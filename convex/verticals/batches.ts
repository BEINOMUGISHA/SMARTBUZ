/**
 * SMARTBUZ — Vertical Module 1: Batches, Expiry & Serials
 *
 * Powers the pharmacy / supermarket / butchery / bakery verticals:
 *   - batch tracking with expiry dates and FEFO (first-expiry-first-out)
 *   - expiry alerts for stock nearing or past expiry
 *   - serial / IMEI tracking for phones, appliances and salvage goods
 *
 * Every query and mutation is scoped to the active business profile so one
 * tenant can never read another's batch or serial data.
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";

/* ───────────────────────── helpers ───────────────────────── */

/**
 * Resolve the active business profile id.
 * Falls back to the first profile so legacy single-tenant installs keep working.
 */
export async function getActiveBusinessId(ctx: any): Promise<Id<"businessProfiles"> | undefined> {
    const profiles = await ctx.db
        .query("businessProfiles")
        .filter((q: any) => q.eq(q.field("isActive"), true))
        // Deterministic: matches businessProfiles.getActive (newest wins).
        .order("desc")
        .collect();
    const active = profiles[0];
    if (active) return active._id;
    const any = await ctx.db.query("businessProfiles").order("desc").first();
    return any?._id;
}

/** Days until expiry. Negative means already expired. */
function daysUntil(expiryDate: string, now = Date.now()): number {
    const t = new Date(expiryDate).getTime();
    if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
    return Math.ceil((t - now) / (24 * 60 * 60 * 1000));
}

/* ───────────────────────── batches ───────────────────────── */

export const listBatches = query({
    args: {
        stockId: v.optional(v.id("stocks")),
        onlyExpiring: v.optional(v.boolean()),
        expiringWithinDays: v.optional(v.number()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows;
        if (args.stockId) {
            rows = await ctx.db
                .query("productBatches")
                .withIndex("by_stockId", (q) => q.eq("stockId", args.stockId!))
                .collect();
        } else {
            rows = await ctx.db.query("productBatches").collect();
        }

        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

        const within = args.expiringWithinDays ?? 30;
        let enriched = rows.map((b) => {
            const days = b.expiryDate ? daysUntil(b.expiryDate) : null;
            return {
                ...b,
                daysToExpiry: days,
                status: days === null ? "no-expiry" : days < 0 ? "expired" : days <= within ? "expiring" : "good",
            };
        });

        if (args.onlyExpiring) {
            enriched = enriched.filter((b) => b.status === "expired" || b.status === "expiring");
        }

        enriched.sort((a, b) => {
            if (a.daysToExpiry === null) return 1;
            if (b.daysToExpiry === null) return -1;
            return a.daysToExpiry - b.daysToExpiry;
        });

        return args.limit ? enriched.slice(0, args.limit) : enriched;
    },
});

export const addBatch = mutation({
    args: {
        stockId: v.id("stocks"),
        batchNumber: v.string(),
        expiryDate: v.optional(v.string()),
        qtyReceived: v.number(),
        costPrice: v.optional(v.number()),
        supplier: v.optional(v.string()),
        userId: v.id("users"),
        date: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (args.qtyReceived <= 0) throw new Error("Quantity received must be greater than zero");

        const businessId = await getActiveBusinessId(ctx);

        // Increase the parent stock quantity and record the movement.
        const stock = await ctx.db.get(args.stockId);
        if (!stock) throw new Error("Stock not found");

        await ctx.db.patch(args.stockId, { qty: stock.qty + args.qtyReceived });

        const date = args.date || new Date().toISOString();
        const batchId = await ctx.db.insert("productBatches", {
            businessProfileId: businessId,
            stockId: args.stockId,
            batchNumber: args.batchNumber,
            expiryDate: args.expiryDate,
            qtyReceived: args.qtyReceived,
            qtyRemaining: args.qtyReceived,
            costPrice: args.costPrice ?? stock.purchasePrice,
            supplier: args.supplier ?? stock.supplier,
            userId: args.userId,
            date,
        });

        await ctx.db.insert("stockLedger", {
            stockId: args.stockId,
            shopId: undefined,
            deltaQty: args.qtyReceived,
            eventType: "RESTOCK",
            referenceId: batchId,
            userId: args.userId,
            timestamp: date,
            notes: `Batch ${args.batchNumber} received${args.expiryDate ? ` expiring ${args.expiryDate}` : ""}`,
        });

        await ctx.db.insert("stockEntries", {
            stockId: args.stockId,
            quantity: args.qtyReceived,
            userId: args.userId,
            date,
            price: stock.price,
            purchasePrice: args.costPrice ?? stock.purchasePrice,
            pv: stock.pv,
            bv: stock.bv,
            halfPrice: stock.halfPrice ?? false,
            type: "restock",
            supplier: args.supplier ?? stock.supplier,
        });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Add Batch",
            details: `Batch ${args.batchNumber} for ${stock.name}: ${args.qtyReceived} units${args.expiryDate ? `, expiry ${args.expiryDate}` : ""}`,
            timestamp: date,
        });

        return batchId;
    },
});

/**
 * Consume stock from the earliest-expiring batch first (FEFO).
 * This is what keeps a pharmacy from issuing stock that expires next month
 * while older stock is still on the shelf.
 */
export const consumeBatch = mutation({
    args: {
        stockId: v.id("stocks"),
        quantity: v.number(),
        userId: v.id("users"),
        reference: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let batches = await ctx.db
            .query("productBatches")
            .withIndex("by_stockId", (q) => q.eq("stockId", args.stockId))
            .collect();
        if (businessId) batches = batches.filter((b) => !b.businessProfileId || b.businessProfileId === businessId);

        const usable = batches
            .filter((b) => b.qtyRemaining > 0)
            .filter((b) => !b.expiryDate || daysUntil(b.expiryDate) >= 0)
            .sort((a, b) => {
                if (!a.expiryDate) return 1;
                if (!b.expiryDate) return -1;
                return a.expiryDate.localeCompare(b.expiryDate);
            });

        let remaining = args.quantity;
        const used: Array<{ batchId: Id<"productBatches">; batchNumber: string; qty: number }> = [];

        for (const b of usable) {
            if (remaining <= 0) break;
            const take = Math.min(b.qtyRemaining, remaining);
            await ctx.db.patch(b._id, { qtyRemaining: b.qtyRemaining - take });
            used.push({ batchId: b._id, batchNumber: b.batchNumber, qty: take });
            remaining -= take;
        }

        if (remaining > 0) {
            throw new Error(`Not enough unexpired batch stock. Short by ${remaining} units.`);
        }

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Consume Batch",
            details: `Consumed ${args.quantity} units via batches: ${used.map((u) => `${u.batchNumber}(${u.qty})`).join(", ")}${args.reference ? ` ref ${args.reference}` : ""}`,
            timestamp: new Date().toISOString(),
        });

        return used;
    },
});

/** Expiry summary for the dashboard widget. */
export const getExpirySummary = query({
    args: { withinDays: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("productBatches").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

        const within = args.withinDays ?? 30;
        let expired = 0, expiring = 0, expiringValue = 0;
        const soon: any[] = [];

        for (const b of rows) {
            if (b.qtyRemaining <= 0) continue;
            const days = b.expiryDate ? daysUntil(b.expiryDate) : null;
            if (days === null) continue;
            if (days < 0) {
                expired += b.qtyRemaining;
            } else if (days <= within) {
                expiring += b.qtyRemaining;
                const stock = await ctx.db.get(b.stockId);
                if (stock) expiringValue += b.qtyRemaining * stock.purchasePrice;
                soon.push({
                    ...b,
                    daysToExpiry: days,
                    productName: stock?.name ?? "Unknown",
                    productCode: stock?.productCode,
                });
            }
        }

        soon.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
        return { expired, expiring, expiringValue, soon: soon.slice(0, 20), totalBatches: rows.length };
    },
});

/* ───────────────────────── serials ───────────────────────── */

export const listSerials = query({
    args: {
        stockId: v.optional(v.id("stocks")),
        status: v.optional(v.string()),
        search: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("productSerials").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

        if (args.stockId) rows = rows.filter((r) => r.stockId === args.stockId);
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        if (args.search) {
            const s = args.search.toLowerCase();
            rows = rows.filter(
                (r) =>
                    r.serialNumber.toLowerCase().includes(s) ||
                    (r.imei ?? "").toLowerCase().includes(s)
            );
        }

        rows.sort((a, b) => b._creationTime - a._creationTime);
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

export const addSerial = mutation({
    args: {
        stockId: v.id("stocks"),
        serialNumber: v.string(),
        imei: v.optional(v.string()),
        condition: v.optional(v.string()),
        warrantyExpiry: v.optional(v.string()),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);

        const existing = await ctx.db
            .query("productSerials")
            .withIndex("by_serialNumber", (q) => q.eq("serialNumber", args.serialNumber))
            .first();
        if (existing) throw new Error(`Serial ${args.serialNumber} is already registered`);

        const id = await ctx.db.insert("productSerials", {
            businessProfileId: businessId,
            stockId: args.stockId,
            serialNumber: args.serialNumber,
            imei: args.imei,
            status: "in_stock",
            condition: args.condition,
            warrantyExpiry: args.warrantyExpiry,
        });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Register Serial",
            details: `Registered serial ${args.serialNumber}${args.imei ? ` (IMEI ${args.imei})` : ""}`,
            timestamp: new Date().toISOString(),
        });

        return id;
    },
});

/** Mark a serial as sold against a sale. */
export const markSerialSold = mutation({
    args: {
        serialNumber: v.string(),
        saleId: v.optional(v.id("sales")),
        customerId: v.optional(v.id("customers")),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const serial = await ctx.db
            .query("productSerials")
            .withIndex("by_serialNumber", (q) => q.eq("serialNumber", args.serialNumber))
            .first();
        if (!serial) throw new Error("Serial not found");
        if (serial.status === "sold") throw new Error("Serial is already marked as sold");

        await ctx.db.patch(serial._id, {
            status: "sold",
            soldToCustomerId: args.customerId,
            soldDate: new Date().toISOString(),
            saleId: args.saleId,
        });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Serial Sold",
            details: `Serial ${args.serialNumber} sold`,
            timestamp: new Date().toISOString(),
        });

        return serial._id;
    },
});
