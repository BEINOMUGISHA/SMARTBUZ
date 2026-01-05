import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

// List stocks with pagination, search, and category filtering
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
    },
    handler: async (ctx, args) => {
        if (args.searchTerm) {
            return await ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!))
                .paginate(args.paginationOpts);
        }

        let stocksQuery = ctx.db.query("stocks");

        if (args.categoryId) {
            stocksQuery = stocksQuery.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
        }

        return await stocksQuery.order("desc").paginate(args.paginationOpts);
    },
});

// Get stock by product code
export const getByCode = query({
    args: { productCode: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("stocks")
            .withIndex("by_productCode", (q) => q.eq("productCode", args.productCode))
            .unique();
    },
});

// Add stock
export const add = mutation({
    args: {
        name: v.string(),
        productCode: v.string(),
        description: v.optional(v.string()),
        price: v.number(),
        purchasePrice: v.number(),
        qty: v.number(),
        pv: v.number(),
        bv: v.number(),
        categoryId: v.id("categories"),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("stocks", {
            ...args,
        });
    },
});

// Update stock
export const update = mutation({
    args: {
        id: v.id("stocks"),
        name: v.optional(v.string()),
        productCode: v.optional(v.string()),
        description: v.optional(v.string()),
        price: v.optional(v.number()),
        purchasePrice: v.optional(v.number()),
        qty: v.optional(v.number()),
        pv: v.optional(v.number()),
        bv: v.optional(v.number()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        const oldStock = await ctx.db.get(id);
        if (!oldStock) throw new Error("Stock not found");

        await ctx.db.patch(id, rest);

        // If price, pv, bv, or halfPrice changed, update all shops
        const priceChanged = rest.price !== undefined && rest.price !== oldStock.price;
        const halfPriceChanged = rest.halfPrice !== undefined && rest.halfPrice !== oldStock.halfPrice;

        if (priceChanged || halfPriceChanged || rest.pv !== undefined || rest.bv !== undefined) {
            const shops = await ctx.db.query("shops").collect();
            for (const shop of shops) {
                const issuedStocks = shop.issuedStocks.map(item => {
                    if (item.stockId === id) {
                        return {
                            ...item,
                            price: rest.price ?? item.price,
                            pv: rest.pv ?? item.pv,
                            bv: rest.bv ?? item.bv,
                            halfPrice: rest.halfPrice ?? item.halfPrice
                        };
                    }
                    return item;
                });
                await ctx.db.patch(shop._id, { issuedStocks });
            }
        }
    },
});

// Delete stock
export const remove = mutation({
    args: { id: v.id("stocks") },
    handler: async (ctx, args) => {
        // Remove from all shops first
        const shops = await ctx.db.query("shops").collect();
        for (const shop of shops) {
            const issuedStocks = shop.issuedStocks.filter(item => item.stockId !== args.id);
            if (issuedStocks.length !== shop.issuedStocks.length) {
                await ctx.db.patch(shop._id, { issuedStocks });
            }
        }
        await ctx.db.delete(args.id);
    },
});

// Restock logic (increment quantity)
export const restock = mutation({
    args: {
        id: v.id("stocks"),
        quantityToAdd: v.number(),
        price: v.number(),
        pv: v.number(),
        bv: v.number(),
        halfPrice: v.boolean(),
        date: v.string(),
    },
    handler: async (ctx, args) => {
        const stock = await ctx.db.get(args.id);
        if (!stock) throw new Error("Stock not found");

        await ctx.db.patch(args.id, {
            qty: stock.qty + args.quantityToAdd,
            price: args.price,
            pv: args.pv,
            bv: args.bv,
            halfPrice: args.halfPrice,
        });

        // Update shops as well for the price/pv/bv/halfPrice change
        const shops = await ctx.db.query("shops").collect();
        for (const shop of shops) {
            const issuedStocks = shop.issuedStocks.map(item => {
                if (item.stockId === args.id) {
                    return {
                        ...item,
                        price: args.price,
                        pv: args.pv,
                        bv: args.bv,
                        halfPrice: args.halfPrice
                    };
                }
                return item;
            });
            await ctx.db.patch(shop._id, { issuedStocks });
        }
    },
});
