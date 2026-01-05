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
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("categories", {
            type: args.type,
        });
    },
});

export const remove = mutation({
    args: {
        id: v.id("categories"),
    },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

export const update = mutation({
    args: {
        id: v.id("categories"),
        type: v.string(),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.id, {
            type: args.type,
        });
    },
});
