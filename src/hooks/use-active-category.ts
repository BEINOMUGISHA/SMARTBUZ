"use client";

/**
 * SMART_BUZ — Active business category hook
 *
 * Resolves the business profile currently in use, maps it to a vertical from
 * the catalog, and exposes the derived settings the shell needs:
 * navigation, terminology, VAT configuration and enabled feature flags.
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

export interface ActiveCategory {
    /** The resolved vertical. */
    category: BusinessCategory;
    /** The business profile backing it (may be null on a fresh install). */
    profile: {
        _id: string;
        businessName: string;
        businessType: string;
        categoryId?: string;
        modules?: string[];
        currency?: string;
        taxEnabled?: boolean;
        taxRate?: number;
        taxInclusive?: boolean;
        taxNote?: string;
        openingFloat?: number;
    } | null;
    /** Sidebar entries for this vertical, filtered by the user's roles. */
    navigation: NavItem[];
    /** Accent theme for this vertical. */
    accent: ReturnType<typeof accentFor>;
    /** Whether a feature is enabled for this vertical. */
    has: (feature: FeatureId) => boolean;
    /** True when the operator has not chosen a vertical yet. */
    needsSetup: boolean;
}

export function useActiveCategory(roles: string[] = []): ActiveCategory {
    const profile = useQuery(api.businessProfiles.getActive);

    const category = useMemo(() => {
        if (!profile) return resolveCategory(null);
        return resolveCategory({
            categoryId: profile.categoryId,
            businessType: profile.categoryId ?? profile.businessType,
        });
    }, [profile]);

    const navigation = useMemo(
        () => buildNavigation(category, roles.length ? roles : ["admin"]),
        [category, roles]
    );

    const accent = useMemo(() => accentFor(category), [category]);

    const has = useMemo(
        () => (feature: FeatureId) => category.features.includes(feature),
        [category]
    );

    const needsSetup = useMemo(() => {
        if (!profile) return true;
        // A profile whose vertical could not be inferred still needs choosing.
        const inferred =
            profile.categoryId ??
            inferCategoryFromBusinessType(profile.businessType) ??
            null;
        return !inferred;
    }, [profile]);

    return { category, profile: profile ?? null, navigation, accent, has, needsSetup };
}

export { BUSINESS_CATEGORIES };
