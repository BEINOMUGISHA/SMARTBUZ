import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { normalizeBusinessRole, requirePlatformPermission, requireTenant } from "./tenancy";
import { roleHasPermission } from "./rbac";
import { writeAudit } from "./audit";
import { resolvePlan } from "./entitlements";
import { loadSubscriptionRow } from "./subscriptionState";
import { periodEnd, recordEvent, syncBusiness } from "./subscriptions";

/**
 * SMARTBUZ — subscription billing.
 *
 * ────────────────────────────────────────────────────────────────────────
 * A payment is not a payment until it is verified
 * ────────────────────────────────────────────────────────────────────────
 *
 * The business says they have paid and gives the provider's reference. That
 * record is **pending**: it says what the customer claims, nothing more.
 *
 * It becomes `verified` when somebody with authority confirms it against
 * the provider's own record — the provider's dashboard, the bank statement,
 * the mobile money statement. Only then does the subscription extend.
 *
 * The same provider reference cannot be claimed twice, so a payment cannot
 * be counted for two periods.
 *
 * ────────────────────────────────────────────────────────────────────────
 * About payment gateways
 * ────────────────────────────────────────────────────────────────────────
 *
 * A live gateway integration calls the provider's own API with the
 * merchant's credentials, and trusts what the provider says because the
 * provider is authenticated. This module does **not** pretend to do that:
 * there is no gateway credential authorised for this deployment, so
 * calling one would mean sending the customer's money details to a service
 * that has not agreed to it.
 *
 * What is here instead is the whole mechanism around it — the pending
 * record, the verification step, the duplicate-reference guard, the
 * extension of the period — with the verification done by a person against
 * the provider's statement. When an authorised provider API is configured,
 * it slots in at exactly one place: `verifyPayment`.
 */

/** The providers a payment may have been made through. */
export const PAYMENT_PROVIDERS = [
    "manual",
    "bank",
    "mobile_money",
    "paypal",
    "stripe",
    "flutterwave",
] as const;

/**
 * Assert the caller may manage this business's subscription.
 *
 * The subscription module deliberately bypasses the subscription write gate,
 * because a business whose subscription has lapsed must still be able to
 * pay for it.
 */
async function requireBillingManager(
  ctx: any,
  businessId?: Id<"businesses">
): Promise<{ business: any; user: any; role: string }> {
  const tenant = await requireTenant(ctx, businessId);
  const role = normalizeBusinessRole(tenant.membership.role);
  if (!roleHasPermission(role, "subscriptions.self.manage")) {
    throw new ConvexError(
      "Forbidden: only the owner or an administrator can manage billing."
    );
  }
  return { business: tenant.business, user: tenant.user, role };
}

/* ────────────────────────────────────────────────────────────────────────
 * The business's side
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Say that a payment has been made.
 *
 * The payment is recorded as **pending**. Nothing about the subscription
 * changes until the payment is verified against the provider's own record.
 */
export const submitPayment = mutation({
  args: {
    amount: v.number(),
    currency: v.optional(v.string()),
    billingCycle: v.union(v.literal("monthly"), v.literal("annual")),
    provider: v.string(),
    providerReference: v.optional(v.string()),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const { business, user, role } = await requireBillingManager(
      ctx,
      args.businessId
    );

    if (args.amount <= 0) {
      throw new ConvexError("A payment must be greater than zero.");
    }

    const subscription = await loadSubscriptionRow(ctx, business._id);
    if (!subscription) {
      throw new ConvexError(
        "Choose a plan before making a payment, so we know what it is for."
      );
    }

    const plan = await resolvePlan(ctx, subscription.planKey);
    if (!plan) {
      throw new ConvexError("The plan on this subscription no longer exists.");
    }

    const provider = args.provider.trim().toLowerCase();
    const providerReference = args.providerReference?.trim() || undefined;

    // The amount is **not** taken on trust from the browser. It is computed
    // from the price stored on the plan, and a figure that does not match is
    // refused. Otherwise a caller could "pay" one shilling for a year.
    const expectedAmount =
      args.billingCycle === "annual" ? plan.priceAnnual : plan.priceMonthly;

    if (expectedAmount > 0 && Math.abs(args.amount - expectedAmount) > 0.5) {
      throw new ConvexError(
        `The ${args.billingCycle} price of the ${plan.name} plan is ${expectedAmount} ${plan.currency}. Payment records are written at the price on the plan.`
      );
    }

    // The same provider reference is the same money. It cannot pay for two
    // periods.
    if (providerReference) {
      const existing = await ctx.db
        .query("subscriptionPayments")
        .withIndex("by_providerReference", (q: any) =>
          q.eq("provider", provider).eq("providerReference", providerReference)
        )
        .collect();
      const clash = existing.find(
        (p: any) => p.businessId === business._id && p.status !== "failed"
      );
      if (clash) {
        throw new ConvexError(
          `A payment with the reference "${providerReference}" has already been recorded.`
        );
      }
    }

    const now = new Date();
    const paymentId = await ctx.db.insert("subscriptionPayments", {
      businessId: business._id,
      subscriptionId: subscription._id,
      planKey: subscription.planKey,
      amount: expectedAmount > 0 ? expectedAmount : args.amount,
      currency: args.currency ?? plan.currency ?? "UGX",
      billingCycle: args.billingCycle,
      periodStart: now.toISOString(),
      periodEnd: periodEnd(args.billingCycle, now),
      status: "pending",
      provider,
      providerReference,
      notes: args.notes,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    await recordEvent(ctx, {
      businessId: business._id,
      subscriptionId: subscription._id,
      type: "payment_submitted",
      amount: args.amount,
      currency: args.currency ?? plan.currency,
      billingCycle: args.billingCycle,
      paymentId,
      actorUserId: user._id,
      actorRole: role,
      note: `Payment of ${expectedAmount > 0 ? expectedAmount : args.amount} submitted via ${provider}.`,
    });

    await writeAudit(ctx, {
      businessId: business._id,
      actorUserId: user._id,
      actorRole: role,
      action: "subscription.payment.submit",
      targetType: "subscription_payment",
      targetId: paymentId,
      metadata: {
        amount: expectedAmount > 0 ? expectedAmount : args.amount,
        provider,
        providerReference,
        billingCycle: args.billingCycle,
      },
    });

    return { paymentId, status: "pending" };
  },
});

/**
 * This business's payments.
 */
export const listPayments = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const role = normalizeBusinessRole(tenant.membership.role);
    if (!roleHasPermission(role, "subscriptions.self.view")) {
      throw new ConvexError("Forbidden: you may not view these payments.");
    }

    const payments = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
      .collect();

    payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = args.limit ?? 50;
    return {
      page: payments.slice(0, limit).map((p) => ({
        _id: p._id,
        amount: p.amount,
        currency: p.currency,
        billingCycle: p.billingCycle,
        status: p.status,
        provider: p.provider,
        providerReference: p.providerReference,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        verifiedAt: p.verifiedAt,
        failureReason: p.failureReason,
        createdAt: p.createdAt,
      })),
      totalCount: payments.length,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * The platform's side
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Confirm a payment and extend the subscription it pays for.
 *
 * The amount confirmed is what the administrator saw on the provider's own
 * record. It is checked against the amount the customer claimed: if they
 * differ, the payment is refused rather than quietly accepted for the
 * wrong amount.
 */
export const verifyPayment = mutation({
  args: {
    paymentId: v.id("subscriptionPayments"),
    /** The amount the provider's own record shows. */
    confirmedAmount: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformPermission(ctx, "subscriptions.payment.verify");

    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError("That payment does not exist.");
    if (payment.status === "verified") {
      throw new ConvexError("That payment has already been verified.");
    }
    if (payment.status === "failed") {
      throw new ConvexError("That payment was rejected.");
    }

    if (Math.abs(args.confirmedAmount - payment.amount) > 0.01) {
      throw new ConvexError(
        `The provider's record shows ${args.confirmedAmount}, but the customer claimed ${payment.amount}. Check the two before confirming.`
      );
    }

    const now = new Date();
    await ctx.db.patch(payment._id, {
      status: "verified",
      verifiedAt: now.toISOString(),
      verifiedBy: actor.user._id,
      notes: args.notes ?? payment.notes,
      updatedAt: now.toISOString(),
    });

    // Extend the subscription the payment was for.
    const subscription = await loadSubscriptionRow(ctx, payment.businessId);
    let status = subscription?.status;

    if (subscription) {
      const fromStatus = subscription.status;

      // The period the customer paid for.
      const periodStart =
        payment.periodStart ?? subscription.currentPeriodEnd ?? now.toISOString();
      const periodEndDate =
        payment.periodEnd ?? periodEnd(payment.billingCycle, now);

      // A payment that arrives while the account is suspended or cancelled
      // is still a payment — the time is banked — but it does not quietly
      // undo a decision somebody made on purpose. The platform owner
      // restores the account when they are ready.
      const staysAsItIs =
        fromStatus === "suspended" || fromStatus === "cancelled";

      await ctx.db.patch(subscription._id, {
        status: staysAsItIs ? fromStatus : "active",
        billingCycle: payment.billingCycle,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEndDate,
        // A payment clears a grace period.
        graceEndsAt: undefined,
        updatedAt: now.toISOString(),
      });
      status = staysAsItIs ? fromStatus : "active";

      await recordEvent(ctx, {
        businessId: payment.businessId,
        subscriptionId: subscription._id,
        type: fromStatus === "active" ? "renewed" : "payment_verified",
        fromStatus,
        toStatus: status,
        amount: payment.amount,
        currency: payment.currency,
        billingCycle: payment.billingCycle,
        paymentId: payment._id,
        actorUserId: actor.user._id,
        actorRole: actor.role,
        note: staysAsItIs
          ? `Payment verified and banked until ${periodEndDate.slice(
              0,
              10
            )}. The account stays ${fromStatus} until an administrator restores it.`
          : `Payment verified — paid through to ${periodEndDate.slice(0, 10)}.`,
      });
    }

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.payment.verify",
      targetType: "subscription_payment",
      targetId: payment._id,
      metadata: {
        amount: payment.amount,
        provider: payment.provider,
        providerReference: payment.providerReference,
        businessId: payment.businessId,
      },
    });

    await syncBusiness(ctx, payment.businessId);

    return { paymentId: payment._id, status, verified: true };
  },
});

/**
 * Reject a payment.
 *
 * A payment that did not arrive. The subscription moves into its grace
 * period, so the business keeps working while the problem is sorted out.
 */
export const rejectPayment = mutation({
  args: {
    paymentId: v.id("subscriptionPayments"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requirePlatformPermission(ctx, "subscriptions.payment.verify");

    const payment = await ctx.db.get(args.paymentId);
    if (!payment) throw new ConvexError("That payment does not exist.");
    if (payment.status === "verified") {
      throw new ConvexError("That payment has already been verified.");
    }

    const now = new Date();
    await ctx.db.patch(payment._id, {
      status: "failed",
      failureReason: args.reason,
      verifiedBy: actor.user._id,
      verifiedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });

    const subscription = await loadSubscriptionRow(ctx, payment.businessId);
    if (subscription) {
      const plan = await resolvePlan(ctx, subscription.planKey);
      const graceDays = plan?.gracePeriodDays ?? 7;
      const graceEndsAt = new Date(
        now.getTime() + graceDays * 86_400_000
      ).toISOString();

      await ctx.db.patch(subscription._id, {
        status: "past_due",
        graceEndsAt,
        updatedAt: now.toISOString(),
      });

      await recordEvent(ctx, {
        businessId: payment.businessId,
        subscriptionId: subscription._id,
        type: "payment_failed",
        fromStatus: subscription.status,
        toStatus: "past_due",
        amount: payment.amount,
        currency: payment.currency,
        paymentId: payment._id,
        actorUserId: actor.user._id,
        actorRole: actor.role,
        note: `Payment rejected: ${args.reason}`,
      });

      await syncBusiness(ctx, payment.businessId);
    }

    await writeAudit(ctx, {
      actorUserId: actor.user._id,
      actorRole: actor.role,
      action: "platform.payment.reject",
      targetType: "subscription_payment",
      targetId: payment._id,
      metadata: { reason: args.reason, amount: payment.amount },
    });

    return { paymentId: payment._id, rejected: true };
  },
});

/**
 * Every payment on the platform, for the administration console.
 */
export const listAllPayments = query({
  args: {
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requirePlatformPermission(ctx, "subscriptions.view");

    const payments = await ctx.db.query("subscriptionPayments").collect();

    let visible = payments;
    if (args.status) {
      visible = visible.filter((p) => p.status === args.status);
    }
    visible.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const limit = args.limit ?? 100;

    const businesses = new Map<string, any>();
    for (const payment of visible.slice(0, limit)) {
      if (businesses.has(payment.businessId)) continue;
      const business = await ctx.db.get(payment.businessId);
      if (business) {
        businesses.set(payment.businessId, {
          name: business.name,
          plan: business.plan,
        });
      }
    }

    return {
      page: visible.slice(0, limit).map((p) => {
        const business = businesses.get(p.businessId);
        return {
          _id: p._id,
          businessId: p.businessId,
          businessName: business?.name ?? "Unknown business",
          planKey: p.planKey,
          amount: p.amount,
          currency: p.currency,
          billingCycle: p.billingCycle,
          status: p.status,
          provider: p.provider,
          providerReference: p.providerReference,
          periodStart: p.periodStart,
          periodEnd: p.periodEnd,
          verifiedAt: p.verifiedAt,
          failureReason: p.failureReason,
          createdAt: p.createdAt,
        };
      }),
      totalCount: visible.length,
      totals: {
        pending: visible.filter((p) => p.status === "pending").length,
        verified: visible.filter((p) => p.status === "verified").length,
        failed: visible.filter((p) => p.status === "failed").length,
        verifiedAmount: visible
          .filter((p) => p.status === "verified")
          .reduce((sum, p) => sum + p.amount, 0),
      },
    };
  },
});
