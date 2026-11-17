/**
 * SMARTBUZ — users, authentication and sessions.
 *
 * Authentication entry points (`register`, `login`, `verifyEmail`, the
 * password-reset pair) are public on purpose: they are how somebody
 * arrives. Everything else in this file runs behind the caller's verified
 * identity.
 *
 * Four rules run through the whole file:
 *
 *  1. **Identity comes from the session, never from an argument.** The
 *     old implementation took `adminUserId` as a mutation argument and
 *     checked its `roles` array — which proved nothing, because the
 *     browser chose the value (AUDIT.md §2.2).
 *  2. **A user is seen only through their business.** A caller may only
 *     act on somebody who shares a business with them.
 *  3. **Accounts are verified.** A new account cannot sign in until its
 *     email address has been proven with a single-use code.
 *  4. **Sessions are revocable.** Every sign-in creates a server-side
 *     session row. The access token carries that session's id, so
 *     signing out or revoking a session stops the token immediately
 *     instead of waiting out its 15-minute lifetime.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import bcrypt from "bcryptjs";
import type { Doc, Id } from "./_generated/dataModel";
import {
  BUSINESS_ROLES,
  type BusinessRole,
  OWNER_ROLE,
  findMembership,
  listUserMemberships,
  normalizeBusinessRole,
  requirePermission,
  requireTenant,
  requireUser,
  roleFromLegacyRoles,
  resolveMemberPermissions,
} from "./tenancy";
import { requireSelfOrAdmin } from "./auth";
import { writeAudit } from "./audit";
import { sha256Hex } from "./crypto";
import { serverSecretMatches } from "./serverSecret";

/**
 * SMARTBUZ — users and access.
 *
 * Authentication entry points (`register`, `login`, the password-reset pair)
 * are public on purpose: they are how somebody arrives. Everything else in
 * this file runs behind the caller's verified identity.
 *
 * Two rules run through the whole file:
 *
 *  1. **Identity comes from the session, never from an argument.** The
 *     old implementation took `adminUserId` as a mutation argument and
 *     checked its `roles` array — which proved nothing, because the
 *     browser chose the value (AUDIT.md §2.2).
 *  2. **A user is seen only through their business.** A caller may only
 *     act on somebody who shares a business with them.
 */

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

/**
 * Generate a high-entropy session secret.
 *
 * 32 bytes from the CSPRNG, base64url encoded. This is the value the
 * browser's token is bound to; the server only keeps its hash.
 */
function generateSessionSecret(): string {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Max number of times a single reset code may be checked before it is voided. */
const MAX_RESET_ATTEMPTS = 5;

/** Max number of times a single verification code may be checked. */
const MAX_VERIFICATION_ATTEMPTS = 5;

const MIN_PASSWORD_LENGTH = 8;

/** How long a reset code stays valid: 1 hour. */
const RESET_CODE_TTL_MS = 60 * 60 * 1000;

/** How long a verification code stays valid: 24 hours. */
const VERIFICATION_CODE_TTL_MS = 24 * 60 * 60 * 1000;

/** How long a session stays valid: 7 days (matches the session cookie). */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** The users of the caller's business, resolved through memberships. */
async function listBusinessUsers(
    ctx: any,
    businessId: Id<"businesses">
): Promise<Doc<"users">[]> {
    const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .collect();

    const users: Doc<"users">[] = [];
    for (const membership of memberships) {
        const user = await ctx.db.get(membership.userId);
        if (user) users.push(user);
    }
    return users;
}

/**
 * The business a sign-in should be attributed to.
 *
 * A sign-in is a global event, but when the person has an active business it
 * belongs to that business's audit trail too — so the entry carries the
 * tenant id and the business owner can see who signed in.
 */
async function activeBusinessOf(
    ctx: any,
    user: Doc<"users">
): Promise<Id<"businesses"> | undefined> {
    if (!user.activeBusinessId) return undefined;
    const membership = await findMembership(ctx, user._id, user.activeBusinessId);
    return membership ? user.activeBusinessId : undefined;
}

/* ────────────────────────────────────────────────────────────────────────
 * Public — the way in
 * ──────────────────────────────────────────────────────────────────────── */

// Register a new user account from the public auth flow.
//
// NOTE: the `roles` argument is accepted for backwards compatibility but
// IGNORED. Previously a client could sign itself up as an admin
// (AUDIT.md §4.1). What a user may do is decided by their membership in a
// business, never by a self-declared global role.
//
// The account starts as `pending_verification`: it cannot sign in until the
// address is proven. The verification code is only ever returned to a
// caller that presents the server secret, so a browser cannot ask for one
// and complete a takeover without reading the inbox.
export const register = mutation({
    args: {
        first_name: v.string(),
        last_name: v.string(),
        email: v.string(),
        password: v.string(),
        phone_number: v.optional(v.string()),
        roles: v.optional(v.array(v.string())),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = args.email.trim().toLowerCase();
        if (!email) {
            throw new Error("Email is required");
        }

        if (!args.password || args.password.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
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
            // A global role list is a legacy concept; the meaningful role
            // lives on the membership. Keep it minimal and harmless here.
            roles: [],
            phone_number: args.phone_number,
            address: undefined,
            date_of_birth: undefined,
            gender: undefined,
            marital_status: undefined,
            nationality: undefined,
            profile_picture: undefined,
            // A new account must prove its email address before it can
            // sign in. Accounts that already existed are migrated as
            // `active`, so nobody is locked out by the upgrade.
            status: "pending_verification",
            emailVerified: false,
            createdAt: new Date().toISOString(),
        });

        // Issue the verification code.
        const code = generateResetCode();
        const codeHash = await bcrypt.hash(code, 10);
        await ctx.db.insert("emailVerifications", {
            userId,
            email,
            codeHash,
            expiresAt: Date.now() + VERIFICATION_CODE_TTL_MS,
            attempts: 0,
            createdAt: Date.now(),
        });

        await ctx.db.insert("activityLogs", {
            userId: userId,
            action: "User Registration",
            details: `New account registered for ${email}`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            actorUserId: userId,
            action: "auth.register",
            targetType: "user",
            targetId: userId,
            metadata: { email },
        });

        const isServer = serverSecretMatches(args.serverSecret);
        return isServer
            ? { success: true, userId, verificationCode: code }
            : { success: true, userId, requiresVerification: true };
    },
});

/**
 * Confirm an email address with the code that was sent to it.
 *
 * The code is single-use, time-limited and attempt-capped. It is compared
 * against a hash — the plain code is never stored.
 */
export const verifyEmail = mutation({
    args: {
        email: v.string(),
        code: v.string(),
    },
    handler: async (ctx, args) => {
        const email = args.email.trim().toLowerCase();

        const verifications = await ctx.db
            .query("emailVerifications")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect();

        const pending = verifications.find((v) => !v.verifiedAt);
        if (!pending) {
            throw new Error("Invalid or expired verification code.");
        }
        if (pending.expiresAt < Date.now()) {
            throw new Error("Invalid or expired verification code.");
        }

        const attempts = (pending.attempts ?? 0) + 1;
        if (attempts > MAX_VERIFICATION_ATTEMPTS) {
            await ctx.db.delete(pending._id);
            throw new Error("Too many incorrect attempts. Request a new code.");
        }
        await ctx.db.patch(pending._id, { attempts });

        const matches = await bcrypt.compare(args.code, pending.codeHash);
        if (!matches) {
            throw new Error("Invalid or expired verification code.");
        }

        await ctx.db.patch(pending._id, { verifiedAt: Date.now() });

        const user = await ctx.db.get(pending.userId);
        if (!user) throw new Error("User not found");

        await ctx.db.patch(user._id, {
            status: "active",
            emailVerified: true,
            emailVerifiedAt: new Date().toISOString(),
        });

        // Any other outstanding code for this address is now void.
        for (const other of verifications) {
            if (other._id !== pending._id && !other.verifiedAt) {
                await ctx.db.delete(other._id);
            }
        }

        await writeAudit(ctx, {
            actorUserId: user._id,
            action: "auth.verify_email",
            targetType: "user",
            targetId: user._id,
            metadata: { email },
        });

        return { success: true };
    },
});

/**
 * Issue a fresh verification code.
 *
 * Always answers "success", whether or not the address is on file, so the
 * endpoint cannot be used to enumerate accounts. The code is only returned
 * to a caller holding the server secret.
 */
export const requestVerification = mutation({
    args: {
        email: v.string(),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const email = args.email.trim().toLowerCase();

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();
        if (!user) return { success: true };
        if (user.emailVerified) return { success: true };

        // Replace any outstanding code.
        const existing = await ctx.db
            .query("emailVerifications")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect();
        for (const v of existing) {
            if (!v.verifiedAt) await ctx.db.delete(v._id);
        }

        const code = generateResetCode();
        await ctx.db.insert("emailVerifications", {
            userId: user._id,
            email,
            codeHash: await bcrypt.hash(code, 10),
            expiresAt: Date.now() + VERIFICATION_CODE_TTL_MS,
            attempts: 0,
            createdAt: Date.now(),
        });

        await writeAudit(ctx, {
            actorUserId: user._id,
            action: "auth.verification_requested",
            targetType: "user",
            targetId: user._id,
            metadata: { email },
        });

        const isServer = serverSecretMatches(args.serverSecret);
        return isServer ? { success: true, code } : { success: true };
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
            .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
            .unique();
        if (!user) throw new Error("Invalid email or password");

        const isValid = bcrypt.compareSync(args.password, user.password);
        if (!isValid) throw new Error("Invalid email or password");

        if (user.status === "suspended") {
            throw new Error("This account has been suspended. Contact your business owner.");
        }

        if (user.status === "pending_verification") {
            throw new Error(
                "Please verify your email address before signing in. Check your inbox for the verification code."
            );
        }

        // Log activity. The sign-in belongs to the user's active business
        // when they have one, so the business owner can see who signed in.
        await ctx.db.insert("activityLogs", {
            businessId: await activeBusinessOf(ctx, user),
            userId: user._id,
            action: "User Login",
            details: `User ${user.first_name} ${user.last_name} logged in`,
            timestamp: new Date().toISOString(),
        });

        await ctx.db.patch(user._id, { lastLoginAt: new Date().toISOString() });

        await writeAudit(ctx, {
            businessId: await activeBusinessOf(ctx, user),
            actorUserId: user._id,
            action: "auth.login",
            targetType: "user",
            targetId: user._id,
            metadata: { email: user.email },
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

        // Generate a 6-digit code from a cryptographically secure source.
        // Only the hash is stored, so a database read cannot be used to
        // take over an account.
        const code = generateResetCode();
        const expiresAt = Date.now() + RESET_CODE_TTL_MS;

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
            codeHash: await bcrypt.hash(code, 10),
            expiresAt,
            attempts: 0,
            createdAt: Date.now(),
        });

        await ctx.db.insert("activityLogs", {
            businessId: await activeBusinessOf(ctx, user),
            userId: user._id,
            action: "Password Reset Request",
            details: `Password reset requested for ${user.first_name} ${user.last_name} (${email})`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: await activeBusinessOf(ctx, user),
            actorUserId: user._id,
            action: "auth.password_reset_requested",
            targetType: "user",
            targetId: user._id,
            metadata: { email },
        });

        // SECURITY: the code is only ever returned when the caller proves it is
        // the Next.js server (via a shared secret held in the Convex deployment
        // env). Returning it to an anonymous browser caller would let anyone
        // request a reset for any account and complete the takeover without
        // ever reading the victim's inbox.
        const isServer = serverSecretMatches(args.serverSecret);
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

        if (!args.newPassword || args.newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
        }

        const resets = await ctx.db
            .query("passwordResets")
            .withIndex("by_email", (q) => q.eq("email", email))
            .collect();

        // A code is single-use: a reset that has already been applied is
        // not accepted a second time.
        const reset = resets.find((r) => !r.usedAt);
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

        // Codes issued before hashing was introduced still carry the plain
        // value; accept those too.
        const matches = reset.codeHash
            ? await bcrypt.compare(args.code, reset.codeHash)
            : reset.code === args.code;
        if (!matches) {
            throw new Error("Invalid or expired reset code");
        }

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();
        if (!user) throw new Error("User not found");

        const hashedPassword = bcrypt.hashSync(args.newPassword, 10);
        await ctx.db.patch(user._id, {
            password: hashedPassword,
            passwordChangedAt: new Date().toISOString(),
        });
        await ctx.db.patch(reset._id, { usedAt: Date.now() });

        // Invalidate all other outstanding reset codes for this email
        for (const r of resets) {
            if (r._id !== reset._id) {
                await ctx.db.delete(r._id);
            }
        }

        // A password reset invalidates every existing session. If the
        // reset was not requested by the account holder, the attacker who
        // set the new password is locked out along with the victim.
        await revokeAllSessionsFor(ctx, user._id, "password_reset");

        await ctx.db.insert("activityLogs", {
            businessId: await activeBusinessOf(ctx, user),
            userId: user._id,
            action: "Password Reset Completed",
            details: `Password reset completed for ${user.first_name} ${user.last_name} (${email})`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: await activeBusinessOf(ctx, user),
            actorUserId: user._id,
            action: "auth.password_reset_completed",
            targetType: "user",
            targetId: user._id,
            metadata: { email },
        });

        return { success: true };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Sessions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Revoke every live session of a user.
 */
async function revokeAllSessionsFor(
    ctx: any,
    userId: Id<"users">,
    reason: string
): Promise<number> {
    const sessions = await ctx.db
        .query("sessions")
        .withIndex("by_userId", (q: any) => q.eq("userId", userId))
        .collect();

    let revoked = 0;
    for (const session of sessions) {
        if (session.revokedAt) continue;
        await ctx.db.patch(session._id, {
            revokedAt: Date.now(),
            revokedReason: reason,
        });
        revoked++;
    }
    return revoked;
}

/**
 * Open a session for a user.
 *
 * Called by the Next.js server only — it proves that by presenting the
 * server secret. A browser cannot open a session for somebody else, and
 * cannot open one without knowing the user's id *and* holding the secret.
 */
export const startSession = mutation({
    args: {
        userId: v.id("users"),
        ip: v.optional(v.string()),
        userAgent: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError(
                "Forbidden: sessions may only be opened by the application server."
            );
        }

        const user = await ctx.db.get(args.userId);
        if (!user) throw new ConvexError("User not found");
        if (user.status === "suspended") {
            throw new ConvexError("This account has been suspended.");
        }
        if (user.status === "pending_verification") {
            throw new ConvexError(
                "This account has not verified its email address yet."
            );
        }

        const sessionId = generateSessionSecret();
        const secret = generateSessionSecret();
        const now = Date.now();
        const expiresAt = now + SESSION_TTL_MS;

        await ctx.db.insert("sessions", {
            userId: args.userId,
            sessionId,
            secretHash: await sha256Hex(secret),
            createdAt: now,
            expiresAt,
            lastSeenAt: now,
            businessId: args.businessId,
            ip: args.ip,
            userAgent: args.userAgent,
        });

        await writeAudit(ctx, {
            actorUserId: args.userId,
            action: "auth.session.start",
            targetType: "session",
            targetId: sessionId,
            metadata: { ip: args.ip, userAgent: args.userAgent },
        });

        return { sessionId, secret, expiresAt };
    },
});

/**
 * Close a session.
 *
 * The Next.js server calls this on logout so the access token stops
 * working at once instead of lingering until it expires.
 */
export const endSession = mutation({
    args: {
        sessionId: v.string(),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError(
                "Forbidden: sessions may only be ended by the application server."
            );
        }

        const session = await ctx.db
            .query("sessions")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .unique();
        if (!session || session.revokedAt) return { success: true };

        await ctx.db.patch(session._id, {
            revokedAt: Date.now(),
            revokedReason: "signed_out",
        });

        await writeAudit(ctx, {
            actorUserId: session.userId,
            action: "auth.session.end",
            targetType: "session",
            targetId: args.sessionId,
            metadata: { reason: "signed_out" },
        });

        return { success: true };
    },
});

/**
 * Record that a session is still in use.
 */
export const touchSession = mutation({
    args: {
        sessionId: v.string(),
        serverSecret: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!serverSecretMatches(args.serverSecret)) {
            throw new ConvexError("Forbidden.");
        }

        const session = await ctx.db
            .query("sessions")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .unique();
        if (!session || session.revokedAt) return { success: false };

        await ctx.db.patch(session._id, { lastSeenAt: Date.now() });
        return { success: true };
    },
});

/**
 * The caller's own sessions.
 *
 * A user can see where their account is signed in and sign it out.
 */
export const listSessions = query({
    args: {},
    handler: async (ctx) => {
        const user = await requireUser(ctx);

        const sessions = await ctx.db
            .query("sessions")
            .withIndex("by_userId", (q) => q.eq("userId", user._id))
            .collect();

        const now = Date.now();
        return sessions
            .filter((s) => !s.revokedAt && s.expiresAt > now)
            .sort((a, b) => (b.lastSeenAt ?? b.createdAt) - (a.lastSeenAt ?? a.createdAt))
            .map((s) => ({
                sessionId: s.sessionId,
                createdAt: s.createdAt,
                lastSeenAt: s.lastSeenAt,
                expiresAt: s.expiresAt,
                ip: s.ip,
                userAgent: s.userAgent,
                businessId: s.businessId,
            }));
    },
});

/**
 * Sign one of the caller's own sessions out.
 */
export const revokeSession = mutation({
    args: { sessionId: v.string() },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const session = await ctx.db
            .query("sessions")
            .withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
            .unique();
        if (!session) throw new ConvexError("That session does not exist.");
        if (session.userId !== user._id) {
            throw new ConvexError("Forbidden: that session belongs to somebody else.");
        }
        if (session.revokedAt) return { success: true };

        await ctx.db.patch(session._id, {
            revokedAt: Date.now(),
            revokedReason: "revoked_by_user",
        });

        await writeAudit(ctx, {
            actorUserId: user._id,
            action: "auth.session.revoke",
            targetType: "session",
            targetId: args.sessionId,
            metadata: { reason: "revoked_by_user" },
        });

        return { success: true };
    },
});

/**
 * Sign every other session of the caller out.
 *
 * The classic "somebody else got into my account" response.
 */
export const revokeOtherSessions = mutation({
    args: { keepSessionId: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        const sessions = await ctx.db
            .query("sessions")
            .withIndex("by_userId", (q) => q.eq("userId", user._id))
            .collect();

        const now = Date.now();
        let revoked = 0;
        for (const session of sessions) {
            if (session.revokedAt) continue;
            if (session.expiresAt <= now) continue;
            if (args.keepSessionId && session.sessionId === args.keepSessionId) continue;
            await ctx.db.patch(session._id, {
                revokedAt: Date.now(),
                revokedReason: "revoked_by_user",
            });
            revoked++;
        }

        await writeAudit(ctx, {
            actorUserId: user._id,
            action: "auth.session.revoke_others",
            targetType: "user",
            targetId: user._id,
            metadata: { revoked },
        });

        return { success: true, revoked };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * The signed-in user
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Everything the app needs about the caller: their account, their
 * businesses and their role in each.
 */
export const me = query({
    args: {},
    handler: async (ctx) => {
        const user = await requireUser(ctx);
        const memberships = await listUserMemberships(ctx, user._id);

        const businesses = [];
        for (const membership of memberships) {
            const business = await ctx.db.get(membership.businessId);
            if (!business) continue;
            businesses.push({
                business,
                role: membership.role,
                isActive: user.activeBusinessId === business._id,
            });
        }

        const activeBusiness = user.activeBusinessId
            ? await ctx.db.get(user.activeBusinessId)
            : null;

        // The permissions of the active business, so the UI can hide what
        // the person may not do. The backend enforces them regardless —
        // this is convenience, never control.
        const activeMembership = memberships.find(
            (m) => m.businessId === user.activeBusinessId
        );
        const permissions = activeMembership
            ? [...(await resolveMemberPermissions(ctx, activeMembership.businessId, activeMembership))]
            : [];

        return {
            user: sanitizeUser(user),
            businesses,
            permissions,
            activeBusiness: activeBusiness
                ? {
                    ...activeBusiness,
                    role:
                        memberships.find((m) => m.businessId === activeBusiness._id)?.role ??
                        "auditor",
                }
                : null,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Directory — scoped to the caller's business
 * ──────────────────────────────────────────────────────────────────────── */

// Fetch all users of the caller's business with pagination and search
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.view");

        const users = await listBusinessUsers(ctx, tenant.businessId);
        const filtered = args.searchTerm
            ? users.filter((u) => {
                const search = args.searchTerm!.toLowerCase();
                return (
                    u.first_name.toLowerCase().includes(search) ||
                    u.last_name.toLowerCase().includes(search) ||
                    u.email.toLowerCase().includes(search)
                );
            })
            : users;

        const paginated = {
            page: filtered.slice(
                args.paginationOpts.numItems * (Number(args.paginationOpts.cursor) || 0),
                args.paginationOpts.numItems * (Number(args.paginationOpts.cursor) || 0) +
                    args.paginationOpts.numItems
            ),
            isDone: false,
            continueCursor: "",
            pageStatus: "more" as const,
        };

        return {
            ...paginated,
            page: paginated.page.map((u) => sanitizeUser(u)!),
        };
    },
});

// Fetch all users of the caller's business
export const listAll = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.view");

        const users = await listBusinessUsers(ctx, tenant.businessId);
        return users.map((u) => sanitizeUser(u)!);
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.view");

        let results = await listBusinessUsers(ctx, tenant.businessId);

        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            results = results.filter(
                (u) =>
                    u.first_name.toLowerCase().includes(search) ||
                    u.last_name.toLowerCase().includes(search) ||
                    u.email.toLowerCase().includes(search)
            );
        }

        const totalCount = results.length;
        const page = results
            .slice(args.offset, args.offset + args.limit)
            .map((u) => sanitizeUser(u)!);

        return { page, totalCount };
    },
});

// Get user by email — only somebody who shares a business with the caller.
export const getByEmail = query({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        const caller = await requireUser(ctx);
        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email.trim().toLowerCase()))
            .unique();
        if (!user) return null;

        const memberships = await listUserMemberships(ctx, caller._id);
        for (const membership of memberships) {
            if (await findMembership(ctx, user._id, membership.businessId)) {
                return sanitizeUser(user);
            }
        }
        return null;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Administration — inside the caller's business
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Update the roles of a member.
 *
 * The old version trusted a client-supplied `adminUserId` (AUDIT.md §2.2).
 * The caller is now derived from the session, and the role that actually
 * counts is the membership role inside the caller's business.
 */
export const setRoles = mutation({
    args: {
        userId: v.id("users"),
        roles: v.array(v.string()),
        adminUserId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", args.userId)
            )
            .unique();
        if (!membership) {
            throw new ConvexError(
                "Forbidden: that person is not a member of this business."
            );
        }
        if (membership.role === OWNER_ROLE) {
            throw new ConvexError("The business owner's role cannot be changed.");
        }

        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error("User not found");

        const role = roleFromLegacyRoles(args.roles);
        await ctx.db.patch(membership._id, {
            role,
            updatedAt: new Date().toISOString(),
        });

        // Keep the legacy global array in step for older screens.
        await ctx.db.patch(args.userId, { roles: args.roles });

        await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            userId: tenant.user._id,
            action: "Set User Roles",
            details: `Updated roles for ${user.first_name} ${user.last_name} to: ${args.roles.join(", ")}`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.role.change",
            targetType: "membership",
            targetId: membership._id,
            metadata: {
                subjectUserId: args.userId,
                email: user.email,
                from: membership.role,
                to: role,
            },
        });
    },
});

/**
 * Set the branches a member is confined to.
 *
 * An empty list means "every branch" for most roles, and "the branches
 * you manage" for a branch manager.
 */
export const setBranchAccess = mutation({
    args: {
        userId: v.id("users"),
        branchIds: v.array(v.id("branches")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", args.userId)
            )
            .unique();
        if (!membership) {
            throw new ConvexError(
                "Forbidden: that person is not a member of this business."
            );
        }
        if (membership.role === OWNER_ROLE) {
            throw new ConvexError("The business owner's access cannot be restricted.");
        }

        // Every branch must belong to this business.
        for (const branchId of args.branchIds) {
            const branch = await ctx.db.get(branchId);
            if (!branch || branch.businessId !== tenant.businessId) {
                throw new ConvexError("That branch belongs to another business.");
            }
        }

        await ctx.db.patch(membership._id, {
            branchIds: args.branchIds,
            updatedAt: new Date().toISOString(),
        });

        const user = await ctx.db.get(args.userId);

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.branch_access.set",
            targetType: "membership",
            targetId: membership._id,
            metadata: {
                subjectUserId: args.userId,
                email: user?.email,
                branchIds: args.branchIds,
            },
        });

        return true;
    },
});

/**
 * Grant or deny custom permissions for a member of this business.
 *
 * A grant can never include a platform-only permission, and a member can
 * never be given more than the person granting it already holds — that is
 * what stops an administrator from escalating anybody, including
 * themselves, past their own authority.
 */
export const setMemberPermissions = mutation({
    args: {
        userId: v.id("users"),
        granted: v.optional(v.array(v.string())),
        denied: v.optional(v.array(v.string())),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", args.userId)
            )
            .unique();
        if (!membership) {
            throw new ConvexError(
                "Forbidden: that person is not a member of this business."
            );
        }
        if (membership.role === OWNER_ROLE) {
            throw new ConvexError("The business owner's permissions cannot be changed.");
        }
        if (args.userId === tenant.user._id) {
            throw new ConvexError(
                "Forbidden: you cannot change your own permissions."
            );
        }

        const requested = [...(args.granted ?? []), ...(args.denied ?? [])];
        const actorPermissions = await resolveMemberPermissions(
            ctx,
            tenant.businessId,
            tenant.membership
        );

        for (const permission of requested) {
            if (permission === "subscriptions.manage") {
                throw new ConvexError(
                    "Forbidden: platform permissions cannot be granted inside a business."
                );
            }
            if (!actorPermissions.has(permission as any)) {
                throw new ConvexError(
                    `Forbidden: you cannot grant "${permission}" because you do not hold it yourself.`
                );
            }
        }

        const existing = await ctx.db
            .query("memberPermissionOverrides")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", args.userId)
            )
            .unique();

        if (existing) {
            await ctx.db.patch(existing._id, {
                granted: args.granted ?? [],
                denied: args.denied ?? [],
                grantedBy: tenant.user._id,
                updatedAt: new Date().toISOString(),
            });
        } else {
            await ctx.db.insert("memberPermissionOverrides", {
                businessId: tenant.businessId,
                userId: args.userId,
                granted: args.granted ?? [],
                denied: args.denied ?? [],
                grantedBy: tenant.user._id,
                updatedAt: new Date().toISOString(),
            });
        }

        const user = await ctx.db.get(args.userId);

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.member_permissions.set",
            targetType: "membership",
            targetId: membership._id,
            metadata: {
                subjectUserId: args.userId,
                email: user?.email,
                granted: args.granted ?? [],
                denied: args.denied ?? [],
            },
        });

        return true;
    },
});

/**
 * Grant or deny custom permissions for a whole role in this business.
 */
export const setRolePermissions = mutation({
    args: {
        role: v.string(),
        granted: v.optional(v.array(v.string())),
        denied: v.optional(v.array(v.string())),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");

        if (!BUSINESS_ROLES.includes(args.role as BusinessRole)) {
            throw new ConvexError("That is not a valid role.");
        }
        if (args.role === OWNER_ROLE) {
            throw new ConvexError("The business owner's permissions cannot be changed.");
        }

        const actorPermissions = await resolveMemberPermissions(
            ctx,
            tenant.businessId,
            tenant.membership
        );

        for (const permission of [...(args.granted ?? []), ...(args.denied ?? [])]) {
            if (permission === "subscriptions.manage") {
                throw new ConvexError(
                    "Forbidden: platform permissions cannot be granted inside a business."
                );
            }
            if (!actorPermissions.has(permission as any)) {
                throw new ConvexError(
                    `Forbidden: you cannot grant "${permission}" because you do not hold it yourself.`
                );
            }
        }

        const existing = await ctx.db
            .query("customRolePermissions")
            .withIndex("by_businessId_role", (q) =>
                q.eq("businessId", tenant.businessId).eq("role", args.role)
            )
            .unique();

        if (existing) {
            await ctx.db.patch(existing._id, {
                granted: args.granted ?? [],
                denied: args.denied ?? [],
                updatedBy: tenant.user._id,
                updatedAt: new Date().toISOString(),
            });
        } else {
            await ctx.db.insert("customRolePermissions", {
                businessId: tenant.businessId,
                role: args.role,
                granted: args.granted ?? [],
                denied: args.denied ?? [],
                updatedBy: tenant.user._id,
                updatedAt: new Date().toISOString(),
            });
        }

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.role_permissions.set",
            targetType: "role",
            targetId: args.role,
            metadata: {
                granted: args.granted ?? [],
                denied: args.denied ?? [],
            },
        });

        return true;
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
        adminUserId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const { id, adminUserId, roles, ...rest } = args;

        // The caller may edit themselves; editing somebody else requires
        // administering a business they also belong to.
        const { businessId } = await requireSelfOrAdmin(ctx, id);
        const caller = await requireUser(ctx);
        const isSelf = caller._id === id;

        const user = await ctx.db.get(id);
        if (!user) throw new Error("User not found");

        await ctx.db.patch(id, rest as any);

        // A role change goes through the membership, not the global array.
        //
        // It must never be something a person can do to *themselves*: that
        // would let a cashier promote themselves to administrator by
        // calling this mutation with their own id. Changing somebody
        // else's role is an administrative act, so it needs the same
        // permission as every other role change (`members.manage`), and
        // the owner's role is not changeable at all.
        if (roles) {
            if (isSelf) {
                throw new ConvexError(
                    "Forbidden: you cannot change your own role. Ask a business administrator."
                );
            }

            await requirePermission(ctx, businessId, "members.manage");

            const membership = await ctx.db
                .query("memberships")
                .withIndex("by_businessId_userId", (q) =>
                    q.eq("businessId", businessId).eq("userId", id)
                )
                .unique();
            if (membership && membership.role !== OWNER_ROLE) {
                await ctx.db.patch(membership._id, {
                    role: roleFromLegacyRoles(roles),
                    updatedAt: new Date().toISOString(),
                });
            }
            await ctx.db.patch(id, { roles });
        }

        const changes = Object.keys(rest)
            .map((key) => `${key}: ${(rest as any)[key]}`)
            .join(", ");
        await ctx.db.insert("activityLogs", {
            businessId,
            userId: (await requireUser(ctx))._id,
            action: "Update User",
            details: `Updated user ${user.first_name} ${user.last_name} - Changes: ${changes}`,
            timestamp: new Date().toISOString(),
        });
    },
});

/**
 * Create a user *in the caller's business*.
 *
 * The old version created a global user with no business attached, which is
 * exactly the "one customer sees another customer's data" problem the audit
 * describes. Now the new account gets a membership in the caller's
 * business and a matching employee record.
 */
export const create = mutation({
    args: {
        first_name: v.string(),
        middle_name: v.optional(v.string()),
        last_name: v.string(),
        email: v.string(),
        roles: v.array(v.string()),
        password: v.optional(v.string()),
        phone_number: v.optional(v.string()),
        adminUserId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
        branchIds: v.optional(v.array(v.id("branches"))),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");

        const email = args.email.trim().toLowerCase();
        const existing = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();
        if (existing) throw new Error("User with this email already exists");

        const passwordToHash = args.password || "password123";
        const hashedPassword = bcrypt.hashSync(passwordToHash, 10);
        const now = new Date().toISOString();

        const userId = await ctx.db.insert("users", {
            first_name: args.first_name.trim(),
            middle_name: args.middle_name,
            last_name: args.last_name.trim(),
            email,
            roles: args.roles,
            password: hashedPassword,
            phone_number: args.phone_number,
            // Staff created by an administrator are trusted to have a
            // working address, so they can sign in straight away.
            status: "active",
            emailVerified: true,
            createdAt: now,
        });

        const role = roleFromLegacyRoles(args.roles) as BusinessRole;

        // A business has exactly one owner, and ownership is transferred
        // rather than handed out. Creating a second owner would make the
        // "cannot change the owner's role" rule ambiguous.
        if (role === OWNER_ROLE) {
            throw new ConvexError(
                "The owner role cannot be assigned. Use Transfer ownership instead."
            );
        }

        const membershipId = await ctx.db.insert("memberships", {
            userId,
            businessId: tenant.businessId,
            role,
            status: "active",
            branchIds: args.branchIds,
            invitedBy: tenant.user._id,
            invitedAt: now,
            joinedAt: now,
            createdAt: now,
        });

        const employeeId = await ctx.db.insert("employees", {
            businessId: tenant.businessId,
            userId,
            fullName: `${args.first_name.trim()} ${args.last_name.trim()}`.trim(),
            email,
            phone: args.phone_number,
            role,
            status: "active",
            hiredAt: now.slice(0, 10),
            createdAt: now,
            createdBy: tenant.user._id,
        });

        await ctx.db.patch(membershipId, { employeeId });

        await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            userId: tenant.user._id,
            action: "Create User",
            details: `Created new user: ${args.first_name} ${args.last_name} (${email}) with roles: ${args.roles.join(", ")}`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.member.create",
            targetType: "membership",
            targetId: membershipId,
            metadata: {
                subjectUserId: userId,
                email,
                role,
                branchIds: args.branchIds ?? [],
            },
        });

        return userId;
    },
});

// Toggle a single role (on the membership inside the caller's business)
export const toggleRole = mutation({
    args: {
        userId: v.id("users"),
        role: v.string(),
        action: v.union(v.literal("add"), v.literal("remove")),
        adminUserId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", args.userId)
            )
            .unique();
        if (!membership) {
            throw new ConvexError(
                "Forbidden: that person is not a member of this business."
            );
        }
        if (membership.role === OWNER_ROLE) {
            throw new ConvexError("The business owner's role cannot be changed.");
        }

        const current = membership.role;
        const target = args.role as BusinessRole;
        if (!BUSINESS_ROLES.includes(target) || target === OWNER_ROLE) {
            throw new ConvexError("That is not a valid role.");
        }

        let role = current;
        if (args.action === "add" && current !== target) {
            role = target;
        } else if (args.action === "remove" && current === target) {
            role = "auditor";
        }

        await ctx.db.patch(membership._id, {
            role,
            updatedAt: new Date().toISOString(),
        });

        await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            userId: tenant.user._id,
            action: "Toggle User Role",
            details: `${args.action === "add" ? "Added" : "Removed"} role '${args.role}' ${
                args.action === "add" ? "to" : "from"
            } a member of ${tenant.business.name}`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.role.change",
            targetType: "membership",
            targetId: membership._id,
            metadata: {
                subjectUserId: args.userId,
                from: current,
                to: role,
            },
        });
    },
});

/**
 * Remove a member of the caller's business.
 *
 * The account itself is only deleted when the person has no membership
 * anywhere else — a user can belong to several businesses, and one
 * business must not be able to delete an account another business still
 * relies on.
 */
export const remove = mutation({
    args: {
        id: v.id("users"),
        adminUserId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", args.id)
            )
            .unique();
        if (!membership) {
            throw new ConvexError(
                "Forbidden: that person is not a member of this business."
            );
        }
        if (membership.role === OWNER_ROLE) {
            throw new ConvexError(
                "The business owner cannot be removed. Transfer ownership first."
            );
        }

        const user = await ctx.db.get(args.id);
        if (!user) throw new Error("User not found");

        const now = new Date().toISOString();
        await ctx.db.patch(membership._id, { status: "suspended", updatedAt: now });

        // Every session of the removed member stops working.
        await revokeAllSessionsFor(ctx, args.id, "membership_removed");

        const remaining = (await listUserMemberships(ctx, args.id)).filter(
            (m) => m._id !== membership._id
        );
        if (remaining.length === 0) {
            // No other business depends on this account — remove it entirely.
            await ctx.db.delete(args.id);
        }

        await ctx.db.insert("activityLogs", {
            businessId: tenant.businessId,
            userId: tenant.user._id,
            action: "Delete User",
            details: `Removed ${user.first_name} ${user.last_name} (${user.email}) from ${tenant.business.name}`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "rbac.member.remove",
            targetType: "membership",
            targetId: membership._id,
            metadata: {
                subjectUserId: args.id,
                email: user.email,
                role: membership.role,
            },
        });
    },
});

// Change Password (for logged-in users)
export const changePassword = mutation({
    args: {
        userId: v.id("users"),
        currentPassword: v.string(),
        newPassword: v.string(),
        keepSessionId: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const { businessId } = await requireSelfOrAdmin(ctx, args.userId);

        const user = await ctx.db.get(args.userId);
        if (!user) throw new Error("User not found");

        const isValid = bcrypt.compareSync(args.currentPassword, user.password);
        if (!isValid) throw new Error("Incorrect current password");

        if (!args.newPassword || args.newPassword.length < MIN_PASSWORD_LENGTH) {
            throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
        }
        if (args.currentPassword === args.newPassword) {
            throw new Error("The new password must be different from the current one.");
        }

        const hashedPassword = bcrypt.hashSync(args.newPassword, 10);
        await ctx.db.patch(args.userId, {
            password: hashedPassword,
            passwordChangedAt: new Date().toISOString(),
        });

        // Changing a password signs out every other device. The session
        // that made the change (if any) survives.
        const sessions = await ctx.db
            .query("sessions")
            .withIndex("by_userId", (q) => q.eq("userId", args.userId))
            .collect();
        for (const session of sessions) {
            if (session.revokedAt) continue;
            if (args.keepSessionId && session.sessionId === args.keepSessionId) continue;
            await ctx.db.patch(session._id, {
                revokedAt: Date.now(),
                revokedReason: "password_changed",
            });
        }

        await ctx.db.insert("activityLogs", {
            businessId,
            userId: args.userId,
            action: "Password Changed",
            details: `Password changed for ${user.first_name} ${user.last_name} (${user.email})`,
            timestamp: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId,
            actorUserId: args.userId,
            action: "auth.password_changed",
            targetType: "user",
            targetId: args.userId,
            metadata: { email: user.email },
        });
    },
});
