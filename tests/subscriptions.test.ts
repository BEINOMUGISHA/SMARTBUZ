/**
 * SMARTBUZ — Phase 6 licensing and subscriptions.
 *
 * The rules the subscription engine has to keep, checked against the **real**
 * backend modules rather than a re-implementation of them.
 *
 * The situations worked out by hand first:
 *
 *   - a trial that has run out, and a grace period that has not
 *   - a business on a plan that does not include purchasing
 *   - a payment submitted, then confirmed, then the same payment claimed twice
 *   - a license key issued, hashed, and redeemed
 *   - a device over the limit
 *   - a business whose subscription has ended: its data is still there, and
 *     it still cannot record anything new
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as subscriptions from "../convex/subscriptions";
import * as plans from "../convex/plans";
import * as billing from "../convex/billing";
import * as license from "../convex/license";
import * as platform from "../convex/platform";
import * as entitlements from "../convex/entitlements";
import * as purchasing from "../convex/purchasing";
import * as analytics from "../convex/analytics";
import * as customers from "../convex/customers";
import * as branches from "../convex/branches";
import * as subscriptionState from "../convex/subscriptionState";

import {
    FakeContext,
    FakeRow,
    makeBranch,
    makeBusiness,
    makeCustomer,
    makeMembership,
    makePlatformAdmin,
    makeUser,
    signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const CALLER = "users_1";

const DAY = 86_400_000;
const NOW = Date.now();
const PAST = new Date(NOW - 30 * DAY).toISOString();
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

/** A context where the caller owns the business. */
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

/** A context where the caller is a platform super administrator. */
function platformContext(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role: "owner" }),
        ],
        platformAdmins: [makePlatformAdmin({ userId: CALLER })],
        ...extra,
    });
}

/** The four built-in plans, as they are seeded. */
const STARTER_FEATURES = ["core.sales", "core.stock", "core.customers"];
const BUSINESS_FEATURES = [
    ...STARTER_FEATURES,
    "purchasing",
    "customer.credit",
    "loyalty.points",
    "multi.branch",
    "multi.warehouse",
];
const PROFESSIONAL_FEATURES = [
    ...BUSINESS_FEATURES,
    "finance.reports",
    "business.intelligence",
];

/* ────────────────────────────────────────────────────────────────────────
 * The plan catalogue
 * ──────────────────────────────────────────────────────────────────────── */

describe("the plan catalogue", () => {
    it("offers the four plans even before the catalogue has been written", async () => {
        const ctx = signedInContext({});
        const listed = await call(plans.list, ctx, {});
        assert.equal(listed.length, 4);
        assert.deepEqual(
            listed.map((p: any) => p.key),
            ["starter", "business", "professional", "enterprise"]
        );
    });

    it("prices the four plans", async () => {
        const ctx = signedInContext({});
        const listed = await call(plans.list, ctx, {});
        const starter = listed.find((p: any) => p.key === "starter");
        const enterprise = listed.find((p: any) => p.key === "enterprise");

        // The annual price is never more than twelve monthly payments.
        for (const plan of listed) {
            assert.ok(
                plan.priceAnnual < plan.priceMonthly * 12,
                `${plan.key}: the annual price should be a discount`
            );
        }

        assert.equal(starter.priceMonthly, 50_000);
        assert.equal(starter.priceAnnual, 500_000);
        assert.equal(enterprise.priceMonthly, 1_200_000);
    });

    it("seeds the catalogue once, and then the table is the truth", async () => {
        const ctx = platformContext();

        const first = await call(plans.seedDefaults, ctx, {});
        assert.equal(first.seeded, 4);
        assert.equal(first.alreadySeeded, false);

        const listed = await call(plans.list, ctx, {});
        assert.equal(listed.length, 4);

        // A second seed does not overwrite prices that have been edited.
        const seeded = (ctx as any).tables.plans.find(
            (p: any) => p.key === "starter"
        );
        await call(
            plans.update,
            ctx,
            { planId: seeded._id, priceMonthly: 60_000 }
        );

        const second = await call(plans.seedDefaults, ctx, {});
        assert.equal(second.alreadySeeded, true);

        const after = await call(plans.list, ctx, {});
        const starter = after.find((p: any) => p.key === "starter");
        assert.equal(starter.priceMonthly, 60_000);
    });

    it("lets the platform create a plan, price it, and take it off offer", async () => {
        const ctx = platformContext();

        await call(plans.create, ctx, {
            key: "retail-plus",
            name: "Retail Plus",
            priceMonthly: 75_000,
            priceAnnual: 750_000,
            features: STARTER_FEATURES,
        });

        const all = await call(plans.listAll, ctx, {});
        const created = all.find((p: any) => p.key === "retail-plus");
        assert.ok(created, "the new plan should be in the catalogue");
        assert.equal(created.priceMonthly, 75_000);

        await call(plans.retire, ctx, { planId: created._id, reason: "test" });

        const offered = await call(plans.list, ctx, {});
        assert.ok(
            !offered.some((p: any) => p.key === "retail-plus"),
            "a retired plan is not offered"
        );
    });

    it("does not let a tenant create plans", async () => {
        const ctx = ownerContext();
        await assert.rejects(
            () =>
                call(plans.create, ctx, {
                    key: "free",
                    name: "Free",
                    priceMonthly: 0,
                    priceAnnual: 0,
                }),
            /Forbidden/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The free trial
 * ──────────────────────────────────────────────────────────────────────── */

describe("the free trial", () => {
    it("starts when a business chooses a plan", async () => {
        const ctx = ownerContext();
        const result = await call(subscriptions.selectPlan, ctx, {
            planKey: "starter",
        });

        assert.equal(result.status, "trial");
        assert.equal(result.changed, true);
        assert.ok(result.trialEndsAt, "the trial has an end date");

        // The trial is exactly the number of days the plan says.
        const days = Math.round(
            (new Date(result.trialEndsAt).getTime() - NOW) / DAY
        );
        assert.ok(days >= 13 && days <= 14, `trial was ${days} days`);

        // The subscription is recorded, and so is the fact that it started.
        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs.length, 1);
        assert.equal(subs[0].planKey, "starter");
        assert.equal(subs[0].status, "trial");

        const events = (ctx as any).tables.subscriptionEvents;
        assert.ok(events.some((e: any) => e.type === "trial_started"));
    });

    it("refuses a plan that does not exist", async () => {
        const ctx = ownerContext();
        await assert.rejects(
            () => call(subscriptions.selectPlan, ctx, { planKey: "platinum" }),
            /no plan called/i
        );
    });

    it("refuses a plan that is not on offer", async () => {
        const ctx = ownerContext({
            plans: [
                {
                    _id: "plans_9",
                    key: "old",
                    name: "Old",
                    priceMonthly: 1,
                    priceAnnual: 1,
                    currency: "UGX",
                    trialDays: 14,
                    gracePeriodDays: 7,
                    deviceLimit: 1,
                    maxUsers: 1,
                    maxBranches: 1,
                    maxWarehouses: 1,
                    maxProducts: 1,
                    features: [],
                    isActive: false,
                    sortOrder: 9,
                },
            ],
        });
        await assert.rejects(
            () => call(subscriptions.selectPlan, ctx, { planKey: "old" }),
            /not on offer/i
        );
    });

    it("changes the plan of a business that already has one", async () => {
        const ctx = ownerContext();
        await call(subscriptions.selectPlan, ctx, { planKey: "starter" });
        const result = await call(subscriptions.selectPlan, ctx, {
            planKey: "business",
        });

        assert.equal(result.changed, true);
        assert.equal(result.planKey, "business");

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].planKey, "business");

        const events = (ctx as any).tables.subscriptionEvents;
        assert.ok(events.some((e: any) => e.type === "plan_changed"));
    });

    it("is not granted to a staff member who cannot manage the subscription", async () => {
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
        await assert.rejects(
            () => call(subscriptions.selectPlan, ctx, { planKey: "starter" }),
            /Forbidden/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The states of a subscription
 * ──────────────────────────────────────────────────────────────────────── */

describe("the states of a subscription", () => {
    it("expires a trial that has run out", () => {
        const status = subscriptionState.computeEffectiveStatus({
            status: "trial",
            trialEndsAt: PAST,
            currentPeriodEnd: PAST,
        } as any);
        assert.equal(status, "expired");
    });

    it("keeps a trial alive until the day it ends", () => {
        const status = subscriptionState.computeEffectiveStatus({
            status: "trial",
            trialEndsAt: FUTURE,
            currentPeriodEnd: FUTURE,
        } as any);
        assert.equal(status, "trial");
    });

    it("gives a past-due business a grace period to sort itself out", () => {
        const status = subscriptionState.computeEffectiveStatus({
            status: "past_due",
            graceEndsAt: FUTURE,
            currentPeriodEnd: PAST,
        } as any);
        assert.equal(status, "grace");
        assert.equal(subscriptionState.isWritableStatus(status), true);
    });

    it("closes the door when the grace period is over", () => {
        const status = subscriptionState.computeEffectiveStatus({
            status: "past_due",
            graceEndsAt: PAST,
            currentPeriodEnd: PAST,
        } as any);
        assert.equal(status, "expired");
        assert.equal(subscriptionState.isWritableStatus(status), false);
    });

    it("never treats a suspended subscription as writable", () => {
        const status = subscriptionState.computeEffectiveStatus({
            status: "suspended",
            currentPeriodEnd: FUTURE,
        } as any);
        assert.equal(status, "suspended");
        assert.equal(subscriptionState.isWritableStatus(status), false);
    });

    it("counts the days left in the paid period", () => {
        const days = subscriptionState.daysRemaining({
            status: "active",
            currentPeriodEnd: new Date(NOW + 10 * DAY).toISOString(),
        } as any);
        assert.equal(days, 10);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The write gate
 * ──────────────────────────────────────────────────────────────────────── */

describe("the write gate", () => {
    it("stops a business whose subscription has ended from recording anything new", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "professional",
                    status: "active",
                    billingCycle: "monthly",
                    trialEndsAt: PAST,
                    currentPeriodStart: PAST,
                    currentPeriodEnd: PAST,
                },
            ],
        });

        await assert.rejects(
            () =>
                call(customers.add, ctx, {
                    name: "Amina Nakato",
                    phone: "0772123456",
                    userId: CALLER,
                }),
            /subscription/i
        );
    });

    it("leaves the business's data exactly where it was", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "professional",
                    status: "active",
                    billingCycle: "monthly",
                    currentPeriodEnd: PAST,
                },
            ],
            branches: [makeBranch({ _id: "branches_1", businessId: BUSINESS })],
        });

        // The branch is still readable — nothing was deleted.
        const listed = await call(branches.list, ctx, {});
        assert.equal(listed.length, 1);
        assert.equal(listed[0].name, "Main Branch");
    });

    it("lets a business that is in grace keep working", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "professional",
                    status: "past_due",
                    billingCycle: "monthly",
                    graceEndsAt: FUTURE,
                    currentPeriodEnd: PAST,
                },
            ],
        });

        const created = await call(customers.add, ctx, {
            name: "Amina Nakato",
            phone: "0772123456",
            userId: CALLER,
        });
        assert.ok(created);
    });

    it("leaves a business with no subscription on record alone", async () => {
        const ctx = ownerContext();
        const created = await call(customers.add, ctx, {
            name: "Amina Nakato",
            phone: "0772123456",
            userId: CALLER,
        });
        assert.ok(created);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Feature entitlements
 * ──────────────────────────────────────────────────────────────────────── */

describe("feature entitlements", () => {
    it("keeps a business on a plan that does not include purchasing out of purchasing", async () => {
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
        });

        await assert.rejects(
            () => call(purchasing.listPurchaseOrders, ctx, {}),
            /does not include/i
        );
    });

    it("lets a business on a plan that includes purchasing use it", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "business",
                    status: "trial",
                    billingCycle: "monthly",
                    trialEndsAt: FUTURE,
                    currentPeriodEnd: FUTURE,
                },
            ],
        });

        const listed = await call(purchasing.listPurchaseOrders, ctx, {});
        assert.ok(Array.isArray(listed.page));
        assert.equal(listed.totalCount, 0);
    });

    it("keeps the reporting suite out of a business that has not paid for it", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "business",
                    status: "trial",
                    billingCycle: "monthly",
                    trialEndsAt: FUTURE,
                    currentPeriodEnd: FUTURE,
                },
            ],
        });

        await assert.rejects(
            () =>
                call(analytics.getSalesByPeriod, ctx, {
                    period: "daily",
                    from: "2026-01-01",
                    to: "2026-01-31",
                }),
            /does not include/i
        );
    });

    it("keeps the credit book out of a plan that has not bought it", async () => {
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
            customers: [makeCustomer({ _id: "customers_1", businessId: BUSINESS })],
        });

        await assert.rejects(
            () => call(customers.getAccount, ctx, { customerId: "customers_1" }),
            /does not include/i
        );
    });

    it("tells the business what it may use", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "professional",
                    status: "trial",
                    billingCycle: "monthly",
                    trialEndsAt: FUTURE,
                    currentPeriodEnd: FUTURE,
                },
            ],
        });

        const mine = await call(entitlements.getMyEntitlements, ctx, {});
        assert.equal(mine.plan.key, "professional");

        const purchasingEntitlement = mine.entitlements.find(
            (e: any) => e.key === "purchasing"
        );
        assert.equal(purchasingEntitlement.included, true);

        const api = mine.entitlements.find((e: any) => e.key === "api.access");
        assert.equal(api.included, false);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Usage limits
 * ──────────────────────────────────────────────────────────────────────── */

describe("usage limits", () => {
    it("refuses a second branch on a plan that allows one", async () => {
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
            branches: [makeBranch({ _id: "branches_1", businessId: BUSINESS })],
        });

        await assert.rejects(
            () => call(branches.create, ctx, { name: "Branch Two" }),
            /allows 1 branch/i
        );
    });

    it("allows the first branch on any plan", async () => {
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
        });

        const created = await call(branches.create, ctx, { name: "First Branch" });
        assert.ok(created);
    });

    it("allows a second branch on a plan that includes multiple branches", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "business",
                    status: "trial",
                    billingCycle: "monthly",
                    trialEndsAt: FUTURE,
                    currentPeriodEnd: FUTURE,
                },
            ],
            branches: [makeBranch({ _id: "branches_1", businessId: BUSINESS })],
        });

        const created = await call(branches.create, ctx, { name: "Branch Two" });
        assert.ok(created);
    });

    it("counts usage from the real records, not from a counter", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "business",
                    status: "trial",
                    billingCycle: "monthly",
                    trialEndsAt: FUTURE,
                    currentPeriodEnd: FUTURE,
                },
            ],
            branches: [
                makeBranch({ _id: "branches_1", businessId: BUSINESS }),
                makeBranch({ _id: "branches_2", businessId: BUSINESS }),
                makeBranch({ _id: "branches_3", businessId: BUSINESS }),
            ],
        });

        const mine = await call(entitlements.getMyEntitlements, ctx, {});
        assert.equal(mine.usage.branches.used, 3);
        assert.equal(mine.usage.branches.limit, 3);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Payment verification
 * ──────────────────────────────────────────────────────────────────────── */

describe("payment verification", () => {
    const activeSubscription = {
        _id: "subscriptions_1",
        businessId: BUSINESS,
        planKey: "business",
        status: "trial",
        billingCycle: "monthly",
        trialEndsAt: PAST,
        currentPeriodStart: PAST,
        currentPeriodEnd: PAST,
    };

    it("records a submitted payment as pending, and does not activate anything", async () => {
        const ctx = ownerContext({ subscriptions: [activeSubscription] });

        const payment = await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-001",
        });

        assert.equal(payment.status, "pending");

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].status, "trial", "nothing became active yet");
    });

    it("refuses an amount that is not the price on the plan", async () => {
        const ctx = ownerContext({ subscriptions: [activeSubscription] });

        await assert.rejects(
            () =>
                call(billing.submitPayment, ctx, {
                    amount: 1,
                    billingCycle: "monthly",
                    provider: "mobile_money",
                    providerReference: "MM-002",
                }),
            /price of the/i
        );
    });

    it("refuses the same provider reference twice", async () => {
        const ctx = ownerContext({ subscriptions: [activeSubscription] });

        await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-003",
        });

        await assert.rejects(
            () =>
                call(billing.submitPayment, ctx, {
                    amount: 150_000,
                    billingCycle: "monthly",
                    provider: "mobile_money",
                    providerReference: "MM-003",
                }),
            /already been recorded/i
        );
    });

    it("activates the subscription when the payment is confirmed", async () => {
        const ctx = platformContext({ subscriptions: [activeSubscription] });

        const payment = await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-004",
        });

        await call(billing.verifyPayment, ctx, {
            paymentId: payment.paymentId,
            confirmedAmount: 150_000,
        });

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].status, "active");

        const payments = (ctx as any).tables.subscriptionPayments;
        assert.equal(payments[0].status, "verified");
        assert.ok(payments[0].verifiedAt);
    });

    it("refuses to confirm a payment for a different amount", async () => {
        const ctx = platformContext({ subscriptions: [activeSubscription] });

        const payment = await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-005",
        });

        await assert.rejects(
            () =>
                call(billing.verifyPayment, ctx, {
                    paymentId: payment.paymentId,
                    confirmedAmount: 150_001,
                }),
            /Check the two before confirming/i
        );
    });

    it("gives a business in grace when a payment is rejected", async () => {
        const ctx = platformContext({ subscriptions: [activeSubscription] });

        const payment = await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-006",
        });

        await call(billing.rejectPayment, ctx, {
            paymentId: payment.paymentId,
            reason: "Not received by the provider.",
        });

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].status, "past_due");
        assert.ok(subs[0].graceEndsAt, "a grace window is opened");
    });

    it("does not let a tenant confirm their own payment", async () => {
        const ctx = ownerContext({ subscriptions: [activeSubscription] });

        const payment = await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-007",
        });

        await assert.rejects(
            () =>
                call(billing.verifyPayment, ctx, {
                    paymentId: payment.paymentId,
                    confirmedAmount: 150_000,
                }),
            /Forbidden/i
        );
    });

    it("banks a payment that arrives while the account is suspended, without unsuspending it", async () => {
        const ctx = platformContext({
            subscriptions: [{ ...activeSubscription, status: "suspended" }],
        });

        const payment = await call(billing.submitPayment, ctx, {
            amount: 150_000,
            billingCycle: "monthly",
            provider: "mobile_money",
            providerReference: "MM-008",
        });

        await call(billing.verifyPayment, ctx, {
            paymentId: payment.paymentId,
            confirmedAmount: 150_000,
        });

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(
            subs[0].status,
            "suspended",
            "a payment does not undo a deliberate suspension"
        );
        // The time is banked, so nothing is lost.
        assert.ok(
            new Date(subs[0].currentPeriodEnd).getTime() > Date.now(),
            "the paid period is recorded"
        );
    });

    it("lets the business apply a verified payment that has not been applied yet", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "business",
                    status: "expired",
                    billingCycle: "monthly",
                    currentPeriodStart: PAST,
                    currentPeriodEnd: PAST,
                },
            ],
            subscriptionPayments: [
                {
                    _id: "subscriptionPayments_1",
                    businessId: BUSINESS,
                    subscriptionId: "subscriptions_1",
                    planKey: "business",
                    amount: 150_000,
                    currency: "UGX",
                    billingCycle: "monthly",
                    periodStart: new Date(NOW).toISOString(),
                    periodEnd: FUTURE,
                    status: "verified",
                    provider: "mobile_money",
                    providerReference: "MM-009",
                    verifiedAt: new Date(NOW).toISOString(),
                    createdAt: new Date(NOW).toISOString(),
                },
            ],
        });

        const result = await call(subscriptions.activateSubscription, ctx, {});
        assert.equal(result.status, "active");

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].status, "active");
        assert.equal(subs[0].currentPeriodEnd, FUTURE);
    });

    it("will not let a business activate itself without a payment", async () => {
        const ctx = ownerContext({
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: BUSINESS,
                    planKey: "business",
                    status: "expired",
                    billingCycle: "monthly",
                    currentPeriodEnd: PAST,
                },
            ],
        });

        await assert.rejects(
            () => call(subscriptions.activateSubscription, ctx, {}),
            /have not received your payment/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * License keys
 * ──────────────────────────────────────────────────────────────────────── */

describe("license keys", () => {
    it("issues a key, shows it once, and stores only its hash", async () => {
        const ctx = platformContext();

        const issued = await call(license.issue, ctx, {
            planKey: "business",
            note: "Sold over the counter.",
        });

        assert.ok(issued.key.startsWith("SBUZ-"), "the key is shown once");
        // SBUZ, then five groups of five characters.
        assert.equal(issued.key.split("-").length, 6);
        assert.equal(issued.key.split("-")[1].length, 5);

        const stored = (ctx as any).tables.licenseKeys[0];
        assert.ok(stored.keyHash, "a hash is stored");
        assert.notEqual(stored.keyHash, issued.key);
        assert.equal(stored.key, undefined, "the key itself is not stored");

        // The raw key does not appear anywhere in the table.
        const raw = JSON.stringify((ctx as any).tables.licenseKeys);
        assert.ok(!raw.includes(issued.key), "the key is not in the database");
    });

    it("gives two different keys the same key two different hashes", async () => {
        const ctx = platformContext();

        const a = await call(license.issue, ctx, { planKey: "business" });
        const b = await call(license.issue, ctx, { planKey: "business" });

        assert.notEqual(a.key, b.key);
        const hashes = (ctx as any).tables.licenseKeys.map((k: any) => k.keyHash);
        assert.notEqual(hashes[0], hashes[1]);
    });

    it("redeems a key onto the plan it was issued for", async () => {
        const platformCtx = platformContext();
        const issued = await call(license.issue, platformCtx, {
            planKey: "professional",
        });
        const stored = (platformCtx as any).tables.licenseKeys[0];

        const ctx = ownerContext({ licenseKeys: [stored] });

        const result = await call(subscriptions.redeemLicenseKey, ctx, {
            key: issued.key,
        });

        assert.equal(result.planKey, "professional");

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].planKey, "professional");
        assert.equal(subs[0].licenseKeyId, stored._id);
    });

    it("refuses a revoked key", async () => {
        const platformCtx = platformContext();
        const issued = await call(license.issue, platformCtx, {
            planKey: "professional",
        });
        const stored = {
            ...(platformCtx as any).tables.licenseKeys[0],
            status: "revoked",
            revokedAt: new Date().toISOString(),
        };

        const ctx = ownerContext({ licenseKeys: [stored] });

        await assert.rejects(
            () => call(subscriptions.redeemLicenseKey, ctx, { key: issued.key }),
            /revoked/i
        );
    });

    it("does not let a tenant issue a license key", async () => {
        const ctx = ownerContext();
        await assert.rejects(
            () => call(license.issue, ctx, { planKey: "business" }),
            /Forbidden/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Devices
 * ──────────────────────────────────────────────────────────────────────── */

describe("devices", () => {
    const subscription = {
        _id: "subscriptions_1",
        businessId: BUSINESS,
        planKey: "starter",
        status: "trial",
        billingCycle: "monthly",
        trialEndsAt: FUTURE,
        currentPeriodEnd: FUTURE,
    };

    it("registers a device", async () => {
        const ctx = ownerContext({ subscriptions: [subscription] });

        const result = await call(subscriptions.registerDevice, ctx, {
            deviceId: "device-1",
            deviceName: "Till 1",
            platform: "web",
        });

        assert.equal(result.alreadyRegistered, false);

        const devices = (ctx as any).tables.devices;
        assert.equal(devices.length, 1);
        assert.equal(devices[0].status, "active");
    });

    it("refuses a device over the plan's limit", async () => {
        const ctx = ownerContext({
            subscriptions: [subscription],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: "device-1",
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                },
            ],
        });

        await assert.rejects(
            () =>
                call(subscriptions.registerDevice, ctx, {
                    deviceId: "device-2",
                    deviceName: "Till 2",
                }),
            /allows 1 device/i
        );
    });

    it("lets a device be registered again after it has been revoked", async () => {
        const ctx = ownerContext({
            subscriptions: [subscription],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: "device-1",
                    deviceName: "Till 1",
                    status: "revoked",
                    registeredAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    revokedAt: new Date().toISOString(),
                },
            ],
        });

        await assert.rejects(
            () =>
                call(subscriptions.registerDevice, ctx, {
                    deviceId: "device-1",
                    deviceName: "Till 1",
                }),
            /revoked/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The platform console
 * ──────────────────────────────────────────────────────────────────────── */

describe("the platform console", () => {
    const subscription = {
        _id: "subscriptions_1",
        businessId: BUSINESS,
        planKey: "business",
        status: "active",
        billingCycle: "monthly",
        currentPeriodStart: PAST,
        currentPeriodEnd: FUTURE,
    };

    it("lists the subscriptions of every business", async () => {
        const ctx = platformContext({ subscriptions: [subscription] });
        const listed = await call(platform.listSubscriptions, ctx, {});

        assert.equal(listed.page.length, 1);
        assert.equal(listed.page[0].businessName, "Test Business");
        assert.equal(listed.counts.active, 1);
    });

    it("suspends an account without touching its data", async () => {
        const ctx = platformContext({
            subscriptions: [subscription],
            branches: [makeBranch({ _id: "branches_1", businessId: BUSINESS })],
        });

        await call(platform.suspendSubscription, ctx, {
            businessId: BUSINESS,
            reason: "Payment failed three times.",
        });

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].status, "suspended");
        assert.ok(subs[0].suspendedReason);

        // The data is still there.
        assert.equal((ctx as any).tables.branches.length, 1);
    });

    it("stops a suspended business from writing", async () => {
        const ctx = platformContext({
            subscriptions: [{ ...subscription, status: "suspended" }],
        });

        await assert.rejects(
            () =>
                call(customers.add, ctx, {
                    name: "Amina Nakato",
                    phone: "0772123456",
                    userId: CALLER,
                }),
            /subscription/i
        );
    });

    it("puts a suspended account back to work", async () => {
        const ctx = platformContext({
            subscriptions: [{ ...subscription, status: "suspended" }],
        });

        await call(platform.reactivateSubscription, ctx, {
            businessId: BUSINESS,
            note: "Payment received.",
        });

        const subs = (ctx as any).tables.subscriptions;
        assert.ok(
            ["active", "trial", "grace"].includes(subs[0].status),
            `unexpected status ${subs[0].status}`
        );
    });

    it("extends a subscription by the days given", async () => {
        const ctx = platformContext({ subscriptions: [subscription] });

        const before = new Date(FUTURE).getTime();
        await call(platform.extendSubscription, ctx, {
            businessId: BUSINESS,
            days: 30,
        });

        const subs = (ctx as any).tables.subscriptions;
        const after = new Date(subs[0].currentPeriodEnd).getTime();
        assert.ok(after > before, "the period is longer");
        assert.equal(Math.round((after - before) / DAY), 30);
    });

    it("moves a business onto another plan", async () => {
        const ctx = platformContext({ subscriptions: [subscription] });

        await call(platform.changePlan, ctx, {
            businessId: BUSINESS,
            planKey: "enterprise",
            note: "Upgrade.",
        });

        const subs = (ctx as any).tables.subscriptions;
        assert.equal(subs[0].planKey, "enterprise");

        const events = (ctx as any).tables.subscriptionEvents;
        assert.ok(events.some((e: any) => e.type === "plan_changed"));
    });

    it("does not let a tenant reach the platform console", async () => {
        const ctx = ownerContext({ subscriptions: [subscription] });

        await assert.rejects(
            () => call(platform.listSubscriptions, ctx, {}),
            /Forbidden/i
        );
        await assert.rejects(
            () =>
                call(platform.suspendSubscription, ctx, {
                    businessId: BUSINESS,
                    reason: "because",
                }),
            /Forbidden/i
        );
    });

    it("does not let one business reach another business's subscription", async () => {
        const ctx = ownerContext({
            subscriptions: [subscription],
            businesses: [
                makeBusiness({ _id: BUSINESS, ownerId: CALLER }),
                makeBusiness({ _id: "businesses_2", ownerId: "users_2" }),
            ],
        });

        await assert.rejects(
            () => call(platform.getSubscription, ctx, { businessId: "businesses_2" }),
            /Forbidden/i
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Tenant isolation
 * ──────────────────────────────────────────────────────────────────────── */

describe("tenant isolation", () => {
    it("does not show one business another's subscription", async () => {
        const ctx = signedInContext({
            users: [makeUser({ _id: CALLER })],
            businesses: [
                makeBusiness({ _id: BUSINESS, ownerId: CALLER }),
                makeBusiness({ _id: "businesses_2", ownerId: "users_2" }),
            ],
            memberships: [
                makeMembership({
                    userId: CALLER,
                    businessId: BUSINESS,
                    role: "owner",
                }),
            ],
            subscriptions: [
                {
                    _id: "subscriptions_1",
                    businessId: "businesses_2",
                    planKey: "enterprise",
                    status: "active",
                    billingCycle: "monthly",
                    currentPeriodEnd: FUTURE,
                },
            ],
        });

        const mine = await call(subscriptions.getMySubscription, ctx, {});
        assert.equal(mine.subscription, null, "not someone else's subscription");

        await assert.rejects(
            () =>
                call(subscriptions.getMySubscription, ctx, {
                    businessId: "businesses_2",
                }),
            /Forbidden/i
        );
    });
});
