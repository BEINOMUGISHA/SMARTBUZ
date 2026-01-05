import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("packages").order("desc").paginate(args.paginationOpts);
    },
});

export const add = mutation({
    args: {
        name: v.string(),
        amount: v.number(),
        bv: v.number(),
        pv: v.number(),
        registrationFee: v.number(),
        isPaid: v.boolean(),
        distributorId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("packages", args);
    },
});
