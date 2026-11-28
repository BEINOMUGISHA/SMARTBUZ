/**
 * SMARTBUZ — the permissions on the vertical work.
 *
 * Every mutation in a vertical checks a permission, so a member of a business
 * cannot write its records without holding the permission for them. These
 * tests check the ones that were missing: a cashier must not be able to open
 * a member's savings account or take a donation, and must still be able to
 * do the work a cashier does.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as members from "../convex/verticals/members";

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

function contextFor(role: string, extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({
                userId: CALLER,
                businessId: BUSINESS,
                role,
            }),
        ],
        ...extra,
    });
}

describe("a member of a business", () => {
    it("cannot open a member's account without the members permission", async () => {
        const ctx = contextFor("cashier");

        await assert.rejects(
            () =>
                call(members.createMember, ctx, {
                    businessId: BUSINESS,
                    name: "Amina Nakato",
                }),
            /Forbidden/i
        );
    });

    it("can open a member's account when it holds the members permission", async () => {
        const ctx = contextFor("business_owner");

        const memberId = await call(members.createMember, ctx, {
            businessId: BUSINESS,
            name: "Amina Nakato",
        });

        assert.ok(memberId);
    });

    it("cannot take a donation without the income permission", async () => {
        const ctx = contextFor("cashier");

        await assert.rejects(
            () =>
                call(members.recordDonation, ctx, {
                    businessId: BUSINESS,
                    donorName: "Amina Nakato",
                    type: "tithe",
                    amount: 50_000,
                }),
            /Forbidden/i
        );
    });

    it("can take a donation when it holds the income permission", async () => {
        const ctx = contextFor("accountant");

        const donationId = await call(members.recordDonation, ctx, {
            businessId: BUSINESS,
            donorName: "Amina Nakato",
            type: "tithe",
            amount: 50_000,
        });

        assert.ok(donationId);
    });

    it("cannot move money in a member's account without the permission", async () => {
        const ctx = contextFor("cashier");

        await assert.rejects(
            () =>
                call(members.recordMemberTransaction, ctx, {
                    businessId: BUSINESS,
                    memberId: "members_1",
                    type: "deposit",
                    amount: 50_000,
                }),
            /Forbidden/i
        );
    });
});
