import { v } from "convex/values";
import { query } from "./_generated/server";

export const getDailyProfitLoss = query({
    args: { date: v.string() }, // ISO String or YYYY-MM-DD
    handler: async (ctx, args) => {
        const targetDate = args.date.split("T")[0];

        // We filter sales manually since we want exact date match or use an index if date is just the date string
        const allSales = await ctx.db.query("sales").collect();
        const daySales = allSales.filter(s => s.date.startsWith(targetDate));

        let totalRevenue = 0;
        let totalCost = 0;

        for (const sale of daySales) {
            totalRevenue += sale.total;
            for (const item of sale.items) {
                const stock = await ctx.db.get(item.stockId);
                if (stock) {
                    totalCost += stock.purchasePrice * item.quantity;
                }
            }
        }

        const totalProfit = totalRevenue - totalCost;

        return {
            date: targetDate,
            totalRevenue,
            totalCost,
            totalProfit,
            salesCount: daySales.length,
        };
    },
});

export const getMonthlyProfitLoss = query({
    args: { year: v.number(), month: v.number() },
    handler: async (ctx, args) => {
        const prefix = `${args.year}-${String(args.month).padStart(2, "0")}`;

        const allSales = await ctx.db.query("sales").collect();
        const monthSales = allSales.filter(s => s.date.startsWith(prefix));

        let totalRevenue = 0;
        let totalCost = 0;

        for (const sale of monthSales) {
            totalRevenue += sale.total;
            for (const item of sale.items) {
                const stock = await ctx.db.get(item.stockId);
                if (stock) {
                    totalCost += stock.purchasePrice * item.quantity;
                }
            }
        }

        const totalProfit = totalRevenue - totalCost;

        return {
            year: args.year,
            month: args.month,
            totalRevenue,
            totalCost,
            totalProfit,
            salesCount: monthSales.length,
        };
    },
});

export const getSalesAndExpenses = query({
    args: { startDate: v.string(), endDate: v.string() },
    handler: async (ctx, args) => {
        const sales = await ctx.db
            .query("sales")
            .filter((q) => q.and(
                q.gte(q.field("date"), args.startDate),
                q.lte(q.field("date"), args.endDate)
            ))
            .collect();

        const expenses = await ctx.db
            .query("expenses")
            .filter((q) => q.and(
                q.gte(q.field("date"), args.startDate),
                q.lte(q.field("date"), args.endDate)
            ))
            .collect();

        return { sales, expenses };
    },
});
