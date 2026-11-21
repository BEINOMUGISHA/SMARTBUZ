# SMARTBUZ v2.0 — 05 · Database Audit (Convex schema and backend data layer)

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Schema:** `convex/schema.ts` — 2,551 lines
**Scope:** PART 10 — schema consistency, field validation, index efficiency, referential integrity, duplicate prevention, transaction consistency, mutation safety, error handling and query cost.

---

## 1. Method

| Aspect | Detail |
|---|---|
| Inspection | `convex/schema.ts` in full (92 tables, 277 index declarations), every module under `convex/`, `convex/integrations/`, `convex/verticals/`, `convex/packages/` |
| Analysis | Programmatic parsing of the schema (table list, index declarations per table), a cross-reference of every table name against every `.query("table")` / `.insert("table")` call in the backend, a scan of all 333 `.collect()` call sites for scope and bound, and a manual review of the highest-risk modules (`migration.ts`, `sync.ts`, `salesCore.ts`, `users.ts`, `tenancy.ts`) |
| Ran | `npm test` (341 assertions, local only) |
| Not ran | Any write to the live deployment; no migration was executed; `npm audit` could not reach the registry |

---

## 2. Schema at a glance

| Metric | Value |
|---|---|
| Tables | **92** |
| Index declarations | **277** (96 distinct index names across tables) |
| Tables carrying a `businessId` | 92 |
| Tables never referenced by any backend code | **0** (only `userTypes` is unindexed; it *is* referenced) |
| Public Convex functions (query/mutation/action) | ~330 across 76 modules |
| `.collect()` call sites in `convex/` | **333**, of which **0** are bounded by `.take()` |
| Collect chains that carry an index or filter | 293 of 308 (the 15 unscoped ones are in `migration.ts`, `plans.ts`, `platform.ts`, `userTypes.ts`) |

**Table domains.** Tenant-owned operational data (`sales`, `saleItems`/embedded items, `stocks`, `stockLedger`,
`stockCostHistory`, `customers`, `suppliers`, `purchaseOrders`, `purchaseInvoices`, `purchasePayments`,
`payments`, `cashShifts`, `expenses`, `loans`, `members`, `shopIssuedStock`-style arrays, `warehouses`),
identity and access (`users`, `memberships`, `sessions`, `emailVerifications`, `passwordResets`, `platformAdmins`),
platform and commerce (`plans`, `subscriptions`, `subscriptionPayments`, `licenses`, `entitlements`,
`industryPackages`, `counters`), audit and activity (`auditLogs`, `activityLogs`, `syncLogs`, `stockConflicts`),
and integrations (`integrationConfigs`, `integrationEvents`, `paymentIntents`, `messages`, `hardwareDevices`,
`statementImports`, `statementLines`).

---

## 3. Summary table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Table naming and field conventions | PASSED | `convex/schema.ts` | Consistent camelCase; `businessId`/`shopId`/`branchId` used uniformly for scope |
| Index coverage for tenant scope | PASSED | `convex/schema.ts:375-378` and equivalents | Composite indexes (`by_businessId_timestamp`) are used where a plain `by_businessId` would be insufficient |
| Unused tables | PASSED | cross-reference of 92 tables | Every table is read or written by the backend |
| Unused/dead fields | PASSED | field-by-field grep | No table field was found that is neither written nor read |
| Input validation on public functions | PASSED | `convex/**` | `v.*` validators present on public args throughout |
| Referential integrity | MEDIUM | `convex/schema.ts` | Convex has no foreign keys; several relationships are enforced only by convention (DB-05) |
| Duplicate prevention | PASSED | `convex/salesCore.ts:166-179` | Invoice sequences use an atomic per-business counter |
| Transaction consistency | MEDIUM | `convex/salesCore.ts`, `convex/sync.ts` | Convex has no multi-document transactions; several multi-write paths can half-apply (DB-04) |
| Mutation safety (read-then-write) | PASSED | `convex/salesCore.ts:166-179`, `convex/sync.ts:273-302` | Counters and dedupe checks are read and written inside one mutation, so Convex's optimistic concurrency serialises them |
| Bounded reads | **FAILED** | 333 `.collect()` sites, 0 `.take()` | DB-02, DB-03 |
| Deployment-wide scan surface | **FAILED** | `convex/migration.ts:163,207-208,227-228,318-319,491-492` | DB-01 (cross-tenant, see `07_TENANT_ISOLATION_REPORT.md`) |
| Error handling | MEDIUM | `convex/**` | Raw `Error` (not `ConvexError`) in several places, leaking internal paths (SEC-09) |
| Denormalisation | MEDIUM | `convex/schema.ts:773-781` | `shops.issuedStocks` duplicates price and quantity that live in `stocks` (DB-06) |

---

## 4. Findings

### DB-01 — The migration module scans and writes the entire deployment from a tenant-reachable endpoint
- **ID:** DB-01 · **Module:** `convex/migration.ts` · **Severity:** **HIGH**
- **Description:** `convex/migration.ts` performs deployment-wide reads with no bound and no tenant scope: `ctx.db.query("users").collect()` (`:319`), `ctx.db.query("businessProfiles").collect()` (`:318,491`), `ctx.db.query("businesses").collect()` (`:163,208,228,492`). Each call loads the entire collection into memory. Combined with the authorisation defect recorded in `07_TENANT_ISOLATION_REPORT.md` (a business owner qualifies as a "migration operator", `convex/migration.ts:105-145`, and an arbitrary `businessId` is accepted without a membership check, `:170-176`), a single call from a tenant administrator can enumerate and rewrite the ownership of every business in the deployment.
- **Steps to reproduce:** Static inspection: `convex/migration.ts:163,170-176,318-319,491-492`.
- **Expected behavior:** A migration tool is a deployment-time administrative operation, guarded by the server secret or a platform role, and bounded in what it reads.
- **Actual behavior:** It is a public mutation guarded by a tenant-level role, and it reads the whole deployment.
- **Root cause:** A single-tenant migration tool was deployed into a multi-tenant product without being moved behind a server-side secret.
- **Recommended fix:** Move `convex/migration.ts` out of the deployed function set (a `convex/dev/` directory excluded by `convex.json`), or gate every entry point behind `serverSecretMatches` in addition to the operator check. Require an explicit `businessId` and verify the caller owns it; never fall back to "the first business that has an owner" (`:189-190`).
- **Test to verify the fix:** A test asserting that a business owner cannot call any migration function, and that a platform operator's call is bounded to one business.

### DB-02 — No query in the backend bounds the rows it reads
- **ID:** DB-02 · **Module:** Backend data layer · **Severity:** **MEDIUM**
- **Description:** There are **333 `.collect()` call sites across `convex/` and not one of them is limited by `.take()`**. A paginated query is the clearest case: `convex/audit.ts:169-200` loads *every* audit row for the business via the `by_businessId_timestamp` index and then slices the requested page in memory (`rows.slice(start, start + numItems)`). The same pattern appears in `convex/customers.ts`, `convex/suppliers.ts`, `convex/loans.ts` and `convex/users.ts`, where the cursor is used as a page number (`Number(args.paginationOpts.cursor) || 0`) over an already-materialised array. The result is correct but unbounded: the cost of a page of 20 rows grows with the tenant's entire history.
- **Steps to reproduce:** Static inspection of `convex/audit.ts:180-200` and the equivalent blocks in `convex/customers.ts`, `convex/suppliers.ts`, `convex/loans.ts`.
- **Expected behavior:** A paginated query reads one page (plus a count), not the whole table.
- **Actual behavior:** The whole table is read and then discarded except for one slice.
- **Root cause:** The pagination was implemented as an in-memory slice over a full read rather than as index-range reads.
- **Recommended fix:** Replace the in-memory slice with an index-range read using the cursor as an offset into the index (`withIndex(..., q => q.gte("timestamp", lastSeen))`). Where a count is needed, keep a separate count query. Apply the same change to the other page-number queries.
- **Test to verify the fix:** A test that seeds 100,000 audit rows for one business and asserts that fetching page 1 reads (and takes) a bounded number of documents.

### DB-03 — Report queries aggregate the tenant's entire history on every request
- **ID:** DB-03 · **Module:** Reporting · **Severity:** **MEDIUM**
- **Description:** `convex/reports.ts` contains **58 `.collect()` calls** and `convex/finance.ts` 19, `convex/verticals/operations.ts` 17, `convex/stocks.ts` 15, `convex/suppliers.ts` 13. A daily sales report for a business with five years of history loads five years of sales into memory, on every request, to compute one number. The queries are correctly tenant-scoped, so there is no cross-tenant leak — this is a cost and latency problem, and it is the single most likely cause of slow reports as data accumulates.
- **Steps to reproduce:** Static inspection of `convex/reports.ts` (58 `.collect()` sites) and `convex/finance.ts` (19).
- **Expected behavior:** A period report reads the rows in the period (using the date index), and the period is pushed into the database rather than filtered in memory.
- **Actual behavior:** The period filter is frequently applied after a full read.
- **Root cause:** Reports were written for correctness first; date-range index reads were never introduced.
- **Recommended fix:** For each report, add a composite index (for example `by_businessId_date`) and push the date range into the index query. Where a report genuinely needs the whole history (year-end totals), pre-aggregate into a summary table.
- **Test to verify the fix:** A performance test that seeds 200,000 sales and asserts a one-day report completes within an agreed time budget.

### DB-04 — Several multi-document writes can leave partial state
- **ID:** DB-04 · **Module:** Backend data layer · **Severity:** **MEDIUM**
- **Description:** Convex guarantees a single document write is atomic, but not a sequence of them. `applySale` inserts the sale, then patches stock, then writes the stock-ledger entry, then writes finance and audit rows (`convex/salesCore.ts` — the sale insert at `:695`, the stock movement at `:728-741`, and the surrounding writes). If the process fails between two of these writes, the sale exists without its stock movement, or the stock moved without its ledger row, and Convex offers no transaction to roll it back. The same applies to `migrateMemberships` (`convex/migration.ts:368-397`: membership insert, then `activeBusinessId` patch, then the ownership patch) and to `pushTransactions` (`convex/sync.ts:322-341` plus the conflict and log writes).
- **Steps to reproduce:** Static inspection of the write sequences named above.
- **Expected behavior:** Either the whole operation applies or none of it does, or a compensating action runs automatically.
- **Actual behavior:** Partial application is possible; the operation is not idempotent at the level of its sub-writes.
- **Root cause:** A platform constraint (no multi-document transactions) was not designed around.
- **Recommended fix:** (1) Make every step idempotent and keyed (each sub-write carries the sale id, so a retry converges). (2) Order the writes so the "anchor" record — the sale — is written first and the rest can be reconciled from it. (3) Add a periodic reconciliation job that compares sales against `stockLedger` and repairs or reports divergence (this also covers DB-03's cost problem, since the job can maintain aggregates).
- **Test to verify the fix:** A test that injects a failure after the second write and asserts the reconciliation job detects and repairs the divergence.

### DB-05 — Referential integrity is enforced by convention, not by the database
- **ID:** DB-05 · **Module:** Backend data layer · **Severity:** **MEDIUM**
- **Description:** Convex has no foreign keys. Several relationships are therefore only as strong as the code that maintains them: `sales.items[].stockId` → `stocks`, `sales.customerId` → `customers`, `stockLedger.stockId` → `stocks`, `purchaseOrders.supplierId` → `suppliers`, `memberships.userId`/`businessId` → `users`/`businesses`. Some of these are protected in code — for example `applySale` rejects a line whose `stock.businessId` differs from the tenant (`convex/salesCore.ts:487,564-567`) — but the guarantee is per-path, not per-schema. A product that is deleted while sales reference it leaves a sale whose line points at a missing product; the code decides what happens (the sale line keeps `name`, `price`, `pv` and `bv` inline, so history survives — which is the right design, and worth stating).
- **Steps to reproduce:** Static inspection of the referenced modules.
- **Expected behavior:** Deleting a referenced record is either prevented or explicitly handled.
- **Actual behavior:** It depends on the calling path.
- **Root cause:** No foreign keys are available, and no soft-delete convention is enforced across modules.
- **Recommended fix:** Adopt a single convention — archive rather than delete any record that appears in a sale, a ledger entry or a purchase order — and enforce it in one shared helper that every delete path calls. Where a delete must remain possible, record the deletion in `auditLogs` with the ids that referenced it.
- **Test to verify the fix:** A test that attempts to delete a product with sales history and asserts the record is archived, and that the audit entry names the referencing sale ids.

### DB-06 — `shops.issuedStocks` duplicates data that already exists in `stocks`
- **ID:** DB-06 · **Module:** Inventory data model · **Severity:** **MEDIUM**
- **Description:** A shop counter holds an embedded array of issued stock snapshots (`convex/schema.ts:773-781`): `stockId`, `name`, `qty`, `price`, `productCode`, `pv`, `bv`. Three problems follow. (1) **Drift:** the snapshot's `price` is copied at issue time (`convex/shops.ts:565,577,649,662`) and is not updated when the master price changes, so the till's price and the server's price diverge — see `03_FRONTEND_TEST_REPORT.md` FE-005, where the divergence makes the server refuse the sale. (2) **Duplication:** `name`, `price`, `pv` and `bv` are copied from `stocks`, so the same facts live in two places with no reconciliation. (3) **Unbounded document growth:** the array lives inside a single `shops` document, so a counter with thousands of products makes that document large, and every read of the shop document reads the whole array.
- **Steps to reproduce:** Static inspection of `convex/schema.ts:773-781`, `convex/shops.ts:565-577,649-662` and `convex/stocks.ts` (`getShopStock` returns `shop.issuedStocks`).
- **Expected behavior:** One source of truth per fact, with the counter's holdings recorded as quantities keyed by product.
- **Actual behavior:** Price, cost and name are copied.
- **Root cause:** The snapshot was designed to make the till's view self-contained, which is convenient offline but duplicates authoritative data.
- **Recommended fix:** Store only `{ stockId, qty, issuedPrice, issuedAt }` in the shop and resolve `name`/`price`/`pv`/`bv` from `stocks` at read time (the offline catalogue cache already does this on the client, `src/lib/offline/catalog.ts`). If the issued price must persist for accounting, keep it but treat it as the *cost* basis and price the sale from the master price.
- **Test to verify the fix:** A test that issues stock, changes the master price, and asserts that the shop's issued record holds no copy of the price while the till still displays the current price.

### DB-07 — The `userTypes` table has no index
- **ID:** DB-07 · **Module:** Schema · **Severity:** **LOW**
- **Description:** `convex/schema.ts:380-383` — `userTypes` is the only table with no index declaration. Every read of it (`convex/userTypes.ts:20`) is therefore a full scan. The table is small and static, so the practical impact is negligible, but it is the one place where the schema's own indexing convention is not followed.
- **Steps to reproduce:** Static inspection of `convex/schema.ts:380-383`.
- **Expected behavior:** Every table is indexed on the fields it is queried by.
- **Actual behavior:** One table is not.
- **Root cause:** The table was added late.
- **Recommended fix:** Add `.index("by_key", ["key"])` (or the equivalent field) and query through the index, or fold the values into a constant if the table is never written.
- **Test to verify the fix:** A test asserting the table is read through an index, or a schema lint rule that every table declares at least one index.

### DB-08 — Schema and function definitions are not validated against each other
- **ID:** DB-08 · **Module:** Tooling · **Severity:** **LOW**
- **Description:** Convex validates argument types at runtime against the generated `dataModel`, and `npm run typecheck` passes, so a schema change that breaks a caller is caught at compile time. But nothing validates that the **indexes a query needs exist**: `convex codegen` is not run in CI (`.github/workflows/ci.yml` has no Convex step), and a query that references an index removed from the schema fails only at runtime, in production. The `getStockSummary` pagination defect (`03_FRONTEND_TEST_REPORT.md` FE-004) is of exactly this family — a contract mismatch between a query and its consumer that no static check caught.
- **Steps to reproduce:** Static inspection of `.github/workflows/ci.yml` and `convex/reports.ts:598-605`.
- **Expected behavior:** Schema, generated API and query contracts are verified in CI.
- **Actual behavior:** The generated API is not regenerated or diffed in CI, and index usage is not checked.
- **Root cause:** The Convex toolchain was never wired into the pipeline.
- **Recommended fix:** Add a CI step that runs `npx convex codegen` and fails if the generated files differ from the committed ones, and a lint rule that flags a `withIndex` call naming an index the table does not declare.
- **Test to verify the fix:** A CI job that fails when an index is removed from the schema while a query still references it.

---

## 5. What was NOT IMPLEMENTED, and what was NOT TESTED

| Item | Status |
|---|---|
| Multi-document transactions / rollback | **NOT IMPLEMENTED** — a Convex platform constraint (DB-04) |
| Foreign-key enforcement | **NOT IMPLEMENTED** — a Convex platform constraint (DB-05) |
| Unique constraints (e.g. on `sales.invoiceNumber`) | **NOT IMPLEMENTED** — Convex has no unique index; uniqueness is achieved in code with the `counters` table (`convex/salesCore.ts:166-179`), which is atomic because the read and the write happen inside one mutation |
| Schema migration versioning | **NOT IMPLEMENTED** — `convex/migration.ts` migrates *data*, not schema; schema changes are pushed by `npx convex dev` with no version history |
| Aggregated report tables / rollups | **NOT IMPLEMENTED** (DB-03) |

| Test | Why not |
|---|---|
| Schema evolution against a populated database | Would require writing to the live deployment |
| Index effectiveness at scale | No seeded dataset of realistic size exists; measurements would require creating one in production |
| Query latency in production | No monitoring exists to measure it (see `06_SECURITY_AUDIT.md` SEC-08) |

---

## 6. Findings summary

**DB-01** HIGH · **DB-02** MEDIUM · **DB-03** MEDIUM · **DB-04** MEDIUM · **DB-05** MEDIUM · **DB-06** MEDIUM ·
**DB-07** LOW · **DB-08** LOW

**Counts: 0 CRITICAL, 1 HIGH, 5 MEDIUM, 2 LOW, 0 INFORMATIONAL**

---

## 7. Verdict

The data layer is **better than average for a Convex application**. The 92 tables are consistently shaped, every
one of them is actually used, tenant scoping is applied through indexes rather than by filtering after the
fact (293 of 308 read chains carry an index or filter), and the places where correctness depends on a
read-then-write — the invoice counter, the offline duplicate check — are correctly written so that Convex's
optimistic concurrency makes them atomic. The schema also anticipates the multi-tenant requirement properly:
`businessId` is present on every tenant-owned table, and composite indexes such as
`by_businessId_timestamp` exist where a simple one would not do.

Three weaknesses recur. **Unbounded reads** (DB-02, DB-03): the schema is indexed for the filters that exist,
but no query limits how many rows it materialises, so every report and every page of a list scales with the
tenant's whole history. **Convex's lack of transactions and foreign keys** is real and is handled unevenly —
sometimes carefully (sale lines keep their own copy of name and price so history survives a product deletion),
sometimes not (a multi-write sequence can half-apply). And **the deployment-time migration tool sits in the
production function set** (DB-01), which is the same defect as the cross-tenant finding in
`07_TENANT_ISOLATION_REPORT.md` seen from the data layer's side.
