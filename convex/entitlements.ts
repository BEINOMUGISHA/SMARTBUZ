import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requirePermission, requireTenant } from "./tenancy";
import {
  ALL_ENTITLEMENTS,
  ENTITLEMENT_CATALOGUE,
  computeEffectiveStatus,
  daysRemaining,
  defaultPlanFor,
  explainStatus,
  isWritableStatus,
  planHasFeature,
  type SubscriptionStatus,
} from "./subscriptionState";
import { loadSubscriptionRow } from "./subscriptionState";

/**
 * SMARTBUZ — entitlements.
 *
 * What a business's subscription lets it do, enforced **on the server**.
 *
 * The interface hides a feature the business does not have, but the
 * interface is not what decides. Every gated function calls
 * `requireEntitlement` before it does anything, so a request made by hand —
 * or by a script, or by a browser that never got the message — is refused
 * just the same.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two different limits
 * ────────────────────────────────────────────────────────────────────────
 *
 *   **Features**  whether a whole part of the product may be used at all —
 *                 purchasing, the credit book, the reporting suite.
 *
 *   **Usage**     how much of it there is allowed — two branches, ten
 *                 staff, a hundred products.
 *
 * Usage is counted from the records that exist rather than kept in a
 * counter, so it cannot drift away from the truth.
 */

export type UsageKind = "branches" | "warehouses" | "users" | "products";

/* ────────────────────────────────────────────────────────────────────────
 * Loading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The plan a subscription is on.
 *
 * The `plans` table is the catalogue. The built-in definitions are only
 * the seed — they are used when the catalogue has not been written yet, so
 * that a fresh installation still has a pricing page.
 */
export async function resolvePlan(
  ctx: any,
  planKey: string
): Promise<{
  key: string;
  name: string;
  description?: string;
  priceMonthly: number;
  priceAnnual: number;
  currency: string;
  trialDays: number;
  gracePeriodDays: number;
  deviceLimit: number;
  maxUsers: number;
  maxBranches: number;
  maxWarehouses: number;
  maxProducts: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
} | null> {
  const stored = await ctx.db
    .query("plans")
    .withIndex("by_key", (q: any) => q.eq("key", planKey))
    .unique();

  if (stored) return stored as any;

  const fallback = defaultPlanFor(planKey);
  return fallback ? (fallback as any) : null;
}

/**
 * The whole picture of a business's subscription.
 */
export async function subscriptionSnapshot(
  ctx: any,
  businessId: string,
  now: Date = new Date()
): Promise<{
  subscription: any | null;
  plan: any | null;
  status: SubscriptionStatus;
  writable: boolean;
  daysRemaining: number | undefined;
  explanation: string;
  features: string[];
}> {
  const subscription = await loadSubscriptionRow(ctx, businessId);
  const plan = subscription
    ? await resolvePlan(ctx, subscription.planKey)
    : null;

  if (!subscription) {
    // No subscription on record: this business is not licensed, so nothing
    // is gated. The platform owner decides which businesses that is.
    return {
      subscription: null,
      plan: null,
      status: "active",
      writable: true,
      daysRemaining: undefined,
      explanation: "This account is not on a subscription.",
      features: ALL_ENTITLEMENTS as string[],
    };
  }

  const status = computeEffectiveStatus(subscription, now);
  const writable = isWritableStatus(status);

  return {
    subscription,
    plan,
    status,
    writable,
    daysRemaining: daysRemaining(subscription, now),
    explanation: explainStatus(status, plan?.name),
    features: plan?.features ?? [],
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * The guards
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Refuse a call that the business's plan does not cover.
 *
 * The message says what happened and what to do about it, because it is
 * read by the owner of the business, not by a developer.
 *
 * This checks the **plan tier** only. Whether the subscription is still
 * alive is a separate question, answered by the write gate in
 * `requirePermission`: a lapsed business keeps the right to *read* its own
 * data and its invoice, but loses the right to write. Nothing is deleted.
 */
export async function requireEntitlement(
  ctx: any,
  businessId: string,
  feature: string
): Promise<void> {
  const snapshot = await subscriptionSnapshot(ctx, businessId);

  // No subscription on record — nothing is gated.
  if (!snapshot.subscription) return;

  if (planHasFeature(snapshot.plan, feature)) return;

  const label =
    (ENTITLEMENT_CATALOGUE as Record<string, { label: string }>)[feature]
      ?.label ?? feature;

  throw new ConvexError(
    `Your ${snapshot.plan?.name ?? "current"} plan does not include ${label}. Upgrade your plan to use it.`
  );
}

/**
 * Refuse a call that both the plan tier and the live subscription forbid.
 *
 * Used where a feature must not even be *read* by an account that is not
 * in good standing — for example the platform's own reporting.
 */
export async function requireActiveEntitlement(
  ctx: any,
  businessId: string,
  feature: string
): Promise<void> {
  const snapshot = await subscriptionSnapshot(ctx, businessId);

  if (!snapshot.subscription) return;

  if (!snapshot.writable) {
    throw new ConvexError(
      `${snapshot.explanation} Ask an administrator to renew or restore the subscription.`
    );
  }

  await requireEntitlement(ctx, businessId, feature);
}

/**
 * Count what the business is using.
 *
 * Counted from the records, never from a counter that could drift.
 */
export async function currentUsage(
  ctx: any,
  businessId: string
): Promise<Record<UsageKind, number>> {
  const [branches, warehouses, memberships, stocks] = await Promise.all([
    ctx.db
      .query("branches")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect(),
    ctx.db
      .query("warehouses")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect(),
    ctx.db
      .query("memberships")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect(),
    ctx.db
      .query("stocks")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
      .collect(),
  ]);

  return {
    branches: branches.filter((b: any) => b.isActive !== false).length,
    warehouses: warehouses.filter((w: any) => w.isActive !== false).length,
    users: memberships.filter((m: any) => (m.status ?? "active") === "active")
      .length,
    products: stocks.length,
  };
}

/** The limit a plan places on one kind of usage. 0 means unlimited. */
export function planLimit(
  plan: any,
  kind: UsageKind
): number {
  if (!plan) return 0;
  switch (kind) {
    case "branches":
      return plan.maxBranches ?? 0;
    case "warehouses":
      return plan.maxWarehouses ?? 0;
    case "users":
      return plan.maxUsers ?? 0;
    case "products":
      return plan.maxProducts ?? 0;
  }
}

const USAGE_LABELS: Record<UsageKind, string> = {
  branches: "branch",
  warehouses: "warehouse",
  users: "staff account",
  products: "product",
};

/**
 * Refuse to create one more thing than the plan allows.
 */
export async function requireUsageAllowance(
  ctx: any,
  businessId: string,
  kind: UsageKind
): Promise<void> {
  const subscription = await loadSubscriptionRow(ctx, businessId);
  if (!subscription) return;

  const plan = await resolvePlan(ctx, subscription.planKey);
  const limit = planLimit(plan, kind);
  if (!limit || limit <= 0) return; // unlimited

  const usage = await currentUsage(ctx, businessId);
  const used = usage[kind];

  if (used >= limit) {
    throw new ConvexError(
      `Your ${plan?.name ?? "current"} plan allows ${limit} ${USAGE_LABELS[kind]}${
        limit === 1 ? "" : "s"
      }, and you are using ${used}. Upgrade your plan to add more.`
    );
  }
}

/**
 * Refuse to open a *second* branch or warehouse without the tier that pays
 * for it.
 *
 * The first one is always allowed — every business needs somewhere to sell
 * from. A second means the business has outgrown a single-site plan, so the
 * `multi.branch` / `multi.warehouse` feature must be on the plan.
 */
export async function requireStructureAllowance(
  ctx: any,
  businessId: string,
  kind: "branches" | "warehouses"
): Promise<void> {
  await requireUsageAllowance(ctx, businessId, kind);

  const subscription = await loadSubscriptionRow(ctx, businessId);
  if (!subscription) return;

  const usage = await currentUsage(ctx, businessId);
  if (usage[kind] < 1) return; // the first one is always allowed

  await requireEntitlement(
    ctx,
    businessId,
    kind === "branches" ? "multi.branch" : "multi.warehouse"
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading — what may this business use?
 * ──────────────────────────────────────────────────────────────────────── */
/**
 * What this business's subscription allows.
 *
 * The interface uses this to show the right things. It is a convenience:
 * the guards above are what actually enforce it.
 */
export const getMyEntitlements = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "subscriptions.self.view");

    const snapshot = await subscriptionSnapshot(ctx, tenant.businessId);

    const usage = await currentUsage(ctx, tenant.businessId);
    const limits: Record<string, { used: number; limit: number }> = {};
    for (const kind of Object.keys(usage) as UsageKind[]) {
      limits[kind] = {
        used: usage[kind],
        limit: planLimit(snapshot.plan, kind),
      };
    }

    const devices = await ctx.db
      .query("devices")
      .withIndex("by_businessId", (q: any) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    return {
      status: snapshot.status,
      writable: snapshot.writable,
      explanation: snapshot.explanation,
      daysRemaining: snapshot.daysRemaining,
      plan: snapshot.plan
        ? {
            key: snapshot.plan.key,
            name: snapshot.plan.name,
            priceMonthly: snapshot.plan.priceMonthly,
            priceAnnual: snapshot.plan.priceAnnual,
            currency: snapshot.plan.currency,
            features: snapshot.plan.features ?? [],
          }
        : null,
      features: snapshot.features,
      entitlements: ALL_ENTITLEMENTS.map((key) => ({
        key,
        label: ENTITLEMENT_CATALOGUE[key].label,
        group: ENTITLEMENT_CATALOGUE[key].group,
        description: ENTITLEMENT_CATALOGUE[key].description,
        included: snapshot.features.includes(key),
      })),
      usage: limits,
      devices: {
        used: devices.filter((d: any) => d.status === "active").length,
        limit: snapshot.plan?.deviceLimit ?? 0,
      },
    };
  },
});
