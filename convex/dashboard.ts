import { v } from "convex/values";
import { query } from "./_generated/server";

export const getStats = query({
    args: {},
    handler: async (ctx) => {
        // 1. Get Totals (This is simple aggregation, might be slow on huge datasets but fine for now)
        const allSales = await ctx.db.query("sales").order("desc").collect();
        const allCustomers = await ctx.db.query("customers").collect();
        const allStock = await ctx.db.query("stocks").collect();

        // Calculate Revenue (Total)
        const totalRevenue = allSales.reduce((sum, sale) => sum + sale.total, 0);

        // Low Stock (Threshold < 10)
        const lowStockCount = allStock.filter(s => s.qty < 10).length;

        // Recent Sales (First 5)
        const recentSales = allSales.slice(0, 5).map(sale => ({
            _id: sale._id,
            customerName: "Walk-in Customer", // potentially fetch customer name if ID exists
            amount: sale.total,
            date: sale.date,
            status: "Completed"
        }));

        // Enrich recent sales with customer names efficiently
        // In a real optimized app, we'd use Promise.all or similar, 
        // but for < 5 items, sequential is fine or parallel.
        const enrichedRecentSales = await Promise.all(recentSales.map(async (s, index) => {
            const sale = allSales[index];
            if (sale.customerId) {
                const customer = await ctx.db.get(sale.customerId);
                return { ...s, customerName: customer?.name || "Unknown" };
            }
            return s;
        }));

        return {
            totalRevenue,
            totalOrders: allSales.length,
            totalCustomers: allCustomers.length,
            lowStockCount,
            recentSales: enrichedRecentSales
        };
    },
});
