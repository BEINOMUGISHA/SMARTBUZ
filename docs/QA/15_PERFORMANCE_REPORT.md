# SMARTBUZ v2.0 — 15 · Performance Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Live production measured:** `https://smartbuz.vercel.app` (deployed from `953f958`)
**Scope:** PART 14 — frontend payload, rendering, query cost, caching, offline behaviour and observed production performance.

---

## 1. Method

| Aspect | Detail |
|---|---|
| Live measurement | Chunk-by-chunk download of every JavaScript asset referenced by the production login page, raw and gzipped (`curl`, `Accept-Encoding: gzip`); production response headers; the Convex sync WebSocket behaviour recorded in the operator's own browser console |
| Static analysis | Query-hook counts per route; the `.collect()` analysis in `05_DATABASE_AUDIT.md`; pagination consumption in `03_FRONTEND_TEST_REPORT.md`; the offline engine in `12_OFFLINE_SYNC_REPORT.md`; the service worker in `public/sw.js` |
| Not done | Load testing, synthetic performance testing, and long-running field telemetry — none is possible without a production monitoring system, and load testing against the live deployment would create the data the mandate forbids |

---

## 2. Measured production payload

| Asset | Raw | Over the wire (gzip) |
|---|---|---|
| Largest chunk (`77bdf70dc7bd2802.js` — the shared React/Next runtime) | 224 KB | 71 KB |
| Second (`a6dad97d9634a72d.js`) | 113 KB | — |
| Third (`b23f42f1b2ad14cc.js`) | 111 KB | — |
| Convex client (`accc32a9d94904d7.js`) | 87 KB | — |
| **Total, all 14 chunks of the login page** | **746 KB** | **227 KB** |

The login page is the smallest route in the application and it already ships **227 KB of JavaScript**. The
dashboard shell — sidebar, navigation, providers, Radix primitives, Recharts, the Convex client — is part of
that payload, and it is loaded before the operator has signed in.

### Query surface per route

| Route | Query hooks (`useQuery` / `usePaginatedQuery` / `useMutation`) |
|---|---|
| `src/app/(dashboard)/page.tsx` (dashboard) | 5 |
| `src/app/(dashboard)/stock/page.tsx` | 10 |
| `src/app/(dashboard)/reports/overview/page.tsx` | 0 (delegates to components under `reports/components/`) |

---

## 3. Summary table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| First-load payload | MEDIUM | live measurement above | 227 KB gzipped before sign-in |
| Route-level code splitting | MEDIUM | live chunk list | The shared runtime dominates; no route-level chunking benefit visible on the login route |
| Backend query cost | **FAILED** | `convex/**` — 333 `.collect()` sites, 0 `.take()` | DB-02, DB-03 |
| Report latency | **FAILED** | `convex/reports.ts` (58 collects), `convex/finance.ts` (19) | Grows with tenant history |
| Paginated query correctness | **FAILED** | `convex/reports.ts:598-605` | Fetches the same page repeatedly (FE-004) |
| Perceived performance (loading state) | **FAILED** | no `loading.tsx` in `src/app` | Blank screen while data loads (FE-003) |
| Offline responsiveness | PASSED | `src/lib/offline/**` | IndexedDB queue, cached catalogue, restart recovery |
| Asset caching | PASSED with a caveat | `public/sw.js` (network-first HTML, cache-first assets) | Cache invalidation is a hand-maintained constant (OFF-06) |
| Connection stability | PASSED with a caveat | operator's console, 19 Nov 2026 | Reconnects succeed; abnormal closures observed |
| Performance monitoring | **NOT IMPLEMENTED** | no monitoring dependency | Nothing in production can be measured (SEC-08) |

---

## 4. Findings

### PERF-01 — 227 KB of JavaScript is downloaded before the operator has signed in
- **ID:** PERF-01 · **Module:** Frontend bundle · **Severity:** MEDIUM
- **Description:** The production login page references 14 JavaScript chunks totalling 746 KB raw / **227 KB gzipped**, of which 71 KB gzipped is the shared React/Next runtime chunk. The same shell — sidebar, Radix primitives, Recharts, the Convex client, the auth provider — is required by every authenticated route, and it is also required by the login route because the providers live in the root layout (`src/app/layout.tsx`). For the target market — a till on a metered or congested mobile connection — the first load is the slowest and most failure-prone moment in the product.
- **Steps to reproduce:** `curl -s https://smartbuz.vercel.app/auth/login | grep -oE '/_next/static/chunks/[^"]+\.js'` then measure each chunk with `Accept-Encoding: gzip`.
- **Expected behavior:** The sign-in route ships only what it needs.
- **Actual behavior:** 227 KB gzipped on the simplest route in the product.
- **Root cause:** The providers were placed in the root layout, so the authenticated shell's dependencies are pulled into the public route.
- **Recommended fix:** (1) Move `ConvexClientProvider` and `AuthProvider` into `src/app/(dashboard)/layout.tsx` and give the auth routes their own minimal layout, so the public route does not pull the shell. (2) Lazy-load Recharts — it is only needed by the report and dashboard routes and is a large dependency. (3) Confirm with a bundle analyser which packages dominate the 224 KB runtime chunk.
- **Test to verify the fix:** A bundle budget in CI that fails when the gzip size of the login route's chunks exceeds a chosen threshold (for example 120 KB).

### PERF-02 — Report queries load the tenant's entire history on every request
- **ID:** PERF-02 · **Module:** Backend query cost · **Severity:** MEDIUM
- **Description:** There are **333 `.collect()` call sites in `convex/` and none is bounded by `.take()`**. `convex/reports.ts` alone has 58, `convex/finance.ts` 19, `convex/verticals/operations.ts` 17, `convex/stocks.ts` 15, `convex/suppliers.ts` 13. A daily report for a business with five years of history loads five years of sales into memory on every request to produce one number. The queries are correctly tenant-scoped, so this is a cost problem rather than a leak — but it is the single most likely cause of the platform becoming slow as a tenant grows.
- **Steps to reproduce:** Static analysis (see `05_DATABASE_AUDIT.md` DB-02, DB-03); a live reproduction would require seeding a production-scale dataset, which the mandate forbids.
- **Expected behavior:** A period report reads the rows inside the period, using a date index.
- **Actual behavior:** The period filter is applied after a full read.
- **Root cause:** Reports were written for correctness; index-range reads were never introduced.
- **Recommended fix:** Add composite date indexes and push the period into the index query; pre-aggregate year-to-date figures into summary tables refreshed by a scheduled job.
- **Test to verify the fix:** A performance test that seeds 200,000 sales and asserts a one-day report completes within an agreed budget.

### PERF-03 — The Global Stock report re-fetches the same page on every "load more"
- **ID:** PERF-03 · **Module:** Reporting / pagination · **Severity:** MEDIUM
- **Description:** `convex/reports.ts:598-605` ignores the cursor and always returns the first `numItems` rows, while reporting `isDone: false` whenever more rows exist. The consumer `src/app/(dashboard)/reports/components/GlobalStockReport.tsx:128-130` therefore keeps calling `loadMoreStock`, each call returning the same rows. Beyond the correctness defect (FE-004 — duplicate rows in the table), this is a network and CPU loop: every "load more" transfers, deserialises and renders a full page of products that the user has already seen.
- **Steps to reproduce:** Open the Global Stock report for a business with more than 20 stock rows and press "Load more" repeatedly.
- **Expected behavior:** Each request returns the next slice; the loop terminates.
- **Actual behavior:** The same slice is returned every time.
- **Root cause:** The query and the consumer disagree about the pagination contract, and no test covers it.
- **Recommended fix:** Implement the cursor as an offset (see FE-004) and let the client stop on the query's `isDone`/`status` flag.
- **Test to verify the fix:** A test that pages the query three times and asserts three disjoint pages.

### PERF-04 — No route has a loading state, so every navigation is a blank screen
- **ID:** PERF-04 · **Module:** Perceived performance · **Severity:** MEDIUM
- **Description:** `find src/app -name 'loading.tsx'` returns nothing. Convex queries are live subscriptions, so a route renders empty and fills in when the first result arrives. On a fast connection this is a flicker; on a slow connection or a cold Convex deployment it is an apparently frozen application. The operator cannot distinguish "loading" from "broken", which is how the 19 November 2026 outage went unnoticed from the interface.
- **Steps to reproduce:** `find src/app -name 'loading.tsx'` → no output; navigate to `/reports/overview` on a throttled connection.
- **Expected behavior:** A skeleton that matches the final layout.
- **Actual behavior:** Empty content.
- **Root cause:** Loading states were never built; the design assumed fast responses.
- **Recommended fix:** Add `loading.tsx` to the heaviest routes with layout-matching skeletons, and expose the Convex query state (`isLoading`) so the skeleton appears only while the *first* result is pending.
- **Test to verify the fix:** A browser test with a throttled network asserting a skeleton is visible before the data arrives.

### PERF-05 — No performance monitoring exists, so none of the above is observable in production
- **ID:** PERF-05 · **Module:** Operations · **Severity:** HIGH
- **Description:** The dependency list contains no error-reporting or performance service, and there is no health endpoint or uptime check. A report that takes 40 seconds in production is indistinguishable from a report that takes 4, because nobody measures it. The platform's own incident history shows the cost: the 19 November 2026 token failure was detected by a user reading a browser console.
- **Steps to reproduce:** `grep -iE 'sentry|datadog|opentelemetry|newrelic' package.json` → no matches; `find src/app/api -name route.ts` → 4 routes, none a health check.
- **Expected behavior:** Real-user latency and error rates are collected, and a deployment that regresses is noticed.
- **Actual behavior:** Neither.
- **Root cause:** Observability was never in scope.
- **Recommended fix:** Add server-side error and latency reporting, instrument the report queries with timing, expose a `/api/health` route, and put an external uptime monitor on it. Convex functions can report their own duration.
- **Test to verify the fix:** An induced slow query in staging produces a latency alert with the function name attached.

### PERF-06 — The sync WebSocket closes abnormally and reconnects without jitter
- **ID:** PERF-06 · **Module:** Real-time connection · **Severity:** LOW
- **Description:** The operator's production console on 19 November 2026 recorded a repeating pattern: `WebSocket closed with code 1006`, `Attempting reconnect in 785ms`, `WebSocket reconnected at t=2668.8s after disconnect due to closed with code 1006`, repeating roughly every 12 minutes. Code 1006 is an abnormal closure — the connection dropped without a close frame. The client recovers correctly (the Convex client reconnects and the log shows a successful reconnection each time), and no data is lost, because the offline queue and the server-side duplicate check cover the gap. The residual issue is the reconnect backoff: the delays shown (785 ms, 1061 ms, 1124 ms, 1241 ms, 4960 ms) grow, but there is no jitter, so many tills reconnecting together after a shared outage will retry in lockstep.
- **Steps to reproduce:** Observed in the operator's browser console against production, 19 Nov 2026, 21:49–21:50 EAT. Not reproducible on demand.
- **Expected behavior:** Reconnects with jittered backoff, and a deployment that stays warm.
- **Actual behavior:** Correct recovery, unjittered retries.
- **Root cause:** Reconnect timing is the Convex client's; the application cannot change it. The underlying cause of the drops (network path, or the Convex deployment idling on the free tier) is outside the application.
- **Recommended fix:** No application change is required for correctness. If the drop frequency is confirmed to be caused by deployment idling, move the Convex deployment to a paid plan. The offline queue already makes the gaps harmless.
- **Test to verify the fix:** Not applicable — this is an observation, not a defect in the application.

### PERF-07 — Asset caches are invalidated by a hand-maintained constant
- **ID:** PERF-07 · **Module:** Caching · **Severity:** LOW
- **Description:** `public/sw.js` precaches `/manifest.json` and `/logo.ico`, serves HTML network-first and static assets cache-first with a background refresh, and never caches API responses — a sound design. The cache namespace is `smartbuz-v5`, a hand-maintained constant (`public/sw.js`, `CACHE_VERSION`). A deployment that changes an asset without bumping the constant leaves stale copies on any till that is offline at that moment, and the service worker will keep serving them.
- **Steps to reproduce:** Static inspection of `public/sw.js`.
- **Expected behavior:** Cache invalidation follows the deployment automatically.
- **Actual behavior:** It follows a manual constant.
- **Root cause:** The service worker is a static file with no build-time link to the deployment.
- **Recommended fix:** Inject the build id into `sw.js` at build time so each deployment owns its cache namespace and the previous one is deleted on activation.
- **Test to verify the fix:** Two consecutive deployments with an asset change; assert the new asset is served and the old cache is removed.

### PERF-08 — Live subscriptions re-render the whole screen on every write
- **ID:** PERF-08 · **Module:** Rendering · **Severity:** LOW
- **Description:** The stock page opens 10 query hooks and the dashboard 5. Each is a live Convex subscription, so a single stock movement re-renders every subscribed component on every till showing that product. For a busy shop with several tills this is a constant stream of renders during peak hours. No measurement of the actual cost was possible (no monitoring), so this is a code-shape observation rather than a measured defect.
- **Steps to reproduce:** `grep -c 'useQuery\|usePaginatedQuery\|useMutation' src/app/(dashboard)/stock/page.tsx` → 10.
- **Expected behavior:** Subscriptions scoped to what the component displays.
- **Actual behavior:** Broad subscriptions on data-heavy pages.
- **Root cause:** Subscription granularity was not designed; queries were taken wholesale from the backend's list functions.
- **Recommended fix:** Add narrower queries (for example a count-only query, a low-stock-only query) and use them on the pages that need them. Measure before and after with real-user monitoring.
- **Test to verify the fix:** A browser test that asserts the number of re-renders after a single mutation does not scale with the number of subscribed components.

---

## 5. What was NOT TESTED, and why

| Item | Why |
|---|---|
| Load testing (concurrent users, request latency) | Requires generating traffic against production; the mandate forbids writes to the live deployment and no staging environment exists |
| Real-user latency percentiles | No monitoring system is installed (PERF-05) |
| Long-run WebSocket stability | Requires an instrumented client over hours |
| Query latency at production data volume | Would require seeding a realistic dataset into the live deployment |
| Memory behaviour of large report queries | Requires a large dataset and a profiler |

---

## 6. Findings summary

**PERF-01** MEDIUM · **PERF-02** MEDIUM · **PERF-03** MEDIUM · **PERF-04** MEDIUM · **PERF-05** HIGH ·
**PERF-06** LOW · **PERF-07** LOW · **PERF-08** LOW

**Counts: 0 CRITICAL, 1 HIGH, 4 MEDIUM, 3 LOW, 0 INFORMATIONAL**

---

## 7. Verdict

Performance is **not the platform's problem** — and that is a real strength. The offline engine means a
congested or failing network degrades into queued sales rather than lost sales, the service worker caches
assets correctly, and the Convex client reconnects without losing work. The sale path re-reads prices on
the server rather than trusting the client, so the "optimise by trusting the browser" failure mode is absent.

What is missing is **scalability discipline and measurement**. Every report query materialises the
tenant's whole history (PERF-02), one report re-fetches the same page indefinitely (PERF-03), and there is
no monitoring at all (PERF-05) — so the platform cannot tell a tenant whose data has outgrown the design
from one whose data has not. The 227 KB first load (PERF-01) is a real cost on a metered connection but is
a tuning problem, not an architectural one.

The practical order is: instrument first (PERF-05), then bound the queries (PERF-02), then fix the
pagination contract (PERF-03), then optimise the bundle (PERF-01).
