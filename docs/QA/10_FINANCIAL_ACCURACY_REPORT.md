# Financial Accuracy Report — SMARTBUZ Platform (Part 7: Finance & Reporting)

- **Date:** 2026-11-20
- **Audited commit:** `953f958` (working tree also contains uncommitted edits to `convex/reports.ts`, `convex/shops.ts`, `convex/integrations/*`; the audit reflects the files as they are on disk)
- **Auditor:** Master System Audit (Worker — Finance & Reporting)
- **Scope:** Revenue, cost of goods sold, gross profit, net profit, expenses, cash balances, payment records, customer debts, supplier liabilities, and the daily/weekly/monthly/branch/tax/financial-summary reports.
- **Modules in scope:** `convex/reports.ts`, `convex/analytics.ts`, `convex/dashboard.ts`, `convex/finance.ts`, `convex/financeCore.ts`, `convex/expenses.ts`, `convex/banking.ts`, `convex/loans.ts`, `convex/sales.ts` (refund path), `convex/salesCore.ts` (sale totals / loan creation), `convex/verticals/tax.ts`, `src/lib/vat.ts`, and the UI components that render these figures.

## 1. Method

### 1.1 What was inspected

| Module | Lines | Role |
|---|---|---|
| `convex/financeCore.ts` | 397 | The shared calculation core (`dayBounds`, `loadSales`, `loadExpenses`, `loadIncome`, `buildCostIndex`, `summariseSales`, `summariseExpenses`, `money`) |
| `convex/analytics.ts` | 1055 | 12 reporting endpoints (period sales, P&L, expenses, best/slow sellers, stock valuation, cashier, branch, payment method, customer debt, supplier debt) |
| `convex/reports.ts` | 1824 | 27 legacy report endpoints (daily/monthly P&L, detailed sales, stock, expenses, product/customer/user performance, profit margin, payments, aged debtors) |
| `convex/dashboard.ts` | 385 | `getStats` and `getBusinessDashboard` |
| `convex/finance.ts` | 1256 | Cash shifts, cash movements, other income, reconciliation, financial summary |
| `convex/expenses.ts` | 246 | Expense CRUD, date-range listing and stats |
| `convex/loans.ts` | 433 | Credit book: loan list/stats, `makePayment`, `add` |
| `convex/banking.ts` | 94 | Money-in/out records |
| `convex/sales.ts:1038-1191` | — | `refundSale` |
| `convex/salesCore.ts:560-803` | — | Server-authoritative sale totals, stock deduction, loan creation |
| `convex/verticals/tax.ts`, `src/lib/vat.ts` | 175 / 74 | URA VAT resolution and helpers |

UI consumers were traced with a repository-wide grep for `api.<module>.<fn>` to establish which backend query actually feeds which screen.

### 1.2 Independent recomputation

All four required calculation paths were recomputed **by hand from the code and schema**, because the Convex functions require a live deployment and the live backend `affable-panda-681.convex.cloud` must never be written to. **These examples are derived by reading code, not by running it.** The `node:test` suite in `tests/` was not extended, because it tests helpers only, not the Convex query handlers.

Worked examples appear in §3 (FIN-16 … FIN-19) and are referenced from the findings that contradict them.

### 1.3 What was NOT tested and why

- **No live execution of any Convex query.** The audit is static analysis plus hand-derivation. Every numeric claim is a derivation from the cited code, not an observation of a running system.
- **No multi-tenant fixture was created.** Writing fixtures to the deployment is prohibited by the audit rules, so cross-tenant behaviour was proved by reading the index expressions and the `requireTenant` calls rather than by attempting to read another tenant's data.
- **Timezone behaviour was derived, not observed.** The browser/client timezone that `date-fns` applies in the UI could not be reproduced for every region.
- **Exports (`src/lib/export.ts`, `export-utils.ts`, `restock-pdf.ts`) were not re-audited** — out of scope for Part 7.
- **The `reports.ts` `continueCursor: "none"` pagination defect is owned by another worker and is not re-reported here.**

### 1.4 Prior audit re-verification (`docs/QA/07-finance-reporting.md`, commit `acafd2b`)

| Prior ID | Prior severity | Status now | Evidence |
|---|---|---|---|
| **C-01** — `getDailyProfitLoss` / `getMonthlyProfitLoss` aggregate across every tenant | CRITICAL | **FIXED** | `convex/reports.ts:21` and `convex/reports.ts:67` now use `withIndex("by_businessId_date", q => q.eq("businessId", businessId)…)` |
| **M-15** — VAT split computed on the client, not the server | MEDIUM | **STILL OPEN** | `convex/salesCore.ts:689-724` persists no `netAmount` / `vatAmount` / `taxRate` on the `sales` row; see FIN-11 |
| **M-28** — every report `.collect()`s its whole dataset into memory | MEDIUM | **STILL OPEN** | e.g. `convex/reports.ts:669-671`, `convex/reports.ts:691-692`, `convex/reports.ts:696` |
| **M-29** — tax inclusivity defined in three places | LOW | **STILL OPEN** | `src/lib/vat.ts:59-69`, `src/hooks/use-active-category.ts`, `convex/verticals/tax.ts:148-175` |
| **M-30** — browser-side exports load the entire dataset | MEDIUM | Out of scope for Part 7 | — |
| — finance module "good" assessment | — | **CONFIRMED still good** | `convex/finance.ts:180-1191` — tenant, permission, branch check, audit row on every mutation |

## 2. Summary Table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Revenue — analytics period reports | PASSED | `convex/analytics.ts:134` | Raw rows, refunds subtracted |
| Revenue — business dashboard | PASSED | `convex/dashboard.ts:246,262` | Raw rows, refunds subtracted |
| Revenue — legacy `dashboard.getStats` | FAILED | `convex/dashboard.ts:106,139` | Refunds not subtracted — FIN-03 |
| Revenue — legacy `reports.getReportsSummary` | FAILED | `convex/reports.ts:721` | Refunds not subtracted — FIN-01 |
| COGS — cost at time of sale | PASSED (analytics/finance) | `convex/financeCore.ts:238-262` | `stockCostHistory` → sale-line `bv` → current `purchasePrice` |
| COGS — legacy reports | FAILED | `convex/reports.ts:727`, `convex/reports.ts:1460` | Uses *current* purchase price — FIN-01, FIN-02 |
| Gross profit | FAILED (legacy) / PASSED (analytics) | `convex/financeCore.ts:351`, `convex/reports.ts:757` | Two implementations disagree |
| Net profit (incl. expenses) | PASSED | `convex/analytics.ts:255-256`, `convex/finance.ts:1218-1221` | Gross + other income − operating expenses |
| Other income | PASSED | `convex/financeCore.ts:170-189` | `incomeRecords` |
| Expenses — tenant scoped | PASSED | `convex/expenses.ts:19,23,44-50,90-92,124-126` | Every read/write checks `businessId` |
| Expenses — included in net profit | PASSED | `convex/analytics.ts:230-237,268` | Yes |
| Expenses — date handling | FAILED | `convex/expenses.ts:164-171,192-199` | Start-of-range day silently excluded — FIN-07 |
| Expenses — negative amount accepted | FAILED | `convex/expenses.ts:52-63` | Inflates net profit — FIN-08 |
| Cash balance (shift) | PASSED | `convex/finance.ts:75-119` | Recomputed from float + cash sales + movements |
| Cash balance (drawer) | PASSED | `convex/finance.ts:682-833` | Variance = sum of shifts' variances |
| Payment records | PASSED | `convex/loans.ts:410-418` | `payments` rows written per repayment |
| Reconciliation | PARTIAL | `convex/finance.ts:1003-1014` | Loan repayments carry no `method` — FIN-15 |
| Customer debts | PARTIAL | `convex/analytics.ts:875`, `convex/reports.ts:1747` | Derived from mutable `loans.balance` — FIN-12, FIN-13 |
| Supplier liabilities | PASSED | `convex/analytics.ts:994-1009` | Derived from `supplierLedger` movements, not a counter |
| Refunds → revenue | PASSED (analytics/finance) | `convex/financeCore.ts:320-321` | — |
| Refunds → cost | PASSED | `convex/financeCore.ts:331-334` | `refundedItems` cost reversed |
| Refunds → customer debt | FAILED | `convex/sales.ts:1149-1156` | Loan balance not reversed — FIN-10 |
| Date range boundaries | FAILED | `convex/reports.ts:112`, `convex/financeCore.ts:61-68` | Boundary and timezone defects — FIN-05, FIN-06, FIN-07 |
| Timezone handling | FAILED | `convex/dashboard.ts:32-43,197-202` | `business.timezone` labels the period but does not bound it — FIN-06 |
| Currency / rounding | PARTIAL | `convex/salesCore.ts:589`, `convex/financeCore.ts:383-385` | Stored totals unrounded; UI hardcodes "UGX" — FIN-14, FIN-18 |
| Tax / VAT report | NOT IMPLEMENTED | `convex/salesCore.ts:689-724` | No VAT is persisted per sale — FIN-11 |
| Mock / hardcoded figures | PASSED | grep across `convex/`, `src/app/(dashboard)/reports/` | No hardcoded financial values found — FIN-19 |
| Cross-tenant contamination (reports) | PASSED | `convex/reports.ts:13-15`, `convex/analytics.ts:106-108`, `convex/dashboard.ts:53-54` | Every report resolves the tenant first |
| Counter drift inventory | FAILED (partial) | see §3.2 | `loans.balance`, `payments.balance`, `customerWallets.balance` are mutable counters |

## 3. Findings

### FIN-01 — `getReportsSummary` overstates revenue and mis-states cost of goods sold

- **Module:** `convex/reports.ts` (`getReportsSummary`, `:651-770`)
- **Severity:** HIGH
- **Description:** The legacy reports summary — the query behind the "Total Sales" / "Est. Net Profit" tiles of the main reports table (`src/app/(dashboard)/reports/components/ReportSummary.tsx:71-101`, consumed via `api.reports.getReportsSummary` in `src/app/(dashboard)/reports/components/DetailedSalesReport.tsx:63`) — computes revenue as the raw sum of `sale.total` with **no subtraction of `refundAmount`**, and computes cost of goods sold from the **current** `stocks.purchasePrice` rather than the cost at the time of the sale. Both contradict `convex/financeCore.ts`, which the newer analytics and finance modules use.
- **Steps to reproduce:** Static inspection: `convex/reports.ts:721` (`totalRevenue += sale.total;`) and `convex/reports.ts:727` (`totalCostOfSales += stock.purchasePrice * item.quantity;`), versus `convex/financeCore.ts:320-321` (`const revenue = (sale.total ?? 0) - refund;`) and `convex/financeCore.ts:326` (`costs.costFor(item.stockId, item.bv ?? 0, sale.date)`).
- **Expected behavior:** Revenue = Σ (`sale.total` − `sale.refundAmount`); COGS = Σ unit-cost-at-sale-date × quantity, resolved via `stockCostHistory` → sale-line `bv` → current `purchasePrice`, as documented at `convex/financeCore.ts:27-44`.
- **Actual behavior:** Revenue includes the pre-refund total of any refunded sale. COGS uses today's purchase price, so a product re-stocked at a higher cost rewrites the profit of every historical sale.
- **Root cause:** `getReportsSummary` predates `financeCore.ts` and was never migrated onto it; a second, independent implementation of the same arithmetic now exists in the codebase.
- **Recommended fix:** Replace the aggregation loop at `convex/reports.ts:715-730` with `buildCostIndex` + `summariseSales` from `convex/financeCore.ts` (the same two calls `convex/analytics.ts:227-228` makes), and subtract `sale.refundAmount` and reverse `sale.refundedItems` cost exactly as `convex/financeCore.ts:320-334` does.
- **Test required to verify the fix:** A node:test case that seeds a business with one sale of 300,000 plus a later purchase that raises the product's `purchasePrice` to 95,000, then asserts `getReportsSummary` returns revenue 300,000 and COGS 160,000 — identical to `summariseSales`.

### FIN-02 — `getProfitMarginReport` uses current purchase price and ignores refunds

- **Module:** `convex/reports.ts` (`getProfitMarginReport` `:1425-1503`, `getProfitMarginSummary` `:1506`)
- **Severity:** HIGH
- **Description:** The profit-margin report computes per-product cost as `stock?.purchasePrice` at line `convex/reports.ts:1460` and revenue as `item.quantity * item.price` at `:1458`, with no reference to `sale.refundAmount` or `stockCostHistory`. The product-level profit and margin shown in the Profit report is therefore computed on a different cost basis from the period P&L in `convex/analytics.ts:212-277`, for the same sales.
- **Steps to reproduce:** Static inspection: `convex/reports.ts:1455-1481`.
- **Expected behavior:** The same cost basis as `convex/analytics.ts:137-145` (cost at sale date), with refunded lines excluded or reversed.
- **Actual behavior:** Cost is today's purchase price; refunded sales still show full revenue and full cost.
- **Root cause:** Same duplication as FIN-01 — a second COGS implementation.
- **Recommended fix:** Reuse `buildCostIndex`/`costFor` with `sale.date`, and net off `sale.refundAmount` and `sale.refundedItems` per line before aggregating.
- **Test required to verify the fix:** A test asserting that a product whose purchase price changed after the sale shows the sale-date cost, and that a refunded sale contributes zero revenue.

### FIN-03 — `dashboard.getStats` counts refunded sales as full revenue, disagreeing with the dashboard beside it

- **Module:** `convex/dashboard.ts` (`getStats` `:45-155`)
- **Severity:** HIGH
- **Description:** `totalRevenue` at `convex/dashboard.ts:106` is `filteredSales.reduce((sum, sale) => sum + sale.total, 0)` and the daily-revenue chart at `convex/dashboard.ts:139` is `(dailyRevenue[day] || 0) + sale.total` — neither subtracts `refundAmount`. The **same dashboard page** (`src/app/(dashboard)/page.tsx:105-120`) also renders `api.dashboard.getBusinessDashboard`, whose revenue *does* subtract refunds (`convex/dashboard.ts:246`). Two revenue figures for the same business, on the same screen, computed differently.
- **Steps to reproduce:** Static inspection: `convex/dashboard.ts:106` and `convex/dashboard.ts:139` versus `convex/dashboard.ts:246`; both queries are called at `src/app/(dashboard)/page.tsx:106` and `:118`.
- **Expected behavior:** One revenue figure per business per period. `convex/dashboard.ts:22` itself promises "Every figure is computed from the caller's business only", and `convex/financeCore.ts:1-9` states the intent that "the dashboard and the reports cannot tell three different stories about the same day".
- **Actual behavior:** After a 300,000 refund, `getStats` still reports 300,000 of revenue while `getBusinessDashboard` reports 0.
- **Root cause:** `getStats` was not migrated onto `financeCore.summariseSales` when that core was introduced.
- **Recommended fix:** Compute `getStats` from `summariseSales(loadSales(...), buildCostIndex(...))` and use `totals.revenue` for both the KPI and the chart.
- **Test required to verify the fix:** Seed a sale of 300,000 fully refunded, then assert `getStats.totalRevenue === 0` and `getBusinessDashboard.today.revenue === 0`.

### FIN-04 — `getDailyProfitLoss` / `getMonthlyProfitLoss` carry the same two arithmetic defects (currently unreferenced by the UI)

- **Module:** `convex/reports.ts` (`:8-52`, `:54-99`)
- **Severity:** MEDIUM
- **Description:** Both endpoints add `sale.total` without subtracting `refundAmount` (`convex/reports.ts:33`, `:79`) and use `stock.purchasePrice` for cost (`:37`, `:83`). They are, however, **not called by any UI component** — a repository-wide grep for `api.reports.*` finds no consumer of `getDailyProfitLoss` or `getMonthlyProfitLoss` — so the defect is latent rather than user-visible today.
- **Steps to reproduce:** Static inspection: `convex/reports.ts:33,37,79,83`; grep for `getDailyProfitLoss` / `getMonthlyProfitLoss` under `src/` returns no hits.
- **Expected behavior:** Same as FIN-01.
- **Actual behavior:** Same as FIN-01; the figures would also be wrong if these endpoints were wired up.
- **Root cause:** Duplicated COGS/revenue logic, second instance.
- **Recommended fix:** Either delete both endpoints or reimplement them on `financeCore` (`summariseSales` + `buildCostIndex`), exactly as proposed in FIN-01.
- **Test required to verify the fix:** Either a test asserting the endpoints are removed, or a test asserting their output equals `summariseSales` output for the same period.

### FIN-05 — `getSalesAndExpenses` silently drops the entire last day of the requested range

- **Module:** `convex/reports.ts` (`getSalesAndExpenses` `:101-122`)
- **Severity:** HIGH
- **Description:** The sales query at `convex/reports.ts:112` bounds the range with `.lte("date", args.endDate)` — the raw `YYYY-MM-DD` end date, with no time suffix. Sale rows store `date` as a full ISO instant (`convex/salesCore.ts:696`, e.g. `"2026-03-10T14:22:07.412Z"`). A lexicographic comparison of `"2026-03-10T14:22:07.412Z"` against `"2026-03-10"` is **greater**, so every sale on the end date falls outside the `lte` bound and is excluded. The expenses query at `:117` has the identical defect. Every other date-bounded endpoint in the same file appends `"T23:59:59.999"` (e.g. `:144`, `:216`, `:669`, `:691`, `:857`, `:1438`, `:1702`) — this one does not.
- **Steps to reproduce:** Static inspection: `convex/reports.ts:112` and `convex/reports.ts:117`. Store a sale dated `2026-03-10T14:22:07.412Z`; request the range `2026-03-01` → `2026-03-10`; the sale is not returned. (Derived by reading code, not executed.)
- **Expected behavior:** An inclusive range — both the first and the last day are fully included, consistent with `convex/financeCore.ts:61-68`.
- **Actual behavior:** The last day of every range is empty for sales and expenses.
- **Root cause:** Missing end-of-day suffix on the bound.
- **Recommended fix:** Use `dayBounds(args.startDate, args.endDate)` from `convex/financeCore.ts` and bound with `gte("date", start).lte("date", end)`.
- **Test required to verify the fix:** A test with a sale at `T14:22:07.412Z` on the end date, asserting it appears in the result.

### FIN-06 — The business time zone labels the period but does not bound it

- **Module:** `convex/dashboard.ts` (`:32-43`, `:197-202`), `convex/financeCore.ts` (`:61-68`)
- **Severity:** MEDIUM
- **Description:** `convex/dashboard.ts:32-43` computes "today" in the business's own time zone via `Intl.DateTimeFormat` — and the comment at `:25-31` states the reason: *"A business in Kampala does not close its books at midnight UTC… Using the business's time zone is the difference between 'today's sales' being right and being three hours out."* But the value is then used only as a **label**. The actual window is `loadSales(ctx, businessId, today, today, …)`, and `convex/financeCore.ts:66` bounds it with `` `${to.slice(0,10)}T23:59:59.999Z` `` — a **UTC** instant. For a UTC+3 business, local 00:00–03:00 of "today" (UTC `yesterday 21:00`–`24:00`) is excluded, and local 21:00–24:00 of tomorrow (UTC `today 18:00`–`21:00`) is included. The window is three hours out — exactly what the comment says the code prevents. `business.timezone` is used nowhere else in any period calculation.
- **Steps to reproduce:** Static inspection: `convex/dashboard.ts:197` → `convex/dashboard.ts:200` → `convex/financeCore.ts:61-68`. A sale recorded at local `2026-03-10T01:30:00+03:00` (= `2026-03-09T22:30:00Z`) is outside the `2026-03-10` → `2026-03-10T23:59:59.999Z` window and is excluded from "today".
- **Expected behavior:** The window for a day in a UTC+3 business runs `2026-03-09T21:00:00Z` → `2026-03-10T20:59:59.999Z`.
- **Actual behavior:** The window runs `2026-03-10T00:00:00Z` → `2026-03-10T23:59:59.999Z`.
- **Root cause:** `dayBounds` works in UTC; `todayIn` works in local time; nothing converts between them.
- **Recommended fix:** Make `dayBounds` timezone-aware — compute the UTC instant of local midnight for the business's zone and use that as the lower bound. Note that `convex/analytics.ts` and `convex/finance.ts` call `dayBounds` without a timezone argument, so the timezone must be threaded through (`loadSales`, `loadExpenses`, `loadIncome` all take `businessId` — the business's `timezone` is available there).
- **Test required to verify the fix:** A test with a business whose `timezone` is `Africa/Kampala` and a sale at `2026-03-09T22:30:00Z`, asserting it is included in the `2026-03-10` dashboard.

### FIN-07 — The expenditures screen drops the expenses of the range's first day

- **Module:** `convex/expenses.ts` (`listByDateRange` `:150-175`, `getStats` `:178-221`)
- **Severity:** MEDIUM
- **Description:** Expenses store a **bare** calendar date — `src/app/(dashboard)/expenditures/page.tsx:78` and `:177` send `new Date().toISOString().split("T")[0]`, i.e. `"2026-03-10"`. The query bounds, however, are full ISO instants — `src/app/(dashboard)/expenditures/page.tsx:87-88` sends `startOfDay(from).toISOString()` / `endOfDay(to).toISOString()` — and `convex/expenses.ts:167-169` compares them against the bare stored date lexicographically. `"2026-03-10"` ≥ `"2026-03-10T00:00:00.000Z"` is **false** (the bare string is a prefix and therefore sorts first), so the expense on the range's first day is silently excluded whenever the client's local midnight is at or ahead of UTC — i.e. for UTC, UTC+1 and later users. Note that `convex/analytics.ts` handles the same table correctly through `dayBounds` (`convex/financeCore.ts:65` slices the start bound to a bare date), so the two screens disagree.
- **Steps to reproduce:** Static inspection: `convex/expenses.ts:164-171` (and the identical `:192-199`), combined with the bound construction at `src/app/(dashboard)/expenditures/page.tsx:87-88`. (Derived by reading code; the outcome is timezone-dependent.)
- **Expected behavior:** Every expense in the inclusive range is returned and totalled.
- **Actual behavior:** The first day's expenses are missing from the expenditures list and from the expenditure KPI total.
- **Root cause:** A bare-date column compared against a full-instant bound. The bound is built in the browser, so the result also depends on the browser's timezone.
- **Recommended fix:** Normalise the stored date and the bound to the same shape — e.g. store `YYYY-MM-DD` and bound with `dayBounds(from, to)` (`convex/financeCore.ts:61-68`), or store a full instant and compare instants consistently.
- **Test required to verify the fix:** A test that stores an expense dated `2026-03-10` and queries the range `2026-03-10` → `2026-03-10`, asserting it is returned and included in `getStats.total`.

### FIN-08 — An expense may be recorded with a negative amount, inflating net profit

- **Module:** `convex/expenses.ts` (`add` `:29-76`, `update` `:107-147`)
- **Severity:** MEDIUM
- **Description:** `convex/expenses.ts:52-63` inserts `amount: args.amount` with no sign check — contrast `convex/finance.ts:192-194`, which rejects a negative opening float, and `convex/loans.ts:406`, which rejects a payment that exceeds the balance. `summariseExpenses` (`convex/financeCore.ts:362-380`) sums the amounts with no sign handling, and net profit is `grossProfit + otherIncome − operatingExpenses` (`convex/analytics.ts:256`). A negative expense therefore **increases** net profit by its absolute value, and a negative expense also lands in `byType` as a negative total.
- **Steps to reproduce:** Static inspection: `convex/expenses.ts:52-63` (no `amount < 0` guard) and `convex/financeCore.ts:368` (`group.total += expense.amount ?? 0`). (Derived by reading code, not executed.)
- **Expected behavior:** `amount` is a positive cost; a credit against an expense is either rejected or modelled as other income.
- **Actual behavior:** A negative expense is stored and reduces the expense total, raising reported net profit.
- **Root cause:** Missing input validation on a financial field.
- **Recommended fix:** Reject `amount <= 0` in `convex/expenses.ts:add` and `:update` with a `ConvexError`, mirroring the style of `convex/finance.ts:192-194`.
- **Test required to verify the fix:** A test asserting `expenses.add` with `amount: -5000` throws, and that net profit is unaffected.

### FIN-09 — Loan payments carry no payment `method`, so reconciliation under-counts repayments

- **Module:** `convex/loans.ts` (`makePayment` `:384-433`), `convex/finance.ts` (`reconcile` `:952-1074`)
- **Severity:** MEDIUM
- **Description:** `convex/loans.ts:410-418` inserts the `payments` row with `businessId`, `loanId`, `shopId`, `customerId`, `amount`, `date` and `balance` — but **not** `method`. The schema declares `method` optional (`convex/schema.ts:696`, "`cash | mobile_money | bank | card | cheque`"). `convex/finance.ts:1009-1014` matches repayments to a statement by `payment.method`, so every loan repayment has `method === undefined` and is skipped. The reconciliation "books" figure therefore omits all repayments, and the variance against a bank statement is overstated.
- **Steps to reproduce:** Static inspection: `convex/loans.ts:410-418` (no `method` field) versus `convex/finance.ts:1010-1013` (`if (method !== args.method.toLowerCase()) continue;`). The UI caller (`src/app/(dashboard)/sales/loans-view.tsx:114`) does not supply a method.
- **Expected behavior:** A reconciliation of a bank statement includes the credit repayments received in that month.
- **Actual behavior:** Repayments are invisible to the reconciliation; the books figure is short by the total repaid.
- **Root cause:** The `method` field is optional in the schema and no caller sets it.
- **Recommended fix:** Add a required `method` argument to `convex/loans.makePayment`, persist it on the `payments` row, and pass it from the UI (defaulting to `cash` where the UI does not collect one).
- **Test required to verify the fix:** A test that records a loan repayment with `method: "bank"`, reconciles a `2026-03` bank statement, and asserts `recordedAmount` includes the repayment.

### FIN-10 — A refunded credit sale keeps its full outstanding balance in the debt book

- **Module:** `convex/sales.ts` (`refundSale` `:1038-1191`), `convex/loans.ts`, `convex/analytics.ts` (`getCustomerDebtReport` `:849-968`)
- **Severity:** MEDIUM
- **Description:** `refundSale` reverses the goods (`:1128` restores `qty`, `:1130-1142` writes a `SALE_REFUND` stock-ledger row) and the money on the sale row (`:1149-1156` sets `refundAmount` and `refundedItems`). It **never touches the `loans` row**. A credit sale of 300,000 with a 50,000 deposit creates a loan with `balance = 250,000` (`convex/salesCore.ts:758-770`). If the customer returns the goods and the sale is refunded in full, the loan still carries `balance = 250,000`, and every debt report — `convex/analytics.ts:875` (`loan.balance`), `convex/reports.ts:751`, `convex/reports.ts:1716`, `convex/reports.ts:1747`, `convex/dashboard.ts:318`, `convex/finance.ts:1183` — continues to show the customer as owing 250,000. Receivables and the dashboard "who owes what" tile are overstated; the credit-limit check at `convex/analytics.ts:926-929` (`overLimit`) can then wrongly flag the customer.
- **Steps to reproduce:** Static inspection: `convex/sales.ts:1149-1156` (the only patch performed) and `convex/analytics.ts:875`.
- **Expected behavior:** A refund of a credit sale reduces (or clears) the corresponding loan balance, and the reversal is written to the loan's payment history.
- **Actual behavior:** The loan balance is unchanged by the refund.
- **Root cause:** `refundSale` was implemented against the `sales` table and the `stockLedger` only; the loan is a third artefact of the same sale and was not included.
- **Recommended fix:** In `refundSale`, look up the loan by `salesId`, reduce `loan.balance` by the refunded amount (clamped at 0), insert a compensating `payments` row with a negative/credit amount or a dedicated reversal `type`, and write the reversal to the audit trail.
- **Test required to verify the fix:** Seed a credit sale, refund it fully, and assert `loans.balance === 0` and that `getCustomerDebtReport.totals.balance === 0`.

### FIN-11 — No VAT is ever persisted on a sale, so no tax report can be produced

- **Module:** `convex/salesCore.ts` (`:689-724`), `convex/verticals/tax.ts`, `src/lib/vat.ts`
- **Severity:** MEDIUM
- **Description:** The server owns the VAT *rate* — `convex/verticals/tax.ts:148-175` (`resolveTax`) derives it from the vertical and clamps any client value to the 18% URA standard — and the rate is stored on the business profile (`convex/schema.ts:39-42`). But the **sale row stores no tax breakdown**: `convex/salesCore.ts:689-724` inserts `total`, `items`, `paymentMode` and no `netAmount` / `vatAmount` / `taxRate`. The VAT split on the receipt is computed in the browser — `src/app/(dashboard)/sales/page.tsx:739-745` builds `vatFigures` from `vatProfile` and passes `netAmount`/`vatAmount` into the receipt object. A tampered client can therefore present a VAT figure that does not reconcile with the server's `total`, and no server-side tax report can be produced from the sales data because the per-sale VAT amounts do not exist.
- **Steps to reproduce:** Static inspection: `convex/salesCore.ts:689-724` (insert has no tax fields) and `src/app/(dashboard)/sales/page.tsx:739-745` (client-side VAT split). Grep for `vatAmount`/`netAmount` across `convex/` returns no hits.
- **Expected behavior:** The server computes and persists the VAT split per sale, and a tax report aggregates it.
- **Actual behavior:** The VAT figure exists only in the browser; it is never written, cannot be audited, and cannot be reported on.
- **Root cause:** `resolveTax` was applied to the business profile but not carried into the sale transaction.
- **Recommended fix:** Compute the VAT split server-side inside `applySale` (using `resolveTax` against the business's vertical), persist `netAmount`, `vatAmount` and `taxRate` on the `sales` row, and add a tax report that sums the persisted VAT over a period.
- **Test required to verify the fix:** A test that creates a sale on an 18% VAT-inclusive business and asserts the persisted `sale.vatAmount === roundUgx(total − total/1.18)` and that a client-supplied VAT value is ignored.

### FIN-12 — Customer debt is derived from a mutable balance counter, not from the movements

- **Module:** `convex/analytics.ts` (`getCustomerDebtReport` `:849-968`), `convex/loans.ts`, `convex/schema.ts`
- **Severity:** MEDIUM
- **Description:** Every customer-debt figure reads `loan.balance` — a **stored counter** on the loan row (`convex/schema.ts:681`) that is decremented by `convex/loans.ts:405-408` (`const newBalance = loan.balance - args.amount; … await ctx.db.patch(args.loanId, { balance: newBalance });`). The `payments` table also stores a `balance` snapshot (`convex/schema.ts:695`). The debt reports sum the counter rather than deriving it from the movement history (`amount − Σ payments`), so the counter and the movements can diverge: a payment that fails to write its `payments` row still reduces `loan.balance`; a `payments` row inserted without a corresponding balance update does the opposite. The schema's own comment on `customers.creditLimit` (`convex/schema.ts:470-475`) says the customer balance "is derived from the loans and payments on the account — it is never stored, so it cannot drift", but the loan-level counter that every report actually reads is stored.
- **Steps to reproduce:** Static inspection: `convex/analytics.ts:875` (`const balance = loan.balance ?? 0;`), `convex/loans.ts:405-408`, `convex/schema.ts:681` and `:695`.
- **Expected behavior:** Outstanding debt = `loan.amount − Σ(payments.amount)` computed from the movement rows, or a counter maintained in the same transaction as every movement with an invariant check.
- **Actual behavior:** A stored counter is the source of truth for six separate figures (`convex/analytics.ts:875`, `convex/reports.ts:751`, `:1716`, `:1747`, `convex/dashboard.ts:318`, `convex/finance.ts:1183`).
- **Root cause:** Denormalised counter used as the reporting source of truth.
- **Recommended fix:** Derive the balance from the `payments` movements (`loan.amount − Σ payments.amount`) in a shared helper in `convex/financeCore.ts`, and use it in all six call sites; or add a reconciliation that flags `loan.balance ≠ amount − Σ payments`.
- **Test required to verify the fix:** A test that inserts a `payments` row directly (bypassing `makePayment`) and asserts the debt reports show the derived balance, not the stale counter.

### FIN-13 — The ageing of debts is computed from the loan's start date, not from its last activity

- **Module:** `convex/analytics.ts` (`getCustomerDebtReport` `:887-893`), `convex/reports.ts` (`getAgedDebtors` `:1760-1788`)
- **Severity:** MEDIUM
- **Description:** Both ageing reports bucket a loan's outstanding balance by the age of the **loan itself**: `convex/analytics.ts:887-893` computes `ageDays` from `loan.date` and places the whole remaining balance into the current / d30 / d60 / d90 bucket; `convex/reports.ts:1765-1773` does the same with `l.date` (falling back to the sale date). A loan taken 200 days ago against which the customer paid yesterday still shows its entire remaining balance in the "over 90 days" bucket. Standard ageing of a debtor's account measures the time since the **last payment**, not since the invoice.
- **Steps to reproduce:** Static inspection: `convex/analytics.ts:887` (`new Date(loan.date).getTime()`) and `convex/reports.ts:1765`.
- **Expected behavior:** Ageing buckets derived from the date of the most recent payment on the account (or, for an unpaid invoice, its own date).
- **Actual behavior:** Ageing derived from the origination date only.
- **Root cause:** The `payments` table is not consulted when ageing.
- **Recommended fix:** For each loan, find the latest `payments.date` (falling back to `loan.date`) and compute `ageDays` from that.
- **Test required to verify the fix:** A test with a 200-day-old loan and a payment yesterday, asserting the outstanding balance appears in the "current" bucket.

### FIN-14 — Sale totals are stored unrounded; the displayed value can differ from the stored value

- **Module:** `convex/salesCore.ts` (`:589`), `convex/financeCore.ts` (`:383-385`), `src/lib/vat.ts` (`:16-18`)
- **Severity:** LOW
- **Description:** `convex/salesCore.ts:589` accumulates `computedTotal += unitPrice * item.quantity` with **no rounding**, and that unrounded value is stored as `sales.total` (`:695`). The report layer rounds only at the end (`money()` at `convex/financeCore.ts:383-385`, `Math.round((v + Number.EPSILON) * 100) / 100`). So a sale of 3 × 33.333 = 99.999 is stored as `99.999` and displayed as `100.00`; a single report line and the stored invoice can differ by up to half a cent per line. The VAT helpers use a different rule entirely — `src/lib/vat.ts:16-18` rounds to **whole shillings** (`Math.round(amount)`), because UGX has no practical subunit — so a VAT-inclusive receipt and a P&L figure use two different rounding conventions in the same transaction.
- **Steps to reproduce:** Static inspection: `convex/salesCore.ts:589`, `convex/salesCore.ts:695`, `convex/financeCore.ts:383-385`, `src/lib/vat.ts:16-18`.
- **Expected behavior:** One documented rounding convention, applied at a single point.
- **Actual behavior:** Float arithmetic is stored raw; two-decimal rounding happens at report time; VAT uses whole-shilling rounding.
- **Root cause:** No rounding policy applied at the transaction boundary.
- **Recommended fix:** Round `computedTotal` with the UGX whole-shilling rule at `convex/salesCore.ts:589` (or a documented two-decimal rule) so the stored invoice equals the reported figure; state the convention in `convex/financeCore.ts`.
- **Test required to verify the fix:** A test selling a product priced at 33.333 and asserting `sale.total === 100` and that the reported revenue equals the sum of `sale.total`.

### FIN-15 — The currency is hardcoded as "UGX" across the report UI although the schema carries a currency

- **Module:** `src/app/(dashboard)/reports/components/ReportSummary.tsx`, `src/lib/export.ts`, `convex/schema.ts`
- **Severity:** LOW
- **Description:** `businesses` carries `currency` and `currencySymbol` (`convex/schema.ts:31-32`), and `suppliers`/`plans` carry `currency` too, but the report UI hardcodes the literal `UGX` — `src/app/(dashboard)/reports/components/ReportSummary.tsx:78,92,107`, `src/app/(dashboard)/reports/components/CustomersReport.tsx:71,77,83,195`, `src/lib/export.ts:224`, `src/lib/escpos.ts:209`. Amounts are formatted with `toLocaleString()` **without a locale argument**, so the thousands separator depends on the browser's locale (a `de-DE` browser renders `10.000`, an `en-US` browser `10,000`) and no currency symbol is attached to the value at all. There is no FX handling: all amounts in a business are assumed to be in the business's currency, which is correct, but the value shown is not the configured currency.
- **Steps to reproduce:** Static inspection: `src/app/(dashboard)/reports/components/ReportSummary.tsx:78` (`` `UGX ${data.totalRevenue.toLocaleString()}` ``).
- **Expected behavior:** The configured `business.currency` / `currencySymbol` is used, with a fixed locale.
- **Actual behavior:** A hardcoded `UGX` prefix and locale-dependent separators.
- **Root cause:** The currency field was added to the schema but never wired into presentation.
- **Recommended fix:** Read `business.currency`/`currencySymbol` from the caller's business and format with `Intl.NumberFormat(locale, { style: "currency", currency })`.
- **Test required to verify the fix:** A component test asserting that a business configured with a non-UGX currency renders that currency.

### FIN-16 — Worked example A: revenue for a period (independently recomputed)

- **Module:** `convex/analytics.ts` (`getSalesByPeriod` `:97-199`), `convex/financeCore.ts`
- **Severity:** INFORMATIONAL
- **Description:** *Derived by reading code, not by running it.*
  - **Formula (from the code):** `revenue = Σ over sales in range of (sale.total − sale.refundAmount)`, where the range is the set of `sales` rows with `businessId = tenant.businessId` and `from.slice(0,10) ≤ sale.date ≤ to.slice(0,10) + "T23:59:59.999Z"` (`convex/financeCore.ts:61-68`, `:118`, `:133-138`).
  - **Worked case:** business B has three sales in March 2026 — S1 total 300,000, refundAmount 0; S2 total 150,000, refundAmount 50,000; S3 total 200,000, refundAmount 0. Query `from=2026-03-01, to=2026-03-31`.
  - **Expected:** `300,000 + (150,000 − 50,000) + 200,000 = 600,000`.
  - **Implementation:** `convex/analytics.ts:134` — `bucket.revenue += (sale.total ?? 0) - refund;` — sums 300,000 + 100,000 + 200,000 = **600,000**. **MATCHES.**
  - **Divergent implementation:** `convex/reports.ts:721` — `totalRevenue += sale.total;` — sums 300,000 + 150,000 + 200,000 = **650,000**. **DOES NOT MATCH** (FIN-01). Same data, same month, two answers, 50,000 apart.
- **Steps to reproduce:** Static inspection: `convex/analytics.ts:134`, `convex/reports.ts:721`, `convex/dashboard.ts:106`.
- **Expected behavior:** One revenue figure for a period.
- **Actual behavior:** 600,000 / 650,000 / 650,000 depending on which endpoint is asked.
- **Root cause:** Three implementations of one calculation.
- **Recommended fix:** See FIN-01 and FIN-03.
- **Test required to verify the fix:** One shared test asserting all three endpoints return 600,000 for the fixture above.

### FIN-17 — Worked example B: gross profit for a set of sales (independently recomputed)

- **Module:** `convex/financeCore.ts` (`:208-263`, `:303-353`), `convex/analytics.ts` (`getProfitAndLoss` `:212-277`)
- **Severity:** INFORMATIONAL
- **Description:** *Derived by reading code, not by running it.*
  - **Formula (from the code):** `cost = Σ_items unitCost(stockId, item.bv, sale.date) × item.quantity`, where `unitCost` resolves in this order (`convex/financeCore.ts:239-261`): (1) the most recent `stockCostHistory` row for the stock with `row.date ≤ sale.date` → `row.unitCost`; (2) else `item.bv` if `> 0`; (3) else the product's current `stocks.purchasePrice`; (4) else 0. Then `grossProfit = revenue − cost` (`:351`), with refunded lines' cost subtracted back (`:331-334`).
  - **Worked case:** one sale on `2026-03-10T09:00:00.000Z`, total 300,000, one line for stock S, quantity 2, `item.bv = 80,000`. `stockCostHistory` for S: `{date: "2026-01-05", unitCost: 80,000}` and `{date: "2026-05-02", unitCost: 95,000}`. Current `stocks.purchasePrice` for S: 95,000.
  - **Expected:** the latest purchase on or before the sale date is the 2026-01-05 row → unitCost **80,000**. Cost = 80,000 × 2 = **160,000**. Revenue = 300,000. Gross profit = **140,000**.
  - **Implementation (`convex/financeCore.ts:242-249`):** the loop takes `2026-01-05` (≤ sale date), then breaks on `2026-05-02` (> sale date) → `found = 80,000` → cost 160,000 → gross profit **140,000**. **MATCHES.**
  - **Divergent implementation (`convex/reports.ts:727`):** `stock.purchasePrice × item.quantity` = 95,000 × 2 = **190,000** → gross profit **110,000**. **DOES NOT MATCH** — 30,000 understated (FIN-01).
  - **Divergent implementation (`convex/reports.ts:1460`, profit margin):** same 190,000 → **DOES NOT MATCH** (FIN-02).
- **Steps to reproduce:** Static inspection: `convex/financeCore.ts:239-261`, `convex/financeCore.ts:326-334`, `convex/reports.ts:727`, `convex/reports.ts:1460`.
- **Expected behavior:** Gross profit computed on the cost of the goods at the time they were sold, as documented at `convex/financeCore.ts:27-44`.
- **Actual behavior:** Two of the three implementations use today's purchase price, so a later re-stock rewrites historical profit.
- **Root cause:** Duplicated cost resolution; only `financeCore` implements the documented order.
- **Recommended fix:** See FIN-01 and FIN-02.
- **Test required to verify the fix:** Assert all three endpoints report gross profit 140,000 for the fixture above.

### FIN-18 — Worked example C: net profit including expenses (independently recomputed)

- **Module:** `convex/analytics.ts` (`getProfitAndLoss` `:255-256`), `convex/finance.ts` (`getFinancialSummary` `:1218-1221`)
- **Severity:** INFORMATIONAL
- **Description:** *Derived by reading code, not by running it.*
  - **Formula (from the code):** `netProfit = grossProfit + otherIncome − operatingExpenses`, where `otherIncome = Σ incomeRecords.amount` in range (`convex/financeCore.ts:170-189`, `:251-253`) and `operatingExpenses = Σ expenses.amount` in range (`convex/financeCore.ts:148-167`, `:362-380`).
  - **Worked case:** continuing example B — grossProfit 140,000. Other income in March 2026: one `incomeRecords` row of 50,000. Expenses in March 2026: 30,000 across two rows (20,000 Rent, 10,000 Fuel).
  - **Expected:** 140,000 + 50,000 − 30,000 = **160,000**.
  - **Implementation (`convex/analytics.ts:255-256`):** `grossProfit = money(revenue − cost)` = 140,000; `otherIncome` = 50,000; `expenseTotals.total` = 30,000; `netProfit = money(140,000 + 50,000 − 30,000)` = **160,000**. **MATCHES.** `convex/finance.ts:1218-1221` computes the identical expression from the same core. **MATCHES.**
  - **Divergent implementation (`convex/reports.ts:757`):** `totalProfit = totalRevenue − totalCostOfSales − totalExpenses` = 300,000 − 190,000 − 30,000 = **80,000**, and it **omits other income entirely** (no `incomeRecords` read anywhere in `convex/reports.ts`). **DOES NOT MATCH** (FIN-01) — and it is labelled "Est. Net Profit" in `src/app/(dashboard)/reports/components/ReportSummary.tsx:92-97` while being a gross-profit-minus-expenses figure computed on the wrong cost basis.
- **Steps to reproduce:** Static inspection: `convex/analytics.ts:255-256`, `convex/finance.ts:1218-1221`, `convex/reports.ts:757`.
- **Expected behavior:** Net profit includes other income and uses the correct cost basis.
- **Actual behavior:** The reports table's "Est. Net Profit" omits other income and uses current purchase prices.
- **Root cause:** Same duplication; `reports.ts` never reads `incomeRecords`.
- **Recommended fix:** See FIN-01.
- **Test required to verify the fix:** Assert the reports summary and the analytics P&L both return net profit 160,000 for the fixture.

### FIN-19 — Worked example D: cash balance after a payment (independently recomputed)

- **Module:** `convex/finance.ts` (`expectedCashForShift` `:75-119`, `closeShift` `:271-345`)
- **Severity:** INFORMATIONAL
- **Description:** *Derived by reading code, not by running it.*
  - **Formula (from the code):** `expectedCash = openingFloat + Σ(cash sales: sale.total − sale.refundAmount) + Σ(cashMovements type "in") − Σ(cashMovements type "out")`, restricted to the shift's own sales (`sale.userId === shift.userId` and the shift's `shopId`/`branchId`) and the shift's own movements (`by_shiftId` index) (`convex/finance.ts:83-118`).
  - **Worked case:** a shift opened with `openingFloat = 100,000`; one cash sale of 50,000 by that cashier during the shift; one `cashMovements` row `type: "in", amount: 20,000` on that shift; one `cashMovements` row `type: "out", amount: 5,000` on that shift.
  - **Expected:** 100,000 + 50,000 + 20,000 − 5,000 = **165,000**.
  - **Implementation (`convex/finance.ts:100-118`):** `cashSales` = 50,000 (the refund term is 0); `cashIn` = 20,000; `cashOut` = 5,000; `return money((shift.openingFloat ?? 0) + cashSales + cashIn - cashOut)` = **165,000**. **MATCHES.**
  - **Consequence:** `closeShift` (`:303-316`) records `variance = money(countedCash − expected)` = `countedCash − 165,000`. If the cashier counts 160,000, the variance is **−5,000** and is persisted on the shift row and in the audit trail (`:328-341`). The drawer variance for the period is the **sum of the shifts' own variances** (`convex/finance.ts:793-800` per the prior audit), which is the correct construction.
  - **Boundary note:** the shift window is `[shift.openedAt, shift.closedAt]` (`convex/finance.ts:80-81`), both full ISO instants, so a sale is attributed to the shift correctly; but the same UTC-vs-local-timezone issue as FIN-06 applies to *which* day a shift falls on.
- **Steps to reproduce:** Static inspection: `convex/finance.ts:75-119`, `convex/finance.ts:303-316`.
- **Expected behavior:** Expected drawer cash recomputed from the shift's own records; variance recorded rather than absorbed.
- **Actual behavior:** As specified. The cash-shift discipline is the strongest part of the finance module.
- **Root cause:** n/a — this path is correct.
- **Recommended fix:** None for the arithmetic. Consider threading the business timezone into the day-level views that sit above it (FIN-06).
- **Test required to verify the fix:** Existing coverage is indirect; add a test asserting `closeShift` returns `variance === -5000` for the fixture above.

### FIN-20 — No mock, placeholder or hardcoded financial figure was found in the report stack

- **Module:** `convex/reports.ts`, `convex/analytics.ts`, `convex/dashboard.ts`, `convex/finance.ts`, `src/app/(dashboard)/reports/components/*`
- **Severity:** INFORMATIONAL (priority check — result)
- **Description:** A repository-wide search of `convex/` and `src/` for `mock`, `placeholder`, `dummy`, `demo`, `fakeData`, `hardcod`, `Math.random` and literal numeric financial values returned **no** hardcoded totals, no sample datasets and no generated placeholder figures in the reporting path. The only `Math.random` in `src/` is `src/components/ui/sidebar.tsx:611`, a UI layout width. The only `placeholder` hits in `convex/` are integration-template field placeholders (`convex/integrations/registry.ts:84` etc.), which are configuration defaults, not financial data. `convex/analytics.ts:22-32` asserts in its own header that "There are no sample figures and no hardcoded totals anywhere in this module" — **verified true**.
- **Steps to reproduce:** Static inspection: grep across `convex/` and `src/` for the patterns above; grep for `^const X = [` / `useState([` literal arrays across `src/app/(dashboard)/reports/components/*.tsx` returned no hits.
- **Expected behavior:** A report of an empty business is zero.
- **Actual behavior:** As expected.
- **Root cause:** n/a.
- **Recommended fix:** None. Keep the current practice — the *correctness* defects in this report are all in live arithmetic, not in placeholder data.
- **Test required to verify the fix:** None.

## 3.2 Counter-drift inventory

Every mutable counter in the reporting path, with its source of truth:

| Counter field | Written by | Source of truth | Can drift? | Used by |
|---|---|---|---|---|
| `loans.balance` | `convex/loans.ts:408` | `loans.amount − Σ payments.amount` | **YES** — decremented independently of the `payments` row insert | `convex/analytics.ts:875`, `convex/reports.ts:751,1716,1747`, `convex/dashboard.ts:318`, `convex/finance.ts:1183` (FIN-12) |
| `payments.balance` | `convex/loans.ts:417`, `convex/salesCore.ts:781` | Snapshot of `loans.balance` | **YES** — a snapshot of a counter | `convex/reports.ts` payments report, audit trail |
| `customers.creditLimit` | client-supplied | n/a (a limit, not a balance) | No | `convex/analytics.ts:910,926-929` |
| `customerWallets.balance` | customer-wallet module | `customerWalletTransactions` | **YES** (not audited in Part 7) | — |
| `suppliers.balance` | `convex/schema.ts:1056` — documented as "written on the same transaction as every ledger entry, never the source of truth" | `supplierLedger` | No (by design) | `convex/analytics.ts` uses the **ledger**, not this field — correct |
| `supplierLedger.balanceAfter` | same transaction | running total | No | statements |
| `sales.total` | `convex/salesCore.ts:695` | `Σ unitPrice × quantity` | **Slight** — stored unrounded (FIN-14) | every revenue figure |
| `sales.refundAmount` | `convex/sales.ts:1151` | `Σ refundedItems.amount` | No | `convex/financeCore.ts:320` |
| `cashShifts.countedCash` / `expectedCash` / `variance` | `convex/finance.ts:307-316` | recomputed at close | No | drawer variance |
| `businesses.openingFloat` | `convex/schema.ts:48` | a configured float | No | — |

**Answer to the decisive question:** the *newer* reporting path (`convex/analytics.ts`, `convex/finance.ts`, `convex/dashboard.ts:getBusinessDashboard`) aggregates from **raw tables** — `sales`, `expenses`, `incomeRecords`, `supplierLedger`, `stockCostHistory` — and computes cost at the time of sale. The *legacy* path (`convex/reports.ts`, `convex/dashboard.ts:getStats`) aggregates from **raw `sales` too**, but re-derives cost from the **current `stocks.purchasePrice`**, which is a de-facto counter of the latest purchase rather than the cost at sale. The genuine stored-counter drift risk is concentrated in the **debt book** (`loans.balance`), which is read by six separate figures.

## 4. NOT IMPLEMENTED

| Item | Evidence | Reason |
|---|---|---|
| Server-side VAT/tax report | `convex/salesCore.ts:689-724` — no tax fields on the `sales` row; no `vatAmount`/`netAmount` anywhere in `convex/` | The VAT split is computed in the browser (`src/app/(dashboard)/sales/page.tsx:739-745`) and never persisted, so it cannot be aggregated or audited server-side (FIN-11) |
| Multi-currency / FX | `convex/schema.ts:31-32` stores `currency`/`currencySymbol`, but no conversion or per-currency reporting exists; the UI hardcodes `UGX` | The product is single-currency per business; only the presentation layer is wrong (FIN-15) |
| Cost-at-sale for the legacy report path | `convex/reports.ts:727`, `:1460` | Not implemented — `financeCore.buildCostIndex` exists but is not used by `reports.ts` (FIN-01, FIN-02) |
| Refund → loan reversal | `convex/sales.ts:1149-1156` | Not implemented — the refund path does not touch the `loans` table (FIN-10) |
| `getDailyProfitLoss` / `getMonthlyProfitLoss` | grep over `src/` — no caller | Implemented but dead code; retained for API compatibility (FIN-04) |

## 5. NOT TESTED

| Item | Reason |
|---|---|
| Runtime execution of any report query | Requires a live Convex deployment; the audit forbids writing to `affable-panda-681.convex.cloud`. All arithmetic was derived by reading code (FIN-16 … FIN-19) |
| Cross-tenant isolation by execution | Read-only proof by index inspection only (`requireTenant` + `eq("businessId", …)` on every report query) — no cross-tenant read was attempted |
| Timezone behaviour in a browser at a non-UTC offset | No browser available in the audit environment; FIN-06 and FIN-07 are derived from the code and the `date-fns` call sites |
| Export fidelity (`src/lib/export.ts`) | Out of scope for Part 7 |
| The `reports.ts` `continueCursor: "none"` pagination defect | Owned by another audit worker; not re-reported here |
| Scale / memory behaviour of `.collect()` (prior M-28) | Confirmed still present by inspection; not benchmarked |

## 6. Counts

**0 CRITICAL, 4 HIGH, 9 MEDIUM, 2 LOW, 5 INFORMATIONAL** — 20 findings (FIN-01 … FIN-20).
