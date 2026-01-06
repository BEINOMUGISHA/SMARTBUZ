import { v } from "convex/values";
import { query } from "./_generated/server";

export const getStats = query({
    args: {
        startDate: v.optional(v.string()), // ISO String
        endDate: v.optional(v.string()),   // ISO String
        shopId: v.optional(v.id("shops")),
    },
    handler: async (ctx, args) => {
        let salesQuery = ctx.db.query("sales");

        const allSales = await salesQuery.order("desc").collect();
        const allCustomers = await ctx.db.query("customers").collect();
        const allStock = await ctx.db.query("stocks").collect();

        // 1. Filter Sales by Date and Shop
        const filteredSales = allSales.filter(sale => {
            const matchesShop = args.shopId ? sale.shopId === args.shopId : true;
            const matchesDate = (args.startDate && args.endDate)
                ? (sale.date >= args.startDate && sale.date <= args.endDate)
                : true;
            return matchesShop && matchesDate;
        });

        // 2. Calculate Revenue
        const totalRevenue = filteredSales.reduce((sum, sale) => sum + sale.total, 0);

        // 3. Low Stock (Threshold < 10)
        // For Sales Dashboard, we might want to filter stock by shop, 
        // but stocks table is global. Shops table has issuedStocks.
        let lowStockCount = 0;
        if (args.shopId) {
            const shop = await ctx.db.get(args.shopId);
            lowStockCount = shop?.issuedStocks.filter(s => s.qty < 5).length || 0;
        } else {
            lowStockCount = allStock.filter(s => s.qty < 10).length;
        }

        // 4. Recent Sales
        const recentSales = filteredSales.slice(0, 5).map(sale => ({
            _id: sale._id,
            customerName: sale.manualCustomerName || "Walk-in Customer",
            amount: sale.total,
            date: sale.date,
            status: "Completed"
        }));

        const enrichedRecentSales = await Promise.all(recentSales.map(async (s) => {
            const sale = filteredSales.find(fs => fs._id === s._id);
            if (sale?.customerId) {
                const customer = await ctx.db.get(sale.customerId);
                return { ...s, customerName: customer?.name || "Unknown" };
            }
            return s;
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
            totalCustomers: allCustomers.length,
            lowStockCount,
            recentSales: enrichedRecentSales,
            chartData
        };
    },
});

export const getGlobalLowStock = query({
    args: {},
    handler: async (ctx) => {
        const stocks = await ctx.db.query("stocks").collect();
        return stocks
            .filter(s => s.qty < 15)
            .sort((a, b) => a.qty - b.qty)
            .slice(0, 10);
    }
});
