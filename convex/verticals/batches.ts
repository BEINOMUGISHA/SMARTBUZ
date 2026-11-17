/**
 * SMARTBUZ — Vertical Module 1: Batches, Expiry & Serials
 *
 * Powers the pharmacy / supermarket / butchery / bakery verticals:
 *   - batch tracking with expiry dates and FEFO (first-expiry-first-out)
 *   - expiry alerts for stock nearing or past expiry
 *   - serial / IMEI tracking for phones, appliances and salvage goods
 *
 * Every query and mutation is scoped to the caller's business, so one
 * tenant can never read another's batch or serial data. The tenant comes
 * from the caller's membership (`requireTenant`), never from a business id
 * the browser supplies.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { logActivity, requirePermission, requireTenant } from "../tenancy";

/* ───────────────────────── helpers ───────────────────────── */

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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        if (args.stockId) {
            const stock = await ctx.db.get(args.stockId);
            if (!stock || stock.businessId !== businessId) {
                throw new ConvexError("Forbidden: that product belongs to another business.");
            }
        }

        let rows = await ctx.db
            .query("productBatches")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.stockId) {
            rows = rows.filter((r) => r.stockId === args.stockId);
        }

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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        date: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        if (args.qtyReceived <= 0) throw new Error("Quantity received must be greater than zero");

        // Increase the parent stock quantity and record the movement.
        const stock = await ctx.db.get(args.stockId);
        if (!stock) throw new Error("Stock not found");
        if (stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        await ctx.db.patch(args.stockId, { qty: stock.qty + args.qtyReceived });

        const date = args.date || new Date().toISOString();
        const batchId = await ctx.db.insert("productBatches", {
            businessId,
            stockId: args.stockId,
            batchNumber: args.batchNumber,
            expiryDate: args.expiryDate,
            qtyReceived: args.qtyReceived,
            qtyRemaining: args.qtyReceived,
            costPrice: args.costPrice ?? stock.purchasePrice,
            supplier: args.supplier ?? stock.supplier,
            userId,
            date,
        });

        await ctx.db.insert("stockLedger", {
            businessId,
            stockId: args.stockId,
            shopId: undefined,
            deltaQty: args.qtyReceived,
            eventType: "RESTOCK",
            referenceId: batchId,
            userId,
            timestamp: date,
            notes: `Batch ${args.batchNumber} received${args.expiryDate ? ` expiring ${args.expiryDate}` : ""}`,
        });

        await ctx.db.insert("stockEntries", {
            businessId,
            stockId: args.stockId,
            quantity: args.qtyReceived,
            userId,
            date,
            price: stock.price,
            purchasePrice: args.costPrice ?? stock.purchasePrice,
            pv: stock.pv,
            bv: stock.bv,
            halfPrice: stock.halfPrice ?? false,
            type: "restock",
            supplier: args.supplier ?? stock.supplier,
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Add Batch",
            `Batch ${args.batchNumber} for ${stock.name}: ${args.qtyReceived} units${args.expiryDate ? `, expiry ${args.expiryDate}` : ""}`
        );

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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        reference: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        const businessId = tenant.businessId;

        const stock = await ctx.db.get(args.stockId);
        if (!stock) throw new Error("Stock not found");
        if (stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        let batches = await ctx.db
            .query("productBatches")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        batches = batches.filter((b) => b.stockId === args.stockId);

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

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Consume Batch",
            `Consumed ${args.quantity} units via batches: ${used.map((u) => `${u.batchNumber}(${u.qty})`).join(", ")}${args.reference ? ` ref ${args.reference}` : ""}`
        );

        return used;
    },
});

/** Expiry summary for the dashboard widget. */
export const getExpirySummary = query({
    args: { withinDays: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        let rows = await ctx.db
            .query("productBatches")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        let rows = await ctx.db
            .query("productSerials")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.stockId) {
            const stock = await ctx.db.get(args.stockId);
            if (!stock || stock.businessId !== businessId) {
                throw new ConvexError("Forbidden: that product belongs to another business.");
            }
            rows = rows.filter((r) => r.stockId === args.stockId);
        }
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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.create");
        const businessId = tenant.businessId;

        const stock = await ctx.db.get(args.stockId);
        if (!stock) throw new Error("Stock not found");
        if (stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        const existing = await ctx.db
            .query("productSerials")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .filter((q) => q.eq(q.field("serialNumber"), args.serialNumber))
            .first();
        if (existing) throw new Error(`Serial ${args.serialNumber} is already registered`);

        const id = await ctx.db.insert("productSerials", {
            businessId,
            stockId: args.stockId,
            serialNumber: args.serialNumber,
            imei: args.imei,
            status: "in_stock",
            condition: args.condition ?? "new",
            warrantyExpiry: args.warrantyExpiry,
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Register Serial",
            `Registered serial ${args.serialNumber}${args.imei ? ` (IMEI ${args.imei})` : ""}`
        );

        return id;
    },
});

/** Mark a serial as sold against a sale. */
export const markSerialSold = mutation({
    args: {
        serialNumber: v.string(),
        saleId: v.optional(v.id("sales")),
        customerId: v.optional(v.id("customers")),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;

        if (args.saleId) {
            const sale = await ctx.db.get(args.saleId);
            if (!sale || sale.businessId !== businessId) {
                throw new ConvexError("Forbidden: that sale belongs to another business.");
            }
        }
        if (args.customerId) {
            const customer = await ctx.db.get(args.customerId);
            if (!customer || customer.businessId !== businessId) {
                throw new ConvexError("Forbidden: that customer belongs to another business.");
            }
        }

        const serial = await ctx.db
            .query("productSerials")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .filter((q) => q.eq(q.field("serialNumber"), args.serialNumber))
            .first();
        if (!serial) throw new Error("Serial not found");
        if (serial.status === "sold") throw new Error("Serial is already marked as sold");

        await ctx.db.patch(serial._id, {
            status: "sold",
            soldToCustomerId: args.customerId,
            soldDate: new Date().toISOString(),
            saleId: args.saleId,
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Serial Sold",
            `Serial ${args.serialNumber} sold`
        );

        return serial._id;
    },
});
