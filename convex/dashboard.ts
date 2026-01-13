import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";

export const getStats = query({
    args: {
        startDate: v.optional(v.string()), // ISO String
        endDate: v.optional(v.string()),   // ISO String
        shopId: v.optional(v.id("shops")),
    },
    handler: async (ctx, args) => {
        // [OPTIMIZED] Use proper indexed queries instead of .collect()
        let salesQuery;
        if (args.shopId) {
            if (args.startDate && args.endDate) {
                salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q =>
                    q.eq("shopId", args.shopId!).gte("date", args.startDate!).lte("date", args.endDate!)
                );
            } else {
                salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", args.shopId!));
            }
        } else {
            if (args.startDate && args.endDate) {
                salesQuery = ctx.db.query("sales").withIndex("by_date", q =>
                    q.gte("date", args.startDate!).lte("date", args.endDate!)
                );
            } else {
                salesQuery = ctx.db.query("sales");
            }
        }

        const filteredSales = await salesQuery.order("desc").collect();
        const totalCustomers = (await ctx.db.query("customers").collect()).length;

        // 2. Calculate Revenue
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);

        // 3. Low Stock [OPTIMIZED]
        let lowStockCount = 0;
        if (args.shopId) {
            const shop = await ctx.db.get(args.shopId);
            lowStockCount = shop?.issuedStocks.filter(s => s.qty < 5).length || 0;
        } else {
            lowStockCount = (await ctx.db.query("stocks").withIndex("by_qty", q => q.lt("qty", 10)).collect()).length;
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
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("stocks")
            .withIndex("by_qty", q => q.lt("qty", 15))
            .order("asc")
            .take(10);
    }
});
