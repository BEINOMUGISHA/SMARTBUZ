import { v } from "convex/values";
import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id } from "./_generated/dataModel";

export const getDailyProfitLoss = query({
    args: { date: v.string() }, // ISO String or YYYY-MM-DD
    handler: async (ctx, args) => {
        const targetDate = args.date.split("T")[0];

        // [OPTIMIZED with Index]
        const daySales = await ctx.db
            .query("sales")
            .withIndex("by_date", (q) => q.gte("date", targetDate).lte("date", targetDate + "\uffff"))
            .collect();

        let totalRevenue = 0;
        let totalCost = 0;

        // [BATCH FETCH] Collect all unique stock IDs first
        const stockIds = [...new Set(daySales.flatMap(s => s.items.map(i => i.stockId)))];
        const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
        const stockMap = new Map(stockDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        for (const sale of daySales) {
            totalRevenue += sale.total;
            for (const item of sale.items) {
                const stock = stockMap.get(item.stockId);
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

        // [OPTIMIZED with Index]
        const monthSales = await ctx.db
            .query("sales")
            .withIndex("by_date", (q) => q.gte("date", prefix).lte("date", prefix + "\uffff"))
            .collect();

        let totalRevenue = 0;
        let totalCost = 0;

        // [BATCH FETCH] Collect all unique stock IDs first
        const stockIds = [...new Set(monthSales.flatMap(s => s.items.map(i => i.stockId)))];
        const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
        const stockMap = new Map(stockDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        for (const sale of monthSales) {
            totalRevenue += sale.total;
            for (const item of sale.items) {
                const stock = stockMap.get(item.stockId);
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
        // [OPTIMIZED with Index]
        const sales = await ctx.db
            .query("sales")
            .withIndex("by_date", (q) =>
                q.gte("date", args.startDate).lte("date", args.endDate)
            )
            .collect();

        const expenses = await ctx.db
            .query("expenses")
            .withIndex("by_date", (q) =>
                q.gte("date", args.startDate).lte("date", args.endDate)
            )
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
        // [OPTIMIZED with Index Search]
        let salesQuery;

        if (args.shopId) {
            if (args.startDate && args.endDate) {
                const endStr = args.endDate + "T23:59:59.999";
                salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q =>
                    q.eq("shopId", args.shopId!).gte("date", args.startDate!).lte("date", endStr)
                );
            } else {
                salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q =>
                    q.eq("shopId", args.shopId!)
                );
            }
        } else if (args.startDate && args.endDate) {
            const endStr = args.endDate + "T23:59:59.999";
            salesQuery = ctx.db.query("sales").withIndex("by_date", q =>
                q.gte("date", args.startDate!).lte("date", endStr)
            );
        } else {
            salesQuery = ctx.db.query("sales");
        }

        // Apply secondary filters
        if (args.clientType && args.clientType !== "All") {
            salesQuery = salesQuery.filter(q => q.eq(q.field("clientType"), args.clientType!));
        }

        const results = await salesQuery.order("desc").paginate(args.paginationOpts);

        // [OPTIMIZED] Enrichment Map Pattern
        const customerIds = [...new Set(results.page.map(s => s.customerId).filter((id): id is Id<"customers"> => !!id))];
        const shopIds = [...new Set(results.page.map(s => s.shopId).filter((id): id is Id<"shops"> => !!id))];

        const [customers, shops] = await Promise.all([
            Promise.all(customerIds.map(id => ctx.db.get(id))),
            Promise.all(shopIds.map(id => ctx.db.get(id))),
        ]);

        const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));
        const shopMap = new Map(shops.filter(s => s !== null).map(s => [s!._id, s]));

        const page = results.page.map(s => {
            const customer = s.customerId ? (customerMap.get(s.customerId) ?? null) : null;
            const shop = s.shopId ? (shopMap.get(s.shopId) ?? null) : null;
            return {
                ...s,
                customerName: customer?.name || s.manualCustomerName || "Walk-in",
                shopName: shop?.name || "Main Warehouse"
            };
        });

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

        // [OPTIMIZED with Enrichment Map]
        const customerIds = [...new Set(results.page.map(l => l.customerId))];
        const salesIds = [...new Set(results.page.map(l => l.salesId))];

        const [customers, salesDocs] = await Promise.all([
            Promise.all(customerIds.map(id => ctx.db.get(id))),
            Promise.all(salesIds.map(id => ctx.db.get(id))),
        ]);

        const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));
        const salesMap = new Map(salesDocs.filter(s => s !== null).map(s => [s!._id, s]));

        const page = results.page.map(l => {
            const customer = customerMap.get(l.customerId);
            const sale = salesMap.get(l.salesId);
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
        });

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
        // [OPTIMIZED with Index Search]
        let salesQuery;
        if (args.startDate && args.endDate) {
            salesQuery = ctx.db.query("sales").withIndex("by_date", q =>
                q.gte("date", args.startDate!).lte("date", args.endDate! + "T23:59:59.999")
            );
        } else if (args.startDate) {
            salesQuery = ctx.db.query("sales").withIndex("by_date", q =>
                q.gte("date", args.startDate!)
            );
        } else if (args.endDate) {
            salesQuery = ctx.db.query("sales").withIndex("by_date", q =>
                q.lte("date", args.endDate! + "T23:59:59.999")
            );
        } else {
            salesQuery = ctx.db.query("sales");
        }
        const sales = await salesQuery.collect();
        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalPV = sales.reduce((sum, s) => {
            return sum + s.items.reduce((itemSum, item) => itemSum + (item.pv || 0) * item.quantity, 0);
        }, 0);
        const totalBV = sales.reduce((sum, s) => {
            return sum + s.items.reduce((itemSum, item) => itemSum + (item.bv || 0) * item.quantity, 0);
        }, 0);

        let expensesQuery;
        if (args.startDate && args.endDate) {
            expensesQuery = ctx.db.query("expenses").withIndex("by_date", q =>
                q.gte("date", args.startDate!).lte("date", args.endDate! + "T23:59:59.999")
            );
        } else if (args.startDate) {
            expensesQuery = ctx.db.query("expenses").withIndex("by_date", q =>
                q.gte("date", args.startDate!)
            );
        } else if (args.endDate) {
            expensesQuery = ctx.db.query("expenses").withIndex("by_date", q =>
                q.lte("date", args.endDate! + "T23:59:59.999")
            );
        } else {
            expensesQuery = ctx.db.query("expenses");
        }
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

        // Efficiently compute shop stock via map
        const shopStockMap: Record<string, number> = {};
        for (const shop of shops) {
            for (const is of shop.issuedStocks) {
                shopStockMap[is.stockId] = (shopStockMap[is.stockId] || 0) + is.qty;
            }
        }

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
