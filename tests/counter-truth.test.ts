/**
 * SMARTBUZ — regression tests for the counter's copy of the product, and for
 * the price that moves while a sale is being rung up.
 *
 * Every test in here describes a way the books could disagree with the
 * shelves, and asserts that the fixed code cannot disagree that way again.
 *
 * The defects:
 *
 *   - a counter kept a copy of the product it held, frozen at the moment
 *     the goods were issued, so a price change never reached the till and
 *     the stock report valued the same goods at a different price from the
 *     inventory summary;
 *   - a price that changed between filling the basket and ringing the sale
 *     up was charged silently, so the customer was charged a figure they
 *     had not agreed to;
 *   - a sale the server had refused was put into the offline queue and
 *     retried as an offline sale, where the rules are looser.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as sales from "../convex/sales";
import * as shops from "../convex/shops";
import * as stocks from "../convex/stocks";
import * as sync from "../convex/sync";

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
const SHOP = "shops_1";

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
        categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        ...extra,
    });
}

/** A counter holding some stock. */
function makeShop(overrides: Record<string, unknown> = {}): FakeRow {
    return {
        _id: SHOP,
        _creationTime: 1,
        businessId: BUSINESS,
        name: "Kampala Road counter",
        serialNumber: "KP-01",
        location: "Kampala Road",
        contact: "",
        userId: CALLER,
        issuedStocks: [],
        ...overrides,
    };
}

/** A sale as a till sends it: two Blue Band at the price on the screen. */
function salePayload(overrides: Record<string, unknown> = {}) {
    return {
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
        ...overrides,
    };
}

/* ────────────────────────────────────────────────────────────────────────
 * The counter holds a quantity, not a copy of the product
 * ──────────────────────────────────────────────────────────────────────── */

describe("the counter holds a quantity, not a copy of the product", () => {
    it("writes only the product and the quantity when stock is issued", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            shops: [makeShop()],
        });

        await call(shops.issueStock, ctx, {
            shopId: SHOP,
            items: [{ stockId: STOCK, qty: 10 }],
        });

        const shop = await ctx.db.get(SHOP) as any;
        assert.equal(shop.issuedStocks.length, 1);
        assert.deepEqual(
            Object.keys(shop.issuedStocks[0]).sort(),
            ["qty", "stockId"],
            "the counter's row must not carry a copy of the product"
        );
        assert.equal(shop.issuedStocks[0].qty, 10);
    });

    it("takes the goods out of the warehouse when they are issued", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            shops: [makeShop()],
        });

        await call(shops.issueStock, ctx, {
            shopId: SHOP,
            items: [{ stockId: STOCK, qty: 10 }],
        });

        const stock = await ctx.db.get(STOCK) as any;
        assert.equal(stock.qty, 40, "the goods left the warehouse");
    });

    it("shows the till the catalogue's price, not the price at issue", async () => {
        // The counter was issued the goods when they cost 12,000. The
        // catalogue has since been re-priced at 13,500.
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50, price: 13_500 })],
            shops: [
                makeShop({
                    issuedStocks: [{ stockId: STOCK, qty: 10 }],
                }),
            ],
        });

        const result = await call(stocks.getShopStock, ctx, {});

        assert.equal(result.stocks.length, 1);
        assert.equal(result.stocks[0].price, 13_500, "the till shows today's price");
        assert.equal(result.stocks[0].name, "Blue Band 250g");
    });

    it("values the counter's goods at the catalogue's price, on one basis", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50, price: 13_500, purchasePrice: 10_000 })],
            shops: [
                makeShop({
                    issuedStocks: [{ stockId: STOCK, qty: 10 }],
                }),
            ],
        });

        const result = await call(shops.getPaginatedShopStock, ctx, {
            shopId: SHOP,
            limit: 50,
            offset: 0,
        });

        assert.equal(result.page.length, 1);
        assert.equal(result.page[0].price, 13_500);
        // The stock value is the goods at the catalogue's price — the same
        // basis the inventory summary uses.
        assert.equal(result.stats.totalValue, 135_000);
        // And the cost is reported beside it, not confused with it.
        assert.equal(result.stats.totalCostValue, 100_000);
        assert.equal(result.stats.totalItems, 10);
    });

    it("does not copy a price change into the counters", async () => {
        // A price change used to be pushed into every counter's row. Now it
        // does not have to be, because the counter holds no price.
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50, price: 12_000 })],
            shops: [
                makeShop({
                    issuedStocks: [{ stockId: STOCK, qty: 10 }],
                }),
            ],
        });

        await call(stocks.update, ctx, { id: STOCK, price: 14_000 });

        const shop = await ctx.db.get(SHOP) as any;
        assert.equal(shop.issuedStocks.length, 1);
        assert.deepEqual(Object.keys(shop.issuedStocks[0]).sort(), ["qty", "stockId"]);
    });

    it("keeps the goods on the counter when a refund reverses a sale", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            shops: [
                makeShop({
                    issuedStocks: [{ stockId: STOCK, qty: 10 }],
                }),
            ],
        });

        // A sale rung up at the counter: the counter's holding falls from 10
        // to 8.
        const created = await call(sales.create, ctx, salePayload());
        const afterSale = await ctx.db.get(SHOP) as any;
        assert.equal(afterSale.issuedStocks[0].qty, 8);

        // The refund path reverses the stock through the compensation route.
        const sale = await ctx.db.get(created.saleId) as any;
        const { reverseSaleLines } = await import("../convex/saleCompensation");
        await reverseSaleLines(
            ctx as any,
            {
                businessId: BUSINESS,
                userId: CALLER,
                sale: sale as any,
                lines: [{ stockId: STOCK, quantity: 2 }],
                reason: "test",
            } as any
        );

        const shop = await ctx.db.get(SHOP) as any;
        assert.equal(shop.issuedStocks.length, 1);
        assert.deepEqual(Object.keys(shop.issuedStocks[0]).sort(), ["qty", "stockId"]);
        assert.equal(shop.issuedStocks[0].qty, 10, "the goods went back on the counter");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * A price that moved while the sale was being rung up
 * ──────────────────────────────────────────────────────────────────────── */

describe("a price that moved while the sale was being rung up", () => {
    it("refuses the sale and says which price changed", async () => {
        // The till showed 12,000. The catalogue says 13,500.
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 13_500 })],
        });

        const error = await errorOf(() => call(sales.create, ctx, salePayload()));

        assert.ok(error, "the sale must be refused");
        const data = error.data;
        assert.equal(data?.code, "PRICE_CHANGED");
        assert.equal(data?.changes.length, 1);
        assert.equal(data?.changes[0].quotedPrice, 12_000);
        assert.equal(data?.changes[0].chargedPrice, 13_500);
        assert.equal(data?.changes[0].name, "Blue Band 250g");
    });

    it("records nothing when the sale is refused", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 13_500 })],
        });

        await errorOf(() => call(sales.create, ctx, salePayload()));

        assert.equal(ctx.tables.sales.length, 0, "a refused sale is not a sale");
    });

    it("goes through once the seller has confirmed the new price", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 13_500 })],
        });

        const created = await call(
            sales.create,
            ctx,
            salePayload({ total: 27_000, acceptPriceChanges: true })
        );

        const sale = await ctx.db.get(created.saleId) as any;
        assert.equal(sale.items[0].price, 13_500, "the catalogue's price is charged");
        assert.equal(sale.total, 27_000);
        assert.equal(sale.priceChanges.length, 1);
        assert.equal(sale.priceChanges[0].quotedPrice, 12_000);
        assert.equal(sale.priceChanges[0].chargedPrice, 13_500);
    });

    it("writes the difference on the sale, so the books can explain it", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 13_500 })],
        });

        const created = await call(
            sales.create,
            ctx,
            salePayload({ total: 27_000, acceptPriceChanges: true })
        );

        const sale = await ctx.db.get(created.saleId) as any;
        assert.ok(Array.isArray(sale.priceChanges));
        assert.equal(sale.priceChanges[0].quantity, 2);
        assert.equal(sale.priceChanges[0].stockId, STOCK);
    });

    it("does not refuse a sale whose price has not moved", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 12_000 })],
        });

        const created = await call(sales.create, ctx, salePayload());
        const sale = await ctx.db.get(created.saleId) as any;
        assert.equal(sale.priceChanges, undefined, "nothing changed, so nothing is recorded");
    });

    it("lets an offline sale through and records the difference", async () => {
        // The goods have gone and the customer has paid. Refusing to record
        // it now would lose a real sale, so it is recorded at the
        // catalogue's price and the difference is written down.
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 13_500 })],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: "device-1",
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: "device-1",
            transactions: [
                {
                    transactionId: "tx-1",
                    occurredAt: new Date().toISOString(),
                    attempts: 1,
                    payload: salePayload(),
                },
            ],
        });

        assert.equal(result.accepted, 1);
        const sale = ctx.tables.sales[0] as any;
        assert.equal(sale.items[0].price, 13_500);
        assert.equal(sale.priceChanges.length, 1);
        assert.equal(sale.priceChanges[0].quotedPrice, 12_000);
    });
});
