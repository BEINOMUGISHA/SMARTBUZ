/**
 * SMARTBUZ — authorization helpers.
 *
 * The helpers in this file answer "may this caller do this?" using the
 * caller's verified identity and their membership in the tenant.
 *
 * The previous implementation took the identity as an argument:
 *
 *     const admin = await requireAdmin(ctx, args.adminUserId);
 *
 * `adminUserId` arrived from the browser, so it proved nothing — any
 * caller could pass a real admin's id and become that admin (AUDIT.md
 * §2.2). `users.listAll` was a public query that handed out exactly those
 * ids.
 *
 * The identity now comes from `ctx.auth.getUserIdentity()`, which the
 * Convex backend verifies against the deployment's own JWKS. There is no
 * way to pass someone else's identity in.
 */

import { ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
  type BusinessId,
  type TenantContext,
  findMembership,
  listUserMemberships,
  normalizeBusinessRole,
  requireIdentity,
  requireMembership,
  requirePermission,
  requireRole,
  requireTenant,
  requireUser,
  resolveBusinessId,
} from "./tenancy";

export {
  requireIdentity,
  requireMembership,
  requirePermission,
  requireRole,
  requireTenant,
  requireUser,
  resolveBusinessId,
  listUserMemberships,
  normalizeBusinessRole,
};

export type { BusinessId, TenantContext };

/**
 * Assert the caller administers the tenant (owner or business administrator).
 *
 * The tenant is the caller's active business unless `businessId` is given,
 * in which case the caller must be a member of *that* business.
 */
export async function requireAdmin(
  ctx: MutationCtx | QueryCtx,
  businessId?: BusinessId
): Promise<{ user: Doc<"users">; membership: Doc<"memberships">; businessId: BusinessId }> {
  const tenant = await requireTenant(ctx, businessId);
  const role = normalizeBusinessRole(tenant.membership.role);
  if (role !== "business_owner" && role !== "business_admin") {
    throw new ConvexError(
      "Forbidden: this action requires administrator privileges in this business."
    );
  }
  return { user: tenant.user, membership: tenant.membership, businessId: tenant.businessId };
}

/**
 * Assert the caller may act on `targetUserId`.
 *
 * A user may always act on themselves. Acting on somebody else requires
 * being an administrator of a business that the target also belongs to —
 * so an admin of Business A cannot edit a user who only belongs to
 * Business B.
 */
export async function requireSelfOrAdmin(
  ctx: MutationCtx | QueryCtx,
  targetUserId: Id<"users">
): Promise<{ user: Doc<"users">; businessId: BusinessId }> {
  const caller = await requireUser(ctx);

  if (caller._id === targetUserId) {
    const businessId = await resolveBusinessId(ctx);
    return { user: caller, businessId };
  }

  const memberships = await listUserMemberships(ctx, caller._id);
  const adminMemberships = memberships.filter((m) => {
    const role = normalizeBusinessRole(m.role);
    return role === "business_owner" || role === "business_admin";
  });

  for (const membership of adminMemberships) {
    const targetMembership = await findMembership(ctx, targetUserId, membership.businessId);
    if (targetMembership) {
      return { user: caller, businessId: membership.businessId };
    }
  }

  throw new ConvexError(
    "Forbidden: you can only modify your own account unless you administer the same business."
  );
}

/**
 * Assert that the caller has the given permission in the tenant.
 * Thin wrapper so handlers read as one line.
 */
export async function requireCan(
  ctx: MutationCtx | QueryCtx,
  permission: Parameters<typeof requirePermission>[2],
  businessId?: BusinessId
): Promise<TenantContext> {
  const tenant = await requireTenant(ctx, businessId);
  await requirePermission(ctx, tenant.businessId, permission);
  return tenant;
}
