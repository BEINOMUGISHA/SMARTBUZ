# 03 — Authentication, Sessions and Access Control

**Commit audited:** `acafd2b`
**Scope:** `convex/auth.config.ts`, `convex/authJwks.ts`, `convex/jwks.ts`, `convex/auth.ts`,
`convex/tenancy.ts`, `convex/rbac.ts`, `convex/users.ts`, `convex/session.ts` (server secret),
`src/lib/session.ts`, `src/lib/convex-token.ts`, `src/app/api/auth/*`.

---

## 1. How authentication actually works

```
Browser                          Next.js server                    Convex deployment
   │ POST /api/auth  ──────────────►│
   │                                  │ users:login (bcrypt compare)
   │                                  │ users:startSession (server secret)
   │                                  │ signAccessToken (RS256, 15 min)
   │◄── Set-Cookie: sb_session ───────┤
   │                                  │
   │ GET /api/auth/convex-token ─────►│
   │                                  │ re-read cookie, users:touchSession
   │◄───── { token, expiresIn } ──────┤
   │                                                                    │
   │ Convex query/mutation with `Authorization: Bearer <token>` ────────►│
   │                                            verifies RS256 against  │
   │                                            <site>/auth/jwks        │
```

The private key (`SMARTBUZ_JWT_PRIVATE_KEY`) never leaves the Next.js server. Convex verifies the
token against the deployment's own JWKS endpoint (`convex/http.ts:7`, `convex/jwks.ts`), so
`ctx.auth.getUserIdentity()` is a trustworthy statement of who is calling — which is the
foundation every tenant guard stands on.

**Assessment: good.** This is the pattern the whole platform depends on, and it is implemented
correctly.

---

## 2. Findings in detail

### 2.1 Token design — good

| Property | Value | Evidence |
|---|---|---|
| Algorithm | RS256 (asymmetric; the deployment holds only the public key) | `src/lib/convex-token.ts:98-104` |
| Lifetime | 15 minutes | `src/lib/convex-token.ts:23` |
| Session binding | `sid` + `ses` claims; the backend re-reads the session row on every call | `src/lib/convex-token.ts:151-154`, `convex/tenancy.ts:196-250` |
| Revocation | Immediate — a revoked session fails `assertSessionLive` on the next call, not after the token expires | `convex/tenancy.ts:231-235` |
| Session secret storage | Only its SHA-256 hash is stored | `convex/users.ts` (`sessions.secretHash`) |
| Comparison | Constant-time | `convex/crypto.ts` `safeEqual`, `src/lib/session.ts:101` |

**L-01 (Low).** The session secret is carried inside the JWT payload. A JWT payload is base64,
not encrypted, so the session secret travels in cleartext to whoever holds the token. The impact
is limited — a holder of the access token can already act as the user — but the secret would
more properly live in an HTTP-only cookie or be referenced rather than embedded.

### 2.2 Login throttling — bypassable (H-02, High)

The Next.js route `POST /api/auth` rate-limits to 8 failed attempts per email per 15 minutes
(`src/app/api/auth/route.ts`). The limiter lives in an in-process `Map`, so on serverless it is
per-instance and best-effort — already a known limitation.

**The larger problem:** the Convex mutation `users:login` (`convex/users.ts:376-424`) is a
**public function with no throttling, no lockout and no attempt counter**. Anyone who knows the
deployment URL can call it directly:

```
POST https://<deployment>.convex.cloud/api/mutation
{"path":"users:login","args":{"email":"...","password":"..."},"format":"json"}
```

The browser never does this — `src/context/auth-context.tsx:165` goes through `/api/auth` — but
the mutation is public API. An attacker can brute-force a password at full speed, with no
throttle, no lockout and no audit trail of the failures.

**Also L-04 (Low):** `users:login` returns early when the email is unknown
(`convex/users.ts:382-384`), before any bcrypt comparison. The response time therefore differs
measurably between "no such account" and "wrong password", which is a timing side channel that
reveals whether an address has an account.

**Recommendation:** move the attempt counter and the throttle into the Convex mutation itself
(keyed on the email and on the source IP), and add a lockout after N consecutive failures.

### 2.3 Password storage — good

bcrypt with cost 10 (`convex/users.ts:192`, `220`, `356`, `454`, `537`, `1439`, `1694`). Email
verification codes and password-reset codes are also bcrypt-hashed, so a database read cannot
reveal a live code.

Code lifetimes are enforced:

| Artefact | Lifetime | Evidence |
|---|---|---|
| Password-reset code | 1 hour | `convex/users.ts:106`, expiry checked at `509`, `528` |
| Email-verification code | 24 hours | `convex/users.ts:109`, expiry checked at `275`, `288` |
| Session | 7 days | `convex/users.ts:112` |

**M-09 (Medium).** The password policy is only a length-and-complexity rule
(`MIN_PASSWORD_LENGTH = 8`, one letter and one number) with no check against a breached-password
list and no check against the account's own email. The 8-character minimum is at the low end of
current guidance.

### 2.4 Sessions — good

The browser session is an HttpOnly, SameSite cookie carrying an HMAC-SHA256-signed payload
(`src/lib/session.ts`). `SESSION_SECRET` must be at least 32 characters and the code refuses to
sign without one (`src/lib/session.ts:44`). The cookie is 7 days; the *access token* is 15
minutes. Two different lifetimes for two different risks — correct.

### 2.5 Server-side operations are gated by a shared secret

Operations a browser must never reach — opening a session, ending one, reading a password-reset
code — require `serverSecretMatches` (`convex/serverSecret.ts`). The comparison is
length-checked and then byte-by-byte (`convex/serverSecret.ts:42-45`), so it does not leak the
secret through timing. If no secret is configured, the operations stay **closed** rather than
opening to an empty string.

**M-10 (Medium).** The secret falls back through a chain: `SMARTBUZ_SERVER_SECRET` →
`RESEND_API_KEY` → `SESSION_SECRET` (`src/lib/mobile-auth.ts` on the branch, and the equivalent
in `convex/serverSecret.ts`). Using the *email provider's* key as the session-opening secret
means a rotated Resend key silently opens session operations to anybody who has read it. The
primary variable should be mandatory in production.

---

## 3. Authorisation model

### 3.1 Roles and permissions

`convex/rbac.ts` holds the catalogue: **44 permissions**, **8 roles**, and a matrix per role.
It has no imports at all — it is a pure, self-contained module, which is why the web interface
and the backend cannot drift apart.

| Role | Scope | Summary |
|---|---|---|
| `business_owner` | business | Everything within the business |
| `business_admin` | business | Administration without ownership |
| `branch_manager` | business | A branch and its staff |
| `accountant` | business | The finance suite, read-write |
| `cashier` | business | The till: sales and stock in, nothing out |
| `stock_manager` | business | Stock, purchases, suppliers |
| `store_assistant` | business | A narrower stock and customer role |
| Platform roles | platform | `platform_super_admin`, `platform_support` |

`tests/permissions.test.ts` asserts the whole matrix — 22 tests, including the `EXPECTED` table
of all 44 permissions.

**Assessment: good.** The matrix is explicit, testable and asserted.

### 3.2 Where authorisation is enforced

| Layer | Enforcement | Correct? |
|---|---|---|
| Backend | `requireTenant` → `requireMembership` → `requirePermission` | Yes |
| Backend (platform) | `requirePlatformRole` / `requirePlatformPermission`, separate `platformAdmins` table | Yes |
| Backend (branches) | `requireBranchAccess`; branch managers are confined to the branches they manage | Yes |
| Interface | Hides what the caller may not do | Presentational only — correct |

**A static scan of all 440 exported Convex functions** (`convex/tenancy.ts` guards plus the
platform, audit, billing, licensing, migration and entitlement guards) found **11 public
functions with no guard at all**. Nine of them are handled in report 09; the two that are not
defects are `plans.listEntitlements` (guarded upstream) and `whoami` (M-11, Low — a leftover
diagnostic query described in its own comment as *"Temporary diagnostic … removed once the
tenancy layer is verified"*, which was never done).

### 3.3 Platform roles cannot be self-granted — good

Platform administrators live in the `platformAdmins` table, not on the user record
(`convex/tenancy.ts:262-269`), and `convex/platform.ts` writes to that table only behind
`requirePlatformWrite`. `grantRole` additionally requires the server secret. The last super
administrator cannot be removed (`convex/platform.ts:393-408`).

### 3.4 Branches — good

`allowedBranchIds` (`convex/tenancy.ts:614-633`) confines a member with an explicit list to it,
confines a branch manager to the branches they manage, and leaves everybody else unrestricted
within the business.

---

## 4. Multi-factor and account protection — not implemented

| Control | Present? |
|---|---|
| Email verification at registration | Yes (`users.verifyEmail`) |
| Password reset | Yes |
| Multi-factor authentication | **No** |
| Account lockout after repeated failures | **No** (H-02) |
| Session management screen (list and revoke your own sessions) | Partially — sessions exist; the user cannot see them |
| "Sign out everywhere" | **No** — one session at a time |

**M-12 (Medium).** There is no way for a user to see which devices are signed in or to sign
them all out. The `sessions` table supports it (`by_userId`), but no interface or function
exposes it.

---

## 5. Summary

| Area | Assessment |
|---|---|
| Token design and session binding | **Good** |
| Session storage and revocation | **Good** |
| Server-side enforcement of every business operation | **Good** |
| Role and permission catalogue | **Good**, and tested |
| Branch scoping | **Good** |
| Platform role separation | **Good** |
| Login throttling | **Weak — bypassable at the Convex layer (H-02)** |
| Account lockout | **Absent** |
| Multi-factor authentication | **Absent** |
| Password policy | **Adequate but basic (M-09)** |
| Session self-service | **Absent (M-12)** |
