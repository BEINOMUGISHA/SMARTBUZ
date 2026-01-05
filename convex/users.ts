import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import bcrypt from "bcryptjs";

// Fetch all users with pagination and search (Paginated)
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

// Fetch all users (Client-side pagination support)
export const listAll = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("users").order("desc").collect();
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

// Universal Update User (combines profile and basic fields)
export const update = mutation({
    args: {
        id: v.id("users"),
        first_name: v.optional(v.string()),
        middle_name: v.optional(v.string()),
        last_name: v.optional(v.string()),
        email: v.optional(v.string()),
        // Profile fields
        address: v.optional(v.string()),
        phone_number: v.optional(v.string()),
        date_of_birth: v.optional(v.string()),
        gender: v.optional(v.string()),
        marital_status: v.optional(v.string()),
        nationality: v.optional(v.string()),
        roles: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

// Login verification
export const login = mutation({
    args: {
        email: v.string(),
        password: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        if (!user) throw new Error("Invalid email or password");

        const isValid = bcrypt.compareSync(args.password, user.password);
        if (!isValid) throw new Error("Invalid email or password");

        return user;
    },
});

// Password reset request
export const requestPasswordReset = mutation({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        if (!user) return { success: true }; // Don't leak user existence

        // Generate a 6-digit code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        const expiresAt = Date.now() + 3600000; // 1 hour

        // Clear existing resets for this email
        const existing = await ctx.db
            .query("passwordResets")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .collect();
        for (const r of existing) {
            await ctx.db.delete(r._id);
        }

        await ctx.db.insert("passwordResets", {
            email: args.email,
            code,
            expiresAt,
        });

        // In a real app, send an email here.
        console.log(`Password reset code for ${args.email}: ${code}`);

        return { success: true };
    },
});

// Complete password reset
export const resetPassword = mutation({
    args: {
        email: v.string(),
        code: v.string(),
        newPassword: v.string(),
    },
    handler: async (ctx, args) => {
        const reset = await ctx.db
            .query("passwordResets")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .filter((q) => q.eq(q.field("code"), args.code))
            .unique();

        if (!reset || reset.expiresAt < Date.now()) {
            throw new Error("Invalid or expired reset code");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        if (!user) throw new Error("User not found");

        const hashedPassword = bcrypt.hashSync(args.newPassword, 10);
        await ctx.db.patch(user._id, { password: hashedPassword });
        await ctx.db.delete(reset._id);

        return { success: true };
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
        password: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        if (existing) throw new Error("User with this email already exists");

        // Use provided password or default
        const passwordToHash = args.password || "password123";
        const hashedPassword = bcrypt.hashSync(passwordToHash, 10);

        const { password, ...userArgs } = args;

        return await ctx.db.insert("users", {
            ...userArgs,
            password: hashedPassword,
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

// Change Password (for logged-in users)
export const changePassword = mutation({
    args: {
        userId: v.id("users"),
        currentPassword: v.string(),
        newPassword: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error("User not found");

        const isValid = bcrypt.compareSync(args.currentPassword, user.password);
        if (!isValid) throw new Error("Incorrect current password");

        const hashedPassword = bcrypt.hashSync(args.newPassword, 10);
        await ctx.db.patch(args.userId, { password: hashedPassword });
    },
});
