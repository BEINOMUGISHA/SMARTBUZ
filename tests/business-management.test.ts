/**
 * SMARTBUZ — Phase 4 business management.
 *
 * The behaviour that matters for the customer book, the supplier book and
 * purchasing, asserted against the real functions:
 *
 *  - A customer balance is **derived** from the credit sales and payments,
 *    so it cannot drift from the statement.
 *  - A payment is applied to the **oldest** credit sale first.
 *  - The **same reference** is the same money: a duplicate payment is
 *    refused, on both sides of the book.
 *  - A supplier balance is the **ledger**, not a number somebody typed.
 *  - Goods can arrive **in parts**, and only what arrived increases stock.
 *  - Receiving more than was ordered is refused.
 *  - Historical purchase cost survives a later price change.
 *  - A business never sees another business's customers, suppliers or orders.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import * as customers from "../convex/customers";
import * as suppliers from "../convex/suppliers";
import * as purchasing from "../convex/purchasing";

import {
  FakeContext,
  FakeRow,
  makeBranch,
  makeBusiness,
  makeCustomer,
  makeLoan,
  makeMembership,
  makePayment,
  makePurchaseOrder,
  makeStock,
  makeSupplier,
  makeSupplierLedger,
  makeUser,
  signedInContext,
} from "./helpers/fake-context";

const BUSINESS = "businesses_1";
const OTHER_BUSINESS = "businesses_2";
const CALLER = "users_1";

/**
 * Invoke a Convex mutation or query handler directly.
 *
 * The `mutation()` wrapper stores the handler as `_handler`; calling it with
 * our fake context runs the real code.
 */
async function call(
  registered: unknown,
  ctx: unknown,
  args: Record<string, unknown> = {}
): Promise<any> {
  const handler = (registered as { _handler: Function })._handler;
  return handler(ctx, args);
}

/** A context where the caller is a member of the business with `role`. */
function contextFor(
  role: string,
  extra: Record<string, FakeRow[]> = {}
): FakeContext {
  return signedInContext({
    users: [makeUser({ _id: CALLER })],
    businesses: [
      makeBusiness({ _id: BUSINESS, ownerId: CALLER }),
      makeBusiness({ _id: OTHER_BUSINESS, name: "Other Business", ownerId: "users_2" }),
    ],
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

/* ────────────────────────────────────────────────────────────────────────
 * Customers — the credit account
 * ──────────────────────────────────────────────────────────────────────── */

describe("customer balances are derived from the credit account", () => {
  it("reports the balance of the open credit sales, not a stored figure", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({ _id: "loans_1", customerId: "customers_1", amount: 100_000, balance: 100_000 }),
        makeLoan({ _id: "loans_2", customerId: "customers_1", amount: 50_000, balance: 50_000 }),
      ],
    });

    const result = await call(customers.getPaginated, ctx, { limit: 10, offset: 0 });

    assert.equal(result.totalCount, 1);
    assert.equal(result.page[0].outstandingBalance, 150_000);
  });

  it("ignores a credit sale that has already been settled", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({ _id: "loans_1", customerId: "customers_1", amount: 100_000, balance: 0 }),
      ],
    });

    const result = await call(customers.getPaginated, ctx, { limit: 10, offset: 0 });

    assert.equal(result.page[0].outstandingBalance, 0);
  });

  it("gives the same balance on the statement as on the account", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({
          _id: "loans_1",
          customerId: "customers_1",
          amount: 100_000,
          balance: 70_000,
        }),
      ],
      payments: [
        makePayment({
          _id: "payments_1",
          customerId: "customers_1",
          loanId: "loans_1",
          amount: 30_000,
          balance: 70_000,
        }),
      ],
    });

    const account = await call(customers.getAccount, ctx, { customerId: "customers_1" });
    const statement = await call(customers.getStatement, ctx, { customerId: "customers_1" });

    assert.equal(account.outstandingBalance, 70_000);
    assert.equal(statement.closingBalance, 70_000);
    assert.equal(statement.totalCharged, 100_000);
    assert.equal(statement.totalPaid, 30_000);
  });
});

describe("customer payments", () => {
  it("applies the money to the oldest credit sale first", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({
          _id: "loans_1",
          customerId: "customers_1",
          amount: 100_000,
          balance: 100_000,
          date: "2026-01-01T00:00:00.000Z",
        }),
        makeLoan({
          _id: "loans_2",
          customerId: "customers_1",
          amount: 200_000,
          balance: 200_000,
          date: "2026-02-01T00:00:00.000Z",
        }),
      ],
    });

    await call(customers.recordPayment, ctx, {
      customerId: "customers_1",
      amount: 120_000,
      reference: "RCPT-001",
    });

    const oldest = ctx.tables.loans.find((l) => l._id === "loans_1");
    const newest = ctx.tables.loans.find((l) => l._id === "loans_2");

    // The oldest sale is cleared, and only the remainder lands on the newer one.
    assert.equal(oldest?.balance, 0);
    assert.equal(newest?.balance, 180_000);
  });

  it("refuses a second payment with the same reference", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({ _id: "loans_1", customerId: "customers_1", amount: 100_000, balance: 100_000 }),
      ],
    });

    await call(customers.recordPayment, ctx, {
      customerId: "customers_1",
      amount: 10_000,
      reference: "RCPT-001",
    });

    await assert.rejects(
      () =>
        call(customers.recordPayment, ctx, {
          customerId: "customers_1",
          amount: 10_000,
          reference: "RCPT-001",
        }),
      /already been recorded/
    );

    // The account moved once, not twice.
    const loan = ctx.tables.loans.find((l) => l._id === "loans_1");
    assert.equal(loan?.balance, 90_000);
  });

  it("refuses a payment larger than what is owed", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({ _id: "loans_1", customerId: "customers_1", amount: 100_000, balance: 100_000 }),
      ],
    });

    await assert.rejects(
      () =>
        call(customers.recordPayment, ctx, {
          customerId: "customers_1",
          amount: 150_000,
        }),
      /exceeds the outstanding balance/
    );
  });

  it("refuses a payment that is not positive", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
    });

    await assert.rejects(
      () =>
        call(customers.recordPayment, ctx, {
          customerId: "customers_1",
          amount: 0,
        }),
      /greater than zero/
    );
  });

  it("is refused to a role that cannot manage credit", async () => {
    // A salesperson may sell and register customers, but does not get to
    // move money on the credit book.
    const ctx = contextFor("salesperson", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({ _id: "loans_1", customerId: "customers_1", amount: 100_000, balance: 100_000 }),
      ],
    });

    await assert.rejects(
      () =>
        call(customers.recordPayment, ctx, {
          customerId: "customers_1",
          amount: 10_000,
        }),
      /Forbidden/
    );
  });

  it("is refused to a role that cannot manage credit, even for its own business", async () => {
    const ctx = contextFor("inventory_manager", {
      customers: [makeCustomer({ _id: "customers_1" })],
    });

    await assert.rejects(
      () => call(customers.setCreditLimit, ctx, { customerId: "customers_1", creditLimit: 500_000 }),
      /Forbidden/
    );
  });
});

describe("the customer book", () => {
  it("refuses a second customer with the same phone number", async () => {
    const ctx = contextFor("salesperson", {
      customers: [makeCustomer({ _id: "customers_1", phone: "0772123456" })],
    });

    await assert.rejects(
      () =>
        call(customers.add, ctx, {
          name: "Someone Else",
          phone: "0772123456",
          userId: CALLER,
        }),
      /already exists/
    );
  });

  it("deactivates a customer who has trading history instead of deleting them", async () => {
    const ctx = contextFor("salesperson", {
      customers: [makeCustomer({ _id: "customers_1" })],
      sales: [
        {
          _id: "sales_1",
          _creationTime: 1,
          businessId: BUSINESS,
          customerId: "customers_1",
          total: 50_000,
          itemCount: 1,
          date: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await call(customers.remove, ctx, { id: "customers_1", userId: CALLER });

    assert.equal(result.deactivated, true);
    assert.equal(result.deleted, false);

    const customer = ctx.tables.customers.find((c) => c._id === "customers_1");
    assert.equal(customer?.isActive, false);
  });

  it("deletes a customer who has never traded", async () => {
    const ctx = contextFor("salesperson", {
      customers: [makeCustomer({ _id: "customers_1" })],
    });

    const result = await call(customers.remove, ctx, { id: "customers_1", userId: CALLER });

    assert.equal(result.deleted, true);
    assert.equal(ctx.tables.customers.length, 0);
  });

  it("refuses to read a customer from another business", async () => {
    const ctx = contextFor("accountant", {
      customers: [
        makeCustomer({ _id: "customers_1", businessId: OTHER_BUSINESS }),
      ],
    });

    await assert.rejects(
      () => call(customers.getById, ctx, { id: "customers_1" }),
      /another business/
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Suppliers — the ledger
 * ──────────────────────────────────────────────────────────────────────── */

describe("the supplier ledger", () => {
  it("moves the balance by the signed amount of the movement", async () => {
    const ctx = contextFor("accountant", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 0 })],
    });

    const { balanceAfter } = await call(suppliers.paySupplier, ctx, {
      supplierId: "suppliers_1",
      amount: 40_000,
      reference: "BANK-9",
    });

    assert.equal(balanceAfter, -40_000);
    const supplier = ctx.tables.suppliers.find((s) => s._id === "suppliers_1");
    assert.equal(supplier?.balance, -40_000);

    const ledger = ctx.tables.supplierLedger;
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, "payment");
    assert.equal(ledger[0].amount, -40_000);
    assert.equal(ledger[0].balanceAfter, -40_000);
  });

  it("refuses a second payment with the same reference", async () => {
    const ctx = contextFor("accountant", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 100_000 })],
    });

    await call(suppliers.paySupplier, ctx, {
      supplierId: "suppliers_1",
      amount: 40_000,
      reference: "BANK-9",
    });

    await assert.rejects(
      () =>
        call(suppliers.paySupplier, ctx, {
          supplierId: "suppliers_1",
          amount: 40_000,
          reference: "BANK-9",
        }),
      /already been recorded/
    );

    assert.equal(ctx.tables.purchasePayments.length, 1);
    assert.equal(ctx.tables.supplierLedger.length, 1);
  });

  it("settles the oldest open invoice first", async () => {
    const ctx = contextFor("accountant", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 300_000 })],
      supplierInvoices: [
        {
          _id: "supplierInvoices_1",
          _creationTime: 1,
          businessId: BUSINESS,
          invoiceNumber: "INV-1",
          supplierId: "suppliers_1",
          supplierName: "Nile Foods Ltd",
          date: "2026-01-01T00:00:00.000Z",
          total: 100_000,
          amountPaid: 0,
          status: "open",
          items: [],
        },
        {
          _id: "supplierInvoices_2",
          _creationTime: 1,
          businessId: BUSINESS,
          invoiceNumber: "INV-2",
          supplierId: "suppliers_1",
          supplierName: "Nile Foods Ltd",
          date: "2026-02-01T00:00:00.000Z",
          total: 200_000,
          amountPaid: 0,
          status: "open",
          items: [],
        },
      ],
    });

    await call(suppliers.paySupplier, ctx, {
      supplierId: "suppliers_1",
      amount: 100_000,
      reference: "BANK-10",
    });

    const first = ctx.tables.supplierInvoices.find((i) => i._id === "supplierInvoices_1");
    const second = ctx.tables.supplierInvoices.find((i) => i._id === "supplierInvoices_2");

    assert.equal(first?.status, "paid");
    assert.equal(first?.amountPaid, 100_000);
    assert.equal(second?.status, "open");
    assert.equal(second?.amountPaid, 0);
  });

  it("refuses a payment larger than the invoice it settles", async () => {
    const ctx = contextFor("accountant", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 100_000 })],
      supplierInvoices: [
        {
          _id: "supplierInvoices_1",
          _creationTime: 1,
          businessId: BUSINESS,
          invoiceNumber: "INV-1",
          supplierId: "suppliers_1",
          supplierName: "Nile Foods Ltd",
          date: "2026-01-01T00:00:00.000Z",
          total: 100_000,
          amountPaid: 0,
          status: "open",
          items: [],
        },
      ],
    });

    await assert.rejects(
      () =>
        call(suppliers.paySupplier, ctx, {
          supplierId: "suppliers_1",
          amount: 150_000,
          reference: "BANK-11",
        }),
      /still owed on invoice/
    );
  });

  it("is refused to a role that cannot pay suppliers", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 100_000 })],
    });

    await assert.rejects(
      () =>
        call(suppliers.paySupplier, ctx, {
          supplierId: "suppliers_1",
          amount: 10_000,
        }),
      /Forbidden/
    );
  });

  it("refuses to read a supplier from another business", async () => {
    const ctx = contextFor("accountant", {
      suppliers: [
        makeSupplier({ _id: "suppliers_1", businessId: OTHER_BUSINESS }),
      ],
    });

    await assert.rejects(
      () => call(suppliers.getById, ctx, { id: "suppliers_1" }),
      /another business/
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Purchasing — orders, receipts and stock
 * ──────────────────────────────────────────────────────────────────────── */

describe("purchase orders", () => {
  it("numbers orders sequentially, per business", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1" })],
    });

    const first = await call(purchasing.createPurchaseOrder, ctx, {
      supplierId: "suppliers_1",
      supplierName: "Nile Foods Ltd",
      items: [{ stockId: "stocks_1", name: "Blue Band 250g", quantity: 10, unitCost: 10_000 }],
    });

    const second = await call(purchasing.createPurchaseOrder, ctx, {
      supplierId: "suppliers_1",
      supplierName: "Nile Foods Ltd",
      items: [{ stockId: "stocks_1", name: "Blue Band 250g", quantity: 5, unitCost: 10_000 }],
    });

    assert.equal(first.poNumber, "PO-0001");
    assert.equal(second.poNumber, "PO-0002");
  });

  it("refuses to let a draft order jump straight to received", async () => {
    const ctx = contextFor("inventory_manager", {
      purchaseOrders: [makePurchaseOrder({ _id: "purchaseOrders_1", status: "draft" })],
    });

    await assert.rejects(
      () =>
        call(purchasing.updatePurchaseOrderStatus, ctx, {
          id: "purchaseOrders_1",
          status: "received",
        }),
      /cannot become received/
    );
  });

  it("refuses to edit an order that has already been placed", async () => {
    const ctx = contextFor("inventory_manager", {
      purchaseOrders: [makePurchaseOrder({ _id: "purchaseOrders_1", status: "ordered" })],
    });

    await assert.rejects(
      () =>
        call(purchasing.updatePurchaseOrder, ctx, {
          id: "purchaseOrders_1",
          notes: "changed my mind",
        }),
      /Only a draft purchase order can be edited/
    );
  });

  it("refuses to read an order from another business", async () => {
    const ctx = contextFor("inventory_manager", {
      purchaseOrders: [
        makePurchaseOrder({ _id: "purchaseOrders_1", businessId: OTHER_BUSINESS }),
      ],
    });

    await assert.rejects(
      () => call(purchasing.getPurchaseOrder, ctx, { id: "purchaseOrders_1" }),
      /another business/
    );
  });
});

describe("receiving goods", () => {
  it("increases stock by what actually arrived, and nothing more", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 10 })],
      purchaseOrders: [
        makePurchaseOrder({
          _id: "purchaseOrders_1",
          status: "ordered",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              productCode: "BB250",
              quantity: 20,
              unitCost: 10_000,
              receivedQty: 0,
              returnedQty: 0,
            },
          ],
        }),
      ],
    });

    const result = await call(purchasing.receiveGoods, ctx, {
      poId: "purchaseOrders_1",
      items: [
        {
          stockId: "stocks_1",
          name: "Blue Band 250g",
          quantity: 6,
          unitCost: 10_000,
          poItemIndex: 0,
        },
      ],
    });

    assert.equal(result.fullyReceived, false);
    assert.equal(result.status, "partially_received");
    assert.equal(result.total, 60_000);

    const stock = ctx.tables.stocks.find((s) => s._id === "stocks_1");
    assert.equal(stock?.qty, 16); // 10 already there, 6 received

    const order = ctx.tables.purchaseOrders.find((o) => o._id === "purchaseOrders_1");
    assert.equal(order?.status, "partially_received");
    assert.equal((order?.items as any[])[0].receivedQty, 6);
  });

  it("closes the order only when every line is complete", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 10 })],
      purchaseOrders: [
        makePurchaseOrder({
          _id: "purchaseOrders_1",
          status: "partially_received",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              productCode: "BB250",
              quantity: 20,
              unitCost: 10_000,
              receivedQty: 6,
              returnedQty: 0,
            },
          ],
        }),
      ],
    });

    const result = await call(purchasing.receiveGoods, ctx, {
      poId: "purchaseOrders_1",
      items: [
        {
          stockId: "stocks_1",
          name: "Blue Band 250g",
          quantity: 14,
          unitCost: 10_000,
          poItemIndex: 0,
        },
      ],
    });

    assert.equal(result.fullyReceived, true);
    assert.equal(result.status, "received");

    const order = ctx.tables.purchaseOrders.find((o) => o._id === "purchaseOrders_1");
    assert.equal(order?.status, "received");
    assert.ok(order?.receivedDate);
  });

  it("refuses to receive more than was ordered", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 10 })],
      purchaseOrders: [
        makePurchaseOrder({
          _id: "purchaseOrders_1",
          status: "ordered",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              productCode: "BB250",
              quantity: 20,
              unitCost: 10_000,
              receivedQty: 0,
              returnedQty: 0,
            },
          ],
        }),
      ],
    });

    await assert.rejects(
      () =>
        call(purchasing.receiveGoods, ctx, {
          poId: "purchaseOrders_1",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              quantity: 25,
              unitCost: 10_000,
              poItemIndex: 0,
            },
          ],
        }),
      /remain outstanding/
    );

    const stock = ctx.tables.stocks.find((s) => s._id === "stocks_1");
    assert.equal(stock?.qty, 10); // untouched
  });

  it("refuses to receive against a cancelled order", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 10 })],
      purchaseOrders: [
        makePurchaseOrder({ _id: "purchaseOrders_1", status: "cancelled" }),
      ],
    });

    await assert.rejects(
      () =>
        call(purchasing.receiveGoods, ctx, {
          poId: "purchaseOrders_1",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              quantity: 5,
              unitCost: 10_000,
              poItemIndex: 0,
            },
          ],
        }),
      /cancelled/
    );
  });

  it("keeps the purchase cost even after the price changes", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 0, purchasePrice: 8_000 })],
      purchaseOrders: [
        makePurchaseOrder({
          _id: "purchaseOrders_1",
          status: "ordered",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              productCode: "BB250",
              quantity: 10,
              unitCost: 9_500,
              receivedQty: 0,
              returnedQty: 0,
            },
          ],
        }),
      ],
    });

    await call(purchasing.receiveGoods, ctx, {
      poId: "purchaseOrders_1",
      items: [
        {
          stockId: "stocks_1",
          name: "Blue Band 250g",
          quantity: 10,
          unitCost: 9_500,
          poItemIndex: 0,
        },
      ],
    });

    // The current price follows the latest purchase…
    const stock = ctx.tables.stocks.find((s) => s._id === "stocks_1");
    assert.equal(stock?.purchasePrice, 9_500);

    // …but the cost of that purchase is on the record.
    assert.equal(ctx.tables.stockCostHistory.length, 1);
    const history = ctx.tables.stockCostHistory[0];
    assert.equal(history.unitCost, 9_500);
    assert.equal(history.quantity, 10);
    assert.equal(history.totalCost, 95_000);
  });

  it("writes to the stock ledger so the figure can be explained", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 10 })],
      purchaseOrders: [
        makePurchaseOrder({ _id: "purchaseOrders_1", status: "ordered" }),
      ],
    });

    await call(purchasing.receiveGoods, ctx, {
      poId: "purchaseOrders_1",
      items: [
        {
          stockId: "stocks_1",
          name: "Blue Band 250g",
          quantity: 5,
          unitCost: 10_000,
          poItemIndex: 0,
        },
      ],
    });

    assert.equal(ctx.tables.stockLedger.length, 1);
    assert.equal(ctx.tables.stockLedger[0].deltaQty, 5);
    assert.equal(ctx.tables.stockLedger[0].eventType, "RESTOCK");
  });
});

describe("supplier invoices", () => {
  it("puts the business on the hook through the supplier ledger", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 0 })],
      stocks: [makeStock({ _id: "stocks_1" })],
    });

    await call(purchasing.recordInvoice, ctx, {
      supplierId: "suppliers_1",
      invoiceNumber: "INV-77",
      items: [
        { stockId: "stocks_1", name: "Blue Band 250g", quantity: 10, unitCost: 10_000 },
      ],
    });

    const supplier = ctx.tables.suppliers.find((s) => s._id === "suppliers_1");
    assert.equal(supplier?.balance, 100_000);

    const ledger = ctx.tables.supplierLedger;
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, "invoice");
    assert.equal(ledger[0].amount, 100_000);
    assert.equal(ledger[0].balanceAfter, 100_000);
  });

  it("refuses the same invoice number twice", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 0 })],
      stocks: [makeStock({ _id: "stocks_1" })],
    });

    const args = {
      supplierId: "suppliers_1",
      invoiceNumber: "INV-77",
      items: [
        { stockId: "stocks_1", name: "Blue Band 250g", quantity: 10, unitCost: 10_000 },
      ],
    };

    await call(purchasing.recordInvoice, ctx, args);

    await assert.rejects(
      () => call(purchasing.recordInvoice, ctx, args),
      /already been recorded/
    );

    assert.equal(ctx.tables.supplierInvoices.length, 1);
    assert.equal(ctx.tables.supplierLedger.length, 1);
  });
});

describe("purchase returns", () => {
  it("takes the goods back out of stock and credits the supplier", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 100_000 })],
      stocks: [makeStock({ _id: "stocks_1", qty: 30 })],
      purchaseOrders: [
        makePurchaseOrder({
          _id: "purchaseOrders_1",
          status: "received",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              productCode: "BB250",
              quantity: 30,
              unitCost: 10_000,
              receivedQty: 30,
              returnedQty: 0,
            },
          ],
        }),
      ],
    });

    const result = await call(purchasing.createPurchaseReturn, ctx, {
      supplierId: "suppliers_1",
      purchaseOrderId: "purchaseOrders_1",
      items: [
        { stockId: "stocks_1", name: "Blue Band 250g", quantity: 4, unitCost: 10_000 },
      ],
    });

    assert.equal(result.total, 40_000);

    const stock = ctx.tables.stocks.find((s) => s._id === "stocks_1");
    assert.equal(stock?.qty, 26);

    const supplier = ctx.tables.suppliers.find((s) => s._id === "suppliers_1");
    assert.equal(supplier?.balance, 60_000);

    const order = ctx.tables.purchaseOrders.find((o) => o._id === "purchaseOrders_1");
    assert.equal((order?.items as any[])[0].returnedQty, 4);
  });

  it("refuses to return more than was received", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 0 })],
      stocks: [makeStock({ _id: "stocks_1", qty: 30 })],
      purchaseOrders: [
        makePurchaseOrder({
          _id: "purchaseOrders_1",
          status: "received",
          items: [
            {
              stockId: "stocks_1",
              name: "Blue Band 250g",
              productCode: "BB250",
              quantity: 30,
              unitCost: 10_000,
              receivedQty: 10,
              returnedQty: 0,
            },
          ],
        }),
      ],
    });

    await assert.rejects(
      () =>
        call(purchasing.createPurchaseReturn, ctx, {
          supplierId: "suppliers_1",
          purchaseOrderId: "purchaseOrders_1",
          items: [
            { stockId: "stocks_1", name: "Blue Band 250g", quantity: 20, unitCost: 10_000 },
          ],
        }),
      /still returnable/
    );
  });

  it("refuses to return goods that are not in stock", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1", balance: 0 })],
      stocks: [makeStock({ _id: "stocks_1", qty: 2 })],
    });

    await assert.rejects(
      () =>
        call(purchasing.createPurchaseReturn, ctx, {
          supplierId: "suppliers_1",
          items: [
            { stockId: "stocks_1", name: "Blue Band 250g", quantity: 5, unitCost: 10_000 },
          ],
        }),
      /only 2 in stock/
    );
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Branch confinement
 * ──────────────────────────────────────────────────────────────────────── */

describe("branch confinement", () => {
  it("keeps a branch manager inside the branch they manage", async () => {
    const ctx = contextFor("branch_manager", {
      branches: [
        makeBranch({
          _id: "branches_1",
          businessId: BUSINESS,
          name: "Main",
          managerId: CALLER,
        }),
        makeBranch({ _id: "branches_2", businessId: BUSINESS, name: "Jinja" }),
      ],
      customers: [
        makeCustomer({ _id: "customers_1", branchId: "branches_2" }),
      ],
    });

    await assert.rejects(
      () => call(customers.getById, ctx, { id: "customers_1" }),
      /branch/i
    );
  });

  it("lets a branch manager work with their own branch", async () => {
    const ctx = contextFor("branch_manager", {
      branches: [
        makeBranch({
          _id: "branches_1",
          businessId: BUSINESS,
          name: "Main",
          managerId: CALLER,
        }),
        makeBranch({ _id: "branches_2", businessId: BUSINESS, name: "Jinja" }),
      ],
      customers: [
        makeCustomer({ _id: "customers_1", branchId: "branches_1" }),
      ],
    });

    const customer = await call(customers.getById, ctx, { id: "customers_1" });
    assert.equal(customer._id, "customers_1");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Audit trail
 * ──────────────────────────────────────────────────────────────────────── */

describe("the audit trail", () => {
  it("records a customer payment", async () => {
    const ctx = contextFor("accountant", {
      customers: [makeCustomer({ _id: "customers_1" })],
      loans: [
        makeLoan({ _id: "loans_1", customerId: "customers_1", amount: 100_000, balance: 100_000 }),
      ],
    });

    await call(customers.recordPayment, ctx, {
      customerId: "customers_1",
      amount: 10_000,
      reference: "RCPT-1",
    });

    const audit = ctx.tables.auditLogs;
    assert.ok(audit.length > 0);
    assert.ok(
      audit.some((a) => String(a.action).includes("payment")),
      "the payment is on the audit log"
    );
  });

  it("records goods received", async () => {
    const ctx = contextFor("inventory_manager", {
      suppliers: [makeSupplier({ _id: "suppliers_1" })],
      stocks: [makeStock({ _id: "stocks_1", qty: 10 })],
      purchaseOrders: [makePurchaseOrder({ _id: "purchaseOrders_1", status: "ordered" })],
    });

    await call(purchasing.receiveGoods, ctx, {
      poId: "purchaseOrders_1",
      items: [
        {
          stockId: "stocks_1",
          name: "Blue Band 250g",
          quantity: 5,
          unitCost: 10_000,
          poItemIndex: 0,
        },
      ],
    });

    const audit = ctx.tables.auditLogs;
    assert.ok(
      audit.some((a) => String(a.action).includes("goods_received")),
      "the receipt is on the audit log"
    );
  });
});
