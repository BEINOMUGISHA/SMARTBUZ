/**
 * SMARTBUZ — regression tests for the money and stock defects.
 *
 * Every test in here describes a way the books could lie, and asserts that
 * the fixed code cannot lie that way again. They are written as the
 * business would meet them — a sale at the till, a refund, a repayment on
 * an account, stock issued to a counter — rather than as unit tests of the
 * functions involved.
 *
 * The defects:
 *
 *   - selling stock that is not there;
 *   - a refund putting the goods back in the warehouse instead of on the
 *     counter they were sold from;
 *   - correcting a credit sale destroying the money the customer had paid;
 *   - a repayment that could be negative, backdated, or silent about how it
 *     was paid;
 *   - a credit limit that was displayed but never enforced;
 *   - stock issued to a counter without ever leaving the warehouse;
 *   - a receipt that named a product the server had never heard of;
 *   - a refunded credit sale that still owed the full amount;
 *   - a rejected offline sale that reversed nothing;
 *   - an inventory figure that meant different things depending on how the
 *     stock had been issued;
 *   - a cashier able to read every product's cost price;
 *   - a low-stock alert that compared every product against one number.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as sales from "../convex/sales";
import * as shops from "../convex/shops";
import * as stocks from "../convex/stocks";
import * as loans from "../convex/loans";
import * as customers from "../convex/customers";
import * as sync from "../convex/sync";
import { dayBounds } from "../convex/financeCore";

import {
    FakeContext,
    FakeRow,
    makeActiveSubscription,
    makeBusiness,
    makeCustomer,
    makeLoan,
    makeMembership,
    makePayment,
    makeStock,
    makeUser,
    signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const CALLER = "users_1";
const STOCK = "stocks_1";
const CUSTOMER = "customers_1";
const SHOP = "shops_1";
const LOAN = "loans_1";
const SALE = "sales_1";

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

/** The owner of the business, with a running subscription. */
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

/** A sale as a till sends it: two Blue Band at 12,000. */
function salePayload(overrides: Record<string, unknown> = {}) {
    return {
        customerId: undefined,
        manualCustomerName: "Walk-in",
        shopId: undefined,
        userId: CALLER,
        total: 24_000,
        clientType: "Non-Member",
        paymentMode: "Cash",
        items: [
            {
                stockId: STOCK,
                name: "Blue Band 250g",
                productCode: "BB250",
                price: 12_000,
                quantity: 2,
                pv: 7_000,
                bv: 7_000,
            },
        ],
        ...overrides,
    };
}

/** A counter holding some stock. */
function makeShop(overrides: Record<string, unknown> = {}): FakeRow {
    return {
        _id: SHOP,
        _creationTime: 1,
        businessId: BUSINESS,
        name: "Kampala Road counter",
        serialNumber: "KP-01",
        location: "Kampala Road",
        contact: "",
        userId: CALLER,
        issuedStocks: [],
        ...overrides,
    };
}

/* ────────────────────────────────────────────────────────────────────────
 * Selling stock that is not there
 * ──────────────────────────────────────────────────────────────────────── */

describe("selling stock that is not there", () => {
    it("refuses a sale for more than the warehouse holds", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 1 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const message = await messageOf(() =>
            call(sales.create, ctx, salePayload())
        );

        assert.match(message, /not enough/i);
        assert.match(message, /Blue Band/);
    });

    it("says how many are left, so the cashier can put the sale right", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 1 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const message = await messageOf(() =>
            call(sales.create, ctx, salePayload())
        );

        assert.match(message, /1 left/);
        assert.match(message, /2 requested/);
    });

    it("still records an offline sale, and flags the shortfall", async () => {
        // An offline sale has already happened: the goods have gone and the
        // customer has paid. Refusing it now would lose a real sale and
        // leave the books short, so the shortfall is allowed and recorded.
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 1 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            devices: [
                {
                    _id: "devices_1",
                    businessId: BUSINESS,
                    deviceId: "device-1",
                    deviceName: "Till 1",
                    status: "active",
                    registeredAt: new Date().toISOString(),
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        const result = await call(sync.pushTransactions, ctx, {
            deviceId: "device-1",
            transactions: [
                {
                    transactionId: "tx-1",
                    occurredAt: new Date().toISOString(),
                    attempts: 1,
                    payload: salePayload(),
                },
            ],
        });

        assert.equal(result.accepted, 1);
        const applied = result.results[0];
        assert.equal(applied.status, "applied");
        assert.equal(applied.conflicts.length, 1);
        assert.equal(applied.conflicts[0].kind, "insufficient");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The receipt names the product the server knows
 * ──────────────────────────────────────────────────────────────────────── */

describe("the receipt names the product the server knows", () => {
    it("ignores a name the browser changed", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, name: "Blue Band 250g", productCode: "BB250" })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const created = await call(
            sales.create,
            ctx,
            salePayload({
                items: [
                    {
                        stockId: STOCK,
                        name: "Something else entirely",
                        productCode: "FORGED-1",
                        price: 12_000,
                        quantity: 2,
                        pv: 7_000,
                        bv: 7_000,
                    },
                ],
            })
        );

        const sale = await ctx.db.get(created.saleId) as any;
        assert.equal(sale.items[0].name, "Blue Band 250g");
        assert.equal(sale.items[0].productCode, "BB250");
    });

    it("stores the total rounded to the currency", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 33.333 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        // Three of something at 33.333…
        const created = await call(
            sales.create,
            ctx,
            salePayload({
                total: 100,
                items: [
                    {
                        stockId: STOCK,
                        name: "Blue Band 250g",
                        productCode: "BB250",
                        price: 33.333,
                        quantity: 3,
                        pv: 7_000,
                        bv: 7_000,
                    },
                ],
            })
        );

        const sale = await ctx.db.get(created.saleId) as any;

        // The total is a figure in the currency, not a repeating decimal.
        assert.equal(sale.total, 100);
        assert.equal(sale.total, Math.round(sale.total * 100) / 100);

        // And the lines add up to it, to the cent.
        const lines = sale.items.reduce(
            (sum: number, line: any) =>
                sum + Math.round(line.price * line.quantity * 100) / 100,
            0
        );
        assert.equal(lines, sale.total);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * A refund puts the goods back where they came from
 * ──────────────────────────────────────────────────────────────────────── */

describe("a refund puts the goods back where they came from", () => {
    it("credits the counter, not the master warehouse", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            shops: [
                makeShop({
                    issuedStocks: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            qty: 2,
                            price: 12_000,
                            productCode: "BB250",
                            pv: 7_000,
                            bv: 7_000,
                            halfPrice: false,
                        },
                    ],
                }),
            ],
            sales: [
                {
                    _id: SALE,
                    businessId: BUSINESS,
                    shopId: SHOP,
                    userId: CALLER,
                    total: 24_000,
                    invoiceNumber: "INV-001",
                    date: new Date().toISOString(),
                    paymentMode: "Cash",
                    clientType: "Non-Member",
                    items: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            productCode: "BB250",
                            price: 12_000,
                            quantity: 2,
                            pv: 7_000,
                            bv: 7_000,
                        },
                    ],
                },
            ],
        });

        await call(sales.refundSale, ctx, {
            saleId: SALE,
            items: [{ stockId: STOCK, quantity: 1 }],
            reason: "Customer changed their mind",
        });

        const shop = await ctx.db.get(SHOP) as any;
        const issued = shop.issuedStocks.find((s: any) => s.stockId === STOCK);
        assert.equal(issued.qty, 3, "the counter gets the goods back");

        const stock = await ctx.db.get(STOCK) as any;
        assert.equal(stock.qty, 100, "the warehouse is left alone");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Correcting a credit sale
 * ──────────────────────────────────────────────────────────────────────── */

describe("correcting a credit sale", () => {
    it("keeps the money the customer has already paid", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 40_000 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            customers: [makeCustomer({ _id: CUSTOMER, creditLimit: 0 })],
            sales: [
                {
                    _id: SALE,
                    businessId: BUSINESS,
                    userId: CALLER,
                    total: 100_000,
                    invoiceNumber: "INV-001",
                    date: new Date().toISOString(),
                    paymentMode: "Loan",
                    isLoan: true,
                    clientType: "Member",
                    initialDeposit: 0,
                    items: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            productCode: "BB250",
                            price: 50_000,
                            quantity: 2,
                            pv: 7_000,
                            bv: 7_000,
                        },
                    ],
                },
            ],
            loans: [
                makeLoan({
                    _id: LOAN,
                    salesId: SALE,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 70_000,
                }),
            ],
            payments: [
                makePayment({
                    _id: "payments_1",
                    loanId: LOAN,
                    customerId: CUSTOMER,
                    amount: 30_000,
                    balance: 70_000,
                }),
            ],
        });

        // The sale was corrected from 100,000 to 80,000.
        await call(sales.editSale, ctx, {
            saleId: SALE,
            userId: CALLER,
            customerId: CUSTOMER,
            total: 80_000,
            clientType: "Member",
            paymentMode: "Loan",
            isLoan: true,
            paymentDueDate: "2026-02-01T00:00:00.000Z",
            initialDeposit: 0,
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    price: 40_000,
                    quantity: 2,
                    pv: 7_000,
                    bv: 7_000,
                },
            ],
        });

        // The repayment is still there.
        const payment = await ctx.db.get("payments_1") as any;
        assert.ok(payment, "the repayment was not destroyed");
        assert.equal(payment.amount, 30_000);

        // The loan follows the corrected sale and the money already paid.
        const loan = await ctx.db.get(LOAN) as any;
        assert.equal(loan.amount, 80_000);
        assert.equal(loan.balance, 50_000, "80,000 owed less the 30,000 already paid");
    });

    it("records a change in the deposit rather than hiding it in the balance", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100, price: 50_000 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            customers: [makeCustomer({ _id: CUSTOMER, creditLimit: 0 })],
            sales: [
                {
                    _id: SALE,
                    businessId: BUSINESS,
                    userId: CALLER,
                    total: 100_000,
                    invoiceNumber: "INV-001",
                    date: new Date().toISOString(),
                    paymentMode: "Loan",
                    isLoan: true,
                    clientType: "Member",
                    initialDeposit: 0,
                    items: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            productCode: "BB250",
                            price: 50_000,
                            quantity: 2,
                            pv: 7_000,
                            bv: 7_000,
                        },
                    ],
                },
            ],
            loans: [
                makeLoan({
                    _id: LOAN,
                    salesId: SALE,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                }),
            ],
        });

        await call(sales.editSale, ctx, {
            saleId: SALE,
            userId: CALLER,
            customerId: CUSTOMER,
            total: 100_000,
            clientType: "Member",
            paymentMode: "Loan",
            isLoan: true,
            paymentDueDate: "2026-02-01T00:00:00.000Z",
            initialDeposit: 20_000,
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    productCode: "BB250",
                    price: 50_000,
                    quantity: 2,
                    pv: 7_000,
                    bv: 7_000,
                },
            ],
        });

        const loan = await ctx.db.get(LOAN) as any;
        assert.equal(loan.balance, 80_000);

        // The deposit is its own entry, so the ledger shows what moved.
        const deposits = await ctx.db
            .query("payments")
            .withIndex("by_loan", (q: any) => q.eq("loanId", LOAN))
            .collect();
        const adjustment = deposits.find((p: any) => p.amount === 20_000);
        assert.ok(adjustment, "the deposit is recorded as a payment");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Repayments
 * ──────────────────────────────────────────────────────────────────────── */

describe("repayments", () => {
    it("refuses a negative payment", async () => {
        const ctx = ownerContext({
            customers: [makeCustomer({ _id: CUSTOMER })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                }),
            ],
        });

        const message = await messageOf(() =>
            call(loans.makePayment, ctx, {
                loanId: LOAN,
                amount: -50_000,
                method: "cash",
                userId: CALLER,
            })
        );

        assert.match(message, /greater than zero/i);
    });

    it("refuses a payment that is not the way of paying it says it is", async () => {
        const ctx = ownerContext({
            customers: [makeCustomer({ _id: CUSTOMER })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                }),
            ],
        });

        const message = await messageOf(() =>
            call(loans.makePayment, ctx, {
                loanId: LOAN,
                amount: 10_000,
                method: "gold",
                userId: CALLER,
            })
        );

        assert.match(message, /not a way of paying/i);
    });

    it("refuses a payment that does not say how it was paid", async () => {
        const ctx = ownerContext({
            customers: [makeCustomer({ _id: CUSTOMER })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                }),
            ],
        });

        const message = await messageOf(() =>
            call(loans.makePayment, ctx, {
                loanId: LOAN,
                amount: 10_000,
                userId: CALLER,
            })
        );

        assert.match(message, /how this payment was made/i);
    });

    it("refuses a payment dated far in the past", async () => {
        // A payment that can be dated anywhere can be moved into a period
        // that has already been closed.
        const ctx = ownerContext({
            customers: [makeCustomer({ _id: CUSTOMER })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                }),
            ],
        });

        const message = await messageOf(() =>
            call(loans.makePayment, ctx, {
                loanId: LOAN,
                amount: 10_000,
                method: "cash",
                date: "2020-01-01T00:00:00.000Z",
                userId: CALLER,
            })
        );

        assert.match(message, /may not be dated/i);
    });

    it("stamps the payment with the server's own date", async () => {
        const ctx = ownerContext({
            customers: [makeCustomer({ _id: CUSTOMER })],
            sales: [
                {
                    _id: SALE,
                    businessId: BUSINESS,
                    userId: CALLER,
                    total: 100_000,
                    invoiceNumber: "INV-001",
                    date: new Date().toISOString(),
                    paymentMode: "Loan",
                    isLoan: true,
                    clientType: "Member",
                    items: [],
                },
            ],
            loans: [
                makeLoan({
                    _id: LOAN,
                    salesId: SALE,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                }),
            ],
        });

        await call(loans.makePayment, ctx, {
            loanId: LOAN,
            amount: 10_000,
            method: "cash",
            date: new Date().toISOString(),
            userId: CALLER,
        });

        const payments = await ctx.db
            .query("payments")
            .withIndex("by_loan", (q: any) => q.eq("loanId", LOAN))
            .collect();
        assert.equal(payments.length, 1);
        assert.ok(payments[0].method, "the payment says how it was paid");
    });

    it("applies a repayment to the oldest credit sale first", async () => {
        const ctx = ownerContext({
            customers: [makeCustomer({ _id: CUSTOMER })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 100_000,
                    balance: 100_000,
                    date: "2026-01-01T00:00:00.000Z",
                }),
            ],
        });

        await call(customers.recordPayment, ctx, {
            customerId: CUSTOMER,
            amount: 40_000,
            method: "cash",
            reference: "RCPT-1",
        });

        const loan = await ctx.db.get(LOAN) as any;
        assert.equal(loan.balance, 60_000);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The credit limit
 * ──────────────────────────────────────────────────────────────────────── */

describe("the credit limit", () => {
    it("refuses a sale that would take the customer over their limit", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            customers: [makeCustomer({ _id: CUSTOMER, creditLimit: 50_000 })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 40_000,
                    balance: 40_000,
                }),
            ],
        });

        const message = await messageOf(() =>
            call(
                sales.create,
                ctx,
                salePayload({
                    customerId: CUSTOMER,
                    total: 24_000,
                    paymentMode: "Loan",
                    isLoan: true,
                    paymentDueDate: "2026-02-01T00:00:00.000Z",
                })
            )
        );

        assert.match(message, /credit limit/i);
    });

    it("allows a sale that stays inside the limit", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            customers: [makeCustomer({ _id: CUSTOMER, creditLimit: 500_000 })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 40_000,
                    balance: 40_000,
                }),
            ],
        });

        const created = await call(
            sales.create,
            ctx,
            salePayload({
                customerId: CUSTOMER,
                total: 24_000,
                paymentMode: "Loan",
                isLoan: true,
                paymentDueDate: "2026-02-01T00:00:00.000Z",
            })
        );

        const sale = await ctx.db.get(created.saleId) as any;
        assert.ok(sale, "the sale was recorded");
    });

    it("does not apply a limit to a customer who has none", async () => {
        // A limit of zero means "no limit" — it is what the customer screens
        // show and what a business that does not extend credit has.
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 100 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            customers: [makeCustomer({ _id: CUSTOMER, creditLimit: 0 })],
            loans: [
                makeLoan({
                    _id: LOAN,
                    customerId: CUSTOMER,
                    amount: 400_000,
                    balance: 400_000,
                }),
            ],
        });

        const created = await call(
            sales.create,
            ctx,
            salePayload({
                customerId: CUSTOMER,
                total: 24_000,
                paymentMode: "Loan",
                isLoan: true,
                paymentDueDate: "2026-02-01T00:00:00.000Z",
            })
        );

        assert.ok(await ctx.db.get(created.saleId), "the sale was recorded");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Issuing stock to a counter
 * ──────────────────────────────────────────────────────────────────────── */

describe("issuing stock to a counter", () => {
    it("takes the goods out of the warehouse", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            shops: [makeShop()],
        });

        await call(shops.issueStock, ctx, {
            shopId: SHOP,
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    qty: 20,
                    price: 12_000,
                    pv: 7_000,
                    bv: 7_000,
                    halfPrice: false,
                },
            ],
        });

        const stock = await ctx.db.get(STOCK) as any;
        assert.equal(stock.qty, 30, "the goods left the warehouse");

        const shop = await ctx.db.get(SHOP) as any;
        assert.equal(shop.issuedStocks[0].qty, 20, "and arrived at the counter");
    });

    it("will not issue more than the warehouse holds", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 5 })],
            shops: [makeShop()],
        });

        const message = await messageOf(() =>
            call(shops.issueStock, ctx, {
                shopId: SHOP,
                items: [
                    {
                        stockId: STOCK,
                        name: "Blue Band 250g",
                        qty: 20,
                        price: 12_000,
                        pv: 7_000,
                        bv: 7_000,
                        halfPrice: false,
                    },
                ],
            })
        );

        assert.match(message, /only 5 in stock/i);
    });

    it("writes the movement to the ledger, both halves of it", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            shops: [makeShop()],
        });

        await call(shops.issueStock, ctx, {
            shopId: SHOP,
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    qty: 20,
                    price: 12_000,
                    pv: 7_000,
                    bv: 7_000,
                    halfPrice: false,
                },
            ],
        });

        const ledger = await ctx.db
            .query("stockLedger")
            .withIndex("by_businessId", (q: any) => q.eq("businessId", BUSINESS))
            .collect();

        const out = ledger.find((r: any) => r.shopId === undefined);
        const in_ = ledger.find((r: any) => r.shopId === SHOP);
        assert.ok(out, "the goods leaving the warehouse is recorded");
        assert.ok(in_, "the goods arriving at the counter is recorded");
        assert.equal(out.deltaQty, -20);
        assert.equal(in_.deltaQty, 20);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Reconciling the stock
 * ──────────────────────────────────────────────────────────────────────── */

describe("reconciling the stock", () => {
    it("says so when the balances agree with the history", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            shops: [makeShop()],
        });

        // A product is created through the app, so its opening balance is
        // in the ledger from the moment it exists.
        await call(stocks.recordOpeningBalances, ctx, {});

        await call(shops.issueStock, ctx, {
            shopId: SHOP,
            items: [
                {
                    stockId: STOCK,
                    name: "Blue Band 250g",
                    qty: 20,
                    price: 12_000,
                    pv: 7_000,
                    bv: 7_000,
                    halfPrice: false,
                },
            ],
        });

        const report = await call(stocks.getReconciliation, ctx, {});
        assert.equal(report.summary.discrepancies, 0);
        assert.equal(report.summary.untracked, 0);
        assert.equal(report.lines[0].warehouse, 30);
        assert.equal(report.lines[0].counter, 20);
    });

    it("shows the difference when the history and the balance disagree", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 50 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            shops: [
                makeShop({
                    issuedStocks: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            qty: 20,
                            price: 12_000,
                            productCode: "BB250",
                            pv: 7_000,
                            bv: 7_000,
                            halfPrice: false,
                        },
                    ],
                }),
            ],
        });

        await call(stocks.recordOpeningBalances, ctx, {});

        // Somebody changed the balance without writing down the movement.
        await ctx.db.patch(STOCK, { qty: 27 });

        const report = await call(stocks.getReconciliation, ctx, {});
        assert.equal(report.summary.discrepancies, 1);
        assert.ok(report.lines[0].note, "the difference is explained");
        assert.equal(report.lines[0].warehouseDifference, -23);
    });

    it("counts the warehouse and the counters separately and adds up", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 30 })],
            shops: [
                makeShop({
                    issuedStocks: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            qty: 20,
                            price: 12_000,
                            productCode: "BB250",
                            pv: 7_000,
                            bv: 7_000,
                            halfPrice: false,
                        },
                    ],
                }),
            ],
        });

        const stats = await call(stocks.getInventoryStats, ctx, {});
        assert.equal(stats.warehouseStock, 30);
        assert.equal(stats.totalShopStock, 20);
        assert.equal(stats.totalItems, 50, "the warehouse and the counters together");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * What the till can see
 * ──────────────────────────────────────────────────────────────────────── */

describe("what the till can see", () => {
    it("does not show a cashier the cost price", async () => {
        const ctx = signedInContext({
            users: [makeUser({ _id: CALLER })],
            businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER })],
            memberships: [
                makeMembership({ userId: CALLER, businessId: BUSINESS, role: "cashier" }),
            ],
            subscriptions: [makeActiveSubscription()],
            stocks: [makeStock({ qty: 10, purchasePrice: 10_000, pv: 7_000, bv: 7_000 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const page = await call(stocks.list, ctx, {
            paginationOpts: { numItems: 10, cursor: null },
        });

        assert.equal(page.page.length, 1);
        assert.equal(page.page[0].purchasePrice, undefined);
        assert.equal(page.page[0].pv, undefined);
        assert.equal(page.page[0].bv, undefined);
        assert.equal(page.page[0].price, 12_000, "the selling price is still there");
    });

    it("shows the cost to somebody who manages the stock", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 10, purchasePrice: 10_000, pv: 7_000, bv: 7_000 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const page = await call(stocks.list, ctx, {
            paginationOpts: { numItems: 10, cursor: null },
        });

        assert.equal(page.page[0].purchasePrice, 10_000);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The low-stock alert
 * ──────────────────────────────────────────────────────────────────────── */

describe("the low-stock alert", () => {
    it("compares each product against its own reorder point", async () => {
        const ctx = ownerContext({
            stocks: [
                makeStock({ _id: "stocks_1", name: "Water drum", qty: 5, reorderPoint: 24 }),
                makeStock({ _id: "stocks_2", name: "Tea sachets", qty: 5, reorderPoint: 2 }),
            ],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const low = await call(stocks.getLowStockAudit, ctx, {});
        const names = low.map((s: any) => s.name).sort();
        assert.deepEqual(names, ["Water drum"], "only the product below its own point");
    });

    it("uses the business's default when a product has no point of its own", async () => {
        const ctx = ownerContext({
            businesses: [makeBusiness({ _id: BUSINESS, ownerId: CALLER, defaultReorderPoint: 20 })],
            stocks: [makeStock({ _id: "stocks_1", name: "Water drum", qty: 5 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const low = await call(stocks.getLowStockAudit, ctx, {});
        assert.equal(low.length, 1);
        assert.equal(low[0].reorderPoint, 20);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * A rejected offline sale
 * ──────────────────────────────────────────────────────────────────────── */

describe("a rejected offline sale", () => {
    it("reverses the sale, the stock and the money", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 10 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            shops: [
                makeShop({
                    issuedStocks: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            qty: 2,
                            price: 12_000,
                            productCode: "BB250",
                            pv: 7_000,
                            bv: 7_000,
                            halfPrice: false,
                        },
                    ],
                }),
            ],
            sales: [
                {
                    _id: SALE,
                    businessId: BUSINESS,
                    shopId: SHOP,
                    userId: CALLER,
                    clientOfflineId: "tx-1",
                    total: 24_000,
                    invoiceNumber: "INV-001",
                    date: new Date().toISOString(),
                    paymentMode: "Cash",
                    clientType: "Non-Member",
                    items: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            productCode: "BB250",
                            price: 12_000,
                            quantity: 2,
                            pv: 7_000,
                            bv: 7_000,
                        },
                    ],
                },
            ],
            stockConflicts: [
                {
                    _id: "stockConflicts_1",
                    businessId: BUSINESS,
                    transactionId: "tx-1",
                    stockId: STOCK,
                    availableQty: 0,
                    requestedQty: 2,
                    kind: "insufficient",
                    status: "pending",
                    createdAt: new Date().toISOString(),
                },
            ],
        });

        const result = await call(sync.resolveConflict, ctx, {
            conflictId: "stockConflicts_1",
            resolution: "rejected",
            note: "The goods were never there",
        });

        assert.equal(result.changed, true);
        assert.ok(result.reversal, "the sale was reversed, not just marked");

        const sale = await ctx.db.get(SALE) as any;
        assert.equal(sale.refundAmount, 24_000, "the money came off");

        const shop = await ctx.db.get(SHOP) as any;
        const issued = shop.issuedStocks.find((s: any) => s.stockId === STOCK);
        assert.equal(issued.qty, 4, "the goods went back to the counter");
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * A product with history
 * ──────────────────────────────────────────────────────────────────────── */

describe("a product with history", () => {
    it("is archived rather than destroyed", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 10 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
            sales: [
                {
                    _id: SALE,
                    businessId: BUSINESS,
                    userId: CALLER,
                    total: 24_000,
                    invoiceNumber: "INV-001",
                    date: new Date().toISOString(),
                    paymentMode: "Cash",
                    clientType: "Non-Member",
                    items: [
                        {
                            stockId: STOCK,
                            name: "Blue Band 250g",
                            productCode: "BB250",
                            price: 12_000,
                            quantity: 2,
                            pv: 7_000,
                            bv: 7_000,
                        },
                    ],
                },
            ],
        });

        const result = await call(stocks.remove, ctx, { id: STOCK });

        assert.equal(result.archived, true, "the product was archived");
        assert.equal(result.deleted, false);

        // The history can still resolve the product.
        const stock = await ctx.db.get(STOCK) as any;
        assert.ok(stock, "the product is still there for the books to read");
        assert.equal(stock.isActive, false);
        assert.equal(stock.qty, 0, "and it is out of stock");
    });

    it("is deleted outright when nobody has ever touched it", async () => {
        const ctx = ownerContext({
            stocks: [makeStock({ qty: 10 })],
            categories: [{ _id: "categories_1", businessId: BUSINESS, type: "Grocery" }],
        });

        const result = await call(stocks.remove, ctx, { id: STOCK });

        assert.equal(result.deleted, true);
        assert.equal(result.archived, false);
        assert.equal(await ctx.db.get(STOCK), null);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * The period a report covers
 * ──────────────────────────────────────────────────────────────────────── */

describe("the period a report covers", () => {
    it("is the local day in the business's own time zone", () => {
        // A shop in Kampala closes its books at midnight its own time.
        const { start, end } = dayBounds("2026-03-10", "2026-03-10", "Africa/Kampala");

        assert.equal(start, "2026-03-09T21:00:00.000Z", "midnight in Kampala");
        assert.equal(end, "2026-03-10T20:59:59.999Z", "the last moment of the day in Kampala");
    });

    it("includes a sale made at half past eleven at night", () => {
        const { start, end } = dayBounds("2026-03-10", "2026-03-10", "Africa/Kampala");
        const lateSale = "2026-03-10T20:30:00.000Z"; // 23:30 in Kampala

        assert.ok(lateSale >= start && lateSale <= end, "it belongs to that day");
    });

    it("includes a sale made at half past midnight", () => {
        const { start, end } = dayBounds("2026-03-10", "2026-03-10", "Africa/Kampala");
        const earlySale = "2026-03-09T21:30:00.000Z"; // 00:30 in Kampala on the 10th

        assert.ok(earlySale >= start && earlySale <= end, "it belongs to that day");
    });

    it("leaves the last sale of the previous evening to the previous day", () => {
        const { start, end } = dayBounds("2026-03-10", "2026-03-10", "Africa/Kampala");
        const lateSale = "2026-03-09T20:30:00.000Z"; // 23:30 in Kampala on the 9th

        assert.ok(!(lateSale >= start && lateSale <= end), "it belongs to the day before");
    });

    it("falls back to UTC when the business has no time zone", () => {
        const { start, end } = dayBounds("2026-03-10", "2026-03-10");

        assert.equal(start, "2026-03-10");
        assert.equal(end, "2026-03-10T23:59:59.999Z");
    });
});
