import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

// List customers with pagination and search
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let customersQuery = ctx.db.query("customers");
        // Pagination
        return await customersQuery.order("desc").paginate(args.paginationOpts);
    },
});

export const listAll = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("customers").order("desc").collect();
    },
});

// Add customer
export const add = mutation({
    args: {
        name: v.string(),
        phone: v.string(),
        email: v.optional(v.string()),
        distributorId: v.optional(v.string()),
        address: v.optional(v.string()),
        packageId: v.optional(v.id("packages")),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("customers", args);
    },
});

// Update customer
export const update = mutation({
    args: {
        id: v.id("customers"),
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        distributorId: v.optional(v.string()),
        address: v.optional(v.string()),
        packageId: v.optional(v.id("packages")),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

// Delete customer
export const remove = mutation({
    args: { id: v.id("customers") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
