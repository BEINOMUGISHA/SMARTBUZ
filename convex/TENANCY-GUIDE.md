# SMARTBUZ — tenancy implementation guide

How every Convex query, mutation and action must be written after the
multi-tenant change. Read this before touching a backend module.

## The model

* A **business** is the tenant. It lives in the `businesses` table.
* A **user** may belong to many businesses. Each membership is a row in
  `memberships` with a `role` and a `status`.
* Every tenant-owned row carries `businessId` and is indexed by it.
* The tenant for a request is resolved from the caller's **membership**,
  never from a business id the browser asked for.

## The identity

`ctx.auth.getUserIdentity()` returns the verified caller. It is populated
from the RS256 access token the Next.js server mints and the deployment
verifies against `/auth/jwks`. There is no way for a caller to present
somebody else's identity.

**Never accept an identity as an argument.** If a function currently takes
`userId` or `adminUserId`, the server must ignore it and use the verified
caller instead. Keep the argument in the validator (so existing frontend
call sites keep working) but mark it deprecated and do not read it.

```ts
// ✗ trust the client
const admin = await ctx.db.get(args.adminUserId);
if (!admin.roles.includes("admin")) throw new Error("Forbidden");

// ✓ derive the caller
const tenant = await requireTenant(ctx);
if (tenant.membership.role !== "business_owner" && tenant.membership.role !== "business_admin") {
  throw new ConvexError("Forbidden: ...");
}
```

## The helpers (`convex/tenancy.ts`)

```ts
import {
  requireTenant,        // → { user, membership, business, businessId, permissions }
  requirePermission,    // (ctx, businessId, "products.create")
  requireUser,          // → the caller's users document
  requireMembership,    // (ctx, businessId) → membership or "Forbidden"
  requireBranchAccess,  // (ctx, membership, branchId) → "Forbidden" for a branch manager
  requirePlatformRole,  // (ctx, roles) → platform administrators only
  logActivity,          // (ctx, businessId, userId, action, details)
} from "./tenancy";
```

`requireTenant(ctx, args.businessId)` is the entry point for almost every
handler:

* if `args.businessId` is given, the caller must be an active member of
  it — otherwise **"Forbidden"** (never a silent fall-back to another
  tenant);
* otherwise the caller's active business is used, falling back to their
  only active membership;
* if the caller belongs to several businesses and has not chosen one, it
  throws "No business selected" — the UI shows the business switcher.

## Rules per handler

1. **Start with the tenant.**

   ```ts
   const tenant = await requireTenant(ctx, args.businessId);
   const businessId = tenant.businessId;
   ```

2. **Read only your own rows.** Prefer the tenant index:

   ```ts
   const rows = await ctx.db
     .query("sales")
     .withIndex("by_businessId_date", (q) =>
       q.eq("businessId", businessId).gte("date", start))
     .collect();
   ```

   For tables with only `by_businessId`, use that. For tables without a
   `businessId` (there are none left except `users`, `userTypes`,
   `passwordResets`), scope by the owning business explicitly.

3. **Never read a document by id without checking it.**

   ```ts
   const sale = await ctx.db.get(args.id);
   if (!sale || sale.businessId !== businessId) {
     throw new ConvexError("Forbidden: that record belongs to another business.");
   }
   ```

4. **Validate every referenced id.** A `stockId`, `customerId`, `shopId`,
   `memberId` … that came from the browser must belong to the same
   business, otherwise throw "Forbidden".

5. **Write the tenant on every insert.**

   ```ts
   await ctx.db.insert("sales", { businessId, /* … */ });
   ```

6. **Attribute activity to the caller.**

   ```ts
   await ctx.db.insert("activityLogs", {
     businessId,
     userId: tenant.user._id,
     action: "Create Sale",
     details: "…",
     timestamp: new Date().toISOString(),
   });
   ```

7. **Guard privileged actions with a permission.**

   ```ts
   await requirePermission(ctx, businessId, "products.create");
   ```

   The canonical permissions are the eighteen listed in
   `convex/rbac.ts`:

   `sales.view|create|cancel|refund`, `products.view|create|update`,
   `inventory.view|adjust|transfer`, `customers.manage`, `suppliers.manage`,
   `finance.view|expenses.create|reports.view`, `employees.manage`,
   `branches.manage`, `subscriptions.manage`.

   Older, finer-grained names still work and are derived from those:
   `business.view|update|settings|transferOwnership`, `members.view|manage`,
   `branches.view`, `warehouses.view|manage`, `employees.view`,
   `products.manage`, `sales.void|discount`, `stock.manage`,
   `customers.view`, `loans.view|manage`, `reports.view|financial`,
   `settings.manage`.

   Prefer the canonical names in new code. The role → permission map lives in
   `ROLE_CANONICAL_PERMISSIONS` in `convex/rbac.ts` — see
   `docs/AUTH-RBAC.md` for the full matrix.

8. **Guard branch-scoped actions.**

   ```ts
   await requireBranchAccess(ctx, tenant.membership, branchId);
   ```

   A branch manager is confined to the branches they are assigned to.

9. **Keep the public surface small.** Only these may run without an
   identity: `users.register`, `users.login`, `users.verifyEmail`,
   `users.requestVerification`, `users.requestPasswordReset`,
   `users.resetPassword`, and `businesses.register`. Everything else must
   call `requireTenant` (or `requireUser`) first.

10. **Record the privileged actions.**

   ```ts
   await writeAudit(ctx, {
     businessId,
     actorUserId: tenant.user._id,
     actorRole: tenant.membership.role,
     action: "rbac.role.change",
     targetType: "membership",
     targetId: membership._id,
     metadata: { from: oldRole, to: newRole },
   });
   ```

   The trail is append-only and tenant-scoped. Use it for anything that
   changes who can do what, not for ordinary business events.

## Things that must not change

* The exported function names — the frontend calls them by name.
* The argument names the frontend already sends. New arguments must be
  optional and additive.
* The shape of the data returned, unless a tenant field has to be added.

## Gotchas

* `ctx.db.get()` with an id from another table throws — wrap it in
  `try/catch` when the id may come from the browser.
* `ctx.db.query("x").collect()` without a tenant filter is a data leak.
  Every one of them must go.
* `counters` is now indexed by `by_businessId_name` — invoice numbers are
  per business.
* `stocks.productCode` is unique **per business**
  (`by_businessId_productCode`), not globally.
* `categories` are per business too.
* `businessProfileId` on the vertical tables is deprecated: the tenant
  field is `businessId`. Write `businessId`; leave the legacy field alone.
