/**
 * SMARTBUZ — pricing.
 *
 * Every trade prices differently, and a price is never just a number on a
 * product. A wholesaler drops the price as the quantity grows; a hardware
 * yard buys cement by the bag and sells it by the kilo; a butcher prices
 * the kilogram; a mobile shop gives a customer a price of their own.
 *
 * This module is the one place where those rules live, so that every
 * trade — retail, agro, construction, dairy, hardware, phones — reaches
 * for the same arithmetic and gets the same answer.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What the server owns
 * ────────────────────────────────────────────────────────────────────────
 *
 * A price is **resolved**, never accepted. The browser says *what* is
 * being bought and *how much*; the server says *what it costs*. That
 * matters because the browser is on a shop floor, on a phone, on a shared
 * till, and it is not the thing that should decide the money.
 *
 * Three rules decide the price, in order:
 *
 *   1. the customer's own price, if the customer has one;
 *   2. otherwise the highest volume tier the quantity reaches;
 *   3. otherwise the product's own list price.
 *
 * And the quantity itself may be in the wrong unit: a bag of cement is
 * not a kilogram of cement until somebody says how heavy a bag is. The
 * conversions live here too, so the answer is the same everywhere.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this module does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * There is no time-of-day pricing and no dynamic pricing from demand. The
 * promotion rules in the catalogue are the only thing that changes a
 * price besides the rules above.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertPackageFeature, assertScreenAvailable } from "./manage";
import { resolvePrice, type PriceCandidate } from "./wholesaler";

/* ────────────────────────────────────────────────────────────────────────
 * Units
 * ──────────────────────────────────────────────────────────────────────── */

/** The units a business measures in by weight or volume. */
const WEIGHT_UNITS = new Set(["kg", "g", "gram", "grams", "kilogram", "kilograms"]);
const VOLUME_UNITS = new Set(["litre", "litres", "l", "ml", "millilitre", "millilitres"]);

/**
 * The measure a unit belongs to.
 *
 * A price per kilogram and a price per litre are not the same thing, so
 * a conversion is only ever allowed within a measure. Converting kilograms
 * to litres would need the density of the product, and a number that looks
 * like a conversion but is not one is how a shop ends up selling cement
 * by the litre.
 */
export function measureOf(unit: string): "weight" | "volume" | "count" {
    const key = unit.trim().toLowerCase();
    if (WEIGHT_UNITS.has(key)) return "weight";
    if (VOLUME_UNITS.has(key)) return "volume";
    return "count";
}

/**
 * Every unit conversion this business has set up.
 */
export const listUnitConversions = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const rows = await ctx.db
            .query("unitConversions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        return rows
            .map((row) => ({
                _id: row._id,
                fromUnit: row.fromUnit,
                toUnit: row.toUnit,
                factor: row.factor,
                measure: measureOf(row.fromUnit),
                createdAt: row.createdAt,
            }))
            .sort((a, b) => a.fromUnit.localeCompare(b.fromUnit));
    },
});

/**
 * Record how many of one unit make one of another.
 *
 * A shop that weighs its tea tells SMARTBUZ that a kilogram is a thousand
 * grams; from then on the shop can buy in kilograms and sell in grams
 * without anyone doing the arithmetic at the counter.
 *
 * The two units have to be the same kind of measure. A kilogram cannot
 * become a litre without the product's density, and SMARTBUZ does not
 * hold densities.
 */
export const createUnitConversion = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        fromUnit: v.string(),
        toUnit: v.string(),
        factor: v.number(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.update");
        await assertPackageFeature(ctx, businessId, [
            "unit_conversions",
            "unit_conversion",
        ]);

        const from = args.fromUnit.trim().toLowerCase();
        const to = args.toUnit.trim().toLowerCase();

        if (!from || !to) {
            throw new ConvexError("A conversion needs both a unit to convert from and a unit to convert to.");
        }

        if (from === to) {
            throw new ConvexError("A unit cannot be converted into itself.");
        }

        if (!Number.isFinite(args.factor) || args.factor <= 0) {
            throw new ConvexError(
                "A conversion factor must be a number greater than zero — how many of the second unit one of the first holds."
            );
        await assertScreenAvailable(ctx, businessId, ["pricing"]);
        }

        if (measureOf(from) !== measureOf(to)) {
            throw new ConvexError(
                `A ${from} cannot be converted into ${to}: they are not the same kind of measure. Converting between weight and volume needs the product's density, which SMARTBUZ does not hold.`
            );
        }

        const existing = await ctx.db
            .query("unitConversions")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const clash = existing.find(
            (row) => row.fromUnit.toLowerCase() === from && row.toUnit.toLowerCase() === to
        );

        const now = new Date().toISOString();

        if (clash) {
            await ctx.db.patch(clash._id, { factor: args.factor });
            await logActivity(
                ctx,
                businessId,
                tenant.user._id,
                "Update unit conversion",
                `Changed ${from} → ${to} to ${args.factor}`
            );
            return clash._id;
        }

        const id = await ctx.db.insert("unitConversions", {
            businessId,
            fromUnit: from,
            toUnit: to,
            factor: args.factor,
            createdAt: now,
            createdBy: tenant.user._id,
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Add unit conversion",
            `Added ${from} → ${to} at ${args.factor}`
        );

        return id;
    },
});

/**
 * Remove a conversion.
 */
export const deleteUnitConversion = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        id: v.id("unitConversions"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.update");

        const row = await ctx.db.get(args.id);
        if (!row || row.businessId !== businessId) {
            throw new ConvexError("Forbidden: that conversion belongs to another business.");
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Remove unit conversion",
            `Removed ${row.fromUnit} → ${row.toUnit}`
        );
        await assertScreenAvailable(ctx, businessId, ["pricing"]);

        return args.id;
    },
});

/**
 * Turn a quantity in one unit into the same quantity in another.
 *
 * The conversion is found on the server, so the answer is the same
 * wherever it is asked for. A quantity that is already in the unit asked
 * for comes back unchanged — no conversion, no rounding.
 */
export const convertQuantity = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        quantity: v.number(),
        fromUnit: v.string(),
        toUnit: v.string(),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const from = args.fromUnit.trim().toLowerCase();
        const to = args.toUnit.trim().toLowerCase();

        if (!Number.isFinite(args.quantity)) {
            throw new ConvexError("A quantity must be a number.");
        }

        if (from === to) {
            return { quantity: args.quantity, factor: 1, converted: false };
        }

        const rows = await ctx.db
            .query("unitConversions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const match = rows.find(
            (row) =>
                row.fromUnit.toLowerCase() === from && row.toUnit.toLowerCase() === to
        );

        if (!match) {
            // The opposite direction is worth trying: two bags make a
            // hundred kilos, so a hundred kilos make two bags.
            const reverse = rows.find(
                (row) =>
                    row.fromUnit.toLowerCase() === to && row.toUnit.toLowerCase() === from
            );

            if (!reverse) {
                throw new ConvexError(
                    `There is no conversion from ${from} to ${to}. Set one up before pricing in ${to}.`
                );
            }

            const factor = 1 / reverse.factor;
            return {
                quantity: roundForMoney(args.quantity * factor),
                factor,
                converted: true,
                via: `${reverse.toUnit} → ${reverse.fromUnit}`,
            };
        }

        return {
            quantity: roundForMoney(args.quantity * match.factor),
            factor: match.factor,
            converted: true,
            via: `${match.fromUnit} → ${match.toUnit}`,
        };
    },
});

/**
 * Round to the precision a quantity can honestly carry.
 *
 * A weight of 2.7182818 kilograms is not a weight anybody weighed, and
 * the extra digits cost money when they are multiplied by a price.
 */
function roundForMoney(value: number): number {
    return Math.round(value * 10000) / 10000;
}

/* ────────────────────────────────────────────────────────────────────────
 * The price book
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Every price rule this business has, in one list.
 *
 * The wholesaler package writes volume tiers and customer prices; this
 * query reads them back for any trade, so a hardware yard can run a
 * volume band without being a wholesaler.
 */
export const listPricingRules = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        type: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const lists = await ctx.db
            .query("priceLists")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const wanted = lists.filter(
            (list) => !args.type || list.type === args.type
        );

        if (wanted.length === 0) return [];

        const entries = await ctx.db
            .query("priceListEntries")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const customerIds = wanted
            .map((list) => list.customerId)
            .filter((id): id is Id<"customers"> => Boolean(id));

        const customers = customerIds.length
            ? await Promise.all(customerIds.map((id) => ctx.db.get(id)))
            : [];

        const customerName = new Map(
            customers
                .filter((c): c is NonNullable<typeof c> => Boolean(c))
                .map((c) => [c._id, c.name])
        );

        const stockIds = Array.from(new Set(entries.map((e) => e.stockId)));
        const stocks = stockIds.length
            ? await Promise.all(stockIds.map((id) => ctx.db.get(id)))
            : [];

        const stockName = new Map(
            stocks
                .filter((s): s is NonNullable<typeof s> => Boolean(s))
                .map((s) => [s._id, s.name])
        );

        return wanted
            .map((list) => {
                const listEntries = entries.filter(
                    (entry) => entry.priceListId === list._id
                );

                return {
                    _id: list._id,
                    name: list.name,
                    type: list.type,
                    customerId: list.customerId,
                    customerName: list.customerId
                        ? customerName.get(list.customerId) ?? "Unknown customer"
                        : undefined,
                    isActive: list.isActive ?? true,
                    entryCount: listEntries.length,
                    entries: listEntries
                        .map((entry) => ({
                            _id: entry._id,
                            stockId: entry.stockId,
                            stockName: stockName.get(entry.stockId) ?? "Unknown product",
                            price: entry.price,
                            minQty: entry.minQty,
                        }))
                        .sort((a, b) => a.stockName.localeCompare(b.stockName)),
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    },
});

/**
 * Everything known about how one product is priced.
 *
 * The list price, the tiers that apply to it, the customers who have
 * their own price for it, and the units it can be sold in.
 */
export const getPriceBook = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        stockId: v.id("stocks"),
        /** The quantity being priced, so the effective price can be shown. */
        quantity: v.optional(v.number()),
        customerId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const stock = await ctx.db.get(args.stockId);
        if (!stock || stock.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        const lists = await ctx.db
            .query("priceLists")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const entries = await ctx.db
            .query("priceListEntries")
            .withIndex("by_stockId", (q) => q.eq("stockId", args.stockId))
            .collect();

        const listById = new Map(lists.map((list) => [list._id, list]));

        const tiers: Array<{
            listId: Id<"priceLists">;
            listName: string;
            minQty?: number;
            price: number;
        }> = [];

        const customerPrices: Array<{
            listId: Id<"priceLists">;
            listName: string;
            customerId?: Id<"customers">;
            price: number;
        }> = [];

        for (const entry of entries) {
            const list = listById.get(entry.priceListId);
            if (!list) continue;

            if (list.type === "tier") {
                tiers.push({
                    listId: list._id,
                    listName: list.name,
                    minQty: entry.minQty ?? list.minQty,
                    price: entry.price,
                });
            } else if (list.type === "customer") {
                customerPrices.push({
                    listId: list._id,
                    listName: list.name,
                    customerId: list.customerId,
                    price: entry.price,
                });
            }
        }

        tiers.sort((a, b) => (a.minQty ?? 0) - (b.minQty ?? 0));

        const candidates: PriceCandidate[] = [
            ...tiers.map((tier) => ({
                type: "tier" as const,
                priceListId: tier.listId,
                price: tier.price,
                minQty: tier.minQty,
            })),
            ...customerPrices.map((cp) => ({
                type: "customer" as const,
                priceListId: cp.listId,
                price: cp.price,
                customerId: cp.customerId,
            })),
        ];

        const quantity = args.quantity ?? 0;
        const resolved = resolvePrice(
            stock.price,
            candidates,
            quantity,
            args.customerId
        );

        const conversions = await ctx.db
            .query("unitConversions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const unit = stock.unit ?? "pcs";
        const measure = measureOf(unit);

        return {
            stockId: stock._id,
            name: stock.name,
            productCode: stock.productCode,
            listPrice: stock.price,
            purchasePrice: stock.purchasePrice,
            unit,
            measure,
            tiers,
            customerPrices,
            /** The price that actually applies, and which rule gave it. */
            effectivePrice: resolved.price,
            priceSource: resolved.matchType ?? "list",
            priceListId: resolved.priceListId,
            /** The line total at the quantity asked about. */
            lineTotal: roundForMoney(resolved.price * quantity),
            /** What the business keeps on the line, before any other cost. */
            margin: roundForMoney(resolved.price - stock.purchasePrice),
            marginPercent:
                resolved.price > 0
                    ? roundForMoney(
                          ((resolved.price - stock.purchasePrice) / resolved.price) * 100
                      )
                    : 0,
            /** The units this product can be converted into. */
            conversions: conversions.filter(
                (row) =>
                    row.fromUnit.toLowerCase() === unit.toLowerCase() ||
                    row.toUnit.toLowerCase() === unit.toLowerCase()
            ),
        };
    },
});

/**
 * What the business has set up, in one place.
 */
export const getPricingSummary = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const lists = await ctx.db
            .query("priceLists")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const entries = await ctx.db
            .query("priceListEntries")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const conversions = await ctx.db
            .query("unitConversions")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const activeStocks = stocks.filter((stock) => stock.isActive !== false);
        const pricedStockIds = new Set(entries.map((entry) => entry.stockId));

        return {
            tierLists: lists.filter((list) => list.type === "tier").length,
            customerLists: lists.filter((list) => list.type === "customer").length,
            rules: entries.length,
            conversions: conversions.length,
            products: activeStocks.length,
            productsWithRules: pricedStockIds.size,
            /** The products with no rule at all — they always sell at list price. */
            productsWithoutRules: activeStocks.filter(
                (stock) => !pricedStockIds.has(stock._id)
            ).length,
            /** The products sold by weight or volume. */
            productsByMeasure: activeStocks.filter(
                (stock) => measureOf(stock.unit ?? "pcs") !== "count"
            ).length,
        };
    },
});

/**
 * Price one line, the way the till would.
 *
 * The browser says what and how much; this says what it costs. It is the
 * same arithmetic the price book uses, so the screen and the till can
 * never disagree.
 */
export const quoteLine = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        stockId: v.id("stocks"),
        quantity: v.number(),
        customerId: v.optional(v.id("customers")),
        /** The unit the quantity is in, when it is not the product's own. */
        unit: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        if (!Number.isFinite(args.quantity) || args.quantity <= 0) {
            throw new ConvexError("A quantity must be a number greater than zero.");
        }

        const stock = await ctx.db.get(args.stockId);
        if (!stock || stock.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        let quantity = args.quantity;
        let convertedFrom: string | undefined;

        const stockUnit = (stock.unit ?? "pcs").toLowerCase();
        const askedUnit = args.unit?.trim().toLowerCase();

        if (askedUnit && askedUnit !== stockUnit) {
            const conversions = await ctx.db
                .query("unitConversions")
                .withIndex("by_businessId", (q) =>
                    q.eq("businessId", tenant.businessId)
                )
                .collect();

            const forward = conversions.find(
                (row) =>
                    row.fromUnit.toLowerCase() === askedUnit &&
                    row.toUnit.toLowerCase() === stockUnit
            );
            const reverse = conversions.find(
                (row) =>
                    row.fromUnit.toLowerCase() === stockUnit &&
                    row.toUnit.toLowerCase() === askedUnit
            );

            if (forward) {
                quantity = roundForMoney(quantity * forward.factor);
                convertedFrom = askedUnit;
            } else if (reverse) {
                quantity = roundForMoney(quantity / reverse.factor);
                convertedFrom = askedUnit;
            } else {
                throw new ConvexError(
                    `There is no conversion from ${askedUnit} to ${stockUnit}, so the price cannot be worked out.`
                );
            }
        }

        const lists = await ctx.db
            .query("priceLists")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const entries = await ctx.db
            .query("priceListEntries")
            .withIndex("by_stockId", (q) => q.eq("stockId", args.stockId))
            .collect();

        const listById = new Map(lists.map((list) => [list._id, list]));

        const candidates: PriceCandidate[] = [];
        for (const entry of entries) {
            const list = listById.get(entry.priceListId);
            if (!list) continue;
            if (list.type === "tier") {
                candidates.push({
                    type: "tier",
                    priceListId: list._id,
                    price: entry.price,
                    minQty: entry.minQty ?? list.minQty,
                });
            } else if (list.type === "customer") {
                candidates.push({
                    type: "customer",
                    priceListId: list._id,
                    price: entry.price,
                    customerId: list.customerId,
                });
            }
        }

        const resolved = resolvePrice(
            stock.price,
            candidates,
            quantity,
            args.customerId
        );

        return {
            stockId: stock._id,
            name: stock.name,
            unit: stock.unit ?? "pcs",
            /** The quantity in the product's own unit. */
            quantity,
            /** The unit the quantity was given in, when it was converted. */
            convertedFrom,
            unitPrice: resolved.price,
            lineTotal: roundForMoney(resolved.price * quantity),
            priceSource: resolved.matchType ?? "list",
            priceListId: resolved.priceListId,
        };
    },
});
