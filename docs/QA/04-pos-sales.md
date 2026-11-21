# 04 — Point of Sale and the Sales Engine

**Commit audited:** `acafd2b`
**Scope:** `convex/salesCore.ts`, `convex/sales.ts`, `convex/promotions.ts`,
`src/app/(dashboard)/sales/page.tsx`, `src/lib/vat.ts`, `src/lib/escpos.ts`,
`src/components/ReceiptTemplate.tsx`.

---

## 1. The central design decision

There is exactly one implementation of "apply a sale to the books": `applySale` in
`convex/salesCore.ts`. Both paths call it —

* `sales.create` — a sale made with the network up;
* `sync.pushTransactions` — a sale made while offline, arriving later.

The module's own header explains why:

> *A sale that arrives late must be recorded exactly as if it had arrived on time: the same
> prices, the same total, the same stock movement, the same promotion triggers. If the two paths
> were written separately they would drift apart within a release, and the books would stop
> matching the tills.*

**This is the correct architecture and it is implemented correctly.** `tests/offline.test.ts`
(45 tests) exercises both paths and asserts they agree.

---

## 2. Money is never trusted from the client

`convex/salesCore.ts:522-596` is the part of the system that matters most:

| Client sends | Server does | Evidence |
|---|---|---|
| `items[].price` | Ignores it; re-reads `stocks.price` | `:573` |
| `items[].pv`, `bv` | Ignores them; re-reads `stock.pv`, `stock.bv` | `:593-594` |
| `items[].quantity` | Validated: finite and greater than zero | `:569-571` |
| `items[].stockId` | Checked against the tenant | `:564-568` |
| `total` | Recomputed from the server prices | `:589` |
| `priceOverrides` | Accepted **only** when the business has enabled overrides, and never above the list price | `:542-588` |
| `paymentMode` | Interpreted by the server to decide payment confirmation | `resolvePaymentConfirmation`, `:715-719` |

The total mismatch rule is well judged (`convex/salesCore.ts:598-613`):

* A **live** sale whose total does not add up is **refused**. Nothing has happened yet, so the
  cashier can be told straight away.
* An **offline** sale whose total does not add up is **still recorded**, at the server's price,
  with the difference kept in `clientTotal` so it can be explained. Refusing it would lose a real
  sale that the customer has already paid for.

**Assessment: good.** This is the behaviour a careful payments team would ask for.

---

## 3. Payment confirmation — the rule, and where it leaks

The rule is stated plainly in `convex/integrations/payments.ts:8-18`:

> **A payment is confirmed by the provider, never by the browser.**

`resolvePaymentConfirmation` (`convex/salesCore.ts:338`) maps the payment mode to
`confirmed` / `pending_verification`. Cash is confirmed; a mobile-money, bank transfer, card or
cheque payment is not, until a provider says so.

**H-01 (High) — the rule can be bypassed.** The mutation that actually performs the confirmation,
`confirmPayment` (`convex/integrations/payments.ts:324-397`), is a **public mutation with no
authentication and no permission check**. A caller who knows a payment `reference` and its
`businessId` can:

* set `confirmedByProvider: true` on the intent (`:361`);
* move the sale's `paymentConfirmation` to `"confirmed"` (`:372-375`);
* write an `integrationEvents` row that reads as though the provider confirmed it (`:386-389`).

The same file's `recordPaymentOutcome` (`:232-310`) is likewise public and unauthenticated; it
can insert a payment intent for **any** business, or patch the status of an existing one.

The legitimate callers of `confirmPayment` are the webhook handler (which verifies the signature
first) and `verifyPaymentWithProvider` (which checks the `payments.verify` permission). Both are
correct. The defect is that the function itself trusts its caller.

**Recommendation:** make `confirmPayment` an `internalMutation`, reachable only from the
webhook action and from the permission-checked action. Convex actions can call internal
mutations; a browser cannot.

---

## 4. Stock

### 4.1 Deduction

Stock is deducted from the branch's issued stock when the cashier belongs to a shop, and from
the main warehouse otherwise (`convex/salesCore.ts:640-686`). A branch sale cannot draw on a
product the branch was not issued (`convex/salesCore.ts:646-649`).

### 4.2 Negative stock is permitted — M-13 (Medium)

`convex/salesCore.ts:651-659` and `:680-684` both allow the quantity to go negative, and the
comment says it is deliberate:

> *Negative stock is allowed by design, so a sale that has already happened is never refused for
> want of stock. The shortfall is recorded as a conflict instead.*

The reasoning is sound **for an offline sale**. But the same rule is applied to a **live** sale,
where nothing has been consumed and the till is online — the cashier could simply sell stock the
business does not have, and the books would show a negative quantity with no conflict recorded,
because `detectStockConflicts` only runs when `offline` is true (`convex/salesCore.ts:636-638`).

**Recommendation:** for a live sale, refuse the sale when the branch has no stock (or record it
as an explicit "oversell" that a manager can see). Keep the permissive behaviour for offline
sales, where the goods have already gone.

### 4.3 The stock ledger — good

Every sale line writes an immutable row to `stockLedger` with the delta, the event type, the
reference and the actor (`convex/salesCore.ts:728-741`). Stock movements are therefore
reconstructable, and the ledger is tenant-scoped.

---

## 5. Conflicts

`detectStockConflicts` (`convex/salesCore.ts:379-421`) distinguishes two cases:

| Kind | Meaning |
|---|---|
| `insufficient` | There was never enough stock. A human must settle the difference. |
| `drift` | The till's belief was out of date but there was enough. A warning. |

This is the right distinction, and it matches the browser offline engine's own vocabulary
(`src/lib/offline/sync.ts`).

---

## 6. Invoice numbering — good

`generateInvoiceNumber` (`convex/salesCore.ts`) keeps a per-business, per-prefix counter
(`counters` table, indexed `by_businessId_name`). Two businesses may both issue `MBR-001`
without colliding. The counter row is read and incremented inside the mutation, so it is
serialised by Convex's single-writer-per-document rule.

**M-14 (Low).** The counter is incremented before the sale is inserted. If the insert then
fails, the number is burnt. That is harmless — a gap in the invoice sequence is normal in
accounting — but worth knowing.

---

## 7. Refunds

`refundSale` (`convex/sales.ts:1038-1191`) is carefully done:

| Check | Evidence |
|---|---|
| Tenant | `:1051` |
| Permission (`sales.refund`) | `:1052` |
| The sale belongs to this business | `:1058-1062` |
| At least one line | `:1063-1065` |
| Branch manager restricted to their branches | `:1067-1070` |
| Cumulative refunds cannot exceed what was sold | `:1098-1105` |
| The stock belongs to this business | `:1108-1113` |
| The refund amount is computed on the server from the price actually charged | `:1115-1118` |

**L-05 (Low).** Three lines in this function contain a literal U+FFFD replacement character
(`convex/sales.ts:1032`, `:1101`, `:1165`) where an em dash was intended. Line 1101 is a
**customer-facing error message**:

```
Cannot refund 2 of Sugar � only 1 remain on this sale.
```

The bytes are `ef bf bd` — a corrupted character committed into the source. Cosmetic, but it is
in a message a cashier reads.

---

## 8. Tax (URA VAT)

`src/lib/vat.ts` implements the Ugandan regime:

* standard rate 18%;
* prices are normally **VAT-inclusive**, so the VAT is extracted for reporting;
* exempt and zero-rated goods carry 0%;
* everything is rounded to whole shillings.

| Function | Behaviour |
|---|---|
| `splitInclusive(gross, rate)` | `net = gross / (1 + rate/100)`; `vat = gross − net` |
| `splitExclusive(net, rate)` | `vat = net × rate/100`; `gross = net + vat` |
| `computeVat(gross, enabled, rate, inclusive)` | Dispatches, or returns zero when disabled |
| `formatUgx(amount)` | `en-UG` thousands separators |

**Assessment: good.** The rounding is deliberate — VAT is reported in whole shillings and the
difference lands in the VAT figure, not in the net.

**M-15 (Medium).** The VAT profile is read on the sales page
(`vatProfile?.taxEnabled`, `taxRate`, `taxInclusive`) but the *server* does not recompute or
store the VAT split on the sale. The receipt shows `netAmount`/`vatAmount` derived on the
client. A tampered client can therefore present a VAT figure that does not match the sale
total. The sale's `total` is protected; the VAT breakdown is not.

---

## 9. Receipts

`src/lib/escpos.ts` compiles a receipt into raw ESC/POS bytes: a header, the invoice number,
date, cashier, customer, the line items, the totals, the payment mode, promotions and a
footer. `buildThermalReceipt` is deterministic and is used by both the browser's Web Serial path
and the mobile printer adapter.

The receipt says what it means:

* `paymentLabel` — the label under PAYMENT MODE distinguishes *"Cash"*, *"Mobile Money (to
  confirm)"* and *"Mobile Money (not confirmed)"*. **A receipt never claims the money arrived
  when nobody knows that it did.**
* A note line can be added for offline sales.

---

## 10. The till interface

`src/app/(dashboard)/sales/page.tsx` is a large client component. It handles the cart, the
customer, the discount, the promotion triggers, the VAT profile and the receipt. It reads
`useActiveCategory` so the same page reads "Product" for a wholesaler and "Item" for a
pharmacy.

**M-16 (Medium).** The till is one very large client component with the cart, the payment
dialog, the receipt and the promotion logic in the same file. It works, but the file is the
hardest thing in the client to change safely, and there is no test at the component level.

---

## 11. Summary

| Area | Assessment |
|---|---|
| One implementation of a sale | **Good** |
| Server-side price and total validation | **Good** |
| Price-override rules | **Good** |
| Offline price difference handling | **Good** |
| Stock ledger | **Good** |
| Refunds | **Good** |
| Invoice numbering | **Good** |
| Payment confirmation rule | **Right in principle, bypassable in practice (H-01)** |
| Negative stock on a live sale | **Permitted — should not be (M-13)** |
| Server-side VAT split | **Not enforced (M-15)** |
| Till component structure | **One very large file (M-16)** |
| Corrupted characters in a user-facing message | **Present (L-05)** |
