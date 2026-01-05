import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("banking").order("desc").paginate(args.paginationOpts);
    },
});

export const update = mutation({
    args: {
        id: v.id("banking"),
        date: v.optional(v.string()),
        amount: v.optional(v.number()),
        comment: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

export const remove = mutation({
    args: { id: v.id("banking") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
