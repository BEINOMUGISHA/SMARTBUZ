import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { requireUsageAllowance } from "./entitlements";
import { paginationOptsValidator } from "convex/server";
import { Id } from "./_generated/dataModel";
import { hasPermission, logActivity, requirePermission, requireTenant } from "./tenancy";
import type { Ctx } from "./tenancy";
import { DEFAULT_REORDER_POINT } from "./defaults";
import { hydrateCounterLines, stripIssuedStockCopies } from "./counterStock";

/**
 * SMART_BUZ — products (stock).
 *
 * Each business keeps its own catalogue. Product codes are unique *per
 * business*, so two businesses may both sell "SKU-001" without colliding.
 */

/**
 * The fields that make up the cost of a product.
 *
 * `purchasePrice` is what the business paid, `pv` and `bv` are the two
 * values the ledger carries for it. Between them they are the margin on
 * every line.
 */
const COST_FIELDS = ["purchasePrice", "pv", "bv"] as const;

/**
 * May this caller see what the products cost?
 *
 * The people who manage stock and the people who read the finances need
 * the cost price to do their work. The till does not: a cashier who can
 * read every product's margin is a cashier who can be talked into
 * discounting it, and who can walk out knowing what the whole shop is
 * worth.
 */
async function canSeeCost(ctx: Ctx, businessId: Id<"businesses">): Promise<boolean> {
    return (
        (await hasPermission(ctx, businessId, "products.manage")) ||
        (await hasPermission(ctx, businessId, "finance.view"))
    );
}

/**
 * The row as the caller is allowed to see it.
 *
 * The cost fields are removed rather than blanked, so a caller cannot tell
 * a product that costs nothing from one whose cost they are not allowed to
 * see.
 */
function withoutCost<T extends object>(row: T, visible: boolean): T {
    if (visible) return row;
    const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const field of COST_FIELDS) delete copy[field];
    return copy as T;
}

// List stocks with pagination, search, and category filtering
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        if (args.categoryId) {
            const category = await ctx.db.get(args.categoryId);
            if (!category || category.businessId !== businessId) {
                throw new ConvexError("Forbidden: that category belongs to another business.");
            }
        }

        // [OPTIMIZED with Index]
        let query;
        if (args.searchTerm) {
            // The search index spans every business, so the tenant filter is
            // applied to the result set.
            query = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!))
                .filter((q) => q.eq(q.field("businessId"), businessId));

            if (args.halfPrice !== undefined) {
                query = query.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            if (args.categoryId) {
                query = query.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
            }
            const page = await query.paginate(args.paginationOpts);
            const canCost = await canSeeCost(ctx, businessId);
            return {
                ...page,
                page: page.page.map((stock) => withoutCost(stock, canCost)),
            };
        } else if (args.categoryId) {
            query = ctx.db
                .query("stocks")
                .withIndex("by_businessId_category", (q) =>
                    q.eq("businessId", businessId).eq("categoryId", args.categoryId!)
                );
            if (args.halfPrice !== undefined) {
                query = query.filter(q => q.eq(q.field("halfPrice"), args.halfPrice));
            }
        } else if (args.halfPrice !== undefined) {
            query = ctx.db
                .query("stocks")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .filter(q => q.eq(q.field("halfPrice"), args.halfPrice!));
        } else {
            query = ctx.db.query("stocks").withIndex("by_businessId", (q) => q.eq("businessId", businessId));
        }

        const page = await query.order("desc").paginate(args.paginationOpts);
        const canCost = await canSeeCost(ctx, businessId);
        return {
            ...page,
            page: page.page.map((stock) => withoutCost(stock, canCost)),
        };
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        // [OPTIMIZED with proper types]
        if (args.searchTerm) {
            let searchQ = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!))
                .filter((q) => q.eq(q.field("businessId"), businessId));

            if (args.halfPrice !== undefined) {
                searchQ = searchQ.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            if (args.categoryId) {
                searchQ = searchQ.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
            }
            const all = await searchQ.collect();
            // Fallback to exact code match if no name results
            if (all.length === 0) {
                const byCode = await ctx.db
                    .query("stocks")
                    .withIndex("by_businessId_productCode", (q) =>
                        q.eq("businessId", businessId).eq("productCode", args.searchTerm!)
                    )
                    .first();
                if (byCode) {
                    if ((args.halfPrice === undefined || byCode.halfPrice === args.halfPrice) &&
                        (!args.categoryId || byCode.categoryId === args.categoryId)) {
                        all.push(byCode);
                    }
                }
            }
            const canCost = await canSeeCost(ctx, businessId);
            return {
                page: all.slice(args.offset, args.offset + args.limit).map((s) => withoutCost(s, canCost)),
                totalCount: all.length,
            };
        }

        let stocksQuery;
        if (args.categoryId) {
            stocksQuery = ctx.db
                .query("stocks")
                .withIndex("by_businessId_category", (q) =>
                    q.eq("businessId", businessId).eq("categoryId", args.categoryId!)
                );
            if (args.halfPrice !== undefined) {
                stocksQuery = stocksQuery.filter(q => q.eq(q.field("halfPrice"), args.halfPrice));
            }
        } else if (args.halfPrice !== undefined) {
            stocksQuery = ctx.db
                .query("stocks")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .filter(q => q.eq(q.field("halfPrice"), args.halfPrice!));
        } else {
            stocksQuery = ctx.db.query("stocks").withIndex("by_businessId", (q) => q.eq("businessId", businessId));
        }

        const all = await stocksQuery.order("desc").collect();
        const totalCount = all.length;
        const canCost = await canSeeCost(ctx, businessId);
        const page = all.slice(args.offset, args.offset + args.limit).map((s) => withoutCost(s, canCost));

        return { page, totalCount };
    },
});

export const count = query({
    args: {
        searchTerm: v.optional(v.string()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        // [OPTIMIZED with Index]
        let query;
        if (args.searchTerm) {
            query = ctx.db
                .query("stocks")
                .withSearchIndex("search_name", (q) => q.search("name", args.searchTerm!))
                .filter((q) => q.eq(q.field("businessId"), businessId));

            if (args.halfPrice !== undefined) {
                query = query.filter((q) => q.eq(q.field("halfPrice"), args.halfPrice));
            }
            if (args.categoryId) {
                query = query.filter((q) => q.eq(q.field("categoryId"), args.categoryId));
            }
        } else if (args.categoryId) {
            query = ctx.db
                .query("stocks")
                .withIndex("by_businessId_category", (q) =>
                    q.eq("businessId", businessId).eq("categoryId", args.categoryId!)
                );
            if (args.halfPrice !== undefined) {
                query = query.filter(q => q.eq(q.field("halfPrice"), args.halfPrice));
            }
        } else if (args.halfPrice !== undefined) {
            query = ctx.db
                .query("stocks")
                .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
                .filter(q => q.eq(q.field("halfPrice"), args.halfPrice!));
        } else {
            query = ctx.db.query("stocks").withIndex("by_businessId", (q) => q.eq("businessId", businessId));
        }

        return (await query.collect()).length;
    },
});

export const getInventoryStats = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const categories = await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const shops = await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const catMap = new Map(categories.map(c => [c._id, c.type]));

        // -----------------------------------------------------------------
        // WHAT THE BUSINESS HOLDS, IN EVERY PLACE IT HOLDS IT
        //
        // The goods live in two places: the warehouse (`stocks.qty`) and the
        // counters (`shops[].issuedStocks[].qty`). The old summary added up
        // only the warehouse, then subtracted the counters from it — which
        // understated the warehouse by everything that had been issued and
        // left the totals meaning different things depending on which
        // issue path had been used.
        //
        // So the holding of each product is the sum of the two, and every
        // figure below is computed from that.
        // -----------------------------------------------------------------
        const counterQty = new Map<Id<"stocks">, number>();
        for (const shop of shops) {
            for (const item of shop.issuedStocks) {
                counterQty.set(item.stockId, (counterQty.get(item.stockId) ?? 0) + item.qty);
            }
        }

        const stats = stocks.reduce((acc, s) => {
            const qty = s.qty + (counterQty.get(s._id) ?? 0);
            const sellValue = qty * s.price;
            const costValue = qty * s.purchasePrice;

            acc.totalSellValue += sellValue;
            acc.totalCostValue += costValue;
            acc.totalItems += qty;
            acc.skuCount += 1;
            acc.totalBV += qty * s.bv;
            acc.totalPV += qty * s.pv;

            if (qty === 0) {
                acc.outOfStockCount += 1;
            }

            const catName = catMap.get(s.categoryId) || "Unknown";
            acc.categoryDistribution[catName] = (acc.categoryDistribution[catName] || 0) + qty;

            if (s.supplier) {
                acc.supplierDistribution[s.supplier] = (acc.supplierDistribution[s.supplier] || 0) + qty;
                if (!acc.suppliers.includes(s.supplier)) {
                    acc.suppliers.push(s.supplier);
                }
            }

            return acc;
        }, {
            totalSellValue: 0,
            totalCostValue: 0,
            totalItems: 0,
            skuCount: 0,
            totalBV: 0,
            totalPV: 0,
            outOfStockCount: 0,
            categoryDistribution: {} as Record<string, number>,
            supplierDistribution: {} as Record<string, number>,
            suppliers: [] as string[]
        });

        // -----------------------------------------------------------------
        // WHERE THE STOCK IS
        //
        // `stocks.qty` is the **warehouse** holding: issuing stock to a
        // counter takes it out of the warehouse, so the two never double
        // count each other.
        //
        // The old figure subtracted the counters' holdings from the
        // warehouse total, which understated the warehouse by however much
        // had been issued — and it only made sense for the one issue path
        // that left the goods in the warehouse as well. With the issue paths
        // unified, the warehouse figure is the sum of the warehouse rows
        // themselves, and the total the business holds is the warehouse plus
        // the counters.
        // -----------------------------------------------------------------
        const warehouseStock = stocks
            .filter((s) => !s.branchId)
            .reduce((sum, s) => sum + s.qty, 0);

        // Calculate shop distribution
        let totalShopStock = 0;
        const shopDistribution = shops.reduce((acc, shop) => {
            const shopTotal = shop.issuedStocks.reduce((sum, item) => sum + item.qty, 0);
            acc[shop.name] = shopTotal;
            totalShopStock += shopTotal;
            return acc;
        }, {} as Record<string, number>);

        // Convert distribution to array for charts
        const categoryDistributionArray = Object.entries(stats.categoryDistribution).map(([name, value]) => ({
            name,
            value
        })).sort((a, b) => b.value - a.value);

        const supplierDistributionArray = Object.entries(stats.supplierDistribution).map(([name, value]) => ({
            name,
            value
        })).sort((a, b) => b.value - a.value);

        const shopDistributionArray = Object.entries(shopDistribution).map(([name, value]) => ({
            name,
            value
        })).sort((a, b) => b.value - a.value);

        return {
            ...stats,
            categoryDistribution: categoryDistributionArray,
            supplierDistribution: supplierDistributionArray,
            shopDistribution: shopDistributionArray,
            supplierCount: stats.suppliers.length,
            shopCount: shops.length,
            totalShopStock,
            warehouseStock,
        };
    }
});

/**
 * Reconcile the stock position against the movement history.
 *
 * The ledger is the record of every movement of goods. The balances — the
 * quantity on the master row, and the quantity at each counter — are the
 * running result of those movements. They must agree, and until there is a
 * way to compare them, a mistake in either one is invisible: the goods go
 * missing and the books do not know.
 *
 * For each product this reports:
 *
 *   - the warehouse holding and the counter holdings,
 *   - the net movement the ledger records for each of them,
 *   - and the difference between the two.
 *
 * A difference is not a bug in the report — it is the report doing its job.
 * It means a movement happened that was never written down, or a balance
 * was changed without a movement behind it. The `note` on each line says
 * which, so the business can put it right.
 */
export const getReconciliation = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        const businessId = tenant.businessId;

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const shops = await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        // The ledger, read once and grouped by the product it concerns.
        const ledger = await ctx.db
            .query("stockLedger")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const warehouseNet = new Map<string, number>();
        const counterNet = new Map<string, number>();
        const counterNetByShop = new Map<string, Map<string, number>>();
        const hasOpening = new Set<string>();
        for (const row of ledger) {
            const key = row.stockId as string;
            if (row.eventType === "OPENING_BALANCE") hasOpening.add(key);
            if (row.shopId) {
                counterNet.set(key, (counterNet.get(key) ?? 0) + (row.deltaQty ?? 0));
                const perShop = counterNetByShop.get(key) ?? new Map<Id<"shops">, number>();
                perShop.set(
                    row.shopId,
                    (perShop.get(row.shopId as string) ?? 0) + (row.deltaQty ?? 0)
                );
                counterNetByShop.set(key, perShop);
            } else {
                warehouseNet.set(key, (warehouseNet.get(key) ?? 0) + (row.deltaQty ?? 0));
            }
        }

        // What each counter holds, and the total across all of them.
        const counterHolding = new Map<string, number>();
        for (const shop of shops) {
            for (const item of shop.issuedStocks) {
                const key = item.stockId as string;
                counterHolding.set(key, (counterHolding.get(key) ?? 0) + item.qty);
            }
        }

        const lines = stocks.map((s) => {
            const key = s._id as string;
            const warehouse = s.qty;
            const counter = counterHolding.get(key) ?? 0;
            const ledgerWarehouse = warehouseNet.get(key) ?? 0;
            const ledgerCounter = counterNet.get(key) ?? 0;

            // A product can only be reconciled once its history starts from
            // a recorded opening balance. Until then there is nothing to
            // compare the balance against, so it is not a discrepancy — it
            // is a product that has not started being tracked.
            const isTracked = hasOpening.has(key);

            const warehouseDifference = warehouse - ledgerWarehouse;
            const counterDifference = counter - ledgerCounter;

            let note: string | undefined;
            if (!isTracked) {
                note =
                    "This product's history does not start from a recorded opening balance, so it cannot be reconciled yet. Record its opening balance to start tracking it.";
            } else if (warehouseDifference !== 0 && counterDifference === 0) {
                note =
                    "The warehouse holds more than the ledger records. A movement was made without being written down.";
            } else if (counterDifference !== 0 && warehouseDifference === 0) {
                note =
                    "The counters hold more than the ledger records. A movement was made without being written down.";
            } else if (warehouseDifference !== 0 || counterDifference !== 0) {
                note =
                    "Both the warehouse and the counters disagree with the ledger. Count the stock and adjust.";
            }

            return {
                stockId: s._id,
                name: s.name,
                productCode: s.productCode,
                warehouse,
                counter,
                ledgerWarehouse,
                ledgerCounter,
                warehouseDifference: isTracked ? warehouseDifference : 0,
                counterDifference: isTracked ? counterDifference : 0,
                tracked: isTracked,
                reconciled: !isTracked || (warehouseDifference === 0 && counterDifference === 0),
                note,
            };
        });

        const discrepancies = lines.filter((l) => l.tracked && !l.reconciled);
        const untracked = lines.filter((l) => !l.tracked);

        return {
            summary: {
                products: lines.length,
                reconciled: lines.length - discrepancies.length,
                discrepancies: discrepancies.length,
                // The products that have never been tracked. They are not
                // wrong; they have simply no history yet.
                untracked: untracked.length,
                // The net difference across every product: how many units
                // the books and the history disagree by.
                netDifference:
                    discrepancies.reduce(
                        (sum, l) => sum + l.warehouseDifference + l.counterDifference,
                        0
                    ),
            },
            lines: lines.sort((a, b) => {
                if (a.reconciled === b.reconciled) return 0;
                return a.reconciled ? 1 : -1;
            }),
        };
    },
});

/**
 * Give the products an opening balance to reconcile against.
 *
 * The ledger can only be reconciled against a balance if it starts
 * somewhere. A product whose opening quantity was never written down —
 * every product created before the ledger was in use — has no opening row,
 * so its balance and its history can never agree.
 *
 * This writes that opening row. It does not change any balance: it
 * records, as the opening, whatever the business holds right now less what
 * the ledger already accounts for. From this moment on every movement of
 * the product is reconcilable, and a movement that is made without being
 * written down shows up as a difference.
 *
 * It is a starting point rather than a correction, and it is written as
 * what it is, so it can be seen.
 */
export const recordOpeningBalances = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        const businessId = tenant.businessId;

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const shops = await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const ledger = await ctx.db
            .query("stockLedger")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const warehouseNet = new Map<string, number>();
        const counterNet = new Map<string, number>();
        const counterNetByShop = new Map<string, Map<string, number>>();
        const hasOpening = new Set<string>();
        for (const row of ledger) {
            const key = row.stockId as string;
            if (row.eventType === "OPENING_BALANCE") hasOpening.add(key);
            if (row.shopId) {
                counterNet.set(key, (counterNet.get(key) ?? 0) + (row.deltaQty ?? 0));
                const perShop = counterNetByShop.get(key) ?? new Map<string, number>();
                perShop.set(
                    row.shopId as string,
                    (perShop.get(row.shopId as string) ?? 0) + (row.deltaQty ?? 0)
                );
                counterNetByShop.set(key, perShop);
            } else {
                warehouseNet.set(key, (warehouseNet.get(key) ?? 0) + (row.deltaQty ?? 0));
            }
        }

        const counterHolding = new Map<string, number>();
        const counterByShop = new Map<string, Map<Id<"shops">, number>>();
        for (const shop of shops) {
            for (const item of shop.issuedStocks) {
                const key = item.stockId as string;
                counterHolding.set(key, (counterHolding.get(key) ?? 0) + item.qty);
                const perShop = counterByShop.get(key) ?? new Map<Id<"shops">, number>();
                perShop.set(shop._id, (perShop.get(shop._id) ?? 0) + item.qty);
                counterByShop.set(key, perShop);
            }
        }

        let recorded = 0;
        for (const stock of stocks) {
            const key = stock._id as string;
            if (hasOpening.has(key)) continue;

            // The opening is what the business holds now, less what the
            // ledger already accounts for.
            const warehouseOpening = stock.qty - (warehouseNet.get(key) ?? 0);
            const counterOpening = (counterHolding.get(key) ?? 0) - (counterNet.get(key) ?? 0);

            if (warehouseOpening !== 0) {
                await ctx.db.insert("stockLedger", {
                    businessId,
                    stockId: stock._id,
                    deltaQty: warehouseOpening,
                    eventType: "OPENING_BALANCE",
                    referenceId: stock.productCode,
                    userId: tenant.user._id,
                    timestamp: new Date().toISOString(),
                    notes: `Opening balance recorded for ${stock.name} so that its movements can be reconciled from now on`,
                });
            }

            // The counters' opening is recorded counter by counter, because
            // that is where the goods are: a counter's holding is its own
            // position, not part of the warehouse's.
            if (counterOpening !== 0) {
                const perShop = counterByShop.get(key) ?? new Map<Id<"shops">, number>();
                for (const [shopId, qty] of perShop) {
                    const shopOpening = qty - (counterNetByShop.get(key)?.get(shopId) ?? 0);
                    if (shopOpening === 0) continue;
                    await ctx.db.insert("stockLedger", {
                        businessId,
                        stockId: stock._id,
                        shopId,
                        deltaQty: shopOpening,
                        eventType: "OPENING_BALANCE",
                        referenceId: stock.productCode,
                        userId: tenant.user._id,
                        timestamp: new Date().toISOString(),
                        notes: `Opening balance recorded for ${stock.name} at the counters`,
                    });
                }
            }
            recorded += 1;
        }

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Record Opening Balances",
            `Recorded the opening balance of ${recorded} product(s)`
        );

        return { recorded };
    },
});

export const getLowStockAudit = query({
    args: {
        threshold: v.optional(v.number()),
        lookbackDays: v.optional(v.number()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        // -----------------------------------------------------------------
        // EACH PRODUCT IS COMPARED AGAINST ITS OWN REORDER POINT
        //
        // The alert used to compare every product against one number typed
        // into the browser. A business stocking 200-litre drums and one
        // stocking tea sachets therefore got the same cutoff, and because
        // the cutoff was never stored, the alert could not be reproduced or
        // audited a week later.
        //
        // The order is: the product's own reorder point, then the
        // business's default, then a constant. The browser's threshold is
        // no longer the deciding number.
        // -----------------------------------------------------------------
        const business = await ctx.db.get(businessId);
        const businessDefault =
            business?.defaultReorderPoint ?? DEFAULT_REORDER_POINT;

        const lookbackDays = args.lookbackDays ?? 7;
        const candidates = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const lowStock = candidates.filter((s) => {
            const reorderPoint = s.reorderPoint ?? businessDefault;
            return s.qty < reorderPoint;
        });

        const categories = await ctx.db
            .query("categories")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const catMap = new Map(categories.map(c => [c._id, c.type]));

        const sales = await ctx.db
            .query("sales")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const startTime = Date.now() - lookbackDays * 24 * 60 * 60 * 1000;
        const soldByStock = new Map<Id<"stocks">, number>();

        for (const sale of sales) {
            const saleTime = new Date(sale.date).getTime();
            if (saleTime < startTime) continue;

            for (const item of sale.items) {
                const current = soldByStock.get(item.stockId) ?? 0;
                soldByStock.set(item.stockId, current + item.quantity);
            }
        }

        const canCost = await canSeeCost(ctx, businessId);

        return lowStock.map(s => {
            const soldInWindow = soldByStock.get(s._id) ?? 0;
            const dailyVelocity = soldInWindow / Math.max(1, lookbackDays);
            const daysToStockOut = dailyVelocity > 0 ? s.qty / dailyVelocity : Number.POSITIVE_INFINITY;
            const reorderPoint = s.reorderPoint ?? businessDefault;
            // Order enough to cover a week of selling and to get back above
            // the product's own reorder point.
            const recommendedOrder = Math.max(0, Math.ceil((dailyVelocity * 7) + reorderPoint - s.qty));

            return {
                ...withoutCost(s, canCost),
                categoryName: catMap.get(s.categoryId) || "Unknown",
                valuation: s.qty * s.price,
                reorderPoint,
                dailyVelocity: Number(dailyVelocity.toFixed(2)),
                daysToStockOut: Number.isFinite(daysToStockOut) ? Number(daysToStockOut.toFixed(1)) : null,
                recommendedOrder,
            };
        });
    }
});

export const getShopStock = query({
    args: {
        searchTerm: v.optional(v.string()),
        halfPrice: v.optional(v.boolean()),
        availability: v.optional(v.union(v.literal("inStock"), v.literal("outOfStock"), v.literal("all"))),
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        limit: v.optional(v.number()),
        offset: v.optional(v.number()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        // The shop is the counter the caller runs in *this* business. The
        // email argument is ignored: the browser used to be able to ask for
        // any user's counter.
        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", tenant.user._id))
            .filter((q) => q.eq(q.field("businessId"), businessId))
            .first();

        // If no shop, user is HQ or unassigned
        if (!shop) return { shop: null, stocks: [] };

        // -----------------------------------------------------------------
        // THE TILL'S CATALOGUE
        //
        // The counter's row says how much of each product it holds. The
        // product itself is read from the master catalogue now.
        //
        // It used to be read from the copy the counter took when the goods
        // were issued, which meant the till showed yesterday's price for a
        // product whose price had since changed: the customer was quoted one
        // figure and charged another, and the till's own list disagreed with
        // the warehouse's. One catalogue, one price.
        // -----------------------------------------------------------------
        let stocks = await hydrateCounterLines(ctx, shop.issuedStocks ?? []);

        // Filter by text
        if (args.searchTerm) {
            const lowerSearch = args.searchTerm.toLowerCase();
            stocks = stocks.filter(s =>
                s.name.toLowerCase().includes(lowerSearch) ||
                (s.productCode?.toLowerCase().includes(lowerSearch) ?? false)
            );
        }

        // Filter by halfPrice
        if (args.halfPrice !== undefined) {
            stocks = stocks.filter(s => !!s.halfPrice === args.halfPrice);
        }

        // Filter by availability
        if (args.availability === "inStock") {
            stocks = stocks.filter(s => s.qty > 0);
        } else if (args.availability === "outOfStock") {
            stocks = stocks.filter(s => s.qty <= 0);
        }

        const totalCount = stocks.length;
        if (args.offset !== undefined && args.limit !== undefined) {
            stocks = stocks.slice(args.offset, args.offset + args.limit);
        }

        // What the goods cost is removed unless the caller is allowed to
        // see it. The till is not shown the cost, so it is not sent either.
        const canCost = await canSeeCost(ctx, businessId);
        const visible = stocks.map((s) => withoutCost(s, canCost));

        return { shop, stocks: visible, totalCount };
    },
});

export const listAll = query({
    args: {
        halfPrice: v.optional(v.boolean()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        const all = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.halfPrice !== undefined) {
            return all.filter(s => !!s.halfPrice === args.halfPrice);
        }

        return all;
    },
});

// Get stock by product code (unique within the business)
export const getByCode = query({
    args: {
        productCode: v.string(),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        return await ctx.db
            .query("stocks")
            .withIndex("by_businessId_productCode", (q) =>
                q.eq("businessId", tenant.businessId).eq("productCode", args.productCode)
            )
            .unique();
    },
});

// Get a single stock with details
export const getStock = query({
    args: { id: v.id("stocks"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const stock = await ctx.db.get(args.id);
        if (!stock) return null;
        if (stock.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        // Get category if available
        const category = stock.categoryId ? await ctx.db.get(stock.categoryId) : null;

        // The cost price is withheld from the roles that have no business
        // seeing it — the till is not one of them.
        const canCost = await canSeeCost(ctx, tenant.businessId);

        return {
            ...withoutCost(stock, canCost),
            category,
        };
    },
});

// Add stock
export const add = mutation({
    args: {
        name: v.string(),
        productCode: v.string(),
        description: v.optional(v.string()),
        price: v.number(),
        purchasePrice: v.number(),
        qty: v.number(),
        pv: v.number(),
        bv: v.number(),
        categoryId: v.id("categories"),
        halfPrice: v.optional(v.boolean()),
        supplier: v.optional(v.string()),
        warehouseId: v.optional(v.id("warehouses")),
        branchId: v.optional(v.id("branches")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.create");
        await requireUsageAllowance(ctx, tenant.businessId, "products");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const category = await ctx.db.get(args.categoryId);
        if (!category || category.businessId !== businessId) {
            throw new ConvexError("Forbidden: that category belongs to another business.");
        }
        if (args.warehouseId) {
            const warehouse = await ctx.db.get(args.warehouseId);
            if (!warehouse || warehouse.businessId !== businessId) {
                throw new ConvexError("Forbidden: that warehouse belongs to another business.");
            }
        }
        if (args.branchId) {
            const branch = await ctx.db.get(args.branchId);
            if (!branch || branch.businessId !== businessId) {
                throw new ConvexError("Forbidden: that branch belongs to another business.");
            }
        }

        // Product codes are unique within the business.
        const duplicate = await ctx.db
            .query("stocks")
            .withIndex("by_businessId_productCode", (q) =>
                q.eq("businessId", businessId).eq("productCode", args.productCode)
            )
            .unique();
        if (duplicate) {
            throw new ConvexError(
                `Product code "${args.productCode}" already exists in this business.`
            );
        }

        const { supplier, businessId: _ignored, ...insertArgs } = args;
        const stockId = await ctx.db.insert("stocks", {
            ...insertArgs,
            businessId,
            supplier,
        });

        // -----------------------------------------------------------------
        // THE OPENING BALANCE GOES IN THE LEDGER TOO
        //
        // The ledger is the record of every movement of goods, and it is
        // only a record of the movements if it starts from the beginning.
        // A product whose opening quantity was never written down cannot be
        // reconciled against it: the difference between the balance and the
        // ledger would always be the opening stock, and the report would be
        // noise.
        //
        // So the goods a product starts with are recorded as the movement
        // they are.
        // -----------------------------------------------------------------
        if (args.qty !== 0) {
            await ctx.db.insert("stockLedger", {
                businessId,
                stockId,
                deltaQty: args.qty,
                eventType: "OPENING_BALANCE",
                referenceId: args.productCode,
                userId,
                timestamp: new Date().toISOString(),
                notes: `Opening stock for ${args.name}`,
            });
        }

        await ctx.db.insert("stockEntries", {
            businessId,
            stockId,
            quantity: args.qty,
            userId,
            date: new Date().toISOString(),
            price: args.price,
            purchasePrice: args.purchasePrice,
            pv: args.pv,
            bv: args.bv,
            halfPrice: args.halfPrice || false,
            type: "add",
            supplier,
        });

        // Log activity
        await logActivity(
            ctx,
            businessId,
            userId,
            "Add Stock",
            `Added new stock: ${args.name} (${args.productCode}) - Qty: ${args.qty}, Price: ${args.price.toLocaleString()}`
        );

        return stockId;
    },
});

// Update stock
export const update = mutation({
    args: {
        id: v.id("stocks"),
        name: v.optional(v.string()),
        productCode: v.optional(v.string()),
        description: v.optional(v.string()),
        price: v.optional(v.number()),
        purchasePrice: v.optional(v.number()),
        qty: v.optional(v.number()),
        pv: v.optional(v.number()),
        bv: v.optional(v.number()),
        categoryId: v.optional(v.id("categories")),
        halfPrice: v.optional(v.boolean()),
        supplier: v.optional(v.string()),
        warehouseId: v.optional(v.id("warehouses")),
        branchId: v.optional(v.id("branches")),
        reorderPoint: v.optional(v.number()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");
        const businessId = tenant.businessId;

        const { id, businessId: _ignored, ...rest } = args;
        const oldStock = await ctx.db.get(id);
        if (!oldStock) throw new Error("Stock not found");
        if (oldStock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        if (rest.categoryId) {
            const category = await ctx.db.get(rest.categoryId);
            if (!category || category.businessId !== businessId) {
                throw new ConvexError("Forbidden: that category belongs to another business.");
            }
        }
        if (rest.productCode && rest.productCode !== oldStock.productCode) {
            const duplicate = await ctx.db
                .query("stocks")
                .withIndex("by_businessId_productCode", (q) =>
                    q.eq("businessId", businessId).eq("productCode", rest.productCode!)
                )
                .unique();
            if (duplicate) {
                throw new ConvexError(
                    `Product code "${rest.productCode}" already exists in this business.`
                );
            }
        }

        await ctx.db.patch(id, rest);

        // -----------------------------------------------------------------
        // THE COUNTERS DO NOT NEED TELLING
        //
        // This used to walk every counter in the business and copy the new
        // price into the row the counter held — because the counter kept a
        // copy of the product. A price change in one place now reaches
        // every counter for free, because the counter does not keep one.
        //
        // The copy-back also had a cost: it was a second write path for the
        // same fact, and it only ran for price changes, so a renamed
        // product or a re-coded one stayed wrong on every counter that had
        // ever been issued it.
        // -----------------------------------------------------------------

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Stock",
            `Updated stock: ${oldStock.name} (${oldStock.productCode}) - Changes: ${changes}`
        );
    },
});

// Delete stock
export const remove = mutation({
    args: { id: v.id("stocks"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.update");
        const businessId = tenant.businessId;

        const stock = await ctx.db.get(args.id);
        if (!stock) throw new Error("Stock not found");
        if (stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        // -----------------------------------------------------------------
        // A PRODUCT WITH HISTORY IS ARCHIVED, NOT DESTROYED
        //
        // Deleting the product document took its history with it: every
        // past sale, every ledger row and every goods receipt still pointed
        // at it, and every report that resolved a sale line back to a
        // product found nothing. The amount survived; the product did not.
        //
        // So a product that has been sold, received, moved or issued is
        // archived instead: out of the catalogue and out of stock, but
        // still resolvable for the books. Only a product nobody has ever
        // touched is deleted outright.
        // -----------------------------------------------------------------
        const history = await productHistory(ctx, businessId, args.id);
        const hasHistory = history.length > 0;

        const shops = await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        for (const shop of shops) {
            const issuedStocks = stripIssuedStockCopies(shop.issuedStocks).filter(item => item.stockId !== args.id);
            if (issuedStocks.length !== shop.issuedStocks.length) {
                await ctx.db.patch(shop._id, { issuedStocks });
            }
        }

        if (hasHistory) {
            await ctx.db.patch(args.id, { isActive: false, qty: 0 });
        } else {
            await ctx.db.delete(args.id);
        }

        // Log activity
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Stock",
            hasHistory
                ? `Archived ${stock.name} (${stock.productCode}) — it has history, so it was taken out of the catalogue rather than destroyed`
                : `Deleted stock: ${stock.name} (${stock.productCode}) - Previous Qty: ${stock.qty}`
        );

        return {
            deleted: !hasHistory,
            archived: hasHistory,
            history: history.length,
            message: hasHistory
                ? `${stock.name} has been sold or moved before, so it was archived instead of deleted. It is out of the catalogue and out of stock, and the history still refers to it.`
                : `${stock.name} was deleted.`,
        };
    },
});

/**
 * What a product has been involved in.
 *
 * A product that has been sold, received, moved or issued to a counter
 * cannot be destroyed, because the history still points at it. This finds
 * out whether it has.
 */
async function productHistory(
    ctx: MutationCtx,
    businessId: Id<"businesses">,
    stockId: Id<"stocks">
): Promise<string[]> {
    const found: string[] = [];

    const sales = await ctx.db
        .query("sales")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();
    if (sales.some((sale) => sale.items?.some((i) => i.stockId === stockId))) {
        found.push("a sale");
    }

    const ledger = await ctx.db
        .query("stockLedger")
        .withIndex("by_stockId", (q) => q.eq("stockId", stockId))
        .collect();
    if (ledger.length > 0) found.push("a stock movement");

    const entries = await ctx.db
        .query("stockEntries")
        .withIndex("by_stockId", (q) => q.eq("stockId", stockId))
        .collect();
    if (entries.length > 0) found.push("a stock entry");

    const receipts = await ctx.db
        .query("goodsReceipts")
        .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
        .collect();
    if (receipts.some((r) => r.items?.some((i) => i.stockId === stockId))) {
        found.push("a goods receipt");
    }

    return found;
}

// Restock logic
export const restock = mutation({
    args: {
        id: v.id("stocks"),
        quantityToAdd: v.number(),
        price: v.number(),
        pv: v.number(),
        bv: v.number(),
        halfPrice: v.boolean(),
        date: v.string(),
        supplier: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const { supplier, businessId: _ignored, ...restockArgs } = args;

        const stock = await ctx.db.get(args.id);
        if (!stock) throw new Error("Stock not found");
        if (stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            qty: stock.qty + args.quantityToAdd,
            price: args.price,
            pv: args.pv,
            bv: args.bv,
            halfPrice: args.halfPrice,
            supplier: supplier ?? stock.supplier,
        });

        // The goods arrived, so the ledger records that they did.
        await ctx.db.insert("stockLedger", {
            businessId,
            stockId: args.id,
            deltaQty: args.quantityToAdd,
            eventType: "RESTOCK",
            referenceId: stock.productCode,
            userId,
            timestamp: args.date || new Date().toISOString(),
            notes: `Restocked ${stock.name}`,
        });

        await ctx.db.insert("stockEntries", {
            businessId,
            stockId: args.id,
            quantity: args.quantityToAdd,
            userId,
            date: args.date || new Date().toISOString(),
            price: args.price,
            purchasePrice: stock.purchasePrice,
            pv: args.pv,
            bv: args.bv,
            halfPrice: args.halfPrice,
            type: "restock",
            supplier,
        });

        // Log activity
        await logActivity(
            ctx,
            businessId,
            userId,
            "Restock",
            `Restocked ${stock.name} (${stock.productCode}) - Added: ${args.quantityToAdd}, New Qty: ${stock.qty + args.quantityToAdd}, Supplier: ${supplier || stock.supplier || 'N/A'}`
        );

        // The counters do not need to be told: they hold a quantity, and
        // the product's price is read from the catalogue. Copying the new
        // price into every counter's row is what used to keep two versions
        // of the truth alive.
    },
});

export const getShopIssueRecords = query({
    args: {
        shopId: v.optional(v.id("shops")),
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        if (args.shopId) {
            const shop = await ctx.db.get(args.shopId);
            if (!shop || shop.businessId !== businessId) {
                throw new ConvexError("Forbidden: that shop belongs to another business.");
            }
        }

        let q;
        if (args.shopId) {
            q = ctx.db
                .query("shopIssueRecords")
                .withIndex("by_businessId", (index) => index.eq("businessId", businessId))
                .filter((filter) => filter.eq(filter.field("shopId"), args.shopId));
            if (args.from && args.to) {
                q = q.filter(q => q.and(
                    q.gte(q.field("date"), args.from!),
                    q.lte(q.field("date"), args.to!.includes("T") ? args.to! : `${args.to!}T23:59:59.999Z`)
                ));
            }
        } else {
            q = ctx.db
                .query("shopIssueRecords")
                .withIndex("by_businessId", (index) => index.eq("businessId", businessId));
            if (args.from && args.to) {
                q = q.filter(q => q.and(
                    q.gte(q.field("date"), args.from!),
                    q.lte(q.field("date"), args.to!.includes("T") ? args.to! : `${args.to!}T23:59:59.999Z`)
                ));
            }
        }

        let records = await q.order("desc").collect();

        const [stocks, shops, users] = await Promise.all([
            Promise.all(records.map(r => ctx.db.get(r.stockId))),
            Promise.all(records.map(r => ctx.db.get(r.shopId))),
            Promise.all(records.map(r => ctx.db.get(r.userId))),
        ]);

        const stockMap = new Map(stocks.filter(s => s !== null).map(s => [s!._id, s]));
        const shopMap = new Map(shops.filter(s => s !== null).map(s => [s!._id, s]));
        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));

        // Apply search filter after enrichment if searchTerm is present
        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            records = records.filter(r => {
                const stock = stockMap.get(r.stockId);
                return (
                    stock?.name.toLowerCase().includes(search) ||
                    stock?.productCode.toLowerCase().includes(search)
                );
            });
        }

        return records.map(r => ({
            ...r,
            stockName: stockMap.get(r.stockId)?.name || "Unknown",
            productCode: stockMap.get(r.stockId)?.productCode || "N/A",
            halfPrice: stockMap.get(r.stockId)?.halfPrice || false,
            shopName: shopMap.get(r.shopId)?.name || "Unknown",
            userName: userMap.get(r.userId) ? `${userMap.get(r.userId)!.first_name} ${userMap.get(r.userId)!.last_name}` : "Unknown",
        }));
    },
});

export const getStockEntries = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        type: v.optional(v.string()), // "add" or "restock"
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        let q = ctx.db
            .query("stockEntries")
            .withIndex("by_businessId", (index) => index.eq("businessId", businessId));

        if (args.from && args.to) {
            q = q.filter(q => q.and(
                q.gte(q.field("date"), args.from!),
                q.lte(q.field("date"), args.to!)
            ));
        }

        if (args.type) {
            q = q.filter(q => q.eq(q.field("type"), args.type));
        }

        const entries = await q.order("desc").collect();

        const [stocks, users] = await Promise.all([
            Promise.all(entries.map(e => ctx.db.get(e.stockId))),
            Promise.all(entries.map(e => ctx.db.get(e.userId))),
        ]);

        const stockMap = new Map(stocks.filter(s => s !== null).map(s => [s!._id, s]));
        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));

        return entries.map(e => ({
            ...e,
            stockName: stockMap.get(e.stockId)?.name || "Unknown",
            productCode: stockMap.get(e.stockId)?.productCode || "N/A",
            userName: userMap.get(e.userId) ? `${userMap.get(e.userId)!.first_name} ${userMap.get(e.userId)!.last_name}` : "Unknown",
        }));
    },
});
