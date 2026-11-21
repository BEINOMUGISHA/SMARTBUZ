import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import type { Ctx } from "./tenancy";

/**
 * SMART_BUZ — what a counter holds.
 *
 * A counter ("shop") does not keep its own copy of the products it holds.
 * It keeps one thing: how much of each product is sitting on its counter.
 *
 * It used to keep more than that. Every issued row carried a copy of the
 * product's name, code, selling price, profit value and book value, frozen
 * at the moment the goods were issued. That copy was a second source of
 * truth, and it drifted:
 *
 *  - A price change in the master catalogue did not reach the counters, so a
 *    counter sold at yesterday's price while the warehouse screen showed
 *    today's. The till and the stock report disagreed with each other.
 *  - The stock report valued the counter's goods at the *issue* price. The
 *    inventory summary valued the same goods at the *current* price. Two
 *    numbers for the same stock, and no way to tell which one was true.
 *  - A product that was renamed or recoded kept the old name on every
 *    counter that had ever been issued it.
 *
 * So the counter row is now exactly `{ stockId, qty }`, and every value a
 * screen shows about those goods — the name, the price, the cost — is read
 * live from the master product. There is one catalogue, and the counter is
 * only a quantity.
 *
 * The old fields are still accepted by the schema so that rows written
 * before this change still validate; they are ignored on read and dropped
 * on the next write. `stripIssuedStockCopies` removes them from the rows
 * that are still carrying them.
 */

/**
 * A counter's row.
 *
 * `name`, `price`, `productCode`, `pv`, `bv` and `halfPrice` are the legacy
 * copies. They are optional because a row written today does not have them.
 */
export const issuedStockValidator = v.object({
    stockId: v.id("stocks"),
    qty: v.number(),
    // --- legacy copies, ignored on read ---
    name: v.optional(v.string()),
    price: v.optional(v.number()),
    productCode: v.optional(v.string()),
    pv: v.optional(v.number()),
    bv: v.optional(v.number()),
    halfPrice: v.optional(v.boolean()),
});

export type IssuedStock = {
    stockId: Id<"stocks">;
    qty: number;
    name?: string;
    price?: number;
    productCode?: string;
    pv?: number;
    bv?: number;
    halfPrice?: boolean;
};

/**
 * A counter's holding, described from the master catalogue.
 *
 * Every field is the product's *current* value. Nothing here was frozen at
 * the moment the goods were issued, so nothing here can go stale.
 */
export type CounterLine = {
    stockId: Id<"stocks">;
    qty: number;
    name: string;
    productCode: string;
    price: number;
    purchasePrice: number;
    pv: number;
    bv: number;
    halfPrice: boolean;
    /** True when the product this row points at no longer exists. */
    missing: boolean;
};

/**
 * The shape a counter's row is written in.
 *
 * Only the product and the quantity. Everything else is the catalogue's
 * business, and the catalogue is the master.
 */
export function counterRow(item: {
    stockId: Id<"stocks">;
    qty: number;
}): { stockId: Id<"stocks">; qty: number } {
    return { stockId: item.stockId, qty: item.qty };
}

/**
 * A counter's rows, without the legacy copies.
 *
 * Used when a counter's whole array is rewritten — issuing, returning,
 * transferring, adjusting — so that the copies disappear the next time the
 * counter is touched.
 */
export function stripIssuedStockCopies(items: IssuedStock[]): { stockId: Id<"stocks">; qty: number }[] {
    return items.map((item) => counterRow(item));
}

/**
 * The counter's holding, described from the master catalogue.
 *
 * The goods are looked up once, in a single batch, so a counter with two
 * hundred lines does not turn into two hundred reads.
 */
export async function hydrateCounterLines(
    ctx: Ctx,
    items: IssuedStock[]
): Promise<CounterLine[]> {
    if (items.length === 0) return [];

    const ids = [...new Set(items.map((item) => item.stockId))];
    const docs = await Promise.all(ids.map((id) => ctx.db.get(id)));
    const master = new Map(
        docs
            .filter((doc): doc is NonNullable<typeof doc> => doc !== null)
            .map((doc) => [doc._id, doc])
    );

    return items.map((item) => {
        const product = master.get(item.stockId);
        if (!product) {
            // The product is gone but the quantity is still on the counter.
            // It is kept — the goods are real — and marked, so a screen can
            // say so rather than quietly showing a total that does not add
            // up.
            return {
                stockId: item.stockId,
                qty: item.qty,
                name: "(product no longer in the catalogue)",
                productCode: "",
                price: 0,
                purchasePrice: 0,
                pv: 0,
                bv: 0,
                halfPrice: false,
                missing: true,
            };
        }
        return {
            stockId: item.stockId,
            qty: item.qty,
            name: product.name,
            productCode: product.productCode,
            price: product.price,
            purchasePrice: product.purchasePrice,
            pv: product.pv,
            bv: product.bv,
            halfPrice: product.halfPrice ?? false,
            missing: false,
        };
    });
}

/**
 * The cost of the goods a counter holds, at the catalogue's cost price.
 *
 * Cost — not the price the goods were issued at — is the basis for every
 * figure that has to mean "what did these goods cost the business". The
 * issue price is not a valuation basis for anything.
 */
export function counterStockValue(lines: CounterLine[]): {
    /** What the goods are worth at today's selling price. */
    retailValue: number;
    /** What the goods cost the business. */
    costValue: number;
    totalItems: number;
    totalPV: number;
    totalBV: number;
} {
    let retailValue = 0;
    let costValue = 0;
    let totalItems = 0;
    let totalPV = 0;
    let totalBV = 0;

    for (const line of lines) {
        retailValue += line.price * line.qty;
        costValue += line.purchasePrice * line.qty;
        totalItems += line.qty;
        totalPV += line.pv * line.qty;
        totalBV += line.bv * line.qty;
    }

    return { retailValue, costValue, totalItems, totalPV, totalBV };
}
