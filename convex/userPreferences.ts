/**
 * SMART_BUZ — how one person wants one business to look.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * The difference between a business and a person
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The business decides what it *trades in*: a pharmacy trades in medicines, a
 * hardware shop in cement and nails. That choice is shared by everybody in
 * the business and belongs to the business.
 *
 * This module is the other half: how *this person* wants to work in it.
 * Which screens they want to see, the colour of the workspace, the screen
 * that opens when they arrive, how crowded it is, the language they read it
 * in.
 *
 * It is per person *and* per business, because the two matter separately:
 *
 *   • A pharmacist who also runs a hardware shop keeps a different menu in
 *     each. The pharmacy gets prescriptions and batches; the hardware shop
 *     gets deliveries and purchase orders. One person's account, two
 *     businesses, two different workplaces — and each one is remembered.
 *   • Two cashiers in the same pharmacy may still want different screens.
 *     One wants the till full-screen; the other wants the day's takings.
 *
 * The record is stamped with the vertical it was made for. When a business
 * changes trade, that stamp is what tells the server that the screens this
 * person chose were chosen for a *different* trade — so the shell can offer
 * the new trade's screens instead of keeping a menu that no longer fits.
 */

import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { logActivity, requireTenant } from "./tenancy";
import { findPackage } from "./packages/registry";
import {
    ALLOWED_ACCENTS,
    ALLOWED_DENSITIES,
    ALLOWED_LOCALES,
} from "./defaults";

/* ────────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The screens this business offers, and the ones this person has chosen.
 *
 * The business's own screens are the vertical's, plus whatever the industry
 * packages it has switched on bring. A person may pick any of them, and
 * only those.
 */
async function allowedModulesFor(
    ctx: QueryCtx,
    businessId: Id<"businesses">,
    businessModules: string[] | undefined
): Promise<string[]> {
    const allowed = new Set<string>(businessModules ?? []);

    // The screens the business's industry packages bring.
    const enabled = await ctx.db
        .query("industryPackages")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .filter((q) => q.eq(q.field("enabled"), true))
        .collect();
    for (const pkg of enabled) {
        const descriptor = findPackage(pkg.packageKey);
        for (const screenId of descriptor?.modules ?? []) allowed.add(screenId);
    }

    return Array.from(allowed);
}

/**
 * What this person's workspace looks like in the active business.
 *
 * The answer carries both what they chose and what the defaults are, so the
 * settings screen can show the choice *and* offer to go back to it.
 */
export const getMine = query({
    args: {
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const user = tenant.user;

        const preferences = await ctx.db
            .query("userPreferences")
            .withIndex("by_userId_businessId", (q) =>
                q.eq("userId", user._id).eq("businessId", tenant.businessId)
            )
            .unique();

        const allowed = await allowedModulesFor(
            ctx,
            tenant.businessId,
            tenant.business.modules
        );

        // The vertical the business trades in right now.
        const categoryId =
            tenant.business.categoryId ?? tenant.business.businessType ?? null;

        return {
            /** What this person chose, if anything. */
            preferences: preferences
                ? {
                      categoryId: preferences.categoryId ?? null,
                      modules: preferences.modules ?? null,
                      accent: preferences.accent ?? null,
                      landingModule: preferences.landingModule ?? null,
                      density: preferences.density ?? null,
                      locale: preferences.locale ?? null,
                      showCategoryWidgets: preferences.showCategoryWidgets ?? null,
                      updatedAt: preferences.updatedAt ?? null,
                  }
                : null,
            /** The screens this business offers. */
            allowedModules: allowed.sort(),
            /** The vertical the business trades in. */
            categoryId,
            /**
             * True when the person's menu was chosen for a different trade.
             *
             * The business changed vertical after they made their choice,
             * so the screens they picked belong to the old trade and the
             * shell says so rather than quietly showing a menu that no
             * longer fits.
             */
            tradeChanged:
                preferences !== null &&
                preferences.categoryId !== undefined &&
                preferences.categoryId !== null &&
                preferences.categoryId !== categoryId,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Save how this person wants this business to look.
 *
 * Every value is checked against what the business actually offers. A person
 * cannot put a screen on their menu that this trade does not have, and
 * cannot point their workspace at a screen the shell does not know.
 */
export const update = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** The screens this person wants. Empty means "the business's own". */
        modules: v.optional(v.array(v.string())),
        accent: v.optional(v.string()),
        landingModule: v.optional(v.string()),
        density: v.optional(v.string()),
        locale: v.optional(v.string()),
        showCategoryWidgets: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const user = tenant.user;
        const now = new Date().toISOString();

        const allowed = new Set(
            await allowedModulesFor(ctx, tenant.businessId, tenant.business.modules)
        );

        // The trade this choice is stamped with. A field that may be absent is
        // never given a null — Convex would refuse the write.
        const categoryId =
            tenant.business.categoryId ?? tenant.business.businessType ?? undefined;

        const patch: Record<string, unknown> = {
            updatedAt: now,
        };
        if (categoryId !== undefined) patch.categoryId = categoryId;

        if (args.modules !== undefined) {
            const wanted = args.modules.filter((m) => allowed.has(m));
            // The dashboard is always there: a workspace with no dashboard is
            // a blank screen.
            wanted.push("dashboard");
            patch.modules = Array.from(new Set(wanted));
        }

        if (args.accent !== undefined) {
            if (!ALLOWED_ACCENTS.includes(args.accent as never)) {
                throw new ConvexError("Choose a colour the workspace knows.");
            }
            patch.accent = args.accent;
        }

        if (args.landingModule !== undefined) {
            if (args.landingModule !== "" && !allowed.has(args.landingModule)) {
                throw new ConvexError("Choose a screen this business has.");
            }
            patch.landingModule = args.landingModule || undefined;
        }

        if (args.density !== undefined) {
            if (!ALLOWED_DENSITIES.includes(args.density as never)) {
                throw new ConvexError("Choose a spacing the workspace knows.");
            }
            patch.density = args.density;
        }

        if (args.locale !== undefined) {
            if (!ALLOWED_LOCALES.includes(args.locale as never)) {
                throw new ConvexError("Choose a language the product speaks.");
            }
            patch.locale = args.locale;
        }

        if (args.showCategoryWidgets !== undefined) {
            patch.showCategoryWidgets = args.showCategoryWidgets;
        }

        const existing = await ctx.db
            .query("userPreferences")
            .withIndex("by_userId_businessId", (q) =>
                q.eq("userId", user._id).eq("businessId", tenant.businessId)
            )
            .unique();

        if (existing) {
            await ctx.db.patch(existing._id, patch);
            await logActivity(
                ctx,
                tenant.businessId,
                user._id,
                "Update Personalisation",
                `${user.first_name} changed how their workspace looks`
            );
            return existing._id;
        }

        const id = await ctx.db.insert("userPreferences", {
            userId: user._id,
            businessId: tenant.businessId,
            ...patch,
            createdAt: now,
        });

        await logActivity(
            ctx,
            tenant.businessId,
            user._id,
            "Update Personalisation",
            `${user.first_name} personalised their workspace`
        );

        return id;
    },
});

/**
 * Go back to how this business looks by default.
 *
 * The person's own choice is removed; the vertical's screens, the trade's
 * colour and the dashboard are what they get.
 */
export const reset = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const user = tenant.user;

        const existing = await ctx.db
            .query("userPreferences")
            .withIndex("by_userId_businessId", (q) =>
                q.eq("userId", user._id).eq("businessId", tenant.businessId)
            )
            .unique();

        if (!existing) return null;

        await ctx.db.delete(existing._id);

        await logActivity(
            ctx,
            tenant.businessId,
            user._id,
            "Update Personalisation",
            `${user.first_name} went back to the default workspace`
        );

        return null;
    },
});

/**
 * The personalisation a person starts with in a new business.
 *
 * Used when a business is created: the owner gets the trade's own screens
 * from the first minute, so the workspace is already theirs rather than
 * generic.
 */
export async function writeDefaultPreferences(
    ctx: MutationCtx,
    userId: Id<"users">,
    businessId: Id<"businesses">,
    categoryId: string | undefined,
    modules: string[],
    now: string
): Promise<void> {
    const existing = await ctx.db
        .query("userPreferences")
        .withIndex("by_userId_businessId", (q) =>
            q.eq("userId", userId).eq("businessId", businessId)
        )
        .unique();
    if (existing) return;

    await ctx.db.insert("userPreferences", {
        userId,
        businessId,
        categoryId: categoryId ?? undefined,
        modules,
        landingModule: "dashboard",
        createdAt: now,
        updatedAt: now,
    });
}
