import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("categories").collect();
    },
});

export const add = mutation({
    args: {
        type: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { userId, ...categoryArgs } = args;
        const categoryId = await ctx.db.insert("categories", categoryArgs);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Add Category",
            details: `Added new category: ${args.type}`,
            timestamp: new Date().toISOString(),
        });

        return categoryId;
    },
});

export const remove = mutation({
    args: {
        id: v.id("categories"),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const category = await ctx.db.get(args.id);
        if (!category) throw new Error("Category not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Delete Category",
            details: `Deleted category: ${category.type}`,
            timestamp: new Date().toISOString(),
        });
    },
});

export const update = mutation({
    args: {
        id: v.id("categories"),
        type: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { id, userId, ...rest } = args;
        const category = await ctx.db.get(id);
        if (!category) throw new Error("Category not found");

        await ctx.db.patch(id, rest);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Update Category",
            details: `Updated category from '${category.type}' to '${args.type}'`,
            timestamp: new Date().toISOString(),
        });
    },
});
