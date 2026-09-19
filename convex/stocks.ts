import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id } from "./_generated/dataModel";

// List stocks with pagination, search, and category filtering
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // [OPTIMIZED with Index]
        let query;
        if (args.searchTerm) {
            query = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!));

            if (args.halfPrice !== undefined) {
                query = query.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            if (args.categoryId) {
                query = query.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
            }
            return await query.paginate(args.paginationOpts);
        } else if (args.categoryId) {
            query = ctx.db.query("stocks").withIndex("by_category", q => q.eq("categoryId", args.categoryId!));
            if (args.halfPrice !== undefined) {
                query = query.filter(q => q.eq(q.field("halfPrice"), args.halfPrice));
            }
        } else if (args.halfPrice !== undefined) {
            query = ctx.db.query("stocks").withIndex("by_halfPrice", q => q.eq("halfPrice", args.halfPrice!));
        } else {
            query = ctx.db.query("stocks");
        }

        return await query.order("desc").paginate(args.paginationOpts);
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // [OPTIMIZED with proper types]
        if (args.searchTerm) {
            let searchQ = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!));

            if (args.halfPrice !== undefined) {
                searchQ = searchQ.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            if (args.categoryId) {
                searchQ = searchQ.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
            }
            const all = await searchQ.collect();
            // Fallback to exact code match if no name results
            if (all.length === 0) {
                const byCode = await ctx.db.query("stocks")
                    .withIndex("by_productCode", q => q.eq("productCode", args.searchTerm!))
                    .first();
                if (byCode) {
                    if ((args.halfPrice === undefined || byCode.halfPrice === args.halfPrice) &&
                        (!args.categoryId || byCode.categoryId === args.categoryId)) {
                        all.push(byCode);
                    }
                }
            }
            return { page: all.slice(args.offset, args.offset + args.limit), totalCount: all.length };
        }

        let stocksQuery;
        if (args.categoryId) {
            stocksQuery = ctx.db.query("stocks").withIndex("by_category", q => q.eq("categoryId", args.categoryId!));
            if (args.halfPrice !== undefined) {
                stocksQuery = stocksQuery.filter(q => q.eq(q.field("halfPrice"), args.halfPrice));
            }
        } else if (args.halfPrice !== undefined) {
            stocksQuery = ctx.db.query("stocks").withIndex("by_halfPrice", q => q.eq("halfPrice", args.halfPrice!));
        } else {
            stocksQuery = ctx.db.query("stocks");
        }

        const all = await stocksQuery.order("desc").collect();
        const totalCount = all.length;
        const page = all.slice(args.offset, args.offset + args.limit);

        return { page, totalCount };
    },
});

export const count = query({
    args: {
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        // [OPTIMIZED with Index]
        let query;
        if (args.searchTerm) {
            query = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!));

            if (args.halfPrice !== undefined) {
                query = query.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            if (args.categoryId) {
                query = query.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
            }
        } else if (args.categoryId) {
            query = ctx.db.query("stocks").withIndex("by_category", q => q.eq("categoryId", args.categoryId!));
            if (args.halfPrice !== undefined) {
                query = query.filter(q => q.eq(q.field("halfPrice"), args.halfPrice));
            }
        } else if (args.halfPrice !== undefined) {
            query = ctx.db.query("stocks").withIndex("by_halfPrice", q => q.eq("halfPrice", args.halfPrice!));
        } else {
            query = ctx.db.query("stocks");
        }

        return (await query.collect()).length;
    },
});

export const getInventoryStats = query({
    args: {},
    handler: async (ctx) => {
        const stocks = await ctx.db.query("stocks").collect();
        const categories = await ctx.db.query("categories").collect();
        const shops = await ctx.db.query("shops").collect();
        const catMap = new Map(categories.map(c => [c._id, c.type]));

        const stats = stocks.reduce((acc, s) => {
            const sellValue = s.qty * s.price;
            const costValue = s.qty * s.purchasePrice;

            acc.totalSellValue += sellValue;
            acc.totalCostValue += costValue;
            acc.totalItems += s.qty;
            acc.skuCount += 1;
            acc.totalBV += s.qty * s.bv;
            acc.totalPV += s.qty * s.pv;

            if (s.qty === 0) {
                acc.outOfStockCount += 1;
            }

            const catName = catMap.get(s.categoryId) || "Unknown";
            acc.categoryDistribution[catName] = (acc.categoryDistribution[catName] || 0) + s.qty;

            if (s.supplier) {
                acc.supplierDistribution[s.supplier] = (acc.supplierDistribution[s.supplier] || 0) + s.qty;
                if (!acc.suppliers.includes(s.supplier)) {
                    acc.suppliers.push(s.supplier);
                }
            }

            return acc;
        }, {
            totalSellValue: 0,
            totalCostValue: 0,
            totalItems: 0,
            skuCount: 0,
            totalBV: 0,
            totalPV: 0,
            outOfStockCount: 0,
            categoryDistribution: {} as Record<string, number>,
            supplierDistribution: {} as Record<string, number>,
            suppliers: [] as string[]
        });

        // Calculate shop distribution
        let totalShopStock = 0;
        const shopDistribution = shops.reduce((acc, shop) => {
            const shopTotal = shop.issuedStocks.reduce((sum, item) => sum + item.qty, 0);
            acc[shop.name] = shopTotal;
            totalShopStock += shopTotal;
            return acc;
        }, {} as Record<string, number>);

        // Convert distribution to array for charts
        const categoryDistributionArray = Object.entries(stats.categoryDistribution).map(([name, value]) => ({
            name,
            value
        })).sort((a, b) => b.value - a.value);

        const supplierDistributionArray = Object.entries(stats.supplierDistribution).map(([name, value]) => ({
            name,
            value
        })).sort((a, b) => b.value - a.value);

        const shopDistributionArray = Object.entries(shopDistribution).map(([name, value]) => ({
            name,
            value
        })).sort((a, b) => b.value - a.value);

        return {
            ...stats,
            categoryDistribution: categoryDistributionArray,
            supplierDistribution: supplierDistributionArray,
            shopDistribution: shopDistributionArray,
            supplierCount: stats.suppliers.length,
            shopCount: shops.length,
            totalShopStock,
            warehouseStock: stats.totalItems - totalShopStock
        };
    }
});

export const getLowStockAudit = query({
    args: {
        threshold: v.optional(v.number()),
        lookbackDays: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const threshold = args.threshold ?? 10;
        const lookbackDays = args.lookbackDays ?? 7;
        const lowStock = await ctx.db
            .query("stocks")
            .withIndex("by_qty")
            .filter(q => q.lt(q.field("qty"), threshold))
            .collect();

        const categories = await ctx.db.query("categories").collect();
        const catMap = new Map(categories.map(c => [c._id, c.type]));

        const sales = await ctx.db.query("sales").collect();
        const startTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
        const soldByStock = new Map<Id<"stocks">, number>();

        for (const sale of sales) {
            const saleTime = new Date(sale.date).getTime();
            if (saleTime < startTime) continue;

            for (const item of sale.items) {
                const current = soldByStock.get(item.stockId) ?? 0;
                soldByStock.set(item.stockId, current + item.quantity);
            }
        }

        return lowStock.map(s => {
            const soldInWindow = soldByStock.get(s._id) ?? 0;
            const dailyVelocity = soldInWindow / Math.max(1, lookbackDays);
            const daysToStockOut = dailyVelocity > 0 ? s.qty / dailyVelocity : Number.POSITIVE_INFINITY;
            const recommendedOrder = Math.max(0, Math.ceil((dailyVelocity * 7) + threshold - s.qty));

            return {
                ...s,
                categoryName: catMap.get(s.categoryId) || "Unknown",
                valuation: s.qty * s.price,
                dailyVelocity: Number(dailyVelocity.toFixed(2)),
                daysToStockOut: Number.isFinite(daysToStockOut) ? Number(daysToStockOut.toFixed(1)) : null,
                recommendedOrder,
            };
        });
    }
});

export const getShopStock = query({
    args: {
        searchTerm: v.optional(v.string()),
        halfPrice: v.optional(v.boolean()),
        availability: v.optional(v.union(v.literal("inStock"), v.literal("outOfStock"), v.literal("all"))),
        email: v.optional(v.string()), // Pass email explicitly because we don't use Convex Auth
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
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

        // Filter by availability
        if (args.availability === "inStock") {
            stocks = stocks.filter(s => s.qty > 0);
        } else if (args.availability === "outOfStock") {
            stocks = stocks.filter(s => s.qty <= 0);
        }

        // Map to match the shape of the main 'stocks' table for UI consistency if needed
        // The array in 'shops' already has { stockId, name, qty... }

        const totalCount = stocks.length;
        if (args.offset !== undefined && args.limit !== undefined) {
            stocks = stocks.slice(args.offset, args.offset + args.limit);
        }

        return { shop, stocks, totalCount };
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

// Get a single stock with details
export const getStock = query({
    args: { id: v.id("stocks") },
    handler: async (ctx, args) => {
        const stock = await ctx.db.get(args.id);
        if (!stock) return null;

        // Get category if available
        const category = stock.categoryId ? await ctx.db.get(stock.categoryId) : null;

        return {
            ...stock,
            category,
        };
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
        supplier: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { supplier, ...insertArgs } = args;
        const identity = await ctx.auth.getUserIdentity();
        let userId: Id<"users"> | undefined;

        if (identity) {
            const user = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", identity.email!))
                .first();
            if (user) userId = user._id;
        }

        if (!userId) {
            const admin = await ctx.db.query("users").first();
            if (admin) userId = admin._id;
        }

        const stockId = await ctx.db.insert("stocks", {
            ...insertArgs,
            supplier,
        });

        if (userId) {
            await ctx.db.insert("stockEntries", {
                stockId,
                quantity: args.qty,
                userId,
                date: new Date().toISOString(),
                price: args.price,
                purchasePrice: args.purchasePrice,
                pv: args.pv,
                bv: args.bv,
                halfPrice: args.halfPrice || false,
                type: "add",
                supplier,
            });

            // Log activity
            await ctx.db.insert("activityLogs", {
                userId,
                action: "Add Stock",
                details: `Added new stock: ${args.name} (${args.productCode}) - Qty: ${args.qty}, Price: UGX ${args.price.toLocaleString()}`,
                timestamp: new Date().toISOString(),
            });
        }

        return stockId;
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
        supplier: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        const oldStock = await ctx.db.get(id);
        if (!oldStock) throw new Error("Stock not found");

        await ctx.db.patch(id, rest);

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

        // Log activity
        const identity = await ctx.auth.getUserIdentity();
        let userId: Id<"users"> | undefined;

        if (identity) {
            const user = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", identity.email!))
                .first();
            if (user) userId = user._id;
        }

        if (!userId) {
            const admin = await ctx.db.query("users").first();
            if (admin) userId = admin._id;
        }

        if (userId) {
            const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
            await ctx.db.insert("activityLogs", {
                userId,
                action: "Update Stock",
                details: `Updated stock: ${oldStock.name} (${oldStock.productCode}) - Changes: ${changes}`,
                timestamp: new Date().toISOString(),
            });
        }
    },
});

// Delete stock
export const remove = mutation({
    args: { id: v.id("stocks") },
    handler: async (ctx, args) => {
        const stock = await ctx.db.get(args.id);
        if (!stock) throw new Error("Stock not found");

        const shops = await ctx.db.query("shops").collect();
        for (const shop of shops) {
            const issuedStocks = shop.issuedStocks.filter(item => item.stockId !== args.id);
            if (issuedStocks.length !== shop.issuedStocks.length) {
                await ctx.db.patch(shop._id, { issuedStocks });
            }
        }
        await ctx.db.delete(args.id);

        // Log activity
        const identity = await ctx.auth.getUserIdentity();
        let userId: Id<"users"> | undefined;

        if (identity) {
            const user = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", identity.email!))
                .first();
            if (user) userId = user._id;
        }

        if (!userId) {
            const admin = await ctx.db.query("users").first();
            if (admin) userId = admin._id;
        }

        if (userId) {
            await ctx.db.insert("activityLogs", {
                userId,
                action: "Delete Stock",
                details: `Deleted stock: ${stock.name} (${stock.productCode}) - Previous Qty: ${stock.qty}`,
                timestamp: new Date().toISOString(),
            });
        }
    },
});

// Restock logic
export const restock = mutation({
    args: {
        id: v.id("stocks"),
        quantityToAdd: v.number(),
        price: v.number(),
        pv: v.number(),
        bv: v.number(),
        halfPrice: v.boolean(),
        date: v.string(),
        supplier: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { supplier, ...restockArgs } = args;
        const identity = await ctx.auth.getUserIdentity();
        let userId: Id<"users"> | undefined;

        if (identity) {
            const user = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", identity.email!))
                .first();
            if (user) userId = user._id;
        }

        if (!userId) {
            const admin = await ctx.db.query("users").first();
            if (admin) userId = admin._id;
        }

        const stock = await ctx.db.get(args.id);
        if (!stock) throw new Error("Stock not found");

        await ctx.db.patch(args.id, {
            qty: stock.qty + args.quantityToAdd,
            price: args.price,
            pv: args.pv,
            bv: args.bv,
            halfPrice: args.halfPrice,
            supplier: supplier ?? stock.supplier,
        });

        if (userId) {
            await ctx.db.insert("stockEntries", {
                stockId: args.id,
                quantity: args.quantityToAdd,
                userId,
                date: args.date || new Date().toISOString(),
                price: args.price,
                purchasePrice: stock.purchasePrice,
                pv: args.pv,
                bv: args.bv,
                halfPrice: args.halfPrice,
                type: "restock",
                supplier,
            });

            // Log activity
            await ctx.db.insert("activityLogs", {
                userId,
                action: "Restock",
                details: `Restocked ${stock.name} (${stock.productCode}) - Added: ${args.quantityToAdd}, New Qty: ${stock.qty + args.quantityToAdd}, Supplier: ${supplier || stock.supplier || 'N/A'}`,
                timestamp: new Date().toISOString(),
            });
        }

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

export const getShopIssueRecords = query({
    args: {
        shopId: v.optional(v.id("shops")),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let q;
        if (args.shopId) {
            q = ctx.db.query("shopIssueRecords").withIndex("by_shop_date", q => q.eq("shopId", args.shopId!));
            if (args.from && args.to) {
                q = q.filter(q => q.and(
                    q.gte(q.field("date"), args.from!),
                    q.lte(q.field("date"), args.to!.includes("T") ? args.to! : `${args.to!}T23:59:59.999Z`)
                ));
            }
        } else {
            q = ctx.db.query("shopIssueRecords");
            if (args.from && args.to) {
                q = q.filter(q => q.and(
                    q.gte(q.field("date"), args.from!),
                    q.lte(q.field("date"), args.to!.includes("T") ? args.to! : `${args.to!}T23:59:59.999Z`)
                ));
            }
        }

        let records = await q.order("desc").collect();

        const [stocks, shops, users] = await Promise.all([
            Promise.all(records.map(r => ctx.db.get(r.stockId))),
            Promise.all(records.map(r => ctx.db.get(r.shopId))),
            Promise.all(records.map(r => ctx.db.get(r.userId))),
        ]);

        const stockMap = new Map(stocks.filter(s => s !== null).map(s => [s!._id, s]));
        const shopMap = new Map(shops.filter(s => s !== null).map(s => [s!._id, s]));
        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));

        // Apply search filter after enrichment if searchTerm is present
        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            records = records.filter(r => {
                const stock = stockMap.get(r.stockId);
                return (
                    stock?.name.toLowerCase().includes(search) ||
                    stock?.productCode.toLowerCase().includes(search)
                );
            });
        }

        return records.map(r => ({
            ...r,
            stockName: stockMap.get(r.stockId)?.name || "Unknown",
            productCode: stockMap.get(r.stockId)?.productCode || "N/A",
            halfPrice: stockMap.get(r.stockId)?.halfPrice || false,
            shopName: shopMap.get(r.shopId)?.name || "Unknown",
            userName: userMap.get(r.userId) ? `${userMap.get(r.userId)!.first_name} ${userMap.get(r.userId)!.last_name}` : "Unknown",
        }));
    },
});

export const getStockEntries = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        type: v.optional(v.string()), // "add" or "restock"
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("stockEntries");

        if (args.from && args.to) {
            q = q.filter(q => q.and(
                q.gte(q.field("date"), args.from!),
                q.lte(q.field("date"), args.to!)
            ));
        }

        if (args.type) {
            q = q.filter(q => q.eq(q.field("type"), args.type));
        }

        const entries = await q.order("desc").collect();

        const [stocks, users] = await Promise.all([
            Promise.all(entries.map(e => ctx.db.get(e.stockId))),
            Promise.all(entries.map(e => ctx.db.get(e.userId))),
        ]);

        const stockMap = new Map(stocks.filter(s => s !== null).map(s => [s!._id, s]));
        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));

        return entries.map(e => ({
            ...e,
            stockName: stockMap.get(e.stockId)?.name || "Unknown",
            productCode: stockMap.get(e.stockId)?.productCode || "N/A",
            userName: userMap.get(e.userId) ? `${userMap.get(e.userId)!.first_name} ${userMap.get(e.userId)!.last_name}` : "Unknown",
        }));
    },
});
