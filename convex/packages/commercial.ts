/**
 * Commercial — quotations and the sales pipeline.
 *
 * Two things a business does before it is paid: it prices the work it is
 * being asked to do (a quotation), and it keeps track of the people who
 * might ask (leads).
 *
 * Both are records the business owns, so both live in this business's tables
 * and both are read and written through the tenant's own scope. Nothing here
 * trusts a browser for money: the price of a product is read from the
 * catalogue on the server, the totals are worked out here, and a quotation
 * becomes a sale through the same sales path the till uses, so the stock
 * moves exactly once and the reports see an ordinary sale.
 */

import { mutation, query } from "../_generated/server";
import type { DatabaseWriter } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { writeAudit } from "../audit";
import { applySale } from "../salesCore";
import { assertFeatureAllowed } from "../subscriptionState";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { notifyBusiness } from "../notifications";
import { assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * The vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "converted",
] as const;
type QuoteStatus = (typeof QUOTE_STATUSES)[number];

const LEAD_STAGES = ["new", "contacted", "quoted", "won", "lost"] as const;
type LeadStage = (typeof LEAD_STAGES)[number];

/**
 * The moves a quotation is allowed to make.
 *
 * A quotation is a document with a life of its own, so its states are a small
 * machine: it is written, it goes out, the customer says yes or no, and after
 * that it has either expired or been turned into a sale. Every move that is
 * not in this table is refused, so a quotation that has become a sale can
 * never go back to being a draft.
 */
const QUOTE_TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent", "declined", "expired"],
  sent: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
  converted: [],
};

/**
 * How likely a lead at each stage is to close.
 *
 * The weighted pipeline is the money the business can expect to turn over,
 * so every stage carries the chance it usually closes at. It is a business
 * convention rather than a fact about the world, so it is written down once
 * here instead of being guessed at differently on every screen.
 */
const STAGE_WEIGHTS: Record<LeadStage, number> = {
  new: 0.1,
  contacted: 0.3,
  quoted: 0.6,
  won: 1,
  lost: 0,
};

/* ────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────── */

/** Two decimal places, without the floating-point dust. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Today, as the server sees it.
 *
 * A quotation holds "until" a day, and the day it holds until is decided by
 * the server rather than by the browser, so that a till in another
 * timezone cannot keep a quote alive by disagreeing about the date.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Is this a date the server can read? */
function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`));
}

/** A date a given number of days from today, as `YYYY-MM-DD`. */
function daysFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * The status a quotation really has.
 *
 * A quotation holds until the day it says it does. Once that day has passed
 * the document has expired whether or not anybody remembered to mark it, so
 * the date is read here rather than trusted to a stored flag that can go
 * stale and leave an expired offer sitting in the register looking live.
 */
function effectiveQuoteStatus(
  quote: Doc<"quotations">,
  today: string
): QuoteStatus {
  if (quote.status === "draft" || quote.status === "sent") {
    if (quote.validUntil < today) return "expired";
  }
  return quote.status as QuoteStatus;
}

/* ────────────────────────────────────────────────────────────────────────
 * Quotation references
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The next quotation reference for this business, e.g. `Q-0007`.
 *
 * The number comes from the business's own counter row, exactly as the
 * invoice number does, so two businesses never hand out the same reference
 * and a reference is never used twice.
 */
async function nextQuotationReference(
  ctx: { db: DatabaseWriter },
  businessId: Id<"businesses">
): Promise<string> {
  const counter = await ctx.db
    .query("counters")
    .withIndex("by_businessId_name", (q: any) =>
      q.eq("businessId", businessId).eq("name", "quotation")
    )
    .first();

  let nextValue = 1;
  if (counter) {
    nextValue = counter.lastValue + 1;
    await ctx.db.patch(counter._id, { lastValue: nextValue });
  } else {
    await ctx.db.insert("counters", {
      businessId,
      name: "quotation",
      lastValue: nextValue,
    });
  }

  return `Q-${String(nextValue).padStart(4, "0")}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Pricing a quotation
 * ──────────────────────────────────────────────────────────────────────── */

interface QuoteLineInput {
  description: string;
  quantity: number;
  unitPrice?: number;
  stockId?: Id<"stocks">;
}

interface PricedLine {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  stockId?: Id<"stocks">;
}

interface PricedQuote {
  lines: PricedLine[];
  subtotal: number;
  /** The prices that were set by hand rather than read from the catalogue. */
  overrides: {
    stockId: Id<"stocks">;
    name: string;
    listPrice: number;
    unitPrice: number;
  }[];
}

/**
 * Work out what each line of a quotation costs.
 *
 * A line with a product behind it is priced from the catalogue, on the
 * server: the browser's figure is only ever a request to price it
 * differently, and that request needs the discount permission. A line with
 * no product behind it is work — delivery, installation, a night of labour —
 * and there is no catalogue to read, so the price is the one given but the
 * amount is still worked out here.
 */
async function priceQuoteLines(
  ctx: { db: { get: (id: Id<"stocks">) => Promise<Doc<"stocks"> | null> } },
  businessId: Id<"businesses">,
  lines: QuoteLineInput[],
  mayOverridePrice: boolean
): Promise<PricedQuote> {
  const priced: PricedLine[] = [];
  const overrides: PricedQuote["overrides"] = [];

  for (const [index, line] of lines.entries()) {
    const position = index + 1;

    if (!Number.isFinite(line.quantity) || line.quantity <= 0) {
      throw new ConvexError(
        `Line ${position}: the quantity has to be more than zero.`
      );
    }

    let description = (line.description ?? "").trim();
    let unitPrice: number;

    if (line.stockId) {
      const stock = await ctx.db.get(line.stockId);
      if (!stock || stock.businessId !== businessId) {
        throw new ConvexError(
          `Line ${position}: that product is not in this business's catalogue.`
        );
      }

      // The catalogue's price, read here. A browser that sends a different
      // figure has not changed it.
      unitPrice = stock.price;
      if (!description) description = stock.name;

      if (
        line.unitPrice !== undefined &&
        Math.abs(line.unitPrice - unitPrice) > 0.005
      ) {
        // Somebody priced this line by hand. That is a manager's move, so
        // the permission is checked here and is never taken from the browser.
        if (!mayOverridePrice) {
          throw new ConvexError(
            `Line ${position}: pricing ${stock.name} differently from the price of ${unitPrice} needs the discount permission.`
          );
        }
        if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
          throw new ConvexError(
            `Line ${position}: the price cannot be negative.`
          );
        }
        if (line.unitPrice > unitPrice) {
          throw new ConvexError(
            `Line ${position}: ${stock.name} cannot be quoted above its price of ${unitPrice}.`
          );
        }
        unitPrice = line.unitPrice;
        overrides.push({
          stockId: stock._id,
          name: stock.name,
          listPrice: stock.price,
          unitPrice,
        });
      }
    } else {
      if (line.unitPrice === undefined) {
        throw new ConvexError(
          `Line ${position}: a price is needed for a line with no product behind it.`
        );
      }
      if (!Number.isFinite(line.unitPrice) || line.unitPrice < 0) {
        throw new ConvexError(`Line ${position}: the price cannot be negative.`);
      }
      if (!description) {
        throw new ConvexError(
          `Line ${position}: say what this line is for.`
        );
      }
      unitPrice = line.unitPrice;
    }

    priced.push({
      description,
      quantity: line.quantity,
      unitPrice: round2(unitPrice),
      total: round2(line.quantity * unitPrice),
      stockId: line.stockId,
    });
  }

  const subtotal = round2(priced.reduce((sum, line) => sum + line.total, 0));
  return { lines: priced, subtotal, overrides };
}

/* ────────────────────────────────────────────────────────────────────────
 * Quotation register
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The quotations of this business, newest first.
 *
 * The status shown is the effective one: a quotation whose day has passed
 * reads as expired even if nobody has touched it since it was sent, because
 * an offer that has run out is not an offer any more.
 */
export const listQuotations = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    status: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "sales.view");

    const today = todayIso();
    const rows = await ctx.db
      .query("quotations")
      .withIndex("by_businessId", (q) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    return rows
      .map((quote) => ({
        ...quote,
        storedStatus: quote.status,
        status: effectiveQuoteStatus(quote, today),
      }))
      .filter((quote) => (args.status ? quote.status === args.status : true))
      .filter((quote) =>
        args.customerId ? quote.customerId === args.customerId : true
      )
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
      );
  },
});

/**
 * Write a quotation.
 *
 * Every figure on the document is worked out here: the price of each line,
 * the subtotal, the discount and the total. The browser sends what the
 * customer wants and what it would like to pay; the server decides what it
 * comes to.
 */
export const createQuotation = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    customerId: v.optional(v.id("customers")),
    customerName: v.string(),
    customerPhone: v.optional(v.string()),
    lines: v.array(
      v.object({
        description: v.string(),
        quantity: v.number(),
        unitPrice: v.optional(v.number()),
        stockId: v.optional(v.id("stocks")),
      })
    ),
    discount: v.optional(v.number()),
    validUntil: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "sales.create");
    const businessId = tenant.businessId;

    if (!args.lines.length) {
      throw new ConvexError("A quotation needs at least one line.");
    }

    // The customer has to be somebody this business knows about, or a name
    // the business is willing to write on a document.
    let customerName = (args.customerName ?? "").trim();
    let customerPhone = (args.customerPhone ?? "").trim();
    if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.businessId !== businessId) {
        throw new ConvexError(
          "Forbidden: that customer belongs to another business."
        );
        await assertScreenAvailable(ctx, businessId, ["quotes"]);
      }
      if (!customerName) customerName = customer.name;
      if (!customerPhone) customerPhone = customer.phone;
    }
    if (!customerName) {
      throw new ConvexError(
        "A quotation needs the name of the customer it is for."
      );
    }

    if (!isIsoDate(args.validUntil)) {
      throw new ConvexError(
        "The date the quotation holds until has to be written as YYYY-MM-DD."
      );
    }
    if (args.validUntil < todayIso()) {
      throw new ConvexError(
        "A quotation cannot be written with a day that has already passed."
      );
    }

    // Discounting is a manager's move, so the permission is read from the
    // membership rather than asked for in the request.
    const mayDiscount = tenant.permissions.has("sales.discount");
    const priced = await priceQuoteLines(ctx, businessId, args.lines, mayDiscount);

    const discount = args.discount ?? 0;
    if (!Number.isFinite(discount) || discount < 0) {
      throw new ConvexError("The discount cannot be negative.");
    }
    if (discount > priced.subtotal) {
      throw new ConvexError(
        "The discount is more than the quotation is worth."
      );
    }
    if (discount > 0 && !mayDiscount) {
      throw new ConvexError(
        "Discounting a quotation needs the discount permission."
      );
    }

    const total = round2(priced.subtotal - discount);
    const now = new Date().toISOString();
    const reference = await nextQuotationReference(ctx, businessId);

    const quotationId = await ctx.db.insert("quotations", {
      businessId,
      customerId: args.customerId,
      customerName,
      customerPhone: customerPhone || undefined,
      reference,
      lines: priced.lines,
      subtotal: priced.subtotal,
      discount,
      total,
      status: "draft",
      validUntil: args.validUntil,
      notes: (args.notes ?? "").trim() || undefined,
      createdBy: tenant.user._id,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Create Quotation",
      `${reference} for ${customerName} — ${total}`
    );

    // A quotation that was priced by hand is written into the security
    // trail: the price on the document and the price in the catalogue are
    // both facts somebody will ask about later.
    if (priced.overrides.length || discount > 0) {
      await writeAudit(ctx, {
        businessId,
        actorUserId: tenant.user._id,
        actorRole: tenant.membership.role,
        action: discount > 0 ? "quotation.discount" : "quotation.price_override",
        targetType: "quotation",
        targetId: quotationId,
        metadata: {
          reference,
          subtotal: priced.subtotal,
          discount,
          total,
          overrides: priced.overrides,
        },
      });
    }

    return { quotationId, reference, total };
  },
});

/**
 * Move a quotation along.
 *
 * A quotation cannot jump: it is written, then sent, then accepted or
 * declined. A move that the document's life does not allow is refused rather
 * than quietly accepted, so the register always says something true.
 */
export const updateQuotationStatus = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    quotationId: v.id("quotations"),
    status: v.union(
      v.literal("sent"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired")
    ),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "sales.create");
    const businessId = tenant.businessId;

    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation || quotation.businessId !== businessId) {
      throw new ConvexError(
        "Forbidden: that quotation belongs to another business."
      );
        await assertScreenAvailable(ctx, businessId, ["quotes"]);
    }

    const current = effectiveQuoteStatus(quotation, todayIso());

    // An expired offer that is being marked expired is simply having its
    // stored status brought into line with the date it already carried.
    if (current === "expired" && args.status === "expired") {
      if (quotation.status !== "expired") {
        await ctx.db.patch(quotation._id, {
          status: "expired",
          updatedAt: new Date().toISOString(),
        });
      }
      return { quotationId: quotation._id, status: "expired" as QuoteStatus };
    }

    if (current === "expired") {
      throw new ConvexError(
        `This quotation expired on ${quotation.validUntil} and cannot be changed.`
      );
    }

    if (!QUOTE_TRANSITIONS[current].includes(args.status)) {
      throw new ConvexError(
        `A quotation that is ${current} cannot be marked ${args.status}.`
      );
    }

    await ctx.db.patch(quotation._id, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Quotation Status",
      `${quotation.reference}: ${current} → ${args.status}`
    );

    if (
      args.status === "sent" ||
      args.status === "accepted" ||
      args.status === "declined"
    ) {
      await notifyBusiness(ctx, {
        businessId,
        kind: "quotation",
        title:
          args.status === "accepted"
            ? `Quotation ${quotation.reference} was accepted`
            : args.status === "declined"
              ? `Quotation ${quotation.reference} was declined`
              : `Quotation ${quotation.reference} was sent`,
        body: `${quotation.customerName} — ${quotation.total.toLocaleString()}.`,
        link: "/quotes",
        severity: args.status === "declined" ? "warning" : "info",
        sourceType: "quotation",
        sourceId: quotation._id,
        roles: ["business_owner", "business_admin", "sales_agent"],
        exceptUserId: tenant.user._id,
      });
    }

    return { quotationId: quotation._id, status: args.status };
  },
});

/**
 * Turn an accepted quotation into a sale.
 *
 * This is the point of a quotation: the customer said yes, so the goods go
 * out and the stock has to move with them. The sale is written through the
 * same path the till uses, so the invoice number, the tax, the stock ledger
 * and the reports are all the same as if the sale had been rung up at the
 * counter.
 *
 * The prices are the ones the customer agreed to. If the catalogue has moved
 * since the quotation was written, the customer is charged the lower of the
 * two — they never pay more than they were quoted — and the difference is
 * written into the audit trail.
 */
export const convertQuotationToSale = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    quotationId: v.id("quotations"),
    paymentMode: v.optional(v.string()),
    paymentDueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "sales.create");
    // Turning a quotation into a sale is selling, so the sales module has to
    // be part of what this business pays for.
    await assertFeatureAllowed(ctx, tenant.businessId, "core.sales");
    const businessId = tenant.businessId;

    const quotation = await ctx.db.get(args.quotationId);
    if (!quotation || quotation.businessId !== businessId) {
      throw new ConvexError(
        "Forbidden: that quotation belongs to another business."
      );
        await assertScreenAvailable(ctx, businessId, ["quotes"]);
    }

    const current = effectiveQuoteStatus(quotation, todayIso());
    if (current !== "accepted") {
      if (current === "converted") {
        throw new ConvexError(
          "This quotation has already been turned into a sale."
        );
      }
      if (current === "expired") {
        throw new ConvexError(
          `This quotation expired on ${quotation.validUntil}, so it cannot be turned into a sale.`
        );
      }
      throw new ConvexError(
        "Only an accepted quotation can be turned into a sale."
      );
    }

    // A sale is made of products. A quotation may also price work that has
    // no product behind it — delivery, installation — and a sale row cannot
    // hold that, so the conversion is refused rather than half-made.
    const freeLines = quotation.lines.filter((line) => !line.stockId);
    if (freeLines.length) {
      throw new ConvexError(
        `This quotation prices work that has no product behind it (${freeLines
          .map((line) => line.description)
          .join(", ")}), so it cannot be turned into a sale.`
      );
    }

    // The catalogue now, against the prices that were agreed.
    const priced: {
      stock: Doc<"stocks">;
      quantity: number;
      unitPrice: number;
      quotedPrice: number;
    }[] = [];
    let linesWorth = 0;
    for (const line of quotation.lines) {
      const stock = await ctx.db.get(line.stockId as Id<"stocks">);
      if (!stock || stock.businessId !== businessId) {
        throw new ConvexError(
          `The product "${line.description}" is no longer in the catalogue.`
        );
      }
      // The customer never pays more than they agreed to, and never more
      // than the catalogue now says.
      const unitPrice = Math.min(line.unitPrice, stock.price);
      linesWorth += unitPrice * line.quantity;
      priced.push({
        stock,
        quantity: line.quantity,
        unitPrice,
        quotedPrice: line.unitPrice,
      });
    }

    // The discount is spread across the lines in proportion to what each is
    // worth, so the sale comes to the figure the customer agreed to and the
    // sale's own lines add up to the sale's own total.
    const target = Math.min(quotation.total, linesWorth);
    const factor = linesWorth > 0 ? target / linesWorth : 0;

    const items = priced.map(({ stock, quantity, unitPrice }) => ({
      stockId: stock._id,
      name: stock.name,
      price: round2(unitPrice * factor),
      quantity,
      pv: stock.pv,
      bv: stock.bv,
    }));

    // The total the server expects: the same sum the sale path works out, so
    // that the guard against a client sending a wrong total does not fire on
    // a total the server itself produced.
    const rawTotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    // A price that is not the catalogue's price is an override, and the
    // sale records it the way the till records one.
    const priceOverrides = priced
      .map(({ stock, quantity }, index) => ({
        stockId: stock._id,
        price: items[index].price,
      }))
      .filter((override, index) => override.price !== priced[index].stock.price);

    let clientType = "retail";
    if (quotation.customerId) {
      const customer = await ctx.db.get(quotation.customerId);
      if (!customer || customer.businessId !== businessId) {
        throw new ConvexError(
          "Forbidden: that customer belongs to another business."
        );
      }
      clientType = customer.type ?? "retail";
    }

    const paymentMode = (args.paymentMode ?? "Cash").trim() || "Cash";
    const isCredit = ["loan", "credit"].includes(paymentMode.toLowerCase());
    const paymentDueDate = isCredit
      ? args.paymentDueDate || daysFromToday(30)
      : undefined;

    const result = await applySale(
      ctx,
      {
        customerId: quotation.customerId,
        manualCustomerName: quotation.customerName,
        customerPhone: quotation.customerPhone,
        userId: tenant.user._id,
        total: rawTotal,
        clientType,
        paymentMode,
        items,
        isLoan: isCredit ? true : undefined,
        paymentDueDate,
        priceOverrides,
      },
      {
        businessId,
        userId: tenant.user._id,
        // The prices come from the server's own quotation rather than from a
        // browser, so they are allowed through even where till-level
        // overrides are switched off.
        allowPriceOverrides: true,
        // A price under the floor is a manager's decision, and it is checked
        // against the membership here.
        canOverrideBelowFloor: tenant.permissions.has("sales.discount"),
      }
    );

    await ctx.db.patch(quotation._id, {
      status: "converted",
      convertedSaleId: result.saleId,
      updatedAt: new Date().toISOString(),
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Convert Quotation",
      `${quotation.reference} → sale ${result.invoiceNumber} (${result.total})`
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "quotation.convert",
      targetType: "quotation",
      targetId: quotation._id,
      metadata: {
        reference: quotation.reference,
        saleId: result.saleId,
        invoiceNumber: result.invoiceNumber,
        quoteTotal: quotation.total,
        saleTotal: result.total,
        discount: quotation.discount,
        paymentMode,
      },
    });

    return {
      saleId: result.saleId,
      invoiceNumber: result.invoiceNumber,
      total: result.total,
    };
  },
});

/**
 * What the quotation register says at a glance.
 *
 * The value out is the money the business has put in front of customers and
 * is still waiting on: the quotations that are drafted, sent or accepted.
 */
export const getQuotationSummary = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "sales.view");

    const today = todayIso();
    const rows = await ctx.db
      .query("quotations")
      .withIndex("by_businessId", (q) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    const counts: Record<QuoteStatus, number> = {
      draft: 0,
      sent: 0,
      accepted: 0,
      declined: 0,
      expired: 0,
      converted: 0,
    };
    let outstanding = 0;
    let total = 0;

    for (const quote of rows) {
      const status = effectiveQuoteStatus(quote, today);
      counts[status] += 1;
      total += quote.total;
      if (status === "draft" || status === "sent" || status === "accepted") {
        outstanding += quote.total;
      }
    }

    return {
      ...counts,
      count: rows.length,
      outstandingValue: round2(outstanding),
      totalValue: round2(total),
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * The pipeline
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The leads of this business, newest first.
 *
 * The search runs over the lead itself — the name, the number, what they
 * asked for — because a shop owner remembers "the woman who wanted 50
 * sacks", not a stage.
 */
export const listLeads = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    stage: v.optional(v.string()),
    search: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const term = (args.search ?? "").trim().toLowerCase();

    const rows = await ctx.db
      .query("leads")
      .withIndex("by_businessId", (q) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    return rows
      .filter((lead) => (args.stage ? lead.stage === args.stage : true))
      .filter((lead) => {
        if (!term) return true;
        return [
          lead.name,
          lead.contact,
          lead.email,
          lead.source,
          lead.requirement,
          lead.notes,
        ].some((field) => (field ?? "").toLowerCase().includes(term));
      })
      .sort((a, b) =>
        a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
      );
  },
});

/**
 * Write a lead down.
 *
 * A lead starts at the beginning of the pipeline. Where it goes from here is
 * a decision made afterwards, when somebody has actually spoken to the
 * person.
 */
export const createLead = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    contact: v.optional(v.string()),
    email: v.optional(v.string()),
    source: v.optional(v.string()),
    value: v.optional(v.number()),
    requirement: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.manage");
    const businessId = tenant.businessId;

    const name = (args.name ?? "").trim();
    if (!name) {
      throw new ConvexError("A lead needs a name.");
    }

    const email = (args.email ?? "").trim();
    if (email && !email.includes("@")) {
      throw new ConvexError("That email address does not look like one.");
    }

    if (
      args.value !== undefined &&
      (!Number.isFinite(args.value) || args.value < 0)
    ) {
      throw new ConvexError("What the lead is worth cannot be negative.");
    }

    const now = new Date().toISOString();
    const leadId = await ctx.db.insert("leads", {
      businessId,
      name,
      contact: (args.contact ?? "").trim() || undefined,
      email: email || undefined,
      source: (args.source ?? "").trim() || undefined,
      stage: "new",
      value: args.value,
      requirement: (args.requirement ?? "").trim() || undefined,
      notes: (args.notes ?? "").trim() || undefined,
      ownerId: tenant.user._id,
      createdAt: now,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Create Lead",
      `${name} (${args.source?.trim() || "source not recorded"})`
    );
        await assertScreenAvailable(ctx, businessId, ["leads"]);

    return { leadId };
  },
});

/**
 * The customer a won lead becomes.
 *
 * A lead that has been won is a person who buys, so they belong in the
 * customer directory. A lead that is already attached to a customer keeps
 * that customer; a lead whose number is already on the books is that
 * customer; otherwise a customer record is made from what the lead knows.
 */
async function resolveCustomerForLead(
  ctx: any,
  businessId: Id<"businesses">,
  lead: Doc<"leads">,
  customerId: Id<"customers"> | undefined,
  phone: string | undefined
): Promise<Id<"customers">> {
  if (lead.customerId) {
    const attached = await ctx.db.get(lead.customerId);
    if (attached && attached.businessId === businessId) return attached._id;
  }

  if (customerId) {
    const customer = await ctx.db.get(customerId);
    if (!customer || customer.businessId !== businessId) {
      throw new ConvexError(
        "Forbidden: that customer belongs to another business."
      );
    }
    return customer._id;
  }

  const contact = (phone ?? lead.contact ?? "").trim();
  if (!contact) {
    throw new ConvexError(
      "This lead has no phone number. Give the customer a number before the lead is won, so the customer record can be made."
    );
  }

  // Somebody already on the books under this number is that customer, not a
  // second one.
  const existing = await ctx.db
    .query("customers")
    .withIndex("by_businessId_phone", (q: any) =>
      q.eq("businessId", businessId).eq("phone", contact)
    )
    .first();
  if (existing) return existing._id;

  const now = new Date().toISOString();
  return ctx.db.insert("customers", {
    businessId,
    name: lead.name,
    phone: contact,
    email: lead.email,
    type: "retail",
    isActive: true,
    notes: lead.requirement
      ? `Came from a lead. ${lead.requirement}`
      : "Came from a lead.",
    createdAt: now,
    updatedAt: now,
  });
}

/**
 * Move a lead along the pipeline.
 *
 * Winning a lead makes it a customer, and the customer record is written
 * here rather than left to somebody to remember. Losing one asks why, so
 * that the pipeline can be read later and the same mistake is not made
 * again.
 */
export const updateLeadStage = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    leadId: v.id("leads"),
    stage: v.union(
      v.literal("new"),
      v.literal("contacted"),
      v.literal("quoted"),
      v.literal("won"),
      v.literal("lost")
    ),
    lostReason: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    customerPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.manage");
    const businessId = tenant.businessId;

    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.businessId !== businessId) {
      throw new ConvexError("Forbidden: that lead belongs to another business.");
    }

    const patch: Partial<Doc<"leads">> = {
      stage: args.stage,
      updatedAt: new Date().toISOString(),
    };

    if (args.stage === "lost") {
      const reason = (args.lostReason ?? "").trim();
      if (!reason) {
        throw new ConvexError(
          "Say why the lead was lost, so the pipeline can be read later."
        );
        await assertScreenAvailable(ctx, businessId, ["leads"]);
      }
      patch.lostReason = reason;
    } else {
      patch.lostReason = undefined;
    }

    if (args.stage === "won") {
      patch.customerId = await resolveCustomerForLead(
        ctx,
        businessId,
        lead,
        args.customerId,
        args.customerPhone
      );
    } else if (args.customerId) {
      const customer = await ctx.db.get(args.customerId);
      if (!customer || customer.businessId !== businessId) {
        throw new ConvexError(
          "Forbidden: that customer belongs to another business."
        );
      }
      patch.customerId = customer._id;
    }

    await ctx.db.patch(lead._id, patch);

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Lead Stage",
      `${lead.name}: ${lead.stage} → ${args.stage}`
    );

    // Winning and losing are the two moves that change what the business
    // has, so they are written into the security trail as well as the
    // activity log.
    if (args.stage === "won" || args.stage === "lost") {
      await writeAudit(ctx, {
        businessId,
        actorUserId: tenant.user._id,
        actorRole: tenant.membership.role,
        action: args.stage === "won" ? "lead.won" : "lead.lost",
        targetType: "lead",
        targetId: lead._id,
        metadata: {
          name: lead.name,
          value: lead.value,
          customerId: patch.customerId,
          lostReason: patch.lostReason,
        },
      });
    }

    return {
      leadId: lead._id,
      stage: args.stage,
      customerId: patch.customerId,
    };
  },
});

/**
 * Take a lead off the books.
 *
 * A lead that was won became a customer, and the customer record matters
 * more than the note of how it was won — so a won lead cannot be deleted
 * out from under it.
 */
export const deleteLead = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    leadId: v.id("leads"),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.manage");

    const lead = await ctx.db.get(args.leadId);
    if (!lead || lead.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that lead belongs to another business.");
    }

    if (lead.stage === "won" || lead.customerId) {
      throw new ConvexError(
        "This lead was won and became a customer, so it cannot be deleted. The customer record matters more than the note of how it was won."
      );
        await assertScreenAvailable(ctx, tenant.businessId, ["leads"]);
    }

    await ctx.db.delete(lead._id);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Delete Lead",
      `${lead.name} (${lead.stage})`
    );

    return { leadId: lead._id };
  },
});

/**
 * The pipeline at a glance.
 *
 * The weighted value is what the open leads are worth if they close at the
 * rate each stage usually closes at. The win rate is the share of the leads
 * that have been decided that were won — a rate with nothing decided behind
 * it is reported as zero rather than as a number that means nothing.
 */
export const getPipelineSummary = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "customers.view");

    const rows = await ctx.db
      .query("leads")
      .withIndex("by_businessId", (q) =>
        q.eq("businessId", tenant.businessId)
      )
      .collect();

    const stages = LEAD_STAGES.map((stage) => {
      const leads = rows.filter((lead) => lead.stage === stage);
      const value = round2(
        leads.reduce((sum, lead) => sum + (lead.value ?? 0), 0)
      );
      return { stage, count: leads.length, value };
    });

    const open = rows.filter(
      (lead) => lead.stage !== "won" && lead.stage !== "lost"
    );
    const pipelineValue = round2(
      open.reduce((sum, lead) => sum + (lead.value ?? 0), 0)
    );
    const weightedValue = round2(
      rows.reduce(
        (sum, lead) =>
          sum +
          (lead.value ?? 0) * (STAGE_WEIGHTS[lead.stage as LeadStage] ?? 0),
        0
      )
    );

    const won = rows.filter((lead) => lead.stage === "won").length;
    const lost = rows.filter((lead) => lead.stage === "lost").length;
    const closed = won + lost;

    return {
      stages,
      total: rows.length,
      open: open.length,
      pipelineValue,
      weightedValue,
      won,
      lost,
      closed,
      winRate: closed === 0 ? 0 : round2((won / closed) * 100),
    };
  },
});
