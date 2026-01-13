import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";


export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        userId: v.optional(v.id("users")),
        action: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let logs = await ctx.db
            .query("activityLogs")
            .order("desc")
            .collect();

        // Apply filters in memory for flexibility (assuming audit logs scale reasonably for this internal tool)
        // For very large datasets, we would need more specific indexes.
        if (args.userId) {
            logs = logs.filter(l => l.userId === args.userId);
        }
        if (args.action && args.action !== "all") {
            logs = logs.filter(l => l.action.toLowerCase().includes(args.action!.toLowerCase()));
        }
        if (args.startDate) {
            logs = logs.filter(l => l.timestamp >= args.startDate!);
        }
        if (args.endDate) {
            // Include the whole end day
            const end = new Date(args.endDate!);
            end.setHours(23, 59, 59, 999);
            logs = logs.filter(l => new Date(l.timestamp) <= end);
        }

        // Manual pagination since we filtered in memory
        const { paginationOpts } = args;
        const total = logs.length;
        const cursor = paginationOpts.cursor ? Number(paginationOpts.cursor) : 0;
        const limit = paginationOpts.numItems;
        const page = logs.slice(cursor, cursor + limit);

        return {
            page,
            isDone: cursor + limit >= total,
            continueCursor: (cursor + limit).toString(),
            totalCount: total // Custom field for frontend total
        };
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
