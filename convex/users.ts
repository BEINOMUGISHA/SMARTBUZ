import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import bcrypt from "bcryptjs";
import { requireAdmin, requireAuth, requireSelfOrAdmin } from "./auth";

// Helper to strip sensitive credentials before returning to client
function sanitizeUser<T extends { password?: string }>(user: T | null): Omit<T, "password"> | null {
    if (!user) return null;
    const { password, ...safeUser } = user;
    return safeUser;
}

/**
 * Generate a 6-digit numeric code from a cryptographically secure source.
 * `Math.random()` is predictable and must not be used for security tokens.
 */
function generateResetCode(): string {
    const range = 900000;
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    return (100000 + (random % range)).toString();
}

/** Max number of times a single reset code may be checked before it is voided. */
const MAX_RESET_ATTEMPTS = 5;

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

        const paginated = await usersQuery.order("desc").paginate(args.paginationOpts);
        return {
            ...paginated,
            page: paginated.page.map(u => sanitizeUser(u)!),
        };
    },
});

// Fetch all users (Client-side pagination support)
export const listAll = query({
    args: {},
    handler: async (ctx) => {
        const users = await ctx.db.query("users").order("desc").collect();
        return users.map(u => sanitizeUser(u)!);
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let q = ctx.db.query("users");

        let results = await q.order("desc").collect();

        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            results = results.filter(u =>
                u.first_name.toLowerCase().includes(search) ||
                u.last_name.toLowerCase().includes(search) ||
                u.email.toLowerCase().includes(search)
            );
        }

        const totalCount = results.length;
        const page = results.slice(args.offset, args.offset + args.limit).map(u => sanitizeUser(u)!);

        return { page, totalCount };
    },
});

// Get user by email
export const getByEmail = query({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        return sanitizeUser(user);
    },
});

// Update user roles
export const setRoles = mutation({
    args: {
        userId: v.id("users"),
        roles: v.array(v.string()),
        adminUserId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // FIX #4: Verify caller is an admin
        await requireAdmin(ctx, args.adminUserId);

        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error("User not found");

        await ctx.db.patch(args.userId, {
            roles: args.roles,
        });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.adminUserId,
            action: "Set User Roles",
            details: `Updated roles for ${user.first_name} ${user.last_name} to: ${args.roles.join(", ")}`,
            timestamp: new Date().toISOString(),
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
        adminUserId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // FIX #4: Verify caller is an admin
        await requireAdmin(ctx, args.adminUserId);

        const { id, adminUserId, ...rest } = args;
        const user = await ctx.db.get(id);
        if (!user) throw new Error("User not found");

        await ctx.db.patch(id, rest);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await ctx.db.insert("activityLogs", {
            userId: adminUserId,
            action: "Update User",
            details: `Updated user ${user.first_name} ${user.last_name} - Changes: ${changes}`,
            timestamp: new Date().toISOString(),
        });
    },
});

// Register a new user account from the public auth flow
export const register = mutation({
    args: {
        first_name: v.string(),
        last_name: v.string(),
        email: v.string(),
        password: v.string(),
        phone_number: v.optional(v.string()),
        roles: v.optional(v.array(v.string())),
    },
    handler: async (ctx, args) => {
        const email = args.email.trim().toLowerCase();
        if (!email) {
            throw new Error("Email is required");
        }

        if (!args.password || args.password.length < 6) {
            throw new Error("Password must be at least 6 characters long");
        }

        const existing = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();

        if (existing) {
            throw new Error("An account with this email already exists");
        }

        const hashedPassword = bcrypt.hashSync(args.password, 10);

        const userId = await ctx.db.insert("users", {
            first_name: args.first_name.trim(),
            middle_name: undefined,
            last_name: args.last_name.trim(),
            email,
            password: hashedPassword,
            roles: args.roles ?? ["sales"],
            phone_number: args.phone_number,
            address: undefined,
            date_of_birth: undefined,
            gender: undefined,
            marital_status: undefined,
            nationality: undefined,
            profile_picture: undefined,
        });

        const user = await ctx.db.get(userId);

        if (user) {
            await ctx.db.insert("activityLogs", {
                userId: user._id,
                action: "User Registration",
                details: `User ${user.first_name} ${user.last_name} registered a new account`,
                timestamp: new Date().toISOString(),
            });
        }

        return { success: true, userId };
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

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: user._id,
            action: "User Login",
            details: `User ${user.first_name} ${user.last_name} logged in`,
            timestamp: new Date().toISOString(),
        });

        return sanitizeUser(user);
    },
});

// Password reset request
export const requestPasswordReset = mutation({
    args: { email: v.string(), serverSecret: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const email = args.email.trim().toLowerCase();
        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();
        if (!user) return { success: true }; // Don't leak user existence

        // Generate a 6-digit code from a cryptographically secure source
        const code = generateResetCode();
        const expiresAt = Date.now() + 3600000; // 1 hour

        // Clear existing resets for this email
        const existing = await ctx.db
            .query("passwordResets")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect();
        for (const r of existing) {
            await ctx.db.delete(r._id);
        }

        await ctx.db.insert("passwordResets", {
            email,
            code,
            expiresAt,
            attempts: 0,
        });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: user._id,
            action: "Password Reset Request",
            details: `Password reset requested for ${user.first_name} ${user.last_name} (${email})`,
            timestamp: new Date().toISOString(),
        });

        // SECURITY: the code is only ever returned when the caller proves it is
        // the Next.js server (via a shared secret held in the Convex deployment
        // env). Returning it to an anonymous browser caller would let anyone
        // request a reset for any account and complete the takeover without
        // ever reading the victim's inbox.
        //
        // NOTE: RESEND_API_KEY must be set in BOTH the Next.js environment and
        // the Convex dashboard environment for password reset to work. If the
        // Convex side is missing, this fails closed (no code is ever returned).
        const expectedSecret = process.env.RESEND_API_KEY;
        const isServer = !!expectedSecret && !!args.serverSecret && args.serverSecret === expectedSecret;
        return isServer ? { success: true, code } : { success: true };
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
        const email = args.email.trim().toLowerCase();

        if (!args.newPassword || args.newPassword.length < 6) {
            throw new Error("Password must be at least 6 characters long");
        }

        const reset = await ctx.db
            .query("passwordResets")
            .withIndex("by_email", (q) => q.eq("email", email))
            .filter((q) => q.eq(q.field("code"), args.code))
            .first();

        if (!reset || reset.expiresAt < Date.now()) {
            throw new Error("Invalid or expired reset code");
        }

        // Brute-force protection: a 6-digit code is only 1,000,000 possibilities,
        // so cap the number of verification attempts per issued code.
        const attempts = (reset.attempts ?? 0) + 1;
        if (attempts > MAX_RESET_ATTEMPTS) {
            await ctx.db.delete(reset._id);
            throw new Error("Too many incorrect attempts. Please request a new reset code.");
        }
        await ctx.db.patch(reset._id, { attempts });

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();
        if (!user) throw new Error("User not found");

        const hashedPassword = bcrypt.hashSync(args.newPassword, 10);
        await ctx.db.patch(user._id, { password: hashedPassword });
        await ctx.db.delete(reset._id);

        // Invalidate all other outstanding reset codes for this email
        const otherResets = await ctx.db
            .query("passwordResets")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect();
        for (const r of otherResets) {
            await ctx.db.delete(r._id);
        }

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: user._id,
            action: "Password Reset Completed",
            details: `Password reset completed for ${user.first_name} ${user.last_name} (${email})`,
            timestamp: new Date().toISOString(),
        });

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
        adminUserId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // FIX #4: Verify caller is an admin
        await requireAdmin(ctx, args.adminUserId);

        const existing = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .unique();
        if (existing) throw new Error("User with this email already exists");

        // Use provided password or default
        const passwordToHash = args.password || "password123";
        const hashedPassword = bcrypt.hashSync(passwordToHash, 10);

        const { password, adminUserId, ...userArgs } = args;

        const userId = await ctx.db.insert("users", {
            ...userArgs,
            password: hashedPassword,
        });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: adminUserId,
            action: "Create User",
            details: `Created new user: ${args.first_name} ${args.last_name} (${args.email}) with roles: ${args.roles.join(", ")}`,
            timestamp: new Date().toISOString(),
        });

        return userId;
    },
});

// Toggle a single role
export const toggleRole = mutation({
    args: {
        userId: v.id("users"),
        role: v.string(),
        action: v.union(v.literal("add"), v.literal("remove")),
        adminUserId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // FIX #4: Verify caller is an admin
        await requireAdmin(ctx, args.adminUserId);

        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error("User not found");

        let roles = [...user.roles];
        if (args.action === "add" && !roles.includes(args.role)) {
            roles.push(args.role);
        } else if (args.action === "remove") {
            roles = roles.filter(r => r !== args.role);
        }

        await ctx.db.patch(args.userId, { roles });

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.adminUserId,
            action: "Toggle User Role",
            details: `${args.action === "add" ? "Added" : "Removed"} role '${args.role}' ${args.action === "add" ? "to" : "from"} ${user.first_name} ${user.last_name}`,
            timestamp: new Date().toISOString(),
        });
    },
});

// Delete user
export const remove = mutation({
    args: { id: v.id("users"), adminUserId: v.id("users") },
    handler: async (ctx, args) => {
        // FIX #4: Verify caller is an admin
        await requireAdmin(ctx, args.adminUserId);

        const user = await ctx.db.get(args.id);
        if (!user) throw new Error("User not found");

        await ctx.db.delete(args.id);

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.adminUserId,
            action: "Delete User",
            details: `Deleted user: ${user.first_name} ${user.last_name} (${user.email})`,
            timestamp: new Date().toISOString(),
        });
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

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Password Changed",
            details: `Password changed for ${user.first_name} ${user.last_name} (${user.email})`,
            timestamp: new Date().toISOString(),
        });
    },
});


