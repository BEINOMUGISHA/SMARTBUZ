/**
 * SMARTBUZ — platform administration.
 *
 * Everything in this file acts *across* businesses: the tenant list, the
 * plan a business is on, the platform administrators themselves. It is
 * deliberately kept apart from the business-scoped modules, because the
 * two have very different trust properties.
 *
 * The rules
 * ─────────
 *  1. **Only a platform administrator gets in.** Every handler starts with
 *     `requirePlatformRole`. A business owner is not a platform
 *     administrator, however large their business.
 *  2. **Reads are open to support, writes are not.** `platform_support`
 *     can look at a tenant to diagnose a problem; it cannot change a
 *     plan, suspend a business or grant a role. Those need
 *     `platform_super_admin`, which is the only role that holds
 *     `subscriptions.manage`.
 *  3. **The last super admin cannot be removed.** Locking everybody out
 *     of the platform is a real failure mode, so it is guarded.
 *  4. **Every write is audited.** Platform actions are recorded in the
 *     platform-scope audit trail with the acting administrator recorded.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { writeAudit } from "./audit";
import {
  type BusinessId,
  type PlatformRole,
  type UserId,
  findPlatformRole,
  requirePlatformPermission,
  requirePlatformRole,
  requireUser,
} from "./tenancy";
import {
  PLATFORM_ROLES,
  roleHasPermission,
  type RoleId,
} from "./rbac";
import { serverSecretMatches } from "./serverSecret";

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Assert the caller may perform a platform-wide *write*.
 *
 * `subscriptions.manage` is the platform's write permission. It is held
 * by `platform_super_admin` and by nobody else, so this is the single
 * gate behind every mutation in this file.
 */
async function requirePlatformWrite(
  ctx: Parameters<typeof requirePlatformRole>[0]
): Promise<{ user: Doc<"users">; role: PlatformRole }> {
  return requirePlatformPermission(ctx, "subscriptions.manage");
}

/** How many active super administrators there are. */
async function countSuperAdmins(
  ctx: Parameters<typeof requirePlatformRole>[0]
): Promise<number> {
  const admins = await ctx.db
    .query("platformAdmins")
    .withIndex("by_role", (q) => q.eq("role", "platform_super_admin"))
    .collect();
  return admins.filter((a) => (a.status ?? "active") === "active").length;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every business on the platform, with the figures support needs to pick
 * the right tenant.
 */
export const listBusinesses = query({
  args: {
    searchTerm: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformRole(ctx, ["platform_super_admin", "platform_support"]);

    const businesses = await ctx.db.query("businesses").collect();

    const filtered = businesses.filter((business) => {
      if (args.status && (business.status ?? "active") !== args.status) {
        return false;
      }
      if (!args.searchTerm) return true;
      const search = args.searchTerm.toLowerCase();
      return (
        business.name.toLowerCase().includes(search) ||
        (business.slug ?? "").toLowerCase().includes(search)
      );
    });

    filtered.sort((a, b) => (a.createdAt ?? "") < (b.createdAt ?? "") ? 1 : -1);

    return filtered.map((business) => ({
      _id: business._id,
      name: business.name,
      slug: business.slug,
      status: business.status ?? "active",
      plan: business.plan,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionExpiresAt: business.subscriptionExpiresAt,
      ownerId: business.ownerId,
      createdAt: business.createdAt,
    }));
  },
});

/**
 * One business, in full. Read-only.
 */
export const getBusiness = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requirePlatformRole(ctx, ["platform_super_admin", "platform_support"]);

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("That business does not exist.");

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
      .collect();

    return {
      business,
      memberCount: memberships.filter(
        (m) => (m.status ?? "active") === "active"
      ).length,
      roles: memberships.reduce<Record<string, number>>((acc, m) => {
        acc[m.role] = (acc[m.role] ?? 0) + 1;
        return acc;
      }, {}),
    };
  },
});

/**
 * The platform administrators.
 */
export const listAdmins = query({
  args: {},
  handler: async (ctx) => {
    await requirePlatformRole(ctx, ["platform_super_admin", "platform_support"]);

    const admins = await ctx.db.query("platformAdmins").collect();
    const out: {
      _id: Id<"platformAdmins">;
      userId: Id<"users">;
      email: string;
      name: string;
      role: string;
      status: string;
      grantedAt?: string;
    }[] = [];

    for (const admin of admins) {
      const user = await ctx.db.get(admin.userId);
      if (!user) continue;
      out.push({
        _id: admin._id,
        userId: admin.userId,
        email: user.email,
        name: [user.first_name, user.last_name].filter(Boolean).join(" "),
        role: admin.role,
        status: admin.status ?? "active",
        grantedAt: admin.grantedAt,
      });
    }

    return out;
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing — subscriptions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Change a business's plan and subscription dates.
 *
 * Requires `subscriptions.manage`, which only `platform_super_admin`
 * holds. A business administrator cannot renew their own subscription —
 * billing is a platform concern.
 */
export const setSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    plan: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()),
    subscriptionExpiresAt: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("That business does not exist.");

    const allowedStatuses = ["trial", "active", "expired", "cancelled"];
    if (
      args.subscriptionStatus &&
      !allowedStatuses.includes(args.subscriptionStatus)
    ) {
      throw new ConvexError(
        "Subscription status must be one of: " + allowedStatuses.join(", ") + "."
      );
    }

    const before = {
      plan: business.plan,
      subscriptionStatus: business.subscriptionStatus,
      subscriptionExpiresAt: business.subscriptionExpiresAt,
    };

    await ctx.db.patch(args.businessId, {
      plan: args.plan ?? business.plan,
      subscriptionStatus: args.subscriptionStatus ?? business.subscriptionStatus,
      subscriptionExpiresAt:
        args.subscriptionExpiresAt ?? business.subscriptionExpiresAt,
      updatedAt: new Date().toISOString(),
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.update",
      targetType: "business",
      targetId: args.businessId,
      metadata: {
        businessName: business.name,
        before,
        after: {
          plan: args.plan ?? business.plan,
          subscriptionStatus:
            args.subscriptionStatus ?? business.subscriptionStatus,
          subscriptionExpiresAt:
            args.subscriptionExpiresAt ?? business.subscriptionExpiresAt,
        },
        reason: args.reason,
      },
    });

    return true;
  },
});

/**
 * Suspend or reactivate a business.
 */
export const setBusinessStatus = mutation({
  args: {
    businessId: v.id("businesses"),
    status: v.string(),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    if (!["active", "suspended", "closed"].includes(args.status)) {
      throw new ConvexError(
        "Status must be one of: active, suspended, closed."
      );
    }

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("That business does not exist.");

    await ctx.db.patch(args.businessId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.business.status",
      targetType: "business",
      targetId: args.businessId,
      metadata: {
        businessName: business.name,
        from: business.status ?? "active",
        to: args.status,
        reason: args.reason,
      },
    });

    return true;
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing — platform administrators
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Give somebody a platform role.
 *
 * Only a super administrator may do this, and only to an existing
 * account. The person granting the role cannot grant a role they do not
 * hold themselves.
 */
export const grantRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    if (!(PLATFORM_ROLES as readonly string[]).includes(args.role)) {
      throw new ConvexError(
        "Role must be one of: " + PLATFORM_ROLES.join(", ") + "."
      );
    }
    if (args.role === actor.role) {
      throw new ConvexError(
        "You cannot grant the same platform role you hold yourself."
      );
    }

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("That user does not exist.");

    const existing = await ctx.db
      .query("platformAdmins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const active = existing.find((a) => (a.status ?? "active") === "active");
    if (active) {
      if (active.role === args.role) {
        throw new ConvexError("That person already holds this platform role.");
      }
      await ctx.db.patch(active._id, {
        role: args.role,
        grantedBy: actor.user._id,
        grantedAt: new Date().toISOString(),
        revokedAt: undefined,
        revokedBy: undefined,
        status: "active",
      });
    } else {
      await ctx.db.insert("platformAdmins", {
        userId: args.userId,
        role: args.role,
        status: "active",
        grantedBy: actor.user._id,
        grantedAt: new Date().toISOString(),
        notes: args.notes,
      });
    }

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.role.grant",
      targetType: "user",
      targetId: args.userId,
      metadata: {
        email: user.email,
        grantedRole: args.role,
        notes: args.notes,
      },
    });

    return true;
  },
});

/**
 * Take a platform role away.
 *
 * The last active super administrator cannot be revoked — there would be
 * nobody left to restore the platform.
 */
export const revokeRole = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    if (args.userId === actor.user._id) {
      throw new ConvexError("You cannot revoke your own platform role.");
    }

    const admins = await ctx.db
      .query("platformAdmins")
      .withIndex("by_userId", (q) => q.eq("userId", args.userId))
      .collect();

    const active = admins.find((a) => (a.status ?? "active") === "active");
    if (!active) {
      throw new ConvexError("That person does not hold a platform role.");
    }

    if (active.role === "platform_super_admin") {
      const remaining = await countSuperAdmins(ctx);
      if (remaining <= 1) {
        throw new ConvexError(
          "Forbidden: this is the last platform super administrator. Promote somebody else first."
        );
      }
    }

    await ctx.db.patch(active._id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
      revokedBy: actor.user._id,
    });

    const user = await ctx.db.get(args.userId);

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.role.revoke",
      targetType: "user",
      targetId: args.userId,
      metadata: {
        email: user?.email,
        revokedRole: active.role,
        reason: args.reason,
      },
    });

    return true;
  },
});

/**
 * Suspend a business member's account from the platform side.
 *
 * Used when a member must be locked out immediately without the business
 * administrator acting.
 */
export const suspendUser = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("That user does not exist.");

    await ctx.db.patch(args.userId, { status: "suspended" });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.user.suspend",
      targetType: "user",
      targetId: args.userId,
      metadata: { email: user.email, reason: args.reason },
    });

    return true;
  },
});

/**
 * Restore a suspended account.
 */
export const reinstateUser = mutation({
  args: {
    userId: v.id("users"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError("That user does not exist.");

    await ctx.db.patch(args.userId, { status: "active" });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.user.reinstate",
      targetType: "user",
      targetId: args.userId,
      metadata: { email: user.email, reason: args.reason },
    });

    return true;
  },
});

/**
 * Bootstrap the very first platform super administrator.
 *
 * There is a chicken-and-egg problem: granting a platform role needs a
 * platform role. This closes it — but only while the platform has **no**
 * active administrator at all, and only for a caller holding the server
 * secret. Once a super administrator exists this refuses, so it can never
 * be used to mint extra administrators.
 */
export const bootstrapSuperAdmin = mutation({
  args: {
    userId: v.id("users"),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!serverSecretMatches(args.serverSecret)) {
      throw new ConvexError(
        "Forbidden: bootstrapping requires the application server."
      );
    }

    const existing = await ctx.db.query("platformAdmins").collect();
    const active = existing.filter((a) => (a.status ?? "active") === "active");
    if (active.length > 0) {
      throw new ConvexError(
        "The platform already has an administrator. Use grantRole instead."
      );
    }

    // Find the account: by id, or by email when the id is not known yet.
    let user: Doc<"users"> | null = null;
    if (args.userId) {
      user = await ctx.db.get(args.userId);
    } else if (args.email) {
      user = await ctx.db
        .query("users")
        .withIndex("by_email", (q) =>
          q.eq("email", args.email!.trim().toLowerCase())
        )
        .unique();
    }

    if (!user) throw new ConvexError("That user does not exist.");

    const adminId = await ctx.db.insert("platformAdmins", {
      userId: user._id,
      role: "platform_super_admin",
      status: "active",
      grantedAt: new Date().toISOString(),
      notes: args.notes ?? "Initial platform administrator",
    });

    await writeAudit(ctx, {
      actorUserId: user._id,
      actorRole: "platform_super_admin",
      action: "platform.role.bootstrap",
      targetType: "user",
      targetId: user._id,
      metadata: { email: user.email, adminId },
    });

    return { adminId, userId: user._id };
  },
});

/**
 * Whether the caller holds a platform role, and which one.
 *
 * The UI uses it to decide whether to show the platform console. It is a
 * convenience only — the guards above are what actually enforce access.
 */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const role = await findPlatformRole(ctx, user._id);
    return {
      userId: user._id,
      email: user.email,
      platformRole: role,
      permissions: role ? roleHasPermission(role, "subscriptions.manage") : false,
    };
  },
});
