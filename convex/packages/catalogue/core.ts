/**
 * SMARTBUZ — the packages that already have behaviour behind them.
 *
 * These four trades were the first to be built, so their packages live
 * here, together with the modules that do their work:
 *
 *   • `convex/packages/supermarket.ts` — selling by weight and by barcode
 *   • `convex/packages/restaurant.ts`  — the floor and the kitchen
 *   • `convex/packages/pharmacy.ts`     — dispensing against batches
 *   • `convex/packages/wholesaler.ts`   — volume tiers and credit accounts
 *
 * Every other trade's package is described in the `catalogue` folder, one
 * file per trade group.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * Supermarket
 * ──────────────────────────────────────────────────────────────────────── */

export const supermarket: IndustryPackageDescriptor = {
    key: "supermarket",
    label: "Supermarket",
    summary:
        "Sells by weight and in packs: unit sizes and pack sizes on every product, barcodes for the till, and weight-based pricing for the counter.",
    categoryId: "supermarket",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "promotions", "suppliers", "purchaseOrders", "batches", "expiry", "deliveries", "pricing", "quotes", "leads", "payroll", "notifications", "imports", "plans"],
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

export const restaurant: IndustryPackageDescriptor = {
    key: "restaurant",
    label: "Restaurant",
    summary:
        "Runs the floor and the kitchen: tables and orders, a menu, and a kitchen display that shows what is being cooked.",
    categoryId: "restaurant",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "tables", "menu", "services", "suppliers", "payroll", "notifications", "imports", "production", "batches", "expiry"],
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

export const pharmacy: IndustryPackageDescriptor = {
    key: "pharmacy",
    label: "Pharmacy",
    summary:
        "Dispenses medicine safely: batches with expiry dates, prescriptions with a named prescriber, and stock taken out in expiry order.",
    categoryId: "pharmacy",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "suppliers", "purchaseOrders", "batches", "expiry", "prescriptions", "payroll", "notifications", "imports"],
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

export const wholesaler: IndustryPackageDescriptor = {
    key: "wholesaler",
    label: "Wholesaler",
    summary:
        "Sells in volume: tiered prices that drop as the quantity grows, a price of your own for a customer, and credit accounts with a limit.",
    categoryId: "wholesale",
    modules: ["sales", "pos", "stock", "inventory", "shops", "expenses", "banking", "reports", "customers", "loans", "suppliers", "purchaseOrders", "deliveries", "receivables", "pricing", "quotes", "leads", "plans", "payroll", "notifications", "imports", "assets"],
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
