import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("expenses").order("desc").paginate(args.paginationOpts);
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
    },
    handler: async (ctx, args) => {
        const expenseId = await ctx.db.insert("expenses", {
            amount: args.amount,
            expense: args.expense,
            receivedBy: args.receivedBy,
            type: args.type,
            date: args.date,
            userId: args.userId,
        });

        
        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Add Expense",
            details: `Added expense: ${args.expense} - UGX ${args.amount.toLocaleString()} (${args.type}) received by ${args.receivedBy}`,
            timestamp: new Date().toISOString(),
        });

        return expenseId;
    },
});

export const remove = mutation({
    args: { id: v.id("expenses"), userId: v.id("users") },
    handler: async (ctx, args) => {
        const expense = await ctx.db.get(args.id);
        if (!expense) throw new Error("Expense not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Delete Expense",
            details: `Deleted expense: ${expense.expense} - UGX ${expense.amount.toLocaleString()} (${expense.type})`,
            timestamp: new Date().toISOString(),
        });
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
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db.get(args.id);
        if (!existing) throw new Error("Expense not found");

        await ctx.db.patch(args.id, {
            amount: args.amount,
            expense: args.expense,
            receivedBy: args.receivedBy,
            type: args.type,
            date: args.date,
        });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Update Expense",
            details: `Updated expense: ${args.expense} - UGX ${args.amount.toLocaleString()} (${args.type}) received by ${args.receivedBy}`,
            timestamp: new Date().toISOString(),
        });

        return args.id;
    },
});

// Get expenses by date range
export const listByDateRange = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("expenses");

        if (args.from && args.to) {
            q = q.filter((q) =>
                q.and(
                    q.gte(q.field("date"), args.from!),
                    q.lte(q.field("date"), args.to!)
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
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("expenses");

        if (args.from && args.to) {
            q = q.filter((q) =>
                q.and(
                    q.gte(q.field("date"), args.from!),
                    q.lte(q.field("date"), args.to!)
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
    args: { id: v.id("expenses") },
    handler: async (ctx, args) => {
        const expense = await ctx.db.get(args.id);
        if (!expense) return null;

        const user = expense.userId ? await ctx.db.get(expense.userId) : null;

        return {
            ...expense,
            user,
        };
    },
});
