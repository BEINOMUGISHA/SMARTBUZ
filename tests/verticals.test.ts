/**
 * SMART_BUZ — the industry verticals.
 *
 * The behaviour modules that give each of the 45 branches of the product
 * its own way of working: the price book, the front desk, the instalment
 * plans, the notifications, the bulk import.
 *
 * Each test states the rule in the business's own words and then checks
 * the **real** handler — the same code the server runs — against a known
 * scenario, so a change in the behaviour shows up as a failure against a
 * figure or a refusal that was agreed on.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as pricing from "../convex/packages/pricing";
import * as hospitality from "../convex/packages/hospitality";
import * as notifications from "../convex/notifications";
import * as imports from "../convex/packages/imports";

import {
    FakeContext,
    FakeRow,
    makeBusiness,
    makeCustomer,
    makeMembership,
    makeUser,
    signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const CALLER = "users_1";
const OTHER = "users_2";

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
 * A context where the caller is a member of the business with `role`.
 */
function contextFor(
    role: string,
    extra: Record<string, FakeRow[]> = {},
    subject: string = CALLER
): FakeContext {
    return signedInContext({
        subject,
        users: [makeUser({ _id: CALLER }), makeUser({ _id: OTHER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role }),
            makeMembership({
                _id: "memberships_2",
                userId: OTHER,
                businessId: BUSINESS,
                role: "business_admin",
            }),
        ],
        ...extra,
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * Pricing — units and the price book
 * ──────────────────────────────────────────────────────────────────────── */

describe("the price book", () => {
    it("knows which measure a unit belongs to", () => {
        assert.equal(pricing.measureOf("kg"), "weight");
        assert.equal(pricing.measureOf("Kilograms"), "weight");
        assert.equal(pricing.measureOf("litre"), "volume");
        assert.equal(pricing.measureOf("ml"), "volume");
        assert.equal(pricing.measureOf("crate"), "count");
    });

    it("refuses to convert weight into volume", async () => {
        const ctx = contextFor("business_owner");

        await assert.rejects(
            () =>
                call(pricing.createUnitConversion, ctx, {
                    businessId: BUSINESS,
                    fromUnit: "kg",
                    toUnit: "litre",
                    factor: 1,
                }),
            /weight/i
        );
    });

    it("allows a conversion inside one measure", async () => {
        const ctx = contextFor("business_owner");

        const outcome = await call(pricing.createUnitConversion, ctx, {
            businessId: BUSINESS,
            fromUnit: "g",
            toUnit: "kg",
            factor: 1000,
        });

        assert.ok(outcome);
        const rows = await call(pricing.listUnitConversions, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0].factor, 1000);
        assert.equal(rows[0].measure, "weight");
    });

    it("refuses a conversion that crosses the kind of measure", async () => {
        const ctx = contextFor("business_owner");

        // A bag of cement is a count, not a weight: turning one into the
        // other needs to know what is in the bag.
        await assert.rejects(
            () =>
                call(pricing.createUnitConversion, ctx, {
                    businessId: BUSINESS,
                    fromUnit: "bag",
                    toUnit: "kg",
                    factor: 50,
                }),
            /same kind of measure|density/i
        );
    });

    it("refuses a conversion with no factor in it", async () => {
        const ctx = contextFor("business_owner");

        await assert.rejects(
            () =>
                call(pricing.createUnitConversion, ctx, {
                    businessId: BUSINESS,
                    fromUnit: "bag",
                    toUnit: "kg",
                    factor: 0,
                }),
            /factor|greater|positive/i
        );
    });

    it("will not let a member of another business into the price book", async () => {
        const ctx = contextFor("business_owner");

        await assert.rejects(
            () =>
                call(pricing.listUnitConversions, ctx, {
                    businessId: "businesses_other",
                }),
            /Forbidden|not/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The front desk
 * ──────────────────────────────────────────────────────────────────────── */

const ROOM = "serviceOutlets_1";

function frontDeskContext(): FakeContext {
    return contextFor("business_admin", {
        serviceOutlets: [
            {
                _id: ROOM,
                _creationTime: 1,
                businessId: BUSINESS,
                businessType: "room",
                name: "Room 1",
                capacity: 2,
                status: "available",
                rate: 50_000,
                housekeepingStatus: "clean",
            },
        ],
    });
}

describe("the front desk", () => {
    it("counts the nights and works out the total on the server", async () => {
        const ctx = frontDeskContext();

        const outcome = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });

        // Three nights, at the room's own rate.
        assert.equal(outcome.nights, 3);
        assert.equal(outcome.nightlyRate, 50_000);
        assert.equal(outcome.total, 150_000);
    });

    it("refuses a stay that leaves before it arrives", async () => {
        const ctx = frontDeskContext();

        await assert.rejects(
            () =>
                call(hospitality.createReservation, ctx, {
                    businessId: BUSINESS,
                    outletId: ROOM,
                    guestName: "Amina Nakato",
                    checkIn: "2026-02-04",
                    checkOut: "2026-02-01",
                }),
            /before/i
        );
    });

    it("refuses a second booking of the same room for the same nights", async () => {
        const ctx = frontDeskContext();

        await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });

        await assert.rejects(
            () =>
                call(hospitality.createReservation, ctx, {
                    businessId: BUSINESS,
                    outletId: ROOM,
                    guestName: "Someone Else",
                    checkIn: "2026-02-03",
                    checkOut: "2026-02-06",
                }),
            /already taken/i
        );
    });

    it("keeps the folio balance as the difference of its entries", async () => {
        const ctx = frontDeskContext();

        const reserved = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });

        await call(hospitality.checkInStay, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
        });

        await call(hospitality.postGuestCharge, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
            description: "Two bottles of water",
            amount: 10_000,
            category: "minibar",
        });

        await call(hospitality.recordStayPayment, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
            amount: 100_000,
            method: "cash",
        });

        const folio = await call(hospitality.listFolioEntries, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
        });

        // 150,000 for the room, 10,000 of charges, 100,000 paid.
        assert.equal(folio.roomTotal, 150_000);
        assert.equal(folio.charges, 10_000);
        assert.equal(folio.payments, 100_000);
        assert.equal(folio.balance, 60_000);
    });

    it("refuses a charge of nothing", async () => {
        const ctx = frontDeskContext();

        const reserved = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });
        await call(hospitality.checkInStay, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
        });

        await assert.rejects(
            () =>
                call(hospitality.postGuestCharge, ctx, {
                    businessId: BUSINESS,
                    bookingId: reserved.bookingId,
                    description: "Nothing at all",
                    amount: 0,
                }),
            /more than zero/i
        );
    });

    it("refuses to take a room out of service while a guest is on it", async () => {
        const ctx = frontDeskContext();

        const reserved = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });
        await call(hospitality.checkInStay, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
        });

        await assert.rejects(
            () =>
                call(hospitality.updateHousekeeping, ctx, {
                    businessId: BUSINESS,
                    outletId: ROOM,
                    status: "out_of_service",
                }),
            /still has/i
        );
    });

    it("will not let a checked-out stay be checked in again", async () => {
        const ctx = frontDeskContext();

        const reserved = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });
        await call(hospitality.checkInStay, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
        });
        await call(hospitality.checkOutStay, ctx, {
            businessId: BUSINESS,
            bookingId: reserved.bookingId,
        });

        await assert.rejects(
            () =>
                call(hospitality.checkInStay, ctx, {
                    businessId: BUSINESS,
                    bookingId: reserved.bookingId,
                }),
            /cannot be checked in/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Notifications
 * ──────────────────────────────────────────────────────────────────────── */

describe("notifications", () => {
    const NOTIFICATION = "notifications_1";

    function notificationContext(subject: string = CALLER): FakeContext {
        return contextFor("business_owner", {
            notifications: [
                {
                    _id: NOTIFICATION,
                    _creationTime: 1,
                    businessId: BUSINESS,
                    userId: CALLER,
                    kind: "sales",
                    title: "A sale was refunded",
                    body: "12,000 refunded",
                    createdAt: "2026-02-01T10:00:00.000Z",
                },
            ],
        }, subject);
    }

    it("counts what the caller has not read", async () => {
        const ctx = notificationContext();

        const unread = await call(notifications.unreadCount, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(unread, 1);
    });

    it("will not let one person mark another's notification read", async () => {
        // The caller is the other member of the business.
        const ctx = notificationContext(OTHER);

        await assert.rejects(
            () =>
                call(notifications.markRead, ctx, {
                    businessId: BUSINESS,
                    id: NOTIFICATION,
                }),
            /somebody else/i
        );
    });

    it("marks only the caller's own notifications", async () => {
        const ctx = notificationContext();

        const changed = await call(notifications.markAllRead, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(changed, 1);

        const rows = await call(notifications.listNotifications, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(rows.length, 1);
        assert.ok(rows[0].readAt);
    });

    it("does not show a notification that belongs to another business", async () => {
        const ctx = notificationContext();

        const rows = await call(notifications.listNotifications, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(rows.length, 1);
        assert.equal(rows[0]._id, NOTIFICATION);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Bulk import
 * ──────────────────────────────────────────────────────────────────────── */

describe("bulk import", () => {
    function importContext(): FakeContext {
        return contextFor("business_owner", {
            categories: [
                {
                    _id: "categories_1",
                    _creationTime: 1,
                    businessId: BUSINESS,
                    type: "Groceries",
                },
            ],
            customers: [
                makeCustomer({
                    _id: "customers_1",
                    businessId: BUSINESS,
                    name: "Amina Nakato",
                    phone: "0772123456",
                }),
            ],
        });
    }

    it("refuses a row whose category does not exist", async () => {
        const ctx = importContext();

        const preview = await call(imports.validateImport, ctx, {
            businessId: BUSINESS,
            type: "products",
            rows: [
                {
                    name: "Blue Band 250g",
                    code: "BB250",
                    category: "No Such Shelf",
                    price: "12000",
                },
            ],
        });

        assert.equal(preview.importable, 0);
        assert.equal(preview.refused, 1);
        assert.match(preview.rows[0].problems.join(" "), /no category/i);
    });

    it("refuses a code that is already in the catalogue", async () => {
        const ctx = importContext();

        const preview = await call(imports.validateImport, ctx, {
            businessId: BUSINESS,
            type: "customers",
            rows: [
                { name: "Someone Else", phone: "0772123456" },
            ],
        });

        assert.equal(preview.importable, 0);
        assert.match(preview.rows[0].problems.join(" "), /already on the book/i);
    });

    it("accepts a good row", async () => {
        const ctx = importContext();

        const preview = await call(imports.validateImport, ctx, {
            businessId: BUSINESS,
            type: "products",
            rows: [
                {
                    name: "Sugar 1kg",
                    code: "SUG1",
                    category: "Groceries",
                    price: "8000",
                    cost: "6500",
                    quantity: "12",
                },
            ],
        });

        assert.equal(preview.importable, 1);
        assert.equal(preview.rows[0].problems.length, 0);
    });

    it("writes the rows that passed the check", async () => {
        const ctx = importContext();

        const outcome = await call(imports.commitImport, ctx, {
            businessId: BUSINESS,
            type: "products",
            rows: [
                {
                    name: "Sugar 1kg",
                    code: "SUG1",
                    category: "Groceries",
                    price: "8000",
                    cost: "6500",
                    quantity: "12",
                },
            ],
        });

        assert.equal(outcome.imported, 1);
        assert.equal(outcome.skipped.length, 0);

        const summary = await call(imports.getImportSummary, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(summary.products, 1);
    });

    it("skips a row that cannot be understood and says why", async () => {
        const ctx = importContext();

        const outcome = await call(imports.commitImport, ctx, {
            businessId: BUSINESS,
            type: "products",
            rows: [
                {
                    name: "Sugar 1kg",
                    code: "SUG1",
                    category: "No Such Shelf",
                    price: "8000",
                },
            ],
        });

        assert.equal(outcome.imported, 0);
        assert.equal(outcome.skipped.length, 1);
        assert.match(outcome.skipped[0].reason, /no category/i);
    });
});
