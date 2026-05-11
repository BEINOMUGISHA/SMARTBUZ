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
        const { userId, ...expenseArgs } = args;
        const expenseId = await ctx.db.insert("expenses", expenseArgs);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId,
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
