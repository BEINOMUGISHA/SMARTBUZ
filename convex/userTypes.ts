import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requirePermission, requireTenant } from "./tenancy";

/**
 * SMART_BUZ — role vocabulary.
 *
 * These are the legacy global role names ("admin", "sales", "stock",
 * "settings", "reports"). They remain a shared vocabulary, but the
 * functions that change them are administrator-only and every action is
 * written to the administrator's own audit trail.
 */
export const get = query({
    args: {
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.view");
        return await ctx.db.query("userTypes").collect();
    },
});

export const add = mutation({
    args: {
        type: v.string(),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");

        const existing = await ctx.db
            .query("userTypes")
            .filter((q) => q.eq(q.field("type"), args.type))
            .unique();
        if (existing) throw new ConvexError("User type already exists");
        const userTypeId = await ctx.db.insert("userTypes", { type: args.type });

        // Log activity
        await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            userId: tenant.user._id,
            action: "Add User Type",
            details: `Added new user type: ${args.type}`,
            timestamp: new Date().toISOString(),
        });

        return userTypeId;
    },
});

export const remove = mutation({
    args: {
        id: v.id("userTypes"),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");

        const userType = await ctx.db.get(args.id);
        if (!userType) throw new ConvexError("User type not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            userId: tenant.user._id,
            action: "Delete User Type",
            details: `Deleted user type: ${userType.type}`,
            timestamp: new Date().toISOString(),
        });
    },
});
