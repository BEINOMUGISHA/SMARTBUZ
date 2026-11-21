# 08 — POS Sales Lifecycle Test Report (PART 4)

**Date:** 2026-11-20
**Audited commit:** `953f958` (branch `main`)
**Scope:** POS sales lifecycle — product selection → cart → quantity → discounts → tax → subtotal → grand total → payment (incl. partial) → receipt → transaction save → stock update → financial records → sales history → returns/refunds.

---

## 1. Method

### 1.1 What was inspected (read-only)

| Area | Files read |
|---|---|
| Sale engine | `convex/sales.ts` (1190 lines), `convex/salesCore.ts` (803 lines), `convex/sync.ts` (704 lines) |
| Pricing / promotions | `convex/promotions.ts`, `src/lib/promo-evaluator.ts`, `convex/packages/*.ts` |
| Payments / money | `convex/integrations/payments.ts`, `convex/finance.ts` (1256), `convex/financeCore.ts` (397), `convex/loans.ts`, `convex/customers.ts` |
| Tax | `convex/verticals/tax.ts` (175), `src/lib/vat.ts` (74) |
| Schema | `convex/schema.ts` — `sales` (`:531-673`), `stocks` (`:391-454`), `loans` (`:675-686`), `payments` (`:688`), `stockLedger` (`:1673`), `counters` (`:1667`) |
| Auth / tenancy | `convex/tenancy.ts`, `convex/rbac.ts`, `src/lib/permissions.ts` |
| Client POS | `src/app/(dashboard)/sales/page.tsx`, `src/app/(dashboard)/sales/edit-sale-sheet.tsx`, `src/components/ReceiptModal.tsx`, `src/components/ThermalReceipt.tsx` |

### 1.2 What was run

- `npm test` (node:test suites in `tests/` — local only, no deployment writes).

### 1.3 What was NOT run, and why

- **Write-capable scripts prohibited by the audit brief and therefore not run:** `scripts/tenant-isolation-e2e.mjs`, `vertical-e9e.mjs`, `vertical-e2e.mjs`, `auth-journey.mjs`, `migrate-to-multitenancy.mjs`, `apply-entitlements.mjs`, `bootstrap-platform-admin.mjs`, `seed-legacy-fixture.mjs`, `probe-*.mjs`.
- **The live deployment `affable-panda-681.convex.cloud` was never written to.** Everything below is proven by static inspection of the current code at `953f958`, plus the local unit suites. The following behaviours could only be proven by writing to the live deployment and are recorded as **NOT TESTED**:
  - two genuinely concurrent sales of the same product (the OCC behaviour is reasoned from code, not observed);
  - a retried online `sales.create` request producing a second sale (the absence of an idempotency key is proven from the code; the observed duplicate was not reproduced);
  - live PSP settlement, webhook-driven `paymentConfirmation` transition, and receipt-printer output;
  - the rate at which `sync.pushTransactions` replays a queued sale twice in practice.

### 1.4 Prior-audit reconciliation

`docs/QA/04-pos-sales.md` was treated as **lead only**. Its findings were re-verified against the current code; see §5 for the per-finding "fixed / still open" verdict.

---

## 2. Summary

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Server-side total recomputation (online) | **PASSED** | `convex/salesCore.ts:558-613` | Server re-reads `stocks.price` and recomputes the total; a client total that differs by > 0.01 is **refused**. |
| Server-side total recomputation (offline) | **PASSED** | `convex/salesCore.ts:608-613`, `:714` | Offline sales also use the server's computed total; the till's figure is kept as `clientTotal` for explanation. |
| Client control of unit price | **FAILED** | `convex/salesCore.ts:541-549`, `:574-588` | A till price override may go to **0**; only "above list price" is rejected. No floor, no per-role gate. |
| Client control of tax / VAT | **FAILED** | `src/lib/vat.ts:59-69`, `src/app/(dashboard)/sales/page.tsx:674-679` | VAT is computed **only in the browser**. The sale record has no tax field at all. |
| Discount authorisation (ceiling) | **FAILED** | `convex/salesCore.ts:576-580` | The only ceiling is "≤ list price". No discount engine, no percentage/amount cap, no cost-price floor. |
| Promotion evaluation | **PASSED** (server-side for the record) | `convex/salesCore.ts:205-297` | Redemption counting is recomputed server-side from `stocks.pv/bv`. |
| Duplicate sale — idempotency key | **FAILED** | `convex/salesCore.ts:500-516`, `src/app/(dashboard)/sales/page.tsx:593-633` | `clientOfflineId` is optional and the online POS never sends it → a retried request creates a second sale. |
| Duplicate sale — invoice number uniqueness | **PARTIAL / FAILED** | `convex/salesCore.ts:148-182`, `convex/schema.ts:670` | A per-business+prefix counter gives sequential numbers, but there is **no unique index** and the prefix is derived from a mutable shop serial number. |
| Negative / zero quantity rejection | **PASSED** | `convex/salesCore.ts:460-464`, `:569-571` | `Number.isFinite(quantity) && quantity > 0` enforced in two places. |
| Negative price / NaN propagation | **PARTIAL** | `convex/salesCore.ts:443-444`, `:544-546` | Item prices from the client are discarded; but `initialDeposit` and `paymentDueDate` are unvalidated. |
| Partial payments — remaining balance | **PASSED** | `convex/salesCore.ts:758-784`, `convex/customers.ts:953-990` | Deposit recorded as a `payments` row; repayments decrement `loans.balance`. |
| Partial payments — idempotency | **FAILED** | `convex/loans.ts:384-432`, `convex/customers.ts:941-951` | `loans.makePayment` has **no** duplicate guard and **no** `amount > 0` check. |
| Partial payments — overpayment | **PASSED** (one path) / **FAILED** (other path) | `convex/customers.ts:957-961` vs `convex/loans.ts:405-406` | `customers.recordPayment` refuses overpayment; `loans.makePayment` accepts a **negative** amount. |
| Stock deduction — exactly once | **PASSED** | `convex/salesCore.ts:640-686`, `:728-741` | One deduction per line, one `stockLedger` row per line, in the same mutation as the sale. |
| Stock deduction — atomicity | **PASSED** | `convex/salesCore.ts:475-724` | The whole sale is one Convex mutation → atomic. |
| Insufficient stock prevented | **FAILED** | `convex/salesCore.ts:652-659`, `:680-684` | Negative stock is allowed **by design**; the shortfall is only recorded for offline sales. |
| Financial records — revenue | **PASSED** | `convex/financeCore.ts:319-352` | Revenue derived from `sales`, refunds netted off. No double counting with `sales.ts`. |
| Financial records — COGS cost basis | **PASSED** | `convex/financeCore.ts:208-263` | `stockCostHistory` → `bv` → `purchasePrice`, resolved as at the sale date. |
| Financial records — receivables | **PARTIAL** | `convex/finance.ts:1178-1184` | Receivables are the sum of a **mutable** `loans.balance` counter, not derived from movements. |
| Refund — authorisation | **PASSED** | `convex/sales.ts:1052`, `:1067-1070` | Separate `sales.refund` permission; branch-scoped. |
| Refund — stock returned to the right place | **FAILED** | `convex/sales.ts:1128-1134` | A shop sale's refund is credited to the **master warehouse**, not the shop. |
| Refund — cap on amount | **PASSED** | `convex/sales.ts:1098-1105` | Over-refund refused against `refundedItems`. |
| Refund — audit trail | **PASSED** | `convex/sales.ts:1158-1187` | `logActivity` + `writeAudit`. |
| Sale edit — total recomputed | **PASSED** | `convex/sales.ts:186-213` | Server recomputes; a mismatch is refused. |
| Sale edit — preserves financial history | **FAILED** | `convex/sales.ts:275-284` | The loan **and its `payments` rows are deleted**. |
| Concurrent sales of the same product | **PASSED (no lost update)** | `convex/salesCore.ts:670-685` | Read-modify-write is inside a single Convex mutation → serializable/OCC. But see POS-007 for the oversell consequence. |
| Sales history — tenant scoping | **PASSED** | `convex/sales.ts:32-49` | `requireTenant` + `by_businessId` index. |
| Sales history — pagination | **PARTIAL** | `convex/sales.ts:666`, `:714-722` | `continueCursor` is correct, but the search filter is applied **after** pagination. |

---

## 3. Recomputation appendix

All three examples below are **derived by reading the code**, not by executing it against a deployment.

### 3.1 The sale total (online)

**Formula as implemented** — `convex/salesCore.ts:558-596`:

```
computedTotal = Σ_lines  unitPrice(line) × quantity(line)

unitPrice(line) = stock.price                          (server master price)
                = priceOverride[stockId]               (only when allowPriceOverrides)
                  and only if override ≤ stock.price
```

`stock.price` is re-read from the `stocks` table (`convex/salesCore.ts:529-532`); the client's
`items[].price` is discarded (`convex/salesCore.ts:590-595` replaces `price`, `pv`, `bv` with the
server's values). The client-supplied `args.total` is then **compared**, not used
(`convex/salesCore.ts:608-613`):

```
totalDiffers = |computedTotal − args.total| > 0.01
if totalDiffers and NOT offline → throw "Sale total mismatch"
```

**Hand-worked example.** Product A: `stocks.price = 10 000`, `qty = 5`. Product B: `stocks.price = 2 500`, `qty = 4`.
A tampered client sends `items[].price = 1` for both lines and `total = 100`.

| | expected (server truth) | tampered client |
|---|---|---|
| Line A | 10 000 × 5 = 50 000 | 1 × 5 = 5 |
| Line B | 2 500 × 4 = 10 000 | 1 × 4 = 4 |
| **Total** | **60 000** | **100** |

`computedTotal = 60 000`. `|60 000 − 100| = 59 900 > 0.01` → **the sale is refused** with
`Sale total mismatch: client sent 100 but the server computed 60000` (`convex/salesCore.ts:610-612`).
**Expected: refused. Actual: refused. ✔ PASSED.**

### 3.2 The sale total (offline, `sync.pushTransactions`)

Same `applySale`, but `options.offline` is set (`convex/sync.ts:322-341`), so
`totalDiffers && !offline` is false and the mismatch no longer throws (`convex/salesCore.ts:609`).
The server's price wins:

- `sales.total` ← `computedTotal` (server truth) — `convex/salesCore.ts:695`
- `sales.clientTotal` ← the till's figure, **only when they differ** — `convex/salesCore.ts:714`
- `sync.pushTransactions` returns **both** `total` and `clientTotal` — `convex/sync.ts:377-378`

**Hand-worked example.** Same cart as §3.1, rung up offline when the till's price list was stale
(till believed A = 9 000, B = 2 400), server price is A = 10 000, B = 2 500.

| | server | till |
|---|---|---|
| Line A | 10 000 × 5 = 50 000 | 9 000 × 5 = 45 000 |
| Line B | 2 500 × 4 = 10 000 | 2 400 × 4 = 9 600 |
| Total | **60 000** | **54 600** |

Recorded: `sales.total = 60 000`, `sales.clientTotal = 54 600`. The books use **60 000** — the
server's price — which is the documented and correct behaviour. **PASSED**, with the caveat in
POS-005 (no price-drift record is raised, unlike a stock drift).

### 3.3 Refund

**Formula as implemented** — `convex/sales.ts:1098-1134`:

```
for each requested refund line:
    already    = Σ refundedItems[stockId].quantity
    if already + line.quantity > soldLine.quantity  → refuse
    amount     = soldLine.price × line.quantity        (price recorded on the original sale)
    refundTotal = Σ amount
    stocks[stockId].qty += line.quantity                ← ALWAYS the master warehouse
    stockLedger += { deltaQty: +line.quantity, eventType: "SALE_REFUND", shopId: sale.shopId }
```

**Hand-worked example.** Shop "MBR-101" sells 3 units of a product whose master `stocks.qty` is 100
and whose `shops.issuedStocks` entry is 20. The sale path (`convex/salesCore.ts:641-665`) deducted
the 3 units **from the shop**, leaving shop = 17, master = 100. The customer returns 1 unit.

| | master `stocks.qty` | shop `issuedStocks.qty` |
|---|---|---|
| before refund | 100 | 17 |
| expected after refund | 100 (unchanged — the unit was never in the warehouse) | 18 |
| **actual after refund** | **101** | **17** |

`convex/sales.ts:1128` patches the master stock unconditionally. The refund credits the warehouse
with a unit that never left it, and the shop is still short one. The `stockLedger` row it writes
carries `shopId: sale.shopId` (`convex/sales.ts:1133`), so the movement history says the **shop**
received the unit while the **master** balance moved. **FAILED — see POS-009.**

### 3.4 VAT on the receipt

**Formula as implemented** — `src/lib/vat.ts:26-36` (browser only):

```
net = round(gross / (1 + rate/100))
vat = round(gross) − net
```

**Hand-worked example.** gross = 60 000, rate = 18, inclusive = true.
`net = round(60 000 / 1.18) = round(50 847.46) = 50 847`; `vat = 60 000 − 50 847 = 9 153`.
Check: 50 847 × 0.18 = 9 152.46 ≈ 9 153. ✔ the arithmetic is right — but it runs **only in the
browser** (`src/app/(dashboard)/sales/page.tsx:674-679`), never on the server, and the `sales` table
stores no tax split (`convex/schema.ts:531-673`). **FAILED — see POS-004.**

---

## 4. Decisive answers

### 4.1 Can the client dictate a sale's total, price, tax or discount?

**No for the total. Yes for the unit price, and the tax is entirely the client's.**

Field-by-field, for `sales.create` / `sales.edit` / `sync.pushTransactions`:

| Input field | Server behaviour | Trusted? |
|---|---|---|
| `total` | Recomputed server-side from `stocks.price × quantity`; compared with a 0.01 tolerance; **refused** if different (online) | **Not trusted** |
| `items[].price` | Discarded; replaced by `stock.price` | **Not trusted** |
| `items[].quantity` | Validated `Number.isFinite && > 0`; used as sent | **Trusted, validated** |
| `items[].pv` / `items[].bv` | Discarded; replaced by `stock.pv` / `stock.bv` | **Not trusted** |
| `items[].name` / `productCode` | **Kept as sent** (`convex/salesCore.ts:590-591` spreads the client item) | **Trusted — see POS-008** |
| `items[].expectedQty` | Used only to compute offline stock-drift conflicts | Advisory |
| `priceOverrides[].price` | Honoured **only** when `business.allowPriceOverrides === true`; rejected only if **above** list price; **no floor** | **Trusted — see POS-001** |
| `customerId` | Loaded and checked against the tenant | Not trusted (validated) |
| `shopId` | Loaded and checked against the tenant; but the *shop actually used* is the one the caller is assigned to (`convex/salesCore.ts:616-620`) | Not trusted |
| `paymentMode` | Stored as sent | Trusted (see POS-013) |
| `initialDeposit` | Stored as sent; **not validated against the total** | **Trusted — see POS-010** |
| `paymentDueDate` | Stored as sent | Trusted |
| `clientOfflineId` | Used as the idempotency key, **if supplied** | **Optional — see POS-002** |
| tax / VAT | **There is no tax field on the sale at all** | **Not modelled — see POS-004** |
| discount | **There is no discount field on the sale at all** | **Not modelled — see POS-003** |

The `sales` row is therefore **not** a client-dictated amount: `sales.total` is always the server's
`computedTotal` (`convex/salesCore.ts:695`). The two real money risks are (a) the price-override
floor (POS-001) and (b) the fact that VAT is never computed or stored server-side (POS-004).

### 4.2 Is there a duplicate-sale / idempotency mechanism?

**Partially, and only for the offline path.**

- `applySale` checks `clientOfflineId` against the `by_clientOfflineId` index and returns the
  existing sale as `isDuplicateSync` (`convex/salesCore.ts:500-516`).
- `sync.pushTransactions` always sets `clientOfflineId: transactionId`
  (`convex/sync.ts:327`) and checks the same key before applying
  (`convex/sync.ts:~280-302`).
- **The online POS never sends `clientOfflineId`** — the payload built at
  `src/app/(dashboard)/sales/page.tsx:593-633` has no such field, and `sales.create`'s validator
  makes it optional (`convex/sales.ts:82`). A retried or double-clicked online sale therefore
  creates a **second** sale, a **second** stock deduction, and a **second** revenue entry.
- `by_clientOfflineId` is a **plain index**, not a unique constraint (`convex/schema.ts:671`);
  Convex has no unique index, so the offline guard is a read-then-write. It is safe in practice only
  because `generateInvoiceNumber` writes the same `counters` row in the same mutation, which
  serialises the two writers (`convex/salesCore.ts:166-179`). If the two pushes resolve to
  **different** `counters` rows (different shop serial prefixes), the serialisation point
  disappears. **See POS-002 / POS-003.**

---

## 5. Findings

### POS-001 — Till price override has no floor; any seller can zero the price

- **Module:** `convex/salesCore.ts` / `convex/sales.ts`
- **Severity:** HIGH
- **Description:** When a business enables `allowPriceOverrides`, the till may send any price per line. The server rejects only a price **above** the list price; there is no lower bound, no cost-price floor, no percentage cap and no per-role gate beyond the generic `sales.create` permission.
- **Static inspection:** `convex/salesCore.ts:541-549` (overrides collected), `convex/salesCore.ts:574-588` (`if (override > stock.price) throw` — only an upper bound); `convex/sales.ts:113-117` (the flag is business-wide); `convex/sales.ts:104` (`requirePermission(..., "sales.create")`).
- **Expected behavior:** A discount has an authorised ceiling (e.g. a percentage of list price, or a floor at cost price) and applying one beyond it requires a separate permission.
- **Actual behavior:** `priceOverrides: [{ stockId, price: 0 }]` is accepted and the line is sold for nothing. The audit trail exists (`sales.hasPriceOverride`, `sales.priceOverrides` with `originalPrice`, `convex/salesCore.ts:582-587`, `:722-723`) but the money is already gone.
- **Root cause:** The override validator only implements an upper bound; the business-level `allowPriceOverrides` flag carries no ceiling parameter and is not tied to a role.
- **Recommended fix:** Add `maxDiscountPercent` / `minPrice` to the business profile, clamp the override server-side, and require a dedicated permission (e.g. `sales.discount.apply`) plus an override reason when the ceiling is breached. Reject overrides below cost price outright.
- **Test required:** A mutation test asserting that an override of `0`, or one below `purchasePrice`, is rejected for a cashier and accepted (with audit) for a manager; and that the sale total reflects the clamped price.

### POS-002 — Online sales have no idempotency key: a retried request duplicates the sale

- **Module:** `convex/sales.ts` / `src/app/(dashboard)/sales/page.tsx`
- **Severity:** HIGH
- **Description:** `clientOfflineId` is the only idempotency mechanism, it is `v.optional` (`convex/sales.ts:82`), and the online POS client never sets it (`src/app/(dashboard)/sales/page.tsx:593-633`). A double-click, a network retry or a client-side re-submit produces two `sales` rows, two stock deductions and two revenue entries.
- **Static inspection:** `convex/sales.ts:82`; `convex/salesCore.ts:500-516` (the guard runs only `if (args.clientOfflineId)`); `src/app/(dashboard)/sales/page.tsx:593-633` (payload has no `clientOfflineId`); `convex/schema.ts:596`, `:671`.
- **Expected behavior:** Every sale carries a client-generated idempotency key; a repeated key returns the original sale and creates nothing new.
- **Actual behavior:** The key is optional and absent online, so the server has no way to recognise a repeat.
- **Root cause:** The idempotency mechanism was designed for the offline queue and was not extended to the online path.
- **Recommended fix:** Generate a UUID in the client for every sale attempt and always send it as `clientOfflineId`; make the key mandatory for `sales.create`; keep the existing lookup in `applySale`.
- **Test required:** Submit the same `clientOfflineId` twice to `sales.create` and assert one `sales` row, one stock deduction and one `stockLedger` row.

### POS-003 — Invoice numbers are not uniquely constrained and the prefix can collide

- **Module:** `convex/salesCore.ts`
- **Severity:** MEDIUM
- **Description:** `generateInvoiceNumber` derives the prefix from the shop's mutable `serialNumber` (`convex/salesCore.ts:153-161`) and keeps a counter per `businessId + prefix` (`:163-179`). There is no unique index on `sales.invoiceNumber` (`convex/schema.ts:670` is a plain index). An HQ sale uses the prefix `"HQ"` (`:153`), so a shop whose serial number starts with `HQ` (e.g. `HQ-101`) issues `HQ-001` from a **different** counter row → two different sales with the same invoice number.
- **Static inspection:** `convex/salesCore.ts:148-182`; `convex/schema.ts:670`.
- **Expected behavior:** Invoice numbers are unique per business, whatever the shop serial numbers are.
- **Actual behavior:** Uniqueness depends on shop serial prefixes being mutually distinct and on the `counters` rows never being reset or duplicated.
- **Root cause:** The counter key is derived from mutable user-facing data instead of a stable identifier (the shop id).
- **Recommended fix:** Key the counter on `businessId + shopId` (or on a dedicated per-business sequence) and prefix with a per-business token; add a uniqueness assertion at write time.
- **Test required:** Create a shop whose `serialNumber` is `HQ-101`, sell at HQ and at the shop, and assert the two invoice numbers differ.

### POS-004 — VAT is computed only in the browser; the sale record has no tax at all

- **Module:** `src/lib/vat.ts` / `src/app/(dashboard)/sales/page.tsx` / `convex/salesCore.ts`
- **Severity:** HIGH
- **Description:** `computeVat` exists only in `src/lib/vat.ts`; there is no VAT computation anywhere under `convex/` (searched for `computeVat|splitInclusive|splitExclusive|vatAmount|URA_VAT_RATE` — only `convex/verticals/tax.ts` and `convex/businesses.ts` deal with the *configuration*, not the amount). The `sales` table has no tax field (`convex/schema.ts:531-673`). The receipt's VAT split is computed in the browser from the business profile (`src/app/(dashboard)/sales/page.tsx:674-679`).
- **Static inspection:** `src/lib/vat.ts:59-69`; `src/app/(dashboard)/sales/page.tsx:674-679`; `convex/salesCore.ts:689-724` (no tax written); `convex/schema.ts:531-673`.
- **Expected behavior:** The server computes and stores the VAT split on the sale (rate, net, VAT) from the server-authoritative rate in `convex/verticals/tax.ts`, so a fiscal receipt cannot be falsified by a tampered client and the books can be reconstructed.
- **Actual behavior:** A tampered client can print any VAT figure it likes on the receipt; the stored sale contains only a tax-inclusive gross total with no tax component, so a URA return cannot be derived from the `sales` table alone.
- **Root cause:** Tax configuration was made server-authoritative (`convex/verticals/tax.ts:9-13`) but the amount was never moved server-side.
- **Recommended fix:** Add `taxRate`, `taxInclusive`, `taxAmount`, `netAmount` to the sale, computed in `applySale` from `business.taxRate` / `business.taxInclusive` and the server-side `stocks.price`, and have the receipt render the stored figures.
- **Test required:** A sale of 60 000 at 18% inclusive must store `taxAmount = 9 153` and `netAmount = 50 847`; a receipt rendered from a tampered client must still show the stored figures.

### POS-005 — No discount engine: the only "discount" is an unbounded price override

- **Module:** `convex/promotions.ts` / `src/lib/promo-evaluator.ts` / `convex/salesCore.ts`
- **Severity:** MEDIUM
- **Description:** The `sales` table and `SaleInput` have no discount field at all (`convex/salesCore.ts:71-96`, `convex/schema.ts:531-673`). The `promotions` model is prize-based ("buy N, get a prize"), not price-based — `processPromotionTriggers` only inserts `promotionRedemptions` rows (`convex/salesCore.ts:205-297`); it never reduces a price. A price reduction is therefore only expressible as a `priceOverride` (POS-001).
- **Static inspection:** `convex/salesCore.ts:205-297`; `src/lib/promo-evaluator.ts:59-175`; no `discount` field in `convex/schema.ts:531-673`.
- **Expected behavior:** Manual discounts are recorded as discounts (amount/percent, reason, approver) and capped server-side.
- **Actual behavior:** There is no first-class discount concept; a discount is indistinguishable from a price change unless the business has overrides enabled, and when it is disabled a till-level discount is simply refused.
- **Root cause:** Discount modelling was never implemented in the sale schema.
- **Recommended fix:** Model discounts as their own line item on the sale (amount, percent, reason, applied-by, approved-by) and evaluate them in `applySale` with a server-side ceiling.
- **Test required:** A sale with a 20% discount stores the discount on the sale row, and the discount survives into the finance summary without a price override.

### POS-006 — Promotion evaluation shown to the customer uses client-supplied PV/BV

- **Module:** `src/lib/promo-evaluator.ts` / `src/app/(dashboard)/sales/page.tsx`
- **Severity:** MEDIUM
- **Description:** The in-cart evaluator computes `totalPV`/`totalBV` from the **cart's** `pv`/`bv` (`src/lib/promo-evaluator.ts:64-65`), which are client-supplied values (`src/app/(dashboard)/sales/page.tsx:600-606`). The server recomputes the redemption count from the trusted `stocks.pv`/`stocks.bv` (`convex/salesCore.ts:593-594`, `:253-254`). The two can disagree.
- **Static inspection:** `src/lib/promo-evaluator.ts:64-65`, `:83`, `:118`, `:147`; `convex/salesCore.ts:253-254`, `:593-594`.
- **Expected behavior:** The rewards shown to the customer are the rewards the server will record.
- **Actual behavior:** A tampered client can inflate `pv` on a cart line and display unlocked rewards that the server will never honour.
- **Root cause:** The display path and the record path evaluate the same rule from two different sources of truth.
- **Recommended fix:** Return the server's evaluation (or the trusted `pv`/`bv`) to the client in the product/cart query rather than accepting them from the browser.
- **Test required:** A cart with a falsified `pv` shows the same rewards as the server records for the same cart.

### POS-007 — Oversell is not prevented at write time; stock may go negative

- **Module:** `convex/salesCore.ts`
- **Severity:** HIGH
- **Description:** Both the shop path (`convex/salesCore.ts:645-660`) and the HQ path (`:674-685`) subtract the sold quantity without comparing it to the quantity on hand. The comments state that negative stock is "allowed by design". The client has also removed its own check (`src/app/(dashboard)/sales/page.tsx:469`: *"Removed maxQty check to allow negative stock selling"*). Only **offline** sales produce a shortfall record (`detectStockConflicts`, `convex/salesCore.ts:379-421`, written to `stockConflicts` at `convex/sync.ts:344-358`); an **online** sale that oversells produces no conflict record at all.
- **Static inspection:** `convex/salesCore.ts:641-686`; `convex/salesCore.ts:636-638` (conflicts only when `offline`); `src/app/(dashboard)/sales/page.tsx:469-470`.
- **Expected behavior:** A sale is refused (or flagged and recorded) when the stock on hand is insufficient; online and offline behave the same way.
- **Actual behavior:** The quantity on hand is not consulted; the balance simply goes negative and, for an online sale, nothing is recorded to explain why.
- **Root cause:** The design decision to "never refuse a sale for want of stock" was applied to the online path without extending the conflict-recording mechanism to it.
- **Recommended fix:** Record a stock conflict for online sales too (`conflicts` is computed only for offline today), and surface negative balances on the inventory and low-stock views; where oversell must be refused, add an explicit `allowNegativeStock` setting.
- **Test required:** Sell 10 of 3 units on hand; assert `stocks.qty = -7` **and** that a conflict/exception row exists for the online path.

### POS-008 — Client-supplied product name and code are stored on the sale

- **Module:** `convex/salesCore.ts`
- **Severity:** LOW
- **Description:** `trustedItems` is built by spreading the client's item (`{ ...item, price, pv, bv }`, `convex/salesCore.ts:590-595`), so `name` and `productCode` remain whatever the client sent. These are then written to `sales.items` (`:699`), used in the `stockLedger` note (`:739`) and printed on the receipt.
- **Static inspection:** `convex/salesCore.ts:590-595`, `:699`, `:739`.
- **Expected behavior:** The product name and code recorded on a sale are the server's, as the price and cost are.
- **Actual behavior:** A tampered client can record a sale line under any name it likes; the money is unaffected, but the sale history, the ledger notes and the receipt can all be mislabelled.
- **Root cause:** The trusted-field list for a sale line covers the money fields only.
- **Recommended fix:** Set `name: stock.name` and `productCode: stock.productCode` in `trustedItems` alongside `price`, `pv` and `bv`.
- **Test required:** A sale submitted with a falsified `name` stores the server's product name.

### POS-009 — A refund of a shop sale credits the master warehouse, not the shop

- **Module:** `convex/sales.ts`
- **Severity:** HIGH
- **Description:** The sale path deducts a shop sale from `shops.issuedStocks` (`convex/salesCore.ts:641-665`) but the refund path always credits `stocks.qty` (`convex/sales.ts:1128`). The ledger row it writes claims `shopId: sale.shopId` (`convex/sales.ts:1133`), so the movement history attributes the return to the shop while the balance that actually moved is the master one.
- **Static inspection:** `convex/salesCore.ts:641-665` (sale deduction, shop); `convex/sales.ts:1128` (refund credit, master); `convex/sales.ts:1130-1142` (ledger row).
- **Expected behavior:** A refunded unit returns to the stock holder it was taken from.
- **Actual behavior:** The warehouse gains a unit that never left it and the shop remains short; the ledger and the balances disagree (see §3.3).
- **Root cause:** `refundSale` was written against the master stock table and does not branch on `sale.shopId`, unlike `applySale` and `editSale`.
- **Recommended fix:** In `refundSale`, credit `shops.issuedStocks` when `sale.shopId` is set (mirroring `convex/sales.ts:218-242`), and write the ledger row against the same holder.
- **Test required:** Sell at a shop, refund one unit, assert the shop's issued quantity is restored and the master `stocks.qty` is unchanged.

### POS-010 — `initialDeposit` is unvalidated and can exceed the sale total

- **Module:** `convex/salesCore.ts` / `convex/sales.ts`
- **Severity:** MEDIUM
- **Description:** `validateSaleInput` checks the total and the quantities but not `initialDeposit` (`convex/salesCore.ts:436-466`). The loan is then created with `balance: computedTotal − deposit` (`convex/salesCore.ts:758-768`) and a `payments` row for the deposit (`:772-783`). A deposit larger than the total produces a **negative** loan balance, a negative receivable in the financial summary (`convex/finance.ts:1178-1184`) and a credit sale that can never be settled: `customers.recordPayment` only considers loans with `balance > 0` (`convex/customers.ts:954`) and refuses any payment above that balance (`:957-961`).
- **Static inspection:** `convex/salesCore.ts:436-466` (no deposit check); `convex/salesCore.ts:758-783`; `convex/finance.ts:1178-1184`; `convex/customers.ts:953-961`.
- **Expected behavior:** The deposit is bounded by the sale total and by zero.
- **Actual behavior:** An unvalidated client field drives the loan balance, the receivable and the payment ledger.
- **Root cause:** The deposit is treated as trusted metadata rather than as a money field.
- **Recommended fix:** Validate `initialDeposit` server-side (`Number.isFinite`, `0 ≤ deposit ≤ computedTotal`) in `validateSaleInput`; clamp the loan balance at zero.
- **Test required:** A sale with `initialDeposit > total` is refused; a sale with `initialDeposit = total` creates a loan with balance 0.

### POS-011 — Editing a sale deletes the loan and its recorded payments

- **Module:** `convex/sales.ts`
- **Severity:** HIGH
- **Description:** `editSale` reverses the original loan by **deleting** the loan row **and every `payments` row attached to it** (`convex/sales.ts:275-284`), then re-creating a fresh loan and deposit (`:378-403`). Any repayment the customer has already made is destroyed, with no reversing entry, no audit row and no negative payment.
- **Static inspection:** `convex/sales.ts:275-284`; `convex/sales.ts:378-403`.
- **Expected behavior:** An edit reverses the sale's effects by posting compensating entries, so the money already received remains recorded and auditable.
- **Actual behavior:** Recorded customer payments are removed from the database; the customer's statement and the receivables figure both fall without any money having been returned.
- **Root cause:** The reversal was implemented as a physical delete rather than as compensating ledger entries.
- **Recommended fix:** Post a reversing `payments` row (negative amount) and set the original loan's balance to zero rather than deleting rows; write an audit entry for the reversal.
- **Test required:** Create a loan sale, record a repayment, edit the sale; assert the original repayment still exists as a reversing entry and the net customer balance is unchanged.

### POS-012 — `loans.makePayment` accepts a negative amount, inflating the receivable

- **Module:** `convex/loans.ts`
- **Severity:** HIGH
- **Description:** `makePayment` validates only that the resulting balance is not negative (`convex/loans.ts:405-406`). A **negative** `amount` therefore *increases* the balance (`newBalance = loan.balance − (−500)`) and writes a `payments` row with `amount: -500` (`convex/loans.ts:410-418`). The inflated loan balance flows straight into receivables (`convex/finance.ts:1178-1184`) and into the customer's outstanding balance (`convex/customers.ts:110-111`).
- **Static inspection:** `convex/loans.ts:405-418`; compare `convex/customers.ts:932-934`, which correctly rejects `amount <= 0`.
- **Expected behavior:** A payment must be greater than zero.
- **Actual behavior:** A negative payment increases the customer's debt and creates a negative payment record.
- **Root cause:** The two repayment mutations were written independently; only one of them validates the amount.
- **Recommended fix:** Add `if (!Number.isFinite(args.amount) || args.amount <= 0) throw` to `loans.makePayment`; better, retire `loans.makePayment` in favour of `customers.recordPayment`, which is the stricter, entitlement-gated path.
- **Test required:** `loans.makePayment` with `amount: -500` is refused and the balance is unchanged.

### POS-013 — Two competing repayment paths with different idempotency and authorisation

- **Module:** `convex/loans.ts` / `convex/customers.ts`
- **Severity:** MEDIUM
- **Description:** Customer money can be received through two mutations with different rules. `customers.recordPayment` requires the `customer.credit` entitlement (`convex/customers.ts:930`), caps the payment at the outstanding balance (`:957-961`), allocates oldest-first (`:966-990`) and refuses a repeated `reference` (`:941-951`). `loans.makePayment` requires only `loans.manage`, has **no** reference, **no** duplicate guard, **no** entitlement check and accepts a client-supplied `date` (`convex/loans.ts:384-418`). A payment row created by `loans.makePayment` also carries no `method`, so it is skipped by the payment-provider reconciliation (`convex/finance.ts:1003-1014` compares `payment.method` to the method being reconciled).
- **Static inspection:** `convex/loans.ts:384-432`; `convex/customers.ts:930-1023`; `convex/finance.ts:1003-1014`.
- **Expected behavior:** One way to take a customer's money, with the same validation, authorisation, idempotency and audit everywhere.
- **Actual behavior:** Two ways, with different strictness; the looser one can write payments that never appear in a reconciliation.
- **Root cause:** Parallel implementations of the same business action.
- **Recommended fix:** Make `customers.recordPayment` the single entry point; deprecate `loans.makePayment` (or make it delegate to it), and require a `method` on every payment row.
- **Test required:** A payment recorded through either path appears identically in the customer statement and in the reconciliation for its method.

### POS-014 — Payment dates are client-supplied and can be backdated

- **Module:** `convex/customers.ts` / `convex/loans.ts`
- **Severity:** MEDIUM
- **Description:** `customers.recordPayment` uses `args.date ?? new Date().toISOString()` (`convex/customers.ts:963`) and `loans.makePayment` uses `args.date` outright (`convex/loans.ts:415`). There is no bound on how far back a payment may be dated, so a payment can be placed in a reporting period that has already been closed or reconciled.
- **Static inspection:** `convex/customers.ts:963`; `convex/loans.ts:415`; compare `convex/salesCore.ts:309-329`, where offline *sales* are correctly bounded to 30 days back and 5 minutes forward (`MAX_OFFLINE_BACKDATE_DAYS`, `MAX_OFFLINE_FUTURE_MINUTES`).
- **Expected behavior:** Financial entries are dated by the server, or the client-supplied date is bounded and flagged.
- **Actual behavior:** A client can date a payment anywhere in the past.
- **Root cause:** The backdating guard was written for sales and never reused for payments.
- **Recommended fix:** Stamp the payment with the server time and, if the business needs a transaction date, store the client value separately and bound it (e.g. ± 48 hours).
- **Test required:** A payment dated 3 months ago is either refused or recorded with the server date as the authoritative one.

### POS-015 — Sales-history search filters after pagination

- **Module:** `convex/sales.ts`
- **Severity:** MEDIUM
- **Description:** `mySales` paginates the index query and then filters the returned page in memory by `searchTerm` (`convex/sales.ts:666`, `:714-722`). The `continueCursor` still advances over the whole index range, so a search can return empty or short pages while later pages contain matches that the user never sees.
- **Static inspection:** `convex/sales.ts:657-666` (the code comments acknowledge the limitation), `:713-727`.
- **Expected behavior:** A search returns all matching sales across pages.
- **Actual behavior:** A search returns an arbitrary subset, and pages can be silently short.
- **Root cause:** A text search over an indexed query was deferred; the workaround filters after pagination.
- **Recommended fix:** Add a `searchIndex` on `sales` (name/invoice number) and use `withSearchIndex` when `searchTerm` is present, or count-matching rather than page-matching.
- **Test required:** Search for a term that matches on page 3 of the unfiltered list; assert the search returns it.

### POS-016 — `mySales` is invisible to users who are not assigned to a shop

- **Module:** `convex/sales.ts`
- **Severity:** LOW
- **Description:** `mySales` looks up the shop the caller is assigned to and returns an empty, `isDone` page when there is none (`convex/sales.ts:597-610`). An owner or administrator who is not assigned to a shop sees no sales at all in this view.
- **Static inspection:** `convex/sales.ts:596-610`.
- **Expected behavior:** Either the view is explicitly a per-till view (and labelled as such), or privileged roles see business-wide sales.
- **Actual behavior:** The view silently returns nothing for HQ-only users.
- **Root cause:** The shop scoping was applied without a role-based fallback.
- **Recommended fix:** Fall back to the business-wide query for roles that are not shop-scoped, or rename the view to make its scope explicit.
- **Test required:** An owner with no shop assignment sees the business-wide sales list.

### POS-017 — An offline price difference is recorded but never surfaced as a conflict

- **Module:** `convex/salesCore.ts` / `convex/sync.ts`
- **Severity:** LOW
- **Description:** An offline sale whose till total differs from the server total is recorded with `clientTotal` (`convex/salesCore.ts:714`) and both figures are returned to the client (`convex/sync.ts:377-378`), but — unlike a stock drift — no `stockConflicts`-style record is written and no entry appears in the sync log reason. The difference is only visible by querying `sales.clientTotal` directly.
- **Static inspection:** `convex/salesCore.ts:714`, `:801`; `convex/sync.ts:344-358` (conflicts are stock-only), `:381-395`.
- **Expected behavior:** A price difference of the same order as a stock difference is recorded and reviewable.
- **Actual behavior:** It is stored on the sale but is not surfaced anywhere an operator will see it.
- **Root cause:** The conflict mechanism was designed for stock only.
- **Recommended fix:** Extend `stockConflicts` (or add a `priceConflicts` table) with the two totals, and include the count in the sync log.
- **Test required:** An offline sale with a stale price list produces a reviewable conflict record.

---

## 6. NOT IMPLEMENTED

| Item | Evidence | Note |
|---|---|---|
| A discount field on the sale | `convex/schema.ts:531-673`, `convex/salesCore.ts:71-96` | No discount concept; only price overrides (POS-005). |
| A tax/VAT field on the sale | `convex/schema.ts:531-673` | VAT is browser-only (POS-004). |
| Stock-availability enforcement at sale time | `convex/salesCore.ts:641-686` | Negative stock is explicit design (POS-007). |
| A unique index on `sales.invoiceNumber` | `convex/schema.ts:670` | Convex cannot express one; a uniqueness check must be written (POS-003). |
| A `continueCursor`-correct search over sales | `convex/sales.ts:657-666` | Deferred by the authors' own comment (POS-015). |

## 7. NOT TESTED

| Item | Reason |
|---|---|
| Two concurrent online sales of the same product | Needs two real writes against the live deployment; only the code path was read. |
| A retried online `sales.create` observed to create two sales | The absence of the key is proven statically; the duplicate was not reproduced. |
| Live PSP / webhook `paymentConfirmation` transition | Requires a real provider call; `convex/integrations/payments.ts` was read only. |
| Receipt rendering and thermal printing | Requires a printer; `src/components/ThermalReceipt.tsx` was read only. |
| Offline replay of the same queued transaction twice | Requires a live sync push; the guard was read at `convex/sync.ts:280-302`. |

## 8. Counts

**0 CRITICAL, 6 HIGH, 6 MEDIUM, 4 LOW, 0 INFORMATIONAL** — 16 findings (POS-001 … POS-017, of which POS-005/006 are MEDIUM).
