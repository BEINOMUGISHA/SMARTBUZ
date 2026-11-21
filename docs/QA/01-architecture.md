# 01 — Architecture and System Discovery

**Audit date:** 19 November 2026
**Commit audited:** `acafd2b` — *feat: add the integration adapter layer and the industry packages* (branch `main`, clean tree)
**Method:** read-only inspection of the repository, plus the checks recorded in `.qa-audit/`.

---

## 1. What SMARTBUZ is

SMARTBUZ is a multi-tenant, multi-vertical business management platform for Ugandan small and
medium businesses. It covers retail point of sale, inventory, customer credit books, purchasing,
staff management, finance and reporting, industry packages (supermarket, restaurant, pharmacy,
wholesaler) and a platform-level subscription/licensing console.

It is a **single web application plus a single backend**. There is no second backend, no second
database and no duplicated business logic.

---

## 2. Technology stack, as actually implemented

| Layer | Technology | Evidence |
|---|---|---|
| Web client | Next.js 16.1.1 (App Router, Turbopack), React 19.2.3, TypeScript 5 | `package.json:56`, `.qa-audit/next-build.log` |
| UI | Tailwind CSS 4, Radix UI primitives, shadcn-style components, `lucide-react` icons | `package.json:32-64` |
| Backend | Convex 1.31.2 (queries, mutations, actions, `httpAction` router) | `package.json:47` |
| Language | TypeScript throughout the backend, the client and the tests | `tsconfig.json` |
| Auth | Custom RS256 JWT issued by the Next.js server, verified by Convex against the deployment's own JWKS | `convex/auth.config.ts:24-34`, `src/lib/convex-token.ts:127-170` |
| Data | Convex's hosted document database (no separate SQL server) | `convex/schema.ts` |
| Offline | Browser: IndexedDB + a durable sync queue. Mobile: not yet present on `main` | `src/lib/offline/*`, `convex/sync.ts` |
| Background work | `expo-notifications` (mobile, in progress) / Convex actions (server) | `convex/integrations/*` |
| Testing | `node:test` driven by a custom esbuild bundler (`scripts/run-tests.mjs`) | `tests/` |
| CI | GitHub Actions — typecheck, test, build | `.github/workflows/ci.yml` |

### Codebase size

| Area | Files | Lines |
|---|---:|---:|
| `convex/` (backend, schema, integrations, packages, verticals) | 81 | 41,610 |
| `src/app/` (routes and API) | 80 | 30,108 |
| `src/components/` | 74 | 11,102 |
| `src/lib/` | 29 | 6,781 |
| `src/` (other: context, hooks) | 4 | 467 |
| `tests/` | 11 | 8,374 |
| `scripts/` (tooling, e2e harnesses, codemods) | 28 | 3,646 |
| **Total** | **307** | **102,088** |

---

## 3. Repository layout

```
convex/                     the backend
  schema.ts                 one file, every table (2,551 lines before this audit)
  tenancy.ts                the tenant guard layer — the spine of the system
  rbac.ts                   the role and permission catalogue
  salesCore.ts              the single implementation of "apply a sale"
  sales.ts stocks.ts ...    per-domain functions
  sync.ts                   the offline synchroniser
  integrations/             the adapter framework (11 adapters, 4 hardware descriptors)
  packages/                 industry packages (supermarket, restaurant, pharmacy, wholesaler)
  verticals/                vertical modules (members, operations, scheduling, tax)
src/app/                    57 pages + 4 API routes
src/components/             UI kit, vertical UI kit, offline components, finance components
src/lib/                    session, JWT, offline engine, hardware drivers, exports, VAT
tests/                      10 test files, 339 tests
scripts/                    28 scripts: e2e harnesses, codemods, key generation, test runner
docs/                       7 design documents from earlier phases
```

---

## 4. Architectural assessment

### 4.1 The tenancy spine — good

The strongest thing in this codebase is `convex/tenancy.ts`. It gives one answer to "who is
calling, in which business, with what rights", and it is used consistently:

* `requireUser` reads the caller from the **verified token subject**, never from an argument
  (`convex/tenancy.ts:175-205`).
* `requireTenant` resolves the business, checks membership, loads the business, refuses a
  suspended business (`convex/tenancy.ts:582-600`).
* `requirePermission` checks the effective permission **and** the subscription state in one
  place, so a handler that forgets to check the subscription still cannot write
  (`convex/tenancy.ts:496-518`).
* Platform roles live in a separate `platformAdmins` table, so a business owner can never grant
  themselves one (`convex/tenancy.ts:262-269`).

A static scan of all 440 exported Convex functions found that every business-facing function
resolves a tenant, and the eleven that do not are either legitimately public (`users:login`,
`users:register`, `plans.list`, `whoami`) or are **defects** — see report 09 and the bug register
in report 18.

### 4.2 One implementation of a sale — good

`convex/salesCore.ts` holds `applySale`, used by both `sales.create` (online) and
`sync.pushTransactions` (offline). Prices are re-read from the `stocks` table and the total is
recomputed on the server (`convex/salesCore.ts:522-596`), so a tampered client cannot falsify
revenue. This is the correct design and it is worth saying so plainly.

### 4.3 One catalogue of permissions — good

`convex/rbac.ts` is a single, self-contained module with no imports. The web interface and the
backend read the same list. 44 permissions, 8 roles, and the role matrices are asserted by
`tests/permissions.test.ts`.

### 4.4 The adapter framework — good, but its write path has a hole

The integration framework (report 13) is well designed: an adapter must be *proved against the
real provider* before it may move money or send a message. That rule is enforced in
`prepareAdapterCall` — except that the mutation which records the proof is itself unguarded
(**bug C-02**).

### 4.5 Areas that have grown past their first design

| Area | Observation |
|---|---|
| `convex/schema.ts` | 2,551 lines in one file. Every table, every index, one file. It works, but it is now the largest single file in the repository and the hardest to review. |
| `src/app/(dashboard)/` | 57 pages, many of them thin wrappers over Convex queries. The route tree has grown faster than the component library. |
| `convex/verticals/` | 4 modules, 28 whole-table reads filtered in memory (report 14). The vertical modules predate the tenant index work in the core tables. |
| The web app and the mobile app | The mobile application does not exist on `main`. See report 12. |

---

## 5. Data flow

### 5.1 An online sale

1. The browser signs in against `POST /api/auth`. The server validates the credentials against
   `users:login`, opens a server-side session, mints a 15-minute RS256 access token and sets an
   HttpOnly cookie (`src/app/api/auth/route.ts`).
2. The browser exchanges the cookie for a fresh token through `GET /api/auth/convex-token`
   (`src/app/api/auth/convex-token/route.ts`).
3. `ConvexReactClient` presents the token. Convex verifies it against the deployment's JWKS
   (`convex/http.ts:7`) and `ctx.auth.getUserIdentity()` becomes trustworthy.
4. `sales.create` → `requireTenant` → `requirePermission("sales.create")` → `applySale` →
   price recomputation → stock movement → sale row → stock ledger → promotion triggers.

### 5.2 An offline sale

1. The browser writes the sale to IndexedDB **first** (`src/lib/offline/queue.ts`).
2. When the network returns, `src/lib/offline/sync.ts` pushes the queue to
   `sync.pushTransactions`.
3. The server checks the device is registered and not revoked, checks the idempotency key
   (`by_clientOfflineId`), checks the subscription covered the moment of the sale, then calls the
   same `applySale` (`convex/sync.ts:227-395`).
4. The result is `applied`, `duplicate` or `rejected`, and any stock conflict is recorded
   separately rather than silently swallowed.

---

## 6. What is genuinely strong

1. **The tenant guard layer** is centralised, consistent and tested from both sides — behaviour
   tests in `tests/acceptance.test.ts` and matrix tests in `tests/permissions.test.ts`.
2. **Server-side price validation.** The client is never trusted for money.
3. **The subscription gate inside `requirePermission`.** A handler cannot forget it.
4. **The offline idempotency key.** A sale cannot be recorded twice.
5. **The "unverified adapter may not move money" rule** — the intent is right, and the
   enforcement point is in the right place; one guard is missing (C-02).
6. **A 15-minute, session-bound access token.** Signing out stops the token immediately rather
   than letting it live out its lifetime.
7. **Documentation.** Seven design documents in `docs/`, and code comments that explain *why*.

---

## 7. Where the risk is concentrated

| Risk | Where | Severity |
|---|---|---|
| Cross-tenant financial aggregation | `convex/reports.ts:19-22`, `convex/reports.ts:65-68` | **Critical** |
| Unauthenticated path to mark an adapter "verified" | `convex/integrations/engine.ts:263-300` | **Critical** |
| Unauthenticated path to confirm a payment | `convex/integrations/payments.ts:232-310`, `324-397` | **High** |
| Unthrottled password checking | `convex/users.ts:376` | **High** |
| Dependency advisories | `package.json` | **High** |
| Whole-table reads | `convex/verticals/*` | **Medium** |
| No mobile application | `apps/` absent on `main` | **Medium** |

All of these are detailed in their own reports and in the bug register (report 18).

---

## 8. Assessment

**The architecture is sound and the tenancy model is the strongest part of it.** The problems
found are not architectural: they are three missing guards on write paths that were written for
an internal caller, one aggregate query that forgot the tenant index, and an absence of automated
tests over some of the reporting code.

None of the critical findings require a redesign. All of them are small, local fixes.
