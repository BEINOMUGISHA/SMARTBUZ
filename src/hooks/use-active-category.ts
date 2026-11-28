"use client";

/**
 * SMART_BUZ — Active business hook
 *
 * Resolves the business the signed-in user is currently working in, maps it
 * to a vertical from the catalog, and exposes the derived settings the
 * shell needs: navigation, terminology, VAT configuration and enabled
 * feature flags.
 *
 * The business comes from the server (`businesses.getActive`), which derives
 * it from the caller's membership — the browser cannot ask for a business
 * it does not belong to.
 */

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
    resolveCategory,
    inferCategoryFromBusinessType,
    BUSINESS_CATEGORIES,
    type BusinessCategory,
    type FeatureId,
} from "@/lib/business-categories";
import { buildNavigation, accentFor, accentForName, type NavItem } from "@/lib/category-nav";
import { normalizeBusinessRole } from "../../convex/rbac";

export interface ActiveCategory {
    /** The resolved vertical. */
    category: BusinessCategory;
    /** The business backing it (may be null on a fresh install). */
    profile: {
        _id: string;
        name: string;
        businessType?: string;
        categoryId?: string;
        modules?: string[];
        currency?: string;
        timezone?: string;
        taxEnabled?: boolean;
        taxRate?: number;
        taxInclusive?: boolean;
        taxNote?: string;
        openingFloat?: number;
    } | null;
    /** The caller's role in this business. */
    role: string | null;
    /** Sidebar entries for this vertical, filtered by the user's roles. */
    navigation: NavItem[];
    /** Accent theme for this vertical. */
    accent: ReturnType<typeof accentFor>;
    /** Whether a feature is enabled for this vertical. */
    has: (feature: FeatureId) => boolean;
    /** True when the operator has not chosen a vertical yet. */
    needsSetup: boolean;
    /**
     * How this person wants *this* business to look.
     *
     * The trade decides what the business is; the person decides how they
     * work in it. These are their own choices, remembered for this business
     * and this trade only.
     */
    personalisation: {
        /** The screens they chose, or null when they have not chosen. */
        modules: string[] | null;
        /** The colour they chose, or null. */
        accent: string | null;
        /** The screen that opens when they arrive, or null. */
        landingModule: string | null;
        /** comfortable | compact, or null. */
        density: string | null;
        /** The language they read this business in, or null. */
        locale: string | null;
        /** Whether the trade's dashboard widgets are shown, or null. */
        showCategoryWidgets: boolean | null;
        /**
         * True when the business changed trade after they made their choice.
         *
         * Their screens were picked for the old trade, so the shell says so
         * rather than quietly showing a menu that no longer fits.
         */
        tradeChanged: boolean;
    };
}

export function useActiveCategory(role?: string | null): ActiveCategory {
    const active = useQuery(api.businesses.getActive, {});
    // The industry packages this business has switched on. Each one brings
    // its own screens, so the menu follows what the business has chosen
    // to trade in, not only what its vertical was set up as.
    const enabledPackages = useQuery(api.packages.manage.listEnabledPackages, {});
    // How this person wants *this* business to look. Their own choice, and
    // it is remembered for this business and this trade only.
    const preferences = useQuery(api.userPreferences.getMine, {});
    const profile = (active as ActiveCategory["profile"]) ?? null;
    const backendRole = (active as { role?: string } | undefined)?.role ?? null;

    // The role that counts is the one on the caller's *membership* in the
    // active business. The server's answer is authoritative; the value
    // passed in is a fallback for the moment before it arrives.
    //
    // An unknown role normalises to `auditor` — read-only — so a role the
    // catalogue does not recognise can never widen the menu.
    const effectiveRole = role
        ? normalizeBusinessRole(role)
        : backendRole
          ? normalizeBusinessRole(backendRole)
          : null;

    const category = useMemo(() => {
        if (!profile) return resolveCategory(null);
        return resolveCategory({
            categoryId: profile.categoryId,
            businessType: profile.categoryId ?? profile.businessType,
        });
    }, [profile]);

    const personalisation = useMemo(() => {
        const saved = preferences?.preferences ?? null;
        return {
            modules: saved?.modules ?? null,
            accent: saved?.accent ?? null,
            landingModule: saved?.landingModule ?? null,
            density: saved?.density ?? null,
            locale: saved?.locale ?? null,
            showCategoryWidgets: saved?.showCategoryWidgets ?? null,
            tradeChanged: preferences?.tradeChanged ?? false,
        };
    }, [preferences]);

    /**
     * The screens this person works in, in this business.
     *
     * Their own choice wins outright — it is their workspace, not the
     * business's, so a screen they switched off stays off.
     */
    const screens = useMemo(() => {
        const own = personalisation.modules;
        if (own && own.length > 0) return own;

        // Without a choice of their own, the menu is the vertical's screens,
        // the business's choice on top of them — a choice on top, not a
        // replacement: a hotel that also runs a clinic keeps the front desk —
        // and the screens the industry packages bring.
        const ids = new Set<string>(category.modules);
        for (const moduleId of profile?.modules ?? []) ids.add(moduleId);
        for (const pkg of enabledPackages ?? []) {
            for (const moduleId of pkg.modules) ids.add(moduleId);
        }
        return Array.from(ids);
    }, [
        category.modules,
        enabledPackages,
        personalisation.modules,
        profile?.modules,
    ]);

    const navigation = useMemo(
        () =>
            buildNavigation(
                effectiveRole ? [effectiveRole] : [],
                screens
            ),
        [effectiveRole, screens]
    );

    // The trade's colour, unless this person chose their own.
    const accent = useMemo(
        () => accentForName(personalisation.accent, category),
        [category, personalisation.accent]
    );

    const has = useMemo(
        () => (feature: FeatureId) => category.features.includes(feature),
        [category]
    );

    const needsSetup = useMemo(() => {
        if (!profile) return true;
        // A business whose vertical could not be inferred still needs choosing.
        const inferred =
            profile.categoryId ??
            inferCategoryFromBusinessType(profile.businessType ?? "") ??
            null;
        return !inferred;
    }, [profile]);

    return {
        category,
        profile,
        role: effectiveRole ?? null,
        navigation,
        accent,
        has,
        needsSetup,
        personalisation,
    };
}

export { BUSINESS_CATEGORIES };
