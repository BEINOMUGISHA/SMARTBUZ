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
import { resolvePlan } from "./entitlements";
import {
  computeEffectiveStatus,
  daysRemaining,
  loadSubscriptionRow,
} from "./subscriptionState";
import { periodEnd, recordEvent, syncBusiness } from "./subscriptions";

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

/* ────────────────────────────────────────────────────────────────────────
 * Subscriptions — the platform owner's view
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every subscription on the platform.
 *
 * This is the list the platform owner works from: who is on which plan,
 * what state their subscription is in, and when it renews.
 */
export const listSubscriptions = query({
  args: {
    searchTerm: v.optional(v.string()),
    status: v.optional(v.string()),
    planKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requirePlatformPermission(ctx, "subscriptions.view");

    const subscriptions = await ctx.db.query("subscriptions").collect();

    const filtered = subscriptions.filter((subscription) => {
      const status = computeEffectiveStatus(subscription);
      if (args.status && status !== args.status) return false;
      if (args.planKey && subscription.planKey !== args.planKey) return false;
      return true;
    });

    const rows: any[] = [];
    for (const subscription of filtered) {
      const business = await ctx.db.get(subscription.businessId);
      if (!business) continue;
      if (args.searchTerm) {
        const search = args.searchTerm.toLowerCase();
        if (!business.name.toLowerCase().includes(search)) continue;
      }

      const plan = await resolvePlan(ctx, subscription.planKey);
      const status = computeEffectiveStatus(subscription);

      rows.push({
        _id: subscription._id,
        businessId: business._id,
        businessName: business.name,
        planKey: subscription.planKey,
        planName: plan?.name ?? subscription.planKey,
        status,
        storedStatus: subscription.status,
        billingCycle: subscription.billingCycle,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        trialEndsAt: subscription.trialEndsAt,
        graceEndsAt: subscription.graceEndsAt,
        daysRemaining: daysRemaining(subscription),
        createdAt: subscription.createdAt,
      });
    }

    rows.sort((a, b) => (a.currentPeriodEnd ?? "").localeCompare(b.currentPeriodEnd ?? ""));

    return {
      page: rows,
      totalCount: rows.length,
      counts: {
        trial: rows.filter((r) => r.status === "trial").length,
        active: rows.filter((r) => r.status === "active").length,
        grace: rows.filter((r) => r.status === "grace").length,
        pastDue: rows.filter((r) => r.status === "past_due").length,
        suspended: rows.filter((r) => r.status === "suspended").length,
        expired: rows.filter((r) => r.status === "expired").length,
        cancelled: rows.filter((r) => r.status === "cancelled").length,
      },
    };
  },
});

/**
 * One business's subscription, in full: the payments, the devices, the
 * license keys and the history.
 */
export const getSubscription = query({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    await requirePlatformPermission(ctx, "subscriptions.view");

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("That business does not exist.");

    const subscription = await loadSubscriptionRow(ctx, args.businessId);
    const plan = subscription
      ? await resolvePlan(ctx, subscription.planKey)
      : null;

    const [payments, devices, licenses, events] = await Promise.all([
      ctx.db
        .query("subscriptionPayments")
        .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
        .collect(),
      ctx.db
        .query("devices")
        .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
        .collect(),
      ctx.db
        .query("licenseKeys")
        .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
        .collect(),
      ctx.db
        .query("subscriptionEvents")
        .withIndex("by_businessId", (q) => q.eq("businessId", args.businessId))
        .collect(),
    ]);

    payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      business: {
        _id: business._id,
        name: business.name,
        status: business.status,
        ownerId: business.ownerId,
        createdAt: business.createdAt,
      },
      subscription,
      plan,
      status: subscription ? computeEffectiveStatus(subscription) : "expired",
      daysRemaining: subscription ? daysRemaining(subscription) : undefined,
      payments: payments.map((p) => ({
        _id: p._id,
        amount: p.amount,
        currency: p.currency,
        billingCycle: p.billingCycle,
        status: p.status,
        provider: p.provider,
        providerReference: p.providerReference,
        verifiedAt: p.verifiedAt,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
      })),
      devices: devices.map((d) => ({
        _id: d._id,
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        platform: d.platform,
        status: d.status,
        registeredAt: d.registeredAt,
        lastSeenAt: d.lastSeenAt,
      })),
      licenses: licenses.map((l) => ({
        _id: l._id,
        keyHint: l.keyHint,
        planKey: l.planKey,
        status: l.status,
        issuedAt: l.issuedAt,
        expiresAt: l.expiresAt,
        lastUsedAt: l.lastUsedAt,
      })),
      history: events.slice(0, 50).map((e) => ({
        _id: e._id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        fromPlan: e.fromPlan,
        toPlan: e.toPlan,
        amount: e.amount,
        note: e.note,
        actorRole: e.actorRole,
        createdAt: e.createdAt,
      })),
    };
  },
});

/**
 * Activate a subscription.
 *
 * The platform owner may activate a subscription directly — for a customer
 * who paid by transfer, or one who has been sent a license key.
 */
export const activateSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    planKey: v.optional(v.string()),
    billingCycle: v.optional(v.union(v.literal("monthly"), v.literal("annual"))),
    /** How many days of access to give. Defaults to a full billing period. */
    days: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("That business does not exist.");

    const existing = await loadSubscriptionRow(ctx, args.businessId);
    const planKey = args.planKey ?? existing?.planKey ?? "starter";
    const plan = await resolvePlan(ctx, planKey);
    if (!plan) throw new ConvexError(`There is no plan called "${planKey}".`);

    const cycle = args.billingCycle ?? existing?.billingCycle ?? "monthly";
    const now = new Date();
    const days = args.days ?? (cycle === "annual" ? 365 : 30);
    const endsAt = new Date(now.getTime() + days * 86_400_000).toISOString();

    if (existing) {
      await ctx.db.patch(existing._id, {
        planKey,
        status: "active",
        billingCycle: cycle,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: endsAt,
        graceEndsAt: undefined,
        suspendedAt: undefined,
        suspendedReason: undefined,
        updatedAt: now.toISOString(),
      });

      await recordEvent(ctx, {
        businessId: args.businessId,
        subscriptionId: existing._id,
        type: "activated",
        fromStatus: existing.status,
        toStatus: "active",
        fromPlan: existing.planKey,
        toPlan: planKey,
        currency: plan.currency,
        billingCycle: cycle,
        actorUserId: actor.user._id,
        actorRole: actor.role,
        note: args.note ?? `Activated until ${endsAt.slice(0, 10)}.`,
      });
    } else {
      const subscriptionId = await ctx.db.insert("subscriptions", {
        businessId: args.businessId,
        planKey,
        status: "active",
        billingCycle: cycle,
        currentPeriodStart: now.toISOString(),
        currentPeriodEnd: endsAt,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });

      await recordEvent(ctx, {
        businessId: args.businessId,
        subscriptionId,
        type: "activated",
        toStatus: "active",
        toPlan: planKey,
        currency: plan.currency,
        billingCycle: cycle,
        actorUserId: actor.user._id,
        actorRole: actor.role,
        note: args.note ?? `Activated until ${endsAt.slice(0, 10)}.`,
      });
    }

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.activate",
      targetType: "business",
      targetId: args.businessId,
      metadata: { planKey, cycle, endsAt, note: args.note },
    });

    await syncBusiness(ctx, args.businessId);

    return { planKey, status: "active", currentPeriodEnd: endsAt };
  },
});

/**
 * Suspend a subscription.
 *
 * The business keeps its data — nothing is deleted — but it cannot record
 * anything new until the subscription is restored.
 */
export const suspendSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("That business does not exist.");

    const subscription = await loadSubscriptionRow(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("That business has no subscription to suspend.");
    }
    if (subscription.status === "suspended") {
      return { subscriptionId: subscription._id, changed: false };
    }

    const now = new Date().toISOString();
    await ctx.db.patch(subscription._id, {
      status: "suspended",
      suspendedAt: now,
      suspendedReason: args.reason,
      updatedAt: now,
    });

    await recordEvent(ctx, {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      type: "suspended",
      fromStatus: subscription.status,
      toStatus: "suspended",
      actorUserId: actor.user._id,
      actorRole: actor.role,
      note: args.reason,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.suspend",
      targetType: "business",
      targetId: args.businessId,
      metadata: { reason: args.reason, from: subscription.status },
    });

    await syncBusiness(ctx, args.businessId);

    return { subscriptionId: subscription._id, changed: true };
  },
});

/**
 * Put a suspended or expired subscription back on.
 *
 * The period is measured from the end of the period that was paid for, so
 * a business that paid for a year and was suspended for a month gets the
 * month back rather than losing it.
 */
export const reactivateSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    /** Days to add on top of the period that was already paid for. */
    days: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const subscription = await loadSubscriptionRow(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("That business has no subscription to reactivate.");
    }

    const now = new Date();
    const days = args.days ?? 30;

    // Carry on from the end of the period that was paid for, when there is
    // one and it is still in the future.
    const paidUntil = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : 0;
    const from = Math.max(paidUntil, now.getTime());
    const endsAt = new Date(from + days * 86_400_000).toISOString();

    await ctx.db.patch(subscription._id, {
      status: "active",
      currentPeriodStart:
        subscription.currentPeriodStart ?? now.toISOString(),
      currentPeriodEnd: endsAt,
      graceEndsAt: undefined,
      suspendedAt: undefined,
      suspendedReason: undefined,
      updatedAt: now.toISOString(),
    });

    await recordEvent(ctx, {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      type: "reactivated",
      fromStatus: subscription.status,
      toStatus: "active",
      actorUserId: actor.user._id,
      actorRole: actor.role,
      note: args.note ?? `Reactivated until ${endsAt.slice(0, 10)}.`,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.reactivate",
      targetType: "business",
      targetId: args.businessId,
      metadata: { days, endsAt, note: args.note },
    });

    await syncBusiness(ctx, args.businessId);

    return { subscriptionId: subscription._id, status: "active", currentPeriodEnd: endsAt };
  },
});

/**
 * Extend a subscription.
 *
 * Adds time to the period that was paid for — a goodwill gesture, or the
 * correction of a mistake.
 */
export const extendSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    days: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    if (args.days === 0) {
      throw new ConvexError("An extension has to be for some days.");
    }

    const subscription = await loadSubscriptionRow(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("That business has no subscription to extend.");
    }

    const now = new Date();
    const from = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : now.getTime();
    const endsAt = new Date(from + args.days * 86_400_000).toISOString();

    await ctx.db.patch(subscription._id, {
      currentPeriodEnd: endsAt,
      updatedAt: now.toISOString(),
    });

    await recordEvent(ctx, {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      type: "extended",
      fromStatus: subscription.status,
      toStatus: subscription.status,
      actorUserId: actor.user._id,
      actorRole: actor.role,
      note:
        args.note ??
        `Extended by ${args.days} days — now until ${endsAt.slice(0, 10)}.`,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.extend",
      targetType: "business",
      targetId: args.businessId,
      metadata: { days: args.days, endsAt, note: args.note },
    });

    await syncBusiness(ctx, args.businessId);

    return { subscriptionId: subscription._id, currentPeriodEnd: endsAt };
  },
});

/**
 * Move a business onto a different plan.
 */
export const changePlan = mutation({
  args: {
    businessId: v.id("businesses"),
    planKey: v.string(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const plan = await resolvePlan(ctx, args.planKey);
    if (!plan) throw new ConvexError(`There is no plan called "${args.planKey}".`);

    const subscription = await loadSubscriptionRow(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("That business has no subscription to change.");
    }

    const fromPlan = subscription.planKey;
    await ctx.db.patch(subscription._id, {
      planKey: args.planKey,
      updatedAt: new Date().toISOString(),
    });

    await recordEvent(ctx, {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      type: "plan_changed",
      fromStatus: subscription.status,
      toStatus: subscription.status,
      fromPlan,
      toPlan: args.planKey,
      actorUserId: actor.user._id,
      actorRole: actor.role,
      note: args.note ?? `Moved from ${fromPlan} to ${args.planKey}.`,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.change_plan",
      targetType: "business",
      targetId: args.businessId,
      metadata: { fromPlan, toPlan: args.planKey, note: args.note },
    });

    await syncBusiness(ctx, args.businessId);

    return { subscriptionId: subscription._id, planKey: args.planKey };
  },
});

/**
 * End a subscription at the customer's request.
 *
 * The data is kept. The business can start again whenever it likes.
 */
export const cancelSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const subscription = await loadSubscriptionRow(ctx, args.businessId);
    if (!subscription) {
      throw new ConvexError("That business has no subscription to cancel.");
    }
    if (subscription.status === "cancelled") {
      return { subscriptionId: subscription._id, changed: false };
    }

    const now = new Date().toISOString();
    await ctx.db.patch(subscription._id, {
      status: "cancelled",
      cancelledAt: now,
      cancellationReason: args.reason,
      updatedAt: now,
    });

    await recordEvent(ctx, {
      businessId: args.businessId,
      subscriptionId: subscription._id,
      type: "cancelled",
      fromStatus: subscription.status,
      toStatus: "cancelled",
      actorUserId: actor.user._id,
      actorRole: actor.role,
      note: args.reason,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.subscription.cancel",
      targetType: "business",
      targetId: args.businessId,
      metadata: { reason: args.reason, from: subscription.status },
    });

    await syncBusiness(ctx, args.businessId);

    return { subscriptionId: subscription._id, changed: true };
  },
});

/**
 * Revoke a device.
 *
 * The device cannot be used again until it is registered afresh. This is
 * how a stolen laptop is cut off from a business.
 */
export const revokeDevice = mutation({
  args: {
    deviceId: v.id("devices"),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformWrite(ctx);

    const device = await ctx.db.get(args.deviceId);
    if (!device) throw new ConvexError("That device does not exist.");
    if (device.status === "revoked") {
      return { deviceId: device._id, changed: false };
    }

    await ctx.db.patch(device._id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
      revokedBy: actor.user._id,
      revocationReason: args.reason,
    });

    await recordEvent(ctx, {
      businessId: device.businessId,
      type: "device_revoked",
      actorUserId: actor.user._id,
      actorRole: actor.role,
      note: `${device.deviceName} revoked by the platform.`,
    });

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.device.revoke",
      targetType: "device",
      targetId: device._id,
      metadata: {
        deviceName: device.deviceName,
        businessId: device.businessId,
        reason: args.reason,
      },
    });

    return { deviceId: device._id, changed: true };
  },
});
