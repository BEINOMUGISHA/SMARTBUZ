/**
 * SMARTBUZ — regression tests for the defects the master audit found.
 *
 * Each of these describes a defect that was found in production code, in
 * the way it was found, and asserts that the fixed code no longer does it.
 * They are here so that the same defect cannot come back quietly.
 *
 * The situations worked out by hand first:
 *
 *   - a sign-in attempt that is wrong, five times, and then one more
 *   - a sign-in attempt against an address that has no account at all
 *   - a business with no subscription trying to record a sale
 *   - a business whose plan does not include the sales module
 *   - a till that was never registered trying to push its queue
 *   - the migration being run by a tenant administrator
 *   - an email address being asked for a reset twice in a minute
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";

import * as users from "../convex/users";
import * as migration from "../convex/migration";
import * as sync from "../convex/sync";
import * as subscriptions from "../convex/subscriptions";
import * as sales from "../convex/sales";
import * as reports from "../convex/reports";
import * as subscriptionState from "../convex/subscriptionState";
import { MAX_FAILED_ATTEMPTS } from "../convex/loginThrottle";

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

/** Invoke a Convex mutation or query handler directly. */
async function call(
    registered: unknown,
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<any> {
    const handler = (registered as { _handler: Function })._handler;
    return await handler(ctx, args);
}

/** The message a failed call produced. */
async function messageOf(fn: () => Promise<unknown>): Promise<string> {
    try {
        await fn();
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
    return "";
}

function ownerContext(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role: "owner" }),
        ],
        subscriptions: [makeActiveSubscription()],
        ...extra,
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * The sign-in throttle
 * ──────────────────────────────────────────────────────────────────────── */

describe("the sign-in throttle", () => {
    it("locks an address out after too many wrong passwords", async () => {
        const ctx = signedInContext({
            users: [
                makeUser({
                    _id: CALLER,
                    email: "owner@example.com",
                    password: bcrypt.hashSync("correct-horse", 10),
                }),
            ],
        });

        // Every one of these is wrong.
        for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
            const message = await messageOf(() =>
                call(users.login, ctx, {
                    email: "owner@example.com",
                    password: "wrong",
                })
            );
            assert.match(message, /Invalid email or password/);
        }

        // The next one is refused before the password is even checked.
        const locked = await messageOf(() =>
            call(users.login, ctx, {
                email: "owner@example.com",
                password: "wrong",
            })
        );
        assert.match(locked, /Too many failed sign-in attempts/);
    });

    it("refuses a correct password while the address is locked out", async () => {
        const ctx = signedInContext({
            users: [
                makeUser({
                    _id: CALLER,
                    email: "owner@example.com",
                    password: bcrypt.hashSync("correct-horse", 10),
                }),
            ],
        });

        for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
            await messageOf(() =>
                call(users.login, ctx, {
                    email: "owner@example.com",
                    password: "wrong",
                })
            );
        }

        const locked = await messageOf(() =>
            call(users.login, ctx, {
                email: "owner@example.com",
                password: "correct-horse",
            })
        );
        assert.match(locked, /Too many failed sign-in attempts/);
    });

    it("counts an address that has no account, so it cannot be used to find out which addresses have one", async () => {
        const ctx = signedInContext({ users: [] });

        for (let attempt = 0; attempt < MAX_FAILED_ATTEMPTS; attempt++) {
            const message = await messageOf(() =>
                call(users.login, ctx, {
                    email: "nobody@example.com",
                    password: "wrong",
                })
            );
            assert.match(message, /Invalid email or password/);
        }

        // The same refusal an account that exists would give.
        const locked = await messageOf(() =>
            call(users.login, ctx, {
                email: "nobody@example.com",
                password: "wrong",
            })
        );
        assert.match(locked, /Too many failed sign-in attempts/);

        // And the row exists for the address that has no account.
        const rows = (ctx as any).tables.loginAttempts;
        assert.equal(rows.length, 1);
        assert.equal(rows[0].email, "nobody@example.com");
    });

    it("starts again from zero after a correct password", async () => {
        const ctx = signedInContext({
            users: [
                makeUser({
                    _id: CALLER,
                    email: "owner@example.com",
                    password: bcrypt.hashSync("correct-horse", 10),
                }),
            ],
        });

        await messageOf(() =>
            call(users.login, ctx, {
                email: "owner@example.com",
                password: "wrong",
            })
        );
        await call(users.login, ctx, {
            email: "owner@example.com",
            password: "correct-horse",
        });

        // The failure count was cleared by the successful sign-in.
        assert.equal((ctx as any).tables.loginAttempts.length, 0);

        // And a wrong password is once again just a wrong password.
        const message = await messageOf(() =>
            call(users.login, ctx, {
                email: "owner@example.com",
                password: "wrong",
            })
        );
        assert.match(message, /Invalid email or password/);
    });

    it("re-hashes a password that was stored with a weaker cost factor", async () => {
        const weak = bcrypt.hashSync("correct-horse", 10);
        const ctx = signedInContext({
            users: [
                makeUser({
                    _id: CALLER,
                    email: "owner@example.com",
                    password: weak,
                }),
            ],
        });

        await call(users.login, ctx, {
            email: "owner@example.com",
            password: "correct-horse",
        });

        const stored = (ctx as any).tables.users[0].password as string;
        assert.notEqual(stored, weak);
        // The cost factor is written into the hash itself.
        const cost = Number(/^\$2[aby]\$(\d{2})\$/.exec(stored)?.[1] ?? "0");
        assert.ok(cost >= 12, `expected a cost of at least 12, got ${cost}`);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The unlicensed tenant
 * ──────────────────────────────────────────────────────────────────────── */

describe("a business with no subscription", () => {
    it("cannot record anything new", async () => {
        const ctx = ownerContext({ subscriptions: [] });

        const message = await messageOf(() =>
            call(
                sales.create,
                ctx,
                {
                    items: [{ stockId: "stocks_1", quantity: 1, price: 1000 }],
                    paymentMode: "cash",
                }
            )
        );

        assert.match(message, /subscription|plan|trial/i);
    });

    it("is not given every entitlement", () => {
        const snapshot = subscriptionState.planHasFeature(
            { features: [] } as never,
            "core.sales"
        );
        assert.equal(snapshot, false);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The till that was never registered
 * ──────────────────────────────────────────────────────────────────────── */

describe("the device limit", () => {
    it("refuses a queue pushed from a device that was never registered", async () => {
        const ctx = ownerContext({ devices: [] });

        const message = await messageOf(() =>
            call(sync.pushTransactions, ctx, {
                deviceId: "never-registered",
                transactions: [],
            })
        );

        assert.match(message, /not registered/i);
    });

    it("refuses a queue pushed from a device that has been revoked", async () => {
        const ctx = ownerContext({
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: "till-1",
                    status: "revoked",
                    registeredAt: "2026-01-01T00:00:00.000Z",
                },
            ],
        });

        const message = await messageOf(() =>
            call(sync.pushTransactions, ctx, {
                deviceId: "till-1",
                transactions: [],
            })
        );

        assert.match(message, /revoked/i);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The migration
 * ──────────────────────────────────────────────────────────────────────── */

describe("the migration", () => {
    it("refuses to run without the server-to-backend secret", async () => {
        const ctx = ownerContext();

        const message = await messageOf(() =>
            call(migration.migrationStatus, ctx, {})
        );

        assert.match(message, /secret|Forbidden/i);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The plan that was chosen but not paid for
 * ──────────────────────────────────────────────────────────────────────── */

describe("choosing a plan", () => {
    it("does not move a business to a paid plan until the payment is confirmed", async () => {
        // The business is on the starter plan and asks for the business
        // plan. Asking is not paying: the plan only changes when a payment
        // for it has been confirmed.
        const ctx = ownerContext({
            subscriptions: [makeActiveSubscription({ planKey: "starter" })],
        });

        const result = await call(subscriptions.selectPlan, ctx, {
            planKey: "business",
        });

        assert.equal(result.changed, false);
        assert.equal(result.requiresPayment, true);
        assert.equal(result.planKey, "starter");
        assert.equal(result.pendingPlanKey, "business");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The email that was sent twice
 * ──────────────────────────────────────────────────────────────────────── */

describe("sending email", () => {
    it("refuses a second email to the same address inside the cooldown", async () => {
        const ctx = signedInContext({
            users: [
                makeUser({
                    _id: CALLER,
                    email: "owner@example.com",
                    emailVerified: false,
                }),
            ],
        });

        // The first one is allowed.
        await call(users.requestVerification, ctx, { email: "owner@example.com" });

        // The second one inside the minute is not.
        const message = await messageOf(() =>
            call(users.requestVerification, ctx, { email: "owner@example.com" })
        );
        assert.match(message, /already been sent/i);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The VAT that was never recorded
 * ──────────────────────────────────────────────────────────────────────── */

describe("the VAT on a sale", () => {
    it("records the tax split on the sale, worked out on the server", async () => {
        // A business that pays VAT at 18%, with the price including it.
        const ctx = ownerContext({
            businesses: [
                makeBusiness({
                    _id: BUSINESS,
                    ownerId: CALLER,
                    taxEnabled: true,
                    taxRate: 18,
                    taxInclusive: true,
                }),
            ],
            stocks: [
                makeStock({ _id: "stocks_1", qty: 10, price: 11_800 }),
            ],
        });

        await call(sales.create, ctx, {
            clientType: "Non-Member",
            manualCustomerName: "Walk-in",
            paymentMode: "Cash",
            total: 11_800,
            items: [
                {
                    stockId: "stocks_1",
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    price: 11_800,
                    quantity: 1,
                },
            ],
        });

        const rows = (ctx as any).tables.sales;
        assert.equal(rows.length, 1);

        // 11,800 includes 18% VAT: the tax is 11,800 × 18/118 = 1,800,
        // and what is left of it is 10,000.
        assert.equal(rows[0].taxAmount, 1_800);
        assert.equal(rows[0].netAmount, 10_000);
        assert.equal(rows[0].taxRate, 18);
        assert.equal(rows[0].taxInclusive, true);
    });

    it("records no tax for a business that does not charge it", async () => {
        const ctx = ownerContext({
            stocks: [
                makeStock({ _id: "stocks_1", qty: 10, price: 11_800 }),
            ],
        });

        await call(sales.create, ctx, {
            clientType: "Non-Member",
            manualCustomerName: "Walk-in",
            paymentMode: "Cash",
            total: 11_800,
            items: [
                {
                    stockId: "stocks_1",
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    price: 11_800,
                    quantity: 1,
                },
            ],
        });

        const rows = (ctx as any).tables.sales;
        assert.equal(rows[0].taxAmount, 0);
        assert.equal(rows[0].netAmount, 11_800);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The report that dropped a day
 * ──────────────────────────────────────────────────────────────────────── */

describe("the report period", () => {
    it("includes the last day of the range", async () => {
        const ctx = ownerContext({
            sales: [
                {
                    _id: "sales_1",
                    businessId: BUSINESS,
                    date: "2026-01-31T09:00:00.000Z",
                    total: 1000,
                    items: [],
                    invoiceNumber: "INV-1",
                },
            ],
        });

        const result = await call(reports.getSalesAndExpenses, ctx, {
            startDate: "2026-01-01",
            endDate: "2026-01-31",
        });

        assert.equal(result.sales.length, 1);
        assert.equal(result.sales[0]._id, "sales_1");
    });
});
