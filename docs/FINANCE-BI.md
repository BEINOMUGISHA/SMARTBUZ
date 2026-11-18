# SMARTBUZ — Finance and Business Intelligence (Phase 5)

This document describes Phase 5: the finance module and the reporting suite.

> **The rule that matters:** every figure is derived from the transaction
> and ledger records. There are no sample numbers in the production code,
> and nothing the browser sends is trusted as money.

---

## 1. Where things live

| File | What it holds |
| --- | --- |
| `convex/financeCore.ts` | The calculation core — the one place the profit and loss is worked out. |
| `convex/finance.ts` | Cash shifts, the cash drawer, cash in and out, other income, reconciliation, the financial summary. |
| `convex/analytics.ts` | The reporting suite — sales over time, profit, products, valuation, by cashier and branch, payment methods, the debt reports. |
| `convex/dashboard.ts` | `getBusinessDashboard` — today's position. |
| `src/lib/export.ts` | CSV, Excel and PDF export. |
| `src/components/finance/` | The export menu and the shared filter bar. |
| `src/app/(dashboard)/finance/page.tsx` | The finance hub. |
| `src/app/(dashboard)/reports/analysis/page.tsx` | Business Intelligence — the reporting suite. |
| `tests/finance.test.ts` | The calculations, checked against known transaction scenarios. |

---

## 2. How the profit is worked out

```
revenue            = every sale, less refunds
cost of goods sold = what the goods cost at the time they were sold
gross profit       = revenue − cost of goods sold
other income       = income that is not a sale
net profit         = gross profit + other income − running costs
```

Everything is computed in `convex/financeCore.ts` and used by the finance
page, the reports and the dashboard alike — so the three cannot tell three
different stories about the same day.

### 2.1 The cost of goods sold

A product's cost changes over time. The cost of a sale has to be the cost
**at the time of that sale**, or last month's profit changes every time the
owner buys stock. The cost is resolved in this order:

1. **`stockCostHistory`** — what the goods actually cost when they were
   bought. The most authoritative record there is, and it is what Phase 4
   put in place for exactly this reason.
2. **The base value recorded on the sale line** (`bv`).
3. **The product's current purchase price.**

Only if all three are missing is the cost taken as zero — which shows up as
a gross profit that is too high, so it is documented rather than hidden.

A refund brings the revenue back down and the cost of the returned goods
back with it.

> **A note on the older reports.** The legacy `reports.ts` profit-margin
> report costs a sale at the product's **current** purchase price, so its
> figures move whenever stock is bought. The Phase 5 reports use the cost at
> the time of the sale. The two will disagree after a restock; the Phase 5
> figures are the correct ones.

### 2.2 Cash is not an expense

Paying a bill out of the till is money moving between the business's own
pockets, not the cost of running the business. Counting it as an expense
would make a profitable business look like it is losing money.

So there are three separate ledgers, and they never mix:

| Ledger | What it is |
| --- | --- |
| `expenses` | The running costs of the business. These reduce the profit. |
| `cashMovements` | Money into and out of the till. These do **not** affect the profit. |
| `incomeRecords` | Money that came in without goods leaving the shelf. This adds to the profit. |

### 2.3 Expenses and branches

An expense may be recorded against a branch. An expense with **no** branch
is a business-wide expense: it is counted in the business figures and left
out of a single branch's figures, because it cannot honestly be said to
belong to one branch.

---

## 3. The cash drawer

A drawer holds an opening float, the cash taken during the period, and the
money put in or taken out. What it *should* hold is computed from those
records — it is never typed in.

```
expected cash = opening float + cash sales + paid in − paid out
variance      = counted cash − expected cash
```

Only cash sales count. A sale paid by mobile money never went near the
drawer, and counting it would make the variance meaningless.

### 3.1 Shifts

A shift is one till session: it opens with a float and closes with the cash
counted.

- Only **one** shift may be open per person — two open drawers cannot both
  be counted.
- A cashier closes their own shift; somebody with `finance.cash.manage` can
  close anybody's.
- The variance is recorded, so a shortfall of 5,000 is a fact somebody can
  act on, rather than "the drawer felt light".

### 3.2 Cash in and cash out

A movement carries a **reference** — the receipt or slip number. Two
movements with the same reference are the same money, and the second is
refused, so a pay-out cannot be entered twice.

---

## 4. Other income

Income that is not a sale: rent from a third party, a service fee, a grant.
It is kept in its own table so that **revenue stays the revenue** and the
gross profit is not quietly flattered.

---

## 5. Reconciliation

A reconciliation compares what a payment provider says was received against
what the books recorded.

```
variance = statement amount − recorded amount
```

When the recorded amount is not given, it is worked out from the books: the
sales paid that way in the period, plus the repayments of credit taken that
way.

A variance of zero is `reconciled`; anything else is a `discrepancy` and is
on the record. The 50,000 difference between a provider's statement and the
books is the thing worth knowing about — a fee, a missing deposit, or a sale
entered twice.

---

## 6. The reports

| Report | What it answers |
| --- | --- |
| Daily / weekly / monthly sales | What we sold, and what it made. Weeks start on Monday. |
| Gross profit and net profit | What the business actually made. |
| Running costs | What the business spent. |
| Best sellers | What to buy more of. |
| Slow-moving stock | What is sitting there — ranked by the **money** in it, not by how little it sold. |
| Stock valuation | What the shelf is worth at cost, and what it would fetch at the till. |
| Sales by cashier | Who sold what. |
| Sales by branch | Which branch is trading. |
| Payment method analysis | How the money came in — and the risk that carries. |
| Customer debt | Who owes the business, and for how long (0-30, 31-60, 61-90, 90+ days). |
| Supplier debt | What the business owes its suppliers. |

Every report takes the same filters — a date range and an optional branch —
so they can be compared with each other.

A day with no trading appears as a **zero**, not as a gap: a missing day
and a day with no sales look the same otherwise.

---

## 7. Exports

Every report can be taken away as:

- **CSV** — for a spreadsheet or another system. Written with a byte order
  mark so Excel opens it with the right encoding.
- **Excel** — a real `.xlsx` workbook: bold headings, sized columns, and
  the numbers left as **numbers** so the spreadsheet can do the arithmetic.
- **PDF** — a document to print and file, landscape when there are many
  columns.

All three carry exactly the rows that are on screen, so the file and the
screen cannot disagree. The export button only appears for somebody who
holds `finance.reports.export` — a report that leaves the system is data
leaving the system.

---

## 8. The dashboard

`api.dashboard.getBusinessDashboard` gives:

- today's sales, transaction count, average ticket, gross profit, running
  costs and net profit;
- the last fortnight of revenue and gross profit, for the chart;
- the best sellers today;
- what is running out;
- what customers owe and what the business owes its suppliers;
- the most recent transactions.

**Today** is today in the **business's own time zone**, not in UTC. A
business in Kampala does not close its books at midnight UTC.

The figures come from the same calculation core as the profit and loss
report, so the dashboard and the report cannot disagree.

> A note on an existing bug this phase fixed: the dashboard used to call
> `getStats` unconditionally, which needs `finance.reports.view`. A cashier
> opening the dashboard was met with a Forbidden error. The query is now
> skipped when the caller may not read it, and such a caller sees the
> "Today" panel instead.

---

## 9. Permissions

Phase 5 added six canonical permissions (31 in total):

| Permission | What it allows |
| --- | --- |
| `finance.dashboard.view` | Read the daily position. |
| `finance.cash.shift.manage` | Open and close a till shift, count the drawer. |
| `finance.cash.manage` | Record money into and out of the till. |
| `finance.income.create` | Record income that is not a sale. |
| `finance.reconcile.manage` | Reconcile provider statements against the books. |
| `finance.reports.export` | Export reports to CSV, Excel and PDF. |

Who holds them:

| Role | New permissions |
| --- | --- |
| Owner, admin | All (with the platform-only ones). |
| Accountant | All six. |
| Auditor | `dashboard.view`, `reports.export` — read-only, never a write. |
| Branch manager, supervisor | `dashboard.view`, `cash.shift.manage`, `cash.manage`. |
| Cashier | `dashboard.view`, `cash.shift.manage`. |
| Platform support | `dashboard.view`. |
| Inventory manager, salesperson | None — neither needs the books. |

The auditor's guarantee is "read only", not "ends in `.view`": an auditor
may export a report, because that produces a file on their own machine and
changes nothing in the business, but must never hold a permission that
writes, edits or moves anything. `tests/permissions.test.ts` asserts that
against an explicit list of mutating verbs.

---

## 10. Tests

```
node scripts/run-tests.mjs
```

`tests/finance.test.ts` checks the calculations against **known scenarios**
— the numbers worked out by hand and written down first, so a change in the
calculation fails against a figure the business agreed on:

- a day with 20,000 cash, 20,000 mobile money and 4,000 on credit gives
  revenue 44,000, cost 33,000, gross profit 11,000 (a 25% margin) and,
  with 7,000 of running costs and 3,000 of other income, a net profit of
  7,000;
- the profit and loss report and the financial summary agree;
- a product bought at 1,200 and sold with a base value of 1,500 costs
  1,200;
- a later purchase does not change what an earlier sale cost;
- the base value is used when there is no purchase history, and the
  purchase price when there is neither;
- a refund takes the revenue and the cost back down together;
- daily, weekly (starting Monday) and monthly bucketing;
- the best sellers and the stock that is stuck;
- the stock valued at 300,000 at cost and 400,000 at the till;
- the drawer holding 33,000 after a float, takings, money in and money out;
- a shift closed 1,000 short, recorded as a variance;
- a mobile money sale never counted as cash;
- the same cash movement refused twice;
- a statement that does not match the books, recorded as a discrepancy;
- customer debt by age, and supplier debt;
- a branch filter that keeps one branch's sales and costs apart;
- the permissions: a salesperson cannot move the till, a branch manager
  cannot reconcile, a supervisor cannot record income, a cashier cannot
  read the financial summary.
