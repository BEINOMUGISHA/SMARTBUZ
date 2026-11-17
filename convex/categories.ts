import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";

/**
 * SMARTBUZ — product categories.
 *
 * Categories belong to a business: two businesses may both have a
 * "Supplements" category without sharing the row, so renaming or deleting
 * one cannot affect the other.
 */
export const get = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        return await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();
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
        await requirePermission(ctx, tenant.businessId, "products.create");

        const categoryId = await ctx.db.insert("categories", {
            type: args.type,
            businessId: tenant.businessId,
        });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Add Category",
            `Added new category: ${args.type}`
        );

        return categoryId;
    },
});

export const remove = mutation({
    args: {
        id: v.id("categories"),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const category = await ctx.db.get(args.id);
        if (!category) throw new Error("Category not found");
        if (category.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that category belongs to another business.");
        }

        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Delete Category",
            `Deleted category: ${category.type}`
        );
    },
});

export const update = mutation({
    args: {
        id: v.id("categories"),
        type: v.string(),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const category = await ctx.db.get(args.id);
        if (!category) throw new Error("Category not found");
        if (category.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that category belongs to another business.");
        }

        await ctx.db.patch(args.id, { type: args.type });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Category",
            `Updated category from '${category.type}' to '${args.type}'`
        );
    },
});
