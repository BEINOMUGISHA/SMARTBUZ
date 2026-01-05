import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        if (args.userId) {
            return await ctx.db
                .query("activityLogs")
                .withIndex("by_userId", (q) => q.eq("userId", args.userId as any))
                .order("desc")
                .paginate(args.paginationOpts);
        }

        return await ctx.db
            .query("activityLogs")
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const add = mutation({
    args: {
        userId: v.id("users"),
        action: v.string(),
        details: v.string(),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: args.action,
            details: args.details,
            timestamp: new Date().toISOString(),
        });
    },
});
