/**
 * SMARTBUZ — tests for the period a report reads.
 *
 * The performance audit (PERF-02, DB-02) found that the reports read their
 * ledger whole and then picked out the rows they wanted. Two things were
 * wrong with that, and they are separate faults:
 *
 *   • **It grew.** Every report fetched the business's whole history, so the
 *     cost of a day's figures went up with the size of the history.
 *
 *   • **It was wrong.** A report that gave one end of a period — "everything
 *     since 1 March" — fell into the branch that applied no date filter at
 *     all, so it answered with everything. The dates the caller gave were
 *     read and then ignored.
 *
 * The reports now ask the index for the period, and a period with only one
 * end is a period like any other.
 *
 * These tests cover the behaviour that had to survive the change, because a
 * bounded read that returns the wrong rows is worse than an unbounded one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FakeContext,
  callHandler,
  makeBusiness,
  makeCustomer,
  makeExpense,
  makeLoan,
  makeMembership,
  makePayment,
  makeSale,
  makeSession,
  makeUser,
  type FakeRow,
} from "./helpers/fake-context";

import {
  getExpensesReport,
  getExpensesReportSummary,
  getLoanSummaryCount,
} from "../convex/reports";

const USER = "users_1";
const BUSINESS = "businesses_1";
const OTHER_BUSINESS = "businesses_2";

/**
 * A context with one owner in one business.
 *
 * The owner may read the reports — reading them is part of running a
 * business.
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

/** An expense, as the database holds it. */
function expense(id: string, date: string, amount: number): FakeRow {
  return makeExpense({
    _id: id,
    businessId: BUSINESS,
    userId: USER,
    date,
    amount,
    expense: `Expense ${id}`,
  });
}

/**
 * Three expenses — one in January, one in March, one in May — and one
 * belonging to somebody else.
 */
function expenseContext() {
  return ownerContext({
    expenses: [
      expense("expenses_1", "2026-01-15T10:00:00.000Z", 100),
      expense("expenses_2", "2026-03-15T10:00:00.000Z", 200),
      expense("expenses_3", "2026-05-15T10:00:00.000Z", 300),
      makeExpense({
        _id: "expenses_4",
        businessId: OTHER_BUSINESS,
        userId: USER,
        date: "2026-03-15T10:00:00.000Z",
        amount: 999,
      }),
    ],
  });
}

/** The dates of the expenses a report returned. */
function datesOf(rows: FakeRow[]): string[] {
  return rows.map((row) => String(row.date)).sort();
}

describe("a report that is given the start of a period", () => {
  it("reads only what comes after it", async () => {
    const ctx = expenseContext();

    const rows = await callHandler<FakeRow[]>(getExpensesReport, ctx, {
      startDate: "2026-03-01",
    });

    // Not every expense the business has ever had.
    assert.deepEqual(datesOf(rows), [
      "2026-03-15T10:00:00.000Z",
      "2026-05-15T10:00:00.000Z",
    ]);
  });

  it("counts only what comes after it", async () => {
    const ctx = expenseContext();

    const summary = await callHandler<{ totalExpenses: number; expenseCount: number }>(
      getExpensesReportSummary,
      ctx,
      { startDate: "2026-03-01" }
    );

    assert.equal(summary.expenseCount, 2);
    assert.equal(summary.totalExpenses, 500);
  });
});

describe("a report that is given the end of a period", () => {
  it("reads only what comes before it", async () => {
    const ctx = expenseContext();

    const rows = await callHandler<FakeRow[]>(getExpensesReport, ctx, {
      endDate: "2026-03-31",
    });

    assert.deepEqual(datesOf(rows), [
      "2026-01-15T10:00:00.000Z",
      "2026-03-15T10:00:00.000Z",
    ]);
  });

  it("includes the whole of its last day", async () => {
    const ctx = ownerContext({
      expenses: [
        expense("expenses_1", "2026-03-31T23:59:00.000Z", 100),
        expense("expenses_2", "2026-04-01T00:30:00.000Z", 200),
      ],
    });

    const rows = await callHandler<FakeRow[]>(getExpensesReport, ctx, {
      endDate: "2026-03-31",
    });

    // The day the period ends on is part of the period.
    assert.deepEqual(datesOf(rows), ["2026-03-31T23:59:00.000Z"]);
  });
});

describe("a report that is given both ends of a period", () => {
  it("reads only what is between them", async () => {
    const ctx = expenseContext();

    const rows = await callHandler<FakeRow[]>(getExpensesReport, ctx, {
      startDate: "2026-02-01",
      endDate: "2026-04-30",
    });

    assert.deepEqual(datesOf(rows), ["2026-03-15T10:00:00.000Z"]);
  });
});

describe("a report that is given no period", () => {
  it("reads everything, because that is what it was asked for", async () => {
    const ctx = expenseContext();

    const rows = await callHandler<FakeRow[]>(getExpensesReport, ctx, {});

    assert.equal(rows.length, 3);
  });
});

describe("the debt book", () => {
  /**
   * Two loans — one taken in January, one in March — each with its own
   * payments.
   */
  function debtBookContext() {
    return ownerContext({
      customers: [makeCustomer({ _id: "customers_1", businessId: BUSINESS })],
      sales: [
        makeSale({
          _id: "sales_1",
          businessId: BUSINESS,
          userId: USER,
          customerId: "customers_1",
          isLoan: true,
          date: "2026-01-10T10:00:00.000Z",
          total: 10_000,
        }),
        makeSale({
          _id: "sales_2",
          businessId: BUSINESS,
          userId: USER,
          customerId: "customers_1",
          isLoan: true,
          date: "2026-03-10T10:00:00.000Z",
          total: 20_000,
        }),
      ],
      loans: [
        makeLoan({
          _id: "loans_1",
          businessId: BUSINESS,
          customerId: "customers_1",
          salesId: "sales_1",
          amount: 10_000,
          balance: 10_000,
          date: "2026-01-10T10:00:00.000Z",
        }),
        makeLoan({
          _id: "loans_2",
          businessId: BUSINESS,
          customerId: "customers_1",
          salesId: "sales_2",
          amount: 20_000,
          balance: 20_000,
          date: "2026-03-10T10:00:00.000Z",
        }),
      ],
      payments: [
        makePayment({
          _id: "payments_1",
          businessId: BUSINESS,
          loanId: "loans_1",
          customerId: "customers_1",
          amount: 1_000,
          date: "2026-02-01T10:00:00.000Z",
        }),
        makePayment({
          _id: "payments_2",
          businessId: BUSINESS,
          loanId: "loans_2",
          customerId: "customers_1",
          amount: 2_000,
          date: "2026-04-01T10:00:00.000Z",
        }),
      ],
    });
  }

  it("counts only the loans taken in the period it is given", async () => {
    const ctx = debtBookContext();

    const count = await callHandler<number>(getLoanSummaryCount, ctx, {
      startDate: "2026-03-01",
    });

    // The January loan is not counted, even though it is still owed.
    assert.equal(count, 1);
  });

  it("counts every loan when it is given no period", async () => {
    const ctx = debtBookContext();

    const count = await callHandler<number>(getLoanSummaryCount, ctx, {});

    assert.equal(count, 2);
  });
});
