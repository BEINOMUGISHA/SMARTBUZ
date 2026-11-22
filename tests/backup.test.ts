/**
 * SMARTBUZ — regression tests for backing a business up and putting it back.
 *
 * The defect: there was no way to take a business's data out of SMARTBUZ,
 * and no way to put it back. Everything else the system promises — the
 * ledger is truthful, the reconciliations balance, the books add up —
 * was conditional on the database continuing to exist.
 *
 * These tests cover the three things that could go wrong:
 *
 *   - a backup that takes more than the business's own rows;
 *   - a backup that a browser could take;
 *   - a restore that puts the rows back but leaves the references pointing
 *     at rows that are not there.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import * as backup from "../convex/backup";
import { isBackupFile, remapDocument } from "../src/lib/backup";

import {
    FakeContext,
    FakeRow,
    makeBusiness,
    makeMembership,
    makeUser,
    signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const CALLER = "users_1";
const SECRET = "a-server-secret-long-enough-to-pass";

/** The shape of a Convex function's handler. */
type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;

/** Invoke a Convex mutation or query handler directly. */
async function call(
    registered: unknown,
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<unknown> {
    const handler = (registered as { _handler: Handler })._handler;
    return await handler(ctx, args);
}

/** The error a failed call produced, whole. */
async function errorOf(fn: () => Promise<unknown>): Promise<unknown> {
    try {
        await fn();
    } catch (err) {
        return err;
    }
    return null;
}

/** The message of an error, whatever it was. */
function messageOf(error: unknown): string {
    if (error && typeof error === "object" && "message" in error) {
        return String((error as { message: unknown }).message);
    }
    return String(error);
}

/** A result as a record, so its fields can be read. */
function asRecord(value: unknown): Record<string, unknown> {
    return (value ?? {}) as Record<string, unknown>;
}

/** A result's field as a list. */
function asList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function ownerContext(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role: "owner" }),
        ],
        categories: [
            { _id: "categories_1", businessId: BUSINESS, type: "Grocery" },
            { _id: "categories_2", businessId: "businesses_2", type: "Grocery" },
        ],
        ...extra,
    });
}

beforeEach(() => {
    process.env.SMARTBUZ_SERVER_SECRET = SECRET;
});

afterEach(() => {
    delete process.env.SMARTBUZ_SERVER_SECRET;
});

describe("taking a backup", () => {
    it("reads the business's own rows and nobody else's", async () => {
        const ctx = ownerContext();

        const result = asRecord(
            await call(backup.exportChunk, ctx, {
                businessId: BUSINESS,
                table: "categories",
                serverSecret: SECRET,
            })
        );
        const page = asList(result.page);

        assert.equal(page.length, 1);
        assert.equal(asRecord(page[0])._id, "categories_1");
    });

    it("will not do it without the server secret", async () => {
        const ctx = ownerContext();

        const error = await errorOf(() =>
            call(backup.exportChunk, ctx, {
                businessId: BUSINESS,
                table: "categories",
            })
        );

        assert.ok(error, "the call must be refused");
        assert.match(messageOf(error), /only be taken by the SMARTBUZ server/);
    });

    it("will not read a table a backup does not cover", async () => {
        const ctx = ownerContext();

        const error = await errorOf(() =>
            call(backup.exportChunk, ctx, {
                businessId: BUSINESS,
                table: "users",
                serverSecret: SECRET,
            })
        );

        assert.ok(error, "the call must be refused");
        assert.match(messageOf(error), /not a table a backup covers/);
    });

    it("will not let a caller without the permission take the business out", async () => {
        const ctx = signedInContext({
            users: [makeUser({ _id: CALLER })],
            businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
            memberships: [
                makeMembership({
                    userId: CALLER,
                    businessId: BUSINESS,
                    role: "cashier",
                }),
            ],
        });

        const error = await errorOf(() => call(backup.tables, ctx, { businessId: BUSINESS }));

        assert.ok(error, "the call must be refused");
    });
});

describe("putting a backup back", () => {
    it("writes the rows back and says what they became", async () => {
        const ctx = ownerContext();

        const result = asRecord(
            await call(backup.restoreChunk, ctx, {
                table: "categories",
                rows: [
                    {
                        _id: "categories_9",
                        _creationTime: 1,
                        businessId: BUSINESS,
                        type: "Grocery",
                    },
                ],
                serverSecret: SECRET,
            })
        );
        const inserted = asList(result.inserted) as Array<[string, string]>;

        assert.equal(inserted.length, 1);
        assert.equal(inserted[0][0], "categories_9");
        assert.notEqual(inserted[0][1], "categories_9");
        assert.equal(result.failed, 0);

        // The row is there, without the old id.
        const written = ctx.tables.categories.find((row) => row.type === "Grocery");
        assert.ok(written);
        assert.equal(written.businessId, BUSINESS);
    });

    it("will not write a table a backup does not cover", async () => {
        const ctx = ownerContext();

        const error = await errorOf(() =>
            call(backup.restoreChunk, ctx, {
                table: "users",
                rows: [{ _id: "users_9", email: "a@b.c" }],
                serverSecret: SECRET,
            })
        );

        assert.ok(error, "the call must be refused");
        assert.match(messageOf(error), /not a table a backup covers/);
    });

    it("will not do it without the server secret", async () => {
        const ctx = ownerContext();

        const error = await errorOf(() =>
            call(backup.restoreChunk, ctx, {
                table: "categories",
                rows: [{ _id: "categories_9", businessId: BUSINESS, type: "Grocery" }],
            })
        );

        assert.ok(error, "the call must be refused");
    });

    it("rewrites the references once the rows exist", async () => {
        const ctx = ownerContext();

        const inserted = asRecord(
            await call(backup.restoreChunk, ctx, {
                table: "categories",
                rows: [
                    { _id: "categories_9", businessId: BUSINESS, type: "Grocery" },
                ],
                serverSecret: SECRET,
            })
        );
        const pairs = asList(inserted.inserted) as Array<[string, string]>;
        const newId = pairs[0][1];

        await call(backup.applyRemap, ctx, {
            table: "categories",
            rows: [
                {
                    id: newId,
                    doc: { businessId: BUSINESS, type: "Hardware", parentId: newId },
                },
            ],
            serverSecret: SECRET,
        });

        const written = ctx.tables.categories.find((row) => row._id === newId);
        assert.equal(written?.type, "Hardware");
        assert.equal(written?.parentId, newId);
    });
});

describe("the backup file", () => {
    it("is recognised when it is a backup", () => {
        assert.equal(
            isBackupFile({
                format: "smartbuz-backup/1",
                takenAt: "2026-11-21T18:00:00.000Z",
                businessId: "businesses_1",
                tables: { categories: [] },
            }),
            true
        );
    });

    it("is refused when it is not one", () => {
        assert.equal(isBackupFile({ tables: {} }), false);
        assert.equal(isBackupFile({ format: "something-else", tables: {} }), false);
        assert.equal(isBackupFile("a string"), false);
        assert.equal(isBackupFile(null), false);
    });

    it("is refused when its tables are not arrays", () => {
        assert.equal(
            isBackupFile({
                format: "smartbuz-backup/1",
                businessId: "businesses_1",
                tables: { categories: "not rows" },
            }),
            false
        );
    });
});

describe("rewriting the references", () => {
    it("replaces an id at the top level", () => {
        const map = new Map([["customers_1", "customers_new"]]);
        assert.deepEqual(
            remapDocument({ customerId: "customers_1", name: "Amina" }, map),
            { customerId: "customers_new", name: "Amina" }
        );
    });

    it("replaces an id inside a list of lines", () => {
        const map = new Map([["stocks_1", "stocks_new"]]);
        assert.deepEqual(
            remapDocument(
                {
                    items: [
                        { stockId: "stocks_1", qty: 2 },
                        { stockId: "stocks_2", qty: 1 },
                    ],
                },
                map
            ),
            {
                items: [
                    { stockId: "stocks_new", qty: 2 },
                    { stockId: "stocks_2", qty: 1 },
                ],
            }
        );
    });

    it("replaces the business id, so the data belongs to the business it went into", () => {
        const map = new Map([["businesses_1", "businesses_9"]]);
        assert.deepEqual(
            remapDocument({ businessId: "businesses_1" }, map),
            { businessId: "businesses_9" }
        );
    });

    it("leaves everything else alone", () => {
        const map = new Map([["customers_1", "customers_new"]]);
        assert.deepEqual(
            remapDocument({ total: 1200, note: "customers_1 was here", paid: true }, map),
            { total: 1200, note: "customers_1 was here", paid: true }
        );
    });
});
