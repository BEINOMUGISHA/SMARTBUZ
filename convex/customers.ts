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

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("customers");
        let results = await q.order("desc").collect();

        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            results = results.filter(c =>
                c.name.toLowerCase().includes(search) ||
                c.phone.includes(search) ||
                (c.distributorId && c.distributorId.toLowerCase().includes(search))
            );
        }

        const totalCount = results.length;
        const page = results.slice(args.offset, args.offset + args.limit);

        return { page, totalCount };
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { userId, ...customerArgs } = args;
        const customerId = await ctx.db.insert("customers", customerArgs);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Add Customer",
            details: `Added new customer: ${args.name} (${args.phone})${args.distributorId ? ` - Distributor ID: ${args.distributorId}` : ''}`,
            timestamp: new Date().toISOString(),
        });

        return customerId;
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { id, userId, ...rest } = args;
        const customer = await ctx.db.get(id);
        if (!customer) throw new Error("Customer not found");

        await ctx.db.patch(id, rest);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Update Customer",
            details: `Updated customer ${customer.name} - Changes: ${changes}`,
            timestamp: new Date().toISOString(),
        });
    },
});

// Delete customer
export const remove = mutation({
    args: { id: v.id("customers"), userId: v.id("users") },
    handler: async (ctx, args) => {
        const customer = await ctx.db.get(args.id);
        if (!customer) throw new Error("Customer not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Delete Customer",
            details: `Deleted customer: ${customer.name} (${customer.phone})${customer.distributorId ? ` - Distributor ID: ${customer.distributorId}` : ''}`,
            timestamp: new Date().toISOString(),
        });
    },
});
