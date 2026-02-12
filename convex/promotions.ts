import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("promotions").order("desc").paginate(args.paginationOpts);
    },
});

export const listAll = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("promotions").order("desc").collect();
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("promotions");
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

export const add = mutation({
    args: {
        name: v.string(),
        prize: v.string(),
        isActive: v.boolean(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("promotions", args);
    },
});

export const update = mutation({
    args: {
        id: v.id("promotions"),
        name: v.optional(v.string()),
        prize: v.optional(v.string()),
        isActive: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

export const remove = mutation({
    args: { id: v.id("promotions") },
    handler: async (ctx, args) => {
        // Also remove linked products
        const products = await ctx.db
            .query("promotionProducts")
            .withIndex("by_promotion", (q) => q.eq("promotionId", args.id))
            .collect();
        for (const p of products) {
            await ctx.db.delete(p._id);
        }
        await ctx.db.delete(args.id);
    },
});

// Promotion Products Management
export const getPromotionProducts = query({
    args: { promotionId: v.id("promotions") },
    handler: async (ctx, args) => {
        const products = await ctx.db
            .query("promotionProducts")
            .withIndex("by_promotion", (q) => q.eq("promotionId", args.promotionId))
            .collect();

        const results = await Promise.all(
            products.map(async (p) => {
                const stock = await ctx.db.get(p.stockId);
                return {
                    ...p,
                    stockName: stock?.name || "Unknown Product",
                    productCode: stock?.productCode || "N/A",
                };
            })
        );

        return results;
    },
});

export const addProduct = mutation({
    args: {
        promotionId: v.id("promotions"),
        stockId: v.id("stocks"),
        requiredQuantity: v.number(),
    },
    handler: async (ctx, args) => {
        // Check for existing product in this promotion
        const existing = await ctx.db
            .query("promotionProducts")
            .withIndex("by_promotion", (q) => q.eq("promotionId", args.promotionId))
            .filter((q) => q.eq(q.field("stockId"), args.stockId))
            .first();

        if (existing) {
            // Update quantity instead of inserting new record
            await ctx.db.patch(existing._id, {
                requiredQuantity: args.requiredQuantity
            });
            return existing._id;
        }

        return await ctx.db.insert("promotionProducts", args);
    },
});

export const removeProduct = mutation({
    args: { id: v.id("promotionProducts") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});

export const updateProductQuantity = mutation({
    args: {
        id: v.id("promotionProducts"),
        quantity: v.number(),
    },
    handler: async (ctx, args) => {
        if (args.quantity <= 0) {
            await ctx.db.delete(args.id);
            return;
        }
        await ctx.db.patch(args.id, { requiredQuantity: args.quantity });
    },
});

export const listRedemptions = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!args.email) throw new Error("Unauthorized");

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first();
        if (!user) throw new Error("User not found");

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        // Must be shop-scoped (or HQ if no shop, but schema allows optional shopId)
        // If shop is null, maybe show all for admin? For now, let's assume strict shop scope if shop exists.
        // If user has no shop, they might be HQ admin.

        let q: any;

        if (shop) {
            if (args.from && args.to) {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) =>
                    q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!)
                );
            } else {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) => q.eq("shopId", shop._id));
            }
        } else {
            // HQ/Admin view
            const baseQuery = ctx.db.query("promotionRedemptions");
            if (args.from && args.to) {
                q = baseQuery.filter(q => q.and(q.gte(q.field("date"), args.from!), q.lte(q.field("date"), args.to!)));
            } else {
                q = baseQuery;
            }
        }

        const stats = await q.order("desc").paginate(args.paginationOpts);

        // Enrich results
        const page = await Promise.all(stats.page.map(async (record: any) => {
            const promotion = await ctx.db.get(record.promotionId);
            const customer = record.customerId ? await ctx.db.get(record.customerId) : null;
            const user = await ctx.db.get(record.userId);

            return {
                ...record,
                promotionName: (promotion as any)?.name || "Unknown Promotion",
                customerName: (customer as any)?.name || "Walk-in",
                operatorName: user ? `${(user as any).first_name} ${(user as any).last_name}` : "Unknown",
            };
        }));

        return { ...stats, page };
    },
});

export const redemptionsStats = query({
    args: {
        email: v.optional(v.string()),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const user = args.email ? await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first() : null;

        const shop = user ? await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first() : null;

        let q: any;
        if (shop) {
            if (args.from && args.to) {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) =>
                    q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!)
                );
            } else {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) => q.eq("shopId", shop._id));
            }
        } else {
            const baseQuery = ctx.db.query("promotionRedemptions");
            if (args.from && args.to) {
                q = baseQuery.filter(q => q.and(q.gte(q.field("date"), args.from!), q.lte(q.field("date"), args.to!)));
            } else {
                q = baseQuery;
            }
        }

        const all = await q.collect();

        // Calculate stats
        const uniqueCustomers = new Set(all.map((r: any) => r.customerId).filter(Boolean));
        const uniqueProducts = new Set(all.map((r: any) => r.stockId));

        return {
            totalRedemptions: all.length,
            uniqueCustomers: uniqueCustomers.size,
            uniqueProducts: uniqueProducts.size,
        };
    },
});

export const getActivePromotionsWithProducts = query({
    args: {},
    handler: async (ctx) => {
        const activePromotions = await ctx.db
            .query("promotions")
            .filter((q) => q.eq(q.field("isActive"), true))
            .collect();

        const promoMap: Record<string, { promotionName: string; requiredQty: number; prize: string }> = {};

        if (activePromotions.length === 0) return promoMap;

        const allPromotionProducts = await ctx.db.query("promotionProducts").collect();

        for (const pp of allPromotionProducts) {
            // Find which promotion this product belongs to
            const promo = activePromotions.find((p) => p._id === pp.promotionId);
            if (promo) {
                promoMap[pp.stockId] = {
                    promotionName: promo.name,
                    requiredQty: pp.requiredQuantity,
                    prize: promo.prize,
                };
            }
        }

        return promoMap;
    },
});
