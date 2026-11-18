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
 * SMARTBUZ — customers: profiles, credit accounts and statements.
 *
 * A customer is one of three things at once, and this module keeps all
 * three honest:
 *
 *  1. **A profile** — who they are and how to reach them.
 *  2. **A credit account** — what they owe, what their limit is, and
 *     every movement on the account.
 *  3. **A trading history** — what they have bought.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Where the money lives
 * ────────────────────────────────────────────────────────────────────────
 *
 * The credit account is **derived**, never stored as a number on the
 * customer record. A customer owes the sum of the open balances of their
 * credit sales — the `loans` rows — and the payments against them are the
 * `payments` rows.
 *
 * Deriving it rather than caching it is deliberate: a cached balance can
 * drift away from the transactions that justify it, and a business that
 * cannot trust its own receivables figure cannot run a credit book. The
 * statements below are assembled from the same rows, so the balance on
 * the statement is the balance on the account, always.
 *
 * Loyalty points are kept apart from the money, in their own table:
 * points are not currency and mixing the two makes a statement unreadable.
 */

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

/** A customer row, narrowed to the fields this module uses. */
type Customer = Doc<"customers">;

/**
 * Load a customer and make sure it belongs to the caller's business.
 */
async function loadCustomer(
  ctx: any,
  customerId: Id<"customers">,
  businessId: BusinessId
): Promise<Customer> {
  const customer = await ctx.db.get(customerId);
  if (!customer || customer.businessId !== businessId) {
    throw new ConvexError(
      "Forbidden: that customer belongs to another business."
    );
  }
  return customer;
}

/**
 * Every credit sale of a customer, oldest first.
 */
async function customerLoans(
  ctx: any,
  customerId: Id<"customers">
): Promise<Doc<"loans">[]> {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_customer", (q: any) => q.eq("customerId", customerId))
    .collect();
  return loans.sort((a: any, b: any) => a.date.localeCompare(b.date));
}

/**
 * Every payment received from a customer, newest first.
 */
async function customerPayments(
  ctx: any,
  customerId: Id<"customers">
): Promise<Doc<"payments">[]> {
  const payments = await ctx.db
    .query("payments")
    .withIndex("by_customer", (q: any) => q.eq("customerId", customerId))
    .collect();
  return payments.sort((a: any, b: any) => b.date.localeCompare(a.date));
}

/**
 * The outstanding balance of a customer's account.
 *
 * It is the sum of the open balances of their credit sales — the figure
 * the business is actually owed.
 */
export async function outstandingBalance(
  ctx: any,
  customerId: Id<"customers">
): Promise<number> {
  const loans = await customerLoans(ctx, customerId);
  return loans.reduce((sum: number, loan: Doc<"loans">) => sum + loan.balance, 0);
}

/**
 * The total the customer has bought, across every sale.
 */
async function lifetimeValue(
  ctx: any,
  businessId: BusinessId,
  customerId: Id<"customers">
): Promise<{ total: number; count: number; lastPurchaseAt?: string }> {
  const sales = await ctx.db
    .query("sales")
    .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
    .filter((q: any) => q.eq(q.field("customerId"), customerId))
    .collect();

  const total = sales.reduce((sum: number, sale: any) => sum + (sale.total ?? 0), 0);
  const dates = sales
    .map((sale: any) => sale.date)
    .filter((date: any): date is string => typeof date === "string")
    .sort();

  return {
    total,
    count: sales.length,
    lastPurchaseAt: dates.length > 0 ? dates[dates.length - 1] : undefined,
  };
}

/**
 * The customers a branch-restricted caller may see.
 *
 * A customer with no branch belongs to the business as a whole, so every
 * branch may see them. A customer who belongs to a branch is only visible
 * to the branches that are allowed to see them.
 */
async function visibleCustomerIds(
  ctx: any,
  membership: Doc<"memberships">
): Promise<BranchId[] | undefined> {
  return allowedBranchIds(ctx, membership);
}

/**
 * Filter customers to those the caller may see.
 */
async function filterVisibleCustomers(
  ctx: any,
  membership: Doc<"memberships">,
  customers: Customer[]
): Promise<Customer[]> {
  const allowed = await visibleCustomerIds(ctx, membership);
  if (!allowed) return customers;
  return customers.filter(
    (c) => !c.branchId || allowed.includes(c.branchId)
  );
}

/* ────────────────────────────────────────────────────────────────────────
 * Queries — the customer book
 * ──────────────────────────────────────────────────────────────────────── */

export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    searchTerm: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const visible = await filterVisibleCustomers(ctx, tenant.membership, customers);
    const filtered = applyCustomerFilters(visible, args.searchTerm, args.branchId);

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
 * Apply the search and branch filters to a set of customers.
 */
function applyCustomerFilters(
  customers: Customer[],
  searchTerm?: string,
  branchId?: Id<"branches">
): Customer[] {
  let results = customers;

  if (branchId) {
    results = results.filter((c) => c.branchId === branchId);
  }

  if (searchTerm) {
    const search = searchTerm.trim().toLowerCase();
    if (search) {
      results = results.filter(
        (c) =>
          c.name.toLowerCase().includes(search) ||
          (c.phone ?? "").toLowerCase().includes(search) ||
          (c.email ?? "").toLowerCase().includes(search) ||
          (c.distributorId ?? "").toLowerCase().includes(search) ||
          (c.notes ?? "").toLowerCase().includes(search)
      );
    }
  }

  return results;
}

export const listAll = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const visible = await filterVisibleCustomers(ctx, tenant.membership, customers);
    return visible.sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const getPaginated = query({
  args: {
    limit: v.number(),
    offset: v.number(),
    searchTerm: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const customers = await ctx.db
      .query("customers")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const visible = await filterVisibleCustomers(ctx, tenant.membership, customers);
    const filtered = applyCustomerFilters(visible, args.searchTerm, args.branchId);

    filtered.sort((a, b) => a.name.localeCompare(b.name));

    const totalCount = filtered.length;
    const page = filtered.slice(args.offset, args.offset + args.limit);

    // The outstanding balance of every customer on the page, from one
    // pass over the business's credit sales.
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const balanceByCustomer = new Map<string, number>();
    for (const loan of loans) {
      if (!loan.customerId) continue;
      const key = loan.customerId as string;
      balanceByCustomer.set(key, (balanceByCustomer.get(key) ?? 0) + loan.balance);
    }

    return {
      page: page.map((customer) => ({
        ...customer,
        outstandingBalance: balanceByCustomer.get(customer._id as string) ?? 0,
      })),
      totalCount,
    };
  },
});

/**
 * One customer, in full: profile, contact details and account summary.
 */
export const getById = query({
  args: {
    id: v.id("customers"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const customer = await loadCustomer(ctx, args.id, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    const balance = await outstandingBalance(ctx, customer._id);
    const creditLimit = customer.creditLimit ?? 0;
    const value = await lifetimeValue(ctx, tenant.businessId, customer._id);

    return {
      ...customer,
      outstandingBalance: balance,
      creditLimit,
      availableCredit: Math.max(0, creditLimit - balance),
      lifetimeValue: value.total,
      purchaseCount: value.count,
      lastPurchaseAt: value.lastPurchaseAt ?? customer.lastPurchaseAt,
    };
  },
});

/**
 * The customer's credit account.
 */
export const getAccount = query({
  args: {
    customerId: v.id("customers"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");
    await requireEntitlement(ctx, tenant.businessId, "customer.credit");

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    const loans = await customerLoans(ctx, customer._id);
    const payments = await customerPayments(ctx, customer._id);

    const balance = loans.reduce((sum: number, loan) => sum + loan.balance, 0);
    const charged = loans.reduce((sum: number, loan) => sum + loan.amount, 0);
    const paid = payments.reduce((sum: number, payment) => sum + payment.amount, 0);
    const creditLimit = customer.creditLimit ?? 0;

    return {
      customer,
      outstandingBalance: balance,
      totalCharged: charged,
      totalPaid: paid,
      creditLimit,
      availableCredit: Math.max(0, creditLimit - balance),
      overLimit: balance > creditLimit && creditLimit >= 0,
      loans,
      payments,
    };
  },
});

/**
 * The customer's statement.
 *
 * Charges and receipts in date order, with the running balance after each
 * line — the same figure the account holds, so the two can never
 * disagree.
 */
export const getStatement = query({
  args: {
    customerId: v.id("customers"),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");
    await requireEntitlement(ctx, tenant.businessId, "customer.credit");

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    const loans = await customerLoans(ctx, customer._id);
    const payments = await customerPayments(ctx, customer._id);

    type Line = {
      date: string;
      type: "charge" | "payment";
      description: string;
      reference?: string;
      amount: number;
      balanceAfter: number;
      loanId?: Id<"loans">;
      paymentId?: Id<"payments">;
    };

    const lines: Line[] = [];

    // A charge is the amount of the credit sale; the running balance is
    // the loan balance after the deposits taken at the time.
    for (const loan of loans) {
      lines.push({
        date: loan.date,
        type: "charge",
        description: `Credit sale${loan.salesId ? ` ${loan.salesId}` : ""}`,
        reference: loan.salesId,
        amount: loan.amount,
        balanceAfter: loan.balance,
        loanId: loan._id,
      });
    }

    // A receipt reduces what is owed.
    for (const payment of payments) {
      lines.push({
        date: payment.date,
        type: "payment",
        description: "Payment received",
        reference: payment.reference,
        amount: -payment.amount,
        balanceAfter: payment.balance,
        paymentId: payment._id,
      });
    }

    const filtered = lines.filter((line) => {
      if (args.from && line.date < args.from) return false;
      if (args.to && line.date > args.to) return false;
      return true;
    });

    filtered.sort((a, b) => a.date.localeCompare(b.date));

    const openingBalance = filtered.length > 0 ? filtered[0].balanceAfter : 0;

    return {
      customer,
      lines: filtered,
      openingBalance,
      closingBalance: await outstandingBalance(ctx, customer._id),
      totalCharged: lines
        .filter((l) => l.type === "charge")
        .reduce((sum, l) => sum + l.amount, 0),
      totalPaid: lines
        .filter((l) => l.type === "payment")
        .reduce((sum, l) => sum + Math.abs(l.amount), 0),
    };
  },
});

/**
 * What the customer has bought.
 */
export const getPurchaseHistory = query({
  args: {
    customerId: v.id("customers"),
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    const sales = await ctx.db
      .query("sales")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .filter((q: any) => q.eq(q.field("customerId"), customer._id))
      .collect();

    sales.sort((a, b) => (a.date < b.date ? 1 : -1));

    const limit = args.limit ?? 50;
    const page = sales.slice(0, limit);

    const shops = await Promise.all(
      [...new Set(page.map((s) => s.shopId).filter((id): id is Id<"shops"> => !!id))].map(
        (id) => ctx.db.get(id)
      )
    );
    const shopMap = new Map(
      shops.filter((s) => s !== null).map((s) => [s!._id, s!])
    );

    return {
      customer,
      sales: page.map((sale) => ({
        _id: sale._id,
        date: sale.date,
        total: sale.total,
        invoiceNumber: sale.invoiceNumber,
        paymentMode: sale.paymentMode,
        isLoan: sale.isLoan,
        deliveryStatus: sale.deliveryStatus,
        itemCount: sale.items?.length ?? 0,
        shop: sale.shopId ? shopMap.get(sale.shopId) ?? null : null,
      })),
      totalCount: sales.length,
      lifetimeValue: sales.reduce((sum, s) => sum + (s.total ?? 0), 0),
    };
  },
});

/**
 * The customer's loyalty account.
 */
export const getLoyalty = query({
  args: {
    customerId: v.id("customers"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");
    await requireEntitlement(ctx, tenant.businessId, "loyalty.points");

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);

    const transactions = await ctx.db
      .query("loyaltyTransactions")
      .withIndex("by_customer", (q) => q.eq("customerId", customer._id))
      .collect();

    transactions.sort((a, b) => b.date.localeCompare(a.date));

    return {
      customerId: customer._id,
      points: customer.loyaltyPoints ?? 0,
      lifetimePoints: transactions
        .filter((t) => t.points > 0)
        .reduce((sum, t) => sum + t.points, 0),
      transactions,
    };
  },
});

/**
 * The customers who owe the most.
 */
export const getOutstandingBalances = query({
  args: {
    limit: v.optional(v.number()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "finance.view");
    await requireEntitlement(ctx, tenant.businessId, "customer.credit");

    const loans = await ctx.db
      .query("loans")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .collect();

    const balanceByCustomer = new Map<string, number>();
    for (const loan of loans) {
      if (!loan.customerId) continue;
      const key = loan.customerId as string;
      balanceByCustomer.set(key, (balanceByCustomer.get(key) ?? 0) + loan.balance);
    }

    const entries = [...balanceByCustomer.entries()]
      .filter(([, balance]) => balance > 0)
      .sort((a, b) => b[1] - a[1]);

    const limit = args.limit ?? 20;
    const top = entries.slice(0, limit);

    const customers = await Promise.all(
      top.map(([id]) => ctx.db.get(id as Id<"customers">))
    );

    return top.map(([id, balance], index) => {
      const customer = customers[index];
      return {
        customer,
        customerId: id,
        outstandingBalance: balance,
        creditLimit: customer?.creditLimit ?? 0,
        overLimit:
          customer?.creditLimit !== undefined &&
          balance > (customer.creditLimit ?? 0),
      };
    });
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations — the customer book
 * ──────────────────────────────────────────────────────────────────────── */

// Add customer
export const add = mutation({
  args: {
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    distributorId: v.optional(v.string()),
    address: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    type: v.optional(v.string()),
    creditLimit: v.optional(v.number()),
    notes: v.optional(v.string()),
    userId: v.id("users"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.manage");

    const { userId, businessId, ...customerArgs } = args;

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
    }

    // A phone number identifies a customer in a shop. Two records with the
    // same number in the same business are the same person, and a second
    // one is a mistake worth catching now rather than at the till.
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_businessId_phone", (q) =>
        q.eq("businessId", tenant.businessId).eq("phone", args.phone)
      )
      .first();
    if (existing) {
      throw new ConvexError(
        `A customer with the phone number ${args.phone} already exists.`
      );
    }

    const now = new Date().toISOString();
    const customerId = await ctx.db.insert("customers", {
      ...customerArgs,
      businessId: tenant.businessId,
      creditLimit: args.creditLimit ?? 0,
      loyaltyPoints: 0,
      totalSpent: 0,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Add Customer",
      `Added new customer: ${args.name} (${args.phone})${
        args.distributorId ? ` - Distributor ID: ${args.distributorId}` : ""
      }`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "customers.create",
      targetType: "customer",
      targetId: customerId,
      metadata: {
        name: args.name,
        phone: args.phone,
        branchId: args.branchId,
        creditLimit: args.creditLimit ?? 0,
      },
    });

    return customerId;
  },
});

// Update customer
export const update = mutation({
  args: {
    id: v.id("customers"),
    name: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    distributorId: v.optional(v.string()),
    address: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    type: v.optional(v.string()),
    notes: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    userId: v.id("users"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.manage");

    const { id, userId, businessId, ...rest } = args;
    const customer = await loadCustomer(ctx, id, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
    }

    if (args.phone && args.phone !== customer.phone) {
      const clash = await ctx.db
        .query("customers")
        .withIndex("by_businessId_phone", (q) =>
          q.eq("businessId", tenant.businessId).eq("phone", args.phone!)
        )
        .first();
      if (clash) {
        throw new ConvexError(
          `A customer with the phone number ${args.phone} already exists.`
        );
      }
    }

    await ctx.db.patch(id, {
      ...rest,
      updatedAt: new Date().toISOString(),
    });

    const changes = Object.keys(rest)
      .map((key) => `${key}: ${(rest as any)[key]}`)
      .join(", ");
    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Update Customer",
      `Updated customer ${customer.name} - Changes: ${changes}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "customers.update",
      targetType: "customer",
      targetId: id,
      metadata: { changes },
    });
  },
});

/**
 * Remove a customer.
 *
 * A customer with history is **deactivated**, not deleted: their sales,
 * credit sales and payments still have to point at something, and the
 * audit trail must stay readable. Only a customer who has never traded
 * is actually deleted.
 */
export const remove = mutation({
  args: {
    id: v.id("customers"),
    userId: v.id("users"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.manage");

    const customer = await loadCustomer(ctx, args.id, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    const loans = await customerLoans(ctx, customer._id);
    const payments = await customerPayments(ctx, customer._id);
    const sales = await ctx.db
      .query("sales")
      .withIndex("by_businessId", (q: any) => q.eq("businessId", tenant.businessId))
      .filter((q: any) => q.eq(q.field("customerId"), customer._id))
      .first();

    const hasHistory = loans.length > 0 || payments.length > 0 || sales !== null;

    if (hasHistory) {
      await ctx.db.patch(customer._id, {
        isActive: false,
        updatedAt: new Date().toISOString(),
      });

      await logActivity(
        ctx,
        tenant.businessId,
        tenant.user._id,
        "Deactivate Customer",
        `Deactivated ${customer.name} (${customer.phone}) — trading history retained`
      );

      await writeAudit(ctx, {
        businessId: tenant.businessId,
        actorUserId: tenant.user._id,
        actorRole: tenant.membership.role,
        action: "customers.deactivate",
        targetType: "customer",
        targetId: customer._id,
        metadata: { name: customer.name, reason: "has_history" },
      });

      return { deleted: false, deactivated: true };
    }

    await ctx.db.delete(customer._id);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Delete Customer",
      `Deleted customer: ${customer.name} (${customer.phone})${
        customer.distributorId ? ` - Distributor ID: ${customer.distributorId}` : ""
      }`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "customers.delete",
      targetType: "customer",
      targetId: customer._id,
      metadata: { name: customer.name, phone: customer.phone },
    });

    return { deleted: true, deactivated: false };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Mutations — the credit account
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Set a customer's credit limit.
 */
export const setCreditLimit = mutation({
  args: {
    customerId: v.id("customers"),
    creditLimit: v.number(),
    reason: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.credit.manage");
    await requireEntitlement(ctx, tenant.businessId, "customer.credit");

    if (args.creditLimit < 0) {
      throw new ConvexError("A credit limit cannot be negative.");
    }

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);

    await ctx.db.patch(customer._id, {
      creditLimit: args.creditLimit,
      updatedAt: new Date().toISOString(),
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Set Credit Limit",
      `Set credit limit for ${customer.name} to ${args.creditLimit.toLocaleString()}${
        args.reason ? ` — ${args.reason}` : ""
      }`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "customers.credit_limit.set",
      targetType: "customer",
      targetId: customer._id,
      metadata: {
        name: customer.name,
        from: customer.creditLimit ?? 0,
        to: args.creditLimit,
        reason: args.reason,
      },
    });

    return true;
  },
});

/**
 * Take a payment against a customer's credit account.
 *
 * The money is applied to the customer's open credit sales, oldest first,
 * so the account never shows a stale balance on the wrong invoice.
 *
 * A payment carries a **reference** — the bank or receipt number. Two
 * payments with the same reference for the same customer are the same
 * payment, and the second is refused. That is what stops a double
 * submission from paying an account twice.
 */
export const recordPayment = mutation({
  args: {
    customerId: v.id("customers"),
    amount: v.number(),
    date: v.optional(v.string()),
    method: v.optional(v.string()),
    reference: v.optional(v.string()),
    note: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.credit.manage");
    await requireEntitlement(ctx, tenant.businessId, "customer.credit");

    if (args.amount <= 0) {
      throw new ConvexError("A payment must be greater than zero.");
    }

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);
    await requireBranchAccess(ctx, tenant.membership, customer.branchId);

    const reference = args.reference?.trim() || undefined;

    // Duplicate-payment guard. The reference identifies the money, so the
    // same reference twice is the same money twice.
    if (reference) {
      const existing = await customerPayments(ctx, customer._id);
      const duplicate = existing.find((p) => p.reference === reference);
      if (duplicate) {
        throw new ConvexError(
          `A payment with reference "${reference}" has already been recorded for ${customer.name}.`
        );
      }
    }

    const loans = await customerLoans(ctx, customer._id);
    const open = loans.filter((loan) => loan.balance > 0);

    const balance = open.reduce((sum, loan) => sum + loan.balance, 0);
    if (args.amount > balance) {
      throw new ConvexError(
        `Payment of ${args.amount.toLocaleString()} exceeds the outstanding balance of ${balance.toLocaleString()}.`
      );
    }

    const date = args.date ?? new Date().toISOString();
    const paymentIds: Id<"payments">[] = [];

    // Apply the money to the oldest open credit sales first.
    let remaining = args.amount;
    for (const loan of open) {
      if (remaining <= 0) break;
      const applied = Math.min(loan.balance, remaining);
      const newLoanBalance = loan.balance - applied;

      await ctx.db.patch(loan._id, { balance: newLoanBalance });

      const paymentId = await ctx.db.insert("payments", {
        businessId: tenant.businessId,
        loanId: loan._id,
        customerId: customer._id,
        amount: applied,
        date,
        balance: newLoanBalance,
        method: args.method,
        reference,
        branchId: customer.branchId,
        userId: tenant.user._id,
        note: args.note,
      });
      paymentIds.push(paymentId);
      remaining -= applied;
    }

    const newBalance = balance - args.amount;

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Customer Payment",
      `Payment of ${args.amount.toLocaleString()} from ${customer.name}${
        reference ? ` (ref ${reference})` : ""
      }. Balance: ${balance.toLocaleString()} → ${newBalance.toLocaleString()}`
    );

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "customers.payment",
      targetType: "customer",
      targetId: customer._id,
      metadata: {
        name: customer.name,
        amount: args.amount,
        reference,
        method: args.method,
        balanceBefore: balance,
        balanceAfter: newBalance,
        paymentIds,
      },
    });

    return { paymentIds, balanceBefore: balance, balanceAfter: newBalance };
  },
});

/**
 * Award or redeem loyalty points.
 */
export const adjustLoyalty = mutation({
  args: {
    customerId: v.id("customers"),
    /** Positive earns points, negative spends them. */
    points: v.number(),
    reason: v.optional(v.string()),
    saleId: v.optional(v.id("sales")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.credit.manage");
    await requireEntitlement(ctx, tenant.businessId, "loyalty.points");

    if (args.points === 0) {
      throw new ConvexError("A loyalty adjustment must not be zero.");
    }

    const customer = await loadCustomer(ctx, args.customerId, tenant.businessId);

    const current = customer.loyaltyPoints ?? 0;
    const next = current + args.points;
    if (next < 0) {
      throw new ConvexError(
        `That would take ${customer.name} below zero points.`
      );
    }

    await ctx.db.patch(customer._id, {
      loyaltyPoints: next,
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert("loyaltyTransactions", {
      businessId: tenant.businessId,
      customerId: customer._id,
      points: args.points,
      type: args.points > 0 ? "earn" : "redeem",
      reason: args.reason,
      saleId: args.saleId,
      branchId: customer.branchId,
      date: new Date().toISOString(),
      userId: tenant.user._id,
      balanceAfter: next,
    });

    await writeAudit(ctx, {
      businessId: tenant.businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "customers.loyalty.adjust",
      targetType: "customer",
      targetId: customer._id,
      metadata: {
        name: customer.name,
        points: args.points,
        from: current,
        to: next,
        reason: args.reason,
      },
    });

    return { points: next };
  },
});
