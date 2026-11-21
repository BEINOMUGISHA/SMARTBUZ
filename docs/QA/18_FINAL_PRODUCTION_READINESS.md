# SMARTBUZ v2.0 — 18 · Final Production-Readiness Assessment

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Live production audited:** `https://smartbuz.vercel.app` · **Live backend:** `affable-panda-681.convex.cloud`
**Audit mode:** read-only, with five non-destructive live probes (documented in `06_SECURITY_AUDIT.md` §2)

---

## 1. The verdict

**SMARTBUZ is a substantial, real platform that is not yet safe to grow.**

That is a narrower and more useful statement than a score, so here is the fuller version.

The engineering is good. The sale engine re-reads prices on the server and refuses a client total that does not
match, so the browser cannot dictate what a customer is charged. The tenant resolver treats a request for
somebody else's business as a hard error rather than a fallback. The permission matrix is enforced inside the
Convex functions, and the historical `adminUserId` authority hole from the earlier audit is genuinely closed.
The offline engine queues a sale in IndexedDB with a generated idempotency key, survives a restart, and pushes
it through the *same* sale engine an online sale uses — so offline and online sales are priced identically.
Entitlements are checked server-side in 57 places. The integration layer talks to real provider APIs with
encrypted credentials that provably cannot reach the browser, and a payment can only be confirmed by a real
provider response. None of this is accidental: it reads like the work of someone who understands the
differences between a demo and a product.

But three things are true at the same time, and they are what this assessment turns on.

**First, there is a live cross-tenant write path.** `convex/migration.ts` — a single-tenant migration tool
that was never moved out of the production function set — is callable by any business owner. It accepts an
arbitrary `businessId`, walks every user in the deployment and writes memberships, ownership and tenant
ownership into the business the caller names. It is the highest-severity finding in this audit and the
cheapest to fix: move the module out of the deployed set.

**Second, the commercial model is one mutation away from being void.** `subscriptions.selectPlan` patches a
tenant's `planKey` without a payment, and entitlements are read from that key — so any business owner can
upgrade themselves to the most expensive plan in the catalogue, for nothing, in one call.

**Third, there is no operational layer.** No monitoring, no alerting, no runbook, no reproducible configuration,
no backup, no lint gate, no dependency scan. The 19 November 2026 production outage — the one that prompted
this audit — was detected by a user reading a browser console, because nothing else was watching.

The platform's failure mode is not that it was built badly. It is that **the controls were placed in the
presentation layer instead of the layer that owns the fact**. The rate limiter protects the Next.js route, not
the public Convex mutation that actually checks the password. The tax rate is server-owned, but the tax amount
is computed in the browser and thrown away. The price the customer is quoted comes from a snapshot that the
server no longer uses. Each of these looks correct in isolation and fails in production.

---

## 2. Findings at a glance

| | Raw | Canonical | The four that decide the verdict |
|---|---|---|---|
| CRITICAL | 12 | **6** | BUG-000 deployed reports leak other tenants' revenue · BUG-001 cross-tenant writes · BUG-004 self-service upgrade without payment · BUG-003 unthrottled credential check |
| HIGH | 39 | **23** | BUG-005 ungated tenants · BUG-002 shared seeded identities · BUG-006 price drift breaks checkout · BUG-007 no VAT anywhere |
| MEDIUM | 58 | **28** | BUG-029 unbounded reads · BUG-052 unversioned configuration · BUG-054 no dependency scan |
| LOW | 21 | **16** | |
| INFORMATIONAL | 6 | **3** | |
| **Total** | **136** | **76** | Full register: `17_BUG_REGISTER.md` |

> **One finding needs only a commit.** BUG-000 (the deployed profit-and-loss reports aggregate every tenant's
> sales — `convex/reports.ts:18-23` and `:62-67` at `953f958`) is **already fixed in the working tree** with
> `withIndex("by_businessId_date", q => q.eq("businessId", businessId)…)`. The fix is uncommitted and therefore
> **not in production today**. Committing and deploying it closes a CRITICAL cross-tenant leak in minutes.

**Verified as working** (and worth keeping): the server-authoritative sale engine, the tenant resolver, the RBAC
matrix, the entitlement gate, the offline queue and sync protocol, the licence-key cryptography, the payment
confirmation chain, the credential encryption, the session handling, the password-recovery flow, and the
hardware failure handling.

---

## 3. Can it take another customer tomorrow?

**Not without the P0 list.** The reasoning is specific rather than general:

| Scenario | Today |
|---|---|
| A new customer signs up and pays | Works — `/setup` starts a tracked trial, and a plan activates only from a verified payment |
| A tenant administrator on the shared deployment calls the migration endpoint | **Cross-tenant write.** BUG-001 |
| A business owner upgrades their own plan | **Free, instantly, all entitlements.** BUG-004 |
| An attacker brute-forces a customer password | **Unlimited attempts against a public endpoint.** BUG-003 |
| A tenant's business expires | Correct — reads continue, writes are refused, no data is deleted |
| The owner changes a product's price | **Checkout breaks at the shop counter.** BUG-006 |
| The owner files a VAT return | **Cannot — no VAT figure exists in the data.** BUG-007 |
| The owner reconciles stock against the transaction history | **Cannot — the ledger is never read.** BUG-010 |
| The owner reads their own profit figures | **Overstated.** BUG-011 |
| Something breaks in production at 02:00 | **Nobody is told.** BUG-028 |

Four of those ten rows are the difference between "a working product" and "a platform that can be sold to
businesses that keep their books properly".

---

## 4. The remediation plan

### Phase 0 — this week (≈3–4 engineer-days): close the critical paths

| # | Action | Fixes | Effort |
|---|---|---|---|
| 0 | **Commit the working-tree fix to `convex/reports.ts` and deploy it** — the deployed profit-and-loss reports currently aggregate every tenant's sales | BUG-000 | S |
| 1 | Move `convex/migration.ts` out of the deployed function set, or gate every entry point behind `serverSecretMatches` | BUG-001, DB-01 | S |
| 2 | Put the server secret in front of `users:login`; add a persisted attempt counter and lockout; run a dummy bcrypt comparison for unknown accounts | BUG-003 | S |
| 3 | Stop `selectPlan` patching `planKey` without a verified payment; record a pending change instead | BUG-004 | M |
| 4 | Make `businesses.register` call `startTrial`; treat a missing subscription row as expired, not ungated; make `deviceLimit()` return "no devices" without a subscription | BUG-005 | S |
| 5 | Remove the seeding mutations from the production set, or gate them behind the server secret | BUG-002 | S |
| 6 | Commit `next.config.ts` and redeploy — the security headers are written but not deployed | BUG-014 | S |
| 7 | Add the tenant guard to `recordProviderError`, `recordMessage` and `reportHardware` (or convert the first two to internal mutations) | BUG-013 | S |

*Phase 0 changes the risk profile of the platform. Nothing else on this list matters as much.*

### Phase 1 — the next sprint (≈8–10 engineer-days): money and stock

| # | Action | Fixes | Effort |
|---|---|---|---|
| 8 | Send `clientOfflineId` on online sales and dedupe on it | BUG-009 | S |
| 9 | Add a floor and a dedicated permission to price overrides | BUG-008 | S |
| 10 | Compute the VAT split in `applySale`; store net, tax and rate on the sale; report from the stored values | BUG-007, FIN-11 | M |
| 11 | Net refunds out of revenue; cost the goods sold at the sale's price; fix the report period boundary | BUG-011, FIN-01/02/03/05 | M |
| 12 | Make every stock-balance change write a ledger row; add a balance-vs-ledger reconciliation query | BUG-010, INV-001…009 | L |
| 13 | Price the cart and the sale from one source; treat the issued price as a cost basis | BUG-006, DB-06 | M |
| 14 | Make a "rejected" conflict reverse the sale through `refundSale` | BUG-012 | M |
| 15 | Enforce the credit limit at the point of sale | BUG-020 | S |
| 16 | Validate payment and deposit amounts; refuse client-supplied payment dates; consolidate the two repayment paths | BUG-019, POS-010/012/013/014 | M |
| 17 | Fix the report pagination contract | BUG-024 | S |
| 18 | Add `global-error.tsx`, a dashboard `error.tsx` and per-route `loading.tsx` | BUG-023 | M |
| 19 | Fix the `/setup` temporal-dead-zone crash | BUG-022 | S |
| 20 | Rate-limit the reset and verification email endpoints | BUG-015 | S |
| 21 | Add error reporting, a `/api/health` route, an uptime monitor and alerts | BUG-028 | M |

### Phase 2 — the following sprint (≈6–8 engineer-days): make it operable

| # | Action | Fixes | Effort |
|---|---|---|---|
| 22 | Put the production configuration under version control; add a pre-deployment environment check | BUG-052 | M |
| 23 | Write `docs/OPERATIONS.md`: release, rollback, environment inventory, key rotation | BUG-055 | S |
| 24 | Add `npm audit` and a diff-based ESLint gate to CI | BUG-053, BUG-054 | S |
| 25 | Bound the queries: date-range index reads, paged audit and list queries | BUG-029, DB-02, DB-03 | L |
| 26 | Surface the sandbox state to the operator; add a settlement reconciliation job | BUG-049, BUG-050 | M |
| 27 | Build the backup and restore path | BUG-051 | L |
| 28 | Deploy the Convex backend from CI so it cannot drift from the web build | BUG-056 | M |
| 29 | Move the providers out of the root layout; lazy-load Recharts | BUG-057 | M |
| 30 | Redact cost price from catalogue queries for roles that may not see it | BUG-045 | S |

### Phase 3 — roadmap (not scheduled)

Mobile application (BUG-027) · warehouse-to-warehouse transfers · push notifications · barcode scanning
(BUG-026) · the shared workspace package layout · internationalisation.

---

## 5. What this audit could not determine

Stated plainly, because an audit that claims completeness is lying about something.

| Area | Why |
|---|---|
| Anything requiring writes to the live deployment | The mandate forbids it. Every behavioural conclusion is from static analysis of the code, and the five live probes were read-only (three credential checks that all failed, one unauthenticated mutation call, one header sweep) |
| Runtime performance of the report queries | No monitoring exists to measure it, and seeding a realistic dataset would write to production |
| Provider behaviour | No sandbox credentials were available; every "sandbox-tested" integration is verified as far as its code, payload shape and endpoint constants |
| Whether the seeded accounts ever reached production | The three known addresses were probed and refused; whether other seeded accounts exist cannot be determined without reading production data |
| Whether the migration tool has already been abused | That is a question about production data, which the mandate does not permit reading. **It should be checked directly** — see §6 |
| UI behaviour in a real browser | No browser test runner exists; rendering, focus order and visual regression were assessed statically |

---

## 6. Two things to do outside the code

**1. Check whether the migration tool has already been used.** `convex/migration.ts` has been reachable by any
business owner since it was deployed. The audit could not read production data to see whether it has been
called. Concretely: look for businesses whose `ownerId` changed recently, for memberships created in bulk, and
for rows in `auditLogs` whose action mentions a migration. If it has been called by someone it should not have
been, that is an incident to work through, not just a bug to fix.

**2. Add the monitoring before the next customer.** BUG-028 is listed as Phase 1, but it is the item that
makes every other item verifiable. An error-reporting service and a health check are an afternoon of work; the
19 November outage is what the absence of them cost.

---

## 7. What the platform deserves

The audit found 136 defects in a codebase of this size, and it found them because the code was written to be
read: the tenant resolver explains why a foreign business id is an error and not a fallback; the sale engine
explains why it re-reads the price; the offline engine explains why a row left in `syncing` is safe to retry;
the service worker explains the three rules it follows. Most of the defects are not in those parts.

The two things that most need fixing — the migration tool and the plan-change path — are both small. One is a
file that should not be in the production function set. The other is a `planKey` patch that should wait for a
payment. Both fit in an afternoon, and both change what the platform is.

What is missing is not effort or skill; it is the layer between "the code works" and "the business can rely on
it" — the monitoring, the runbook, the reconciliation job, the configuration that is versioned rather than
remembered. Build that layer and this becomes a strong product. Without it, every fix is invisible until a
customer finds it.

---

## 8. Deliverables

| Report | Purpose |
|---|---|
| `docs/QA/01_SYSTEM_OVERVIEW.md` | What the system is: stack, topology, module map, test infrastructure |
| `docs/QA/02_FEATURE_AUDIT.md` | Module-by-module feature inventory with status |
| `docs/QA/03_FRONTEND_TEST_REPORT.md` | Pages, components, forms, states, client/server divergence |
| `docs/QA/04_BACKEND_TEST_REPORT.md` | Backend modules, authentication, guards, data layer |
| `docs/QA/05_DATABASE_AUDIT.md` | Schema, indexes, integrity, query cost |
| `docs/QA/06_SECURITY_AUDIT.md` | Authentication, secrets, headers, live probes |
| `docs/QA/07_TENANT_ISOLATION_REPORT.md` | Isolation matrix and cross-tenant paths |
| `docs/QA/08_POS_TEST_REPORT.md` | The sale lifecycle |
| `docs/QA/09_INVENTORY_TEST_REPORT.md` | Stock, customers, suppliers, purchasing |
| `docs/QA/10_FINANCIAL_ACCURACY_REPORT.md` | Finance and reporting, independently recomputed |
| `docs/QA/11_LICENSING_TEST_REPORT.md` | Subscriptions, entitlements, devices |
| `docs/QA/12_OFFLINE_SYNC_REPORT.md` | The offline scenario and the sync protocol |
| `docs/QA/13_MOBILE_TEST_REPORT.md` | The mobile application |
| `docs/QA/14_INTEGRATION_TEST_REPORT.md` | Providers, webhooks, reconciliation, credentials |
| `docs/QA/15_PERFORMANCE_REPORT.md` | Payload, query cost, caching, measurement |
| `docs/QA/16_BUILD_DEPLOYMENT_REPORT.md` | Build, CI, deployment, runbook |
| `docs/QA/17_BUG_REGISTER.md` | All 136 findings, consolidated into 75 canonical entries with priority and effort |
| `docs/QA/18_FINAL_PRODUCTION_READINESS.md` | This document |

---

## 9. Audit trail

| Item | Detail |
|---|---|
| Date | 20 November 2026 |
| Commit audited | `953f958` (branch `main`, `github.com/BEINOMUGISHA/SMARTBUZ`) |
| Production audited | `https://smartbuz.vercel.app` (deployed from `953f958`), backend `affable-panda-681.convex.cloud` |
| Scope | Parts 1–18 of the master audit mandate, all 18 reports |
| Method | Static analysis of 76 backend modules, 93 schema tables, 151 components and 50 routes; 341 local test assertions (all passing); a production build (passing); ESLint (1,448 problems); five non-destructive live probes |
| Not done | Any write to the live deployment; any source modification; any deployment; any secret printed |
| Source changes made | **None.** The only files this audit wrote are the 18 reports in `docs/QA/` |
| Prior audit | `docs/QA/01-architecture.md` … `17-build-deployment.md` (17 files, 19 Nov 2026) was read as a lead only and re-verified; it has not been modified |
