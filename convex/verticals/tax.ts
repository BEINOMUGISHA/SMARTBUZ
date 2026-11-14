/**
 * SMART_BUZ — URA VAT registry (server-authoritative)
 *
 * The frontend catalog (src/lib/business-categories.ts) carries tax settings
 * so the UI can render VAT-aware receipts immediately. The server keeps its
 * own copy of the same policy and — importantly — is the authority that
 * actually decides the rate stored on a business profile.
 *
 * Rationale: fiscal receipts must not be tamperable. If a client could post
 * `taxRate: 0` for a restaurant, the resulting receipts would under-state
 * VAT and the business would be exposed to a URA assessment. So whenever the
 * category is known, the server derives the tax configuration itself and
 * ignores whatever the client asked for.
 *
 * Reference: Uganda Revenue Authority VAT Act — standard rate 18%.
 */

export interface ServerTaxConfig {
    enabled: boolean;
    rate: number;
    inclusive: boolean;
    note: string;
}

/** URA standard VAT rate. */
export const URA_VAT_RATE = 18;

const STANDARD: ServerTaxConfig = {
    enabled: true,
    rate: URA_VAT_RATE,
    inclusive: true,
    note: "VAT inclusive @ 18% — Price shown includes VAT",
};

/** VAT zero-rated: exempt goods (primary agricultural produce). */
const ZERO_RATED: ServerTaxConfig = {
    enabled: true,
    rate: 0,
    inclusive: true,
    note: "VAT zero-rated (exempt goods) @ 0%",
};

/**
 * VAT-exempt / zero-rated verticals, each with its own URA wording so the
 * receipt shows the correct reason for the 0% rate.
 */
const EXEMPT: Record<string, ServerTaxConfig> = {
    bookshop: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "Zero-rated educational materials @ 0%",
    },
    clinic: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "VAT exempt — healthcare services (URA)",
    },
    veterinary: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "VAT exempt — veterinary services (URA)",
    },
    sacco: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "VAT exempt — financial services (URA)",
    },
    education: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "VAT exempt — education services (URA)",
    },
    church: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "VAT exempt — religious organisation (URA)",
    },
    ngo: {
        enabled: true,
        rate: 0,
        inclusive: true,
        note: "VAT exempt — exempt supplies (URA)",
    },
};

/** Verticals that pay the standard 18% rate. */
const STANDARD_CATEGORIES = new Set([
    "retail",
    "supermarket",
    "wholesale",
    "butchery",
    "baker",
    "printing",
    "stationery",
    "shoes",
    "beauty",
    "restaurant",
    "cafe",
    "hotel",
    "pharmacy",
    "barber",
    "salon",
    "fitness",
    "laundry",
    "tailor",
    "carpentry",
    "welding",
    "construction",
    "hardware",
    "cleaning",
    "photography",
    "event",
    "mobile",
    "electronics",
    "salvage",
    "fuel",
    "transport",
    "realestate",
    "security",
]);

/** Verticals whose supplies are VAT zero-rated (primary agricultural produce). */
const ZERO_RATED_CATEGORIES = new Set(["agro", "farming", "dairy"]);

/**
 * Resolve the authoritative tax configuration for a vertical.
 * Returns null when the category is not in the registry, in which case the
 * caller should fall back to whatever the client supplied.
 */
export function taxForCategory(categoryId: string | undefined | null): ServerTaxConfig | null {
    if (!categoryId) return null;
    if (EXEMPT[categoryId]) return EXEMPT[categoryId];
    if (ZERO_RATED_CATEGORIES.has(categoryId)) return ZERO_RATED;
    if (STANDARD_CATEGORIES.has(categoryId)) return STANDARD;
    return null;
}

/**
 * Decide the tax configuration to persist.
 * The server table wins whenever the category is known.
 */
export function resolveTax(
    categoryId: string | undefined | null,
    clientTax: {
        enabled?: boolean;
        rate?: number;
        inclusive?: boolean;
        note?: string;
    }
): { enabled: boolean; rate: number; inclusive: boolean; taxNote?: string } {
    const server = taxForCategory(categoryId);
    if (server) {
        return {
            enabled: server.enabled,
            rate: server.rate,
            inclusive: server.inclusive,
            taxNote: server.note,
        };
    }
    // Unknown category — fall back to the client's values, clamped so a
    // client can never declare a rate above the URA standard rate.
    const rate = Math.min(Math.max(clientTax.rate ?? 0, 0), URA_VAT_RATE);
    return {
        enabled: clientTax.enabled ?? rate > 0,
        rate,
        inclusive: clientTax.inclusive ?? true,
        taxNote: clientTax.note ?? "",
    };
}
