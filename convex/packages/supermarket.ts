/**
 * SMARTBUZ — the supermarket package.
 *
 * Selling by weight, in packs, and by barcode.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this package does
 * ────────────────────────────────────────────────────────────────────────
 *
 * A supermarket's products are not all the same shape. Some are sold one
 * at a time, some by the pack or the crate, some by the kilo. The till
 * has to know which, and a barcode scanner has to be able to find the
 * product without anyone typing its name.
 *
 * This package gives every product a unit, a pack size and — where the
 * shop uses them — a barcode, and it makes the till able to look a
 * product up by that barcode.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this package does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It does not generate barcodes or print shelf labels. It does not
 * calibrate the scale — a mis-set scale gives the wrong price and
 * nothing here can detect it. It has no coupon codes, no loyalty scheme
 * and no time-of-day pricing; the promotions it uses are the threshold
 * and multi-buy rules that already exist in the catalogue.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { assertBarcodeIsFree, normaliseBarcode } from "../barcode";
import { assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * The weight maths
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The total for a line sold by weight.
 *
 * A weighed product's price is the price of **one unit of weight** — a
 * kilo, say — so the line is that price times the weight.
 *
 * The rule that matters here: this never returns a number that is not a
 * number. A missing weight, a negative weight, a price that is not a
 * number — all of them give zero, because a till that shows `NaN` on the
 * screen is worse than one that shows zero and prompts the operator.
 *
 * The weight is what the operator typed or what the scale reported. This
 * function cannot tell the difference, which is why the package's limits
 * say the scale's own calibration is the shop's responsibility.
 */
export function calculateWeightedTotal(
    unitPrice: number,
    weight: number | undefined | null,
    unit?: string
): number {
    const price = Number(unitPrice);
    if (!Number.isFinite(price) || price <= 0) return 0;

    const amount = Number(weight);
    if (!Number.isFinite(amount) || amount <= 0) return 0;

    const total = price * amount;
    if (!Number.isFinite(total)) return 0;

    void unit;
    return Math.round(total * 100) / 100;
}

/**
 * The price per unit of a product sold in packs.
 *
 * A crate of twenty-four cans priced at 240,000 is 10,000 a can. This
 * turns the pack price into the unit price the till charges.
 */
export function unitPriceFromPack(
    packPrice: number,
    unitsPerPack: number | undefined | null
): number {
    const price = Number(packPrice);
    const units = Number(unitsPerPack);

    if (!Number.isFinite(price) || price <= 0) return 0;
    if (!Number.isFinite(units) || units <= 0) return price;

    const unitPrice = price / units;
    if (!Number.isFinite(unitPrice)) return price;

    return Math.round(unitPrice * 100) / 100;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The products this shop sells in bulk, or by weight.
 *
 * These are the products whose unit, pack size or weight matters at the
 * till.
 */
export const listBulkProducts = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        categoryId: v.optional(v.id("categories")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.view");

        const rows = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const filtered = rows.filter(
            (stock) =>
                stock.unitsPerPack !== undefined ||
                stock.allowFractional === true ||
                stock.weightBased === true ||
                stock.unit !== undefined
        );

        const byCategory = args.categoryId
            ? filtered.filter((stock) => stock.categoryId === args.categoryId)
            : filtered;

        return byCategory.map((stock) => ({
            id: stock._id,
            name: stock.name,
            productCode: stock.productCode,
            barcode: stock.barcode,
            price: stock.price,
            qty: stock.qty,
            unit: stock.unit,
            unitsPerPack: stock.unitsPerPack,
            allowFractional: stock.allowFractional ?? false,
            weightBased: stock.weightBased ?? false,
            unitPrice: unitPriceFromPack(stock.price, stock.unitsPerPack),
        }));
    },
});

/**
 * Find a product by its barcode.
 *
 * The barcode is normalised before the lookup, so `abc-123` and
 * `ABC-123` find the same product — scanners differ in the case they
 * report.
 *
 * The lookup is an index read. It used to be a walk over every product in
 * the business, which meant a scan got slower as the catalogue grew.
 *
 * A barcode that belongs to no product returns `null`. It never returns
 * a near match, because a near match is a wrong item handed to a
 * customer.
 */
export const searchByBarcode = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        barcode: v.string(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.view");

        const barcode = normaliseBarcode(args.barcode);
        if (!barcode) return null;

        const match = await ctx.db
            .query("stocks")
            .withIndex("by_businessId_barcode", (q) =>
                q.eq("businessId", businessId).eq("barcode", barcode)
            )
            .first();

        if (!match) return null;

        return {
            id: match._id,
            name: match.name,
            productCode: match.productCode,
            price: match.price,
            qty: match.qty,
            unit: match.unit,
            unitsPerPack: match.unitsPerPack,
            weightBased: match.weightBased ?? false,
            allowFractional: match.allowFractional ?? false,
        };
    },
});

/**
 * Put a barcode in the form it is stored in.
 *
 * Re-exported from `convex/barcode`, which is where the rule lives, so
 * that every place a barcode is written stores it the same way.
 */
export { normaliseBarcode };

/* ────────────────────────────────────────────────────────────────────────
 * Writing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Record how a product is measured.
 *
 * The unit, the pack size and whether the quantity may be fractional are
 * what the till needs to sell the product properly.
 */
export const setProductUnits = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        stockId: v.id("stocks"),
        unit: v.optional(v.string()),
        unitsPerPack: v.optional(v.number()),
        allowFractional: v.optional(v.boolean()),
        weightBased: v.optional(v.boolean()),
        barcode: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.update");

        const stock = await ctx.db.get(args.stockId);
        if (!stock || stock.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that product belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["pricing"]);
        }

        if (args.unitsPerPack !== undefined) {
            if (!Number.isFinite(args.unitsPerPack) || args.unitsPerPack <= 0) {
                throw new ConvexError(
                    "The pack size must be a number greater than zero."
                );
            }
        }

        const patch: Record<string, unknown> = {};

        if (args.unit !== undefined) patch.unit = args.unit;
        if (args.unitsPerPack !== undefined) patch.unitsPerPack = args.unitsPerPack;
        if (args.allowFractional !== undefined)
            patch.allowFractional = args.allowFractional;
        if (args.weightBased !== undefined) patch.weightBased = args.weightBased;

        if (args.barcode !== undefined) {
            const barcode = normaliseBarcode(args.barcode);
            if (!barcode) {
                throw new ConvexError("A barcode cannot be blank.");
            }

            // One barcode, one product. Two products with the same barcode
            // would make the scanner a guessing game. The check is made
            // against the index, so it does not slow down as the catalogue
            // grows.
            await assertBarcodeIsFree(ctx, businessId, barcode, stock._id);

            patch.barcode = barcode;
        }

        await ctx.db.patch(stock._id, patch);

        return { id: stock._id, ...patch };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Promotions
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The promotions this shop is running, with the products that trigger
 * them.
 *
 * The triggering itself happens in the till's sale path — this list is
 * what the interface shows and what the shop's own rules are.
 */
export const listPromotions = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.view");

        const promotions = await ctx.db
            .query("promotions")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const active = promotions.filter((promotion) => promotion.isActive);

        const links = await ctx.db
            .query("promotionProducts")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        return active.map((promotion) => ({
            id: promotion._id,
            name: promotion.name,
            prize: promotion.prize,
            triggerType: promotion.triggerType,
            threshold: promotion.threshold,
            products: links
                .filter((link) => link.promotionId === promotion._id)
                .map((link) => ({
                    stockId: link.stockId,
                    requiredQuantity: link.requiredQuantity,
                })),
        }));
    },
});

/** The Id type is used in the argument shapes above. */
export type SupermarketStockId = Id<"stocks">;
