import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("userTypes").collect();
    },
});

export const add = mutation({
    args: { type: v.string(), userId: v.id("users") },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("userTypes")
            .filter((q) => q.eq(q.field("type"), args.type))
            .unique();
        if (existing) throw new Error("User type already exists");
        const userTypeId = await ctx.db.insert("userTypes", { type: args.type });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Add User Type",
            details: `Added new user type: ${args.type}`,
            timestamp: new Date().toISOString(),
        });

        return userTypeId;
    },
});

export const remove = mutation({
    args: { id: v.id("userTypes"), userId: v.id("users") },
    handler: async (ctx, args) => {
        const userType = await ctx.db.get(args.id);
        if (!userType) throw new Error("User type not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Delete User Type",
            details: `Deleted user type: ${userType.type}`,
            timestamp: new Date().toISOString(),
        });
    },
});
