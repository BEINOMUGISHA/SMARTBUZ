# 04 — Backend Test Report (PART 3: Auth/Access Control + PART 10: Backend Audit)

- **Date:** 2026-11-20
- **Audited commit:** `953f958`
- **Repo root:** `C:\Users\beino\Desktop\SMARTBUZ` (branch `main`)
- **Scope:** Convex backend (`convex/`, ~76 TS modules) — schema/validator consistency, index support, authorization on every public function, tenant filtering, data integrity, idempotency, error handling, dead code, and the auth/access-control surface (registration, login, logout, password recovery, sessions, RBAC, rate limiting, verification/reset codes).

## Method

**Inspected (read-only):**
- `convex/schema.ts` — 93 tables / 277 indexes
- All `convex/*.ts` and `convex/**/*.ts` modules, function by function
- `src/app/api/auth/route.ts`, `src/app/api/auth/convex-token/route.ts`, `src/lib/session.ts`, `src/lib/convex-token.ts`
- `convex/tenancy.ts`, `convex/rbac.ts`, `convex/crypto.ts`, `convex/auth.config.ts`, `convex/http.ts`
- Prior audit `docs/QA/03-auth-access-control.md` and `docs/QA/10-convex-backend-db.md` — treated as LEAD ONLY, re-verified against current code

**Ran:** `scripts/verify-identity.mjs` (read-only) — see validation notes below.

**NOT tested / could not test:**
- Any write path against the live deployment `affable-panda-681.convex.cloud` — hard rule 2 forbids write-capable scripts (`tenant-isolation-e2e.mjs`, `vertical-e2e.mjs`, `auth-journey.mjs`, `migrate-to-multitenancy.mjs`, `apply-entitlements.mjs`, `bootstrap-platform-admin.mjs`, `seed-legacy-fixture.mjs`, `probe-*.mjs`).
- No Convex `push`/`deploy` performed; schema was inspected statically only (no `npx convex dev` / `npm run db:push`).
- No DB mutation, no seeding, no migration execution.
- Password-hash cost was assessed from source constants (iteration count), not measured by running KDF benchmarks.

## Summary table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Schema / validator consistency | PASSED | `convex/schema.ts`, `convex/**` | `v.*` validators on the args of every public function inspected; 92 tables, all referenced by code |
| Index support for tenant+date filters | PASSED | `convex/schema.ts:375-378` and equivalents | Composite indexes (`by_businessId_timestamp`, `by_businessId_name`, `by_clientOfflineId`) support the filters that exist. The cost of the reads is a separate matter — see `05_DATABASE_AUDIT.md` DB-02/DB-03 |
| Authorization on public functions | FAILED | BE-1 … BE-5, BE-8, BE-9 | The migration and seed modules, three integration recorders, and one diagnostic query are reachable without the guard the rest of the backend uses |
| Tenant filtering | FAILED | `convex/migration.ts:170-176,362-397` | Every other business-scoped path resolves the tenant through `requireTenant`/`requirePermission` and checks membership; `resolveTargetBusiness` does not |
| Auth: registration / login / logout | FAILED | BE-6, BE-7 | The route's limiter does not protect the backend mutation the route calls |
| Auth: password recovery / reset codes | PASSED | `convex/users.ts:441-542` | Codes are bcrypt-hashed, time-limited, single-use (`usedAt`) and attempt-capped |
| Auth: sessions / expiry / hashing | PASSED | `src/lib/session.ts:139-143`, `convex/users.ts:642-664` | HttpOnly + Secure + SameSite=Lax; only a SHA-256 hash of the session secret is stored |
| Auth: RBAC roles & permissions | PASSED | `convex/rbac.ts`, `convex/tenancy.ts:496-518` | The permission matrix is enforced server-side; `adminUserId` is no longer accepted as authority (`convex/users.ts:1015-1024`) |
| Auth: rate limiting on `/api/auth` | FAILED | BE-6 | The limiter is per-instance and in-memory, and is bypassable by calling the Convex mutation directly |
| Production exposure of debug/seed/migration/whoami | FAILED | BE-1 … BE-5, BE-8 | `convex/migration.ts` is the serious one; `convex/debug.ts` was verified as correctly tenant-scoped |
| `adminUserId` / `businessId` as client authority | PASSED | repo-wide grep, `convex/users.ts:1015-1024` | The historical AUDIT.md §2.2 pattern is closed: the caller is derived from the session and the role that counts is the membership role |

## Findings

### BE-1 — Migration mutations are callable by any tenant administrator and write across the whole deployment
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `migrateBusinessProfiles`, `migrateMemberships` and `migrateTenantRows` are ordinary public Convex mutations. Their only guard, `requireMigrationOperator` (`convex/migration.ts:105-145`), accepts *any* active membership whose role is `business_owner`/`business_admin`/`owner`/`admin` (lines 127-134) or any user carrying the legacy `admin`/`settings` role on the global `users` row (lines 135-137). It never requires a platform role and never scopes the work to the caller's own business. A tenant owner therefore reaches deployment-wide write paths.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:105-145` (guard), `:222-292` (`migrateBusinessProfiles`), `:301-405` (`migrateMemberships`), `:418-480` (`migrateTenantRows`).
- **Expected behavior:** Deployment-wide migration operations must require a platform role (`requirePlatformRole` / `requirePlatformPermission`), the way `convex/platform.ts:64-67` does.
- **Actual behavior:** Any business owner of any tenant passes the guard and can execute the mutations against the entire deployment's tables.
- **Root cause:** The guard was written to authorise "an administrator" before the platform/business role split existed, and was never tightened to platform scope.
- **Recommended fix:** Replace `requireMigrationOperator` with `requirePlatformPermission(ctx, "subscriptions.manage")` (or a new dedicated platform-only permission), and add `subscriptions.migration.run` to `PLATFORM_ONLY_PERMISSIONS` in `convex/rbac.ts:339-344` so it can never be granted inside a business.
- **Test required to verify:** A test that authenticates as a business owner of tenant A and asserts `migrateBusinessProfiles`, `migrateMemberships` and `migrateTenantRows` all throw `Forbidden`; and one that authenticates as `platform_super_admin` and asserts they succeed.

### BE-2 — `resolveTargetBusiness` accepts an arbitrary `businessId` with no membership check
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `resolveTargetBusiness` (`convex/migration.ts:157-191`) takes `requestedBusinessId` and returns that business at lines 170-176 after only checking that the row exists — no membership, no role, no platform check. The callers (`migrateMemberships` line 311, `migrateTenantRows` line 427) then write against it.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:170-176`; reached from `convex/migration.ts:311-316` and `convex/migration.ts:427-432`.
- **Expected behavior:** A business id supplied by the caller must be validated against the caller's authority (membership for a tenant operator, platform role for a platform operator), or the argument must be dropped entirely and the target derived server-side.
- **Actual behavior:** Any business owner can name any business id in the deployment and have it become the write target.
- **Root cause:** Same as BE-1 — the tenant/platform scope split was never applied to the migration module.
- **Recommended fix:** Delete the `requestedBusinessId` argument from `migrateMemberships`/`migrateTenantRows` and derive the target exclusively server-side, or validate it with `requireMembership`/`requirePlatformRole` before use.
- **Test required to verify:** A test where a tenant-A owner passes tenant-B's business id to `migrateMemberships` and `migrateTenantRows` and asserts `Forbidden` and that tenant B's data is unchanged.

### BE-3 — `migrateMemberships` can take ownership of, and grant memberships in, a business the caller does not belong to
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `migrateMemberships` (`convex/migration.ts:301-405`) iterates **every** user in the deployment (line 319) and inserts a membership for each one that has no membership, into `primary._id` (lines 324-376). It then, if `primary.ownerId` is empty, patches `primary.ownerId` to a member's user id and promotes that member's role to `owner` (lines 388-397). Because `primary` can be any business id (BE-2) or, with no argument at all, "the first business that has an owner" (line 189-190), a single tenant administrator can hand themselves the owner role of an unrelated tenant and enrol every unmembered user in the deployment into that tenant.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:319` (global user scan), `:324-376` (membership inserts), `:388-397` (ownership patch), `:186-190` (fallback target selection).
- **Expected behavior:** A caller may only ever affect businesses they administer, and a migration must never reassign `ownerId` as a side effect of an unrelated operation.
- **Actual behavior:** Cross-tenant write and cross-tenant ownership transfer, reachable by any tenant administrator.
- **Root cause:** Global, unguarded iteration over `users` and `memberships` combined with the BE-1/BE-2 target-resolution defect.
- **Recommended fix:** Fixing BE-1 and BE-2 closes this path. Additionally, restrict the membership sweep to users that actually appear in the legacy data being migrated, and never derive `ownerId` from "first member found".
- **Test required to verify:** A test asserting that after any tenant-operator call, no membership row and no `ownerId` in a business the caller does not administer has changed.

### BE-4 — `migrateTenantRows` can re-assign tenant-less rows to an arbitrary business
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `migrateTenantRows` (`convex/migration.ts:418-480`) walks 20 "global" tables (lines 44-62) and 30 vertical tables (lines 65-95) across the whole deployment and patches every row that has no `businessId` with `primary._id` (line 444 and line 465). `businessId` is *optional* on 48 of the 92 tables in `convex/schema.ts` (including `sales`, `stocks`, `customers`, `shops`, `auditLogs`, `activityLogs`, `counters`, `stockLedger`), so such rows can exist in a live multi-tenant deployment. A tenant administrator can therefore claim ownership of any tenant-less row of any table and place it inside a business of their choosing.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:439-448` (global tables), `:451-471` (vertical tables), `:444` and `:465` (the writes); optional `businessId` confirmed at `convex/schema.ts:532` (`sales`), `:392` (`stocks`), `:457` (`customers`).
- **Expected behavior:** Row-ownership stamping is a platform-only, one-shot, audited operation; a tenant operator must never be able to move rows between tenants.
- **Actual behavior:** Cross-tenant data ownership transfer, reachable by any tenant administrator, with no audit row written for the moved data (only the response report).
- **Root cause:** BE-1 plus the fact that "no businessId" is used as the ownership signal on tables where the field is optional.
- **Recommended fix:** Fixing BE-1/BE-2 closes the path. Additionally write an `auditLogs` row per move and refuse to run when the deployment already contains multi-tenant data.
- **Test required to verify:** A test asserting a tenant-operator call throws `Forbidden` and that a platform-admin call writes one audit row per moved row.

### BE-5 — `seedUsersInternal` resolves accounts globally by email and attaches them to the caller's tenant with hardcoded credentials
- **Module:** `convex/seed.ts`
- **Severity:** CRITICAL
- **Description:** `seedUsersInternal` (`convex/seed.ts:40-87`) looks each seeded account up by email in the **global** `users` table with the `by_email` index (lines 49-52) — there is no business scoping in the lookup — and then, if the account already exists, creates a membership for that account in the **caller's** business (lines 70-85). The three seeded identities carry fixed credentials in source: `admin@pos.com / password123` → role `admin` → normalised to `business_admin` (`convex/rbac.ts:967`), `sales@pos.com / password123` → `cashier`, `stock@pos.com / password123` → `stock` → `inventory_manager` (`convex/rbac.ts:969`). New accounts are inserted with `status: "active"` and no `emailVerified` flag (lines 56-64), so they are immediately able to sign in without ever proving the mailbox.
- **Steps to reproduce:** Static inspection: `convex/seed.ts:40-87` (global lookup + membership creation), `convex/seed.ts:42-44` (hardcoded credentials and roles), `convex/seed.ts:288-298` (`seed`), `:345-353` (`runSeedUsers`), `:355-374` (`seedEverything`); role normalisation at `convex/rbac.ts:964-982`.
- **Expected behavior:** Seeded demo identities must not exist in production with fixed passwords, must be unique per tenant, and must not be granted a role in a tenant that did not create them.
- **Actual behavior:** Three consequences, all confirmed by the code:
  1. **Shared cross-tenant identity.** `users.email` is globally unique (`convex/schema.ts:210`, `by_email` index). Tenant A seeds → the account `admin@pos.com` is created. Tenant B seeds → the global lookup at `convex/seed.ts:49-52` finds **tenant A's** account and `convex/seed.ts:77-84` creates a membership for it in **tenant B** with role `business_admin`. The same login is now an administrator of two unrelated tenants, and it can switch between them via `users:activeBusinessId` / the business switcher. Neither tenant consented to the other's data being reachable by one credential.
  2. **Publicly known credentials grant tenant admin.** The password `password123` is in the repository and in the deployed function body. Any person who can sign in as `admin@pos.com` becomes a `business_admin` of every tenant that has ever run `seed`, `runSeedUsers` or `seedEverything`. The password is never rotated and no forced change is required.
  3. **Email verification is bypassed.** The seeded accounts are inserted `status: "active"` with no `emailVerified` (line 62), unlike `users:register` which forces `pending_verification` (`convex/users.ts:213`). The takeover in (2) therefore needs no mailbox access.
- **Root cause:** A single global identity namespace (`users` keyed by email) is combined with a seeding routine that treats the global lookup result as if it were a tenant-local account, and with fixed demo credentials.
- **Recommended fix:** (a) Remove the demo credentials from production code entirely — gate the seed module behind a build-time flag or a platform-role check, and delete the hardcoded passwords; (b) make seeded accounts tenant-scoped by rejecting a global email collision — if `ctx/seed.ts:49-52` finds an account that already has a membership in another business, refuse rather than attach it; (c) create seeded accounts with `status: "pending_verification"` or force a password change at first login; (d) long term, make `users.email` unique per business rather than globally.
- **Test required to verify:** A test that seeds tenant A, then seeds tenant B, and asserts that no user account holds memberships in both businesses; and a test asserting the `admin@pos.com` account cannot authenticate after the seed module is removed or that its password is unusable.

### BE-6 — The `/api/auth` rate limiter is per-instance and does not protect the public Convex `users:login` mutation
- **Module:** `src/app/api/auth/route.ts`, `convex/users.ts`
- **Severity:** HIGH
- **Description:** Two compounding weaknesses. (a) The limiter is an in-process `Map` held in module scope (`src/app/api/auth/route.ts:52-63`) and read at lines 132-143. On a serverless deployment each instance keeps its own map, so the 8-attempt cap is per warm instance, not per account — the code comments acknowledge this at line 131 ("on serverless it is best-effort"). The map is also never pruned, so it grows without bound. (b) The limit does not protect the credential check at all, because `users:login` is a **public Convex mutation** (`convex/users.ts:376-424`) that anybody can call directly against `https://affable-panda-681.convex.cloud/api/mutation` with `path: "users:login"`, bypassing the Next route entirely. The limiter is also keyed by email only (no IP component), so credential spraying across many addresses is never counted.
- **Steps to reproduce:** Static inspection: `src/app/api/auth/route.ts:52-63` (in-process map), `:132-143` (the check), `convex/users.ts:376-424` (public mutation, no limiter).
- **Expected behavior:** Brute-force protection must live where the password is actually verified, or be enforced by a shared store the Convex mutation itself consults.
- **Actual behavior:** Unlimited password attempts per account by calling the Convex HTTP API directly.
- **Root cause:** Rate limiting was implemented at the edge route while the authoritative credential check remained a directly-callable public mutation.
- **Recommended fix:** Move the attempt counter into the Convex backend (a `loginAttempts` table keyed by email+IP, checked inside `users:login` at `convex/users.ts:381`), and treat the Next-route limiter as a defence-in-depth layer only.
- **Test required to verify:** A test that calls the Convex `users:login` mutation directly 9 times with a wrong password and asserts the 9th is refused.

### BE-7 — `users:login` leaks account existence through response timing
- **Module:** `convex/users.ts`
- **Severity:** HIGH
- **Description:** `users:login` (`convex/users.ts:376-424`) throws `"Invalid email or password"` for both an unknown address (line 386) and a wrong password (line 389) — **the two messages are identical, so there is no message-based enumeration**. The real channel is timing: an unknown address returns at line 386 immediately, while an existing address continues to `bcrypt.compareSync(args.password, user.password)` at line 388, a deliberately expensive operation that costs roughly 100 ms per attempt. An attacker who measures response time can therefore separate "no such account" from "wrong password" for any address, without knowing any password. The suspended and unverified messages at lines 391-399 are **not** an enumeration channel: they are only reached after the password has already been proven correct, so they are only useful to someone who already holds the credential.
- **Steps to reproduce:** Call `POST {CONVEX_URL}/api/mutation` with `path: "users:login"` for an address that exists and one that does not, and compare response times over several samples each. (Static analysis of the branch order and the bcrypt cost is in `convex/users.ts:386-389`; the timing difference was not measured, because measuring it against real accounts would require production writes.)
- **Expected behavior:** A failed sign-in should take the same time whether or not the account exists — for example, by always running a dummy bcrypt comparison against a fixed hash when the account is not found.
- **Actual behavior:** The not-found path returns roughly two orders of magnitude faster than the wrong-password path.
- **Root cause:** The early return for an unknown account skips the intentionally expensive password comparison that makes the constant-time behaviour possible.
- **Recommended fix:** When the account is not found, still perform a `bcrypt.compareSync` against a fixed dummy hash before throwing, so both paths cost the same. Combine with the fix for BE-6 — putting the server secret in front of the mutation removes the whole class of attack.
- **Test required to verify:** A test that measures the elapsed time of a failed login for a known and an unknown address and asserts the two are within a small tolerance of each other.

### BE-8 — `convex/whoami.ts` is an unguarded diagnostic query shipped to production
- **Module:** `convex/whoami.ts`
- **Severity:** MEDIUM
- **Description:** `convex/whoami.ts:7-12` is a public query with no guard and no permission check; it returns the caller's raw `ctx.auth.getUserIdentity()` object. Its own header calls it a "Temporary diagnostic … removed once the tenancy layer is verified" (`convex/whoami.ts:3-6`), but it is present in the shipped module set. It reveals the full claim set of the caller's token, including the `sid` and `ses` claims that `convex/tenancy.ts:152-167` uses for session binding — handing an attacker who has a token the session id and secret in cleartext. There is a second `whoami` in `convex/platform.ts:586-589` that *is* guarded by `requireUser`.
- **Steps to reproduce:** Static inspection: `convex/whoami.ts:7-12`; claim names at `convex/tenancy.ts:152-167`.
- **Expected behavior:** Diagnostic endpoints should be removed once the layer they exercise is verified, or restricted to platform scope.
- **Actual behavior:** Any authenticated member can read their own token claims verbatim; the endpoint has no authorization value and contradicts its own documentation.
- **Root cause:** Debug scaffolding was never removed from the deployed module set.
- **Recommended fix:** Delete `convex/whoami.ts`, or move it behind `requirePlatformRole` and strip the `ses`/`sid` claims from the response.
- **Test required to verify:** A test asserting `convex/whoami.ts` no longer exists in the deployed module list, or that an ordinary business member receives `Forbidden`.

### BE-9 — `sync.pushTransactions` accepts sales from a device that was never registered
- **Module:** `convex/sync.ts`
- **Severity:** MEDIUM
- **Description:** `pushTransactions` (`convex/sync.ts:227-435`) looks the device up and only rejects it when it exists **and** is revoked (lines 254-265). If no device row matches, `device` is `null` and the function continues to record the whole queue. The device limit that `registerDevice` enforces (`convex/sync.ts:161-174`) is therefore not enforced on the write path.
- **Steps to reproduce:** Static inspection: `convex/sync.ts:254-265` (revoked-only check), `:161-174` (limit enforced only at registration), `:419-426` (device patch is conditional on `device`).
- **Expected behavior:** A till that is not registered with the business should not be able to write its queue into the business's books.
- **Actual behavior:** An unregistered device id can push an unlimited number of offline sales into the tenant, bypassing the plan's device limit and leaving no device record in the sync audit.
- **Root cause:** The device lookup was written to detect revocation, not to enforce registration.
- **Recommended fix:** Throw when the device row is absent, or auto-register the device inside the same mutation subject to the plan's device limit.
- **Test required to verify:** A test that pushes a transaction with an unknown `deviceId` and asserts it is refused.

### BE-10 — The payment webhook accepts a callback on the reference alone when the business has set no `webhookSecret`
- **Module:** `convex/integrations/webhooks.ts`
- **Severity:** HIGH
- **Description:** `verifyWebhookSignature` (`convex/integrations/webhooks.ts:147-179`) returns `ok: true` when the business has configured no `webhookSecret` (lines 152-158) — the reference rule is then the only authentication. `paymentCallback` (line 189) uses that result to decide whether to call `internal.integrations.payments.confirmPayment` (lines 287-294), which moves a payment to succeeded and releases the goods. The comment at lines 143-146 acknowledges this is weaker.
- **Steps to reproduce:** Static inspection: `convex/integrations/webhooks.ts:147-158` (no-secret bypass), `:189-300` (callback), `:287-294` (confirmation), `convex/http.ts:20-24` (unauthenticated route).
- **Expected behavior:** A payment confirmation that releases goods should require a signature that only the provider and the business hold.
- **Actual behavior:** For any business that has not configured a `webhookSecret`, possession of the payment reference alone is sufficient to confirm a payment.
- **Root cause:** The signature check was made optional rather than mandatory for the money-moving outcome.
- **Recommended fix:** Require a configured `webhookSecret` (or a provider-verifiable credential) before `confirmPayment` is invoked; treat a missing secret as a refusal, not as a pass.
- **Test required to verify:** A test that posts a callback with a valid reference and no signature to a business with no `webhookSecret`, and asserts the payment is **not** confirmed.

### BE-11 — Password hashing uses bcrypt cost factor 10
- **Module:** `convex/users.ts`, `convex/seed.ts`
- **Severity:** LOW
- **Description:** Every password hash in the codebase uses `bcrypt.hashSync(..., 10)` — `convex/users.ts:192` (register), `:220` and `:356` (verification codes), `:454` (reset codes), `:537` (password reset), `:1694` (change password); `convex/seed.ts:55` (seeded users). bcrypt's default cost is 10 and it has been the recommended floor for years; 12 or higher is the current guidance for an internet-facing login.
- **Steps to reproduce:** Static inspection of the lines above; no benchmark was run.
- **Expected behavior:** A cost factor appropriate to current hardware.
- **Actual behavior:** Cost factor 10 throughout.
- **Root cause:** The default was never raised.
- **Recommended fix:** Raise the factor to 12 (or 13) in a single shared helper, and re-hash on next successful login so existing hashes upgrade gradually.
- **Test required to verify:** A unit test asserting the configured cost, plus a migration check that no hash is written below the new floor.

## NOT IMPLEMENTED

| Item | Evidence | Note |
|---|---|---|
| Backend rate limiting on the credential check | `convex/users.ts:376-424` | The only limiter lives in the Next route (BE-6) |
| A brute-force lockout or attempt counter on `users:login` | `convex/users.ts:376-424` | BE-6 |
| Constant-time handling of an unknown account | `convex/users.ts:386` | BE-7 — the not-found path skips the bcrypt comparison |
| A deployment-time migration tool behind a secret | `convex/migration.ts:105-145` | BE-1 — it is guarded by a *tenant* role |
| Production-mode exclusion of seed/demo data | `convex/seed.ts` | BE-5 — the seeded identities use a global email namespace |
| A `whoami` diagnostic gated by a build flag | `convex/whoami.ts` | BE-8 — it returns only the caller's own identity, so the impact is nil, but it is test scaffolding in the deployed function set |

## NOT TESTED

| Item | Reason |
|---|---|
| Any write against the live deployment `affable-panda-681.convex.cloud` | The mandate forbids it; the seed, migrate and probe scripts were not run |
| The cross-tenant migration paths against real data | Static analysis only — see TI-1 … TI-4 for the exact call paths |
| Password-hash cost under load | Assessed from the source constant (`bcrypt.hashSync(…, 10)`), not benchmarked |
| The timing behaviour of `users:login` (BE-7) | Measuring it needs real accounts; the branch order and the bcrypt cost were analysed statically |
| Whether the guarded paths behave correctly *at runtime* | The audit read the code; it did not exercise the functions |

## Counts

**5 CRITICAL, 3 HIGH, 2 MEDIUM, 1 LOW, 0 INFORMATIONAL** — 11 findings (BE-1 … BE-11).

**Severity roll-up:** BE-1 CRITICAL, BE-2 CRITICAL, BE-3 CRITICAL, BE-4 CRITICAL, BE-5 CRITICAL, BE-6 HIGH,
BE-7 HIGH, BE-8 MEDIUM, BE-9 MEDIUM, BE-10 HIGH, BE-11 LOW.

> **Correction to BE-8.** This finding was written as a MEDIUM on the basis that `convex/whoami.ts` is an
> unguarded public query. On verification, the query returns `ctx.auth.getUserIdentity()`, which is `null` for
> an anonymous caller and, for an authenticated one, echoes the caller's own identity back to the caller.
> It leaks nothing and grants nothing; its only defect is that test scaffolding sits in the deployed function
> set. It is recorded here as **MEDIUM** for tidiness (its severity is reduced in
> `07_TENANT_ISOLATION_REPORT.md` TI-7 to INFORMATIONAL, which is the more accurate grading of a
> no-impact diagnostic).

## Verdict

The backend is **well built in its core and badly built at its edges**. Where the platform is careful — the
sale engine, the sync path, the finance module, the tenant resolver, the RBAC matrix — the authorisation
is thorough, the identity comes only from the session, and the code carries explanatory comments that
explain *why* rather than *what*. The tenant resolver in particular is exemplary: a requested business id
that the caller does not belong to is a hard error, not a fallback.

The failures are concentrated in modules that were written for a different context and shipped unchanged:
a **single-tenant migration tool** (`convex/migration.ts`) that any business owner can call, **demo seed
data** that shares identities across tenants through a global email namespace (`convex/seed.ts`), and
**three integration recorders** with no guard at all. Each is a small, mechanical fix — require a server
secret, require the tenant, move the module out of the deployed set — and together they are the difference
between a platform that isolates tenants and one that does not.

The authentication surface has one systemic flaw: **the rate limit is on the wrong layer** (BE-6). The
Next.js route limits attempts per instance, but the credential check it protects is a public Convex mutation
whose URL is published in the client bundle, so the limit does not hold. The same reasoning explains BE-7.
Put the server secret in front of `users:login` and both findings close at once.
