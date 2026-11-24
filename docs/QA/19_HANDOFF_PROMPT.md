# SMARTBUZ — hand-off prompt

*Everything below is meant to be pasted into a new session, whole. It is the
state of the application as of 24 November 2026: what is there, what is
proven, and what is still owed.*

---

## 1 · What you are working on

**SMARTBUZ v2.0** — a multi-tenant, multi-vertical point-of-sale and business
management platform for African small businesses. Ugandan usage tax (URA VAT)
is first-class; the money, the stock and the debt are the point, and the
platform is built so that a shop owner can trust the numbers.

| | |
|---|---|
| Front end | Next.js 16.4.6 (App Router), React 19, TypeScript, Tailwind, shadcn/ui, Recharts |
| Back end | Convex 1.31 — 320 queries/mutations/actions, 94 tables, 290 indexes |
| Auth | Convex Auth + a short-lived JWT the Next.js server mints for the browser, JWKS published by the backend |
| Offline | PWA — service worker, IndexedDB catalogue and sale queue, heartbeat, sync engine |
| Tests | 21 files, 129 suites, 509 tests, all passing |
| Dependencies | 0 high and 0 critical advisories in the production tree; 9 moderate in the whole tree |
| Repo | `C:\Users\beino\Desktop\SMARTBUZ` — branch `main`, remote `https://github.com/BEINOMUGISHA/SMARTBUZ` |
| Web (live) | `https://smartbuz.vercel.app` |
| Backend (live) | `https://affable-panda-681.convex.cloud` (site: `https://affable-panda-681.convex.site`) |
| Health | `/api/health` answers 200 with `missingVariables: []`, and CI polls it every 30 minutes |

Fifty pages, ten server routes, fifty-seven backend modules. Six industry
packages (restaurant, supermarket, pharmacy, wholesaler, manage, registry) and
eighteen vertical feature pages.

**The single most important thing to understand:** the Convex deployment the
app points at is `affable-panda-681`. `npx convex deploy` publishes to the
project's *production* deployment instead and will report success while
changing nothing the app uses. The command that publishes to the right place
is `npx convex dev --once`. A stale, unused deployment also exists at
`shocking-mule-553.convex.cloud` — ignore it.

---

## 2 · The rules you must not break

1. **Never write to the live Convex deployment unless that write *is* the
   remediation.** Write-capable audit scripts are prohibited. `scripts/verify-identity.mjs`
   and `scripts/verify-deployment.mjs` are read-only and safe. The one-off
   repair scripts (`scripts/backfill-audit-scope.mjs`,
   `scripts/strip-plain-reset-codes.mjs`, `scripts/normalise-barcodes.mjs`)
   are gated on the server secret and are run against the live deployment only
   when they *are* the fix.
2. **Never print a secret value.** Refer to variables by name
   (`SMARTBUZ_JWT_PRIVATE_KEY`, `SMARTBUZ_SERVER_SECRET`, `SESSION_SECRET`,
   `RESEND_API_KEY`). Compare by hash, never by value. The health endpoint
   names missing variables and never their contents — keep it that way.
3. **The lint gate fails on any new finding.** Baseline: 1,468. Never add
   `no-explicit-any` or any other lint debt in `src/`, `convex/` or
   `scripts/`. Warnings count too.
4. **Match the codebase's voice.** Comments explain *why*, in prose, and the
   reasoning is visible in the code. A comment that says only what the line
   does is noise.
5. **Preserve each file's line endings.** The repository is mixed; each file
   is internally consistent. Check with `grep -qU $'\r' "<file>"` before
   editing.
6. **A cursor is an offset, never a page number.** The pagination hook echoes
   whatever the server returned.
7. **Convex applies `.filter()` before `.paginate()`**, so a filtered page is
   still a page of the filtered set.
8. **A period with one end is a period.** "Everything since 1 March" must not
   answer with everything. Reports ask the index for their period.
9. **A read that is whole on purpose says `all-time:` in the source**, on the
   lines above it. The read checker counts those separately, so the number it
   prints is the number of reads that forgot their period.
10. **Never cap a read with `.take(n)` to make it look better.** That silently
    truncates a financial report. Bound the read by the period or the parent,
    not by a number.
11. **A `NEXT_PUBLIC_` variable must be Vercel "Config", never "Secret".** Its
    value is inlined into the browser bundle at build time; an encrypted
    variable is not inlined at all, so the client is handed `undefined` while
    the server looks perfectly well. Vercel warns on the form — the warning is
    correct.
12. **The application can go down without a single line of code changing.** The
    Vercel project *is* part of the application. Read §5.2 before touching
    anything else.

---

## 3 · How to know whether it works

Run all of these before saying a thing is done. They are the instruments that
keep this codebase honest.

```bash
npm run typecheck                              # app
npx tsc --noEmit -p convex/tsconfig.json       # backend, against the schema
npm test                                       # 509 tests
node scripts/lint-baseline.mjs                 # gate: PASS at or below 1,468
node scripts/check-ledger-reads.mjs            # unbounded ledger reads
node scripts/check-bounded-reads.mjs           # whole tables read to serve one page
node scripts/check-public-bundle.mjs           # no public route may reach the Convex client
node scripts/check-workflows.mjs               # the CI files can actually be run
node scripts/check-live-health.mjs             # the live application is answering
npm run build                                  # the app builds
```

Typecheck takes 5–8 minutes, the lint scan about 13, the build about 11. Run
the slow ones in the background. `npm audit --omit=dev` must be clean of high
and critical advisories — CI fails the build on one.

---

## 4 · What is available and working

Each line is something that was broken by the audit and has been fixed, or a
capability that exists and is exercised. Where it lives is in §7.

### The till
- A live sale is priced, costed and validated by the server. The browser does
  not decide what a thing costs.
- A price that changes while the sale is being rung up **holds** the sale
  until the seller puts the new price to the customer, and the difference is
  written on the sale so the books can explain it. An offline sale cannot be
  held — the goods have gone and the money has been taken — so it is recorded
  at the catalogue's price with the difference recorded.
- Stock cannot go negative on a live sale, and the cashier is told which
  product ran out. A position that is already negative may still be sold,
  because refusing would strand the product for good.
- The receipt takes its product name and code from the server's catalogue, not
  from the browser. A client that renamed a line in transit does not put a
  name on the receipt that does not match the product it was charged for.
- **Barcode scanning is wired to the till**, and a product can carry a
  barcode. `convex/barcode.ts`, `src/app/(dashboard)/till/`.
- An online sale carries a `clientOfflineId` and is deduplicated on it, so a
  retried request does not duplicate the sale.
- The currency comes from the business record. It was hardcoded as "UGX" in
  188 places; a dollar business was shown "UGX 12,500" and the mobile-money
  request asked the provider for "UGX" whatever the business traded in, which
  the provider refuses.

### Money and the books
- `convex/financeCore.ts` is the single place money is worked out. The
  reports do not each do their own arithmetic.
- Refunds are netted out of revenue. Goods are costed **at the price they
  were bought at**, not at today's price — last month's profit no longer
  changes every time the owner restocks.
- A report's period includes its first day and its last day, and the period is
  the business's own local day. A period with one end is read as that half.
- VAT is computed server-side and stored on the sale as net, tax and rate;
  the reports read the stored values.
- A sale's total is a figure in the currency and the lines add up to it.
- A price override has a floor, so no seller can sell at zero.
- A negative expense is refused: it *adds* to profit, turning an expense into
  a gain.

### Stock and the warehouse
- Every change of goods writes a ledger row — opening balance, restock, issue,
  transfer, adjustment, refund. The ledger was written but never read; it is
  now read, and `stocks.getReconciliation` compares the balances against the
  history.
- A counter no longer keeps a copy of the product. Its row is
  `{ stockId, qty }` and nothing else. A price change reaches every counter
  at once, and the goods are valued on one basis — the copy that used to
  drift out of step is gone.
- Issuing stock to a counter takes it out of the warehouse and writes both
  halves of the movement.
- The warehouse's holding and the counters' holdings are counted separately,
  and the total is the two together.
- Each product is compared against its own reorder point; the business's
  default is stored rather than typed into the browser.
- The cost price is withheld from the till and from everyone without a
  cost-visible role.
- A product with history is archived rather than destroyed.

### Customers, suppliers and the debt book
- A repayment must be positive, must be within the balance, is dated by the
  server, and must say how it was paid. The two doors into the debt book
  follow the same rules.
- A customer's credit limit is enforced at the point of sale.
- Correcting a credit sale keeps the money the customer has paid — the loan
  is corrected, not destroyed. A correction at the till used to be able to
  *increase* what a customer owed.
- A refunded credit sale no longer keeps its full outstanding balance.
- The ageing of debts is computed from the loan's last activity, not from the
  day the loan was opened, and the ageing reports read only the payments
  taken since the oldest loan still owing.
- The debt book's cursor was the page *number* while the server returned the
  offset, so page two asked for page one again. Fixed and tested.

### Reports
Eleven report screens: overview, sales, profit, expenses, products, customers,
users, shops, stock, loans, analysis. Every report reads its period through
the index.

### People, tenants and permissions
- Multi-tenant from the ground up. Every query is scoped to the caller's
  business; the profit-and-loss reports used to return every tenant's revenue
  and profit.
- RBAC with nine business roles and three platform roles. Permissions are
  enforced **on writes**, at the gate, not hidden in the interface.
- The `core.*` entitlements were published on the pricing page and never
  checked. They are enforced now.
- `convex/migration.ts` was callable by any business owner with an arbitrary
  `businessId` and wrote across the whole deployment. It now needs the
  server-to-backend secret in addition to the operator role, and it will not
  guess which business to migrate: it asks.
- `convex/seed.ts` is likewise gated on the server secret.
- Backend refusals reach the operator as a refusal on the screen, not as
  console output.
- `convex/migrationStatus` returns deployment-wide figures only to the server.

### Licensing and subscriptions
- A business with no subscription row used to be given every entitlement and
  could write for ever. Registration starts a real, tracked free trial, the
  entitlement gate fails closed, and the tenants that already exist were
  backfilled.
- Choosing a paid plan records the *intention*; the plan becomes real only
  when a payment for it is verified. Moving to a free plan takes effect at
  once. A plan change moves the price, the billing cycle and the period
  together — a business that moved to a cheaper plan used to keep the
  expensive one until the old period ran out.
- Device limits are enforced beyond registration, and a business moved to a
  smaller plan loses the devices beyond its allowance.

### Integrations
- Payment adapters (mobile money, cards), messaging, hardware and
  reconciliation, behind one adapter layer and a provider registry.
- A payment callback is authenticated by a signature. An adapter with **no**
  webhook secret refuses every callback, rather than accepting one on its
  reference alone.
- **A payment the customer made but the books did not see is repaired
  automatically.** The repair asks the provider — the only party that knows —
  and the provider's answer is what stands. The till asks for the repair
  every time it talks to the server. A provider that cannot be reached is not
  the same as a payment that failed: the payment is left alone, the attempt
  is counted, and after three attempts it is flagged for a person
  (`payments.listPaymentsNeedingReview`).
- Every adapter starts in the sandbox, and a sandbox adapter that is switched
  on now carries a visible warning that it will not move real money. Every
  payment in the history says whether it was a sandbox one.
- The internal integration mutations are internal. The public ones are
  resolved from the session.

### Offline
A service worker with a named, versioned cache; an IndexedDB catalogue, a
bounded sale queue (the oldest sent sales are let go past two hundred, the
ones still waiting never are); a heartbeat and a sync engine; a cached
session store so a signed-in till comes back up without a network.

### The verticals and the packages
Eighteen vertical pages — appointments, assets, attendance, batches, classes,
deliveries, devices, expenditures, fuel, inventory, members, menu,
platform, prescriptions, production, purchase-orders, rentals, rooms,
service-tickets, shops, stock, subscription, suppliers, systemconfig, tables,
till — and six packages: restaurant, supermarket, pharmacy, wholesaler,
manage, registry. Backed by `convex/verticals/` (batches, members,
operations, scheduling, tax) and `convex/packages/`.

### Operations
- **Backup and restore.** A backup is one JSON file — catalogue, customers,
  sales, debts, ledger, audit trail — readable without SMARTBUZ. The accounts,
  the sessions and the licence are deliberately *not* in it: a restored
  database that could grant itself a licence would be a hole rather than a
  backup. Reading is bounded one table at a time through the table's
  `by_businessId` index; writing needs the server secret.
- **`GET /api/health`** — 200 when every required dependency answers and every
  required variable is set, 503 otherwise. It names missing *variables* and
  never their values, and it never forwards an upstream body.
- **Something polls it.** `.github/workflows/health-check.yml` runs
  `scripts/check-live-health.mjs` every half hour, so an application that is
  down is a failed job rather than a silence. The script tells *"the
  application says it is broken"* apart from *"this machine could not reach
  it"*, and only the first fails the job. Run it by hand with
  `node scripts/check-live-health.mjs`.
- The audit trail, with a `scope` on each row so a tenant reads its own trail
  and the platform reads the whole one.
- `docs/RUNBOOK.md` — how to release the web app and the backend, which goes
  first and why, how to roll either back, how to rotate each key.

### The front end
- The `/setup` wizard crashed on every load. Fixed.
- The dashboard shell recreated its sidebar on every render, resetting its
  state. Hoisted out.
- There are now error boundaries (root, route, dashboard), a not-found page
  and loading states for the main segments.
- The sign-in screen no longer downloads the whole application: **212.5 KB
  gzipped in 16 chunks**, down from 239.7 KB in 17. The Convex client is gone
  from the public routes entirely — the session and the auth context were
  split, and the public auth flows go through the Next.js server so the
  verification code never travels through the browser.
- Accessibility is consistent: a route announcer sets the document title and
  moves focus to the new page's `<h1>`, a skip link, a labelled `<main>`,
  auth pages as `<main>`, and register's headings as real headings.

---

## 5 · What still needs to be done

Ordered by how much it matters. Each is a real gap, not a wish.

### 5.1 The gates run now — but the backend is still published by hand
The `ci.yml` workflow was **rejected by GitHub on every push since the day it
was written**: the Build step had a name and an environment and no `run:`. A
workflow GitHub cannot parse is refused *before any job starts* — the run is
marked failed with zero jobs and no reason. So the configuration pre-flight,
the lint gate, the dependency audit, the Convex schema check, the typecheck,
the tests and the build had never once been executed by GitHub. They had only
ever been run by hand, on one machine, on the day of the commit.

Fixed: the step runs the build, with the same placeholder environment the
pre-flight uses. `scripts/check-workflows.mjs` now checks the workflow files
(parse, every job has something to do, every step says what to run and is
named, every dependency exists, every local action is present) and runs in the
pre-flight, so the next invalid workflow is a failed job rather than a silent
one. It was proved against the file it was written for.

**What is still wrong:** `.github/workflows/deploy-convex.yml` needs
`CONVEX_DEPLOY_KEY` and `CONVEX_URL` as repository **secrets** and
`CONVEX_DEPLOYMENT` as a repository **variable**. **None of the three is
set**, so the job reports that it did nothing and the backend is published by
hand. The web app deploys itself through Vercel on every push; the backend
does not. Set the three, and the job will publish to the right deployment and
prove afterwards that every function in the commit is on the deployment the
app points at.

### 5.2 The application's configuration can be lost, and the code was never at fault
On 23 November 2026 at about 19:02 the Vercel Production environment was found
to hold **one** variable — `SMARTBUZ_JWT_PRIVATE_KEY` — and the four that make
the application start were gone: `NEXT_PUBLIC_CONVEX_URL`,
`NEXT_PUBLIC_CONVEX_SITE_URL`, `SESSION_SECRET` and `SMARTBUZ_SERVER_SECRET`.
Every deployment built from that point answered **503**, and the first sign of
it was a customer. The application was back up on the afternoon of 24
November — about twenty-one hours.

**The code was not the cause.** The server reads its configuration at run time
and the build does not bake the values in; the same commit on the same machine
was healthy the day before. What failed was a *project setting* — a thing that
is invisible in the repository and that nothing in the repository was checking.

What was done about it:

- The four variables are restored, from the values in `.env.local`. The
  `SMARTBUZ_SERVER_SECRET` in that file was hash-compared against the one
  already inside the Convex deployment and they match, so the restored
  configuration is the configuration the backend expects.
- `/api/health` is now polled by CI every half hour —
  `.github/workflows/health-check.yml` runs `scripts/check-live-health.mjs` —
  so an application that is down is a failed job rather than a silence. The
  script tells *"the application says it is broken"* apart from *"this machine
  could not reach it"*, and only the first fails the job.
- `docs/RUNBOOK.md` §5.2 now carries the case in full, including the rule
  that a `NEXT_PUBLIC_` variable must be **Config** and not **Secret**.

**What is still true of it:** the health check sees the *effect* of a lost
variable, not the variable itself, and it only watches the web app. Two things
would close it properly and neither is in the repository: a scheduled
`node scripts/validate-config.mjs --prod` against the *real* Vercel
environment (needs a Vercel token), and an outside uptime service.

### 5.3 Nothing is watching — as much as nothing
`/api/health` is now polled by CI (§5.2). That is better than nothing, and it
is not monitoring: it knows about failure but not about slowness; it runs only
while the repository is active; and it fails into GitHub's email, with no
escalation. There is still no error-reporting service (no Sentry, no
equivalent in the dependency tree) and no outside uptime service. Nobody is
told when a login starts failing repeatedly: the throttle counts the failures
and says nothing. Nobody is told when a platform action happens. The fix is:
point an outside uptime monitor at `/api/health`; add error reporting; notify
on lockout and on platform actions.

### 5.4 No Content-Security-Policy
Five security headers are committed and deployed (`X-DNS-Prefetch-Control`,
`Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`,
`Referrer-Policy`). The CSP the audit asked for is **not** among them. It
needs a nonce-based policy, which means it has to be built in `next.config.ts`
and in the middleware — not added as a static header — because a static CSP
and `unsafe-inline` are the two things that make a CSP theatre.

### 5.5 The mobile application does not exist
`apps/mobile/` holds nothing but installed dependencies — no source, no
`package.json`, nothing tracked by git. The audit's recommendation was to
commit the Expo project or record the work as roadmap, and it was recorded as
roadmap. It is a decision nobody has taken: build it, or delete the
directory.

### 5.6 The reads that are still unbounded
The unbounded ledger reads are down from 72 to **48**, with five more read
whole on purpose and counted apart. What is left:

- The **customer and supplier books** are read whole. They are catalogues,
  bounded by the size of the business rather than by history, and the search
  that narrows them matches several fields at once — it cannot be pushed into
  an index without changing what it matches.
- The **debt book** must be read whole to find the loans still owing,
  because a loan's balance lives on the loan and there is no index on it.
  That is the current state of the business, not a history.
- A report asked for "all time" still reads all time, because that is what
  was asked for. It says `all-time:` in the source so the checker can tell
  it apart from a read that forgot its period.

### 5.7 Partial state
Convex offers no cross-document transaction, so a write split across several
mutations can still leave partial state. The sale itself is one idempotent
mutation. Around it, `stocks.reconcileSales` names the sale whose stock
movement is missing and `stocks.repairSaleMovement` puts it right — keyed by
(sale, product), so repeating the repair cannot double the books. The other
paths are not all so.

### 5.8 The lint backlog
1,458 findings against a baseline of 1,468. The gate fails only on *new*
problems, so the backlog stays visible and cannot grow. It is real debt, and
it is almost all `no-explicit-any` in the Convex layer.

### 5.9 The audit's own reports are snapshots
`docs/QA/01`–`18` describe the application as it was on 20 November 2026.
Only `17_BUG_REGISTER.md` has been kept current. Read the register's §0 and
this prompt for the present state; read the rest for the detail of what was
found.

---

## 6 · Releasing

**Backend.** `npx convex dev --once` publishes to `affable-panda-681`. It
takes about two and a half minutes and adds any new index the schema
declares. Then prove it:

```bash
node scripts/verify-deployment.mjs https://affable-panda-681.convex.cloud
```

Every function in the source must be on the deployment, or the check fails.
There is a second, unused deployment — ignore it.

**Web.** A push to `main` deploys to `https://smartbuz.vercel.app` through
Vercel. The **Redeploy** button on the Vercel dashboard needs a 6-digit
authenticator code from the owner; a git push does not. The Vercel CLI is
logged out, so the dashboard is the way in.

**A variable that is added or changed is not in the running application until
the application is rebuilt** — a deployment keeps the environment it was built
with, and a `NEXT_PUBLIC_` variable is inlined into the bundle at build time.
Either redeploy from the dashboard (2FA), or push a commit, which builds a new
deployment carrying the new variables and needs no authenticator code. See
§5.2.

**Order.** Backend first, then the web app. The web app talks to the backend,
and a web build that lands before the backend it expects will serve a client
that calls functions that are not there yet.

**After releasing:**

```bash
curl -s https://smartbuz.vercel.app/api/health
# {"status":"ok",...,"missingVariables":[]}
```

`/auth/login`, `/auth/register`, `/auth/forgot-password` and
`/auth/reset-password` must all answer 200. `/` and `/setup` must answer
**307** — the unauthenticated redirect is the correct answer, not a failure.

The network from this machine is flaky: DNS failures on github.com, Vercel
and Convex are common and are not a real outage. Retry. `git push` needs a
retry loop.

---

## 7 · Where things live

| | |
|---|---|
| `convex/schema.ts` | 94 tables, 290 indexes. The source of truth for the data model. |
| `convex/financeCore.ts` | Where money is calculated. One place, on purpose. |
| `convex/salesCore.ts` | Where a sale is applied: pricing, stock, cost, idempotency. |
| `convex/tenancy.ts`, `convex/rbac.ts`, `convex/entitlements.ts` | The tenant, the role, the gate. |
| `convex/audit.ts` | The audit trail, with `scope` on each row. |
| `convex/verticals/` | batches, members, operations, scheduling, tax. |
| `convex/packages/` | restaurant, supermarket, pharmacy, wholesaler, manage, registry. |
| `convex/integrations/` | the adapter layer, providers, webhooks, reconciliation, payment repair. |
| `src/context/session-context.tsx` | The session. No Convex in it — this is what keeps the Convex client out of the public routes. |
| `src/context/auth-context.tsx` | The auth context. Needs `users.me`, so it is mounted only on authenticated routes. |
| `src/app/(dashboard)/layout.tsx` | Where the Convex client and the auth provider are mounted. |
| `src/lib/public-auth.ts`, `src/lib/convex-server.ts` | The server-side path for register, verify and reset. |
| `src/lib/offline/` | The offline engine: catalogue, device, network, queue, session cache, sync. |
| `src/app/api/auth/*/route.ts` | The public auth routes. The verification code never reaches the browser. |
| `tests/helpers/fake-context.ts` | The fake Convex context. `callHandler(registered, ctx, args)` is how a registered function is called. |
| `scripts/` | The instruments. `check-ledger-reads`, `check-bounded-reads`, `check-public-bundle`, `check-workflows`, `check-live-health`, `lint-baseline`, `measure-bundle`, `verify-deployment`, `verify-identity`, `validate-config`. |
| `docs/RUNBOOK.md` | Release, rollback, key rotation, and the rules above in the operational voice. |
| `docs/QA/17_BUG_REGISTER.md` | The register. §0 is the current status; §2–§6 are the audit's findings. |
| `.github/workflows/health-check.yml` | Polls the live application every 30 minutes. The watcher that was missing on 23 Nov 2026. |
| `.scratch/` | Working files. Gitignored. Not a deliverable. |

**Two things worth knowing about the code.** Convex's `query()` and
`mutation()` return a `RegisteredQuery` — not callable per TypeScript, though
calling works at runtime with a console warning; use the repository's
`callHandler` pattern. And a dynamic choice of index needs the codebase's
`let query;` evolving-any pattern, because a typed `let query =
ctx.db.query(...)` breaks on `.withIndex()`.

---

## 8 · How to start

Read `docs/QA/17_BUG_REGISTER.md` §0, then run the gates in §3. Whatever the
gates say is the truth, whatever any document says. Take the first item in §5
that is not done, and do it the way the last person would have: change what
the server will accept rather than documenting what it should not, and leave
the instrument that proves it.
