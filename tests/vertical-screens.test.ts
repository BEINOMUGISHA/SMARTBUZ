/**
 * SMART_BUZ — the screens a vertical brings, and the gate that guards them.
 *
 * A vertical says what its trade can do. This checks that it also has the
 * screen for each of those things, that the package beside it brings the same
 * screens, and that a business which has not switched on the package behind
 * a screen cannot do the work that screen is for.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as manage from "../convex/packages/manage";
import * as commercial from "../convex/packages/commercial";
import { allPackages } from "../convex/packages/registry";
import {
    BUSINESS_CATEGORIES,
    CAPABILITY_SCREENS,
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
const BUSINESS_ID = BUSINESS as Id<"businesses">;

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

function packageRow(
    packageKey: string,
    enabled: boolean
): FakeRow {
    return {
        _id: `industryPackages_${packageKey}`,
        _creationTime: 1,
        businessId: BUSINESS,
        packageKey,
        enabled,
        features: [],
        settings: {},
        createdAt: "2026-02-01T00:00:00.000Z",
        updatedAt: "2026-02-01T00:00:00.000Z",
    } as FakeRow;
}

describe("a vertical and the screens it brings", () => {
    it("gives every vertical the screen for each of its capabilities", () => {
        const missing: string[] = [];

        for (const category of BUSINESS_CATEGORIES) {
            for (const feature of category.features) {
                const screens = CAPABILITY_SCREENS[feature];
                if (!screens) {
                    missing.push(`${category.id}: no screen known for ${feature}`);
                    continue;
                }
                for (const screen of screens) {
                    if (!category.modules.includes(screen)) {
                        missing.push(
                            `${category.id}: ${feature} needs the ${screen} screen`
                        );
                    }
                }
            }
        }

        assert.deepEqual(missing, []);
    });

    it("gives every package exactly the screens its vertical brings", () => {
        const byCategory = new Map(
            BUSINESS_CATEGORIES.map((category) => [category.id, category])
        );

        for (const descriptor of allPackages()) {
            const category = byCategory.get(
                descriptor.categoryId as (typeof BUSINESS_CATEGORIES)[number]["id"]
            );
            assert.ok(category, `${descriptor.key} has no vertical`);

            const expected = category.modules.filter(
                (module) =>
                    module !== "dashboard" && module !== "systemconfig"
            );

            assert.deepEqual(
                descriptor.modules,
                expected,
                `${descriptor.key} does not bring the screens of ${category.id}`
            );
        }
    });

    it("has one package for every vertical, and no vertical for two packages", () => {
        const seen = new Map<string, string>();

        for (const descriptor of allPackages()) {
            const previous = seen.get(descriptor.categoryId);
            assert.equal(
                previous,
                undefined,
                `${descriptor.categoryId} has two packages: ${previous} and ${descriptor.key}`
            );
            seen.set(descriptor.categoryId, descriptor.key);
        }

        assert.equal(seen.size, BUSINESS_CATEGORIES.length);
    });
});

describe("a screen behind a package", () => {
    it("is refused when the package that brings it is switched off", async () => {
        const ctx = contextFor({
            industryPackages: [packageRow("hotel", false)],
        });

        await assert.rejects(
            () => manage.assertScreenAvailable(ctx as any, BUSINESS_ID, "leads"),
            /switched off/i
        );
    });

    it("is allowed when the package that brings it is switched on", async () => {
        const ctx = contextFor({
            industryPackages: [packageRow("hotel", true)],
        });

        await manage.assertScreenAvailable(ctx as any, BUSINESS_ID, "leads");
    });

    it("is allowed when the business has never touched the packages", async () => {
        const ctx = contextFor();

        await manage.assertScreenAvailable(ctx as any, BUSINESS_ID, "leads");
    });

    it("is never refused for a screen no package brings", async () => {
        const ctx = contextFor({
            industryPackages: [packageRow("hotel", false)],
        });

        await manage.assertScreenAvailable(ctx as any, BUSINESS_ID, "not_a_screen");
    });

    it("stops the work behind the screen, not just the screen itself", async () => {
        const ctx = contextFor({
            industryPackages: [packageRow("hotel", false)],
        });

        await assert.rejects(
            () =>
                call(commercial.createLead, ctx, {
                    businessId: BUSINESS,
                    name: "Amina Nakato",
                }),
            /switched off/i
        );
    });

    it("lets the work through when the package is on", async () => {
        const ctx = contextFor({
            industryPackages: [packageRow("hotel", true)],
        });

        const leadId = await call(commercial.createLead, ctx, {
            businessId: BUSINESS,
            name: "Amina Nakato",
        });

        assert.ok(leadId);
    });
});
