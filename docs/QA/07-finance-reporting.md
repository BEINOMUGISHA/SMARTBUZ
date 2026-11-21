# 07 — Finance, Reporting and Exports

**Commit audited:** `acafd2b`
**Scope:** `convex/reports.ts` (27 endpoints), `convex/finance.ts` (13 endpoints),
`convex/expenses.ts`, `convex/analytics.ts`, `convex/verticals/tax.ts`, `src/lib/vat.ts`,
`src/lib/export.ts`, `src/lib/export-utils.ts`, `src/lib/restock-pdf.ts`.

---

## 1. The finding that matters most in this report

### C-01 — CRITICAL: two financial reports aggregate across every tenant

`convex/reports.ts:8-52` (`getDailyProfitLoss`) and `convex/reports.ts:54-99`
(`getMonthlyProfitLoss`) resolve the tenant correctly and check the permission correctly:

```ts
const tenant = await requireTenant(ctx, args.businessId);
const businessId = tenant.businessId;
await requirePermission(ctx, businessId, "reports.view");
```

…and then read **every sale of every business on that date**:

```ts
// convex/reports.ts:19-22
const daySales = await ctx.db
    .query("sales")
    .withIndex("by_date", (q) => q.gte("date", targetDate).lte("date", targetDate + "\uffff"))
    .collect();
```

`by_date` is a date-only index. It has no `businessId` component, so the query returns every
tenant's sales for that day. The function then sums them:

```ts
// convex/reports.ts:32-42
for (const sale of daySales) {
    totalRevenue += sale.total;
    for (const item of sale.items) { ... totalCost += stock.purchasePrice * item.quantity; }
}
const totalProfit = totalRevenue - totalCost;
```

The same pattern is at `convex/reports.ts:65-68` for the monthly report.

**What a tenant sees:** their "Daily profit & loss" and "Monthly profit & loss" figures
include every other business's revenue, cost, profit and sale count on the platform. The
numbers are not merely wrong — they are the sum of the platform.

**Why it was missed:** the file is otherwise careful. Twenty-five of the twenty-seven report
functions use a `by_businessId*` index, and the two that do not are the two that were written
first, at the top of the file.

**Evidence that this is an isolated slip and not a pattern:**
`convex/reports.ts` was scanned for every index used. Only lines 21 and 67 use a non-tenant
index; lines 112, 117, 145, 147, 151, 153, 211, 241, 313, 395, 432-438, 451-457, 462, 490, 500,
535, 537, 552, 556, 621, 632, 634, 669-670, 691-692, 696, 741, 789, 796, 857-858, 916-917,
967-968, 1033-1034, 1112-1113, 1210-1211, 1288-1289, 1369-1370, 1438-1439, 1518-1519, 1606-1607,
1702-1703 and 1715 all scope by `businessId`.

**Fix:** use the existing `by_businessId_date` index, exactly as `getSalesAndExpenses` does at
`convex/reports.ts:112`:

```ts
.withIndex("by_businessId_date", (q) =>
    q.eq("businessId", businessId).gte("date", targetDate).lte("date", targetDate + "\uffff"))
```

**Two lines. That is the whole fix.**

---

## 2. The finance module — good

`convex/finance.ts` implements the cash-shift discipline a till needs:

| Function | Line | What it does |
|---|---|---|
| `openShift` | 180 | Opens a till with a float; one open shift per cashier |
| `closeShift` | 271 | Counts the cash, computes the variance, records the difference |
| `getCurrentShift` | 348 | The open shift |
| `listShifts` / `getShiftDetail` | 378 / 433 | History |
| `recordCashMovement` | 511 | Money in and out of the drawer |
| `getCashDrawer` | 682 | The drawer's position |
| `recordIncome` | 834 | Other income |
| `reconcile` | 952 | Reconciles a period |
| `getFinancialSummary` | 1133 | The finance dashboard |

Every one of them resolves the tenant, checks a permission, checks branch access where it
applies, and writes an audit row. Examples:

* `openShift` — permission `finance.cash.shift.manage` (`:190`), the opening float cannot be
  negative (`:192-194`), the branch must belong to the business **and** be one the caller may
  work in (`:196-202`), the shop must belong to the business (`:204-209`), and a cashier may
  not open a second shift (`:211-221`).
* `closeShift` — the expected cash is computed from the shift's own sales and movements
  (`:303`), the variance is `countedCash − expectedCash` (`:304`), and the difference is
  recorded rather than quietly absorbed (`:268`). The comment at `:268` says it plainly: *"so a
  shortfall cannot quietly become the new baseline"*.
* `getCashDrawer` — the period variance is the **sum of the shifts' own variances**, not the
  difference between the counted cash and the period's expected cash (`:793-800`), with the
  reasoning written out. That is the correct way to do it.

**Assessment: good.** This is the module a finance manager would trust.

---

## 3. The reporting module — otherwise careful

Twenty-seven report endpoints, covering sales, expenses, stock, loans, customers, staff,
products, profit margin, payments and aged debtors.

The ones that were checked in detail are properly scoped:

* `getSalesAndExpenses` (`:101`) — `by_businessId_date` on both sales and expenses.
* `getDetailedSalesReport` (`:124`) — `by_businessId_shop_date` when a shop is named,
  `by_businessId_date` otherwise.
* `getStockSummary` (`:522`) — `by_businessId_productCode` and `by_businessId`.
* `getProfitMarginReport` (`:1425`) — `by_businessId_date`.
* `getAgedDebtors` (`:1734`) — `by_businessId`.

**M-28 (Medium).** Every report loads its rows with `.collect()` and then aggregates them in
JavaScript. A business with three years of sales will read three years of sales into memory on
every report request. This is the scalability problem in report 14, seen from the reporting
side.

---

## 4. VAT (URA)

`src/lib/vat.ts` implements the Ugandan regime — 18% standard, inclusive pricing by default,
exempt and zero-rated at 0%, everything rounded to whole shillings. It is used by the receipt
template and by the thermal receipt.

**M-15 (Medium) — the VAT split is not enforced on the server.** The sales page computes
`vatFigures` on the client and passes `netAmount` and `vatAmount` into the receipt
(`src/app/(dashboard)/sales/page.tsx`). The server stores `total` — which *is* protected — but
not the VAT breakdown. A tampered client can present a VAT figure that does not reconcile with
the sale total.

For a business that files VAT returns, the VAT figure on the receipt should be the one the
server computed.

**M-29 (Low).** `src/lib/verticals/tax.ts` (`resolveTax`) provides a vertical-specific tax
resolution, and `src/hooks/use-active-category.ts` reads `taxInclusive`. There are now three
places that know about tax inclusivity — `src/lib/vat.ts`, `src/hooks/use-active-category.ts`
and `convex/verticals/tax.ts` — and they are not obviously consistent. Worth a single
definition.

---

## 5. Analytics

`convex/analytics.ts` exposes twelve endpoints, and every one of them calls
`requireEntitlement(ctx, tenant.businessId, "business.intelligence")` before doing anything
(`:108`, `:222`, `:297`, `:354`, `:452`, `:537`, `:600`, `:685`, `:771`, `:859`, `:980`).

**Assessment: good.** The entitlement is checked first, and a request made by hand — not
through the interface — is refused in exactly the same way.

---

## 6. Exports

| Library | Used for | Risk |
|---|---|---|
| `exceljs` | Stock and sales workbooks | `uuid` advisory (moderate) |
| `jspdf` + `jspdf-autotable` | Restock orders and other PDFs | **Critical advisory — see report 15** |
| `file-saver` | Saving the generated file | — |

**M-30 (Medium).** The exports run entirely in the browser. For a business exporting a year of
sales, the whole dataset is loaded into the page. A server-side export would be better, but
this is a scale problem rather than a correctness problem.

---

## 7. Findings summary

| ID | Severity | Finding |
|---|---|---|
| **C-01** | **Critical** | `getDailyProfitLoss` and `getMonthlyProfitLoss` aggregate across every tenant (`convex/reports.ts:19-22`, `65-68`) |
| M-15 | Medium | The VAT breakdown is computed on the client, not the server |
| M-28 | Medium | Every report collects its whole dataset into memory |
| M-30 | Medium | Browser-side exports load the entire dataset |
| M-29 | Low | Tax inclusivity is defined in three places |
| — | Good | The finance module — shifts, variance, drawer, reconciliation |
| — | Good | Analytics is entitlement-gated on every endpoint |
| — | Good | 25 of 27 report functions are correctly tenant-scoped |
