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
import { buildNavigation, accentFor, type NavItem } from "@/lib/category-nav";
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
}

export function useActiveCategory(role?: string | null): ActiveCategory {
    const active = useQuery(api.businesses.getActive, {});
    // The industry packages this business has switched on. Each one brings
    // its own screens, so the menu follows what the business has chosen
    // to trade in, not only what its vertical was set up as.
    const enabledPackages = useQuery(api.packages.manage.listEnabledPackages, {});
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

    const packageModules = useMemo(() => {
        const ids = new Set<string>();

        // The business's own choice of screens, made on the settings
        // screen. It is a choice on top of the vertical, not a replacement
        // for it: a hotel that also runs a clinic keeps the front desk.
        for (const moduleId of profile?.modules ?? []) ids.add(moduleId);

        // And the screens the industry packages it has switched on bring.
        for (const pkg of enabledPackages ?? []) {
            for (const moduleId of pkg.modules) ids.add(moduleId);
        }

        return Array.from(ids);
    }, [enabledPackages, profile?.modules]);

    const navigation = useMemo(
        () =>
            buildNavigation(
                category,
                effectiveRole ? [effectiveRole] : [],
                packageModules
            ),
        [category, effectiveRole, packageModules]
    );

    const accent = useMemo(() => accentFor(category), [category]);

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
    };
}

export { BUSINESS_CATEGORIES };
