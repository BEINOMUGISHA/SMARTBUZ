/**
 * SMARTBUZ — the barcode a product carries.
 *
 * A barcode is the one thing about a product that a machine reads. That
 * makes its form matter more than most fields: a barcode written one way
 * and read another is a barcode that never matches, and the cashier
 * cannot tell the difference between "this product has no barcode" and
 * "the barcode I typed is not the barcode on the shelf".
 *
 * So a barcode is stored in one form only:
 *
 *   - **upper case** — scanners differ in the case they report, and the
 *     code on the product is not always the case on the shelf label;
 *   - **without spaces or punctuation** — the same scanner may report
 *     "ABC-123" and "abc 123" for the same product;
 *   - **with dashes kept** — a dash is part of many real barcodes and
 *     carries meaning for the person reading it.
 *
 * The stored value is the normalised one, so the lookup is an index read
 * rather than a walk over every product in the business.
 */

import { ConvexError } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

/**
 * Put a barcode in the form it is stored in.
 *
 * Case is folded up and everything that is not a letter, a digit or a
 * dash is taken out.
 */
export function normaliseBarcode(raw: string): string {
    return raw.replace(/[^0-9A-Za-z-]/g, "").toUpperCase();
}

/**
 * Is this worth storing as a barcode?
 *
 * A barcode of one or two characters is not a barcode; it is a typo that
 * would then hide the real product behind it.
 */
export function isUsableBarcode(raw: string | undefined | null): boolean {
    if (!raw) return false;
    const normalised = normaliseBarcode(raw);
    return normalised.length >= 3 && normalised.length <= 64;
}

/**
 * Refuse a barcode that another product in this business already carries.
 *
 * The check is made against the index rather than by walking the
 * products, because a business with ten thousand products should not take
 * longer to save a product than it takes to list them.
 *
 * A barcode belongs to one product. Two products sharing one means the
 * scanner cannot say which one is meant, and the cashier picks one at
 * random — which is how the wrong thing is handed to a customer.
 */
export async function assertBarcodeIsFree(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    barcode: string,
    exceptStockId?: Id<"stocks">
): Promise<void> {
    if (!barcode) return;

    const clash = await ctx.db
        .query("stocks")
        .withIndex("by_businessId_barcode", (q) =>
            q.eq("businessId", businessId).eq("barcode", barcode)
        )
        .first();

    if (!clash) return;
    if (exceptStockId && clash._id === exceptStockId) return;

    throw new ConvexError(
        `The barcode ${barcode} is already on "${clash.name}". A barcode belongs to one product — clear it from that product first, or give this one a different barcode.`
    );
}
