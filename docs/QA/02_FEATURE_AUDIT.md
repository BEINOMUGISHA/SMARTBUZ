# SMARTBUZ v2.0 — 02 · Feature Audit

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Scope:** PART 1 — module-by-module feature inventory. Every functional area of the platform, its status, and the report that carries the evidence.

**How to read this document.** `IMPLEMENTED` means the feature exists and works as described. `PARTIAL` means
it exists but fails in a way that matters. `BROKEN` means it exists and produces wrong results. `NOT IMPLEMENTED`
means there is no code for it. The status is a summary; the evidence, the defects and the fixes are in the
domain report named in the last column.

---

## 1. Summary of the platform

| | Count |
|---|---|
| Functional areas audited | 24 |
| Implemented and working | 9 |
| Partial | 8 |
| Broken | 4 |
| Not implemented | 3 |
| **136 individual findings** across 13 reports | 12 CRITICAL · 39 HIGH · 58 MEDIUM · 21 LOW · 6 INFORMATIONAL |

---

## 2. Feature inventory

| # | Module | Feature | Status | Evidence | Report |
|---|---|---|---|---|---|
| 1 | Authentication | Registration, login, logout, session persistence | **PARTIAL** | Login works and is server-authoritative, but the credential check is an unthrottled public mutation | `04`, `06` |
| 2 | Authentication | Password recovery, verification codes | **IMPLEMENTED** | bcrypt-hashed, expiring, single-use, attempt-capped | `04`, `06` |
| 3 | Authentication | Session cookie, expiry, revocation | **IMPLEMENTED** | HttpOnly + Secure + SameSite=Lax; only a hash of the secret is stored | `04`, `06` |
| 4 | Authentication | Rate limiting | **BROKEN** | The limiter is per-instance, in memory, and bypassable via the public Convex endpoint | `04`, `06` |
| 5 | Multi-tenancy | Tenant resolution, membership, switching | **IMPLEMENTED** | A requested business id the caller does not own is a hard error | `07` |
| 6 | Multi-tenancy | Role and permission matrix (RBAC) | **IMPLEMENTED** | Enforced server-side on every business-scoped mutation | `04`, `07` |
| 7 | Multi-tenancy | Tenant isolation across all modules | **PARTIAL** | Sound everywhere except `convex/migration.ts` and three integration recorders | `07`, `14` |
| 8 | Point of sale | Cart, checkout, payment, receipt | **PARTIAL** | The server re-reads prices and recomputes the total (the most important thing is right), but a price change breaks the checkout and a retry duplicates the sale | `03`, `08` |
| 9 | Point of sale | Discounts and promotions | **PARTIAL** | There is no discount engine; the only "discount" is an unbounded price override, and the customer-facing promotion evaluation uses client-supplied values | `08` |
| 10 | Point of sale | Tax / VAT | **BROKEN** | The rate is server-owned, but the amount is computed only in the browser and is never recorded; no report produces a VAT figure | `03`, `08`, `10` |
| 11 | Point of sale | Refunds and returns | **PARTIAL** | `refundSale` exists and reverses stock and money, but a shop sale is credited to the master warehouse | `08` |
| 12 | Inventory | Products, categories, cost and selling price | **PARTIAL** | Product create/edit works; the edit form writes quantity directly, the cost price reaches cashiers, and a product can be hard-deleted with sales history | `09` |
| 13 | Inventory | Stock movements, adjustments, shop counters | **BROKEN** | The ledger exists and is written, but nine of eleven balance-changing paths write no movement, and issuing stock to a counter does not reduce the warehouse | `09` |
| 14 | Inventory | Barcode scanning | **NOT IMPLEMENTED** | The server helpers exist but nothing calls them; the product form has no barcode field | `09` |
| 15 | Inventory | Valuation, low-stock alerts | **PARTIAL** | Two different valuation bases; the low-stock threshold is one global client-supplied value | `09` |
| 16 | Customers & suppliers | Customer directory, credit sales, repayments, balances | **PARTIAL** | The balance is properly derived and repayment allocation is correct, but the credit limit is never enforced and two repayment paths write the same balance | `09`, `10` |
| 17 | Purchasing | Purchase orders, goods receipt, invoices, supplier payments | **PARTIAL** | The goods-receipt path is the one path that writes both a stock entry and a ledger row; supplier balances are a cached counter kept in step with the ledger | `09` |
| 18 | Finance | Revenue, profit, expenses, cash, debt reports | **BROKEN** | Four separate defects overstate revenue and mis-state cost of goods sold; the last day of a range is dropped | `10` |
| 19 | Licensing | Plans, entitlements, trials, grace, device limits | **BROKEN** | Entitlements are enforced server-side, but a tenant can upgrade itself without paying and a tenant with no subscription row is ungated forever | `11` |
| 20 | Offline | Sale queue, sync, conflicts, restart recovery | **IMPLEMENTED** | A durable IndexedDB queue with generated idempotency keys, pushed through the same sale engine as an online sale | `12` |
| 21 | Integrations | Mobile money, cards, SMS, WhatsApp, email, reconciliation | **PARTIAL** | Real provider adapters with correct payload shapes and encrypted credentials — but three recorders are unguarded, every adapter defaults to sandbox, and nothing repairs a failed payment | `14` |
| 22 | Hardware | Printers, barcode scanners, cash drawer, scale | **IMPLEMENTED** | Web Serial / WebUSB with an honest failure path and a browser-print fallback | `14` |
| 23 | Platform | Multi-business, platform console, subscriptions, devices | **IMPLEMENTED** | Platform writes require a platform permission; every tenant-scoped path enforces membership | `07`, `11` |
| 24 | Mobile | React Native / Expo application | **NOT IMPLEMENTED** | `apps/mobile/` contains only a `node_modules/` tree | `13` |

---

## 3. Areas by implementation status

### 3.1 Implemented and working — 9

These are the parts of the platform that can be relied on.

| Area | What makes it sound |
|---|---|
| Password recovery and verification | Codes are bcrypt-hashed, time-limited, single-use and attempt-capped — and the code is never returned to the browser unless the caller presents the server secret |
| Sessions | HttpOnly, Secure in production, SameSite=Lax; only a SHA-256 hash of the secret is stored; sessions can be listed and revoked by their owner |
| Tenant resolution | A requested business id the caller is not a member of is a hard error, never a fallback |
| RBAC | The permission matrix is enforced inside the Convex functions; the historical `adminUserId` authority pattern is genuinely closed |
| Server-authoritative pricing | The sale engine re-reads every price from the master table, recomputes the total and refuses a mismatch — the browser cannot dictate what is charged |
| Payment confirmation | A plan activates only from a server-verified payment; `confirmPayment` is an internal mutation no client can call |
| Offline sales | A durable, idempotent, restart-safe queue that pushes through the same sale engine — the "cached screens only" failure mode does not apply |
| Hardware | Printing failures fall back to browser printing with an honest toast; the cash drawer is never falsely auto-verified |
| Platform console | Platform writes require a platform permission and are audited |

### 3.2 Partial — 8

| Area | What is missing |
|---|---|
| Registration and login | The flow works; the brute-force defence is on the wrong layer |
| Tenant isolation | Sound in 90% of the modules; broken in one (the migration tool) and leaky in three recorders |
| Checkout | Prices and totals are server-verified; the issued-price snapshot and the master price disagree after a price change, and a retried sale duplicates |
| Discounts | No discount engine at all — only a price override with no floor |
| Refunds | The reversal exists; the location credited is wrong for shop sales |
| Products and categories | CRUD works; quantity is written outside the ledger, cost price leaks, and deletion ignores history |
| Customers and suppliers | Balances are derived correctly; the credit limit is advisory and there are two repayment paths |
| Purchasing | The receipt path is correct; the rest of the module does not write movements |

### 3.3 Broken — 4

| Area | Why it is broken |
|---|---|
| Rate limiting | The limiter protects the presentation layer, not the credential check it is meant to protect |
| Tax / VAT | The rate is server-owned; the amount exists only in the browser and is never persisted, so no tax return can be produced from the system's data |
| Stock movements | The ledger is written but never read, and most balance changes bypass it entirely |
| Financial reports | Revenue is overstated (refunds not netted), cost of goods sold uses the wrong price, and the boundary day of a range is dropped |

### 3.4 Not implemented — 3

| Area | Reality |
|---|---|
| Barcode scanning | Server helpers exist (`convex/packages/supermarket.ts:159`, `convex/stocks.ts:391-442`) but have no caller and no UI |
| React Native / Expo app | `apps/mobile/` holds only a 338-package `node_modules/`; there is no manifest, entry point or source |
| Push notifications | No dependency, no token table, no delivery path |

---

## 4. What the platform does not do at all

Beyond the three features above that are partially or wholly absent, the following are **not present anywhere
in the repository** and were confirmed by search rather than assumed:

| Capability | Search performed | Result |
|---|---|---|
| Cloud storage / object storage | `storage`, `s3`, `bucket` across `convex/` | No integration |
| Backup and restore | `backup` across `src/`, `convex/`, `scripts/` | No code |
| Browser E2E test runner | Playwright / Cypress in `package.json` | Not present |
| Component test framework | Testing Library / Vitest / Jest in `package.json` and `tests/` | Not present |
| Error monitoring / APM | Sentry / Datadog / OpenTelemetry in `package.json` | Not present |
| Scheduled jobs / crons | `convex/crons.ts` | Does not exist |
| Infrastructure as code | `vercel.json`, `Dockerfile`, `docker-compose.yml` | None |
| Internationalisation | Message catalogue / i18n library | None — all strings are hardcoded English |
| Shared workspace packages | `packages/` directory | Does not exist |
| Accessibility audit tooling | axe / pa11y in `package.json` | Not present |

---

## 5. Where the effort should go

The platform is **large and mostly real**. Ninety-three tables, 76 backend modules, 50 pages, six industry
packages, a working offline engine and a genuine payment-integration layer are not a small achievement, and
the parts that were written with care — the sale engine, the tenant resolver, the permission matrix, the
entitlement gate, the offline queue — are careful in a way that shows the author knows what they are doing.

The failures are **not** spread evenly. They cluster in exactly three places:

1. **Tools that were written for one context and shipped into another.** `convex/migration.ts` is a
   single-tenant migration tool; `convex/seed.ts` assumes one global admin email; the integration recorders
   assume the caller is already inside the tenant. All three are in the production function set.
2. **Controls placed in the presentation layer.** The rate limiter, the tax computation and the price the
   customer is shown all live in the browser, where they can be bypassed — and where the business's books
   depend on them, the consequence is wrong money.
3. **The operational layer that was never built.** No monitoring, no runbook, no reproducible configuration,
   no backup, no lint gate, no dependency scan. The 19 November 2026 outage is the bill for this.

Fixing group 1 is a day of work and closes five CRITICAL findings. Group 2 is where the money is. Group 3
is what stops the next incident from being discovered by a user reading a browser console.

---

## 6. Reports

| Report | Covers |
|---|---|
| `01_SYSTEM_OVERVIEW.md` | Architecture, stack, topology, module map, test infrastructure |
| `03_FRONTEND_TEST_REPORT.md` | PART 2 — pages, components, forms, states, a11y, client/server divergence |
| `04_BACKEND_TEST_REPORT.md` | PART 3 + PART 10 — backend modules, auth, guards, data layer |
| `05_DATABASE_AUDIT.md` | PART 10 — schema, indexes, integrity, query cost |
| `06_SECURITY_AUDIT.md` | PART 15 — authentication, secrets, headers, live probes |
| `07_TENANT_ISOLATION_REPORT.md` | PART 9 — isolation matrix, cross-tenant paths |
| `08_POS_TEST_REPORT.md` | PART 4 — the sale lifecycle |
| `09_INVENTORY_TEST_REPORT.md` | PART 5 + PART 6 — stock, customers, suppliers, purchasing |
| `10_FINANCIAL_ACCURACY_REPORT.md` | PART 7 — finance and reporting, recomputed |
| `11_LICENSING_TEST_REPORT.md` | PART 8 — subscriptions, entitlements, devices |
| `12_OFFLINE_SYNC_REPORT.md` | PART 11 — the offline scenario and the sync protocol |
| `13_MOBILE_TEST_REPORT.md` | PART 12 — the mobile application |
| `14_INTEGRATION_TEST_REPORT.md` | PART 13 — providers, webhooks, reconciliation, credentials |
| `15_PERFORMANCE_REPORT.md` | PART 14 — payload, query cost, caching, measurement |
| `16_BUILD_DEPLOYMENT_REPORT.md` | PART 17 — build, CI, deployment, runbook |
| `17_BUG_REGISTER.md` | The consolidated register of all 136 findings |
| `18_FINAL_PRODUCTION_READINESS.md` | The verdict and the remediation plan |
