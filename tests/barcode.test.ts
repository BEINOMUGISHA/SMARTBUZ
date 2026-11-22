/**
 * SMARTBUZ — regression tests for the barcode on a product.
 *
 * The defect: the platform advertised barcode scanning as a working
 * feature and shipped a server-side lookup for it, but nothing ever
 * called it. There was no way to record a barcode on a product, and a
 * scan at the till found nothing — so the cashier typed the product name
 * by hand, every time, on every sale.
 *
 * These tests cover the three things that could go wrong:
 *
 *   - a barcode that is stored in one form and read in another, so a
 *     scan never matches;
 *   - two products sharing one barcode, so a scan is a guess;
 *   - a scan that finds a product the counter does not hold.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { normaliseBarcode, isUsableBarcode } from "../convex/barcode";
import * as stocks from "../convex/stocks";
import * as supermarket from "../convex/packages/supermarket";

import {
    FakeContext,
    FakeRow,
    makeActiveSubscription,
    makeBusiness,
    makeCategory,
    makeMembership,
    makeShop,
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

/** The error a failed call produced, whole. */
async function errorOf(fn: () => Promise<unknown>): Promise<any> {
    try {
        await fn();
    } catch (err) {
        return err;
    }
    return null;
}

/** The owner of the business, with a running subscription. */
function ownerContext(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role: "owner" }),
        ],
        subscriptions: [makeActiveSubscription()],
        categories: [makeCategory()],
        ...extra,
    });
}

/** The product a stock row describes. */
function productArgs(overrides: Record<string, unknown> = {}) {
    return {
        name: "Blue Band 250g",
        productCode: "BB250",
        price: 12_000,
        purchasePrice: 10_000,
        qty: 50,
        pv: 7_000,
        bv: 7_000,
        categoryId: "categories_1",
        ...overrides,
    };
}

/* ────────────────────────────────────────────────────────────────────────
 * A barcode is stored in one form
 * ──────────────────────────────────────────────────────────────────────── */

describe("a barcode is stored in one form", () => {
    it("folds the case up", () => {
        assert.equal(normaliseBarcode("abc123"), "ABC123");
        assert.equal(normaliseBarcode("ABC123"), "ABC123");
    });

    it("takes the spaces out", () => {
        assert.equal(normaliseBarcode("abc 123"), "ABC123");
        assert.equal(normaliseBarcode("  abc 123  "), "ABC123");
    });

    it("keeps the dash, because a dash is part of the code", () => {
        assert.equal(normaliseBarcode("abc-123"), "ABC-123");
    });

    it("refuses a barcode that is too short to be one", () => {
        assert.equal(isUsableBarcode("AB"), false);
        assert.equal(isUsableBarcode(""), false);
        assert.equal(isUsableBarcode(undefined), false);
        assert.equal(isUsableBarcode("ABC"), true);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The product carries the barcode
 * ──────────────────────────────────────────────────────────────────────── */

describe("the product carries the barcode", () => {
    it("stores it in the form it is read back in", async () => {
        const ctx = ownerContext();

        const id = await call(stocks.add, ctx, productArgs({ barcode: "abc-123" }));

        const row = await ctx.db.get(id) as any;
        assert.equal(row.barcode, "ABC-123");
    });

    it("stores a barcode typed with spaces in the same form", async () => {
        const ctx = ownerContext();

        const id = await call(stocks.add, ctx, productArgs({ barcode: "abc 123" }));

        const row = await ctx.db.get(id) as any;
        assert.equal(row.barcode, "ABC123");
    });

    it("refuses a barcode that is too short", async () => {
        const ctx = ownerContext();

        const error = await errorOf(() =>
            call(stocks.add, ctx, productArgs({ barcode: "AB" }))
        );

        assert.ok(error, "the product is refused");
        assert.match(error.message, /at least three characters/);
    });

    it("lets a product have no barcode at all", async () => {
        const ctx = ownerContext();

        const id = await call(stocks.add, ctx, productArgs());

        const row = await ctx.db.get(id) as any;
        assert.equal(row.barcode, undefined);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * One barcode, one product
 * ──────────────────────────────────────────────────────────────────────── */

describe("one barcode, one product", () => {
    it("refuses a second product taking the same barcode", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123" })],
        });

        const error = await errorOf(() =>
            call(stocks.add, ctx, productArgs({ productCode: "BB999", barcode: "ABC-123" }))
        );

        assert.ok(error, "the product is refused");
        assert.match(error.message, /already on/);
    });

    it("refuses it even when the second one is typed differently", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC123" })],
        });

        const error = await errorOf(() =>
            call(stocks.add, ctx, productArgs({ productCode: "BB999", barcode: "abc 123" }))
        );

        assert.ok(error, "the product is refused");
        assert.match(error.message, /already on/);
    });

    it("lets the same product keep its own barcode", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123" })],
        });

        // Saving the product again, with the barcode it already has, is
        // not a clash with itself.
        await call(stocks.update, ctx, {
            id: STOCK,
            name: "Blue Band 250g (new label)",
            barcode: "ABC-123",
        });

        const row = await ctx.db.get(STOCK) as any;
        assert.equal(row.barcode, "ABC-123");
        assert.equal(row.name, "Blue Band 250g (new label)");
    });

    it("refuses a barcode another product holds when one is edited onto it", async () => {
        const ctx = ownerContext({
            stocks: [
                makeStock({ _id: "stocks_1", barcode: undefined }),
                makeStock({ _id: "stocks_2", productCode: "BB999", barcode: "ABC-123" }),
            ],
        });

        const error = await errorOf(() =>
            call(stocks.update, ctx, { id: STOCK, barcode: "abc-123" })
        );

        assert.ok(error, "the change is refused");
        assert.match(error.message, /already on/);
    });

    it("lets a product be given no barcode at all", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123" })],
        });

        await call(stocks.update, ctx, { id: STOCK, barcode: "" });

        const row = await ctx.db.get(STOCK) as any;
        assert.equal(row.barcode, undefined);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The scan finds the product
 * ──────────────────────────────────────────────────────────────────────── */

describe("the scan finds the product", () => {
    it("finds the product whatever the case the scanner reported", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123" })],
        });

        const found = await call(supermarket.searchByBarcode, ctx, {
            barcode: "abc-123",
        });

        assert.ok(found, "the product is found");
        assert.equal(found.id, STOCK);
        assert.equal(found.name, "Blue Band 250g");
    });

    it("finds the product when the scanner reported spaces", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC123" })],
        });

        const found = await call(supermarket.searchByBarcode, ctx, {
            barcode: "abc 123",
        });

        assert.ok(found, "the product is found");
        assert.equal(found.id, STOCK);
    });

    it("returns nothing for a barcode that belongs to no product", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123" })],
        });

        const found = await call(supermarket.searchByBarcode, ctx, {
            barcode: "ZZZ-999",
        });

        assert.equal(found, null);
    });

    it("never returns another business's product", async () => {
        const ctx = ownerContext({
            stocks: [
                makeStock({
                    _id: "stocks_other",
                    businessId: "businesses_other",
                    barcode: "ABC-123",
                }),
            ],
        });

        const found = await call(supermarket.searchByBarcode, ctx, {
            barcode: "ABC-123",
        });

        assert.equal(found, null, "the barcode belongs to another business");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The scan is looked up on the counter
 * ──────────────────────────────────────────────────────────────────────── */

describe("the scan is looked up on the counter", () => {
    it("finds the product on this counter", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123", qty: 50 })],
            shops: [
                makeShop({
                    issuedStocks: [{ stockId: STOCK, qty: 8 }],
                }),
            ],
        });

        const result = await call(stocks.getShopStock, ctx, { barcode: "abc-123" });

        assert.equal(result.stocks.length, 1);
        assert.equal(result.stocks[0].name, "Blue Band 250g");
        // The counter's own quantity, not the warehouse's.
        assert.equal(result.stocks[0].qty, 8);
    });

    it("does not find a product the counter does not hold", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ barcode: "ABC-123", qty: 50 })],
            shops: [makeShop({ issuedStocks: [] })],
        });

        const result = await call(stocks.getShopStock, ctx, { barcode: "ABC-123" });

        assert.equal(result.stocks.length, 0);
    });

    it("does not find a product whose barcode is on the warehouse copy only", async () => {
        // The barcode is on the product, but the counter holds a different
        // product, so the scan must not resolve to it.
        const ctx = ownerContext({
            stocks: [
                makeStock({ _id: STOCK, barcode: "ABC-123" }),
                makeStock({ _id: "stocks_2", productCode: "BB999", barcode: "XYZ-999" }),
            ],
            shops: [
                makeShop({ issuedStocks: [{ stockId: "stocks_2", qty: 4 }] }),
            ],
        });

        const result = await call(stocks.getShopStock, ctx, { barcode: "XYZ-999" });

        assert.equal(result.stocks.length, 1);
        assert.equal(result.stocks[0].stockId, "stocks_2");
        assert.equal(result.stocks[0].qty, 4);
    });
});
