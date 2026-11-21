/**
 * SMARTBUZ — Phase 5 finance and business intelligence.
 *
 * The financial calculations, checked against **known transaction
 * scenarios** rather than against whatever the code happens to produce.
 *
 * Every number below is worked out by hand first and written down, so a
 * change in the calculation shows up as a failure against a figure the
 * business agreed on. The scenarios are:
 *
 *   - a day with cash, mobile money and credit sales in it
 *   - a product bought at one price and sold at another
 *   - a product bought twice at different prices
 *   - a shift with a float, takings, money in and money out
 *   - a provider statement that does not match the books
 *   - money owed by customers and owed to suppliers
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as finance from "../convex/finance";
import * as analytics from "../convex/analytics";
import * as reports from "../convex/reports";

import {
    FakeContext,
    FakeRow,
    makeActiveSubscription,
    makeBusiness,
    makeCashMovement,
    makeCashShift,
    makeCustomer,
    makeExpense,
    makeIncomeRecord,
    makeLoan,
    makeMembership,
    makeSale,
    makeStock,
    makeStockCostHistory,
    makeSupplier,
    makeSupplierLedger,
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
    return handler(ctx, args);
}

/**
 * A context where the caller is a member of the business with `role`.
 *
 * The business is on a running subscription: a business with no subscription
 * is not licensed, and the entitlement gate fails closed. A test that wants
 * an unlicensed business passes its own `subscriptions` row.
 */
function contextFor(role: string, extra: Record<string, FakeRow[]> = {}): FakeContext {
    return signedInContext({
        users: [makeUser({ _id: CALLER })],
        businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
        memberships: [
            makeMembership({ userId: CALLER, businessId: BUSINESS, role }),
        ],
        subscriptions: [makeActiveSubscription()],
        ...extra,
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * The known day
 * ────────────────────────────────────────────────────────────────────────
 *
 * On 2026-01-15 the shop sold:
 *
 *   10 × Blue Band 250g at 2,000   = 20,000  paid in cash
 *    5 × Sugar 1kg     at 4,000   = 20,000  paid by mobile money
 *    2 × Blue Band 250g at 2,000   =  4,000  sold on credit
 *
 * The goods cost 1,500 and 3,000 each, so:
 *
 *   revenue      44,000
 *   cost         33,000
 *   gross profit 11,000
 *
 * The running costs of the day were 7,000 and there was 3,000 of other
 * income, so the net profit was 7,000.
 * ──────────────────────────────────────────────────────────────────────── */

const BLUE_BAND = "stocks_1";
const SUGAR = "stocks_2";

function knownDaySales(): FakeRow[] {
    return [
        makeSale({
            _id: "sales_1",
            invoiceNumber: "INV-1",
            total: 20_000,
            itemCount: 10,
            paymentMode: "Cash",
            date: "2026-01-15T10:00:00.000Z",
            items: [
                {
                    stockId: BLUE_BAND,
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    quantity: 10,
                    price: 2_000,
                    bv: 1_500,
                    pv: 500,
                },
            ],
        }),
        makeSale({
            _id: "sales_2",
            invoiceNumber: "INV-2",
            total: 20_000,
            itemCount: 5,
            paymentMode: "Mobile Money",
            date: "2026-01-15T11:30:00.000Z",
            items: [
                {
                    stockId: SUGAR,
                    name: "Sugar 1kg",
                    productCode: "SG1",
                    quantity: 5,
                    price: 4_000,
                    bv: 3_000,
                    pv: 1_000,
                },
            ],
        }),
        makeSale({
            _id: "sales_3",
            invoiceNumber: "INV-3",
            total: 4_000,
            itemCount: 2,
            paymentMode: "Loan",
            isLoan: true,
            date: "2026-01-15T13:00:00.000Z",
            items: [
                {
                    stockId: BLUE_BAND,
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    quantity: 2,
                    price: 2_000,
                    bv: 1_500,
                    pv: 500,
                },
            ],
        }),
    ];
}

function knownDayStocks(): FakeRow[] {
    return [
        makeStock({
            _id: BLUE_BAND,
            name: "Blue Band 250g",
            productCode: "BB250",
            qty: 100,
            price: 2_000,
            purchasePrice: 1_500,
            bv: 1_500,
            pv: 500,
        }),
        makeStock({
            _id: SUGAR,
            name: "Sugar 1kg",
            productCode: "SG1",
            qty: 50,
            price: 4_000,
            purchasePrice: 3_000,
            bv: 3_000,
            pv: 1_000,
        }),
    ];
}

/* ────────────────────────────────────────────────────────────────────────
 * The profit and loss
 * ──────────────────────────────────────────────────────────────────────── */

describe("the profit and loss of a known day", () => {
    it("works out revenue, cost, gross profit and net profit", async () => {
        const ctx = contextFor("accountant", {
            sales: knownDaySales(),
            stocks: knownDayStocks(),
            expenses: [
                makeExpense({
                    _id: "expenses_1",
                    amount: 5_000,
                    expense: "Market rent",
                    type: "Rent",
                    date: "2026-01-15T08:00:00.000Z",
                }),
                makeExpense({
                    _id: "expenses_2",
                    amount: 2_000,
                    expense: "Transport",
                    type: "Transport",
                    date: "2026-01-15T18:00:00.000Z",
                }),
            ],
            incomeRecords: [
                makeIncomeRecord({
                    _id: "incomeRecords_1",
                    amount: 3_000,
                    source: "Stall rent",
                    date: "2026-01-15T09:00:00.000Z",
                }),
            ],
        });

        const result = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(result.revenue, 44_000);
        assert.equal(result.costOfGoodsSold, 33_000);
        assert.equal(result.grossProfit, 11_000);
        assert.equal(result.operatingExpenses, 7_000);
        assert.equal(result.otherIncome, 3_000);
        assert.equal(result.netProfit, 7_000);
        assert.equal(result.transactions, 3);
        assert.equal(result.itemsSold, 17);

        // 11,000 of 44,000 is exactly a quarter.
        assert.equal(result.grossMargin, 25);
    });

    it("splits the money by how it was paid", async () => {
        const ctx = contextFor("accountant", {
            sales: knownDaySales(),
            stocks: knownDayStocks(),
        });

        const result = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        const methods = await call(analytics.getPaymentMethodAnalysis, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        const cash = methods.page.find((m: any) => m.method === "Cash");
        const mobile = methods.page.find((m: any) => m.method === "Mobile Money");
        const loan = methods.page.find((m: any) => m.method === "Loan");

        assert.equal(cash.revenue, 20_000);
        assert.equal(cash.transactions, 1);
        assert.equal(mobile.revenue, 20_000);
        assert.equal(loan.revenue, 4_000);
        assert.equal(methods.totals.revenue, 44_000);
    });

    it("reports the same figures on the financial summary", async () => {
        const ctx = contextFor("accountant", {
            sales: knownDaySales(),
            stocks: knownDayStocks(),
            expenses: [
                makeExpense({ _id: "expenses_1", amount: 7_000, type: "General" }),
            ],
            incomeRecords: [
                makeIncomeRecord({ _id: "incomeRecords_1", amount: 3_000 }),
            ],
        });

        const profit = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });
        const summary = await call(finance.getFinancialSummary, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        // The dashboard, the reports and the finance page must agree.
        assert.equal(summary.revenue, profit.revenue);
        assert.equal(summary.costOfGoodsSold, profit.costOfGoodsSold);
        assert.equal(summary.grossProfit, profit.grossProfit);
        assert.equal(summary.operatingExpenses, profit.operatingExpenses);
        assert.equal(summary.otherIncome, profit.otherIncome);
        assert.equal(summary.netProfit, profit.netProfit);
        assert.equal(summary.netProfit, 7_000);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The cost of goods sold
 * ──────────────────────────────────────────────────────────────────────── */

describe("the cost of the goods sold", () => {
    it("uses what the goods actually cost when they were bought", async () => {
        // Blue Band was bought at 1,200 a unit. The sale line recorded a base
        // value of 1,500 and the current purchase price is 1,800 — but the
        // goods cost 1,200, so the profit is 20,000 − 12,000 = 8,000.
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 10,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                }),
            ],
            stocks: [
                makeStock({
                    _id: BLUE_BAND,
                    qty: 100,
                    price: 2_000,
                    purchasePrice: 1_800,
                    bv: 1_500,
                }),
            ],
            stockCostHistory: [
                makeStockCostHistory({
                    _id: "stockCostHistory_1",
                    stockId: BLUE_BAND,
                    date: "2026-01-01T00:00:00.000Z",
                    quantity: 50,
                    unitCost: 1_200,
                    totalCost: 60_000,
                }),
            ],
        });

        const result = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(result.costOfGoodsSold, 12_000);
        assert.equal(result.grossProfit, 8_000);
    });

    it("does not let a later purchase change what an earlier sale cost", async () => {
        // Bought at 1,000 on 1 January and at 2,000 on 1 February. The sale
        // in January cost 10,000 and the sale in February cost 20,000.
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 10,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                }),
                makeSale({
                    _id: "sales_2",
                    total: 20_000,
                    date: "2026-02-10T10:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 10,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                }),
            ],
            stocks: [
                makeStock({
                    _id: BLUE_BAND,
                    qty: 100,
                    price: 2_000,
                    purchasePrice: 2_000,
                    bv: 1_500,
                }),
            ],
            stockCostHistory: [
                makeStockCostHistory({
                    _id: "stockCostHistory_1",
                    stockId: BLUE_BAND,
                    date: "2026-01-01T00:00:00.000Z",
                    unitCost: 1_000,
                }),
                makeStockCostHistory({
                    _id: "stockCostHistory_2",
                    stockId: BLUE_BAND,
                    date: "2026-02-01T00:00:00.000Z",
                    unitCost: 2_000,
                }),
            ],
        });

        const january = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-01",
            to: "2026-01-31",
        });
        const february = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-02-01",
            to: "2026-02-28",
        });

        assert.equal(january.costOfGoodsSold, 10_000);
        assert.equal(january.grossProfit, 10_000);
        assert.equal(february.costOfGoodsSold, 20_000);
        assert.equal(february.grossProfit, 0);
    });

    it("falls back to the base value recorded on the sale", async () => {
        // No purchase history. The sale recorded 3,000 a unit and the
        // current purchase price is 3,500 — the recorded base value wins.
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: SUGAR,
                            name: "Sugar 1kg",
                            quantity: 5,
                            price: 4_000,
                            bv: 3_000,
                        },
                    ],
                }),
            ],
            stocks: [
                makeStock({
                    _id: SUGAR,
                    qty: 50,
                    price: 4_000,
                    purchasePrice: 3_500,
                    bv: 3_000,
                }),
            ],
        });

        const result = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(result.costOfGoodsSold, 15_000);
        assert.equal(result.grossProfit, 5_000);
    });

    it("falls back to the purchase price when there is nothing else", async () => {
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: SUGAR,
                            name: "Sugar 1kg",
                            quantity: 5,
                            price: 4_000,
                            bv: 0,
                        },
                    ],
                }),
            ],
            stocks: [
                makeStock({
                    _id: SUGAR,
                    qty: 50,
                    price: 4_000,
                    purchasePrice: 3_500,
                    bv: 0,
                }),
            ],
        });

        const result = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(result.costOfGoodsSold, 17_500);
        assert.equal(result.grossProfit, 2_500);
    });

    it("takes a refund out of the revenue and the cost", async () => {
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    refundAmount: 4_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 10,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                    refundedItems: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 2,
                            amount: 4_000,
                        },
                    ],
                }),
            ],
            stocks: [
                makeStock({
                    _id: BLUE_BAND,
                    qty: 100,
                    price: 2_000,
                    purchasePrice: 1_500,
                    bv: 1_500,
                }),
            ],
        });

        const result = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        // 20,000 − 4,000 refunded, and 8 units of cost instead of 10.
        assert.equal(result.revenue, 16_000);
        assert.equal(result.costOfGoodsSold, 12_000);
        assert.equal(result.grossProfit, 4_000);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Sales over time
 * ──────────────────────────────────────────────────────────────────────── */

describe("sales over time", () => {
    const spread = [
        makeSale({
            _id: "sales_1",
            total: 10_000,
            date: "2026-01-12T10:00:00.000Z", // a Monday
            items: [
                {
                    stockId: BLUE_BAND,
                    name: "Blue Band 250g",
                    quantity: 5,
                    price: 2_000,
                    bv: 1_500,
                },
            ],
        }),
        makeSale({
            _id: "sales_2",
            total: 6_000,
            date: "2026-01-14T10:00:00.000Z", // a Wednesday
            items: [
                {
                    stockId: BLUE_BAND,
                    name: "Blue Band 250g",
                    quantity: 3,
                    price: 2_000,
                    bv: 1_500,
                },
            ],
        }),
        makeSale({
            _id: "sales_3",
            total: 20_000,
            date: "2026-01-20T10:00:00.000Z", // the Tuesday of the next week
            items: [
                {
                    stockId: BLUE_BAND,
                    name: "Blue Band 250g",
                    quantity: 10,
                    price: 2_000,
                    bv: 1_500,
                },
            ],
        }),
    ];

    const stocks = [
        makeStock({
            _id: BLUE_BAND,
            qty: 100,
            price: 2_000,
            purchasePrice: 1_500,
            bv: 1_500,
        }),
    ];

    it("breaks the day down by day, and shows the empty days too", async () => {
        const ctx = contextFor("accountant", { sales: spread, stocks });

        const result = await call(analytics.getSalesByPeriod, ctx, {
            period: "daily",
            from: "2026-01-12",
            to: "2026-01-20",
        });

        assert.equal(result.series.length, 9);
        assert.equal(result.totals.revenue, 36_000);
        assert.equal(result.totals.transactions, 3);

        const twelfth = result.series.find((r: any) => r.period === "2026-01-12");
        const thirteenth = result.series.find((r: any) => r.period === "2026-01-13");
        const twentieth = result.series.find((r: any) => r.period === "2026-01-20");

        assert.equal(twelfth.revenue, 10_000);
        assert.equal(twelfth.grossProfit, 2_500);
        // A day with no trading is a zero, not a gap.
        assert.equal(thirteenth.revenue, 0);
        assert.equal(thirteenth.transactions, 0);
        assert.equal(twentieth.revenue, 20_000);
    });

    it("breaks the week down by week, starting on Monday", async () => {
        const ctx = contextFor("accountant", { sales: spread, stocks });

        const result = await call(analytics.getSalesByPeriod, ctx, {
            period: "weekly",
            from: "2026-01-12",
            to: "2026-01-20",
        });

        assert.equal(result.series.length, 2);

        const firstWeek = result.series.find((r: any) => r.period === "2026-01-12");
        const secondWeek = result.series.find((r: any) => r.period === "2026-01-19");

        // Monday and Wednesday of the first week.
        assert.equal(firstWeek.revenue, 16_000);
        assert.equal(firstWeek.transactions, 2);
        // The following Tuesday.
        assert.equal(secondWeek.revenue, 20_000);
        assert.equal(secondWeek.transactions, 1);
    });

    it("breaks the month down by month", async () => {
        const ctx = contextFor("accountant", { sales: spread, stocks });

        const result = await call(analytics.getSalesByPeriod, ctx, {
            period: "monthly",
            from: "2026-01-01",
            to: "2026-01-31",
        });

        assert.equal(result.series.length, 1);
        assert.equal(result.series[0].period, "2026-01");
        assert.equal(result.series[0].revenue, 36_000);
        assert.equal(result.series[0].transactions, 3);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Products
 * ──────────────────────────────────────────────────────────────────────── */

describe("the product reports", () => {
    it("ranks the best sellers by how many were sold", async () => {
        const ctx = contextFor("accountant", {
            sales: knownDaySales(),
            stocks: knownDayStocks(),
        });

        const result = await call(analytics.getBestSellingProducts, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(result.page[0].name, "Blue Band 250g");
        assert.equal(result.page[0].quantity, 12); // 10 plus 2 on credit
        assert.equal(result.page[0].revenue, 24_000);
        assert.equal(result.totals.quantity, 17);
        assert.equal(result.totals.revenue, 44_000);
    });

    it("shows what is stuck on the shelf", async () => {
        const ctx = contextFor("accountant", {
            sales: knownDaySales(),
            stocks: [
                ...knownDayStocks(),
                makeStock({
                    _id: "stocks_3",
                    name: "Old Umbrella",
                    productCode: "UMB",
                    qty: 25,
                    price: 15_000,
                    purchasePrice: 10_000,
                    bv: 10_000,
                }),
            ],
        });

        const result = await call(analytics.getSlowMovingProducts, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        // Nothing sold, so it is the slowest.
        const umbrella = result.page[0];
        assert.equal(umbrella.name, "Old Umbrella");
        assert.equal(umbrella.quantitySold, 0);
        assert.equal(umbrella.stockValue, 250_000);

        assert.equal(result.totals.deadStockValue, 250_000);
    });

    it("values the stock at what it cost", async () => {
        const ctx = contextFor("accountant", {
            stocks: [
                makeStock({
                    _id: BLUE_BAND,
                    name: "Blue Band 250g",
                    qty: 100,
                    price: 2_000,
                    purchasePrice: 1_500,
                    bv: 1_500,
                }),
                makeStock({
                    _id: SUGAR,
                    name: "Sugar 1kg",
                    qty: 50,
                    price: 4_000,
                    purchasePrice: 3_000,
                    bv: 3_000,
                }),
            ],
        });

        const result = await call(analytics.getStockValuation, ctx, {});

        // 100 × 1,500 + 50 × 3,000 = 300,000
        assert.equal(result.totals.costValue, 300_000);
        // 100 × 2,000 + 50 × 4,000 = 400,000
        assert.equal(result.totals.retailValue, 400_000);
        assert.equal(result.totals.marginValue, 100_000);
        assert.equal(result.totals.units, 150);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The cash drawer
 * ──────────────────────────────────────────────────────────────────────── */

describe("the cash drawer", () => {
    it("knows what should be in the drawer without anybody saying so", async () => {
        const ctx = contextFor("cashier", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    paymentMode: "Cash",
                    userId: CALLER,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 10,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                }),
            ],
            cashShifts: [
                makeCashShift({
                    _id: "cashShifts_1",
                    openingFloat: 10_000,
                    openedAt: "2026-01-15T08:00:00.000Z",
                }),
            ],
            cashMovements: [
                makeCashMovement({
                    _id: "cashMovements_1",
                    shiftId: "cashShifts_1",
                    type: "in",
                    amount: 5_000,
                    date: "2026-01-15T09:00:00.000Z",
                }),
                makeCashMovement({
                    _id: "cashMovements_2",
                    shiftId: "cashShifts_1",
                    type: "out",
                    amount: 2_000,
                    date: "2026-01-15T11:00:00.000Z",
                }),
            ],
        });

        const drawer = await call(finance.getCashDrawer, ctx, {
            shiftId: "cashShifts_1",
        });

        // 10,000 float + 20,000 cash sales + 5,000 in − 2,000 out
        assert.equal(drawer.expectedCash, 33_000);
        assert.equal(drawer.cashSales, 20_000);
        assert.equal(drawer.cashIn, 5_000);
        assert.equal(drawer.cashOut, 2_000);
    });

    it("records the difference between what was counted and what should be there", async () => {
        const ctx = contextFor("cashier", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    paymentMode: "Cash",
                    userId: CALLER,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [],
                }),
            ],
            cashShifts: [
                makeCashShift({
                    _id: "cashShifts_1",
                    openingFloat: 10_000,
                    openedAt: "2026-01-15T08:00:00.000Z",
                }),
            ],
        });

        const result = await call(finance.closeShift, ctx, {
            shiftId: "cashShifts_1",
            countedCash: 29_000,
        });

        // 10,000 + 20,000 expected, 29,000 counted → 1,000 missing.
        assert.equal(result.expectedCash, 30_000);
        assert.equal(result.variance, -1_000);

        const shift = ctx.tables.cashShifts.find((s) => s._id === "cashShifts_1");
        assert.equal(shift?.status, "closed");
        assert.equal(shift?.variance, -1_000);
    });

    it("does not count a sale paid by mobile money as cash", async () => {
        const ctx = contextFor("cashier", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    paymentMode: "Mobile Money",
                    userId: CALLER,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [],
                }),
            ],
            cashShifts: [
                makeCashShift({
                    _id: "cashShifts_1",
                    openingFloat: 10_000,
                    openedAt: "2026-01-15T08:00:00.000Z",
                }),
            ],
        });

        const drawer = await call(finance.getCashDrawer, ctx, {
            shiftId: "cashShifts_1",
        });

        assert.equal(drawer.cashSales, 0);
        assert.equal(drawer.expectedCash, 10_000);
    });

    it("adds up the variance of each shift over a period", async () => {
        // Two shifts: one balanced, one 1,000 short. The period's variance is
        // the sum of the two, each worked out against its own takings.
        const ctx = contextFor("cashier", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 20_000,
                    paymentMode: "Cash",
                    userId: CALLER,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [],
                }),
            ],
            cashShifts: [
                makeCashShift({
                    _id: "cashShifts_1",
                    openingFloat: 10_000,
                    openedAt: "2026-01-15T08:00:00.000Z",
                    status: "closed",
                    closedAt: "2026-01-15T18:00:00.000Z",
                    countedCash: 30_000,
                    expectedCash: 30_000,
                    variance: 0,
                }),
                makeCashShift({
                    _id: "cashShifts_2",
                    openingFloat: 5_000,
                    openedAt: "2026-01-15T09:00:00.000Z",
                    status: "closed",
                    closedAt: "2026-01-15T17:00:00.000Z",
                    countedCash: 4_000,
                    expectedCash: 5_000,
                    variance: -1_000,
                }),
            ],
        });

        const drawer = await call(finance.getCashDrawer, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(drawer.scope, "period");
        assert.equal(drawer.variance, -1_000);
        assert.equal(drawer.countedCash, 34_000);
        assert.equal(drawer.shiftCount, 2);
    });

    it("refuses a second shift while one is open", async () => {
        const ctx = contextFor("cashier", {
            cashShifts: [
                makeCashShift({ _id: "cashShifts_1", status: "open" }),
            ],
        });

        await assert.rejects(
            () => call(finance.openShift, ctx, { openingFloat: 5_000 }),
            /already have an open shift/
        );
    });

    it("refuses the same cash movement being recorded twice", async () => {
        const ctx = contextFor("accountant", {});

        await call(finance.recordCashMovement, ctx, {
            type: "out",
            amount: 2_000,
            category: "petty_cash",
            reason: "Bought fuel for the delivery",
            reference: "RECEIPT-9",
        });

        await assert.rejects(
            () =>
                call(finance.recordCashMovement, ctx, {
                    type: "out",
                    amount: 2_000,
                    category: "petty_cash",
                    reason: "Bought fuel for the delivery",
                    reference: "RECEIPT-9",
                }),
            /already been recorded/
        );

        assert.equal(ctx.tables.cashMovements.length, 1);
    });

    it("refuses a movement that is not money", async () => {
        const ctx = contextFor("accountant", {});

        await assert.rejects(
            () =>
                call(finance.recordCashMovement, ctx, {
                    type: "out",
                    amount: 0,
                    category: "petty_cash",
                    reason: "Nothing",
                }),
            /greater than zero/
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Reconciliation
 * ──────────────────────────────────────────────────────────────────────── */

describe("payment reconciliation", () => {
    it("records the difference between the statement and the books", async () => {
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 480_000,
                    paymentMode: "Mobile Money",
                    date: "2026-01-15T10:00:00.000Z",
                    items: [],
                }),
            ],
        });

        const result = await call(finance.reconcile, ctx, {
            kind: "mobile_money",
            method: "Mobile Money",
            period: "2026-01",
            statementReference: "MM-STAT-01",
            statementAmount: 500_000,
        });

        assert.equal(result.recordedAmount, 480_000);
        assert.equal(result.variance, 20_000);
        assert.equal(result.status, "discrepancy");
    });

    it("calls it reconciled when the two agree", async () => {
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    total: 480_000,
                    paymentMode: "Mobile Money",
                    date: "2026-01-15T10:00:00.000Z",
                    items: [],
                }),
            ],
        });

        const result = await call(finance.reconcile, ctx, {
            kind: "mobile_money",
            method: "Mobile Money",
            period: "2026-01",
            statementReference: "MM-STAT-02",
            statementAmount: 480_000,
        });

        assert.equal(result.variance, 0);
        assert.equal(result.status, "reconciled");
    });

    it("refuses a period that is not a month", async () => {
        const ctx = contextFor("accountant", {});

        await assert.rejects(
            () =>
                call(finance.reconcile, ctx, {
                    kind: "bank",
                    method: "Bank Transfer",
                    period: "January",
                    statementReference: "B-1",
                    statementAmount: 100,
                }),
            /YYYY-MM/
        );
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The debt reports
 * ──────────────────────────────────────────────────────────────────────── */

describe("the debt reports", () => {
    it("shows what customers owe and how old it is", async () => {
        const today = new Date();
        const fresh = new Date(today.getTime() - 10 * 86_400_000)
            .toISOString()
            .slice(0, 10);
        const old = new Date(today.getTime() - 120 * 86_400_000)
            .toISOString()
            .slice(0, 10);

        const ctx = contextFor("accountant", {
            customers: [
                makeCustomer({
                    _id: "customers_1",
                    name: "Amina Nakato",
                    phone: "0772123456",
                    creditLimit: 100_000,
                }),
                makeCustomer({
                    _id: "customers_2",
                    name: "Bosco Kiwanuka",
                    phone: "0772123457",
                    creditLimit: 0,
                }),
            ],
            loans: [
                makeLoan({
                    _id: "loans_1",
                    customerId: "customers_1",
                    amount: 30_000,
                    balance: 30_000,
                    date: `${fresh}T10:00:00.000Z`,
                }),
                makeLoan({
                    _id: "loans_2",
                    customerId: "customers_1",
                    amount: 20_000,
                    balance: 20_000,
                    date: `${old}T10:00:00.000Z`,
                }),
                makeLoan({
                    _id: "loans_3",
                    customerId: "customers_2",
                    amount: 10_000,
                    balance: 10_000,
                    date: `${fresh}T10:00:00.000Z`,
                }),
                // A settled sale is not a debt.
                makeLoan({
                    _id: "loans_4",
                    customerId: "customers_2",
                    amount: 5_000,
                    balance: 0,
                    date: `${fresh}T10:00:00.000Z`,
                }),
            ],
        });

        const report = await call(analytics.getCustomerDebtReport, ctx, {});

        assert.equal(report.totals.balance, 60_000);
        assert.equal(report.totals.customers, 2);
        // The old debt is in the over-90-days bucket.
        assert.equal(report.totals.d90, 20_000);
        assert.equal(report.totals.current, 40_000);

        const amina = report.page.find((r: any) => r.customerId === "customers_1");
        assert.equal(amina.balance, 50_000);
        assert.equal(amina.overLimit, false);

        const bosco = report.page.find((r: any) => r.customerId === "customers_2");
        assert.equal(bosco.balance, 10_000);
    });

    it("shows what the business owes its suppliers", async () => {
        const ctx = contextFor("accountant", {
            suppliers: [
                makeSupplier({ _id: "suppliers_1", name: "Nile Foods Ltd" }),
                makeSupplier({ _id: "suppliers_2", name: "Kampala Packaging" }),
            ],
            supplierLedger: [
                makeSupplierLedger({
                    _id: "supplierLedger_1",
                    supplierId: "suppliers_1",
                    type: "invoice",
                    amount: 100_000,
                    balanceAfter: 100_000,
                    date: "2026-01-05T00:00:00.000Z",
                }),
                makeSupplierLedger({
                    _id: "supplierLedger_2",
                    supplierId: "suppliers_1",
                    type: "payment",
                    amount: -40_000,
                    balanceAfter: 60_000,
                    date: "2026-01-10T00:00:00.000Z",
                }),
                // A supplier who has been paid in full is not owed anything.
                makeSupplierLedger({
                    _id: "supplierLedger_3",
                    supplierId: "suppliers_2",
                    type: "invoice",
                    amount: 50_000,
                    balanceAfter: 50_000,
                    date: "2026-01-05T00:00:00.000Z",
                }),
                makeSupplierLedger({
                    _id: "supplierLedger_4",
                    supplierId: "suppliers_2",
                    type: "payment",
                    amount: -50_000,
                    balanceAfter: 0,
                    date: "2026-01-08T00:00:00.000Z",
                }),
            ],
        });

        const report = await call(analytics.getSupplierDebtReport, ctx, {});

        assert.equal(report.totals.balance, 60_000);
        assert.equal(report.totals.suppliers, 1);
        assert.equal(report.page[0].name, "Nile Foods Ltd");
        assert.equal(report.page[0].balance, 60_000);
        assert.equal(report.page[0].charged, 100_000);
        assert.equal(report.page[0].paid, 40_000);
    });

    it("puts the two together on the financial summary", async () => {
        const ctx = contextFor("accountant", {
            loans: [
                makeLoan({
                    _id: "loans_1",
                    customerId: "customers_1",
                    amount: 30_000,
                    balance: 30_000,
                }),
                makeLoan({
                    _id: "loans_2",
                    customerId: "customers_1",
                    amount: 20_000,
                    balance: 20_000,
                }),
            ],
            supplierLedger: [
                makeSupplierLedger({
                    _id: "supplierLedger_1",
                    supplierId: "suppliers_1",
                    type: "invoice",
                    amount: 100_000,
                    balanceAfter: 100_000,
                }),
                makeSupplierLedger({
                    _id: "supplierLedger_2",
                    supplierId: "suppliers_1",
                    type: "payment",
                    amount: -40_000,
                    balanceAfter: 60_000,
                }),
            ],
        });

        const summary = await call(finance.getFinancialSummary, ctx, {});

        assert.equal(summary.receivables, 50_000);
        assert.equal(summary.payables, 60_000);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Branches
 * ──────────────────────────────────────────────────────────────────────── */

describe("branch filters", () => {
    it("only counts the sales of the branch that was asked for", async () => {
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    branchId: "branches_1",
                    total: 20_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 10,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                }),
                makeSale({
                    _id: "sales_2",
                    branchId: "branches_2",
                    total: 50_000,
                    date: "2026-01-15T11:00:00.000Z",
                    items: [
                        {
                            stockId: BLUE_BAND,
                            name: "Blue Band 250g",
                            quantity: 25,
                            price: 2_000,
                            bv: 1_500,
                        },
                    ],
                }),
            ],
            stocks: [
                makeStock({
                    _id: BLUE_BAND,
                    qty: 100,
                    price: 2_000,
                    purchasePrice: 1_500,
                    bv: 1_500,
                }),
            ],
        });

        const main = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
            branchId: "branches_1",
        });
        const all = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(main.revenue, 20_000);
        assert.equal(main.grossProfit, 5_000);
        assert.equal(all.revenue, 70_000);
        assert.equal(all.grossProfit, 17_500);
    });

    it("keeps a branch's own running costs with the branch", async () => {
        const ctx = contextFor("accountant", {
            sales: [
                makeSale({
                    _id: "sales_1",
                    branchId: "branches_1",
                    total: 20_000,
                    date: "2026-01-15T10:00:00.000Z",
                    items: [],
                }),
            ],
            expenses: [
                makeExpense({
                    _id: "expenses_1",
                    branchId: "branches_1",
                    amount: 4_000,
                    type: "Rent",
                }),
                // A business-wide cost belongs to the business, not to a branch.
                makeExpense({
                    _id: "expenses_2",
                    branchId: undefined,
                    amount: 6_000,
                    type: "General",
                }),
            ],
        });

        const branch = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
            branchId: "branches_1",
        });
        const all = await call(analytics.getProfitAndLoss, ctx, {
            from: "2026-01-15",
            to: "2026-01-15",
        });

        assert.equal(branch.operatingExpenses, 4_000);
        assert.equal(all.operatingExpenses, 10_000);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Who may do what
 * ──────────────────────────────────────────────────────────────────────── */

describe("the permissions on the finance module", () => {
    it("refuses a cash movement to a role that may not move the till", async () => {
        const ctx = contextFor("salesperson", {});

        await assert.rejects(
            () =>
                call(finance.recordCashMovement, ctx, {
                    type: "in",
                    amount: 5_000,
                    category: "float",
                    reason: "Float",
                }),
            /Forbidden/
        );
    });

    it("refuses a reconciliation to a role that may not reconcile", async () => {
        const ctx = contextFor("branch_manager", {});

        await assert.rejects(
            () =>
                call(finance.reconcile, ctx, {
                    kind: "bank",
                    method: "Bank Transfer",
                    period: "2026-01",
                    statementReference: "B-1",
                    statementAmount: 100,
                }),
            /Forbidden/
        );
    });

    it("refuses other income to a role that may not record it", async () => {
        const ctx = contextFor("supervisor", {});

        await assert.rejects(
            () =>
                call(finance.recordIncome, ctx, {
                    amount: 5_000,
                    source: "Rent",
                }),
            /Forbidden/
        );
    });

    it("refuses the financial summary to a role that may not read the books", async () => {
        const ctx = contextFor("cashier", {});

        await assert.rejects(
            () =>
                call(finance.getFinancialSummary, ctx, {
                    from: "2026-01-01",
                    to: "2026-01-31",
                }),
            /Forbidden/
        );
    });

    it("lets a cashier open and close their own shift", async () => {
        const ctx = contextFor("cashier", {});

        const shiftId = await call(finance.openShift, ctx, {
            openingFloat: 10_000,
        });

        assert.ok(shiftId);

        const closed = await call(finance.closeShift, ctx, {
            shiftId,
            countedCash: 10_000,
        });

        assert.equal(closed.expectedCash, 10_000);
        assert.equal(closed.variance, 0);
    });

    describe("reports tenant isolation (C-01)", () => {
        it("getDailyProfitLoss does not include sales from another business", async () => {
            const OTHER_BUSINESS = "businesses_other";
            const ctx = contextFor("accountant", {
                stocks: [
                    makeStock({ _id: BLUE_BAND, businessId: BUSINESS, purchasePrice: 1500, price: 2000 }),
                ],
                sales: [
                    makeSale({
                        _id: "sales_mine",
                        businessId: BUSINESS,
                        total: 20_000,
                        date: "2026-01-15T10:00:00.000Z",
                        items: [{ stockId: BLUE_BAND, name: "Blue Band", quantity: 10, price: 2000, bv: 0, pv: 0 }],
                    }),
                    makeSale({
                        _id: "sales_theirs",
                        businessId: OTHER_BUSINESS,
                        total: 50_000,
                        date: "2026-01-15T11:00:00.000Z",
                        items: [{ stockId: BLUE_BAND, name: "Blue Band", quantity: 25, price: 2000, bv: 0, pv: 0 }],
                    }),
                ],
            });

            const result = await call(reports.getDailyProfitLoss, ctx, {
                date: "2026-01-15",
                businessId: BUSINESS,
            });

            assert.equal(result.totalRevenue, 20_000);
            assert.equal(result.salesCount, 1);
        });

        it("getMonthlyProfitLoss does not include sales from another business", async () => {
            const OTHER_BUSINESS = "businesses_other";
            const ctx = contextFor("accountant", {
                stocks: [
                    makeStock({ _id: BLUE_BAND, businessId: BUSINESS, purchasePrice: 1500, price: 2000 }),
                ],
                sales: [
                    makeSale({
                        _id: "sales_mine",
                        businessId: BUSINESS,
                        total: 20_000,
                        date: "2026-01-15T10:00:00.000Z",
                        items: [{ stockId: BLUE_BAND, name: "Blue Band", quantity: 10, price: 2000, bv: 0, pv: 0 }],
                    }),
                    makeSale({
                        _id: "sales_theirs",
                        businessId: OTHER_BUSINESS,
                        total: 50_000,
                        date: "2026-01-20T11:00:00.000Z",
                        items: [{ stockId: BLUE_BAND, name: "Blue Band", quantity: 25, price: 2000, bv: 0, pv: 0 }],
                    }),
                ],
            });

            const result = await call(reports.getMonthlyProfitLoss, ctx, {
                year: 2026,
                month: 1,
                businessId: BUSINESS,
            });

            assert.equal(result.totalRevenue, 20_000);
            assert.equal(result.salesCount, 1);
        });
    });
});
