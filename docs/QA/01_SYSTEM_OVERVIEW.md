# SMARTBUZ v2.0 — 01 · System Overview

**Audit date:** 20 November 2026
**Audited commit:** `953f958` (branch `main`, repository `github.com/BEINOMUGISHA/SMARTBUZ`)
**Live production web:** `https://smartbuz.vercel.app`
**Live Convex deployment:** `affable-panda-681.convex.cloud` (site `affable-panda-681.convex.site`)
**Auditor mode:** read-only. No source file, database record or deployment was modified during this audit.

> This document establishes *what the system is*. Whether each part actually works is established in
> `02_FEATURE_AUDIT.md` and the domain reports (`03`–`16`). Every statement below is drawn from the
> repository at the commit named above.

---

## 1. Method and constraints

| Aspect | Detail |
|---|---|
| Repository inspected | `C:\Users\beino\Desktop\SMARTBUZ` at commit `953f958` |
| Inspection method | Static analysis of every module in `src/`, `convex/`, `scripts/`, `tests/`, `.github/` |
| Commands executed | `git rev-parse`, `npm run typecheck` (PASS), `npm test` (PASS, 341 assertions), `npm run build` (PASS), `npx eslint` (TIMED OUT — see `16_BUILD_DEPLOYMENT_REPORT.md`) |
| Live verification | `scripts/verify-identity.mjs` against the live Convex deployment (read-only `whoami` query, 8/8 assertions passed) |
| Not executed (by mandate) | Any script that writes to the live deployment (`tenant-isolation-e2e.mjs`, `vertical-e2e.mjs`, `auth-journey.mjs`, `migrate-to-multitenancy.mjs`, `apply-entitlements.mjs`, `bootstrap-platform-admin.mjs`, `seed-legacy-fixture.mjs`, `probe-*.mjs`); `npm audit` (registry endpoint unreachable during the audit window) |
| Prior audit | `docs/QA/01-architecture.md` … `17-build-deployment.md` (17 files, dated 19 Nov 2026) was read as a lead only. Every reused claim was re-verified against current code; this report set supersedes it and does not edit it. |

---

## 2. Technology stack

| Layer | Technology | Version | Evidence |
|---|---|---|---|
| Web framework | Next.js (App Router, Turbopack) | 16.1.1 | `package.json:56` |
| UI runtime | React / React DOM | 19.2.3 | `package.json:59-60` |
| Language | TypeScript | ^5 | `package.json:80` |
| Styling | Tailwind CSS | ^4 | `package.json:74` |
| Component primitives | Radix UI (20 packages) + shadcn-style local components | various | `package.json:16-42`, `src/components/ui/` |
| Charts | Recharts | ^2.15.4 | `package.json:65` |
| Backend | Convex (client ^1.31.2, runtime 1.31.7 observed) | — | `package.json:47`, browser console |
| Database | Convex hosted document DB | — | `convex/schema.ts` |
| Auth | Custom RS256 JWT (self-issued JWKS) | — | `src/lib/convex-token.ts`, `convex/auth.config.ts` |
| Password hashing | bcryptjs, cost 10 | ^3.0.3 | `package.json:43` |
| Email | Resend | ^6.35.0 | `package.json:66`, `src/lib/email.ts` |
| Export | ExcelJS, jsPDF + jspdf-autotable | ^4.4.0, ^4.1.0 | `package.json:48-49` |
| Date handling | date-fns | ^4.1.0 | `package.json:44` |
| Form state | react-hook-form + @hookform/resolvers | ^7.70.0 | `package.json:62` |
| Notifications | sonner | ^2.0.7 | `package.json:67` |
| Test runner | Node built-in `node:test` + esbuild bundler | Node 22 in CI | `scripts/run-tests.mjs`, `.github/workflows/ci.yml` |
| Hosting | Vercel (git-connected to `main`) | — | `next.config.ts`, deploy observed 19 Nov 2026 21:50 EAT |
| Mobile | **NOT IMPLEMENTED** — `apps/mobile/` contains only `node_modules/` | — | `apps/mobile/` directory listing |

**Dependency note:** `zod` was removed from `package.json` in the working tree; no source file imports it
(verified by repository-wide grep), so no validation library is in use — Convex `v.*` validators are the
only input validation layer.

---

## 3. Deployment topology

```
Browser (PWA, service worker: public/sw.js)
   │  session cookie (HttpOnly, HMAC-SHA256 signed)
   ▼
Next.js 16 App Router on Vercel  ─────────────────────────────┐
   │  /api/auth (login/logout/session)                        │
   │  /api/auth/convex-token  → mints RS256 JWT (15 min)     │
   │  /api/auth/send-verification, /api/send-reset-email      │
   │                                                         │
   ▼                                                         ▼
Convex cloud deployment (affable-panda-681)         Convex cloud deployment
  • queries / mutations / actions                       • /auth/jwks   (public key)
  • 93 tables, 277 indexes                             • /payments/callback (HMAC)
  • tenant guards (convex/tenancy.ts)                   ▲
  • RBAC (convex/rbac.ts)                               │  verified against JWKS
  │                                                     │
  └──────────────── Convex client (convex/react) ───────┘
        authenticated with the minted JWT
```

**Authentication flow (verified end-to-end on the live deployment):**

1. `POST /api/auth` validates credentials server-side, opens a Convex session row, mints a 15-minute
   RS256 token and sets an HttpOnly cookie (`src/app/api/auth/route.ts`).
2. The browser exchanges the cookie for a fresh token via `GET /api/auth/convex-token`
   (`src/app/api/auth/convex-token/route.ts`).
3. `ConvexReactClient` presents the token on every call
   (`src/components/convex-client-provider.tsx:8,40`).
4. Convex verifies the signature against the deployment's own JWKS (`convex/auth.config.ts:24-34`,
   `convex/http.ts:7`), making `ctx.auth.getUserIdentity()` trustworthy.

`scripts/verify-identity.mjs` was executed against the live deployment on 19 Nov 2026: a token signed
with the local private key produced a verified identity (`subject`, `email`, `issuer` all correct),
and forged, foreign-issuer and expired tokens were all rejected.

**Environment configuration.** Thirteen environment variables are read by the code:
`SESSION_SECRET`, `RESEND_API_KEY`, `SMARTBUZ_SERVER_SECRET`, `SMARTBUZ_JWT_PRIVATE_KEY`,
`SMARTBUZ_AUTH_ISSUER`, `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`,
`NEXT_PUBLIC_APP_VERSION`, `RESEND_FROM_EMAIL`, plus `CONVEX_URL` / `CONVEX_SITE_URL`
(platform-provided, `scripts/`) and `NODE_ENV`. Nine are documented in `.env.example`.

> **Production configuration gap (fixed 19 Nov 2026, verified):** the Vercel project was missing
> `SMARTBUZ_JWT_PRIVATE_KEY`, so `/api/auth/convex-token` returned HTTP 503 to signed-in browsers and
> the Convex client silently fell back to anonymous requests — surfacing to users as the misleading
> *"Unauthorized: you must be signed in to access business data"*. The variable was added and the
> project redeployed at commit `953f958`. The failure path was additionally made self-reporting
> (`src/lib/convex-token.ts`, `src/app/api/auth/convex-token/route.ts`,
> `src/components/convex-client-provider.tsx`). See `16_BUILD_DEPLOYMENT_REPORT.md`.

---

## 4. Module map

### 4.1 Web application (Next.js, `src/`)

| Area | Location | Notes |
|---|---|---|
| Route tree | `src/app/(dashboard)/**` | 44 dashboard pages in a `(dashboard)` route group |
| Public routes | `src/app/auth/{login,register,forgot-password,reset-password}` | 4 pages |
| Onboarding | `src/app/setup` | 1 page |
| API routes | `src/app/api/**` | 4 routes: `/api/auth`, `/api/auth/convex-token`, `/api/auth/send-verification`, `/api/send-reset-email` |
| Components | `src/components/**` | 151 `.tsx` files, 121 client components (80%) |
| Shared logic | `src/lib/**` | permissions, session, convex-token, vat, offline engine, hardware, export, escpos, mobile-money, promo-evaluator, business categories |
| Session state | `src/context/auth-context.tsx` | rehydrates from cookie, `users.me` via Convex |
| Convex client | `src/components/convex-client-provider.tsx` | token provider for `convex/react` |
| Edge gate | `src/middleware.ts` | session-only; the license/activation gate was removed by request (`src/middleware.ts:4-9`) |

Dashboard pages (44): appointments, assets, attendance, batches, classes, customers, deliveries,
devices, expenditures, finance, fuel, integrations, inventory, members, menu, platform, prescriptions,
production, purchase-orders, rentals, reports (+9 report sub-routes), rooms, sales, sales/loans,
service-tickets, settings, shops, stock, subscription, suppliers, systemconfig, tables, till.

### 4.2 Backend (Convex, `convex/`)

76 TypeScript modules (excluding generated code). The ten largest by exported function count:

| Module | Functions | Responsibility |
|---|---|---|
| `convex/verticals/operations.ts` | 35 | Cross-vertical operations (production, prescriptions, batches…) |
| `convex/reports.ts` | 27 | Daily/weekly/monthly/branch/tax reports |
| `convex/users.ts` | 26 | Users, sessions, password hashing, verification codes |
| `convex/businesses.ts` | 21 | Businesses, memberships, branches |
| `convex/platform.ts` | 20 | Platform console (subscriptions, entitlements) |
| `convex/shops.ts` | 16 | Shops / outlets |
| `convex/stocks.ts` | 15 | Stock levels and movements |
| `convex/customers.ts` | 15 | Customers, credit, repayments |
| `convex/finance.ts` | 13 | Finance ledger and summaries |
| `convex/sales.ts` + `salesCore.ts` | 9 + core | Sale lifecycle |

Supporting modules: `tenancy.ts` (tenant guards), `rbac.ts` (role/permission matrix), `auth.ts`,
`auth.config.ts`, `authJwks.ts`, `http.ts` (JWKS + payment callback), `jwks.ts`, `serverSecret.ts`,
`crypto.ts` (AES-GCM, PBDF2, constant-time compare), `license.ts`, `subscriptions.ts`,
`entitlements.ts`, `subscriptionState.ts`, `plans.ts`, `billing.ts`, `audit.ts`, `activityLogs.ts`,
`sync.ts` (offline sync), `whoami.ts`, `seed.ts`, `debug.ts`, `defaults.ts`, `migration.ts`,
`analytics.ts`, `dashboard.ts`, `expenses.ts`, `banking.ts`, `loans.ts`, `purchasing.ts`,
`suppliers.ts`, `categories.ts`, `promotions.ts`, `warehouses.ts`, `branches.ts`, `employees.ts`,
`activityLogs.ts`, `userTypes.ts`, `utils.ts`.

**Vertical packages** — `convex/packages/`: pharmacy, restaurant, supermarket, wholesaler, manage,
registry (6). **Vertical extensions** — `convex/verticals/`: batches, members, operations, scheduling,
tax (5).

**Integrations** — `convex/integrations/`: config, engine, hardware, internal, manage, messaging,
payments, reconciliation, registry, templates, types, webhooks + providers (`cards.ts`,
`mobileMoney.ts`, `messaging.ts`).

### 4.3 Data model

`convex/schema.ts` — 2,551 lines, **93 tables**, **277 indexes**. Tables are a mix of tenant-owned
(sales, products, customers, stock, subscriptions-per-business…) and global (plans, industry packages,
platform administration). Tenant-owned tables carry a `businessId` (and frequently `shopId`); the
ownership rule and the guard used on each path are audited in `07_TENANT_ISOLATION_REPORT.md`.

### 4.4 Offline engine

| Component | Location | Role |
|---|---|---|
| Local database | `src/lib/offline/db.ts` (22 KB) | IndexedDB schema and access layer |
| Durable queue | `src/lib/offline/queue.ts` | Pending operations survive a reload |
| Sync engine | `src/lib/offline/sync.ts` (18 KB) | Push/pull, conflict handling, device registration |
| Catalogue cache | `src/lib/offline/catalog.ts` | Cached product catalogue |
| Session cache | `src/lib/offline/session-cache.ts` | Last-known session for offline boot |
| Price lists | `src/lib/offline/price-list.ts` | Offline price resolution |
| Device identity | `src/lib/offline/device.ts` | Device id + app version |
| Network state | `src/lib/offline/network.ts` | Connectivity detection |
| Server side | `convex/sync.ts` | `registerDevice`, `pushTransactions`, `listConflicts`, `resolveConflict`, `getSyncStatus`, `listSyncLogs` |
| Service worker | `public/sw.js`, `public/manifest.json` | Asset caching, installable PWA |

### 4.5 Hardware and peripherals

`src/lib/hardware/`: barcode scanner (keyboard-wedge), thermal receipt printer, cash drawer, scale.
`src/lib/escpos.ts` — ESC/POS byte stream. `convex/integrations/hardware.ts` + `hardwareDevices`
table — device registration against the subscription device limit.

---

## 5. Automated test infrastructure

| Suite | Location | What it exercises |
|---|---|---|
| Permission matrix | `tests/permissions.test.ts` | Real `convex/rbac.ts` + `convex/tenancy.ts` imports |
| Tenant guards | `tests/guards.test.ts` | Guard behaviour on every protected function |
| Finance | `tests/finance.test.ts` | Ledger, totals, tax, rounding |
| Subscriptions | `tests/subscriptions.test.ts` | Plan gating, entitlement, device limits |
| Acceptance | `tests/acceptance.test.ts` | End-to-end business flows in-process |
| Business management | `tests/business-management.test.ts` | Businesses, memberships, branches |
| Integrations | `tests/integrations.test.ts` | Payment/webhook/reconciliation adapters |
| Offline (server) | `tests/offline.test.ts` | Sync push/pull, conflicts |
| Offline (client) | `tests/offline-client.test.ts` | Queue, IndexedDB behaviour |
| Escalation | `tests/escalation.test.ts` | Support escalation paths |
| Helpers | `tests/helpers/` | Shared fixtures and in-memory Convex harness |

**Current result:** `npm test` → **341 assertions, 75 suites, 0 failures** (4.5 s, 19 Nov 2026).

Tests import the *real* backend modules — `scripts/run-tests.mjs` bundles them with esbuild and runs
them under `node --test`, so the suite is genuinely against production logic, not mocks. There is no
browser/E2E test runner (no Playwright/Cypress), no component-test framework, and no Expo test
setup — see `16_BUILD_DEPLOYMENT_REPORT.md` for the coverage gap analysis.

---

## 6. Continuous integration and delivery

`.github/workflows/ci.yml` — triggered on push to `main`, `feat/**`, `fix/**` and on pull requests:

1. `npm ci` (Node 22, npm cache)
2. `npm run typecheck`
3. `npm test` (all suites)
4. `npm run build` (Next.js production build) with placeholder environment values so the build never
   depends on a live backend

Concurrency is handled with `cancel-in-progress`. **CI does not run ESLint**, and does not deploy.

Deployment to Vercel is **git-connected**: a push to `main` triggers a build and production
deployment. This was verified empirically on 19 Nov 2026 — pushing `953f958` produced a new live
build within ~90 s (detected by a content change in the served HTML and new chunk hashes). The Convex
backend is deployed separately (`npx convex dev` / `npx convex deploy`); no workflow deploys it.

There is **no `vercel.json`, no Dockerfile, no infrastructure-as-code and no deployment runbook** in
the repository — production configuration lives in the Vercel dashboard, which is exactly how the
missing-key incident of 19 Nov 2026 became possible.

---

## 7. What exists, and what does not

| Capability | Status | Evidence |
|---|---|---|
| Next.js web application | **IMPLEMENTED** — 50 pages | `src/app/**` |
| Convex backend | **IMPLEMENTED** — 76 modules, 93 tables | `convex/**` |
| Offline synchronization | **IMPLEMENTED** — IndexedDB queue + server sync + conflicts | `src/lib/offline/*`, `convex/sync.ts` |
| Subscription & licensing | **IMPLEMENTED** — plans, entitlements, devices, license keys | `convex/subscriptions.ts`, `license.ts`, `entitlements.ts`, `plans.ts` |
| Industry packages | **IMPLEMENTED** — 6 packages | `convex/packages/` |
| PWA | **IMPLEMENTED** — service worker + manifest | `public/sw.js`, `public/manifest.json` |
| Hardware peripherals | **IMPLEMENTED** — barcode, printer, drawer, scale | `src/lib/hardware/` |
| React Native / Expo mobile app | **NOT IMPLEMENTED** | `apps/mobile/` contains only `node_modules/`; no `package.json`, `app.json`, `App.tsx` or source tree exists |
| Shared TypeScript packages | **NOT IMPLEMENTED** | No `packages/` workspace; shared logic is duplicated by import path, not packaged |
| Browser E2E test runner | **NOT IMPLEMENTED** | No Playwright/Cypress dependency; `tests/` is node-only |
| Monitoring / error tracking | **NOT IMPLEMENTED** | No Sentry/Datadog/OpenTelemetry dependency; only `console.error` in catch blocks |
| Backup & restore | **NOT IMPLEMENTED** | No backup script, export-to-file-of-record, or restore path in the repository |

---

## 8. Audit scope boundaries

- **No destructive testing.** No record was written, deleted or migrated in the live deployment. Any
  behaviour that can only be proven by writing (duplicate-sale idempotency, concurrent stock
  decrements, offline sync conflict resolution against a live peer) is reported as **NOT TESTED** with
  the reason, plus the static analysis of the code path.
- **No source modification.** The only files written by this audit are the reports under `docs/QA/`.
- **Secrets.** No secret value appears in any report; environment variables are referenced by name
  only.
