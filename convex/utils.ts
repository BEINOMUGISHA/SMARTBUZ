import { v } from "convex/values";
import { mutation, query, QueryCtx, MutationCtx } from "./_generated/server";

/**
 * Helper to check if a user has a specific role.
 * This assumes you pass the userId to the function.
 * In a real-world scenario with managed Auth, ctx.auth.getUserIdentity() would be used.
 */
export async function checkRole(ctx: QueryCtx | MutationCtx, userId: any, allowedRoles: string[]) {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("User not found");

    if ("roles" in user) {
        const roles = user.roles as string[];
        const hasRole = roles.some((role: string) => allowedRoles.includes(role));
        if (!hasRole) throw new Error("Unauthorized: Insufficient permissions");
    } else {
        throw new Error("Invalid user record: Missing roles");
    }

    return user;
}

// Example of a role-protected query wrapper or logic
// You can use this inside your handlers like:
// await checkRole(ctx, args.userId, ["admin"]);
