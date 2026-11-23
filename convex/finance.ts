import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import {
  type BusinessId,
  allowedBranchIds,
  logActivity,
  requireBranchAccess,
  requirePermission,
  requireTenant,
} from "./tenancy";
import { writeAudit } from "./audit";
import { requireEntitlement } from "./entitlements";
import {
  buildCostIndexForPeriod,
  businessDayBounds,
  displayName,
  loadExpenses,
  loadIncome,
  loadSales,
  money,
  summariseExpenses,
  summariseSales,
} from "./financeCore";

/**
 * SMARTBUZ — the finance module.
 *
 * The cash side of the business: the till, the shifts that run it, money in
 * and out of the drawer, income that is not a sale, and the reconciliation
 * of what a payment provider says against what the books recorded.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The cash drawer
 * ────────────────────────────────────────────────────────────────────────
 *
 * A drawer holds an opening float, the cash sales taken during the period,
 * and the money that was put in or taken out of it. What it *should* hold is
 * computed from those records — it is never typed in. What it *did* hold is
 * what the cashier counted. The difference between the two is the variance,
 * and it is the whole point of counting the drawer at all: a shortfall of
 * 5,000 is a fact somebody can act on, while "the drawer felt light" is
 * not.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Cash-in and cash-out are not expenses
 * ────────────────────────────────────────────────────────────────────────
 *
 * A pay-out of petty cash is money moving between the business's own
 * pockets, not the cost of running the business. Recording it as an expense
 * would make a profitable business look like it is losing money. So the
 * drawer has its own ledger (`cashMovements`) and the profit and loss
 * statement has its own (`expenses`), and the two never mix.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

type Shift = Doc<"cashShifts">;

/** Is this payment method cash? */
export function isCashMethod(mode: string | undefined): boolean {
  return (mode ?? "").trim().toLowerCase() === "cash";
}

/**
 * The cash that should be in the drawer for a shift.
 *
 * The opening float, plus the cash the cashier took during the shift, plus
 * the money put in, minus the money taken out.
 */
async function expectedCashForShift(
  ctx: any,
  businessId: BusinessId,
  shift: Shift
): Promise<number> {
  const openedAt = shift.openedAt;
  const closedAt = shift.closedAt ?? new Date().toISOString();

  const sales = await ctx.db
    .query("sales")
    .withIndex("by_businessId_date", (q: any) =>
      q
        .eq("businessId", businessId)
        .gte("date", openedAt)
        .lte("date", closedAt)
    )
    .collect();

  const mine = sales.filter((sale: any) => {
    if (sale.userId !== shift.userId) return false;
    if (shift.shopId) return sale.shopId === shift.shopId;
    if (shift.branchId) return sale.branchId === shift.branchId;
    return true;
  });

  let cashSales = 0;
  for (const sale of mine) {
    if (!isCashMethod(sale.paymentMode)) continue;
    cashSales += (sale.total ?? 0) - (sale.refundAmount ?? 0);
  }

  const movements = await ctx.db
    .query("cashMovements")
    .withIndex("by_shiftId", (q: any) => q.eq("shiftId", shift._id))
    .collect();

  let cashIn = 0;
  let cashOut = 0;
  for (const movement of movements) {
    if (movement.type === "in") cashIn += movement.amount ?? 0;
    else cashOut += movement.amount ?? 0;
  }

  return money((shift.openingFloat ?? 0) + cashSales + cashIn - cashOut);
}

/**
 * The cash sales of a shift, with the breakdown the shift detail shows.
 */
async function shiftCashBreakdown(
  ctx: any,
  businessId: BusinessId,
  shift: Shift
): Promise<{ cashSales: number; cashIn: number; cashOut: number }> {
  const openedAt = shift.openedAt;
  const closedAt = shift.closedAt ?? new Date().toISOString();

  const sales = await ctx.db
    .query("sales")
    .withIndex("by_businessId_date", (q: any) =>
      q
        .eq("businessId", businessId)
        .gte("date", openedAt)
        .lte("date", closedAt)
    )
    .collect();

  let cashSales = 0;
  let transactions = 0;
  for (const sale of sales) {
    if (sale.userId !== shift.userId) continue;
    if (shift.shopId && sale.shopId !== shift.shopId) continue;
    if (!shift.shopId && shift.branchId && sale.branchId !== shift.branchId) {
      continue;
    }
    if (!isCashMethod(sale.paymentMode)) continue;
    cashSales += (sale.total ?? 0) - (sale.refundAmount ?? 0);
    transactions += 1;
  }

  const movements = await ctx.db
    .query("cashMovements")
    .withIndex("by_shiftId", (q: any) => q.eq("shiftId", shift._id))
    .collect();

  let cashIn = 0;
  let cashOut = 0;
  for (const movement of movements) {
    if (movement.type === "in") cashIn += movement.amount ?? 0;
    else cashOut += movement.amount ?? 0;
  }

  return { cashSales: money(cashSales), cashIn: money(cashIn), cashOut: money(cashOut) };
}

/* ────────────────────────────────────────────────────────────────────────
 * Cash shifts
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Open a shift.
 *
 * A cashier gets their float and starts. Only one shift may be open at a
 * time for a person — two open drawers cannot both be counted.
 */
export const openShift = mutation({
  args: {
    openingFloat: v.number(),
    branchId: v.optional(v.id("branches")),
    shopId: v.optional(v.id("shops")),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");

    if (args.openingFloat < 0) {
      throw new ConvexError("An opening float cannot be negative.");
    }

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
      await requireBranchAccess(ctx, tenant.membership, args.branchId);
    }

    if (args.shopId) {
      const shop = await ctx.db.get(args.shopId);
      if (!shop || shop.businessId !== tenant.businessId) {
        throw new ConvexError("That shop belongs to another business.");
      }
    }

    // One open shift per cashier.
    const open = await ctx.db
      .query("cashShifts")
      .withIndex("by_userId", (q: any) => q.eq("userId", tenant.user._id))
      .collect();
    const alreadyOpen = open.find((s: any) => s.status === "open");
    if (alreadyOpen) {
      throw new ConvexError(
        "You already have an open shift. Close it before opening another."
      );
    }

    const now = new Date().toISOString();
    const shiftId = await ctx.db.insert("cashShifts", {
      businessId: tenant.businessId,
      branchId: args.branchId,
      shopId: args.shopId,
      userId: tenant.user._id,
      userName: displayName(tenant.user),
      status: "open",
      openedAt: now,
      openingFloat: money(args.openingFloat),
      notes: args.notes,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Open Shift",
      `Opened the till with ${money(args.openingFloat).toLocaleString()} as float`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "finance.shift.open",
      targetType: "cash_shift",
      targetId: shiftId,
      metadata: {
        openingFloat: args.openingFloat,
        branchId: args.branchId,
        shopId: args.shopId,
      },
    });

    return shiftId;
  },
});

/**
 * Close a shift.
 *
 * The cashier counts the drawer. The system knows what should be in it. The
 * difference is recorded, so a shortfall cannot quietly become the new
 * normal.
 */
export const closeShift = mutation({
  args: {
    shiftId: v.id("cashShifts"),
    countedCash: v.number(),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");

    if (args.countedCash < 0) {
      throw new ConvexError("A cash count cannot be negative.");
    }

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that shift belongs to another business.");
    }
    if (shift.status !== "open") {
      throw new ConvexError("That shift is already closed.");
    }

    // A cashier closes their own shift; somebody with drawer authority can
    // close anybody's.
    const isOwn = shift.userId === tenant.user._id;
    if (!isOwn) {
      await requirePermission(ctx, tenant.businessId, "finance.cash.manage");
    }

    await requireBranchAccess(ctx, tenant.membership, shift.branchId);

    const expected = await expectedCashForShift(ctx, tenant.businessId, shift);
    const variance = money(args.countedCash - expected);
    const now = new Date().toISOString();

    await ctx.db.patch(shift._id, {
      status: "closed",
      closedAt: now,
      countedCash: money(args.countedCash),
      expectedCash: expected,
      variance,
      notes: args.notes ?? shift.notes,
      closedBy: tenant.user._id,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Close Shift",
      `Closed the till — expected ${expected.toLocaleString()}, counted ${money(
        args.countedCash
      ).toLocaleString()}, variance ${variance.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "finance.shift.close",
      targetType: "cash_shift",
      targetId: shift._id,
      metadata: {
        countedCash: args.countedCash,
        expectedCash: expected,
        variance,
        userId: shift.userId,
      },
    });

    return { expectedCash: expected, countedCash: money(args.countedCash), variance };
  },
});

/** The caller's open shift, if there is one. */
export const getCurrentShift = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");

    const shifts = await ctx.db
      .query("cashShifts")
      .withIndex("by_userId", (q: any) => q.eq("userId", tenant.user._id))
      .collect();

    const open = shifts.find((s: any) => s.status === "open");
    if (!open) return null;

    const breakdown = await shiftCashBreakdown(ctx, tenant.businessId, open);

    return {
      ...open,
      breakdown,
      expectedCash: money(
        (open.openingFloat ?? 0) +
          breakdown.cashSales +
          breakdown.cashIn -
          breakdown.cashOut
      ),
    };
  },
});

/** The shifts of a business, newest first. */
export const listShifts = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    userId: v.optional(v.id("users")),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");

    const { start, end } = await businessDayBounds(ctx, tenant.businessId, args.from, args.to);

    const shifts = await ctx.db
      .query("cashShifts")
      .withIndex("by_businessId_openedAt", (q: any) =>
        q
          .eq("businessId", tenant.businessId)
          .gte("openedAt", start)
          .lte("openedAt", end)
      )
      .collect();

    // A branch manager sees their own branches only.
    const allowed = await allowedBranchIds(ctx, tenant.membership);
    let visible = shifts;
    if (allowed) {
      visible = visible.filter((s: any) => !s.branchId || allowed.includes(s.branchId));
    }
    if (args.branchId) {
      visible = visible.filter((s: any) => s.branchId === args.branchId);
    }
    if (args.userId) {
      visible = visible.filter((s: any) => s.userId === args.userId);
    }
    if (args.status) {
      visible = visible.filter((s: any) => s.status === args.status);
    }

    visible.sort((a: any, b: any) => b.openedAt.localeCompare(a.openedAt));

    const totalCount = visible.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 25;
    const page = visible.slice(offset, offset + limit);

    return { page, totalCount, hasMore: offset + limit < totalCount };
  },
});

/** One shift, in full: what should be in the drawer, and what was. */
export const getShiftDetail = query({
  args: {
    shiftId: v.id("cashShifts"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");

    const shift = await ctx.db.get(args.shiftId);
    if (!shift || shift.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that shift belongs to another business.");
    }
    await requireBranchAccess(ctx, tenant.membership, shift.branchId);

    const breakdown = await shiftCashBreakdown(ctx, tenant.businessId, shift);
    const expected = money(
      (shift.openingFloat ?? 0) +
        breakdown.cashSales +
        breakdown.cashIn -
        breakdown.cashOut
    );

    const movements = await ctx.db
      .query("cashMovements")
      .withIndex("by_shiftId", (q: any) => q.eq("shiftId", shift._id))
      .collect();

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_businessId_date", (q: any) =>
        q
          .eq("businessId", tenant.businessId)
          .gte("date", shift.openedAt)
          .lte("date", shift.closedAt ?? new Date().toISOString())
      )
      .collect();

    const mine = sales.filter((sale: any) => {
      if (sale.userId !== shift.userId) return false;
      if (shift.shopId) return sale.shopId === shift.shopId;
      if (shift.branchId) return sale.branchId === shift.branchId;
      return true;
    });

    return {
      shift,
      breakdown,
      expectedCash: expected,
      variance:
        shift.countedCash === undefined || shift.countedCash === null
          ? undefined
          : money(shift.countedCash - expected),
      movements,
      sales: mine
        .sort((a: any, b: any) => b.date.localeCompare(a.date))
        .map((sale: any) => ({
          _id: sale._id,
          invoiceNumber: sale.invoiceNumber,
          total: sale.total,
          paymentMode: sale.paymentMode,
          date: sale.date,
        })),
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Cash in and cash out
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Record money going into or out of the till.
 *
 * A movement may carry a **reference** — the receipt or slip number. Two
 * movements with the same reference are the same money, and the second is
 * refused, so a pay-out cannot be entered twice.
 */
export const recordCashMovement = mutation({
  args: {
    type: v.union(v.literal("in"), v.literal("out")),
    amount: v.number(),
    category: v.string(),
    reason: v.string(),
    reference: v.optional(v.string()),
    date: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    shiftId: v.optional(v.id("cashShifts")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.manage");

    if (args.amount <= 0) {
      throw new ConvexError("A cash movement must be greater than zero.");
    }
    if (!args.reason.trim()) {
      throw new ConvexError("A cash movement needs a reason.");
    }

    const branchId = args.branchId;
    if (branchId) {
      const branch = await ctx.db.get(branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
      await requireBranchAccess(ctx, tenant.membership, branchId);
    }

    if (args.shiftId) {
      const shift = await ctx.db.get(args.shiftId);
      if (!shift || shift.businessId !== tenant.businessId) {
        throw new ConvexError("That shift belongs to another business.");
      }
    }

    const reference = args.reference?.trim() || undefined;
    if (reference) {
      const existing = await ctx.db
        .query("cashMovements")
        .withIndex("by_reference", (q: any) => q.eq("reference", reference))
        .collect();
      const duplicate = existing.find(
        (m: any) => m.businessId === tenant.businessId
      );
      if (duplicate) {
        throw new ConvexError(
          `A cash movement with reference "${reference}" has already been recorded.`
        );
      }
    }

    const now = new Date().toISOString();
    const movementId = await ctx.db.insert("cashMovements", {
      businessId: tenant.businessId,
      branchId,
      shiftId: args.shiftId,
      type: args.type,
      amount: money(args.amount),
      category: args.category,
      reason: args.reason.trim(),
      reference,
      date: args.date ?? now,
      userId: tenant.user._id,
      userName: displayName(tenant.user),
      createdAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      args.type === "in" ? "Cash In" : "Cash Out",
      `${args.type === "in" ? "Into" : "Out of"} the till — ${money(
        args.amount
      ).toLocaleString()} (${args.category}): ${args.reason}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "finance.cash.movement",
      targetType: "cash_movement",
      targetId: movementId,
      metadata: {
        type: args.type,
        amount: args.amount,
        category: args.category,
        reference,
      },
    });

    return movementId;
  },
});

/** The cash movements of a business, newest first. */
export const listCashMovements = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    type: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.manage");

    const { start, end } = await businessDayBounds(ctx, tenant.businessId, args.from, args.to);

    const movements = await ctx.db
      .query("cashMovements")
      .withIndex("by_businessId_date", (q: any) =>
        q
          .eq("businessId", tenant.businessId)
          .gte("date", start)
          .lte("date", end)
      )
      .collect();

    const allowed = await allowedBranchIds(ctx, tenant.membership);
    let visible = movements;
    if (allowed) {
      visible = visible.filter(
        (m: any) => !m.branchId || allowed.includes(m.branchId)
      );
    }
    if (args.branchId) {
      visible = visible.filter((m: any) => m.branchId === args.branchId);
    }
    if (args.type) {
      visible = visible.filter((m: any) => m.type === args.type);
    }

    visible.sort((a: any, b: any) => b.date.localeCompare(a.date));

    const totalCount = visible.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;
    const page = visible.slice(offset, offset + limit);

    let totalIn = 0;
    let totalOut = 0;
    for (const movement of visible) {
      if (movement.type === "in") totalIn += movement.amount ?? 0;
      else totalOut += movement.amount ?? 0;
    }

    return {
      page,
      totalCount,
      hasMore: offset + limit < totalCount,
      totalIn: money(totalIn),
      totalOut: money(totalOut),
      net: money(totalIn - totalOut),
    };
  },
});

/**
 * The cash drawer.
 *
 * Either one shift, or the business over a period.
 */
export const getCashDrawer = query({
  args: {
    shiftId: v.optional(v.id("cashShifts")),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.cash.shift.manage");

    const businessId = tenant.businessId;

    // ── One shift ───────────────────────────────────────────────────────
    if (args.shiftId) {
      const shift = await ctx.db.get(args.shiftId);
      if (!shift || shift.businessId !== businessId) {
        throw new ConvexError("Forbidden: that shift belongs to another business.");
      }
      await requireBranchAccess(ctx, tenant.membership, shift.branchId);

      const breakdown = await shiftCashBreakdown(ctx, businessId, shift);
      const expected = money(
        (shift.openingFloat ?? 0) +
          breakdown.cashSales +
          breakdown.cashIn -
          breakdown.cashOut
      );

      return {
        scope: "shift" as const,
        shift,
        openingFloat: money(shift.openingFloat ?? 0),
        cashSales: breakdown.cashSales,
        cashIn: breakdown.cashIn,
        cashOut: breakdown.cashOut,
        expectedCash: expected,
        countedCash: shift.countedCash,
        variance:
          shift.countedCash === undefined || shift.countedCash === null
            ? undefined
            : money(shift.countedCash - expected),
      };
    }

    // ── A period ────────────────────────────────────────────────────────
    const { start, end } = await businessDayBounds(ctx, tenant.businessId, args.from, args.to);

    const shifts = await ctx.db
      .query("cashShifts")
      .withIndex("by_businessId_openedAt", (q: any) =>
        q
          .eq("businessId", businessId)
          .gte("openedAt", start)
          .lte("openedAt", end)
      )
      .collect();

    const allowed = await allowedBranchIds(ctx, tenant.membership);
    let visibleShifts = shifts;
    if (allowed) {
      visibleShifts = visibleShifts.filter(
        (s: any) => !s.branchId || allowed.includes(s.branchId)
      );
    }
    if (args.branchId) {
      visibleShifts = visibleShifts.filter(
        (s: any) => s.branchId === args.branchId
      );
    }

    const openingFloat = visibleShifts.reduce(
      (sum: number, s: any) => sum + (s.openingFloat ?? 0),
      0
    );

    const movements = await ctx.db
      .query("cashMovements")
      .withIndex("by_businessId_date", (q: any) =>
        q.eq("businessId", businessId).gte("date", start).lte("date", end)
      )
      .collect();

    let cashIn = 0;
    let cashOut = 0;
    for (const movement of movements) {
      if (args.branchId && movement.branchId !== args.branchId) continue;
      if (movement.type === "in") cashIn += movement.amount ?? 0;
      else cashOut += movement.amount ?? 0;
    }

    const sales = await loadSales(ctx, businessId, args.from, args.to, args.branchId);
    let cashSales = 0;
    for (const sale of sales) {
      if (!isCashMethod(sale.paymentMode)) continue;
      cashSales += (sale.total ?? 0) - (sale.refundAmount ?? 0);
    }

    const countedCash = visibleShifts.reduce(
      (sum: number, s: any) =>
        s.countedCash === undefined || s.countedCash === null
          ? sum
          : sum + s.countedCash,
      0
    );
    const closedShifts = visibleShifts.filter(
      (s: any) => s.countedCash !== undefined && s.countedCash !== null
    );

    /**
     * The variance of the period is the sum of the shifts' own variances.
     *
     * Each shift's variance was worked out against that shift's own cash
     * sales and movements, so adding them up is exact. Subtracting the
     * counted cash from the period's expected cash would mix in any cash
     * taken outside a shift and give a number that means nothing.
     */
    const shiftVariance = visibleShifts.reduce(
      (sum: number, s: any) =>
        s.variance === undefined || s.variance === null ? sum : sum + s.variance,
      0
    );

    const expectedCash = money(openingFloat + cashSales + cashIn - cashOut);

    return {
      scope: "period" as const,
      openingFloat: money(openingFloat),
      cashSales: money(cashSales),
      cashIn: money(cashIn),
      cashOut: money(cashOut),
      expectedCash,
      countedCash: closedShifts.length > 0 ? money(countedCash) : undefined,
      variance: closedShifts.length > 0 ? money(shiftVariance) : undefined,
      shiftCount: visibleShifts.length,
      closedShiftCount: closedShifts.length,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Other income
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Record income that is not a sale.
 *
 * Rent from a third party, a service fee, a grant. Money that came in
 * without goods leaving the shelf, so it is not revenue and does not flatter
 * the gross profit.
 */
export const recordIncome = mutation({
  args: {
    amount: v.number(),
    source: v.string(),
    description: v.optional(v.string()),
    date: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    reference: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.income.create");
    await requireEntitlement(ctx, tenant.businessId, "finance.reports");

    if (args.amount <= 0) {
      throw new ConvexError("An income record must be greater than zero.");
    }
    if (!args.source.trim()) {
      throw new ConvexError("An income record needs a source.");
    }

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
      await requireBranchAccess(ctx, tenant.membership, args.branchId);
    }

    const now = new Date().toISOString();
    const incomeId = await ctx.db.insert("incomeRecords", {
      businessId: tenant.businessId,
      branchId: args.branchId,
      date: args.date ?? now,
      amount: money(args.amount),
      source: args.source.trim(),
      description: args.description,
      reference: args.reference,
      userId: tenant.user._id,
      createdAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Record Income",
      `${args.source.trim()} — ${money(args.amount).toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "finance.income.create",
      targetType: "income_record",
      targetId: incomeId,
      metadata: { amount: args.amount, source: args.source },
    });

    return incomeId;
  },
});

/** The other-income records of a business. */
export const listIncome = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "finance.reports");

    const records = await loadIncome(
      ctx,
      tenant.businessId,
      args.from,
      args.to,
      args.branchId
    );
    records.sort((a: any, b: any) => b.date.localeCompare(a.date));

    const totalCount = records.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;
    const page = records.slice(offset, offset + limit);

    return {
      page,
      totalCount,
      hasMore: offset + limit < totalCount,
      total: money(records.reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0)),
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Reconciliation
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Reconcile a provider statement against the books.
 *
 * The provider says "we paid you 1,200,000". The books say "we recorded
 * 1,150,000". The 50,000 difference is the thing worth knowing about — it
 * is a fee, a missing deposit, or a sale that was entered twice.
 *
 * When `recordedAmount` is not given, it is worked out from the books: the
 * sales paid that way in the period, plus the repayments of credit taken
 * that way.
 */
export const reconcile = mutation({
  args: {
    kind: v.string(),
    method: v.string(),
    period: v.string(),
    statementReference: v.string(),
    statementAmount: v.number(),
    recordedAmount: v.optional(v.number()),
    notes: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reconcile.manage");
    await requireEntitlement(ctx, tenant.businessId, "finance.reports");

    if (!args.statementReference.trim()) {
      throw new ConvexError("A reconciliation needs the statement reference.");
    }
    if (!/^\d{4}-\d{2}$/.test(args.period)) {
      throw new ConvexError("A period is written as YYYY-MM.");
    }

    let recorded = args.recordedAmount;

    if (recorded === undefined) {
      // The books for that month: the sales paid that way, plus the
      // repayments of credit taken that way.
      const from = `${args.period}-01`;
      const monthNumber = Number(args.period.slice(5, 7));
      const lastDay = new Date(
        Date.UTC(Number(args.period.slice(0, 4)), monthNumber, 0)
      ).toISOString().slice(0, 10);
      const to = `${lastDay}T23:59:59.999Z`;

      const sales = await ctx.db
        .query("sales")
        .withIndex("by_businessId_date", (q: any) =>
          q.eq("businessId", tenant.businessId).gte("date", from).lte("date", to)
        )
        .collect();

      let total = 0;
      for (const sale of sales) {
        const mode = (sale.paymentMode ?? "").toLowerCase();
        if (mode !== args.method.toLowerCase()) continue;
        total += (sale.total ?? 0) - (sale.refundAmount ?? 0);
      }

      // Credit taken and then repaid by this method also reached the account.
      const payments = await ctx.db
        .query("payments")
        .withIndex("by_businessId", (q: any) =>
          q.eq("businessId", tenant.businessId)
        )
        .collect();
      for (const payment of payments) {
        if (!payment.date.startsWith(args.period)) continue;
        const method = (payment.method ?? "").toLowerCase();
        if (method !== args.method.toLowerCase()) continue;
        total += payment.amount ?? 0;
      }

      recorded = money(total);
    }

    const variance = money(args.statementAmount - recorded);
    const now = new Date().toISOString();

    const reconciliationId = await ctx.db.insert("reconciliations", {
      businessId: tenant.businessId,
      branchId: args.branchId,
      kind: args.kind,
      method: args.method,
      period: args.period,
      statementReference: args.statementReference.trim(),
      statementAmount: money(args.statementAmount),
      recordedAmount: money(recorded),
      variance,
      status: variance === 0 ? "reconciled" : "discrepancy",
      notes: args.notes,
      resolvedBy: tenant.user._id,
      resolvedAt: now,
      userId: tenant.user._id,
      createdAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Reconcile",
      `${args.method} ${args.period} — statement ${money(
        args.statementAmount
      ).toLocaleString()}, books ${money(recorded).toLocaleString()}, variance ${variance.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "finance.reconciliation.create",
      targetType: "reconciliation",
      targetId: reconciliationId,
      metadata: {
        kind: args.kind,
        method: args.method,
        period: args.period,
        statementAmount: args.statementAmount,
        recordedAmount: recorded,
        variance,
      },
    });

    return {
      reconciliationId,
      recordedAmount: money(recorded),
      variance,
      status: variance === 0 ? "reconciled" : "discrepancy",
    };
  },
});

/** The reconciliations of a business. */
export const listReconciliations = query({
  args: {
    period: v.optional(v.string()),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "finance.reports");

    const rows = await ctx.db
      .query("reconciliations")
      .withIndex("by_businessId", (q: any) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    let visible = rows;
    if (args.period) {
      visible = visible.filter((r: any) => r.period === args.period);
    }
    if (args.status) {
      visible = visible.filter((r: any) => r.status === args.status);
    }

    visible.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));

    const totalCount = visible.length;
    const offset = args.offset ?? 0;
    const limit = args.limit ?? 50;
    const page = visible.slice(offset, offset + limit);

    return {
      page,
      totalCount,
      hasMore: offset + limit < totalCount,
      totalVariance: money(
        visible.reduce((sum: number, r: any) => sum + (r.variance ?? 0), 0)
      ),
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * The financial summary
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The financial position of the business over a period.
 *
 * This is the one place the profit and loss is worked out, so the finance
 * page, the reports and the dashboard all show the same numbers.
 */
export const getFinancialSummary = query({
  args: {
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.reports.view");
    await requireEntitlement(ctx, tenant.businessId, "finance.reports");

    const businessId = tenant.businessId;

    const sales = await loadSales(
      ctx,
      businessId,
      args.from,
      args.to,
      args.branchId
    );
    const costs = await buildCostIndexForPeriod(ctx, businessId, args.from, args.to);
    const saleTotals = summariseSales(sales, costs);

    const expenses = await loadExpenses(
      ctx,
      businessId,
      args.from,
      args.to,
      args.branchId
    );
    const expenseTotals = summariseExpenses(expenses);

    const income = await loadIncome(
      ctx,
      businessId,
      args.from,
      args.to,
      args.branchId
    );
    const otherIncome = money(
      income.reduce((sum: number, r: any) => sum + (r.amount ?? 0), 0)
    );

    // ── Receivables: what customers owe ────────────────────────────────
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();
    const receivables = money(
      loans.reduce((sum: number, l: any) => sum + (l.balance ?? 0), 0)
    );

    // ── Payables: what the business owes suppliers ─────────────────────
    const ledger = await ctx.db
      .query("supplierLedger")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect();
    const balanceBySupplier = new Map<string, number>();
    for (const row of ledger) {
      const key = row.supplierId as string;
      balanceBySupplier.set(key, (balanceBySupplier.get(key) ?? 0) + (row.amount ?? 0));
    }
    const payables = money(
      [...balanceBySupplier.values()].reduce(
        (sum: number, balance) => sum + Math.max(0, balance),
        0
      )
    );

    // ── Cash movements over the period ─────────────────────────────────
    const { start, end } = await businessDayBounds(ctx, tenant.businessId, args.from, args.to);
    const movements = await ctx.db
      .query("cashMovements")
      .withIndex("by_businessId_date", (q: any) =>
        q.eq("businessId", businessId).gte("date", start).lte("date", end)
      )
      .collect();
    let cashIn = 0;
    let cashOut = 0;
    for (const movement of movements) {
      if (movement.type === "in") cashIn += movement.amount ?? 0;
      else cashOut += movement.amount ?? 0;
    }

    const grossProfit = money(saleTotals.revenue - saleTotals.cost);
    const netProfit = money(
      grossProfit + otherIncome - expenseTotals.total
    );

    return {
      from: args.from,
      to: args.to,
      branchId: args.branchId,

      revenue: money(saleTotals.revenue),
      costOfGoodsSold: money(saleTotals.cost),
      grossProfit,
      grossMargin:
        saleTotals.revenue > 0 ? (grossProfit / saleTotals.revenue) * 100 : 0,

      operatingExpenses: money(expenseTotals.total),
      expenseCount: expenseTotals.count,
      expensesByType: expenseTotals.byType,

      otherIncome,
      netProfit,
      netMargin:
        saleTotals.revenue > 0 ? (netProfit / saleTotals.revenue) * 100 : 0,

      transactions: saleTotals.transactions,
      itemsSold: saleTotals.items,
      creditTransactions: saleTotals.creditTransactions,
      creditRevenue: money(saleTotals.creditRevenue),
      cashRevenue: money(saleTotals.cashRevenue),
      otherRevenue: money(saleTotals.otherRevenue),

      receivables,
      payables,
      cashIn: money(cashIn),
      cashOut: money(cashOut),
    };
  },
});
