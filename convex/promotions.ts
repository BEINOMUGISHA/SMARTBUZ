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
        triggerType: v.optional(v.string()),
        threshold: v.optional(v.number()),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { userId, ...promoArgs } = args;
        const promoId = await ctx.db.insert("promotions", promoArgs);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Add Promotion",
            details: `Created new promotion: ${args.name} - Prize: ${args.prize}, Type: ${args.triggerType || 'N/A'}${args.threshold ? `, Threshold: ${args.threshold}` : ''}, Status: ${args.isActive ? 'Active' : 'Inactive'}`,
            timestamp: new Date().toISOString(),
        });

        return promoId;
    },
});

export const update = mutation({
    args: {
        id: v.id("promotions"),
        name: v.optional(v.string()),
        prize: v.optional(v.string()),
        isActive: v.optional(v.boolean()),
        triggerType: v.optional(v.string()),
        threshold: v.optional(v.number()),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { id, userId, ...rest } = args;
        const promotion = await ctx.db.get(id);
        if (!promotion) throw new Error("Promotion not found");

        const patchData: any = { ...rest };

        // If switching to Product type, remove threshold
        if (args.triggerType === "Product") {
            patchData.threshold = undefined;
        }

        await ctx.db.patch(id, patchData);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Update Promotion",
            details: `Updated promotion ${promotion.name} - Changes: ${changes}`,
            timestamp: new Date().toISOString(),
        });
    },
});

export const remove = mutation({
    args: { id: v.id("promotions"), userId: v.id("users") },
    handler: async (ctx, args) => {
        const promotion = await ctx.db.get(args.id);
        if (!promotion) throw new Error("Promotion not found");

        // Also remove linked products
        const products = await ctx.db
            .query("promotionProducts")
            .withIndex("by_promotion", (q) => q.eq("promotionId", args.id))
            .collect();
        for (const p of products) {
            await ctx.db.delete(p._id);
        }
        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Delete Promotion",
            details: `Deleted promotion: ${promotion.name} - Prize: ${promotion.prize} (${products.length} linked products removed)`,
            timestamp: new Date().toISOString(),
        });
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const promotion = await ctx.db.get(args.promotionId);
        const stock = await ctx.db.get(args.stockId);

        // Check for existing product in this promotion
        const existing = await ctx.db
            .query("promotionProducts")
            .withIndex("by_promotion", (q) => q.eq("promotionId", args.promotionId))
            .filter((q) => q.eq(q.field("stockId"), args.stockId))
            .first();

        let productId;
        if (existing) {
            // Update quantity instead of inserting new record
            await ctx.db.patch(existing._id, {
                requiredQuantity: args.requiredQuantity
            });
            productId = existing._id;
        } else {
            productId = await ctx.db.insert("promotionProducts", {
                promotionId: args.promotionId,
                stockId: args.stockId,
                requiredQuantity: args.requiredQuantity,
            });
        }

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: existing ? "Update Promotion Product" : "Add Product to Promotion",
            details: `${existing ? 'Updated' : 'Added'} product ${stock?.name || 'Unknown'} (${args.requiredQuantity} units) to promotion ${promotion?.name || 'Unknown'}`,
            timestamp: new Date().toISOString(),
        });

        return productId;
    },
});

export const removeProduct = mutation({
    args: { id: v.id("promotionProducts"), userId: v.id("users") },
    handler: async (ctx, args) => {
        const product = await ctx.db.get(args.id);
        if (!product) throw new Error("Promotion product not found");

        const stock = await ctx.db.get(product.stockId);
        const promotion = await ctx.db.get(product.promotionId);

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Remove Product from Promotion",
            details: `Removed product ${stock?.name || 'Unknown'} from promotion ${promotion?.name || 'Unknown'}`,
            timestamp: new Date().toISOString(),
        });
    },
});

export const updateProductQuantity = mutation({
    args: {
        id: v.id("promotionProducts"),
        quantity: v.number(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const product = await ctx.db.get(args.id);
        if (!product) throw new Error("Promotion product not found");

        const stock = await ctx.db.get(product.stockId);
        const promotion = await ctx.db.get(product.promotionId);

        if (args.quantity <= 0) {
            await ctx.db.delete(args.id);
            
            // Log activity
            await ctx.db.insert("activityLogs", {
                userId: args.userId,
                action: "Remove Product from Promotion",
                details: `Removed product ${stock?.name || 'Unknown'} from promotion ${promotion?.name || 'Unknown'} (quantity set to 0)`,
                timestamp: new Date().toISOString(),
            });
            return;
        }
        
        await ctx.db.patch(args.id, { requiredQuantity: args.quantity });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Update Promotion Product Quantity",
            details: `Updated quantity for ${stock?.name || 'Unknown'} in promotion ${promotion?.name || 'Unknown'}: ${product.requiredQuantity} -> ${args.quantity}`,
            timestamp: new Date().toISOString(),
        });
    },
});

export const listRedemptions = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
    },
    handler: async (ctx, args) => {
        let targetShopId = args.shopId;

        if (!targetShopId && args.email) {
            const user = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", args.email!))
                .first();
            if (user) {
                const shop = await ctx.db
                    .query("shops")
                    .withIndex("by_user", (q) => q.eq("userId", user._id))
                    .first();
                if (shop) targetShopId = shop._id;
            }
        }

        let q: any;
        if (targetShopId) {
            if (args.from && args.to) {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) =>
                    q.eq("shopId", targetShopId!).gte("date", args.from!).lte("date", args.to!)
                );
            } else {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) => q.eq("shopId", targetShopId!));
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
    }
});

export const redemptionsStats = query({
    args: {
        email: v.optional(v.string()),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
    },
    handler: async (ctx, args) => {
        let targetShopId = args.shopId;

        if (!targetShopId && args.email) {
            const user = await ctx.db
                .query("users")
                .withIndex("by_email", (q) => q.eq("email", args.email!))
                .first();
            if (user) {
                const shop = await ctx.db
                    .query("shops")
                    .withIndex("by_user", (q) => q.eq("userId", user._id))
                    .first();
                if (shop) targetShopId = shop._id;
            }
        }

        let q: any;
        if (targetShopId) {
            if (args.from && args.to) {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) =>
                    q.eq("shopId", targetShopId!).gte("date", args.from!).lte("date", args.to!)
                );
            } else {
                q = ctx.db.query("promotionRedemptions").withIndex("by_shop_date", (q) => q.eq("shopId", targetShopId!));
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
        const globalPromotions = activePromotions.filter(p => p.triggerType === "TotalPV" || p.triggerType === "TotalBV");

        if (activePromotions.length === 0) return { productPromotions: promoMap, globalPromotions: [] };

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

        return { productPromotions: promoMap, globalPromotions };
    },
});
