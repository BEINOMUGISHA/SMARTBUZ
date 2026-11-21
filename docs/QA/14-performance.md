# 14 — Performance and Scalability

**Commit audited:** `acafd2b`
**Method:** static analysis of the database access patterns, plus the recorded build timings.

---

## 1. Summary

The platform's *shape* is good: the data model is indexed properly, the hot paths use compound
tenant indexes, and the sale path is careful about N+1 reads (`convex/salesCore.ts:529`,
`:671` batch the stock fetches).

The platform's *scale* is not yet proven. Three patterns account for most of the risk:

| Pattern | Count | Where |
|---|---:|---|
| **Whole-table read, then filter by hand** | 28 | `convex/verticals/*` (25), `convex/audit.ts`, `convex/license.ts`, `convex/packages/pharmacy.ts` |
| **Report endpoint collects its whole dataset** | 25+ | `convex/reports.ts` |
| **One write per row in a loop** | several | `convex/stocks.ts:756-774`, `convex/stocks.ts:626-645` |

None of these is a correctness defect. All of them become one when the data grows.

---

## 2. The whole-table read pattern

### 2.1 What it looks like

```ts
// convex/verticals/members.ts:30-31
let rows = await ctx.db.query("members").collect();
rows = rows.filter((r) => r.businessId === businessId);
```

The filter is applied, so **isolation is intact**. The problem is that the read is not scoped:
every request loads every row of the table, across every tenant, and throws most of them away.

### 2.2 Where it is

| File | Occurrences |
|---|---:|
| `convex/verticals/operations.ts` | 12 |
| `convex/verticals/members.ts` | 7 |
| `convex/verticals/scheduling.ts` | 6 |
| `convex/audit.ts` | 1 |
| `convex/license.ts` | 1 |
| `convex/packages/pharmacy.ts` | 1 |
| **Total** | **28** |

The three vertical modules account for 25 of the 28.

### 2.3 Why it is there

The vertical modules were written after the core tenant indexes were in place, and they were
written quickly. Every one of the affected tables — `members`, `memberTransactions`,
`walletTransactions`, `staffCommissions`, `donations`, `deliveries`, `assets`, `fuelDispenses`,
`vehicles`, `routeFares`, `tillSessions`, `serviceTickets`, `rentals`, `attendance`,
`classEnrolments`, `productionBatches`, `recurringCharges`, `appointments`, `serviceOutlets`,
`tableOrders`, `menuItems` — **does** have a `by_businessId` index in the schema. The queries
simply do not use it.

### 2.4 What it costs

At 50 members per business and 50 businesses, `listMembers` reads 2,500 rows to return 50. At
500 members and 500 businesses it reads 250,000 rows to return 500 — on **every request**, and
the function is called by the members list, the member search and the member-number generator
(a write path, `convex/verticals/members.ts:67`).

Convex's per-function read limits will start failing before the CPU does.

**Recommendation:** replace each `.collect()` + filter with
`.withIndex("by_businessId", (q) => q.eq("businessId", businessId))`. The indexes already
exist. This is a mechanical change — about 25 edits — with no behaviour change.

---

## 3. The reporting pattern

`convex/reports.ts` collects every sale, every expense, every stock row, every loan, every
payment and every customer that matches the filter, and aggregates them in JavaScript.

```ts
// convex/reports.ts:151-153
salesQuery = ctx.db.query("sales").withIndex("by_businessId_date", ...);
```

The reads are tenant-scoped and correctly indexed — which is good — but they are unbounded.
A business with three years of trading has three years of sales in one report request.

**M-28 (Medium).** Every report loads its entire result set into the function. The reports
have `…Summary` variants (`:197`, `:382`, `:609`, `:904`, `:1021`, `:1197`, `:1357`, `:1506`,
`:1689`), which suggests the intention was to aggregate in the database — but the summaries
call the same functions and aggregate the same way.

**Recommendation:** use `.paginate()` for the row-level reports and compute the summaries with
a database-side aggregation, or at minimum cap the date range and report "showing the first N
of M".

---

## 4. N+1 reads

The sale path avoids N+1 — this was clearly done on purpose:

```ts
// convex/salesCore.ts:529
const pricingDocs = await Promise.all(stockIdsForPricing.map((id) => ctx.db.get(id)));
```

and again at `:671` for the stock deduction. Good.

**But** `applySale` writes one `stockLedger` row per line in a loop
(`convex/salesCore.ts:729-741`), and `stocks.update` and `stocks.restock` write one row per
branch in a loop (`convex/stocks.ts:630-645`, `:756-774`). A sale of 30 lines writes 30 rows;
a price change writes one row per branch. Convex batches writes within a transaction, but these
are not inside an explicit transaction.

**M-51 (Medium).** Wrap the stock-ledger inserts and the branch propagation in
`ctx.db.transaction` so Convex can batch them into a single write.

---

## 5. The client

| Measure | Value |
|---|---|
| Pages | 57 |
| Client components | 121 of 151 `.tsx` files (80%) |
| Components holding a Convex query or mutation | 7 |

**Assessment: good.** The data lives in Convex and is fetched live; there is no client-side
store to fall out of step, and no large client-side data set to load. The Next.js build
produced 54 static pages in 6 seconds and compiled in 84 seconds.

**M-52 (Low).** Every dashboard page is a separate route and a separate bundle. A cashier
moving between the till, the inventory and the customers page downloads three bundles. Not a
problem on a good connection; a problem on a 2G link in a rural shop.

---

## 6. Build timings

| Step | Time |
|---|---:|
| `tsc --noEmit` | 339 s |
| `convex codegen` | 66 s |
| `next build` — compile | 84 s |
| `next build` — static generation (54 pages) | 6 s |
| `next build` — total | 264 s |
| `npm test` | 7 s |

**M-53 (Low).** `tsc --noEmit` takes 5½ minutes, and CI runs it serially before the tests and
the build (`.github/workflows/ci.yml:33-40`). The CI job has a 20-minute timeout
(`:18`). It passes — but the margin is thin, and a slow machine could push it over. Splitting
the type-check and the build into parallel jobs would halve the wall-clock time.

---

## 7. The database

**M-54 (Medium).** The schema holds **92 tables and 306 indexes** in a single 2,551-line file
(`convex/schema.ts`). Convex charges for storage and reads are billed by the bytes scanned.
With 306 indexes on 92 tables, the write amplification is significant: every sale insert
updates the `by_businessId`, `by_businessId_date`, `by_businessId_shop_date`,
`by_businessId_branch_date`, `by_date`, `by_shop_date`, `by_customer_date`, `by_invoiceNumber`,
`by_clientOfflineId`, `by_businessId_occurredAt` and `by_deviceId` indexes — eleven index
writes for one row.

Most of those are justified by a query that uses them. The audit could not find a query for
`by_invoiceNumber` in any module — it is defined and unused. **M-55 (Low):** remove the unused
indexes, or at least review the list.

**M-56 (Low).** `by_date` and `by_shop_date` on `sales` (`:667-668`) are the only non-tenant
indexes on a table where every row has a `businessId` — and `by_date` is the index that C-01
uses by mistake. See report 10, M-35.

---

## 8. Priority order for the performance work

| Priority | Change | Effort | Effect |
|---|---|---|---|
| 1 | Replace the 28 whole-table reads with `by_businessId` index reads | ~25 edits, mechanical | Removes the worst scaling cliff |
| 2 | Bound the report queries (pagination or a date cap) | Medium | Stops a three-year-old business from timing out a report |
| 3 | Wrap the stock-ledger and branch-propagation loops in a transaction | Small | Fewer round trips per sale |
| 4 | Aggregate the report summaries in the database | Medium | Makes the summaries cheap |
| 5 | Review the 306 indexes for unused ones | Small | Less write amplification |
| 6 | Split the CI type-check and build into parallel jobs | Small | Faster feedback |

**None of these change behaviour.** They are all the same shape of work: use the index that is
already there.

---

## 9. Summary

| Area | Assessment |
|---|---|
| Schema indexing | **Good** — the right indexes exist |
| N+1 avoidance on the hot path | **Good** — batched deliberately |
| Tenant scoping of reads | **Good** — correct everywhere it matters |
| Whole-table reads | **28 instances, concentrated in the vertical modules** |
| Report unbounded collections | **~25 endpoints** |
| Write batching | **Loops that could be transactions** |
| Index count | **306 — some unused** |
| Build and test timings | **Acceptable; CI is close to its timeout** |
