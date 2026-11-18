# SMARTBUZ — Licensing and subscriptions

Phase 6 turns SMARTBUZ into a SaaS platform: a business buys a plan, the plan
decides what it may use, and the platform owner runs the whole thing from a
console.

This document describes how it works. It is written for the people who have to
operate it — the platform owner and the business owner — rather than for the
code.

---

## 1. The shape of it

```
        plan catalogue                 subscription                  entitlements
   ┌────────────────────┐        ┌────────────────────┐        ┌────────────────────┐
   │  plans             │        │  subscriptions     │        │  features  (what)  │
   │  key, prices,      │◄──────►│  plan, state,      │───────►│  usage     (how much)│
   │  limits, features  │        │  period, trial     │        │                    │
   └────────────────────┘        └────────────────────┘        └────────────────────┘
            │                             │                              │
            │                             ▼                              ▼
   ┌────────────────────┐        ┌────────────────────┐        ┌────────────────────┐
   │  payments          │───────►│  the write gate    │───────►│  the modules       │
   │  pending → verified│        │  in requirePermission│       │  purchasing, BI…   │
   └────────────────────┘        └────────────────────┘        └────────────────────┘
```

Six tables carry it: `plans`, `subscriptions`, `subscriptionEvents`,
`subscriptionPayments`, `licenseKeys` and `devices`.

---

## 2. The plan catalogue

Pricing is **data**, not code. The four built-in plans are a *seed*; once the
`plans` table is written, the table is the only thing read.

| Plan | Monthly | Annual | Trial | Grace | Devices | Branches | Warehouses | Staff | Products |
|---|---|---|---|---|---|---|---|---|---|
| Starter | 50,000 | 500,000 | 14 days | 7 days | 1 | 1 | 1 | 3 | 100 |
| Business | 150,000 | 1,500,000 | 14 days | 7 days | 3 | 3 | 3 | 10 | 500 |
| Professional | 400,000 | 4,000,000 | 14 days | 7 days | 10 | 10 | 10 | 25 | 2,000 |
| Enterprise | 1,200,000 | 12,000,000 | 14 days | 7 days | unlimited | unlimited | unlimited | unlimited | unlimited |

Amounts are in UGX. **A limit of 0 means unlimited.**

The platform owner creates and prices plans in the console. The annual price is
never more than twelve monthly payments — the seed sets it that way, and the
console shows the discount against the monthly rate.

`plans.seedDefaults` writes the four built-in plans once. Running it again
does **not** overwrite prices that have been edited by hand.

A retired plan keeps the businesses already on it but cannot be chosen again.

---

## 3. The states of a subscription

| State | Meaning | Can write? |
|---|---|---|
| `trial` | The free trial is running. | ✅ |
| `active` | Paid for, up to date. | ✅ |
| `past_due` | A payment failed. A grace window has opened. | ✅ |
| `grace` | Inside the grace window. The business still works. | ✅ |
| `suspended` | Put on hold by the platform owner. | ❌ |
| `expired` | The trial or the paid period ran out. | ❌ |
| `cancelled` | Ended at the business's own request. | ❌ |

The state a business is *actually* in is computed from the dates, not read
from a stored label — so a subscription whose trial quietly ran out becomes
`expired` on its own, without anybody having to remember to change it.

### Grace periods

When a payment is rejected the subscription moves to `past_due` and a grace
window opens (7 days by default). Inside that window the business keeps
working. When the window closes the subscription becomes `expired` and the
writing stops.

### Nothing is ever deleted

**This is a hard rule.** When a subscription ends:

- no sales, stock, customers, invoices or reports are deleted;
- no row in `subscriptions` is deleted — it is cancelled or suspended;
- `subscriptionEvents` keeps the full history of what happened and when.

What changes is only what the business is *allowed to do*. A lapsed business
keeps the right to **read** its own data and its own invoice; it loses the
right to **record** anything new. A subscription is a key, not a container.

---

## 4. The write gate

The gate lives in one place: `requirePermission` in `convex/tenancy.ts`.

That is deliberate. `requirePermission` is the single point every
business-scoped mutation passes through, so putting the check there means
there is no way to add a function and forget to protect it. There is no
client-side check anywhere — the browser can be told anything, and the
server decides.

The gate applies **only to write-ish permissions**. A permission that reads
is never blocked, so an expired business can still look at its books, export
a report and read its subscription.

Permissions that count as writes are recognised by their verb:

```
manage  create  cancel  refund  adjust  transfer  pay  return
record  set  update  delete  export
```

`export` counts as a write because exporting takes data out of the business.

### A business with no subscription on record is not gated

If there is no row in `subscriptions` for a business, nothing about it is
gated. This keeps self-hosted installations and pre-existing data working.
Every business created through registration, through the platform console, or
through the API carries a subscription and *is* gated.

---

## 5. Entitlements and usage limits

Two different ideas, often confused:

**Features — what may this business use at all?**

| Key | What it opens |
|---|---|
| `core.sales` | Selling, the till, receipts |
| `core.stock` | Products, stock levels, movements |
| `core.customers` | The customer directory |
| `purchasing` | Suppliers, purchase orders, goods received, invoices, returns |
| `customer.credit` | The credit book: accounts, statements, balances, payments |
| `loyalty.points` | Loyalty points and adjustments |
| `finance.reports` | Income, reconciliation, the financial summary |
| `business.intelligence` | The reporting suite: profit and loss, best sellers, stock valuation |
| `multi.branch` | More than one branch |
| `multi.warehouse` | More than one warehouse |
| `api.access` | Programmatic access |
| `priority.support` | Priority support |
| `custom.domain` | A domain of the business's own |

Which plans carry which:

| Plan | Features |
|---|---|
| Starter | `core.sales`, `core.stock`, `core.customers` |
| Business | the above **+** `purchasing`, `customer.credit`, `loyalty.points`, `multi.branch`, `multi.warehouse` |
| Professional | the above **+** `finance.reports`, `business.intelligence` |
| Enterprise | everything, including `api.access`, `priority.support`, `custom.domain` |

**Usage — how much of it there is allowed?**

Branches, warehouses, staff and products. Usage is **counted from the real
records**, never from a counter that could drift out of step with reality.

The first branch and the first warehouse are always allowed — every business
needs somewhere to sell from. A second one means the business has outgrown a
single-site plan, so `multi.branch` / `multi.warehouse` must be on the plan.

---

## 6. Payments

**A payment is not a payment until it has been verified.**

The flow:

1. The business submits a payment: amount, cycle, provider, and the
   reference the provider gave them. It is recorded as `pending`.
2. Somebody with authority — a platform administrator — confirms it against
   the provider's **own record**.
3. Only then does the subscription extend and the payment become `verified`.

If the payment is rejected, the subscription moves to `past_due` and a grace
window opens.

### The amount comes from the plan, not the browser

`billing.submitPayment` recomputes the price from the plan on file and
**refuses** an amount that does not match it. A caller cannot "pay" one
shilling for a year by editing a request.

`billing.verifyPayment` checks the amount the provider shows against the
amount recorded, and refuses to confirm a payment whose two figures differ.

### The same money cannot be claimed twice

A provider reference identifies one payment. The same reference from the same
provider is refused the second time.

### A note on payment gateways

**No live payment gateway is integrated in this phase.** No gateway
credential has been authorised for this deployment, and integrating a
provider's API without one would mean inventing behaviour.

What *is* complete is the mechanism: pending → verified → the subscription
extends, with the duplicate guard, the server-computed amount and the grace
window on rejection all in place. The seam where a gateway goes is a single
function, `billing.verifyPayment`. Wiring a real provider in means calling
that function from the provider's own webhook, after checking the webhook's
signature against the provider's documented method.

---

## 7. License keys

A license key is a printed code a business can redeem:

```
SBUZ-X7K2M-9QRTB-H4VNC-8JWD3
```

- The key is **shown exactly once**, at the moment it is issued.
- What is stored is an **HMAC-SHA256 hash**, pegged with
  `SMARTBUZ_SERVER_SECRET`, plus a five-character hint so a person can
  recognise their own key.
- A database read cannot be turned back into a working license key.

The pepper is `SMARTBUZ_SERVER_SECRET`, falling back to `RESEND_API_KEY` and
then `SESSION_SECRET`. If none is set, the public fallback pepper is used —
which is fine for development and **not** for production. Set it on both the
Next.js server and the Convex deployment.

Redeeming a key moves the account onto the plan the key was issued for. A
revoked key cannot be redeemed again, and the record of what was issued and
when it was stopped stays readable.

---

## 8. Devices

Each device is registered by an identifier it reports for itself, with a name
so it can be recognised. The plan's device limit is enforced on the server.

A device that has been revoked cannot be registered again without an
administrator. A device that already exists and has not been revoked simply
updates — registering the same till twice does not use up two places.

---

## 9. The platform console

`/platform`, for platform administrators only. It has four tabs.

**Subscriptions** — every business's subscription, filterable by state, with
a detail panel offering activate, suspend, reactivate, extend, change plan,
cancel, and revoke a device.

**Plans** — the catalogue. Create a plan, edit its prices and limits, retire
it. The prices shown are the prices charged.

**Payments** — the payments waiting to be confirmed, each with a Confirm
button that confirms **the amount recorded**, and a Reject button that opens
a grace window.

**License keys** — issue a key (shown once), list them with their hint and
state, revoke one.

The console is a convenience. The rules are enforced on the server, and a
tenant cannot reach any of it: `subscriptions.view`,
`subscriptions.plan.manage`, `subscriptions.payment.verify` and
`subscriptions.manage` are platform-only permissions, and they are in
`PLATFORM_ONLY_PERMISSIONS` so no business administrator — not even an
owner — can hand them out.

---

## 10. What a new business does

1. Registers, and signs in.
2. In the setup wizard: picks its trade, **picks a plan**, and fills in its
   details.
3. A `subscriptions` row is created with status `trial` and a trial end date
   computed from the plan. The business is now gated by that plan.
4. It uses everything the plan allows. Anything else is refused by the
   server with a message saying which plan it needs.
5. When the trial runs out the business stops recording — but its data is all
   still there, and it can read it and its invoice.
6. It submits a payment. An administrator confirms it. The subscription
   becomes `active` and the period extends.

---

## 11. Permissions

| Permission | Who holds it |
|---|---|
| `subscriptions.self.view` | every business role |
| `subscriptions.self.manage` | owner, admin |
| `subscriptions.view` | platform only |
| `subscriptions.plan.manage` | platform only |
| `subscriptions.payment.verify` | platform only |
| `subscriptions.manage` | platform only |

The first two are the business's own subscription. The last four belong to
the platform and are never grantable inside a business.

The subscription module deliberately does **not** go through the write gate,
because a business whose subscription has lapsed must still be able to renew
it. It checks the role matrix directly instead.

---

## 12. Where things are

| File | What is in it |
|---|---|
| `convex/subscriptionState.ts` | The states, the entitlement catalogue, the built-in plans. A leaf module with no imports from the rest of the backend, so it can be reasoned about on its own. |
| `convex/entitlements.ts` | The guards: `requireEntitlement`, `requireUsageAllowance`, `requireStructureAllowance`, and `getMyEntitlements`. |
| `convex/plans.ts` | The catalogue: list, seed, create, update, retire. |
| `convex/subscriptions.ts` | Trials, activation, renewal, devices, history, redeeming a key. |
| `convex/billing.ts` | Submitting, verifying and rejecting payments. |
| `convex/license.ts` | Issuing, revoking and inspecting license keys. |
| `convex/platform.ts` | The platform console's operations. |
| `convex/tenancy.ts` | `requirePermission` — where the write gate lives. |
| `src/app/(dashboard)/subscription/page.tsx` | The business's subscription page. |
| `src/app/(dashboard)/platform/page.tsx` | The platform console. |
| `src/components/subscription/plan-picker.tsx` | The plan chooser, used by the setup wizard and the subscription page. |
| `tests/subscriptions.test.ts` | The tests. |

`scripts/apply-entitlements.mjs` is the maintenance helper that inserts the
guards into a module. It is idempotent: it removes the guards it knows about
and puts them back.

---

## 13. Operating notes

- Bootstrap the first platform administrator with
  `node scripts/bootstrap-platform-admin.mjs --email <address>`.
- Set `SMARTBUZ_SERVER_SECRET` on the Next.js server **and** on the Convex
  deployment. Without it, session creation and code retrieval stay closed,
  and license-key hashing uses the public fallback pepper.
- A subscription row is never deleted. To end one, cancel it.
- If a business is on a plan that has been retired, it keeps working. It
  cannot move to that plan again, and it cannot be moved *back* to it either.
