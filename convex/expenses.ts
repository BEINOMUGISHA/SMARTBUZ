import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("expenses").order("desc").paginate(args.paginationOpts);
    },
});

export const add = mutation({
    args: {
        amount: v.number(),
        expense: v.string(),
        receivedBy: v.string(),
        type: v.string(),
        date: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("expenses", args);
    },
});

export const remove = mutation({
    args: { id: v.id("expenses") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
