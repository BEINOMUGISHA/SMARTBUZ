# 15 — Security, Secrets and Dependencies

**Commit audited:** `acafd2b`
**Scope:** `npm audit`, the whole tracked tree for committed secrets, the environment
configuration, the cryptographic helpers, and the public HTTP surface.

---

## 1. Dependency vulnerabilities — 23 findings

`npm audit` reports **23 vulnerabilities: 1 low, 7 moderate, 13 high, 2 critical**.

| Severity | Package | Direct? | Fix |
|---|---|---|---|
| **Critical** | `jspdf` | **yes** | `npm audit fix` |
| **Critical** | `next` (16.1.1) | **yes** | breaking: `next@16.4.6` |
| **High** | `zod` (< 4.6.6) | **yes** | `npm audit fix` |
| High | `brace-expansion`, `browserslist`, `flatted`, `js-yaml`, `lodash`, `minimatch`, `nanoid`, `picomatch`, `postcss`, `sharp`, `source-map-js`, `tmp` | no | `npm audit fix` (postcss and sharp need the Next upgrade) |
| Moderate | `@humanfs/node`, `ajv`, `baseline-browser-mapping`, `dompurify`, `exceljs`, `fflate`, `uuid` | exceljs yes | various |
| Low | `@babel/core` | no | `npm audit fix` |

### 1.1 H-05 (High) — the critical advisories

**`jspdf`** — *"PDF Object Injection via Unsanitized Input in addJS Method; jsPDF affected by
client-side/server-side denial of service via malicious GIF dimensions."*

`jspdf` is a direct dependency and is used in `src/lib/export.ts`,
`src/lib/export-utils.ts` and `src/lib/restock-pdf.ts` to build PDFs **in the browser** from
database content. The injection surface is real: a product name, a customer name or a note
reaches a PDF field. The DoS surface is also real: a crafted image dimension can hang or crash
the export.

**`next`** — *"self-hosted applications vulnerable to DoS via Image Optimizer remotePatterns
configuration; HTTP request deserialization can lead to DoS when using insecure React Server
Components."*

The upgrade to `16.4.6` is flagged as breaking, but it is a patch-level move within Next 16
and the advisories are DoS, not remote code execution.

**Recommendation:** upgrade `next` to 16.4.6 and `jspdf` to a patched release as the first
remediation step. Both are direct dependencies and both are upgradeable.

### 1.2 H-06 (High) — `zod` is a dependency with an advisory and no use at all

`zod` is a direct dependency (`package.json:68`) and carries a **high** advisory (*"Zod can
exhaust memory while validating oversized constrained collections"*).

A search of the entire repository — every `.ts`, `.tsx`, `.mjs` and `.js` file outside
`node_modules` — found **no import of `zod` anywhere**. The backend uses Convex's own
validators (`convex/values`); the client uses `react-hook-form` and the shadcn form primitives.

**Recommendation: remove `zod` from `package.json`.** This closes a high-severity advisory at
zero risk and removes a dependency that nothing uses.

### 1.3 The transitive findings

Most are build-time (`brace-expansion`, `minimatch`, `picomatch`, `flatted`, `source-map-js`,
`nanoid`) or come from `exceljs` (`uuid` — a missing buffer bounds check in v3/v5/v6 when a
buffer is supplied).

`npm audit fix` will resolve 17 of the 23 without a breaking change. The remaining six need
the `next` upgrade and the `exceljs` decision.

**M-57 (Medium).** `dompurify` (moderate, XSS bypasses) and `ajv` (moderate, ReDoS) are
transitive. `dompurify` is worth tracing: it suggests something is sanitising HTML, and it
should be confirmed that the sanitiser is used on the path it is meant for.

### 1.4 No dependency audit in CI

`.github/workflows/ci.yml` runs typecheck, tests and build. It does **not** run
`npm audit`. A high-severity advisory introduced by a dependency bump would not be noticed
until someone ran the audit by hand.

**Recommendation:** add `npm audit --audit-level=high` as a CI step, with a documented
allow-list for the findings that cannot be fixed immediately.

---

## 2. Committed secrets — none found

A scan of all **337 tracked files** for private-key blocks, AWS keys, Google API keys, Slack
tokens, Stripe live secrets, Resend keys and assigned secret-like values found **zero
matches**.

`git ls-files` confirms that `.env.example` is the **only** environment file tracked.
`.env.local` is ignored (`.gitignore:36`) and is not in the repository.

**M-58 (Low).** The git *history* was not searched for secrets that were later removed. That
is a worthwhile exercise before the repository is ever public — but the remote is already a
private GitHub repository, so the risk is lower than it would be for a public one.

**Assessment: good.** No credential is committed, and `.env*` is ignored with
`!.env.example` so the template stays tracked.

---

## 3. Environment configuration

### 3.1 What the code reads against what `.env.example` documents

13 variables are read by the code; 9 are documented.

| Read but **not** documented | Used by |
|---|---|
| `SMARTBUZ_AUTH_ISSUER` | `src/lib/convex-token.ts:68` — overrides the token issuer |
| `NEXT_PUBLIC_APP_VERSION` | `src/lib/offline/device.ts` |
| `CONVEX_SITE_URL` | `convex/auth.config.ts:22` — provided by the platform |
| `CONVEX_URL` | three operator scripts |
| `APP_URL` | `scripts/auth-journey.mjs` |
| `NODE_ENV` | framework |

| Documented but **never read** | Problem |
|---|---|
| `MTN_MOMO_API_KEY` | **Stale.** Phase 9 moved to the adapter framework; the credentials live per business, encrypted, in the database |
| `AIRTEL_MONEY_CLIENT_ID` | **Stale**, same reason |

**M-04 (Medium).** `.env.example:60-63` still tells an operator to set mobile-money gateway
credentials and refers to *"/api/momo returns a simulated response"* — **a route that was
deleted in Phase 9**. An operator following the example would set two variables that do
nothing, and would believe the mobile-money integration works when it has never been
configured.

**M-59 (Medium).** `SMARTBUZ_AUTH_ISSUER` is undocumented. It overrides the issuer the access
tokens are minted against, and it must match the deployment's site URL exactly. Setting it
wrongly breaks every sign-in, with an error that says *"Cannot mint a Convex access token: the
deployment site URL is unknown."* — which points at the wrong variable.

### 3.2 The server secret fallback chain — M-10 (Medium)

`convex/serverSecret.ts` looks up the shared secret through a chain:
`SMARTBUZ_SERVER_SECRET` → `RESEND_API_KEY` → `SESSION_SECRET`.

Using the **email provider's API key** as the secret that opens sessions, ends sessions and
reads password-reset codes is a poor default. If the Resend key is rotated, session opening
silently changes behaviour. The primary variable should be mandatory in production, and the
fallback should be removed or restricted to development.

---

## 4. Cryptography in use

| Purpose | Primitive | Where |
|---|---|---|
| Password hashing | bcrypt, cost 10 | `convex/users.ts` |
| Verification and reset codes | bcrypt, cost 10, with expiry | `convex/users.ts` |
| Session secret storage | SHA-256 hash only | `convex/users.ts` |
| Session cookie signature | HMAC-SHA256, constant-time compare | `src/lib/session.ts:101` |
| Access tokens | RS256, 15 minutes, session-bound | `src/lib/convex-token.ts` |
| Webhook signatures | HMAC-SHA256, constant-time compare | `convex/integrations/webhooks.ts:147` |
| Provider credentials at rest | AES-GCM + PBKDF2 | `convex/crypto.ts` |
| Payment references | `crypto.getRandomValues`, 4 bytes | `convex/integrations/payments.ts:53` |

**Assessment: good.** The right primitives throughout, and the comparisons are constant-time.

**M-49 (Low).** The payment reference's 4 bytes of randomness are thin for a value that can
confirm money.

**M-37 (Low).** The PBKDF2 iteration count is not recorded alongside the sealed secret, so it
cannot be raised later without a migration.

---

## 5. The public HTTP surface

| Endpoint | Authentication |
|---|---|
| `POST /api/auth` | Credentials; rate-limited in-process |
| `POST /api/auth?action=logout` | The HttpOnly cookie |
| `GET /api/auth` | The HttpOnly cookie |
| `GET /api/auth/convex-token` | The HttpOnly cookie |
| `POST /api/auth/send-verification` | **None** — emails a code to an address |
| `POST /api/send-reset-email` | **None** — emails a reset code |
| `GET <site>/auth/jwks` | None — public keys, correct |
| `POST <site>/payments/callback` | HMAC signature + reference lookup |

**M-60 (Medium).** `/api/auth/send-verification` and `/api/send-reset-email` are unauthenticated
by necessity, but **neither is rate-limited**. Both correctly avoid account enumeration — each
answers `success: true` with `messageId: null` whether or not the address exists
(`src/app/api/auth/send-verification/route.ts:78-82`,
`src/app/api/send-reset-email/route.ts:84-89`) — which is the right design and was checked.

The gap is different: for an address that **does** have an account, each call sends a real
email through Resend, which is a paid, quota-limited, deliverability-scored API. An attacker
can call either route in a loop and burn the account's sending quota, damage the sending
domain's reputation, and spam a real customer with verification and reset codes.

**Recommendation:** apply the same per-address throttle the login route already uses, and a
global per-IP cap, to both email routes.

---

## 6. What is genuinely secure here

1. **No committed secrets.** Zero matches across 337 tracked files.
2. **No private key in the client bundle.** `SMARTBUZ_JWT_PRIVATE_KEY` is read only in
   `src/lib/convex-token.ts`, which is imported only by server routes.
3. **The backend is not a public API.** `convex/auth.config.ts` makes
   `ctx.auth.getUserIdentity()` the only trustworthy statement of who is calling, and every
   business function depends on it. This was the original, catastrophic hole (AUDIT.md §2.1)
   and it is closed.
4. **Server-side authorisation on every write.** Not one client-side check is trusted.
5. **Encrypted provider credentials.** AES-GCM at rest, decrypted only inside the server.
6. **Short-lived, revocable tokens.** Signing out takes effect immediately.
7. **Constant-time comparison** everywhere a secret is compared.
8. **Secrets fail closed.** No server secret means the protected operations stay closed.

---

## 7. Findings

| ID | Severity | Finding |
|---|---|---|
| H-05 | **High** | `jspdf` (critical advisory) and `next@16.1.1` (critical advisory) are direct dependencies |
| H-06 | **High** | `zod` is a high-severity advisory on a dependency nothing imports |
| M-04 | Medium | `.env.example` documents two removed variables and a deleted route |
| M-57 | Medium | `dompurify` XSS advisories — the sanitisation path should be confirmed |
| M-58 | Low | The git history has not been searched for removed secrets |
| M-59 | Medium | `SMARTBUZ_AUTH_ISSUER` is read but undocumented |
| M-60 | Medium | The two unauthenticated email routes are not rate-limited (they do correctly avoid account enumeration) |
| M-10 | Medium | The server secret falls back to the email provider's key |
| M-37 | Low | The PBKDF2 iteration count is not stored with the secret |
| M-49 | Low | The payment reference's random portion is 4 bytes |
| — | Good | No committed secrets; the client bundle holds no secret; encryption at rest; constant-time comparisons; secrets fail closed |
