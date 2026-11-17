import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";

/**
 * SMARTBUZ — banking records (money in and out of the till).
 *
 * Tenant-scoped: a business only ever sees its own banking records.
 */
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        return await ctx.db
            .query("banking")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const update = mutation({
    args: {
        id: v.id("banking"),
        date: v.optional(v.string()),
        amount: v.optional(v.number()),
        comment: v.optional(v.string()),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        const banking = await ctx.db.get(args.id);
        if (!banking) throw new Error("Banking record not found");
        if (banking.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that banking record belongs to another business."
            );
        }

        const { id, userId, businessId, ...rest } = args;
        await ctx.db.patch(id, rest as any);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Banking Record",
            `Updated banking record - Changes: ${changes}`
        );
    },
});

export const remove = mutation({
    args: {
        id: v.id("banking"),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        const banking = await ctx.db.get(args.id);
        if (!banking) throw new Error("Banking record not found");
        if (banking.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that banking record belongs to another business."
            );
        }

        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Delete Banking Record",
            `Deleted banking record - Amount: ${banking.amount?.toLocaleString() || 'N/A'}, Comment: ${banking.comment || 'N/A'}`
        );
    },
});
