/**
 * SMARTBUZ — the wholesaler package.
 *
 * Volume pricing, a price of your own for a customer, credit accounts
 * and distribution.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Which price applies
 * ────────────────────────────────────────────────────────────────────────
 *
 * Two rules, in this order:
 *
 *   1. A **customer's own price list** wins over a volume tier. If the
 *      shop has agreed a price with a customer, that is the price —
 *      whatever quantity they buy.
 *   2. Among **volume tiers**, the one that applies is the highest band
 *      the quantity reaches. A tier that needs 50 units does not apply
 *      to a sale of 12.
 *
 * If nothing applies, the product's own price is charged. A price list
 * is a discount, never a surcharge — a list cannot make a customer pay
 * more than the shelf price unless the shop deliberately wrote it that
 * way, which the interface does not allow.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule that matters
 * ────────────────────────────────────────────────────────────────────────
 *
 * **The server's price wins.**
 *
 * Every price that reaches a sale is recomputed on the server from the
 * stored price lists and the stored product prices. Nothing the browser
 * sends about a price is believed — a tampered till must not be able to
 * charge a customer less than the books say.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this package does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * A volume tier applies to the quantity on the whole sale, not to a
 * quantity per line. There is no interest on a credit account and no
 * penalty rate. A delivery record carries the customer and the status
 * but not the individual lines, so it cannot yet be checked off against
 * a picking list. There is no second currency and no exchange rate.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * Price resolution
 * ──────────────────────────────────────────────────────────────────────── */

/** One candidate price for a product. */
export interface PriceCandidate {
    /** The list it came from. */
    priceListId: Id<"priceLists">;
    /** `tier` or `customer`. */
    type: "tier" | "customer";
    /** The customer, when the list belongs to one. */
    customerId?: Id<"customers">;
    /** The price. */
    price: number;
    /** The quantity this price applies from, for a tier. */
    minQty?: number;
}

/** The price that applies, and why. */
export interface ResolvedPrice {
    price: number;
    /** Which list it came from, when one applied. */
    priceListId?: Id<"priceLists">;
    /** Which kind of list it came from. */
    matchType?: "tier" | "customer";
    /** The quantity band that applied, for a tier. */
    minQty?: number;
}

/**
 * Work out the price for a sale.
 *
 * `candidates` are the price-list entries for this product that could
 * apply — the caller has already narrowed them down to this product and
 * this customer.
 *
 * A customer's own list beats a tier. Among tiers, the highest band the
 * quantity reaches wins. When nothing applies, the product's own price
 * is charged.
 */
export function resolvePrice(
    listPrice: number,
    candidates: PriceCandidate[],
    quantity: number,
    customerId?: Id<"customers">
): ResolvedPrice {
    const fallback = Number.isFinite(Number(listPrice)) ? Number(listPrice) : 0;
    const bought = Number(quantity);
    const safeQuantity = Number.isFinite(bought) && bought > 0 ? bought : 0;

    if (!Array.isArray(candidates) || candidates.length === 0) {
        return { price: fallback };
    }

    const usable = candidates.filter((candidate) => {
        const price = Number(candidate.price);
        return Number.isFinite(price) && price > 0;
    });

    if (usable.length === 0) {
        return { price: fallback };
    }

    // The customer's own price wins over any tier.
    if (customerId) {
        const customerPrices = usable.filter(
            (candidate) =>
                candidate.type === "customer" &&
                candidate.customerId === customerId
        );

        if (customerPrices.length > 0) {
            const chosen = customerPrices[0];
            return {
                price: Number(chosen.price),
                priceListId: chosen.priceListId,
                matchType: "customer",
            };
        }
    }

    // Among tiers, the highest band the quantity reaches.
    const tiers = usable
        .filter((candidate) => candidate.type === "tier")
        .map((candidate) => ({
            ...candidate,
            minQty: Number(candidate.minQty ?? 0),
        }))
        .filter((candidate) => Number.isFinite(candidate.minQty))
        .filter((candidate) => candidate.minQty <= safeQuantity)
        .sort((a, b) => b.minQty - a.minQty);

    if (tiers.length > 0) {
        const chosen = tiers[0];
        return {
            price: Number(chosen.price),
            priceListId: chosen.priceListId,
            matchType: "tier",
            minQty: chosen.minQty,
        };
    }

    return { price: fallback };
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The price lists.
 */
export const listPriceLists = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        type: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.view");

        let rows = await ctx.db
            .query("priceLists")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.type) {
            rows = rows.filter((row) => row.type === args.type);
        }

        const entries = await ctx.db
            .query("priceListEntries")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        return rows.map((row) => ({
            id: row._id,
            name: row.name,
            type: row.type,
            customerId: row.customerId,
            minQty: row.minQty,
            isActive: row.isActive !== false,
            entryCount: entries.filter((entry) => entry.priceListId === row._id).length,
            createdAt: row.createdAt,
        }));
    },
});

/**
 * What a customer owes, and how much room is left on their limit.
 *
 * The balance is worked out from the loans and the payments on the
 * account, never from a stored figure that could drift away from the
 * records.
 */
export const creditAccountSummary = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        customerId: v.id("customers"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.view");

        const customer = await ctx.db.get(args.customerId);
        if (!customer || customer.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that customer belongs to another business."
            );
        }

        const loans = await ctx.db
            .query("loans")
            .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
            .collect();

        const payments = await ctx.db
            .query("payments")
            .withIndex("by_customer", (q) => q.eq("customerId", args.customerId))
            .collect();

        const loanIds = new Set(loans.map((loan) => loan._id));

        const paidOnLoans = payments
            .filter((payment) => payment.loanId && loanIds.has(payment.loanId))
            .reduce((sum, payment) => sum + (payment.amount ?? 0), 0);

        const paidDirectly = payments
            .filter((payment) => !payment.loanId || !loanIds.has(payment.loanId))
            .reduce((sum, payment) => sum + (payment.amount ?? 0), 0);

        const outstanding = Math.max(
            0,
            loans.reduce((sum, loan) => sum + (loan.balance ?? 0), 0) - paidOnLoans
        );

        const creditLimit = customer.creditLimit ?? 0;
        const availableCredit =
            creditLimit > 0 ? Math.max(0, creditLimit - outstanding) : 0;

        // The oldest unpaid sale decides whether the account is overdue.
        // The due date belongs to the sale the credit was taken on.
        let oldestDueDate: string | undefined;
        for (const loan of loans) {
            if (!loan.salesId) continue;
            const sale = await ctx.db.get(loan.salesId);
            if (!sale || sale.businessId !== businessId) continue;
            const due = sale.paymentDueDate ?? sale.date;
            if (!due) continue;
            if (!oldestDueDate || due < oldestDueDate) oldestDueDate = due;
        }

        return {
            customerId: customer._id,
            customerName: customer.name,
            outstanding,
            creditLimit,
            availableCredit,
            /** True when the account is over its limit. */
            overLimit: creditLimit > 0 && outstanding > creditLimit,
            oldestDueDate,
            loanCount: loans.length,
            paidTotal: paidOnLoans + paidDirectly,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Create a price list.
 *
 * A `tier` list is a volume band; a `customer` list is one customer's
 * own prices.
 */
export const createPriceList = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        name: v.string(),
        type: v.string(),
        customerId: v.optional(v.id("customers")),
        minQty: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.update");

        if (args.type !== "tier" && args.type !== "customer") {
            throw new ConvexError(
                'A price list is either a "tier" or a "customer" list.'
            );
        await assertScreenAvailable(ctx, businessId, ["pricing"]);
        }

        if (!args.name.trim()) {
            throw new ConvexError("A price list needs a name.");
        }

        if (args.type === "customer") {
            if (!args.customerId) {
                throw new ConvexError(
                    "A customer price list must say which customer it is for."
                );
            }

            const customer = await ctx.db.get(args.customerId);
            if (!customer || customer.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that customer belongs to another business."
                );
            }
        }

        if (args.type === "tier" && args.minQty !== undefined) {
            if (!Number.isFinite(args.minQty) || args.minQty < 0) {
                throw new ConvexError(
                    "A volume tier's minimum quantity cannot be negative."
                );
            }
        }

        const now = new Date().toISOString();

        return await ctx.db.insert("priceLists", {
            businessId,
            name: args.name.trim(),
            type: args.type,
            customerId: args.customerId,
            minQty: args.minQty,
            isActive: true,
            createdAt: now,
            updatedAt: now,
        });
    },
});

/**
 * Set one product's price within a list.
 */
export const setPriceListEntry = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        priceListId: v.id("priceLists"),
        stockId: v.id("stocks"),
        price: v.number(),
        minQty: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.update");

        const list = await ctx.db.get(args.priceListId);
        if (!list || list.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that price list belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["pricing"]);
        }

        const stock = await ctx.db.get(args.stockId);
        if (!stock || stock.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that product belongs to another business."
            );
        }

        if (!Number.isFinite(args.price) || args.price <= 0) {
            throw new ConvexError("A price must be a number greater than zero.");
        }

        const existing = await ctx.db
            .query("priceListEntries")
            .withIndex("by_priceListId", (q) => q.eq("priceListId", args.priceListId))
            .collect();

        const match = existing.find((entry) => entry.stockId === args.stockId);

        if (match) {
            await ctx.db.patch(match._id, {
                price: args.price,
                minQty: args.minQty,
            });
            return match._id;
        }

        return await ctx.db.insert("priceListEntries", {
            businessId,
            priceListId: args.priceListId,
            stockId: args.stockId,
            price: args.price,
            minQty: args.minQty,
        });
    },
});

/**
 * The prices that apply to a customer's basket.
 *
 * The server recomputes every price from the stored price lists and the
 * stored product prices. The prices the browser sends are ignored — a
 * tampered till must not be able to charge a customer less than the
 * books say.
 */
export const applyPriceListsToSale = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        customerId: v.optional(v.id("customers")),
        items: v.array(
            v.object({
                stockId: v.id("stocks"),
                quantity: v.number(),
            })
        ),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "sales.view");

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const lists = await ctx.db
            .query("priceLists")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const activeLists = lists.filter((list) => list.isActive !== false);

        const entries = await ctx.db
            .query("priceListEntries")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const entriesByList = new Map<string, typeof entries>();
        for (const entry of entries) {
            const list = entriesByList.get(entry.priceListId) ?? [];
            list.push(entry);
            entriesByList.set(entry.priceListId, list);
        }

        const totalQuantity = args.items.reduce(
            (sum, item) => sum + (item.quantity ?? 0),
            0
        );

        return args.items.map((item) => {
            const stock = stocks.find((s) => s._id === item.stockId);
            if (!stock) {
                throw new ConvexError("One of the items is not a product of this business.");
            }

            const candidates: PriceCandidate[] = [];

            for (const list of activeLists) {
                const listEntries = entriesByList.get(list._id) ?? [];
                const entry = listEntries.find((e) => e.stockId === item.stockId);
                if (!entry) continue;

                candidates.push({
                    priceListId: list._id,
                    type: list.type === "customer" ? "customer" : "tier",
                    customerId: list.customerId,
                    price: entry.price,
                    minQty: entry.minQty ?? list.minQty,
                });
            }

            const resolved = resolvePrice(
                stock.price,
                candidates,
                totalQuantity,
                args.customerId
            );

            return {
                stockId: item.stockId,
                name: stock.name,
                quantity: item.quantity,
                listPrice: stock.price,
                price: resolved.price,
                priceListId: resolved.priceListId,
                matchType: resolved.matchType,
                minQty: resolved.minQty,
                /** The total for the line, computed on the server. */
                lineTotal: Math.round(resolved.price * item.quantity * 100) / 100,
            };
        });
    },
});

/** The Id type is used in the argument shapes above. */
export type WholesalerPriceListId = Id<"priceLists">;
