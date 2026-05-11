import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("banking").order("desc").paginate(args.paginationOpts);
    },
});

export const update = mutation({
    args: {
        id: v.id("banking"),
        date: v.optional(v.string()),
        amount: v.optional(v.number()),
        comment: v.optional(v.string()),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { id, userId, ...rest } = args;
        const banking = await ctx.db.get(id);
        if (!banking) throw new Error("Banking record not found");

        await ctx.db.patch(id, rest);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Update Banking Record",
            details: `Updated banking record - Changes: ${changes}`,
            timestamp: new Date().toISOString(),
        });
    },
});

export const remove = mutation({
    args: { id: v.id("banking"), userId: v.id("users") },
    handler: async (ctx, args) => {
        const banking = await ctx.db.get(args.id);
        if (!banking) throw new Error("Banking record not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Delete Banking Record",
            details: `Deleted banking record - Amount: UGX ${banking.amount?.toLocaleString() || 'N/A'}, Comment: ${banking.comment || 'N/A'}`,
            timestamp: new Date().toISOString(),
        });
    },
});
