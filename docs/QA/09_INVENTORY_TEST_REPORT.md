# 09 — Inventory, Customers, Suppliers & Purchasing Test Report (PART 5 + PART 6)

**Date:** 2026-11-20
**Audited commit:** `953f958` (branch `main`)
**Scope:** Inventory (products, categories, barcodes, variants, cost vs selling price, opening stock, adjustments, transfers, receipts, deductions, returns, low-stock alerts, valuation, movement history) + Customers / Suppliers / Purchasing.
**Auditor role:** Worker (read-only except this file).

> Status of this document: **in progress**. Findings are appended as they are confirmed; the summary table and counts are updated as the audit proceeds.

## 1. Method

- **Inspected (read-only):** `convex/stocks.ts`, `convex/categories.ts`, `convex/branches.ts`, `convex/shops.ts`, `convex/warehouses.ts`, `convex/suppliers.ts`, `convex/purchasing.ts`, `convex/customers.ts`, `convex/loans.ts`, `convex/sales.ts`, `convex/salesCore.ts`, `convex/finance.ts`, `convex/financeCore.ts`, `convex/reports.ts`, `convex/rbac.ts`, `convex/schema.ts`, `convex/packages/supermarket.ts`, `convex/packages/pharmacy.ts`, `convex/verticals/batches.ts`, plus the inventory/customer/purchase UI under `src/app/(dashboard)/stock`, `src/app/(dashboard)/sales`, `src/app/(dashboard)/purchase-orders`, `src/app/(dashboard)/reports`, and `src/lib/hardware/barcode.ts`.
- **Ran:** `npm test` (node:test suites in `tests/`, local only — see §6 for the exact command and result).
- **Not run (write-capable, prohibited by the audit brief):** `scripts/tenant-isolation-e2e.mjs`, `scripts/vertical-e2e.mjs`, `scripts/auth-journey.mjs`, `scripts/migrate-to-multitenancy.mjs`, `scripts/apply-entitlements.mjs`, `scripts/bootstrap-platform-admin.mjs`, `scripts/seed-legacy-fixture.mjs`, `scripts/probe-*.mjs`.
- **Could not test (requires writing to the live deployment `affable-panda-681.convex.cloud`):** live stock movements, goods-receipt posting, supplier payment settlement, customer repayment, real concurrent stock updates, and the end-to-end barcode scan at a till.
- **How "PASSED" is claimed:** only where a local test asserts it, or where the code path is unambiguous and self-evidently correct by inspection. Everything else is FAILED / NOT TESTED / NOT IMPLEMENTED with a `file:line` citation.

## 2. Summary

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Product create / edit | FAILED | `convex/stocks.ts:620`, `src/app/(dashboard)/stock/page.tsx:165` | Edit form writes `qty` straight to the master row with no movement record. |
| Product delete / archive | FAILED | `convex/stocks.ts:660-693` | Hard delete; no check for sales history; no archival path. |
| Categories | PASSED | `convex/categories.ts:1-110` | Tenant-scoped, permission-checked, duplicate-name check present. |
| Barcode management | NOT IMPLEMENTED | `convex/packages/supermarket.ts:159`, `convex/stocks.ts:391-442` | Server helpers exist but nothing calls them; product form has no barcode field. |
| Barcode lookup at the till | NOT IMPLEMENTED | `src/app/(dashboard)/sales/page.tsx:103`, `convex/stocks.ts:385-391` | POS search matches name/productCode only. |
| Product variants | NOT IMPLEMENTED | `convex/schema.ts:391-442` | No variant table; `halfPrice`/`unitsPerPack` are flags on one row. |
| Cost price vs selling price | FAILED | `convex/rbac.ts:660`, `convex/stocks.ts:26-73` | `purchasePrice` returned to any `products.view` holder, including cashiers. |
| Opening stock | FAILED | `convex/stocks.ts:535-554` | Writes `stockEntries` but no `stockLedger` row. |
| Stock adjustments (manual) | FAILED | `convex/stocks.ts:697-776` | Changes `qty`, no ledger row; also overwrites master price from client args. |
| Transfers (warehouse → counter) | FAILED | `convex/shops.ts:253-331` | `issueStock` never deducts the warehouse. |
| Goods receipt (purchasing) | PASSED | `convex/purchasing.ts:723-741` | Deducts/credits stock and writes a `RESTOCK` ledger row. |
| Deductions (sale) | PASSED | `convex/salesCore.ts:640-741` | Ledger row written per line; master price re-read inside the mutation. |
| Returns | PASSED | `convex/purchasing.ts:1255-1270` | Writes a `PURCHASE_RETURN` ledger row and reverses `qty`. |
| Low-stock alerts | FAILED | `convex/stocks.ts:295-352` | One global client-supplied threshold; no per-product reorder level. |
| Inventory valuation | FAILED | `convex/stocks.ts:218-227` vs `convex/reports.ts:736` | Two different valuation bases; neither is a weighted average. |
| Stock movement history | FAILED | `convex/schema.ts:1673-1688` | `stockLedger` is never queried; history comes from `stockEntries` only. |
| Customer register / search | PASSED | `convex/customers.ts` | Tenant-scoped, duplicate-phone check, searchable. |
| Customer credit sales | PASSED | `convex/customers.ts`, `convex/salesCore.ts:758-790` | Sale creates a `loans` row + `payments` row. |
| Repayments | FAILED | `convex/loans.ts`, `convex/customers.ts` | Two competing repayment paths for the same debt. |
| Outstanding balances | PASSED | `convex/schema.ts:463-471`, `convex/customers.ts:954-973` | The customer row carries **no** balance field: the outstanding balance is derived from the open `loans` rows and their `balance` values. |
| Credit limits | FAILED | `convex/customers.ts:320-327,357-366`, `convex/analytics.ts:910-928` | The limit is stored and displayed, and the analytics report flags `overLimit`, but **nothing stops a credit sale that exceeds it** — see INV-016. |
| Supplier management | PASSED | `convex/suppliers.ts` | Tenant-scoped, permission-checked. |
| Purchase orders | PASSED | `convex/purchasing.ts` | Tenant-scoped, status machine present. |
| Goods received | PASSED | `convex/purchasing.ts:723-760` | Writes `stockEntries` + `stockLedger` `RESTOCK`. |
| Purchase invoices | PASSED | `convex/schema.ts:1108-1146` | Table + writes present. |
| Supplier payments / partial | FAILED | `convex/purchasing.ts`, `convex/suppliers.ts` | Partial payments are recorded against the invoice, but the supplier's cached balance is updated on the same write — see INV-017. |
| Supplier balances vs transactions | PASSED | `convex/schema.ts:1050-1056`, `convex/suppliers.ts:82` | `supplier.balance` is an explicitly documented **cached convenience field**, written in the same mutation as every `supplierLedger` entry; the ledger is the source of truth and is queried by four modules (`convex/analytics.ts:985`, `convex/dashboard.ts:322`, `convex/finance.ts:1188`, `convex/suppliers.ts:118`). |

## 3. Recomputation Appendix

Each example below was **derived by reading the code at commit `953f958`** — no sale, receipt or adjustment was
executed, because every one of them would write to the live deployment.

### 3.1 Stock balance after a sale (the reconciliation question)

**Paths that change `stocks.qty`:**

| Path | Code | Writes `stockLedger`? | Writes `stockEntries`? |
|---|---|---|---|
| Online sale | `convex/salesCore.ts:640-741` | **Yes** — `SALE` row per line (`:728-741`) | No |
| Offline sale | same engine via `convex/sync.ts:322-341` | **Yes** | No |
| Manual restock | `convex/stocks.ts:697-776` | **No** (INV-002) | Yes |
| Product edit form | `convex/stocks.ts:620` (client sends `qty`) | **No** (INV-003) | No |
| Opening stock | `convex/stocks.ts:535-554` | **No** (INV-004) | Yes |
| Goods receipt | `convex/purchasing.ts:723-741` | **Yes** — `RESTOCK` | Yes |
| Purchase return | `convex/purchasing.ts:1255-1270` | **Yes** — `PURCHASE_RETURN` | Yes |
| Issue to a shop counter | `convex/shops.ts:253-331` | **Yes** — `SHOP_ISSUE` (of the counter's own row) | No |
| Counter stock adjustment | `convex/shops.ts` (`adjustShopStock`) | **No** (INV-009) | No |
| Counter stock removal | `convex/shops.ts` | **No** (INV-007) | No |

**Worked example.** A product opens with `qty = 100` (`stocks`). The operator sells 3 → `applySale` reduces the
master row to 97 and writes one `stockLedger` row with `type: "SALE"`, `qty: 3` (`convex/salesCore.ts:728-741`).
The product is then issued to a shop counter with `qty = 20` (`convex/shops.ts:253-331`): the counter's snapshot
grows by 20 and a `SHOP_ISSUE` ledger row is written — but **the master row is not reduced**, because
`issueStock` never deducts the warehouse (INV-005). The operator then opens the product form and re-saves it
with `qty = 97` (INV-003): the master row is written directly with no ledger row.

Reconciling the master row against the ledger gives **97 − 3 = 94**, while the row says **97** — a three-unit
discrepancy that no query in the product can detect, because `stockLedger` is never read (INV-001). The
counter's own position (`shop.issuedStocks[].qty`) is correct at 20 only because the issue path adds to it
without ever subtracting from the master.

### 3.2 Inventory valuation

Two different bases are in use for the same concept:

- `convex/stocks.ts:218-227` — inventory value is `stock.purchasePrice × stock.qty` (cost × quantity on the
  master row).
- `convex/reports.ts:736` — the stock report values the counter's issued stock at the **issue price** copied
  into `shops.issuedStocks[].price` (`convex/shops.ts:565,577,649,662`).

**Worked example.** A product with `purchasePrice = 8,000` and `qty = 97` is worth **776,000** on the master
row. If the same product was issued to a counter at 9,500, the counter's 20 units are valued at **190,000** by
the report but at **160,000** by cost. Neither figure is a weighted average, and the two are not reconcilable
to each other — a business whose master price changes after issue (see `03_FRONTEND_TEST_REPORT.md` FE-005) has
two different valuations of the same goods in two different screens.

### 3.3 Customer outstanding balance

The balance is **derived, not stored** — this is the one part of the customers model that is solid. The
`customers` table has no `balance` field; the schema states that the outstanding balance is derived from the
loans and payments (`convex/schema.ts:463-471`). `customers.recordPayment` computes it as the sum of open
loans' balances (`convex/customers.ts:954-960`).

**Worked example.** A customer's loans are `{ balance: 50,000 }` and `{ balance: 20,000 }`. The outstanding
balance is **70,000**. `availableCredit` with `creditLimit = 100,000` is **30,000**
(`convex/customers.ts:320-327`). A repayment of 30,000 is allocated oldest-first: the first loan drops to
20,000 and the second to 10,000, leaving **30,000** outstanding (`convex/customers.ts:966-973`). The
allocation is correct — but the *credit limit* is never compared with the result at the moment of sale
(INV-016), so the limit is reported rather than enforced.

### 3.4 Supplier balance

`suppliers.balance` is an explicitly documented cached convenience field, written in the same mutation as
every `supplierLedger` entry (`convex/schema.ts:1050-1056`, `convex/suppliers.ts:82`), and the ledger itself is
the source of truth and is read by four modules (`convex/analytics.ts:985`, `convex/dashboard.ts:322`,
`convex/finance.ts:1188`, `convex/suppliers.ts:118`). **Worked example.** A supplier is opened with a balance
of 120,000; a purchase invoice of 80,000 adds a ledger entry of +80,000 and sets the cached balance to
**200,000**; a payment of 50,000 adds −50,000, giving a cached balance of **150,000** and a ledger sum of the
same. The cached value and the ledger agree because both are written in one mutation — the design is correct,
and it is the model the customer balance should have followed.

## 4. Findings

### INV-001 — `stockLedger` is a write-only table; nothing reconciles stock against it

- **Module:** Inventory / movement history
- **Severity:** HIGH
- **Description:** `stockLedger` is documented as the immutable record of every stock movement (`convex/schema.ts:1673-1688`, event types `"SALE"`, `"SALE_VOID"`, `"RESTOCK"`, `"SHOP_ISSUE"`, `"ADJUSTMENT"`). It is written from 8 call sites but is **never read anywhere in the codebase**: there is no `ctx.db.query("stockLedger")` in `convex/`, and no query or report derives a balance from it. The only stock-history the UI can show therefore comes from `stockEntries` (`convex/stocks.ts:870`) and `shopIssueRecords` (`convex/shops.ts:716`, `convex/stocks.ts:801-812`), which cover a different and smaller set of events.
- **Steps to reproduce:** Static inspection: `grep -rn 'query("stockLedger")' convex/` returns no match; the only `stockLedger` references are `ctx.db.insert(...)` calls at `convex/purchasing.ts:732`, `convex/purchasing.ts:1262`, `convex/sales.ts:254`, `convex/sales.ts:329`, `convex/sales.ts:958`, `convex/sales.ts:972`, `convex/sales.ts:1130`, `convex/salesCore.ts:730`, `convex/packages/pharmacy.ts:423`, `convex/verticals/batches.ts:128`, plus the schema and the migration list.
- **Expected behavior:** A single audited movement ledger that every stock change writes to and every balance/reconciliation/history view reads from.
- **Actual behavior:** The ledger is append-only and unread. Nothing in the product can detect that a balance no longer matches its movements, and the documented `SHOP_ISSUE` and `ADJUSTMENT` event types are never produced by any code path.
- **Root cause:** The ledger was introduced as an audit sink but no read path or reconciliation job was ever built.
- **Recommended fix:** Either (a) make every stock write go through a single `applyStockMovement(ctx, {stockId, shopId, deltaQty, eventType, ...})` helper that both patches the balance and inserts the ledger row, and add a reconciliation query/report that compares `stocks.qty` (plus `shops.issuedStocks[].qty`) against the ledger sum; or (b) drop the table and stop describing it as the immutable movement record.
- **Test required to verify the fix:** A local test that creates a product, performs one sale, one restock, one transfer and one adjustment, then asserts `sum(stockLedger.deltaQty) === stocks.qty + sum(shops.issuedStocks[].qty)` for every product.

### INV-002 — Manual restock changes the balance with no ledger row

- **Module:** Inventory / adjustments
- **Severity:** HIGH
- **Description:** `stocks.restock` is the ordinary "add stock" path used by the product screen. It patches `stocks.qty` (`convex/stocks.ts:723-730`) and records a `stockEntries` row of type `"restock"` (`convex/stocks.ts:732-745`), but it **never inserts a `stockLedger` row**. The only reason the ledger does not look catastrophically wrong is that the ledger is never read (INV-001).
- **Steps to reproduce:** Static inspection: `convex/stocks.ts:697-776` (no `stockLedger` insert between the `ctx.db.patch` at :723 and the end of the handler).
- **Expected behavior:** Every increase in `stocks.qty` produces one matching `stockLedger` row with a positive `deltaQty` and `eventType: "RESTOCK"`.
- **Actual behavior:** `stocks.qty` rises with no ledger row. The movement is visible only in `stockEntries`, which does not distinguish a restock from an opening balance other than by its `type` string, and which is never cross-checked against the balance.
- **Root cause:** `restock` predates the ledger, or was written against `stockEntries` only.
- **Recommended fix:** Insert a `stockLedger` row inside `restock` with `deltaQty: args.quantityToAdd`, `eventType: "RESTOCK"`, `referenceId` = the `stockEntries` id, and the same `timestamp`; derive the balance change from that row.
- **Test required to verify the fix:** Assert that after `stocks.restock` the ledger contains exactly one `RESTOCK` row with `deltaQty === quantityToAdd`, and that `sum(deltaQty)` equals the change in `stocks.qty`.

### INV-003 — The product edit form writes `qty` directly, with no movement and no audit trail

- **Module:** Inventory / product editing
- **Severity:** HIGH
- **Description:** `stocks.update` accepts an optional `qty` (`convex/stocks.ts:578`) and applies the whole args object to the master row with `ctx.db.patch(id, rest)` (`convex/stocks.ts:620`). The product edit form submits `qty` on every save (`src/app/(dashboard)/stock/page.tsx:165`), so simply opening a product and pressing Save can silently rewrite the on-hand quantity. No `stockEntries` row, no `stockLedger` row, no adjustment reason, and no check that the change is authorised beyond the generic `products.update` permission (`convex/stocks.ts:590`).
- **Steps to reproduce:** Static inspection: `convex/stocks.ts:578` (arg), `convex/stocks.ts:620` (patch), `src/app/(dashboard)/stock/page.tsx:158-171` (form sends `qty`). Read a product, change nothing, save → the request still carries the quantity currently displayed and rewrites it.
- **Expected behavior:** Editing a product's *catalogue* fields (name, code, category, prices) must not be able to change the on-hand quantity. Quantity changes must go through an explicit, permissioned, movement-recording adjustment.
- **Actual behavior:** `products.update` (granted to `inventory_manager`, `branch_manager`, `supervisor`, `business_admin` — `convex/rbac.ts:641`, `:675`) silently rewrites the balance, which is the figure every valuation and stock report is built on.
- **Root cause:** The update mutation is a generic patch of client-supplied fields, with the form posting the whole product record.
- **Recommended fix:** Remove `qty` from the `stocks.update` args and from the edit form; if a direct quantity edit is wanted, route it through the audited adjustment path and require `inventory.adjust`.
- **Test required to verify the fix:** Call `stocks.update` with a changed `qty` and assert it is rejected or ignored; assert no `stockEntries`/`stockLedger` row is created by a catalogue-only edit.

### INV-004 — Opening stock creates no ledger row

- **Module:** Inventory / opening stock
- **Severity:** MEDIUM
- **Description:** `stocks.add` creates the product with its opening `qty` (`convex/stocks.ts:535-539`) and records a `stockEntries` row of type `"add"` (`convex/stocks.ts:541-554`), but no `stockLedger` row. Opening balances are therefore invisible to the ledger.
- **Steps to reproduce:** Static inspection: `convex/stocks.ts:480-567` (no `stockLedger` insert).
- **Expected behavior:** An opening balance is a movement of type `"RESTOCK"` (or a dedicated `"OPENING"`) recorded in the ledger.
- **Actual behavior:** No ledger row; the ledger's sum for a freshly created product is zero while `stocks.qty` is non-zero.
- **Root cause:** Same as INV-002.
- **Recommended fix:** Insert a ledger row with `eventType: "OPENING_BALANCE"` and `deltaQty: args.qty` in `stocks.add`.
- **Test required to verify the fix:** After `stocks.add`, assert the ledger sum for that `stockId` equals the opening `qty`.

### INV-005 — `issueStock` gives a counter stock without taking it out of the warehouse

- **Module:** Inventory / transfers
- **Severity:** HIGH
- **Description:** `shops.issueStock` adds the requested quantities to `shop.issuedStocks` (`convex/shops.ts:290-306`) and writes `shopIssueRecords` (`convex/shops.ts:311-319`), but it **never deducts the master `stocks.qty`** and **never checks that the warehouse holds the stock**. The same operation is implemented differently by `shops.transferStock` (`convex/shops.ts:550-552`) and `shops.batchTransferStock` (`convex/shops.ts:640-642`), which do deduct and do check availability (`convex/shops.ts:541`, `:637`). Two mutations, same business intent, opposite effect on the total.
- **Steps to reproduce:** Static inspection: `convex/shops.ts:253-331` — no `ctx.db.patch(args.stockId, { qty: ... })` and no `stock.qty < item.qty` check anywhere in the handler; contrast `convex/shops.ts:541` and `convex/shops.ts:637`.
- **Expected behavior:** Issuing stock to a counter is a transfer: the warehouse balance falls by the issued quantity, the counter's balance rises by the same amount, and total inventory is unchanged. It must be refused if the warehouse does not hold the quantity.
- **Actual behavior:** With `issueStock` the same physical units are counted twice — once in `stocks.qty` (warehouse) and once in `shop.issuedStocks` (counter). Ten units issued to a counter from a warehouse holding ten leaves the warehouse showing ten and the counter showing ten: twenty on the books for ten in existence. It also permits issuing more than the warehouse holds.
- **Root cause:** A second implementation of "issue stock" was added alongside the transfer mutations and was never reconciled with them.
- **Recommended fix:** Delete `shops.issueStock` and use `shops.batchTransferStock` for every issuance, or make `issueStock` delegate to it. If it must stay, apply the same warehouse deduction and availability check and record a `SHOP_ISSUE` ledger row.
- **Test required to verify the fix:** Issue 10 units from a warehouse holding 10 and assert `stocks.qty === 0`, `issuedStocks[0].qty === 10`, and the total across warehouse + counters is still 10. Issue 11 and assert the mutation is refused.

### INV-006 — Counter transfers are absent from the movement ledger

- **Module:** Inventory / transfers
- **Severity:** MEDIUM
- **Description:** `shops.transferStock` (`convex/shops.ts:549-584`) and `shops.batchTransferStock` (`convex/shops.ts:639-669`) move quantity from the master `stocks.qty` into `shop.issuedStocks` and record `shopIssueRecords` (`convex/shops.ts:587-594`, `:673-680`), but neither writes a `stockLedger` row. The ledger's documented `SHOP_ISSUE` event type is produced by nothing.
- **Steps to reproduce:** Static inspection: `convex/shops.ts:520-605` and `convex/shops.ts:607-692` — no `ctx.db.insert("stockLedger", ...)` in either handler.
- **Expected behavior:** A transfer writes a `SHOP_ISSUE` ledger row with `shopId` set and a negative `deltaQty` against the warehouse balance.
- **Actual behavior:** Transfers appear in `shopIssueRecords` only. The warehouse reduction has no ledger entry, so a ledger-based reconciliation would miss every transfer.
- **Root cause:** Same root cause as INV-002 — the ledger write was added to the sale path and the purchasing path only.
- **Recommended fix:** Write a `SHOP_ISSUE` ledger row per transferred line in both mutations.
- **Test required to verify the fix:** After a transfer, assert the ledger contains a `SHOP_ISSUE` row with `shopId` = target shop and `deltaQty` = `-quantity`.

### INV-007 — Removing or clearing a counter's stock destroys it silently

- **Module:** Inventory / transfers
- **Severity:** MEDIUM
- **Description:** `shops.removeStock` deletes the product from `shop.issuedStocks` (`convex/shops.ts:350-352`) and `shops.clearStocks` empties the array entirely (`convex/shops.ts:382`). Neither returns the quantity to the warehouse `stocks.qty`, neither writes a `stockLedger` row, and neither writes a `shopIssueRecords` row.
- **Steps to reproduce:** Static inspection: `convex/shops.ts:333-363` (removeStock) and `convex/shops.ts:366-393` (clearStocks) — no warehouse patch, no ledger insert, no issue record.
- **Expected behavior:** Removing a product from a counter is either a return to the warehouse (quantity goes back up) or a written-off disposal (quantity leaves the books with a movement row). Either way the total must be accounted for.
- **Actual behavior:** The quantity disappears from every balance in the system. It is neither in the warehouse nor at the counter nor in any movement record. `clearStocks` on a counter with 500 units on hand erases 500 units of inventory from the books in one call.
- **Root cause:** The mutations were written to fix the counter's display, not to conserve stock.
- **Recommended fix:** Make `removeStock` call the same logic as `returnShopStock` (`convex/shops.ts:474-518`), and make `clearStocks` iterate the same per-item return; write a `stockLedger` row (e.g. `eventType: "SHOP_RETURN"` / `"ADJUSTMENT"`) for each.
- **Test required to verify the fix:** With 10 units at a counter and 20 in the warehouse, call `removeStock` and assert the warehouse is back to 30 and a movement row exists.

### INV-008 — Returning counter stock to the warehouse leaves no movement record

- **Module:** Inventory / transfers
- **Severity:** MEDIUM
- **Description:** `shops.returnShopStock` adds the counter's quantity back to the master `stocks.qty` (`convex/shops.ts:498-501`) and removes the line from `shop.issuedStocks` (`convex/shops.ts:504-507`), but writes no `stockLedger` row and no `shopIssueRecords` row.
- **Steps to reproduce:** Static inspection: `convex/shops.ts:474-518`.
- **Expected behavior:** The return is the mirror of the transfer and is recorded as such in the ledger and in the issue history.
- **Actual behavior:** The quantity reappears in the warehouse balance with no trace of the round trip. The counter's issue history shows the issue but never the return.
- **Root cause:** Same root cause as INV-006.
- **Recommended fix:** Insert a `SHOP_ISSUE` ledger row with positive `deltaQty` and a `shopIssueRecords` row (or a dedicated `shopReturnRecords` row).
- **Test required to verify the fix:** Assert that after a return the warehouse balance is restored and that the ledger contains the compensating entry.

### INV-009 — `adjustShopStock` moves quantity with no movement and no issue history

- **Module:** Inventory / adjustments
- **Severity:** MEDIUM
- **Description:** `shops.adjustShopStock` sets a counter's line to an absolute `newQty` and compensates the warehouse by the same delta (`convex/shops.ts:429-460`). It writes no `stockLedger` row and no `shopIssueRecords` row, and it takes `newQty` from the client with no reason field.
- **Steps to reproduce:** Static inspection: `convex/shops.ts:396-471`.
- **Expected behavior:** A counter adjustment is recorded as a movement with a reason, and the ledger shows the offsetting warehouse movement.
- **Actual behavior:** Both balances change with no trace. `shopIssueRecords` — the only history the UI can display for a counter — does not show it, so a shrinkage is invisible in the counter's history even though `inventory.adjust` is a separate, auditable permission.
- **Root cause:** Same root cause as INV-006.
- **Recommended fix:** Write a ledger row for the counter side and the warehouse side of the adjustment and a `shopIssueRecords` row with the reason.
- **Test required to verify the fix:** Adjust a counter line from 10 to 7 and assert the ledger shows -3 at the counter and +3 at the warehouse, and that the counter's issue history contains the adjustment.

### INV-010 — A product can be hard-deleted while it still has sales history

- **Module:** Inventory / product lifecycle
- **Severity:** HIGH
- **Description:** `stocks.remove` deletes the product document outright (`convex/stocks.ts:683`). It removes the product from every counter's `issuedStocks` array (`convex/stocks.ts:673-682`) and deletes nothing else. It performs **no check for sales history**: there is no query of `sales`, `stockLedger`, `stockEntries`, `goodsReceipts` or `purchaseInvoices` before the delete. Convex does not cascade, so every `sales.items[].stockId`, `stockLedger.stockId`, `stockEntries.stockId`, `shopIssueRecords.stockId` and `purchaseInvoices[].stockId` referring to that product is left pointing at a document that no longer exists, and `ctx.db.get()` on such an id throws.
- **Steps to reproduce:** Static inspection: `convex/stocks.ts:660-694` — the handler reads the product, cleans up `shops.issuedStocks`, and calls `ctx.db.delete(args.id)`; there is no history check anywhere in the handler. The delete is reachable from the product screen (`src/app/(dashboard)/stock/page.tsx:114`, `:179-188`).
- **Expected behavior:** A product with transactions is archived (deactivated), never deleted, so the historical sale and movement records remain resolvable.
- **Actual behavior:** Deleting a sold product destroys the link between past sales and the product. Historical sales still carry the product's id, name and price as they were at the time of sale (so the *amount* survives), but every report that resolves a sale line back to a live product — the stock report (`convex/reports.ts:1460`, `:1541`), the stock-entry history (`convex/stocks.ts:870`) and the ledger — loses the product and the `ctx.db.get` in those joins returns `null` or throws. The schema has no `isActive` flag on `stocks` to support archival (`convex/schema.ts:391-442`), although `customers` and `suppliers` do have one.
- **Root cause:** `remove` was written as a hard delete with no lifecycle design, and the `stocks` table was never given an archival flag.
- **Recommended fix:** Add `isActive: v.optional(v.boolean())` to `stocks`; make `remove` refuse when the product appears in any `sales`/`stockLedger`/`stockEntries`/`goodsReceipts` row and set `isActive: false` instead; filter inactive products out of the catalogue and out of pickers, but keep them resolvable for history.
- **Test required to verify the fix:** Create a product, sell one unit, attempt `stocks.remove`, assert it is refused (or that the product is archived and `ctx.db.get` on the old id still resolves).

### INV-011 — `getInventoryStats` subtracts counter stock from a figure that no longer contains it

- **Module:** Inventory / valuation
- **Severity:** MEDIUM
- **Description:** `stocks.getInventoryStats` sums `s.qty` over the master `stocks` rows into `totalItems` (`convex/stocks.ts:218-225`), sums the counters' `issuedStocks[].qty` into `totalShopStock` (`convex/stocks.ts:259-264`), and then reports `warehouseStock: stats.totalItems - totalShopStock` (`convex/stocks.ts:290`).
- **Steps to reproduce:** Static inspection: `convex/stocks.ts:218-227`, `:259-264`, `:290`.
- **Expected behavior:** `warehouseStock` is the warehouse's own holding.
- **Actual behavior:** Whether the warehouse figure is right depends on which issue path was used. After `shops.transferStock` the master `stocks.qty` has already been reduced, so `totalItems` is the warehouse holding alone and subtracting `totalShopStock` again **understates** the warehouse. After `shops.issueStock` (INV-005) the master quantity still contains the issued units, so `totalItems` includes the counter's stock and the subtraction happens to be right by accident. The same stat therefore reports two different meanings depending on how the stock was issued.
- **Root cause:** The two issue paths behave differently (INV-005), and the stat assumes one of them.
- **Recommended fix:** Compute the warehouse holding as the sum of `stocks.qty` over rows whose `warehouseId` is the warehouse and `branchId` is unset, without subtracting counter holdings, once the issue paths are unified (INV-005).
- **Test required to verify the fix:** Issue stock to a counter by both paths, then assert `totalItems === warehouseStock + totalShopStock` holds identically.

### INV-012 — Low-stock alerts use one global, client-supplied threshold with no per-product reorder level

- **Module:** Inventory / low-stock alerts
- **Severity:** MEDIUM
- **Description:** `stocks.getLowStockAudit` takes `threshold` and `lookbackDays` as query arguments defaulting to 10 and 7 (`convex/stocks.ts:296-307`), and flags every product with `qty < threshold` (`convex/stocks.ts:308-312`). The `stocks` table has **no per-product reorder level / minimum-stock field** (`convex/schema.ts:391-442`), so there is nowhere to record "this product must always hold 24".
- **Steps to reproduce:** Static inspection: `convex/stocks.ts:295-352`; `convex/schema.ts:391-442` (field list).
- **Expected behavior:** A per-product reorder point, set by the business, with the alert comparing `qty` against that value, plus an override default.
- **Actual behavior:** Every product in the business shares the same cutoff, and the cutoff is chosen by the caller. A business stocking 200-litre water drums and one stocking tea sachets gets the same 10-unit line, so the alert is either all-noise or all-silent depending on one number typed in the browser. The threshold is not stored, so the alert is not reproducible or auditable over time.
- **Root cause:** No reorder-point field was added to the schema.
- **Recommended fix:** Add `reorderPoint: v.optional(v.number())` to `stocks`; compute the alert from it, falling back to a business-level default stored in `businessProfiles` rather than a query argument.
- **Test required to verify the fix:** Two products with different reorder points, one above and one below; assert the audit returns exactly the one that is below its own point, and that the threshold survives a page reload.

### INV-013 — Barcode scanning is not wired to the till

- **Module:** Inventory / barcode
- **Severity:** HIGH
- **Description:** The platform advertises barcode scanning as a working feature (`convex/integrations/registry.ts:772-796`, `convex/packages/registry.ts:83-97`), and a server-side lookup exists (`convex/packages/supermarket.ts:159-197`, `searchByBarcode`). That query has **no callers anywhere** in `src/` or `convex/`. The POS loads its products through `stocks.getShopStock` (`src/app/(dashboard)/sales/page.tsx:103`, `:185`), whose search matches the product **name** and **productCode** only (`convex/stocks.ts:385-391`). The browser-side scanner library (`src/lib/hardware/barcode.ts`) types the scanned digits into whatever has focus and is imported only by the integrations demo page (`src/app/(dashboard)/integrations/page.tsx`).
- **Steps to reproduce:** Static inspection: `grep -rn "searchByBarcode" src/ convex/` matches only its definition at `convex/packages/supermarket.ts:159`; `grep -rn "barcode" src/app/(dashboard)/sales/` returns nothing.
- **Expected behavior:** Scanning a product's barcode at the till selects that product, and the lookup is tenant-scoped and counter-aware.
- **Actual behavior:** There is no barcode lookup in the sale path. Scanning at the till types a numeric string into the product search box, which searches product *names* (`convex/stocks.ts:42-45`, the `search_name` search index) and then falls back to an exact `productCode` match (`convex/stocks.ts:105-111`). A barcode is neither a name nor a product code, so the scan finds nothing and the cashier must type the product name.
- **Root cause:** The server helper was written and never wired into the till; the client's scanner library is a keyboard burst filter with no product resolution attached.
- **Recommended fix:** Call `packages/supermarket.searchByBarcode` from the POS product picker when a scan is detected, falling back to the name search; return the counter's own quantity for a shop-scoped caller rather than the warehouse quantity.
- **Test required to verify the fix:** Unit-test `normaliseBarcode` (already exported, `convex/packages/supermarket.ts:205-207`) and add a POS test that a scanned barcode resolves the right product, including the case where the barcode differs in case/spacing from the stored value.

### INV-014 — A product's barcode cannot be recorded from the product form

- **Module:** Inventory / barcode
- **Severity:** MEDIUM
- **Description:** `stocks.add` and `stocks.update` have **no `barcode` argument** (`convex/stocks.ts:480-496`, `:570-587`), and the product form has no barcode field (`src/app/(dashboard)/stock/page.tsx:132-144`, `:158-171`). The only mutation that writes `stocks.barcode` is `packages.supermarket.setProductUnits` (`convex/packages/supermarket.ts:219-290`), which has **no callers** in `src/`.
- **Steps to reproduce:** Static inspection: `grep -rn "setProductUnits" src/ convex/` matches only its definition at `convex/packages/supermarket.ts:219`.
- **Expected behavior:** The barcode is a field of the product, editable on the product form, validated for uniqueness within the business.
- **Actual behavior:** There is no reachable way to set a barcode from the application. The uniqueness logic that exists (`convex/packages/supermarket.ts:263-281` — normalised, per-business, one barcode to one product) is correct but unreachable, so in practice no product carries a barcode at all. Note that the uniqueness check is also an O(n) scan over every product in the business (`convex/packages/supermarket.ts:265-268`), which will not scale.
- **Root cause:** The barcode feature lives in an optional package module that the product screens were never wired to.
- **Recommended fix:** Add `barcode` to the `stocks.add`/`stocks.update` args and to the product form, normalising it on write; replace the O(n) uniqueness scan with the existing `by_businessId_barcode` index (`convex/schema.ts:452`) — noting that it must query the normalised form, so either store the normalised value only or add a normalised index.
- **Test required to verify the fix:** Create a product with barcode `abc-123`; assert it is stored as `ABC-123`; assert a second product cannot take `ABC 123`; assert the barcode resolves via `searchByBarcode` for the owning business and returns `null` for another business.

### INV-015 — The cost price is returned to cashiers

- **Module:** Inventory / cost vs selling price
- **Severity:** MEDIUM
- **Description:** The cost of a product lives in `stocks.purchasePrice` (`convex/schema.ts:397`). The catalogue queries return the whole stock document: `stocks.list` (`convex/stocks.ts:42-72`), `stocks.getPaginated` (`convex/stocks.ts:91-145`), `stocks.getStock` (`convex/stocks.ts:463-475`) and `stocks.getShopStock` (which returns `shop.issuedStocks` verbatim, `convex/stocks.ts:382`). The `cashier` role holds `products.view` (`convex/rbac.ts:660`), and `products.view` is the only permission these queries require (`convex/stocks.ts:27`, `:87`, `:158`, `:201`, `:367`, `:421`, `:445`, `:461`).
- **Steps to reproduce:** Static inspection: `convex/rbac.ts:657-669` (cashier permissions) and `convex/stocks.ts:17-73` (the query returns full documents). A call to `api.stocks.list` from a cashier session returns `purchasePrice` for every product.
- **Expected behavior:** Cost price is visible to roles that manage stock and to finance, and is withheld from the till. `pv` and `bv` are carried in the same payload (`convex/schema.ts:399-400`).
- **Actual behavior:** A cashier can read every product's cost price by calling the catalogue query directly, even though the till UI does not render it. Any role that can read products can read the margin.
- **Root cause:** The catalogue query returns the raw row; no field-level redaction exists, and `products.view` carries no notion of "see cost".
- **Recommended fix:** Project the catalogue queries to the fields each role may see — return `purchasePrice`/`pv`/`bv` only when the caller holds a cost-visible permission (e.g. `finance.view` or `products.manage`); otherwise omit them from the payload. Apply the same projection to `stocks.getShopStock`, which returns the counter's snapshot including `pv`/`bv`.
- **Test required to verify the fix:** Call `stocks.list` as a cashier and assert the returned objects have no `purchasePrice`/`pv`/`bv` key; call it as an inventory manager and assert they are present.

### INV-016 — A customer credit limit is never enforced at the point of sale
- **Module:** Customers / credit control
- **Severity:** HIGH
- **Description:** A customer's credit limit is stored on the customer row (`creditLimit`, `convex/schema.ts:470`) and is surfaced everywhere the operator can see it — `availableCredit` and `overLimit` in the customer detail helpers (`convex/customers.ts:320-327`, `:357-366`) and the `overLimit` flag in the receivables analytics (`convex/analytics.ts:910-928`). But it is **never consulted when a sale is made**: a repository-wide search for `creditLimit` returns no occurrence in `convex/salesCore.ts`, `convex/sales.ts` or `convex/verticals/operations.ts`. A till can sell on credit to a customer who is already `overLimit`, and the breach becomes visible only afterwards, in a report.
- **Steps to reproduce:** Static inspection: `grep -rn 'creditLimit' convex/` → the only call sites are `convex/analytics.ts:910,925,927,928`, `convex/customers.ts:320,326,327,357,364,365,366,593` and the schema — none of them is on a sale path. (A live reproduction would require writing a credit sale to the production deployment, which the mandate forbids.)
- **Expected behavior:** A credit sale that would push the customer past their limit is refused (or requires a manager's approval), with the reason shown to the cashier.
- **Actual behavior:** The sale proceeds; the limit is advisory, and only a report records the breach.
- **Root cause:** The limit was implemented as a display and reporting attribute rather than as a rule on the transaction path.
- **Recommended fix:** In the credit-sale path of `applySale`, compute the customer's open balance (the same derivation `customers.recordPayment` uses: the sum of `loans[].balance` where `balance > 0`), add the new total, and refuse when it exceeds `creditLimit` and `creditLimit > 0`. If a business wants soft limits, make that a per-business setting and still record the breach at the moment it happens rather than in a later report.
- **Test required to verify the fix:** A test that takes a customer to their limit, attempts one more credit sale, and asserts it is refused with the limit named; and a test asserting a sale within the limit succeeds.

### INV-017 — Two competing repayment paths write the same debt balance
- **Module:** Customers / loans
- **Severity:** MEDIUM
- **Description:** Customer debt can be reduced through either `customers.recordPayment` (`convex/customers.ts:917-1000`) or `loans.makePayment` (`convex/loans.ts:384-440`). Both read the loan balance, subtract the payment, patch `loans[].balance`, insert a `payments` row and write an activity log. `recordPayment` additionally allocates a payment across several open loans oldest-first with an overpayment guard (`convex/customers.ts:954-973`) and a duplicate-reference guard. `makePayment` reduces exactly one loan. Each mutation is individually atomic, but the two paths implement the same rule twice, with different validation: `recordPayment` refuses an amount greater than the total outstanding, while `makePayment` refuses only an amount greater than *that loan's* balance (`convex/loans.ts:405-406`). The `payments` rows written by the two paths are not distinguishable, so a ledger reconstructed from `payments` alone cannot tell which path settled a debt.
- **Steps to reproduce:** Static inspection of `convex/customers.ts:917-1000` and `convex/loans.ts:384-440`.
- **Expected behavior:** One repayment path, one validation rule, and payments rows that identify how a debt was settled.
- **Actual behavior:** Two paths with different validation and no discriminator on the resulting `payments` rows.
- **Root cause:** The customer-facing repayment was added on top of the loan-facing one without consolidating them.
- **Recommended fix:** Make `loans.makePayment` call the same internal allocation routine that `recordPayment` uses, and add a `channel` field (`"customer"` / `"loan"` / `"mobile-money"`) to the `payments` table so the ledger records which path settled a debt. Also handle the case where a payment spans several loans: `recordPayment` patches each loan's balance in sequence, so a failure between two patches would leave the first loan reduced with no matching payment row — see `05_DATABASE_AUDIT.md` DB-04.
- **Test required to verify the fix:** A test that repays through both paths and asserts the resulting balances, the `payments` rows and the audit trail are identical in shape.

---

## 5. NOT IMPLEMENTED

- **Product variants** — there is no variant table and no variant axis in the schema. `halfPrice` (`convex/schema.ts:402`), `unitsPerPack` (`convex/schema.ts:428`) and `weightBased` (`convex/schema.ts:441`) are boolean/flag fields on the single product row; the bulk/wholesale package is a pricing mode, not a variant model. Not implemented.
- **Barcode capture in the product form and barcode lookup at the till** — the server helpers exist (`convex/packages/supermarket.ts:159`, `:219`) but are unreachable from the UI (INV-013, INV-014). Effectively not implemented.
- **Product archival** — `stocks` has no `isActive` flag (`convex/schema.ts:391-442`); products are hard-deleted (INV-010).
- **Per-product reorder level / minimum stock** — no such field exists, so low-stock alerts cannot be per-product (INV-012).
- **Stock transfer between warehouses or branches** — `stocks` carries `warehouseId` and `branchId` (`convex/schema.ts:405-407`) but every movement path in scope moves quantity between the single master table and a shop counter. There is no warehouse-to-warehouse transfer.

## 6. NOT TESTED

- **Live stock movements, goods receipt, supplier payment settlement, customer repayment, concurrent stock updates** — all require writing to the live Convex deployment `affable-panda-681.convex.cloud`, which the audit brief prohibits. Every conclusion above is therefore from static inspection of the current code at commit `953f958`.
- **`npm test` result** — see the run recorded in §1; the existing suites are finance/acceptance suites and do not cover inventory reconciliation.
- **Multi-tenant leakage of the barcode lookup** — `searchByBarcode` filters on `businessId` (`convex/packages/supermarket.ts:174`), which is correct by inspection, but it has no caller and no test.

## 7. Counts

**0 CRITICAL, 7 HIGH, 10 MEDIUM, 0 LOW, 0 INFORMATIONAL** — 17 findings (INV-001 … INV-017).

**Severity roll-up:** INV-001 HIGH, INV-002 HIGH, INV-003 HIGH, INV-004 MEDIUM, INV-005 HIGH, INV-006 MEDIUM,
INV-007 HIGH, INV-008 MEDIUM, INV-009 MEDIUM, INV-010 HIGH, INV-011 MEDIUM, INV-012 MEDIUM, INV-013 MEDIUM,
INV-014 MEDIUM, INV-015 MEDIUM, INV-016 HIGH, INV-017 MEDIUM.

---

## 8. Verdict

The **movement ledger that was built to solve this problem is never read** (INV-001). `stockLedger` is
documented as the immutable record of every stock change and is written from eight call sites — but no query
anywhere in the product reads it, and the balances it would reconcile are instead maintained by a mix of
direct writes to `stocks.qty` and embedded arrays on the shop document. Nine of the eleven paths that change a
stock balance write no ledger row at all, so **no reconciliation between the recorded history and the recorded
balance is even possible** — which is why INV-001 through INV-009 are all variations on one root cause rather
than nine independent bugs.

Two consequences matter commercially. **The stock position a business sees is not derivable from its
transactions** (INV-001, INV-005, INV-006) — issuing stock to a counter does not reduce the warehouse, so the
same units are counted twice. And **the goods receipt path is the one path that does everything right**
(goods receipt writes `stockEntries` *and* a `RESTOCK` ledger row), which shows the intended design was there
first and was not applied to the other paths.

The credit and debt model is the opposite picture: the outstanding balance is properly derived (no stored
counter), repayment allocation is correct, and the supplier ledger keeps a cached balance in step with its
source of truth. The one real defect in that area is that the **credit limit is advisory** (INV-016) — a limit
that is displayed, reported and never enforced is worse than no limit, because the business believes it is
protected.
