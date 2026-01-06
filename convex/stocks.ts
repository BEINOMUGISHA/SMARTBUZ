import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

// List stocks with pagination, search, and category filtering
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        if (args.searchTerm) {
            let searchQ = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!));

            if (args.halfPrice !== undefined) {
                searchQ = searchQ.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }

            return await searchQ.paginate(args.paginationOpts);
        }

        let stocksQuery = ctx.db.query("stocks");

        if (args.categoryId) {
            stocksQuery = stocksQuery.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
        }

        if (args.halfPrice !== undefined) {
            stocksQuery = stocksQuery.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
        }

        return await stocksQuery.order("desc").paginate(args.paginationOpts);
    },
});

export const count = query({
    args: {
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        if (args.searchTerm) {
            let searchQ = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!));

            if (args.halfPrice !== undefined) {
                searchQ = searchQ.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            return (await searchQ.collect()).length;
        }

        let stocksQuery = ctx.db.query("stocks");

        if (args.categoryId) {
            stocksQuery = stocksQuery.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
        }

        if (args.halfPrice !== undefined) {
            stocksQuery = stocksQuery.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
        }

        return (await stocksQuery.collect()).length;
    },
});

export const getShopStock = query({
    args: {
        searchTerm: v.optional(v.string()),
        halfPrice: v.optional(v.boolean()),
        email: v.optional(v.string()), // Pass email explicitly because we don't use Convex Auth
    },
    handler: async (ctx, args) => {
        if (!args.email) return { shop: null, stocks: [] };

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first();

        if (!user) return { shop: null, stocks: [] };

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        // If no shop, user is HQ or unassigned
        if (!shop) return { shop: null, stocks: [] };

        let stocks = shop.issuedStocks || [];

        // Filter by text
        if (args.searchTerm) {
            const lowerSearch = args.searchTerm.toLowerCase();
            stocks = stocks.filter(s =>
                s.name.toLowerCase().includes(lowerSearch) ||
                (s.productCode?.toLowerCase().includes(lowerSearch) ?? false)
            );
        }

        // Filter by halfPrice
        if (args.halfPrice !== undefined) {
            stocks = stocks.filter(s => !!s.halfPrice === args.halfPrice);
        }

        // Map to match the shape of the main 'stocks' table for UI consistency if needed
        // The array in 'shops' already has { stockId, name, qty... }
        // We'll return it as is, but UI needs to handle accessing it.
        return { shop, stocks };
    },
});

export const listAll = query({
    args: {
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("stocks");

        // We can't easily chain filters if we don't know which index to use or if we just scan all.
        // For "stocks", scanning all is fine for < 10k items.
        // If we want to be strict, we can use an index if defined, but schema didn't show "by_halfPrice".

        const all = await q.collect();

        if (args.halfPrice !== undefined) {
            return all.filter(s => !!s.halfPrice === args.halfPrice);
        }

        return all;
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
