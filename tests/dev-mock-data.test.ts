/**
 * SMART_BUZ — the development mock data.
 *
 * The demo is only worth having if it is shaped like the real thing, so
 * these tests hold it to the rules the product itself keeps:
 *
 *   • the catalogue is real products at real prices, for every trade the
 *     product supports — never "Product 1";
 *   • a product is never sold below what it cost;
 *   • the demo sales are written by the real sale engine, so every total is
 *     the sum of its lines and every VAT split adds back to the total;
 *   • the goods a month of trading used are accounted for, and nothing is
 *     ever left below zero;
 *   • running the seeder twice changes nothing the second time;
 *   • and it refuses to run without the server secret, so a browser can
 *     never fill a business with made-up data.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

import {
    MOCK_CATALOGUES,
    MOCK_FALLBACK_CATALOGUE,
    mockCatalogueFor,
    mockClientTypesFor,
} from "../convex/devMockCatalogue";
import { seedMockData } from "../convex/devMockData";
import { BUSINESS_CATEGORIES } from "../src/lib/business-categories";
import {
    FakeContext,
    FakeRow,
    makeActiveSubscription,
    makeBusiness,
    makeMembership,
    makeSession,
    makeUser,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const USER = "users_1";

/** The secret the server checks the caller against. */
const SECRET = "a-test-server-secret-that-is-long-enough";

/** The deployment the seeder says it means to write to. */
const DEPLOYMENT = "dev:test-deployment";

/** What the seeder says it did. */
interface SeedReport {
    products: number;
    customers: number;
    salesPlanned: number;
    salesWritten: number;
    nextCursor: number | null;
    complete: boolean;
    anchor: string;
    staff: Array<{ email: string; password: string; role: string }>;
}

/** Invoke the mutation's handler directly. */
async function call(
    ctx: unknown,
    args: Record<string, unknown> = {}
): Promise<SeedReport> {
    const handler = (
        seedMockData as unknown as {
            _handler: (ctx: unknown, args: unknown) => Promise<SeedReport>;
        }
    )._handler;
    return await handler(ctx, args);
}

/**
 * The number a field holds.
 *
 * A fake row is untyped on purpose — it is whatever a table has in it —
 * so a test that wants to do arithmetic on a field says so here.
 */
function num(row: FakeRow, field: string): number {
    return row[field] as number;
}

/** A context with one owner in one business. */
function ownerContext(extra: Record<string, FakeRow[]> = {}): FakeContext {
    return new FakeContext({
        identity: { subject: USER, sid: "session-abc" },
        users: [makeUser({ _id: USER })],
        businesses: [
            makeBusiness({
                _id: BUSINESS,
                categoryId: "retail",
                taxEnabled: true,
                taxRate: 18,
                taxInclusive: true,
            }),
        ],
        memberships: [
            makeMembership({
                _id: "memberships_1",
                userId: USER,
                businessId: BUSINESS,
                role: "business_owner",
            }),
        ],
        sessions: [makeSession({ userId: USER, sessionId: "session-abc" })],
        subscriptions: [makeActiveSubscription()],
        ...extra,
    });
}

before(() => {
    process.env.SMARTBUZ_SERVER_SECRET = SECRET;
    process.env.CONVEX_DEPLOYMENT = DEPLOYMENT;
});

/* ────────────────────────────────────────────────────────────────────────────
 * The catalogue
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the mock catalogue", () => {
    it("has a catalogue for every trade the product supports", () => {
        const missing = BUSINESS_CATEGORIES.filter(
            (category) => !MOCK_CATALOGUES[category.id]
        ).map((category) => category.id);

        assert.deepEqual(missing, [], `no catalogue for: ${missing.join(", ")}`);
    });

    it("never sells a product below what it cost", () => {
        for (const [trade, rows] of Object.entries(MOCK_CATALOGUES)) {
            for (const [name, , price, cost] of rows) {
                assert.ok(
                    price > 0,
                    `${trade}: "${name}" is not sold for anything (${price})`
                );
                assert.ok(
                    cost >= 0,
                    `${trade}: "${name}" costs ${cost}, which is not a price`
                );
                assert.ok(
                    cost <= price,
                    `${trade}: "${name}" is sold for ${price} but costs ${cost}`
                );
            }
        }
    });

    it("gives every trade a shelf of things with no name left out", () => {
        for (const [trade, rows] of Object.entries(MOCK_CATALOGUES)) {
            assert.ok(rows.length >= 8, `${trade} has only ${rows.length} products`);
            for (const [name, category] of rows) {
                assert.ok(name.trim().length > 0, `${trade} has a product with no name`);
                assert.ok(
                    category.trim().length > 0,
                    `${trade}: "${name}" has no category`
                );
            }
        }
    });

    it("never lists the same product twice in one trade", () => {
        for (const [trade, rows] of Object.entries(MOCK_CATALOGUES)) {
            const names = rows.map(([name]) => name);
            const repeated = names.filter((name, index) => names.indexOf(name) !== index);
            assert.deepEqual(repeated, [], `${trade} lists ${repeated.join(", ")} twice`);
        }
    });

    it("falls back to a real catalogue for a trade it does not know", () => {
        const products = mockCatalogueFor("a-trade-that-does-not-exist");
        assert.ok(products.length >= 8);
        assert.equal(products.length, MOCK_FALLBACK_CATALOGUE.length);
        for (const product of products) {
            assert.ok(product.price > 0);
            assert.ok(product.purchasePrice <= product.price);
        }
    });

    it("sells to distributors only in the trades that sell to distributors", () => {
        assert.ok(mockClientTypesFor("wholesale").includes("Distributor"));
        assert.ok(!mockClientTypesFor("retail").includes("Distributor"));
        assert.ok(mockClientTypesFor("retail").includes("Retail"));
    });
});

/* ────────────────────────────────────────────────────────────────────────────
 * The seeder
 * ──────────────────────────────────────────────────────────────────────────── */

describe("the demo seeder", () => {
    it("refuses to run without the server secret", async () => {
        const ctx = ownerContext();

        await assert.rejects(
            () => call(ctx, { businessId: BUSINESS, serverSecret: "wrong" }),
            /only be written by the SMARTBUZ server/i
        );
        assert.equal(ctx.tables.stocks.length, 0);
        assert.equal(ctx.tables.sales.length, 0);
    });

    it("refuses to write to a deployment it was not aimed at", async () => {
        const ctx = ownerContext();

        await assert.rejects(
            () =>
                call(ctx, {
                    businessId: BUSINESS,
                    serverSecret: SECRET,
                    devDeployment: "dev:somewhere-else",
                }),
            /development deployment/i
        );
        assert.equal(ctx.tables.sales.length, 0);
    });

    it("fills a business with a catalogue, customers, suppliers and a month of trading", async () => {
        const ctx = ownerContext();

        const report = await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        assert.ok(report.products > 0, "no products were written");
        assert.ok(report.customers > 0, "no customers were written");
        assert.ok(report.salesPlanned > 0, "no sales were planned");
        assert.equal(report.salesWritten, 25, "the first batch is not a batch of 25");
        assert.equal(report.nextCursor, 25);
        assert.equal(report.complete, false);

        assert.ok(ctx.tables.categories.length > 0, "no categories were written");
        assert.ok(ctx.tables.stocks.length > 0, "no products were written");
        assert.ok(ctx.tables.suppliers.length > 0, "no suppliers were written");
        assert.ok(ctx.tables.promotions.length > 0, "no promotions were written");
        assert.ok(ctx.tables.expenses.length > 0, "no expenses were written");
        assert.ok(ctx.tables.stockLedger.length > 0, "the opening stock was not recorded");
        assert.equal(ctx.tables.sales.length, 25);
    });

    it("writes every product with a code, a barcode and a price above its cost", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        const codes = new Set<string>();
        for (const stock of ctx.tables.stocks) {
            assert.ok(stock.productCode, `"${stock.name}" has no code`);
            assert.ok(!codes.has(stock.productCode as string), `code ${stock.productCode} repeats`);
            codes.add(stock.productCode as string);

            assert.ok(
                typeof stock.barcode === "string" && (stock.barcode as string).length === 13,
                `"${stock.name}" has no barcode`
            );
            assert.ok(
                num(stock, "price") >= num(stock, "purchasePrice"),
                `"${stock.name}" is sold below what it cost`
            );
            assert.ok(num(stock, "qty") > 0, `"${stock.name}" opened empty`);
        }

        // Airtime is sold at face value — the shop earns nothing on it — but
        // nothing else in the catalogue may be sold without a margin.
        const withoutMargin = ctx.tables.stocks.filter(
            (stock) => num(stock, "price") === num(stock, "purchasePrice")
        );
        assert.ok(
            withoutMargin.length <= 2,
            `${withoutMargin.length} products are sold without a margin`
        );
    });

    it("writes every sale with a total that is the sum of its lines", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        for (const sale of ctx.tables.sales) {
            const lines = (sale.items ?? []) as Array<{
                price: number;
                quantity: number;
            }>;
            const sum = lines.reduce((total, line) => total + line.price * line.quantity, 0);
            assert.equal(sale.total, sum, `sale ${sale.invoiceNumber} does not add up`);
        }
    });

    it("splits the VAT on every sale so that it adds back to the total", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        for (const sale of ctx.tables.sales) {
            assert.equal(typeof sale.taxAmount, "number", "a sale carries no VAT");
            assert.equal(typeof sale.netAmount, "number", "a sale carries no net");
            const sum = (sale.taxAmount as number) + (sale.netAmount as number);
            assert.ok(
                Math.abs(sum - (sale.total as number)) < 0.02,
                `the VAT on ${sale.invoiceNumber} does not add back up`
            );
            assert.equal(sale.taxRate, 18);
            assert.equal(sale.taxInclusive, true);
        }
    });

    it("dates the trading inside the month and never in the future", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        const now = Date.now();
        const dates = ctx.tables.sales.map((sale) => Date.parse(sale.date as string));
        for (const at of dates) {
            assert.ok(Number.isFinite(at), "a sale carries no date");
            assert.ok(at <= now, "a sale is dated in the future");
            assert.ok(
                at >= now - 30 * 86_400_000,
                "a sale is dated further back than a till may backdate one"
            );
        }
        assert.ok(new Set(dates).size > 5, "the whole month was traded in one day");
    });

    it("never leaves a product below zero", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        for (const stock of ctx.tables.stocks) {
            assert.ok(
                num(stock, "qty") >= 0,
                `"${stock.name}" went below zero (${num(stock, "qty")})`
            );
        }
    });

    it("accounts for every unit it sold in the ledger", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        const balance = new Map<string, number>();
        for (const row of ctx.tables.stockLedger) {
            const key = row.stockId as string;
            balance.set(key, (balance.get(key) ?? 0) + (row.deltaQty as number));
        }
        for (const stock of ctx.tables.stocks) {
            assert.equal(
                balance.get(stock._id),
                stock.qty,
                `the ledger and the shelf disagree about "${stock.name}"`
            );
        }
    });

    it("writes nothing the second time it is run", async () => {
        const ctx = ownerContext();
        const args = {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        };

        const first = await call(ctx, args);
        const productsAfterFirst = ctx.tables.stocks.length;
        const salesAfterFirst = ctx.tables.sales.length;

        const second = await call(ctx, args);

        assert.equal(second.salesWritten, 0, "the second run wrote sales again");
        assert.equal(ctx.tables.stocks.length, productsAfterFirst, "products were duplicated");
        assert.equal(ctx.tables.sales.length, salesAfterFirst, "sales were duplicated");
        assert.equal(first.salesPlanned, second.salesPlanned);
    });

    it("keeps the demo inside the business it was asked for", async () => {
        const ctx = ownerContext();
        await call(ctx, {
            businessId: BUSINESS,
            serverSecret: SECRET,
            devDeployment: DEPLOYMENT,
            cursor: 0,
        });

        for (const table of [
            ctx.tables.stocks,
            ctx.tables.sales,
            ctx.tables.customers,
            ctx.tables.suppliers,
            ctx.tables.promotions,
            ctx.tables.expenses,
            ctx.tables.categories,
            ctx.tables.stockLedger,
        ]) {
            for (const row of table) {
                assert.equal(
                    row.businessId,
                    BUSINESS,
                    `a row was written for another business: ${JSON.stringify(row)}`
                );
            }
        }
    });
});
