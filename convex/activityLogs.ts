import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requirePermission, requireTenant } from "./tenancy";

/**
 * SMARTBUZ — activity log (audit trail).
 *
 * The log is tenant-scoped: an operator of Business A may read the audit
 * trail of Business A and never of Business B.
 */
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        userId: v.optional(v.id("users")),
        action: v.optional(v.string()),
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        let logs = await ctx.db
            .query("activityLogs")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        return await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            // The actor is the authenticated caller; `args.userId` is kept for
            // compatibility with older call sites but is never trusted.
            userId: tenant.user._id,
            action: args.action,
            details: args.details,
            timestamp: new Date().toISOString(),
        });
    },
});
