import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Id } from "./_generated/dataModel";
import { logActivity, requirePermission, requireTenant } from "./tenancy";

/**
 * SMART_BUZ — promotions and prize redemptions.
 *
 * A promotion belongs to a business: two businesses may both run a
 * "Buy 6 get 1 free" offer without interfering with each other.
 */

/** The counter the caller runs in this business, if any. */
async function callerShopId(
    ctx: any,
    userId: Id<"users">,
    businessId: Id<"businesses">
): Promise<Id<"shops"> | undefined> {
    const shop = await ctx.db
        .query("shops")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .filter((q: any) => q.eq(q.field("businessId"), businessId))
        .first();
    return shop?._id;
}

export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        return await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const listAll = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        return await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .collect();
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        let results = await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .collect();

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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.create");

        const { userId, businessId, ...promoArgs } = args;
        const promoId = await ctx.db.insert("promotions", {
            ...promoArgs,
            businessId: tenant.businessId,
        });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Add Promotion",
            `Created new promotion: ${args.name} - Prize: ${args.prize}, Type: ${args.triggerType || 'N/A'}${args.threshold ? `, Threshold: ${args.threshold}` : ''}, Status: ${args.isActive ? 'Active' : 'Inactive'}`
        );

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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const { id, userId, businessId, ...rest } = args;
        const promotion = await ctx.db.get(id);
        if (!promotion) throw new ConvexError("Promotion not found");
        if (promotion.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that promotion belongs to another business.");
        }

        const patchData: any = { ...rest };

        // If switching to Product type, remove threshold
        if (args.triggerType === "Product") {
            patchData.threshold = undefined;
        }

        await ctx.db.patch(id, patchData);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Promotion",
            `Updated promotion ${promotion.name} - Changes: ${changes}`
        );
    },
});

export const remove = mutation({
    args: {
        id: v.id("promotions"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const promotion = await ctx.db.get(args.id);
        if (!promotion) throw new ConvexError("Promotion not found");
        if (promotion.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that promotion belongs to another business.");
        }

        // Also remove linked products
        const products = await ctx.db
            .query("promotionProducts")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .filter((q) => q.eq(q.field("promotionId"), args.id))
            .collect();
        for (const p of products) {
            await ctx.db.delete(p._id);
        }
        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Delete Promotion",
            `Deleted promotion: ${promotion.name} - Prize: ${promotion.prize} (${products.length} linked products removed)`
        );
    },
});

// Promotion Products Management
export const getPromotionProducts = query({
    args: {
        promotionId: v.id("promotions"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const promotion = await ctx.db.get(args.promotionId);
        if (!promotion || promotion.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that promotion belongs to another business.");
        }

        const products = await ctx.db
            .query("promotionProducts")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .filter((q) => q.eq(q.field("promotionId"), args.promotionId))
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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const promotion = await ctx.db.get(args.promotionId);
        if (!promotion || promotion.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that promotion belongs to another business.");
        }
        const stock = await ctx.db.get(args.stockId);
        if (!stock || stock.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        // Check for existing product in this promotion
        const existing = await ctx.db
            .query("promotionProducts")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .filter((q) =>
                q.and(
                    q.eq(q.field("promotionId"), args.promotionId),
                    q.eq(q.field("stockId"), args.stockId)
                )
            )
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
                businessId: tenant.businessId,
                promotionId: args.promotionId,
                stockId: args.stockId,
                requiredQuantity: args.requiredQuantity,
            });
        }

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            existing ? "Update Promotion Product" : "Add Product to Promotion",
            `${existing ? 'Updated' : 'Added'} product ${stock?.name || 'Unknown'} (${args.requiredQuantity} units) to promotion ${promotion?.name || 'Unknown'}`
        );

        return productId;
    },
});

export const removeProduct = mutation({
    args: {
        id: v.id("promotionProducts"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const product = await ctx.db.get(args.id);
        if (!product) throw new ConvexError("Promotion product not found");
        if (product.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that promotion product belongs to another business."
            );
        }

        const stock = await ctx.db.get(product.stockId);
        const promotion = await ctx.db.get(product.promotionId);

        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Remove Product from Promotion",
            `Removed product ${stock?.name || 'Unknown'} from promotion ${promotion?.name || 'Unknown'}`
        );
    },
});

export const updateProductQuantity = mutation({
    args: {
        id: v.id("promotionProducts"),
        quantity: v.number(),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");

        const product = await ctx.db.get(args.id);
        if (!product) throw new ConvexError("Promotion product not found");
        if (product.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that promotion product belongs to another business."
            );
        }

        const stock = await ctx.db.get(product.stockId);
        const promotion = await ctx.db.get(product.promotionId);

        if (args.quantity <= 0) {
            await ctx.db.delete(args.id);

            // Log activity
            await logActivity(
                ctx,
                tenant.businessId,
                tenant.user._id,
                "Remove Product from Promotion",
                `Removed product ${stock?.name || 'Unknown'} from promotion ${promotion?.name || 'Unknown'} (quantity set to 0)`
            );
            return;
        }

        await ctx.db.patch(args.id, { requiredQuantity: args.quantity });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Promotion Product Quantity",
            `Updated quantity for ${stock?.name || 'Unknown'} in promotion ${promotion?.name || 'Unknown'}: ${product.requiredQuantity} -> ${args.quantity}`
        );
    },
});

export const listRedemptions = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        shopId: v.optional(v.id("shops")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");

        let targetShopId = args.shopId;
        if (targetShopId) {
            const shop = await ctx.db.get(targetShopId);
            if (!shop || shop.businessId !== tenant.businessId) {
                throw new ConvexError("Forbidden: that shop belongs to another business.");
            }
        } else {
            targetShopId = await callerShopId(ctx, tenant.user._id, tenant.businessId);
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
            // HQ/Admin view — still only this business's redemptions.
            const baseQuery = ctx.db
                .query("promotionRedemptions")
                .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId));
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
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");

        let targetShopId = args.shopId;
        if (targetShopId) {
            const shop = await ctx.db.get(targetShopId);
            if (!shop || shop.businessId !== tenant.businessId) {
                throw new ConvexError("Forbidden: that shop belongs to another business.");
            }
        } else {
            targetShopId = await callerShopId(ctx, tenant.user._id, tenant.businessId);
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
            const baseQuery = ctx.db
                .query("promotionRedemptions")
                .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId));
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
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const activePromotions = await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .filter((q) => q.eq(q.field("isActive"), true))
            .collect();

        const promoMap: Record<string, { promotionName: string; requiredQty: number; prize: string }> = {};
        const globalPromotions = activePromotions.filter(p => p.triggerType === "TotalPV" || p.triggerType === "TotalBV");

        if (activePromotions.length === 0) return { productPromotions: promoMap, globalPromotions: [] };

        const allPromotionProducts = await ctx.db
            .query("promotionProducts")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

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
