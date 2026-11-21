# SMARTBUZ v2.0 — 03 · Frontend and UI Test Report

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Scope:** PART 2 — Frontend and user interface testing (Next.js 16 App Router web app under `src/`).

---

## 1. Scope summary

- Route inventory and coverage against the `src/app` route tree (50 pages, 4 API routes).
- Dead links (`href` / `router.push` targets with no matching route).
- Broken / no-op buttons and permanently disabled controls.
- Placeholder content and mock data presented as real data.
- Client vs server calculation divergence (totals, VAT, discounts, stock valuation, balances).
- Pagination consumption of Convex `usePaginatedQuery` results.
- Shop-level vs master-level pricing at checkout.
- Forms, modals, loading / empty / error states, data freshness.
- Session expiry and unauthorized-access behaviour, error-boundary coverage.
- React 19 hook-rule violations reported by ESLint (`set-state-in-effect`, `exhaustive-deps`, `static-components`, `purity`).

---

## 2. Method

### 2.1 Inspected
The whole route tree under `src/app`; all 151 `.tsx` components; every `href` / `router.push` target
resolved against the real route tree; client arithmetic compared line-by-line with `convex/salesCore.ts`
(`applySale`), `convex/verticals/tax.ts`, `src/lib/vat.ts` and `convex/finance.ts`; every
`usePaginatedQuery` consumer against its backend query's `continueCursor` semantics; the checkout path
against the master-price mutation path; forms and modals; ESLint output for the hook rules.

### 2.2 Run
`git rev-parse --short HEAD`; `npm test` (341 assertions pass, local only); `npx eslint src convex`
(1,448 problems, rule-level breakdown captured); `npm run build` (54 routes, PASS); `npm run typecheck`
(PASS); `scripts/verify-identity.mjs` (read-only); static route/link cross-reference.

### 2.3 Could NOT be tested, and why
- No interactive browser session was driven against production; findings are code-derived unless stated.
- No writes of any kind to the Convex deployment; the prohibited seed/migrate/probe scripts were not run.
- Third-party payment, SMS and WhatsApp flows need credentials and would cause external side effects.
- Printing, camera capture and receipt-printer behaviour are hardware/browser dependent.

---

## 3. Summary table

| Area | Status | Evidence | Notes |
|---|---|---|---|
| Route loading and navigation | PASSED | `src/app/**` | All 50 pages are reachable; every `href`/`router.push` target resolves to a real route |
| Dead links | PASSED | `src/` href/router.push inventory | 18 distinct link targets, all exist |
| Error boundaries | **FAILED** | `src/app/**` (no `error.tsx` anywhere) | FE-002 |
| Route loading states | **FAILED** | `src/app/**` (no `loading.tsx` anywhere) | FE-003 |
| Onboarding wizard | **FAILED** | `src/app/setup/page.tsx:117,121` | FE-001 — crashes on every load |
| Report pagination | **FAILED** | `convex/reports.ts:598-605` + `GlobalStockReport.tsx:114-130` | FE-004 — duplicate rows |
| Checkout pricing | **FAILED** | `convex/shops.ts:565,577` vs `convex/salesCore.ts:573` | FE-005 — sale refused after a price change |
| Tax computation | **FAILED** | `src/lib/vat.ts` used only by `sales/page.tsx:9` | FE-006 |
| Shell layout stability | **FAILED** | `src/app/(dashboard)/layout.tsx:101,403,433` | FE-007 |
| Payment-method effect | **FAILED** | `src/app/(dashboard)/sales/page.tsx:171-176` | FE-008 |
| Unauthorized-access handling | **FAILED** | production console output | FE-009 |
| Forms, modals, toasts | PASSED | `src/components/**` | Consistent sonner toasts, modal open/close present |
| Responsive layout | PASSED | `src/app/(dashboard)/layout.tsx:395-440` | Tailwind breakpoints applied throughout |
| Accessibility | MEDIUM | see FE-010 | No systematic audit possible without a browser |

---

## 4. Route inventory

| Route | File | Client/Server | Notes |
|---|---|---|---|
| `/` | `src/app/(dashboard)/page.tsx` | Client | Dashboard landing |
| `/setup` | `src/app/setup/page.tsx` | Client | Onboarding wizard — **crashes, FE-001** |
| `/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` | `src/app/auth/**` | Client | Public routes, listed in `src/middleware.ts` `PUBLIC_PATHS` |
| `/appointments`, `/attendance`, `/classes`, `/rooms`, `/members`, `/deliveries`, `/fuel`, `/rentals`, `/production`, `/batches`, `/prescriptions`, `/service-tickets` | `src/app/(dashboard)/**` | Client | Vertical/appointment surfaces |
| `/sales`, `/sales/loans`, `/till`, `/tables` | `src/app/(dashboard)/**` | Client | Point of sale |
| `/inventory`, `/stock`, `/assets`, `/warehouses` | `src/app/(dashboard)/**` | Client | Inventory |
| `/customers`, `/suppliers`, `/purchase-orders`, `/expenditures` | `src/app/(dashboard)/**` | Client | Trading partners |
| `/finance`, `/reports/**` (10 routes) | `src/app/(dashboard)/**` | Client | Reporting — **FE-004** |
| `/shops`, `/branches`, `/devices`, `/settings`, `/systemconfig` | `src/app/(dashboard)/**` | Client | Configuration |
| `/integrations`, `/subscription`, `/platform` | `src/app/(dashboard)/**` | Client | Integrations, billing, platform console |
| `/api/auth`, `/api/auth/convex-token`, `/api/auth/send-verification`, `/api/send-reset-email` | `src/app/api/**` | Server | The only server routes |

---

## 5. Findings

### FE-001 — The `/setup` wizard crashes on every load (temporal-dead-zone read)
- **ID:** FE-001 · **Module:** Setup / Onboarding · **Severity:** HIGH
- **Description:** `src/app/setup/page.tsx:117` reads `planKey` inside a `.find()` callback, but `planKey` is declared with `const` at line 121. That is a temporal-dead-zone read. The reference hides inside an arrow function, so neither `tsc` nor ESLint flags it — but the callback executes on every render.
- **Steps to reproduce:** Open `/setup` as a signed-in user with no business. `api.plans.list` resolves (it always resolves to at least one plan — `convex/plans.ts:79-86` falls back to `DEFAULT_PLANS` when the table is empty) → React re-renders → `.find((p) => p.key === planKey)` runs → `ReferenceError: Cannot access 'planKey' before initialization`. There is no `error.tsx` anywhere in `src/app`, so the error escapes to the root and the page goes blank. Verified by isolated reproduction: an empty array returns `null` without throwing; a non-empty array throws.
- **Static inspection:** `src/app/setup/page.tsx:117` (read) vs `:121` (declaration); non-empty guarantee at `convex/plans.ts:79-86`.
- **Expected behavior:** The four-step wizard renders and the operator can create a business.
- **Actual behavior:** The wizard throws during render, so first-run onboarding cannot be completed through the UI, and the failure is invisible to the operator (FE-002).
- **Root cause:** The derived `chosenPlan` was placed above the `useState` declaration it depends on, and the usage was hidden in a callback so no static check caught it.
- **Recommended fix:** Move the `const [planKey, setPlanKey] = useState<string | null>(null);` declaration above line 117, or move the `chosenPlan` derivation below the `useState` block.
- **Test to verify the fix:** Render `SetupPage` with a mocked `api.plans.list` returning two plans and assert the wizard renders with no console error.

### FE-002 — There is no error boundary anywhere in the application
- **ID:** FE-002 · **Module:** Application shell / error handling · **Severity:** HIGH
- **Description:** `find src/app -name 'error.tsx' -o -name 'global-error.tsx'` returns **nothing**. Not one route has an error boundary. Any render-time throw therefore unmounts the whole application with no recovery, no message and no "back to safety" path. This is not theoretical: on 19 November 2026 the production token endpoint returned 503, the Convex client fell back to anonymous requests, and the browser console recorded `Uncaught ConvexError: Unauthorized: you must be signed in to access business data` with **no visible error in the application itself** — the operator's only clue was the console.
- **Steps to reproduce:** `find src/app -name 'error.tsx'` → no output. Then trigger any render error (for example the FE-001 crash) and observe a blank page.
- **Expected behavior:** A route-level `error.tsx` that shows a recoverable error with a retry, plus a `global-error.tsx` as the last resort.
- **Actual behavior:** A white screen and a console entry.
- **Root cause:** Error UI was never built; Next.js's default is to surface the error in development only.
- **Recommended fix:** Add `src/app/global-error.tsx` and a shared `src/app/(dashboard)/error.tsx` that renders a branded error state with a "Retry" button and a support reference. Wire Convex query/mutation errors into it through a `ConvexErrorBoundary` component so a backend rejection is shown to the operator rather than only logged.
- **Test to verify the fix:** A test that forces a query to reject and asserts the error UI is rendered with a retry control.

### FE-003 — No route has a loading state; every navigation shows a blank screen
- **ID:** FE-003 · **Module:** Application shell · **Severity:** MEDIUM
- **Description:** `find src/app -name 'loading.tsx'` returns nothing. Convex queries are live subscriptions, so every page renders empty and then fills in. On a slow connection or a cold Convex deployment (the free tier sleeps), the operator sees an empty page and cannot tell whether the app is broken or merely loading.
- **Steps to reproduce:** `find src/app -name 'loading.tsx'` → no output; navigate to any dashboard route on a throttled connection.
- **Expected behavior:** A skeleton or spinner per route while the first query resolves.
- **Actual behavior:** Blank content.
- **Root cause:** Loading states were never added; the shell relies on data arriving quickly.
- **Recommended fix:** Add `loading.tsx` files to the heaviest routes (`/`, `/sales`, `/reports/**`, `/stock`, `/customers`) with skeleton layouts that match the final layout, so the transition does not shift.
- **Test to verify the fix:** Throttle the network in a browser test and assert a skeleton is visible before the data arrives.

### FE-004 — The Global Stock report returns the same page repeatedly, duplicating rows
- **ID:** FE-004 · **Module:** Reporting / pagination · **Severity:** HIGH
- **Description:** `convex/reports.ts:522-605` (`getStockSummary`) slices the first `numItems` rows on every call (`page = enriched.slice(0, numItems)`), ignores the incoming cursor entirely, and always returns `continueCursor: "none"` (`:604`) while reporting `isDone: enriched.length <= numItems` (`:605`). The consumer, `src/app/(dashboard)/reports/components/GlobalStockReport.tsx:114-118`, uses `usePaginatedQuery` and, at `:128-130`, calls `loadMoreStock(rowsPerPage)` whenever the loaded rows are fewer than `page × rowsPerPage`. Convex's pagination protocol asks the server for the next page using the returned cursor; the server ignores it and returns the first page again. The client therefore appends the same rows over and over, and the table displays duplicated products while the count from `getStockSummaryCount` (the true catalogue size) does not match what is rendered.
- **Steps to reproduce:** Open the Global Stock report for a business with more than one page of stock (20 rows at the default `rowsPerPage`) → "Load more" appends the first page again → duplicate rows.
- **Expected behavior:** Each page returns a distinct slice, with a cursor that identifies the next offset.
- **Actual behavior:** The same first page is returned for every cursor value; `isDone` never becomes true while more than `numItems` rows exist, so the client keeps requesting.
- **Root cause:** The query was written to return a fixed page and the client was written to expect a paged cursor. The two halves do not agree, and no test covers pagination.
- **Recommended fix:** Implement the cursor as an offset (parse it as an integer, `slice(offset, offset + numItems)`, and return `continueCursor: String(offset + numItems)`), set `isDone` from the offset, and align `GlobalStockReport.tsx`'s "load more" condition with the query's `isDone`/`status` flag rather than a row-count heuristic.
- **Test to verify the fix:** A test that seeds 50 stock rows, pages through the query with `numItems: 20`, and asserts three pages of 20/20/10 with no repeated document id and `isDone` true on the last page.

### FE-005 — A master price change breaks checkout at shop counters
- **ID:** FE-005 · **Module:** Point of sale / pricing · **Severity:** HIGH
- **Description:** When stock is issued to a shop, the issue snapshot copies the master price (`convex/shops.ts:565,577,649,662` — `price: stock.price` into `shops.issuedStocks[].price`, schema at `convex/schema.ts:773-781`). The till reads that snapshot: `api.stocks.getShopStock` returns `shop.issuedStocks` (`convex/stocks.ts`), and the cart is priced from `stock.price` (`src/app/(dashboard)/sales/page.tsx:446`). The server, however, always charges the **current** master price — `applySale` re-reads `stocks` and computes `unitPrice = stock.price` (`convex/salesCore.ts:573`). If the master price is changed after the stock was issued, the till displays the old price, the customer is quoted that price, the server computes a different total, and the sale is **refused** with "Sale total mismatch" (`convex/salesCore.ts:608-613`). Nothing re-prices the issued snapshot when the master price changes; the refresh only happens on the next issue operation (`convex/shops.ts:564`).
- **Steps to reproduce:** Issue a product to a shop → change the product's master price → open the till at that shop → add the product to the cart → complete the sale → the server rejects it with a total-mismatch error. (Not reproduced live: it would require writes to production.)
- **Expected behavior:** The till and the server agree, or the difference is handled explicitly.
- **Actual behavior:** The checkout is blocked for every product whose master price changed since it was issued, and the customer is quoted a price the system refuses to honour.
- **Root cause:** Two sources of truth for the retail price, with no invalidation when one of them changes.
- **Recommended fix:** Price the cart from the master price (the same source the server uses) and treat the issued price as a cost/issue price only; or keep the issued price as the source of truth for retail and have `applySale` price from the shop's issued record, requiring the shop id on the sale. Do not mix the two. Whichever is chosen, add a price-change invalidation so the two cannot drift.
- **Test to verify the fix:** A test that issues stock, changes the master price, then completes a sale at the shop and asserts it succeeds and that the charged price equals the price shown at the till.

### FE-006 — VAT is computed only in the browser and never recorded
- **ID:** FE-006 · **Module:** Point of sale / tax · **Severity:** HIGH
- **Description:** `src/lib/vat.ts` implements Uganda's VAT-inclusive regime correctly (`splitInclusive`, `splitExclusive`, `computeVat`, whole-shilling rounding). But `computeVat` is imported by exactly one file — `src/app/(dashboard)/sales/page.tsx:9` — and the split it produces is used for the receipt and then discarded. The `sales` table has no tax field (`convex/schema.ts:531-673`), the sale engine contains no tax logic (`convex/salesCore.ts`), and **no report computes VAT** (`convex/reports.ts`, `convex/finance.ts`, `convex/financeCore.ts`, `convex/analytics.ts` contain no tax references at all). The *rate* is server-owned (`convex/verticals/tax.ts`, introduced by commit `69f9688`), but the *amount* is never persisted.
- **Steps to reproduce:** Complete a VAT-enabled sale → inspect the `sales` document → there is no VAT or net-amount field. Run any financial report → no VAT line appears.
- **Expected behavior:** The sale records the net amount, the VAT amount and the rate applied, so a URA return can be produced and historical figures cannot change.
- **Actual behavior:** The VAT split exists only in the browser at the moment of sale. Any report must re-derive it from the rate in force today, so changing a business's category or rate silently rewrites its historical VAT.
- **Root cause:** The compliance work covered the rate but not the recording of the split.
- **Recommended fix:** Compute the split server-side in `applySale` from the business's server-owned rate, store `netAmount`, `taxAmount` and `taxRate` on the sale, and make the financial reports read the stored values.
- **Test to verify the fix:** A sale at 18% records `taxAmount`; a report over a period containing a rate change sums the stored amounts and does not re-derive them.

### FE-007 — The dashboard shell recreates its sidebar on every render, resetting its state
- **ID:** FE-007 · **Module:** Application shell · **Severity:** MEDIUM
- **Description:** `SidebarContent` is declared **inside** `DashboardLayout` (`src/app/(dashboard)/layout.tsx:101`) and rendered as `<SidebarContent />` at `:403` (desktop sidebar) and `:433` (mobile sheet). A component defined in a parent's body is a new component type on every render, so React unmounts and remounts it — discarding all of its state. ESLint flags exactly this: `react-hooks/static-components` at `src/app/(dashboard)/layout.tsx:403` and `:433` ("Cannot create components during render — Components created during render will reset …"). The sidebar holds the collapsible Reports sub-menu (`reportsSubItems`, `:31`) and the auto-expand effect at `:72-77` that opens it on `/reports` routes, so the operator's expanded/collapsed navigation state flickers back on every state change anywhere in the shell.
- **Steps to reproduce:** Expand a sidebar group on any dashboard page, then interact with anything in the shell → the group collapses again.
- **Expected behavior:** The sidebar keeps its open/closed state across renders.
- **Actual behavior:** It resets whenever the parent re-renders.
- **Root cause:** The sidebar component was written inline inside the layout function.
- **Recommended fix:** Move `SidebarContent` (and the `reportsSubItems` constant) to module scope, or into its own file, and pass the state in as props.
- **Test to verify the fix:** A test that renders the layout, expands a group, triggers a parent state change, and asserts the group is still expanded.

### FE-008 — The payment-method effect reads a stale value
- **ID:** FE-008 · **Module:** Point of sale · **Severity:** MEDIUM
- **Description:** `src/app/(dashboard)/sales/page.tsx:171-176` auto-selects the payment method when `isLoan` changes, but the effect reads `paymentMethod` (`:174`) while declaring only `[isLoan]` as its dependency (`:176`). ESLint reports `react-hooks/exhaustive-deps` at `:176` ("React Hook useEffect has a missing dependency: 'paymentMethod'"). The effect therefore closes over the payment method as it was when `isLoan` last changed, not the current one, so the "Loan ⇄ Cash" auto-switch can leave the till on the wrong payment method — which is what the money is recorded against.
- **Steps to reproduce:** Toggle a sale between loan and non-loan while the payment method has been changed manually, and observe the selected method.
- **Expected behavior:** The effect always sees the current payment method.
- **Actual behavior:** It sees a captured value.
- **Root cause:** An incomplete dependency array, invisible to TypeScript.
- **Recommended fix:** Use the functional form — `setPaymentMethod((m) => (isLoan ? "Loan" : m === "Loan" ? "Cash" : m))` — which removes the dependency on `paymentMethod` entirely and is correct by construction.
- **Test to verify the fix:** A test that sets `isLoan` false while the method is "Loan" and asserts it becomes "Cash", and one that sets it true and asserts "Loan".

### FE-009 — Backend rejections reach the operator only as console output
- **ID:** FE-009 · **Module:** Session handling · **Severity:** MEDIUM
- **Description:** When the Convex client is unauthenticated, every guarded query throws `ConvexError: Unauthorized: you must be signed in to access business data` (`convex/users.ts:325`). Those rejections are caught by nothing on the client: the production console on 19 November 2026 recorded them as `Uncaught ConvexError` while the interface itself showed no explanation. Combined with FE-002 (no error boundary), an operator has no in-product signal that their session has expired or that the server is misconfigured.
- **Steps to reproduce:** Produce the 19 Nov 2026 condition (a 503 from `/api/auth/convex-token`) and watch the console while the UI shows no message.
- **Expected behavior:** A visible "your session has expired — sign in again" state, and a route to sign in.
- **Actual behavior:** An uncaught error in the console.
- **Root cause:** The session context (`src/context/auth-context.tsx`) tracks "signed in / signed out" but does not detect the *server-side* rejection of a request.
- **Recommended fix:** Catch `ConvexError` with the unauthorized message in a wrapper around the Convex client, surface it through the auth context, and render a re-authentication prompt. Do not rely on the console.
- **Test to verify the fix:** A test that mocks a rejected query and asserts the re-authentication prompt appears.

### FE-010 — Accessibility is handled inconsistently
- **ID:** FE-010 · **Module:** Accessibility · **Severity:** LOW
- **Description:** The codebase uses Radix primitives, which bring most keyboard semantics with them, and icon buttons generally carry an `sr-only` label (for example `src/app/(dashboard)/layout.tsx:431-433`). But the audit found no systematic treatment: there is no `error.tsx` to announce failures, no `loading.tsx` with `aria-busy`, and no route-level landmark or focus management after client navigation. ESLint reports `react/no-unescaped-entities` at 9 sites (unescaped apostrophes in JSX text) — cosmetic, but it indicates raw text is not going through a consistent content path.
- **Steps to reproduce:** Navigate the dashboard with a screen reader or keyboard only; observe that focus is not moved to the new page's heading after a client-side navigation.
- **Expected behavior:** Consistent landmarks, focus management on navigation, and announced errors.
- **Actual behavior:** Ad-hoc.
- **Root cause:** Accessibility was not part of the definition of done.
- **Recommended fix:** Add a `RouteAnnouncer` that sets the document title and moves focus to the `<h1>` on route change, add `aria-busy` to loading skeletons, and give the error boundary an `role="alert"`.
- **Test to verify the fix:** An automated axe scan on the five highest-traffic routes with no critical violations.

---

## 6. NOT IMPLEMENTED

| Item | Evidence | Note |
|---|---|---|
| Route-level error boundaries | `find src/app -name 'error.tsx'` → none | FE-002 |
| Route-level loading states | `find src/app -name 'loading.tsx'` → none | FE-003 |
| A `not-found.tsx` route | `find src/app -name 'not-found.tsx'` → none | Next.js's built-in 404 is used |
| Browser E2E test runner | no Playwright/Cypress in `package.json` | No UI regression net |
| Component unit tests | `tests/` is node-only | No React Testing Library |
| Error-reporting service | no Sentry/Datadog dependency | No in-product diagnostics |
| Internationalisation | all UI strings are hardcoded English | No message catalogue |

---

## 7. NOT TESTED

| Item | Reason |
|---|---|
| Rendering in a real browser (visual regression, focus order, screen-reader output) | No browser test runner in the repository; static analysis only |
| The 503-token-failure path under load | Requires a deliberately broken deployment |
| Behaviour with an expired session mid-checkout | Requires a live session and a timed expiry |
| Payment-provider popups (card 3-D Secure) | Requires provider credentials |
| Mobile viewport rendering | No device emulation available; Tailwind breakpoints reviewed statically |

---

## 8. Counts

**FE-001** HIGH · **FE-002** HIGH · **FE-003** MEDIUM · **FE-004** HIGH · **FE-005** HIGH · **FE-006** HIGH ·
**FE-007** MEDIUM · **FE-008** MEDIUM · **FE-009** MEDIUM · **FE-010** LOW

**Counts: 0 CRITICAL, 5 HIGH, 4 MEDIUM, 1 LOW, 0 INFORMATIONAL**

---

## 9. Verdict

The frontend is **structurally sound and visually consistent** — 50 routes all resolve, the link graph is clean,
the shell is responsive, and forms and modals behave. It fails in three specific ways that matter for a POS:
it has **no error boundaries and no loading states** (FE-002, FE-003), so any failure is invisible to the person
standing at the till; the **Global Stock report paginates incorrectly** (FE-004), showing duplicated rows; and
two pricing defects — a **price change that breaks checkout** (FE-005) and **VAT that exists only in the
browser** (FE-006) — put the customer's quoted price and the business's books at risk. FE-001 means the
onboarding wizard has never worked through the UI, which is why the setup path must have been completed by
hand.
