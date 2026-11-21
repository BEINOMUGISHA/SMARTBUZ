# 09 — Multi-Tenant Isolation and Data Security

**Commit audited:** `acafd2b`
**Scope:** `convex/tenancy.ts`, `convex/rbac.ts`, every exported Convex function, and every
database read that touches a tenant-owned table.

---

## 1. How isolation is meant to work

Every tenant-owned row carries a `businessId`. Isolation is enforced by three ideas:

1. **The caller's identity comes from the verified token**, never from an argument
   (`convex/tenancy.ts:175-205`).
2. **The business is resolved server-side** from the caller's *membership*, never from a client
   claim (`convex/tenancy.ts:537-563`).
3. **Every table read is scoped by `businessId`**, using an index that starts with
   `businessId`.

The third is the one that has to be repeated by hand in every function, and it is the one that
fails.

---

## 2. How the audit was done

Two static passes over the whole backend, plus a manual review of every finding.

**Pass 1 — unguarded functions.** Every one of the **440** exported Convex functions was
extracted and its handler scanned for a guard call. Thirty-one distinct guard functions were
recognised (`requireTenant`, `requireUser`, `requirePermission`, `requirePlatformRole`,
`requireBillingManager`, `requireAuditAccess`, `requireMigrationOperator`, `requireEntitlement`,
`requireUsageAllowance`, `assertSubscriptionWritable`, `serverSecretMatches` and the rest).
**Eleven public functions had no guard.**

**Pass 2 — unguarded reads.** Every `ctx.db.query("…")` was extracted and checked for a
`businessId` term. **51 candidates**, each reviewed by hand. Most were false positives — a
`withSearchIndex` followed by `.filter(q => q.eq(q.field("businessId"), businessId))`, or a
read by a foreign key that had already been proven to belong to the tenant.

**Pass 3 — the whole-table pattern.** Every `.collect()` immediately followed by an in-memory
`.filter(… .businessId === businessId)` was counted: **28**.

---

## 3. Findings

### 3.1 C-01 — CRITICAL: two financial reports read across every tenant

Detailed in report 07. In summary:

`convex/reports.ts:19-22` and `convex/reports.ts:65-68` read `sales` through the `by_date`
index, which is not business-scoped (`convex/schema.ts:667`:
`.index("by_date", ["date"])`), and aggregate the result. The tenant guard and the permission
check are both correct and both irrelevant to the leak.

**Every other `sales` index used anywhere in the codebase is business-scoped**, and the report
file itself uses `by_businessId_date` in 25 of its 27 functions. This is a single slip.

### 3.2 C-02 — CRITICAL: an unauthenticated caller can mark an adapter "verified"

`convex/integrations/engine.ts:263-300`:

```ts
export const saveTestResult = mutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        verificationStatus: v.string(),
        lastTestedAt: v.string(),
        lastTestResult: v.string(),
        lastTestPassed: v.boolean(),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.query("integrationConfigs")...unique();
        if (!existing) throw new ConvexError("That adapter has no configuration to record the test against.");
        await ctx.db.patch(existing._id, {
            verificationStatus: args.verificationStatus,
            verifiedAt: args.verifiedAt,
            lastTestedAt: args.lastTestedAt,
            lastTestResult: args.lastTestResult,
            lastTestPassed: args.lastTestPassed,
            updatedBy: args.userId,
            updatedAt: new Date().toISOString(),
        });
    },
});
```

There is **no `requireTenant`, no `requirePermission`, no session check**. The function's own
comment explains why it was written this way:

> *Split out because an action cannot write to the database — it has to ask a mutation to do
> it.*

That reasoning is right, but the conclusion drawn from it was wrong. A Convex action can call
an **internal** mutation (`ctx.runMutation(internal.…)`), which no browser can reach. The
function was made *public* instead, which makes it reachable by anybody who knows the
deployment URL.

**Impact.** The entire integration framework rests on one rule:

> *The adapter must have been proved against the real provider — "configured" is not "works".*

`requireUsableIntegration` (`convex/integrations/config.ts:134`) enforces it. An unauthenticated
caller who knows a `businessId` and an `adapterKey` can set `verificationStatus: "verified"`
and `lastTestPassed: true` on that business's adapter configuration, and from that moment the
adapter may move real money through a provider account the business configured — and, worse,
through one the business *did not* configure but the attacker did, if the attacker can write the
configuration (see C-03 below, which makes exactly that possible).

**Recommendation:** make `saveTestResult` an `internalMutation` and call it from the action
through `internal.integrations.engine.saveTestResult`.

### 3.3 C-03 — HIGH: an unauthenticated caller can write payment and message records into any business

Three "recorder" mutations exist so that actions can write to the database. All three are
public and unauthenticated:

| Mutation | File | What an unauthenticated caller can do |
|---|---|---|
| `recordEvent` | `convex/integrations/engine.ts:108-137` | Insert an arbitrary row into `integrationEvents` for any `businessId`, with any `userId` |
| `recordMessage` | `convex/integrations/messaging.ts:192` | Insert an arbitrary row into `messages` for any `businessId` |
| `recordPaymentOutcome` | `convex/integrations/payments.ts:232-310` | Insert **or patch** a `paymentIntents` row for any `businessId` — including patching the `status` of a real pending intent |
| `recordCallback` | `convex/integrations/webhooks.ts:349` | Insert an arbitrary row into the webhook log for any `businessId` |

`recordPaymentOutcome` is the serious one, because it patches an existing intent:

```ts
const existing = await ctx.db.query("paymentIntents")
    .withIndex("by_reference", (q) => q.eq("reference", args.reference)).unique();
if (existing) {
    await ctx.db.patch(existing._id, { status: args.status, providerReference: …, error: … });
}
```

The `businessId` is taken from the caller, not from the intent, so it also allows writing an
intent into **another business's** ledger.

**Combined with C-02**, an attacker can: create a payment intent with `recordPaymentOutcome`
pointing at a provider account they control, mark that adapter "verified" with
`saveTestResult`, and then have the platform send live payment requests to their own provider
account — with the money never reaching the business.

**Recommendation:** make all four `internalMutation`s, and have the actions call them through
the `internal` namespace.

### 3.4 H-01 — HIGH: an unauthenticated caller can confirm a payment

`convex/integrations/payments.ts:324-397` (`confirmPayment`) — full detail in report 04.

It sets `confirmedByProvider: true` on the intent, moves the sale's `paymentConfirmation` to
`"confirmed"`, and writes an audit row that reads as though the provider confirmed it. The
`businessId` is checked against the intent (`:349-353`) — but the caller supplies it, and the
caller is not authenticated.

The legitimate callers (the webhook handler, which verifies the signature, and
`verifyPaymentWithProvider`, which checks the `payments.verify` permission) are both correct.
The function simply trusts its caller.

**Recommendation:** `internalMutation`, reachable only from the two legitimate paths.

### 3.5 H-02 — HIGH: login throttling can be bypassed

Full detail in report 03. The Convex mutation `users:login` (`convex/users.ts:376`) is public
and unthrottled; the Next.js route's limiter is only one of the ways in.

### 3.6 M-02 — MEDIUM: the audit trail can be forged

Every "recorder" mutation in 3.3 accepts a `userId` argument and writes it into the row. An
unauthenticated caller can therefore attribute an event, a message or a payment record to any
user of any business. The audit trail is a record of what happened; a record that can be written
by anybody is not an audit trail.

### 3.7 M-11 — LOW: a leftover diagnostic query

`convex/whoami.ts`:

```ts
/**
 * Temporary diagnostic: echoes the authenticated identity.
 * Used by the auth smoke test; removed once the tenancy layer is verified.
 */
export const whoami = query({ args: {}, handler: async (ctx) => await ctx.auth.getUserIdentity() });
```

The tenancy layer has been verified. The query returns the caller's own identity, or `null` for
an anonymous caller, so it leaks nothing — but it is a public endpoint that should not be in a
production build. Remove it.

### 3.8 What is *not* wrong — the false positives worth recording

The 51 candidate cross-tenant reads resolved as follows:

| Pattern | Count | Verdict |
|---|---:|---|
| `withSearchIndex(...)` followed by `.filter(q => q.eq(q.field("businessId"), businessId))` | 8 | Correct — the filter is applied |
| Read by a foreign key whose parent was already proven to belong to the tenant (`customers.ts:79-97`) | 12 | Correct |
| Read of a table with no `businessId` column | 6 | Correct |
| Read by `by_businessId*` index | 25 | Correct |
| **Genuinely unscoped** | **2** | **C-01** |

And the eleven unguarded functions:

| Function | Verdict |
|---|---|
| `users:register`, `users:verifyEmail`, `users:requestVerification`, `users:login`, `users:requestPasswordReset`, `users:resetPassword` | Legitimately public — but `login` is unthrottled (H-02) |
| `plans.listEntitlements` | Reached through a guarded path; should be guarded itself (M-33) |
| `whoami` | Harmless, should be removed (M-11) |
| `integrations.engine.recordEvent`, `engine.saveTestResult` | **C-02, C-03** |
| `integrations.messaging.sendMessage` | Guarded through `prepareAdapterCall` — correct |
| `integrations.messaging.recordMessage` | **C-03** |
| `integrations.payments.initiatePayment` | Guarded through `prepareAdapterCall` — correct |
| `integrations.payments.recordPaymentOutcome` | **C-03** |
| `integrations.payments.confirmPayment` | **H-01** |
| `integrations.webhooks.recordCallback` | **C-03** |

---

## 4. Isolation controls that work

| Control | Where | Assessment |
|---|---|---|
| Tenant resolution | `convex/tenancy.ts:537-563` | Correct — a requested business must be one the caller is a member of |
| Membership check | `convex/tenancy.ts:374` | Correct |
| Permission check | `convex/tenancy.ts:496-518` | Correct, and it also gates the subscription |
| Branch scoping | `convex/tenancy.ts:614-649` | Correct |
| Platform role separation | `convex/tenancy.ts:262-269` | Correct — a separate table |
| Ownership checks on foreign keys | `salesCore.ts:564`, `stocks.ts:596`, `customers.ts:64`, `suppliers.ts` | Correct and consistent |
| Sale item ownership | `salesCore.ts:564-568` | Correct |
| Refund item ownership | `sales.ts:1108-1113` | Correct |
| Offline push idempotency scoped to the tenant | `convex/sync.ts:273-279` | Correct — the index is global, the filter is applied |
| Payment intent ownership | `payments.ts:349-353` | Correct *as a check*; the caller is not authenticated (H-01) |

---

## 5. Data protection

| Aspect | Assessment |
|---|---|
| Passwords | bcrypt, cost 10 |
| Verification and reset codes | bcrypt-hashed, expiring |
| Sessions | Only the SHA-256 hash of the secret is stored |
| Session cookie | HttpOnly, SameSite |
| Access tokens | RS256, 15 minutes, session-bound |
| Integration credentials | AES-GCM encrypted at rest (`convex/crypto.ts` `encryptSecret` / `decryptSecret`, PBKDF2 key derivation) |
| Secrets in the client bundle | **None found.** No private key, no provider credential and no session secret is referenced from any `src/` client component. `SMARTBUZ_JWT_PRIVATE_KEY` is read only in `src/lib/convex-token.ts`, which is imported only by server routes. |
| `NEXT_PUBLIC_*` exposure | Only the deployment URL and the site URL, both public by nature |

**M-34 (Low).** The `ses` claim carries the session secret in the JWT payload in cleartext
(base64 is not encryption). A holder of the access token can read the session secret from it.
The impact is limited — they already have the token — but the secret would rather live in an
HTTP-only cookie.

---

## 6. Summary

| ID | Severity | Finding |
|---|---|---|
| **C-01** | **Critical** | `getDailyProfitLoss` / `getMonthlyProfitLoss` aggregate across every tenant |
| **C-02** | **Critical** | `saveTestResult` lets an unauthenticated caller mark an adapter "verified" |
| **C-03** | **High** | `recordEvent` / `recordMessage` / `recordPaymentOutcome` / `recordCallback` write into any business |
| **H-01** | **High** | `confirmPayment` can be called without authentication |
| **H-02** | **High** | `users:login` is unthrottled |
| M-02 | Medium | The audit trail can be forged |
| M-11 | Low | `whoami` is a leftover diagnostic |
| M-33 | Low | `plans.listEntitlements` is unguarded |
| M-34 | Low | The session secret travels in the JWT payload |
