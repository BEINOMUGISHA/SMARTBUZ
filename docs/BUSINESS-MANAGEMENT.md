# SMARTBUZ — Business Management (Phase 4)

This document describes Phase 4: the customer book, the supplier book and
purchasing — how the money is tracked, where the truth lives, and what the
backend refuses.

> **The one rule that matters:** balances are **derived**, never typed in.
> A customer balance is computed from their credit sales and their payments.
> A supplier balance is computed from their ledger. Nothing in this phase
> trusts a number that arrived from the browser.

---

## 1. Where things live

| File | What it holds |
| --- | --- |
| `convex/customers.ts` | Customer profiles, contact details, credit accounts, payments, loyalty, statements. |
| `convex/suppliers.ts` | Supplier registration, contacts, the supplier ledger, payments, statements. |
| `convex/purchasing.ts` | Purchase orders, goods received notes, supplier invoices, purchase returns, purchase payments. |
| `convex/verticals/operations.ts` | The legacy entry points, now delegating to the modules above. |
| `convex/rbac.ts` | The permission catalogue and the grant matrix. |
| `convex/audit.ts` | The audit trail for privileged actions. |
| `tests/business-management.test.ts` | The behaviour of the books, asserted against the real functions. |

The pages that use them:

| Page | Backend |
| --- | --- |
| `src/app/(dashboard)/customers/page.tsx` | `api.customers.*` |
| `src/app/(dashboard)/suppliers/page.tsx` | `api.suppliers.*`, `api.purchasing.*` |
| `src/app/(dashboard)/purchase-orders/page.tsx` | `api.purchasing.*`, `api.suppliers.*` |

---

## 2. Customers

### 2.1 The profile

A customer row holds the name, phone, email, address, the optional customer
ID printed on receipts, the branch they belong to, a credit limit and a
loyalty point balance.

**A phone number identifies a customer in a shop.** Adding a customer whose
phone number already exists in the same business is refused — the two records
are the same person, and the mistake is worth catching now rather than at the
till.

### 2.2 The credit account

The outstanding balance of a customer is:

```
balance = Σ (balance of every credit sale) − (nothing — the loan balance
                                            already has the payments applied)
```

Concretely: a credit sale creates a `loans` row. Taking money creates
`payments` rows and reduces the loan balances they are applied to. The
customer's balance is the sum of the remaining loan balances.

There is **no cached balance field** on the customer. A cached balance can
drift from the transactions behind it, and a business that cannot trust its
receivables figure cannot run a credit book.

The consequence worth knowing: the customer list, the account and the
statement are all computed from the same rows, so they cannot disagree.

### 2.3 Payments are applied oldest-first

When a customer pays, the money is applied to their **oldest open credit
sales first**, and only the remainder spills onto the next one. That is how a
credit book works, and it means the account never shows a stale balance on
the wrong invoice.

A payment of more than the outstanding balance is refused.

### 2.4 Duplicate payments

Every payment may carry a **reference** — the bank or receipt number. Two
payments with the same reference for the same customer are the same money,
and the second is refused:

> `A payment with reference "RCPT-001" has already been recorded for Amina Nakato.`

A payment without a reference cannot be checked this way, so the reference is
strongly recommended at the point of entry. The suppliers side works the same
way.

### 2.5 Statements

`api.customers.getStatement` returns every charge and receipt in date order
with the running balance after each line, plus the opening balance, the
closing balance, the total charged and the total paid. The closing balance
is the account balance — computed from the same rows, not copied from it.

### 2.6 Loyalty points

Points live in their own table (`loyaltyTransactions`), separate from the
money ledger: points are not money, and mixing the two makes the statement
unreadable. `api.customers.getLoyalty` returns the current balance, the
lifetime total and the movement history.

### 2.7 Deleting a customer

A customer with trading history is **deactivated**, not deleted. Their sales,
payments and credit account still have to point at something, and an audit
that cannot resolve a name is not an audit. A customer who has never traded
is deleted outright.

---

## 3. Suppliers

### 3.1 The ledger is the truth

Every movement on a supplier account is one row in `supplierLedger`, in order,
with the running balance after it:

```
amount > 0   the business owes the supplier more   (an invoice)
amount < 0   the business owes the supplier less   (a payment, a return)
```

`suppliers.balance` is a **cache** of that sum, written in the same
transaction as the ledger entry. It exists so the supplier list can sort by
balance cheaply. If it ever disagrees with the ledger, the ledger is right.

### 3.2 Payments

`api.suppliers.paySupplier` records a payment, applies it to the supplier's
open invoices **oldest first** (the same rule a bookkeeper would use),
settles the invoice and posts the ledger entry.

The same duplicate-reference guard applies as for customers.

### 3.3 Statements and balances

`api.suppliers.getStatement` returns the ledger with the running balance.
`api.suppliers.getOutstandingBalances` returns the suppliers you owe, worst
first.

### 3.4 Deleting a supplier

As with customers: a supplier with invoices or purchase orders is deactivated
rather than deleted.

---

## 4. Purchasing

The order of operations:

```
1. Purchase order      — what you intend to buy
2. Goods received note — what actually turned up (possibly in parts)
3. Supplier invoice    — what the supplier says they are owed
4. Payment             — what you paid (see suppliers.ts)
5. Purchase return     — what you sent back
```

### 4.1 Purchase orders

A purchase order is created in `draft` and moves `draft → ordered → (partially
received) → received`. The transitions are checked: a draft order cannot jump
straight to `received`, because the goods have not arrived yet. Only a draft
order can be edited — once it is placed, change it by cancelling it and
raising a new one.

PO numbers are sequential per business (`PO-0001`, `PO-0002`, …) and are
allocated from a counter, so two businesses can both issue "PO-0001" and two
orders raised in the same second still get different numbers.

### 4.2 Partial goods receipt

Goods arrive in parts, and the order stays open until every line is complete.

Each purchase order line carries its own `receivedQty`. A receipt names the
line it settles (`poItemIndex`) and how many units arrived:

- Receiving **more** than was ordered is refused.
- Receiving less than was ordered is normal: the line's `receivedQty` rises
  and the order becomes `partially_received`.
- The order becomes `received` only when **every** line is complete.

Pretending a half-delivered order is finished is how a business ends up
ordering the same goods twice.

### 4.3 Stock updates

Receiving goods:

- increases `stocks.qty` by what arrived,
- writes a `stockLedger` row, so every movement of stock can be explained,
- writes a `stockEntries` row (the record the books are built from),
- sets `stocks.purchasePrice` to the cost of this purchase — the current cost.

Receiving goods requires **both** `purchasing.manage` and
`inventory.adjust`, because it moves stock.

### 4.4 Historical purchase costs

`stocks.purchasePrice` always holds the *latest* cost — that is what a price
field is for. But a margin worked out from today's price would be wrong for a
sale made months ago, so every receipt also writes a `stockCostHistory` row:

| What it keeps | Why |
| --- | --- |
| `unitCost` | What the goods cost that time. |
| `quantity` | How many were bought at that price. |
| `totalCost` | The whole purchase's cost. |
| `supplierId`, `supplierName` | Who was bought from. |
| `purchaseOrderId` | Which order it came from. |
| `date` | When — the price changed later, this row did not. |

`api.purchasing.getCostHistory` reads it back.

### 4.5 Supplier invoices

Recording an invoice puts the business on the hook, so it is written to the
supplier ledger in the same transaction.

**The same invoice number from the same supplier is refused.** It is the same
document, and recording it twice would double what the business owes. The due
date is worked out from the supplier's payment terms when one is not given.

### 4.6 Purchase returns

Returning goods:

- takes the stock back out (and refuses if it is not in stock),
- credits the supplier's ledger,
- records `returnedQty` on the order and the invoice lines, so the same goods
  cannot be returned twice.

### 4.7 Branches and warehouses

Purchase orders, goods receipts, invoices and returns all carry an optional
`branchId` and `warehouseId`. A goods receipt lands in the branch and
warehouse of its order unless told otherwise. A branch manager is confined to
the branches they manage — enforced on the server by `requireBranchAccess`,
not by the interface.

---

## 5. Permissions

Phase 4 added seven canonical permissions to `convex/rbac.ts`:

| Permission | What it allows |
| --- | --- |
| `customers.view` | Read the customer book, accounts and statements. |
| `customers.manage` | Add and edit customers, set credit limits, take payments. |
| `customers.credit.manage` | Move money on the credit book and change credit limits. |
| `suppliers.view` | Read the supplier book and statements. |
| `suppliers.manage` | Register and edit suppliers, record invoices. |
| `purchasing.view` | Read purchase orders, receipts, invoices and returns. |
| `purchasing.manage` | Raise and edit purchase orders, record invoices, receive goods. |
| `purchasing.pay` | Pay suppliers. |
| `purchasing.return` | Return goods to a supplier. |

`customers.view` was promoted from a legacy name to a canonical one, and is
deliberately **not** granted to `inventory_manager`: inventory staff do not
need the customer book.

The full matrix is in `convex/rbac.ts`, and `tests/permissions.test.ts`
asserts it exactly — a role gaining or losing a permission fails the build.

---

## 6. Audit trail

Privileged actions are written to `auditLogs` through `writeAudit`:

| Action | When |
| --- | --- |
| `customers.create` / `customers.update` | The customer book changes. |
| `customers.deactivate` / `customers.delete` | A customer is retired or removed. |
| `customers.credit_limit.set` | A credit limit changes. |
| `customers.payment` | Money is taken on a credit account. |
| `customers.loyalty.adjust` | Loyalty points are changed by hand. |
| `suppliers.create` / `suppliers.update` | The supplier book changes. |
| `suppliers.deactivate` / `suppliers.delete` | A supplier is retired or removed. |
| `suppliers.payment` | A supplier is paid. |
| `suppliers.adjustment` | A balance is corrected by hand. |
| `purchasing.order.create` / `purchasing.order.update` / `purchasing.order.status` | An order is raised, edited or moves. |
| `purchasing.goods_received` | Goods are received. |
| `purchasing.invoice.record` | A supplier invoice is recorded. |
| `purchasing.return.create` | Goods are returned. |

Ordinary events go to `activityLogs` through `logActivity` — the difference
is that an audit row answers "who did this to which record, and when", while
an activity row answers "what happened".

---

## 7. The legacy API

`convex/verticals/operations.ts` keeps its original exports — same names,
same argument shapes, same array return shapes — but each one now delegates
to the module above. The old supplier and purchase-order functions were
permission-checked only in the interface before; they now enforce the same
rules as everything else, and existing callers keep working.

---

## 8. Tests

```
node scripts/run-tests.mjs
```

`tests/business-management.test.ts` covers, against the real functions:

- the balance is derived from the credit sales, and a settled sale is ignored;
- the statement and the account give the same balance;
- a payment is applied to the oldest credit sale first;
- a duplicate reference is refused, on both sides of the book;
- an overpayment is refused;
- a duplicate invoice number is refused;
- a duplicate phone number is refused;
- a customer with history is deactivated rather than deleted;
- goods received in parts increase stock by what arrived, and only what
  arrived;
- an order closes only when every line is complete;
- over-receiving is refused, and leaves the stock untouched;
- the purchase cost survives a later price change;
- a return takes the goods out of stock and credits the supplier;
- one business never sees another's customers, suppliers or orders;
- a branch manager stays inside their branch;
- the audit trail records payments and receipts.
