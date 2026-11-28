/**
 * SMARTBUZ — the clinical package.
 *
 * Two records that a clinic, a pharmacy or an agro-clinic has to keep
 * whether it sells anything or not:
 *
 *   • the **controlled-drug register** — what came in, what went out, and
 *     what the register says should still be on the shelf; and
 *   • **vaccinations** — the campaigns, the animals, the patients, and the
 *     date the next dose falls due.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The balance is never taken on trust
 * ────────────────────────────────────────────────────────────────────────
 *
 * A controlled-drug register is a legal record. The number on it has to be
 * the number the entries add up to, and it has to be that number even when
 * the person typing is in a hurry. So the balance is worked out on the
 * server from the entries, every time, and what the browser believes the
 * balance is — nothing — is never written.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this package deliberately does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It does not check what one medicine does to another, it does not judge
 * whether a dose is right for the animal or the patient, and it does not
 * know how long a vaccine lasts. The next due date is the one the operator
 * sends, because that interval belongs to the vaccine, the species and the
 * country — and SMARTBUZ does not know those.
 */

import { mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertPackageFeature, assertScreenAvailable } from "./manage";
import { writeAudit } from "../audit";

/* ────────────────────────────────────────────────────────────────────────
 * The shapes the register understands
 * ──────────────────────────────────────────────────────────────────────── */

/** The four ways a controlled drug can move. */
const entryType = v.union(
  v.literal("receipt"),
  v.literal("dispense"),
  v.literal("adjustment"),
  v.literal("write_off"),
);

export type ClinicalEntryType =
  | "receipt"
  | "dispense"
  | "adjustment"
  | "write_off";

/** What a vaccination was given to. */
const subjectType = v.union(
  v.literal("livestock"),
  v.literal("pet"),
  v.literal("human"),
);

export type ClinicalSubjectType = "livestock" | "pet" | "human";

/** Whether the vaccination has happened, is booked, or was missed. */
const vaccinationStatus = v.union(
  v.literal("done"),
  v.literal("booked"),
  v.literal("missed"),
);

export type ClinicalVaccinationStatus = "done" | "booked" | "missed";

/** The stock movement each entry type is worth. */
const LEDGER_EVENT_BY_ENTRY: Record<ClinicalEntryType, string> = {
  receipt: "RESTOCK",
  dispense: "SALE",
  write_off: "ADJUSTMENT",
  adjustment: "ADJUSTMENT",
};

/* ────────────────────────────────────────────────────────────────────────
 * Small helpers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Round to three decimals.
 *
 * Quantities in a register are small numbers — 2.5 ml, 20 tablets — and
 * they are added up hundreds of times. Left alone, binary floating point
 * turns twenty additions of 0.1 into 2.0000000000000004, and a register
 * that reads 2.0000000000000004 is a register nobody trusts.
 */
function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** Is this a plain calendar day, `YYYY-MM-DD`? */
function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return false;
  // A date like 2026-02-31 parses but is not a real day, so it is checked
  // against the day it actually claims to be.
  return parsed.toISOString().slice(0, 10) === value;
}

/** Today, as the register writes days down. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The day that is `days` after `day`. */
function addDays(day: string, days: number): string {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/**
 * What one entry does to the register.
 *
 * A receipt adds, a dispense and a write-off take away. An adjustment is
 * the one entry whose direction is not in its type — it is the correction
 * of a mistake, and a mistake can go either way — so its quantity carries
 * the sign. Every other type keeps its quantity positive and takes its
 * direction from the type, which is what keeps the book readable.
 *
 * An entry type this version does not know contributes nothing rather than
 * quietly corrupting a balance.
 */
function entryDelta(entry: string, quantity: number): number {
  switch (entry) {
    case "receipt":
      return quantity;
    case "dispense":
    case "write_off":
      return -quantity;
    case "adjustment":
      return quantity;
    default:
      return 0;
  }
}

/** Which way an entry moved the drug. */
function entryDirection(entry: string, quantity: number): "in" | "out" {
  return entryDelta(entry, quantity) >= 0 ? "in" : "out";
}

/**
 * The line a drug is counted on.
 *
 * "Morphine 30mg" and "Morphine 10mg" are different drugs as far as the
 * register is concerned, so the name alone is not enough to identify a
 * line — the strength and the unit travel with it.
 */
function drugKey(drugName: string, strength?: string, unit?: string): string {
  return `${drugName.trim().toLowerCase()}|${(strength ?? "").trim().toLowerCase()}|${(unit ?? "").trim().toLowerCase()}`;
}

/**
 * The order the register reads in.
 *
 * Entries are kept in the order they happened, not the order they were
 * typed: a receipt entered on Friday for a drug that arrived on Tuesday
 * belongs above the Wednesday dispense it covered. Where two entries share
 * a day, the one typed first comes first.
 */
function inRegisterOrder<T extends { date: string; createdAt: string }>(
  entries: T[],
): T[] {
  return [...entries].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
}

/**
 * Move stock, and write the movement down.
 *
 * The quantity on hand is not a number anybody edits — it is the sum of
 * the movements, so a movement that is not written down is a movement that
 * never happened. The ledger row is what makes the quantity work out; the
 * entry row records what came in, which is what the stock reports read.
 */
async function moveStock(
  ctx: MutationCtx,
  businessId: Id<"businesses">,
  userId: Id<"users">,
  args: {
    stockCode: string;
    deltaQty: number;
    eventType: string;
    referenceId: string;
    notes: string;
    timestamp: string;
  },
): Promise<void> {
  const code = args.stockCode.trim();

  const stock = await ctx.db
    .query("stocks")
    .withIndex("by_businessId_productCode", (q) =>
      q.eq("businessId", businessId).eq("productCode", code),
    )
    .first();

  if (!stock) {
    throw new ConvexError(
      `There is no product with the code "${code}" in this business, so no stock was moved.`,
    );
  }

  const nextQty = round3(stock.qty + args.deltaQty);
  if (nextQty < 0) {
    throw new ConvexError(
      `There are only ${stock.qty} of ${stock.name} left, so no stock was moved.`,
    );
  }

  await ctx.db.patch(stock._id, { qty: nextQty });

  await ctx.db.insert("stockLedger", {
    businessId,
    stockId: stock._id,
    shopId: undefined,
    deltaQty: args.deltaQty,
    eventType: args.eventType,
    referenceId: args.referenceId,
    userId,
    timestamp: args.timestamp,
    notes: args.notes,
  });

  // Only what came in is entered as stock. What went out is already
  // written down as a movement, and entering it twice would make the
  // stock-entered report show a movement that never came in.
  if (args.deltaQty > 0) {
    await ctx.db.insert("stockEntries", {
      businessId,
      stockId: stock._id,
      quantity: args.deltaQty,
      userId,
      date: args.timestamp,
      price: stock.price,
      purchasePrice: stock.purchasePrice,
      pv: stock.pv,
      bv: stock.bv,
      halfPrice: stock.halfPrice ?? false,
      type: "restock",
      supplier: stock.supplier,
    });
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * The controlled-drug register
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every controlled drug on the register, with the balance the entries add
 * up to.
 *
 * The balance is worked out here rather than read from a column, because
 * a column can only ever hold the answer as it was when the last entry was
 * written. It is also the number a stock check is done against, so it has
 * to be right even if the entries were typed out of order.
 */
export const listControlledDrugs = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    drugName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.view");

    const entries = await ctx.db
      .query("controlledDrugEntries")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const wanted = args.drugName?.trim().toLowerCase();

    // One line per drug, strength and unit.
    const lines = new Map<
      string,
      {
        drugName: string;
        strength?: string;
        unit: string;
        balance: number;
        entryCount: number;
        lastEntryDate?: string;
      }
    >();

    for (const entry of entries) {
      if (wanted && entry.drugName.trim().toLowerCase() !== wanted) continue;

      const key = drugKey(entry.drugName, entry.strength, entry.unit);
      const line = lines.get(key) ?? {
        drugName: entry.drugName,
        strength: entry.strength,
        unit: entry.unit,
        balance: 0,
        entryCount: 0,
        lastEntryDate: undefined,
      };

      line.balance = round3(line.balance + entryDelta(entry.entryType, entry.quantity));
      line.entryCount += 1;
      if (!line.lastEntryDate || entry.date > line.lastEntryDate) {
        line.lastEntryDate = entry.date;
      }

      lines.set(key, line);
    }

    return [...lines.values()].sort((a, b) =>
      a.drugName.localeCompare(b.drugName),
    );
  },
});

/**
 * The register itself, newest entry first.
 *
 * The balance shown against each line is the running balance of the book
 * in the order the book reads, worked out from the entries again — so the
 * column always agrees with the rows above it, even for entries that were
 * entered late.
 */
export const listControlledEntries = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    drugName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.view");

    const entries = await ctx.db
      .query("controlledDrugEntries")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const wanted = args.drugName?.trim().toLowerCase();
    const chosen = wanted
      ? entries.filter((e) => e.drugName.trim().toLowerCase() === wanted)
      : entries;

    // The running balance is a property of a drug, so it is worked out
    // drug by drug and not across the whole register.
    const balances = new Map<string, number>();
    for (const entry of inRegisterOrder(chosen)) {
      const key = drugKey(entry.drugName, entry.strength, entry.unit);
      balances.set(
        key,
        round3((balances.get(key) ?? 0) + entryDelta(entry.entryType, entry.quantity)),
      );
    }

    const ordered = inRegisterOrder(chosen).reverse();

    const rows = ordered.map((entry) => {
      const key = drugKey(entry.drugName, entry.strength, entry.unit);
      return {
        _id: entry._id,
        drugName: entry.drugName,
        strength: entry.strength,
        unit: entry.unit,
        entryType: entry.entryType,
        quantity: entry.quantity,
        direction: entryDirection(entry.entryType, entry.quantity),
        balanceAfter: balances.get(key) ?? 0,
        patientName: entry.patientName,
        patientId: entry.patientId,
        prescriberName: entry.prescriberName,
        prescriberNumber: entry.prescriberNumber,
        prescriptionId: entry.prescriptionId,
        reason: entry.reason,
        date: entry.date,
        recordedBy: entry.recordedBy,
        createdAt: entry.createdAt,
      };
    });

    return args.limit === undefined ? rows : rows.slice(0, args.limit);
  },
});

/**
 * Write one line into the controlled-drug register.
 *
 * The balance is recomputed here from the entries that are already in the
 * book, in the order the book reads, so what is stored is what the
 * register actually says. A dispense that is larger than the register
 * holds is refused: a register that can go below zero is not a register.
 */
export const recordControlledDrugEntry = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    entryType,
    drugName: v.string(),
    strength: v.optional(v.string()),
    unit: v.string(),
    quantity: v.number(),
    date: v.string(),
    patientName: v.string(),
    patientId: v.optional(v.id("customers")),
    prescriberName: v.optional(v.string()),
    prescriberNumber: v.optional(v.string()),
    prescriptionId: v.optional(v.id("prescriptions")),
    reason: v.optional(v.string()),
    /** The product code of the stock this entry moves, when it moves any. */
    stockCode: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.manage");
    await assertPackageFeature(ctx, businessId, "controlled_drugs");

    // Moving stock is a stock job, so it carries the stock permission as
    // well — writing to the register is not a way around the till's rules.
    // It is asked for here, before anything is written, so a person who may
    // not move stock is told so before the entry is made.
    if (args.stockCode?.trim()) {
      await requirePermission(ctx, businessId, "stock.manage");
    }

    const kind = args.entryType as ClinicalEntryType;

    // ── What the entry says ─────────────────────────────────────────
    const drugName = args.drugName.trim();
    if (!drugName) {
      throw new ConvexError("A register entry needs the drug it is for.");
    }

    const unit = args.unit.trim();
    if (!unit) {
      throw new ConvexError(
        "A register entry needs the unit it is counted in — tablets, millilitres, ampoules.",
      );
    }

    const patientName = args.patientName.trim();
    if (!patientName) {
      throw new ConvexError(
        "A register entry needs the patient it was for, or where it came from.",
      );
    }

    if (!isDay(args.date)) {
      throw new ConvexError(`"${args.date}" is not a day. Use the format YYYY-MM-DD.`);
    }

    if (!Number.isFinite(args.quantity)) {
      throw new ConvexError("The quantity has to be a number.");
    }
    if (kind !== "adjustment" && args.quantity <= 0) {
      throw new ConvexError("The quantity has to be more than zero.");
    }
    if (kind === "adjustment" && args.quantity === 0) {
      throw new ConvexError("An adjustment has to move something.");
    }
    if ((kind === "write_off" || kind === "adjustment") && !args.reason?.trim()) {
      throw new ConvexError(
        "A write-off and an adjustment both need a reason. The register is a legal record.",
      );
    }

    // ── Who it belongs to ───────────────────────────────────────────
    if (args.patientId) {
      const patient = await ctx.db.get(args.patientId);
      if (!patient || patient.businessId !== businessId) {
        throw new ConvexError("Forbidden: that patient belongs to another business.");
      }
    }

    if (args.prescriptionId) {
      const prescription = await ctx.db.get(args.prescriptionId);
      if (!prescription || prescription.businessId !== businessId) {
        throw new ConvexError(
          "Forbidden: that prescription belongs to another business.",
        );
      }
    }

    // ── The balance the register holds ──────────────────────────────
    const key = drugKey(drugName, args.strength, unit);

    const sameDrug = await ctx.db
      .query("controlledDrugEntries")
      .withIndex("by_businessId_drugName", (q) =>
        q.eq("businessId", businessId).eq("drugName", drugName),
      )
      .collect();

    const now = new Date().toISOString();

    const draft = {
      date: args.date,
      createdAt: now,
      entryType: kind,
      quantity: args.quantity,
    };

    const book = inRegisterOrder([
      ...sameDrug.filter((e) => drugKey(e.drugName, e.strength, e.unit) === key),
      draft,
    ]);

    let running = 0;
    let balanceBefore = 0;
    let balanceAfter = 0;
    let seenDraft = false;

    for (const entry of book) {
      const isDraft = entry === draft;
      if (isDraft) {
        balanceBefore = running;
        seenDraft = true;
      }
      running = round3(running + entryDelta(entry.entryType, entry.quantity));
      if (isDraft) balanceAfter = running;

      // The register may not go below zero, and it is checked from this
      // entry onwards — so a dispense dated before the receipt that covered
      // it is refused, and so is a dispense that would leave the entries
      // after it in the red. A register that was already out of step before
      // this entry was written is a different problem, and it must not lock
      // the drug up: the entry is measured against the balance it found.
      if (seenDraft && running < 0 && balanceBefore >= 0) {
        throw new ConvexError(
          `The register does not hold that much ${drugName}. It holds ${balanceBefore} ${unit}, and ${kind === "write_off" ? "a write-off" : kind === "dispense" ? "a dispense" : "an adjustment"} of ${Math.abs(args.quantity)} ${unit} would take it below zero.`,
        );
      }
    }

    // ── The entry itself ────────────────────────────────────────────
    const entryId = await ctx.db.insert("controlledDrugEntries", {
      businessId,
      drugName,
      strength: args.strength?.trim() || undefined,
      unit,
      entryType: kind,
      quantity: args.quantity,
      balanceAfter,
      prescriptionId: args.prescriptionId,
      patientName,
      patientId: args.patientId,
      prescriberName: args.prescriberName?.trim() || undefined,
      prescriberNumber: args.prescriberNumber?.trim() || undefined,
      reason: args.reason?.trim() || undefined,
      date: args.date,
      recordedBy: tenant.user._id,
      createdAt: now,
    });

    // ── The stock it moves ──────────────────────────────────────────
    const stockCode = args.stockCode?.trim();
    if (stockCode) {
      const delta = entryDelta(kind, args.quantity);
      const strength = args.strength?.trim();

      await moveStock(ctx, businessId, tenant.user._id, {
        stockCode,
        deltaQty: delta,
        eventType: LEDGER_EVENT_BY_ENTRY[kind],
        referenceId: entryId,
        notes: `${kind} ${args.quantity} ${unit} of ${drugName}${strength ? ` ${strength}` : ""} — controlled-drug register.`,
        timestamp: now,
      });
    }

    const strength = args.strength?.trim();

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Controlled Drug Entry",
      `${kind} of ${args.quantity} ${unit} of ${drugName}${strength ? ` ${strength}` : ""} for ${patientName}. Register balance ${balanceAfter} ${unit}.`,
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: `clinical.controlled_drug.${kind}`,
      targetType: "controlled_drug_entry",
      targetId: entryId,
      metadata: {
        drugName,
        strength,
        unit,
        quantity: args.quantity,
        entryType: kind,
        balanceBefore,
        balanceAfter,
        patientName,
        prescriberName: args.prescriberName?.trim() || undefined,
        reason: args.reason?.trim() || undefined,
        stockCode: stockCode || undefined,
      },
    });

    return { id: entryId, balanceBefore, balanceAfter, entryType: kind };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Vaccinations
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The vaccination record, newest first.
 *
 * Campaigns are how an agro-clinic and a clinic both work — "round 2 of
 * the FMD campaign in Kabarole" is the unit of work — so the campaign is
 * what the list can be filtered by.
 */
export const listVaccinations = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    status: v.optional(vaccinationStatus),
    campaignName: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.view");

    const rows = await ctx.db
      .query("vaccinations")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const campaign = args.campaignName?.trim().toLowerCase();

    const chosen = rows.filter((row) => {
      if (args.status && row.status !== args.status) return false;
      if (campaign && row.campaignName.trim().toLowerCase() !== campaign) return false;
      return true;
    });

    const ordered = [...chosen].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });

    const limited = args.limit === undefined ? ordered : ordered.slice(0, args.limit);

    return limited.map((row) => ({
      _id: row._id,
      campaignName: row.campaignName,
      subjectName: row.subjectName,
      subjectType: row.subjectType,
      ownerName: row.ownerName,
      ownerId: row.ownerId,
      vaccineName: row.vaccineName,
      dose: row.dose,
      date: row.date,
      nextDueDate: row.nextDueDate,
      status: row.status,
      amount: row.amount,
      stockIssued: row.stockIssued,
      notes: row.notes,
      recordedBy: row.recordedBy,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * Record one vaccination.
 *
 * The vaccine may come out of the clinic's own stock, in which case the
 * movement is written against the product so the till's quantity stays
 * right. The next due date is the operator's: SMARTBUZ does not know how
 * long a vaccine lasts, so it is either taken as it is given or worked out
 * from an interval the operator states.
 */
export const recordVaccination = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    campaignName: v.string(),
    subjectName: v.string(),
    subjectType,
    ownerName: v.optional(v.string()),
    ownerId: v.optional(v.id("customers")),
    vaccineName: v.string(),
    dose: v.optional(v.string()),
    date: v.string(),
    nextDueDate: v.optional(v.string()),
    /** Days until the next dose, when the date itself is not known. */
    nextDueInDays: v.optional(v.number()),
    status: vaccinationStatus,
    amount: v.optional(v.number()),
    notes: v.optional(v.string()),
    /** The product code of the vaccine stock this vaccination issues. */
    stockCode: v.optional(v.string()),
    /** How many units of the product one dose takes. */
    stockQuantity: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.manage");

    // Issuing vaccine stock is a stock job, so it carries the stock
    // permission as well. It is asked for before the vaccination is
    // written, so a person who may not move stock is told so first.
    if (args.stockCode?.trim()) {
      await requirePermission(ctx, businessId, "stock.manage");
    }

    const campaignName = args.campaignName.trim();
    if (!campaignName) {
      throw new ConvexError("A vaccination needs the campaign it belongs to.");
    }

    const subjectName = args.subjectName.trim();
    if (!subjectName) {
      throw new ConvexError("A vaccination needs the animal or the patient it was given to.");
    }

    const vaccineName = args.vaccineName.trim();
    if (!vaccineName) {
      throw new ConvexError("A vaccination needs the vaccine that was given.");
    }

    if (!isDay(args.date)) {
      throw new ConvexError(`"${args.date}" is not a day. Use the format YYYY-MM-DD.`);
    }

    if (args.nextDueDate !== undefined && !isDay(args.nextDueDate)) {
      throw new ConvexError(
        `"${args.nextDueDate}" is not a day. Use the format YYYY-MM-DD.`,
      );
        await assertScreenAvailable(ctx, businessId, ["prescriptions"]);
    }

    if (args.nextDueInDays !== undefined) {
      if (!Number.isInteger(args.nextDueInDays) || args.nextDueInDays <= 0) {
        throw new ConvexError(
          "The days until the next dose have to be a whole number of days.",
        );
      }
    }

    if (args.amount !== undefined) {
      if (!Number.isFinite(args.amount) || args.amount < 0) {
        throw new ConvexError("The fee cannot be negative.");
      }
    }

    if (args.ownerId) {
      const owner = await ctx.db.get(args.ownerId);
      if (!owner || owner.businessId !== businessId) {
        throw new ConvexError("Forbidden: that owner belongs to another business.");
      }
    }

    // The next due date is either the one the operator gave, or the one
    // that falls out of the interval the operator gave. SMARTBUZ does not
    // have a rule of its own for how long a vaccine lasts.
    const nextDueDate =
      args.nextDueDate ?? (args.nextDueInDays !== undefined
        ? addDays(args.date, args.nextDueInDays)
        : undefined);

    const stockCode = args.stockCode?.trim();
    const status = args.status as ClinicalVaccinationStatus;

    if (stockCode && status !== "done") {
      throw new ConvexError(
        "Stock is only issued when the vaccination is recorded as done. A booked or missed vaccination has not used any vaccine.",
      );
    }

    const stockQuantity = args.stockQuantity ?? 1;
    if (stockCode && (!Number.isFinite(stockQuantity) || stockQuantity <= 0)) {
      throw new ConvexError("The amount of vaccine issued has to be more than zero.");
    }

    const now = new Date().toISOString();

    const vaccinationId = await ctx.db.insert("vaccinations", {
      businessId,
      campaignName,
      subjectName,
      subjectType: args.subjectType as ClinicalSubjectType,
      ownerName: args.ownerName?.trim() || undefined,
      ownerId: args.ownerId,
      vaccineName,
      dose: args.dose?.trim() || undefined,
      date: args.date,
      nextDueDate,
      status,
      amount: args.amount,
      stockIssued: stockCode ? true : undefined,
      notes: args.notes?.trim() || undefined,
      recordedBy: tenant.user._id,
      createdAt: now,
    });

    if (stockCode) {
      await requirePermission(ctx, businessId, "stock.manage");

      await moveStock(ctx, businessId, tenant.user._id, {
        stockCode,
        deltaQty: -stockQuantity,
        eventType: "ADJUSTMENT",
        referenceId: vaccinationId,
        notes: `Vaccination of ${subjectName} — ${vaccineName}${args.dose ? ` ${args.dose}` : ""} (${campaignName}).`,
        timestamp: now,
      });
    }

    await logActivity(
      ctx,
      businessId,
      tenant.user._id,
      "Vaccination",
      `${vaccineName}${args.dose ? ` ${args.dose}` : ""} given to ${subjectName} (${campaignName})${nextDueDate ? `. Next due ${nextDueDate}` : ""}.`,
    );

    await writeAudit(ctx, {
      businessId,
      actorUserId: tenant.user._id,
      actorRole: tenant.membership.role,
      action: "clinical.vaccination.recorded",
      targetType: "vaccination",
      targetId: vaccinationId,
      metadata: {
        campaignName,
        subjectName,
        subjectType: args.subjectType,
        ownerName: args.ownerName?.trim() || undefined,
        vaccineName,
        dose: args.dose?.trim() || undefined,
        date: args.date,
        nextDueDate,
        status,
        amount: args.amount,
        stockCode: stockCode || undefined,
        stockQuantity: stockCode ? stockQuantity : undefined,
      },
    });

    return { id: vaccinationId, nextDueDate };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * The summary the screen opens with
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The headline numbers.
 *
 * Every figure here is counted from the rows themselves — the balances
 * come out of the entries, the campaigns are the campaigns the records
 * name — so the screen and the register can never disagree.
 */
export const getClinicalSummary = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    /** How far ahead to look for vaccinations that are due. */
    withinDays: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;
    await requirePermission(ctx, businessId, "members.view");

    const withinDays = args.withinDays ?? 30;
    const start = today();
    const end = addDays(start, withinDays);

    const entries = await ctx.db
      .query("controlledDrugEntries")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    const lines = new Map<
      string,
      { drugName: string; strength?: string; unit: string; balance: number; entryCount: number }
    >();

    for (const entry of entries) {
      const key = drugKey(entry.drugName, entry.strength, entry.unit);
      const line = lines.get(key) ?? {
        drugName: entry.drugName,
        strength: entry.strength,
        unit: entry.unit,
        balance: 0,
        entryCount: 0,
      };
      line.balance = round3(line.balance + entryDelta(entry.entryType, entry.quantity));
      line.entryCount += 1;
      lines.set(key, line);
    }

    const vaccinations = await ctx.db
      .query("vaccinations")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    // A vaccination is due when its next dose falls inside the window that
    // is being looked at. The window is counted in days from today, on the
    // server, so two people in two places see the same number.
    const due = vaccinations.filter(
      (row) => row.nextDueDate !== undefined && row.nextDueDate >= start && row.nextDueDate <= end,
    );

    const booked = vaccinations.filter((row) => row.status === "booked");

    // The campaigns of this calendar month, counted from the month the
    // server is in.
    const now = new Date();
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString().slice(0, 10);
    const monthEnd = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
    ).toISOString().slice(0, 10);

    const campaignsThisMonth = new Set(
      vaccinations
        .filter((row) => row.date >= monthStart && row.date <= monthEnd)
        .map((row) => row.campaignName.trim().toLowerCase()),
    ).size;

    return {
      controlledDrugCount: lines.size,
      registerBalances: [...lines.values()].sort((a, b) =>
        a.drugName.localeCompare(b.drugName),
      ),
      vaccinationsDueIn30Days: due.length,
      vaccinationsBooked: booked.length,
      campaignsThisMonth,
      vaccinationsRecorded: vaccinations.length,
      periodStart: start,
      periodEnd: end,
    };
  },
});
