/**
 * SMART_BUZ — the industry packages.
 *
 * A package is the set of things a business can do because of what it
 * trades. These tests check the three moments that matter:
 *
 *   - a business that chooses a vertical gets that vertical's package
 *   - a package that is on brings its screens into the menu
 *   - a package that is off brings nothing, and takes nothing away
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as manage from "../convex/packages/manage";
import * as hospitality from "../convex/packages/hospitality";
import { buildNavigation } from "../src/lib/category-nav";
import {
    resolveCategory,
} from "../src/lib/business-categories";

import type { Id } from "../convex/_generated/dataModel";
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

/** The ids in a test are plain strings; the server wants typed ones. */
const BUSINESS_ID = BUSINESS as Id<"businesses">;
const CALLER_ID = CALLER as Id<"users">;

async function call(
    registered: unknown,
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<any> {
    const handler = (registered as { _handler: Function })._handler;
    return handler(ctx, args);
}

function contextFor(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({
                userId: CALLER,
                businessId: BUSINESS,
                role: "business_owner",
            }),
        ],
        ...extra,
    });
}

describe("the industry packages", () => {
    it("switches the vertical's own package on", async () => {
        const ctx = contextFor();

        const key = await manage.enablePackageForCategory(
            ctx,
            BUSINESS_ID,
            "hotel",
            CALLER_ID
        );

        assert.equal(key, "hotel");

        const packages = await call(manage.listEnabledPackages, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(packages.length, 1);
        assert.equal(packages[0].key, "hotel");
        assert.ok(packages[0].modules.length > 0, "the package brings screens");
    });

    it("leaves a business with nothing on until it chooses a vertical", async () => {
        const ctx = contextFor();

        const key = await manage.enablePackageForCategory(
            ctx,
            BUSINESS_ID,
            undefined,
            CALLER_ID
        );
        assert.equal(key, null);

        const packages = await call(manage.listEnabledPackages, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(packages.length, 0);
    });

    it("keeps the choices a business has already made", async () => {
        const ctx = contextFor({
            industryPackages: [
                {
                    _id: "industryPackages_1",
                    _creationTime: 1,
                    businessId: BUSINESS,
                    packageKey: "hotel",
                    enabled: false,
                    features: ["room_service"],
                    settings: { rooms: 12 },
                    createdAt: "2026-02-01T00:00:00.000Z",
                    updatedAt: "2026-02-01T00:00:00.000Z",
                },
            ],
        });

        await manage.enablePackageForCategory(
            ctx,
            BUSINESS_ID,
            "hotel",
            CALLER_ID
        );

        const packages = await call(manage.listEnabledPackages, ctx, {
            businessId: BUSINESS,
        });
        assert.equal(packages.length, 1);
        // The business chose this feature; switching the package back on
        // must not take it away.
        assert.ok(packages[0].features.includes("room_service"));
    });

    it("brings the screens into the menu", () => {
        const category = resolveCategory({ categoryId: "hotel" });
        const withoutPackage = buildNavigation(
            ["business_owner"],
            category.modules
        );
        const withPackage = buildNavigation(["business_owner"], [
            ...category.modules,
            "fees",
        ]);

        assert.ok(
            withoutPackage.some((item) => item.id === "frontDesk"),
            "the hotel's own vertical brings the front desk"
        );
        assert.ok(
            !withoutPackage.some((item) => item.id === "fees"),
            "a school screen is not in a hotel's menu until its package is on"
        );
        assert.ok(
            withPackage.some((item) => item.id === "fees"),
            "an extra package adds its own screens"
        );
    });

    it("ignores a module that has no screen behind it", () => {
        const category = resolveCategory({ categoryId: "retail" });
        const items = buildNavigation(["business_owner"], [
            ...category.modules,
            "not_a_module",
        ]);

        assert.ok(items.length > 0);
        assert.ok(items.every((item) => Boolean(item.href)));
    });
});

describe("a feature that is switched off", () => {
    const ROOM = "serviceOutlets_1";

    function hotelContext(features: string[]): FakeContext {
        return contextFor({
            industryPackages: [
                {
                    _id: "industryPackages_1",
                    _creationTime: 1,
                    businessId: BUSINESS,
                    packageKey: "hotel",
                    enabled: true,
                    features,
                    settings: {},
                    createdAt: "2026-02-01T00:00:00.000Z",
                    updatedAt: "2026-02-01T00:00:00.000Z",
                },
            ],
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

    it("is refused, and the refusal says where to turn it on", async () => {
        const ctx = hotelContext(["room_inventory", "folio"]);

        await assert.rejects(
            () =>
                call(hospitality.createReservation, ctx, {
                    businessId: BUSINESS,
                    outletId: ROOM,
                    guestName: "Amina Nakato",
                    checkIn: "2026-02-01",
                    checkOut: "2026-02-04",
                }),
            /switched off/i
        );
    });

    it("is allowed when the feature is on", async () => {
        const ctx = hotelContext([
            "room_inventory",
            "reservations",
            "folio",
        ]);

        const outcome = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });

        assert.equal(outcome.nights, 3);
    });

    it("is allowed when the business has never touched the packages", async () => {
        const ctx = contextFor({
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

        const outcome = await call(hospitality.createReservation, ctx, {
            businessId: BUSINESS,
            outletId: ROOM,
            guestName: "Amina Nakato",
            checkIn: "2026-02-01",
            checkOut: "2026-02-04",
        });

        assert.equal(outcome.nights, 3);
    });

    it("is refused when the whole package is switched off", async () => {
        const ctx = contextFor({
            industryPackages: [
                {
                    _id: "industryPackages_1",
                    _creationTime: 1,
                    businessId: BUSINESS,
                    packageKey: "hotel",
                    enabled: false,
                    features: ["reservations"],
                    settings: {},
                    createdAt: "2026-02-01T00:00:00.000Z",
                    updatedAt: "2026-02-01T00:00:00.000Z",
                },
            ],
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

        await assert.rejects(
            () =>
                call(hospitality.createReservation, ctx, {
                    businessId: BUSINESS,
                    outletId: ROOM,
                    guestName: "Amina Nakato",
                    checkIn: "2026-02-01",
                    checkOut: "2026-02-04",
                }),
            /switched off/i
        );
    });
});
