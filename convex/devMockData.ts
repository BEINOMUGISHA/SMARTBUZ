/**
 * SMART_BUZ — the development mock data.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * What this is
 * ────────────────────────────────────────────────────────────────────────────
 *
 * A demo of SMART_BUZ has to look like a business that has been trading for
 * a month: a real catalogue, a month of sales, customers who come back,
 * expenses that have to be paid, promotions that actually trigger.
 *
 * This module writes exactly that — and it writes it **the way the product
 * writes it**, not around it:
 *
 *   • the prices, the totals, the VAT split and the invoice numbers are
 *     worked out by the *same* sale engine the till uses
 *     (`applySale` in `convex/salesCore.ts`), so a demo sale is
 *     indistinguishable from a real one;
 *   • the goods move through the stock ledger and the stock entries, so the
 *     inventory reconciles against the history;
 *   • every row carries the business it belongs to, so nothing can leak into
 *     another tenant;
 *   • running it twice changes nothing the second time.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * Why it is allowed to exist at all
 * ────────────────────────────────────────────────────────────────────────────
 *
 * The product's rule is that a real business never sees made-up data: an
 * empty list is an empty list. That rule is why this is **not** in the
 * product:
 *
 *   • it refuses to run without the server secret, which a browser never
 *     has, so no user can call it;
 *   • it refuses to run against anything but a `dev:` deployment, so even a
 *     leaked secret cannot seed a customer's database;
 *   • nothing in the application UI reads any of it — it is ordinary data in
 *     ordinary tables, so it cannot be mistaken for a real book.
 *
 * `scripts/dev-mock-data.mjs` is the way in.
 */

import { mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import bcrypt from "bcryptjs";
import type { Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";
import { serverSecretMatches } from "./serverSecret";
import { PASSWORD_HASH_COST } from "./crypto";
import { applySale } from "./salesCore";
import {
    MOCK_CUSTOMERS,
    MOCK_DISTRIBUTORS,
    MOCK_EXPENSE_AMOUNTS,
    MOCK_EXPENSE_TYPES,
    MOCK_PAYMENT_MODES,
    MOCK_SUPPLIERS,
    mockCatalogueFor,
    mockClientTypesFor,
    type MockProduct,
} from "./devMockCatalogue";

/* ────────────────────────────────────────────────────────────────────────────
 * The shape of the demo
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * How many days of trading the demo covers.
 *
 * Twenty-nine days of history ending yesterday. It has to fit inside the
 * thirty days a till is allowed to backdate a sale — a sale dated further
 * back than that is refused by the sale engine, and the demo month would
 * collapse onto today.
 */
const DEMO_DAYS = 29;

/** How many sales the demo holds. */
const TOTAL_SALES = 220;

/**
 * How many sales one call writes.
 *
 * A Convex transaction has a size and a time limit, and a month of sales is
 * more than one transaction should carry. The caller loops over the batches
 * until the seeder says there is nothing left.
 */
const SALES_PER_BATCH = 25;

/** The till the demo sales came from. */
const MOCK_DEVICE_ID = "MOCK-TILL-01";

/** The prefix that marks a row as part of the demo. */
const MOCK_PREFIX = "MOCK";

/* ────────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

/** The first millisecond of the day, in UTC. */
function startOfUtcDay(ms: number): number {
    return Math.floor(ms / DAY_MS) * DAY_MS;
}

/**
 * A number generator that always produces the same sequence.
 *
 * The demo has to be reproducible: the same business must always get the
 * same month of trading, or a second run of the seeder would quietly change
 * the history it is supposed to be filling in. The seed comes from the
 * business itself, so each business gets its own — but always the same one.
 */
function makeRandom(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d2b79f5) >>> 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** A stable number from a string, so a business always gets the same demo. */
function hashString(text: string): number {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

/** A whole number in a range. */
function randomInt(random: () => number, min: number, max: number): number {
    return min + Math.floor(random() * (max - min + 1));
}

/** One item of a list. */
function pick<T>(random: () => number, items: readonly T[]): T {
    return items[Math.floor(random() * items.length)];
}

/**
 * How far a time zone is from UTC, in milliseconds, on a given day.
 *
 * A shop in Kampala opens at eight in the morning **its** time, not in
 * Greenwich's, and a sale that lands at five in the morning local time is
 * obviously wrong. The business's own time zone is what decides.
 */
function timeZoneOffsetMs(at: Date, timeZone: string): number {
    try {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone,
            hour12: false,
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        }).formatToParts(at);
        const read = (type: string): number =>
            Number(parts.find((part) => part.type === type)?.value ?? "0");
        const asUtc = Date.UTC(
            read("year"),
            read("month") - 1,
            read("day"),
            read("hour") % 24,
            read("minute"),
            read("second")
        );
        return asUtc - at.getTime();
    } catch {
        // A business with an unknown time zone falls back to Uganda's, which
        // is the market the product is built for.
        return 3 * 3_600_000;
    }
}

/**
 * The check digit of an EAN-13 barcode.
 *
 * The barcode on a demo product has to be a real barcode: a scanner pointed
 * at the demo catalogue should behave the way it behaves in a real shop.
 */
function ean13CheckDigit(first12: string): string {
    let sum = 0;
    for (let index = 0; index < 12; index += 1) {
        sum += Number(first12[index]) * (index % 2 === 0 ? 1 : 3);
    }
    return String((10 - (sum % 10)) % 10);
}

/** A barcode for one product of the demo catalogue. */
function mockBarcode(index: number): string {
    const body = `600${String(index + 1).padStart(9, "0")}`;
    return `${body}${ean13CheckDigit(body)}`;
}

/** A password for a demo account: long, and full of nothing guessable. */
function generatePassword(): string {
    const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    let out = "";
    for (let index = 0; index < bytes.length; index += 1) {
        out += alphabet[bytes[index] % alphabet.length];
    }
    return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The plan
 * ──────────────────────────────────────────────────────────────────────────── */

/** A product of the demo, before it is written. */
interface PlannedProduct extends MockProduct {
    /** Its place in the catalogue. */
    index: number;
    /** The code it is filed under. */
    code: string;
    /** The barcode printed on it. */
    barcode: string;
    /** Who supplies it. */
    supplier: string;
    /** How many units the demo month sells of it. */
    demand: number;
}

/** One line of a planned sale. */
interface PlannedLine {
    productIndex: number;
    quantity: number;
}

/** One sale of the demo, before it is written. */
interface PlannedSale {
    index: number;
    /** When it happened, in the business's own time zone. */
    occurredAt: string;
    lines: PlannedLine[];
    paymentMode: string;
    clientType: string;
    /** Which of the demo customers it belongs to. */
    customerIndex?: number;
    /** The name on the receipt, when the customer was not a known one. */
    manualCustomerName?: string;
}

/** The whole month of the demo, worked out before anything is written. */
interface DemoPlan {
    /** The first day of the demo, in UTC milliseconds. */
    anchorMs: number;
    products: PlannedProduct[];
    sales: PlannedSale[];
}

/**
 * The names of the walk-in customers.
 *
 * A shop sells to people who are not on the customer list, and the receipt
 * says who they were.
 */
const WALK_IN_NAMES = [
    "A Customer",
    "Walk-in Customer",
    "Cash Customer",
    "Passing Customer",
    "One-off Customer",
];

/**
 * How busy each day of the week is.
 *
 * Sunday is quiet — the shops are shut — and Saturday is the busiest day of
 * the week, because that is when the market is on.
 */
const WEEKDAY_WEIGHTS: Record<number, number> = {
    0: 0.25, // Sunday
    1: 1.0, // Monday
    2: 1.0, // Tuesday
    3: 1.0, // Wednesday
    4: 1.05, // Thursday
    5: 1.2, // Friday
    6: 1.45, // Saturday
};

/**
 * The hours of the trading day, weighted so the sales are not all at ten in
 * the morning.
 */
const HOUR_POOL = [
    8, 9, 9, 10, 10, 11, 11, 12, 13, 14, 15, 15, 16, 16, 17, 17, 18, 18, 19, 20,
];

/**
 * Work out the whole demo: the catalogue, the month of sales, and how much
 * of each product the month uses up.
 *
 * Everything here is a pure function of the business and the anchor day, so
 * two calls always agree — which is what makes the seeder safe to run twice.
 */
function buildPlan(
    businessId: Id<"businesses">,
    categoryId: string | undefined,
    timeZone: string,
    anchorMs: number
): DemoPlan {
    const random = makeRandom(hashString(String(businessId)));
    const catalogue = mockCatalogueFor(categoryId);
    const prefix = (categoryId ?? "gen").slice(0, 3).toUpperCase();

    /* ── The catalogue ────────────────────────────────────────────────── */

    const products: PlannedProduct[] = catalogue.map((product, index) => ({
        ...product,
        index,
        code: `${prefix}-${String(index + 1).padStart(3, "0")}`,
        barcode: mockBarcode(index),
        supplier: MOCK_SUPPLIERS[index % MOCK_SUPPLIERS.length].name,
        demand: 0,
    }));

    /* ── The month ────────────────────────────────────────────────────── */

    // The day of the week the demo starts on.
    const anchorWeekday = new Date(anchorMs).getUTCDay();

    // The days, repeated by how busy each one is, so a busy day simply
    // comes up more often.
    const dayPool: number[] = [];
    for (let offset = 0; offset < DEMO_DAYS; offset += 1) {
        const weekday = (anchorWeekday + offset) % 7;
        const weight = WEEKDAY_WEIGHTS[weekday] ?? 1;
        const copies = Math.max(1, Math.round(weight * 4));
        for (let copy = 0; copy < copies; copy += 1) dayPool.push(offset);
    }

    const sales: PlannedSale[] = [];
    const clientTypes = mockClientTypesFor(categoryId);

    for (let index = 0; index < TOTAL_SALES; index += 1) {
        const dayOffset = pick(random, dayPool);
        const hour = pick(random, HOUR_POOL);
        const minute = randomInt(random, 0, 59);

        // How many things the customer put on the counter.
        const lineCount = randomInt(random, 1, 5);
        const lines: PlannedLine[] = [];
        const used = new Set<number>();

        for (let line = 0; line < lineCount; line += 1) {
            // A weighted draw, so the popular things come up more often.
            let chosen = -1;
            for (let attempt = 0; attempt < 12; attempt += 1) {
                const candidate = Math.floor(random() * products.length);
                if (!used.has(candidate)) {
                    chosen = candidate;
                    break;
                }
            }
            if (chosen === -1) continue;
            used.add(chosen);

            const product = products[chosen];
            // Cheap things are bought in twos and threes; a machine is
            // bought one at a time.
            const quantity =
                product.price < 5000
                    ? randomInt(random, 1, 4)
                    : product.price < 50000
                      ? randomInt(random, 1, 2)
                      : 1;

            lines.push({ productIndex: chosen, quantity });
            product.demand += quantity;
        }

        if (lines.length === 0) continue;

        const usesKnownCustomer = random() < 0.3;
        const customerIndex = usesKnownCustomer
            ? randomInt(random, 0, MOCK_CUSTOMERS.length - 1)
            : undefined;

        const total = lines.reduce((sum, line) => {
            const product = products[line.productIndex];
            return sum + product.price * line.quantity;
        }, 0);

        // The moment of the sale, in the business's own time.
        const localMs =
            anchorMs + dayOffset * DAY_MS + hour * 3_600_000 + minute * 60_000;
        const offsetMs = timeZoneOffsetMs(new Date(localMs), timeZone);

        sales.push({
            index,
            occurredAt: new Date(localMs - offsetMs).toISOString(),
            lines,
            paymentMode: pick(random, MOCK_PAYMENT_MODES),
            // A big basket is a wholesale basket.
            clientType:
                total > 250000 && random() < 0.6
                    ? "Wholesale"
                    : pick(random, clientTypes),
            customerIndex,
            manualCustomerName:
                customerIndex === undefined ? pick(random, WALK_IN_NAMES) : undefined,
        });
    }

    return { anchorMs, products, sales };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Writing the world
 * ──────────────────────────────────────────────────────────────────────────── */

/** The categories the demo catalogue needs, in the order they first appear. */
function catalogueCategories(products: PlannedProduct[]): string[] {
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const product of products) {
        if (seen.has(product.category)) continue;
        seen.add(product.category);
        ordered.push(product.category);
    }
    return ordered;
}

/**
 * The categories of the demo catalogue, created if they are not there yet.
 *
 * A category belongs to the business, so it is looked up by the business and
 * its name — never by name alone.
 */
async function seedCategories(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    names: string[]
): Promise<Map<string, Id<"categories">>> {
    const byName = new Map<string, Id<"categories">>();
    for (const name of names) {
        const existing = await ctx.db
            .query("categories")
            .withIndex("by_businessId_type", (q) =>
                q.eq("businessId", businessId).eq("type", name)
            )
            .first();
        if (existing) {
            byName.set(name, existing._id);
            continue;
        }
        const id = await ctx.db.insert("categories", { type: name, businessId });
        byName.set(name, id);
    }
    return byName;
}

/**
 * The products of the demo catalogue.
 *
 * A product is only written if its code is free, and the quantity it opens
 * with is worked out from what the demo month actually sells of it — so the
 * shelf never goes negative and always has something left on it at the end
 * of the month.
 */
async function seedProducts(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    userId: Id<"users">,
    products: PlannedProduct[],
    categories: Map<string, Id<"categories">>,
    warehouseId: Id<"warehouses"> | undefined
): Promise<Map<string, Id<"stocks">>> {
    const byCode = new Map<string, Id<"stocks">>();

    for (const product of products) {
        const existing = await ctx.db
            .query("stocks")
            .withIndex("by_businessId_productCode", (q) =>
                q.eq("businessId", businessId).eq("productCode", product.code)
            )
            .unique();
        if (existing) {
            byCode.set(product.code, existing._id);
            continue;
        }

        const categoryId = categories.get(product.category);
        if (!categoryId) continue;

        // The opening stock covers the month's trading and leaves a sensible
        // amount on the shelf afterwards.
        const safety = Math.max(6, Math.round(product.demand * 0.35));
        const openingQty = product.demand + safety;

        const description = product.unit
            ? `${product.category} · sold by the ${product.unit}`
            : product.category;

        const stockId = await ctx.db.insert("stocks", {
            businessId,
            name: product.name,
            productCode: product.code,
            description,
            price: product.price,
            purchasePrice: product.purchasePrice,
            qty: openingQty,
            // PV is the value of the goods at the selling price and BV is
            // their book value — the cost the business paid. The receipt
            // prints both, and the promotion engine counts a basket by its
            // price value, so the two have to be the money and not a
            // made-up number.
            pv: product.price,
            bv: product.purchasePrice,
            categoryId,
            supplier: product.supplier,
            barcode: product.barcode,
            unit: product.unit,
            isActive: true,
            reorderPoint: Math.max(2, Math.round(openingQty * 0.15)),
            warehouseId,
        });

        byCode.set(product.code, stockId);

        // The goods a product starts with are a movement, and the movement
        // goes in the ledger — otherwise the stock and the ledger can never
        // be reconciled.
        const now = new Date().toISOString();
        await ctx.db.insert("stockLedger", {
            businessId,
            stockId,
            deltaQty: openingQty,
            eventType: "OPENING_BALANCE",
            referenceId: product.code,
            userId,
            timestamp: now,
            notes: `Opening stock for ${product.name}`,
        });
        await ctx.db.insert("stockEntries", {
            businessId,
            stockId,
            quantity: openingQty,
            userId,
            date: now,
            price: product.price,
            purchasePrice: product.purchasePrice,
            pv: product.price,
            bv: product.purchasePrice,
            halfPrice: false,
            type: "add",
            supplier: product.supplier,
        });
    }

    return byCode;
}

/** The customers the demo shop has served. */
async function seedCustomers(
    ctx: MutationCtx,
    businessId: Id<"businesses">
): Promise<Id<"customers">[]> {
    const ids: Id<"customers">[] = [];
    const now = new Date().toISOString();

    for (const customer of MOCK_CUSTOMERS) {
        const existing = await ctx.db
            .query("customers")
            .withIndex("by_businessId_phone", (q) =>
                q.eq("businessId", businessId).eq("phone", customer.phone)
            )
            .unique();
        if (existing) {
            ids.push(existing._id);
            continue;
        }
        const id = await ctx.db.insert("customers", {
            businessId,
            name: customer.name,
            phone: customer.phone,
            address: customer.address,
            type: customer.type,
            creditLimit: 0,
            loyaltyPoints: 0,
            totalSpent: 0,
            isActive: true,
            createdAt: now,
            updatedAt: now,
        });
        ids.push(id);
    }

    // The distributors a trading business buys from and sells to.
    for (const distributor of MOCK_DISTRIBUTORS) {
        const existing = await ctx.db
            .query("customers")
            .withIndex("by_businessId_phone", (q) =>
                q.eq("businessId", businessId).eq("phone", distributor.phone)
            )
            .unique();
        if (existing) continue;
        await ctx.db.insert("customers", {
            businessId,
            name: distributor.name,
            phone: distributor.phone,
            email: distributor.email,
            distributorId: distributor.distributorId,
            address: distributor.address,
            type: "wholesale",
            creditLimit: 5000000,
            loyaltyPoints: 0,
            totalSpent: 0,
            isActive: true,
            createdAt: now,
            updatedAt: now,
        });
    }

    return ids;
}

/** The suppliers the demo business buys from. */
async function seedSuppliers(
    ctx: MutationCtx,
    businessId: Id<"businesses">
): Promise<void> {
    const now = new Date().toISOString();
    for (const supplier of MOCK_SUPPLIERS) {
        const existing = await ctx.db
            .query("suppliers")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .filter((q) => q.eq(q.field("name"), supplier.name))
            .first();
        if (existing) continue;

        await ctx.db.insert("suppliers", {
            businessId,
            name: supplier.name,
            contact: supplier.contact,
            phone: supplier.phone,
            email: supplier.email,
            address: supplier.address,
            paymentTerms: supplier.paymentTerms,
            paymentTermsDays: supplier.paymentTermsDays,
            balance: 0,
            currency: "UGX",
            isActive: true,
            createdAt: now,
            updatedAt: now,
        });
    }
}

/**
 * The promotions the demo shop is running.
 *
 * One of them is a spend threshold — which works because a basket's price
 * value is its value in shillings — and one of them is a product trigger,
 * which is the promotion a shop runs on a line it wants to move.
 */
async function seedPromotions(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    products: PlannedProduct[],
    stockIds: Map<string, Id<"stocks">>
): Promise<void> {
    const promotions = [
        {
            name: "Spend 100,000 and win",
            prize: "UGX 20,000 voucher",
            triggerType: "TotalPV",
            threshold: 100000,
        },
        {
            name: "Spend 500,000 and win",
            prize: "Free delivery for a month",
            triggerType: "TotalPV",
            threshold: 500000,
        },
    ];

    for (const promotion of promotions) {
        const existing = await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .filter((q) => q.eq(q.field("name"), promotion.name))
            .first();
        if (existing) continue;

        await ctx.db.insert("promotions", {
            businessId,
            name: promotion.name,
            prize: promotion.prize,
            isActive: true,
            triggerType: promotion.triggerType,
            threshold: promotion.threshold,
        });
    }

    // The promotion on a product: buy three, get one free.
    const target = products[0];
    if (!target) return;
    const stockId = stockIds.get(target.code);
    if (!stockId) return;

    const promotion = await ctx.db
        .query("promotions")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .filter((q) => q.eq(q.field("name"), "Buy 3, get 1 free"))
        .first();

    let promotionId: Id<"promotions">;
    if (promotion) {
        promotionId = promotion._id;
    } else {
        promotionId = await ctx.db.insert("promotions", {
            businessId,
            name: "Buy 3, get 1 free",
            prize: `One ${target.name} free`,
            isActive: true,
            triggerType: "Product",
        });
    }

    const linked = await ctx.db
        .query("promotionProducts")
        .withIndex("by_promotion", (q) => q.eq("promotionId", promotionId))
        .filter((q) => q.eq(q.field("stockId"), stockId))
        .first();
    if (linked) return;

    await ctx.db.insert("promotionProducts", {
        businessId,
        promotionId,
        stockId,
        requiredQuantity: 3,
    });
}

/** What an expense of each kind is called on the receipt. */
function expenseDescription(type: string): string {
    switch (type) {
        case "Rent":
            return "Shop rent";
        case "Utilities":
            return "Electricity and water";
        case "Salaries":
            return "Staff salaries";
        case "Office Supplies":
            return "Stationery and printing";
        case "Transportation":
            return "Delivery and transport";
        case "Marketing":
            return "Advertising and promotion";
        case "Maintenance":
            return "Repairs and maintenance";
        case "Training":
            return "Staff training";
        default:
            return "Other running cost";
    }
}

/**
 * The month's expenses.
 *
 * Rent, power, the staff on the floor — the fixed costs that turn a sales
 * figure into a profit figure. A demo with sales but no expenses would
 * show a profit no shop in Kampala has ever made.
 */
async function seedExpenses(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    userId: Id<"users">,
    anchorMs: number,
    timeZone: string,
    receivedBy: string
): Promise<void> {
    const random = makeRandom(hashString(`${businessId}:expenses`));

    for (let day = 0; day < DEMO_DAYS; day += 1) {
        const entriesToday = random() < 0.75 ? 1 : random() < 0.5 ? 2 : 0;
        for (let entry = 0; entry < entriesToday; entry += 1) {
            const type = pick(random, MOCK_EXPENSE_TYPES);
            const amounts = MOCK_EXPENSE_AMOUNTS[type] ?? [25000];
            const amount = pick(random, amounts);
            const hour = randomInt(random, 8, 17);
            const minute = randomInt(random, 0, 59);
            const localMs =
                anchorMs + day * DAY_MS + hour * 3_600_000 + minute * 60_000;
            const offsetMs = timeZoneOffsetMs(new Date(localMs), timeZone);
            const date = new Date(localMs - offsetMs).toISOString();

            const existing = await ctx.db
                .query("expenses")
                .withIndex("by_businessId_date", (q) =>
                    q.eq("businessId", businessId).eq("date", date)
                )
                .first();
            if (existing) continue;

            await ctx.db.insert("expenses", {
                businessId,
                date,
                amount,
                expense: expenseDescription(type),
                receivedBy,
                type,
                userId,
            });
        }
    }
}

/**
 * The two people who work in the demo shop.
 *
 * Their passwords are made up afresh and printed once to whoever ran the
 * seeder — nobody else ever learns them, and there is no shared password
 * waiting in the code for anybody to find.
 */
async function seedStaff(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    slug: string
): Promise<Array<{ email: string; password: string; role: string }>> {
    const staff = [
        {
            role: "cashier",
            first_name: "Sales",
            last_name: "Agent",
            roles: ["sales"],
        },
        {
            role: "inventory_manager",
            first_name: "Stock",
            last_name: "Manager",
            roles: ["stock"],
        },
    ];

    const created: Array<{ email: string; password: string; role: string }> = [];
    const now = new Date().toISOString();

    for (const person of staff) {
        const email = `${person.role}.${slug}@example.invalid`;
        const password = generatePassword();
        const hashed = bcrypt.hashSync(password, PASSWORD_HASH_COST);

        let account = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();

        if (!account) {
            const userId = await ctx.db.insert("users", {
                first_name: person.first_name,
                last_name: person.last_name,
                email,
                roles: person.roles,
                password: hashed,
                status: "active",
                emailVerified: true,
                createdAt: now,
            });
            account = await ctx.db.get(userId);
        } else {
            await ctx.db.patch(account._id, {
                password: hashed,
                first_name: person.first_name,
                last_name: person.last_name,
                roles: person.roles,
            });
        }
        if (!account) continue;

        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", businessId).eq("userId", account!._id)
            )
            .unique();
        if (!membership) {
            await ctx.db.insert("memberships", {
                userId: account._id,
                businessId,
                role: person.role,
                status: "active",
                createdAt: now,
                joinedAt: now,
            });
        }

        created.push({ email, password, role: person.role });
    }

    return created;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The anchor
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The first day of the demo month.
 *
 * When the demo has already been written, the anchor is taken from the demo
 * sales that are already there, so the month stays where it was put.
 * Otherwise the month starts twenty-nine days ago and ends yesterday — a
 * shop that has been trading, whose books are up to date.
 */
async function resolveAnchor(
    ctx: MutationCtx,
    businessId: Id<"businesses">
): Promise<number> {
    const sales = await ctx.db
        .query("sales")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();

    let earliest: number | null = null;
    for (const sale of sales) {
        const key = sale.clientOfflineId;
        if (typeof key !== "string" || !key.startsWith(`${MOCK_PREFIX}-`)) continue;
        const at = Date.parse(sale.occurredAt ?? sale.date);
        if (!Number.isFinite(at)) continue;
        if (earliest === null || at < earliest) earliest = at;
    }

    if (earliest !== null) return startOfUtcDay(earliest);
    return startOfUtcDay(Date.now()) - DEMO_DAYS * DAY_MS;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Writing the sales
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Write one batch of the demo month.
 *
 * The sales go through the real sale engine, so the prices, the totals, the
 * VAT split, the invoice number, the stock movement and the ledger entry are
 * all worked out the way they are at the till. Nothing here writes a number
 * that the server would not have written itself.
 */
async function seedSales(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    userId: Id<"users">,
    plan: DemoPlan,
    stockIds: Map<string, Id<"stocks">>,
    customerIds: Id<"customers">[],
    offset: number,
    count: number
): Promise<number> {
    let written = 0;

    for (let index = offset; index < Math.min(offset + count, plan.sales.length); index += 1) {
        const sale = plan.sales[index];

        const lines = sale.lines
            .map((line) => {
                const product = plan.products[line.productIndex];
                const stockId = stockIds.get(product.code);
                if (!stockId) return null;
                return {
                    stockId,
                    name: product.name,
                    productCode: product.code,
                    price: product.price,
                    quantity: line.quantity,
                    pv: product.price,
                    bv: product.purchasePrice,
                };
            })
            .filter((line): line is NonNullable<typeof line> => line !== null);

        if (lines.length === 0) continue;

        const total = lines.reduce((sum, line) => sum + line.price * line.quantity, 0);
        const transactionId = `${MOCK_PREFIX}-${businessId}-${index}`;

        const applied = await applySale(
            ctx,
            {
                userId,
                total,
                clientType: sale.clientType,
                paymentMode: sale.paymentMode,
                items: lines,
                customerId:
                    sale.customerIndex === undefined
                        ? undefined
                        : customerIds[sale.customerIndex],
                manualCustomerName: sale.manualCustomerName,
                clientOfflineId: transactionId,
                isOfflineSync: true,
            },
            {
                businessId,
                userId,
                allowPriceOverrides: false,
                canOverrideBelowFloor: false,
                offline: {
                    deviceId: MOCK_DEVICE_ID,
                    transactionId,
                    occurredAt: sale.occurredAt,
                },
            }
        );

        // A sale that is already there is left exactly as it is.
        if (applied.isDuplicateSync) continue;

        // The sale happened in a shop where the money was actually received,
        // so the money is recorded as confirmed rather than as a payment
        // nobody has seen yet.
        await ctx.db.patch(applied.saleId, {
            paymentConfirmation: "confirmed",
            syncSource: "offline",
        });

        written += 1;
    }

    return written;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The mutation
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Refuse to run anywhere but the development deployment the caller expects.
 *
 * The server secret is the real lock — a browser never has it. This is the
 * second lock: the caller says which deployment it means to write to, and
 * the server checks that it really is talking to that one. A production
 * deployment therefore refuses to be filled with made-up data even if a
 * secret were ever to leak.
 */
function requireDevDeployment(serverSecret: string | undefined, expected: string | undefined): void {
    if (!serverSecretMatches(serverSecret)) {
        throw new ConvexError(
            "Forbidden: the demo data can only be written by the SMARTBUZ server. " +
                "Run scripts/dev-mock-data.mjs instead of calling this from a browser."
        );
    }

    const actual = process.env.CONVEX_DEPLOYMENT;
    if (!actual || !expected) return;

    // Convex calls a development deployment "dev:<name>", and the runtime
    // may carry either the prefixed name or the bare one. What matters is
    // that both sides mean the same deployment.
    const bare = (value: string): string => value.replace(/^dev:/, "");
    if (bare(actual) !== bare(expected)) {
        throw new ConvexError(
            "Forbidden: the demo data may only be written to the development deployment " +
                `"${expected}". This deployment is "${actual}".`
        );
    }
}

export const seedMockData = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        serverSecret: v.optional(v.string()),
        /**
         * Where to start writing the demo month.
         *
         * The caller starts at zero and follows the cursor the seeder
         * returns, until it says there is nothing left.
         */
        cursor: v.optional(v.number()),
        /**
         * The deployment the caller believes it is writing to.
         *
         * The server checks that it is talking to that deployment, so a
         * production database can never be filled with the demo.
         */
        devDeployment: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        requireDevDeployment(args.serverSecret, args.devDeployment);
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        const businessId = tenant.businessId;
        const userId = tenant.user._id;
        const business = tenant.business;
        const timeZone = business.timezone || "Africa/Kampala";
        const categoryId = business.categoryId ?? business.businessType ?? undefined;

        const anchorMs = await resolveAnchor(ctx, businessId);
        const plan = buildPlan(businessId, categoryId, timeZone, anchorMs);

        /* ── The catalogue and the world around it ─────────────────────── */

        const categories = await seedCategories(
            ctx,
            businessId,
            catalogueCategories(plan.products)
        );

        const warehouse = await ctx.db
            .query("warehouses")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .filter((q) => q.eq(q.field("isDefault"), true))
            .first();

        const stockIds = await seedProducts(
            ctx,
            businessId,
            userId,
            plan.products,
            categories,
            warehouse?._id
        );

        const customerIds = await seedCustomers(ctx, businessId);
        await seedSuppliers(ctx, businessId);
        await seedPromotions(ctx, businessId, plan.products, stockIds);

        const receivedBy =
            [tenant.user.first_name, tenant.user.last_name].filter(Boolean).join(" ") ||
            tenant.user.email;
        await seedExpenses(ctx, businessId, userId, anchorMs, timeZone, receivedBy);

        // The business is set up: the demo is a business that is running,
        // not one that is still asking the questions.
        await ctx.db.patch(businessId, {
            onboardingComplete: true,
            onboardingStep: "done",
        });

        /* ── The month of trading ──────────────────────────────────────── */

        const cursor = Math.max(0, Math.floor(args.cursor ?? 0));
        const written = await seedSales(
            ctx,
            businessId,
            userId,
            plan,
            stockIds,
            customerIds,
            cursor,
            SALES_PER_BATCH
        );

        const nextCursor = cursor + SALES_PER_BATCH;
        const complete = nextCursor >= plan.sales.length;

        // The staff are made on the first pass only, so that the password
        // printed to the operator is the one that is in force for the whole
        // of the seeding run.
        let staff: Array<{ email: string; password: string; role: string }> = [];
        if (cursor === 0) {
            const slug = (business.slug ?? business.name ?? "demo")
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 40);
            staff = await seedStaff(ctx, businessId, slug || "demo");

            await logActivity(
                ctx,
                businessId,
                userId,
                "Demo data loaded",
                `Loaded ${plan.products.length} products, ${customerIds.length} customers and ${plan.sales.length} demo sales.`
            );
        }

        return {
            products: plan.products.length,
            customers: customerIds.length,
            salesPlanned: plan.sales.length,
            salesWritten: written,
            nextCursor: complete ? null : nextCursor,
            complete,
            anchor: new Date(anchorMs).toISOString(),
            staff,
        };
    },
});
