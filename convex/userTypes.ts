import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("userTypes").collect();
    },
});

export const add = mutation({
    args: { type: v.string() },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("userTypes")
            .filter((q) => q.eq(q.field("type"), args.type))
            .unique();
        if (existing) throw new Error("User type already exists");
        return await ctx.db.insert("userTypes", { type: args.type });
    },
});

export const remove = mutation({
    args: { id: v.id("userTypes") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
