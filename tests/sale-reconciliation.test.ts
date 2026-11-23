/**
 * SMARTBUZ — tests for the reconciliation of a sale's stock movement.
 *
 * Convex has no multi-document transaction, so a failure part-way through
 * a write can leave partial state. The audit (DB-04) said the cure is to
 * make every step keyed — so a retry converges — and to have a
 * reconciliation that compares the records and repairs or reports the
 * divergence.
 *
 * These tests cover the reconciliation: it finds a sale whose movement
 * never reached the ledger, and the repair writes that movement once and
 * only once.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    callHandler,
    makeBusiness,
    makeMembership,
    makeUser,
    signedInContext,
    type FakeRow,
} from "./helpers/fake-context";

import { reconcileSales, repairSaleMovement } from "../convex/stocks";

const USER = "users_1";
const BUSINESS = "businesses_1";
const STOCK = "stocks_1";

/**
 * A context with one owner in one business.
 *
 * The business is on a running subscription — an unlicensed business is
 * refused before it is asked anything.
 */
function ownerContext(extra: Record<string, FakeRow[]> = {}) {
    return signedInContext({
        subject: USER,
        users: [makeUser({ _id: USER })],
        businesses: [makeBusiness({ _id: BUSINESS })],
        memberships: [
            makeMembership({
                _id: "memberships_1",
                userId: USER,
                businessId: BUSINESS,
                role: "business_owner",
            }),
        ],
        ...extra,
    });
}

/** A sale of one product. */
function sale(overrides: Partial<FakeRow> = {}): FakeRow {
    return {
        _id: "sales_1",
        _creationTime: 1,
        businessId: BUSINESS,
        userId: USER,
        shopId: undefined,
        customerId: "customers_1",
        invoiceNumber: "INV-001",
        date: "2026-11-10T10:00:00.000Z",
        total: 20_000,
        items: [
            {
                stockId: STOCK,
                name: "Sugar 1kg",
                quantity: 2,
                price: 10_000,
                pv: 7_000,
                bv: 7_000,
            },
        ],
        ...overrides,
    };
}

/** The movement a sale should have written. */
function movement(overrides: Partial<FakeRow> = {}): FakeRow {
    return {
        _id: "stockLedger_1",
        _creationTime: 1,
        businessId: BUSINESS,
        stockId: STOCK,
        shopId: undefined,
        deltaQty: -2,
        eventType: "SALE",
        referenceId: "INV-001",
        userId: USER,
        timestamp: "2026-11-10T10:00:00.000Z",
        ...overrides,
    };
}

type Missing = {
    saleId: string;
    invoiceNumber: string | null;
    date: string;
    stockId: string;
    name: string | null;
    quantity: number;
};

type Reconciliation = {
    salesChecked: number;
    movementsChecked: number;
    missing: Missing[];
};

type Repair = { saleId: string; written: number; alreadyThere: number };

describe("the reconciliation of a sale's stock movement", () => {
    it("finds a sale whose movement never reached the ledger", async () => {
        const ctx = ownerContext({ sales: [sale()], stockLedger: [] });

        const result = await callHandler<Reconciliation>(reconcileSales, ctx, {
            from: "2026-11-01T00:00:00.000Z",
            to: "2026-11-30T23:59:59.999Z",
        });

        assert.equal(result.salesChecked, 1);
        assert.equal(result.missing.length, 1);
        assert.equal(result.missing[0].saleId, "sales_1");
        assert.equal(result.missing[0].stockId, STOCK);
        assert.equal(result.missing[0].quantity, 2);
    });

    it("finds nothing when every sale has its movement", async () => {
        const ctx = ownerContext({
            sales: [sale()],
            stockLedger: [movement()],
        });

        const result = await callHandler<Reconciliation>(reconcileSales, ctx, {
            from: "2026-11-01T00:00:00.000Z",
            to: "2026-11-30T23:59:59.999Z",
        });

        assert.equal(result.movementsChecked, 1);
        assert.deepEqual(result.missing, []);
    });

    it("writes the movement that was lost", async () => {
        const ctx = ownerContext({ sales: [sale()], stockLedger: [] });

        const result = await callHandler<Repair>(repairSaleMovement, ctx, {
            saleId: "sales_1",
        });

        assert.equal(result.written, 1);
        assert.equal(result.alreadyThere, 0);
        assert.equal(ctx.tables.stockLedger.length, 1);

        const written = ctx.tables.stockLedger[0];
        assert.equal(written.stockId, STOCK);
        assert.equal(written.eventType, "SALE");
        assert.equal(written.referenceId, "INV-001");
        assert.equal(written.deltaQty, -2);
    });

    it("writes the movement once, however many times it is run", async () => {
        const ctx = ownerContext({ sales: [sale()], stockLedger: [] });

        await callHandler<Repair>(repairSaleMovement, ctx, { saleId: "sales_1" });
        const second = await callHandler<Repair>(repairSaleMovement, ctx, {
            saleId: "sales_1",
        });

        assert.equal(second.written, 0);
        assert.equal(second.alreadyThere, 1);
        assert.equal(ctx.tables.stockLedger.length, 1);
    });

    it("leaves a movement that is already there alone", async () => {
        const ctx = ownerContext({
            sales: [sale()],
            stockLedger: [movement()],
        });

        const result = await callHandler<Repair>(repairSaleMovement, ctx, {
            saleId: "sales_1",
        });

        assert.equal(result.written, 0);
        assert.equal(result.alreadyThere, 1);
        assert.equal(ctx.tables.stockLedger.length, 1);
    });

    it("refuses a sale that belongs to another business", async () => {
        const ctx = ownerContext({
            sales: [sale({ businessId: "businesses_other" })],
            stockLedger: [],
        });

        await assert.rejects(
            () => callHandler<Repair>(repairSaleMovement, ctx, { saleId: "sales_1" }),
            /Forbidden/
        );
    });
});
