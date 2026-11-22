/**
 * SMARTBUZ — regression tests for the currency a business trades in.
 *
 * The defect: the money was written out as the literal "UGX" in a good
 * number of places, so a business trading in dollars was shown
 * "UGX 12,500" on its dashboard, on its receipts and in its exports — and
 * the mobile-money request asked the provider for "UGX" whatever the
 * business traded in, which the provider refuses.
 *
 * These tests cover the three things that could go wrong:
 *
 *   - a currency that is not read from the business but assumed;
 *   - a report that shows the business's money in the wrong currency;
 *   - a receipt that says what the money was not.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    businessCurrency,
    currencySymbol,
    formatMoney,
    DEFAULT_CURRENCY,
    SUPPORTED_CURRENCIES,
} from "../src/lib/currency";
import { getStatsForVariant } from "../src/app/(dashboard)/reports/components/ReportSummary";
import { buildThermalReceipt } from "../src/lib/escpos";
import * as sales from "../convex/sales";

import {
    FakeContext,
    FakeRow,
    makeActiveSubscription,
    makeBusiness,
    makeMembership,
    makeStock,
    makeUser,
    signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const CALLER = "users_1";
const STOCK = "stocks_1";

/** Invoke a Convex mutation or query handler directly. */
async function call(
    registered: unknown,
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<any> {
    const handler = (registered as { _handler: Function })._handler;
    return await handler(ctx, args);
}

/** The owner of the business, with a running subscription. */
function ownerContext(
    extra: Record<string, FakeRow[]> = {},
    business: Record<string, unknown> = {}
): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [
            makeBusiness({ _id: BUSINESS, ownerId: CALLER, ...business }),
        ],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role: "owner" }),
        ],
        subscriptions: [makeActiveSubscription()],
        categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        ...extra,
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * The currency comes from the business
 * ──────────────────────────────────────────────────────────────────────── */

describe("the currency comes from the business", () => {
    it("falls back to the default when the business has not chosen one", () => {
        assert.equal(businessCurrency(undefined), DEFAULT_CURRENCY);
        assert.equal(businessCurrency(null), DEFAULT_CURRENCY);
        assert.equal(businessCurrency(""), DEFAULT_CURRENCY);
        assert.equal(businessCurrency("   "), DEFAULT_CURRENCY);
    });

    it("reads the currency the business chose", () => {
        assert.equal(businessCurrency("USD"), "USD");
        assert.equal(businessCurrency("RWF"), "RWF");
    });

    it("does not care how the code was written down", () => {
        assert.equal(businessCurrency("usd"), "USD");
        assert.equal(businessCurrency("  gbp  "), "GBP");
    });

    it("shows the symbol the business has, and the code when it has none", () => {
        assert.equal(currencySymbol("USD", "$"), "$");
        assert.equal(currencySymbol("EUR", "€"), "€");
        // "UGX" has no symbol of its own, so the code stands in for it.
        assert.equal(currencySymbol("UGX", null), "UGX");
        assert.equal(currencySymbol("UGX", "  "), "UGX");
    });

    it("formats money in the business's currency", () => {
        assert.equal(formatMoney(12_500, "USD"), "USD 12,500");
        assert.equal(formatMoney(12_500.5, "USD"), "USD 12,500.5");
        assert.equal(formatMoney(12_500.4, "USD", { decimals: false }), "USD 12,500");
        assert.equal(formatMoney(12_500.6, "USD", { decimals: false }), "USD 12,501");
        assert.equal(formatMoney(null, "USD"), "USD 0");
    });

    it("offers the same currencies everywhere a business picks one", () => {
        assert.ok(SUPPORTED_CURRENCIES.includes("UGX"));
        assert.ok(SUPPORTED_CURRENCIES.includes("USD"));
        assert.ok(SUPPORTED_CURRENCIES.includes("EUR"));
        assert.ok(SUPPORTED_CURRENCIES.includes("GBP"));
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * A report shows the business's money in the business's currency
 * ──────────────────────────────────────────────────────────────────────── */

describe("a report shows the business's money in the business's currency", () => {
    const data = {
        totalRevenue: 250_000,
        totalCostOfSales: 100_000,
        totalProfit: 150_000,
        totalExpenses: 20_000,
        totalPV: 180_000,
        totalBV: 120_000,
        totalInventorySellingPrice: 400_000,
        totalInventoryCostPrice: 260_000,
        itemCount: 12,
    };

    it("shows the currency it was given", () => {
        const stats = getStatsForVariant("sales", data, "USD");
        const values = stats.map((s) => s.value).join(" | ");
        assert.match(values, /USD/);
        assert.doesNotMatch(values, /UGX/);
    });

    it("shows the cost in the same currency as the value", () => {
        const stats = getStatsForVariant("overview", data, "RWF");
        const cost = stats.find((s) => s.description.startsWith("COST:"));
        assert.ok(cost, "the overview reports the cost");
        assert.match(cost!.description, /COST: RWF/);
    });

    it("still says UGX for a business that trades in UGX", () => {
        const stats = getStatsForVariant("sales", data, "UGX");
        assert.match(stats.map((s) => s.value).join(" "), /UGX/);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * A receipt says what the money was
 * ──────────────────────────────────────────────────────────────────────── */

describe("a receipt says what the money was", () => {
    it("prints the currency of the sale", () => {
        const bytes = buildThermalReceipt({
            shopName: "Kampala Road counter",
            invoiceNumber: "INV-1",
            date: "2026-11-22T10:00:00.000Z",
            cashierName: "Jane",
            items: [{ name: "Blue Band 250g", qty: 2, price: 12_000 }],
            total: 24_000,
            paymentMode: "Cash",
            currency: "USD",
        });
        const text = Buffer.from(bytes).toString("latin1");
        assert.match(text, /AMOUNT \(USD\)/);
        assert.match(text, /USD 24,000/);
        assert.doesNotMatch(text, /UGX/);
    });

    it("falls back to the default when the sale does not say", () => {
        const bytes = buildThermalReceipt({
            shopName: "Kampala Road counter",
            invoiceNumber: "INV-1",
            date: "2026-11-22T10:00:00.000Z",
            cashierName: "Jane",
            items: [{ name: "Blue Band 250g", qty: 2, price: 12_000 }],
            total: 24_000,
            paymentMode: "Cash",
        });
        const text = Buffer.from(bytes).toString("latin1");
        assert.match(text, /AMOUNT \(UGX\)/);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The sale records the currency it was rung up in
 * ──────────────────────────────────────────────────────────────────────── */

describe("the sale records the currency it was rung up in", () => {
    it("writes the business's currency onto the sale", async () => {
        const ctx = ownerContext(
            { stocks: [makeStock({ qty: 50 })] },
            { currency: "USD" }
        );

        const created = await call(sales.create, ctx, {
            customerId: undefined,
            manualCustomerName: "Walk-in",
            shopId: undefined,
            userId: CALLER,
            total: 24_000,
            clientType: "Non-Member",
            paymentMode: "Cash",
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    price: 12_000,
                    quantity: 2,
                    pv: 7_000,
                    bv: 7_000,
                },
            ],
        });

        const sale = await ctx.db.get(created.saleId) as any;
        assert.equal(sale.currency, "USD");
    });

    it("records the standard when the business has not chosen a currency", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
        });

        const created = await call(sales.create, ctx, {
            customerId: undefined,
            manualCustomerName: "Walk-in",
            shopId: undefined,
            userId: CALLER,
            total: 24_000,
            clientType: "Non-Member",
            paymentMode: "Cash",
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    price: 12_000,
                    quantity: 2,
                    pv: 7_000,
                    bv: 7_000,
                },
            ],
        });

        const sale = await ctx.db.get(created.saleId) as any;
        assert.equal(sale.currency, DEFAULT_CURRENCY);
    });
});
