# SMARTBUZ — Integrations and Industry Packages

Phase 9 gives SMARTBUZ an **integration adapter layer**: one way to add a
payment provider, a messaging channel or a piece of till hardware, and one
set of rules that every integration obeys. It also adds four **industry
packages** — supermarkets, restaurants, pharmacies and wholesalers — that
a business switches on or off.

---

## The rule this phase is built around

> **Do not claim an integration is functional until real provider or
> hardware testing has been completed.**

This is not a disclaimer in the documentation. It is built into the code:

| Mechanism | Where |
|---|---|
| Every adapter starts in the state `unverified` | `convex/integrations/registry.ts` |
| Only a **live test** against the real provider can reach `verified` | `convex/integrations/engine.ts` |
| An adapter that is not `verified` **may not move money or send a message** | `convex/integrations/internal.ts` |
| A payment is confirmed by the **provider**, never by the browser | `convex/integrations/payments.ts` |
| Hardware reports **what it actually did**, never what it assumed | `src/lib/hardware/` |
| Every adapter states what it **does not do** | the registry's `limitations` |

The badge on the Integrations page therefore means exactly one thing:

- **Verified** — a live test reached the real provider and it answered.
- **Configured** — the credentials are saved, but nobody has made a real
  call with them.
- **Not verified** — nothing has been tested. Where every adapter starts.
- **Failed** — a live test was attempted and the provider refused it.

**No adapter in SMARTBUZ has passed a live test yet.** They have been
written against each provider's published API and their code paths are
covered by tests, but nobody has run them against MTN's sandbox, Airtel's
sandbox, a real Resend account, a real thermal printer, or a real cash
drawer. They are therefore all marked *not verified*, and the table at the
bottom of this document says exactly what each one needs.

---

## The architecture

```
convex/integrations/
  types.ts             the contract — what an adapter is
  registry.ts          the catalogue — every adapter that exists
  config.ts            where credentials live, and when an adapter may be used
  internal.ts          the internal bridge — actions have no database
  engine.ts            dispatch, the live test, the audit trail
  manage.ts            what the interface reads and writes
  payments.ts          collections, confirmation, reconciliation of intents
  messaging.ts         sending, receipts, reminders, the message log
  reconciliation.ts    statement import and matching
  webhooks.ts          the provider's callback
  hardware.ts          the register of till hardware
  providers/
    types.ts           the provider contract
    mobileMoney.ts     MTN, Airtel
    cards.ts           Flutterwave, Paystack, Stripe
    messaging.ts       SMS, WhatsApp, email

convex/packages/       the four industry packages
src/lib/hardware/      the browser half — barcode, printer, drawer, scale
src/app/(dashboard)/integrations/   the page
```

### One contract, every integration

An adapter is a value in a registry. It declares the same things whatever
it is:

- what it is called and what it does,
- what the business must configure,
- **how it proves it works**,
- **what it does not do**.

The behaviour lives behind two small interfaces — `PaymentProvider` and
`MessagingProvider` — so adding a fifth payment gateway is one entry in
the registry and one file beside it, not a new pattern across the
codebase.

### Why there is an `internal.ts`

In this Convex version an **action has no database**. `fetch` is only
allowed in an action, and an action can only read the database by calling
a query.

So the adapters live in actions, and they need three things before they
may call a provider: the caller's tenant, the caller's permission, and
the adapter's decrypted credentials. `convex/integrations/internal.ts`
resolves all three in one internal query.

Those functions are **internal** on purpose. A public query can be
called by anyone who can reach the deployment, so a public query that
returned decrypted credentials would be a hole straight through the
encryption.

### Credentials

Provider secrets are encrypted with AES-GCM before they are stored, using
a key derived from the server secret with PBKDF2 and a per-secret salt.
The plaintext never leaves the server: it is decrypted for the duration of
one call and is never returned to the browser.

The interface can tell an owner that a key **is present**. It can never
read one back. Changing a secret puts the adapter back to `configured` —
not `verified` — because a changed credential has not been tested.

> **A deployment that matters must set `SMARTBUZ_SERVER_SECRET`.** Without
> it the encryption falls back to a public constant, which is fine for a
> developer's machine and useless for real credentials.

---

## Payments

### The rule

**A collection request is not a payment.** The customer still has to enter
their PIN. A sale taken through a provider stays `pending_verification`
until the provider's own callback arrives, or a status query against the
provider says otherwise — exactly as an offline sale behaves.

The reference is ours, is sent to the provider as its idempotency key, and
is stored against the intent. A retry after a timeout cannot take the
money twice, and a second push with the same reference is recognised and
refused.

### What each provider does

| Adapter | How it collects | How it is confirmed |
|---|---|---|
| `mtn.momo` | MTN Collections request-to-pay | MTN's callback, or a status query |
| `airtel.money` | Airtel Collections request | Airtel's callback, or a status query |
| `card.flutterwave` | Hosted checkout page | Flutterwave's callback, or a status query |
| `card.paystack` | Hosted checkout page | Paystack's callback, or a status query |
| `card.stripe` | Hosted checkout page | Stripe's callback, or a status query |
| `bank.statement` | Reads a statement file | The reconciliation, matched against the books |
| `bank.transfer` | Records a transfer | A statement line |

### The callback

`POST /payments/callback` is the one address a provider may call. It is
unauthenticated by nature — a provider is not a signed-in member of
staff — and is authenticated instead by:

1. **The reference.** The callback must name a payment SMARTBUZ actually
   started, and that payment must still be waiting for a result. A
   callback naming a reference nobody issued is refused.
2. **The signature**, when the business has set a `webhookSecret`. The
   callback must carry a matching HMAC-SHA256 of its own body under
   `x-smartbuz-signature`, or it is refused.

> The signature scheme each provider actually uses on its callbacks must
> be confirmed against that provider's own documentation during live
> testing. Until then, an adapter with no webhook secret accepts
> callbacks on the reference alone, and says so in its limitations.

### What was changed, and why

The old `/api/momo` route has been **removed**. It never called a
provider: it logged the request and invented a transaction id. And
`initiateMoMoPush` in the client returned

```ts
{ success: true, transactionId: `TXN-${Date.now()}`, status: "PENDING" }
```

**even when the request had failed** — so the till told the cashier
"Prompt sent! Customer should enter PIN" for a push that was never sent.

Now the prompt is sent by the payment adapter on the server, which refuses
to run unless the adapter has been proved against the real provider, and
the sale carries the provider's reference so that it stays *awaiting
confirmation* rather than being marked paid by the cashier's word.

---

## Messaging

| Adapter | Channel | Notes |
|---|---|---|
| `sms.generic` | SMS | Any HTTP gateway — you give it the URL, key and body format |
| `sms.africasTalking` | SMS | Africa's Talking, with delivery receipts |
| `whatsapp.cloud` | WhatsApp | Meta's Cloud API, from a business phone number |
| `email.resend` | Email | Resend, from a verified domain |

### What "sent" means

**Sent** means the gateway accepted the message for delivery. It does not
mean the customer read it, and in some cases it does not even mean the
message left the country — a carrier can reject it afterwards. The
message log records the gateway's own answer and nothing more.

### What is included

- **Receipts** — built from the sale as the server holds it (the stored
  prices, the stored total), sent to a contact the customer has on file.
  Never to a number typed at the till.
- **Payment reminders** — for credit accounts that are overdue, worked out
  from the loans and payments rather than a stored balance that could
  drift. A reminder run reports exactly how many were sent, how many
  failed and which accounts had no contact details.

Templates live in `convex/integrations/templates.ts` and are plain data
with named holes. A hole with no value is left visible and reported, so a
receipt never says "Balance: undefined".

---

## Hardware

| Device | How it is reached | How it is proved |
|---|---|---|
| Barcode scanner | Keyboard wedge — it types the barcode | Scanning a real barcode and seeing the right product |
| Thermal printer | Web Serial / Web USB, ESC/POS | Printing a test receipt and reading it off the paper |
| Cash drawer | The printer's drawer pulse | A person confirming the drawer opened |
| Weighing scale | Web Serial, or over HTTP | Putting a known weight on it and comparing |

### What the software cannot know

- **A printer cannot read its own paper.** A successful write means the
  bytes went to the printer. Only a person can confirm the receipt came
  out right.
- **A cash drawer cannot report that it opened.** Its status line is a
  serial pin that the Web Serial API cannot watch. Every drawer result
  says `verified: false` and asks the operator to look.
- **A scale cannot say whether it is calibrated.** A scale reading a kilo
  too heavy gives a price a kilo too high, and nothing can detect it. The
  shop must check it against a known weight.

The hardware register therefore keeps a `verified` state that **only a
person can set**.

The browser reports what it actually supports — Web Serial, Web USB,
Bluetooth — so the interface can say why a button is greyed out rather
than failing obscurely.

---

## Industry packages

Packages are **data, not code**. Each one declares its features and its
settings in `convex/packages/registry.ts`, and the behaviour lives in the
module beside it. A business switches a package on and off and chooses
its settings; it never has to be told which code to run.

**Turning a package off never deletes anything.** It stops the business
using it. Kitchen tickets stay where they are, prescriptions stay on
file, price lists stay as they were.

### Supermarket

Bulk sales (unit and pack size on every product), barcode scanning,
weighing scales and promotions.

- Prices by weight are per unit of weight. A missing or impossible weight
  gives zero, never a broken number.
- A barcode belongs to **one** product. Setting a barcode that is already
  in use is refused.
- Limitations: no barcode generation, no shelf labels, no coupon codes,
  no loyalty scheme, no time-of-day pricing.

### Restaurant

Table management, menu management, kitchen display and order tracking.

- A kitchen ticket carries **its own copy** of the lines. A dish added
  after the food is cooking goes on a new ticket, so what the kitchen is
  cooking never changes underneath them.
- A ticket moves forwards only (`queued → preparing → ready → served`),
  and may always be **cancelled** — a customer who walks out must not
  leave a ticket cooking.
- The menu hides what is sold out *and* what has run out of stock.
- Limitations: no splits, no split bills, no tips, no ordering of the
  dishes within a ticket.

### Pharmacy

Batch tracking, expiry dates, prescription workflows and expiry alerts.

- Stock comes out of the batch that **expires first**, and expired
  batches are skipped.
- **A prescription is never silently short.** What could not be filled is
  recorded and the prescription is marked `partially_dispensed` — never
  `dispensed` when it was not.
- Limitations: no interaction checking, no dose validation, no legal
  prescription form, no separate controlled-drug register.

### Wholesaler

Bulk pricing, customer-specific pricing, credit accounts and distribution.

- A **customer's own price wins** over a volume tier. Among tiers, the
  **highest band the quantity reaches** wins. When nothing applies, the
  product's own price is charged.
- **The server's price always wins.** Every price is recomputed on the
  server from the stored lists. A tampered till cannot charge less than
  the books say.
- A credit account's balance is derived from the loans and payments, never
  from a stored figure that could drift.
- Limitations: tiers apply to the whole sale rather than per line, no
  interest or penalty rate, deliveries carry the customer and status but
  not the individual lines, one currency only.

---

## The verification matrix

**Nothing in this table has been tested against a real provider or a real
device.** Every row is *not verified*. This table is what has to happen
before each row may say otherwise.

### Payments

| Adapter | Status | What has to happen | Needs |
|---|---|---|---|
| `mtn.momo` | **NOT VERIFIED** | Fetch a sandbox collection token; then make a sandbox collection and confirm the callback arrives | An MTN MoMo API subscription (sandbox), subscription id, API user/key/password, a public HTTPS callback host |
| `airtel.money` | **NOT VERIFIED** | Fetch a sandbox collections token; then make a sandbox collection and confirm the notification arrives | An Airtel Africa account with collections enabled, client id/secret/key, a public HTTPS callback host |
| `card.flutterwave` | **NOT VERIFIED** | List the merchant's payment accounts; then complete a hosted checkout and confirm the callback | A Flutterwave merchant account, the secret key, a public HTTPS callback host |
| `card.paystack` | **NOT VERIFIED** | List the merchant's transactions; then complete a hosted checkout and confirm the callback | A Paystack merchant account, the secret key, a public HTTPS callback host |
| `card.stripe` | **NOT VERIFIED** | Read the account balance; then complete a checkout and confirm the callback | A Stripe account with payments enabled, the secret key, a public HTTPS callback host |
| `bank.statement` | **NOT VERIFIED** | Import a real statement and check every line is matched or listed as unmatched | A statement from the business's own bank; the column names it uses |
| `bank.transfer` | **NOT VERIFIED** | Settle one real transfer against a statement | The business's bank account details |

### Messaging

| Adapter | Status | What has to happen | Needs |
|---|---|---|---|
| `sms.generic` | **NOT VERIFIED** | Send one SMS to a number the business controls and read it | An HTTP SMS gateway account, the endpoint, key and body format, a test number |
| `sms.africasTalking` | **NOT VERIFIED** | Read the account, then send one SMS and read it | An Africa's Talking account with SMS enabled, username and API key, a test number |
| `whatsapp.cloud` | **NOT VERIFIED** | Read the phone number, then send one message and read it | A Meta Business account with the WhatsApp API, a phone number and id, a permanent token, an approved template |
| `email.resend` | **NOT VERIFIED** | List the domains, then send one email and read it | A Resend account with a verified domain, the API key, a from address on that domain |

### Hardware

| Device | Status | What has to happen | Needs |
|---|---|---|---|
| Barcode scanner | **NOT VERIFIED** | Scan a product in the till and confirm the right product comes up | A HID keyboard-wedge scanner, a barcode on a product, the barcode on the product itself |
| Thermal printer | **NOT VERIFIED** | Print a test receipt and read it off the paper | An ESC/POS printer, a desktop Chrome or Edge browser |
| Cash drawer | **NOT VERIFIED** | Open the drawer and confirm it opens | A cash drawer wired to a compatible ESC/POS printer |
| Weighing scale | **NOT VERIFIED** | Put a known weight on the scale and compare it with the reading | A scale connected to the till, a weight the business knows the value of |

### Industry packages

| Package | Status | What has to happen |
|---|---|---|
| Supermarket | **NOT VERIFIED** | Scan and weigh a real sale; run a real promotion |
| Restaurant | **NOT VERIFIED** | Fire a real order and watch it move through the kitchen |
| Pharmacy | **NOT VERIFIED** | Dispense against real batches and watch the expiry order |
| Wholesaler | **NOT VERIFIED** | Sell at a tier and at a customer's own price, and settle a credit account |

---

## Permissions

Eight permissions were added. They are in the one canonical catalogue in
`convex/rbac.ts`, and every role's grant matrix was updated with them.

| Permission | What it allows |
|---|---|
| `integrations.view` | See the catalogue, what is configured and how far each is tested |
| `integrations.manage` | Set credentials and settings, and switch adapters on or off |
| `integrations.test` | Run a live test against a provider |
| `payments.verify` | Confirm a payment the provider has reported |
| `messages.view` | Read the message log |
| `messages.send` | Send receipts, reminders and other messages |
| `hardware.manage` | Configure the till's hardware |
| `industry.manage` | Switch industry packages on and off |

`integrations.test` is separated from `integrations.manage` on purpose: a
live test makes a real call to a provider, and on some providers that
costs money.

---

## What is deliberately absent

- **No Background Sync API.** It is not in Safari and is inconsistent
  elsewhere. The offline engine uses a heartbeat and a tick.
- **No client-side trust checks.** Everything that moves money or changes
  a balance is decided on the server.
- **No data is deleted when a subscription ends** — and nothing is deleted
  when an integration is switched off either. The payments, messages and
  events an adapter produced stay in the business's history.
- **No credentials in the browser.** Not masked, not truncated — absent.
