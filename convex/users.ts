import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

// Fetch all users with pagination and search
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let usersQuery = ctx.db.query("users");

        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            usersQuery = usersQuery.filter((q) =>
                q.or(
                    q.eq(q.field("first_name"), search),
                    q.eq(q.field("last_name"), search),
                    q.eq(q.field("email"), search)
                )
            );
        }

        return await usersQuery.order("desc").paginate(args.paginationOpts);
    },
});

// Get user by email
export const getByEmail = query({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
    },
});

// Update user roles
export const setRoles = mutation({
    args: {
        userId: v.id("users"),
        roles: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.userId, {
            roles: args.roles,
        });
    },
});

// Update user profile
export const updateProfile = mutation({
    args: {
        id: v.id("users"),
        first_name: v.optional(v.string()),
        middle_name: v.optional(v.string()),
        last_name: v.optional(v.string()),
        email: v.optional(v.string()),
        address: v.optional(v.string()),
        phone_number: v.optional(v.string()),
        date_of_birth: v.optional(v.string()),
        gender: v.optional(v.string()),
        marital_status: v.optional(v.string()),
        nationality: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

// Create user
export const create = mutation({
    args: {
        first_name: v.string(),
        middle_name: v.optional(v.string()),
        last_name: v.string(),
        email: v.string(),
        roles: v.array(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        if (existing) throw new Error("User with this email already exists");

        // Set default temporary password
        const password = "12345678"; // Hashed representation or clear for now as per original

        return await ctx.db.insert("users", {
            ...args,
            password,
        });
    },
});

// Toggle a single role
export const toggleRole = mutation({
    args: {
        userId: v.id("users"),
        role: v.string(),
        action: v.union(v.literal("add"), v.literal("remove")),
    },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error("User not found");

        let roles = [...user.roles];
        if (args.action === "add" && !roles.includes(args.role)) {
            roles.push(args.role);
        } else if (args.action === "remove") {
            roles = roles.filter(r => r !== args.role);
        }

        await ctx.db.patch(args.userId, { roles });
    },
});

// Delete user
export const remove = mutation({
    args: { id: v.id("users") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
    },
});
