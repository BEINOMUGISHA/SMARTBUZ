# 08 — Subscriptions, Entitlements, Plans and Licensing

**Commit audited:** `acafd2b`
**Scope:** `convex/subscriptionState.ts`, `convex/plans.ts`, `convex/subscriptions.ts`,
`convex/entitlements.ts`, `convex/license.ts`, `convex/billing.ts`, `convex/platform.ts`,
`src/app/(dashboard)/subscription/page.tsx`, `src/app/(dashboard)/platform/page.tsx`,
`docs/LICENSING.md`.

---

## 1. The model

| Concept | Where | Note |
|---|---|---|
| Plan | `plans` table | Price, limits, features |
| Subscription | `subscriptions` table | A business's plan, period, status |
| Entitlement | Derived | "May this business use feature X?" |
| Usage allowance | Derived | "May this business have N of thing?" |
| Device registration | `devices` table | A phone or till, counted against the plan |
| Licence key | `licenseKeys` table | An offline/air-gapped licence |
| Platform console | `convex/platform.ts` | The SMARTBUZ team's own view of every business |

---

## 2. The plans

Four plans, defined once in `convex/subscriptionState.ts:179-294`:

| Plan | Monthly (UGX) | Annual (UGX) | Trial | Grace | Devices | Users | Branches | Warehouses | Products |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **Starter** | 50,000 | 500,000 | 14 d | 7 d | 1 | 3 | 1 | 1 | 100 |
| **Business** | 150,000 | 1,500,000 | 14 d | 7 d | 3 | 10 | 3 | 3 | 1,000 |
| **Professional** | 400,000 | 4,000,000 | 14 d | 14 d | 10 | 50 | 10 | 10 | 10,000 |
| **Enterprise** | 1,200,000 | 12,000,000 | 30 d | 30 d | ∞ | ∞ | ∞ | ∞ | ∞ |

Features are additive: `core.sales`, `core.stock`, `core.customers` are on every plan;
`purchasing`, `customer.credit`, `loyalty.points`, `multi.branch`, `multi.warehouse` start at
Business; `finance.reports` and `business.intelligence` at Professional; `api.access`,
`priority.support` and `custom.domain` at Enterprise.

The pricing is plausible for the market and the limits are coherent. **0 means unlimited**
(`deviceLimit: 0` at `:270`), which is documented in the plan definition.

---

## 3. The status model — good

`convex/subscriptionState.ts:10-51`:

| Status | Meaning | Can write? |
|---|---|---|
| `trial` | The free period | **Yes** |
| `active` | Paid and current | **Yes** |
| `past_due` | A payment failed; the grace window is running | **Yes** |
| `grace` | The grace window is running | **Yes** |
| `suspended` | Suspended by the platform | No |
| `expired` | The period is over and nothing was paid | No |
| `cancelled` | Cancelled | No |

`WRITABLE_STATUSES = ["trial", "active", "grace"]` (`:47`).

**Two design decisions worth calling out.**

**The status is derived from the clock, not only from the stored row** (`:324-356`). A trial
whose trial period has ended is `expired` even though nobody has gone round and set it to
`expired`. A `past_due` subscription stays writable until its grace window closes. That means
the platform does not need a scheduled job to keep the state honest — the state is a function of
the subscription row and the current time.

**The write gate is inside `requirePermission`** (`convex/tenancy.ts:513-515`):

```ts
if (isWritePermission(permission)) {
    await assertSubscriptionWritable(ctx, businessId);
}
```

This is the strongest thing about the licensing design: a handler **cannot forget** to check
the subscription, because the check lives in the permission function every write goes through.
`assertSubscriptionWritable` is called from exactly one place — `convex/tenancy.ts:514` — and
that is the point.

**Nothing is deleted when a subscription ends.** The data stays; the writing stops
(`convex/tenancy.ts:493-494`).

---

## 4. Entitlements

`convex/entitlements.ts` provides:

| Function | Purpose |
|---|---|
| `resolvePlan` | The plan a business is on, with its features |
| `requireEntitlement` (`:153`) | Refuse unless the plan grants the feature |
| `requireActiveEntitlement` (`:180`) | The same, plus the subscription must be active |
| `requireUsageAllowance` (`:303`) | Refuse when a countable limit is reached |
| `requireStructureAllowance` (`:335`) | The same for branches, warehouses, users |
| `subscriptionCoveredAt` (`:209`) | Whether the business was entitled **at a past moment** |

`subscriptionCoveredAt` is the subtle one, and it is used correctly. An offline sale made
during a valid subscription must still be recordable after the subscription has lapsed — so
`sync.pushTransactions` asks "were you entitled *then*?" rather than "are you entitled now?"
(`convex/sync.ts:304-312`). Getting this wrong would either lose real sales or let a lapsed
business keep trading.

Enforcement is spread across the domain modules and is present where it matters:
`convex/analytics.ts` (12 endpoints, `business.intelligence`), `convex/customers.ts`
(`customer.credit`, `loyalty.points`), `convex/finance.ts` (`finance.reports`),
`convex/purchasing.ts` (`purchasing`).

---

## 5. Devices

`sync.registerDevice` (`convex/sync.ts:110-225`) registers a phone or till against a business.
It refuses a device over the plan's limit, and a revoked device cannot push sales
(`convex/sync.ts:261-265`).

`subscriptions.registerDevice` (`convex/subscriptions.ts:557`) is the subscription-aware
equivalent, and `subscriptions.listDevices` (`:649`) lists them. `platform.revokeDevice`
(`convex/platform.ts:1179`) removes one from the platform's side.

**Assessment: good.** The device limit is enforced at registration and a revoked device is
refused at push time, so the enforcement is not only at the door.

---

## 6. Licensing (offline / air-gapped)

`convex/license.ts` issues, revokes and inspects licence keys. Every one of those four
operations requires `requirePlatformPermission` — they are platform-operator actions, not
tenant actions, and a tenant cannot mint a licence for themselves.

**M-31 (Low).** The whole table is read with the whole-table pattern in one place
(`convex/license.ts` — see report 14). At the number of licence keys a platform operator will
ever hold, this is immaterial; it is listed for completeness.

---

## 7. Billing

`convex/billing.ts` records subscription payments. `verifyPayment` (`:259`), `rejectPayment`
(`:371`) and `listAllPayments` (`:441`) all require `requirePlatformPermission`.

**M-32 (Medium).** The billing functions are guarded by a *platform* permission, but a
subscription payment is a fact about the **business's** money. There is no route by which the
business owner can see what the platform has recorded as paid for their subscription, or
dispute it. `subscriptions.getHistory` (`convex/subscriptions.ts:278`) shows the tenant their
subscription history, but the *payments* against it are platform-side only.

**Recommendation:** expose a read-only view of the business's own payment history.

---

## 8. Platform console

`convex/platform.ts` is the SMARTBUZ team's own console: list every business, suspend one,
activate a subscription, change a plan, cancel one, extend a period, revoke a device, list and
manage platform administrators.

The guards are right:

* `requirePlatformRole(ctx, ["platform_super_admin", "platform_support"])` for reads
  (`:95`, `:133`, `:162`);
* `requirePlatformWrite(ctx)` — which is `requirePlatformPermission(ctx, "subscriptions.manage")`
  — for writes (`:64-68`);
* platform roles live in the `platformAdmins` table, never on the user record
  (`convex/tenancy.ts:262-269`), so a business owner can never grant themselves one;
* the last active super administrator cannot be removed (`:393-408`);
* `grantRole` additionally requires the server secret (`:321`).

`tests/subscriptions.test.ts` (56 tests) asserts the boundary, including *"does not let a
tenant reach the platform console"* and *"does not let one business reach another business's
subscription"*.

---

## 9. Plan administration

`convex/plans.ts` — `list`, `getByKey`, `listAll`, `seedDefaults`, `create`, `update`, `retire`,
`listEntitlements` — all require `requirePlatformPermission`.

Two design points are worth noting:

* A plan's **price** lives only in the `plans` table, never in the application code
  (`convex/plans.ts:17-19`).
* Changing a plan's price does **not** change what existing subscribers pay for the period they
  have already paid for; a price change applies to the next period
  (`convex/plans.ts:254-259`).

That is the correct commercial behaviour and it is easy to get wrong.

**M-33 (Low).** `plans.listEntitlements` (`convex/plans.ts:388`) has no guard of its own
although its siblings do. It is reached through a guarded path in practice, but it should be
guarded like the rest — the platform's plan catalogue is not tenant-visible.

---

## 10. Summary

| Area | Assessment |
|---|---|
| Plan catalogue and pricing | **Good** — one source, additive features, plausible limits |
| Subscription status derived from the clock | **Good** |
| Write gate inside `requirePermission` | **Excellent** — cannot be forgotten |
| Grace period behaviour | **Good** |
| Nothing deleted on lapse | **Good** |
| Offline sales against a lapsed subscription | **Good** — `subscriptionCoveredAt` |
| Feature entitlements | **Good** — enforced in the domain modules |
| Device limits and revocation | **Good** |
| Platform console separation | **Good** |
| Price changes do not affect a paid period | **Good** |
| Licence key administration | **Good** |
| Tenant visibility of their own payments | **Absent (M-32)** |
| `plans.listEntitlements` guard | **Missing (M-33)** |
