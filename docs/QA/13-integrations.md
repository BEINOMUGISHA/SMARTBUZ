# 13 — Integrations, Payments, Messaging and Industry Packages

**Commit audited:** `acafd2b`
**Scope:** `convex/integrations/` (14 files), `convex/packages/` (6 files),
`convex/http.ts`, `src/app/(dashboard)/integrations/page.tsx`, `src/lib/mobile-money.ts`,
`src/lib/hardware/*`, `docs/INTEGRATIONS.md`.

---

## 1. The adapter framework

The design principle is stated in the framework's own header and it is the right one:

> *An adapter must have been proved against the real provider — "configured" is not "works".*

### 1.1 The contract

`convex/integrations/types.ts` defines:

| Concept | Meaning |
|---|---|
| `VerificationStatus` | `unverified` → `configured` → `verified`, or `failed` |
| `AdapterDescriptor` | The catalogue entry: key, label, category, fields, verification guide, limitations |
| `AdapterVerificationGuide` | How the business proves it works — the method, what it requires, the provider's documentation |
| `PaymentStatus` | `pending` / `succeeded` / `failed` |
| `PaymentInitiation` | What a provider is asked to do |
| `MessageChannel` | `sms` / `whatsapp` / `email` |

Every adapter declares its own **limitations** up front — *"Limits that are true today, stated up
front rather than discovered"*. That is the right instinct: a business reads what the adapter
cannot do before it relies on it, not after.

### 1.2 The catalogue

**16 adapters** are registered:

| Category | Adapters |
|---|---|
| **Payments** | `mtn.momo`, `airtel.money`, `card.flutterwave`, `card.paystack`, `card.stripe` |
| **Banking** | `bank.statement` (import), `bank.transfer` |
| **Messaging** | `sms.generic`, `whatsapp.meta`, `email.resend` |
| **Hardware** | `hardware.barcode`, `hardware.thermal_printer`, `hardware.cash_drawer`, `hardware.scale` |

Plus four provider implementations under `convex/integrations/providers/`
(`mobileMoney.ts`, `cards.ts`, `messaging.ts`).

### 1.3 The enforcement point

`prepareAdapterCall` (`convex/integrations/internal.ts`) resolves the tenant, checks a
permission, loads the configuration, decrypts the secrets, and — critically — refuses unless
the adapter is **verified**:

```ts
// convex/integrations/payments.ts:112-120
const prepared = await ctx.runQuery(
    internal.integrations.internal.prepareAdapterCall,
    {
        businessId: args.businessId,
        adapterKey: args.adapterKey,
        permission: "sales.create",
        requireVerified: true,
    }
);
```

`requireVerified: true` on `initiatePayment` and on `sendMessage`. `verifyPaymentWithProvider`
uses `requireVerified: false`, because asking a provider whether a payment arrived is exactly
what you must be able to do when the provider is not yet trusted.

**Assessment: the design is right.** The problem is that the function which records the proof
is itself unguarded — see **C-02** in report 09 and **C-03**.

---

## 2. Payments

### 2.1 The rule

`convex/integrations/payments.ts:8-18`:

> **A payment is confirmed by the provider, never by the browser.**
>
> *When a cashier starts a mobile-money collection, the money has not been taken. The customer
> still has to enter their PIN. The sale is therefore left at `pending_verification` — exactly
> as an offline sale is — and it only moves to `confirmed` when the provider's own callback
> arrives, or when a status query against the provider says so.*

The sale carries `paymentReference`, and the receipt says *"Mobile Money (to confirm)"*.

### 2.2 Idempotency

`paymentReference()` (`convex/integrations/payments.ts:53-60`) produces
`SBZ-PAY-<base36 timestamp>-<8 hex characters>` — 32 bits of platform randomness plus a
millisecond timestamp. The reference is:

* sent to the provider as the idempotency key;
* stored against the intent, indexed by `by_reference`;
* checked before a collection is started, so a retry after a timeout returns the existing
  intent rather than taking the money twice (`:124-141`).

**M-49 (Low).** 32 bits of randomness is thin for a value that can confirm money. The
timestamp contributes some entropy, but the reference is not a secret in the way a session
secret is — it appears on receipts and in provider dashboards. Increasing the random portion to
16 bytes would cost nothing.

### 2.3 The callback

`convex/integrations/webhooks.ts:189-259` (`paymentCallback`) — see report 10 for the full
walk-through. The design is correct: reference lookup, signature verification, constant-time
comparison, a `failed` record when it refuses.

**M-50 (Medium).** When no webhook secret is configured, the callback is accepted on the
reference alone, with a recorded warning (`convex/integrations/webhooks.ts:152-158`):

> *"No webhook secret is configured for this adapter, so the callback was accepted on its
> reference alone. Set a webhook secret to check the signature as well."*

The reference is the only thing standing between an attacker and a forged payment
confirmation. The adapter's own `limitations` should say so, and the interface should push the
business to set a secret.

### 2.4 The confirmation path is open — H-01

`confirmPayment` (`:324-397`) is a public mutation with no authentication. Detailed in report
04 and report 09.

---

## 3. Messaging

| Adapter | Transport |
|---|---|
| `sms.generic` | An HTTP SMS gateway with a URL template |
| `whatsapp.meta` | The Meta WhatsApp Cloud API |
| `email.resend` | Resend |

`sendMessage` (`convex/integrations/messaging.ts:80-190`) requires `messages.send` and
`requireVerified: true`, and records the outcome either way — a failed send is written to the
message log with its error, not swallowed (`:146-163`).

Templates live in `convex/integrations/templates.ts` — receipts, payment reminders — and
`reconciliation.ts` handles the bank statement import and matching.

**Assessment: good.** The message log records both successes and failures, with the provider's
own message id.

---

## 4. Hardware

`convex/integrations/hardware.ts` holds the server-side registry of hardware devices.
`src/lib/hardware/` holds the browser drivers:

| Driver | Mechanism | Status |
|---|---|---|
| `barcode.ts` | Keyboard-wedge (USB scanners that type) | Works in the browser |
| `printer.ts` | Web Serial (USB/Bluetooth serial adapters) | Browser only |
| `drawer.ts` | The ESC/POS drawer kick pulse | Browser only |
| `scale.ts` | `parseScaleLine` — parses a weighing scale's serial output | Parsing only |

**H-03 (Medium).** There is no camera-based scanning anywhere. The keyboard-wedge driver works
with most USB scanners, but not with a phone camera, and not with a Bluetooth scanner that does
not present itself as a keyboard. For the target market — a phone as the till — this is a real
gap. The mobile branch implements a camera scanner; it is not merged and has not been run.

---

## 5. Industry packages

`convex/packages/` holds five modules:

| Package | What it adds |
|---|---|
| `supermarket.ts` | Bulk sales, pack pricing via `unitsPerPack`, promotions, weighing scales |
| `restaurant.ts` | Table management, kitchen display, menu management, order tracking |
| `pharmacy.ts` | Batch tracking, expiry dates, prescription workflows, controlled drugs |
| `wholesaler.ts` | Bulk pricing, customer-specific prices, credit accounts, distribution |
| `manage.ts` | Enabling and configuring a package for a business |

`convex/packages/registry.ts` is the catalogue. `convex/packages/manage.ts` turns a package on
for a business — **modular and configurable**, exactly as the brief asked: a retailer does not
have a pharmacy's batch-tracking table in its interface.

`convex/verticals/` holds the broader vertical modules (members and wallets, operations,
scheduling, tax).

**Assessment: good.** These are genuine extensions on the shared tables rather than
re-implementations of the sale or the stock. `tests/integrations.test.ts` (73 tests) covers the
registry, the price resolution (`resolvePrice`), the restaurant state machine
(`canTransition`) and the supermarket and pharmacy packages.

---

## 6. What was removed, and why it matters

Phase 9 deleted `src/app/api/momo/route.ts` and rewrote `src/lib/mobile-money.ts` and
`src/components/mobile-money-modal.tsx` to call the real adapter.

The deleted route **fabricated a transaction identifier and never called a provider**. It
looked like a mobile-money integration and moved no money. Its removal is one of the most
important things in this audit's history: it is the difference between a demo and a product.

The replacement calls `api.integrations.payments.initiatePayment`, which enforces the
verification gate, and the sale now carries `paymentReference` and stays `pending_verification`
until a provider confirms it. The receipt prints *"(to confirm)"*.

**This is the standard the rest of the framework should be held to, and C-02 is a violation of
it.**

---

## 7. Verification honesty

`docs/INTEGRATIONS.md` carries a verification matrix, and **every adapter is marked NOT
VERIFIED**. No adapter has been tested against a real provider, because no provider account
was available and no real device was available.

That honesty is the correct position and it should be preserved. **But it makes C-02 worse**:
the "verified" state is currently *unreachable by legitimate means* (there is no verified
adapter to copy from) while being *reachable by an unauthenticated caller*. The one field that
is supposed to be impossible to forge is the easiest one to write.

---

## 8. Findings

| ID | Severity | Finding |
|---|---|---|
| **C-02** | **Critical** | `saveTestResult` lets an unauthenticated caller mark an adapter "verified" |
| **C-03** | **High** | `recordEvent` / `recordMessage` / `recordPaymentOutcome` / `recordCallback` write into any business |
| **H-01** | **High** | `confirmPayment` can be called without authentication |
| M-50 | Medium | A callback with no configured secret is accepted on the reference alone |
| H-03 | Medium | No camera-based barcode scanning |
| M-49 | Low | The payment reference carries only 32 bits of randomness |
| — | Good | The verification gate is in the right place and is enforced by `prepareAdapterCall` |
| — | Good | The payment confirmation rule is right and is applied to the sale and the receipt |
| — | Good | Idempotent references |
| — | Good | The framework is modular and configurable |
| — | Good | Every adapter's limitations are stated up front |
| — | Good | No adapter is claimed to work until it is proved |
| — | Good | The fabricating `/api/momo` route was removed |
