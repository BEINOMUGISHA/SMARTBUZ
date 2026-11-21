# 06 — Customers, Suppliers, Credit and Purchasing

**Commit audited:** `acafd2b`
**Scope:** `convex/customers.ts`, `convex/suppliers.ts`, `convex/purchasing.ts`,
`convex/loans.ts`, `convex/verticals/members.ts`, `src/app/(dashboard)/customers/page.tsx`,
`src/app/(dashboard)/suppliers/page.tsx`, `src/app/(dashboard)/purchase-orders/page.tsx`.

---

## 1. Customers

| Function | Kind | Line |
|---|---|---|
| `list` / `listAll` / `getPaginated` | query | 174 / 239 / 255 |
| `getById` | query | 307 |
| `getAccount` | query | 338 |
| `getStatement` | query | 380 |
| `getPurchaseHistory` | query | 466 |
| `getLoyalty` | query | 521 |
| `getOutstandingBalances` | query | 554 |
| `add` / `update` / `remove` | mutation | 607 / 691 / 771 |
| `setCreditLimit` | mutation | 854 |
| `recordPayment` | mutation | 917 |
| `adjustLoyalty` | mutation | 1029 |

### 1.1 The credit book

The model is a `loans` table (one row per credit sale) and a `payments` table (one row per
payment received). A customer's outstanding balance is the sum of the open loan balances
(`convex/customers.ts:106-120`).

`recordPayment` is the best-written financial function in the codebase:

| Rule | Evidence |
|---|---|
| Tenant and permission (`customers.credit.manage`) | `:928-929` |
| The credit feature must be entitled | `:930` |
| The amount must be greater than zero | `:932-934` |
| The customer must belong to the business | `:936` (`loadCustomer`) |
| Branch restrictions apply | `:937` |
| **A duplicate payment reference is refused** | `:941-951` |
| **A payment larger than the outstanding balance is refused** | `:957-961` |
| The money is applied to the **oldest** open credit sale first | `:966-973` |

The duplicate-reference guard is the important one: a mobile-money reference identifies the
money, so recording the same reference twice means recording the same money twice. It is
refused.

### 1.2 Credit limits are advisory, not enforced — M-23 (Medium)

A credit limit is stored, reported and checked for negativity
(`convex/customers.ts:866`), and the customer views report `availableCredit` and `overLimit`
(`:327`, `:366`, `:596`). But **nothing refuses a sale** that pushes the customer over their
limit. `convex/salesCore.ts` never reads `creditLimit`.

The effect: the limit is a number on a screen. A cashier who sells on credit beyond the limit
is not stopped, and the over-limit state is only visible afterwards.

**Recommendation:** in `applySale`, when the sale is a credit sale, compare the resulting
balance against the customer's limit and either refuse or record an explicit override with a
reason and a permission of its own.

### 1.3 Loyalty

`adjustLoyalty` (`:1029`) and `getLoyalty` (`:521`) are gated behind the `loyalty.points`
entitlement (`:529`, `:1041`), so the feature is genuinely tied to the plan.

---

## 2. Suppliers

| Function | Kind | Line |
|---|---|---|
| `list` / `listAll` / `getById` | query | 148 / 222 / 272 |
| `getPurchaseHistory` | query | 312 |
| `getStatement` | query | 365 |
| `listPayments` | query | 444 |
| `getOutstandingBalances` | query | 486 |
| `upsert` / `remove` | mutation | 621 / 647 |
| `paySupplier` | mutation | 724 |
| `adjustBalance` | mutation | 883 |

The supplier side mirrors the customer side: a `supplierLedger` of what the business owes, and
`paySupplier` settles it. `paySupplier` is where the money leaves the business, so it is worth
checking what protects it.

---

## 3. Purchasing

| Function | Line |
|---|---|
| `listPurchaseOrders` / `getPurchaseOrder` | 254 / 270 |
| `createPurchaseOrder` / `updatePurchaseOrder` / `updatePurchaseOrderStatus` | 411 / 512 / 500 |
| `receiveGoods` | 851 |
| `recordInvoice` | 934 |
| `listGoodsReceipts` | 909 |
| `createPurchaseReturn` | 1167 |
| `listPurchaseReturns` | 1383 |
| `getCostHistory` | 1422 |

`receiveGoods` is the function that turns a purchase order into stock. It is the one that
matters most for the cost of goods, and it is the one that **does** update `purchasePrice`
(`convex/purchasing.ts:726`, `751`) and **does** write to `stockLedger`
(`convex/purchasing.ts:732`, `1262`).

**This confirms M-20 from report 05:** the purchasing path maintains the cost of goods
correctly; the inventory screen's "restock" path does not. The defect is in the shortcut, not
in the proper flow.

---

## 4. Findings

### 4.1 Member numbers are unique across the whole platform — M-24 (Medium)

`convex/verticals/members.ts:75-79`:

```ts
const dupe = await ctx.db
    .query("members")
    .withIndex("by_memberNumber", (q) => q.eq("memberNumber", memberNumber!))
    .first();
if (dupe) throw new Error(`Member number ${memberNumber} is already in use`);
```

The index is not business-scoped, so business A cannot use `M-00001` if business B already
has it. Two consequences:

1. A real functional collision — every business's first member is `M-00001`.
2. A small information leak — the error message confirms that a member number exists somewhere
   in the platform.

**Recommendation:** make the index `by_businessId_memberNumber` and check within the business.

### 4.2 Member number generation reads the whole table — M-25 (Medium)

`convex/verticals/members.ts:67-72` collects every `members` row across every tenant and
filters in memory to find the highest number. It is the same pattern as report 14's
whole-table reads, and it is on a write path.

### 4.3 `adjustBalance` — review

`convex/suppliers.ts:883` adjusts a supplier balance directly. It is tenant-guarded and
permission-guarded, but a direct balance adjustment with no supporting document is the kind of
entry that makes a ledger hard to audit. The activity log records it, which is the minimum.

**M-26 (Low).** There is no reason field on a supplier balance adjustment. The customer's
`recordPayment` has a reference and a note; the supplier's equivalent should too.

---

## 5. Credit in the vertical modules

The `members` vertical (`convex/verticals/members.ts`) provides the SACCO, school, gym, NGO and
retail-wallet variants: share accounts, savings, a member ledger, donations, stylist commissions.

`walletTransactions` (`:300`), `staffCommissions` (`:350`) and `donations` (`:451`) are read
with the whole-table pattern flagged in report 14.

**M-27 (Medium).** `convex/verticals/members.ts` has 7 whole-table reads. It is the second
worst file in the repository.

---

## 6. What is strong here

1. **The credit book is modelled properly** — loans and payments, not a mutable balance field.
2. **Payments are applied oldest-first**, which is what a credit book expects.
3. **Duplicate payment references are refused** — the double-counting guard.
4. **Overpayment is refused** — you cannot pay more than is owed.
5. **The entitlement gate** — credit and loyalty are tied to the plan.
6. **Purchasing updates the cost of goods and writes the ledger.**
7. **Customer and supplier histories are real statements**, not a count.

---

## 7. Summary

| Area | Assessment |
|---|---|
| Customer credit book | **Good** |
| Payment recording and allocation | **Good** — duplicate and overpayment guards |
| Supplier ledger | **Good** |
| Purchasing and goods receipt | **Good** — updates cost and ledger |
| Loyalty | **Good**, entitlement-gated |
| Credit limit enforcement at the point of sale | **Advisory only (M-23)** |
| Member number uniqueness | **Global instead of per-business (M-24)** |
| Member number generation | **Whole-table read on a write path (M-25)** |
| Supplier adjustment reason | **Missing (M-26)** |
