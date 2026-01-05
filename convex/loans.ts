import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("loans").order("desc").paginate(args.paginationOpts);
    },
});

export const add = mutation({
    args: {
        customerId: v.id("customers"),
        salesId: v.id("sales"),
        amount: v.number(),
        balance: v.number(),
        date: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("loans", args);
    },
});

export const makePayment = mutation({
    args: {
        loanId: v.id("loans"),
        amount: v.number(),
        date: v.string(),
    },
    handler: async (ctx, args) => {
        const loan = await ctx.db.get(args.loanId);
        if (!loan) throw new Error("Loan not found");

        const newBalance = loan.balance - args.amount;
        if (newBalance < 0) throw new Error("Payment exceeds balance");

        await ctx.db.patch(args.loanId, { balance: newBalance });

        return await ctx.db.insert("payments", {
            loanId: args.loanId,
            amount: args.amount,
            date: args.date,
            balance: newBalance,
        });
    },
});
