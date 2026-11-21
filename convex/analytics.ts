import { v } from "convex/values";
import { query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { allowedBranchIds, requirePermission, requireTenant } from "./tenancy";
import { requireEntitlement } from "./entitlements";
import {
  buildCostIndex,
  dayKey,
  displayName,
  loadExpenses,
  loadSales,
  money,
  monthKey,
  summariseExpenses,
  summariseSales,
  weekKey,
} from "./financeCore";

/**
 * SMARTBUZ — the reporting suite.
 *
 * Every figure here is computed from the transaction and ledger records:
 * the sales, the expenses, the credit book and the supplier ledger. There
 * are no sample figures and no hardcoded totals anywhere in this module —
 * a report of an empty business is zero, because there is nothing in it.
 *
 * Each report takes the same filters — a date range and an optional branch
 * — so they can be compared with each other and exported together.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

/** The key that a record is bucketed by, for the chosen period. */
function bucketKey(date: string, period: "daily" | "weekly" | "monthly"): string {
  if (period === "weekly") return weekKey(date);
  if (period === "monthly") return monthKey(date);
  return dayKey(date);
}

/**
 * Every bucket between two dates, so a day with no sales appears as zero
 * instead of being missing from the chart. A gap in the data and a day with
 * no trading look the same otherwise.
 */
function bucketRange(
  from: string,
  to: string,
  period: "daily" | "weekly" | "monthly"
): string[] {
  const buckets: string[] = [];

  if (period === "monthly") {
    const start = new Date(`${from.slice(0, 7)}-01T00:00:00.000Z`);
    const end = new Date(`${to.slice(0, 7)}-01T00:00:00.000Z`);
    const cursor = new Date(start);
    while (cursor <= end && buckets.length < 240) {
      buckets.push(cursor.toISOString().slice(0, 7));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
    return buckets;
  }

  if (period === "weekly") {
    const cursor = new Date(`${weekKey(from)}T00:00:00.000Z`);
    const end = new Date(`${weekKey(to)}T00:00:00.000Z`);
    while (cursor <= end && buckets.length < 520) {
      buckets.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return buckets;
  }

  const cursor = new Date(`${dayKey(from)}T00:00:00.000Z`);
  const end = new Date(`${dayKey(to)}T00:00:00.000Z`);
  while (cursor <= end && buckets.length < 1100) {
    buckets.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return buckets;
}

/* ────────────────────────────────────────────────────────────────────────
 * Sales over time
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Sales broken down by day, week or month.
 *
 * The same figures drive the daily, weekly and monthly sales reports — the
 * period only changes how the days are grouped.
 */
export const getSalesByPeriod = query({
  args: {
    period: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly")),
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const sales = await loadSales(
      ctx,
      tenant.businessId,
      args.from,
      args.to,
      args.branchId
    );
    const costs = await buildCostIndex(ctx, tenant.businessId);

    const buckets = new Map<
      string,
      { revenue: number; cost: number; transactions: number; items: number }
    >();

    for (const sale of sales) {
      const key = bucketKey(sale.date, args.period);
      const bucket = buckets.get(key) ?? {
        revenue: 0,
        cost: 0,
        transactions: 0,
        items: 0,
      };

      const refund = sale.refundAmount ?? 0;
      bucket.revenue += (sale.total ?? 0) - refund;
      bucket.transactions += 1;

      for (const item of sale.items ?? []) {
        const unit = costs.costFor(item.stockId, item.bv ?? 0, sale.date);
        bucket.cost += unit * (item.quantity ?? 0);
        bucket.items += item.quantity ?? 0;
      }
      for (const item of sale.refundedItems ?? []) {
        const unit = costs.costFor(item.stockId, 0, sale.date);
        bucket.cost -= unit * (item.quantity ?? 0);
      }

      buckets.set(key, bucket);
    }

    const series = bucketRange(args.from, args.to, args.period).map((key) => {
      const bucket = buckets.get(key) ?? {
        revenue: 0,
        cost: 0,
        transactions: 0,
        items: 0,
      };
      return {
        period: key,
        revenue: money(bucket.revenue),
        cost: money(bucket.cost),
        grossProfit: money(bucket.revenue - bucket.cost),
        transactions: bucket.transactions,
        items: bucket.items,
        averageTicket:
          bucket.transactions > 0 ? money(bucket.revenue / bucket.transactions) : 0,
      };
    });

    const totals = series.reduce(
      (acc, row) => ({
        revenue: acc.revenue + row.revenue,
        cost: acc.cost + row.cost,
        grossProfit: acc.grossProfit + row.grossProfit,
        transactions: acc.transactions + row.transactions,
        items: acc.items + row.items,
      }),
      { revenue: 0, cost: 0, grossProfit: 0, transactions: 0, items: 0 }
    );

    return {
      period: args.period,
      from: args.from,
      to: args.to,
      branchId: args.branchId,
      series,
      totals: {
        revenue: money(totals.revenue),
        cost: money(totals.cost),
        grossProfit: money(totals.grossProfit),
        transactions: totals.transactions,
        items: totals.items,
        averageTicket:
          totals.transactions > 0
            ? money(totals.revenue / totals.transactions)
            : 0,
      },
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Profit and loss
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The profit and loss of a period.
 *
 * Gross profit is what the goods left the shelf for, less what they cost.
 * Net profit is that, plus any other income, less the running costs of the
 * business.
 */
export const getProfitAndLoss = query({
  args: {
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;

    const sales = await loadSales(ctx, businessId, args.from, args.to, args.branchId);
    const costs = await buildCostIndex(ctx, businessId);
    const saleTotals = summariseSales(sales, costs);

    const expenses = await loadExpenses(
      ctx,
      businessId,
      args.from,
      args.to,
      args.branchId
    );
    const expenseTotals = summariseExpenses(expenses);

    const income = await ctx.db
      .query("incomeRecords")
      .withIndex("by_businessId_date", (q: any) =>
        q
          .eq("businessId", businessId)
          .gte("date", args.from)
          .lte("date", `${args.to.slice(0, 10)}T23:59:59.999Z`)
      )
      .collect();
    const scopedIncome = args.branchId
      ? income.filter((r: any) => r.branchId === args.branchId)
      : income;
    const otherIncome = money(
      scopedIncome.reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0)
    );

    const grossProfit = money(saleTotals.revenue - saleTotals.cost);
    const netProfit = money(grossProfit + otherIncome - expenseTotals.total);

    return {
      from: args.from,
      to: args.to,
      branchId: args.branchId,
      revenue: money(saleTotals.revenue),
      costOfGoodsSold: money(saleTotals.cost),
      grossProfit,
      grossMargin:
        saleTotals.revenue > 0 ? (grossProfit / saleTotals.revenue) * 100 : 0,
      otherIncome,
      operatingExpenses: money(expenseTotals.total),
      expensesByType: expenseTotals.byType,
      netProfit,
      netMargin:
        saleTotals.revenue > 0 ? (netProfit / saleTotals.revenue) * 100 : 0,
      transactions: saleTotals.transactions,
      itemsSold: saleTotals.items,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Expenses
 * ──────────────────────────────────────────────────────────────────────── */

/** The expenses of a period, with the totals. */
export const getExpenseReport = query({
  args: {
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    type: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const expenses = await loadExpenses(
      ctx,
      tenant.businessId,
      args.from,
      args.to,
      args.branchId
    );

    const filtered = args.type
      ? expenses.filter((e: any) => (e.type || "Uncategorised") === args.type)
      : expenses;

    filtered.sort((a: any, b: any) => b.date.localeCompare(a.date));

    const totals = summariseExpenses(filtered);
    const totalCount = filtered.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;

    return {
      page: filtered.slice(offset, offset + limit).map((e: any) => ({
        _id: e._id,
        date: e.date,
        amount: e.amount,
        expense: e.expense,
        receivedBy: e.receivedBy,
        type: e.type || "Uncategorised",
        branchId: e.branchId,
      })),
      totalCount,
      hasMore: offset + limit < totalCount,
      total: money(totals.total),
      count: totals.count,
      byType: totals.byType,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Products
 * ──────────────────────────────────────────────────────────────────────── */

/** The best-selling products of a period. */
export const getBestSellingProducts = query({
  args: {
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const sales = await loadSales(
      ctx,
      tenant.businessId,
      args.from,
      args.to,
      args.branchId
    );
    const costs = await buildCostIndex(ctx, tenant.businessId);

    const products = new Map<
      string,
      {
        stockId: string;
        name: string;
        productCode: string;
        quantity: number;
        revenue: number;
        cost: number;
        grossProfit: number;
        transactions: number;
      }
    >();

    for (const sale of sales) {
      for (const item of sale.items ?? []) {
        const key = item.stockId as string;
        const product = products.get(key) ?? {
          stockId: key,
          name: item.name,
          productCode: item.productCode ?? "",
          quantity: 0,
          revenue: 0,
          cost: 0,
          grossProfit: 0,
          transactions: 0,
        };

        const unit = costs.costFor(item.stockId, item.bv ?? 0, sale.date);
        const revenue = (item.price ?? 0) * (item.quantity ?? 0);
        const cost = unit * (item.quantity ?? 0);

        product.quantity += item.quantity ?? 0;
        product.revenue += revenue;
        product.cost += cost;
        product.grossProfit += revenue - cost;
        product.transactions += 1;

        products.set(key, product);
      }
    }

    const all = [...products.values()].map((p) => ({
      ...p,
      revenue: money(p.revenue),
      cost: money(p.cost),
      grossProfit: money(p.grossProfit),
      margin: p.revenue > 0 ? (p.grossProfit / p.revenue) * 100 : 0,
    }));

    all.sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue);

    const totalCount = all.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 20;

    return {
      page: all.slice(offset, offset + limit),
      totalCount,
      hasMore: offset + limit < totalCount,
      totals: {
        quantity: all.reduce((sum, p) => sum + p.quantity, 0),
        revenue: money(all.reduce((sum, p) => sum + p.revenue, 0)),
        grossProfit: money(all.reduce((sum, p) => sum + p.grossProfit, 0)),
      },
    };
  },
});

/**
 * The slow-moving products.
 *
 * Stock that is sitting there. The measure that matters is not how little
 * it sold but how much **money** is sitting in it, so the list is ranked by
 * the value of the stock.
 */
export const getSlowMovingProducts = query({
  args: {
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;
    const sales = await loadSales(ctx, businessId, args.from, args.to, args.branchId);
    const costs = await buildCostIndex(ctx, businessId);

    const sold = new Map<string, { quantity: number; revenue: number }>();
    const lastSale = new Map<string, string>();

    for (const sale of sales) {
      for (const item of sale.items ?? []) {
        const key = item.stockId as string;
        const entry = sold.get(key) ?? { quantity: 0, revenue: 0 };
        entry.quantity += item.quantity ?? 0;
        entry.revenue += (item.price ?? 0) * (item.quantity ?? 0);
        sold.set(key, entry);

        const previous = lastSale.get(key);
        if (!previous || sale.date > previous) lastSale.set(key, sale.date);
      }
    }

    const stocks = await ctx.db
      .query("stocks")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();

    const rows = stocks
      .filter((s: any) => (s.qty ?? 0) > 0)
      .filter((s: any) => !args.branchId || !s.branchId || s.branchId === args.branchId)
      .map((s: any) => {
        const unitCost = costs.costFor(s._id, 0);
        const entry = sold.get(s._id as string);
        return {
          stockId: s._id,
          name: s.name,
          productCode: s.productCode,
          qty: s.qty ?? 0,
          unitCost: money(unitCost),
          stockValue: money(unitCost * (s.qty ?? 0)),
          retailValue: money((s.price ?? 0) * (s.qty ?? 0)),
          quantitySold: entry?.quantity ?? 0,
          revenue: money(entry?.revenue ?? 0),
          lastSaleDate: lastSale.get(s._id as string),
        };
      });

    // The slowest first: least sold, and the most money tied up.
    rows.sort(
      (a, b) =>
        a.quantitySold - b.quantitySold || b.stockValue - a.stockValue
    );

    const limit = args.limit ?? 20;

    return {
      page: rows.slice(0, limit),
      totalCount: rows.length,
      totals: {
        stockValue: money(rows.reduce((sum, r) => sum + r.stockValue, 0)),
        deadStockValue: money(
          rows
            .filter((r) => r.quantitySold === 0)
            .reduce((sum, r) => sum + r.stockValue, 0)
        ),
      },
    };
  },
});

/**
 * What the stock on the shelf is worth.
 *
 * Two figures: what it cost, and what it would fetch at the till. The
 * difference is the margin still sitting on the shelf.
 */
export const getStockValuation = query({
  args: {
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;
    const costs = await buildCostIndex(ctx, businessId);

    const stocks = await ctx.db
      .query("stocks")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();

    const filtered = stocks.filter((s: any) => {
      if (args.branchId && s.branchId && s.branchId !== args.branchId) return false;
      if (args.warehouseId && s.warehouseId !== args.warehouseId) return false;
      return true;
    });

    const rows = filtered.map((s: any) => {
      const unitCost = costs.costFor(s._id, 0);
      const qty = s.qty ?? 0;
      return {
        stockId: s._id,
        name: s.name,
        productCode: s.productCode,
        categoryId: s.categoryId,
        qty,
        unitCost: money(unitCost),
        unitPrice: money(s.price ?? 0),
        costValue: money(unitCost * qty),
        retailValue: money((s.price ?? 0) * qty),
        marginValue: money(((s.price ?? 0) - unitCost) * qty),
      };
    });

    rows.sort((a, b) => b.costValue - a.costValue);

    return {
      page: rows,
      totalCount: rows.length,
      totals: {
        costValue: money(rows.reduce((sum, r) => sum + r.costValue, 0)),
        retailValue: money(rows.reduce((sum, r) => sum + r.retailValue, 0)),
        marginValue: money(rows.reduce((sum, r) => sum + r.marginValue, 0)),
        units: rows.reduce((sum, r) => sum + r.qty, 0),
      },
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * People and places
 * ──────────────────────────────────────────────────────────────────────── */

/** Sales by cashier. */
export const getSalesByCashier = query({
  args: {
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const sales = await loadSales(
      ctx,
      tenant.businessId,
      args.from,
      args.to,
      args.branchId
    );
    const costs = await buildCostIndex(ctx, tenant.businessId);

    const byUser = new Map<
      string,
      { userId: string; revenue: number; cost: number; transactions: number; items: number }
    >();

    for (const sale of sales) {
      const key = sale.userId as string;
      const row = byUser.get(key) ?? {
        userId: key,
        revenue: 0,
        cost: 0,
        transactions: 0,
        items: 0,
      };

      row.revenue += (sale.total ?? 0) - (sale.refundAmount ?? 0);
      row.transactions += 1;

      for (const item of sale.items ?? []) {
        const unit = costs.costFor(item.stockId, item.bv ?? 0, sale.date);
        row.cost += unit * (item.quantity ?? 0);
        row.items += item.quantity ?? 0;
      }
      for (const item of sale.refundedItems ?? []) {
        const unit = costs.costFor(item.stockId, 0, sale.date);
        row.cost -= unit * (item.quantity ?? 0);
      }

      byUser.set(key, row);
    }

    const userIds = [...byUser.keys()];
    const users = await Promise.all(userIds.map((id) => ctx.db.get(id as Id<"users">)));
    const names = new Map(
      users
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => [u._id as string, displayName(u)])
    );

    const rows = [...byUser.values()]
      .map((row) => ({
        ...row,
        name: names.get(row.userId) ?? "Unknown cashier",
        revenue: money(row.revenue),
        cost: money(row.cost),
        grossProfit: money(row.revenue - row.cost),
        items: row.items,
        averageTicket:
          row.transactions > 0 ? money(row.revenue / row.transactions) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      page: rows,
      totalCount: rows.length,
      totals: {
        revenue: money(rows.reduce((sum, r) => sum + r.revenue, 0)),
        grossProfit: money(rows.reduce((sum, r) => sum + r.grossProfit, 0)),
        transactions: rows.reduce((sum, r) => sum + r.transactions, 0),
      },
    };
  },
});

/** Sales by branch. */
export const getSalesByBranch = query({
  args: {
    from: v.string(),
    to: v.string(),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;
    const sales = await loadSales(ctx, businessId, args.from, args.to);
    const costs = await buildCostIndex(ctx, businessId);

    const byBranch = new Map<
      string,
      { branchId: string | null; revenue: number; cost: number; transactions: number }
    >();

    for (const sale of sales) {
      const key = (sale.branchId as string) ?? "";
      const row = byBranch.get(key) ?? {
        branchId: sale.branchId ?? null,
        revenue: 0,
        cost: 0,
        transactions: 0,
      };

      row.revenue += (sale.total ?? 0) - (sale.refundAmount ?? 0);
      row.transactions += 1;

      for (const item of sale.items ?? []) {
        const unit = costs.costFor(item.stockId, item.bv ?? 0, sale.date);
        row.cost += unit * (item.quantity ?? 0);
      }
      for (const item of sale.refundedItems ?? []) {
        const unit = costs.costFor(item.stockId, 0, sale.date);
        row.cost -= unit * (item.quantity ?? 0);
      }

      byBranch.set(key, row);
    }

    const branchIds = [...byBranch.values()]
      .map((r) => r.branchId)
      .filter((id): id is Id<"branches"> => !!id);
    const branches = await Promise.all(branchIds.map((id) => ctx.db.get(id)));
    const names = new Map(
      branches
        .filter((b): b is NonNullable<typeof b> => !!b)
        .map((b) => [b._id as string, b.name])
    );

    const rows = [...byBranch.values()]
      .map((row) => ({
        ...row,
        name: row.branchId ? (names.get(row.branchId) ?? "Unknown branch") : "Unassigned",
        revenue: money(row.revenue),
        cost: money(row.cost),
        grossProfit: money(row.revenue - row.cost),
        averageTicket:
          row.transactions > 0 ? money(row.revenue / row.transactions) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      page: rows,
      totalCount: rows.length,
      totals: {
        revenue: money(rows.reduce((sum, r) => sum + r.revenue, 0)),
        grossProfit: money(rows.reduce((sum, r) => sum + r.grossProfit, 0)),
        transactions: rows.reduce((sum, r) => sum + r.transactions, 0),
      },
    };
  },
});

/**
 * How the money came in.
 *
 * Every sale was paid for somehow. Which way is worth knowing: a business
 * that takes everything in cash has a different risk, and a different
 * reconciliation, from one that takes mobile money.
 */
export const getPaymentMethodAnalysis = query({
  args: {
    from: v.string(),
    to: v.string(),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;
    const sales = await loadSales(ctx, businessId, args.from, args.to, args.branchId);

    const methods = new Map<
      string,
      { method: string; revenue: number; transactions: number; items: number }
    >();

    for (const sale of sales) {
      const method = (sale.paymentMode || "Unspecified").trim() || "Unspecified";
      const row = methods.get(method) ?? {
        method,
        revenue: 0,
        transactions: 0,
        items: 0,
      };
      row.revenue += (sale.total ?? 0) - (sale.refundAmount ?? 0);
      row.transactions += 1;
      for (const item of sale.items ?? []) {
        row.items += item.quantity ?? 0;
      }
      methods.set(method, row);
    }

    // Repayments of credit taken, by the method they were paid in.
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();
    const repayments = new Map<string, number>();
    for (const payment of payments) {
      if (payment.date < args.from || payment.date > `${args.to.slice(0, 10)}T23:59:59.999Z`) {
        continue;
      }
      const method = (payment.method || "Unspecified").trim() || "Unspecified";
      repayments.set(method, (repayments.get(method) ?? 0) + (payment.amount ?? 0));
    }

    const totalRevenue = [...methods.values()].reduce(
      (sum, m) => sum + m.revenue,
      0
    );

    const rows = [...methods.values()]
      .map((row) => ({
        ...row,
        revenue: money(row.revenue),
        repaid: money(repayments.get(row.method) ?? 0),
        share: totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0,
        averageTicket:
          row.transactions > 0 ? money(row.revenue / row.transactions) : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      page: rows,
      totalCount: rows.length,
      totals: {
        revenue: money(totalRevenue),
        transactions: rows.reduce((sum, r) => sum + r.transactions, 0),
        repaid: money([...repayments.values()].reduce((sum, v) => sum + v, 0)),
      },
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * The debt reports
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Who owes the business, and for how long.
 *
 * The ageing is what makes the report actionable: money owed for a week is
 * a different problem from money owed for four months.
 */
export const getCustomerDebtReport = query({
  args: {
    branchId: v.optional(v.id("branches")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;
    const now = Date.now();

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();

    const byCustomer = new Map<
      string,
      {
        balance: number;
        oldest: string;
        lastActivity: string;
        buckets: { current: number; d30: number; d60: number; d90: number };
      }
    >();

    // -----------------------------------------------------------------
    // WHEN WAS THE ACCOUNT LAST TOUCHED?
    //
    // Ageing a debtor account measures the time since the **last payment**
    // on it, not the time since the oldest invoice. A customer who bought
    // on 1 January and paid yesterday is not a 90-day debtor: they are
    // someone who pays. Ageing from the origination date instead puts
    // every regular payer in the oldest bucket and hides the debts that
    // genuinely have gone stale.
    //
    // The payments are read once for the whole business and grouped by the
    // loan they belong to, rather than queried per loan.
    // -----------------------------------------------------------------
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const lastPaymentByLoan = new Map<string, string>();
    for (const payment of payments) {
      const loanId = payment.loanId as string;
      const current = lastPaymentByLoan.get(loanId);
      const paymentDate = String(payment.date ?? "");
      if (!current || paymentDate > current) {
        lastPaymentByLoan.set(loanId, paymentDate);
      }
    }

    for (const loan of loans) {
      const balance = loan.balance ?? 0;
      if (balance <= 0) continue;
      const key = loan.customerId as string;
      const lastActivity =
        lastPaymentByLoan.get(loan._id as string) ?? String(loan.date);
      const row = byCustomer.get(key) ?? {
        balance: 0,
        oldest: loan.date,
        lastActivity,
        buckets: { current: 0, d30: 0, d60: 0, d90: 0 },
      };

      row.balance += balance;
      if (loan.date < row.oldest) row.oldest = loan.date;
      if (lastActivity > row.lastActivity) row.lastActivity = lastActivity;

      const ageDays = Math.floor(
        (now - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (ageDays <= 30) row.buckets.current += balance;
      else if (ageDays <= 60) row.buckets.d30 += balance;
      else if (ageDays <= 90) row.buckets.d60 += balance;
      else row.buckets.d90 += balance;

      byCustomer.set(key, row);
    }

    const customerIds = [...byCustomer.keys()];
    const customers = await Promise.all(
      customerIds.map((id) => ctx.db.get(id as Id<"customers">))
    );
    const details = new Map(
      customers
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => [
          c._id as string,
          {
            name: c.name,
            phone: c.phone,
            creditLimit: c.creditLimit ?? 0,
            branchId: c.branchId,
          },
        ])
    );

    const allowed = await allowedBranchIds(ctx, tenant.membership);

    const rows = [...byCustomer.entries()]
      .map(([customerId, row]) => {
        const detail = details.get(customerId);
        return {
          customerId,
          name: detail?.name ?? "Unknown customer",
          phone: detail?.phone ?? "",
          creditLimit: detail?.creditLimit ?? 0,
          overLimit:
            detail && detail.creditLimit > 0
              ? row.balance > detail.creditLimit
              : false,
          balance: money(row.balance),
          oldestDate: row.oldest,
          // The age of the **account**, not of its oldest invoice: the time
          // since the customer last paid. See the note above the buckets.
          ageDays: Math.floor(
            (now - new Date(row.lastActivity).getTime()) / (1000 * 60 * 60 * 24)
          ),
          buckets: {
            current: money(row.buckets.current),
            d30: money(row.buckets.d30),
            d60: money(row.buckets.d60),
            d90: money(row.buckets.d90),
          },
        };
      })
      .filter((row) => {
        if (!allowed) return true;
        const branchId = details.get(row.customerId)?.branchId;
        return !branchId || allowed.includes(branchId);
      })
      .sort((a, b) => b.balance - a.balance);

    const totalCount = rows.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;

    return {
      page: rows.slice(offset, offset + limit),
      totalCount,
      hasMore: offset + limit < totalCount,
      totals: {
        balance: money(rows.reduce((sum, r) => sum + r.balance, 0)),
        current: money(rows.reduce((sum, r) => sum + r.buckets.current, 0)),
        d30: money(rows.reduce((sum, r) => sum + r.buckets.d30, 0)),
        d60: money(rows.reduce((sum, r) => sum + r.buckets.d60, 0)),
        d90: money(rows.reduce((sum, r) => sum + r.buckets.d90, 0)),
        customers: rows.length,
      },
    };
  },
});

/** What the business owes its suppliers. */
export const getSupplierDebtReport = query({
  args: {
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "business.intelligence");

    const businessId = tenant.businessId;

    const ledger = await ctx.db
      .query("supplierLedger")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();

    const bySupplier = new Map<
      string,
      { balance: number; charged: number; paid: number; oldest: string; lastMovement: string }
    >();

    for (const row of ledger) {
      const key = row.supplierId as string;
      const entry = bySupplier.get(key) ?? {
        balance: 0,
        charged: 0,
        paid: 0,
        oldest: row.date,
        lastMovement: row.date,
      };
      entry.balance += row.amount ?? 0;
      if (row.amount >= 0) entry.charged += row.amount ?? 0;
      else entry.paid += Math.abs(row.amount ?? 0);
      if (row.date < entry.oldest) entry.oldest = row.date;
      if (row.date > entry.lastMovement) entry.lastMovement = row.date;
      bySupplier.set(key, entry);
    }

    const supplierIds = [...bySupplier.keys()];
    const suppliers = await Promise.all(
      supplierIds.map((id) => ctx.db.get(id as Id<"suppliers">))
    );
    const details = new Map(
      suppliers
        .filter((s): s is NonNullable<typeof s> => !!s)
        .map((s) => [
          s._id as string,
          { name: s.name, phone: s.phone ?? "", email: s.email ?? "" },
        ])
    );

    const rows = [...bySupplier.entries()]
      .map(([supplierId, entry]) => ({
        supplierId,
        name: details.get(supplierId)?.name ?? "Unknown supplier",
        phone: details.get(supplierId)?.phone ?? "",
        email: details.get(supplierId)?.email ?? "",
        balance: money(entry.balance),
        charged: money(entry.charged),
        paid: money(entry.paid),
        oldestDate: entry.oldest,
        lastMovementDate: entry.lastMovement,
      }))
      .filter((row) => row.balance > 0)
      .sort((a, b) => b.balance - a.balance);

    const totalCount = rows.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;

    return {
      page: rows.slice(offset, offset + limit),
      totalCount,
      hasMore: offset + limit < totalCount,
      totals: {
        balance: money(rows.reduce((sum, r) => sum + r.balance, 0)),
        charged: money(rows.reduce((sum, r) => sum + r.charged, 0)),
        paid: money(rows.reduce((sum, r) => sum + r.paid, 0)),
        suppliers: rows.length,
      },
    };
  },
});
