import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("shops").order("desc").paginate(args.paginationOpts);
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        serialNumber: v.string(),
        location: v.string(),
        contact: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("shops", {
            ...args,
            issuedStocks: [],
        });
    },
});

export const issueStock = mutation({
    args: {
        shopId: v.id("shops"),
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            qty: v.number(),
            price: v.number(),
            productCode: v.string(),
            pv: v.number(),
            bv: v.number(),
            halfPrice: v.boolean(),
        })),
    },
    handler: async (ctx, args) => {
        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

        // Merge or replace depending on business need - original logic seems to append
        const updatedStock = [...shop.issuedStocks, ...args.items];
        await ctx.db.patch(args.shopId, { issuedStocks: updatedStock });
    },
});

export const removeStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
    },
    handler: async (ctx, args) => {
        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

        const updatedStock = shop.issuedStocks.filter(s => s.stockId !== args.stockId);
        await ctx.db.patch(args.shopId, { issuedStocks: updatedStock });
    },
});

export const clearStocks = mutation({
    args: { shopId: v.id("shops") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.shopId, { issuedStocks: [] });
    },
});
