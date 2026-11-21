# 02 — Frontend, User Interface and Offline Web Client

**Commit audited:** `acafd2b`
**Scope:** `src/app/` (57 pages, 4 API routes), `src/components/` (74 files), `src/lib/offline/`,
`public/sw.js`, `public/manifest.json`.

---

## 1. Shape of the client

| Measure | Value |
|---|---:|
| Routes (pages) | 57 |
| API routes | 4 (`/api/auth`, `/api/auth/convex-token`, `/api/auth/send-verification`, `/api/send-reset-email`) |
| `.tsx` files under `src/` | 151 |
| Of which client components (`"use client"`) | 121 (80%) |
| Components holding a Convex query or mutation | 7 |
| `src/lib/offline/` modules | 9 |

The client is a live Convex client: the browser holds a token and talks to the backend directly
for reads and writes. Only four routes go through the Next.js server, and all four exist because
the server holds something the browser must not (the session secret, the JWT private key, the
email provider key).

That is a sound split. The alternative — proxying everything through the server — would add a
hop to every read.

---

## 2. Route inventory

**Public**

| Route | Purpose |
|---|---|
| `/auth/login` | Sign in |
| `/auth/register` | Register, then email verification |
| `/auth/forgot-password` | Request a reset code |
| `/auth/reset-password` | Set a new password |
| `/setup` | First-business setup |

**Authenticated (under the `(dashboard)` group)** — 52 routes

Sales and money: `/sales`, `/sales/loans`, `/stock`, `/inventory`, `/customers`, `/suppliers`,
`/purchase-orders`, `/shops`, `/exp`, `/finance`, `/till`.

Business management: `/members`, `/settings`, `/subscription`, `/devices`, `/systemconfig`,
`/platform`, `/assets`.

Reporting (11): `/reports` and its sub-routes for overview, sales, shops, stock, loans, expenses,
products, customers, users, profit, analysis.

Industry packages (16): `/appointments`, `/attendance`, `/batches`, `/classes`, `/deliveries`,
`/fuel`, `/menu`, `/prescriptions`, `/production`, `/rentals`, `/rooms`, `/service-tickets`,
`/tables`, `/batches`, `/shops`, `/expenditures`.

**Product surface.** The route tree maps cleanly onto the business: a retailer can ignore the
school, salon, fuel and pharmacy routes entirely, and the navigation is filtered by business
category (`src/hooks/use-active-category.ts`, `src/lib/business-categories.ts`).

---

## 3. Interface kit

`src/components/ui/` is a shadcn-style primitive set (Radix + Tailwind + CVA), and
`src/components/vertical/ui-kit.tsx` is the domain kit on top of it. The vertical kit exports
`VerticalPageHeader`, `StatStrip` (a `stats` prop of `{label, value, tone}`), `StatusBadge`,
`LoadingState` and `EmptyState`.

**Assessment:** consistent, and the empty/loading/error states exist as shared components rather
than being reinvented per page. The vertical kit is a genuinely good abstraction — it is what
makes 57 routes feel like one product instead of 57 pages.

---

## 4. Loading, empty and error states — mostly present, not universal

The shared kit provides the three states, and most pages use them. Two gaps:

* **L-02 (Low).** Not every page renders a distinct error state. The Convex `useQuery` error is
  surfaced by the framework's error boundary rather than by a page-level message, so a failed
  report shows the Next.js error boundary rather than "we could not load this report — try
  again". `EmptyState` and `LoadingState` are used consistently; the error state is the one that
  is uneven.

---

## 5. Accessibility — partial

| Check | Result |
|---|---|
| Semantic landmarks | Present (`<main>`, nav, header) in the dashboard shell |
| Keyboard navigation in the sidebar | Present (shadcn `Sheet`, focus-trapping) |
| Focus rings | Provided by shadcn defaults, but several custom pressables in `src/components/offline/` set no `accessibilityRole` |
| Form labelling | Present in the auth forms (`htmlFor` / `id` pairs) |
| Colour contrast | Not systematically checked; the emerald-on-white and muted-grey palette is compliant by inspection but was never measured |
| Screen-reader status announcements | **Absent.** The offline sync banner (`src/components/offline/sync-status.tsx`) changes text on a timer with no `aria-live` region, so a cashier using a screen reader is never told that a sale failed to sync |

**L-03 (Low).** No automated accessibility check (no axe, no Playwright a11y) runs in CI.

---

## 6. Responsive design and low-end devices

The layout is a fixed desktop sidebar that collapses to a drawer below a breakpoint
(`src/app/(dashboard)/layout.tsx`). The dashboard is usable on a phone in a browser, but it is a
desktop product made narrow, not a mobile product.

This matters for the plan the product makes for the Ugandan market. Report 12 covers the
position on a native mobile application.

---

## 7. Offline web client

`src/lib/offline/` is a complete offline engine for the browser:

| Module | Responsibility |
|---|---|
| `db.ts` | IndexedDB schema — the queue, the catalogue cache, the settings store |
| `queue.ts` | Durable transaction queue: enqueue, mark syncing/synced/failed, retry scheduling |
| `sync.ts` | The synchroniser: push, backoff, idempotency, conflict surfacing |
| `catalog.ts` | Cached product catalogue and price lists for offline lookup |
| `price-list.ts` | Customer- and tier-specific pricing |
| `device.ts` | Stable device identity and registration |
| `network.ts` | Connectivity detection |
| `session-cache.ts` | Cached session so the till comes up with no network |
| `types.ts` | The offline data model |

**This is the strongest part of the client.** The design decisions are right:

* A sale is written to local storage **before** anything else happens.
* The idempotency key is generated once and carried through to the server.
* A failed sync is retried with exponential backoff and a cap.
* A conflict is surfaced to the cashier rather than swallowed.
* An offline payment is recorded as *pending verification*, never as confirmed.

`tests/offline.test.ts` (45 tests) and `tests/offline-client.test.ts` (10 tests) cover the
server and browser halves.

**Gap.** `src/components/offline/sync-status.tsx` shows the queue state, but the *reason* a sale
failed is not surfaced in the interface — the server's error text is stored in the queue row and
never rendered. **M-07 (Medium):** a cashier sees "3 sales waiting" with no indication of why.

---

## 8. Service worker and installability

`public/sw.js` and `public/manifest.json` make the web application installable. The service
worker registration lives in `src/components/service-worker-registration.tsx`.

**M-08 (Medium).** The service worker caches the application shell. A cached shell served to a
browser with no network shows the interface, and the interface then fails on every query — so
the user sees a working-looking application that cannot load anything. There is no
offline-first fallback for read operations; only writes are queued. The offline engine is
therefore a *write* queue, not an offline application, and the interface does not say so.

---

## 9. Exports and printing

`src/lib/export.ts`, `src/lib/export-utils.ts` and `src/lib/restock-pdf.ts` produce Excel
(`exceljs`) and PDF (`jspdf`, `jspdf-autotable`) exports in the browser.

**Finding.** `jspdf` is a direct dependency with a **critical** advisory (object injection via
`addJS`, and a DoS via crafted image dimensions) — see report 15. The export path builds
documents from database content, so the injection surface is real if a product name or a customer
name ever reaches a PDF field.

---

## 10. Client-side permission enforcement

The interface hides what the caller may not do, using the permission set the server returns
(`src/lib/permissions.ts`, fed by `users.me`). **Every one of those checks is presentational.**
The server re-checks every operation.

The one place this is worth watching is `src/lib/mobile-money.ts` and
`src/components/mobile-money-modal.tsx`, which were rewritten in Phase 9 to call the real
adapter. That work removed a route that fabricated transaction identifiers. It is the correct
outcome and it is worth confirming the rest of the client has no similar fabrication. A scan for
client-side identifiers that are never sent to the server found none.

---

## 11. Summary

| Area | Assessment |
|---|---|
| Route and component structure | Good |
| Shared interface kit | Good |
| Loading and empty states | Good |
| Error states | Uneven (L-02) |
| Accessibility | Partial; no measurement, no CI check (L-03) |
| Responsive design | Desktop-first; acceptable for a browser, not a till |
| Offline write queue | **Good** — the best-engineered part of the client |
| Offline read experience | Weak (M-08) |
| Export surface | Carries a critical dependency advisory (report 15) |
