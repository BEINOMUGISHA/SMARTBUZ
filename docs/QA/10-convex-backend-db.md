# 10 — The Convex Backend, the Schema and the Data Model

**Commit audited:** `acafd2b`
**Scope:** `convex/schema.ts`, `convex/_generated/*`, `convex/http.ts`, `convex/auth.config.ts`,
`convex/jwks.ts`, `convex/serverSecret.ts`, `convex/crypto.ts`, every module in `convex/`.

---

## 1. Shape of the backend

| Measure | Value |
|---|---:|
| Tables | 92 |
| — carrying a `businessId` | 84 |
| — genuinely global | 8 |
| Indexes | 306 |
| Exported functions | 440 |
| — queries | 214 |
| — mutations | 210 |
| — actions | 6 |
| — internal queries | 8 |
| — HTTP actions | 2 |
| Modules | 81 files, 41,610 lines |

**The eight global tables** are: `businesses`, `users`, `platformAdmins`, `emailVerifications`,
`userTypes`, `businessProfiles`, `passwordResets`, `plans`. Every one of them is global for a
reason — the user table is the identity root, the plan catalogue is the same for everybody, the
platform administrator table must not be reachable from a tenant.

**Only one tenant table lacks a `by_businessId` index**: `sessions`, which is keyed by
`by_sessionId` and `by_userId`. That is correct — a session belongs to a user, not to a business.

---

## 2. The schema

One file, `convex/schema.ts`, 2,551 lines, holding every table, every field and every index.

### 2.1 Conventions

The schema follows a consistent discipline:

* **Identifiers.** `businessId: v.id("businesses")` on every tenant table; `v.optional(...)`
  where the link is genuinely optional (a sale may have no customer, a stock row may have no
  barcode yet).
* **Timestamps.** `createdAt: v.string()` holding an ISO timestamp, consistently.
* **Money.** `v.number()` in the business currency. **There is no minor-unit integer and no
  currency column on the money fields** — the currency lives on the business.
* **Enums.** `v.string()` with the allowed values documented in a comment above the field
  (`/** open | closed */`, `/** add | restock */`, `/** platform_super_admin | platform_support */`).
  Convex has no native enum, and this is the idiomatic way to do it.
* **Indexes.** Every table carries at least one index; the tenant tables carry a
  `by_businessId` index, and the hot tables carry compound ones
  (`by_businessId_date`, `by_businessId_shop_date`, `by_businessId_branch_date`,
  `by_businessId_productCode`, `by_businessId_userId`, `by_businessId_memberNumber`).

### 2.2 Two findings

**M-35 (Medium).** `sales` carries `by_date` (`:667`) and `by_shop_date` (`:668`) — indexes that
are **not** business-scoped — alongside the scoped ones. `by_date` is the index that C-01 uses by
mistake. `by_shop_date` is indexed by a shop, which is itself business-scoped, so it is safe.

The presence of a date-only index on a table where every row has a `businessId` is a trap: it
looks like a natural index to reach for and it silently crosses tenants. **Recommendation:**
either remove `by_date` from `sales`, or rename it to `by_date_unchecked` so the next person
sees the hazard.

**M-36 (Low).** `sales.businessId` is `v.optional(v.id("businesses"))` (`:594` in the schema)
while almost every other tenant table requires it. The optionality means a sale can exist with
no business, which no code path creates — but it also means a tenant filter that forgets to
check for `undefined` behaves differently from one that does not.

---

## 3. Functions

### 3.1 The shape of a handler

```ts
export const refundSale = mutation({
    args: { saleId: v.id("sales"), items: v.array(...), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.refund");
        ...
    },
});
```

The convention is consistent across the codebase: resolve the tenant, check the permission, then
work. Arguments are typed with Convex validators, so a malformed request is rejected by the
platform before the handler runs.

### 3.2 Actions — the constraint that shapes the integrations

There are only **6 actions** in the whole backend, and they are all in the integration layer
plus one webhook handler. The reason is structural: **in this Convex version an action has no
`ctx.db`**. An action cannot read or write the database; it must call a query or a mutation
through `ctx.runQuery` / `ctx.runMutation`.

This single fact is the root cause of findings C-02 and C-03. The author of those functions
needed a mutation an action could call, made it `public`, and thereby opened a path to the
browser. **The correct pattern is `internalMutation`**, which an action can call through
`ctx.runMutation(internal.…)` and which no client can reach. The codebase already uses
`internal` correctly elsewhere — `internal.integrations.internal.prepareAdapterCall` is the
model.

### 3.3 The HTTP router

`convex/http.ts` mounts exactly two routes:

| Route | Method | Purpose |
|---|---|---|
| `/auth/jwks` | GET | The public keys Convex verifies the access tokens against |
| `/payments/callback` | POST | The payment provider's callback |

Both are appropriate to be unauthenticated: the first publishes public keys, the second
authenticates itself with an HMAC signature and a reference lookup
(`convex/integrations/webhooks.ts:189-259`).

The webhook handler is the best-written unauthenticated endpoint in the codebase:

* it finds the payment by reference (`:213-227`);
* it fetches the business's configured secret for that adapter (`:232-240`);
* it verifies the signature with a constant-time comparison (`:243`, and `safeEqual` at `:171`);
* it **refuses when no secret is configured** only with a recorded warning (`:152-158`) — this
  is the one soft spot, covered in report 13;
* it writes a `failed` callback record when it refuses (`:246-253`).

---

## 4. Cryptography

`convex/crypto.ts` provides:

| Function | Purpose |
|---|---|
| `sha256Hex` | Hashing a session secret |
| `hmacSha256Hex` | Webhook signatures |
| `safeEqual` | Constant-time comparison |
| `encryptSecret` / `decryptSecret` | AES-GCM with a PBKDF2-derived key, for provider credentials at rest |
| `SealedSecret` | The stored shape |

**Assessment: good.** The primitives are the right ones, the comparisons are constant-time, and
the credentials of third-party providers are encrypted at rest rather than stored in the clear.

**M-37 (Low).** `encryptSecret`/`decryptSecret` derive their key with PBKDF2. The iteration
count is not recorded in the stored value, so it cannot be raised later without a migration.

---

## 5. `serverSecret.ts`

`convex/serverSecret.ts` gates the operations a browser must never reach: opening a session,
ending one, reading a password-reset code, emailing a verification code.

```ts
if (!secret || secret.length < 16) return undefined;
```

and the comparison is length-checked and then byte-by-byte (`:42-45`).

**When no secret is configured, the operations stay closed** rather than opening to an empty
string. That is the correct default.

**M-10 (Medium), restated.** The secret is looked up through a fallback chain
(`SMARTBUZ_SERVER_SECRET` → `RESEND_API_KEY` → `SESSION_SECRET`). Using the email provider's
key as the session-opening secret is a poor default. In production, `SMARTBUZ_SERVER_SECRET`
should be mandatory.

---

## 6. Generated code

`convex/_generated/` holds `api.js`, `api.d.ts`, `server.js`, `server.d.ts` and `dataModel.d.ts`.
`convex codegen` runs cleanly (exit 0, 66 seconds) and regenerates `api.d.ts` — which is what
makes the typed API available to the client.

**M-38 (Medium).** CI does not run `convex codegen`. A change to the schema that is not
followed by a codegen leaves `api.d.ts` stale, and the client will type-check against a set of
functions that no longer exist — or, worse, a new function will exist on the server but not in
the typed API, so the client cannot call it and nobody notices until runtime.

The generated files **are** committed (`convex/_generated/api.d.ts` is tracked), which is the
right choice for a TypeScript monorepo-style setup, but it means codegen must be part of CI or
part of the commit discipline.

---

## 7. Schema ergonomics

**M-39 (Low).** `convex/schema.ts` is 2,551 lines in a single file. Splitting it into
`schema/tables/*.ts` and re-exporting would make a schema review possible, and would make the
Phase 9-style additions (which added 12 tables to one file) less disruptive.

**M-40 (Low).** There are no `v.optional(v.id(...))` **reference** fields in the schema — Convex
has no foreign-key constraint, so referential integrity is maintained entirely by application
code. This is normal for Convex, but it means the discipline of checking ownership after every
`ctx.db.get` is essential. It is applied consistently (see report 09, §4) — with the exception
of the finding in C-01.

---

## 8. Summary

| Area | Assessment |
|---|---|
| Schema conventions | **Good** — consistent, documented, well indexed |
| Tenant modelling | **Good** — 84 of 92 tables carry `businessId`; the 8 globals are justified |
| Index design | **Good** — compound tenant indexes on the hot paths |
| Handler conventions | **Good** — tenant → permission → work |
| Argument validation | **Good** — Convex validators throughout |
| Action constraints | **Understood, but mishandled in the integrations (C-02, C-03)** |
| HTTP surface | **Good** — two routes, both correctly unauthenticated |
| Cryptography | **Good** — right primitives, constant-time comparisons, encrypted secrets |
| `by_date` on `sales` | **A trap that caused C-01 (M-35)** |
| `convex codegen` in CI | **Missing (M-38)** |
| Schema file size | **2,551 lines in one file (M-39)** |
