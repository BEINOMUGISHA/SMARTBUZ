/**
 * SMARTBUZ Convex Auth Helpers
 *
 * FIX #4: Server-side role verification for Convex mutations.
 *
 * Usage in any mutation:
 *   const admin = await requireAdmin(ctx, args.adminUserId);
 *   // throws ConvexError if the caller is not an admin
 *
 *   const caller = await requireAuth(ctx, args.userId);
 *   // throws ConvexError if the userId does not exist
 */

import { MutationCtx, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { ConvexError } from "convex/values";

/**
 * Assert that a userId exists and has the "admin" role.
 * Throws ConvexError (visible to the client) if not.
 * Returns the full admin user document for convenience.
 */
export async function requireAdmin(
  ctx: MutationCtx | QueryCtx,
  adminUserId: Id<"users">
) {
  const user = await ctx.db.get(adminUserId);
  if (!user) {
    throw new ConvexError("Unauthorized: user not found.");
  }
  if (!user.roles.includes("admin")) {
    throw new ConvexError(
      "Forbidden: this action requires administrator privileges."
    );
  }
  return user;
}

/**
 * Assert that a userId exists (any role).
 * Throws ConvexError if not found.
 */
export async function requireAuth(
  ctx: MutationCtx | QueryCtx,
  userId: Id<"users">
) {
  const user = await ctx.db.get(userId);
  if (!user) {
    throw new ConvexError("Unauthorized: user session is invalid.");
  }
  return user;
}

/**
 * Assert that the caller owns the resource OR is an admin.
 * Useful for "edit your own profile" type mutations.
 */
export async function requireSelfOrAdmin(
  ctx: MutationCtx | QueryCtx,
  callerId: Id<"users">,
  targetId: Id<"users">
) {
  const caller = await ctx.db.get(callerId);
  if (!caller) {
    throw new ConvexError("Unauthorized: user session is invalid.");
  }
  if (callerId !== targetId && !caller.roles.includes("admin")) {
    throw new ConvexError(
      "Forbidden: you can only modify your own account unless you are an administrator."
    );
  }
  return caller;
}
