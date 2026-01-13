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

export const listAll = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("packages").order("desc").collect();
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("packages");
        let results = await q.order("desc").collect();

        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            results = results.filter(p => p.name.toLowerCase().includes(search));
        }

        const totalCount = results.length;
        const page = results.slice(args.offset, args.offset + args.limit);

        return { page, totalCount };
    },
});

export const update = mutation({
    args: {
        id: v.id("packages"),
        name: v.optional(v.string()),
        amount: v.optional(v.number()),
        bv: v.optional(v.number()),
        pv: v.optional(v.number()),
        registrationFee: v.optional(v.number()),
        isPaid: v.optional(v.boolean()),
        distributorId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

export const remove = mutation({
    args: { id: v.id("packages") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
