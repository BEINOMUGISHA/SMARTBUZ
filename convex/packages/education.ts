/**
 * SMARTBUZ — school fees.
 *
 * A school is not a shop. Nobody walks in and buys a thing: the school
 * invoices a term's fees to a student, the family pays some or all of it,
 * and whatever is left over gets older every week until somebody chases it.
 *
 * So this module keeps four things straight:
 *
 *   • the invoice   — what was charged, for which term, and when it falls due
 *   • the payment   — what has been taken against it, and by what method
 *   • the ageing    — how old each unpaid balance is
 *   • the statement — what one student owes, in words a parent can read
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule
 * ────────────────────────────────────────────────────────────────────────
 *
 * **The server owns every number.**
 *
 * The browser sends what the operator typed — the lines, the amount paid,
 * the due date. The total, the balance, the status and the ageing are
 * worked out here, from the stored rows, every single time. A client that
 * sends its own total, its own balance or its own status is ignored, so
 * what the school is told it is owed can never be the browser's opinion.
 *
 * The money itself is written to `incomeRecords`, which is the product's
 * ledger for money that came in without goods leaving the shelf. School
 * fees are exactly that — money received that is not a sale — so they
 * belong beside rent and grants rather than in the sales book, where they
 * would flatter a revenue that never happened. The invoice holds the
 * allocation (what was paid against what); the ledger holds the money.
 *
 * The product's `payments` table cannot hold a school fee: every row in it
 * points at a loan, and every loan points at a sale, and a fee is neither.
 * Writing a fake sale to satisfy it would put school money into the retail
 * revenue report, so the fee ledger is used instead.
 */

import { mutation, query } from "../_generated/server";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { writeAudit } from "../audit";
import { money } from "../financeCore";
import { assertPaymentMethod, resolvePaymentDates } from "../paymentRules";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertPackageFeature, assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

const MS_PER_DAY = 86_400_000;

/** The states a fee invoice can be in. */
type FeeStatus = "unpaid" | "partial" | "paid" | "overdue" | "void";

/** Today, on the server, as `YYYY-MM-DD`. */
function asOfDate(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A plain date the operator typed, checked before it is stored.
 *
 * A due date is a date and not a moment: "due on 30 April" means the same
 * thing to the bursar and to the parent, so it is kept as the day itself.
 */
function assertDate(value: string, what: string): string {
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ConvexError(`The ${what} must be a date like 2026-04-30.`);
  }
  if (!Number.isFinite(Date.parse(`${trimmed}T00:00:00Z`))) {
    throw new ConvexError(`The ${what} is not a real date.`);
  }
  return trimmed;
}

/**
 * How many days past its due date an invoice is.
 *
 * Zero while the invoice is still within its time — a bill that falls due
 * today is not late today.
 */
function daysOverdue(dueDate: string, asOf: string): number {
  const due = Date.parse(`${dueDate}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(due) || !Number.isFinite(now)) return 0;
  const days = Math.floor((now - due) / MS_PER_DAY);
  return days > 0 ? days : 0;
}

/**
 * The status an invoice's own numbers give it.
 *
 * The browser never says what an invoice is. It is worked out here from the
 * total, what has been paid against it and when the bill falls due, so the
 * status on the screen is always the status on the row.
 */
function deriveStatus(args: {
  total: number;
  amountPaid: number;
  balance: number;
  dueDate: string;
  asOf: string;
}): Exclude<FeeStatus, "void"> {
  if (args.balance <= 0) return "paid";
  if (args.amountPaid > 0) return "partial";
  return args.dueDate < args.asOf ? "overdue" : "unpaid";
}

/**
 * The next receipt number for this business.
 *
 * The counter lives in the `counters` table, so two schools can both issue
 * "RCT-00001" without colliding, and two payments taken in the same second
 * still get different numbers.
 */
async function nextReceiptNumber(
  ctx: MutationCtx,
  businessId: Id<"businesses">
): Promise<string> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_businessId_name", (q) =>
      q.eq("businessId", businessId).eq("name", "fee_receipt")
    )
    .first();

  let nextValue = 1;
  if (counter) {
    nextValue = counter.lastValue + 1;
    await ctx.db.patch(counter._id, { lastValue: nextValue });
  } else {
    await ctx.db.insert("counters", {
      businessId,
      name: "fee_receipt",
      lastValue: nextValue,
    });
  }

  return `RCT-${String(nextValue).padStart(5, "0")}`;
}

/**
 * How a receipt reads on the money ledger.
 *
 * The invoice id is written into the line so that a student's statement can
 * find the receipts that belong to that student's invoices without a table
 * of its own. The method — and the mobile money or cheque reference the
 * operator quoted — are written in brackets at the end, where they can be
 * read back without guessing where the line begins.
 */
function receiptDescription(args: {
  term: string;
  payerName: string;
  method: string;
  reference?: string | undefined;
  invoiceId: string;
}): string {
  const bracket = args.reference
    ? `${args.method}, ref ${args.reference}`
    : args.method;
  return `${args.term} — ${args.payerName} — invoice ${args.invoiceId} (${bracket})`;
}

/** The parts of a receipt line, read back for a statement. */
function parseReceipt(description: string): {
  method: string | null;
  reference: string | null;
  invoiceId: string | null;
} {
  const invoice = /— invoice (\S+)/.exec(description);
  const bracket = /\(([a-z_]+)(?:, ref ([^)]*))?\)/.exec(description);
  return {
    method: bracket?.[1] ?? null,
    reference: bracket?.[2] ?? null,
    invoiceId: invoice?.[1] ?? null,
  };
}

/** The buckets an unpaid balance is aged into. */
const AGEING_BUCKETS: Array<{ key: string; label: string; from: number; to: number }> = [
  { key: "current", label: "Current (not yet due)", from: 0, to: 0 },
  { key: "1-30", label: "1–30 days", from: 1, to: 30 },
  { key: "31-60", label: "31–60 days", from: 31, to: 60 },
  { key: "61-90", label: "61–90 days", from: 61, to: 90 },
  { key: "90+", label: "90+ days", from: 91, to: Number.MAX_SAFE_INTEGER },
];

/**
 * The students of this business, by id.
 *
 * The member record is the one place a student's name lives, so it is read
 * from there rather than copied onto the invoice — a student who is renamed
 * shows the new name on every screen at once.
 */
async function studentNames(
  ctx: QueryCtx,
  businessId: Id<"businesses">
): Promise<Map<string, string>> {
  const rows = await ctx.db
    .query("members")
    .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
    .collect();
  return new Map(rows.map((row) => [row._id, row.name]));
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The fee invoices of this business.
 *
 * The balance and the days overdue on every row are worked out here, from
 * the stored numbers and the server's own clock, so a list that was opened
 * in March and a list that was opened in April never disagree about what a
 * bill still owes.
 */
export const listFeeInvoices = query({
  args: {
    status: v.optional(v.string()),
    term: v.optional(v.string()),
    memberId: v.optional(v.id("members")),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.view");

    let rows = await ctx.db
      .query("feeInvoices")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    if (args.status) rows = rows.filter((row) => row.status === args.status);
    if (args.term) rows = rows.filter((row) => row.term === args.term);
    if (args.memberId) rows = rows.filter((row) => row.memberId === args.memberId);

    const names = await studentNames(ctx, businessId);
    const asOf = asOfDate(new Date());

    return rows
      .map((row) => ({
        _id: row._id,
        memberId: row.memberId ?? null,
        memberName: row.memberId ? names.get(row.memberId) ?? null : null,
        payerName: row.payerName,
        payerPhone: row.payerPhone ?? null,
        term: row.term,
        lines: row.lines,
        total: row.total,
        amountPaid: row.amountPaid,
        balance: row.balance,
        dueDate: row.dueDate,
        status: row.status,
        daysOverdue: row.status === "void" ? 0 : daysOverdue(row.dueDate, asOf),
        notes: row.notes ?? null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
      // The oldest bill first: that is the one a bursar is chasing.
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  },
});

/**
 * What is owed, and how old it is.
 *
 * The ageing is the whole point of the screen: a bursar does not chase a
 * balance, they chase a balance that is thirty days old and one that is a
 * hundred days old, because those are two different conversations.
 */
export const getFeeArrears = query({
  args: {
    term: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "finance.view");

    const rows = await ctx.db
      .query("feeInvoices")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const asOf = asOfDate(new Date());

    const outstanding = rows.filter((row) => {
      if (row.status === "void") return false;
      if (args.term && row.term !== args.term) return false;
      return row.balance > 0;
    });

    const buckets = AGEING_BUCKETS.map((bucket) => {
      const inBucket = outstanding.filter((row) => {
        const days = daysOverdue(row.dueDate, asOf);
        return days >= bucket.from && days <= bucket.to;
      });

      return {
        key: bucket.key,
        label: bucket.label,
        count: inBucket.length,
        amount: money(
          inBucket.reduce((sum, row) => sum + row.balance, 0)
        ),
      };
    });

    return {
      asOf,
      term: args.term ?? null,
      buckets,
      invoiceCount: outstanding.length,
      totalOutstanding: money(
        outstanding.reduce((sum, row) => sum + row.balance, 0)
      ),
    };
  },
});

/**
 * One student's account, written for a parent to read.
 *
 * It carries the terms that have been billed, what has been paid against
 * each of them, what is still owed, and the receipts for the payments that
 * have come in.
 */
export const getStudentStatement = query({
  args: {
    memberId: v.id("members"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.view");

    const member = await ctx.db.get(args.memberId);
    if (!member || member.businessId !== businessId) {
      throw new ConvexError("Forbidden: that student belongs to another business.");
    }

    const rows = await ctx.db
      .query("feeInvoices")
      .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
      .collect();

    const invoices = rows
      .filter((row) => row.businessId === businessId)
      .map((row) => ({
        _id: row._id,
        term: row.term,
        lines: row.lines,
        total: row.total,
        amountPaid: row.amountPaid,
        balance: row.balance,
        dueDate: row.dueDate,
        status: row.status,
        daysOverdue: row.status === "void" ? 0 : daysOverdue(row.dueDate, asOfDate(new Date())),
      }));

    // The receipts are the money rows the school wrote when a payment came
    // in. They are matched to the invoices by the invoice id written into
    // the receipt line.
    const invoiceIds = new Set<string>(invoices.map((invoice) => invoice._id));
    const ledger = await ctx.db
      .query("incomeRecords")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const payments = ledger
      .filter((row) => row.source === "School fees")
      .map((row) => {
        const parsed = parseReceipt(row.description ?? "");
        return {
          receiptNumber: row.reference ?? null,
          amount: row.amount,
          date: row.date,
          method: parsed.method,
          reference: parsed.reference,
          invoiceId: parsed.invoiceId,
          term: row.description?.split(" — ")[0] ?? null,
        };
      })
      .filter(
        (payment) => payment.invoiceId !== null && invoiceIds.has(payment.invoiceId)
      )
      .sort((a, b) => b.date.localeCompare(a.date));

    const live = invoices.filter((invoice) => invoice.status !== "void");

    return {
      student: {
        _id: member._id,
        name: member.name,
        memberNumber: member.memberNumber,
        phone: member.phone ?? null,
        email: member.email ?? null,
        joinedDate: member.joinedDate,
      },
      invoices,
      payments,
      totals: {
        invoiced: money(live.reduce((sum, invoice) => sum + invoice.total, 0)),
        paid: money(live.reduce((sum, invoice) => sum + invoice.amountPaid, 0)),
        owed: money(live.reduce((sum, invoice) => sum + invoice.balance, 0)),
        overdueCount: live.filter((invoice) => invoice.daysOverdue > 0).length,
      },
    };
  },
});

/**
 * The money of the current term, in four figures.
 *
 * "Collected" is the money taken against this term's invoices — not the
 * money that happened to arrive this week — so the figure stands next to
 * the figure it is part of.
 */
export const getFeesSummary = query({
  args: {
    term: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "finance.view");

    const rows = await ctx.db
      .query("feeInvoices")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const live = rows.filter((row) => row.status !== "void");

    // The terms this school has billed, most recent first — the filter the
    // screen offers the operator.
    const terms = Array.from(new Set(live.map((row) => row.term))).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true })
    );

    // With no term chosen, the current term is the one the newest invoice
    // was raised for.
    const term =
      args.term ??
      live.reduce<string | null>((latest, row) => {
        if (!latest) return row.term;
        return row.createdAt > latest ? row.term : latest;
      }, null);

    const inTerm = term ? live.filter((row) => row.term === term) : [];

    const asOf = asOfDate(new Date());
    const inArrears = new Set<string>();
    for (const row of inTerm) {
      if (row.balance > 0 && daysOverdue(row.dueDate, asOf) > 0) {
        inArrears.add(row.memberId ?? row.payerName);
      }
    }

    return {
      term,
      terms,
      invoiced: money(inTerm.reduce((sum, row) => sum + row.total, 0)),
      collected: money(inTerm.reduce((sum, row) => sum + row.amountPaid, 0)),
      outstanding: money(inTerm.reduce((sum, row) => sum + row.balance, 0)),
      invoiceCount: inTerm.length,
      studentsInArrears: inArrears.size,
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Raise a fee invoice.
 *
 * The operator types the lines — what is being charged for this term — and
 * the server works out what it comes to. There is no fee structure to look
 * up, on purpose: an invoice that carried a copy of the fee structure
 * would change its meaning the moment the school changed its prices, and
 * the bill a parent was given would stop being the bill they were given.
 */
export const raiseFeeInvoice = mutation({
  args: {
    memberId: v.optional(v.id("members")),
    customerId: v.optional(v.id("customers")),
    payerName: v.string(),
    payerPhone: v.optional(v.string()),
    term: v.string(),
    lines: v.array(
      v.object({
        description: v.string(),
        amount: v.number(),
        quantity: v.optional(v.number()),
      })
    ),
    dueDate: v.string(),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.manage");
    await assertPackageFeature(ctx, businessId, "term_billing");

    const term = args.term.trim();
    if (!term) {
      throw new ConvexError("The invoice needs a term, for example Term 1 2026.");
    }

    const dueDate = assertDate(args.dueDate, "due date");

    if (args.lines.length === 0) {
      throw new ConvexError("An invoice needs at least one line.");
    }

    const lines = args.lines.map((line, index) => {
      const description = line.description.trim();
      if (!description) {
        throw new ConvexError(`Line ${index + 1} needs a description.`);
      }
      if (!(line.amount > 0)) {
        throw new ConvexError(`Line ${index + 1} must be more than zero.`);
      }
      if (line.quantity !== undefined && !(line.quantity > 0)) {
        throw new ConvexError(`Line ${index + 1} must have a quantity of more than zero.`);
      }
      return {
        description,
        amount: money(line.amount),
        quantity: line.quantity,
      };
    });

    // The total is the sum of the lines, worked out here. The browser never
    // gets to say what a term's fees come to.
    const total = money(
      lines.reduce((sum, line) => sum + line.amount * (line.quantity ?? 1), 0)
    );
    if (total <= 0) {
      throw new ConvexError("An invoice must come to more than zero.");
    }

    let payerName = args.payerName.trim();
    if (args.memberId) {
      const member = await ctx.db.get(args.memberId);
      if (!member || member.businessId !== businessId) {
        throw new ConvexError("Forbidden: that student belongs to another business.");
      }
      // A bill for a student is addressed to the student unless the school
      // says otherwise — the parent who pays is often not the same name.
      if (!payerName) payerName = member.name;
    }
    if (!payerName) {
      throw new ConvexError("The invoice needs the name of the person who will pay.");
    }

    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.businessId !== businessId) {
        throw new ConvexError("Forbidden: that customer belongs to another business.");
      }
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const asOf = asOfDate(now);
    const status = deriveStatus({
      total,
      amountPaid: 0,
      balance: total,
      dueDate,
      asOf,
    });

    const id = await ctx.db.insert("feeInvoices", {
      businessId,
      memberId: args.memberId,
      customerId: args.customerId,
      payerName,
      payerPhone: args.payerPhone?.trim() || undefined,
      term,
      lines,
      total,
      amountPaid: 0,
      balance: total,
      dueDate,
      status,
      notes: args.notes?.trim() || undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Raise Fee Invoice",
      `${payerName} — ${term}: ${total} due ${dueDate}`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "fee.invoice.raise",
      targetType: "fee_invoice",
      targetId: id,
      metadata: { term, total, dueDate, payerName },
    });

    return { id, total, balance: total, status, dueDate, term };
  },
});

/**
 * Take a payment against an invoice.
 *
 * The invoice keeps the allocation — what has been paid against what — and
 * the money is written to the product's own ledger for income that is not a
 * sale. Both happen here, together, so money can never be recorded against
 * a bill without the bill knowing about it.
 */
export const payFeeInvoice = mutation({
  args: {
    invoiceId: v.id("feeInvoices"),
    amount: v.number(),
    method: v.string(),
    reference: v.optional(v.string()),
    date: v.optional(v.string()),
    notes: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.manage");

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== businessId) {
      throw new ConvexError("Forbidden: that invoice belongs to another business.");
    }
    if (invoice.status === "void") {
      throw new ConvexError("This invoice has been voided, so nothing can be paid against it.");
    }

    if (!(args.amount > 0)) {
      throw new ConvexError("The payment must be more than zero.");
    }

    const amount = money(args.amount);
    const balance = money(invoice.total - invoice.amountPaid);
    if (amount > balance) {
      throw new ConvexError(
        `That is more than the balance outstanding. The most that can be taken now is ${balance}.`
      );
        await assertScreenAvailable(ctx, businessId, ["fees"]);
    }

    const method = assertPaymentMethod(args.method);

    // The server's own clock stamps the payment. An operator's date is kept
    // beside it when it is close enough to be believable, which is the same
    // rule every other payment in the product follows.
    const { date: paymentDate, paymentDate: claimedDate } =
      resolvePaymentDates(args.date);

    const amountPaid = money(invoice.amountPaid + amount);
    const newBalance = money(invoice.total - amountPaid);
    const now = new Date();
    const nowIso = now.toISOString();
    const status = deriveStatus({
      total: invoice.total,
      amountPaid,
      balance: newBalance,
      dueDate: invoice.dueDate,
      asOf: asOfDate(now),
    });

    await ctx.db.patch(invoice._id, {
      amountPaid,
      balance: newBalance,
      status,
      updatedAt: nowIso,
    });

    const receiptNumber = await nextReceiptNumber(ctx, businessId);

    await ctx.db.insert("incomeRecords", {
      businessId,
      date: paymentDate,
      amount,
      source: "School fees",
      description: receiptDescription({
        term: invoice.term,
        payerName: invoice.payerName,
        method,
        reference: args.reference?.trim() || undefined,
        invoiceId: invoice._id,
      }),
      reference: receiptNumber,
      userId: tenant.user._id,
      createdAt: nowIso,
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Record Fee Payment",
      `${invoice.payerName} — ${invoice.term}: ${amount} by ${method} (${receiptNumber})`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "fee.invoice.pay",
      targetType: "fee_invoice",
      targetId: invoice._id,
      metadata: {
        amount,
        method,
        receiptNumber,
        balanceAfter: newBalance,
        claimedDate: claimedDate ?? null,
        notes: args.notes?.trim() || undefined,
      },
    });

    return {
      receiptNumber,
      invoiceId: invoice._id,
      amount,
      method,
      date: paymentDate,
      balanceAfter: newBalance,
      status,
      payerName: invoice.payerName,
      term: invoice.term,
    };
  },
});

/**
 * Void a fee invoice.
 *
 * Voiding is not deleting: the invoice stays on file, because a school has
 * to be able to show that a bill was raised and then cancelled. It is
 * refused once money has been taken against it, because that money is
 * somebody's receipt and only a refund can take it back — a void must
 * never make a payment disappear.
 */
export const voidFeeInvoice = mutation({
  args: {
    invoiceId: v.id("feeInvoices"),
    reason: v.optional(v.string()),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.manage");

    const invoice = await ctx.db.get(args.invoiceId);
    if (!invoice || invoice.businessId !== businessId) {
      throw new ConvexError("Forbidden: that invoice belongs to another business.");
    }
    if (invoice.status === "void") {
      throw new ConvexError("This invoice has already been voided.");
    }
    if (invoice.amountPaid > 0) {
      throw new ConvexError(
        "Money has been taken against this invoice, so it cannot be voided. Refund the payment instead."
      );
        await assertScreenAvailable(ctx, businessId, ["fees"]);
    }

    const nowIso = new Date().toISOString();

    await ctx.db.patch(invoice._id, {
      status: "void",
      updatedAt: nowIso,
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Void Fee Invoice",
      `${invoice.payerName} — ${invoice.term}${args.reason?.trim() ? `: ${args.reason.trim()}` : ""}`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "fee.invoice.void",
      targetType: "fee_invoice",
      targetId: invoice._id,
      metadata: {
        term: invoice.term,
        total: invoice.total,
        reason: args.reason?.trim() || undefined,
      },
    });

    return { id: invoice._id, status: "void" as const };
  },
});
