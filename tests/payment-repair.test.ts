/**
 * SMARTBUZ — regression tests for the automatic payment repair.
 *
 * The defect: a mobile-money collection whose callback never arrived left
 * the customer having paid and the books not knowing. Nothing went and
 * asked the provider what happened, so the payment sat there for ever.
 *
 * These tests cover the three decisions the repair makes — when to ask,
 * what the answer means, and when a person has to look — and the bookkeeping
 * that makes the "a person has to look" part real rather than a promise.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    classifyProviderStatus,
    isOldEnoughToAsk,
    needsHumanReview,
    DEFAULT_REPAIR_MAX_ATTEMPTS,
    DEFAULT_REPAIR_MIN_AGE_MINUTES,
} from "../convex/integrations/paymentRepair";
import * as payments from "../convex/integrations/payments";

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
        ...extra,
    });
}

/** A payment intent waiting for the provider. */
function makeIntent(overrides: Record<string, unknown> = {}): FakeRow {
    return {
        _id: "paymentIntents_1",
        _creationTime: 1,
        businessId: BUSINESS,
        adapterKey: "mtn.momo",
        provider: "MTN",
        reference: "ref-1",
        amount: 12_000,
        currency: "UGX",
        status: "pending",
        createdAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        updatedAt: new Date().toISOString(),
        ...overrides,
    };
}

describe("when the repair asks the provider", () => {
    it("leaves a payment that is still in flight alone", () => {
        const justStarted = new Date(Date.now() - 30 * 1000).toISOString();
        assert.equal(isOldEnoughToAsk(justStarted), false);
    });

    it("asks about a payment whose callback never arrived", () => {
        const stuck = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        assert.equal(isOldEnoughToAsk(stuck), true);
    });

    it("waits the agreed time before asking", () => {
        const twoMinutesAgo = new Date(
            Date.now() - (DEFAULT_REPAIR_MIN_AGE_MINUTES * 60 + 5) * 1000
        ).toISOString();
        const aMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();

        assert.equal(isOldEnoughToAsk(twoMinutesAgo), true);
        assert.equal(isOldEnoughToAsk(aMinuteAgo), false);
    });

    it("does not ask about a payment whose date it cannot read", () => {
        assert.equal(isOldEnoughToAsk("not a date"), false);
    });
});

describe("what the provider's answer means", () => {
    it("repairs the payment when the money was taken", () => {
        assert.equal(classifyProviderStatus("succeeded"), "repaired");
    });

    it("closes the payment when the money was not taken", () => {
        assert.equal(classifyProviderStatus("failed"), "failed");
    });

    it("waits when the provider has not settled either way", () => {
        assert.equal(classifyProviderStatus("pending"), "waiting");
        assert.equal(classifyProviderStatus("unknown"), "waiting");
    });
});

describe("when a person has to look", () => {
    it("keeps trying for a while", () => {
        assert.equal(needsHumanReview(1), false);
        assert.equal(needsHumanReview(DEFAULT_REPAIR_MAX_ATTEMPTS - 1), false);
    });

    it("asks for a person once it has tried enough", () => {
        assert.equal(needsHumanReview(DEFAULT_REPAIR_MAX_ATTEMPTS), true);
        assert.equal(needsHumanReview(DEFAULT_REPAIR_MAX_ATTEMPTS + 1), true);
    });
});

describe("the repair in the database", () => {
    it("only looks at the business's own payments", async () => {
        const ctx = ownerContext({
            paymentIntents: [
                makeIntent({ _id: "paymentIntents_1", reference: "mine" }),
                makeIntent({
                    _id: "paymentIntents_2",
                    reference: "theirs",
                    businessId: "businesses_2",
                }),
            ],
        });

        const unsettled = asList(
            await call(payments.listUnsettledIntents, ctx, { businessId: BUSINESS })
        );

        assert.equal(unsettled.length, 1);
        assert.equal(asRecord(unsettled[0]).reference, "mine");
    });

    it("leaves a payment that is still in flight alone", async () => {
        const ctx = ownerContext({
            paymentIntents: [
                makeIntent({
                    _id: "paymentIntents_1",
                    reference: "in-flight",
                    createdAt: new Date(Date.now() - 5 * 1000).toISOString(),
                }),
            ],
        });

        const unsettled = asList(
            await call(payments.listUnsettledIntents, ctx, { businessId: BUSINESS })
        );

        assert.equal(unsettled.length, 0);
    });

    it("counts the attempts and puts the payment in front of a person", async () => {
        const ctx = ownerContext({
            paymentIntents: [
                makeIntent({ _id: "paymentIntents_1", reference: "stuck" }),
            ],
        });

        await call(payments.recordRepairAttempt, ctx, {
            businessId: BUSINESS,
            reference: "stuck",
            error: "The provider did not answer.",
            needsReview: true,
        });

        const intent = await ctx.db.get("paymentIntents_1");
        assert.equal(intent?.repairAttempts, 1);
        assert.equal(intent?.needsReview, true);
        assert.ok(intent?.lastRepairAt, "the attempt is dated");
        assert.equal(intent?.error, "The provider did not answer.");
    });

    it("counts every attempt", async () => {
        const ctx = ownerContext({
            paymentIntents: [
                makeIntent({ _id: "paymentIntents_1", reference: "stuck" }),
            ],
        });

        await call(payments.recordRepairAttempt, ctx, {
            businessId: BUSINESS,
            reference: "stuck",
        });
        await call(payments.recordRepairAttempt, ctx, {
            businessId: BUSINESS,
            reference: "stuck",
        });

        const intent = await ctx.db.get("paymentIntents_1");
        assert.equal(intent?.repairAttempts, 2);
    });

    it("does not touch another business's payment", async () => {
        const ctx = ownerContext({
            paymentIntents: [
                makeIntent({
                    _id: "paymentIntents_1",
                    reference: "theirs",
                    businessId: "businesses_2",
                }),
            ],
        });

        await call(payments.recordRepairAttempt, ctx, {
            businessId: BUSINESS,
            reference: "theirs",
        });

        const intent = await ctx.db.get("paymentIntents_1");
        assert.equal(intent?.repairAttempts, undefined);
    });

    it("shows the owner the payments that need a person", async () => {
        const ctx = ownerContext({
            paymentIntents: [
                makeIntent({
                    _id: "paymentIntents_1",
                    reference: "needs-a-person",
                    needsReview: true,
                    repairAttempts: 3,
                }),
                makeIntent({
                    _id: "paymentIntents_2",
                    reference: "still-trying",
                    repairAttempts: 1,
                }),
            ],
        });

        const waiting = asList(
            await call(payments.listPaymentsNeedingReview, ctx, { businessId: BUSINESS })
        );

        assert.equal(waiting.length, 1);
        assert.equal(asRecord(waiting[0]).reference, "needs-a-person");
        assert.equal(asRecord(waiting[0]).attempts, 3);
    });
});
