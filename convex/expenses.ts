import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";

/**
 * SMARTBUZ — expenses.
 *
 * Running costs of the business, scoped to the business that recorded them.
 */
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        return await ctx.db
            .query("expenses")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const add = mutation({
    args: {
        amount: v.number(),
        expense: v.string(),
        receivedBy: v.string(),
        type: v.string(),
        date: v.string(),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.expenses.create");

        const expenseId = await ctx.db.insert("expenses", {
            businessId: tenant.businessId,
            amount: args.amount,
            expense: args.expense,
            receivedBy: args.receivedBy,
            type: args.type,
            date: args.date,
            // The recorder is the authenticated caller, not whoever the
            // browser said it was.
            userId: tenant.user._id,
        });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Add Expense",
            `Added expense: ${args.expense} - UGX ${args.amount.toLocaleString()} (${args.type}) received by ${args.receivedBy}`
        );

        return expenseId;
    },
});

export const remove = mutation({
    args: {
        id: v.id("expenses"),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.expenses.create");

        const expense = await ctx.db.get(args.id);
        if (!expense) throw new Error("Expense not found");
        if (expense.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that expense belongs to another business.");
        }

        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Delete Expense",
            `Deleted expense: ${expense.expense} - UGX ${expense.amount.toLocaleString()} (${expense.type})`
        );
    },
});

export const update = mutation({
    args: {
        id: v.id("expenses"),
        amount: v.number(),
        expense: v.string(),
        receivedBy: v.string(),
        type: v.string(),
        date: v.string(),
        userId: v.id("users"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.expenses.create");

        const existing = await ctx.db.get(args.id);
        if (!existing) throw new Error("Expense not found");
        if (existing.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that expense belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            amount: args.amount,
            expense: args.expense,
            receivedBy: args.receivedBy,
            type: args.type,
            date: args.date,
        });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Expense",
            `Updated expense: ${args.expense} - UGX ${args.amount.toLocaleString()} (${args.type}) received by ${args.receivedBy}`
        );

        return args.id;
    },
});

// Get expenses by date range
export const listByDateRange = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        let q = ctx.db
            .query("expenses")
            .withIndex("by_businessId", (index) => index.eq("businessId", tenant.businessId));

        if (args.from && args.to) {
            q = q.filter((f) =>
                f.and(
                    f.gte(f.field("date"), args.from!),
                    f.lte(f.field("date"), args.to!)
                )
            );
        }

        return await q.order("desc").collect();
    },
});

// Get expense stats for a date range
export const getStats = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        let q = ctx.db
            .query("expenses")
            .withIndex("by_businessId", (index) => index.eq("businessId", tenant.businessId));

        if (args.from && args.to) {
            q = q.filter((f) =>
                f.and(
                    f.gte(f.field("date"), args.from!),
                    f.lte(f.field("date"), args.to!)
                )
            );
        }

        const expenses = await q.collect();

        const total = expenses.reduce((sum, e) => sum + e.amount, 0);
        const count = expenses.length;

        // Group by type
        const byType = expenses.reduce((acc, e) => {
            const type = e.type || "Uncategorized";
            if (!acc[type]) acc[type] = { total: 0, count: 0 };
            acc[type].total += e.amount;
            acc[type].count += 1;
            return acc;
        }, {} as Record<string, { total: number; count: number }>);

        return {
            total,
            count,
            byType,
        };
    },
});

// Get a single expense with user details
export const getExpenseWithUser = query({
    args: {
        id: v.id("expenses"),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        const expense = await ctx.db.get(args.id);
        if (!expense) return null;
        if (expense.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that expense belongs to another business.");
        }

        const user = expense.userId ? await ctx.db.get(expense.userId) : null;

        return {
            ...expense,
            user,
        };
    },
});
