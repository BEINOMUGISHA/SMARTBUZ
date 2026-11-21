# 16 — Automated Testing and Quality Assurance

**Commit audited:** `acafd2b`
**Scope:** `tests/` (10 files), `scripts/run-tests.mjs`, `.github/workflows/ci.yml`,
`scripts/` (the e2e harnesses).

---

## 1. What exists

| File | Tests | Focus |
|---|---:|---|
| `tests/integrations.test.ts` | 73 | The adapter registry, webhook signatures, message templates, reconciliation, the industry packages, the hardware drivers |
| `tests/subscriptions.test.ts` | 56 | Plans, subscriptions, billing, licensing, the platform console, entitlements, tenant isolation |
| `tests/offline.test.ts` | 45 | `convex/sync.ts`, `convex/sales.ts`, `convex/salesCore.ts`, `convex/subscriptionState.ts` |
| `tests/business-management.test.ts` | 38 | Customers, suppliers, purchasing |
| `tests/finance.test.ts` | 34 | The finance module, analytics |
| `tests/guards.test.ts` | 32 | The tenancy guards, end to end |
| `tests/permissions.test.ts` | 22 | The RBAC catalogue and the role matrix |
| `tests/acceptance.test.ts` | 19 | The three acceptance statements, written as behaviour |
| `tests/escalation.test.ts` | 10 | Role changes and their effect |
| `tests/offline-client.test.ts` | 10 | The browser sync engine's backoff and due-selection |
| **Total** | **339** | 74 suites, **339 pass, 0 fail** |

**Assessment: a serious test suite for a project of this size.** 339 tests over 102,000 lines
of code, all passing, with the hardest parts — the tenancy guards, the permission matrix, the
offline engine and the subscription engine — covered in depth.

---

## 2. The harness

`scripts/run-tests.mjs` bundles each test file with esbuild (already present as a Next.js
dependency) and runs it under `node:test`. There is no test framework to install and the suite
runs in **7 seconds**.

```powershell
node scripts/run-tests.mjs            # everything
node scripts/run-tests.mjs acceptance # one file
node scripts/run-tests.mjs permissions
```

---

## 3. How the tests reach the backend

`tests/helpers/fake-context.ts` (22,370 bytes) implements a fake Convex context: `ctx.db` with
`query`, `get`, `insert`, `patch`, `delete`, `withIndex`, `withSearchIndex`, `filter`,
`paginate`, `unique`, `first`, `collect`, plus `ctx.auth.getUserIdentity()`.

This is a **unit-test** approach: the guards and the business rules are exercised against an
in-memory database that behaves like Convex's.

### 3.1 Why it is good

* It is fast — 7 seconds for 339 tests, no deployment needed.
* It makes the *rules* the subject of the test rather than the plumbing.
* The acceptance tests are written as behaviour — *"this call is refused"* — so they keep their
  meaning even when the catalogue is rearranged.

### 3.2 Where it is weak — M-61 (Medium)

The fake context is **a re-implementation of Convex's query and index semantics**. It is
22 KB of carefully written code that has to stay faithful to the real platform. Where it is not
faithful, a test passes and the production behaviour differs.

**The concrete example is C-01.** The fake context's `withIndex` applies the conditions it is
given, regardless of the index's name. A query written as
`.withIndex("by_date", (q) => q.gte("date", d))` returns the same rows in the fake and in
production — so a test would not have caught the cross-tenant leak. **And no test covers
`convex/reports.ts` at all** (see §4).

The other risk is the same in miniature everywhere: a test asserts the *fake* rejects
something the real one accepts, or accepts something the real one rejects.

**Recommendation:** add a small suite of integration tests that run against a real Convex
deployment — `convex-test` provides an in-memory Convex server for exactly this. Two or three
end-to-end flows would catch the class of defect the fake cannot.

---

## 4. Coverage gaps — M-09 (Medium)

### 4.1 Modules with no direct test

These modules are imported by **no** test file:

| Module | Why it matters |
|---|---|
| `convex/reports.ts` | **Contains the critical finding C-01.** 27 report endpoints, no tests |
| `convex/stocks.ts` | 14 endpoints, no tests — the inventory rules are untested |
| `convex/shops.ts` | Branch stock, issues, transfers — untested |
| `convex/dashboard.ts` | The dashboard figures the business looks at first — untested |
| `convex/expenses.ts` | Untested |
| `convex/loans.ts` | The credit book — partially covered through `customers.ts`, not directly |
| `convex/promotions.ts` | Untested |
| `convex/warehouses.ts` | Untested |
| `convex/businesses.ts` | Business creation and switching — untested |
| `convex/employees.ts` | Untested |
| `convex/categories.ts` | Untested |
| `convex/audit.ts` | The audit trail — untested |
| `convex/http.ts` | The webhook route — the signature check is tested, the route is not |
| `convex/verticals/*` | 4 modules, 25 whole-table reads — untested |
| `convex/packages/manage.ts` | Untested |
| `convex/packages/restaurant.ts` | Only `canTransition` is tested |
| `convex/seed.ts` | Untested — and it creates users with a known password (M-06) |
| `src/lib/offline/db.ts` | The IndexedDB layer — untested |
| `src/lib/export*.ts` | The Excel and PDF export — untested |
| `src/app/api/*` | The four API routes — untested |

**The pattern is consistent and explicable:** the modules that were built with tests are the
ones the platform's author was most worried about — the guards, the permissions, the offline
engine and the subscription engine. The modules that were built quickly — the reports, the
vertical modules, the exports — were not.

**And the two critical findings in this audit are both in untested code.**

### 4.2 The UI is not tested at all

There is no component test, no end-to-end browser test, and no accessibility test. There are
operator scripts — `scripts/ui-check.mjs`, `scripts/app-smoke-test.ps1`,
`scripts/tenant-isolation-e2e.mjs`, `scripts/vertical-e2e.mjs`, `scripts/auth-journey.mjs` —
but they are **not** part of CI and they need a running deployment.

**M-62 (Medium).** `scripts/tenant-isolation-e2e.mjs` is exactly the test that would have
caught C-01. It exists; it is not run automatically; and it needs a live deployment.

---

## 5. CI

`.github/workflows/ci.yml` runs on every push to `main`, `feat/**` and `fix/**`, and on every
pull request to `main`.

```yaml
- run: npm ci
- run: npm run typecheck      # tsc --noEmit
- run: npm test               # 339 tests
- run: npm run build          # next build
```

The build is given placeholder environment variables
(`NEXT_PUBLIC_CONVEX_URL: https://placeholder.convex.cloud`,
`SESSION_SECRET: ci-placeholder-session-secret-at-least-32-chars`,
`RESEND_API_KEY: ci-placeholder-key`) with a comment explaining that **the build must not
depend on a live deployment**. That is the right instinct, and it is verified: `src/lib/convex-url.ts`
falls back to a placeholder and `src/app/api/send-reset-email/route.ts` fails loudly rather
than pretending to work.

### 5.1 What CI does not do

| Missing | Consequence |
|---|---|
| `convex codegen` | A schema change without a codegen leaves `api.d.ts` stale (M-38) |
| `npm run lint` | `eslint.config.mjs` exists and `npm run lint` is defined, but it never runs |
| `npm audit` | A high-severity advisory is not noticed until someone looks (H-03) |
| The operator e2e scripts | The tenant-isolation end-to-end test is never run |
| A coverage report | There is no way to see what is covered without counting test files |
| The mobile application | There is none on `main` |

**M-63 (Low).** `npm run lint` has never been run in CI. Running it now would probably produce
a list of warnings that has nothing to do with correctness, but a lint job that is not
enforced is a lint job that rots.

---

## 6. What the test suite is genuinely good at

1. **The permission matrix** (`tests/permissions.test.ts`) asserts all 44 permissions against
   every role — the table is in the test, so a new permission that is not added to a role
   fails the build.
2. **The acceptance statements** are written as behaviour, not as matrix assertions.
3. **The offline engine** is tested on both sides — the server (`convex/sync.ts`) and the
   browser (`src/lib/offline/sync.ts`) — including the idempotency and the backoff.
4. **The subscription engine** is tested from every angle: the plans, the devices, the grace
   period, the platform console and the tenant-isolation boundary.
5. **The integration framework** is tested without touching a provider: the registry, the
   signature verification, the templates, the reconciliation matching and the industry price
   resolution.
6. **It runs in 7 seconds.** A suite this fast gets run.

---

## 7. Findings

| ID | Severity | Finding |
|---|---|---|
| M-61 | Medium | The fake Convex context re-implements the platform's semantics; a real-deployment suite would catch a class of defect it cannot |
| M-09 | Medium | `convex/reports.ts`, `convex/stocks.ts`, `convex/shops.ts`, `convex/dashboard.ts` and the vertical modules have no tests — and C-01 is in one of them |
| M-62 | Medium | The operator e2e scripts exist but are not in CI; one of them would have caught C-01 |
| M-63 | Low | `npm run lint` is defined and never run |
| M-38 | Medium | `convex codegen` is not in CI |
| — | Good | 339 tests, 74 suites, all passing, in 7 seconds |
| — | Good | The permission matrix is asserted in full |
| — | Good | The acceptance tests are behavioural |
| — | Good | The hardest subsystems — tenancy, permissions, offline, subscriptions — are covered |

---

## 8. What should be added, in order

1. **Tests for `convex/reports.ts`** — at minimum, a test that asserts a report's totals
   change when another business's data is added. That test would have caught C-01 on the day it
   was written.
2. **A `convex codegen` step in CI**, plus a check that `git diff --exit-code` on
   `convex/_generated` is clean.
3. **An `npm audit --audit-level=high` step.**
4. **`convex-test` integration tests** for three flows: an online sale, an offline sale pushed
   later, and a tenant attempting to read another tenant's data.
5. **Tests for `convex/stocks.ts` and `convex/dashboard.ts`** — the inventory rules and the
   figures the business trusts.
6. **An accessibility and a browser smoke test** in CI, using the scripts that already exist.
