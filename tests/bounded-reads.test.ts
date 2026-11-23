/**
 * SMARTBUZ — tests for the reads that were loading a whole table to serve
 * one page.
 *
 * The performance audit (PERF-02, DB-02, DB-03) found that not one of the
 * 352 `.collect()` sites in the backend was bounded. The three that mattered
 * most were:
 *
 *   - the platform audit trail, which read every audit row in the
 *     deployment and then threw away every row that belonged to a business;
 *   - the tenant audit trail, which read the business's whole history to
 *     return one page of it;
 *   - the debt book, which was read whole for every request, and whose
 *     cursor was the *page number* rather than the offset — so the second
 *     page of the list asked for the first page again.
 *
 * These tests cover the behaviour that had to survive the change, because
 * a bounded read that returns the wrong rows is worse than an unbounded
 * one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    FakeContext,
    callHandler,
    makeBusiness,
    makeCustomer,
    makeLoan,
    makeMembership,
    makePlatformAdmin,
    makeSale,
    makeSession,
    makeStock,
    makeStockCostHistory,
    makeUser,
    type FakeRow,
} from "./helpers/fake-context";

import { writeAudit } from "../convex/audit";
import { list as auditList, listPlatform as auditListPlatform } from "../convex/audit";
import { buildCostIndex } from "../convex/financeCore";
import { getLoans } from "../convex/loans";

const USER = "users_1";
const BUSINESS = "businesses_1";

/** What a paginated query answers with. */
type Page = { page: FakeRow[]; isDone: boolean; continueCursor: string };
const OTHER_BUSINESS = "businesses_2";

/** An audit row as the database holds it. */
function auditRow(overrides: Partial<FakeRow> = {}): FakeRow {
    return {
        _id: "auditLogs_1",
        _creationTime: 1,
        businessId: BUSINESS,
        scope: "tenant",
        actorUserId: USER,
        action: "auth.login",
        timestamp: "2026-11-01T10:00:00.000Z",
        ...overrides,
    };
}

/**
 * A context with one owner in one business.
 *
 * The owner may read the trail — reading it is part of running a business.
 */
function ownerContext(extra: Record<string, FakeRow[]> = {}) {
    return new FakeContext({
        identity: { subject: USER, sid: "session-abc" },
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
        sessions: [makeSession({ userId: USER, sessionId: "session-abc" })],
        ...extra,
    });
}

describe("the audit trail", () => {
    it("stamps each entry with the trail it belongs to", async () => {
        const ctx = ownerContext();

        await writeAudit(ctx as never, {
            businessId: BUSINESS as never,
            action: "auth.login",
        });
        await writeAudit(ctx as never, {
            action: "platform.subscription.update",
        });

        const rows = ctx.tables.auditLogs;
        assert.equal(rows.length, 2);

        const tenantRow = rows.find((r) => r.businessId === BUSINESS);
        const platformRow = rows.find((r) => r.businessId === undefined);

        assert.equal(tenantRow?.scope, "tenant");
        assert.equal(platformRow?.scope, "platform");
    });

    it("shows the caller only their own business's entries", async () => {
        const ctx = ownerContext({
            auditLogs: [
                auditRow({ _id: "auditLogs_1", action: "auth.login" }),
                auditRow({
                    _id: "auditLogs_2",
                    businessId: OTHER_BUSINESS,
                    scope: "tenant",
                    action: "rbac.role.change",
                    timestamp: "2026-11-02T10:00:00.000Z",
                }),
            ],
        });

        const result = await callHandler<Page>(auditList, ctx, {
            paginationOpts: { numItems: 50, cursor: null },
        });

        assert.equal(result.page.length, 1);
        assert.equal(result.page[0].action, "auth.login");
    });

    it("narrows by the action that was asked for", async () => {
        const ctx = ownerContext({
            auditLogs: [
                auditRow({ _id: "auditLogs_1", action: "auth.login" }),
                auditRow({
                    _id: "auditLogs_2",
                    action: "rbac.role.change",
                    timestamp: "2026-11-02T10:00:00.000Z",
                }),
            ],
        });

        const result = await callHandler<Page>(auditList, ctx, {
            paginationOpts: { numItems: 50, cursor: null },
            action: "rbac.role.change",
        });

        assert.equal(result.page.length, 1);
        assert.equal(result.page[0].action, "rbac.role.change");
    });

    it("narrows by the date it was asked from", async () => {
        const ctx = ownerContext({
            auditLogs: [
                auditRow({
                    _id: "auditLogs_1",
                    timestamp: "2026-11-01T10:00:00.000Z",
                }),
                auditRow({
                    _id: "auditLogs_2",
                    timestamp: "2026-11-05T10:00:00.000Z",
                }),
            ],
        });

        const result = await callHandler<Page>(auditList, ctx, {
            paginationOpts: { numItems: 50, cursor: null },
            since: "2026-11-03T00:00:00.000Z",
        });

        assert.equal(result.page.length, 1);
        assert.equal(result.page[0].timestamp, "2026-11-05T10:00:00.000Z");
    });

    it("keeps the platform trail away from a business's own trail", async () => {
        const ctx = new FakeContext({
            identity: { subject: "users_admin", sid: "session-abc" },
            users: [makeUser({ _id: "users_admin" })],
            sessions: [makeSession({ userId: "users_admin", sessionId: "session-abc" })],
            platformAdmins: [
                makePlatformAdmin({
                    _id: "platformAdmins_1",
                    userId: "users_admin",
                    role: "platform_super_admin",
                }),
            ],
            auditLogs: [
                auditRow({ _id: "auditLogs_1", scope: "tenant", businessId: BUSINESS }),
                auditRow({
                    _id: "auditLogs_2",
                    scope: "platform",
                    businessId: undefined,
                    action: "platform.subscription.update",
                    timestamp: "2026-11-03T10:00:00.000Z",
                }),
                auditRow({
                    _id: "auditLogs_3",
                    scope: "tenant",
                    businessId: OTHER_BUSINESS,
                    timestamp: "2026-11-04T10:00:00.000Z",
                }),
            ],
        });

        const result = await callHandler<Page>(auditListPlatform, ctx, {
            paginationOpts: { numItems: 50, cursor: null },
        });

        // Only the platform entry. The tenant entries — this business's and
        // the other business's — are not in the platform trail, and the
        // platform trail is read from the scope index rather than by
        // reading the whole table and discarding most of it.
        assert.equal(result.page.length, 1);
        assert.equal(result.page[0].action, "platform.subscription.update");
        assert.equal(result.page[0].businessId, undefined);
    });

    it("refuses the platform trail to anybody who is not a platform administrator", async () => {
        const ctx = ownerContext();

        await assert.rejects(
            () =>
                callHandler<Page>(auditListPlatform, ctx, {
                    paginationOpts: { numItems: 50, cursor: null },
                }),
            /Forbidden/
        );
    });
});

describe("the debt book", () => {
    /**
     * A business with five credit sales and the five loans they made.
     */
    function debtBookContext() {
        const sales: FakeRow[] = [];
        const loans: FakeRow[] = [];

        for (let index = 0; index < 5; index += 1) {
            const date = `2026-11-0${index + 1}T10:00:00.000Z`;
            sales.push(
                makeSale({
                    _id: `sales_${index + 1}`,
                    businessId: BUSINESS,
                    userId: USER,
                    customerId: "customers_1",
                    isLoan: true,
                    date,
                    total: 10_000,
                })
            );
            loans.push(
                makeLoan({
                    _id: `loans_${index + 1}`,
                    businessId: BUSINESS,
                    customerId: "customers_1",
                    salesId: `sales_${index + 1}`,
                    amount: 10_000,
                    balance: 10_000,
                    date,
                })
            );
        }

        return ownerContext({
            sales,
            loans,
            customers: [makeCustomer({ _id: "customers_1", businessId: BUSINESS })],
        });
    }

    it("gives the next page the next loans, not the same ones again", async () => {
        const ctx = debtBookContext();

        const first = await callHandler<Page>(getLoans, ctx, {
            paginationOpts: { numItems: 2, cursor: null },
        });

        assert.equal(first.page.length, 2);
        assert.equal(first.isDone, false);

        const second = await callHandler<Page>(getLoans, ctx, {
            paginationOpts: { numItems: 2, cursor: first.continueCursor },
        });

        assert.equal(second.page.length, 2);

        // The two pages must not show the same loans. The cursor used to be
        // the page number while the server returned the offset, so the
        // second page asked for the first two loans again.
        const firstIds = first.page.map((loan) => loan._id);
        const secondIds = second.page.map((loan) => loan._id);

        for (const id of secondIds) {
            assert.ok(!firstIds.includes(id), `loan ${id} appeared on both pages`);
        }
    });

    it("says when there is nothing more to read", async () => {
        const ctx = debtBookContext();

        const first = await callHandler<Page>(getLoans, ctx, {
            paginationOpts: { numItems: 3, cursor: null },
        });
        assert.equal(first.isDone, false);

        const last = await callHandler<Page>(getLoans, ctx, {
            paginationOpts: { numItems: 3, cursor: first.continueCursor },
        });
        assert.equal(last.page.length, 2);
        assert.equal(last.isDone, true);
    });
});

describe("the cost of goods as at a date", () => {
    it("reads only the purchases made on or before the date it is given", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: "stocks_1", purchasePrice: 5000 })],
            stockCostHistory: [
                makeStockCostHistory({
                    _id: "stockCostHistory_1",
                    stockId: "stocks_1",
                    unitCost: 4000,
                    date: "2026-10-01T00:00:00.000Z",
                }),
                makeStockCostHistory({
                    _id: "stockCostHistory_2",
                    stockId: "stocks_1",
                    unitCost: 9000,
                    date: "2026-12-01T00:00:00.000Z",
                }),
            ],
        });

        const costs = await buildCostIndex(
            ctx as never,
            BUSINESS as never,
            "2026-11-01T00:00:00.000Z"
        );

        // The purchase in December happened after the date and cannot have
        // costed anything in November.
        assert.equal(costs.costFor("stocks_1" as never, 0), 4000);
    });

    it("reads the whole purchase history when no date is given", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: "stocks_1", purchasePrice: 5000 })],
            stockCostHistory: [
                makeStockCostHistory({
                    _id: "stockCostHistory_1",
                    stockId: "stocks_1",
                    unitCost: 4000,
                    date: "2026-10-01T00:00:00.000Z",
                }),
                makeStockCostHistory({
                    _id: "stockCostHistory_2",
                    stockId: "stocks_1",
                    unitCost: 9000,
                    date: "2026-12-01T00:00:00.000Z",
                }),
            ],
        });

        const costs = await buildCostIndex(ctx as never, BUSINESS as never);

        // The most recent purchase is the current cost.
        assert.equal(costs.costFor("stocks_1" as never, 0), 9000);
    });

    it("falls back to the price on the sale when there is no purchase to go on", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ _id: "stocks_1", purchasePrice: 5000 })],
            stockCostHistory: [],
        });

        const costs = await buildCostIndex(ctx as never, BUSINESS as never);

        assert.equal(costs.costFor("stocks_1" as never, 0), 5000);
        assert.equal(costs.costFor("stocks_1" as never, 3000), 3000);
    });
});
