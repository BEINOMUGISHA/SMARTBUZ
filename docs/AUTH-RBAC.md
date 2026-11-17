# SMARTBUZ — Authentication, Roles and Permissions (Phase 2)

This document describes the Phase 2 access-control model: the eleven roles,
the eighteen permissions, how they are enforced on the backend, and how to
extend them safely.

> **The one rule that matters:** the interface decides what to *show*. The
> backend decides what to *allow*. A tampered client that calls a mutation it
> has no permission for gets a `Forbidden` error — never a result.

---

## 1. Where things live

| File | What it holds |
| --- | --- |
| `convex/rbac.ts` | The catalogue: roles, permissions, the grant matrix. Pure — no database, no Convex runtime. |
| `convex/tenancy.ts` | The guards: `requireUser`, `requirePermission`, `requireBranchAccess`, `requirePlatformRole`. |
| `convex/platform.ts` | Platform administration — tenants, plans, other administrators. |
| `convex/audit.ts` | The security audit trail (append-only). |
| `convex/users.ts` | Registration, verification, sign-in, password recovery, sessions. |
| `convex/serverSecret.ts` | The shared secret that gates server-only operations. |
| `src/lib/permissions.ts` | Interface helpers. Mirrors the catalogue; enforces nothing. |
| `tests/` | The automated permission tests. |

---

## 2. Roles

There are eleven roles, in two scopes.

### Platform scope

A platform role is **global** — it is not a membership in a business. It
lives in the `platformAdmins` table and is granted only by another platform
super administrator.

| Role | What it is for |
| --- | --- |
| `platform_super_admin` | Full control of the platform: tenants, plans, subscriptions, other administrators. |
| `platform_support` | Read-only access across every tenant for diagnosing customer issues. |

### Business scope

A business role lives on the **membership** row, not on the user. The same
person can be a `business_owner` in one business and a `cashier` in another.

| Role | What it is for |
| --- | --- |
| `business_owner` | Owns the business. Exactly one per business. |
| `business_admin` | Runs the business day to day: staff, branches, catalogue, finance. |
| `branch_manager` | Runs one or more branches — confined to the branches they are assigned to. |
| `supervisor` | Oversees counters and staff. Can cancel and refund sales raised by others. |
| `cashier` | Works the till. No accounting access. |
| `inventory_manager` | Owns the catalogue and stock: products, adjustments, transfers, suppliers. |
| `accountant` | Owns the books: finance visibility, expense capture, financial reporting. |
| `salesperson` | Sells on the road. Creates sales and manages their own customers. |
| `auditor` | Read-only oversight. Sees everything, changes nothing. |

The old six-role vocabulary (`owner`, `admin`, `manager`, `cashier`, `stock`,
`viewer`) is mapped onto these automatically by `LEGACY_ROLE_MAP`, so rows
that already exist in the database keep working:

| Legacy | Phase 2 |
| --- | --- |
| `owner` | `business_owner` |
| `admin` | `business_admin` |
| `manager` | `branch_manager` |
| `cashier` | `cashier` |
| `stock` | `inventory_manager` |
| `viewer` | `auditor` |

Anything unrecognised becomes `auditor` — the read-only role. An unknown
value can never widen access.

---

## 3. Permissions

Eighteen canonical permissions:

| Permission | Allows |
| --- | --- |
| `sales.view` | Read sales, invoices, receipts. |
| `sales.create` | Ring up a sale at the till. |
| `sales.cancel` | Void a completed sale and return the stock. |
| `sales.refund` | Issue a refund against a completed sale. |
| `products.view` | Read the catalogue and prices. |
| `products.create` | Add new products. |
| `products.update` | Edit product details and prices. |
| `inventory.view` | Read stock levels and warehouses. |
| `inventory.adjust` | Correct stock levels and record adjustments. |
| `inventory.transfer` | Move stock between branches and warehouses. |
| `customers.manage` | Create and edit customer records. |
| `suppliers.manage` | Create and edit suppliers and purchase orders. |
| `finance.view` | Read financial figures — margins, ledgers, profitability. |
| `finance.expenses.create` | Record and amend expenses. |
| `finance.reports.view` | Run and export the reporting suite. |
| `employees.manage` | Add, edit and remove staff records and assignments. |
| `branches.manage` | Create, edit and retire branches. |
| `subscriptions.manage` | Change a business's plan, status and billing dates. |

### The grant matrix

| Permission | Super Admin | Support | Owner | Admin | Branch Mgr | Supervisor | Cashier | Inventory Mgr | Accountant | Salesperson | Auditor |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `sales.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `sales.create` | ● | | ● | ● | ● | | ● | | | ● | |
| `sales.cancel` | ● | | ● | ● | ● | ● | | | | | |
| `sales.refund` | ● | | ● | ● | | ● | | | | | |
| `products.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `products.create` | ● | | ● | ● | | | | ● | | | |
| `products.update` | ● | | ● | ● | | ● | | ● | | | |
| `inventory.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `inventory.adjust` | ● | | ● | ● | ● | ● | | ● | | | |
| `inventory.transfer` | ● | | ● | ● | ● | | | ● | | | |
| `customers.manage` | ● | | ● | ● | ● | ● | ● | | ● | ● | |
| `suppliers.manage` | ● | | ● | ● | | | | ● | | | |
| `finance.view` | ● | ● | ● | ● | | | | | ● | | ● |
| `finance.expenses.create` | ● | | ● | ● | | | | | ● | | |
| `finance.reports.view` | ● | ● | ● | ● | | | | | ● | | ● |
| `employees.manage` | ● | | ● | ● | ● | | | | | | |
| `branches.manage` | ● | | ● | ● | | | | | | | |
| `subscriptions.manage` | ● | | | | | | | | | | | |

`●` = granted. The table is asserted verbatim by `tests/permissions.test.ts`,
so adding a permission forces a decision for every role instead of silently
widening everyone's access.

### Legacy permissions

Existing handlers still use the older, finer-grained names (`stock.manage`,
`reports.financial`, `settings.manage`, `members.manage`, …). These are not
a second source of truth: each declares which canonical permission it is
equivalent to, and a role holds the legacy name exactly when it holds those
canonical ones.

```ts
"stock.manage"      ≡ "inventory.adjust"
"sales.void"        ≡ "sales.cancel"
"products.manage"   ≡ "products.create" + "products.update"
"members.manage"    ≡ "employees.manage"
"reports.financial" ≡ "finance.view"
"reports.view"      ≡ "finance.reports.view"
"warehouses.view"   ≡ "inventory.view"
"warehouses.manage" ≡ "inventory.transfer"
```

Legacy-only permissions (`business.settings`, `loans.manage`,
`sales.discount`, `settings.manage`, …) have no canonical equivalent and are
granted explicitly per role in `ROLE_LEGACY_EXTRAS`.

New handlers should use the canonical names.

---

## 4. How enforcement works

### Identity

`ctx.auth.getUserIdentity()` is the only trustworthy statement of who is
calling. The document id comes from the signed token's subject — never from
a mutation argument. (The old implementation took `adminUserId` as an
argument and checked its `roles` array, which proved nothing, because the
browser chose the value. See `AUDIT.md` §2.2.)

### Tenant

The business is resolved from the caller's **membership**. A client may ask
for a specific business, but only one the caller actually belongs to.
Anything else is a hard `Forbidden` — never a silent fall-back to some other
tenant's data.

### The permission gate

Every handler calls one of:

```ts
const tenant = await requireTenant(ctx, args.businessId);
await requirePermission(ctx, tenant.businessId, "sales.create");
```

`requirePermission` resolves the caller's membership, computes their
effective permissions (role defaults → role-level custom grants →
member-level custom grants, with denials winning) and compares against the
requested permission.

### Branch restrictions

`requireBranchAccess(ctx, membership, branchId)` stops a branch manager
reaching a branch that is not theirs.

The allowed set is:

1. the membership's explicit `branchIds`, when it has any;
2. otherwise — **for branch-scoped roles only** — the branches whose
   `managerId` is that member;
3. otherwise every branch of the business.

A branch manager with no branches at all reaches none. They can never fall
back to "all branches".

### Platform operations

Platform administration lives in `convex/platform.ts`, apart from the
business modules, because the two have very different trust properties.

Every handler there starts with `requirePlatformRole` (read) or
`requirePlatformPermission(ctx, "subscriptions.manage")` (write). Business
membership never confers platform authority — owning a large business does
not make you a platform administrator.

`subscriptions.manage` is granted to `platform_super_admin` and to nobody
else, so it cannot be handed out inside a business. The last active super
administrator cannot be revoked, because there would be nobody left to
restore the platform.

### Bootstrapping the first administrator

Granting a platform role normally needs a platform role. The very first one
is bootstrapped:

```bash
SMARTBUZ_SERVER_SECRET=... node scripts/bootstrap-platform-admin.mjs --email you@example.com
```

`platform:bootstrapSuperAdmin` works **only** while the platform has no
active administrator at all, and only for a caller holding the server
secret. Once a super administrator exists it refuses — so it can never be
used to mint extra administrators.

Afterwards, administrators are granted from the platform console by
another super administrator (`platform:grantRole`).

---

## 5. Custom permissions

A business administrator may widen or narrow a role, and may do the same for
one member:

```ts
await setRolePermissions({ role: "supervisor", granted: ["sales.refund"] });
await setMemberPermissions({ userId, granted: ["inventory.adjust"] });
```

Rules:

- A grant can only include a permission the granting person **already
  holds**. That is what stops an administrator from escalating anybody —
  including themselves — past their own authority.
- A platform-only permission can never be granted inside a business.
- The business owner's permissions cannot be changed, and nobody may change
  their own.
- Denials win over grants.

Both tables are per-business: `customRolePermissions` and
`memberPermissionOverrides`.

---

## 6. Authentication

### Registration

`users.register` creates the account as `pending_verification`. It **ignores**
the `roles` argument — a client can no longer sign itself up as an
administrator. What somebody may do is decided by their membership in a
business.

### Account verification

A new account cannot sign in until its address is proven:

1. `users.register` stores a hash of a 6-digit code in `emailVerifications`.
2. The Next.js route `POST /api/auth/send-verification` asks the backend for
   the code **using the shared server secret** and emails it.
3. `users.verifyEmail` checks the code, marks the address verified and
   activates the account.

The code is single-use, expires after 24 hours and is attempt-capped. It
never reaches the browser — only the inbox. That is what stops anybody from
verifying an address they do not own.

### Password recovery

- The reset code is stored as a **bcrypt hash**, never in plain text.
- It is single-use (`usedAt`), expires after 1 hour and is attempt-capped
  at 5 attempts.
- A successful reset **revokes every session** for that account.
- `requestPasswordReset` always answers "success", whether or not the
  address is on file, so the endpoint cannot enumerate accounts.
- `changePassword` revokes every other session, keeping only the one that
  made the change.

### Sessions

Every sign-in creates a row in `sessions`:

- the browser holds an HttpOnly cookie with the session id and secret;
- the backend stores only the **SHA-256 hash** of the secret;
- the access token carries the session id (`sid`) and secret (`ses`) as
  claims.

`requireUser` checks that the session exists, belongs to the caller, has not
been revoked and has not expired, and that the secret matches the stored
hash. Signing out therefore stops the token **immediately**, rather than
letting it live out the remaining 15 minutes.

Users can list their sessions and revoke them from their profile
(`users.listSessions`, `users.revokeSession`, `users.revokeOtherSessions`).

---

## 7. Audit logging

`activityLogs` is the business-scoped feed of ordinary events. `auditLogs`
is the **security** trail, and it is append-only — no mutation in
`convex/audit.ts` edits or deletes a row.

Recorded: sign-ins, registrations, verification, password changes, session
start/end/revocation, role changes, custom permission changes, refunds, and
every platform action.

Metadata is redacted before it is written: passwords, codes, secrets, tokens
and hashes are replaced with `[redacted]`.

Reading it requires the owner, an administrator, an accountant or an
auditor — enforced by the backend, not by hiding the link.

---

## 8. Tests

```bash
npm test                  # everything
npm run test:acceptance   # the three acceptance criteria
npm run test:permissions  # the role × permission matrix
```

The tests run against the **real** backend modules using an in-memory
Convex context (`tests/helpers/fake-context.ts`). They do not re-implement
the rules: if a guard stops throwing, the tests fail.

| File | What it covers |
| --- | --- |
| `tests/permissions.test.ts` | The catalogue, the grant matrix, the aliases, role normalisation. |
| `tests/guards.test.ts` | `requirePermission`, custom grants and denials, branch restrictions, sessions, platform roles. |
| `tests/acceptance.test.ts` | The three acceptance criteria, as behaviour. |
| `tests/escalation.test.ts` | The real mutation handlers: nobody can grant themselves anything. |

The runner (`scripts/run-tests.mjs`) bundles the TypeScript with esbuild —
already present as a Next.js dependency — and runs it with Node's built-in
test runner. No new dependencies, no running deployment needed.

---

## 9. Adding a permission

1. Add it to `PERMISSION_DEFINITIONS` in `convex/rbac.ts`.
2. Decide, explicitly, what **every** role gets. The matrix test will fail
   until you do.
3. Add it to the `EXPECTED` table in `tests/permissions.test.ts`.
4. Use it in the handler with `requirePermission`.
5. If an existing legacy name now stands for it, add it to
   `LEGACY_PERMISSION_ALIASES`.

## 10. Adding a role

1. Add the id to `BUSINESS_ROLES` (or `PLATFORM_ROLES`).
2. Add a `RoleDefinition` to `ROLES`.
3. Add its canonical grants to `ROLE_CANONICAL_PERMISSIONS` and any
   legacy-only grants to `ROLE_LEGACY_EXTRAS`.
4. Add it to the `EXPECTED` table in `tests/permissions.test.ts`.

---

## 11. Environment

| Variable | Where | Why |
| --- | --- | --- |
| `SMARTBUZ_SERVER_SECRET` | Next.js **and** the Convex deployment | Gates session creation, reset codes and verification codes. Falls back to `RESEND_API_KEY`, then `SESSION_SECRET`. If none is set, those operations stay **closed** rather than opening to anyone. |
| `RESEND_API_KEY` | Next.js | Sends the reset and verification emails. |
| `RESEND_FROM_EMAIL` | Next.js | The sender address. |
| `SESSION_SECRET` | Next.js | Signs the session cookie. |

> The server secret must be at least 16 characters. Without it, `users.startSession`
> refuses to open sessions — set it on both sides before deploying.
