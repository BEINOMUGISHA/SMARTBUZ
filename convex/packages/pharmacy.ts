/**
 * SMARTBUZ — the pharmacy package.
 *
 * Batches, expiry dates and prescriptions.
 *
 * ────────────────────────────────────────────────────────────────────────
 * First expiry, first out
 * ────────────────────────────────────────────────────────────────────────
 *
 * When a medicine is dispensed, it comes out of the batch that expires
 * **first** — not the oldest batch, and not the batch with the most in
 * it. The batch that expires soonest is the one that will be wasted if
 * it is not used, so it goes first.
 *
 * Expired batches are skipped entirely.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule that matters
 * ────────────────────────────────────────────────────────────────────────
 *
 * **A prescription is never silently short.**
 *
 * If there is not enough stock to fill the prescription, what there is
 * gets dispensed, the shortfall is recorded, and the prescription is
 * marked `partially_dispensed`. It is never marked `dispensed` when it
 * was not, and the patient is never told they have the whole thing when
 * they do not.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this package does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It does not check interactions between medicines, and it does not
 * validate doses — SMARTBUZ does not know what one medicine does to
 * another. The controlled-drug flag records that a prescription needs a
 * controlled record kept alongside it; it does not keep a separate
 * register.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * Batch allocation
 * ──────────────────────────────────────────────────────────────────────── */

/** One batch a medicine could come out of. */
export interface AllocatableBatch {
    _id: Id<"productBatches">;
    batchNumber?: string;
    expiryDate?: string;
    qtyRemaining?: number;
}

/**
 * What one batch gives up.
 */
export interface BatchAllocation {
    batchId: Id<"productBatches">;
    batchNumber?: string;
    expiryDate?: string;
    quantity: number;
}

/**
 * Work out which batches a quantity comes out of.
 *
 * The batches are used in expiry order — soonest first — and expired
 * ones are skipped. When `blockExpired` is on, an expired batch is never
 * used; when it is off, an expired batch is still passed over, because
 * dispensing expired medicine is not something this package will do
 * quietly. The flag exists so that a pharmacy which *does* return
 * expired stock for disposal can record the movement.
 *
 * The result says exactly what could not be filled, so the caller can
 * tell the patient.
 */
export function allocateBatches(
    batches: AllocatableBatch[],
    quantityNeeded: number,
    options: { includeExpired?: boolean } = {}
): { allocations: BatchAllocation[]; shortfall: number } {
    const needed = Number(quantityNeeded);
    if (!Number.isFinite(needed) || needed <= 0) {
        return { allocations: [], shortfall: 0 };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTime = today.getTime();

    // Soonest expiry first. A batch with no expiry date goes last, since
    // it cannot be expiring any sooner than one that has a date.
    const usable = batches
        .filter((batch) => (batch.qtyRemaining ?? 0) > 0)
        .filter((batch) => {
            if (!batch.expiryDate) return true;
            const expiry = new Date(batch.expiryDate).getTime();
            if (!Number.isFinite(expiry)) return true;
            const expired = expiry < todayTime;
            return expired ? options.includeExpired === true : true;
        })
        .sort((a, b) => {
            const aExpiry = a.expiryDate ? new Date(a.expiryDate).getTime() : Infinity;
            const bExpiry = b.expiryDate ? new Date(b.expiryDate).getTime() : Infinity;
            if (aExpiry !== bExpiry) return aExpiry - bExpiry;
            return a.batchNumber?.localeCompare(b.batchNumber ?? "") ?? 0;
        });

    const allocations: BatchAllocation[] = [];
    let remaining = needed;

    for (const batch of usable) {
        if (remaining <= 0) break;

        const take = Math.min(remaining, batch.qtyRemaining ?? 0);
        if (take <= 0) continue;

        allocations.push({
            batchId: batch._id,
            batchNumber: batch.batchNumber,
            expiryDate: batch.expiryDate,
            quantity: take,
        });

        remaining -= take;
    }

    return {
        allocations,
        shortfall: Math.max(0, Math.round((remaining + Number.EPSILON) * 1000) / 1000),
    };
}

/**
 * How a batch stands: how many days until it expires.
 */
export function expiryStatus(
    expiryDate: string | undefined,
    warningDays = 90
): { status: "no-expiry" | "expired" | "expiring" | "good"; daysToExpiry: number | undefined } {
    if (!expiryDate) return { status: "no-expiry", daysToExpiry: undefined };

    const expiry = new Date(expiryDate).getTime();
    if (!Number.isFinite(expiry)) {
        return { status: "no-expiry", daysToExpiry: undefined };
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const daysToExpiry = Math.ceil((expiry - today.getTime()) / 86_400_000);

    if (daysToExpiry < 0) return { status: "expired", daysToExpiry };
    if (daysToExpiry <= warningDays) return { status: "expiring", daysToExpiry };
    return { status: "good", daysToExpiry };
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The batches that are about to expire, soonest first.
 *
 * Expired stock is included when `includeExpired` is on, because a
 * pharmacy needs to know what is sitting on the shelf past its date.
 */
export const listExpiringBatches = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        withinDays: v.optional(v.number()),
        includeExpired: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "inventory.view");

        const withinDays = args.withinDays ?? 90;

        const batches = await ctx.db
            .query("productBatches")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const stockNames = new Map(stocks.map((s) => [s._id, s.name]));

        const rows = batches
            .map((batch) => {
                const status = expiryStatus(batch.expiryDate, withinDays);
                return {
                    id: batch._id,
                    stockId: batch.stockId,
                    productName: stockNames.get(batch.stockId),
                    batchNumber: batch.batchNumber,
                    expiryDate: batch.expiryDate,
                    qtyRemaining: batch.qtyRemaining,
                    status: status.status,
                    daysToExpiry: status.daysToExpiry,
                };
            })
            .filter((batch) => {
                if (batch.status === "no-expiry") return false;
                if (batch.status === "expired") return args.includeExpired === true;
                if (batch.status === "expiring") return true;
                return false;
            });

        // Soonest expiry first, and the expired stock at the very top —
        // it is the thing that needs attention today.
        rows.sort((a, b) => {
            const aDays = a.daysToExpiry ?? Number.POSITIVE_INFINITY;
            const bDays = b.daysToExpiry ?? Number.POSITIVE_INFINITY;
            return aDays - bDays;
        });

        return rows;
    },
});

/**
 * The prescriptions, newest first.
 */
export const listPrescriptions = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        status: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.view");

        let rows = await ctx.db
            .query("prescriptions")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.status) {
            rows = rows.filter((prescription) => prescription.status === args.status);
        }

        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return rows.map((prescription) => ({
            id: prescription._id,
            patientName: prescription.patientName,
            patientPhone: prescription.patientPhone,
            prescriberName: prescription.prescriberName,
            prescriberNumber: prescription.prescriberNumber,
            items: prescription.items,
            status: prescription.status,
            controlled: prescription.controlled ?? false,
            createdAt: prescription.createdAt,
            dispensedAt: prescription.dispensedAt,
        }));
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Record a prescription.
 */
export const createPrescription = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        customerId: v.optional(v.id("customers")),
        patientName: v.string(),
        patientPhone: v.optional(v.string()),
        prescriberName: v.string(),
        prescriberNumber: v.optional(v.string()),
        prescriberFacility: v.optional(v.string()),
        items: v.array(
            v.object({
                stockId: v.optional(v.id("stocks")),
                name: v.string(),
                dosage: v.optional(v.string()),
                quantity: v.number(),
            })
        ),
        controlled: v.optional(v.boolean()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.create");

        if (!args.patientName.trim()) {
            throw new ConvexError("A prescription needs the patient's name.");
        }

        if (!args.prescriberName.trim()) {
            throw new ConvexError(
                "A prescription needs the name of the person who prescribed it."
            );
        await assertScreenAvailable(ctx, businessId, ["prescriptions"]);
        }

        if (args.items.length === 0) {
            throw new ConvexError("A prescription needs at least one medicine on it.");
        }

        for (const item of args.items) {
            if (!(item.quantity > 0)) {
                throw new ConvexError(
                    `"${item.name}" has a quantity of ${item.quantity}. A prescription cannot ask for nothing.`
                );
            }
        }

        const now = new Date().toISOString();

        return await ctx.db.insert("prescriptions", {
            businessId,
            customerId: args.customerId,
            patientName: args.patientName.trim(),
            patientPhone: args.patientPhone,
            prescriberName: args.prescriberName.trim(),
            prescriberNumber: args.prescriberNumber,
            prescriberFacility: args.prescriberFacility,
            items: args.items.map((item) => ({
                stockId: item.stockId,
                name: item.name,
                dosage: item.dosage,
                quantity: item.quantity,
            })),
            status: "pending",
            controlled: args.controlled ?? false,
            notes: args.notes,
            createdAt: now,
        });
    },
});

/**
 * Dispense a prescription.
 *
 * Each medicine comes out of the batch that expires first. What could
 * not be filled is reported, and the prescription is marked
 * `partially_dispensed` rather than `dispensed`.
 */
export const dispensePrescription = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        prescriptionId: v.id("prescriptions"),
        /** Set when the prescription is being dispensed as part of a sale. */
        saleId: v.optional(v.id("sales")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(ctx, businessId, "sales.create");

        const prescription = await ctx.db.get(args.prescriptionId);
        if (!prescription || prescription.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that prescription belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["prescriptions"]);
        }

        if (prescription.status === "dispensed") {
            throw new ConvexError("This prescription has already been dispensed.");
        }

        if (prescription.status === "cancelled") {
            throw new ConvexError("This prescription was cancelled.");
        }

        const now = new Date().toISOString();
        const dispensedItems: typeof prescription.items = [];
        const shortfalls: { name: string; required: number; dispensed: number }[] = [];

        for (const item of prescription.items) {
            const stockId = item.stockId;
            if (!stockId) {
                shortfalls.push({
                    name: item.name,
                    required: item.quantity,
                    dispensed: 0,
                });
                dispensedItems.push({ ...item });
                continue;
            }

            const batches = await ctx.db
                .query("productBatches")
                .withIndex("by_stockId", (q) => q.eq("stockId", stockId))
                .collect();

            const owned = batches.filter(
                (batch) =>
                    batch.businessId === businessId && (batch.qtyRemaining ?? 0) > 0
            );

            const { allocations, shortfall } = allocateBatches(owned, item.quantity);

            for (const allocation of allocations) {
                const batch = await ctx.db.get(allocation.batchId);
                if (!batch) continue;

                await ctx.db.patch(batch._id, {
                    qtyRemaining: Math.max(
                        0,
                        (batch.qtyRemaining ?? 0) - allocation.quantity
                    ),
                });

                // The movement is written to the stock ledger, so the
                // quantity on hand can always be worked out from the
                // records rather than trusted.
                await ctx.db.insert("stockLedger", {
                    businessId,
                    stockId,
                    deltaQty: -allocation.quantity,
                    eventType: "SALE",
                    referenceId: args.prescriptionId,
                    userId: membership.userId,
                    timestamp: now,
                    notes: `Dispensed against prescription (batch ${allocation.batchNumber ?? "unknown"}).`,
                });
            }

            const dispensed = item.quantity - shortfall;

            dispensedItems.push({
                ...item,
                batchId: allocations[0]?.batchId,
                batchNumber: allocations[0]?.batchNumber,
                expiryDate: allocations[0]?.expiryDate,
            });

            if (shortfall > 0) {
                shortfalls.push({
                    name: item.name,
                    required: item.quantity,
                    dispensed,
                });
            }
        }

        const status = shortfalls.length === 0 ? "dispensed" : "partially_dispensed";

        await ctx.db.patch(prescription._id, {
            items: dispensedItems,
            status,
            saleId: args.saleId,
            dispensedBy: membership.userId,
            dispensedAt: now,
        });

        return {
            status,
            shortfalls,
            dispensedItems,
        };
    },
});

/** The Id type is used in the argument shapes above. */
export type PharmacyPrescriptionId = Id<"prescriptions">;
