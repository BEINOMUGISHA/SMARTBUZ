# SMARTBUZ v2.0 — 11 · Licensing and Subscription Test Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Scope:** PART 8 — subscriptions, licensing, plan gating, device limits, trials, grace periods, payment confirmation and revocation.

---

## 1. Method

| Aspect | Detail |
|---|---|
| Inspection | `convex/subscriptions.ts`, `convex/license.ts`, `convex/entitlements.ts`, `convex/subscriptionState.ts`, `convex/plans.ts`, `convex/billing.ts`, `convex/platform.ts`, `convex/sync.ts` (device registration), `convex/users.ts` (device registration), `convex/tenancy.ts:496-518` (the write gate), `convex/businesses.ts` (signup paths) |
| Analysis | A programmatic map of every `requireEntitlement` / `assertSubscriptionWritable` call site across the backend, and a trace of every path that creates or mutates a `subscriptions` row |
| Ran | `npm test` (local only — `tests/subscriptions.test.ts` passes) |
| Not ran | Any mutation against the live deployment: no plan was selected, no subscription was created, expired or renewed |

---

## 2. How the licensing system actually works

```
Plan catalogue (convex/plans.ts, DEFAULT_PLANS in subscriptionState.ts)
        │  features[] + deviceLimit + maxUsers/maxBranches/maxProducts
        ▼
Subscription row (per business)  ──►  status: trial | active | grace | past_due | expired | suspended | cancelled
        │
        ├─► subscriptionSnapshot()  →  features, status, daysRemaining, explanation
        │        │
        │        └─► requireEntitlement(ctx, businessId, feature)   ← 57 call sites, 5 add-on features
        │
        └─► requirePermission()  →  for WRITE permissions only
                 └─► assertSubscriptionWritable()  →  refuses writes when not in trial/active/grace
```

**The enforcement model is server-side and correct in shape**: plan features are checked inside the Convex
function, never in the browser, and the check refuses with a message written for a business owner
("Your Current plan does not include X. Upgrade your plan to use it.", `convex/entitlements.ts:169-171`).
Expiry is enforced by a **write-only** gate (`convex/tenancy.ts:513-515`), so a lapsed account keeps reading
its own history while it can no longer record anything new.

---

## 3. Summary table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Plan catalogue | PASSED | `convex/plans.ts`, `convex/subscriptionState.ts:179-306` | `DEFAULT_PLANS` is the seed when the table is empty; plan management is platform-only (`requirePlatformPermission`, `convex/plans.ts:118`) |
| Feature entitlements enforced server-side | PASSED | 57 `requireEntitlement` call sites: purchasing 24, business.intelligence 11, finance.reports 5, customer.credit 5, loyalty.points 2 | In `convex/analytics.ts`, `customers.ts`, `finance.ts`, `purchasing.ts`, `suppliers.ts` |
| Trial creation | PASSED | `convex/subscriptions.ts:152-200` (`startTrial`) | Creates a tracked row with `trialEndsAt` |
| Grace period | PASSED | `convex/subscriptionState.ts:47,349-353` | `grace` is writable; a failed payment keeps the business working until the window closes |
| Payment confirmation | PASSED | `convex/subscriptions.ts:446-500`, `convex/billing.ts:259-262` | A plan activates only from a `subscriptionPayments` row with `status === "verified"`; `verifyPayment` needs the platform permission `subscriptions.payment.verify` |
| Licence-key redemption | PASSED | `convex/subscriptions.ts:742-820`, `convex/license.ts:46-63` | Keys are HMAC-SHA256 hashed, revoked/expired/used keys are refused, and the key space is ~96 bits |
| Data preservation on expiry | PASSED | `convex/subscriptionState.ts:466-472` | "The business keeps its data — nothing is deleted" — enforced in code |
| **Plan changes** | **FAILED** | `convex/subscriptions.ts:352-399` | **A tenant can move itself to any active plan without paying — see LIC-01** |
| Trial expiry | **FAILED** | `convex/subscriptionState.ts:355` | A trial with no end date never expires — see LIC-03 |
| Businesses without a subscription row | **FAILED** | `convex/businesses.ts:256-341`, `convex/entitlements.ts:110-122,160-161` | Fully ungated — see LIC-02 |
| Device limits | **FAILED** | `convex/sync.ts:157-174,209-215` | Skipped when there is no subscription row; only enforced at registration — see LIC-04 |
| Revocation | PASSED | `convex/platform.ts:1179`, `convex/subscriptions.ts:682` | Device revocation and subscription suspension are platform operations with an audit trail |

---

## 4. Findings

### LIC-01 — A tenant can move itself to any paid plan without paying
- **ID:** LIC-01 · **Module:** Subscriptions · **Severity:** **CRITICAL**
- **Description:** `subscriptions.selectPlan` is callable by a business owner or manager
  (`requireSubscriptionManager`, `convex/subscriptions.ts:334-337`). When the business already has a
  subscription row, the handler **patches `planKey` to whatever active plan the caller names** and stops
  there — no payment, no tier comparison, no period change, no approval:
  ```ts
  const fromPlan = existing.planKey;
  await ctx.db.patch(existing._id, { planKey: args.planKey, updatedAt: now.toISOString() });
  ```
  (`convex/subscriptions.ts:362-366`). Entitlements are then recomputed from the **patched plan**, because
  `subscriptionSnapshot` resolves the plan from `subscription.planKey`
  (`convex/entitlements.ts:105-108`) and `requireEntitlement` tests `planHasFeature(snapshot.plan, feature)`
  (`convex/entitlements.ts:163`). The status is untouched, so the write gate
  (`assertSubscriptionWritable`) stays open. The result: **one mutation call upgrades any tenant to the most
  expensive plan in the catalogue**, unlocking purchasing, business intelligence, finance reports, customer
  credit and loyalty — along with that plan's `deviceLimit`, `maxUsers`, `maxBranches` and `maxProducts` —
  for nothing. The event and audit records the change (`subscription.plan_changed`, `:368-389`), so the
  platform can see it happened; nothing prevents it.
- **Steps to reproduce:** As a business owner, call `api.subscriptions.selectPlan` with `{ planKey: "<most expensive active plan>" }`. The subscription's `planKey` changes and every entitlement of that plan becomes available immediately. (Not executed against production — it would grant a subscription this audit has no right to grant.)
- **Expected behavior:** A plan change takes effect only after a verified payment, or through a platform-admin action. A self-service change should at most *request* an upgrade and leave the entitlements on the current plan until the payment is confirmed.
- **Actual behavior:** The entitlement set changes instantly and unconditionally.
- **Root cause:** The handler conflates "choose the plan to be billed for" with "activate the plan's features", and the entitlement check reads the plan key rather than the billing state.
- **Recommended fix:** (1) Do not patch `planKey` in `selectPlan`. Instead record a *pending* plan change (a `pendingPlanKey` field) and apply it only when `subscriptionPayments` reaches `status === "verified"` — the same rule `activateSubscription` already follows. (2) If self-service escalation is wanted, it must go through the payment path. (3) Until then, restrict `selectPlan` to plans of equal or lower tier, and require the platform permission for upgrades. (4) Add a regression test that asserts the entitlement set does not change when `selectPlan` is called without a verified payment.
- **Test to verify the fix:** A tenant on the lowest plan calls `selectPlan` with the highest plan and is refused, or the call records a pending upgrade while `requireEntitlement` continues to refuse the higher-tier feature.

### LIC-02 — The public registration path creates a tenant that no licensing rule applies to
- **ID:** LIC-02 · **Module:** Subscriptions / onboarding · **Severity:** **HIGH**
- **Description:** `businesses.register` is a public mutation — its own comment says *"Public on purpose — this is how a new customer arrives"* (`convex/businesses.ts:245-255`). It creates the owner, the business, the membership, a warehouse, a branch, categories and an employee record, and sets `plan: "trial"` and `subscriptionStatus: "trial"` on the business row (`convex/businesses.ts:340-341`) — but it **never calls `startTrial`, so no `subscriptions` row is created**. The entitlement system reads "no subscription row" as *not licensed and therefore not gated*:
  ```ts
  if (!snapshot.subscription) return;          // convex/entitlements.ts:160-161
  ```
  and the snapshot reports `features: ALL_ENTITLEMENTS` and `writable: true`
  (`convex/entitlements.ts:110-121`). The same absence makes `deviceLimit()` return 0, which switches the
  device cap off entirely (`convex/sync.ts:209-215` — see LIC-04). So a tenant created this way has every
  paid feature, no device limit and — because a "trial" with no end date never lapses (LIC-03) — no
  expiry. **The normal user journey is safe**: `/auth/register` calls `api.users.register`
  (`src/app/auth/register/page.tsx:18`) and `/setup` calls `api.businesses.createForCurrentUser`, which *does*
  call `startTrial` (`convex/businesses.ts:535`). The bypass is the unused public endpoint — reachable by
  anyone who knows the deployment URL, which is published in the client bundle.
- **Steps to reproduce:** Static inspection: `grep -rn 'insert("subscriptions"' convex/` → only `convex/platform.ts:832`, `convex/subscriptions.ts:166` and `:802`. `businesses.register` (`:256-341`) is not among them.
- **Expected behavior:** Every business — however created — has a subscription row with a trial end date, so the trial expires and the entitlements are tiered.
- **Actual behavior:** A business created through the public registration endpoint is permanently ungated.
- **Root cause:** Two ways to create a business exist, and only one of them starts a trial.
- **Recommended fix:** Make `businesses.register` call `startTrial` exactly as `createForCurrentUser` does. Failing that, remove `businesses.register` from the deployed function set if the UI no longer uses it. As a belt-and-braces measure, make `loadSubscriptionStatus` treat a missing subscription row as a **expired** state rather than an ungated one, and treat "not licensed" as "nothing beyond the core tier" instead of "everything".
- **Test to verify the fix:** A test that registers a business through `businesses.register` and asserts a `subscriptions` row exists with a `trialEndsAt`, that a write is refused after that date, and that an add-on feature is refused before it.

### LIC-03 — A trial with no end date never expires
- **ID:** LIC-03 · **Module:** Subscriptions · **Severity:** **MEDIUM**
- **Description:** `computeEffectiveStatus` decides a trial has ended only when there is an end date to compare
  against:
  ```ts
  const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : undefined;
  ...
  if (periodEndMs !== undefined && nowMs > periodEndMs) return "expired";
  return status;                       // convex/subscriptionState.ts:341-357
  ```
  A subscription (or a business carrying only `subscriptionStatus`) with **no** `currentPeriodEnd` and **no**
  `trialEndsAt` therefore stays in `trial` forever, and `trial` is a writable status
  (`WRITABLE_STATUSES = ["trial", "active", "grace"]`, `convex/subscriptionState.ts:47`). `daysRemaining`
  returns `undefined` for the same reason (`:361-371`), so the UI cannot even show a countdown.
- **Steps to reproduce:** Static inspection of `convex/subscriptionState.ts:327-371` together with the business
  row written by `businesses.register` (`convex/businesses.ts:340-341`), which sets `subscriptionStatus`
  without `subscriptionExpiresAt`.
- **Expected behavior:** A trial always has an end date; a subscription without one is either repaired or treated as expired.
- **Actual behavior:** The trial is eternal and invisible to the countdown.
- **Root cause:** The absence of an end date is treated as "not yet expired" rather than as "not configured".
- **Recommended fix:** In `computeEffectiveStatus`, treat a missing end date on a `trial` status as `expired` (or as a 30-day default), and make `startTrial` the only way a trial status can be produced. Add a defensive check on write that a trial without an end date is repaired.
- **Test to verify the fix:** A unit test over `computeEffectiveStatus` asserting that `{ status: "trial" }` with no end date is `expired`, and that a trial with an end date in the past is `expired`.

### LIC-04 — Device limits are enforced only at registration, and only when a subscription row exists
- **ID:** LIC-04 · **Module:** Licensing / devices · **Severity:** **MEDIUM**
- **Description:** Two gaps compound. (1) **The cap is skipped when there is no subscription row**:
  `deviceLimit()` returns `0` when it finds no subscription (`convex/sync.ts:209-215`), and `registerDevice`
  only enforces a cap `if (limit > 0)` (`convex/sync.ts:161-174`) — so `0` means "no limit", not "no
  devices". A business without a subscription row (LIC-02) can register unlimited tills. (2) **The cap is
  enforced only at registration**: `pushTransactions` looks the device up and refuses only a **revoked**
  one — an unknown `deviceId` is accepted (see `12_OFFLINE_SYNC_REPORT.md` OFF-01, `convex/sync.ts:254-265`)
  — so a till that was never registered, or whose registration was deleted, can still push sales. There is
  also no check that a device still has a slot at the moment it uses the system.
- **Steps to reproduce:** Static inspection of `convex/sync.ts:157-174,209-215,254-265`.
- **Expected behavior:** The device cap is enforced against the number of *active* devices at every point where a device acts, and a business with no subscription registers no devices.
- **Actual behavior:** The cap is checked once, at registration, and skipped entirely in the no-subscription case.
- **Root cause:** The device limit is modelled as a registration-time constraint rather than an ongoing one, and `0` is overloaded to mean both "no subscription" and "unlimited".
- **Recommended fix:** Return `null` from `deviceLimit()` when there is no subscription and treat that as *no devices allowed*; enforce the cap in `pushTransactions` as well as `registerDevice`; and require a registered, non-revoked device id on every sync (OFF-01).
- **Test to verify the fix:** Tests for: a business with no subscription registering a device (refused), a business at its cap pushing from a second unregistered device (refused), and a revoked device pushing (refused — already the case).

### LIC-05 — The `core.*` entitlements in the catalogue are never enforced
- **ID:** LIC-05 · **Module:** Licensing / entitlements · **Severity:** **LOW**
- **Description:** `ENTITLEMENT_CATALOGUE` (`convex/subscriptionState.ts:64-133`) publishes entries for
  `core.sales`, `core.stock` and `core.customers` alongside the five add-ons, and `ALL_ENTITLEMENTS` is
  derived from the catalogue (`:134`). But `requireEntitlement` is only ever called with the five add-on
  keys — there is no call site for `core.sales`, `core.stock` or `core.customers`. The `core.*` entries are
  therefore decorative: removing them from a plan's `features` array would change nothing, and the UI
  presents them as gated capabilities.
- **Steps to reproduce:** `grep -rhoE 'requireEntitlement\(ctx, [^,]+, "[a-z.]+"' convex/` → only `purchasing`,
  `business.intelligence`, `finance.reports`, `customer.credit`, `loyalty.points`.
- **Expected behavior:** Every published entitlement is either enforced or removed from the catalogue.
- **Actual behavior:** Three published entries are not enforced.
- **Root cause:** The catalogue grew to describe the product while the enforcement grew separately.
- **Recommended fix:** Either gate the `core.*` features in `requirePermission`/`requireTenant` (so a plan without `core.sales` cannot sell), or remove them from the catalogue and from the pricing page so the UI does not promise them.
- **Test to verify the fix:** A test asserting that every key in `ENTITLEMENT_CATALOGUE` appears in at least one `requireEntitlement` call, or is explicitly listed as ungated.

### LIC-06 — A plan change does not adjust billing or the entitlement of *existing* data
- **ID:** LIC-06 · **Module:** Subscriptions · **Severity:** **MEDIUM**
- **Description:** `selectPlan` changes only `planKey` (`convex/subscriptions.ts:363-366`). The billing
  cycle, the amount, `currentPeriodStart` and `currentPeriodEnd` are untouched, and no payment is required
  (LIC-01). A tenant that switches from a monthly plan to an annual one therefore keeps its monthly period
  while carrying the annual plan's limits, and a tenant that switches *back* keeps whatever the previous
  plan's entitlements were until the next recomputation. The platform-level `changePlan`
  (`convex/platform.ts:1067`) does have a full state machine, but the tenant-facing path does not use it.
- **Steps to reproduce:** Static inspection of `convex/subscriptions.ts:352-399` against `convex/platform.ts:1067-1122`.
- **Expected behavior:** A plan change is a billing event: the new plan's period and price take effect together, and the previous period's entitlements are settled.
- **Actual behavior:** Only the label changes.
- **Root cause:** Two plan-change implementations, one of them incomplete.
- **Recommended fix:** Replace the tenant-facing patch with a call to the same routine the platform console uses, so that a change moves the period, records the price difference and settles the old period — after payment (LIC-01).
- **Test to verify the fix:** A test that changes a plan and asserts the subscription's period, price and status move together and that the change is recorded in the subscription history.

---

## 5. Controls verified as sound

| Control | Evidence |
|---|---|
| Entitlements are enforced in the backend, not the UI | 57 `requireEntitlement` call sites across `analytics.ts`, `customers.ts`, `finance.ts`, `purchasing.ts`, `suppliers.ts` |
| A refusal explains itself to a business owner | `convex/entitlements.ts:169-171` — "Your {plan} plan does not include {label}. Upgrade your plan to use it." |
| A plan is activated only from a verified payment | `convex/subscriptions.ts:446-500` — requires a `subscriptionPayments` row with `status === "verified"` |
| Payment verification is a platform operation | `convex/billing.ts:259-262` — `requirePlatformPermission(ctx, "subscriptions.payment.verify")` |
| Licence keys are never stored in the clear | `convex/license.ts:46-48` — HMAC-SHA256 with the server secret; only a 5-character hint is stored (`keyHint`, `:66-68`) |
| Licence keys have adequate entropy | `convex/license.ts:53-63` — `SBUZ-XXXXX-XXXXX-XXXXX-XXXXX` over a 28-character ambiguity-free alphabet ≈ 96 bits |
| A revoked, expired or used licence key is refused | `convex/subscriptions.ts:762-780` |
| Subscription events and audits are recorded | `recordEvent` + `writeAudit` on every plan change, activation and suspension (`convex/subscriptions.ts:368-389`, `convex/platform.ts`) |
| Business data survives an expiry | `convex/subscriptionState.ts:466-472` — the write gate refuses; nothing is deleted |

---

## 6. NOT IMPLEMENTED

| Item | Evidence |
|---|---|
| Usage-based or seat-metered billing | No metering of any kind beyond the static plan limits |
| A self-service upgrade that completes only after payment | `convex/subscriptions.ts:362-366` applies the plan immediately (LIC-01) |
| Automatic renewal or dunning | No scheduler exists in the backend; `past_due`/`grace` are set by the platform console |
| A plan-change quote or proration | `selectPlan` changes nothing about the period or the amount (LIC-06) |
| Device enforcement at use time | The cap is checked only at registration (LIC-04) |
| A per-tenant feature override | Entitlements come from the plan only |

## 7. NOT TESTED

| Item | Reason |
|---|---|
| Any live subscription transition | Selecting, activating, expiring or cancelling a subscription writes to the live deployment, which the mandate forbids |
| Whether a plan *can* actually be selected without payment in production | Proven from the code path, which does not branch on payment for an existing subscription |
| Provider-side payment confirmation | Requires a funded sandbox account and provider credentials |
| The expiry path end-to-end | Would require expiring a real subscription |
| Whether `selectPlan` is reachable from the shipped UI | The mutation is public and the deployment URL is public; the current UI's use of it was not traced beyond `/setup` (`src/app/setup/page.tsx:132`) |

---

## 8. Counts

**LIC-01** CRITICAL · **LIC-02** HIGH · **LIC-03** MEDIUM · **LIC-04** MEDIUM · **LIC-05** LOW · **LIC-06** MEDIUM

**Counts: 1 CRITICAL, 1 HIGH, 3 MEDIUM, 1 LOW, 0 INFORMATIONAL**

---

## 9. Verdict

The licensing **machinery is well designed and mostly well built**. Entitlements are enforced inside the
backend — 57 call sites across five add-on features — and the refusals are written for a business owner
rather than a developer. The write-only expiry gate is exactly right: a lapsed account keeps its history and
loses only its ability to record new transactions, and nothing is ever deleted. Licence keys are hashed with
HMAC, are ~96 bits of entropy, and are single-use and revocable. Payment confirmation cannot be forged from
a client.

**One defect destroys the value of all of it.** `selectPlan` changes the plan a tenant is on *without a
payment* (LIC-01), and entitlements are read from that plan key — so the entire commercial model is one
mutation away from being void. It is also the kind of defect that survives testing: the code looks correct
(it validates the plan, records an event, writes an audit trail), and the audit trail is what makes it
convincing until someone reads what the status field was *not* changed to.

The second-order findings reinforce each other: a business with no subscription row is entirely ungated
(LIC-02), a trial without an end date never expires (LIC-03), and the device cap is inert in exactly the
same case (LIC-04). All three come from the same design decision — *"no subscription on record means nothing
is gated"* — which is safe for a legacy backfill and dangerous for a live signup path.

**Fix LIC-01 first.** It is a small change (do not patch `planKey` without a verified payment) and it
protects the revenue of every other feature in the product.
