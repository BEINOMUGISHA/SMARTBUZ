import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type BusinessId,
  type BranchId,
  type WarehouseId,
  logActivity,
  requireBranchAccess,
  requirePermission,
  requireTenant,
} from "./tenancy";
import { writeAudit } from "./audit";
import { postSupplierLedger } from "./suppliers";
import { requireEntitlement } from "./entitlements";

/**
 * SMARTBUZ — purchasing.
 *
 * The whole buying cycle, in the order it actually happens:
 *
 *   1. **Purchase order** — what we intend to buy, from whom, for which
 *      branch and warehouse.
 *   2. **Goods received note** — what actually turned up. Goods can
 *      arrive in parts, so a receipt updates the ordered quantity of each
 *      line and the order stays open until every line is complete.
 *   3. **Supplier invoice** — the document the supplier sends. Recording
 *      it puts the business on the hook for the money.
 *   4. **Payment** — money to the supplier (see `convex/suppliers.ts`).
 *   5. **Purchase return** — goods sent back, taking the credit off the
 *      account.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Stock and cost
 * ────────────────────────────────────────────────────────────────────────
 *
 * Receiving goods increases stock and writes to the stock ledger, exactly
 * like every other movement, so the stock figure can always be explained.
 *
 * It also writes a row to `stockCostHistory`. The purchase price of a
 * product changes over time; the history keeps what each purchase
 * actually cost, so the margin of a past sale can be worked out from the
 * price that applied then rather than from today's.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

type PurchaseOrder = Doc<"purchaseOrders">;

/**
 * Next sequential number in a per-business series.
 *
 * The counter lives in the `counters` table, so two businesses can both
 * issue "PO-0001" without colliding, and two orders raised in the same
 * second still get different numbers.
 */
async function nextNumber(
  ctx: any,
  businessId: BusinessId,
  name: string,
  prefix: string,
  width = 4
): Promise<string> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_businessId_name", (q: any) =>
      q.eq("businessId", businessId).eq("name", name)
    )
    .first();

  let nextValue = 1;
  if (counter) {
    nextValue = counter.lastValue + 1;
    await ctx.db.patch(counter._id, { lastValue: nextValue });
  } else {
    await ctx.db.insert("counters", {
      businessId,
      name,
      lastValue: nextValue,
    });
  }

  return `${prefix}-${String(nextValue).padStart(width, "0")}`;
}

/**
 * Load a purchase order and make sure it belongs to the caller's business.
 */
async function loadPurchaseOrder(
  ctx: any,
  poId: Id<"purchaseOrders">,
  businessId: BusinessId
): Promise<PurchaseOrder> {
  const order = await ctx.db.get(poId);
  if (!order || order.businessId !== businessId) {
    throw new ConvexError(
      "Forbidden: that purchase order belongs to another business."
    );
  }
  return order;
}

/**
 * Load a supplier and make sure it belongs to the caller's business.
 */
async function loadSupplier(
  ctx: any,
  supplierId: Id<"suppliers">,
  businessId: BusinessId
): Promise<Doc<"suppliers">> {
  const supplier = await ctx.db.get(supplierId);
  if (!supplier || supplier.businessId !== businessId) {
    throw new ConvexError(
      "Forbidden: that supplier belongs to another business."
    );
  }
  return supplier;
}

/**
 * Load a stock row and make sure it belongs to the caller's business.
 */
async function loadStock(
  ctx: any,
  stockId: Id<"stocks">,
  businessId: BusinessId
): Promise<Doc<"stocks">> {
  const stock = await ctx.db.get(stockId);
  if (!stock || stock.businessId !== businessId) {
    throw new ConvexError(
      "Forbidden: that product belongs to another business."
    );
  }
  return stock;
}

/**
 * Check a branch and a warehouse belong to the caller's business.
 */
async function assertBranchAndWarehouse(
  ctx: any,
  businessId: BusinessId,
  branchId?: Id<"branches">,
  warehouseId?: Id<"warehouses">
): Promise<void> {
  if (branchId) {
    const branch = await ctx.db.get(branchId);
    if (!branch || branch.businessId !== businessId) {
      throw new ConvexError("That branch belongs to another business.");
    }
  }
  if (warehouseId) {
    const warehouse = await ctx.db.get(warehouseId);
    if (!warehouse || warehouse.businessId !== businessId) {
      throw new ConvexError("That warehouse belongs to another business.");
    }
  }
}

/**
 * A line of a purchase order.
 */
interface PurchaseLine {
  stockId?: Id<"stocks">;
  name: string;
  productCode?: string;
  quantity: number;
  unitCost: number;
  receivedQty?: number;
  returnedQty?: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Queries — purchase orders
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The purchase order book.
 *
 * The handler is exported as a plain function as well as a Convex query,
 * so the legacy `verticals.operations` wrappers can delegate to it
 * instead of keeping a second, thinner implementation.
 */
export async function listPurchaseOrdersHandler(
  ctx: any,
  args: {
    status?: string;
    supplierId?: Id<"suppliers">;
    branchId?: Id<"branches">;
    warehouseId?: Id<"warehouses">;
    searchTerm?: string;
    limit?: number;
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const orders = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    let filtered = orders;

    if (args.status) {
      filtered = filtered.filter((o: any) => o.status === args.status);
    }
    if (args.supplierId) {
      filtered = filtered.filter((o: any) => o.supplierId === args.supplierId);
    }
    if (args.branchId) {
      filtered = filtered.filter((o: any) => o.branchId === args.branchId);
    }
    if (args.warehouseId) {
      filtered = filtered.filter((o: any) => o.warehouseId === args.warehouseId);
    }
    if (args.searchTerm) {
      const search = args.searchTerm.trim().toLowerCase();
      if (search) {
        filtered = filtered.filter(
          (o: any) =>
            o.poNumber.toLowerCase().includes(search) ||
            o.supplierName.toLowerCase().includes(search) ||
            (o.notes ?? "").toLowerCase().includes(search)
        );
      }
    }

    filtered.sort((a: any, b: any) => b.date.localeCompare(a.date));

    const limit = args.limit ?? filtered.length;

    return {
      page: filtered.slice(0, limit),
      totalCount: filtered.length,
      statuses: {
        draft: filtered.filter((o: any) => o.status === "draft").length,
        ordered: filtered.filter((o: any) => o.status === "ordered").length,
        partiallyReceived: filtered.filter(
          (o: any) => o.status === "partially_received"
        ).length,
        received: filtered.filter((o: any) => o.status === "received").length,
        cancelled: filtered.filter((o: any) => o.status === "cancelled").length,
      },
    };
}

export const listPurchaseOrders = query({
  args: {
    status: v.optional(v.string()),
    supplierId: v.optional(v.id("suppliers")),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    searchTerm: v.optional(v.string()),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: listPurchaseOrdersHandler,
});

/**
 * One purchase order, with the receipts against it.
 */
export const getPurchaseOrder = query({
  args: {
    id: v.id("purchaseOrders"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const order = await loadPurchaseOrder(ctx, args.id, tenant.businessId);

    const receipts = await ctx.db
      .query("goodsReceipts")
      .withIndex("by_po", (q) => q.eq("poId", order._id))
      .collect();
    receipts.sort((a, b) => b.date.localeCompare(a.date));

    const invoices = order.supplierId
      ? await ctx.db
          .query("supplierInvoices")
          .withIndex("by_supplier", (q) => q.eq("supplierId", order.supplierId!))
          .filter((q: any) => q.eq(q.field("purchaseOrderId"), order._id))
          .collect()
      : [];

    return {
      ...order,
      goodsReceipts: receipts,
      invoices,
      outstandingAmount: order.total - (order.amountPaid ?? 0),
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations — purchase orders
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Raise a purchase order.
 *
 * The order names the branch it is for and the warehouse the goods are
 * expected to land in, so the same business can buy for several branches
 * at once and keep the stock apart.
 */
export async function createPurchaseOrderHandler(
  ctx: any,
  args: {
    supplierId?: Id<"suppliers">;
    supplierName: string;
    expectedDate?: string;
    notes?: string;
    branchId?: Id<"branches">;
    warehouseId?: Id<"warehouses">;
    items: {
      stockId?: Id<"stocks">;
      name: string;
      productCode?: string;
      quantity: number;
      unitCost: number;
    }[];
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");
    const businessId = tenant.businessId;

    if (args.items.length === 0) {
      throw new ConvexError("A purchase order needs at least one line item");
    }
    for (const item of args.items) {
      if (item.quantity <= 0) {
        throw new ConvexError("A purchase order line must ask for more than nothing.");
      }
      if (item.unitCost < 0) {
        throw new ConvexError("A unit cost cannot be negative.");
      }
    }

    await assertBranchAndWarehouse(ctx, businessId, args.branchId, args.warehouseId);

    let supplierName = args.supplierName;
    if (args.supplierId) {
      const supplier = await loadSupplier(ctx, args.supplierId, businessId);
      supplierName = supplier.name;
    }

    const total = args.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const now = new Date().toISOString();
    const poNumber = await nextNumber(ctx, businessId, "purchase_order", "PO");

    const id = await ctx.db.insert("purchaseOrders", {
      businessId,
      poNumber,
      supplierId: args.supplierId,
      supplierName,
      status: "draft",
      date: now,
      expectedDate: args.expectedDate,
      total,
      amountPaid: 0,
      branchId: args.branchId,
      warehouseId: args.warehouseId,
      notes: args.notes,
      userId: tenant.user._id,
      updatedAt: now,
      items: args.items.map((i) => ({ ...i, receivedQty: 0, returnedQty: 0 })),
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Create Purchase Order",
      `${poNumber} to ${supplierName} — ${total.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "purchasing.order.create",
      targetType: "purchase_order",
      targetId: id,
      metadata: {
        poNumber,
        supplierId: args.supplierId,
        supplierName,
        total,
        branchId: args.branchId,
        warehouseId: args.warehouseId,
        lines: args.items.length,
      },
    });

    return { id, poNumber };
}

export const createPurchaseOrder = mutation({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    supplierName: v.string(),
    expectedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    items: v.array(
      v.object({
        stockId: v.optional(v.id("stocks")),
        name: v.string(),
        productCode: v.optional(v.string()),
        quantity: v.number(),
        unitCost: v.number(),
      })
    ),
    businessId: v.optional(v.id("businesses")),
  },
  handler: createPurchaseOrderHandler,
});

/**
 * Change a purchase order's status.
 *
 * The transitions are checked, so an order cannot jump from "draft"
 * straight to "received" without the goods arriving.
 */
export async function updatePurchaseOrderStatusHandler(
  ctx: any,
  args: {
    id: Id<"purchaseOrders">;
    status: string;
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const order = await loadPurchaseOrder(ctx, args.id, tenant.businessId);
    const now = new Date().toISOString();

    const allowed: Record<string, string[]> = {
      draft: ["ordered", "cancelled"],
      ordered: ["cancelled"],
      partially_received: ["cancelled"],
      received: [],
      cancelled: [],
    };

    const from = order.status;
    const targets = allowed[from] ?? [];

    if (from === "received" && args.status !== "received") {
      throw new ConvexError(
        "This order is fully received. Use a purchase return to send goods back."
      );
    }
    if (from === "cancelled") {
      throw new ConvexError("This order has been cancelled.");
    }
    if (!targets.includes(args.status)) {
      throw new ConvexError(
        `A ${from} purchase order cannot become ${args.status}.`
      );
    }

    await ctx.db.patch(order._id, {
      status: args.status,
      updatedAt: now,
      ...(args.status === "cancelled"
        ? { cancelledAt: now, cancelledBy: tenant.user._id }
        : {}),
    });

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "purchasing.order.status",
      targetType: "purchase_order",
      targetId: order._id,
      metadata: { poNumber: order.poNumber, from, to: args.status },
    });

    return true;
}

export const updatePurchaseOrderStatus = mutation({
  args: {
    id: v.id("purchaseOrders"),
    status: v.string(),
    businessId: v.optional(v.id("businesses")),
  },
  handler: updatePurchaseOrderStatusHandler,
});

/**
 * Change the lines of a draft purchase order.
 */
export const updatePurchaseOrder = mutation({
  args: {
    id: v.id("purchaseOrders"),
    expectedDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    items: v.optional(
      v.array(
        v.object({
          stockId: v.optional(v.id("stocks")),
          name: v.string(),
          productCode: v.optional(v.string()),
          quantity: v.number(),
          unitCost: v.number(),
        })
      )
    ),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const order = await loadPurchaseOrder(ctx, args.id, tenant.businessId);

    if (order.status !== "draft") {
      throw new ConvexError(
        "Only a draft purchase order can be edited. Cancel it and raise a new one."
      );
    }

    await assertBranchAndWarehouse(
      ctx,
      tenant.businessId,
      args.branchId,
      args.warehouseId
    );

    const items = args.items;
    if (items) {
      if (items.length === 0) {
        throw new ConvexError("A purchase order needs at least one line item");
      }
      const total = items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
      await ctx.db.patch(order._id, {
        items: items.map((i) => ({ ...i, receivedQty: 0, returnedQty: 0 })),
        total,
      });
    }

    await ctx.db.patch(order._id, {
      expectedDate: args.expectedDate,
      notes: args.notes,
      branchId: args.branchId,
      warehouseId: args.warehouseId,
      updatedAt: new Date().toISOString(),
    });

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "purchasing.order.update",
      targetType: "purchase_order",
      targetId: order._id,
      metadata: { poNumber: order.poNumber },
    });

    return true;
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations — goods received
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Receive goods against a purchase order.
 *
 * Goods often arrive in parts, so a receipt says **how many** of each
 * line arrived and the order is only closed when every line is complete.
 * Over-receiving is refused: the order says how much was asked for.
 *
 * The receipt also records what the goods actually cost. That cost goes
 * into the stock ledger and into the cost history, so the price a product
 * was bought at is never lost when the price changes.
 */
export async function receiveGoodsHandler(
  ctx: any,
  args: {
    poId: Id<"purchaseOrders">;
    items: {
      stockId: Id<"stocks">;
      name: string;
      productCode?: string;
      quantity: number;
      unitCost: number;
      poItemIndex?: number;
    }[];
    branchId?: Id<"branches">;
    warehouseId?: Id<"warehouses">;
    invoiceId?: Id<"supplierInvoices">;
    notes?: string;
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");
    // Receiving goods moves stock, so it needs the inventory permission
    // as well as the purchasing one.
    await requirePermission(ctx, tenant.businessId, "inventory.adjust");

    const businessId = tenant.businessId;
    const order = await loadPurchaseOrder(ctx, args.poId, businessId);

    if (order.status === "cancelled") {
      throw new ConvexError("This purchase order has been cancelled.");
    }
    if (order.status === "received") {
      throw new ConvexError("This purchase order has already been received.");
    }
    if (args.items.length === 0) {
      throw new ConvexError("A goods receipt needs at least one line item.");
    }

    const branchId = args.branchId ?? order.branchId;
    const warehouseId = args.warehouseId ?? order.warehouseId;
    await assertBranchAndWarehouse(ctx, businessId, branchId, warehouseId);

    if (args.invoiceId) {
      const invoice = await ctx.db.get(args.invoiceId);
      if (!invoice || invoice.businessId !== businessId) {
        throw new ConvexError("That invoice belongs to another business.");
      }
    }

    const now = new Date().toISOString();
    const nowMs = Date.now();

    // Work out which purchase-order line each receipt line settles.
    const lines: PurchaseLine[] = order.items as PurchaseLine[];
    const receiptItems: {
      stockId: Id<"stocks">;
      name: string;
      productCode?: string;
      quantity: number;
      unitCost: number;
      poItemIndex?: number;
    }[] = [];

    const updatedLines = lines.map((line) => ({ ...line }));
    let total = 0;

    for (const item of args.items) {
      if (item.quantity <= 0) {
        throw new ConvexError("A received quantity must be greater than zero.");
      }

      // Find the order line: by index when given, otherwise by product.
      let lineIndex = item.poItemIndex;
      if (lineIndex === undefined) {
        lineIndex = updatedLines.findIndex(
          (l) =>
            (l.stockId && l.stockId === item.stockId) ||
            (l.productCode && l.productCode === item.productCode) ||
            l.name === item.name
        );
      }
      if (lineIndex === undefined || lineIndex < 0 || lineIndex >= updatedLines.length) {
        throw new ConvexError(
          `The product "${item.name}" is not on ${order.poNumber}.`
        );
      }

      const line = updatedLines[lineIndex];
      const alreadyReceived = line.receivedQty ?? 0;
      const ordered = line.quantity;
      const newReceived = alreadyReceived + item.quantity;

      if (newReceived > ordered) {
        throw new ConvexError(
          `Cannot receive ${item.quantity} of ${item.name} — only ${
            ordered - alreadyReceived
          } remain outstanding on ${order.poNumber}.`
        );
      }

      // The stock must belong to this business.
      const stock = await loadStock(ctx, item.stockId, businessId);

      updatedLines[lineIndex] = {
        ...line,
        receivedQty: newReceived,
      };

      receiptItems.push({
        stockId: item.stockId,
        name: item.name,
        productCode: item.productCode ?? stock.productCode,
        quantity: item.quantity,
        unitCost: item.unitCost,
        poItemIndex: lineIndex,
      });

      total += item.quantity * item.unitCost;

      // ── Stock ──────────────────────────────────────────────────────
      await ctx.db.patch(stock._id, {
        qty: stock.qty + item.quantity,
        // The product's current cost becomes the cost of this purchase.
        // The previous costs are kept in the cost history.
        purchasePrice: item.unitCost,
        warehouseId: warehouseId ?? stock.warehouseId,
        branchId: branchId ?? stock.branchId,
        supplier: order.supplierName,
      });

      await ctx.db.insert("stockLedger", {
        businessId,
        stockId: item.stockId,
        shopId: undefined,
        deltaQty: item.quantity,
        eventType: "RESTOCK",
        referenceId: order.poNumber,
        userId: tenant.user._id,
        timestamp: now,
        notes: `Goods received against ${order.poNumber}`,
      });

      await ctx.db.insert("stockEntries", {
        businessId,
        stockId: item.stockId,
        quantity: item.quantity,
        userId: tenant.user._id,
        date: now,
        price: stock.price,
        purchasePrice: item.unitCost,
        pv: stock.pv,
        bv: stock.bv,
        halfPrice: stock.halfPrice ?? false,
        type: "restock",
        supplier: order.supplierName,
      });

      // ── Cost history ───────────────────────────────────────────────
      // What this product cost, and when. Preserved whatever happens to
      // the price afterwards.
      await ctx.db.insert("stockCostHistory", {
        businessId,
        stockId: item.stockId,
        productCode: stock.productCode,
        name: item.name,
        unitCost: item.unitCost,
        quantity: item.quantity,
        totalCost: item.unitCost * item.quantity,
        supplierId: order.supplierId,
        supplierName: order.supplierName,
        purchaseOrderId: order._id,
        branchId,
        warehouseId,
        date: now,
        recordedBy: tenant.user._id,
      });
    }

    // The receipt itself.
    const receiptNumber = await nextNumber(ctx, businessId, "goods_receipt", "GRN");
    const receiptId = await ctx.db.insert("goodsReceipts", {
      businessId,
      poId: order._id,
      receiptNumber,
      supplierId: order.supplierId,
      supplierName: order.supplierName,
      date: now,
      total,
      branchId,
      warehouseId,
      invoiceId: args.invoiceId,
      userId: tenant.user._id,
      notes: args.notes,
      items: receiptItems,
    });

    // The order closes only when every line is complete.
    const fullyReceived = updatedLines.every(
      (line) => (line.receivedQty ?? 0) >= line.quantity
    );
    const anyReceived = updatedLines.some((line) => (line.receivedQty ?? 0) > 0);

    await ctx.db.patch(order._id, {
      items: updatedLines,
      status: fullyReceived ? "received" : anyReceived ? "partially_received" : order.status,
      receivedDate: fullyReceived ? now : order.receivedDate,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Goods Received",
      `${receiptNumber} against ${order.poNumber} — ${total.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "purchasing.goods_received",
      targetType: "goods_receipt",
      targetId: receiptId,
      metadata: {
        poNumber: order.poNumber,
        receiptNumber,
        supplierId: order.supplierId,
        total,
        branchId,
        warehouseId,
        fullyReceived,
        items: receiptItems.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          unitCost: i.unitCost,
        })),
      },
    });

    return {
      receiptNumber,
      receiptId,
      total,
      fullyReceived,
      status: fullyReceived ? "received" : "partially_received",
    };
}

export const receiveGoods = mutation({
  args: {
    poId: v.id("purchaseOrders"),
    items: v.array(
      v.object({
        stockId: v.id("stocks"),
        name: v.string(),
        productCode: v.optional(v.string()),
        quantity: v.number(),
        unitCost: v.number(),
        /** Which line of the purchase order this settles. */
        poItemIndex: v.optional(v.number()),
      })
    ),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    invoiceId: v.optional(v.id("supplierInvoices")),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: receiveGoodsHandler,
});

export async function listGoodsReceiptsHandler(
  ctx: any,
  args: {
    poId?: Id<"purchaseOrders">;
    supplierId?: Id<"suppliers">;
    branchId?: Id<"branches">;
    limit?: number;
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const receipts = await ctx.db
      .query("goodsReceipts")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    let filtered = receipts;
    if (args.poId) filtered = filtered.filter((r: any) => r.poId === args.poId);
    if (args.supplierId) {
      filtered = filtered.filter((r: any) => r.supplierId === args.supplierId);
    }
    if (args.branchId) {
      filtered = filtered.filter((r: any) => r.branchId === args.branchId);
    }

    filtered.sort((a: any, b: any) => b.date.localeCompare(a.date));

    const limit = args.limit ?? filtered.length;

    return { page: filtered.slice(0, limit), totalCount: filtered.length };
}

export const listGoodsReceipts = query({
  args: {
    poId: v.optional(v.id("purchaseOrders")),
    supplierId: v.optional(v.id("suppliers")),
    branchId: v.optional(v.id("branches")),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: listGoodsReceiptsHandler,
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations — supplier invoices
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Record a supplier invoice.
 *
 * Recording the invoice puts the business on the hook for the money, so
 * it is written to the supplier ledger in the same transaction.
 *
 * The same invoice number from the same supplier is refused: it is the
 * same document, and recording it twice would double what the business
 * owes.
 */
export const recordInvoice = mutation({
  args: {
    supplierId: v.id("suppliers"),
    invoiceNumber: v.string(),
    date: v.optional(v.string()),
    dueDate: v.optional(v.string()),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    items: v.array(
      v.object({
        stockId: v.optional(v.id("stocks")),
        name: v.string(),
        productCode: v.optional(v.string()),
        quantity: v.number(),
        unitCost: v.number(),
      })
    ),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const businessId = tenant.businessId;
    const supplier = await loadSupplier(ctx, args.supplierId, businessId);

    const invoiceNumber = args.invoiceNumber.trim();
    if (!invoiceNumber) {
      throw new ConvexError("An invoice needs a number.");
    }
    if (args.items.length === 0) {
      throw new ConvexError("An invoice needs at least one line item.");
    }

    await assertBranchAndWarehouse(ctx, businessId, args.branchId, args.warehouseId);

    // Duplicate-invoice guard: the same document must not be recorded twice.
    const existing = await ctx.db
      .query("supplierInvoices")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .collect();
    const duplicate = existing.find(
      (i) => i.invoiceNumber.toLowerCase() === invoiceNumber.toLowerCase()
    );
    if (duplicate) {
      throw new ConvexError(
        `Invoice ${invoiceNumber} from ${supplier.name} has already been recorded.`
      );
    }

    const total = args.items.reduce((s, i) => s + i.quantity * i.unitCost, 0);
    const now = new Date().toISOString();
    const date = args.date ?? now;

    // When the supplier has payment terms, the invoice falls due that many
    // days after its date.
    let dueDate = args.dueDate;
    if (!dueDate && supplier.paymentTermsDays) {
      const due = new Date(date);
      due.setDate(due.getDate() + supplier.paymentTermsDays);
      dueDate = due.toISOString();
    }

    const invoiceId = await ctx.db.insert("supplierInvoices", {
      businessId,
      invoiceNumber,
      supplierId: supplier._id,
      supplierName: supplier.name,
      date,
      dueDate,
      total,
      amountPaid: 0,
      status: "open",
      purchaseOrderId: args.purchaseOrderId,
      branchId: args.branchId,
      warehouseId: args.warehouseId,
      items: args.items.map((i) => ({ ...i, returnedQty: 0 })),
      notes: args.notes,
      createdBy: tenant.user._id,
      createdAt: now,
      updatedAt: now,
    });

    // The ledger: the business now owes this much more.
    await postSupplierLedger(ctx, {
      businessId,
      supplierId: supplier._id,
      type: "invoice",
      amount: total,
      invoiceId,
      purchaseOrderId: args.purchaseOrderId,
      branchId: args.branchId,
      warehouseId: args.warehouseId,
      reference: invoiceNumber,
      date,
      userId: tenant.user._id,
      notes: args.notes,
    });

    // Link the invoice to the order it settles.
    if (args.purchaseOrderId) {
      const order = await loadPurchaseOrder(ctx, args.purchaseOrderId, businessId);
      const orderInvoiceIds = order.invoiceId ? [order.invoiceId] : [];
      await ctx.db.patch(order._id, {
        invoiceId: invoiceId,
        updatedAt: now,
      });
      void orderInvoiceIds;
    }

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Supplier Invoice",
      `Invoice ${invoiceNumber} from ${supplier.name} — ${total.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "purchasing.invoice.record",
      targetType: "supplier_invoice",
      targetId: invoiceId,
      metadata: {
        invoiceNumber,
        supplierId: supplier._id,
        supplierName: supplier.name,
        total,
        dueDate,
      },
    });

    return { invoiceId, invoiceNumber, total };
  },
});

export const listInvoices = query({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    status: v.optional(v.string()),
    searchTerm: v.optional(v.string()),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const invoices = await ctx.db
      .query("supplierInvoices")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    let filtered = invoices;
    if (args.supplierId) {
      filtered = filtered.filter((i) => i.supplierId === args.supplierId);
    }
    if (args.status) {
      filtered = filtered.filter((i) => i.status === args.status);
    }
    if (args.searchTerm) {
      const search = args.searchTerm.trim().toLowerCase();
      if (search) {
        filtered = filtered.filter(
          (i) =>
            i.invoiceNumber.toLowerCase().includes(search) ||
            i.supplierName.toLowerCase().includes(search)
        );
      }
    }

    filtered.sort((a, b) => b.date.localeCompare(a.date));

    const limit = args.limit ?? filtered.length;
    const page = filtered.slice(0, limit);

    return {
      page,
      totalCount: filtered.length,
      totalOutstanding: filtered
        .filter((i) => i.status === "open" || i.status === "partial")
        .reduce((sum, i) => sum + (i.total - i.amountPaid), 0),
    };
  },
});

export const getInvoice = query({
  args: {
    id: v.id("supplierInvoices"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const invoice = await ctx.db.get(args.id);
    if (!invoice || invoice.businessId !== tenant.businessId) {
      throw new ConvexError(
        "Forbidden: that invoice belongs to another business."
      );
    }

    const payments = await ctx.db
      .query("purchasePayments")
      .withIndex("by_invoice", (q) => q.eq("invoiceId", invoice._id))
      .collect();

    return {
      ...invoice,
      outstanding: invoice.total - invoice.amountPaid,
      payments,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations — purchase returns
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Return goods to a supplier.
 *
 * The stock goes back out, the supplier's account is credited, and the
 * order and invoice lines record how much has been returned so the same
 * goods cannot be returned twice.
 */
export const createPurchaseReturn = mutation({
  args: {
    supplierId: v.id("suppliers"),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    invoiceId: v.optional(v.id("supplierInvoices")),
    goodsReceiptId: v.optional(v.id("goodsReceipts")),
    items: v.array(
      v.object({
        stockId: v.id("stocks"),
        name: v.string(),
        productCode: v.optional(v.string()),
        quantity: v.number(),
        unitCost: v.number(),
      })
    ),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.return");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");
    await requirePermission(ctx, tenant.businessId, "inventory.adjust");

    const businessId = tenant.businessId;
    const supplier = await loadSupplier(ctx, args.supplierId, businessId);

    if (args.items.length === 0) {
      throw new ConvexError("A purchase return needs at least one line item.");
    }

    const now = new Date().toISOString();
    const order = args.purchaseOrderId
      ? await loadPurchaseOrder(ctx, args.purchaseOrderId, businessId)
      : null;

    let invoice: Doc<"supplierInvoices"> | null = null;
    if (args.invoiceId) {
      invoice = await ctx.db.get(args.invoiceId);
      if (!invoice || invoice.businessId !== businessId) {
        throw new ConvexError("That invoice belongs to another business.");
      }
      if (invoice.supplierId !== supplier._id) {
        throw new ConvexError("That invoice belongs to another supplier.");
      }
    }

    let total = 0;
    const returnItems: {
      stockId: Id<"stocks">;
      name: string;
      productCode?: string;
      quantity: number;
      unitCost: number;
    }[] = [];

    for (const item of args.items) {
      if (item.quantity <= 0) {
        throw new ConvexError("A return quantity must be greater than zero.");
      }

      const stock = await loadStock(ctx, item.stockId, businessId);

      if (stock.qty < item.quantity) {
        throw new ConvexError(
          `Cannot return ${item.quantity} of ${item.name} — only ${stock.qty} in stock.`
        );
      }

      // The order line must have been received first.
      if (order) {
        const lines = order.items as PurchaseLine[];
        const line = lines.find(
          (l) =>
            (l.stockId && l.stockId === item.stockId) ||
            l.name === item.name
        );
        if (!line) {
          throw new ConvexError(
            `The product "${item.name}" is not on ${order.poNumber}.`
          );
        }
        const received = line.receivedQty ?? 0;
        const alreadyReturned = line.returnedQty ?? 0;
        if (alreadyReturned + item.quantity > received) {
          throw new ConvexError(
            `Cannot return ${item.quantity} of ${item.name} — only ${
              received - alreadyReturned
            } of the ${received} received are still returnable.`
          );
        }
      }

      await ctx.db.patch(stock._id, { qty: stock.qty - item.quantity });

      await ctx.db.insert("stockLedger", {
        businessId,
        stockId: item.stockId,
        shopId: undefined,
        deltaQty: -item.quantity,
        eventType: "PURCHASE_RETURN",
        referenceId: supplier.name,
        userId: tenant.user._id,
        timestamp: now,
        notes: `Goods returned to ${supplier.name}`,
      });

      returnItems.push({
        stockId: item.stockId,
        name: item.name,
        productCode: item.productCode ?? stock.productCode,
        quantity: item.quantity,
        unitCost: item.unitCost,
      });

      total += item.quantity * item.unitCost;
    }

    const returnNumber = await nextNumber(ctx, businessId, "purchase_return", "PR");

    const returnId = await ctx.db.insert("purchaseReturns", {
      businessId,
      returnNumber,
      supplierId: supplier._id,
      supplierName: supplier.name,
      purchaseOrderId: args.purchaseOrderId,
      invoiceId: args.invoiceId,
      goodsReceiptId: args.goodsReceiptId,
      date: now,
      total,
      status: "completed",
      branchId: order?.branchId,
      warehouseId: order?.warehouseId,
      items: returnItems,
      notes: args.notes,
      userId: tenant.user._id,
      createdAt: now,
    });

    // The ledger: the business owes the supplier less.
    await postSupplierLedger(ctx, {
      businessId,
      supplierId: supplier._id,
      type: "return",
      amount: -total,
      invoiceId: args.invoiceId,
      purchaseOrderId: args.purchaseOrderId,
      purchaseReturnId: returnId,
      branchId: order?.branchId,
      warehouseId: order?.warehouseId,
      reference: returnNumber,
      date: now,
      userId: tenant.user._id,
      notes: args.notes,
    });

    // Record the return against the order and the invoice.
    if (order) {
      const lines = order.items as PurchaseLine[];
      const updated = lines.map((line) => {
        const returned = returnItems
          .filter(
            (r) =>
              (line.stockId && r.stockId === line.stockId) || r.name === line.name
          )
          .reduce((sum, r) => sum + r.quantity, 0);
        if (returned === 0) return line;
        return { ...line, returnedQty: (line.returnedQty ?? 0) + returned };
      });
      await ctx.db.patch(order._id, { items: updated, updatedAt: now });
    }

    if (invoice) {
      const lines = invoice.items;
      const updated = lines.map((line) => {
        const returned = returnItems
          .filter(
            (r) =>
              (line.stockId && r.stockId === line.stockId) || r.name === line.name
          )
          .reduce((sum, r) => sum + r.quantity, 0);
        if (returned === 0) return line;
        return { ...line, returnedQty: (line.returnedQty ?? 0) + returned };
      });
      await ctx.db.patch(invoice._id, { items: updated, updatedAt: now });
    }

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Purchase Return",
      `${returnNumber} to ${supplier.name} — ${total.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "purchasing.return.create",
      targetType: "purchase_return",
      targetId: returnId,
      metadata: {
        returnNumber,
        supplierId: supplier._id,
        supplierName: supplier.name,
        total,
        purchaseOrderId: args.purchaseOrderId,
        invoiceId: args.invoiceId,
      },
    });

    return { returnId, returnNumber, total };
  },
});

export const listPurchaseReturns = query({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const returns = await ctx.db
      .query("purchaseReturns")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    let filtered = returns;
    if (args.supplierId) {
      filtered = filtered.filter((r) => r.supplierId === args.supplierId);
    }

    filtered.sort((a, b) => b.date.localeCompare(a.date));

    const limit = args.limit ?? filtered.length;

    return { page: filtered.slice(0, limit), totalCount: filtered.length };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Cost history
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * What a product has cost, and when.
 *
 * The purchase price changes; this is what it was. A margin calculated
 * for a sale in the past must use the cost that applied then.
 */
export const getCostHistory = query({
  args: {
    stockId: v.optional(v.id("stocks")),
    supplierId: v.optional(v.id("suppliers")),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const rows = await ctx.db
      .query("stockCostHistory")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    let filtered = rows;
    if (args.stockId) filtered = filtered.filter((r) => r.stockId === args.stockId);
    if (args.supplierId) {
      filtered = filtered.filter((r) => r.supplierId === args.supplierId);
    }

    filtered.sort((a, b) => b.date.localeCompare(a.date));

    const limit = args.limit ?? 100;

    // The average cost paid for a product, and its movement over time.
    const byStock = new Map<string, number[]>();
    for (const row of filtered) {
      const key = row.stockId as string;
      const list = byStock.get(key) ?? [];
      list.push(row.unitCost);
      byStock.set(key, list);
    }

    return {
      page: filtered.slice(0, limit),
      totalCount: filtered.length,
      averageCostByStock: Object.fromEntries(
        [...byStock.entries()].map(([key, costs]) => [
          key,
          costs.reduce((sum, c) => sum + c, 0) / costs.length,
        ])
      ),
    };
  },
});
