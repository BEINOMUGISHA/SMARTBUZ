# SMART_BUZ — Technical Audit & SaaS Roadmap (Uganda Market)

**Audited:** 2026-11-11 · Next.js 16 · Convex · TypeScript · Tailwind v4
**Verdict:** Solid domain modelling and a strong feature surface, but **not yet safe to sell as multi-tenant SaaS**. The blocking issue is that authentication stops at the Next.js edge while the Convex backend is fully public.

---

## 1. Executive Summary

SMART_BUZ has genuinely good bones for a Ugandan POS: MLM-aware PV/BV promotions, shop-level stock issuance, credit books, A5/thermal receipts, offline sale drafts, and a full reports suite. The architecture choices (Convex for reactive queries, ledger table for stock movements) are right for this product.

The problems are concentrated in three areas:

| Area | State | Impact |
|---|---|---|
| **Multi-tenancy** | Not implemented at all | **Critical** — one customer sees another customer's data |
| **Backend authz** | Trust-the-client model | **Critical** — any user can act as any other user |
| **Money integrity** | Client-supplied totals | **High** — revenue can be silently falsified |

I fixed the contained blockers (build failure, Edge runtime crash, reset-code account takeover, client-side price tampering, brute force) and documented the structural work that needs a migration plan.

---

## 2. Critical Faults

### 2.1 The Convex backend is a public API — auth stops at the edge ❌ CRITICAL

The session cookie and license gate live in Next.js `middleware.ts`. But **Convex functions are called directly from the browser** (`src/components/convex-client-provider.tsx:7` uses `NEXT_PUBLIC_CONVEX_URL`), and there is **no `convex/auth.config.ts`** — so every query and mutation in the deployment is callable by anyone who knows the deployment URL.

Next.js middleware protects the *page*, not the *data*. Anyone can call the Convex HTTP API directly:

```bash
# Fetch every sale in the system, no credentials required
curl -X POST "$CONVEX_URL/api/query" \
  -d '{"path":"reports:summaryStats","args":{},"format":"json"}'
```

This exposes `sales.list`, `users.listAll`, `stocks.listAll`, `reports.*`, `loans.getLoans`, and all 40+ report queries. Every customer of a multi-tenant deployment shares one data plane.

**Fix:** Add `convex/auth.config.ts` and require a verified identity in every handler. This is the single highest-value change in the entire audit.

### 2.2 Authorization trusts a client-supplied `adminUserId` ❌ CRITICAL

`convex/auth.ts` looks correct, but the pattern is broken:

```ts
export async function requireAdmin(ctx, adminUserId: Id<"users">) {
  const user = await ctx.db.get(adminUserId);
  if (!user.roles.includes("admin")) throw new ConvexError("Forbidden");
  return user;
}
```

`adminUserId` arrives **as a mutation argument from the browser**. It proves nothing. Any caller can pass an admin's real `_id` and become an admin. The only thing standing between an attacker and `users.remove` (deleting any account) or `users.setRoles` (self-promoting to admin) is knowing an admin's ID — and `users.listAll` is a public query that hands those out.

The client does exactly this at `src/app/(dashboard)/systemconfig/page.tsx:490`:
```ts
await deleteUser({ id: deletingId, adminUserId: user!._id });
```

**Fix:** Derive the caller from the authenticated identity inside Convex. Never accept identity as an argument.

### 2.3 No multi-tenant isolation ❌ CRITICAL

`grep` for `organizationId|tenantId|businessId|workspaceId` across the codebase returns **zero matches**. Every table is global:

```ts
stocks: defineTable({ name, productCode, price, qty, ... })   // no owner
sales:  defineTable({ total, date, items, ... })              // no owner
shops:  defineTable({ name, serialNumber, issuedStocks, ... }) // no owner
```

`businessProfiles` looks like a tenant model but is decorative — `getActive` returns `profiles[0]`, and nothing else references it. Reports filter by `args.shopId`, which the *client* also supplies and may omit entirely:

```ts
const matchesShop = !args.shopId || sale?.shopId === args.shopId;
```

Omit `shopId` and you see every shop's revenue. A shop user and the HQ owner read the same rows.

**Fix:** Add `orgId` to every table, index it, and inject the org filter server-side from the authenticated session. Requires a data migration.

### 2.4 Password reset was a full account takeover ✅ FIXED

`requestPasswordReset` returned the reset code to the caller:

```ts
return { success: true, code }; // code returned so frontend can email it
```

The browser received the 6-digit code in the mutation response, and the server-side email step was pure decoration. Anyone could reset any account — including the admin — without ever touching the victim's inbox.

**Fixed:** the code is now generated server-side, returned only when the caller proves it is our Next.js server (`serverSecret` check), and email delivery happens entirely server-side. The browser never handles the code.

### 2.5 Sale totals trusted from the client ✅ FIXED

`sales.create` took `total` and per-item `price` straight from the browser and persisted them:

```ts
total: args.total,      // client-controlled
items: args.items,      // client-controlled prices
```

A modified client could record a UGX 500,000 sale as UGX 500. That silently falsifies revenue, profit margins, and the promotion PV/BV triggers that decide who wins prizes.

**Fixed:** the server now re-reads prices from `stocks`, recomputes the total, and rejects the sale on mismatch. Applied to both `create` and `editSale`.

---

## 3. High-Severity Faults

### 3.1 The license gate was a global switch, not a business model — REMOVED

**Status: removed on request.** The activation gate (`LICENSE_KEYS`, the `sb_license` cookie, the `/locked` page and `/api/validate-license`) has been deleted. The middleware now enforces the session only, and there is no activation screen — any visitor with a valid session reaches the application.

For the record, the original finding was that `LICENSE_KEYS` was a comma-separated env var checked in `middleware.ts:43`. The cookie stored the **plaintext key**, so anyone who obtained one key unlocked the entire deployment — and there was only one key set for everybody. There was no per-business key, no expiry, no seat count, no plan.

**If commercial gating is ever wanted,** it should be built as a real `subscriptions` table (`orgId`, `plan`, `status`, `expiresAt`, `seats`) checked per-request server-side — not restored from the removed global switch. See §5.7.

### 3.2 Build was broken — deploy blocker ✅ FIXED

```
Error: Missing API key. Pass it to the constructor `new Resend("re_123")`
Error: Failed to collect page data for /api/send-reset-email
```

`new Resend(process.env.RESEND_API_KEY)` at module scope threw during page data collection, so `npm run build` exited non-zero and **the app could not be deployed at all** without the env var present at build time.

**Fixed:** Resend is now instantiated lazily inside the handler, returning a clear 503 if unconfigured.

### 3.2b Missing `NEXT_PUBLIC_CONVEX_URL` broke the build again ✅ FIXED

Once the Resend crash was resolved, the next build failed with:

```
Error: No address provided to ConvexReactClient.
Error occurred prerendering page "/sales".
```

`src/components/convex-client-provider.tsx` did `new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!)` — the `!` asserts non-null but does nothing at runtime, so with no `.env.local` present the client constructor threw during prerender and killed the build.

**Fixed:** added `src/lib/convex-url.ts`, which resolves the URL with an explicit placeholder fallback and logs a clear actionable error. Server-side routes now return 503 when the URL is unconfigured instead of calling a dead endpoint. Added `.env.example` documenting every required variable (the `.env*` gitignore rule now has a `!.env.example` exception so the template is shareable).

### 3.3 Edge runtime incompatibility in session signing ✅ FIXED

`src/lib/session.ts` imported Node's `crypto` while `src/middleware.ts` (Edge runtime) imported it:

```
A Node.js module is loaded ('crypto' at line 11) which is not supported in the Edge Runtime.
```

The middleware — the thing protecting every route — would fail at runtime on Vercel's Edge deployment.

**Fixed:** migrated to Web Crypto (`crypto.subtle`), with `btoa`/`atob` base64url encoding, keeping constant-time comparison.

### 3.4 Negative stock is silently permitted ⚠️

In `sales.create` the insufficient-stock guard is commented out:

```ts
// [CHANGED] We allow negative stock now as per user request
// if (stock.qty < item.quantity) { throw new Error("Insufficient stock..."); }
```

Shops can sell stock they never received, and HQ can sell what it does not have. With the ledger recording negative deltas, inventory valuation quietly goes wrong. If this is a deliberate MLM/distributor behaviour it should be an explicit, named policy (`allowOversell: true`) surfaced in reports — not a commented-out check.

### 3.5 Stock ledger is incomplete ⚠️

`stockLedger` is written on sales (3 sites in `convex/sales.ts`) but **never** on restock, shop issue, shop return, transfer, or adjustment. The table is therefore not a complete audit trail — and `restock` (`convex/stocks.ts:566`) changes `qty` with no ledger row.

For a business where "where did this stock come from?" is a real question, the ledger must be written on every quantity mutation.

### 3.6 Shop issuance duplicates stock lines ⚠️

`shops.issueStock` appends instead of merging:

```ts
const updatedStock = [...shop.issuedStocks, ...args.items];
```

Issuing the same product twice creates two rows for one `stockId`. `getShopStock` then shows it twice, and `findIndex` in sale paths only updates the **first** match — so the second line never decrements. Inventory goes wrong quietly.

**Fix:** merge by `stockId` (sum quantities), matching the read path.

### 3.7 Mobile money is a simulation ⚠️

`src/app/api/momo/route.ts` logs and returns a **fabricated** transaction ID. No MTN/Airtel API is called. Worse, `mobile-money-modal.tsx:84` lets the cashier click "Confirm & Paid" with an **optional** manual reference — so a sale can be marked paid with no money received and no gateway evidence.

For a Ugandan market where MoMo is the dominant payment rail, this must be a real integration with server-side confirmation.

---

## 4. Medium-Severity Faults

| # | Fault | Location | Note |
|---|---|---|---|
| 4.1 | `register` accepts client `roles` | `convex/users.ts:166` | Client sends `roles: ["sales"]`, but the mutation accepts any array — self-signup as admin |
| 4.2 | Role gating is client-side only | `src/app/(dashboard)/layout.tsx:122` | `user.roles.includes(...)` in the UI; server never enforces |
| 4.3 | `debug.inspectUser` is a public query | `convex/debug.ts` | Leaks user IDs, names, emails, shop mapping |
| 4.4 | Session has no server-side revocation | `src/lib/session.ts` | Stateless signed cookie; logout-all is impossible |
| 4.5 | Password policy is 6 chars minimum | `convex/users.ts:173` | Weak for admin/finance access |
| 4.6 | No login throttling | `src/app/api/auth/route.ts` | **Fixed** — added 8 attempts / 15 min |
| 4.7 | Reset code brute-forceable | `convex/users.ts` | **Fixed** — 5 attempts, then code voided |
| 4.8 | Service worker is stale-cache-first | `public/sw.js` | Caches `/` and serves it — users can run an old POS build |
| 4.9 | `getShopStock` scopes by `email` argument | `convex/stocks.ts:275` | Any caller can pass any user's email |
| 4.10 | `shopIssueRecords` written but never read for stock | `convex/shops.ts:408` | Records exist; quantity source of truth is `issuedStocks` |
| 4.11 | Seeded default passwords | `convex/seed.ts:26` | `admin@pos.com` / `password123` |

---

## 5. What's Missing for the Ugandan Market

### 5.1 URA tax compliance — a legal requirement, not a nice-to-have

There is **no VAT handling anywhere** (`grep -rn "VAT\|tax" convex/sales.ts` → empty). Uganda's VAT regime requires:

- **18% standard rate**, with exempt/zero-rated categories (basic goods, agricultural inputs)
- **TIN on every fiscal invoice**
- **VAT-inclusive pricing** (the norm for retail — the price shown is the price paid)
- **Separate VAT amounts** in revenue reporting and on receipts
- **URA e-invoicing / fiscalisation** for VAT-registered businesses

`businessProfiles` has a `taxEnabled` flag that **nothing reads**. Receipts (`src/components/ReceiptTemplate.tsx`) show no TIN, no VAT line, no tax breakdown. A VAT-registered Ugandan retailer cannot use this as-is — this is the single biggest commercial blocker.

### 5.2 Mobile money (real, not simulated)

MTN MoMo and Airtel Money are the primary payment rails in Uganda. Needed:

- Real **request-to-pay / USSD push** via the official MTN and Airtel Open APIs
- **Webhook-driven confirmation** — the sale is marked paid when the gateway confirms, not when the cashier clicks
- **USSD fallback** for feature phones, and **STK push** for smartphones
- Reconciliation against gateway settlement reports
- Partial payments and change handling
- Payment receipts sent to the customer by **SMS**

### 5.3 Multi-currency / regional readiness

- Currency should be **per-organisation**, not the hardcoded `UGX` in `businessProfiles`
- Support UGX, USD, RWF, KES, TZS with fixed or floating FX rates
- Ugandan businesses frequently quote in USD while settling in UGX — dual-currency display on products and receipts
- Ugandan phone formatting must handle `+256`, `0` prefixes, and 9/10-digit local numbers (already partly handled in `src/lib/mobile-money.ts`)

### 5.4 Offline-first (Uganda's power and network reality)

The offline draft queue exists (`src/lib/offline-sales-manager.ts`) but the service worker is stale-cache-first, which is the wrong model for a POS. Correct approach:

- **Cache-first for the app shell** (offline UI), **network-first for data**
- Queued sales must sync with **conflict resolution** on stock
- **Cash drawer / offline session** reconciliation — cash counted vs. system
- **Supervisor override PIN** for offline discounts and voids
- End-of-day Z-report generation while offline

### 5.5 Financial controls a finance team will demand

- **Shift / till management** — open and close a till per staff shift, with variance tracking
- **Cash count reconciliation** (expected vs. counted)
- **Void/cancellation approval workflow** with reasons, requiring supervisor sign-off
- **Discount and price-override permissions**
- **Day-end close** producing an immutable Z-report
- **Loyalty and customer credit** — a "credit book" is standard practice for Ugandan wholesalers; the current loan module is a starting point but needs per-customer credit limits
- **Purchase orders and supplier management** — the schema tracks `supplier` as a free-text string on stocks and entries; it needs a real `suppliers` table with purchase orders, goods received notes, and supplier payment terms

### 5.6 UGX-specific correctness

- **Money as integers.** UGX has no practical subunit. All amounts should be stored as whole shillings (`number` is fine) — but never computed with float arithmetic across `pv`, `bv`, `price`, and `quantity` without rounding. The current `sum(price * qty)` chains are float-based.
- **Number formatting** must use the Ugandan convention (`1,250,000` — no decimals, no currency symbol in the middle).
- **Date/time**: sales timestamps are ISO strings compared lexicographically (`q.gte("date", start)`). This breaks across timezones and around month boundaries. Store epoch millis, or normalize to a single timezone (EAT, UTC+3) consistently.

### 5.7 SaaS platform essentials

- **Subscription & billing** (the global `LICENSE_KEYS` gate was removed — see §3.1): plans, trials, per-seat pricing, auto-expiry, upgrade flow
- **Mobile money subscription payments** — customers in Kampala pay for SMART_BUZ with MoMo, not a card
- **Onboarding wizard** — create business → configure tax → set up shops → invite staff
- **Invite/email verification** instead of open self-registration with client-chosen roles
- **Audit log with IP + device** — currently `activityLogs` records user and timestamp only
- **Data export/deletion** for GDPR-style compliance and customer offboarding
- **Usage analytics** per tenant (transactions, seats, products) to drive renewal
- **In-app help** — a WhatsApp/YouTube link and a short onboarding tour beat a docs site for this market

---

## 6. Prioritised Roadmap

### Phase 1 — Make it safe (blocking for any real customer)
1. Add `convex/auth.config.ts`; derive identity server-side in every handler
2. Replace all `adminUserId`/`userId` argument-trust with `ctx.auth.getUserIdentity()`
3. Add `orgId` to every table + server-side org filtering (with data migration)
4. ~~Replace `LICENSE_KEYS` with a `subscriptions` table and per-org checks~~ — the global license gate was removed on request; build real per-org subscriptions only if commercial gating is actually needed (§5.7)
5. Delete `convex/debug.ts` or gate it behind an admin identity check

### Phase 2 — Make it sellable in Uganda
6. VAT engine: 18% default, per-category exemptions, TIN, VAT-inclusive pricing, tax on receipts
7. Real MTN MoMo + Airtel Money with webhook confirmation
8. Shift/till management, Z-reports, void approvals
9. UGX integer money handling + EAT timezone normalization
10. Real `suppliers` table with purchase orders

### Phase 3 — Make it a product
11. Offline-first service worker + conflict resolution + offline reconciliation
12. Subscription billing via mobile money, self-serve upgrade
13. Staff invitations, onboarding wizard, in-app help
14. URA fiscalisation / e-invoicing integration
15. Customer credit limits, loyalty, SMS receipts

---

## 7. Fixes Applied in This Pass

| Fix | File | Impact |
|---|---|---|
| Lazy Resend init | `src/app/api/send-reset-email/route.ts` | Build no longer fails; deploy unblocked |
| Convex URL fallback + clear config error | `src/lib/convex-url.ts` (new), `convex-client-provider.tsx`, API routes | Build survives a missing `NEXT_PUBLIC_CONVEX_URL`; 503 instead of a dead endpoint |
| `.env.example` + gitignore exception | `.env.example` (new), `.gitignore` | Every required variable documented and shareable |
| Web Crypto session signing | `src/lib/session.ts`, `src/middleware.ts`, `src/app/api/auth/route.ts` | Edge runtime compatible; middleware no longer breaks on Vercel |
| Server-side price + total recomputation | `convex/sales.ts` (`create`, `editSale`) | Client can no longer falsify revenue, margin, or promotion triggers |
| Reset code never exposed to browser | `convex/users.ts`, `src/app/api/send-reset-email/route.ts`, `src/app/auth/forgot-password/page.tsx` | Closed a full account-takeover path |
| CSPRNG reset codes + 5-attempt brute-force cap | `convex/users.ts` | Reset codes no longer predictable or guessable at scale |
| Login rate limiting | `src/app/api/auth/route.ts` | Blocks credential stuffing |
| `attempts` field on `passwordResets` | `convex/schema.ts` | Supports brute-force guard |
| Server-authoritative URA VAT | `convex/verticals/tax.ts` (new), `convex/businessProfiles.ts` | A tampered client can no longer set 0% VAT on a restaurant and under-state VAT on fiscal receipts |
| Single-active-business invariant | `convex/businessProfiles.ts`, `convex/verticals/batches.ts` | "Which business am I in?" is now deterministic; previously `profiles[0]` of an unordered filter decided it |
| Tenant scoping on all vertical tables | `convex/schema.ts` (29 new tables) | Every vertical record carries `businessProfileId` + a `by_businessProfileId` index |
| Missing stock-ledger entries on goods receipt | `convex/verticals/operations.ts` (`receiveGoods`) | Goods receipt now writes the `stockLedger` row that §3.5 flagged as missing |
| Service worker no longer installed in development | `src/components/service-worker-registration.tsx` | A cached dev bundle could be replayed against freshly rendered HTML, producing hydration mismatches and defeating hot reload |
| Service worker never caches API responses | `public/sw.js` | `/api/auth` (the "who am I" endpoint) and other API GETs were being written into Cache Storage and replayed |

**Verification:** `npx tsc --noEmit` exits 0; `npm run build` exits 0 with no Edge-runtime or Resend errors (verified by re-running the build and grepping for both failure signatures).

### Deployment prerequisites

Password reset now requires `RESEND_API_KEY` in **two** places: the Next.js environment **and** the Convex dashboard environment. The Convex mutation fails closed if the Convex-side secret is missing — no code is ever returned to an anonymous caller. Without the Convex-side variable, password reset silently cannot deliver codes.

> **Note:** These are contained, low-risk fixes. They do **not** address Phase 1 items 1–3 (real backend auth and multi-tenancy), which require a schema migration and a careful, staged rollout.

---

## 8. Multi-Vertical Adaptation for the Ugandan Market

This section documents the second workstream: turning SMART_BUZ from a single POS into a **data-driven platform that serves every significant Ugandan business category**, each with its own professional interface and its own feature set.

### 8.1 The core idea — a catalogue, not 42 separate apps

Adding a vertical is now an **append to a catalogue**, not a new codebase. `src/lib/business-categories.ts` (≈65 KB) defines **42 verticals across 7 sectors**:

| Sector | Verticals |
|---|---|
| Trade | retail, supermarket, wholesale, agro, farming, dairy, butchery, baker, bookshop, printing, stationery, shoes, beauty |
| Food | restaurant, cafe, hotel |
| Health | pharmacy, clinic, veterinary |
| Services | barber, salon, fitness, laundry, tailor, carpentry, welding, construction, hardware, cleaning, photography, event, mobile, electronics, salvage, fuel, transport |
| Finance | sacco, realestate, security |
| Community | education, church, ngo |

Each catalogue entry declares its **modules** (which feature pages appear), **features** (capability flags), **tax** (URA VAT configuration), **units** (how this trade measures things — crates, kg, service sessions, litres) and **terminology** (what it calls its customers, staff and products).

Everything else is derived from that single source:

| Consumer | File |
|---|---|
| Sidebar navigation & role filtering | `src/lib/category-nav.ts` |
| Active-vertical hook (nav, accent, feature flags, setup state) | `src/hooks/use-active-category.ts` |
| Dashboard widgets per vertical | `src/components/category-widgets.tsx` |
| VAT engine | `src/lib/vat.ts` |
| Onboarding wizard | `src/app/setup/page.tsx` |
| Vertical switcher & business profile | `src/components/business-vertical-settings.tsx` |

### 8.2 Backend modules (78 new Convex functions)

Four new modules under `convex/verticals/`, all tenant-scoped via `businessProfileId` and a shared `getActiveBusinessId(ctx)` resolver:

- **`batches.ts`** — batch/expiry tracking with **FEFO** consumption, expiry summaries, serial & IMEI registration (pharmacy, agro, electronics)
- **`scheduling.ts`** — appointments with a double-booking guard, service outlets (tables/rooms/chairs), table orders, menu management, schedule summaries
- **`members.ts`** — members with auto-generated `M-#####` numbers, a transaction ledger with over-draw protection, customer wallets, staff commissions, donations (SACCO, church, NGO, gym)
- **`operations.ts`** — suppliers, purchase orders, goods receipt (raises stock **and** writes the missing `stockLedger` row), deliveries, assets, fuel dispensing, vehicles, route fares, till sessions with cash variance, service tickets, rentals, attendance, enrolments, production batches, recurring charges

29 new tables were added to `convex/schema.ts`, every one carrying `businessProfileId` with a `by_businessProfileId` index.

### 8.3 Interface pages (17 new pages)

`batches`, `appointments`, `members`, `tables`, `menu`, `service-tickets`, `suppliers`, `purchase-orders`, `fuel`, `assets`, `classes`, `attendance`, `deliveries`, `till`, `rentals`, `production`, `rooms`, `prescriptions` — all built on a shared vertical UI kit (`src/components/vertical/ui-kit.tsx`) so every trade gets the same consistent, professional surface with its own terminology.

All **29** navigation routes in the registry resolve to a real page, and all **33** modules referenced by the catalogue have a registry entry — verified programmatically, not by eye.

### 8.4 URA VAT — server-authoritative

The frontend catalogue carries the tax settings so receipts render VAT-aware immediately, but **the server owns the rate that is actually stored**. `convex/verticals/tax.ts` keeps the policy server-side and `businessProfiles.setCategory` / `create` / `update` derive the tax configuration from the category, ignoring what the client asked for.

This was a real hole found during verification: before the fix, a tampered client could post `taxRate: 0` for a restaurant and the receipts would under-state VAT. The fix is proven by a live test — see §8.5.

| Vertical group | Rate | Receipt wording |
|---|---|---|
| Most trade, food, services, retail | **18%** | "VAT inclusive @ 18% — Price shown includes VAT" |
| agro, farming, dairy | **0%** | "VAT zero-rated (exempt goods) @ 0%" |
| clinic, veterinary, sacco, education, church, ngo | **0%** | "VAT exempt — &lt;reason&gt; (URA)" |
| bookshop | **0%** | "Zero-rated educational materials @ 0%" |

Unknown categories fall back to the client value, **clamped so a rate above the URA standard rate can never be declared**.

### 8.5 Verification

A live end-to-end suite (`scripts/vertical-e2e.mjs`) runs against the deployed backend. **25 / 25 passing** on the dev deployment, covering: business-profile creation, vertical resolution, member numbering, over-draw protection, menu creation and business scoping, availability toggling, the table floor (open → add → close with the running total), the double-booking guard, suppliers, purchase orders, **goods receipt raising stock 10 → 30 and writing the stock-ledger row**, till session open/duplicate-rejection/variance, service tickets, donations, batch expiry summaries, schedule summaries, and **VAT tampering rejection in both directions**.

A contract checker (`scripts/check-vertical-contracts.mjs`) parses every Convex argument validator and diffs it against every frontend mutation call site: **37 call sites checked, 0 mismatches**. This is what caught the field-name drift in the vertical pages.

### 8.6 Deployment state

| Deployment | Name | State |
|---|---|---|
| Dev | `affable-panda-681` | Current — all 42 verticals, 78 vertical functions, security fixes, **empty of test data** |
| Prod | `shocking-mule-553` | **0 functions deployed — never touched** |

The production deployment still has nothing deployed to it. Deploying to prod is an externally visible action and needs explicit sign-off.

> **Still outstanding (Phase 1, needs a data migration):** the legacy tables (`sales`, `stocks`, `customers`, `expenses`, `loans`, `shops`) are still not tenant-scoped, and the Convex backend still trusts client-supplied identity arguments. The **new vertical layer is tenant-ready**; the legacy layer is not. Until the legacy tables are migrated and `ctx.auth.getUserIdentity()` replaces the trust-the-client pattern, this is not yet safe to sell as multi-tenant SaaS — the same conclusion §1 reached, narrowed in scope but not eliminated.

