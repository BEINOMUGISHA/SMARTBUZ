# SMARTBUZ v2.0 — 14 · Integration Test Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Scope:** PART 13 — Third-party integrations: mobile money, card payments, email, SMS/messaging, push notifications, hardware peripherals, cloud storage/backup, webhooks, reconciliation, and credential handling.

---

## 1. Method

| Aspect | Detail |
|---|---|
| Inspected | `convex/integrations/**` (config, engine, hardware, internal, manage, messaging, payments, reconciliation, registry, templates, types, webhooks + `providers/{cards,mobileMoney,messaging,types}.ts`), `convex/http.ts`, `src/lib/mobile-money.ts`, `src/lib/email.ts`, `src/lib/escpos.ts`, `src/lib/hardware/**`, `src/app/api/send-reset-email/route.ts`, `src/app/api/auth/send-verification/route.ts` |
| Ran | `npm test` (local only); a full scan of every public Convex function for authorization guards, cross-checked by hand |
| Not run | Any provider call — no sandbox credentials, no funded test account. All provider behaviour is assessed statically. |
| Live probes | None against payment providers. The live deployment was only read (JWKS, bundle inspection). |

---

## 2. Integration status matrix

| Integration | Status | Evidence | Notes |
|---|---|---|---|
| MTN MoMo | **SANDBOX-IMPLEMENTED** | `convex/integrations/providers/mobileMoney.ts:47,61,138,193` | Real MTN collection endpoints; sandbox is the **default** unless `targetEnvironment` is set to `live` |
| Airtel Money | **SANDBOX-IMPLEMENTED** | `providers/mobileMoney.ts:99,111` | Separate sandbox and production base URLs |
| Card payments (Flutterwave) | **SANDBOX-IMPLEMENTED** | `providers/cards.ts:82,128,158,235,359` | `FLUTTERWAVE_SANDBOX_BASE`; `isLive()` requires an explicit `environment === "live"` (`:438`) |
| Email (Resend) | **PRODUCTION-READY CODE, NOT VERIFIED LIVE** | `src/lib/email.ts:100-129` | Correctly reports "not configured" instead of pretending to send |
| SMS (Africa's Talking) | **SANDBOX-IMPLEMENTED** | `providers/messaging.ts:143-171` | Real `api.africastalking.com` endpoint |
| SMS (generic) | **IMPLEMENTED** | `providers/messaging.ts:54-56` | Generic HTTP adapter |
| WhatsApp Cloud | **SANDBOX-IMPLEMENTED** | `providers/messaging.ts:248-279` | Real Cloud API payload shape |
| Push notifications | **NOT IMPLEMENTED** | repository-wide search for `pushnotif|expo-notifications|fcm|apns|deviceToken` → **no match** | No token table, no delivery path |
| Cloud storage | **NOT IMPLEMENTED** | repository-wide search for `storage|s3|bucket` → no integration | Reports export as Excel/PDF only |
| Backup / restore | **NOT IMPLEMENTED** | repository-wide search for `backup` in `src/ convex/ scripts/` → **no match** | No export-to-file-of-record, no restore path |
| Receipt printers | **IMPLEMENTED (browser transport only)** | `src/lib/escpos.ts:258`, `src/lib/hardware/printer.ts` | Web Serial / WebUSB; no network or Bluetooth transport |
| Barcode scanner | **IMPLEMENTED (keyboard wedge)** | `src/lib/hardware/barcode.ts` | No camera scanning |
| Cash drawer | **IMPLEMENTED** | `src/lib/hardware/` | Cannot be auto-verified from a browser (correctly handled, `hardware.ts:236-238`) |
| Scale | **IMPLEMENTED** | `src/lib/hardware/` | |
| Bank statement reconciliation | **IMPLEMENTED** | `convex/integrations/reconciliation.ts:332-655` | Import → match → manual match → settle; operator-driven |
| Webhook reception | **IMPLEMENTED** | `convex/http.ts:18-22`, `convex/integrations/webhooks.ts` | HMAC-SHA256 with constant-time compare |

**Nothing here is production-verified.** No provider credential was available in the audit environment, so
every "real" integration is verified only as far as its code, its payload shape and its endpoint constants.

---

## 3. Findings

### INT-01 — `recordProviderError` is a public mutation with no authorization check
- **ID:** INT-01 · **Module:** Payments · **Severity:** **HIGH**
- **Description:** `convex/integrations/payments.ts:498-519` is a public Convex mutation. It takes `businessId`, `adapterKey`, `reference` and `error` and inserts an `integrationEvents` row — with **no `requireTenant`, no `requirePermission`, no session check and no server secret**. Any unauthenticated caller can write into any tenant's event log, with any content, at any rate. The written rows are `direction: "outbound"`, `kind: "payment_lookup_failed"`, `status: "failed"` — so they pollute the payment-failure history of a business the caller does not belong to.
- **Steps to reproduce:** Static inspection of the complete handler (`convex/integrations/payments.ts:498-519`). A live proof would write to production and was therefore not performed.
- **Expected behavior:** Only a caller who is a member of the business may record a provider failure for it, and only for an adapter that business has configured.
- **Actual behavior:** Any anonymous caller may insert arbitrary rows into any tenant's `integrationEvents` table.
- **Root cause:** The "record what happened" helper was written as a client-callable mutation without the tenant guard that the rest of the module uses.
- **Recommended fix:** Require the tenant and the `integrations.manage` permission, exactly as `saveAdapterConfig` does (`convex/integrations/manage.ts:198-209`). If the intent is for the *server* to record failures, convert it to an `internalMutation` so only other Convex functions can call it.
- **Test to verify the fix:** A test asserting that calling `recordProviderError` without a valid session is rejected, and one asserting that a member of business A cannot write an event for business B.

### INT-02 — `recordMessage` is a public mutation with no authorization check
- **ID:** INT-02 · **Module:** Messaging · **Severity:** **HIGH**
- **Description:** `convex/integrations/messaging.ts:192-230` inserts a `messages` row from a public mutation. Like INT-01, there is no `requireTenant`, no permission check and no server secret, and `businessId` is caller-supplied. The inserted row carries a recipient address, a message body, a channel and a status — so an anonymous caller can write arbitrary messages into any tenant's message history.
- **Steps to reproduce:** Static inspection of `convex/integrations/messaging.ts:192-230`.
- **Expected behavior:** Messages are recorded only by the server, or by a member of the business the message belongs to.
- **Actual behavior:** Any anonymous caller can insert arbitrary message records into any tenant.
- **Root cause:** Identical to INT-01 — a recording helper was exposed as a public mutation.
- **Recommended fix:** Make it an `internalMutation` if the server is the only legitimate recorder; otherwise require the tenant and the `integrations.manage` permission. Apply the same treatment to any sibling helper in the messaging module.
- **Test to verify the fix:** A test asserting that an unauthenticated call is rejected, and that a caller from business A cannot record a message for business B.

### INT-03 — `reportHardware` can register hardware against any tenant
- **ID:** INT-03 · **Module:** Hardware · **Severity:** **MEDIUM**
- **Description:** `convex/integrations/hardware.ts:213-273` is a public mutation. The *update* branch correctly checks ownership (`existing.businessId !== args.businessId` → "Forbidden: that device belongs to another business", `:243-246`), but the *create* branch inserts a `hardwareDevices` row for whatever `businessId` the caller supplies (`:261-273`) with no authentication. An anonymous caller can therefore register printer/scanner/drawer/scale devices into another tenant's device list, marked `configured` (or `verified` for hardware the browser can confirm).
- **Steps to reproduce:** Static inspection of `convex/integrations/hardware.ts:213-273` — note that the ownership check at `:243-246` is inside the `if (recordId)` branch only.
- **Expected behavior:** A device record is created only for the caller's own business.
- **Actual behavior:** A device record can be created for any business id.
- **Root cause:** The ownership check was written for the update path and not applied to the insert path.
- **Recommended fix:** Require the tenant (`requireTenant` + `integrations.manage`) at the top of the handler, and check `args.businessId` against the resolved tenant before inserting.
- **Test to verify the fix:** A test asserting that creating a device for another business is refused.

### INT-04 — A payment callback is accepted on its reference alone when no webhook secret is configured
- **ID:** INT-04 · **Module:** Payments / webhooks · **Severity:** **MEDIUM**
- **Description:** `verifyWebhookSignature` returns `ok: true` when the adapter has no secret, with the reason *"the callback was accepted on its reference alone"* (`convex/integrations/webhooks.ts:152-157`). The callback route is deliberately unauthenticated (`convex/http.ts:18-22`), so the reference is the only credential in that configuration. The reference is a 4-byte random value (`convex/integrations/payments.ts:53`) — short enough to enumerate at volume, and it is echoed in provider dashboards and in logs.
- **Steps to reproduce:** Static inspection of `convex/integrations/webhooks.ts:147-179` and `:189-260`. A live proof needs a real payment reference.
- **Expected behavior:** A callback that cannot be authenticated is refused, or the adapter cannot be activated without a secret.
- **Actual behavior:** The adapter silently degrades to reference-only authentication.
- **Root cause:** A convenience fallback for unconfigured adapters.
- **Recommended fix:** Refuse callbacks for secret-less adapters and require the secret at configuration time (`saveAdapterConfig` should reject a webhook adapter without one). Raise the reference to at least 128 bits. Log every degraded acceptance as a warning.
- **Test to verify the fix:** A test asserting a secret-less adapter's callback is refused, and that configuration cannot save without a secret.

### INT-05 — Every payment adapter defaults to sandbox, and nothing surfaces that to the operator
- **ID:** INT-05 · **Module:** Payments / mobile money · **Severity:** **MEDIUM**
- **Description:** `isLive` is true only when the adapter configuration explicitly says `environment === "live"` (`convex/integrations/providers/cards.ts:438`) or `targetEnvironment === "live"` (`providers/mobileMoney.ts:61,138,193`); the default is sandbox. The `sandbox` flag is recorded on the payment intent and returned to the caller (`convex/integrations/payments.ts:149,170,191,212,222`), but the operator-facing UI does not present it as a warning. A business that configures credentials, never flips the switch and takes money will transact against sandbox endpoints: the collection "succeeds", the sale completes, and no real money moves.
- **Steps to reproduce:** Configure an adapter without selecting the live environment, then initiate a payment → the call goes to the sandbox base URL and reports success. (Not executed — it requires provider credentials.)
- **Expected behavior:** A live deployment either defaults to live, or displays an unmistakable "SANDBOX" banner while an adapter is in sandbox mode.
- **Actual behavior:** Silent sandbox operation.
- **Root cause:** Sandbox-first is a sensible default for development and was never surfaced to production users.
- **Recommended fix:** Show a persistent "sandbox" badge in the integrations screen and on the till while any payment adapter is in sandbox mode; refuse to enable a sandbox adapter for a business whose subscription is active, or at least warn on configuration.
- **Test to verify the fix:** A test asserting the integrations screen renders a sandbox warning when a payment adapter is unconfigured for live mode.

### INT-06 — There is no automatic repair for a payment that fails after the customer was charged
- **ID:** INT-06 · **Module:** Payments · **Severity:** **MEDIUM**
- **Description:** `initiatePayment` (`convex/integrations/payments.ts:73-231`) calls the provider and records the outcome. When the provider call itself fails or times out, the failure is recorded (`recordProviderError`, `:498`) and the sale is left pending; the customer may already have been debited. There is no background retry, no scheduled reconciliation against provider records, and no operator-facing queue of "charged but unconfirmed" payments. The `integrationEvents` table records what happened; nothing acts on it.
- **Steps to reproduce:** Static inspection of `convex/integrations/payments.ts:73-231` and `:498-519`; there is no scheduler in the codebase (no `convex/crons.ts`).
- **Expected behavior:** A retry or a reconciliation job that matches provider settlements against local payment intents, and a visible queue of unmatched payments.
- **Actual behavior:** A silent pending state.
- **Root cause:** The integration layer was built as request/response; long-running reconciliation was never added. (Bank *statement* reconciliation exists in `convex/integrations/reconciliation.ts`, but it is operator-driven and covers statements, not provider settlements.)
- **Recommended fix:** Add a scheduled job that re-queries provider settlement records and resolves pending payment intents, plus an operations screen listing payments that are charged but unconfirmed. The `integrationEvents` table already provides the audit trail to drive it.
- **Test to verify the fix:** A test that marks a payment intent pending, runs the reconciliation job with a stubbed provider response, and asserts the intent is resolved.

### INT-07 — Push notifications are not implemented
- **ID:** INT-07 · **Module:** Notifications · **Severity:** **LOW**
- **Description:** No push notification capability exists: a repository-wide search for `pushnotif|expo-notifications|fcm|apns|deviceToken` returns nothing, there is no push-token table among the 93 tables, and `convex/integrations/messaging.ts` covers only SMS, WhatsApp and email. A cashier on a phone receives no notification of a stock conflict, an offline sync conflict or a payment failure.
- **Steps to reproduce:** Repository-wide search (no match).
- **Expected behavior:** Push delivery for the events the platform already detects (sync conflicts, payment failures).
- **Actual behavior:** Nothing.
- **Root cause:** Out of scope when the messaging module was written.
- **Recommended fix:** Add a `pushTokens` table, a registration mutation and a delivery path reusing the existing `MessagingProvider` interface, so the channel model does not need changing. Low priority — the mobile client does not exist yet (see `13_MOBILE_TEST_REPORT.md`).
- **Test to verify the fix:** A test that registers a token and asserts a conflict produces a push delivery record.

### INT-08 — There is no backup or restore path for a business's data
- **ID:** INT-08 · **Module:** Data resilience · **Severity:** **MEDIUM**
- **Description:** A search of `src/`, `convex/` and `scripts/` for `backup` returns no match. The platform has no export of a business's data to a portable file of record, and no restore procedure. The only exports are presentation-level (Excel/PDF for individual reports, `src/lib/export.ts`, `src/lib/export-utils.ts`). Data lives in a single Convex deployment, so a mistaken deletion, a bad migration or a corruption event is unrecoverable from the application's own facilities. The `convex/migration.ts` module (a tenant-facing, deployment-wide write tool — see `07_TENANT_ISOLATION_REPORT.md`) makes this materially worse.
- **Steps to reproduce:** Repository-wide search for `backup` → no match.
- **Expected behavior:** A scheduled, encrypted export of each business's data to a portable archive, and a documented restore procedure.
- **Actual behavior:** None.
- **Root cause:** Never designed.
- **Recommended fix:** Add a scheduled export job producing a per-business JSON/CSV archive (Convex can export via scheduled functions), store it encrypted with the existing `convex/crypto.ts` helpers, and document the restore procedure in the operations runbook.
- **Test to verify the fix:** A test that exports a seeded business and asserts the archive contains every table's rows for that business, and that a restore recreates an equivalent dataset.

### INT-09 — The email path has no rate limit
- **ID:** INT-09 · **Module:** Email · **Severity:** **MEDIUM**
- **Description:** `src/lib/email.ts` behaves correctly when unconfigured — it returns `null` rather than pretending to send (`src/lib/email.ts:106-109`), and the API route turns that into *"Email delivery is not configured on this server."* (`src/app/api/send-reset-email/route.ts:63`) rather than a false success. But neither the reset nor the verification endpoint throttles requests, so an unauthenticated caller can drive Resend spend and flood a victim's mailbox. (Cross-reference: `06_SECURITY_AUDIT.md` SEC-03, which covers the same endpoints from the security side.)
- **Steps to reproduce:** Static inspection of `src/app/api/send-reset-email/route.ts` and `src/app/api/auth/send-verification/route.ts` — no limiter present.
- **Expected behavior:** A per-address cooldown and a per-IP cap, applied server-side.
- **Actual behavior:** Unlimited.
- **Root cause:** The rate limiter was written for login only.
- **Recommended fix:** Apply the backend-backed limiter proposed in SEC-01 to both endpoints, with a per-address cooldown of at least 60 seconds.
- **Test to verify the fix:** A test asserting the second request for the same address within the cooldown is refused with 429.

---

## 4. Controls verified as sound

| Control | Status | Evidence |
|---|---|---|
| Integration secrets never reach the browser | **PASSED** | Every accessor is an `internal*` function: `convex/integrations/internal.ts:69,198,242,268,323,448,466` — Convex internal functions cannot be called from a client |
| Decrypted secrets are not returned by any public query | **PASSED** | `convex/integrations/internal.ts:29-32,53-56` — the `secrets` field exists only on the internal result type |
| A client cannot self-report a successful payment | **PASSED** | `confirmPayment` is an `internalMutation` (`convex/integrations/payments.ts:324`); only `verifyPaymentWithProvider` (an action that actually calls the provider, `:405`) calls it, at `:477` |
| Payment initiation is tenant-scoped and permission-checked | **PASSED** | `initiatePayment` resolves tenant, permission `sales.create` and adapter readiness in one internal call (`convex/integrations/payments.ts:112-120`) |
| A payment reference cannot be reused by another business | **PASSED** | `convex/integrations/payments.ts:134-139` — "Forbidden: that payment reference belongs to another business." |
| An adapter must be *verified*, not merely configured | **PASSED** | `requireVerified: true` at `convex/integrations/payments.ts:118` |
| Webhook signatures are verified with a constant-time compare | **PASSED** | `convex/integrations/webhooks.ts:147-179` (HMAC-SHA256 over the raw body, `safeEqual`) |
| Adapter configuration is tenant-scoped and permission-checked | **PASSED** | `convex/integrations/manage.ts:198-209` (`requireTenant` + permission) |
| Receipt printing failures fall back to browser printing | **PASSED** | `src/components/ReceiptModal.tsx:81-88` — a Web Serial failure falls back to `window.print()` with a toast, rather than silently claiming success |
| The cash drawer is not falsely auto-verified | **PASSED** | `convex/integrations/hardware.ts:236-238` — a drawer cannot be confirmed from a browser, so its report is never taken at face value |

---

## 5. NOT IMPLEMENTED

| Item | Evidence |
|---|---|
| Push notifications | No dependency, no token table, no delivery path |
| Cloud storage / object storage | No integration in `convex/integrations/` |
| Backup and restore | No `backup` code anywhere in `src/`, `convex/`, `scripts/` |
| A scheduled reconciliation worker | No `convex/crons.ts`; reconciliation is operator-driven |
| Bluetooth / network receipt printing | Only Web Serial / WebUSB transports (`src/lib/escpos.ts:258`) |
| Camera-based barcode scanning | Keyboard-wedge only (`src/lib/hardware/barcode.ts`) |
| Production-verified provider behaviour | No sandbox credentials were available in the audit environment |

## 6. NOT TESTED

| Item | Reason |
|---|---|
| Any live provider call (MTN, Airtel, Flutterwave, Africa's Talking, WhatsApp, Resend) | Requires credentials and creates external side effects |
| Webhook signature acceptance/rejection against a real provider | Requires a live provider secret |
| The full mobile-money collection-and-confirm cycle | Requires a funded sandbox account |
| SMS/WhatsApp template rendering with real template data | The template engine was read statically (`convex/integrations/templates.ts`) |
| Receipt printing against real hardware | Requires a thermal printer |

---

## 7. Counts

**INT-01** HIGH · **INT-02** HIGH · **INT-03** MEDIUM · **INT-04** MEDIUM · **INT-05** MEDIUM ·
**INT-06** MEDIUM · **INT-07** LOW · **INT-08** MEDIUM · **INT-09** MEDIUM

**Counts: 0 CRITICAL, 2 HIGH, 5 MEDIUM, 1 LOW, 0 INFORMATIONAL**

---

## 8. Verdict

The integration layer is **genuinely well built where it matters**: real provider adapters with correct
payload shapes and endpoint constants, encrypted credential storage that provably cannot leak to the
browser, a payment-confirmation path that only a real provider response can trigger, tenant-scoped
configuration, and a device-adapter contract that requires verification before use. This is not a mock
layer dressed up as an integration layer — the code is written to talk to the real APIs.

The defects are consistent and narrow: **three recording helpers (`recordProviderError`, `recordMessage`,
`reportHardware`) were exposed as public mutations without the tenant guard the rest of the module uses**
(INT-01 to INT-03), so anonymous callers can write into tenants' tables. None of them grants privilege or
reads data — they corrupt event logs rather than steal records — but they are cross-tenant writes and
should be closed quickly, most cheaply by converting the two recorders to `internalMutation`.

The second theme is **operational honesty** (INT-05, INT-06): the platform defaults every payment adapter
to *sandbox* and never says so to the operator, and it has no mechanism to notice that a payment was
collected but never confirmed. For a business taking real money, both are unacceptable as they stand.
