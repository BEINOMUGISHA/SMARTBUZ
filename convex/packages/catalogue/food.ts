/**
 * SMART_BUZ — the packages for the food and hospitality businesses.
 *
 * Food & Beverage: the businesses that serve people — a restaurant, a
 * café, a hotel or guest house.
 */

import type { IndustryPackageDescriptor } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * Café and coffee shop
 * ──────────────────────────────────────────────────────────────────────── */

const cafe: IndustryPackageDescriptor = {
    key: "cafe",
    label: "Café / coffee shop",
    summary:
        "A focused drinks menu, table management at the counter, and a running record of what is used up each day — milk, sugar, cups.",
    categoryId: "cafe",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "tables", "menu", "services", "payroll", "notifications", "imports", "production"],
    features: [
        {
            key: "menu_management",
            label: "Menu management",
            summary:
                "Keep the drinks and food menu, and mark an item sold out so it disappears from the till.",
            defaultEnabled: true,
        },
        {
            key: "table_management",
            label: "Table management",
            summary:
                "Open a tab on a table, add to it, and close it when the table is paid.",
            defaultEnabled: true,
        },
        {
            key: "consumable_usage",
            label: "Consumable usage",
            summary:
                "Track the milk, sugar and cups a day's sales consumed.",
            defaultEnabled: true,
        },
        {
            key: "kitchen_display",
            label: "Kitchen display",
            summary:
                "Fire food orders to the kitchen and track them through to served.",
            defaultEnabled: false,
        },
        {
            key: "daily_reconciliation",
            label: "Daily reconciliation",
            summary:
                "Close the day against what was sold and what was counted.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "ticketPrefix",
            label: "Ticket prefix",
            type: "string",
            default: "C",
            help: "Printed at the start of each ticket number, e.g. C014.",
        },
        {
            key: "serviceChargePercent",
            label: "Service charge",
            type: "number",
            default: 0,
        },
        {
            key: "milkPerCafeLatte",
            label: "Milk per latte (ml)",
            type: "number",
            default: 180,
            help: "How much milk one latte uses, so the day's usage can be worked out.",
        },
        {
            key: "cupsPerOrder",
            label: "Cups per order",
            type: "number",
            default: 1,
            help: "How many cups a single drink costs in crockery.",
        },
        {
            key: "closeAt",
            label: "Closing time",
            type: "string",
            default: "20:00",
            help: "When the day's reconciliation is due.",
        },
    ],
    limitations: [
        "The consumable figures are worked out from the drinks on the menu and the settings above. SMARTBUZ does not count the fridge, so a wastage or a staff drink is not captured unless somebody writes it down.",
        "There is no loyalty scheme beyond the shared points ledger, and no subscription for the commuter who comes every morning.",
        "A table order is one bill; it cannot be split between two parties without taking two separate orders.",
        "There are no waiter tips and no tip prompt on the payment screen.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Hotel and guest house
 * ──────────────────────────────────────────────────────────────────────── */

const hotel: IndustryPackageDescriptor = {
    key: "hotel",
    label: "Hotel / guest house",
    summary:
        "Runs the front desk: a room inventory, a reservation, check-in and check-out, a folio of what the guest owes, a housekeeping round and a night audit.",
    categoryId: "hotel",
    modules: ["sales", "pos", "stock", "inventory", "expenses", "banking", "reports", "customers", "rooms", "bookings", "services", "frontDesk", "quotes", "leads", "payroll", "notifications", "imports"],
    features: [
        {
            key: "room_inventory",
            label: "Room inventory",
            summary:
                "Every room, its type and its rate, and whether it is free tonight.",
            defaultEnabled: true,
        },
        {
            key: "reservations",
            label: "Reservations",
            summary:
                "Take a booking with a date, a room and a rate, and hold the room against it.",
            defaultEnabled: true,
        },
        {
            key: "folio",
            label: "Guest folio",
            summary:
                "What the guest has charged and what they still owe, added to as they spend.",
            defaultEnabled: true,
        },
        {
            key: "housekeeping",
            label: "Housekeeping",
            summary:
                "Mark a room clean, dirty or being serviced, so it is not sold twice.",
            defaultEnabled: true,
        },
        {
            key: "night_audit",
            label: "Night audit",
            summary:
                "Close the day: rooms sold, occupancy and the revenue the night produced.",
            defaultEnabled: true,
        },
    ],
    settings: [
        {
            key: "defaultRate",
            label: "Default nightly rate",
            type: "number",
            default: 0,
            help: "The rate a new room gets. Zero means each room must be given its own.",
        },
        {
            key: "checkInTime",
            label: "Check-in time",
            type: "string",
            default: "14:00",
        },
        {
            key: "checkOutTime",
            label: "Check-out time",
            type: "string",
            default: "10:00",
        },
        {
            key: "taxPercent",
            label: "Tax on the room",
            type: "number",
            default: 0,
            help: "Added to the nightly rate as a percentage.",
        },
        {
            key: "markRoomDirtyOnCheckout",
            label: "Mark a room for cleaning when it is checked out",
            type: "boolean",
            default: true,
        },
    ],
    limitations: [
        "A stay records the nights, the rate and the charges. SMARTBUZ does not take a card, book a flight or run a booking channel.",
        "The folio is a list of charges against the stay. It does not post them to a general ledger of accounts on its own.",
        "The night audit reports the night's figures; it does not close a ledger or raise the day's invoices.",
        "There is no key-card integration, no door-access log and no housekeeping task list for the staff on the floor.",
    ],
};

export const foodPackages: IndustryPackageDescriptor[] = [cafe, hotel];
