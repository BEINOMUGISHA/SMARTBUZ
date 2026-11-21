import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type BusinessId,
  normalizeBusinessRole,
  requireTenant,
} from "./tenancy";
import { roleHasPermission } from "./rbac";
import { writeAudit } from "./audit";
import { resolvePlan, subscriptionSnapshot } from "./entitlements";
import {
  computeEffectiveStatus,
  daysRemaining,
  explainStatus,
  isWritableStatus,
  loadSubscriptionRow,
  DEFAULT_PLAN_KEY,
  type SubscriptionStatus,
} from "./subscriptionState";
import { hmacSha256Hex, safeEqual } from "./crypto";
import { serverSecretMatches, serverSecretValue } from "./serverSecret";

/**
 * SMARTBUZ — subscriptions.
 *
 * What a business can do about its own subscription: see it, choose a
 * plan, pay for it, redeem a license key and manage the devices registered
 * against it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two kinds of authority
 * ────────────────────────────────────────────────────────────────────────
 *
 * The subscription module deliberately does **not** go through
 * `requirePermission` for its own writes. That guard applies the
 * subscription gate — which is right for ordinary business data, and
 * exactly wrong here: a business whose subscription has lapsed must still
 * be able to renew it.
 *
 * So the module checks the role against the canonical matrix directly. The
 * authority is the same; only the gate is different.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Assert the caller may manage this business's subscription.
 *
 * Owner or administrator, according to the canonical role matrix.
 */
async function requireSubscriptionManager(
  ctx: any,
  businessId?: Id<"businesses">
): Promise<{ business: Doc<"businesses">; user: Doc<"users">; role: string }> {
  const tenant = await requireTenant(ctx, businessId);
  const role = normalizeBusinessRole(tenant.membership.role);
  if (!roleHasPermission(role, "subscriptions.self.manage")) {
    throw new ConvexError(
      "Forbidden: only the owner or an administrator can manage the subscription."
    );
  }
  return {
    business: tenant.business,
    user: tenant.user,
    role,
  };
}

/** Assert the caller may see this business's subscription. */
async function requireSubscriptionReader(
  ctx: any,
  businessId?: Id<"businesses">
): Promise<{ business: Doc<"businesses">; user: Doc<"users">; role: string }> {
  const tenant = await requireTenant(ctx, businessId);
  const role = normalizeBusinessRole(tenant.membership.role);
  if (!roleHasPermission(role, "subscriptions.self.view")) {
    throw new ConvexError(
      "Forbidden: you may not view this business's subscription."
    );
  }
  return {
    business: tenant.business,
    user: tenant.user,
    role,
  };
}

/** Write an entry to the subscription history. */
export async function recordEvent(
  ctx: any,
  entry: {
    businessId: Id<"businesses">;
    subscriptionId?: Id<"subscriptions">;
    type: string;
    fromStatus?: string;
    toStatus?: string;
    fromPlan?: string;
    toPlan?: string;
    amount?: number;
    currency?: string;
    billingCycle?: string;
    paymentId?: Id<"subscriptionPayments">;
    note?: string;
    actorUserId?: Id<"users">;
    actorRole?: string;
  }
): Promise<void> {
  await ctx.db.insert("subscriptionEvents", {
    ...entry,
    createdAt: new Date().toISOString(),
  });
}

/**
 * Keep the business's own summary fields in step with the subscription.
 *
 * The business document carries a small summary so that a list of tenants
 * can be rendered without reading every subscription.
 */
export async function syncBusiness(ctx: any, businessId: Id<"businesses">): Promise<void> {
  const subscription = await loadSubscriptionRow(ctx, businessId);
  await ctx.db.patch(businessId, {
    plan: subscription?.planKey,
    subscriptionStatus: subscription?.status,
    subscriptionExpiresAt:
      subscription?.currentPeriodEnd ?? subscription?.trialEndsAt,
    updatedAt: new Date().toISOString(),
  });
}

/** The end of a billing period, starting now. */
export function periodEnd(cycle: string, from: Date): string {
  const end = new Date(from);
  if (cycle === "annual") end.setUTCFullYear(end.getUTCFullYear() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return end.toISOString();
}

/**
 * The most recent **verified** payment for a plan.
 *
 * Only a verified payment counts. A pending one is a claim; a verified one
 * is money that was confirmed against the provider's own record.
 */
export async function latestVerifiedPaymentForPlan(
  ctx: any,
  businessId: Id<"businesses">,
  planKey: string
): Promise<any | null> {
  const payments = await ctx.db
    .query("subscriptionPayments")
    .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
    .collect();

  const matching = payments
    .filter((p: any) => p.status === "verified" && p.planKey === planKey)
    .sort((a: any, b: any) =>
      String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))
    );

  return matching[0] ?? null;
}

/** Has this business already paid for this plan? */
export async function hasVerifiedPaymentForPlan(
  ctx: any,
  businessId: Id<"businesses">,
  planKey: string
): Promise<boolean> {
  return (await latestVerifiedPaymentForPlan(ctx, businessId, planKey)) !== null;
}

/**
 * Start a free trial for a business that has no subscription yet.
 *
 * Exported so that creating a business can put it on a real, tracked trial
 * straight away — a subscription row with a trial end date — rather than
 * leaving the business on a plan it is not really subscribed to.
 *
 * Returns `null` when the plan is unknown, so the caller can decide what to
 * do; a business with no plan is simply not gated.
 */
export async function startTrial(
  ctx: any,
  businessId: Id<"businesses">,
  planKey: string,
  actor?: { userId?: Id<"users">; role?: string }
): Promise<Id<"subscriptions"> | null> {
  const plan = await resolvePlan(ctx, planKey);
  if (!plan) return null;

  const now = new Date();
  const trialEndsAt = new Date(
    now.getTime() + (plan.trialDays ?? 0) * 86_400_000
  ).toISOString();

  const subscriptionId = await ctx.db.insert("subscriptions", {
    businessId,
    planKey,
    status: "trial",
    billingCycle: "monthly",
    trialEndsAt,
    currentPeriodStart: now.toISOString(),
    currentPeriodEnd: trialEndsAt,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  });

  await recordEvent(ctx, {
    businessId,
    subscriptionId,
    type: "trial_started",
    toStatus: "trial",
    toPlan: planKey,
    currency: plan.currency,
    actorUserId: actor?.userId,
    actorRole: actor?.role,
    note: `Free trial started — ${plan.trialDays} days.`,
  });

  await syncBusiness(ctx, businessId);

  return subscriptionId;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * This business's subscription: the plan, the dates, what it allows and
 * what it has used.
 */
export const getMySubscription = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const { business } = await requireSubscriptionReader(ctx, args.businessId);
    const snapshot = await subscriptionSnapshot(ctx, business._id);

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
      .collect();

    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
      .collect();

    const licenses = await ctx.db
      .query("licenseKeys")
      .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
      .collect();

    return {
      business: { _id: business._id, name: business.name },
      subscription: snapshot.subscription,
      plan: snapshot.plan,
      status: snapshot.status,
      writable: snapshot.writable,
      daysRemaining: snapshot.daysRemaining,
      explanation: snapshot.explanation,
      features: snapshot.features,
      devices: {
        used: devices.filter((d: any) => d.status === "active").length,
        limit: snapshot.plan?.deviceLimit ?? 0,
        registered: devices
          .filter((d: any) => d.status === "active")
          .map((d: any) => ({
            _id: d._id,
            deviceId: d.deviceId,
            deviceName: d.deviceName,
            platform: d.platform,
            lastSeenAt: d.lastSeenAt,
            registeredAt: d.registeredAt,
          })),
      },
      licenses: licenses.map((l: any) => ({
        _id: l._id,
        keyHint: l.keyHint,
        status: l.status,
        issuedAt: l.issuedAt,
        expiresAt: l.expiresAt,
      })),
      payments: payments
        .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 10)
        .map((p: any) => ({
          _id: p._id,
          amount: p.amount,
          currency: p.currency,
          billingCycle: p.billingCycle,
          status: p.status,
          provider: p.provider,
          providerReference: p.providerReference,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          createdAt: p.createdAt,
        })),
    };
  },
});

/**
 * The subscription history of this business.
 *
 * Every change, in order: what it was, what it became, and who did it.
 */
export const getHistory = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { business } = await requireSubscriptionReader(ctx, args.businessId);

    const events = await ctx.db
      .query("subscriptionEvents")
      .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
      .collect();

    events.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = args.limit ?? 50;
    return {
      page: events.slice(0, limit).map((e) => ({
        _id: e._id,
        type: e.type,
        fromStatus: e.fromStatus,
        toStatus: e.toStatus,
        fromPlan: e.fromPlan,
        toPlan: e.toPlan,
        amount: e.amount,
        currency: e.currency,
        billingCycle: e.billingCycle,
        note: e.note,
        actorRole: e.actorRole,
        createdAt: e.createdAt,
      })),
      totalCount: events.length,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Choosing a plan
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Choose a plan.
 *
 * A business with no subscription starts a **free trial** on the plan it
 * picks, for as long as that plan's trial lasts. A business that already
 * has one changes plan, and the change is on the record.
 *
 * The trial end date is set when the trial starts and is not moved by
 * changing plan: a business cannot extend its trial by changing its mind.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Choosing a paid plan does not buy it
 * ────────────────────────────────────────────────────────────────────────
 *
 * Entitlements are read from the plan key, so patching that key without
 * money behind it would be a hole straight through the billing system: a
 * business could name the most expensive plan and be entitled to it
 * immediately.
 *
 * So the plan key only moves when the money is there:
 *
 *  • A **free** plan takes effect at once. Moving to a smaller plan costs
 *    nobody anything, and blocking it would only trap people on a plan
 *    they cannot afford.
 *  • A **paid** plan is recorded as `pendingPlanKey` and takes effect when
 *    a payment for it is verified. Until then the business keeps the
 *    entitlements it has already paid for.
 */
export const selectPlan = mutation({
  args: {
    planKey: v.string(),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const { business, user, role } = await requireSubscriptionManager(
      ctx,
      args.businessId
    );

    const plan = await resolvePlan(ctx, args.planKey);
    if (!plan) {
      throw new ConvexError(`There is no plan called "${args.planKey}".`);
    }
    if (!plan.isActive) {
      throw new ConvexError(
        `The ${plan.name} plan is not on offer. Please choose another plan.`
      );
    }

    const now = new Date();
    const existing = await loadSubscriptionRow(ctx, business._id);

    if (existing) {
      if (existing.planKey === args.planKey) {
        // Already on this plan. Clear any stale intention to change.
        if (existing.pendingPlanKey) {
          await ctx.db.patch(existing._id, { pendingPlanKey: undefined });
        }
        return {
          subscriptionId: existing._id,
          planKey: existing.planKey,
          status: computeEffectiveStatus(existing),
          changed: false,
        };
      }

      const isFreePlan = plan.priceMonthly <= 0 && plan.priceAnnual <= 0;

      if (!isFreePlan) {
        // A paid plan needs money behind it. Look for a verified payment
        // for exactly this plan; if there is none, record the intention
        // and leave the real plan alone.
        const hasVerifiedPayment = await hasVerifiedPaymentForPlan(
          ctx,
          business._id,
          args.planKey
        );

        if (!hasVerifiedPayment) {
          await ctx.db.patch(existing._id, {
            pendingPlanKey: args.planKey,
            updatedAt: now.toISOString(),
          });

          await recordEvent(ctx, {
            businessId: business._id,
            subscriptionId: existing._id,
            type: "plan_change_requested",
            fromStatus: existing.status,
            toStatus: existing.status,
            fromPlan: existing.planKey,
            toPlan: args.planKey,
            actorUserId: user._id,
            actorRole: role,
            note: `Asked to move to ${args.planKey}. The plan changes once the payment is confirmed.`,
          });

          await writeAudit(ctx, {
            businessId: business._id,
            actorUserId: user._id,
            actorRole: role,
            action: "subscription.plan.request",
            targetType: "subscription",
            targetId: existing._id,
            metadata: { fromPlan: existing.planKey, toPlan: args.planKey },
          });

          return {
            subscriptionId: existing._id,
            planKey: existing.planKey,
            pendingPlanKey: args.planKey,
            status: computeEffectiveStatus(existing),
            changed: false,
            requiresPayment: true,
            message: `To move to the ${plan.name} plan, submit the payment. The plan changes once the payment is confirmed.`,
          };
        }
      }

      const fromPlan = existing.planKey;

      // ────────────────────────────────────────────────────────────────
      // A plan change moves the price, the cycle and the period
      // ────────────────────────────────────────────────────────────────
      //
      // The plan used to change and nothing else did. The subscription was
      // then on a new plan with the old plan's billing cycle, the old
      // plan's period and — worse — the old plan's period still running.
      // A business that moved to a cheaper plan kept the expensive one
      // until the old period ran out, and a business that moved to an
      // expensive one had never paid for the period it was being given.
      //
      // So the three travel together. A free plan ends the paid period:
      // nothing is being paid for any more. A paid plan takes the cycle
      // and the period from the payment that paid for it.
      const patch: Record<string, unknown> = {
        planKey: args.planKey,
        pendingPlanKey: undefined,
        updatedAt: now.toISOString(),
      };

      if (isFreePlan) {
        patch.billingCycle = "monthly";
        patch.currentPeriodStart = undefined;
        patch.currentPeriodEnd = undefined;
        patch.trialEndsAt = undefined;
        patch.graceEndsAt = undefined;
      } else {
        const payment = await latestVerifiedPaymentForPlan(
          ctx,
          business._id,
          args.planKey
        );
        patch.billingCycle = payment?.billingCycle ?? existing.billingCycle;
        if (payment?.periodStart) patch.currentPeriodStart = payment.periodStart;
        if (payment?.periodEnd) patch.currentPeriodEnd = payment.periodEnd;
      }

      await ctx.db.patch(existing._id, patch);

      await recordEvent(ctx, {
        businessId: business._id,
        subscriptionId: existing._id,
        type: "plan_changed",
        fromStatus: existing.status,
        toStatus: existing.status,
        fromPlan,
        toPlan: args.planKey,
        actorUserId: user._id,
        actorRole: role,
        note: `Changed from ${fromPlan} to ${args.planKey}.`,
      });

      await writeAudit(ctx, {
        businessId: business._id,
        actorUserId: user._id,
        actorRole: role,
        action: "subscription.plan.change",
        targetType: "subscription",
        targetId: existing._id,
        metadata: { fromPlan, toPlan: args.planKey },
      });

      await syncBusiness(ctx, business._id);

      return {
        subscriptionId: existing._id,
        planKey: args.planKey,
        status: computeEffectiveStatus(existing),
        changed: true,
      };
    }

    // A new subscription: the free trial starts now.
    const subscriptionId = await startTrial(ctx, business._id, args.planKey, {
      userId: user._id,
      role,
    });

    if (!subscriptionId) {
      throw new ConvexError(`There is no plan called "${args.planKey}".`);
    }

    const trialEndsAt = await ctx.db
      .get(subscriptionId)
      .then((row: any) => row?.trialEndsAt);

    await writeAudit(ctx, {
      businessId: business._id,
      actorUserId: user._id,
      actorRole: role,
      action: "subscription.trial.start",
      targetType: "subscription",
      targetId: subscriptionId,
      metadata: { planKey: args.planKey, trialEndsAt },
    });

    return {
      subscriptionId,
      planKey: args.planKey,
      status: "trial" as SubscriptionStatus,
      trialEndsAt,
      changed: true,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Activation
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Activate the subscription.
 *
 * The subscription only becomes active when there is a **verified** payment
 * behind it. The business saying "I have paid" is not a payment; the
 * payment has to be confirmed against the provider's own record first.
 */
export const activateSubscription = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const { business, user, role } = await requireSubscriptionManager(
      ctx,
      args.businessId
    );

    const subscription = await loadSubscriptionRow(ctx, business._id);
    if (!subscription) {
      throw new ConvexError(
        "Choose a plan first, and your free trial will begin."
      );
    }

    const status = computeEffectiveStatus(subscription);
    if (status === "active") {
      return { subscriptionId: subscription._id, status, changed: false };
    }

    // Is there a verified payment for this plan that has not been applied
    // yet? The platform normally applies it as it confirms it, so this is
    // the safety net for the case where the payment arrived while the
    // account was suspended.
    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
      .collect();

    const paidUntil = subscription.currentPeriodEnd
      ? new Date(subscription.currentPeriodEnd).getTime()
      : 0;

    // The plan the money was actually for: the plan the business asked for
    // but had not yet paid for, if there is one, otherwise the plan it is
    // already on. A payment for the pending plan is what makes the change
    // real.
    const targetPlanKey = subscription.pendingPlanKey ?? subscription.planKey;

    const verified = payments
      .filter(
        (p: any) =>
          p.status === "verified" &&
          p.planKey === targetPlanKey &&
          new Date(p.periodEnd ?? p.verifiedAt ?? p.createdAt).getTime() > paidUntil
      )
      .sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt))[0];

    if (!verified) {
      throw new ConvexError(
        "We have not received your payment yet. Once the payment is confirmed, your subscription will be activated."
      );
    }

    const now = new Date();
    const periodStart = verified.periodStart ?? now.toISOString();
    const periodEndDate =
      verified.periodEnd ?? periodEnd(verified.billingCycle, now);

    // The payment settles the plan the business asked for. Moving the plan
    // key here — and only here — is what makes a paid plan real.
    const planChanges = targetPlanKey !== subscription.planKey;

    await ctx.db.patch(subscription._id, {
      status: "active",
      ...(planChanges ? { planKey: targetPlanKey } : {}),
      pendingPlanKey: undefined,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEndDate,
      updatedAt: now.toISOString(),
    });

    await ctx.db.patch(verified._id, {
      verifiedAt: now.toISOString(),
      verifiedBy: user._id,
      updatedAt: now.toISOString(),
    });

    await recordEvent(ctx, {
      businessId: business._id,
      subscriptionId: subscription._id,
      type: "activated",
      fromStatus: subscription.status,
      toStatus: "active",
      fromPlan: subscription.planKey,
      toPlan: targetPlanKey,
      amount: verified.amount,
      currency: verified.currency,
      billingCycle: verified.billingCycle,
      paymentId: verified._id,
      actorUserId: user._id,
      actorRole: role,
      note: planChanges
        ? `Subscription activated on the ${targetPlanKey} plan.`
        : "Subscription activated.",
    });

    await writeAudit(ctx, {
      businessId: business._id,
      actorUserId: user._id,
      actorRole: role,
      action: "subscription.activate",
      targetType: "subscription",
      targetId: subscription._id,
      metadata: { amount: verified.amount, periodEnd: periodEndDate },
    });

    await syncBusiness(ctx, business._id);

    return { subscriptionId: subscription._id, status: "active" as const, changed: true };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Repair
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Give a business that has no subscription row one.
 *
 * A business used to be able to exist with no subscription at all — the
 * registration path forgot to create one — and a business with no
 * subscription was not gated: it could use every feature and keep writing
 * for ever. Registration now starts a trial, and the entitlement gate fails
 * closed, so no new business can be in that state.
 *
 * This mutation is how the businesses that *already* are get out of it.
 * It is a server operation: it is called by
 * `scripts/backfill-subscriptions.mjs`, and a browser cannot reach it.
 */
export const backfillSubscription = mutation({
  args: {
    businessId: v.id("businesses"),
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
    /** The plan to put the trial on. Defaults to the default plan. */
    planKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!serverSecretMatches(args.serverSecret)) {
      throw new ConvexError(
        "Forbidden: the backfill can only be run by the SMARTBUZ server."
      );
    }

    const existing = await loadSubscriptionRow(ctx, args.businessId);
    if (existing) {
      return {
        businessId: args.businessId,
        created: false,
        planKey: existing.planKey,
        status: existing.status,
      };
    }

    const business = await ctx.db.get(args.businessId);
    if (!business) {
      throw new ConvexError("That business does not exist.");
    }

    const planKey = args.planKey ?? DEFAULT_PLAN_KEY;
    const subscriptionId = await startTrial(ctx, args.businessId, planKey);

    if (!subscriptionId) {
      throw new ConvexError(`There is no plan called "${planKey}".`);
    }

    return {
      businessId: args.businessId,
      created: true,
      subscriptionId,
      planKey,
      status: "trial" as SubscriptionStatus,
    };
  },
});

/**
 * The businesses that have no subscription row.
 *
 * This is the list `scripts/backfill-subscriptions.mjs` works through. It
 * is gated by the server secret rather than by a platform role, because
 * the script runs without signing anybody in — and because a list of every
 * tenant is exactly the kind of thing that should not be readable by
 * accident.
 */
export const listUnsubscribed = query({
  args: {
    /** The server-to-backend secret. Only the SMARTBUZ server has it. */
    serverSecret: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (!serverSecretMatches(args.serverSecret)) {
      throw new ConvexError(
        "Forbidden: only the SMARTBUZ server may list the tenants without a subscription."
      );
    }

    const businesses = await ctx.db.query("businesses").collect();
    const subscriptions = await ctx.db.query("subscriptions").collect();
    const subscribed = new Set(subscriptions.map((s) => s.businessId));

    return businesses
      .filter((b) => !subscribed.has(b._id))
      .map((b) => ({ businessId: b._id, name: b.name, slug: b.slug }));
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Devices
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Register a device.
 *
 * A plan allows a number of devices. The limit is the plan's, and it is
 * checked on the server — the interface cannot be trusted to count.
 */
export const registerDevice = mutation({
  args: {
    deviceId: v.string(),
    deviceName: v.string(),
    platform: v.optional(v.string()),
    appVersion: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const { business, user, role } = await requireSubscriptionManager(
      ctx,
      args.businessId
    );

    const deviceId = args.deviceId.trim();
    if (!deviceId) throw new ConvexError("A device needs an identifier.");
    if (!args.deviceName.trim()) {
      throw new ConvexError("A device needs a name, so it can be recognised.");
    }

    const now = new Date().toISOString();

    const existing = await ctx.db
      .query("devices")
      .withIndex("by_businessId_deviceId", (q: any) =>
        q.eq("businessId", business._id).eq("deviceId", deviceId)
      )
      .unique();

    if (existing) {
      if (existing.status === "revoked") {
        throw new ConvexError(
          "This device has been revoked. Ask an administrator to register it again."
        );
      }
      await ctx.db.patch(existing._id, {
        deviceName: args.deviceName.trim(),
        platform: args.platform,
        appVersion: args.appVersion,
        lastSeenAt: now,
      });
      return { deviceId: existing._id, alreadyRegistered: true };
    }

    // How many devices does the plan allow?
    //
    // A business with no subscription has no plan, so it has no device
    // allowance either. Reading that as "0 means unlimited" would let an
    // unlicensed tenant register devices without limit.
    const snapshot = await subscriptionSnapshot(ctx, business._id);
    if (!snapshot.subscription) {
      throw new ConvexError(snapshot.explanation);
    }
    const limit = snapshot.plan?.deviceLimit ?? 0;

    if (limit > 0) {
      const devices = await ctx.db
        .query("devices")
        .withIndex("by_businessId", (q: any) =>
          q.eq("businessId", business._id)
        )
        .collect();
      const active = devices.filter((d: any) => d.status === "active");
      if (active.length >= limit) {
        throw new ConvexError(
          `Your ${snapshot.plan?.name ?? "current"} plan allows ${limit} device${
            limit === 1 ? "" : "s"
          }, and all ${limit} are in use. Revoke one, or upgrade your plan.`
        );
      }
    }

    const id = await ctx.db.insert("devices", {
      businessId: business._id,
      deviceId,
      deviceName: args.deviceName.trim(),
      platform: args.platform,
      appVersion: args.appVersion,
      status: "active",
      registeredAt: now,
      lastSeenAt: now,
      createdAt: now,
    });

    await writeAudit(ctx, {
      businessId: business._id,
      actorUserId: user._id,
      actorRole: role,
      action: "subscription.device.register",
      targetType: "device",
      targetId: id,
      metadata: { deviceId, deviceName: args.deviceName.trim() },
    });

    return { deviceId: id, alreadyRegistered: false };
  },
});

/** The devices registered against this business. */
export const listDevices = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const { business } = await requireSubscriptionReader(ctx, args.businessId);

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_businessId", (q) => q.eq("businessId", business._id))
      .collect();

    devices.sort((a: any, b: any) => b.registeredAt.localeCompare(a.registeredAt));

    return devices.map((d: any) => ({
      _id: d._id,
      deviceId: d.deviceId,
      deviceName: d.deviceName,
      platform: d.platform,
      appVersion: d.appVersion,
      status: d.status,
      registeredAt: d.registeredAt,
      lastSeenAt: d.lastSeenAt,
      revokedAt: d.revokedAt,
      revocationReason: d.revocationReason,
    }));
  },
});

/**
 * Revoke one of this business's own devices.
 *
 * A business may free up a slot on its own plan by revoking a device it no
 * longer uses. The platform can revoke any device.
 */
export const revokeDevice = mutation({
  args: {
    deviceId: v.id("devices"),
    reason: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const { business, user, role } = await requireSubscriptionManager(
      ctx,
      args.businessId
    );

    const device = await ctx.db.get(args.deviceId);
    if (!device || device.businessId !== business._id) {
      throw new ConvexError("That device belongs to another business.");
    }
    if (device.status === "revoked") {
      return { deviceId: device._id, changed: false };
    }

    await ctx.db.patch(device._id, {
      status: "revoked",
      revokedAt: new Date().toISOString(),
      revokedBy: user._id,
      revocationReason: args.reason,
    });

    await recordEvent(ctx, {
      businessId: business._id,
      type: "device_revoked",
      actorUserId: user._id,
      actorRole: role,
      note: `${device.deviceName} revoked.`,
    });

    await writeAudit(ctx, {
      businessId: business._id,
      actorUserId: user._id,
      actorRole: role,
      action: "subscription.device.revoke",
      targetType: "device",
      targetId: device._id,
      metadata: { deviceName: device.deviceName, reason: args.reason },
    });

    return { deviceId: device._id, changed: true };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * License keys
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Redeem a license key.
 *
 * The key is hashed with the server's pepper before it is looked up, so the
 * stored value cannot be turned back into a working key. A key that has
 * already been used by another business is refused.
 */
export const redeemLicenseKey = mutation({
  args: {
    key: v.string(),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const { business, user, role } = await requireSubscriptionManager(
      ctx,
      args.businessId
    );

    const key = args.key.trim().toUpperCase();
    if (!key) throw new ConvexError("Enter the license key you were given.");

    const hash = await hmacSha256Hex(serverSecretValue(), key);
    const license = await ctx.db
      .query("licenseKeys")
      .withIndex("by_keyHash", (q) => q.eq("keyHash", hash))
      .unique();

    if (!license) {
      throw new ConvexError("That license key is not valid.");
    }
    if (license.status === "revoked") {
      throw new ConvexError(
        "That license key has been revoked. Please contact SMARTBUZ."
      );
    }
    if (
      license.expiresAt &&
      new Date(license.expiresAt).getTime() < Date.now()
    ) {
      throw new ConvexError("That license key has expired.");
    }
    if (license.businessId && license.businessId !== business._id) {
      throw new ConvexError(
        "That license key has already been used by another business."
      );
    }

    const now = new Date();
    const planKey = license.planKey ?? "starter";
    const resolvedPlan = await resolvePlan(ctx, planKey);

    const subscription = await loadSubscriptionRow(ctx, business._id);
    const periodStart = now.toISOString();
    const periodEndDate = new Date(
      now.getTime() + 365 * 86_400_000
    ).toISOString();

    if (subscription) {
      await ctx.db.patch(subscription._id, {
        planKey,
        status: "active",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEndDate,
        licenseKeyId: license._id,
        updatedAt: periodStart,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        businessId: business._id,
        planKey,
        status: "active",
        billingCycle: "annual",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEndDate,
        licenseKeyId: license._id,
        createdAt: periodStart,
        updatedAt: periodStart,
      });
    }

    await ctx.db.patch(license._id, {
      businessId: business._id,
      status: "active",
      lastUsedAt: periodStart,
      useCount: (license.useCount ?? 0) + 1,
    });

    await recordEvent(ctx, {
      businessId: business._id,
      type: "license_redeemed",
      toStatus: "active",
      toPlan: planKey,
      actorUserId: user._id,
      actorRole: role,
      note: `License key …${license.keyHint} redeemed.`,
    });

    await writeAudit(ctx, {
      businessId: business._id,
      actorUserId: user._id,
      actorRole: role,
      action: "subscription.license.redeem",
      targetType: "license_key",
      targetId: license._id,
      metadata: { planKey, keyHint: license.keyHint },
    });

    await syncBusiness(ctx, business._id);

    return { planKey, resolved: resolvedPlan?.name ?? planKey };
  },
});

/**
 * Is this device allowed to be used?
 *
 * The check the client makes before it will run, and the check the server
 * makes on every write.
 */
export const checkDevice = query({
  args: {
    deviceId: v.string(),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const deviceId = args.deviceId.trim();

    const device = await ctx.db
      .query("devices")
      .withIndex("by_businessId_deviceId", (q: any) =>
        q.eq("businessId", tenant.businessId).eq("deviceId", deviceId)
      )
      .unique();

    if (!device) {
      return { allowed: false, reason: "This device is not registered." };
    }
    if (device.status === "revoked") {
      return { allowed: false, reason: "This device has been revoked." };
    }

    const snapshot = await subscriptionSnapshot(ctx, tenant.businessId);
    if (!snapshot.writable) {
      return {
        allowed: false,
        reason: snapshot.explanation,
        status: snapshot.status,
      };
    }

    return {
      allowed: true,
      status: snapshot.status,
      planKey: snapshot.plan?.key,
      daysRemaining: snapshot.daysRemaining,
      explanation: snapshot.explanation,
    };
  },
});

/**
 * The subscription's state, in one place.
 *
 * The paywall reads this. It is a convenience — the server enforces the
 * rules whether or not anybody reads it.
 */
export const getSubscriptionState = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const { business } = await requireSubscriptionReader(ctx, args.businessId);
    const snapshot = await subscriptionSnapshot(ctx, business._id);

    return {
      status: snapshot.status,
      writable: snapshot.writable,
      explanation: snapshot.explanation,
      daysRemaining: snapshot.daysRemaining,
      planKey: snapshot.plan?.key,
      planName: snapshot.plan?.name,
      features: snapshot.features,
      renewalDate: snapshot.subscription?.currentPeriodEnd,
      trialEndsAt: snapshot.subscription?.trialEndsAt,
      graceEndsAt: snapshot.subscription?.graceEndsAt,
    };
  },
});
