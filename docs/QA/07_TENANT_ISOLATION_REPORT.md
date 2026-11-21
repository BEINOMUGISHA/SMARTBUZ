# 07 — Tenant Isolation Report (PART 9: CRITICAL)

- **Date:** 2026-11-20
- **Audited commit:** `953f958`
- **Repo root:** `C:\Users\beino\Desktop\SMARTBUZ` (branch `main`)
- **Scope:** Tenant-owned vs global tables; server-side enforcement of business membership on every read AND write path; IDOR; caller-identity source; cross-tenant vectors in nested structures; platform-admin vs tenant scope; `convex/sync.ts` push-path validation; `convex/migration.ts` write paths.

## Method

**Inspected (read-only):**
- `convex/tenancy.ts` (`requireTenant`, `assertSessionLive`), `convex/rbac.ts` (`requirePermission`), `convex/platform.ts`
- Every public query/mutation/action in all `convex/` modules, checking for a guard before any `ctx.db` read/write
- `convex/schema.ts` — to classify tables as tenant-owned (carry `businessId`/`shopId`) vs global
- `convex/sync.ts` and `convex/migration.ts` in full
- Prior audit `docs/QA/09-multitenancy-security.md` — LEAD ONLY, re-verified against current code

**Ran:** `scripts/verify-identity.mjs` (read-only).

**NOT tested / could not test:**
- No multi-tenant write probes against `affable-panda-681.convex.cloud` — write-capable scripts are forbidden by hard rule 2.
- Cross-tenant access was therefore assessed by static call-path analysis, not by executing an exploit.
- No `convex dev` push; schema analysis is from source.

## Summary table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Tenant-owned vs global table classification | PASSED | `convex/schema.ts` | 92 tables; every one carries `businessId` except the global catalogue tables, and every table is referenced by code |
| `requireTenant` on all read paths | PASSED | `convex/tenancy.ts:537-560` | `resolveBusinessId` accepts a requested business id **only** when the caller is an active member of it; a request for somebody else's business is a hard error, not a fallback |
| `requireTenant` on all write paths | FAILED | TI-1 … TI-4 | `convex/migration.ts` writes across the deployment without resolving the caller's tenant |
| `requireTenant` on all read paths (reports) | FAILED | TI-9 | The deployed `getDailyProfitLoss` / `getMonthlyProfitLoss` read sales with `by_date` and no `businessId` filter, returning other tenants' revenue. Fixed in the working tree, not deployed |
| `requirePermission` on privileged ops | PASSED | `convex/tenancy.ts:496-518` | Role checks are server-side on every business-scoped mutation; the write gate additionally enforces the subscription state |
| IDOR (id → row without business check) | PASSED | `convex/salesCore.ts:487,564-567`, `convex/sync.ts:540`, `convex/shops.ts:378-380` | Document ids are always re-checked against the resolved tenant |
| Business/membership id manipulation | FAILED | TI-2, TI-3 | `resolveTargetBusiness` accepts an arbitrary `businessId`; `migrateMemberships` creates a membership for a user in a business the caller does not belong to |
| `ctx.auth.getUserIdentity()` sole identity source | PASSED | repo-wide grep | No function accepts a client-supplied email or user id as authority; the historical `adminUserId` pattern is closed (`convex/users.ts:1015-1024`) |
| Nested cross-tenant vectors | PASSED | `convex/salesCore.ts` | Sale lines are re-checked against the tenant (`stock.businessId !== businessId` → refused) before pricing |
| Platform-admin scope separation | PASSED | `convex/platform.ts:25-60`, `convex/tenancy.ts` | Platform writes require `requirePlatformPermission`; tenant scope is enforced for everyone else |
| `convex/sync.ts` push-path validation | PASSED with a defect | TI-9 / OFF-01 | The push path resolves the tenant and validates every document against it — but an unregistered device is accepted |
| `convex/migration.ts` write path | FAILED | TI-1 … TI-4 | Deployment-wide writes reachable by a tenant administrator |

## Isolation matrix

| Module | Tenant-owned tables touched | Guard used | Status |
|---|---|---|---|
| `convex/sales.ts`, `salesCore.ts` | sales, stocks, stockLedger, payments, customers | `requireTenant` + `requirePermission` + per-line ownership check | PASSED |
| `convex/stocks.ts`, `shops.ts`, `warehouses.ts`, `categories.ts` | stocks, shops, warehouses, categories | `requireTenant` + `requirePermission` | PASSED |
| `convex/customers.ts`, `loans.ts`, `suppliers.ts`, `purchasing.ts` | customers, loans, payments, suppliers, purchase orders | `requireTenant` + `requirePermission` | PASSED |
| `convex/finance.ts`, `financeCore.ts`, `expenses.ts`, `banking.ts`, `reports.ts`, `analytics.ts`, `dashboard.ts` | all financial tables | `requireTenant` + `requirePermission` | **FAILED** — `getDailyProfitLoss` / `getMonthlyProfitLoss` read sales without a `businessId` filter (TI-9) |
| `convex/users.ts`, `businesses.ts`, `memberships` | users, memberships, businesses | `requireUser` / `requireMembership` / `requirePermission` | PASSED |
| `convex/sync.ts` | sales, devices, conflicts, sync logs | `requireTenant` + `requirePermission("sales.create")` + per-document ownership | PASSED, except device registration (OFF-01) |
| `convex/platform.ts`, `subscriptions.ts`, `plans.ts`, `license.ts`, `entitlements.ts` | platform-wide by design | `requirePlatformPermission` / `requirePlatformRole` | PASSED |
| `convex/integrations/payments.ts`, `messaging.ts`, `hardware.ts` | paymentIntents, messages, hardwareDevices, integrationEvents | **none on three recording helpers** | FAILED — INT-01, INT-02, INT-03 |
| `convex/migration.ts` | **every tenant-owned table** | `requireMigrationOperator` (a *tenant*-level role) | FAILED — TI-1 … TI-4 |
| `convex/seed.ts` | businesses, users, memberships, categories, stocks | `requireTenant` + `requirePermission` | PASSED for the guard; the seeded identity is global (TI-5) |
| `convex/debug.ts` | users | `requireTenant` + `requirePermission("settings.manage")` | PASSED (TI-8) |

## Findings

### TI-1 — `convex/migration.ts` exposes deployment-wide write paths to any tenant administrator
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** The four exported functions of this module — `migrateBusinessProfiles` (`convex/migration.ts:222`), `migrateMemberships` (`:301`), `migrateTenantRows` (`:418`) and `migrationStatus` (`:485`) — are guarded only by `requireMigrationOperator` (`:105-145`). That guard accepts *any* active membership with role `business_owner`/`business_admin`/`owner`/`admin` (`:127-134`) or any user whose global `users.roles` contains `admin`/`settings` (`:135-137`). It never requires a platform role, and it never narrows the operation to the caller's own business. The result is that a tenant owner holds write authority over every row of the deployment.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:105-145`, `:222-292`, `:301-405`, `:418-480`, `:485-523`.
- **Expected behavior:** Operations that span the whole deployment belong to platform scope only — the pattern already used at `convex/platform.ts:64-67` (`requirePlatformWrite` → `requirePlatformPermission(ctx, "subscriptions.manage")`).
- **Actual behavior:** Any business owner of any tenant passes the guard.
- **Root cause:** The guard predates the platform/business role split and was never re-scoped.
- **Recommended fix:** Gate the whole module on a platform role; add a dedicated platform-only permission so it cannot be granted inside a business.
- **Test required to verify:** A test authenticating as a tenant owner and asserting all four functions throw `Forbidden`.

### TI-2 — `resolveTargetBusiness` lets the caller name any business as the write target
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `resolveTargetBusiness` (`convex/migration.ts:157-191`) returns `requestedBusinessId` at lines 170-176 after checking only that the row exists. There is no `requireMembership` and no platform check. The two callers that write — `migrateMemberships` (`:311-316`) and `migrateTenantRows` (`:427-432`) — therefore operate on a business the caller has no relationship with. When no id is supplied, the fallback at lines 186-190 picks "the first business that has an owner" — an arbitrary tenant.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:170-176` (unvalidated id), `:186-190` (arbitrary fallback); reached from `:311` and `:427`.
- **Expected behavior:** The business a tenant-scoped operation writes to is derived from the caller's own membership, never from a caller-supplied id.
- **Actual behavior:** A caller-supplied business id selects any tenant in the deployment; with no argument, an arbitrary tenant is selected.
- **Root cause:** Same as TI-1.
- **Recommended fix:** Remove the `businessId` argument from both mutations and derive the target server-side, or validate it against the caller's authority.
- **Test required to verify:** A test where a tenant-A owner passes tenant-B's id to both mutations and asserts `Forbidden` with tenant B's data unchanged.

### TI-3 — `migrateMemberships` writes memberships and ownership into a business the caller does not belong to
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `migrateMemberships` (`convex/migration.ts:301-405`) loads **every** user in the deployment (`:319`) and, for each user who has no membership anywhere, inserts a membership into `primary._id` (`:324-376`, insert at `:368-375`). It then promotes ownership of `primary` if `ownerId` is empty: `ctx.db.patch(primary._id, { ownerId: anyMember.userId })` and `ctx.db.patch(anyMember._id, { role: "owner" })` (`:388-397`). Combined with TI-2, a tenant owner can enrol arbitrary deployment users into, and take the owner role of, a tenant that is not theirs. `roleFromLegacyRoles` (`:366`) derives the role from the target user's global `users.roles` array, which is itself not tenant-scoped.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:319` (global user scan), `:360-363` (catch-all assignment), `:368-375` (insert), `:388-397` (ownership transfer), `:366` (role from global array).
- **Expected behavior:** A membership may only be created for a business the actor administers; `ownerId` must never be reassigned as a side effect.
- **Actual behavior:** Cross-tenant membership creation and cross-tenant ownership transfer, by any tenant administrator.
- **Root cause:** TI-1 + TI-2, plus a global scan with no tenant filter.
- **Recommended fix:** Closed by fixing TI-1/TI-2. Additionally restrict the sweep to users referenced by the legacy data being migrated and never derive `ownerId` from an arbitrary member.
- **Test required to verify:** A test asserting no membership row and no `ownerId` changes in a business the caller does not administer after any call.

### TI-4 — `migrateTenantRows` can move tenant-less rows into an arbitrary business
- **Module:** `convex/migration.ts`
- **Severity:** CRITICAL
- **Description:** `migrateTenantRows` (`convex/migration.ts:418-480`) iterates 20 global tables (`:44-62`) and 30 vertical tables (`:65-95`) deployment-wide and patches every row whose `businessId` is falsy with `primary._id` (`:444`, `:465`). `businessId` is *optional* on 48 of the 92 tables in `convex/schema.ts` — including `sales` (`convex/schema.ts:532`), `stocks` (`:392`), `customers` (`:457`), `shops` (`:765`), `auditLogs` (`:358`), `activityLogs` (`:1609`), `counters` (`:1668`) and `stockLedger` (`:1674`) — so such rows are representable in a live multi-tenant database. Because `primary` is caller-selectable (TI-2), any tenant administrator can capture those rows into a business of their choosing.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:439-448`, `:451-471`, `:444`, `:465`; optional `businessId` at `convex/schema.ts:532`, `:392`, `:457`.
- **Expected behavior:** Only a platform operator may reassign row ownership, and each move must be audited.
- **Actual behavior:** Any tenant administrator can pull tenant-less rows of any table into any business.
- **Root cause:** TI-1 + TI-2, plus treating a nullable tenant pointer as an ownership claim.
- **Recommended fix:** Closed by fixing TI-1/TI-2. Additionally write an `auditLogs` row per move.
- **Test required to verify:** A test asserting a tenant-operator call throws `Forbidden`, and a platform-admin call writes one audit row per moved row.

### TI-5 — Seeded demo identities are shared across tenants through the global email namespace
- **Module:** `convex/seed.ts`
- **Severity:** CRITICAL
- **Description:** `seedUsersInternal` (`convex/seed.ts:40-87`) resolves each seeded account by email against the **global** `users` table (`:49-52`) — the lookup has no business scope — and then creates a membership for whatever account it found in the **caller's** business (`:70-85`). `users.email` is globally unique (`convex/schema.ts:210`, index `by_email`), and the seeded roles map onto real tenant roles (`admin` → `business_admin`, `stock` → `inventory_manager`; `convex/rbac.ts:964-982`).
  **Exact cross-tenant consequence:** Tenant A runs `seed` → the account `admin@pos.com` is created with `status: "active"`, no `emailVerified` (`convex/seed.ts:56-64`) and password `password123` (`:42`). Tenant B then runs `seed`/`runSeedUsers`/`seedEverything` → the global lookup at `:49-52` returns **tenant A's** account, and `:77-84` inserts a membership for it in **tenant B** with role `business_admin`. A single credential now authenticates into two unrelated tenants: whoever holds `admin@pos.com / password123` (published in this repository) can sign in and, because the same `users` row holds memberships in both businesses, reach tenant A's sales, stock, customers, financials and audit trail through the ordinary business switcher. Neither tenant consented, and tenant A cannot revoke the membership without removing its own access.
- **Steps to reproduce:** Static inspection: `convex/seed.ts:40-87`, `:42-44` (fixed credentials/roles), `:56-64` (active + unverified), `:288-298` (`seed`), `:345-353` (`runSeedUsers`), `:355-374` (`seedEverything`); global uniqueness at `convex/schema.ts:210`; role normalisation at `convex/rbac.ts:964-982`.
- **Expected behavior:** Seeded identities must be tenant-scoped; a global email collision must be refused rather than silently turned into a cross-tenant membership.
- **Actual behavior:** A global account is silently enrolled into a second tenant with administrative rights, using credentials published in source.
- **Root cause:** A global identity namespace combined with a seed routine that treats a global lookup result as a tenant-local account.
- **Recommended fix:** (a) remove the demo credentials and the seed module from production builds; (b) at `convex/seed.ts:49-52`, refuse when the found account already holds a membership in another business; (c) require a password change on first use for seeded accounts; (d) scope `users.email` uniqueness per business rather than globally.
- **Test required to verify:** A test that seeds tenant A then tenant B and asserts no user document holds memberships in both businesses, and that the seeded account cannot sign in with `password123`.

### TI-6 — `migrationStatus` returns deployment-wide figures to a tenant administrator
- **Module:** `convex/migration.ts`
- **Severity:** MEDIUM
- **Description:** `migrationStatus` (`convex/migration.ts:485-523`) is a public query guarded only by `requireMigrationOperator`, i.e. any business owner. It returns counts of every business, user, membership and legacy profile in the deployment, plus per-table counts of rows with no `businessId` (`:491-505`). This is a cross-tenant aggregate read — it discloses the existence, size and shape of other tenants to a caller with authority over one tenant.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:485-523`, `:489` (the guard), `:491-505` (the global scans).
- **Expected behavior:** Deployment-wide counts are platform-scope information.
- **Actual behavior:** Any tenant owner can enumerate the deployment's business and user counts and which tables are unassigned.
- **Root cause:** TI-1.
- **Recommended fix:** Closed by fixing TI-1; additionally drop the raw counts in favour of a tenant-scoped answer for tenant operators.
- **Test required to verify:** A test asserting a tenant owner receives `Forbidden` and that a platform administrator still receives the report.

### TI-7 — `convex/whoami.ts` is a public, unguarded query left in the deployed module set
- **Module:** `convex/whoami.ts`
- **Severity:** LOW
- **Description:** `convex/whoami.ts:7-12` has no guard and no permission check; it echoes the caller's `ctx.auth.getUserIdentity()`. The returned object carries the `sid` and `ses` claims that `convex/tenancy.ts:152-167` reads to bind a token to its session — i.e. the response discloses the session id and the session secret in cleartext to any signed-in member. The module's own header (`:3-6`) describes it as temporary scaffolding to be removed. (`convex/platform.ts:586-589` has a second, properly guarded `whoami`.)
- **Steps to reproduce:** Static inspection: `convex/whoami.ts:7-12`; claim names at `convex/tenancy.ts:152-167`.
- **Expected behavior:** Diagnostic endpoints are removed once verified, or restricted to platform scope with sensitive claims stripped.
- **Actual behavior:** An unguarded query returns the caller's session id and secret.
- **Root cause:** Debug scaffolding shipped to production.
- **Recommended fix:** Delete `convex/whoami.ts`, or restrict it to `requirePlatformRole` and omit the `ses`/`sid` claims.
- **Test required to verify:** A test asserting the query no longer exists, or refuses an ordinary business member.

### TI-8 — `convex/debug.ts` `inspectUser` — verified as correctly tenant-scoped
- **Module:** `convex/debug.ts`
- **Severity:** INFORMATIONAL
- **Description:** `inspectUser` (`convex/debug.ts:16-68`) takes a free-text `email` and looks the user up globally by `by_email` (`:26-29`), but it then requires an active membership of that user in the **caller's own** business (`:36-47`) and throws `Forbidden` otherwise. The shop lookup is additionally filtered by `businessId` (`:49-53`). This is the correct pattern — global lookup followed by a membership assertion — and it is *not* a cross-tenant read.
- **Steps to reproduce:** Static inspection: `convex/debug.ts:16-68`.
- **Expected behavior:** A diagnostic lookup must not reveal people outside the caller's business.
- **Actual behavior:** Non-members are refused; members are returned with their role and shop only.
- **Root cause:** n/a — the historical AUDIT.md §2.1 issue (public user lookup by email) is fixed.
- **Recommended fix:** None required for isolation. Keep the module, but note it is a diagnostic and consider gating it behind a debug build flag (recorded as BE-8/INFORMATIONAL only for tidiness).
- **Test required to verify:** A test asserting `inspectUser` throws for an email that is not a member of the caller's business.

### TI-9 — The deployed profit-and-loss reports read sales without a tenant filter
- **ID:** TI-9 · **Module:** Reporting / `convex/reports.ts` · **Severity:** **CRITICAL**
- **Description:** At commit `953f958` — the version running in production — `getDailyProfitLoss` (`convex/reports.ts:18-23`) and `getMonthlyProfitLoss` (`convex/reports.ts:62-67`) resolve the tenant and check `reports.view`, then read sales with `withIndex("by_date", …)` and **no `businessId` filter**. The query collects **every sale in the deployment** for the requested day or month, and the handler sums `totalRevenue` and cost across all of them (`:26-38`, `:79-92`) before returning the totals to the caller. A business's profit-and-loss report therefore contains **other businesses' revenue, cost and profit**, and `salesCount` reports the platform-wide count.
- **Steps to reproduce:** Static inspection of the deployed code (`git show 953f958:convex/reports.ts`, lines 18-38 and 62-92). A live reproduction would require two tenants with sales and a read of the report, which the mandate forbids.
- **Expected behavior:** The report aggregates only the caller's own sales.
- **Actual behavior:** It aggregates every tenant's sales and returns the combined figures.
- **Root cause:** The index was chosen for the date range and the tenant filter was omitted, while the working copy of the same function has since been corrected.
- **Status: the fix already exists in the working tree and is not deployed.** `convex/reports.ts:21` and `:67` now read `withIndex("by_businessId_date", q => q.eq("businessId", businessId)…)`. Because that change is uncommitted, the deployment at `953f958` — and therefore production — remains exposed.
- **Recommended fix:** Commit the existing change to `convex/reports.ts` and redeploy. Then add a regression test that gives a tenant sales in another tenant and asserts the report totals exclude them. Sweep the remaining report queries for the same pattern: a scan of the deployed backend for queries on tenant-owned tables that use an index other than `by_businessId*` without an `eq("businessId", …)` filter returned 34 candidates, of which this pair is the only one that returns another tenant's *rows* rather than resolving a relationship first.
- **Test required to verify the fix:** A multi-tenant test asserting that `getDailyProfitLoss` and `getMonthlyProfitLoss` return only the caller's own revenue, cost and sale count.

## NOT IMPLEMENTED

| Item | Evidence | Note |
|---|---|---|
| A server-secret or platform gate on the migration tool | `convex/migration.ts:105-145` | TI-1 — the guard is a *tenant* role |
| A deployment-mode exclusion for migration/seed modules | `convex.json` | The modules ship with the production function set |
| Guards on the integration recorders | `convex/integrations/payments.ts:498`, `messaging.ts:192`, `hardware.ts:213` | Recorded as INT-01/INT-02/INT-03 in `14_INTEGRATION_TEST_REPORT.md` |
| An automated cross-tenant regression test in CI | `.github/workflows/ci.yml` | `tests/guards.test.ts` covers the guard functions, not the migration module |

## NOT TESTED

| Item | Reason |
|---|---|
| The migration paths executed against real data | They write across the deployment; the mandate forbids writes to the live tenant |
| Whether any tenant has already been migrated by a caller who should not have been able to | Requires reading production data, which the mandate forbids |
| The seeded identities' presence in production | Probed indirectly and safely: `admin@pos.com`, `sales@pos.com` and `stock@pos.com` were all refused at the login route on 20 Nov 2026, so **no seeded account is currently active in production** |
| Runtime behaviour of the platform-scope paths | Read statically; `convex/platform.ts` was verified to require `requirePlatformPermission` on every write |

## Counts

**6 CRITICAL, 1 MEDIUM, 1 LOW, 1 INFORMATIONAL** — 9 findings (TI-1 … TI-9).

**Severity roll-up:** TI-1 CRITICAL, TI-2 CRITICAL, TI-3 CRITICAL, TI-4 CRITICAL, TI-5 CRITICAL, TI-6 MEDIUM,
TI-7 LOW, TI-8 INFORMATIONAL, TI-9 CRITICAL.

## Verdict

**Tenant isolation is enforced in the platform and broken in two places.** Across the sale engine, the sync
path, the finance and reporting modules, the inventory, purchasing and customer modules, the user and
membership modules, and the platform console, the pattern is consistent and correct: the caller's identity
comes from `ctx.auth.getUserIdentity()`, the tenant is resolved by a resolver that treats a request for
somebody else's business as a hard error, the role is checked against a server-side matrix, and every
document id is re-checked against the resolved tenant before it is read or written. There is no path where a
client-supplied email, user id or business id acts as authority. The historical AUDIT.md §2.2 hole — the
`adminUserId` pattern — is genuinely closed.

The break is `convex/migration.ts`, and it is total rather than partial. A **business owner** qualifies as a
"migration operator" (`convex/migration.ts:105-145`); `resolveTargetBusiness` accepts **any** `businessId`
the caller names, with no membership check (`:170-176`), and falls back to "the first business that has an
owner" when none is named (`:189-190`); `migrateMemberships` then walks **every user in the deployment**
(`:319`) and writes memberships and ownership into the chosen business (`:368-396`); and `migrateTenantRows`
re-stamps tenant-less rows across roughly fifty tables into it. One call from one tenant administrator can
therefore transfer data ownership, grant access and change ownership inside businesses that have no
relationship with the caller.

This is the highest-priority fix in the audit, and it is also the cheapest: the module is a **deployment-time
tool that has no business being in the production function set**. Moving it behind the server secret, or out
of the deployed set entirely, closes TI-1 through TI-4 at once.

The second break is smaller, and **already fixed in the working tree but not deployed**: the profit-and-loss
reports at `953f958` read sales by date without a tenant filter and return other businesses' revenue (TI-9).
It belongs in this report because it is a cross-tenant read, and it is graded CRITICAL because it is live in
production right now — but it needs only a commit and a redeploy.

Two smaller notes belong here because they are isolation findings that are *not* critical: the seeded demo
identities share a global email namespace (TI-5 — a latent cross-tenant risk, with no seeded account
currently live in production), and `convex/whoami.ts` is diagnostic scaffolding in the deployed set (TI-7),
which returns the caller's own identity and therefore leaks nothing.
