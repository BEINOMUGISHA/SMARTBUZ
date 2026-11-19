/**
 * SMARTBUZ — the industry package catalogue.
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

export type PackageConfigType =
    | "string"
    | "number"
    | "boolean"
    | "enum";

/** One feature inside a package. */
export interface IndustryFeature {
    key: string;
    label: string;
    summary: string;
    /** Whether it is on when the package is first enabled. */
    defaultEnabled: boolean;
}

/** One setting a package understands. */
export interface IndustrySetting {
    key: string;
    label: string;
    type: PackageConfigType;
    default?: string | number | boolean;
    help?: string;
    options?: { value: string; label: string }[];
}

/** One industry package. */
export interface IndustryPackageDescriptor {
    /** The stable machine name, e.g. `supermarket`. */
    key: string;
    label: string;
    summary: string;
    /** The vertical catalogue id this package lines up with. */
    categoryId: string;
    /** What the package does for the business. */
    features: IndustryFeature[];
    /** The settings the package understands. */
    settings: IndustrySetting[];
    /** What the package does not do today. */
    limitations: string[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Supermarket
 * ──────────────────────────────────────────────────────────────────────── */

const supermarket: IndustryPackageDescriptor = {
    key: "supermarket",
    label: "Supermarket",
    summary:
        "Sells by weight and in packs: unit sizes and pack sizes on every product, barcodes for the till, and weight-based pricing for the counter.",
    categoryId: "supermarket",
    features: [
        {
            key: "bulk_sales",
            label: "Bulk sales",
            summary:
                "Sell by the pack, the crate or the kilo, with the pack size recorded against the product.",
            defaultEnabled: true,
        },
        {
            key: "barcode_scanning",
            label: "Barcode scanning",
            summary:
                "Find a product at the till by scanning its barcode instead of typing its name.",
            defaultEnabled: true,
        },
        {
            key: "weighing_scales",
            label: "Weighing scales",
            summary:
                "Take a weight from a scale and price the item by the kilo.",
            defaultEnabled: true,
        },
        {
            key: "promotions",
            label: "Promotions",
            summary:
                "Run multi-buy and threshold promotions, and award the prize at the till.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultUnit",
            label: "Default unit",
            type: "enum",
            default: "pcs",
            options: [
                { value: "pcs", label: "Pieces" },
                { value: "pack", label: "Packs" },
                { value: "box", label: "Boxes" },
                { value: "crate", label: "Crates" },
                { value: "kg", label: "Kilograms" },
                { value: "litre", label: "Litres" },
            ],
            help: "The unit a new product gets when it is created.",
        },
        {
            key: "allowFractionalQuantity",
            label: "Allow fractional quantities",
            type: "boolean",
            default: false,
            help:
                "On for anything sold by weight or volume, off for tablets and bottles.",
        },
        {
            key: "priceIncludesTax",
            label: "Shelf prices include tax",
            type: "boolean",
            default: true,
        },
        {
            key: "requireBarcode",
            label: "Require a barcode on new products",
            type: "boolean",
            default: false,
            help:
                "Turn this on and a product without a barcode cannot be created, which suits a shop that scans everything.",
        },
    ],
    limitations: [
        "Scanning finds a product by its barcode; SMARTBUZ does not generate barcodes or print shelf labels.",
        "A weighed item is priced per unit of weight, and the weight comes from the operator or the scale — the scale's own calibration is the shop's responsibility.",
        "Promotions are threshold and multi-buy rules on products and totals; there is no coupon code, no loyalty scheme and no time-of-day pricing.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Restaurant
 * ──────────────────────────────────────────────────────────────────────── */

const restaurant: IndustryPackageDescriptor = {
    key: "restaurant",
    label: "Restaurant",
    summary:
        "Runs the floor and the kitchen: tables and orders, a menu, and a kitchen display that shows what is being cooked.",
    categoryId: "restaurant",
    features: [
        {
            key: "table_management",
            label: "Table management",
            summary:
                "Open a tab on a table, add to it, and close it when the table is paid.",
            defaultEnabled: true,
        },
        {
            key: "menu_management",
            label: "Menu management",
            summary:
                "Keep the menu, mark an item sold out, and hide it from the till until it is back.",
            defaultEnabled: true,
        },
        {
            key: "kitchen_display",
            label: "Kitchen display",
            summary:
                "Fire an order to the kitchen and track it through preparing, ready and served.",
            defaultEnabled: true,
        },
        {
            key: "order_tracking",
            label: "Order tracking",
            summary:
                "Follow every order from the moment it is fired to the moment it is served.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "ticketPrefix",
            label: "Kitchen ticket prefix",
            type: "string",
            default: "T",
            help: "Printed at the start of each ticket number, e.g. T014.",
        },
        {
            key: "autoFireOnClose",
            label: "Fire to the kitchen when the order is paid",
            type: "boolean",
            default: false,
            help:
                "On, the kitchen sees every order the moment it is closed. Off, a waiter fires it.",
        },
        {
            key: "serviceChargePercent",
            label: "Service charge",
            type: "number",
            default: 0,
            help: "Added to the bill as a percentage. Zero means none.",
        },
    ],
    limitations: [
        "A kitchen ticket tracks preparation state; it does not manage splits, split bills, or the order of dishes within a ticket.",
        "There are no waiter tips and no tip prompts on the payment screen.",
        "A table order is one bill: the table cannot be split between two parties without taking two separate orders.",
        "The kitchen display is a screen that refreshes; it is not a dedicated terminal with its own login.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Pharmacy
 * ──────────────────────────────────────────────────────────────────────── */

const pharmacy: IndustryPackageDescriptor = {
    key: "pharmacy",
    label: "Pharmacy",
    summary:
        "Dispenses medicine safely: batches with expiry dates, prescriptions with a named prescriber, and stock taken out in expiry order.",
    categoryId: "pharmacy",
    features: [
        {
            key: "batch_tracking",
            label: "Batch tracking",
            summary:
                "Know which batch of which product is on the shelf and how much of it is left.",
            defaultEnabled: true,
        },
        {
            key: "expiry_dates",
            label: "Expiry dates",
            summary:
                "See what is about to expire, and take the oldest stock first.",
            defaultEnabled: true,
        },
        {
            key: "prescriptions",
            label: "Prescription workflow",
            summary:
                "Record the prescriber, dispense against batches, and keep the record.",
            defaultEnabled: true,
        },
        {
            key: "expiry_alerts",
            label: "Expiry alerts",
            summary:
                "A running list of stock that is close to expiring, soonest first.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "expiryWarningDays",
            label: "Warn this many days before expiry",
            type: "number",
            default: 90,
            help: "Stock within this window is listed as expiring soon.",
        },
        {
            key: "requirePrescriberNumber",
            label: "Require the prescriber's number",
            type: "boolean",
            default: false,
        },
        {
            key: "controlledDrugsEnabled",
            label: "Controlled drugs",
            type: "boolean",
            default: false,
            help:
                "Turn this on to mark prescriptions that need the controlled-drug record kept alongside them.",
        },
        {
            key: "blockExpiredStock",
            label: "Refuse to sell expired stock",
            type: "boolean",
            default: true,
            help:
                "With this on, an expired batch is skipped when stock is taken out.",
        },
    ],
    limitations: [
        "Dispensing follows expiry order, but the prescription is not printed on a legal form and no regulator's register is kept beyond the prescription record itself.",
        "There is no interaction checking and no dosing validation — SMARTBUZ does not know what one medicine does to another.",
        "A prescription records what was dispensed and from which batch; it does not handle returns or a patient collecting part of an order later.",
        "The controlled-drug flag records that a prescription needs a controlled record kept; it does not keep a separate register for it.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Wholesaler
 * ──────────────────────────────────────────────────────────────────────── */

const wholesaler: IndustryPackageDescriptor = {
    key: "wholesaler",
    label: "Wholesaler",
    summary:
        "Sells in volume: tiered prices that drop as the quantity grows, a price of your own for a customer, and credit accounts with a limit.",
    categoryId: "wholesale",
    features: [
        {
            key: "bulk_pricing",
            label: "Bulk pricing",
            summary:
                "A price that applies from a certain quantity, so buying more costs less each.",
            defaultEnabled: true,
        },
        {
            key: "customer_pricing",
            label: "Customer-specific pricing",
            summary:
                "A price of your own for a customer, which wins over the volume tiers.",
            defaultEnabled: true,
        },
        {
            key: "credit_accounts",
            label: "Credit accounts",
            summary:
                "Sell on credit against a limit, and see what each account owes.",
            defaultEnabled: true,
        },
        {
            key: "distribution",
            label: "Distribution",
            summary:
                "Send goods out to a shop or a customer and track the delivery.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultCreditDays",
            label: "Default credit term (days)",
            type: "number",
            default: 30,
            help: "How long a credit account is given to pay by default.",
        },
        {
            key: "tierFallback",
            label: "When no tier applies",
            type: "enum",
            default: "list",
            options: [
                { value: "list", label: "Charge the list price" },
                { value: "block", label: "Refuse the sale" },
            ],
            help:
                "What to do when a sale's quantity falls below every tier.",
        },
        {
            key: "allowCustomerPriceOverride",
            label: "Allow a price override at the till",
            type: "boolean",
            default: false,
            help:
                "On, a supervisor may change a price at the counter. Off, only the price lists apply.",
        },
    ],
    limitations: [
        "A volume tier applies to the quantity on the whole sale, not to a quantity per line — a single line that reaches a tier does not by itself trigger it.",
        "Credit accounts use the existing credit limit and loan records; there is no interest, no penalty rate and no dunning schedule beyond the reminder messages.",
        "A delivery record carries the customer and the status; it does not yet carry the individual lines, so a delivery cannot be checked off against a picking list.",
        "Prices are held in the currency of the business; there is no per-customer currency and no live exchange rate.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * The catalogue
 * ──────────────────────────────────────────────────────────────────────── */

/** Every industry package. */
export const INDUSTRY_PACKAGES: IndustryPackageDescriptor[] = [
    supermarket,
    restaurant,
    pharmacy,
    wholesaler,
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
