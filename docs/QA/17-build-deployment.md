# 17 — Build, Deployment and Operations

**Commit audited:** `acafd2b`
**Scope:** `package.json`, `next.config.ts`, `convex.json`, `.github/workflows/ci.yml`,
`scripts/`, `.env.example`, `README.md`.

---

## 1. The build

| Step | Command | Result | Time |
|---|---|---|---:|
| Type-check | `npx tsc --noEmit` | **exit 0** | 339 s |
| Unit tests | `node scripts/run-tests.mjs` | **339 pass, 0 fail** | 7 s |
| Convex codegen | `npx convex codegen` | **exit 0** | 66 s |
| Production build | `npx next build` | **exit 0** | 264 s |

The build produced **54 static pages** and **4 dynamic API routes**, compiled in 84 seconds and
static-generated in 6.

**`next.config.ts` is four lines.** There is no `images` configuration, no `redirects`, no
`headers`, no `rewrites`, no `experimental` flags and no image remote patterns.

**M-64 (Medium).** There are **no security headers** configured. A production deployment
would serve the application without `Content-Security-Policy`, `Strict-Transport-Security`,
`X-Content-Type-Options`, `Referrer-Policy` or `X-Frame-Options`. The `headers()` function in
`next.config.ts` would add all five in a dozen lines.

**M-65 (Medium).** There is no `images.remotePatterns` configuration, while `next/image` is in
use. If the application displays provider logos or product images from another origin, the
optimiser will refuse them at runtime.

---

## 2. The build has an external network dependency — M-66 (Medium)

`src/app/layout.tsx:2` imports `Geist` and `Geist_Mono` from `next/font/google`. Next.js
downloads the font files **at build time**.

**This was observed during the audit.** The first `next build` failed:

```
Error: Turbopack build failed with 1 errors:
[next]/internal/font/google/geist_mono_8d43a2aa.module.css
next/font: error:
Failed to fetch `Geist Mono` from Google Fonts.
```

The second run, from the same working tree, minutes later, **succeeded**. The font URL was
confirmed reachable from the machine at the time of the failure. So the failure was transient —
a network blip, a proxy, or a rate limit on the Google Fonts API.

**A build that fails intermittently because of an external service is a build that will fail
intermittently in production too**, and it will fail on the day it matters most.

**Recommendation:** self-host the fonts with `next/font/local`, or pin the font files in the
repository. The build must depend on nothing but the repository.

---

## 3. Continuous integration

`.github/workflows/ci.yml`:

| Trigger | Branches |
|---|---|
| push | `main`, `feat/**`, `fix/**` |
| pull request | `main` |

```yaml
- run: npm ci
- run: npm run typecheck
- run: npm test
- run: npm run build
  env:
    NEXT_PUBLIC_CONVEX_URL: https://placeholder.convex.cloud
    SESSION_SECRET: ci-placeholder-session-secret-at-least-32-chars
    RESEND_API_KEY: ci-placeholder-key
```

### 3.1 What is right

* **The build does not need a live deployment.** The placeholder values are deliberate and the
  comment says so. `src/lib/convex-url.ts` falls back to a placeholder and surfaces a clear
  error in the browser rather than crashing the prerender, and
  `src/app/api/send-reset-email/route.ts` fails loudly. Both were verified by reading them.
* **The workflow runs on every branch** that matters, and cancels superseded runs.
* **The job has a 20-minute timeout.**

### 3.2 What is missing

| Missing | Why |
|---|---|
| `convex codegen` | A schema change without a codegen leaves `api.d.ts` stale (M-38) |
| `npm run lint` | Defined, never run (M-63) |
| `npm audit` | A high-severity advisory is not noticed (H-03) |
| A `git diff --exit-code convex/_generated` check | Catches a forgotten codegen |
| The operator e2e scripts | `tenant-isolation-e2e.mjs` exists and is never run (M-62) |
| Coverage | No way to see what is covered |
| The mobile application | None on `main` |

### 3.3 Timing

The job runs serially: 339 s + 7 s + 264 s ≈ **610 seconds**, plus `npm ci`. The timeout is
1,200 seconds. It passes with room to spare — but `tsc --noEmit` alone is more than half the
budget, and it is the slowest step by a wide margin.

**M-53 (Low).** Splitting the type-check and the build into two parallel jobs would roughly
halve the wall-clock time and give the failing step sooner.

---

## 4. Deployment

### 4.1 The web application

The target is **Vercel** — `.env.example:6-8` names it explicitly:

> *Production (Vercel): set these under Project → Settings → Environment Variables and enable
> them for Production, Preview and Development.*

There is **no deployment configuration in the repository** — no `vercel.json`, no Dockerfile,
no `docker-compose.yml`, no infrastructure-as-code. The deployment is a Vercel project
configured through its dashboard.

**M-67 (Low).** A `vercel.json` with the build command, the Node version and the environment
variables would make the deployment reproducible and reviewable. Right now it lives in
somebody's dashboard.

### 4.2 The Convex deployment

`convex.json` is one line:

```json
{ "functions": "convex/" }
```

There is **no deployment script** in `scripts/`. The README documents `npx convex dev` for
local development (`README.md:233`), but there is no documented production deployment step,
no `convex deploy` wrapper, and no statement of when the schema is pushed.

**M-68 (Medium).** The order of operations for a production release is undefined. The schema
must be pushed to the Convex deployment *before* the Next.js application that calls the new
functions is deployed — otherwise the client calls a function the backend does not have. This
should be written down and automated.

**Recommendation:** add a `scripts/deploy.mjs` that runs `convex codegen`, `tsc --noEmit`,
the tests, `convex deploy`, and then the Next.js build, in that order, and states the
constraint in a comment.

### 4.3 The database

There is **no migration framework**. Convex's schema is applied by `convex deploy`, and Convex
handles the schema change itself. Data migrations are handled by hand-written scripts:

* `scripts/migrate-to-multitenancy.mjs` — the single-tenant → multi-tenant migration
* `scripts/verify-migration.mjs` — its verification
* `scripts/apply-entitlements.mjs` — applying entitlements to existing businesses
* `scripts/seed-legacy-fixture.mjs` — seeding a legacy fixture

This is the right approach for Convex — a schema change is a deployment, not a migration — but
it means the *data* migrations are one-off scripts that are run by hand and then left in the
repository.

**M-69 (Low).** There is no record of which deployments have had which data migration applied.
`scripts/verify-migration.mjs` helps, but a marker in the database — a row in a `migrations`
table — would make it unambiguous.

---

## 5. Operational scripts

28 scripts. The valuable ones:

| Script | Purpose |
|---|---|
| `generate-auth-keys.mjs` | Generates the JWKS and the private key |
| `bootstrap-platform-admin.mjs` | Creates the first platform administrator |
| `audit-tenant-guards.mjs` | **Audits the tenant guards** — the platform already has a guard audit |
| `tenant-isolation-e2e.mjs` | **End-to-end tenant isolation test** against a live deployment |
| `verify-identity.mjs`, `auth-journey.mjs` | Authentication smoke tests |
| `vertical-e2e.mjs`, `check-vertical-contracts.mjs` | The vertical modules |
| `ui-check.mjs`, `app-smoke-test.ps1` | Interface smoke tests |
| `migrate-to-multitenancy.mjs`, `verify-migration.mjs` | The multi-tenancy migration |
| `run-tests.mjs` | The test runner |

**The platform already has the tools this audit needed.** `scripts/audit-tenant-guards.mjs` and
`scripts/tenant-isolation-e2e.mjs` exist and would have caught C-01 — they are simply not run
by CI.

**M-70 (Medium).** The highest-value change to CI is to run the scripts that already exist.
`tenant-isolation-e2e.mjs` against a preview deployment would catch the class of defect that
produced C-01.

---

## 6. Documentation of operations

### 6.1 `README.md`

Fourteen thousand eight hundred bytes, organised by phase, with a local-setup section and a
"Verifying it" section for each phase. It is a good orientation document.

**M-71 (Low).** The README ends with a block of unformatted developer notes (`README.md:242-257`)
— working reminders about stock reports, HP sales, product swapping, promotions and A5 printing.
They are notes to self, not documentation. They should be moved into an issue tracker or a
`docs/` note.

### 6.2 `docs/`

Seven documents, each covering one phase's design: `AUTH-RBAC.md`, `BUSINESS-MANAGEMENT.md`,
`FINANCE-BI.md`, `INTEGRATIONS.md`, `LICENSING.md`, `MULTITENANCY-MIGRATION.md`, `OFFLINE.md`.

**M-72 (Low).** There is no document that says how to *run* the platform in production: which
environment variables, in which order, which scripts to run, how to create the first platform
administrator, and how to verify a deployment. `README.md` covers local setup only.

### 6.3 `AUDIT.md`

Twenty-eight thousand bytes — the audit that preceded this one. It is referenced throughout the
code comments (*"AUDIT.md §2.1"*). Keeping it is right, and it shows the platform has been
audited before.

---

## 7. Findings

| ID | Severity | Finding |
|---|---|---|
| M-66 | Medium | The production build depends on fetching a font from Google, and failed once during the audit |
| M-64 | Medium | No security headers are configured |
| M-65 | Medium | No `images.remotePatterns` configuration |
| M-68 | Medium | The deployment order (schema before application) is undocumented and unautomated |
| M-70 | Medium | The tenant-isolation end-to-end test exists and is not in CI |
| M-38 | Medium | `convex codegen` is not in CI |
| M-72 | Low | There is no runbook for a production deployment |
| M-67 | Low | No `vercel.json` — the deployment lives in a dashboard |
| M-69 | Low | No record of which data migrations a deployment has had |
| M-71 | Low | The README ends with unformatted working notes |
| M-53 | Low | The CI job is serial and spends most of its time in the type-check |
| — | Good | The build needs no live deployment, and this was verified |
| — | Good | The operator scripts are thorough — including a guard audit and a tenant-isolation e2e |
| — | Good | `convex.json` is minimal and correct |
| — | Good | Convex's own schema deployment avoids a migration framework, which is right for it |
