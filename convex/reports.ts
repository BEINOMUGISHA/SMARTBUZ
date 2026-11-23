import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { requirePermission, requireTenant } from "./tenancy";
import { query, type QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Doc, Id } from "./_generated/dataModel";
import {
    buildCostIndexForPeriod,
    businessDayBounds,
    loadSales,
    money,
    summariseSales,
} from "./financeCore";

/* ────────────────────────────────────────────────────────────────────────
 * Reading a report's period
 *
 * A report is asked for a period, or it is not. Either way the period is
 * asked of the index, so the rows outside it are never fetched.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The last moment of a day, as an ISO string.
 *
 * A period includes the day it ends on, so the upper bound of a range is
 * the end of its last day rather than the start of it.
 */
function endOfDay(day: string): string {
    return `${day}T23:59:59.999Z`;
}

/**
 * The sales of a business inside the period a report asks for.
 *
 * A report that gives one end of the range is still a bounded read. It
 * used to be read whole — every sale the business ever made — and then no
 * date filter was applied to what came back, so "everything from March
 * onwards" came back as "everything". Only a report that asks for no
 * period at all reads everything, which is what it asked for.
 */
async function salesForPeriod(
    ctx: QueryCtx,
    businessId: Id<"businesses">,
    startDate?: string,
    endDate?: string
): Promise<Doc<"sales">[]> {
    if (startDate && endDate) {
        return ctx.db
            .query("sales")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    if (startDate) {
        return ctx.db
            .query("sales")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate)
            )
            .collect();
    }
    if (endDate) {
        return ctx.db
            .query("sales")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    // all-time: the caller asked for no period at all, so it is owed every
    // row the business has.
    return ctx.db
        .query("sales")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();
}

/** The expenses of a business inside the period a report asks for. */
async function expensesForPeriod(
    ctx: QueryCtx,
    businessId: Id<"businesses">,
    startDate?: string,
    endDate?: string
): Promise<Doc<"expenses">[]> {
    if (startDate && endDate) {
        return ctx.db
            .query("expenses")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    if (startDate) {
        return ctx.db
            .query("expenses")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate)
            )
            .collect();
    }
    if (endDate) {
        return ctx.db
            .query("expenses")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    // all-time: the caller asked for no period at all, so it is owed every
    // row the business has.
    return ctx.db
        .query("expenses")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();
}

/**
 * The loans of a business inside the period a report asks for.
 *
 * These were read through the business's index and filtered on the date
 * afterwards. The filter ran on the server, so the rows were fetched and
 * then thrown away; the debt book's own date index asks for the period
 * instead.
 */
async function loansForPeriod(
    ctx: QueryCtx,
    businessId: Id<"businesses">,
    startDate?: string,
    endDate?: string
): Promise<Doc<"loans">[]> {
    if (startDate && endDate) {
        return ctx.db
            .query("loans")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    if (startDate) {
        return ctx.db
            .query("loans")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate)
            )
            .collect();
    }
    if (endDate) {
        return ctx.db
            .query("loans")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    // all-time: the caller asked for no period at all, so it is owed every
    // row the business has.
    return ctx.db
        .query("loans")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();
}

/**
 * The payments of a business inside the period a report asks for.
 *
 * These were read through the business's index and filtered on the date
 * afterwards. The filter ran on the server, so the rows were fetched and
 * then thrown away, and a report that gave only one end of the range had
 * no filter at all — "everything since March" came back as "everything".
 */
async function paymentsForPeriod(
    ctx: QueryCtx,
    businessId: Id<"businesses">,
    startDate?: string,
    endDate?: string
): Promise<Doc<"payments">[]> {
    if (startDate && endDate) {
        return ctx.db
            .query("payments")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    if (startDate) {
        return ctx.db
            .query("payments")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", startDate)
            )
            .collect();
    }
    if (endDate) {
        return ctx.db
            .query("payments")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).lte("date", endOfDay(endDate))
            )
            .collect();
    }
    // all-time: the caller asked for no period at all, so it is owed every
    // row the business has.
    return ctx.db
        .query("payments")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();
}

/**
 * The profit and loss of a day.
 *
 * The figures come from `convex/financeCore.ts`, which is where the rest of
 * the application's money is calculated from. This query used to work out
 * the figures on its own, and it got them wrong in three ways that the
 * shared core already handles:
 *
 *   • A refunded sale still counted as revenue. The core nets the refund
 *     back out, so a day with a refund in it reports what it actually
 *     brought in.
 *   • The cost of the goods was today's purchase price rather than the
 *     price the goods were bought at. Last month's profit therefore changed
 *     every time the owner restocked. The core resolves the cost from the
 *     cost history, falling back to the value recorded on the sale line.
 *   • The figures were not rounded, so floating-point noise reached the
 *     screen. The core rounds to two decimals.
 */
export const getDailyProfitLoss = query({
    args: { date: v.string(),
        businessId: v.optional(v.id("businesses")),
    }, // ISO String or YYYY-MM-DD
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        const targetDate = args.date.split("T")[0];

        const daySales = await loadSales(ctx, businessId, targetDate, targetDate);
        const costs = await buildCostIndexForPeriod(ctx, businessId, targetDate, targetDate);
        const totals = summariseSales(daySales, costs);

        return {
            date: targetDate,
            totalRevenue: money(totals.revenue),
            totalCost: money(totals.cost),
            totalProfit: money(totals.grossProfit),
            // The VAT charged that day, and the revenue without it. A
            // business that has to file a return needs both, and they come
            // from the sales themselves rather than from a rate applied
            // afterwards.
            totalVat: money(totals.vat),
            netRevenue: money(totals.netRevenue),
            salesCount: totals.transactions,
        };
    },
});

/**
 * The profit and loss of a month.
 *
 * As with the daily figure, the arithmetic comes from the shared core, so
 * the two reports and the dashboard cannot disagree.
 */
export const getMonthlyProfitLoss = query({
    args: { year: v.number(), month: v.number(),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");

        const month = String(args.month).padStart(2, "0");
        const lastDay = new Date(
            Date.UTC(args.year, args.month, 0)
        ).toISOString().slice(0, 10);

        const monthSales = await loadSales(
            ctx,
            businessId,
            `${args.year}-${month}-01`,
            lastDay
        );
        const costs = await buildCostIndexForPeriod(
            ctx,
            businessId,
            `${args.year}-${month}-01`,
            lastDay
        );
        const totals = summariseSales(monthSales, costs);

        return {
            year: args.year,
            month: args.month,
            totalRevenue: money(totals.revenue),
            totalCost: money(totals.cost),
            totalProfit: money(totals.grossProfit),
            totalVat: money(totals.vat),
            netRevenue: money(totals.netRevenue),
            salesCount: totals.transactions,
        };
    },
});

export const getSalesAndExpenses = query({
    args: { startDate: v.string(), endDate: v.string(),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");

        // The upper bound runs to the last millisecond of the end date.
        // Comparing against the bare date left out everything that happened
        // on that day, so a range that began and ended on the same day
        // showed nothing at all.
        const { start, end } = await businessDayBounds(ctx, businessId, args.startDate, args.endDate);

        const sales = await ctx.db
            .query("sales")
            .withIndex("by_businessId_date", (q) => q.eq("businessId", businessId).gte("date", start).lte("date", end))
            .collect();

        const expenses = await ctx.db
            .query("expenses")
            .withIndex("by_businessId_date", (q) => q.eq("businessId", businessId).gte("date", start).lte("date", end))
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // The period is asked of the index, so the rows outside it are never
        // fetched — and a report that gives one end of the range is still a
        // bounded read.
        let salesQuery;
        const endStr = args.endDate ? endOfDay(args.endDate) : undefined;

        if (args.shopId) {
            if (args.startDate && endStr) {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", args.shopId!).gte("date", args.startDate!).lte("date", endStr));
            } else if (args.startDate) {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", args.shopId!).gte("date", args.startDate!));
            } else if (endStr) {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", args.shopId!).lte("date", endStr));
            } else {
                salesQuery = ctx.db.query("sales").withIndex("by_businessId_shop_date", q => q.eq("businessId", businessId).eq("shopId", args.shopId!));
            }
        } else if (args.startDate && endStr) {
            salesQuery = ctx.db.query("sales").withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", args.startDate!).lte("date", endStr));
        } else if (args.startDate) {
            salesQuery = ctx.db.query("sales").withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", args.startDate!));
        } else if (endStr) {
            salesQuery = ctx.db.query("sales").withIndex("by_businessId_date", q => q.eq("businessId", businessId).lte("date", endStr));
        } else {
            salesQuery = ctx.db.query("sales").withIndex("by_businessId", q => q.eq("businessId", businessId));
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // The period is asked of the index, so the rows outside it are never
        // fetched. A report that gives one end of the range is still a
        // bounded read; only a report that asks for no period at all reads
        // everything.
        let sales;
        const endStr = args.endDate ? endOfDay(args.endDate) : undefined;

        if (args.startDate && endStr) {
            sales = await ctx.db.query("sales").withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", args.startDate!).lte("date", endStr)).collect();
        } else if (args.startDate) {
            sales = await ctx.db.query("sales").withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", args.startDate!)).collect();
        } else if (endStr) {
            sales = await ctx.db.query("sales").withIndex("by_businessId_date", q => q.eq("businessId", businessId).lte("date", endStr)).collect();
        } else {
            // all-time: the caller asked for no period at all, so it is owed
            // every row the business has.
            sales = await ctx.db.query("sales").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
        }

        // The remaining filters are on the sale itself, so they are applied
        // to what the index returned.
        if (args.shopId) sales = sales.filter(s => s.shopId === args.shopId);
        if (args.clientType && args.clientType !== "All") sales = sales.filter(s => s.clientType === args.clientType);
        if (args.customerId) sales = sales.filter(s => s.customerId === args.customerId);
        if (args.transactionType && args.transactionType !== "All") sales = sales.filter(s => s.transactionType === args.transactionType);

        return sales.length;
    }
});

// Dedicated summary stats for the Loans Report tab
export const getLoanReportSummary = query({
    args: {
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        clientType: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // The period is asked of the debt book's own date index, and the
        // customer is picked out of what that returns.
        let loans = await loansForPeriod(ctx, businessId, args.startDate, args.endDate);
        if (args.customerId) {
            loans = loans.filter(l => l.customerId === args.customerId);
        }

        // Join with sales for shop/clientType filtering and PV/BV calc
        const salesIds = [...new Set(loans.map(l => l.salesId))];
        const salesDocs = await Promise.all(salesIds.map(id => ctx.db.get(id)));
        const salesMap = new Map(salesDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        const filtered = loans.filter(l => {
            const sale = salesMap.get(l.salesId);
            const matchesShop = !args.shopId || sale?.shopId === args.shopId;
            const matchesClient = !args.clientType || args.clientType === "All" || sale?.clientType === args.clientType;
            return matchesShop && matchesClient;
        });

        let totalLoanedAmount = 0;
        let totalOutstandingBalance = 0;
        let totalPV = 0;
        let totalBV = 0;
        for (const loan of filtered) {
            totalLoanedAmount += loan.amount;
            totalOutstandingBalance += loan.balance || 0;
            const sale = salesMap.get(loan.salesId);
            if (sale) {
                for (const item of sale.items) {
                    totalPV += (item.pv || 0) * item.quantity;
                    totalBV += (item.bv || 0) * item.quantity;
                }
            }
        }

        return {
            totalRevenue: 0,
            totalCostOfSales: 0,
            totalProfit: 0,
            totalExpenses: 0,
            totalInventorySellingPrice: 0,
            totalInventoryCostPrice: 0,
            itemCount: 0,
            totalPV,
            totalBV,
            loanCount: filtered.length,
            totalLoanedAmount,
            totalOutstandingBalance,
        };
    },
});

export const getLoanSummary = query({
    args: {
        paginationOpts: paginationOptsValidator,
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        clientType: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // The period is asked of the debt book's own date index, and the
        // customer is picked out of what that returns.
        let loans = await loansForPeriod(ctx, businessId, args.startDate, args.endDate);
        if (args.customerId) {
            loans = loans.filter(l => l.customerId === args.customerId);
        }

        // The list was ordered by the newest first, which is the order the
        // rows were created in.
        const results = await loans
            .slice()
            .sort((a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0));

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

        // Enrich all filtered loans (client paginates the result)
        const customerIds = [...new Set(filteredResults.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];
        const salesIds = [...new Set(filteredResults.map(l => l.salesId))];

        const [customers, salesDocs] = await Promise.all([
            Promise.all(customerIds.map(id => ctx.db.get(id))),
            Promise.all(salesIds.map(id => ctx.db.get(id))),
        ]);

        const customerMap = new Map(customers.filter((c): c is NonNullable<typeof c> => c !== null).map(c => [c._id, c]));
        const salesMap = new Map(salesDocs.filter((s): s is NonNullable<typeof s> => s !== null).map(s => [s._id, s]));

        const page = filteredResults.map(l => {
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
            isDone: true,
            continueCursor: ""
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // The period is asked of the debt book's own date index, and the
        // customer is picked out of what that returns.
        let loans = await loansForPeriod(ctx, businessId, args.startDate, args.endDate);
        if (args.customerId) {
            loans = loans.filter(l => l.customerId === args.customerId);
        }

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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        const sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);
        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalPV = sales.reduce((sum, s) => {
            return sum + s.items.reduce((itemSum, item) => itemSum + (item.pv || 0) * item.quantity, 0);
        }, 0);
        const totalBV = sales.reduce((sum, s) => {
            return sum + s.items.reduce((itemSum, item) => itemSum + (item.bv || 0) * item.quantity, 0);
        }, 0);

        const expenses = await expensesForPeriod(ctx, businessId, args.startDate, args.endDate);
        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

        const loans = await loansForPeriod(ctx, businessId, args.startDate, args.endDate);
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let shops = await ctx.db.query("shops").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();

        if (args.search) {
            const s = args.search.toLowerCase();
            shops = shops.filter(sh =>
                sh.name.toLowerCase().includes(s) ||
                sh.location.toLowerCase().includes(s)
            );
        }

        let salesQuery = ctx.db.query("sales").withIndex("by_businessId", q => q.eq("businessId", businessId));
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
        searchType: v.optional(v.string()), // "name", "code", "supplier", "category",
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // Fetch dependencies for enrichment
        const categories = await ctx.db.query("categories").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
        const categoryMap = new Map(categories.map(c => [c._id, c.type]));
        const shops = await ctx.db.query("shops").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();

        // 1. Optimized filtering
        let stocks: any[] = [];
        const searchLower = args.search?.toLowerCase();

        if (args.search && args.searchType === "name") {
            stocks = await ctx.db.query("stocks")
                .withSearchIndex("search_name", q => q.search("name", args.search!)).filter(q => q.eq(q.field("businessId"), businessId)).collect();
        } else if (args.search && args.searchType === "supplier") {
            stocks = await ctx.db.query("stocks")
                .withSearchIndex("search_supplier", q => q.search("supplier", args.search!)).filter(q => q.eq(q.field("businessId"), businessId)).collect();
        } else if (args.search && args.searchType === "code") {
            // Product code is often exact or prefix
            stocks = await ctx.db.query("stocks")
                .withIndex("by_businessId_productCode", q => q.eq("businessId", businessId).gte("productCode", args.search!).lte("productCode", args.search! + "\uffff"))
                .collect();
        } else {
            // Default or Category search (Category doesn't have search index, so fetch all or filter)
            stocks = await ctx.db.query("stocks").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // Use the same logic as getStockSummary but return length
        const categories = await ctx.db.query("categories").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
        const categoryMap = new Map(categories.map(c => [c._id, c.type]));

        let stocks: any[] = [];
        const searchLower = args.search?.toLowerCase();

        if (args.search && args.searchType === "name") {
            stocks = await ctx.db.query("stocks").withSearchIndex("search_name", q => q.search("name", args.search!)).filter(q => q.eq(q.field("businessId"), businessId)).filter(q => q.eq(q.field("businessId"), businessId)).collect();
        } else if (args.search && args.searchType === "supplier") {
            stocks = await ctx.db.query("stocks").withSearchIndex("search_supplier", q => q.search("supplier", args.search!)).filter(q => q.eq(q.field("businessId"), businessId)).filter(q => q.eq(q.field("businessId"), businessId)).collect();
        } else if (args.search && args.searchType === "code") {
            stocks = await ctx.db.query("stocks").withIndex("by_businessId_productCode", q => q.eq("businessId", businessId).gte("productCode", args.search!).lte("productCode", args.search! + "\uffff")).collect();
        } else {
            stocks = await ctx.db.query("stocks").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // [SALES DATA]
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

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
        const expenses = await expensesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // [STOCK DATA] All current stock
        let stocks = await ctx.db.query("stocks").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();

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

        // The cost of the goods is resolved by the shared cost index below,
        // which knows what each product cost when it was bought — so there
        // is no need to read the current stock documents here.

        // -----------------------------------------------------------------
        // THE FIGURES COME FROM THE SHARED FINANCE HELPERS
        //
        // This summary used to add up `sale.total` without subtracting the
        // refunds, and to cost the goods at today's purchase price rather
        // than the price they were bought at. Both contradict the newer
        // reports, so the same owner looking at two screens saw two
        // different answers to "what did we make".
        //
        // Now both come from `financeCore` — the same helpers the analytics
        // and finance modules use — so there is one answer.
        // -----------------------------------------------------------------
        const costIndex = await buildCostIndexForPeriod(
            ctx,
            businessId,
            args.startDate,
            args.endDate
        );
        const totals = summariseSales(sales, costIndex);

        const totalRevenue = money(totals.revenue);
        const totalCostOfSales = money(totals.cost);

        let totalPV = 0;
        let totalBV = 0;
        for (const sale of sales) {
            for (const item of sale.items) {
                totalPV += (item.pv || 0) * item.quantity;
                totalBV += (item.bv || 0) * item.quantity;
            }
        }

        const totalExpenses = money(
            expenses.reduce((sum, e) => sum + (e.amount ?? 0), 0)
        );

        // [CURRENT INVENTORY VALUES]
        const totalInventorySellingPrice = stocks.reduce((sum, s) => sum + (s.price * s.qty), 0);
        const totalInventoryCostPrice = stocks.reduce((sum, s) => sum + (s.purchasePrice * s.qty), 0);

        // [LOAN DATA] - Fetch loans and match with filtered sales
        // We can't rely on sales.balance as it's not in the schema. We must check the loans table.
        // 1. Fetch loans roughly within range (if date provided)
        let loansQuery = ctx.db.query("loans").withIndex("by_businessId", q => q.eq("businessId", businessId));
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
        searchType: v.optional(v.string()), // "name", "code", "supplier", "category",
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        const startOfToday = args.date;
        const endOfToday = args.date + "T23:59:59.999";

        // 1. Fetch entries for the day
        const entries = await ctx.db
            .query("stockEntries")
            .withIndex("by_businessId", q => q.eq("businessId", businessId))
            .filter(q => q.and(q.gte(q.field("date"), startOfToday), q.lte(q.field("date"), endOfToday)))
            .collect();

        // 2. Fetch dependencies for enrichment and filtering
        const stockIds = [...new Set(entries.map(e => e.stockId))];
        const userIds = [...new Set(entries.map(e => e.userId))];
        const categories = await ctx.db.query("categories").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
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

// ============================================================
// EXPENSES REPORT
// ============================================================

// Expenses list with filters and enrichment
export const getExpensesReport = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        type: v.optional(v.string()),
        userId: v.optional(v.id("users")),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let expenses = await expensesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Sort by date desc
        expenses.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

        // Enrich with user info
        const userIds = [...new Set(expenses.map(e => e.userId).filter((id): id is Id<"users"> => !!id))];
        const users = await Promise.all(userIds.map(id => ctx.db.get(id)));
        const userMap = new Map(users.filter((u): u is NonNullable<typeof u> => !!u).map(u => [u._id, u]));

        let enriched = expenses.map(e => {
            const user = e.userId ? userMap.get(e.userId) : null;
            return {
                ...e,
                userName: user ? `${user.first_name} ${user.last_name}` : e.receivedBy || "System",
                userEmail: user?.email || "-",
            };
        });

        // Filter by type
        if (args.type) {
            enriched = enriched.filter(e => e.type === args.type);
        }

        // Filter by user
        if (args.userId) {
            enriched = enriched.filter(e => e.userId === args.userId);
        }

        // Search filter
        if (args.search) {
            const s = args.search.toLowerCase();
            enriched = enriched.filter(e =>
                e.expense.toLowerCase().includes(s) ||
                e.type.toLowerCase().includes(s) ||
                e.userName.toLowerCase().includes(s) ||
                e.receivedBy.toLowerCase().includes(s)
            );
        }

        return enriched;
    },
});

// Expenses summary with category breakdown
export const getExpensesReportSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        type: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let expenses = await expensesForPeriod(ctx, businessId, args.startDate, args.endDate);

        if (args.type) {
            expenses = expenses.filter(e => e.type === args.type);
        }

        const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
        const expenseCount = expenses.length;
        const avgExpense = expenseCount > 0 ? totalExpenses / expenseCount : 0;

        // Group by category (type)
        const categoryMap = new Map<string, number>();
        for (const e of expenses) {
            const current = categoryMap.get(e.type) || 0;
            categoryMap.set(e.type, current + e.amount);
        }

        const categories = Array.from(categoryMap.entries()).map(([type, total]) => ({ type, total }));

        // Sort categories by total desc
        categories.sort((a, b) => b.total - a.total);

        return {
            totalExpenses,
            expenseCount,
            avgExpense,
            categories,
        };
    },
});

// ============================================================
// PRODUCT PERFORMANCE REPORT
// ============================================================

// Product performance list with filters and enrichment
export const getProductPerformanceReport = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        // Aggregate product performance
        const productMap = new Map<string, any>();

        for (const sale of sales) {
            for (const item of sale.items) {
                const key = item.stockId;
                if (!productMap.has(key)) {
                    productMap.set(key, {
                        stockId: item.stockId,
                        productName: item.name,
                        productCode: item.productCode || "N/A",
                        totalQuantity: 0,
                        totalRevenue: 0,
                        totalPV: 0,
                        totalBV: 0,
                        saleCount: 0,
                    });
                }
                const product = productMap.get(key);
                product.totalQuantity += item.quantity;
                product.totalRevenue += item.quantity * item.price;
                product.totalPV += item.quantity * item.pv;
                product.totalBV += item.quantity * item.bv;
                product.saleCount += 1;
            }
        }

        // Convert to array and sort by revenue desc
        let products = Array.from(productMap.values());
        products.sort((a, b) => b.totalRevenue - a.totalRevenue);

        // Search filter
        if (args.search) {
            const s = args.search.toLowerCase();
            products = products.filter(p =>
                p.productName.toLowerCase().includes(s) ||
                p.productCode.toLowerCase().includes(s)
            );
        }

        return products;
    },
});

// Product performance summary with metrics
export const getProductPerformanceSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalSalesCount = sales.length;

        // Aggregate product performance
        const productMap = new Map<string, any>();

        for (const sale of sales) {
            for (const item of sale.items) {
                const key = item.stockId;
                if (!productMap.has(key)) {
                    productMap.set(key, {
                        stockId: item.stockId,
                        productName: item.name,
                        totalQuantity: 0,
                        totalRevenue: 0,
                        totalPV: 0,
                        totalBV: 0,
                    });
                }
                const product = productMap.get(key);
                product.totalQuantity += item.quantity;
                product.totalRevenue += item.quantity * item.price;
                product.totalPV += item.quantity * item.pv;
                product.totalBV += item.quantity * item.bv;
            }
        }

        const products = Array.from(productMap.values());
        const productCount = products.length;
        const topProduct = products.sort((a, b) => b.totalRevenue - a.totalRevenue)[0];

        const totalQuantity = products.reduce((sum, p) => sum + p.totalQuantity, 0);
        const totalPV = products.reduce((sum, p) => sum + p.totalPV, 0);
        const totalBV = products.reduce((sum, p) => sum + p.totalBV, 0);

        return {
            totalRevenue,
            totalSalesCount,
            productCount,
            totalQuantity,
            totalPV,
            totalBV,
            topProduct: topProduct ? {
                name: topProduct.productName,
                revenue: topProduct.totalRevenue,
                quantity: topProduct.totalQuantity,
            } : null,
        };
    },
});

// ============================================================
// CUSTOMER ANALYTICS REPORT
// ============================================================

// Customer analytics list with filters and enrichment
export const getCustomerAnalyticsReport = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        clientType: v.optional(v.string()),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        // Filter by client type
        if (args.clientType && args.clientType !== "All") {
            sales = sales.filter(s => s.clientType === args.clientType);
        }

        // Aggregate by customer
        const customerMap = new Map<Id<"customers">, any>();

        for (const sale of sales) {
            const customerId = sale.customerId;
            if (!customerId) continue;

            if (!customerMap.has(customerId)) {
                customerMap.set(customerId, {
                    customerId,
                    customerName: "Unknown",
                    customerPhone: "-",
                    clientType: sale.clientType || "Unknown",
                    totalPurchases: 0,
                    totalSpent: 0,
                    totalPV: 0,
                    totalBV: 0,
                    firstPurchaseDate: sale.date,
                    lastPurchaseDate: sale.date,
                    purchaseCount: 0,
                });
            }
            const customer = customerMap.get(customerId);
            customer.totalPurchases += 1;
            customer.totalSpent += sale.total;
            // Calculate PV/BV from items
            const itemPV = sale.items.reduce((sum, item) => sum + (item.pv * item.quantity), 0);
            const itemBV = sale.items.reduce((sum, item) => sum + (item.bv * item.quantity), 0);
            customer.totalPV += itemPV;
            customer.totalBV += itemBV;
            customer.purchaseCount += 1;

            if (sale.date < customer.firstPurchaseDate) {
                customer.firstPurchaseDate = sale.date;
            }
            if (sale.date > customer.lastPurchaseDate) {
                customer.lastPurchaseDate = sale.date;
            }
        }

        // Enrich with customer details
        const customerIds = Array.from(customerMap.keys());
        const customers = await Promise.all(customerIds.map(id => ctx.db.get(id)));
        const customerDetailsMap = new Map(customers.filter((c): c is NonNullable<typeof c> => !!c).map(c => [c._id, c]));

        for (const [customerId, data] of customerMap.entries()) {
            const details = customerDetailsMap.get(customerId);
            if (details) {
                data.customerName = details.name;
                data.customerPhone = details.phone || "-";
            }
        }

        // Convert to array and sort by spend desc
        let customersList = Array.from(customerMap.values());
        customersList.sort((a, b) => b.totalSpent - a.totalSpent);

        // Search filter
        if (args.search) {
            const s = args.search.toLowerCase();
            customersList = customersList.filter(c =>
                c.customerName.toLowerCase().includes(s) ||
                c.customerPhone.toLowerCase().includes(s)
            );
        }

        return customersList;
    },
});

// Customer analytics summary with metrics
export const getCustomerAnalyticsSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        clientType: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        // Filter by client type
        if (args.clientType && args.clientType !== "All") {
            sales = sales.filter(s => s.clientType === args.clientType);
        }

        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalSalesCount = sales.length;

        // Aggregate by customer
        const customerMap = new Map<Id<"customers">, any>();

        for (const sale of sales) {
            const customerId = sale.customerId;
            if (!customerId) continue;

            if (!customerMap.has(customerId)) {
                customerMap.set(customerId, {
                    totalSpent: 0,
                    purchaseCount: 0,
                    clientType: sale.clientType || "Unknown",
                });
            }
            const customer = customerMap.get(customerId);
            customer.totalSpent += sale.total;
            customer.purchaseCount += 1;
        }

        const customersList = Array.from(customerMap.values());
        const customerCount = customersList.length;
        const avgSpentPerCustomer = customerCount > 0 ? totalRevenue / customerCount : 0;
        const topCustomer = customersList.sort((a, b) => b.totalSpent - a.totalSpent)[0];

        // Count by client type
        const standardClientCount = customersList.filter(c => c.clientType === "Standard Client").length;
        const hpClientCount = customersList.filter(c => c.clientType === "HP Client").length;

        return {
            totalRevenue,
            totalSalesCount,
            customerCount,
            avgSpentPerCustomer,
            topCustomer: topCustomer ? {
                spent: topCustomer.totalSpent,
                purchases: topCustomer.purchaseCount,
            } : null,
            standardClientCount,
            hpClientCount,
        };
    },
});

// ============================================================
// USER/STAFF PERFORMANCE REPORT
// ============================================================

// User performance list with filters and enrichment
export const getUserPerformanceReport = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        // Aggregate by user
        const userMap = new Map<Id<"users">, any>();

        for (const sale of sales) {
            const userId = sale.userId;
            if (!userId) continue;

            if (!userMap.has(userId)) {
                userMap.set(userId, {
                    userId,
                    userName: "Unknown",
                    userEmail: "-",
                    totalSales: 0,
                    totalRevenue: 0,
                    totalPV: 0,
                    totalBV: 0,
                    totalItems: 0,
                });
            }
            const user = userMap.get(userId);
            user.totalSales += 1;
            user.totalRevenue += sale.total;
            user.totalItems += sale.items.reduce((sum, item) => sum + item.quantity, 0);
            const itemPV = sale.items.reduce((sum, item) => sum + (item.pv * item.quantity), 0);
            const itemBV = sale.items.reduce((sum, item) => sum + (item.bv * item.quantity), 0);
            user.totalPV += itemPV;
            user.totalBV += itemBV;
        }

        // Enrich with user details
        const userIds = Array.from(userMap.keys());
        const users = await Promise.all(userIds.map(id => ctx.db.get(id)));
        const userDetailsMap = new Map(users.filter((u): u is NonNullable<typeof u> => !!u).map(u => [u._id, u]));

        for (const [userId, data] of userMap.entries()) {
            const details = userDetailsMap.get(userId);
            if (details) {
                data.userName = `${details.first_name} ${details.last_name}`;
                data.userEmail = details.email || "-";
            }
        }

        // Convert to array and sort by revenue desc
        let usersList = Array.from(userMap.values());
        usersList.sort((a, b) => b.totalRevenue - a.totalRevenue);

        // Search filter
        if (args.search) {
            const s = args.search.toLowerCase();
            usersList = usersList.filter(u =>
                u.userName.toLowerCase().includes(s) ||
                u.userEmail.toLowerCase().includes(s)
            );
        }

        return usersList;
    },
});

// User performance summary with metrics
export const getUserPerformanceSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);
        const totalSalesCount = sales.length;

        // Aggregate by user
        const userMap = new Map<Id<"users">, any>();

        for (const sale of sales) {
            const userId = sale.userId;
            if (!userId) continue;

            if (!userMap.has(userId)) {
                userMap.set(userId, {
                    totalRevenue: 0,
                    totalSales: 0,
                });
            }
            const user = userMap.get(userId);
            user.totalRevenue += sale.total;
            user.totalSales += 1;
        }

        const usersList = Array.from(userMap.values());
        const userCount = usersList.length;
        const avgRevenuePerUser = userCount > 0 ? totalRevenue / userCount : 0;
        const topUser = usersList.sort((a, b) => b.totalRevenue - a.totalRevenue)[0];

        const avgSalesPerUser = userCount > 0 ? totalSalesCount / userCount : 0;

        return {
            totalRevenue,
            totalSalesCount,
            userCount,
            avgRevenuePerUser,
            avgSalesPerUser,
            topUser: topUser ? {
                revenue: topUser.totalRevenue,
                sales: topUser.totalSales,
            } : null,
        };
    },
});

// ============================================================
// PROFIT MARGIN REPORT
// ============================================================

// Profit margin list with filters and enrichment
export const getProfitMarginReport = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        // Aggregate by product
        const productMap = new Map<string, any>();

        // Fetch all stocks for cost price lookup
        const stockIds = [...new Set(sales.flatMap(s => s.items.map(i => i.stockId)))];
        const stocks = await Promise.all(stockIds.map(id => ctx.db.get(id)));
        const stockMap = new Map(stocks.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        for (const sale of sales) {
            for (const item of sale.items) {
                const key = item.stockId;
                const revenue = item.quantity * item.price;
                const stock = stockMap.get(key);
                const purchasePrice = stock?.purchasePrice || 0;
                const cost = item.quantity * purchasePrice;

                if (!productMap.has(key)) {
                    productMap.set(key, {
                        stockId: item.stockId,
                        productName: item.name,
                        productCode: item.productCode || "N/A",
                        totalQuantity: 0,
                        totalRevenue: 0,
                        totalCost: 0,
                        totalProfit: 0,
                        profitMargin: 0,
                    });
                }
                const product = productMap.get(key);
                product.totalQuantity += item.quantity;
                product.totalRevenue += revenue;
                product.totalCost += cost;
                product.totalProfit += (revenue - cost);
            }
        }

        // Calculate profit margins
        for (const product of productMap.values()) {
            product.profitMargin = product.totalRevenue > 0 ? (product.totalProfit / product.totalRevenue) * 100 : 0;
        }

        // Convert to array and sort by profit desc
        let products = Array.from(productMap.values());
        products.sort((a, b) => b.totalProfit - a.totalProfit);

        // Search filter
        if (args.search) {
            const s = args.search.toLowerCase();
            products = products.filter(p =>
                p.productName.toLowerCase().includes(s) ||
                p.productCode.toLowerCase().includes(s)
            );
        }

        return products;
    },
});

// Profit margin summary with metrics
export const getProfitMarginSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let sales = await salesForPeriod(ctx, businessId, args.startDate, args.endDate);

        // Filter by shop
        if (args.shopId) {
            sales = sales.filter(s => s.shopId === args.shopId);
        }

        const totalRevenue = sales.reduce((sum, s) => sum + s.total, 0);

        // Calculate total cost from items
        let totalCost = 0;
        const productMap = new Map<string, any>();

        // Fetch all stocks for purchase price lookup
        const stockIds = [...new Set(sales.flatMap(s => s.items.map(i => i.stockId)))];
        const stocks = await Promise.all(stockIds.map(id => ctx.db.get(id)));
        const stockMap = new Map(stocks.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        for (const sale of sales) {
            for (const item of sale.items) {
                const stock = stockMap.get(item.stockId);
                const purchasePrice = stock?.purchasePrice || 0;
                const cost = item.quantity * purchasePrice;
                totalCost += cost;

                const key = item.stockId;
                if (!productMap.has(key)) {
                    productMap.set(key, {
                        totalRevenue: 0,
                        totalCost: 0,
                    });
                }
                const product = productMap.get(key);
                product.totalRevenue += item.quantity * item.price;
                product.totalCost += cost;
            }
        }

        const totalProfit = totalRevenue - totalCost;
        const overallMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

        const products = Array.from(productMap.values());
        const productCount = products.length;
        const profitableProducts = products.filter(p => p.totalRevenue > p.totalCost).length;
        const avgMargin = productCount > 0 ? products.reduce((sum, p) => sum + ((p.totalRevenue - p.totalCost) / p.totalRevenue) * 100, 0) / productCount : 0;

        const topProduct = products.sort((a, b) => (b.totalRevenue - b.totalCost) - (a.totalRevenue - a.totalCost))[0];

        return {
            totalRevenue,
            totalCost,
            totalProfit,
            overallMargin,
            productCount,
            profitableProducts,
            avgMargin,
            topProduct: topProduct ? {
                name: topProduct.stockId, // This should be enriched with product name
                profit: topProduct.totalRevenue - topProduct.totalCost,
                margin: ((topProduct.totalRevenue - topProduct.totalCost) / topProduct.totalRevenue) * 100,
            } : null,
        };
    },
});

// ============================================================
// PAYMENTS / COLLECTIONS REPORT
// ============================================================

// Collections list - all loan payments with filters and enrichment
export const getPaymentsReport = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        customerId: v.optional(v.id("customers")),
        userId: v.optional(v.id("users")),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // 1. Filter payments by date
        let payments = await paymentsForPeriod(ctx, businessId, args.startDate, args.endDate);

        // 2. Filter by shop/customer
        if (args.shopId) payments = payments.filter(p => p.shopId === args.shopId);
        if (args.customerId) payments = payments.filter(p => p.customerId === args.customerId);

        // 3. Sort by date desc
        payments.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

        // 4. Enrich: loan, customer, shop, user (via loan's sale)
        const loanIds = [...new Set(payments.map(p => p.loanId))];
        const customerIds = [...new Set(payments.map(p => p.customerId).filter((id): id is Id<"customers"> => !!id))];
        const shopIds = [...new Set(payments.map(p => p.shopId).filter((id): id is Id<"shops"> => !!id))];

        const [loans, customers, shops] = await Promise.all([
            Promise.all(loanIds.map(id => ctx.db.get(id))),
            Promise.all(customerIds.map(id => ctx.db.get(id))),
            Promise.all(shopIds.map(id => ctx.db.get(id))),
        ]);

        const loanMap = new Map(loans.filter((l): l is NonNullable<typeof l> => !!l).map(l => [l._id, l]));
        const customerMap = new Map(customers.filter((c): c is NonNullable<typeof c> => !!c).map(c => [c._id, c]));
        const shopMap = new Map(shops.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        // Get sales (to derive recording user) for each loan
        const salesIds = [...new Set(loans.filter((l): l is NonNullable<typeof l> => !!l).map(l => l.salesId))];
        const salesDocs = await Promise.all(salesIds.map(id => ctx.db.get(id)));
        const salesMap = new Map(salesDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));

        const userIds = [...new Set(
            salesDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => s.userId)
        )];
        const users = await Promise.all(userIds.map(id => ctx.db.get(id)));
        const userMap = new Map(users.filter((u): u is NonNullable<typeof u> => !!u).map(u => [u._id, u]));

        // 5. Build enriched list
        let enriched = payments.map(p => {
            const loan = loanMap.get(p.loanId);
            const customer = p.customerId ? customerMap.get(p.customerId) : null;
            const shop = p.shopId ? shopMap.get(p.shopId) : null;
            const sale = loan ? salesMap.get(loan.salesId) : null;
            const recordedBy = sale ? userMap.get(sale.userId) : null;
            return {
                ...p,
                loan,
                customerName: customer?.name || loan?.manualCustomerName || "Walk-in/Unknown",
                customerPhone: customer?.phone || "-",
                customerType: sale?.clientType || "Unknown",
                shopName: shop?.name || "Main HQ",
                loanAmount: loan?.amount || 0,
                originalSaleId: loan?.salesId,
                recordedBy: recordedBy ? `${recordedBy.first_name} ${recordedBy.last_name}` : "System",
            };
        });

        // 6. Filter by user (recorded by sale's user)
        if (args.userId) {
            enriched = enriched.filter(p => {
                const loan = loanMap.get(p.loanId);
                if (!loan) return false;
                const sale = salesMap.get(loan.salesId);
                return sale?.userId === args.userId;
            });
        }

        // 7. Search filter
        if (args.search) {
            const s = args.search.toLowerCase();
            enriched = enriched.filter(p =>
                p.customerName.toLowerCase().includes(s) ||
                p.customerPhone.toLowerCase().includes(s) ||
                p.shopName.toLowerCase().includes(s) ||
                p.recordedBy.toLowerCase().includes(s)
            );
        }

        return enriched;
    },
});

// Aggregate summary for the Payments tab
export const getPaymentsReportSummary = query({
    args: {
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        customerId: v.optional(v.id("customers")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        let payments = await paymentsForPeriod(ctx, businessId, args.startDate, args.endDate);
        if (args.shopId) payments = payments.filter(p => p.shopId === args.shopId);
        if (args.customerId) payments = payments.filter(p => p.customerId === args.customerId);

        const totalCollected = payments.reduce((sum, p) => sum + p.amount, 0);
        const paymentCount = payments.length;
        const uniqueCustomers = new Set(payments.map(p => p.customerId).filter(Boolean)).size;
        const uniqueLoans = new Set(payments.map(p => p.loanId)).size;
        const avgPayment = paymentCount > 0 ? totalCollected / paymentCount : 0;

        // Outstanding from all currently active loans (not date filtered)
        const allLoans = await ctx.db.query("loans").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
        const totalOutstanding = allLoans.reduce((sum, l) => sum + (l.balance || 0), 0);
        const recoveryRate = totalCollected + totalOutstanding > 0
            ? (totalCollected / (totalCollected + totalOutstanding)) * 100
            : 0;

        return {
            totalCollected,
            paymentCount,
            uniqueCustomers,
            uniqueLoans,
            avgPayment,
            totalOutstanding,
            recoveryRate,
        };
    },
});

// Aged debtors - outstanding loans bucketed by age
export const getAgedDebtors = query({
    args: {
        shopId: v.optional(v.id("shops")),
        customerId: v.optional(v.id("customers")),
        search: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "reports.view");
        // Get all loans with outstanding balance
        const allLoans = await ctx.db.query("loans").withIndex("by_businessId", q => q.eq("businessId", businessId)).collect();
        const outstanding = allLoans.filter(l => (l.balance || 0) > 0);

        // Enrich with sale (for shopId/clientType) and customer
        const salesIds = [...new Set(outstanding.map(l => l.salesId))];
        const customerIds = [...new Set(outstanding.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];

        const [salesDocs, customers] = await Promise.all([
            Promise.all(salesIds.map(id => ctx.db.get(id))),
            Promise.all(customerIds.map(id => ctx.db.get(id))),
        ]);
        const salesMap = new Map(salesDocs.filter((s): s is NonNullable<typeof s> => !!s).map(s => [s._id, s]));
        const customerMap = new Map(customers.filter((c): c is NonNullable<typeof c> => !!c).map(c => [c._id, c]));

        const now = Date.now();

        // -----------------------------------------------------------------
        // AGEING FROM THE LAST PAYMENT
        //
        // The age of a debt is the time since the account was last touched,
        // not the time since the oldest invoice on it. A customer who bought
        // in January and paid yesterday is not a 90-day debtor — they are
        // someone who pays. Ageing from the origination date instead puts
        // every regular payer in the oldest bucket and hides the debts that
        // genuinely have gone stale.
        //
        // The payments are read once and grouped by the loan they belong
        // to, rather than queried per loan.
        //
        // Only the payments taken since the oldest open loan can be the
        // last payment on one of them — a loan is opened before any money
        // is paid against it — so the read is bounded by that date instead
        // of by every payment the business has ever received.
        // -----------------------------------------------------------------
        const lastPaymentByLoan = new Map<string, string>();
        const oldestOpenLoan = outstanding.reduce<number | null>((oldest, loan) => {
            const at = new Date(loan.date).getTime();
            if (!Number.isFinite(at)) return oldest;
            return oldest === null || at < oldest ? at : oldest;
        }, null);

        if (oldestOpenLoan !== null) {
            const from = new Date(oldestOpenLoan).toISOString();
            const allPayments = await ctx.db
                .query("payments")
                .withIndex("by_businessId_date", q => q.eq("businessId", businessId).gte("date", from))
                .collect();
            for (const payment of allPayments) {
                const loanId = payment.loanId as string;
                const current = lastPaymentByLoan.get(loanId);
                const paymentDate = String(payment.date ?? "");
                if (!current || paymentDate > current) {
                    lastPaymentByLoan.set(loanId, paymentDate);
                }
            }
        }

        let enriched = outstanding.map(l => {
            const sale = salesMap.get(l.salesId);
            const customer = l.customerId ? customerMap.get(l.customerId) : null;
            const loanDate = l.date ? new Date(l.date).getTime() : (sale?.date ? new Date(sale.date).getTime() : now);
            const lastPayment = lastPaymentByLoan.get(l._id as string);
            const lastActivity = lastPayment ? new Date(lastPayment).getTime() : loanDate;
            const ageDays = Math.max(0, Math.floor((now - lastActivity) / (1000 * 60 * 60 * 24)));

            let bucket: "current" | "30" | "60" | "90" | "over90";
            if (ageDays <= 30) bucket = "current";
            else if (ageDays <= 60) bucket = "30";
            else if (ageDays <= 90) bucket = "60";
            else if (ageDays <= 120) bucket = "90";
            else bucket = "over90";

            return {
                ...l,
                customerName: customer?.name || l.manualCustomerName || "Walk-in/Unknown",
                customerPhone: customer?.phone || "-",
                clientType: sale?.clientType || "Unknown",
                shopId: sale?.shopId,
                ageDays,
                bucket,
                originalAmount: l.amount,
                outstandingBalance: l.balance || 0,
                paidAmount: l.amount - (l.balance || 0),
                dueDate: sale?.paymentDueDate,
            };
        });

        // Filters
        if (args.shopId) enriched = enriched.filter(l => l.shopId === args.shopId);
        if (args.customerId) enriched = enriched.filter(l => l.customerId === args.customerId);
        if (args.search) {
            const s = args.search.toLowerCase();
            enriched = enriched.filter(l =>
                l.customerName.toLowerCase().includes(s) ||
                l.customerPhone.toLowerCase().includes(s)
            );
        }

        // Sort by age desc (oldest first)
        enriched.sort((a, b) => b.ageDays - a.ageDays);

        // Bucket totals
        const buckets = {
            current: { count: 0, total: 0 },
            "30": { count: 0, total: 0 },
            "60": { count: 0, total: 0 },
            "90": { count: 0, total: 0 },
            over90: { count: 0, total: 0 },
        };
        for (const l of enriched) {
            buckets[l.bucket].count += 1;
            buckets[l.bucket].total += l.outstandingBalance;
        }

        return {
            loans: enriched,
            buckets,
            totalOutstanding: enriched.reduce((sum, l) => sum + l.outstandingBalance, 0),
            totalDebtors: enriched.length,
        };
    },
});
