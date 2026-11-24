# SMARTBUZ v2.0 — 17 · Consolidated Bug Register

**Audit date:** 20 November 2026
**Audited commit:** `953f958`
**Sources:** all reports in `docs/QA/` (01, 03–16)

This register **consolidates** the 136 individual findings recorded across the thirteen domain reports into
**canonical entries** — one entry per root cause, with the source finding IDs cross-referenced. Several
defects were independently found by more than one domain (the VAT gap, for example, was reported by the
frontend, the POS and the finance audits); the canonical entry lists every source so nothing is lost.

---

## 0. Status — 24 November 2026

This register is the work order. The entries below record where each
canonical entry stands after the remediation work.

**Read this section first.** The tables in §2–§6 are the audit's findings as
they were written on 20 November 2026 — they describe the defect, not its
present state, and their status lines are as of that date. This section is
the present state. Where the two disagree, this section is right.

| | Entries |
|---|---|
| Fixed and deployed | 72 |
| Partly fixed — what is left is written down below | 5 |
| Closed by a decision, or verified as correct | 5 |
| **Total canonical entries** | **82** (BUG-000 … BUG-081) |

### Fixed and deployed

The following were fixed in the remediation waves, and the backend was
published to the deployment the application uses (`affable-panda-681`):

| Entry | What changed |
|---|---|
| BUG-000 | The profit-and-loss reports are scoped to the caller's business. They read sales by date with no business filter at all, and returned every tenant's revenue and profit. |
| BUG-001 | `convex/migration.ts` was callable by any business owner with an arbitrary `businessId`, and wrote memberships, ownership and tenant rows across the whole deployment. It now requires the server-to-backend secret in addition to the operator role, and it asks which business to migrate rather than guessing. `scripts/migrate-to-multitenancy.mjs` and `scripts/verify-migration.mjs` send the secret. |
| BUG-002 | `convex/seed.ts` is gated on the server secret, so the seeded demo identities cannot be created or re-created by a tenant. |
| BUG-003 | Sign-in is throttled against the server, per address and per IP, and the throttle takes the same time whether the address is known or not. |
| BUG-004 | Choosing a paid plan records the *intention*; the plan becomes real only when a payment for it is verified. Moving to a free plan still takes effect at once. |
| BUG-005 | A business with no subscription row was given every entitlement and could write for ever. Registration starts a real, tracked free trial, the entitlement gate fails closed, and the tenants that already existed were backfilled. |
| BUG-006 | A price that moved between the basket being filled and the sale being rung up is detected. The live sale is held until the seller has put the new price to the customer; the difference is written on the sale. An offline sale is recorded at the catalogue's price, with the difference recorded. |
| BUG-007 | VAT is computed server-side and stored on the sale as net, tax and rate; the reports read the stored values. |
| BUG-008 | A price override is clamped to a floor, and going above it needs a dedicated permission. |
| BUG-009 | The online path sends `clientOfflineId` too, and the sale is deduplicated on it exactly as the offline path does. |
| BUG-010 | Every movement of goods now writes a ledger row — the opening balance, a restock, an issue to a counter, a transfer, an adjustment and a refund. The ledger is read for the first time: `stocks.getReconciliation` compares the balances against the history, and `stocks.recordOpeningBalances` gives the products that predate the ledger the opening balance they need to be reconciled. |
| BUG-011 | The reports summary and the P&L now come from the same `financeCore` helpers, so refunds net off and cost is the price the goods were bought at. |
| BUG-012 | A conflict resolved as "rejected" now reverses the sale — the goods go back, the money comes off, the ledger is written — through the same compensation path a refund uses. |
| BUG-013 | `recordProviderError` and `recordMessage` are internal mutations, and `reportHardware` resolves the tenant from the session rather than from the browser. |
| BUG-015 | The password-reset and verification email endpoints are throttled by a server-backed limiter with a per-address cooldown and a per-IP cap. |
| BUG-016 | A live sale may not sell stock that is not there. An offline sale still may, and the shortfall is recorded as a conflict. |
| BUG-017 | A refund credits the counter the goods were sold from, not the master warehouse. |
| BUG-018 | Correcting a credit sale keeps the money the customer has paid. The loan is corrected, not destroyed. |
| BUG-019 | A repayment must be positive, must be within the balance, is dated by the server, and must say how it was paid. |
| BUG-020 | A customer's credit limit is enforced at the point of sale. |
| BUG-021 | A product with history is archived rather than destroyed. |
| BUG-022 | The `/setup` wizard no longer crashes: the `planKey` declaration comes before the `chosenPlan` derivation that read it, and because the read hid inside a callback neither TypeScript nor ESLint had seen it. |
| BUG-023 | The application has a root error boundary, a route boundary, a dashboard boundary, a not-found page and loading states for the main segments. |
| BUG-024 | The stock report stops on the server's `isDone` instead of re-fetching the page it already has, and the cursor is an offset. |
| BUG-025 | A callback for an adapter with no webhook secret is refused, and the signature is checked against the secret that is on file. |
| BUG-026 | A product carries a barcode, the product form records it, and a scan at the till puts the product in the basket. The barcode is stored in one form — upper case, no spaces — so a scanner reporting `abc-123` finds `ABC-123`, and it belongs to one product in the business and no other. The scan is looked up on the counter the cashier runs, so the goods it can sell are the goods it finds. |
| BUG-030 | A plan change moves the price, the billing cycle and the period together. A business that moved to a cheaper plan used to keep the expensive one until the old period ran out. |
| BUG-031 | The `core.*` entitlements were published on the pricing page and never checked. They are enforced at the permission gate, on writes. |
| BUG-032 | The device limit is checked beyond registration, and a business moved to a smaller plan loses the devices beyond its allowance. |
| BUG-033 | The sidebar is hoisted out of the layout component, so it is no longer a new component type on every render and it keeps its state. |
| BUG-034 | The payment-method effect reads the current value rather than a stale one. |
| BUG-035 | A backend refusal reaches the operator as a refusal on the screen; the main mutation screens say what was wrong. |
| BUG-036 | `migrationStatus` returns deployment-wide figures only to the server that holds the secret. |
| BUG-037 | An expense must be a positive amount. A negative one *adds* to profit, turning an expense into a gain. |
| BUG-038 | A report's period is the local day in the business's own time zone, not the UTC day. |
| BUG-039 | A date range includes its first day and its last. |
| BUG-040 | A refunded credit sale no longer keeps its full balance in the debt book. |
| BUG-041 | A debtor's account is aged from the last payment on it, not from the oldest invoice. |
| BUG-042 | Every payment carries the method it was made by. |
| BUG-043 | The warehouse's holding and the counters' holdings are counted separately, and the total is the two together. |
| BUG-044 | Each product is compared against its own reorder point, and the business's default is stored rather than typed into the browser. |
| BUG-045 | The cost price is withheld from the till and from everyone without a cost-visible role. |
| BUG-046 | Issuing stock to a counter takes it out of the warehouse and writes both halves of the movement to the ledger. |
| BUG-047 | The goods are valued on one basis. The counter no longer keeps a copy of the product, so the stock report and the inventory summary value the same goods at the catalogue's price, and the cost is reported beside the value rather than confused with it. |
| BUG-048 | `getSyncStatus` reads the fifty newest synchronisation rows rather than every row the till has ever written. |
| BUG-049 | Every adapter starts in the sandbox, and one that is switched on and still in the sandbox carries a visible warning that it will not move real money. Every payment in the history says whether it was a sandbox one. |
| BUG-050 | A collection whose callback never arrived is now settled by the repair: it asks the provider what happened, and the provider's answer is what stands. The till asks for the repair every time it talks to the server, so the payment is settled by the next moment of contact. A provider that cannot be reached is counted, and after three attempts the payment is flagged for a person (`payments.listPaymentsNeedingReview`) rather than being forgotten. |
| BUG-051 | A business's data can be taken out as a JSON file and put back again — see "Backup and restore" below. The accounts, the sessions and the licence are deliberately not in it: a restored database that could grant itself a licence would be a hole rather than a backup. |
| BUG-052 | The configuration is validated before a release by `scripts/validate-config.mjs`, which prints variable *names* and never a value, and which runs in CI against the production shape of the configuration. |
| BUG-053 | The lint gate exists: the 1,468 findings are recorded as a baseline and the gate fails on *new* problems only. The backlog stays visible and the codebase cannot get worse while it is worked off. |
| BUG-054 | The dependency tree is audited in CI and the job fails on a real high or critical advisory — and does not fail when the advisory service cannot be reached, because a registry outage must not be mistaken for a vulnerable build, or for a clean one. |
| BUG-055 | `docs/RUNBOOK.md` says how to release the web app and the backend, which goes first and why, how to roll either back, how to rotate each key, and what to check when the app returns 503. |
| BUG-057 | The sign-in route no longer downloads the Convex client. The providers lived in the root layout, so every public route carried the client — 24 KB gzipped of it — to let a stranger type a password; they now live on the authenticated routes only, and the public routes reach the backend through the server instead. Registering, proving an address and resetting a password are server routes now, which also means the verification code never travels through the browser at all. The sign-in screen went from 239.7 KB gzipped in 17 chunks to 212.5 KB in 16, measured on the live deployment the same way both times, and the Convex client is no longer among them. `scripts/check-public-bundle.mjs` is the gate that keeps it that way. |
| BUG-059 | CI typechecks the Convex functions against the schema and verifies that the checked-in generated code is complete and derived from the current schema, not a frozen snapshot of an older one. |
| BUG-060 | The counter's row is a quantity and nothing else. The name, the price and the cost are read from the catalogue, so a price change reaches every counter at once and nothing can be valued on a stale copy. |
| BUG-061 | The promotion engine evaluates the server's own cost figures, not the browser's. |
| BUG-062 | Sales-history search filters before the page is cut, so a search cannot miss matches on later pages. |
| BUG-063 | The password hash cost factor is 12. |
| BUG-064 | The plain codes are gone from the database — `migration.stripPlainResetCodes` took them out — and the field that held them has been removed from the schema. A code from the plain era is refused and the person who holds it asks for a new one. |
| BUG-065 | Every one of the 119 plain `Error` throws in the backend is now a `ConvexError`. Convex appends the handler's file and line to an uncaught plain `Error`, so the caller was told how the server is laid out; a `ConvexError` carries the message and its data and nothing else. What the caller sees is unchanged — what it no longer carries is the source path. |
| BUG-066 | The till keeps a bounded record of what it has done: the sent sales are let go oldest-first once there are more than two hundred, and the sales that are still waiting are never discarded. |
| BUG-067 | The cache is named after a hash of the service worker's own source, so it changes exactly when the worker changes and nobody has to remember to bump a number. |
| BUG-068 | `mySales` shows the business's sales to someone who may read the financial reports, and a caller's own sales to everyone else, instead of silently showing nothing. |
| BUG-069 | The product's name and code on a receipt come from the server's catalogue, not from the browser. |
| BUG-070 | The sales report and the export now show the lines that were re-priced, with the price the customer was quoted and the price they were charged. |
| BUG-071 | A sale's total is a figure in the currency, and the lines add up to it. |
| BUG-072 | The money is no longer written out as "UGX" on any screen, report, receipt or export. The currency comes from the business record through `useCurrency()`, and a business picks its currency when it is set up. A sale records the currency it was rung up in, so a receipt printed years later says what the money was then and not what the business trades in today. |
| BUG-074 | The `userTypes` table has an index. |
| BUG-075 | The screen says where you are, and the focus goes with it. A new `RouteAnnouncer` names the page that has just arrived and moves the focus to its heading, so a person who cannot see the screen is told about the new page rather than left on the old one. The dashboard has a skip link, because the navigation is long and a person who cannot see it has no other way past it; the navigation is a labelled landmark and the page body is a main landmark. The four public sign-in screens are main landmarks with real headings. The loading skeletons already carried `aria-busy` and the error boundary already carried `role="alert"`, and both were left alone. |
| BUG-079 | A report given one end of a period now reads that period. A report asked for "everything since 1 March" was answering with everything: the date was read, and then no date filter was applied to the rows that came back. The reports ask the index for the period instead, so a period with one end is a period like any other — and the rows outside it are never fetched. The debt book's reports are bounded the same way, and the ageing report reads only the payments taken since the oldest loan still owing, which is all it needs to find the last payment on each one. |
| BUG-080 | The CI workflow was rejected by GitHub on every push since the day it was written: the Build step had a name and an environment and no `run:`. A workflow GitHub cannot parse is refused *before any job starts*, so the run was marked failed with zero jobs and no reason — and every gate in that file had never once been executed. The step runs the build now, and `scripts/check-workflows.mjs` checks the workflow files so the next invalid workflow is a failed job rather than a silent one. |
| BUG-081 | The application's own configuration was lost, and the application was down for a day without anybody being told. On 23 November 2026 the Vercel Production environment was found to hold one variable — `SMARTBUZ_JWT_PRIVATE_KEY` — and the four that make the application start were gone: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `SESSION_SECRET` and `SMARTBUZ_SERVER_SECRET`. Every deployment built from that point answered 503, and the first sign of it was a customer. The cause was not in the code: the server still reads its configuration at run time, and the build did not bake the values in. The variables are back, the health endpoint that named them is now polled by CI every half hour so an outage is a failed job rather than a silence, and two things are written down so it cannot happen quietly again. A `NEXT_PUBLIC_` variable must be **Config**, not **Secret** — an encrypted variable is not inlined into the browser bundle, so the client is handed `undefined` while the server looks perfectly well — and the configuration a deployment is built with is only as good as the last time somebody checked it, which is why the check now happens on a schedule. |

### Still open

These are the entries that are not closed. The ones fixed since the audit
are in the table above; the ones closed by a decision, or verified as correct
without needing a change, are at the foot of this table.

| Entry | Priority | What is left |
|---|---|---|
| BUG-014 | P0 | Five security headers are committed and deployed: `X-DNS-Prefetch-Control`, `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options` and `Referrer-Policy`. **The Content-Security-Policy is not among them.** It cannot be a static header either — it has to be built with a nonce in `next.config.ts` and the middleware, because a static CSP and `unsafe-inline` are the two things that make a CSP theatre rather than a defence. |
| BUG-027 | P2 | The mobile app does not exist. `apps/mobile/` holds nothing but installed dependencies — no source, no `package.json`, nothing tracked by git. The recommendation was to commit the Expo project or record the work as roadmap, and it was recorded as roadmap. It is a decision nobody has taken: build it, or delete the directory. |
| BUG-028 | P0 | `GET /api/health` exists and is correct — 200 when every required dependency answers and every required variable is set, 503 otherwise, naming missing *variables* and never their values. **Partly fixed 24 Nov 2026.** Something polls it now: `.github/workflows/health-check.yml` runs `scripts/check-live-health.mjs` every half hour, so an application that is down is a failed job and a failing repository page rather than a silence. The script tells "the application says it is broken" apart from "this machine could not reach it", and only the first fails the job — a gate that cries wolf is a gate people learn to ignore. **Still open:** there is still no uptime monitor and no error-reporting service in the dependency tree; GitHub's own email is the only channel, and a scheduled workflow only runs while the repository is active. Nobody is told when sign-in starts failing repeatedly — the throttle counts the failures and says nothing — and nobody is told when a platform action happens. This is the same class of failure as 19 November 2026, when the application returned 503 for a day and the first sign of trouble was a customer report. |
| BUG-029 | P2 | ~~Some queries read a whole table with no bound.~~ **Partly fixed 22 Nov 2026.** The reads that grow without end are bounded where they can be, and the instruments that measure the rest are in place. The platform audit trail no longer reads every audit row in the deployment to find the few that are platform events — each row now says which trail it belongs to, and the trail is read a page at a time from a narrowed index. A business's own trail is read the same way: the action, the actor and the date are index ranges, not filters applied to everything that has ever happened. The debt book is read for the period it is asked for, and the cost of goods is read as at the end of the report's period rather than as the whole purchase history — a purchase made after the period cannot have costed anything in it. The debt book's cursor was the page *number* while the server returned the offset, so the second page of the list asked for the first page again; that is fixed and tested. The appointments and the rentals were read by collecting their whole tables and picking out this business's rows afterwards; they are now read through the business's own index. The low-stock audit asked for every sale the business has ever made and then discarded the ones outside its look-back window; the window is now asked of the sales index. The repayment analysis now asks the payments index for the period it reports on, and the cost history of a product or a supplier is read through the index that is about that product or that supplier rather than through the business's whole cost history. The reports themselves were the largest remaining reader: a report was given a period and read the whole ledger anyway, then applied the period to what came back — and a report given only one end of the period applied no date at all, so it answered with everything (that is BUG-079). The reports now ask the index for the period, through one shared helper, and the debt book's reports are bounded the same way. `scripts/check-ledger-reads.mjs` and `scripts/check-bounded-reads.mjs` list what is still unbounded, so the count can only go down: the unbounded ledger reads are down from 72 to 48, and the five reads that are whole on purpose — a report that was asked for no period at all is owed every row — are marked as such in the source and counted separately. **Still open:** the customer and supplier books are read whole — they are catalogues, bounded by the size of the business rather than by history, and the search that narrows them matches several fields at once, which cannot be pushed into an index without changing what it matches. The debt book still has to be read whole to find the loans that are still owing, because a loan's balance is on the loan and there is no index on it; that is the current state of the business, not a history. A report asked for "all time" still reads all time, because that is what was asked for. |
| BUG-056 | P2 | The pipeline exists and does the right thing: it publishes to the deployment named by `CONVEX_DEPLOYMENT` or derived from `CONVEX_URL`, tries both the `dev:` and `prod:` forms, and then proves that every function in the commit is on the deployment the app points at. **It has never run, because none of the three settings exists** — `CONVEX_DEPLOY_KEY` and `CONVEX_URL` are not set as repository secrets and `CONVEX_DEPLOYMENT` is not set as a repository variable. The job reports that it did nothing, and the backend is published by hand. The web app deploys itself on every push; the backend does not. |
| BUG-058 | P1 | ~~Convex has no multi-document transactions, so a failure part-way through a write can still leave partial state.~~ **Mitigated 22 Nov 2026.** Convex has no transaction across documents, and no cure is coming, so the cure is to make every step keyed and to have something that notices when one was missed. The stock movement of a sale is now keyed by the sale and the product it concerns: `stocks.repairSaleMovement` writes the movement a sale never had, and running it again writes nothing more, so a repair that can be repeated cannot double the books. `stocks.reconcileSales` compares the sales of a period with the movements behind them and names the sale whose movement is missing — the older reconciliation compared a balance with the history and could say that something was wrong but not what. A sale that never had its movement written is now findable and repairable. **Still open:** Convex still offers no transaction, so a write that is split across several mutations can still leave partial state; the sale itself is written in one mutation and is idempotent, but the paths around it are not all so. |
| BUG-073 | LOW | `convex/whoami.ts` is a deliberate diagnostic used by `scripts/verify-identity.mjs`, and it returns no session claims. Kept, and the reasoning is in the file. |
| BUG-076 | INFO | `convex/debug.ts` `inspectUser` was verified as correctly tenant-scoped. No change needed. |
| BUG-077 | INFO | The four financial recomputation worked examples confirm the arithmetic. No change needed. |
| BUG-078 | INFO | No mock, placeholder or hardcoded financial figure was found in the report stack. No change needed. |

---

| | Raw findings | Canonical entries |
|---|---|---|
| CRITICAL | 12 | **6** |
| HIGH | 39 | **23** |
| MEDIUM | 58 | **37** |
| LOW | 21 | **13** |
| INFORMATIONAL | 6 | **3** |
| **Total** | **136** | **82** (BUG-000 … BUG-081) |

Raw findings by report: `04` 11 · `05` 8 · `03` 10 · `08` 17 · `09` 17 · `10` 20 · `11` 6 · `12` 6 ·
`13` 5 · `14` 9 · `15` 8 · `06` 11 · `07` 8 · `16` 10.

**Priority** — P0: fix before the next customer is onboarded · P1: fix in the next sprint ·
P2: schedule · P3: backlog.
**Effort** — S: under half a day · M: one to three days · L: more than three days.

---

## 2. CRITICAL — six canonical entries

### BUG-000 · The deployed profit-and-loss reports aggregate every tenant's sales
- **Source findings:** C-01 (`10`, prior-audit re-verification), confirmed against commit `953f958` by the auditor
- **Priority:** P0 · **Effort:** S (the fix is already written) · **Status: fix exists in the working tree, is uncommitted, and is **not deployed**
- **Location:** `convex/reports.ts:18-23` (`getDailyProfitLoss`) and `:62-67` (`getMonthlyProfitLoss`) at commit `953f958`
- **Description:** Both queries resolve the tenant correctly and check `reports.view`, then read sales with `withIndex("by_date", …)` and **no `businessId` filter**, collecting every sale in the deployment for that day or month and summing `totalRevenue` and cost across all of them. The result returned to the caller therefore contains **other businesses' revenue, cost and profit**. The working tree already contains the fix — `withIndex("by_businessId_date", q => q.eq("businessId", businessId)…)` at `convex/reports.ts:21` and `:67` — but it is uncommitted, and production runs `953f958`, so the deployed application is exposed today.
- **Fix:** Commit the working-tree change to `convex/reports.ts` and redeploy. Then add a regression test that calls both queries as a tenant with sales in another tenant and asserts the totals exclude them.
- **Note:** This is the only finding in the audit whose fix is already written; it needs a commit and a deploy, not a code change.

### BUG-001 · A tenant administrator can write across the whole deployment
- **Source findings:** TI-1, TI-2, TI-3, TI-4 (`07`) · BE-1, BE-2, BE-3, BE-4 (`04`) · DB-01 (`05`)
- **Priority:** P0 · **Effort:** S
- **Location:** `convex/migration.ts:105-145` (the operator check), `:170-176` (target resolution), `:319-397` (the writes)
- **Description:** `requireMigrationOperator` accepts any business owner or administrator, and `resolveTargetBusiness` accepts an arbitrary `businessId` with no membership check (falling back to "the first business that has an owner"). `migrateMemberships` then reads **every user in the deployment** and writes memberships — and, at `:388-396`, **ownership** — into the business the caller named. `migrateTenantRows` re-stamps tenant-less rows across roughly fifty tables into it. One call from one tenant administrator can transfer data ownership, enrol users and change ownership inside businesses that have no relationship with the caller.
- **Fix:** Move `convex/migration.ts` out of the deployed function set (a `convex/dev/` directory excluded by `convex.json`), or gate every entry point behind `serverSecretMatches` in addition to the operator check. Never fall back to "the first business that has an owner".

### BUG-002 · Seeded demo identities are shared across tenants with hardcoded passwords
- **Source findings:** TI-5 (`07`) · BE-5, SEC-05 (`04`, `06`)
- **Priority:** P0 · **Effort:** S
- **Location:** `convex/seed.ts:40-87` (accounts), `:288-353` (the public mutations)
- **Description:** `seedUsersInternal` creates `admin@pos.com / password123`, `sales@pos.com / password123` and `stock@pos.com / password123`, then resolves each account **globally by email** and attaches it to the caller's business with the seeded role. Two businesses that seed therefore share one account, and the holder of a publicly known password is an administrator of both. The seeding mutations are guarded by a tenant-level role, so any business owner or manager can reach them.
- **Live state:** all three seeded addresses were probed against the production login route on 20 Nov 2026 and **all three were refused** — no seeded account is currently active. This is a latent defect, not a live compromise.
- **Fix:** Remove the seeding mutations from the production function set, or gate them behind `serverSecretMatches`; generate per-tenant identities with random passwords that are never returned.

### BUG-003 · The credential check is a public, unthrottled backend mutation
- **Source findings:** SEC-01, SEC-02 (`06`) · BE-6, BE-7 (`04`)
- **Priority:** P0 · **Effort:** S
- **Location:** `convex/users.ts:376-424` (`users:login`); `src/app/api/auth/route.ts:52-63` (the ineffective limiter)
- **Description:** `users:login` requires no token, no server secret and has no attempt counter. The only rate limit is an in-memory map in the Next route, which is per-instance on serverless. The Convex deployment URL is published in the client bundle, so the limiter is bypassable by calling the mutation directly — **verified live**: the call executed unauthenticated and returned the credential error. The unknown-account path also returns ~100 ms faster than the wrong-password path (it skips the bcrypt comparison), giving a timing oracle for account enumeration.
- **Fix:** Put the server secret in front of `users:login` (as `users:startSession` already is), add a persisted attempt counter and lockout, and run a dummy bcrypt comparison for unknown accounts.

### BUG-004 · A tenant can move itself to any paid plan without paying
- **Source findings:** LIC-01 (`11`)
- **Priority:** P0 · **Effort:** M
- **Location:** `convex/subscriptions.ts:352-399` (`selectPlan`), `convex/entitlements.ts:105-108,163`
- **Description:** When a subscription row exists, `selectPlan` patches `planKey` to any active plan the caller names — no payment, no tier comparison, no period change — and entitlements are recomputed from the patched plan key. One mutation call therefore upgrades any tenant to the most expensive plan in the catalogue, unlocking purchasing, business intelligence, finance reports, customer credit and loyalty, along with that plan's device, user, branch and product limits, for nothing. The change is written to the subscription history and the audit trail, which makes it visible after the fact but does not prevent it.
- **Fix:** Do not patch `planKey` in `selectPlan`. Record a pending plan change and apply it only when a `subscriptionPayments` row reaches `status === "verified"` — the rule `activateSubscription` already follows.

### BUG-005 · A business with no subscription row is not governed by any licensing rule
- **Source findings:** LIC-02, LIC-03 (`11`) · OFF-02 (`12`)
- **Priority:** P0 · **Effort:** S
- **Location:** `convex/businesses.ts:256-341` (the public registration path), `convex/entitlements.ts:110-122,160-161`, `convex/subscriptionState.ts:327-357`, `convex/sync.ts:209-215`
- **Description:** `businesses.register` is public and creates a business with `plan: "trial"` and `subscriptionStatus: "trial"` but **no `subscriptions` row**. The entitlement system reads a missing row as "not licensed, therefore not gated" — every feature is granted (`features: ALL_ENTITLEMENTS`), the write gate stays open, and `deviceLimit()` returns 0, which switches the device cap off. A trial with no end date never lapses (`computeEffectiveStatus` returns `trial` when there is no date to compare), so the tenant is ungated **forever**. The normal UI journey is safe — `/setup` calls `createForCurrentUser`, which calls `startTrial` — but the unused public endpoint is reachable by anyone who knows the deployment URL.
- **Fix:** Make `businesses.register` call `startTrial` exactly as `createForCurrentUser` does; treat a missing subscription row as expired rather than ungated; make `deviceLimit()` return "no devices" rather than "no limit" when there is no subscription.

---

## 3. HIGH — twenty-three canonical entries

| ID | Title | Source findings | Priority | Effort | One-line fix |
|---|---|---|---|---|---|
| **BUG-006** | Two sources of truth for the retail price: a master price change breaks checkout at shop counters | FE-005 (`03`), DB-06 (`05`) | P0 | M | Price the cart and the sale from one source; treat the issued price as a cost basis, never as the retail price |
| **BUG-007** | VAT is never recorded and no report produces a VAT figure | POS-004 (`08`), FE-006 (`03`), FIN-11 (`10`) | P0 | M | Compute the split server-side in `applySale`; store net, tax and rate on the sale; report from the stored values |
| **BUG-008** | A till price override has no floor — any seller can sell at zero | POS-001 (`08`) | P0 | S | Clamp overrides to a configurable floor and require a dedicated permission above it |
| **BUG-009** | An online sale has no idempotency key: a retried request duplicates the sale | POS-002 (`08`) | P0 | S | Send `clientOfflineId` from the online path too, and dedupe on it exactly as the offline path does |
| **BUG-010** | The stock ledger is written but never read; nine of eleven stock paths write no movement | INV-001, INV-002, INV-003, INV-004, INV-006, INV-007, INV-008, INV-009 (`09`) | P0 | L | Make every balance change write a ledger row, and add a reconciliation query that compares balances to the ledger |
| **BUG-011** | The financial reports overstate revenue and mis-state cost of goods sold | FIN-01, FIN-02, FIN-03, FIN-05 (`10`) | P0 | M | Net refunds out of revenue, cost the goods sold at the price the sale was made at, and bound the report period correctly |
| **BUG-012** | Resolving a stock conflict as "rejected" does not reverse the sale, the stock or the money | OFF-03 (`12`) | P0 | M | Make `rejected` call the compensation path `refundSale` already implements |
| **BUG-013** | Three integration recorders are public mutations with no authorization check | INT-01, INT-02 (`14`), INT-03 (`14`) | P0 | S | Convert `recordProviderError` and `recordMessage` to internal mutations; require the tenant in `reportHardware` |
| **BUG-014** | Production serves no security headers | SEC-04 (`06`) | P0 | S | Commit `next.config.ts` as it stands, add a CSP, and redeploy |
| **BUG-015** | The password-reset and verification email endpoints are unthrottled | SEC-03 (`06`), INT-09 (`14`) | P0 | S | Apply the backend-backed limiter with a per-address cooldown and a per-IP cap |
| **BUG-016** | Oversell is not prevented at write time; stock may go negative | POS-007 (`08`) | P1 | M | Decide the policy (block, or allow and flag) and enforce it in `applySale` |
| **BUG-017** | A refund of a shop sale credits the master warehouse, not the shop | POS-009 (`08`) | P1 | S | Credit the location the stock was deducted from |
| **BUG-018** | Editing a sale deletes its loan and the recorded payments | POS-011 (`08`) | P1 | M | Make an edit that changes the financial terms re-open the loan instead of deleting it |
| **BUG-019** | The debt book can be inflated: a negative loan payment, an unvalidated deposit, and a backdated payment | POS-012, POS-010, POS-014 (`08`), POS-013 (`08`), INV-017 (`09`), FIN-12 (`10`) | P1 | M | Validate that every payment and deposit is positive and within the sale; refuse client-supplied payment dates; consolidate the two repayment paths |
| **BUG-020** | A customer credit limit is displayed and reported but never enforced | INV-016 (`09`) | P1 | S | Refuse a credit sale that would exceed the limit, at the point of sale |
| **BUG-021** | A product can be hard-deleted while it still has sales history | INV-010 (`09`), DB-05 (`05`) | P1 | S | Archive rather than delete any record that appears in a sale, a ledger entry or a purchase order |
| **BUG-022** | The `/setup` wizard crashes on every load | FE-001 (`03`) | P1 | S | Move the `planKey` declaration above the `chosenPlan` derivation |
| **BUG-023** | There is no error boundary and no loading state anywhere in the application | FE-002, FE-003 (`03`), PERF-04 (`15`) | P1 | M | Add `global-error.tsx`, a dashboard `error.tsx` and per-route `loading.tsx` |
| **BUG-024** | The Global Stock report re-fetches the same page and duplicates rows | FE-004 (`03`), PERF-03 (`15`) | P1 | S | Implement the cursor as an offset and let the client stop on `isDone` |
| **BUG-025** | A payment callback is accepted on its reference alone when no webhook secret is set | BE-10 (`04`), SEC-06 (`06`), INT-04 (`14`) | P1 | M | Refuse callbacks for secret-less adapters; require the secret at configuration time; lengthen the reference |
| **BUG-026** | Barcode scanning is not wired to the till and the product form cannot record a barcode | INV-013, INV-014 (`09`) | P1 | M | Wire the existing server helpers into the till and the product form |
| **BUG-027** | The mobile application does not exist | MOB-01, MOB-02 (`13`) | P2 | L | Commit the Expo project or delete the directory and record the work as roadmap |
| **BUG-028** | There is no monitoring, alerting or error reporting — in any sense | PERF-05 (`15`), SEC-08 (`06`), BUILD-09 (`16`) | P0 | M | Add error reporting, a `/api/health` route, an uptime monitor and alerts on failed logins and platform actions |

---

## 4. MEDIUM — thirty-seven canonical entries

| ID | Title | Source findings | Priority | Effort |
|---|---|---|---|---|
| BUG-029 | No query in the backend bounds the rows it reads (333 `.collect()` sites, 0 `.take()`) | DB-02, DB-03 (`05`), PERF-02 (`15`) | P1 | L |
| BUG-030 | `selectPlan` changes the plan without adjusting billing, the period or the price | LIC-06 (`11`) | P1 | M |
| BUG-031 | The `core.*` entitlements are published but never enforced | LIC-05 (`11`) | P2 | S |
| BUG-032 | Device limits are enforced only at registration, and only when a subscription row exists | LIC-04 (`11`), OFF-01 (`12`), BE-9 (`04`) | P1 | M |
| BUG-033 | The dashboard shell recreates its sidebar on every render, resetting its state | FE-007 (`03`) | P2 | S |
| BUG-034 | The payment-method effect reads a stale value | FE-008 (`03`) | P1 | S |
| BUG-035 | Backend rejections reach the operator only as console output | FE-009 (`03`) | P1 | M |
| BUG-036 | `migrationStatus` returns deployment-wide figures to a tenant administrator | TI-6 (`07`) | P1 | S |
| BUG-037 | An expense may be recorded with a negative amount, inflating net profit | FIN-08 (`10`) | P1 | S |
| BUG-038 | The business time zone labels the period but does not bound it | FIN-06 (`10`) | P1 | M |
| BUG-039 | The expenditure and sales screens drop the first day of the requested range | FIN-05 (`10`), FIN-07 (`10`) | P1 | S |
| BUG-040 | A refunded credit sale keeps its full outstanding balance in the debt book | FIN-10 (`10`) | P1 | M |
| BUG-041 | The ageing of debts is computed from the loan's start date, not from its last activity | FIN-13 (`10`) | P2 | S |
| BUG-042 | Loan payments carry no payment method, so reconciliation under-counts repayments | FIN-09 (`10`) | P2 | S |
| BUG-043 | `getInventoryStats` subtracts counter stock from a figure that no longer contains it | INV-011 (`09`) | P1 | S |
| BUG-044 | Low-stock alerts use one global, client-supplied threshold with no per-product reorder level | INV-012 (`09`) | P2 | M |
| BUG-045 | The cost price is returned to cashiers | INV-015 (`09`) | P1 | S |
| BUG-046 | `issueStock` gives a counter stock without taking it out of the warehouse | INV-005 (`09`) | P0 | M |
| BUG-047 | Two different valuation bases are used for the same goods | DB-06 (`05`), INV-011 (`09`) | P1 | M |
| BUG-048 | `getSyncStatus` reads every sync log for the business with an unbounded query | OFF-04 (`12`) | P2 | S |
| BUG-049 | Every payment adapter defaults to sandbox and nothing surfaces it to the operator | INT-05 (`14`) | P1 | M |
| BUG-050 | There is no automatic repair for a payment that fails after the customer was charged | INT-06 (`14`) | P1 | L |
| BUG-051 | There is no backup or restore path for a business's data | INT-08 (`14`) | P1 | L |
| BUG-052 | Production configuration is unversioned and unvalidated — the cause of the 19 Nov outage | BUILD-01, BUILD-04 (`16`) | P0 | M |
| BUG-053 | The lint gate does not exist, and enabling it fails (1,154 errors) | BUILD-02 (`16`) | P2 | M |
| BUG-054 | Dependency vulnerabilities are unknown — no scan in CI and the manual scan could not complete | BUILD-03 (`16`), SEC-07 (`06`) | P1 | S |
| BUG-055 | There is no deployment runbook, rollback procedure or key-rotation procedure | BUILD-07, BUILD-08 (`16`) | P1 | S |
| BUG-056 | The Convex backend is not deployed by any pipeline and can drift from the web build | BUILD-10 (`16`) | P2 | M |
| BUG-057 | 227 KB of JavaScript is downloaded before the operator has signed in | PERF-01 (`15`) | P2 | M |
| BUG-058 | Multiple writes can leave partial state — Convex has no multi-document transactions | DB-04 (`05`) | P1 | L |
| BUG-059 | The schema and the functions are not validated against each other in CI | DB-08 (`05`) | P2 | S |
| BUG-060 | `shops.issuedStocks` duplicates price and quantity that live in `stocks` | DB-06 (`05`) | P1 | M |
| BUG-061 | Promotion evaluation shown to the customer uses client-supplied PV/BV | POS-006 (`08`) | P1 | M |
| BUG-062 | Sales-history search filters after pagination | POS-015 (`08`) | P2 | S |
| BUG-079 | A report given one end of a period ignores it and answers with everything | found while bounding the reports (see BUG-029) | P1 | S |
| BUG-080 | The CI workflow is invalid, so no gate has ever run | found while making CI run (see BUG-053, BUG-054) | P0 | S |
| BUG-081 | The deployment's configuration was lost and the application was down for a day, unannounced | found while restoring the 23–24 Nov 2026 outage (see BUG-052, BUG-055, BUG-028) | P0 | S |

---

## 5. LOW — thirteen canonical entries

BUG-063 bcrypt cost factor is the minimum (BE-11, SEC-11) · BUG-064 legacy plaintext reset codes are still accepted
(SEC-10) · BUG-065 backend errors leak internal source paths (SEC-09) · BUG-066 the offline queue has no upper bound
(OFF-05) · BUG-067 the service worker cache is invalidated by a hand-maintained constant (OFF-06, PERF-07) ·
BUG-068 `mySales` is invisible to users not assigned to a shop (POS-016) · BUG-069 client-supplied product name and code
are stored on the sale (POS-008) · BUG-070 an offline price difference is recorded but never surfaced (POS-017) ·
BUG-071 sale totals are stored unrounded (FIN-14) · BUG-072 the currency is hardcoded as "UGX" (FIN-15) ·
BUG-073 `convex/whoami.ts` is diagnostic scaffolding in the deployed set (TI-7, BE-8) · BUG-074 the `userTypes` table has
no index (DB-07) · BUG-075 accessibility is handled inconsistently (FE-010).

## 6. INFORMATIONAL — three canonical entries

BUG-076 `convex/debug.ts` `inspectUser` — verified as correctly tenant-scoped (TI-8) · BUG-077 four financial
recomputation worked examples confirming the arithmetic (FIN-16 … FIN-19) · BUG-078 no mock, placeholder or
hardcoded financial figure was found in the report stack (FIN-20).

---

## 7. The twenty to fix first

| # | Entry | Why it is first |
|---|---|---|
| 1 | **BUG-001** | Cross-tenant write capability. Cheap to close: move the module out of the deployed set |
| 2 | **BUG-004** | The entire commercial model is one mutation away from being void |
| 3 | **BUG-003** | Unlimited credential attempts against a public endpoint |
| 4 | **BUG-005** | Unsigned tenants get everything, forever |
| 5 | **BUG-002** | Known-password administrators that cross tenants |
| 6 | **BUG-014** | The headers are written; they are simply not deployed |
| 7 | **BUG-009** | A double-tap on a slow connection makes two sales and two stock deductions |
| 8 | **BUG-008** | Any seller can zero a price |
| 9 | **BUG-013** | Three anonymous write paths into tenant tables |
| 10 | **BUG-015** | Unthrottled email sending |
| 11 | **BUG-011** | The financial reports are wrong in four separate ways |
| 12 | **BUG-007** | No VAT figure exists anywhere in the system |
| 13 | **BUG-010** | The stock position cannot be reconciled with the transactions |
| 14 | **BUG-006** | A price change breaks the checkout |
| 15 | **BUG-012** | "Rejected" does not reverse anything |
| 16 | **BUG-016** | Oversell is possible |
| 17 | **BUG-017** | Refunds land in the wrong place |
| 18 | **BUG-018** | Editing a sale destroys the loan record |
| 19 | **BUG-019** | The debt book can be inflated |
| 20 | **BUG-028** | Without monitoring, none of the above is noticed, and the next one is not either |

**Total effort for the first twenty:** roughly **9–13 engineer-days** of focused work, concentrated in three
files — `convex/migration.ts` (delete or gate), `convex/subscriptions.ts` (plan changes) and
`convex/users.ts` (the login guard) — plus one deployment (`next.config.ts`) and one monitoring setup.

---

## 8. How to use this register

- Each canonical entry names the **source finding IDs**, so the full evidence, the reproduction steps and the
  recommended fix for every entry are in the domain report listed in §1 of that report.
- **Effort and priority** are the audit's judgement, not measured values; treat them as a planning aid.
- Entries marked **P0** are the ones that change the risk profile of the platform rather than its polish.
- The severity of an entry is the highest severity assigned to it by any source report, with two documented
  corrections: BE-7 was rewritten (the enumeration channel is timing, not error messages) and BE-8/TI-7 was
  downgraded (a diagnostic that echoes the caller's own identity leaks nothing).
