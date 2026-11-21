# 05 — Inventory, Products, Stock and Barcodes

**Commit audited:** `acafd2b`
**Scope:** `convex/stocks.ts`, `convex/warehouses.ts`, `convex/shops.ts`,
`convex/purchasing.ts`, `convex/packages/supermarket.ts`, `convex/packages/pharmacy.ts`,
`convex/verticals/batches.ts`, `src/app/(dashboard)/stock/page.tsx`,
`src/app/(dashboard)/inventory/page.tsx`.

---

## 1. The product model

A product (`stocks`) carries, among others:

| Field | Meaning |
|---|---|
| `name`, `productCode`, `description` | Identity. `productCode` is unique **within a business** |
| `price` | The shelf price |
| `purchasePrice` | The cost — used for profit |
| `qty` | Quantity on hand |
| `pv`, `bv` | Per-unit profit value and base value (the platform's legacy value columns) |
| `categoryId` | Category |
| `halfPrice` | May be sold at half price |
| `warehouseId`, `branchId` | Where the stock lives |
| `barcode` | The printed barcode (added in Phase 9) |
| `unit`, `unitsPerPack` | The unit of sale (`kg`, `crate`, `strip`) and how many make a pack |
| `allowFractional`, `weightBased` | Fractional and by-weight selling |

The `unit` / `unitsPerPack` / `allowFractional` / `weightBased` fields are exactly what a
supermarket, a butcher and a wholesaler each need, and they are optional on one table rather
than separate tables. That is the right modelling choice.

---

## 2. Endpoints

| Function | Kind | Notes |
|---|---|---|
| `list` | query | `convex/stocks.ts:17` |
| `getPaginated` | query | `:76` |
| `count` | query | `:149` |
| `getInventoryStats` | query | `:197` |
| `getLowStockAudit` | query | `:295` |
| `getShopStock` | query | `:355` |
| `listAll` | query | `:414` |
| `getByCode` | query | `:438` — barcode / product-code lookup |
| `getStock` | query | `:457` |
| `add` | mutation | `:480` |
| `update` | mutation | `:570` |
| `remove` | mutation | `:660` |
| `restock` | mutation | `:697` |
| `getShopIssueRecords` | query | `:778` |
| `getStockEntries` | query | `:857` |

All of them are tenant-scoped. `update` and `remove` additionally check that the product belongs
to the caller's business (`convex/stocks.ts:596-598`, `669-671`), and `update` checks that a
changed `categoryId` belongs to the same business (`:600-605`) and that a changed `productCode`
is not already used in that business (`:606-618`).

---

## 3. Findings

### 3.1 The quantity can be edited without a movement record — M-17 (Medium)

`stocks.update` accepts `qty` directly (`convex/stocks.ts:579`) and patches it
(`convex/stocks.ts:620`). No `stockEntries` row is written and no `stockLedger` row is written.

The consequence: the stock on hand can be changed by anybody with `products.update`, and the
change leaves no trace in either movement table. A stock count that does not agree with the
books cannot be explained.

**Recommendation:** refuse a `qty` change through `update` and route every quantity change
through an explicit adjustment mutation that writes a movement row with a reason.

### 3.2 Restock does not write to the immutable ledger — M-18 (Medium)

`stockLedger` is written by the sale path (`convex/salesCore.ts:730`), by purchasing
(`convex/purchasing.ts:732`, `1262`), by pharmacy batches (`convex/packages/pharmacy.ts:423`)
and by batches (`convex/verticals/batches.ts:128`) — but **not** by `stocks.restock`, which
writes to a different table, `stockEntries` (`convex/stocks.ts:732-745`).

So the ledger is not a complete record of stock movement. Any attempt to reconstruct stock from
the ledger will not reconcile.

### 3.3 A restock can silently reduce the stock — M-19 (Medium)

`restock` takes `quantityToAdd: v.number()` (`convex/stocks.ts:702`) and applies it without
validating it (`convex/stocks.ts:723-730`):

```ts
qty: stock.qty + args.quantityToAdd,
```

A negative value is accepted, so a "restock" of `-50` reduces the stock by 50 while writing a
row that says `type: "restock"`. A non-finite value would write `NaN` into a `v.number()`
column.

**Recommendation:** require `quantityToAdd > 0` and require a reason; use a separate,
explicitly named adjustment mutation for write-offs.

### 3.4 The cost of goods goes stale unless purchasing is used — M-20 (Medium)

`stocks.restock` records `purchasePrice: stock.purchasePrice` — the **old** cost
(`convex/stocks.ts:739`) — and never updates `stocks.purchasePrice`. The proper purchasing flow
does update it (`convex/purchasing.ts:726`, `751`: `purchasePrice: item.unitCost`).

Profit is computed from `stock.purchasePrice` (`convex/reports.ts:37`,
`convex/reports.ts:83`). A business that restocks through the inventory screen rather than
through purchase orders therefore reports profit against a cost it no longer pays.

**Recommendation:** have `restock` take the new purchase price and update it, or have the
profit calculation use a weighted moving average cost maintained by the ledger.

### 3.5 Deleting a product makes historical profit wrong — M-21 (Medium)

`stocks.remove` deletes the product row outright (`convex/stocks.ts:683`). Historical sales
keep the `stockId` as a plain identifier, so the sales survive — but the report code does:

```ts
const stock = stockMap.get(item.stockId);
if (stock) {
    totalCost += stock.purchasePrice * item.quantity;
}
```

(`convex/reports.ts:34-38`)

A deleted product contributes **no cost**, so the revenue is counted and the cost is not. The
effect is that deleting a product silently **raises** reported profit for every sale that ever
contained it.

**Recommendation:** either refuse to delete a product that has sales history (deactivate it
instead), or snapshot the cost onto the sale line when the sale is recorded.

---

## 4. Branch and warehouse stock

A shop holds its own `issuedStocks` array; a sale from that shop deducts from it
(`convex/salesCore.ts:641-665`). A sale from the head office deducts from the main `stocks` row
(`convex/salesCore.ts:667-685`).

Price changes propagate from the product to every branch that holds it
(`convex/stocks.ts:625-645`, and the same propagation in `restock` at `:756-774`). That is
correct, and it means a price change reaches the till without a separate instruction.

**M-22 (Low).** The propagation loops over every shop and patches each one individually — two
database writes per branch per price change. A business with 50 branches does 50 writes. Fine at
today's scale; worth batching later.

---

## 5. Barcodes

Phase 9 added `stocks.barcode` and the index `by_barcode`, plus a browser driver
(`src/lib/hardware/barcode.ts`) that converts a scanner's keystrokes into a product lookup.

**Assessment: the data model is right; the hardware path is partly unverified.** The scanner
driver in the browser is a keyboard-wedge implementation — it listens for fast keystrokes ending
in Enter. That works with a USB scanner that behaves as a keyboard, which is most of them. It
does not use the camera.

`convex/stocks.ts:438` (`getByCode`) is the server-side lookup for a scanned code.

**H-03 (Medium).** There is no camera-based scanner in the web application, and the mobile
application that would provide one is not on `main` (report 12). A business whose products are
labelled but not barcode-keyboard compatible has no scanning path at all.

---

## 6. Industry-specific stock behaviour

| Package | Stock behaviour |
|---|---|
| **Supermarket** | Bulk and pack pricing via `unitsPerPack`; promotions; weighing-scale products via `weightBased` |
| **Pharmacy** | Batch tracking (`productBatches`), expiry dates, controlled-drug records (`convex/verticals/batches.ts`, `convex/packages/pharmacy.ts`) |
| **Wholesaler** | Volume tiers and customer-specific price lists (`priceLists`, `priceListEntries`) |
| **Restaurant** | Menu items and table orders (`convex/verticals/scheduling.ts`) |

The pharmacy package writes to `stockLedger` (`convex/packages/pharmacy.ts:423`) and the
wholesaler resolves tiered pricing through one function (`convex/packages/wholesaler.ts`
`resolvePrice`, tested in `tests/integrations.test.ts`). These are genuine extensions rather than
re-implementations: they reuse `stocks`, `salesCore` and the ledger.

---

## 7. Low stock and inventory audit

`getLowStockAudit` (`convex/stocks.ts:295`) and `getInventoryStats` (`:197`) provide the
alerts. The dashboard shows a low-stock tile and the inventory page lists what needs
reordering.

**Assessment: present and adequate.** Threshold configuration is per business through the
business settings.

---

## 8. Summary

| Area | Assessment |
|---|---|
| Product model | **Good** — one table, optional vertical fields |
| Tenant and ownership checks | **Good** |
| Product-code uniqueness | **Good**, per business |
| Branch stock and price propagation | **Good** |
| Industry packages | **Good** — real extensions, not re-implementations |
| Quantity changes without a movement record | **M-17** |
| Incomplete stock ledger | **M-18** |
| Unvalidated restock quantity | **M-19** |
| Stale cost of goods | **M-20** |
| Deleting a product corrupts historical profit | **M-21** |
| Camera barcode scanning | **Not available on `main` (H-03)** |
