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
    findPackageByCategory,
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
                /** The screens this package adds when it is on. */
                modules: descriptor.modules,
            };
        });
    },
});

/**
 * The packages this business has switched on, and what they bring.
 *
 * This is what the sidebar reads. A business that trades in groceries can
 * switch on the hospitality package and find a front desk in its menu;
 * the screens arrive with the package, and they leave with it.
 *
 * The permission here is the lightest one a member of a business can
 * hold, because every member needs the menu — including the cashier who
 * must never see the integrations screen.
 */
export const listEnabledPackages = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "business.view");

        const rows = await ctx.db
            .query("industryPackages")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const enabled = rows.filter((row) => row.enabled === true);

        return enabled.map((row) => {
            const descriptor = findPackage(row.packageKey);
            const features =
                row.features ?? (descriptor ? defaultFeatures(descriptor) : []);

            return {
                key: row.packageKey,
                label: descriptor?.label ?? row.packageKey,
                /** The screens this package adds to the menu. */
                modules: descriptor?.modules ?? [],
                /** The features of this package that are on. */
                features,
                /** The package's settings, with the defaults filled in. */
                settings: {
                    ...(descriptor ? defaultSettings(descriptor) : {}),
                    ...((row.settings ?? {}) as Record<
                        string,
                        string | number | boolean
                    >),
                },
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

/**
 * Is this feature available to the business?
 *
 * A feature belongs to a package: layaway belongs to the retail and shoe
 * packages, term billing belongs to the education package. The business
 * has the feature when one of the packages that offers it is switched on
 * **with that feature on**.
 *
 * Two cases are deliberately forgiving:
 *
 *   - A business that has never touched the packages has every feature.
 *     Nothing has been switched off, so nothing is refused.
 *   - A package the business has never configured contributes nothing and
 *     takes nothing away. It is the package the business has actually
 *     configured that decides.
 */
export async function packageFeatureAvailable(
    ctx: any,
    businessId: Id<"businesses">,
    featureKey: string | string[]
): Promise<boolean> {
    const keys = Array.isArray(featureKey) ? featureKey : [featureKey];

    const owners = allPackages().filter((descriptor) =>
        descriptor.features.some((feature) => keys.includes(feature.key))
    );

    // Nobody claims this feature, so there is nothing to switch off.
    if (owners.length === 0) return true;

    const rows = (await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId", (q: any) =>
            q.eq("businessId", businessId)
        )
        .collect()) as Array<{
        packageKey: string;
        enabled: boolean;
        features?: string[];
    }>;

    // The business has never been here. Nothing is switched off, so
    // nothing is refused.
    if (rows.length === 0) return true;

    const byKey = new Map(rows.map((row) => [row.packageKey, row]));

    for (const descriptor of owners) {
        const row = byKey.get(descriptor.key);
        if (!row) continue;
        if (row.enabled !== true) continue;

        const features = row.features ?? defaultFeatures(descriptor);
        if (keys.some((key) => features.includes(key))) return true;
    }

    return false;
}

/**
 * The screens a business can work in, and the packages that bring them.
 *
 * A screen belongs to the packages that offer it: the batch screen belongs to
 * the supermarket, the pharmacy, the butcher and the baker. A business can
 * work in a screen when it has one of those packages switched on.
 */
export async function assertScreenAvailable(
    ctx: any,
    businessId: Id<"businesses">,
    screenIds: string | string[]
): Promise<void> {
    const screens = Array.isArray(screenIds) ? screenIds : [screenIds];

    const owners = allPackages().filter((descriptor) =>
        descriptor.modules.some((module) => screens.includes(module))
    );

    // Nobody claims the screen, so there is nothing to switch off.
    if (owners.length === 0) return;

    const rows = (await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .collect()) as Array<{
        packageKey: string;
        enabled: boolean;
        features?: string[];
    }>;

    // The business has never touched the packages. Nothing is switched off,
    // so nothing is refused.
    if (rows.length === 0) return;

    const byKey = new Map(rows.map((row) => [row.packageKey, row]));

    for (const descriptor of owners) {
        const row = byKey.get(descriptor.key);
        if (!row) continue;
        if (row.enabled !== true) continue;

        // A package that is switched on brings its screens with it.
        return;
    }

    const labels = owners.map((descriptor) => descriptor.label).join(" or ");
    const screens_label = screens.map((screen) => SCREEN_LABELS[screen] ?? screen).join(" or ");

    throw new ConvexError(
        `${screens_label} is switched off for this business. Turn on the ${labels} package in Integrations → Industry packages to use it.`
    );
}

/**
 * The names of the screens, so a refusal can say which one it is about.
 */
const SCREEN_LABELS: Record<string, string> = {
    batches: "Batches & expiry",
    expiry: "Expiry watch",
    plans: "Instalment plans",
    pricing: "Pricing",
    measurements: "Measurements",
    production: "Production",
    members: "Members",
    attendance: "Attendance",
    assets: "Assets",
    services: "Service jobs",
    appointments: "Appointments",
    bookings: "Bookings",
    classes: "Classes & students",
    fees: "Student fees",
    rooms: "Rooms",
    rentals: "Rentals & hire",
    tables: "Tables & orders",
    menu: "Menu",
    fuelPump: "Fuel pumps",
    prescriptions: "Clinical records",
    frontDesk: "Front desk",
    quotes: "Quotations",
    leads: "Pipeline",
    payroll: "Payroll",
    notifications: "Notifications",
    imports: "Bulk import",
};

/**
 * Refuse the work when the feature behind it is switched off.
 *
 * The refusal says what is off and where to turn it on, because a person
 * at the counter needs to know which switch to press, not that the
 * computer said no.
 */
export async function assertPackageFeature(
    ctx: any,
    businessId: Id<"businesses">,
    featureKey: string | string[]
): Promise<void> {
    if (await packageFeatureAvailable(ctx, businessId, featureKey)) return;

    const keys = Array.isArray(featureKey) ? featureKey : [featureKey];
    const owners = allPackages().filter((descriptor) =>
        descriptor.features.some((feature) => keys.includes(feature.key))
    );

    const label =
        owners
            .flatMap((descriptor) => descriptor.features)
            .find((feature) => keys.includes(feature.key))?.label ?? keys[0];

    const packages = owners.map((descriptor) => descriptor.label).join(" or ");

    throw new ConvexError(
        `"${label}" is switched off for this business. Turn it on in Integrations → Industry packages (${packages}).`
    );
}

/**
 * Switch on the package that belongs to a vertical.
 *
 * When a business says it is a hotel, the hotel package goes on with it —
 * its features, its settings and its screens. A business that has not
 * chosen a vertical yet has nothing switched on, because there is nothing
 * to switch on.
 *
 * Switching it on again later does not disturb anything: the features and
 * settings the business has chosen are kept.
 */
export async function enablePackageForCategory(
    ctx: any,
    businessId: Id<"businesses">,
    categoryId: string | undefined,
    userId: Id<"users">
): Promise<string | null> {
    if (!categoryId) return null;

    const descriptor = findPackageByCategory(categoryId);
    if (!descriptor) return null;

    const existing = await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId_packageKey", (q: any) =>
            q.eq("businessId", businessId).eq("packageKey", descriptor.key)
        )
        .unique();

    const now = new Date().toISOString();

    if (existing) {
        if (existing.enabled !== true) {
            await ctx.db.patch(existing._id, {
                enabled: true,
                features: existing.features ?? defaultFeatures(descriptor),
                settings: {
                    ...defaultSettings(descriptor),
                    ...((existing.settings ?? {}) as Record<
                        string,
                        string | number | boolean
                    >),
                },
                updatedBy: userId,
                updatedAt: now,
            });
        }
        return descriptor.key;
    }

    await ctx.db.insert("industryPackages", {
        businessId,
        packageKey: descriptor.key,
        enabled: true,
        features: defaultFeatures(descriptor),
        settings: defaultSettings(descriptor),
        updatedBy: userId,
        createdAt: now,
        updatedAt: now,
    });

    return descriptor.key;
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
