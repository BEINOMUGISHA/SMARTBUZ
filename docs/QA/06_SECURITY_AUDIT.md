# SMARTBUZ v2.0 — 06 · Security Audit

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Live production:** `https://smartbuz.vercel.app` · **Live backend:** `affable-panda-681.convex.cloud`
**Audit mode:** read-only, with five non-destructive live probes (documented in §2).

---

## 1. Security model as implemented

| Layer | Mechanism | Evidence |
|---|---|---|
| Identity | RS256 JWT minted by the Next server, verified by Convex against the deployment's own JWKS | `src/lib/convex-token.ts`, `convex/auth.config.ts:24-34`, `convex/http.ts:7` |
| Caller authority | `ctx.auth.getUserIdentity()` only — never a client-supplied email or user id | `convex/tenancy.ts` |
| Tenant isolation | `requireTenant` / `requirePermission` / `assertSessionLive` on every business-scoped path | `convex/tenancy.ts` |
| Session | HttpOnly, `Secure` in production, `SameSite=Lax`, server-side session row, only a SHA-256 hash of the secret stored | `src/lib/session.ts:139-143`, `convex/users.ts` |
| Passwords | bcrypt, cost 10 | `convex/users.ts:192,388,537,1439,1694` |
| Verification / reset codes | bcrypt-hashed, time-limited, single-use (`usedAt`), attempt-capped | `convex/users.ts:220-225,356-357,441-455,508-542` |
| Money | Server re-reads prices from `stocks` and recomputes the total; a client total mismatch is refused | `convex/salesCore.ts:522-613` |
| Platform scope | `requirePlatformRole` / `requirePlatformPermission` | `convex/platform.ts:35-36`, `convex/license.ts:89`, `convex/plans.ts:118` |
| Integration secrets at rest | AES-GCM + PBKDF2, constant-time compare | `convex/crypto.ts` |
| Webhook authenticity | HMAC-SHA256 over the raw body, constant-time compare | `convex/integrations/webhooks.ts:147-179` |
| Audit trail | `convex/audit.ts`, `activityLogs`, `syncLogs` | `convex/audit.ts`, `convex/sync.ts:438-467` |

---

## 2. Live verification performed

Five probes were sent against production. No record was created, modified or deleted; no session was
left open.

| # | Probe | Target | Result |
|---|---|---|---|
| 1 | `POST /api/auth` with `admin@pos.com / password123` | Next.js login route | 401 `Invalid email or password` — the seeded admin account is **not** active in production |
| 2 | `POST /api/auth` with `sales@pos.com / password123` | Next.js login route | 401 — not active |
| 3 | `POST /api/auth` with `stock@pos.com / password123` | Next.js login route | 401 — not active |
| 4 | `POST <convex>/api/mutation` `path: "users:login"` with a non-existent address | Convex backend, directly | **200 — the mutation executed and returned a credential error, unauthenticated and unthrottled** (see SEC-01) |
| 5 | `curl -sI` against production pages | Edge | `Strict-Transport-Security` present (added by Vercel at the edge). `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` — **absent** (see SEC-04) |

---

## 3. Controls verified as sound

| Control | Status | Evidence |
|---|---|---|
| The browser cannot forge an identity | **PASSED** | Forged, foreign-issuer and expired tokens all rejected by the live backend (`scripts/verify-identity.mjs`, 8/8) |
| The client cannot dictate a sale's price or total | **PASSED** | `convex/salesCore.ts:528-613` — prices re-read from `stocks`, total recomputed, mismatch refused for live sales |
| A client cannot reference another tenant's data | **PASSED** | `convex/salesCore.ts:487,564-567`; `convex/sync.ts:540`; `convex/shops.ts:378-380` |
| Secrets are not in the client bundle | **PASSED** | `src/lib/session.ts`, `src/lib/convex-token.ts`, `src/lib/email.ts` are imported only by API routes and `src/middleware.ts` — no client component imports them |
| Verification codes are not returned to the browser | **PASSED** | `convex/users.ts:245-248` — the code is returned only when the caller presents the server secret |
| Password reset does not leak account existence | **PASSED** | `convex/users.ts:435` returns `{ success: true }` for an unknown address; the API route returns the same |
| Password reset is single-use, expiring and attempt-capped | **PASSED** | `convex/users.ts:508-542` (`usedAt`, `expiresAt`, `MAX_RESET_ATTEMPTS`) |
| Platform and billing actions require platform permission | **PASSED** | `convex/platform.ts:213,276`, `convex/billing.ts:259-262` |
| Subscription activation requires a server-verified payment | **PASSED** | `convex/subscriptions.ts:446-500` — only a `subscriptionPayments` row with `status === "verified"` activates a plan |
| Session cookie flags | **PASSED** | `src/lib/session.ts:139-143` — `httpOnly`, `secure` in production, `sameSite: "lax"`, `path: "/"` |
| No unsafe DOM injection of user data | **PASSED** | `dangerouslySetInnerHTML` appears only in static `<style>` blocks (`src/components/ReceiptModal.tsx:97`, `ReceiptTemplate.tsx:60`, `ThermalReceipt.tsx:25`) and in the Recharts wrapper (`src/components/ui/chart.tsx:83`) |
| No file-upload surface | **PASSED** | No multipart/file-write handling anywhere in `src/` or `convex/` |
| External links open safely | **PASSED** | `src/app/(dashboard)/integrations/page.tsx:500` uses `rel="noreferrer"` |

---

## 4. Findings

### SEC-01 — The password check is a public, unthrottled backend mutation; the application's rate limiter is bypassable
- **ID:** SEC-01
- **Module:** Authentication
- **Severity:** **CRITICAL**
- **Description:** `users:login` (`convex/users.ts:376-424`) is a public Convex mutation. It requires no access token, no server secret and no proof of anything: it takes an email and a password and compares them (`convex/users.ts:388`). There is **no attempt counter, no lockout and no throttle anywhere on this path**. The only rate limit in the system is an in-memory map in the Next.js route (`src/app/api/auth/route.ts:52-63`, 8 attempts per email per 15 minutes). That limiter protects only the *Next.js route* — the Convex deployment URL is public (it is embedded in the client bundle and visible to every visitor), so the same mutation can be called directly, completely bypassing the limiter:
  ```
  POST https://affable-panda-681.convex.cloud/api/mutation
  {"path":"users:login","args":{"email":"…","password":"…"},"format":"json"}
  ```
  Probe 4 in §2 confirms this: the call executed unauthenticated and returned the credential error. The contrast with the rest of the codebase is stark — `users:resetPassword` caps attempts on a 6-digit code (`convex/users.ts:516-521`), and `users:changePassword` requires the current password (`convex/users.ts:1671-1690`); the primary brute-force target has neither.
- **Steps to reproduce:** Send the request above with any email address and any password. A correct password returns the sanitised user object; an incorrect one returns `{"status":"error","errorMessage":"… Uncaught Error: Invalid email or password"}`. Repeat without limit.
- **Expected behavior:** Credential verification is rate-limited at the layer that owns the credential, so that the limit cannot be bypassed by calling the backend directly; and repeated failures lock or throttle the account.
- **Actual behavior:** Unlimited credential attempts are available to anyone who knows the deployment URL, which is published in the client bundle.
- **Root cause:** The rate limit was placed in the presentation layer instead of the credential-owning layer.
- **Recommended fix:** (1) Add attempt counting and lockout to `users:login` itself — persist `failedAttempts`/`lockedUntil` on the user row, refuse after N failures, and reset on success. (2) Keep the Next.js limiter as a cheap first layer, but treat it as defence in depth, not the control. (3) Move credential verification behind the server secret so that only the Next.js server can call it, exactly as `users:startSession` already does (`src/app/api/auth/route.ts:213-220` passes `serverSecret`) — this makes the public endpoint impossible to brute-force directly. (4) Alert on a spike in failed logins.
- **Test required to verify the fix:** A test that calls the Convex mutation directly N+1 times with a wrong password and asserts the N+1st is refused with a lockout, and a test asserting the mutation rejects a caller without the server secret.

### SEC-02 — The application's own login limiter is per-instance and ineffective in production
- **ID:** SEC-02
- **Module:** Authentication
- **Severity:** **HIGH**
- **Description:** The login throttle is a module-level `Map` in the Next.js route (`src/app/api/auth/route.ts:52-63`) with a 15-minute window. On Vercel each serverless instance holds its own copy, so the limit is per-instance, not per-account: traffic spread across instances multiplies the allowed attempts, and a cold start resets the map entirely. The code comments acknowledge this ("per server instance, so on serverless it is best-effort", `src/app/api/auth/route.ts:130-131`), but the limit is presented as protection.
- **Steps to reproduce:** Static inspection of `src/app/api/auth/route.ts:52-63` and `:130-143`; the deployment is serverless (Vercel), confirmed by the live deployment headers.
- **Expected behavior:** A brute-force limit that holds regardless of how many instances serve the request.
- **Actual behavior:** A best-effort limit that is trivially multiplied by instance count.
- **Root cause:** In-process state was used for a control that must be shared across processes.
- **Recommended fix:** Move the counter into the backend (see SEC-01) so it is stored in the database and shared by every instance; delete the in-process map once the backend counter exists.
- **Test required to verify the fix:** A test that performs N failures through the route and asserts the N+1st is refused, run against a deployment with more than one instance.

### SEC-03 — The password-reset and verification-email endpoints have no rate limit
- **ID:** SEC-03
- **Module:** Authentication / email
- **Severity:** **HIGH**
- **Description:** `POST /api/send-reset-email` and `POST /api/auth/send-verification` have no throttling of any kind — no per-IP, per-email or global cap. The audit's own review of the route table records both as carrying **no rate limit**. An unauthenticated caller can therefore request a reset code for an arbitrary address at will, which (a) burns Resend quota and can get the sending domain suspended, (b) allows mailbox flooding of a victim, and (c) repeatedly triggers code rotation, which invalidates a code the genuine user is in the middle of typing.
- **Steps to reproduce:** Static inspection of `src/app/api/send-reset-email/route.ts` and `src/app/api/auth/send-verification/route.ts` — no limiter, no attempt counter, no cooldown. The reset code's own attempt cap (`convex/users.ts:516-521`) applies only *after* a code has been issued.
- **Expected behavior:** A per-address cooldown (for example one code per 60 seconds) and a per-IP hourly cap.
- **Actual behavior:** Unlimited.
- **Root cause:** Rate limiting was applied only to the login path.
- **Recommended fix:** Add a shared limiter (the same backend-backed mechanism as SEC-01) with a per-address cooldown and a per-IP cap, and return HTTP 429 with a retry-after. Prefer the backend so the limit survives instance changes.
- **Test required to verify the fix:** A test that requests ten codes for one address in a minute and asserts the later requests are refused with 429.

### SEC-04 — Production serves no security headers
- **ID:** SEC-04
- **Module:** Web security
- **Severity:** **HIGH**
- **Description:** Live response headers from `https://smartbuz.vercel.app` include only `Strict-Transport-Security` (added by Vercel at the edge). There is **no `Content-Security-Policy`, no `X-Frame-Options` / `frame-ancestors`, no `X-Content-Type-Options`, no `Referrer-Policy` and no `Permissions-Policy`** (probe 5 in §2). The repository already contains a correct implementation — `next.config.ts` in the working tree defines `securityHeaders` with HSTS, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `X-DNS-Prefetch-Control` and `Referrer-Policy` — but that file is **uncommitted and undeployed**, so the live site has none of it. The consequence is that the application can be framed (clickjacking against a POS cashier session) and has no CSP to constrain script sources.
- **Steps to reproduce:** `curl -sI https://smartbuz.vercel.app | grep -i 'x-frame\|x-content-type\|content-security\|referrer'` → no output.
- **Expected behavior:** The headers in the working-tree `next.config.ts` deployed to production.
- **Actual behavior:** None of them are present in production.
- **Root cause:** The `next.config.ts` change was never committed, so it never reached the deployment.
- **Recommended fix:** Commit `next.config.ts` as it stands and redeploy. Add `Content-Security-Policy` (start with `default-src 'self'` and extend to the Convex WebSocket origin `wss://*.convex.cloud`), and `frame-ancestors 'none'` in place of, or alongside, `X-Frame-Options`.
- **Test required to verify the fix:** An automated check against the deployed URL asserting the presence of each header.

### SEC-05 — Seeding creates globally-unique accounts with hardcoded passwords, and links them into the caller's tenant
- **ID:** SEC-05
- **Module:** Multi-tenancy / seeding
- **Severity:** **HIGH**
- **Description:** `seedUsersInternal` (`convex/seed.ts:40-87`) creates three users with **hardcoded credentials** — `admin@pos.com / password123` (role `admin`), `sales@pos.com / password123` (cashier) and `stock@pos.com / password123` (stock manager) — and then, for each one, looks the account up **globally by email** (`convex/seed.ts:49-52`, the `by_email` index has no business scope) and creates a membership for that account in the *calling* business with the seeded role (`convex/seed.ts:70-85`). Two consequences: (1) any tenant that runs the seed exposes a **known-password administrator**; (2) because the email is globally unique, the *same* account is granted membership in **every business that seeds**, so one known password reaches multiple tenants. The seeding mutations are guarded (`requireTenant` + `requirePermission`, `convex/seed.ts:291-292` and the sibling handlers), so they are reachable by any business owner or manager — a role that should never be able to mint a global administrator. **Live state: probes 1–3 in §2 confirm none of the three seeded accounts is currently active in production**, so this is a latent defect, not an active compromise.
- **Steps to reproduce:** Static inspection of `convex/seed.ts:40-87` and `:288-353`. (A live proof requires creating users in a production tenant, which the mandate forbids; the credential probes above were used instead and found no seeded account.)
- **Expected behavior:** Seeded users are unique to the tenant being seeded, are created with a random password that is never returned, and cannot collide with an account that already exists in another tenant.
- **Actual behavior:** Fixed global email addresses, a fixed password, and a membership link created for a pre-existing global account.
- **Root cause:** The seeder was written for a single-tenant demo and its assumptions (one global admin email) were never revisited for a multi-tenant product.
- **Recommended fix:** (1) Remove the seeding mutations from the production deployment entirely — move them to a `convex/dev/` folder excluded from `convex.json`, or gate them behind `serverSecretMatches`. (2) If they must stay, generate a per-tenant email (`admin+<businessId>@…`) and a random password that is never returned to the caller. (3) Never attach a membership to an account that already exists outside the tenant without an explicit invitation flow.
- **Test required to verify the fix:** A test asserting that seeding business A and then business B produces two distinct user rows, with no shared email and no shared password, and that the second seed does not create a membership for the first tenant's account.

### SEC-06 — A payment callback is accepted without a signature when the adapter has no webhook secret
- **ID:** SEC-06
- **Module:** Payments
- **Severity:** **MEDIUM**
- **Description:** `verifyWebhookSignature` returns `ok: true` when no webhook secret is configured for the adapter (`convex/integrations/webhooks.ts:152-157`), with the reason *"the callback was accepted on its reference alone"*. The callback route is deliberately unauthenticated (`convex/http.ts:18-22`), so its only authentication is the payment reference plus, optionally, the signature. With no secret configured, anyone who learns a payment reference can mark that payment as confirmed. The reference is a 4-byte random value (`convex/integrations/payments.ts:53`, per the source comment) — short enough to be guessable at volume, and it is also echoed in provider dashboards and logs.
- **Steps to reproduce:** Static inspection of `convex/integrations/webhooks.ts:147-179` and `:189-260`. (A live proof would require a real payment reference.)
- **Expected behavior:** A callback that cannot be authenticated is refused, or the adapter is refused configuration until a secret is set.
- **Actual behavior:** The adapter degrades to reference-only authentication, silently.
- **Root cause:** The fallback was chosen to keep unconfigured adapters usable.
- **Recommended fix:** Refuse callbacks for adapters without a configured secret and require the secret at adapter-configuration time (the configuration UI should refuse to save a webhook adapter without one). Lengthen the payment reference to at least 128 bits of entropy. Log every degraded-acceptance decision at warning level.
- **Test required to verify the fix:** A test asserting that a callback for a secret-less adapter is refused, and one asserting that a configured secret is required before an adapter can be activated.

### SEC-07 — No dependency vulnerability scanning
- **ID:** SEC-07
- **Module:** Supply chain
- **Severity:** **MEDIUM**
- **Description:** There is no dependency scanning in CI (`.github/workflows/ci.yml` runs typecheck, tests and build only) and no `audit` script in `package.json:5-14`. `npm audit --omit=dev` could not complete during this audit — the registry advisory endpoint was unreachable from the audit host for the full 180 s timeout — so **the production dependency tree is currently unverified**. The production set includes `next@16.1.1`, `convex@^1.31.2`, `bcryptjs@^3.0.3`, `exceljs@^4.4.0`, `jspdf@^4.1.0` and `resend@^6.35.0`.
- **Steps to reproduce:** `npm audit --omit=dev` → timeout, no output.
- **Expected behavior:** A scheduled scan with a recorded baseline.
- **Actual behavior:** No scan, and the one manual attempt could not reach the advisory service.
- **Root cause:** No supply-chain step in the pipeline.
- **Recommended fix:** Add `npm audit --omit=dev --audit-level=high` to CI, tolerate transient registry failures but fail on a real finding, and re-run the scan from a host with registry access to establish the current baseline.
- **Test required to verify the fix:** A CI run publishes the audit report as an artefact.

### SEC-08 — No security monitoring, alerting or audit-log review
- **ID:** SEC-08
- **Module:** Operations / detection
- **Severity:** **MEDIUM**
- **Description:** The platform writes a good audit trail (`convex/audit.ts`, `activityLogs`, `syncLogs`), but nothing reads it. There is no error-reporting service in the dependency list, no alerting on repeated failed logins, no notification on a platform-admin action, and no log retention policy. The 19 November 2026 production outage was detected by a user reading a browser console — which is precisely the signal that did not reach an operator.
- **Steps to reproduce:** `grep -iE 'sentry|datadog|opentelemetry' package.json` → no matches; no alerting configuration exists in the repository.
- **Expected behavior:** Security-relevant events (failed logins, role grants, subscription changes, device revocations) raise an alert.
- **Actual behavior:** They are written to a table and never surfaced.
- **Root cause:** Detection was never built.
- **Recommended fix:** Add error monitoring, and a scheduled job that reports on failed-login spikes, platform-admin actions and subscription changes to the owner. Define a retention policy for `activityLogs` and `audit`.
- **Test required to verify the fix:** An induced failed-login burst in staging produces an alert within the agreed latency.

### SEC-09 — Backend errors leak internal source paths to the client
- **ID:** SEC-09
- **Module:** Information disclosure
- **Severity:** **LOW**
- **Description:** Convex error payloads include the handler's source location. The live probe in §2 returned `Uncaught Error: Invalid email or password at handler (../convex/users.ts:175:31)` — a server-side file path and line number delivered to an unauthenticated caller. The same pattern applies to every uncaught error in the backend.
- **Steps to reproduce:** The probe request in §2.
- **Expected behavior:** Client-facing errors describe the problem without revealing the implementation's file layout.
- **Actual behavior:** File paths and line numbers are disclosed.
- **Root cause:** Errors are thrown as plain `Error` objects rather than being mapped to safe, typed responses.
- **Recommended fix:** Wrap the credential path in `ConvexError` with a safe message and catch unexpected errors at the boundary, logging the detail server-side and returning a generic message to the caller. Audit the other public mutations for the same pattern.
- **Test required to verify the fix:** An integration test asserting that no backend error payload contains a file path.

### SEC-10 — Legacy password-reset codes are still accepted in plaintext
- **ID:** SEC-10
- **Module:** Authentication
- **Severity:** **LOW**
- **Description:** `users:resetPassword` accepts a plaintext-stored code for legacy records: `const matches = reset.codeHash ? await bcrypt.compare(args.code, reset.codeHash) : reset.code === args.code;` (`convex/users.ts:524-527`). Codes issued before hashing was introduced are stored in the clear, so a database read exposes them. The comparison is a plain string equality rather than a constant-time compare, although the values are short-lived and single-use.
- **Steps to reproduce:** Static inspection of `convex/users.ts:524-527`.
- **Expected behavior:** Only hashed codes are honoured.
- **Actual behavior:** Plaintext legacy codes remain usable.
- **Root cause:** A backwards-compatibility path was left in place after hashing was introduced.
- **Recommended fix:** Migrate or invalidate outstanding legacy codes (the rows expire quickly anyway), then delete the fallback branch. Use `safeEqual` from `convex/crypto.ts` for the comparison.
- **Test required to verify the fix:** A test asserting that a reset row without a `codeHash` is refused.

### SEC-11 — bcrypt cost factor is the minimum
- **ID:** SEC-11
- **Module:** Authentication
- **Severity:** **LOW**
- **Description:** Passwords are hashed with bcrypt at cost 10 (`convex/users.ts:192,537,1439,1694`). Cost 10 is the accepted minimum but is the weakest setting bcryptjs still supports; the current guidance is 12 or higher where login latency allows it.
- **Steps to reproduce:** `grep -n 'bcrypt.hashSync' convex/users.ts` → cost 10 at four sites.
- **Expected behavior:** A cost factor appropriate to the threat model.
- **Actual behavior:** The minimum.
- **Root cause:** The default was never revisited.
- **Recommended fix:** Raise the cost to 12 and add a transparent re-hash on next successful login (compare the stored cost, re-hash when it is below the current policy).
- **Test required to verify the fix:** A test that logs in with a cost-10 hash and asserts the stored hash is re-written at the current cost.

---

## 5. What was NOT TESTED, and why

| Item | Why |
|---|---|
| Password spraying against real accounts | Would require live credential attempts against production tenants. Only the three known seeded addresses were probed (all refused). |
| Cross-tenant exploitation of any specific function | Requires writes to production data; covered by static analysis in `07_TENANT_ISOLATION_REPORT.md`. |
| Provider-side behaviour (MTN MoMo, Airtel, card acquirers) | Requires sandbox credentials and a funded sandbox account; none configured in this environment. |
| Runtime vulnerability scanning of the running application | No scanner is installed and the mandate forbids intrusive testing against production. |
| `npm audit` result | Registry advisory endpoint unreachable from the audit host. |

---

## 6. Findings summary

**SEC-01** CRITICAL · **SEC-02** HIGH · **SEC-03** HIGH · **SEC-04** HIGH · **SEC-05** HIGH ·
**SEC-06** MEDIUM · **SEC-07** MEDIUM · **SEC-08** MEDIUM · **SEC-09** LOW · **SEC-10** LOW · **SEC-11** LOW

**Counts: 1 CRITICAL, 4 HIGH, 3 MEDIUM, 3 LOW, 0 INFORMATIONAL**

---

## 7. Assessment

The **core** of this platform's security is genuinely well built and was verified against the live
system: identity cannot be forged, money cannot be dictated by the browser, tenant boundaries are
enforced in the data layer, secrets never reach the client bundle, and reset/verification codes are
hashed, expiring and single-use. The prior audit's catastrophic hole — an open Convex deployment —
has been closed and re-verified.

The failure mode in this audit is **systemic rather than structural**: controls were placed in the
presentation layer and in process-local memory rather than in the component that owns the fact.
The login rate limiter is the clearest case (SEC-01, SEC-02): the limit exists, it is documented, and
it does not hold, because the credential check lives behind a public URL that the client bundle
publishes. The same pattern produced SEC-03 (email endpoints unthrottled), SEC-04 (headers authored
but never committed) and SEC-08 (an audit trail nothing reads).

**SEC-01 must be fixed before this platform carries another tenant.** It is a single-file change with
a large effect: move the counter into the backend, and put the server secret in front of the mutation.
