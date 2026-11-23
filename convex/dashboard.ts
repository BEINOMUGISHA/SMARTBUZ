import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requirePermission, requireTenant } from "./tenancy";
import {
    buildCostIndexForPeriod,
    dayBounds,
    isCreditSale,
    loadExpenses,
    loadIncome,
    loadSales,
    money,
    summariseExpenses,
    summariseSales,
} from "./financeCore";

/**
 * SMARTBUZ — dashboard statistics.
 *
 * Every figure is computed from the caller's business only.
 */

/**
 * Today, in the business's own time zone.
 *
 * A business in Kampala does not close its books at midnight UTC — it
 * closes them at midnight its own time. Using the business's time zone is
 * the difference between "today's sales" being right and being three hours
 * out.
 */
function todayIn(timeZone: string | undefined): string {
    try {
        return new Intl.DateTimeFormat("en-CA", {
            timeZone: timeZone || "Africa/Kampala",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).format(new Date());
    } catch {
        return new Date().toISOString().slice(0, 10);
    }
}

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

/**
 * The business dashboard.
 *
 * Where the owner looks first: what today brought in, what the profit was,
 * what is running out, who owes what, and what the last fortnight looked
 * like.
 *
 * The figures come from the same calculation core as the reports, so the
 * dashboard and the profit and loss report can never disagree.
 */
export const getBusinessDashboard = query({
    args: {
        /** A day to report on. Defaults to today, in the business's time zone. */
        date: v.optional(v.string()),
        branchId: v.optional(v.id("branches")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.dashboard.view");

        const businessId = tenant.businessId;
        const today = args.date ?? todayIn(tenant.business?.timezone);

        // ── Today ────────────────────────────────────────────────────────
        const todaySales = await loadSales(ctx, businessId, today, today, args.branchId);
        const costs = await buildCostIndexForPeriod(ctx, businessId, today, today);
        const todayTotals = summariseSales(todaySales, costs);

        const todayExpenses = await loadExpenses(
            ctx,
            businessId,
            today,
            today,
            args.branchId
        );
        const todayExpenseTotals = summariseExpenses(todayExpenses);

        const todayIncome = await loadIncome(
            ctx,
            businessId,
            today,
            today,
            args.branchId
        );
        const todayOtherIncome = money(
            todayIncome.reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0)
        );

        const todayGrossProfit = money(todayTotals.revenue - todayTotals.cost);
        const todayNetProfit = money(
            todayGrossProfit + todayOtherIncome - todayExpenseTotals.total
        );

        // ── The last fourteen days, for the chart ────────────────────────
        const chartFrom = new Date(`${today}T00:00:00.000Z`);
        chartFrom.setUTCDate(chartFrom.getUTCDate() - 13);
        const chartStart = chartFrom.toISOString().slice(0, 10);

        const chartSales = await loadSales(
            ctx,
            businessId,
            chartStart,
            today,
            args.branchId
        );

        const buckets = new Map<string, { revenue: number; cost: number }>();
        for (const sale of chartSales) {
            const key = sale.date.slice(0, 10);
            const bucket = buckets.get(key) ?? { revenue: 0, cost: 0 };
            bucket.revenue += (sale.total ?? 0) - (sale.refundAmount ?? 0);
            for (const item of sale.items ?? []) {
                const unit = costs.costFor(item.stockId, item.bv ?? 0, sale.date);
                bucket.cost += unit * (item.quantity ?? 0);
            }
            buckets.set(key, bucket);
        }

        const chartData: { date: string; revenue: number; grossProfit: number }[] = [];
        for (let i = 0; i < 14; i++) {
            const day = new Date(chartFrom);
            day.setUTCDate(day.getUTCDate() + i);
            const key = day.toISOString().slice(0, 10);
            const bucket = buckets.get(key) ?? { revenue: 0, cost: 0 };
            chartData.push({
                date: key,
                revenue: money(bucket.revenue),
                grossProfit: money(bucket.revenue - bucket.cost),
            });
        }

        // ── Best sellers today ───────────────────────────────────────────
        const bestSellers = new Map<
            string,
            { name: string; productCode: string; quantity: number; revenue: number }
        >();
        for (const sale of todaySales) {
            for (const item of sale.items ?? []) {
                const key = item.stockId as string;
                const row = bestSellers.get(key) ?? {
                    name: item.name,
                    productCode: item.productCode ?? "",
                    quantity: 0,
                    revenue: 0,
                };
                row.quantity += item.quantity ?? 0;
                row.revenue += (item.price ?? 0) * (item.quantity ?? 0);
                bestSellers.set(key, row);
            }
        }
        const topSellers = [...bestSellers.values()]
            .map((row) => ({
                ...row,
                revenue: money(row.revenue),
            }))
            .sort((a, b) => b.quantity - a.quantity)
            .slice(0, 5);

        // ── Low stock ────────────────────────────────────────────────────
        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const lowStock = stocks
            .filter((s: any) => (s.qty ?? 0) < 10)
            .filter((s: any) => !args.branchId || !s.branchId || s.branchId === args.branchId)
            .sort((a: any, b: any) => (a.qty ?? 0) - (b.qty ?? 0))
            .slice(0, 8)
            .map((s: any) => ({
                stockId: s._id,
                name: s.name,
                productCode: s.productCode,
                qty: s.qty ?? 0,
                price: s.price ?? 0,
            }));

        // ── Outstanding balances ─────────────────────────────────────────
        const loans = await ctx.db
            .query("loans")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const receivables = money(
            loans.reduce((sum: number, l: any) => sum + (l.balance ?? 0), 0)
        );

        const ledger = await ctx.db
            .query("supplierLedger")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const balanceBySupplier = new Map<string, number>();
        for (const row of ledger) {
            const key = row.supplierId as string;
            balanceBySupplier.set(
                key,
                (balanceBySupplier.get(key) ?? 0) + (row.amount ?? 0)
            );
        }
        const payables = money(
            [...balanceBySupplier.values()].reduce(
                (sum: number, balance) => sum + Math.max(0, balance),
                0
            )
        );

        // ── Recent transactions ──────────────────────────────────────────
        const recent = [...todaySales]
            .sort((a: any, b: any) => b.date.localeCompare(a.date))
            .slice(0, 8)
            .map((sale: any) => ({
                _id: sale._id,
                invoiceNumber: sale.invoiceNumber,
                total: sale.total,
                paymentMode: sale.paymentMode,
                date: sale.date,
                isCredit: isCreditSale(sale),
            }));

        return {
            date: today,
            branchId: args.branchId,

            today: {
                revenue: money(todayTotals.revenue),
                transactions: todayTotals.transactions,
                items: todayTotals.items,
                grossProfit: todayGrossProfit,
                operatingExpenses: money(todayExpenseTotals.total),
                otherIncome: todayOtherIncome,
                netProfit: todayNetProfit,
                averageTicket:
                    todayTotals.transactions > 0
                        ? money(todayTotals.revenue / todayTotals.transactions)
                        : 0,
                creditTransactions: todayTotals.creditTransactions,
            },

            chartData,
            bestSellers: topSellers,
            lowStock,
            lowStockCount: lowStock.length,

            balances: {
                receivables,
                payables,
            },

            recentTransactions: recent,
        };
    },
});
