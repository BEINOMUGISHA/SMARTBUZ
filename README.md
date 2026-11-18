# SMART_BUZ

Point of sale and business management for multi-branch retail and service
businesses. Next.js 16 (App Router, Turbopack) on the front end, Convex on
the back end.

## Multi-tenancy (Phase 1)

Every business is a tenant. A user may belong to several businesses and works
in one of them at a time; the server decides which, from a signed access
token — never from an argument the browser sends.

| Concept | Table | Notes |
| --- | --- | --- |
| The tenant | `businesses` | Name, vertical, currency, timezone, tax settings, plan |
| Membership | `memberships` | A user in a business, with a role: business_owner, business_admin, branch_manager, supervisor, cashier, inventory_manager, accountant, salesperson, auditor |
| People | `employees` | Staff records inside a business |
| Sales points | `branches`, `shops` | `branches` is the first-class model; `shops` are the legacy counters linked to a branch |
| Storage | `warehouses` | Where stock lives, per business |

Every tenant-owned table carries `businessId` and is indexed by it, so a
query can never scan across businesses.

Documentation:

- [`convex/TENANCY-GUIDE.md`](convex/TENANCY-GUIDE.md) — the model, the
  roles and permissions, and how to write a tenant-safe function.
- [`docs/MULTITENANCY-MIGRATION.md`](docs/MULTITENANCY-MIGRATION.md) — how to
  move a single-tenant deployment across without losing a record.

### Verifying it

```bash
node scripts/verify-identity.mjs        # the backend really authenticates callers
node scripts/tenant-isolation-e2e.mjs   # business A cannot see business B
node scripts/verify-migration.mjs --email <operator> --password '<password>'
powershell -File scripts/app-smoke-test.ps1   # the app itself still works
```

## Authentication and access control (Phase 2)

Eleven roles — two platform, nine business — over eighteen permissions, all
enforced on the backend.

| Concept | Where it lives | Notes |
| --- | --- | --- |
| The catalogue | `convex/rbac.ts` | Roles, permissions and the grant matrix. Pure, so the UI and the backend cannot drift apart |
| The guards | `convex/tenancy.ts` | `requirePermission`, `requireBranchAccess`, `requirePlatformRole` |
| Platform admin | `convex/platform.ts` | Tenants, plans, subscriptions, other administrators |
| Security trail | `convex/audit.ts` | Append-only, tenant-scoped |
| Sessions | `sessions` table | Every sign-in is revocable; a revoked token stops working at once |
| Verification | `emailVerifications` table | A new account cannot sign in until its address is proven |
| Custom grants | `customRolePermissions`, `memberPermissionOverrides` | Per business, never able to exceed the granter's own authority |

Documentation:

- [`docs/AUTH-RBAC.md`](docs/AUTH-RBAC.md) — the roles, the permission
  matrix, how enforcement works, and how to extend it.

### Verifying it

```bash
npm test                  # the permission matrix, the guards and the acceptance criteria
npm run test:acceptance   # just the three acceptance criteria
```

The tests run against the real backend modules with an in-memory Convex
context — no deployment needed.

### First platform administrator

Platform administration needs a platform role, so the very first one is
bootstrapped. It works only while the platform has no administrator at all:

```bash
SMARTBUZ_SERVER_SECRET=... node scripts/bootstrap-platform-admin.mjs --email you@example.com
```

See [`docs/AUTH-RBAC.md`](docs/AUTH-RBAC.md) for the rest.

---

## Finance and business intelligence (Phase 5)

Every financial figure is derived from the authoritative transaction and
ledger records. There are no sample numbers anywhere in the production path.

| Concept | Where it lives | Notes |
| --- | --- | --- |
| The calculation core | `convex/financeCore.ts` | One place that decides what a day, a week and a month are, and what a sale cost |
| Cash drawer and shifts | `convex/finance.ts` | Opening float, cash in and out, close-off variance, reconciliation |
| The reporting suite | `convex/analytics.ts` | Daily/weekly/monthly sales, profit and loss, best sellers, slow movers, stock valuation, sales by cashier and by branch, payment methods, customer and supplier debt ageing |
| The daily dashboard | `convex/dashboard.ts` | Today in the business's own timezone, with a 14-day chart, best sellers, low stock and recent transactions |
| Exports | `src/lib/export.ts` | CSV, Excel and PDF, all generated on the server's own figures |

The cost of a sale is resolved by a cascade, in order: the recorded cost
history for that stock, then the book value carried on the sale, then the
purchase price on the stock record. A business that buys the same product
twice at different prices gets the right cost for each.

Documentation: [`docs/FINANCE-BI.md`](docs/FINANCE-BI.md).

---

## Licensing and subscriptions (Phase 6)

SMARTBUZ is a SaaS platform. A business buys a plan, the plan decides what it
may use, and the platform owner runs the whole thing from a console.

| Concept | Where it lives | Notes |
| --- | --- | --- |
| The catalogue | `convex/plans.ts` | Starter, Business, Professional, Enterprise. Pricing is data, not code |
| The states | `convex/subscriptionState.ts` | Trial, active, past due, grace, suspended, expired, cancelled — computed from the dates, so nothing lapses silently |
| The guards | `convex/entitlements.ts` | Feature entitlements and usage limits, both enforced on the server |
| The write gate | `convex/tenancy.ts` | `requirePermission` is the one point every mutation passes through, so no function can forget to be protected |
| Payments | `convex/billing.ts` | Pending → verified. The amount is computed from the plan, and the same provider reference cannot be claimed twice |
| License keys | `convex/license.ts` | `SBUZ-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX`, shown once, stored only as an HMAC-SHA256 hash |
| Devices | `convex/subscriptions.ts` | Registration and the plan's device limit |
| The console | `src/app/(dashboard)/platform/page.tsx` | Plans, subscriptions, payments and keys — platform administrators only |

Two rules the engine never breaks:

- **Nothing is deleted when a subscription ends.** No sales, stock, customers
  or reports are removed, and no subscription row is deleted. The business
  keeps the right to read its own data and its own invoice; it loses the
  right to record anything new.
- **There is no client-side license check.** The browser is told nothing it
  can act on. A feature the plan does not include is refused by the server
  even when the request is made by hand.

Documentation: [`docs/LICENSING.md`](docs/LICENSING.md).

### Verifying it

```bash
npm test                  # the whole suite: permissions, finance, subscriptions
```

---

### Local setup

```bash
npm install
node scripts/generate-auth-keys.mjs   # prints the JWKS + SMARTBUZ_JWT_PRIVATE_KEY
npx convex dev                        # deploy the functions
npm run dev                           # start the app
```

`SMARTBUZ_JWT_PRIVATE_KEY` and `SESSION_SECRET` go in `.env.local`; see
`.env.example`. The backend publishes its own public key at
`<deployment>.convex.site/auth/jwks`.

---

npx tsc --noEmit --project tsconfig.json


Stock Reports:
-in here first of all we will add the supplier in stock creation and in re stocking we add the field of the supplie so that we know from where and in re stocking we have differeent supplier so we have to keep that record,  
-then when issuing stock to the shop its important to keep those records we want to know what we issued to a shop on a specific date
HP Sales: 
I'll add "Phone" and "Location" fields  for HP client salesand regular client sales and they shouldbe optional. include this in reciept
Product Swapping: 
-I'll implement a new feature to handle product exchanges.
we should add the product swapping tab in the shop sales where when you give us the product  we will know the quantity and and increase that product qtyand we willbe knowing te product through product code and we will be knowing the shop through shop id but you can know through capturing the shopthat is opened i dont need to tell it to you, then after he product qty will increase and the taken decrease, then lookfor a way toinclude that in my sales reports there in sales
make a reciept for this
promotions:
-as we arleady implemented it we will add in this the configuring of the promotions that capture the whole  products like we have a promotion if you buy from us and in the reciept you add up all the bv and it reaches 100 you win something so our config should choose bv or pv and tell the qty to trigure it  so that we capture it when saling products and this is trigure in the whole sale reciept when you add it up and ofcose include that even n our promotion tab and we shouldhave the filters for daily audit and date range as we had in the my sales report include this in the reciept
A5 Printing: I'll optimize all printouts (receipts and reports) to fit perfectly on A5 paper.
