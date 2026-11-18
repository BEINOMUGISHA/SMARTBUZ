import { ConvexError } from "convex/values";

/**
 * SMARTBUZ — subscription state.
 *
 * The rules of a subscription, with no dependencies: no imports from the
 * tenancy layer, so it can be used from anywhere without a circular
 * import.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The states
 * ────────────────────────────────────────────────────────────────────────
 *
 *   trial       the free trial is running
 *   active      paid, and the period has been paid for
 *   past_due    a payment failed; the grace window is running
 *   grace       the grace window is running
 *   suspended   the platform owner stopped the account
 *   expired     the period is over and nothing was paid
 *   cancelled   the customer ended it
 *
 * Only `trial`, `active` and `grace` let a business **write**. A suspended,
 * expired or cancelled subscription can still be **read** — the owner must
 * be able to see their data and their invoice — but nothing new can be
 * recorded.
 *
 * **Nothing is ever deleted when a subscription ends.** The data stays; only
 * the writing stops.
 */

export const SUBSCRIPTION_STATUSES = [
    "trial",
    "active",
    "past_due",
    "grace",
    "suspended",
    "expired",
    "cancelled",
] as const;

export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ["monthly", "annual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** The states in which a business may still record things. */
export const WRITABLE_STATUSES: SubscriptionStatus[] = ["trial", "active", "grace"];

/** Is this a state in which the business may write? */
export function isWritableStatus(status: SubscriptionStatus): boolean {
    return WRITABLE_STATUSES.includes(status);
}

/* ────────────────────────────────────────────────────────────────────────
 * Entitlements
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every feature that can be gated.
 *
 * The key is what a plan stores in its `features` array. The label is what
 * the pricing page and the subscription page show.
 */
export const ENTITLEMENT_CATALOGUE = {
    "core.sales": {
        label: "Sales and the till",
        group: "Core",
        description: "Record sales, take payment and print receipts.",
    },
    "core.stock": {
        label: "Stock and products",
        group: "Core",
        description: "Products, stock levels and adjustments.",
    },
    "core.customers": {
        label: "Customer directory",
        group: "Core",
        description: "Customer profiles, contact details and purchase history.",
    },
    purchasing: {
        label: "Purchasing and suppliers",
        group: "Operations",
        description: "Purchase orders, goods received notes and supplier invoices.",
    },
    "customer.credit": {
        label: "Customer credit account",
        group: "Operations",
        description: "Sell on credit, take repayments and issue statements.",
    },
    "loyalty.points": {
        label: "Loyalty points",
        group: "Operations",
        description: "Earn and redeem points with your customers.",
    },
    "finance.reports": {
        label: "Finance reports",
        group: "Intelligence",
        description: "Profit and loss, running costs, the financial summary.",
    },
    "business.intelligence": {
        label: "Business intelligence",
        group: "Intelligence",
        description: "The full reporting suite, exports and the stock valuation.",
    },
    "multi.branch": {
        label: "Multiple branches",
        group: "Structure",
        description: "Run more than one branch from one account.",
    },
    "multi.warehouse": {
        label: "Multiple warehouses",
        group: "Structure",
        description: "Run more than one warehouse and stock between them.",
    },
    "api.access": {
        label: "API access",
        group: "Platform",
        description: "Integrate SMARTBUZ with your own systems.",
    },
    "priority.support": {
        label: "Priority support",
        group: "Platform",
        description: "A direct line to the SMARTBUZ team.",
    },
    "custom.domain": {
        label: "Custom domain",
        group: "Platform",
        description: "Serve your business from your own domain.",
    },
} as const;

export type EntitlementKey = keyof typeof ENTITLEMENT_CATALOGUE;

export const ALL_ENTITLEMENTS = Object.keys(
    ENTITLEMENT_CATALOGUE
) as EntitlementKey[];

/** Does this plan grant this feature? */
export function planHasFeature(
    plan: { features?: string[] } | null | undefined,
    feature: string
): boolean {
    if (!plan) return false;
    return (plan.features ?? []).includes(feature);
}

/* ────────────────────────────────────────────────────────────────────────
 * The built-in plans
 * ──────────────────────────────────────────────────────────────────────── */

export interface PlanDefinition {
    key: string;
    name: string;
    description: string;
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
    isDefault?: boolean;
}

/**
 * The four plans SMARTBUZ ships with.
 *
 * These are the **seed**, not a second source of truth: they are written
 * into the `plans` table by `plans.seedDefaults`, and the table is what
 * everything else reads. They are kept here so that a fresh installation
 * has a pricing page before anybody has opened the platform console.
 */
export const DEFAULT_PLANS: PlanDefinition[] = [
    {
        key: "starter",
        name: "Starter",
        description:
            "For a single till finding its feet. Sales, stock and customers.",
        priceMonthly: 50_000,
        priceAnnual: 500_000,
        currency: "UGX",
        trialDays: 14,
        gracePeriodDays: 7,
        deviceLimit: 1,
        maxUsers: 3,
        maxBranches: 1,
        maxWarehouses: 1,
        maxProducts: 100,
        features: ["core.sales", "core.stock", "core.customers"],
        isActive: true,
        sortOrder: 1,
        isDefault: true,
    },
    {
        key: "business",
        name: "Business",
        description:
            "For a shop that buys stock and sells on credit. Purchasing, suppliers and a credit book.",
        priceMonthly: 150_000,
        priceAnnual: 1_500_000,
        currency: "UGX",
        trialDays: 14,
        gracePeriodDays: 7,
        deviceLimit: 3,
        maxUsers: 10,
        maxBranches: 3,
        maxWarehouses: 3,
        maxProducts: 1_000,
        features: [
            "core.sales",
            "core.stock",
            "core.customers",
            "purchasing",
            "customer.credit",
            "loyalty.points",
            "multi.branch",
            "multi.warehouse",
        ],
        isActive: true,
        sortOrder: 2,
        isDefault: true,
    },
    {
        key: "professional",
        name: "Professional",
        description:
            "For a business with branches and a management team. The full reporting suite and every branch.",
        priceMonthly: 400_000,
        priceAnnual: 4_000_000,
        currency: "UGX",
        trialDays: 14,
        gracePeriodDays: 14,
        deviceLimit: 10,
        maxUsers: 50,
        maxBranches: 10,
        maxWarehouses: 10,
        maxProducts: 10_000,
        features: [
            "core.sales",
            "core.stock",
            "core.customers",
            "purchasing",
            "customer.credit",
            "loyalty.points",
            "multi.branch",
            "multi.warehouse",
            "finance.reports",
            "business.intelligence",
        ],
        isActive: true,
        sortOrder: 3,
        isDefault: true,
    },
    {
        key: "enterprise",
        name: "Enterprise",
        description:
            "For a group. Unlimited everything, API access and a direct line to us.",
        priceMonthly: 1_200_000,
        priceAnnual: 12_000_000,
        currency: "UGX",
        trialDays: 30,
        gracePeriodDays: 30,
        deviceLimit: 0,
        maxUsers: 0,
        maxBranches: 0,
        maxWarehouses: 0,
        maxProducts: 0,
        features: [
            "core.sales",
            "core.stock",
            "core.customers",
            "purchasing",
            "customer.credit",
            "loyalty.points",
            "multi.branch",
            "multi.warehouse",
            "finance.reports",
            "business.intelligence",
            "api.access",
            "priority.support",
            "custom.domain",
        ],
        isActive: true,
        sortOrder: 4,
        isDefault: true,
    },
];

/** The built-in definition of a plan, when it is one of the four. */
export function defaultPlanFor(key: string): PlanDefinition | undefined {
    return DEFAULT_PLANS.find((p) => p.key === key);
}

/**
 * The plan a business starts on when nobody has chosen one for it.
 *
 * The first plan marked as the default in `DEFAULT_PLANS`.
 */
export const DEFAULT_PLAN_KEY =
    DEFAULT_PLANS.find((p) => p.isDefault)?.key ?? DEFAULT_PLANS[0].key;

/* ────────────────────────────────────────────────────────────────────────
 * The state of a subscription
 * ──────────────────────────────────────────────────────────────────────── */

export interface SubscriptionLike {
    status?: string;
    currentPeriodEnd?: string;
    trialEndsAt?: string;
    graceEndsAt?: string;
}

/**
 * The status a subscription is **effectively** in right now.
 *
 * The stored status is what was decided; the effective status is what is
 * true given the clock. A trial whose trial period ended is expired, even
 * though nobody has gone round and set it to expired.
 */
export function computeEffectiveStatus(
    subscription: SubscriptionLike | null | undefined,
    now: Date = new Date()
): SubscriptionStatus {
    if (!subscription) return "expired";

    const status = (subscription.status ?? "trial") as SubscriptionStatus;

    // These are decided by a person and do not lapse on their own.
    if (status === "suspended" || status === "cancelled" || status === "expired") {
        return status;
    }

    const nowMs = now.getTime();
    const periodEnd = subscription.currentPeriodEnd ?? subscription.trialEndsAt;
    const periodEndMs = periodEnd ? new Date(periodEnd).getTime() : undefined;
    const graceEndMs = subscription.graceEndsAt
        ? new Date(subscription.graceEndsAt).getTime()
        : undefined;

    // A payment that failed keeps the business working until the grace
    // window closes.
    if (status === "past_due" || status === "grace") {
        const window = graceEndMs ?? periodEndMs;
        if (window === undefined || nowMs <= window) return "grace";
        return "expired";
    }

    if (periodEndMs !== undefined && nowMs > periodEndMs) return "expired";

    return status;
}

/** How many days are left in the paid period or the trial. */
export function daysRemaining(
    subscription: SubscriptionLike | null | undefined,
    now: Date = new Date()
): number | undefined {
    if (!subscription) return undefined;
    const end = subscription.currentPeriodEnd ?? subscription.trialEndsAt;
    if (!end) return undefined;
    const ms = new Date(end).getTime() - now.getTime();
    if (ms < 0) return 0;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
}

/**
 * A plain-language explanation of why a business cannot write.
 *
 * The owner sees this, so it says what happened and what to do about it —
 * not "Forbidden".
 */
export function explainStatus(
    status: SubscriptionStatus,
    planName?: string
): string {
    switch (status) {
        case "trial":
            return "Your free trial is running.";
        case "active":
            return "Your subscription is active.";
        case "past_due":
        case "grace":
            return "We could not take the last payment. You can keep working until the grace period ends.";
        case "suspended":
            return "This subscription is suspended. Contact SMARTBUZ to have it restored.";
        case "expired":
            return "Your subscription has expired. Your data is safe — renew to carry on.";
        case "cancelled":
            return "This subscription was cancelled. Your data is safe — start a new subscription to carry on.";
        default:
            return `Your subscription (${planName ?? "current plan"}) is not active.`;
    }
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading the subscription
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The subscription row of a business, if it has one.
 *
 * Deliberately free of any dependency on the tenancy layer, so that the
 * tenancy layer can use it without a circular import.
 */
export async function loadSubscriptionRow(
    ctx: any,
    businessId: string
): Promise<any | null> {
    const row = await ctx.db
        .query("subscriptions")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .unique();
    return row ?? null;
}

/**
 * The status of a business, whether it has a subscription row or only the
 * summary fields on the business itself.
 *
 * A business with neither is an unlicensed tenant: it predates licensing,
 * or the platform is not enforcing, and it is not gated.
 */
export async function loadSubscriptionStatus(
    ctx: any,
    businessId: string
): Promise<{
    status: SubscriptionStatus;
    writable: boolean;
    subscription: any | null;
}> {
    const subscription = await loadSubscriptionRow(ctx, businessId);

    if (subscription) {
        const status = computeEffectiveStatus(subscription);
        return { status, writable: isWritableStatus(status), subscription };
    }

    const business = await ctx.db.get(businessId);
    const raw = business?.subscriptionStatus;
    if (!raw) {
        // No subscription on record at all: not gated.
        return { status: "active", writable: true, subscription: null };
    }

    const status = computeEffectiveStatus({
        status: raw,
        currentPeriodEnd: business?.subscriptionExpiresAt,
    });
    return { status, writable: isWritableStatus(status), subscription: null };
}

/**
 * Refuse a write when the business's subscription does not allow one.
 *
 * This is the enforcement point for a suspended, expired or cancelled
 * subscription. The business keeps its data — nothing is deleted — but it
 * cannot record anything new until the subscription is put right.
 */
export async function assertSubscriptionWritable(
    ctx: any,
    businessId: string
): Promise<void> {
    const { status, writable } = await loadSubscriptionStatus(ctx, businessId);
    if (writable) return;
    throw new ConvexError(explainStatus(status));
}
