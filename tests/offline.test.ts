/**
 * SMARTBUZ — Phase 7, the offline-first engine.
 *
 * The rules a till must keep when the network goes, checked against the
 * **real** backend modules rather than a re-implementation of them.
 *
 * The situations worked out by hand first:
 *
 *   - the same sale pushed twice, by the same till and by a different one
 *   - two devices selling the same stock while offline
 *   - a mobile-money payment made with no signal
 *   - a sale rung up on Tuesday, pushed on Wednesday
 *   - one bad sale in the middle of a queue of good ones
 *   - a business whose subscription lapsed after the sale was rung up
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as sync from "../convex/sync";
import * as sales from "../convex/sales";
import * as salesCore from "../convex/salesCore";
import * as subscriptionState from "../convex/subscriptionState";

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
const DEVICE = "SBZ-DEVICE-0001";

const DAY = 86_400_000;
const NOW = Date.now();
/** A Tuesday. */
const OCCURRED_AT = new Date(NOW - DAY).toISOString();
const FUTURE = new Date(NOW + 30 * DAY).toISOString();

/** Invoke a Convex mutation or query handler directly. */
async function call(
    registered: unknown,
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<any> {
    const handler = (registered as { _handler: Function })._handler;
    return handler(ctx, args);
}

/**
 * A context where the caller owns the business.
 *
 * The business is on a running subscription: a business with no subscription
 * is not licensed, and a till may not be registered for one.
 *
 * The till is registered by default too. A till that has never been
 * registered cannot push its queue — the device limit used to be checked
 * only at registration, so a till nobody had registered could record
 * sales — so a test that pushes a queue needs a registered till unless it
 * is specifically testing what happens without one.
 */
function ownerContext(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role: "owner" }),
        ],
        subscriptions: [makeActiveSubscription()],
        devices: [
            {
                _id: "devices_1",
                businessId: BUSINESS,
                deviceId: DEVICE,
                deviceName: "Till 1",
                status: "active",
                registeredAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            },
        ],
        ...extra,
    });
}

/** A sale as a till sends it: two Blue Band at 12,000. */
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
        clientType_: undefined,
        ...overrides,
    };
}

/** A queued transaction. */
function queued(transactionId: string, overrides: Record<string, unknown> = {}) {
    return {
        transactionId,
        occurredAt: OCCURRED_AT,
        attempts: 1,
        payload: salePayload(),
        ...overrides,
    };
}

/* ────────────────────────────────────────────────────────────────────────
 * Devices
 * ──────────────────────────────────────────────────────────────────────── */

describe("device registration", () => {
    it("registers a till once, and recognises it afterwards", async () => {
        // No till yet — this is the test that registers the first one.
        const ctx = ownerContext({ devices: [] });

        const first = await call(sync.registerDevice, ctx, {
            deviceId: DEVICE,
            platform: "web",
            appVersion: "1.0.0",
        });
        assert.equal(first.registered, true);
        assert.equal(first.alreadyRegistered, false);

        const second = await call(sync.registerDevice, ctx, {
            deviceId: DEVICE,
            platform: "web",
        });
        assert.equal(second.alreadyRegistered, true);

        assert.equal((ctx as any).tables.devices.length, 1);
    });

    it("refuses a device that has been revoked", async () => {
        const ctx = ownerContext({
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: DEVICE,
                    deviceName: "Till 1",
                    status: "revoked",
                    registeredAt: new Date().toISOString(),
                    revokedAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        await assert.rejects(
            () => call(sync.registerDevice, ctx, { deviceId: DEVICE }),
            /revoked/i
        );
    });

    it("refuses a device over the plan's limit", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "starter",
                    status: "trial",
                    billingCycle: "monthly",
                    trialEndsAt: FUTURE,
                    currentPeriodEnd: FUTURE,
                },
            ],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: "SBZ-OTHER",
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        await assert.rejects(
            () => call(sync.registerDevice, ctx, { deviceId: DEVICE }),
            /allows 1 device/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Pushing the queue
 * ──────────────────────────────────────────────────────────────────────── */

describe("pushing the queue", () => {
    it("records an offline sale and says so", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        assert.equal(result.results.length, 1);
        assert.equal(result.results[0].status, "applied");
        assert.ok(result.results[0].saleId);

        const salesRows = (ctx as any).tables.sales;
        assert.equal(salesRows.length, 1);
        assert.equal(salesRows[0].total, 24_000);
        assert.equal(salesRows[0].clientOfflineId, "TX-1");
        assert.equal(salesRows[0].deviceId, DEVICE);
        assert.equal(salesRows[0].syncSource, "offline");
    });

    it("takes the stock down", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        assert.equal((ctx as any).tables.stocks[0].qty, 8);
    });

    it("records the sale against the day it was rung up, not the day it synced", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        const sale = (ctx as any).tables.sales[0];
        assert.equal(sale.date, OCCURRED_AT);
        assert.equal(sale.occurredAt, OCCURRED_AT);
    });

    it("does not let a till date a sale to last year", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const longAgo = new Date(NOW - 400 * DAY).toISOString();
        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1", { occurredAt: longAgo })],
        });

        const sale = (ctx as any).tables.sales[0];
        assert.notEqual(sale.date, longAgo, "the date was adjusted");
        assert.ok(
            new Date(sale.date).getTime() > NOW - 2 * DAY,
            "the sale is dated about now"
        );
    });

    it("never counts the same sale twice", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const first = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });
        const second = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        assert.equal(first.results[0].status, "applied");
        assert.equal(second.results[0].status, "duplicate");
        assert.equal(second.results[0].saleId, first.results[0].saleId);

        assert.equal((ctx as any).tables.sales.length, 1);
        // The stock was only taken down once.
        assert.equal((ctx as any).tables.stocks[0].qty, 8);
    });

    it("recognises a duplicate that arrives from a different till", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: DEVICE,
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
                {
                    _id: "devices_2",
                    businessId: BUSINESS,
                    deviceId: "SBZ-DEVICE-0002",
                    deviceName: "Till 2",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        // The same transaction, pushed by another device — a reinstall, or a
        // till that was cloned. It is still one sale.
        const second = await call(sync.pushTransactions, ctx, {
            deviceId: "SBZ-DEVICE-0002",
            transactions: [queued("TX-1")],
        });

        assert.equal(second.results[0].status, "duplicate");
        assert.equal((ctx as any).tables.sales.length, 1);
        assert.equal((ctx as any).tables.stocks[0].qty, 8);
    });

    it("keeps the good sales when one of them is refused", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const bad = queued("TX-BAD", {
            payload: salePayload({
                total: 999_999,
                items: [
                    {
                        stockId: "stocks_missing",
                        name: "Ghost product",
                        price: 1,
                        quantity: 1,
                        pv: 1,
                        bv: 1,
                    },
                ],
            }),
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1"), bad, queued("TX-2")],
        });

        assert.equal(result.results.length, 3);
        assert.equal(result.results[0].status, "applied");
        assert.equal(result.results[1].status, "rejected");
        assert.ok(result.results[1].error);
        assert.equal(result.results[2].status, "applied");

        // The two good sales are on the books; the bad one is not.
        assert.equal((ctx as any).tables.sales.length, 2);
    });

    it("writes down what it did with every transaction", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });
        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        const logs = (ctx as any).tables.syncLogs;
        assert.equal(logs.length, 2);
        assert.equal(logs[0].status, "applied");
        assert.equal(logs[1].status, "duplicate");
        assert.equal(logs[0].transactionId, "TX-1");
        assert.equal(logs[0].deviceId, DEVICE);
    });

    it("does not let one malformed record stop the rest of the queue", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        // A record that got corrupted on the till: no items, no total.
        const broken = queued("TX-BROKEN", {
            payload: { nothing: "useful" } as any,
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1"), broken, queued("TX-2")],
        });

        assert.equal(result.results.length, 3);
        assert.equal(result.results[0].status, "applied");
        assert.equal(result.results[1].status, "rejected");
        assert.ok(result.results[1].error, "the reason is given");
        assert.equal(result.results[2].status, "applied");

        assert.equal((ctx as any).tables.sales.length, 2);
    });

    it("notes that the device has caught up", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: DEVICE,
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1")],
        });

        const device = (ctx as any).tables.devices[0];
        assert.ok(device.lastSyncAt, "the device has a last sync time");
        assert.equal(device.lastSyncStatus, "ok");
    });

    it("refuses to push from a revoked device", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: DEVICE,
                    deviceName: "Till 1",
                    status: "revoked",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        await assert.rejects(
            () =>
                call(sync.pushTransactions, ctx, {
                    deviceId: DEVICE,
                    transactions: [queued("TX-1")],
                }),
            /revoked/i
        );

        assert.equal((ctx as any).tables.sales.length, 0);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Server-side validation
 * ──────────────────────────────────────────────────────────────────────── */

describe("server-side validation of offline sales", () => {
    it("charges the price on the server, not the price in the payload", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10, price: 12_000 })],
        });

        // The till says the product costs 1. It does not.
        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        total: 2,
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 1,
                                quantity: 2,
                                pv: 7_000,
                                bv: 7_000,
                            },
                        ],
                    }),
                }),
            ],
        });

        assert.equal(result.results[0].status, "applied");

        const sale = (ctx as any).tables.sales[0];
        assert.equal(sale.total, 24_000, "the server's price is what was charged");
        assert.equal(sale.items[0].price, 12_000);
    });

    it("keeps the till's figure when the two differ, so the difference can be explained", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10, price: 12_000 })],
        });

        // The till was working from an old price list.
        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        total: 20_000,
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 10_000,
                                quantity: 2,
                                pv: 7_000,
                                bv: 7_000,
                            },
                        ],
                    }),
                }),
            ],
        });

        assert.equal(result.results[0].status, "applied");
        assert.equal(result.results[0].total, 24_000);
        assert.equal(result.results[0].clientTotal, 20_000);

        const sale = (ctx as any).tables.sales[0];
        assert.equal(sale.total, 24_000);
        assert.equal(sale.clientTotal, 20_000);
    });

    it("refuses a live sale whose total does not add up", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        await assert.rejects(
            () =>
                call(sales.create, ctx, {
                    ...salePayload(),
                    total: 999,
                }),
            /total mismatch/i
        );
    });

    it("refuses a sale for a product of another business", async () => {
        const ctx = ownerContext({
            stocks: [
                makeStock({ _id: STOCK, qty: 10 }),
                makeStock({
                    _id: "stocks_other",
                    businessId: "businesses_2",
                    qty: 10,
                }),
            ],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        items: [
                            {
                                stockId: "stocks_other",
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 12_000,
                                quantity: 2,
                                pv: 7_000,
                                bv: 7_000,
                            },
                        ],
                    }),
                }),
            ],
        });

        assert.equal(result.results[0].status, "rejected");
        assert.equal((ctx as any).tables.sales.length, 0);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Payments
 * ──────────────────────────────────────────────────────────────────────── */

describe("offline payments", () => {
    it("does not treat an offline mobile-money payment as confirmed", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({ paymentMode: "Mobile Money" }),
                }),
            ],
        });

        assert.equal(result.results[0].paymentConfirmation, "pending_verification");

        const sale = (ctx as any).tables.sales[0];
        assert.equal(sale.paymentConfirmation, "pending_verification");
    });

    it("treats cash in the drawer as confirmed", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1", { payload: salePayload({ paymentMode: "Cash" }) })],
        });

        assert.equal(result.results[0].paymentConfirmation, "confirmed");
    });

    it("treats a bank transfer as unconfirmed too", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({ paymentMode: "Bank Transfer" }),
                }),
            ],
        });

        assert.equal(result.results[0].paymentConfirmation, "pending_verification");
    });

    it("leaves a live sale as it was", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        await call(sales.create, ctx, { ...salePayload() });

        const sale = (ctx as any).tables.sales[0];
        assert.equal(sale.paymentConfirmation, undefined);
        assert.equal(sale.syncSource, "online");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Stock conflicts
 * ──────────────────────────────────────────────────────────────────────── */

describe("two devices selling the same stock offline", () => {
    it("records the sale, and says the stock was short", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 3 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 12_000,
                                quantity: 5,
                                pv: 7_000,
                                bv: 7_000,
                                expectedQty: 10,
                            },
                        ],
                        total: 60_000,
                    }),
                }),
            ],
        });

        // The sale happened. The customer has the goods.
        assert.equal(result.results[0].status, "applied");
        assert.equal(result.results[0].conflicts.length, 1);
        assert.equal(result.results[0].conflicts[0].kind, "insufficient");
        assert.equal(result.results[0].conflicts[0].availableQty, 3);
        assert.equal(result.results[0].conflicts[0].requestedQty, 5);
        assert.equal(result.results[0].conflicts[0].expectedQty, 10);

        // It is on the books.
        assert.equal((ctx as any).tables.sales.length, 1);
        assert.equal((ctx as any).tables.sales[0].total, 60_000);
    });

    it("writes the conflict down so it can be dealt with", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 3 })],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 12_000,
                                quantity: 5,
                                pv: 7_000,
                                bv: 7_000,
                                expectedQty: 10,
                            },
                        ],
                        total: 60_000,
                    }),
                }),
            ],
        });

        const conflicts = (ctx as any).tables.stockConflicts;
        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].kind, "insufficient");
        assert.equal(conflicts[0].status, "pending");
        assert.equal(conflicts[0].transactionId, "TX-1");
        assert.equal(conflicts[0].deviceId, DEVICE);
        assert.equal(conflicts[0].availableQty, 3);
        assert.equal(conflicts[0].expectedQty, 10);
    });

    it("notices when the stock moved but there is still enough", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 8 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 12_000,
                                quantity: 2,
                                pv: 7_000,
                                bv: 7_000,
                                expectedQty: 10,
                            },
                        ],
                    }),
                }),
            ],
        });

        assert.equal(result.results[0].status, "applied");
        assert.equal(result.results[0].conflicts.length, 1);
        assert.equal(result.results[0].conflicts[0].kind, "drift");
    });

    it("says nothing when the stock is exactly as the till expected", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 12_000,
                                quantity: 2,
                                pv: 7_000,
                                bv: 7_000,
                                expectedQty: 10,
                            },
                        ],
                    }),
                }),
            ],
        });

        assert.equal(result.results[0].conflicts.length, 0);
        assert.equal((ctx as any).tables.stockConflicts.length, 0);
    });

    it("lets the owner resolve a conflict", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 3 })],
        });

        await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    payload: salePayload({
                        items: [
                            {
                                stockId: STOCK,
                                name: "Blue Band 250g",
                                productCode: "BB250",
                                price: 12_000,
                                quantity: 5,
                                pv: 7_000,
                                bv: 7_000,
                                expectedQty: 10,
                            },
                        ],
                        total: 60_000,
                    }),
                }),
            ],
        });

        const conflictId = (ctx as any).tables.stockConflicts[0]._id;

        const resolved = await call(sync.resolveConflict, ctx, {
            conflictId,
            resolution: "accepted",
            note: "Stock-take found the shelf empty.",
        });

        assert.equal(resolved.status, "resolved");
        assert.equal((ctx as any).tables.stockConflicts[0].status, "resolved");
        assert.equal((ctx as any).tables.stockConflicts[0].resolution, "accepted");
    });

    it("does not let a business resolve somebody else's conflict", async () => {
        const ctx = ownerContext({
            stockConflicts: [
                {
                    _id: "stockConflicts_1",
                    businessId: "businesses_2",
                    stockId: STOCK,
                    availableQty: 1,
                    requestedQty: 5,
                    kind: "insufficient",
                    status: "pending",
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        await assert.rejects(
            () =>
                call(sync.resolveConflict, ctx, {
                    conflictId: "stockConflicts_1",
                    resolution: "accepted",
                }),
            /does not exist/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The subscription and the offline queue
 * ──────────────────────────────────────────────────────────────────────── */

describe("a business whose subscription lapsed", () => {
    const lapsed = {
        _id: "subscriptions_1",
        businessId: BUSINESS,
        planKey: "business",
        status: "active",
        billingCycle: "monthly",
        currentPeriodStart: new Date(NOW - 60 * DAY).toISOString(),
        /** The paid-for period ended twelve hours ago. */
        currentPeriodEnd: new Date(NOW - 12 * 60 * 60 * 1000).toISOString(),
    };

    it("still records a sale that was rung up while it was running", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
            subscriptions: [lapsed],
        });

        // Rung up yesterday — while the subscription was still running.
        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [queued("TX-1", { occurredAt: OCCURRED_AT })],
        });

        assert.equal(result.results[0].status, "applied");
        assert.equal((ctx as any).tables.sales.length, 1);
    });

    it("refuses a sale that was rung up after it lapsed", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
            subscriptions: [lapsed],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: DEVICE,
            transactions: [
                queued("TX-1", {
                    occurredAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
                }),
            ],
        });

        assert.equal(result.results[0].status, "rejected");
        assert.equal((ctx as any).tables.sales.length, 0);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Tenant isolation
 * ──────────────────────────────────────────────────────────────────────── */

describe("tenant isolation", () => {
    it("does not push a sale into another business", async () => {
        const ctx = ownerContext({
            businesses: [
                makeBusiness({ _id: BUSINESS, ownerId: CALLER }),
                makeBusiness({ _id: "businesses_2", ownerId: "users_2" }),
            ],
            stocks: [makeStock({ _id: STOCK, qty: 10 })],
        });

        await assert.rejects(
            () =>
                call(sync.pushTransactions, ctx, {
                    deviceId: DEVICE,
                    transactions: [queued("TX-1")],
                    businessId: "businesses_2",
                }),
            /Forbidden/i
        );
    });

    it("does not show one business another's sync log", async () => {
        const ctx = ownerContext({
            businesses: [
                makeBusiness({ _id: BUSINESS, ownerId: CALLER }),
                makeBusiness({ _id: "businesses_2", ownerId: "users_2" }),
            ],
            syncLogs: [
                {
                    _id: "syncLogs_1",
                    businessId: "businesses_2",
                    direction: "push",
                    status: "applied",
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        const logs = await call(sync.listSyncLogs, ctx, {});
        assert.equal(logs.length, 0);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The status the owner sees
 * ──────────────────────────────────────────────────────────────────────── */

describe("the sync status", () => {
    it("shows the till and how it is doing", async () => {
        const ctx = ownerContext({
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: DEVICE,
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    lastSyncAt: new Date().toISOString(),
                    lastSyncStatus: "ok",
                    createdAt: new Date().toISOString(),
                },
            ],
            stockConflicts: [
                {
                    _id: "stockConflicts_1",
                    businessId: BUSINESS,
                    stockId: STOCK,
                    availableQty: 1,
                    requestedQty: 5,
                    kind: "insufficient",
                    status: "pending",
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        const status = await call(sync.getSyncStatus, ctx, {});
        assert.equal(status.devices.length, 1);
        assert.equal(status.devices[0].deviceId, DEVICE);
        assert.equal(status.devices[0].lastSyncStatus, "ok");
        assert.equal(status.pendingConflicts, 1);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The rules the sale core applies
 * ──────────────────────────────────────────────────────────────────────── */

describe("the rules the sale core applies", () => {
    it("keeps the day a sale was rung up, within reason", () => {
        const yesterday = new Date(NOW - DAY).toISOString();

        const kept = salesCore.resolveOccurredAt(yesterday);
        assert.equal(kept.date, yesterday);
        assert.equal(kept.adjusted, false);
    });

    it("refuses a sale dated to last year", () => {
        const longAgo = new Date(NOW - 400 * DAY).toISOString();

        const adjusted = salesCore.resolveOccurredAt(longAgo);
        assert.equal(adjusted.adjusted, true);
        assert.notEqual(adjusted.date, longAgo);
    });

    it("refuses a sale dated to next week", () => {
        const nextWeek = new Date(NOW + 7 * DAY).toISOString();

        const adjusted = salesCore.resolveOccurredAt(nextWeek);
        assert.equal(adjusted.adjusted, true);
    });

    it("refuses a date it cannot read", () => {
        const adjusted = salesCore.resolveOccurredAt("not a date");
        assert.equal(adjusted.adjusted, true);
    });

    it("does not confirm a mobile-money payment made offline", () => {
        assert.equal(
            salesCore.resolvePaymentConfirmation("Mobile Money", true),
            "pending_verification"
        );
        assert.equal(
            salesCore.resolvePaymentConfirmation("Bank Transfer", true),
            "pending_verification"
        );
    });

    it("is happy with cash in the drawer", () => {
        assert.equal(salesCore.resolvePaymentConfirmation("Cash", true), "confirmed");
    });

    it("leaves a live sale as it was", () => {
        assert.equal(
            salesCore.resolvePaymentConfirmation("Mobile Money", false),
            undefined
        );
    });

    it("notices when the stock moved but there is enough", () => {
        const available = new Map<any, number>([[STOCK, 8]]);
        const conflicts = salesCore.detectStockConflicts(
            [
                {
                    stockId: STOCK as any,
                    name: "Blue Band 250g",
                    quantity: 2,
                    expectedQty: 10,
                },
            ],
            available
        );

        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].kind, "drift");
        assert.equal(conflicts[0].availableQty, 8);
    });

    it("notices when there was not enough", () => {
        const available = new Map<any, number>([[STOCK, 1]]);
        const conflicts = salesCore.detectStockConflicts(
            [
                {
                    stockId: STOCK as any,
                    name: "Blue Band 250g",
                    quantity: 5,
                    expectedQty: 10,
                },
            ],
            available
        );

        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].kind, "insufficient");
        assert.equal(conflicts[0].requestedQty, 5);
    });

    it("says nothing when the stock is as expected", () => {
        const available = new Map<any, number>([[STOCK, 10]]);
        const conflicts = salesCore.detectStockConflicts(
            [
                {
                    stockId: STOCK as any,
                    name: "Blue Band 250g",
                    quantity: 2,
                    expectedQty: 10,
                },
            ],
            available
        );

        assert.equal(conflicts.length, 0);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The states of a subscription, restated
 * ──────────────────────────────────────────────────────────────────────── */

describe("the states a till can be in", () => {
    it("knows a trial that has run out", () => {
        assert.equal(
            subscriptionState.computeEffectiveStatus({
                status: "trial",
                trialEndsAt: new Date(NOW - DAY).toISOString(),
                currentPeriodEnd: new Date(NOW - DAY).toISOString(),
            } as any),
            "expired"
        );
    });

    it("knows a business that is still in good standing", () => {
        assert.equal(
            subscriptionState.computeEffectiveStatus({
                status: "active",
                currentPeriodEnd: FUTURE,
            } as any),
            "active"
        );
    });
});
