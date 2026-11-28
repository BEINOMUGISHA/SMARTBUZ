/**
 * SMART_BUZ — the industry package catalogue.
 *
 * An industry package is a bundle of features a business turns on because
 * of what it trades: a supermarket sells by weight and in packs, a
 * restaurant runs a kitchen, a pharmacy dispenses against batches, a
 * wholesaler prices by volume and sells on credit.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Packages are data, not code
 * ────────────────────────────────────────────────────────────────────────
 *
 * Each package is described here — what it does, which features it has,
 * what its settings are — and the behaviour lives in the module beside
 * it. A business switches a package on and off and chooses its settings;
 * it never has to be told which code to run.
 *
 * That is what makes the packages *configurable*: turning the kitchen
 * display off does not remove the code, it stops the business being able
 * to turn it on by accident.
 *
 * This module is **pure** — no Convex imports — so it can be tested on
 * its own and rendered in the browser without pulling the server in.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The limits are part of the description
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every package carries a `limitations` list saying what it does **not**
 * do today. It is not a disclaimer; it is the difference between a
 * business knowing what it is buying and finding out on a busy Saturday.
 */

import type {
    IndustryFeature,
    IndustryPackageDescriptor,
    IndustrySetting,
    PackageConfigType,
} from "./types";
import {
    pharmacy,
    restaurant,
    supermarket,
    wholesaler,
} from "./catalogue/core";
import { tradePackages } from "./catalogue/trade";
import { foodPackages } from "./catalogue/food";
import { healthPackages } from "./catalogue/health";
import { servicesPackages } from "./catalogue/services";
import { tradingPackages } from "./catalogue/trading";
import { financePackages } from "./catalogue/finance";
import { communityPackages } from "./catalogue/community";

export type {
    IndustryFeature,
    IndustryPackageDescriptor,
    IndustrySetting,
    PackageConfigType,
};

/* ────────────────────────────────────────────────────────────────────────
 * The catalogue
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every industry package.
 *
 * One package for every trade in the vertical catalogue, so a business
 * never has to trade in a way the product has not heard of.
 */
export const INDUSTRY_PACKAGES: IndustryPackageDescriptor[] = [
    supermarket,
    restaurant,
    pharmacy,
    wholesaler,
    ...tradePackages,
    ...foodPackages,
    ...healthPackages,
    ...servicesPackages,
    ...tradingPackages,
    ...financePackages,
    ...communityPackages,
];

const BY_KEY: Record<string, IndustryPackageDescriptor> = Object.fromEntries(
    INDUSTRY_PACKAGES.map((p) => [p.key, p])
);

/** The package with this key, or undefined. */
export function findPackage(key: string): IndustryPackageDescriptor | undefined {
    return BY_KEY[key];
}

/** Every package. */
export function allPackages(): IndustryPackageDescriptor[] {
    return INDUSTRY_PACKAGES;
}

/**
 * The package that belongs to a vertical.
 *
 * There is exactly one package per vertical, so a business that says it
 * is a hotel gets the hotel package — and the screens that go with it —
 * without having to be told which package that was.
 */
export function findPackageByCategory(
    categoryId: string
): IndustryPackageDescriptor | undefined {
    const key = categoryId.trim().toLowerCase();
    return INDUSTRY_PACKAGES.find((p) => p.categoryId === key);
}

/**
 * Is this value acceptable for this setting?
 *
 * The package's own declaration is the authority — a value outside the
 * declared options is refused rather than stored, so a typo in the
 * interface cannot quietly change how a business trades.
 */
export function isValidSetting(
    descriptor: IndustryPackageDescriptor,
    key: string,
    value: unknown
): boolean {
    const setting = descriptor.settings.find((s) => s.key === key);
    if (!setting) return false;

    if (value === undefined || value === null) return true;

    switch (setting.type) {
        case "boolean":
            return typeof value === "boolean";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "string":
            return typeof value === "string";
        case "enum":
            if (typeof value !== "string") return false;
            return (setting.options ?? []).some((o) => o.value === value);
        default:
            return false;
    }
}

/**
 * The settings a package starts with.
 *
 * Every declared setting gets its default, so a package that is switched
 * on behaves sensibly before anything is configured.
 */
export function defaultSettings(
    descriptor: IndustryPackageDescriptor
): Record<string, string | number | boolean> {
    const settings: Record<string, string | number | boolean> = {};
    for (const setting of descriptor.settings) {
        if (setting.default !== undefined) {
            settings[setting.key] = setting.default;
        }
    }
    return settings;
}

/**
 * The features a package starts with.
 */
export function defaultFeatures(
    descriptor: IndustryPackageDescriptor
): string[] {
    return descriptor.features
        .filter((feature) => feature.defaultEnabled)
        .map((feature) => feature.key);
}
