import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requirePermission, requireTenant } from "./tenancy";

/**
 * SMARTBUZ — dashboard statistics.
 *
 * Every figure is computed from the caller's business only.
 */
export const getStats = query({
    args: {
        startDate: v.optional(v.string()), // ISO String
        endDate: v.optional(v.string()),   // ISO String
        shopId: v.optional(v.id("shops")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");
        const businessId = tenant.businessId;

        // A shop that belongs to another business is simply not a valid filter.
        if (args.shopId) {
            const shop = await ctx.db.get(args.shopId);
            if (!shop || shop.businessId !== businessId) {
                throw new ConvexError("Forbidden: that shop belongs to another business.");
            }
        }

        // [OPTIMIZED] Use proper indexed queries instead of .collect()
        let salesQuery;
        if (args.shopId) {
            if (args.startDate && args.endDate) {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_shop_date", q =>
                    q.eq("businessId", businessId).eq("shopId", args.shopId!).gte("date", args.startDate!).lte("date", args.endDate!)
                );
            } else {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_shop_date", q =>
                    q.eq("businessId", businessId).eq("shopId", args.shopId!)
                );
            }
        } else {
            if (args.startDate && args.endDate) {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_date", q =>
                    q.eq("businessId", businessId).gte("date", args.startDate!).lte("date", args.endDate!)
                );
            } else {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId", q =>
                    q.eq("businessId", businessId)
                );
            }
        }

        const filteredSales = await salesQuery.order("desc").collect();

        // Calculate total customers - if shopId is provided, count customers who have made purchases at that shop
        let totalCustomers;
        if (args.shopId) {
            // For shop-specific view, count unique customers who have made purchases at this shop
            const customerIds = new Set(filteredSales.map(s => s.customerId).filter((id): id is Id<"customers"> => !!id));
            totalCustomers = customerIds.size;
        } else {
            // For the business view, count the customers of this business only
            totalCustomers = (await ctx.db
                .query("customers")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .collect()).length;
        }

        // 2. Calculate Revenue
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);

        // 3. Low Stock [OPTIMIZED]
        let lowStockCount = 0;
        if (args.shopId) {
            const shop = await ctx.db.get(args.shopId);
            lowStockCount = shop?.issuedStocks.filter(s => s.qty < 5).length || 0;
        } else {
            const lowStock = await ctx.db
                .query("stocks")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .collect();
            lowStockCount = lowStock.filter(s => s.qty < 10).length;
        }

        // 4. Recent Sales [BATCH OPTIMIZED]
        const rawRecentSales = filteredSales.slice(0, 5);
        const customerIds = [...new Set(rawRecentSales.map(s => s.customerId).filter((id): id is Id<"customers"> => !!id))];
        const customers = await Promise.all(customerIds.map(id => ctx.db.get(id)));
        const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));

        const recentSales = rawRecentSales.map(sale => ({
            _id: sale._id,
            customerName: sale.customerId ? (customerMap.get(sale.customerId)?.name || "Unknown") : (sale.manualCustomerName || "Walk-in"),
            amount: sale.total,
            date: sale.date,
            status: "Completed"
        }));

        // 5. Chart Data (Daily Revenue)
        const dailyRevenue: Record<string, number> = {};
        filteredSales.forEach(sale => {
            const day = sale.date.split('T')[0];
            dailyRevenue[day] = (dailyRevenue[day] || 0) + sale.total;
        });

        const chartData = Object.entries(dailyRevenue)
            .map(([date, value]) => ({ date, value }))
            .sort((a, b) => a.date.localeCompare(b.date));

        return {
            totalRevenue,
            totalOrders: filteredSales.length,
            totalCustomers,
            lowStockCount,
            recentSales,
            chartData
        };
    },
});

export const getGlobalLowStock = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        return stocks
            .filter((s) => s.qty < 15)
            .sort((a, b) => a.qty - b.qty)
            .slice(0, 10);
    }
});
