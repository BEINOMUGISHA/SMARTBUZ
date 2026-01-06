import { v } from "convex/values";
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

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

export const getDetailedSalesReport = query({
    args: {
        paginationOpts: paginationOptsValidator,
        shopId: v.optional(v.id("shops")),
        clientType: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let salesQuery = ctx.db.query("sales");

        if (args.shopId) {
            salesQuery = salesQuery.filter(q => q.eq(q.field("shopId"), args.shopId!));
        }

        if (args.clientType && args.clientType !== "All") {
            salesQuery = salesQuery.filter(q => q.eq(q.field("clientType"), args.clientType!));
        }

        if (args.startDate && args.endDate) {
            const startStr = args.startDate;
            const endStr = args.endDate + "T23:59:59.999";
            salesQuery = salesQuery.filter(q =>
                q.and(
                    q.gte(q.field("date"), startStr),
                    q.lte(q.field("date"), endStr)
                )
            );
        }

        const results = await salesQuery.order("desc").paginate(args.paginationOpts);

        // Enrich with customer and shop names
        const page = await Promise.all(results.page.map(async s => {
            const customer = s.customerId ? await ctx.db.get(s.customerId) : null;
            const shop = s.shopId ? await ctx.db.get(s.shopId) : null;
            return {
                ...s,
                customerName: customer?.name || s.manualCustomerName || "Walk-in",
                shopName: shop?.name || "Main Warehouse"
            };
        }));

        return { ...results, page };
    }
});

export const getDetailedSalesReportCount = query({
    args: {
        shopId: v.optional(v.id("shops")),
        clientType: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let salesQuery = ctx.db.query("sales");
        if (args.shopId) salesQuery = salesQuery.filter(q => q.eq(q.field("shopId"), args.shopId!));
        if (args.clientType && args.clientType !== "All") salesQuery = salesQuery.filter(q => q.eq(q.field("clientType"), args.clientType!));
        if (args.startDate && args.endDate) {
            const endStr = args.endDate + "T23:59:59.999";
            salesQuery = salesQuery.filter(q => q.and(q.gte(q.field("date"), args.startDate!), q.lte(q.field("date"), endStr)));
        }
        const sales = await salesQuery.collect();
        return sales.length;
    }
});

export const getLoanSummary = query({
    args: {
        paginationOpts: paginationOptsValidator,
        customerId: v.optional(v.id("customers")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let loanQuery = ctx.db.query("loans");
        if (args.customerId) {
            loanQuery = loanQuery.filter(q => q.eq(q.field("customerId"), args.customerId!));
        }

        if (args.startDate && args.endDate) {
            const startStr = args.startDate;
            const endStr = args.endDate + "T23:59:59.999";
            loanQuery = loanQuery.filter(q =>
                q.and(
                    q.gte(q.field("date"), startStr),
                    q.lte(q.field("date"), endStr)
                )
            );
        }

        const results = await loanQuery.order("desc").paginate(args.paginationOpts);

        const page = await Promise.all(results.page.map(async l => {
            const customer = await ctx.db.get(l.customerId);
            const sale = await ctx.db.get(l.salesId);
            return {
                ...l,
                customerName: customer?.name || "Unknown",
                customerPhone: customer?.phone || "-",
                date: l.date || sale?.date || "-",
                items: sale?.items || [],
                clientType: sale?.clientType || "Unknown",
                paymentMode: sale?.paymentMode || "Loan",
                totalAmount: sale?.total || l.amount || 0,
                dueDate: sale?.paymentDueDate || undefined
            };
        }));

        return { ...results, page };
    }
});

export const getLoanSummaryCount = query({
    args: {
        customerId: v.optional(v.id("customers")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let loanQuery = ctx.db.query("loans");
        if (args.customerId) loanQuery = loanQuery.filter(q => q.eq(q.field("customerId"), args.customerId!));
        if (args.startDate && args.endDate) {
            const endStr = args.endDate + "T23:59:59.999";
            loanQuery = loanQuery.filter(q => q.and(q.gte(q.field("date"), args.startDate!), q.lte(q.field("date"), endStr)));
        }
        const loans = await loanQuery.collect();
        return loans.length;
    }
});

export const summaryStats = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let salesQuery = ctx.db.query("sales");
        if (args.startDate) salesQuery = salesQuery.filter(q => q.gte(q.field("date"), args.startDate!));
        if (args.endDate) salesQuery = salesQuery.filter(q => q.lte(q.field("date"), args.endDate! + "T23:59:59.999"));

        const sales = await salesQuery.collect();
        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalPV = sales.reduce((sum, s) => {
            return sum + s.items.reduce((itemSum, item) => itemSum + (item.pv || 0) * item.quantity, 0);
        }, 0);
        const totalBV = sales.reduce((sum, s) => {
            return sum + s.items.reduce((itemSum, item) => itemSum + (item.bv || 0) * item.quantity, 0);
        }, 0);

        let expensesQuery = ctx.db.query("expenses");
        if (args.startDate) expensesQuery = expensesQuery.filter(q => q.gte(q.field("date"), args.startDate!));
        if (args.endDate) expensesQuery = expensesQuery.filter(q => q.lte(q.field("date"), args.endDate! + "T23:59:59.999"));
        const expenses = await expensesQuery.collect();
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

        let loansQuery = ctx.db.query("loans");
        if (args.startDate) loansQuery = loansQuery.filter(q => q.gte(q.field("date"), args.startDate!));
        if (args.endDate) loansQuery = loansQuery.filter(q => q.lte(q.field("date"), args.endDate! + "T23:59:59.999"));
        const loans = await loansQuery.collect();
        const totalLoansBalance = loans.reduce((sum, l) => sum + l.balance, 0);

        return {
            totalRevenue,
            totalPV,
            totalBV,
            totalExpenses,
            totalLoansBalance,
            salesCount: sales.length,
        };
    }
});

export const getShopSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const shops = await ctx.db.query("shops").collect();

        let salesQuery = ctx.db.query("sales");
        if (args.startDate) salesQuery = salesQuery.filter(q => q.gte(q.field("date"), args.startDate!));
        if (args.endDate) salesQuery = salesQuery.filter(q => q.lte(q.field("date"), args.endDate! + "T23:59:59.999"));

        const sales = await salesQuery.collect();

        const summary = shops.map(shop => {
            const shopSales = sales.filter(s => s.shopId === shop._id);
            return {
                id: shop._id,
                name: shop.name,
                location: shop.location,
                totalSales: shopSales.reduce((sum, s) => sum + s.total, 0),
                transactionCount: shopSales.length,
                lastSaleDate: shopSales.length > 0 ? shopSales.sort((a, b) => b.date.localeCompare(a.date))[0].date : null
            };
        });

        return summary;
    }
});

export const getStockSummary = query({
    args: {
        paginationOpts: paginationOptsValidator,
    },
    handler: async (ctx, args) => {
        const results = await ctx.db.query("stocks").paginate(args.paginationOpts);
        const shops = await ctx.db.query("shops").collect();

        const shopStockMap: Record<string, number> = {};
        shops.forEach(shop => {
            shop.issuedStocks.forEach(is => {
                shopStockMap[is.stockId] = (shopStockMap[is.stockId] || 0) + is.qty;
            });
        });

        const page = results.page.map(stock => ({
            ...stock,
            hqQty: stock.qty,
            shopQty: shopStockMap[stock._id] || 0,
            totalQty: stock.qty + (shopStockMap[stock._id] || 0)
        }));

        return { ...results, page };
    }
});

export const getStockSummaryCount = query({
    args: {},
    handler: async (ctx) => {
        return (await ctx.db.query("stocks").collect()).length;
    }
});
