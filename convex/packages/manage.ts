/**
 * SMARTBUZ — enabling and configuring industry packages.
 *
 * A business turns a package on, chooses which of its features it wants,
 * and sets its settings. Everything else in SMARTBUZ asks this module
 * whether a package is on before it does anything.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule
 * ────────────────────────────────────────────────────────────────────────
 *
 * **Turning a package off never deletes anything.**
 *
 * It stops the business using the package. The kitchen tickets stay
 * where they are, the prescriptions stay on file, the price lists stay
 * as they were. A business that turns the restaurant package off in the
 * middle of service still has its evening's orders.
 *
 * Settings are validated against the package's own declaration, so a
 * value that the package does not understand is refused rather than
 * stored.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import {
    allPackages,
    defaultFeatures,
    defaultSettings,
    findPackage,
    isValidSetting,
} from "./registry";

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every package, with what this business has turned on.
 */
export const listPackages = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "integrations.view");

        const rows = await ctx.db
            .query("industryPackages")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const byKey = new Map(rows.map((row) => [row.packageKey, row]));

        return allPackages().map((descriptor) => {
            const row = byKey.get(descriptor.key);
            const enabled = row?.enabled ?? false;

            return {
                key: descriptor.key,
                label: descriptor.label,
                summary: descriptor.summary,
                categoryId: descriptor.categoryId,
                enabled,
                features: descriptor.features.map((feature) => ({
                    ...feature,
                    enabled: enabled
                        ? (row?.features ?? defaultFeatures(descriptor)).includes(
                              feature.key
                          )
                        : false,
                })),
                settings: descriptor.settings.map((setting) => ({
                    key: setting.key,
                    label: setting.label,
                    type: setting.type,
                    help: setting.help,
                    options: setting.options,
                    default: setting.default,
                    value:
                        row?.settings?.[setting.key] ??
                        setting.default ??
                        defaultSettings(descriptor)[setting.key],
                })),
                limitations: descriptor.limitations,
            };
        });
    },
});

/**
 * Is this package on for this business?
 *
 * A plain function so that any other module can ask the question without
 * going through the interface.
 */
export async function packageEnabled(
    ctx: any,
    businessId: Id<"businesses">,
    packageKey: string
): Promise<boolean> {
    const row = await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId_packageKey", (q: any) =>
            q.eq("businessId", businessId).eq("packageKey", packageKey)
        )
        .unique();

    return row?.enabled === true;
}

/**
 * Is this one feature of a package on?
 *
 * A package that is off has no features on, whatever is stored.
 */
export async function packageFeatureEnabled(
    ctx: any,
    businessId: Id<"businesses">,
    packageKey: string,
    featureKey: string
): Promise<boolean> {
    if (!(await packageEnabled(ctx, businessId, packageKey))) return false;

    const row = await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId_packageKey", (q: any) =>
            q.eq("businessId", businessId).eq("packageKey", packageKey)
        )
        .unique();

    const descriptor = findPackage(packageKey);
    const features = row?.features ?? (descriptor ? defaultFeatures(descriptor) : []);

    return features.includes(featureKey);
}

/**
 * One package's settings, with the defaults filled in.
 */
export async function packageSettings(
    ctx: any,
    businessId: Id<"businesses">,
    packageKey: string
): Promise<Record<string, string | number | boolean>> {
    const descriptor = findPackage(packageKey);
    if (!descriptor) return {};

    const row = await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId_packageKey", (q: any) =>
            q.eq("businessId", businessId).eq("packageKey", packageKey)
        )
        .unique();

    return { ...defaultSettings(descriptor), ...((row?.settings ?? {}) as Record<string, string | number | boolean>) };
}

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Turn a package on or off.
 *
 * The first time it is switched on, its features and settings are seeded
 * from the package's own declaration, so it behaves sensibly straight
 * away.
 */
export const enablePackage = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        packageKey: v.string(),
        enabled: v.boolean(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "industry.manage"
        );

        const descriptor = findPackage(args.packageKey);
        if (!descriptor) {
            throw new ConvexError(`There is no industry package called "${args.packageKey}".`);
        }

        const now = new Date().toISOString();

        const existing = await ctx.db
            .query("industryPackages")
            .withIndex("by_businessId_packageKey", (q) =>
                q.eq("businessId", businessId).eq("packageKey", args.packageKey)
            )
            .unique();

        if (existing) {
            // Turning a package off leaves its features and settings
            // alone, so turning it back on restores what the business
            // had.
            await ctx.db.patch(existing._id, {
                enabled: args.enabled,
                updatedBy: membership.userId,
                updatedAt: now,
            });
            return existing._id;
        }

        return await ctx.db.insert("industryPackages", {
            businessId,
            packageKey: args.packageKey,
            enabled: args.enabled,
            features: defaultFeatures(descriptor),
            settings: defaultSettings(descriptor),
            updatedBy: membership.userId,
            createdAt: now,
            updatedAt: now,
        });
    },
});

/**
 * Turn one feature of a package on or off.
 */
export const setPackageFeature = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        packageKey: v.string(),
        featureKey: v.string(),
        enabled: v.boolean(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "industry.manage"
        );

        const descriptor = findPackage(args.packageKey);
        if (!descriptor) {
            throw new ConvexError(`There is no industry package called "${args.packageKey}".`);
        }

        const feature = descriptor.features.find((f) => f.key === args.featureKey);
        if (!feature) {
            throw new ConvexError(
                `"${args.featureKey}" is not a feature of the ${descriptor.label} package.`
            );
        }

        const existing = await ctx.db
            .query("industryPackages")
            .withIndex("by_businessId_packageKey", (q) =>
                q.eq("businessId", businessId).eq("packageKey", args.packageKey)
            )
            .unique();

        if (!existing) {
            throw new ConvexError(
                `The ${descriptor.label} package is not switched on, so its features cannot be changed yet.`
            );
        }

        const features = new Set(existing.features ?? []);
        if (args.enabled) {
            features.add(args.featureKey);
        } else {
            features.delete(args.featureKey);
        }

        await ctx.db.patch(existing._id, {
            features: Array.from(features),
            updatedBy: membership.userId,
            updatedAt: new Date().toISOString(),
        });

        return null;
    },
});

/**
 * Change a package's settings.
 *
 * Every value is checked against the package's own declaration: an
 * unknown key is refused, and a value outside the declared options is
 * refused. A typo in the interface cannot quietly change how a business
 * trades.
 */
export const setPackageSettings = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        packageKey: v.string(),
        settings: v.record(v.string(), v.any()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "industry.manage"
        );

        const descriptor = findPackage(args.packageKey);
        if (!descriptor) {
            throw new ConvexError(`There is no industry package called "${args.packageKey}".`);
        }

        for (const [key, value] of Object.entries(args.settings)) {
            if (!isValidSetting(descriptor, key, value)) {
                const setting = descriptor.settings.find((s) => s.key === key);
                throw new ConvexError(
                    setting
                        ? `"${key}" does not accept that value.`
                        : `"${key}" is not a setting of the ${descriptor.label} package.`
                );
            }
        }

        const existing = await ctx.db
            .query("industryPackages")
            .withIndex("by_businessId_packageKey", (q) =>
                q.eq("businessId", businessId).eq("packageKey", args.packageKey)
            )
            .unique();

        const now = new Date().toISOString();

        if (existing) {
            await ctx.db.patch(existing._id, {
                settings: {
                    ...((existing.settings ?? {}) as Record<string, unknown>),
                    ...args.settings,
                },
                updatedBy: membership.userId,
                updatedAt: now,
            });
            return existing._id;
        }

        return await ctx.db.insert("industryPackages", {
            businessId,
            packageKey: args.packageKey,
            enabled: true,
            features: defaultFeatures(descriptor),
            settings: { ...defaultSettings(descriptor), ...args.settings },
            updatedBy: membership.userId,
            createdAt: now,
            updatedAt: now,
        });
    },
});
