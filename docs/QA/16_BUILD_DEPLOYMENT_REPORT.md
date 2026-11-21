# SMARTBUZ v2.0 — 16 · Build and Deployment Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958` (branch `main`)
**Live production web:** `https://smartbuz.vercel.app`
**Live Convex deployment:** `affable-panda-681.convex.cloud` (site `affable-panda-681.convex.site`)
**Overall verdict:** The build and deployment pipeline **works and produces a working production system**, but it is **unreproducible from the repository** (no infrastructure-as-code, no runbook, no environment manifest) and its **quality gates are partly non-functional** (lint is not in CI and fails if it is; `npm audit` cannot complete).

---

## 1. Method

| Check | Command | Result |
|---|---|---|
| TypeScript compilation | `npm run typecheck` | **PASS** — exit 0, no diagnostics |
| Unit / integration / acceptance tests | `npm test` | **PASS** — 341 assertions, 75 suites, 0 failures, 4.5 s |
| Next.js production build | `npm run build` | **PASS** — 54 routes, ~11 min wall clock on the audited machine |
| Lint | `npx eslint src convex` | **FAIL** — 1,448 problems (1,154 errors, 294 warnings); ~10 min runtime |
| Dependency vulnerabilities | `npm audit --omit=dev` | **NOT TESTED** — the registry advisory endpoint was unreachable from the audit host for the full 180 s timeout; re-run required |
| CI workflow | `.github/workflows/ci.yml` | Executed by GitHub Actions on `953f958`: all three checks (typecheck, tests, build) reported **success** |
| Live deployment behaviour | curl against `https://smartbuz.vercel.app` | **PASS** — session gate redirects (307), `/api/auth` 401, manifest and service worker 200 |
| Live identity verification | `node scripts/verify-identity.mjs` | **PASS** — 8/8 assertions against the live Convex deployment |

---

## 2. Build pipeline

```
push to main ──► GitHub Actions (ci.yml)
                   ├─ npm ci            (Node 22, npm cache)
                   ├─ npm run typecheck ✔
                   ├─ npm test          ✔  (341 assertions)
                   └─ npm run build     ✔  (placeholder env — no live dependency)
                │
                └─► Vercel (git-connected) ──► production build ──► smartbuz.vercel.app
```

**Route inventory from the production build:** 54 routes — 50 static/ISR pages plus 4 dynamic API routes
(`/api/auth`, `/api/auth/convex-token`, `/api/auth/send-verification`, `/api/send-reset-email`) and the
Edge proxy/middleware.

**Build determinism.** The CI build deliberately runs with placeholder environment values
(`NEXT_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`, a dummy `SESSION_SECRET` and `RESEND_API_KEY`,
`.github/workflows/ci.yml:46-48`), so a build never depends on a live backend — a good practice. The
consequence is that **CI proves the code compiles, never that the production configuration is correct**;
the production environment is validated only by running production.

---

## 3. Deployment model

| Aspect | Reality | Evidence |
|---|---|---|
| Web hosting | Vercel, **git-connected** to `github.com/BEINOMUGISHA/SMARTBUZ`, branch `main` | Push of `953f958` at 21:49 EAT produced a new live build by 21:50 EAT (verified by content-hash change in the served HTML and new chunk names) |
| Build command | `npm run build` (implicit Vercel default for Next.js) | no `vercel.json` in the repository |
| Backend hosting | Convex Cloud, deployed **separately** (`npx convex dev` / `npx convex deploy`) | no workflow deploys the backend; `convex/README.md` documents the manual step |
| Configuration source | **Vercel dashboard** environment variables | no `vercel.json`, no Dockerfile, no IaC, no `.env.production` template with values |
| Deploy trigger | Git push to `main` | verified empirically |
| Rollback | Vercel dashboard "Redeploy" of a previous build | not documented anywhere in the repository |
| Database migrations | Convex schema push is part of `npx convex dev`; **no migration versioning** | `convex/migration.ts` exists for data backfill, not for schema versioning |

---

## 4. Findings

### BUILD-01 — Production configuration exists only in a dashboard; there is no reproducible deployment definition
- **ID:** BUILD-01
- **Module:** Build / deployment
- **Severity:** **HIGH**
- **Description:** The repository contains no `vercel.json`, no Dockerfile, no infrastructure-as-code and no documented environment manifest with values. The full production configuration — including the RSA signing key — lives only in the Vercel dashboard. On 19 November 2026 this produced a live production outage: `SMARTBUZ_JWT_PRIVATE_KEY` had never been added to the Vercel project, so `/api/auth/convex-token` returned HTTP 503 for every signed-in browser, Convex treated every request as anonymous, and the application reported *"Unauthorized: you must be signed in to access business data"* to users who were signed in. The environment variable was added and the project redeployed on the same day.
- **Steps to reproduce:** (1) The live route returned 503 while the session cookie was valid; (2) the running build was confirmed to be the previous commit's build (unchanged chunk hashes) while `SMARTBUZ_JWT_PRIVATE_KEY` was present in `.env.local` but absent from the dashboard; (3) after adding the variable and redeploying, the same request returned a token.
- **Expected behavior:** A deployment whose configuration is version-controlled, reproducible from a clean checkout, and validated before it reaches users.
- **Actual behavior:** Configuration is manual and unversioned; its absence caused a production outage that was diagnosed from browser console output rather than from any monitoring or pre-flight check.
- **Root cause:** No infrastructure-as-code and no pre-deployment environment validation.
- **Recommended fix:** (a) Add `vercel.json` with the build command, Node version, and framework preset; (b) add a `vercel.env.example` listing every required variable **by name** with a description and scope; (c) add a startup self-check endpoint that validates the presence of every required variable and returns a non-200 with the names of the missing ones (the mechanism introduced in `953f958` for the token route should be generalised); (d) add the Convex deploy to CI on a `convex/` deployment branch so the backend is never behind the web build.
- **Test required to verify the fix:** A CI job that starts the built app with an intentionally empty environment and asserts the self-check endpoint names every missing variable.

### BUILD-02 — The lint gate does not exist, and enabling it would fail immediately
- **ID:** BUILD-02
- **Module:** Build / quality gates
- **Severity:** **MEDIUM**
- **Description:** `.github/workflows/ci.yml` runs typecheck, tests and build — **not lint**. `npx eslint src convex` reports **1,448 problems (1,154 errors, 294 warnings)**, overwhelmingly `@typescript-eslint/no-explicit-any`. The lint run also takes roughly **10 minutes** on the audited machine, which makes it impractical as a pre-commit or pre-push hook. The result is a quality gate that is defined in `eslint.config.mjs` but never enforced.
- **Steps to reproduce:** `npx eslint src convex` → `✖ 1448 problems (1154 errors, 294 warnings)` across **141 files**. Breakdown by rule: `no-explicit-any` 1,119 · `no-unused-vars` 285 · `react-hooks/set-state-in-effect` 11 · `react/no-unescaped-entities` 9 · `prefer-const` 8 · `react-hooks/exhaustive-deps` 5 · `react-hooks/static-components` 3 · `react-hooks/purity` 3. Worst files: `convex/sales.ts` (64), `convex/finance.ts` (59), `convex/loans.ts` (54), `src/app/(dashboard)/reports/components/LoansReport.tsx` (51), `src/app/(dashboard)/sales/my-sales-view.tsx` (48), `convex/purchasing.ts` (39).
- **Expected behavior:** The lint configuration is either enforced in CI, or the codebase is brought to zero errors so it can be.
- **Actual behavior:** 1,154 lint errors are tolerated indefinitely; no CI job would notice a new one. Note that the 11 `react-hooks/set-state-in-effect` and 5 `react-hooks/exhaustive-deps` violations are not cosmetic — they are React 19 correctness rules about state updates inside effects and stale closures in dependency arrays, both of which produce real render-loop and stale-value bugs.
- **Root cause:** The rule set was configured at project creation and never made a gate; the volume of `any` usage in the Convex layer was never addressed.
- **Recommended fix:** (1) Run ESLint in CI and fail the build on new violations only (a diff-based baseline, `--max-warnings 0` on changed files); (2) open a follow-up to remove the `any` backlog, starting with the Convex modules where `ctx: any` defeats type checking on database access; (3) enable `--cache` and scope lint to changed directories to bring the runtime under one minute.
- **Test required to verify the fix:** A CI run must fail when a test fixture file with a deliberate `no-explicit-any` violation is introduced, and pass otherwise.

### BUILD-03 — `npm audit` cannot complete; dependency vulnerability status is unknown
- **ID:** BUILD-03
- **Module:** Security / dependencies
- **Severity:** **MEDIUM**
- **Description:** `npm audit --omit=dev` timed out after the full 180 s budget against the registry advisory endpoint (the same host family that also intermittently failed to resolve during the audit window). **The production dependency tree has therefore never been scanned during this audit**, and no dependency-scanning job exists in CI. The production dependency set includes packages that carry real security weight: `next@16.1.1`, `convex@^1.31.2`, `bcryptjs@^3.0.3`, `exceljs@^4.4.0`, `jspdf@^4.1.0`, `resend@^6.35.0`.
- **Steps to reproduce:** `npm audit --omit=dev` → timeout after 180 s, no output.
- **Expected behavior:** A scheduled or CI dependency scan with a known, current vulnerability baseline.
- **Actual behavior:** Unknown. There is no `npm audit` step in `.github/workflows/ci.yml` and no `audit` script in `package.json:5-14`.
- **Root cause:** No dependency-management step in the pipeline; the environment could not reach the advisory service during the audit window.
- **Recommended fix:** Add `npm audit --omit=dev --audit-level=high` to CI (non-blocking on transient registry failure, blocking on a real high/critical finding) and run it on a schedule. Re-run the scan from a host with registry access and record the result.
- **Test required to verify the fix:** The scan completes and its output is stored as an artefact attached to the build.

### BUILD-04 — The production build has no environment pre-flight check
- **ID:** BUILD-04
- **Module:** Build / deployment
- **Severity:** **HIGH**
- **Description:** A build succeeds with a completely wrong environment: CI proves this by design, using `NEXT_PUBLIC_CONVEX_URL=https://placeholder.convex.cloud`. `src/lib/convex-url.ts:14-17` even falls back to that placeholder at runtime, so a production deployment with a missing `NEXT_PUBLIC_CONVEX_URL` builds cleanly and fails only in the browser, with an "Invalid deployment address" error at runtime. The only environment validation that exists is the one added on 19 November 2026 inside the token route (`src/app/api/auth/convex-token/route.ts`), which checks the token configuration only, and only after a request arrives.
- **Steps to reproduce:** Build with `NEXT_PUBLIC_CONVEX_URL` unset → build succeeds; the placeholder is embedded in the client bundle.
- **Expected behavior:** A deployment is rejected, or loudly fails health checks, when required configuration is absent — before users see it.
- **Actual behavior:** Misconfiguration is detected only by users, in the browser console.
- **Root cause:** The placeholder was introduced to avoid opaque prerender crashes, but it converts a build-time error into a runtime error.
- **Recommended fix:** Add a `/api/health` route that verifies every required variable is present and that the Convex deployment answers a `whoami` query, returning the names of anything missing; wire it to a Vercel deployment-protection or uptime check so a bad deploy is caught automatically.
- **Test required to verify the fix:** A staging deploy with a deliberately missing variable must fail its health check, and the check must name the missing variable.

### BUILD-05 — The build takes about 11 minutes; the type-check stage is the bottleneck
- **ID:** BUILD-05
- **Module:** Build / performance
- **Severity:** **LOW**
- **Description:** A cold production build on the audited machine took ~11 minutes end-to-end, of which the TypeScript check stage alone ran for roughly 7 minutes (`.next/diagnostics/build-diagnostics.json` reported `buildStage: "type-checking"` for several minutes). The CI job allows 20 minutes (`timeout-minutes: 20`).
- **Steps to reproduce:** `npm run build` on a cold `.next`; inspect `.next/diagnostics/build-diagnostics.json` during the run.
- **Expected behavior:** A build that completes in a few minutes, with a fast feedback loop.
- **Actual behavior:** ~11 minutes locally; CI is close to its 20-minute timeout.
- **Root cause:** Type checking 150+ client components plus 76 Convex modules in a single pass; no incremental type-check cache in CI.
- **Recommended fix:** Split type-checking from the build in CI (run `tsc --noEmit --incremental` as its own job with a shared cache), and keep the production build job to the bundling step only.
- **Test required to verify the fix:** The CI workflow completes in under 6 minutes on a clean cache.

### BUILD-06 — `next/font/google` makes the build depend on an external network call
- **ID:** BUILD-06
- **Module:** Build / reliability
- **Severity:** **MEDIUM**
- **Description:** `src/app/layout.tsx` originally imported `Geist` and `Geist_Mono` from `next/font/google`, which fetches `fonts.googleapis.com` at build time. During this audit that host was intermittently unreachable from the build machine (a 20 s request timed out with no response, while `fonts.gstatic.com` answered normally); a build that reached the font stage stalled there. The working tree already contained a fix — replacing the `next/font` import with a plain CSS font stack (`src/app/globals.css:50-51`) — which was committed and deployed on 19 November 2026 as part of `953f958`, removing the build-time dependency on Google Fonts entirely.
- **Steps to reproduce:** `curl -s --max-time 20 https://fonts.googleapis.com/css2?family=Geist` → timeout (`http_code 000`) during the audit window; the same request succeeded minutes later, confirming the failure is network-dependent rather than a hard block.
- **Expected behavior:** A build that does not depend on a third-party font CDN being reachable.
- **Actual behavior:** Before `953f958` the build did depend on it; after `953f958` it does not (verified: the live deployment now renders `<body class="font-sans antialiased">`).
- **Root cause:** `next/font/google` performs a build-time network fetch by design.
- **Recommended fix:** Already applied in `953f958`. If the Geist webfonts are wanted later, self-host the font files and use `next/font/local` instead, which needs no network at build time.
- **Test required to verify the fix:** Build with DNS blocked for `fonts.googleapis.com` — it must still succeed.

### BUILD-07 — No deployment runbook, rollback procedure or environment documentation
- **ID:** BUILD-07
- **Module:** Operations
- **Severity:** **MEDIUM**
- **Description:** The repository documents local setup (`README.md:228-239`) but not production deployment: there is no runbook for releasing, no rollback procedure, no list of which environment variables must be set in which scope, and no record of which Convex deployment corresponds to which environment. `.env.example` lists nine variables and notes that `NEXT_PUBLIC_*` values are inlined at build time (`.env.example:10-13`), but nothing ties the Vercel project to the Convex deployment.
- **Steps to reproduce:** `ls docs/` → `AUTH-RBAC.md`, `BUSINESS-MANAGEMENT.md`, `FINANCE-BI.md`, `INTEGRATIONS.md`, `LICENSING.md`, `MULTITENANCY-MIGRATION.md`, `OFFLINE.md`, `QA/` — no deployment or operations runbook.
- **Expected behavior:** A runbook a second engineer could follow: how to release, how to roll back, which variables must be set, how to rotate the signing key without locking everyone out.
- **Actual behavior:** None.
- **Root cause:** Single-operator project.
- **Recommended fix:** Add `docs/OPERATIONS.md` covering release, rollback, environment variable inventory (names only), key rotation procedure (publish the new JWKS first, then switch the signing key, then revoke the old — never the reverse), and Convex deployment mapping.
- **Test required to verify the fix:** A second engineer follows the runbook to perform a release and a rollback on a staging project without further instruction.

### BUILD-08 — Key rotation has no safe procedure and would break every session if done in the wrong order
- **ID:** BUILD-08
- **Module:** Operations / security
- **Severity:** **MEDIUM**
- **Description:** The signing key pair is split across two artefacts that are deployed independently: the public JWK lives in `convex/authJwks.ts` (committed, deployed to the Convex backend) and the private key lives in the Next.js environment. Rotating it means changing both, and the order matters: publishing a new public key before the server can sign with the new private key is safe (old tokens still verify); switching the server first is not (every newly minted token fails verification, because Convex still publishes the old key). No procedure is documented, and `scripts/generate-auth-keys.mjs` prints a *new* key pair without any warning that the public half must be deployed to the backend first — the script's own header comment (`scripts/generate-auth-keys.mjs:9-16`) only says where to paste it.
- **Steps to reproduce:** `node scripts/generate-auth-keys.mjs` → prints a fresh `SMARTBUZ_JWT_PRIVATE_KEY` and a new JWK; the JWK must be pasted into `convex/authJwks.ts` and deployed to Convex, and the private key must then be set in the deployment environment.
- **Expected behavior:** A documented, ordered rotation procedure that never invalidates live sessions.
- **Actual behavior:** Undocumented; the script output does not state the required order.
- **Root cause:** Key rotation was never designed for.
- **Recommended fix:** Extend the script's output with an explicit ordered checklist (1) deploy the new public JWK to Convex and confirm `/auth/jwks` serves it; (2) set the new private key in the deployment environment; (3) redeploy; (4) confirm `/api/auth/convex-token` returns a token and that it verifies. Add the same checklist to `docs/OPERATIONS.md`.
- **Test required to verify the fix:** A staging rotation executed in the documented order keeps existing sessions valid throughout, and the old key can then be removed.

### BUILD-09 — No error monitoring; failures surface only as browser console output
- **ID:** BUILD-09
- **Module:** Operations / observability
- **Severity:** **HIGH**
- **Description:** The dependency list contains no error-reporting service (no Sentry, no Datadog, no OpenTelemetry), and there is no `/api/health` route, no uptime check and no alerting. The token-minting failure of 19 November 2026 was detected because a user read the browser console and pasted it — there is no automated signal that would have raised it. For a POS used in shops, a backend that is silently broken is indistinguishable from a backend that is idle.
- **Steps to reproduce:** `grep -iE 'sentry|datadog|opentelemetry|bugsnag|rollbar' package.json` → no matches; `find src/app/api -name route.ts` → 4 routes, none of them a health check.
- **Expected behavior:** Errors in production reach an operator automatically, within minutes.
- **Actual behavior:** They do not.
- **Root cause:** Observability was never part of the build.
- **Recommended fix:** (1) Add server-side error reporting (Sentry or equivalent) to the Next.js server and to Convex actions; (2) add a `/api/health` route checking configuration and backend reachability; (3) add an external uptime monitor against both the health route and the public pages; (4) log the 503-class failures server-side with a machine-readable code so they can be alerted on.
- **Test required to verify the fix:** An induced 500 in a staging environment must produce an alert, and the health endpoint must report a missing configuration variable by name.

### BUILD-10 — The Convex backend deployment is not part of any automated pipeline
- **ID:** BUILD-10
- **Module:** Build / deployment
- **Severity:** **MEDIUM**
- **Description:** The web application deploys automatically on push, but the Convex backend does not. The two can therefore be at different commits: the web build at `953f958` talks to a backend whose schema and functions were last pushed by hand. `convex/schema.ts` changed in the same commit range as the web application, and a mismatch produces runtime errors in the browser rather than a failed deployment.
- **Steps to reproduce:** `.github/workflows/ci.yml` contains no `convex deploy` step; `convex/README.md` documents `npx convex dev` as a manual step.
- **Expected behavior:** The backend and the web application are versioned and deployed together, or the compatibility boundary is explicit and enforced.
- **Actual behavior:** Manual, unrecorded, and unpinned.
- **Root fix (recommended):** Add a CI job that runs `npx convex deploy` against a dedicated deployment branch on merge to `main`, or record the deployed backend commit in the web build's environment so a mismatch is detectable at boot.
- **Test required to verify the fix:** A deliberate one-line schema change must fail the web build when the backend has not been redeployed.
- **Severity note:** MEDIUM — with the caveat that the actual production risk depends on how far the two have drifted, which is not verifiable from the repository.

---

## 5. Live production surface (measured)

| Check | Result |
|---|---|
| `GET /` without a session | 307 → `/auth/login` (session gate active) |
| `GET /setup` without a session | 307 → `/auth/login` |
| `GET /api/auth` without a session | 401 `{"user":null}` |
| `GET /api/auth/convex-token` without a session | 401 `{"error":"Not signed in."}` |
| `GET /manifest.json` | 200, `application/json` |
| `GET /sw.js` | 200, `application/javascript` |
| `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Content-Security-Policy` | **Absent** — the security headers drafted in `next.config.ts` are not deployed (that file is uncommitted in the working tree) |
| `Strict-Transport-Security` | Present (added by Vercel at the edge, not by the app) |
| Login page JavaScript payload | **746 KB** (14 chunks) |

---

## 6. Findings summary

**BUILD-01** HIGH · **BUILD-02** MEDIUM · **BUILD-03** MEDIUM · **BUILD-04** HIGH · **BUILD-05** LOW ·
**BUILD-06** MEDIUM · **BUILD-07** MEDIUM · **BUILD-08** MEDIUM · **BUILD-09** HIGH · **BUILD-10** MEDIUM

**Counts: 0 CRITICAL, 3 HIGH, 6 MEDIUM, 1 LOW, 0 INFORMATIONAL**

---

## 7. Verdict

The pipeline is **functional and proven**: typecheck, tests and production build all pass, CI is green on
`953f958`, the deployment is automatic on push, and the live system authenticates and serves data. The gap is
**not** in the machinery but in **operational maturity**: the configuration that makes the system work is
unversioned and unvalidated (BUILD-01, BUILD-04), there is no monitoring to notice failures (BUILD-09), there
is no runbook (BUILD-07), and two of the three defined quality gates are either absent from CI or failing
(BUILD-02, BUILD-03). The 19 November 2026 outage is the concrete cost of exactly these four gaps, and it is
the strongest argument for fixing them before the platform takes on more tenants.
