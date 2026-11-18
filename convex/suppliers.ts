import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  type BusinessId,
  type BranchId,
  allowedBranchIds,
  logActivity,
  requireBranchAccess,
  requirePermission,
  requireTenant,
} from "./tenancy";
import { writeAudit } from "./audit";
import { requireEntitlement } from "./entitlements";

/**
 * SMARTBUZ — suppliers: the book, the ledger and the statements.
 *
 * A supplier is the other side of the purchasing ledger. Where a customer
 * account records what a customer owes *us*, a supplier account records
 * what *we* owe the supplier.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The supplier ledger
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every movement on a supplier account is one row in `supplierLedger`, in
 * order, with the running balance after it. The balance is **derived**
 * from those rows rather than kept as a separate number, so the statement,
 * the supplier record and the invoice can never tell three different
 * stories.
 *
 * `amount` is signed from the business's point of view:
 *
 *   + amount   the business owes the supplier more (an invoice)
 *   − amount   the business owes the supplier less (a payment or a return)
 *
 * `suppliers.balance` is a cached copy of that sum, written on the same
 * transaction as the ledger entry. It is a convenience for sorting and
 * for the list view; the ledger is the truth.
 */

type Supplier = Doc<"suppliers">;

/* ────────────────────────────────────────────────────────────────────────
 * The ledger
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Post a movement to a supplier account and refresh the cached balance.
 *
 * Every supplier money movement goes through here, so the ledger stays
 * complete and the balance stays correct.
 */
export async function postSupplierLedger(
  ctx: any,
  entry: {
    businessId: BusinessId;
    supplierId: Id<"suppliers">;
    type: "invoice" | "payment" | "return" | "adjustment" | "credit";
    /** Signed: positive increases what the business owes. */
    amount: number;
    invoiceId?: Id<"supplierInvoices">;
    purchaseOrderId?: Id<"purchaseOrders">;
    paymentId?: Id<"purchasePayments">;
    purchaseReturnId?: Id<"purchaseReturns">;
    branchId?: Id<"branches">;
    warehouseId?: Id<"warehouses">;
    reference?: string;
    date: string;
    userId?: Id<"users">;
    notes?: string;
  }
): Promise<{ ledgerId: Id<"supplierLedger">; balanceAfter: number }> {
  const supplier = await ctx.db.get(entry.supplierId);
  if (!supplier || supplier.businessId !== entry.businessId) {
    throw new ConvexError("Forbidden: that supplier belongs to another business.");
  }

  const balanceAfter = (supplier.balance ?? 0) + entry.amount;

  const ledgerId = await ctx.db.insert("supplierLedger", {
    businessId: entry.businessId,
    supplierId: entry.supplierId,
    type: entry.type,
    amount: entry.amount,
    balanceAfter,
    invoiceId: entry.invoiceId,
    purchaseOrderId: entry.purchaseOrderId,
    paymentId: entry.paymentId,
    purchaseReturnId: entry.purchaseReturnId,
    branchId: entry.branchId,
    warehouseId: entry.warehouseId,
    reference: entry.reference,
    date: entry.date,
    userId: entry.userId,
    notes: entry.notes,
  });

  await ctx.db.patch(entry.supplierId, {
    balance: balanceAfter,
    updatedAt: new Date().toISOString(),
  });

  return { ledgerId, balanceAfter };
}

/**
 * The ledger of one supplier, oldest first.
 */
async function supplierLedgerRows(
  ctx: any,
  supplierId: Id<"suppliers">
): Promise<Doc<"supplierLedger">[]> {
  const rows = await ctx.db
    .query("supplierLedger")
    .withIndex("by_supplier", (q: any) => q.eq("supplierId", supplierId))
    .collect();
  return rows.sort((a: any, b: any) => a.date.localeCompare(b.date));
}

/* ────────────────────────────────────────────────────────────────────────
 * Queries
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Load a supplier and make sure it belongs to the caller's business.
 */
async function loadSupplier(
  ctx: any,
  supplierId: Id<"suppliers">,
  businessId: BusinessId
): Promise<Supplier> {
  const supplier = await ctx.db.get(supplierId);
  if (!supplier || supplier.businessId !== businessId) {
    throw new ConvexError(
      "Forbidden: that supplier belongs to another business."
    );
  }
  return supplier;
}

/**
 * The supplier book.
 */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    includeInactive: v.optional(v.boolean()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "suppliers.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const filtered = applySupplierFilters(
      suppliers,
      args.searchTerm,
      args.branchId,
      args.includeInactive
    );

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    const cursor = Number(args.paginationOpts.cursor) || 0;
    const start = cursor * args.paginationOpts.numItems;
    const page = filtered.slice(start, start + args.paginationOpts.numItems);

    return {
      page,
      isDone: start + args.paginationOpts.numItems >= filtered.length,
      continueCursor: String(cursor + 1),
      totalCount: filtered.length,
    };
  },
});

/**
 * Every supplier, for the pickers.
 *
 * The handler is exported as a plain function as well as a Convex query,
 * so the legacy `verticals.operations` wrapper can delegate to it.
 */
export async function listSuppliersHandler(
  ctx: any,
  args: {
    searchTerm?: string;
    branchId?: Id<"branches">;
    includeInactive?: boolean;
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "suppliers.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const filtered = applySupplierFilters(
      suppliers,
      args.searchTerm,
      args.branchId,
      args.includeInactive
    );

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
}

export const listAll = query({
  args: {
    searchTerm: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    includeInactive: v.optional(v.boolean()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: listSuppliersHandler,
});

/**
 * Apply the search and branch filters to a set of suppliers.
 */
function applySupplierFilters(
  suppliers: Supplier[],
  searchTerm?: string,
  branchId?: Id<"branches">,
  includeInactive?: boolean
): Supplier[] {
  let results = suppliers;

  if (!includeInactive) {
    results = results.filter((s) => s.isActive !== false);
  }

  if (branchId) {
    results = results.filter((s) => s.branchId === branchId);
  }

  if (searchTerm) {
    const search = searchTerm.trim().toLowerCase();
    if (search) {
      results = results.filter(
        (s) =>
          s.name.toLowerCase().includes(search) ||
          (s.contact ?? "").toLowerCase().includes(search) ||
          (s.phone ?? "").toLowerCase().includes(search) ||
          (s.email ?? "").toLowerCase().includes(search) ||
          (s.taxNumber ?? "").toLowerCase().includes(search) ||
          (s.notes ?? "").toLowerCase().includes(search)
      );
    }
  }

  return results;
}

/**
 * One supplier, with their account summary.
 */
export const getById = query({
  args: {
    id: v.id("suppliers"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "suppliers.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const supplier = await loadSupplier(ctx, args.id, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, supplier.branchId);

    const rows = await supplierLedgerRows(ctx, supplier._id);
    const invoices = await ctx.db
      .query("supplierInvoices")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .collect();
    const payments = await ctx.db
      .query("purchasePayments")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .collect();

    return {
      ...supplier,
      balance: supplier.balance ?? 0,
      invoiceCount: invoices.length,
      openInvoiceTotal: invoices
        .filter((i) => i.status === "open" || i.status === "partial")
        .reduce((sum, i) => sum + (i.total - i.amountPaid), 0),
      paymentCount: payments.length,
      totalPaid: payments.reduce((sum, p) => sum + p.amount, 0),
      lastMovementAt: rows.length > 0 ? rows[rows.length - 1].date : undefined,
    };
  },
});

/**
 * What the business has bought from a supplier.
 */
export const getPurchaseHistory = query({
  args: {
    supplierId: v.id("suppliers"),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const supplier = await loadSupplier(ctx, args.supplierId, tenant.businessId);

    const purchaseOrders = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .collect();
    const receipts = await ctx.db
      .query("goodsReceipts")
      .withIndex("by_po", (q) => q.eq("poId", undefined))
      .filter((q: any) => q.eq(q.field("supplierId"), supplier._id))
      .collect();
    const invoices = await ctx.db
      .query("supplierInvoices")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .collect();

    purchaseOrders.sort((a, b) => b.date.localeCompare(a.date));
    invoices.sort((a, b) => b.date.localeCompare(a.date));
    receipts.sort((a, b) => b.date.localeCompare(a.date));

    const limit = args.limit ?? 50;

    return {
      supplier,
      purchaseOrders: purchaseOrders.slice(0, limit),
      goodsReceipts: receipts.slice(0, limit),
      invoices: invoices.slice(0, limit),
      totals: {
        ordered: purchaseOrders.reduce((sum, p) => sum + p.total, 0),
        invoiced: invoices.reduce((sum, i) => sum + i.total, 0),
        received: receipts.reduce((sum, r) => sum + r.total, 0),
      },
    };
  },
});

/**
 * The supplier's statement.
 *
 * Every movement on the account in date order, with the running balance
 * after each line.
 */
export const getStatement = query({
  args: {
    supplierId: v.id("suppliers"),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "suppliers.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const supplier = await loadSupplier(ctx, args.supplierId, tenant.businessId);

    const rows = await supplierLedgerRows(ctx, supplier._id);
    const filtered = rows.filter((row) => {
      if (args.from && row.date < args.from) return false;
      if (args.to && row.date > args.to) return false;
      return true;
    });

    const invoices = await ctx.db
      .query("supplierInvoices")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .collect();
    const invoiceMap = new Map(invoices.map((i) => [i._id as string, i]));

    const lines = filtered.map((row) => {
      const invoice = row.invoiceId ? invoiceMap.get(row.invoiceId as string) : null;
      return {
        ...row,
        description: describeMovement(row, invoice?.invoiceNumber),
      };
    });

    const totalCharged = rows
      .filter((r) => r.amount > 0)
      .reduce((sum, r) => sum + r.amount, 0);
    const totalPaid = rows
      .filter((r) => r.amount < 0)
      .reduce((sum, r) => sum + Math.abs(r.amount), 0);

    return {
      supplier,
      lines,
      openingBalance: lines.length > 0 ? lines[0].balanceAfter - lines[0].amount : 0,
      closingBalance: supplier.balance ?? 0,
      totalCharged,
      totalPaid,
    };
  },
});

/**
 * A human description of a ledger movement.
 */
function describeMovement(
  row: Doc<"supplierLedger">,
  invoiceNumber?: string
): string {
  switch (row.type) {
    case "invoice":
      return `Invoice ${invoiceNumber ?? row.reference ?? ""}`.trim();
    case "payment":
      return `Payment${row.reference ? ` (ref ${row.reference})` : ""}`;
    case "return":
      return `Purchase return${row.reference ? ` (${row.reference})` : ""}`;
    case "credit":
      return `Credit${row.reference ? ` (${row.reference})` : ""}`;
    case "adjustment":
      return row.notes || "Adjustment";
    default:
      return row.notes || row.type;
  }
}

/**
 * The payments the business has made to its suppliers.
 */
export const listPayments = query({
  args: {
    supplierId: v.optional(v.id("suppliers")),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const payments = await ctx.db
      .query("purchasePayments")
      .withIndex("by_businessId", (q: any) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    let filtered = payments;
    if (args.supplierId) {
      filtered = filtered.filter((p) => p.supplierId === args.supplierId);
    }
    if (args.from) filtered = filtered.filter((p) => p.date >= args.from!);
    if (args.to) filtered = filtered.filter((p) => p.date <= args.to!);

    filtered.sort((a: any, b: any) => b.date.localeCompare(a.date));

    const limit = args.limit ?? filtered.length;

    return {
      page: filtered.slice(0, limit),
      totalCount: filtered.length,
      totalPaid: filtered.reduce((sum: number, p: any) => sum + p.amount, 0),
    };
  },
});

/**
 * The suppliers the business owes the most.
 */
export const getOutstandingBalances = query({
  args: {
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.view");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const suppliers = await ctx.db
      .query("suppliers")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const owing = suppliers
      .map((s) => ({ supplier: s, balance: s.balance ?? 0 }))
      .filter((entry) => entry.balance > 0)
      .sort((a, b) => b.balance - a.balance);

    const limit = args.limit ?? 20;
    return owing.slice(0, limit);
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Register a supplier, or update one.
 *
 * The same mutation does both, so there is only one way a supplier record
 * is written and only one place to audit it.
 */
export async function upsertSupplierHandler(
  ctx: any,
  args: {
    id?: Id<"suppliers">;
    name: string;
    contact?: string;
    phone?: string;
    email?: string;
    address?: string;
    paymentTerms?: string;
    paymentTermsDays?: number;
    taxNumber?: string;
    branchId?: Id<"branches">;
    currency?: string;
    isActive?: boolean;
    notes?: string;
    businessId?: BusinessId;
  }
) {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "suppliers.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const { id, businessId, ...payload } = args;

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
    }

    const now = new Date().toISOString();

    if (id) {
      const supplier = await loadSupplier(ctx, id, tenant.businessId);
      await requireBranchAccess(ctx, tenant.membership, supplier.branchId);

      await ctx.db.patch(id, {
        ...payload,
        businessId: tenant.businessId,
        updatedAt: now,
      });

      await logActivity(
        ctx,
        tenant.businessId,
        tenant.user._id,
        "Update Supplier",
        `Updated supplier ${args.name}`
      );

      await writeAudit(ctx, {
        businessId: tenant.businessId,
        actorUserId: tenant.user._id,
        actorRole: tenant.membership.role,
        action: "suppliers.update",
        targetType: "supplier",
        targetId: id,
        metadata: { name: args.name },
      });

      return id;
    }

    const supplierId = await ctx.db.insert("suppliers", {
      ...payload,
      businessId: tenant.businessId,
      balance: 0,
      isActive: args.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Create Supplier",
      `Added supplier ${args.name}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "suppliers.create",
      targetType: "supplier",
      targetId: supplierId,
      metadata: {
        name: args.name,
        contact: args.contact,
        phone: args.phone,
        branchId: args.branchId,
      },
    });

    return supplierId;
}

export const upsert = mutation({
  args: {
    id: v.optional(v.id("suppliers")),
    name: v.string(),
    contact: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    paymentTerms: v.optional(v.string()),
    paymentTermsDays: v.optional(v.number()),
    taxNumber: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    currency: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: upsertSupplierHandler,
});

/**
 * Retire a supplier.
 *
 * A supplier with trading history is deactivated rather than deleted —
 * their invoices, receipts and payments still have to point at something.
 */
export const remove = mutation({
  args: {
    id: v.id("suppliers"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "suppliers.manage");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    const supplier = await loadSupplier(ctx, args.id, tenant.businessId);

    const invoices = await ctx.db
      .query("supplierInvoices")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .first();
    const purchaseOrders = await ctx.db
      .query("purchaseOrders")
      .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
      .first();

    const hasHistory = invoices !== null || purchaseOrders !== null;

    if (hasHistory) {
      await ctx.db.patch(supplier._id, {
        isActive: false,
        updatedAt: new Date().toISOString(),
      });

      await writeAudit(ctx, {
        businessId: tenant.businessId,
        actorUserId: tenant.user._id,
        actorRole: tenant.membership.role,
        action: "suppliers.deactivate",
        targetType: "supplier",
        targetId: supplier._id,
        metadata: { name: supplier.name, reason: "has_history" },
      });

      return { deleted: false, deactivated: true };
    }

    await ctx.db.delete(supplier._id);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Delete Supplier",
      `Deleted supplier ${supplier.name}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "suppliers.delete",
      targetType: "supplier",
      targetId: supplier._id,
      metadata: { name: supplier.name },
    });

    return { deleted: true, deactivated: false };
  },
});

/**
 * Pay a supplier.
 *
 * The payment is applied to the supplier's open invoices, oldest first,
 * and written to the supplier ledger.
 *
 * A payment carries a **reference** — the bank or receipt number. Two
 * payments with the same reference for the same supplier are the same
 * payment, and the second is refused. That is what stops a double
 * submission from paying an invoice twice.
 */
export const paySupplier = mutation({
  args: {
    supplierId: v.id("suppliers"),
    amount: v.number(),
    date: v.optional(v.string()),
    method: v.optional(v.string()),
    reference: v.optional(v.string()),
    invoiceId: v.optional(v.id("supplierInvoices")),
    purchaseOrderId: v.optional(v.id("purchaseOrders")),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.pay");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    if (args.amount <= 0) {
      throw new ConvexError("A payment must be greater than zero.");
    }

    const supplier = await loadSupplier(ctx, args.supplierId, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, supplier.branchId);

    const reference = args.reference?.trim() || undefined;

    // Duplicate-payment guard.
    if (reference) {
      const existing = await ctx.db
        .query("purchasePayments")
        .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
        .collect();
      const duplicate = existing.find((p) => p.reference === reference);
      if (duplicate) {
        throw new ConvexError(
          `A payment with reference "${reference}" has already been recorded for ${supplier.name}.`
        );
      }
    }

    const date = args.date ?? new Date().toISOString();
    const now = new Date().toISOString();

    // Which invoice is being settled. When none is named, the oldest open
    // invoice is settled — the same rule a bookkeeper would use.
    let invoice: Doc<"supplierInvoices"> | null = null;
    if (args.invoiceId) {
      invoice = await ctx.db.get(args.invoiceId);
      if (!invoice || invoice.businessId !== tenant.businessId) {
        throw new ConvexError("That invoice belongs to another business.");
      }
      if (invoice.supplierId !== supplier._id) {
        throw new ConvexError("That invoice belongs to another supplier.");
      }
      if (invoice.status === "cancelled") {
        throw new ConvexError("That invoice has been cancelled.");
      }
    } else {
      const open = await ctx.db
        .query("supplierInvoices")
        .withIndex("by_supplier", (q) => q.eq("supplierId", supplier._id))
        .collect();
      open.sort((a, b) => a.date.localeCompare(b.date));
      invoice =
        open.find((i) => i.status === "open" || i.status === "partial") ?? null;
    }

    if (invoice) {
      const outstanding = invoice.total - invoice.amountPaid;
      if (args.amount > outstanding) {
        throw new ConvexError(
          `Payment of ${args.amount.toLocaleString()} exceeds the ${outstanding.toLocaleString()} still owed on invoice ${invoice.invoiceNumber}.`
        );
      }
    }

    const paymentId = await ctx.db.insert("purchasePayments", {
      businessId: tenant.businessId,
      supplierId: supplier._id,
      supplierName: supplier.name,
      amount: args.amount,
      date,
      method: args.method,
      reference,
      invoiceId: invoice?._id,
      purchaseOrderId: args.purchaseOrderId,
      branchId: supplier.branchId,
      userId: tenant.user._id,
      notes: args.notes,
      createdAt: now,
    });

    // The ledger: a payment reduces what the business owes.
    const { balanceAfter } = await postSupplierLedger(ctx, {
      businessId: tenant.businessId,
      supplierId: supplier._id,
      type: "payment",
      amount: -args.amount,
      invoiceId: invoice?._id,
      purchaseOrderId: args.purchaseOrderId,
      paymentId,
      branchId: supplier.branchId,
      reference: reference ?? `PAY-${paymentId}`,
      date,
      userId: tenant.user._id,
      notes: args.notes,
    });

    // Settle the invoice.
    if (invoice) {
      const amountPaid = invoice.amountPaid + args.amount;
      const status =
        amountPaid >= invoice.total ? "paid" : "partial";
      await ctx.db.patch(invoice._id, {
        amountPaid,
        status,
        updatedAt: now,
      });
    }

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Supplier Payment",
      `Paid ${args.amount.toLocaleString()} to ${supplier.name}${
        reference ? ` (ref ${reference})` : ""
      }${invoice ? ` against invoice ${invoice.invoiceNumber}` : ""}. Balance now ${balanceAfter.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "suppliers.payment",
      targetType: "supplier",
      targetId: supplier._id,
      metadata: {
        name: supplier.name,
        amount: args.amount,
        reference,
        method: args.method,
        invoiceId: invoice?._id,
        invoiceNumber: invoice?.invoiceNumber,
        balanceAfter,
      },
    });

    return { paymentId, balanceAfter };
  },
});

/**
 * Adjust a supplier's balance by hand.
 *
 * For the odd correction that no document explains — a goodwill credit, a
 * rounding correction. It is written to the ledger like everything else,
 * so it is visible on the statement rather than hidden in a field.
 */
export const adjustBalance = mutation({
  args: {
    supplierId: v.id("suppliers"),
    /** Signed: positive increases what the business owes. */
    amount: v.number(),
    reason: v.string(),
    date: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "purchasing.pay");
    await requireEntitlement(ctx, tenant.businessId, "purchasing");

    if (args.amount === 0) {
      throw new ConvexError("An adjustment must not be zero.");
    }
    if (!args.reason.trim()) {
      throw new ConvexError("An adjustment must say why it was made.");
    }

    const supplier = await loadSupplier(ctx, args.supplierId, tenant.businessId);

    const { balanceAfter } = await postSupplierLedger(ctx, {
      businessId: tenant.businessId,
      supplierId: supplier._id,
      type: "adjustment",
      amount: args.amount,
      reference: `ADJ-${Date.now()}`,
      date: args.date ?? new Date().toISOString(),
      userId: tenant.user._id,
      notes: args.reason,
    });

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "suppliers.adjustment",
      targetType: "supplier",
      targetId: supplier._id,
      metadata: {
        name: supplier.name,
        amount: args.amount,
        reason: args.reason,
        balanceAfter,
      },
    });

    return { balanceAfter };
  },
});
