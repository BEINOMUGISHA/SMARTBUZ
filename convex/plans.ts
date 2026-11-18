import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requirePlatformPermission } from "./tenancy";
import { writeAudit } from "./audit";
import {
  ALL_ENTITLEMENTS,
  DEFAULT_PLANS,
  ENTITLEMENT_CATALOGUE,
} from "./subscriptionState";

/**
 * SMARTBUZ — the plan catalogue.
 *
 * The pricing is **data**, not code. The platform owner creates a plan,
 * edits the price, changes what it allows and retires it — and the pricing
 * page, the subscription page and the entitlement checks all read the same
 * row. Nothing about a plan's price is written into the application.
 *
 * The four plans SMARTBUZ ships with are the **seed** of this table. They
 * live in `subscriptionState.ts` so that a fresh installation has a
 * pricing page before anybody has opened the platform console; once
 * seeded, the table is the only thing that is read.
 */

/** The shape a plan is written and read in. */
function present(plan: Doc<"plans">) {
    return {
        _id: plan._id,
        key: plan.key,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceAnnual: plan.priceAnnual,
        currency: plan.currency,
        trialDays: plan.trialDays,
        gracePeriodDays: plan.gracePeriodDays,
        deviceLimit: plan.deviceLimit,
        maxUsers: plan.maxUsers,
        maxBranches: plan.maxBranches,
        maxWarehouses: plan.maxWarehouses,
        maxProducts: plan.maxProducts,
        features: plan.features,
        isActive: plan.isActive,
        sortOrder: plan.sortOrder,
        isDefault: plan.isDefault,
    };
}

/** Validate a feature key against the catalogue. */
function assertKnownFeatures(features: string[]): void {
    for (const feature of features) {
        if (!ALL_ENTITLEMENTS.includes(feature as never)) {
            throw new ConvexError(
                `"${feature}" is not a feature SMARTBUZ knows about. Known features: ${ALL_ENTITLEMENTS.join(
                    ", "
                )}.`
            );
        }
    }
}

/**
 * The plans on offer.
 *
 * Public on purpose: the pricing page has to be readable before anybody
 * has an account.
 */
export const list = query({
    args: {
        includeInactive: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const stored = await ctx.db.query("plans").collect();

        // Nothing seeded yet: fall back to the built-in definitions so the
        // pricing page is never blank.
        const plans =
            stored.length > 0
                ? stored
                : (DEFAULT_PLANS.map((plan) => ({
                      ...plan,
                      _id: `builtin:${plan.key}`,
                      createdAt: "",
                  })) as unknown as Doc<"plans">[]);

        const visible = args.includeInactive
            ? plans
            : plans.filter((p) => p.isActive);

        visible.sort((a, b) => a.sortOrder - b.sortOrder);

        return visible.map(present);
    },
});

/** One plan, by its key. */
export const getByKey = query({
    args: { key: v.string() },
    handler: async (ctx, args) => {
        const stored = await ctx.db
            .query("plans")
            .withIndex("by_key", (q) => q.eq("key", args.key))
            .unique();

        if (stored) return present(stored);

        const fallback = DEFAULT_PLANS.find((p) => p.key === args.key);
        return fallback ? { ...fallback, _id: `builtin:${fallback.key}` } : null;
    },
});

/** Every plan, including the retired ones. Platform administrators only. */
export const listAll = query({
    args: {},
    handler: async (ctx) => {
        await requirePlatformPermission(ctx, "subscriptions.plan.manage");
        const stored = await ctx.db.query("plans").collect();
        stored.sort((a, b) => a.sortOrder - b.sortOrder);
        return stored.map(present);
    },
});

/**
 * Write the built-in plans into the catalogue.
 *
 * Does nothing when the catalogue already has plans — the platform owner's
 * edited prices are never overwritten by a second call.
 */
export const seedDefaults = mutation({
    args: {},
    handler: async (ctx) => {
        const actor = await requirePlatformPermission(ctx, "subscriptions.plan.manage");

        const existing = await ctx.db.query("plans").collect();
        if (existing.length > 0) {
            return { seeded: 0, alreadySeeded: true };
        }

        const now = new Date().toISOString();
        for (const plan of DEFAULT_PLANS) {
            await ctx.db.insert("plans", {
                ...plan,
                createdAt: now,
                updatedAt: now,
            });
        }

        await writeAudit(ctx, {
            actorUserId: actor.user._id,
            actorRole: actor.role,
            action: "platform.plans.seed",
            targetType: "plan",
            metadata: { plans: DEFAULT_PLANS.map((p) => p.key) },
        });

        return { seeded: DEFAULT_PLANS.length, alreadySeeded: false };
    },
});

/**
 * Create a plan.
 *
 * The key is the stable name a subscription refers to, so it cannot be
 * changed later without stranding the subscriptions on it.
 */
export const create = mutation({
    args: {
        key: v.string(),
        name: v.string(),
        description: v.optional(v.string()),
        priceMonthly: v.number(),
        priceAnnual: v.number(),
        currency: v.optional(v.string()),
        trialDays: v.optional(v.number()),
        gracePeriodDays: v.optional(v.number()),
        deviceLimit: v.optional(v.number()),
        maxUsers: v.optional(v.number()),
        maxBranches: v.optional(v.number()),
        maxWarehouses: v.optional(v.number()),
        maxProducts: v.optional(v.number()),
        features: v.optional(v.array(v.string())),
        sortOrder: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const actor = await requirePlatformPermission(ctx, "subscriptions.plan.manage");

        const key = args.key.trim().toLowerCase();
        if (!/^[a-z0-9-]{2,32}$/.test(key)) {
            throw new ConvexError(
                "A plan key is 2 to 32 characters of letters, numbers and dashes."
            );
        }
        if (!args.name.trim()) {
            throw new ConvexError("A plan needs a name.");
        }
        if (args.priceMonthly < 0 || args.priceAnnual < 0) {
            throw new ConvexError("A price cannot be negative.");
        }

        const existing = await ctx.db
            .query("plans")
            .withIndex("by_key", (q) => q.eq("key", key))
            .unique();
        if (existing) {
            throw new ConvexError(`A plan with the key "${key}" already exists.`);
        }

        const features = args.features ?? ["core.sales", "core.stock", "core.customers"];
        assertKnownFeatures(features);

        const now = new Date().toISOString();
        const planId = await ctx.db.insert("plans", {
            key,
            name: args.name.trim(),
            description: args.description,
            priceMonthly: args.priceMonthly,
            priceAnnual: args.priceAnnual,
            currency: args.currency ?? "UGX",
            trialDays: args.trialDays ?? 14,
            gracePeriodDays: args.gracePeriodDays ?? 7,
            deviceLimit: args.deviceLimit ?? 1,
            maxUsers: args.maxUsers ?? 3,
            maxBranches: args.maxBranches ?? 1,
            maxWarehouses: args.maxWarehouses ?? 1,
            maxProducts: args.maxProducts ?? 100,
            features,
            isActive: true,
            sortOrder: args.sortOrder ?? 99,
            createdAt: now,
            updatedAt: now,
        });

        await writeAudit(ctx, {
            actorUserId: actor.user._id,
            actorRole: actor.role,
            action: "platform.plan.create",
            targetType: "plan",
            targetId: planId,
            metadata: {
                key,
                name: args.name.trim(),
                priceMonthly: args.priceMonthly,
                priceAnnual: args.priceAnnual,
            },
        });

        return planId;
    },
});

/**
 * Edit a plan — its price, its limits, what it allows, or whether it is on
 * offer.
 *
 * Changing the price of a plan does **not** change what existing
 * subscribers pay: their subscription records the amount that was paid and
 * the period it was paid for. A price change applies to the next period.
 */
export const update = mutation({
    args: {
        planId: v.id("plans"),
        name: v.optional(v.string()),
        description: v.optional(v.string()),
        priceMonthly: v.optional(v.number()),
        priceAnnual: v.optional(v.number()),
        currency: v.optional(v.string()),
        trialDays: v.optional(v.number()),
        gracePeriodDays: v.optional(v.number()),
        deviceLimit: v.optional(v.number()),
        maxUsers: v.optional(v.number()),
        maxBranches: v.optional(v.number()),
        maxWarehouses: v.optional(v.number()),
        maxProducts: v.optional(v.number()),
        features: v.optional(v.array(v.string())),
        isActive: v.optional(v.boolean()),
        sortOrder: v.optional(v.number()),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const actor = await requirePlatformPermission(ctx, "subscriptions.plan.manage");

        const plan = await ctx.db.get(args.planId);
        if (!plan) throw new ConvexError("That plan does not exist.");

        if (args.priceMonthly !== undefined && args.priceMonthly < 0) {
            throw new ConvexError("A price cannot be negative.");
        }
        if (args.priceAnnual !== undefined && args.priceAnnual < 0) {
            throw new ConvexError("A price cannot be negative.");
        }
        if (args.features) assertKnownFeatures(args.features);

        const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
        if (args.name !== undefined) patch.name = args.name.trim();
        if (args.description !== undefined) patch.description = args.description;
        if (args.priceMonthly !== undefined) patch.priceMonthly = args.priceMonthly;
        if (args.priceAnnual !== undefined) patch.priceAnnual = args.priceAnnual;
        if (args.currency !== undefined) patch.currency = args.currency;
        if (args.trialDays !== undefined) patch.trialDays = args.trialDays;
        if (args.gracePeriodDays !== undefined) {
            patch.gracePeriodDays = args.gracePeriodDays;
        }
        if (args.deviceLimit !== undefined) patch.deviceLimit = args.deviceLimit;
        if (args.maxUsers !== undefined) patch.maxUsers = args.maxUsers;
        if (args.maxBranches !== undefined) patch.maxBranches = args.maxBranches;
        if (args.maxWarehouses !== undefined) patch.maxWarehouses = args.maxWarehouses;
        if (args.maxProducts !== undefined) patch.maxProducts = args.maxProducts;
        if (args.features !== undefined) patch.features = args.features;
        if (args.isActive !== undefined) patch.isActive = args.isActive;
        if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;

        await ctx.db.patch(plan._id, patch);

        await writeAudit(ctx, {
            actorUserId: actor.user._id,
            actorRole: actor.role,
            action: "platform.plan.update",
            targetType: "plan",
            targetId: plan._id,
            metadata: {
                key: plan.key,
                before: {
                    priceMonthly: plan.priceMonthly,
                    priceAnnual: plan.priceAnnual,
                    features: plan.features,
                    isActive: plan.isActive,
                },
                after: patch,
                reason: args.reason,
            },
        });

        return true;
    },
});

/**
 * Take a plan off offer.
 *
 * The plan is never deleted: businesses are still subscribed to it, and
 * their history has to stay readable.
 */
export const retire = mutation({
    args: {
        planId: v.id("plans"),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const actor = await requirePlatformPermission(ctx, "subscriptions.plan.manage");

        const plan = await ctx.db.get(args.planId);
        if (!plan) throw new ConvexError("That plan does not exist.");

        const subscribers = await ctx.db
            .query("subscriptions")
            .withIndex("by_planKey", (q) => q.eq("planKey", plan.key))
            .collect();

        await ctx.db.patch(plan._id, {
            isActive: false,
            updatedAt: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            actorUserId: actor.user._id,
            actorRole: actor.role,
            action: "platform.plan.retire",
            targetType: "plan",
            targetId: plan._id,
            metadata: {
                key: plan.key,
                subscribers: subscribers.length,
                reason: args.reason,
            },
        });

        return { subscribers: subscribers.length };
    },
});

/**
 * The features that can be put on a plan.
 *
 * The platform console uses this to build the list of boxes to tick.
 */
export const listEntitlements = query({
    args: {},
    handler: async () => {
        return ALL_ENTITLEMENTS.map((key) => ({
            key,
            label: ENTITLEMENT_CATALOGUE[key].label,
            group: ENTITLEMENT_CATALOGUE[key].group,
            description: ENTITLEMENT_CATALOGUE[key].description,
        }));
    },
});
