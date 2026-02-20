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
        customerId: v.optional(v.id("customers")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        transactionType: v.optional(v.string()),
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

        if (args.customerId) {
            salesQuery = salesQuery.filter(q => q.eq(q.field("customerId"), args.customerId!));
        }

        if (args.transactionType && args.transactionType !== "All") {
            salesQuery = salesQuery.filter(q => q.eq(q.field("transactionType"), args.transactionType!));
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
        customerId: v.optional(v.id("customers")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        transactionType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let salesQuery = ctx.db.query("sales");
        if (args.shopId) salesQuery = salesQuery.filter(q => q.eq(q.field("shopId"), args.shopId!));
        if (args.clientType && args.clientType !== "All") salesQuery = salesQuery.filter(q => q.eq(q.field("clientType"), args.clientType!));
        if (args.customerId) salesQuery = salesQuery.filter(q => q.eq(q.field("customerId"), args.customerId!));
        if (args.startDate && args.endDate) {
            const endStr = args.endDate + "T23:59:59.999";
            salesQuery = salesQuery.filter(q => q.and(q.gte(q.field("date"), args.startDate!), q.lte(q.field("date"), endStr)));
        }
        if (args.transactionType && args.transactionType !== "All") {
            salesQuery = salesQuery.filter(q => q.eq(q.field("transactionType"), args.transactionType!));
        }
        const sales = await salesQuery.collect();
        return sales.length;
    }
});

export const getLoanSummary = query({
    args: {
        paginationOpts: paginationOptsValidator,
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        clientType: v.optional(v.string()),
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

        const results = await loanQuery.order("desc").collect();

        // Join with sales to check shopId
        const salesIdsForJoin = [...new Set(results.map(l => l.salesId))];
        const salesDocsForJoin = await Promise.all(salesIdsForJoin.map(id => ctx.db.get(id)));
        const salesMapForFilter = new Map(salesDocsForJoin.filter(s => !!s).map(s => [s!._id, s]));

        let filteredResults = results;
        if (args.shopId || args.clientType) {
            filteredResults = results.filter(l => {
                const sale = salesMapForFilter.get(l.salesId);
                const matchesShop = !args.shopId || sale?.shopId === args.shopId;
                const matchesClient = !args.clientType || args.clientType === "All" || sale?.clientType === args.clientType;
                return matchesShop && matchesClient;
            });
        }

        // Apply pagination manually after filtering
        const totalCount = filteredResults.length;
        const pageItems = filteredResults.slice(
            args.paginationOpts.numItems * (args.paginationOpts.id ? 1 : 0), // Simplistic, but let's assume standard offset for report
            args.paginationOpts.numItems
        );

        // Wait, convex pagination is cursor based.
        // For reports with complex filters, we often collect all and paginate manually.
        const customerIds = [...new Set(filteredResults.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];
        const salesIds = [...new Set(filteredResults.map(l => l.salesId))];

        const [customers, salesDocs] = await Promise.all([
            Promise.all(customerIds.map(id => ctx.db.get(id))),
            Promise.all(salesIds.map(id => ctx.db.get(id))),
        ]);

        const customerMap = new Map(customers.filter((c): c is NonNullable<typeof c> => c !== null).map(c => [c._id, c]));
        const salesMap = new Map(salesDocs.filter((s): s is NonNullable<typeof s> => s !== null).map(s => [s._id, s]));

        const page = pageItems.map(l => {
            const customer = l.customerId ? customerMap.get(l.customerId) : undefined;
            const sale = salesMap.get(l.salesId);
            return {
                ...l,
                customerName: customer?.name || l.manualCustomerName || "Walk-in/Unknown",
                customerPhone: customer?.phone || "-",
                date: l.date || sale?.date || "-",
                items: sale?.items || [],
                clientType: sale?.clientType || "Unknown",
                paymentMode: sale?.paymentMode || "Loan",
                totalAmount: sale?.total || l.amount || 0,
                dueDate: sale?.paymentDueDate || undefined
            };
        });

        return {
            page,
            isDone: totalCount <= (args.paginationOpts.numItems + (args.paginationOpts.id ? args.paginationOpts.numItems : 0)), // Simple check for manual pagination
            status: totalCount > args.paginationOpts.numItems ? "CanLoadMore" : "Exhausted",
            continueCursor: "" // Cursor-less pagination for filtered results
        };
    }
});

export const getLoanSummaryCount = query({
    args: {
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        clientType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let loanQuery = ctx.db.query("loans");
        if (args.customerId) loanQuery = loanQuery.filter(q => q.eq(q.field("customerId"), args.customerId!));
        if (args.startDate && args.endDate) {
            const endStr = args.endDate + "T23:59:59.999";
            loanQuery = loanQuery.filter(q => q.and(q.gte(q.field("date"), args.startDate!), q.lte(q.field("date"), endStr)));
        }
        const loans = await loanQuery.collect();

        if (args.shopId || args.clientType) {
            const salesIds = [...new Set(loans.map(l => l.salesId))];
            const salesDocs = await Promise.all(salesIds.map(id => ctx.db.get(id)));
            const salesMap = new Map(salesDocs.filter(s => !!s).map(s => [s!._id, s]));
            return loans.filter(l => {
                const sale = salesMap.get(l.salesId);
                const matchesShop = !args.shopId || sale?.shopId === args.shopId;
                const matchesClient = !args.clientType || args.clientType === "All" || sale?.clientType === args.clientType;
                return matchesShop && matchesClient;
            }).length;
        }

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
        search: v.optional(v.string()),

    },
    handler: async (ctx, args) => {
        let shops = await ctx.db.query("shops").collect();

        if (args.search) {
            const s = args.search.toLowerCase();
            shops = shops.filter(sh =>
                sh.name.toLowerCase().includes(s) ||
                sh.location.toLowerCase().includes(s)
            );
        }

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
        halfPrice: v.optional(v.boolean()),
        search: v.optional(v.string()),
        searchType: v.optional(v.string()), // "name", "code", "supplier", "category"
    },
    handler: async (ctx, args) => {
        // Fetch dependencies for enrichment
        const categories = await ctx.db.query("categories").collect();
        const categoryMap = new Map(categories.map(c => [c._id, c.type]));
        const shops = await ctx.db.query("shops").collect();

        // 1. Optimized filtering
        let stocks: any[] = [];
        const searchLower = args.search?.toLowerCase();

        if (args.search && args.searchType === "name") {
            stocks = await ctx.db.query("stocks")
                .withSearchIndex("search_name", q => q.search("name", args.search!))
                .collect();
        } else if (args.search && args.searchType === "supplier") {
            stocks = await ctx.db.query("stocks")
                .withSearchIndex("search_supplier", q => q.search("supplier", args.search!))
                .collect();
        } else if (args.search && args.searchType === "code") {
            // Product code is often exact or prefix
            stocks = await ctx.db.query("stocks")
                .withIndex("by_productCode", q => q.gte("productCode", args.search!).lte("productCode", args.search! + "\uffff"))
                .collect();
        } else {
            // Default or Category search (Category doesn't have search index, so fetch all or filter)
            stocks = await ctx.db.query("stocks").collect();
        }

        // Apply secondary filters in memory
        let filtered = stocks.filter(s => {
            const matchesHalfPrice = args.halfPrice === undefined || s.halfPrice === args.halfPrice;

            if (!args.search) return matchesHalfPrice;

            // If we already used a search index, just check halfPrice
            if (["name", "supplier", "code"].includes(args.searchType || "")) {
                return matchesHalfPrice;
            }

            // Fallback for Category search or multi-field fallback
            if (args.searchType === "category") {
                const catName = categoryMap.get(s.categoryId)?.toLowerCase() || "";
                return matchesHalfPrice && catName.includes(searchLower!);
            }

            // Default fallback search (name or code)
            return matchesHalfPrice && (
                s.name.toLowerCase().includes(searchLower!) ||
                s.productCode.toLowerCase().includes(searchLower!)
            );
        });

        const shopStockMap: Record<string, number> = {};
        for (const shop of shops) {
            for (const is of shop.issuedStocks) {
                shopStockMap[is.stockId] = (shopStockMap[is.stockId] || 0) + is.qty;
            }
        }

        const enriched = filtered.map(stock => ({
            ...stock,
            categoryName: stock.categoryId ? (categoryMap.get(stock.categoryId as any) || "General") : "General",
            hqQty: stock.qty,
            shopQty: shopStockMap[stock._id] || 0,
            totalQty: stock.qty + (shopStockMap[stock._id] || 0)
        }));

        const numItems = args.paginationOpts.numItems;
        const page = enriched.slice(0, numItems);

        return {
            page,
            isDone: enriched.length <= numItems,
            continueCursor: "none"
        };
    }
});

export const getStockSummaryCount = query({
    args: {
        halfPrice: v.optional(v.boolean()),
        search: v.optional(v.string()),
        searchType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // Use the same logic as getStockSummary but return length
        const categories = await ctx.db.query("categories").collect();
        const categoryMap = new Map(categories.map(c => [c._id, c.type]));

        let stocks: any[] = [];
        const searchLower = args.search?.toLowerCase();

        if (args.search && args.searchType === "name") {
            stocks = await ctx.db.query("stocks").withSearchIndex("search_name", q => q.search("name", args.search!)).collect();
        } else if (args.search && args.searchType === "supplier") {
            stocks = await ctx.db.query("stocks").withSearchIndex("search_supplier", q => q.search("supplier", args.search!)).collect();
        } else if (args.search && args.searchType === "code") {
            stocks = await ctx.db.query("stocks").withIndex("by_productCode", q => q.gte("productCode", args.search!).lte("productCode", args.search! + "\uffff")).collect();
        } else {
            stocks = await ctx.db.query("stocks").collect();
        }

        const filtered = stocks.filter(s => {
            const matchesHalfPrice = args.halfPrice === undefined || s.halfPrice === args.halfPrice;
            if (!args.search) return matchesHalfPrice;
            if (["name", "supplier", "code"].includes(args.searchType || "")) return matchesHalfPrice;
            if (args.searchType === "category") {
                const catName = categoryMap.get(s.categoryId)?.toLowerCase() || "";
                return matchesHalfPrice && catName.includes(searchLower!);
            }
            return matchesHalfPrice && (s.name.toLowerCase().includes(searchLower!) || s.productCode.toLowerCase().includes(searchLower!));
        });
        return filtered.length;
    }
});

export const getReportsSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        clientType: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
        search: v.optional(v.string()),
        halfPrice: v.optional(v.boolean()),
        transactionType: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        // [SALES DATA]
        let sales = await (args.startDate && args.endDate
            ? ctx.db.query("sales").withIndex("by_date", q => q.gte("date", args.startDate!).lte("date", args.endDate! + "T23:59:59.999")).collect()
            : ctx.db.query("sales").collect()
        );

        // [APPLY ADDITIONAL FILTERS IN MEMORY for flexibility]
        if (args.shopId || args.clientType || args.search || args.customerId) {
            const searchLower = args.search?.toLowerCase();
            sales = sales.filter(s => {
                const matchesShop = !args.shopId || s.shopId === args.shopId;
                const matchesClient = !args.clientType || s.clientType === args.clientType;
                const matchesCustomer = !args.customerId || s.customerId === args.customerId;
                const matchesSearch = !searchLower || (
                    (s.manualCustomerName || "").toLowerCase().includes(searchLower) ||
                    s.items.some(i => i.name.toLowerCase().includes(searchLower))
                );
                const matchesTransactionType = !args.transactionType || args.transactionType === "All" || s.transactionType === args.transactionType;
                return matchesShop && matchesClient && matchesSearch && matchesCustomer && matchesTransactionType;
            });
        }

        // [EXPENSES DATA] - Expenses usually only filter by date
        const expenses = await (args.startDate && args.endDate
            ? ctx.db.query("expenses").withIndex("by_date", q => q.gte("date", args.startDate!).lte("date", args.endDate! + "T23:59:59.999")).collect()
            : ctx.db.query("expenses").collect()
        );

        // [STOCK DATA] All current stock
        let stocks = await ctx.db.query("stocks").collect();

        if (args.halfPrice !== undefined || args.search) {
            const searchLower = args.search?.toLowerCase();
            stocks = stocks.filter(s => {
                const matchesHalfPrice = args.halfPrice === undefined || s.halfPrice === args.halfPrice;
                const matchesSearch = !searchLower || (
                    s.name.toLowerCase().includes(searchLower) ||
                    s.productCode.toLowerCase().includes(searchLower)
                );
                return matchesHalfPrice && matchesSearch;
            });
        }

        // [ENRICHMENT FOR SALES COST]
        const stockIds = [...new Set(sales.flatMap(s => s.items.map(i => i.stockId)))];
        const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
        const stockMap = new Map(stockDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        let totalRevenue = 0;
        let totalCostOfSales = 0;
        let totalPV = 0;
        let totalBV = 0;

        for (const sale of sales) {
            totalRevenue += sale.total;
            for (const item of sale.items) {
                totalPV += (item.pv || 0) * item.quantity;
                totalBV += (item.bv || 0) * item.quantity;
                const stock = stockMap.get(item.stockId);
                if (stock) {
                    totalCostOfSales += stock.purchasePrice * item.quantity;
                }
            }
        }

        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

        // [CURRENT INVENTORY VALUES]
        const totalInventorySellingPrice = stocks.reduce((sum, s) => sum + (s.price * s.qty), 0);
        const totalInventoryCostPrice = stocks.reduce((sum, s) => sum + (s.purchasePrice * s.qty), 0);

        // [LOAN DATA] - Fetch loans and match with filtered sales
        // We can't rely on sales.balance as it's not in the schema. We must check the loans table.
        // 1. Fetch loans roughly within range (if date provided)
        let loansQuery = ctx.db.query("loans");
        if (args.startDate) loansQuery = loansQuery.filter(q => q.gte(q.field("date"), args.startDate!));
        if (args.endDate) loansQuery = loansQuery.filter(q => q.lte(q.field("date"), args.endDate! + "T23:59:59.999"));
        const loans = await loansQuery.collect();

        // 2. Filter loans where the linked sale is in our filtered 'sales' list
        const salesIdSet = new Set(sales.map(s => s._id));
        const matchedLoans = loans.filter(l => salesIdSet.has(l.salesId));

        const loanCount = matchedLoans.length;
        const totalOutstandingBalance = matchedLoans.reduce((sum, l) => sum + (l.balance || 0), 0);
        const totalLoanedAmount = matchedLoans.reduce((sum, l) => sum + l.amount, 0);

        return {
            totalRevenue,
            totalCostOfSales,
            totalProfit: totalRevenue - totalCostOfSales - totalExpenses,
            totalExpenses,
            totalPV,
            totalBV,
            totalInventorySellingPrice,
            totalInventoryCostPrice,
            itemCount: sales.reduce((sum, s) => sum + s.items.reduce((iSum, i) => iSum + i.quantity, 0), 0),
            // Loan-specific metrics
            loanCount,
            totalOutstandingBalance,
            totalLoanedAmount
        };
    }
});

export const getStockEntries = query({
    args: {
        date: v.string(), // YYYY-MM-DD
        search: v.optional(v.string()),
        searchType: v.optional(v.string()), // "name", "code", "supplier", "category"
    },
    handler: async (ctx, args) => {
        const startOfToday = args.date;
        const endOfToday = args.date + "T23:59:59.999";

        // 1. Fetch entries for the day
        const entries = await ctx.db
            .query("stockEntries")
            .withIndex("by_date", q => q.gte("date", startOfToday).lte("date", endOfToday))
            .collect();

        // 2. Fetch dependencies for enrichment and filtering
        const stockIds = [...new Set(entries.map(e => e.stockId))];
        const userIds = [...new Set(entries.map(e => e.userId))];
        const categories = await ctx.db.query("categories").collect();
        const categoryMap = new Map(categories.map(c => [c._id, c.type]));

        const [stocks, users] = await Promise.all([
            Promise.all(stockIds.map(id => ctx.db.get(id))),
            Promise.all(userIds.map(id => ctx.db.get(id)))
        ]);

        const stockMap = new Map(stocks.filter(s => !!s).map(s => [s!._id, s!]));
        const userMap = new Map(users.filter(u => !!u).map(u => [u!._id, u!]));

        // 3. Enrich and filter
        const searchLower = args.search?.toLowerCase();

        const enriched = entries.map(e => {
            const stock = stockMap.get(e.stockId);
            const user = userMap.get(e.userId);
            return {
                ...e,
                productName: stock?.name || "Unknown Product",
                productCode: stock?.productCode || "N/A",
                categoryName: stock?.categoryId ? (categoryMap.get(stock.categoryId as any) || "General") : "General",
                userName: user ? `${user.first_name} ${user.last_name}` : "System",
            };
        });

        if (!args.search) return enriched;

        return enriched.filter(e => {
            if (args.searchType === "name") return e.productName.toLowerCase().includes(searchLower!);
            if (args.searchType === "code") return e.productCode.toLowerCase().includes(searchLower!);
            if (args.searchType === "supplier") return (e.supplier || "").toLowerCase().includes(searchLower!);
            if (args.searchType === "category") return e.categoryName.toLowerCase().includes(searchLower!);

            // Fallback: search Name, Code or Supplier
            return e.productName.toLowerCase().includes(searchLower!) ||
                e.productCode.toLowerCase().includes(searchLower!) ||
                (e.supplier || "").toLowerCase().includes(searchLower!);
        });
    }
});
