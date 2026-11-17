import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
// Trigger sync
import { paginationOptsValidator } from "convex/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";

/**
 * SMART_BUZ — shops (counters that stock has been issued to).
 *
 * A shop belongs to a business. Stock can only be issued to, taken from or
 * adjusted in a shop of the caller's own business.
 */

export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.view");

        return await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const listAll = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.view");

        return await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .collect();
    },
});

export const getPaginated = query({
    args: {
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.view");

        let results = await ctx.db
            .query("shops")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .collect();

        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            results = results.filter(s =>
                s.name.toLowerCase().includes(search) ||
                s.location.toLowerCase().includes(search)
            );
        }

        const totalCount = results.length;
        const page = results.slice(args.offset, args.offset + args.limit);

        return { page, totalCount };
    },
});

export const getShop = query({
    args: { id: v.id("shops"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.view");

        const shop = await ctx.db.get(args.id);
        if (!shop) return null;
        if (shop.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }
        return shop;
    },
});

export const getPaginatedShopStock = query({
    args: {
        shopId: v.id("shops"),
        limit: v.number(),
        offset: v.number(),
        searchTerm: v.optional(v.string()),
        halfPrice: v.optional(v.boolean()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const shop = await ctx.db.get(args.shopId);
        if (!shop) return { page: [], totalCount: 0, stats: { totalValue: 0, totalPV: 0, totalBV: 0, totalItems: 0 } };
        if (shop.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        let stocks = shop.issuedStocks || [];

        // Apply Search
        if (args.searchTerm) {
            const search = args.searchTerm.toLowerCase();
            stocks = stocks.filter(s =>
                s.name.toLowerCase().includes(search) ||
                (s.productCode && s.productCode.toLowerCase().includes(search))
            );
        }

        // Apply HP Filter
        if (args.halfPrice !== undefined) {
            stocks = stocks.filter(s => !!s.halfPrice === args.halfPrice);
        }

        const totalCount = stocks.length;

        // Calculate Stats for the ENTIRE filtered list (pre-pagination)
        const stats = stocks.reduce((acc, s) => ({
            totalValue: acc.totalValue + (s.qty * s.price),
            totalPV: acc.totalPV + (s.qty * (s.pv || 0)),
            totalBV: acc.totalBV + (s.qty * (s.bv || 0)),
            totalItems: acc.totalItems + s.qty
        }), { totalValue: 0, totalPV: 0, totalBV: 0, totalItems: 0 });

        // Paginate
        const page = stocks.slice(args.offset, args.offset + args.limit);

        return { page, totalCount, stats };
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        serialNumber: v.string(),
        location: v.string(),
        contact: v.string(),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        branchId: v.optional(v.id("branches")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.manage");
        const businessId = tenant.businessId;

        if (args.branchId) {
            const branch = await ctx.db.get(args.branchId);
            if (!branch || branch.businessId !== businessId) {
                throw new ConvexError("Forbidden: that branch belongs to another business.");
            }
        }

        const { userId, businessId: _ignored, ...shopArgs } = args;
        const shopId = await ctx.db.insert("shops", {
            ...shopArgs,
            businessId,
            userId: tenant.user._id,
            issuedStocks: [],
        });

        // Log activity
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Create Shop",
            `Created new shop: ${args.name} (${args.serialNumber}) at ${args.location}`
        );

        return shopId;
    },
});

export const update = mutation({
    args: {
        id: v.id("shops"),
        name: v.optional(v.string()),
        serialNumber: v.optional(v.string()),
        location: v.optional(v.string()),
        contact: v.optional(v.string()),
        userId: v.optional(v.id("users")), // @deprecated — the caller is derived from the session
        branchId: v.optional(v.id("branches")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.manage");

        const { id, userId, businessId: _ignored, ...rest } = args;
        const shop = await ctx.db.get(id);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        await ctx.db.patch(id, rest as any);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Shop",
            `Updated shop: ${shop.name} - Changes: ${changes}`
        );
    },
});

export const remove = mutation({
    args: {
        id: v.id("shops"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "branches.manage");

        const shop = await ctx.db.get(args.id);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Delete Shop",
            `Deleted shop: ${shop.name} (${shop.serialNumber}) at ${shop.location}`
        );
    },
});

export const issueStock = mutation({
    args: {
        shopId: v.id("shops"),
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            qty: v.number(),
            price: v.number(),
            productCode: v.string(),
            pv: v.number(),
            bv: v.number(),
            halfPrice: v.boolean(),
        })),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.transfer");
        const businessId = tenant.businessId;

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        for (const item of args.items) {
            const stock = await ctx.db.get(item.stockId);
            if (!stock || stock.businessId !== businessId) {
                throw new ConvexError("Forbidden: that product belongs to another business.");
            }
        }

        // Merge by product instead of appending: appending created a second
        // row for the same product and made the shop's inventory disagree
        // with the warehouse.
        const issued = [...shop.issuedStocks];
        for (const item of args.items) {
            const index = issued.findIndex(s => s.stockId === item.stockId);
            if (index >= 0) {
                issued[index] = {
                    ...issued[index],
                    qty: issued[index].qty + item.qty,
                    price: item.price,
                    pv: item.pv,
                    bv: item.bv,
                    halfPrice: item.halfPrice,
                };
            } else {
                issued.push(item);
            }
        }
        await ctx.db.patch(args.shopId, { issuedStocks: issued });

        // Log activity
        const itemSummary = args.items.map(i => `${i.name} (${i.qty})`).join(", ");
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Issue Stock to Shop",
            `Issued stock to ${shop.name}: ${itemSummary}`
        );
    },
});

export const removeStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.transfer");

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        const stockItem = shop.issuedStocks.find(s => s.stockId === args.stockId);
        const updatedStock = shop.issuedStocks.filter(s => s.stockId !== args.stockId);
        await ctx.db.patch(args.shopId, { issuedStocks: updatedStock });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Remove Stock from Shop",
            `Removed ${stockItem?.name || 'stock'} from ${shop.name}`
        );
    },
});

// Clear all stock from a shop (Dangerous)
export const clearStocks = mutation({
    args: {
        shopId: v.id("shops"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        await ctx.db.patch(args.shopId, { issuedStocks: [] });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Clear Shop Stocks",
            `Cleared all stock from ${shop.name} (${shop.issuedStocks.length} items removed)`
        );
    },
});

// Adjust shop stock (Increase or Decrease)
export const adjustShopStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        newQty: v.number(),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.adjust");
        const businessId = tenant.businessId;

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        const stockIndex = shop.issuedStocks.findIndex(s => s.stockId === args.stockId);
        if (stockIndex === -1) throw new Error("Item not found in shop");

        const currentQty = shop.issuedStocks[stockIndex].qty;
        const delta = args.newQty - currentQty;
        const stockName = shop.issuedStocks[stockIndex].name;

        if (delta === 0) return; // No change

        const warehouseStock = await ctx.db.get(args.stockId);
        if (warehouseStock && warehouseStock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }

        if (delta > 0) {
            // INCREASE: Deduct from Warehouse, Add to Shop
            if (!warehouseStock) throw new Error("Stock not found in warehouse");

            if (warehouseStock.qty < delta) {
                throw new Error(`Insufficient warehouse stock. Available: ${warehouseStock.qty}, Required: ${delta}`);
            }

            // Update Warehouse
            await ctx.db.patch(args.stockId, {
                qty: warehouseStock.qty - delta
            });
        } else {
            // DECREASE: Add abs(delta) to Warehouse, Deduct from Shop
            // If warehouse stock deleted (rare), we still return? Ideally yes.
            if (warehouseStock) {
                await ctx.db.patch(args.stockId, {
                    qty: warehouseStock.qty + Math.abs(delta)
                });
            }
        }

        // Update Shop Stock
        const updatedStocks = [...shop.issuedStocks];
        updatedStocks[stockIndex] = {
            ...updatedStocks[stockIndex],
            qty: args.newQty
        };

        await ctx.db.patch(args.shopId, {
            issuedStocks: updatedStocks
        });

        // Log activity
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Adjust Shop Stock",
            `Adjusted ${stockName} in ${shop.name}: ${currentQty} -> ${args.newQty} (${delta > 0 ? '+' : ''}${delta})`
        );
    },
});

// Return entire stock to warehouse
export const returnShopStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.transfer");
        const businessId = tenant.businessId;

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        const stockItem = shop.issuedStocks.find(s => s.stockId === args.stockId);
        if (!stockItem) throw new Error("Item not found in shop");

        // Return quantity to warehouse
        const warehouseStock = await ctx.db.get(args.stockId);
        if (warehouseStock && warehouseStock.businessId === businessId) {
            await ctx.db.patch(args.stockId, {
                qty: warehouseStock.qty + stockItem.qty
            });
        }

        // Remove from shop
        const updatedStocks = shop.issuedStocks.filter(s => s.stockId !== args.stockId);
        await ctx.db.patch(args.shopId, {
            issuedStocks: updatedStocks
        });

        // Log activity
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Return Stock to Warehouse",
            `Returned ${stockItem.name} (${stockItem.qty} units) from ${shop.name} to warehouse`
        );
    },
});

export const transferStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        quantity: v.number(),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.transfer");
        const businessId = tenant.businessId;

        // 1. Validation
        if (args.quantity <= 0) throw new Error("Quantity must be greater than zero");

        const stock = await ctx.db.get(args.stockId);
        if (!stock) throw new Error("Stock item not found in warehouse");
        if (stock.businessId !== businessId) {
            throw new ConvexError("Forbidden: that product belongs to another business.");
        }
        if (stock.qty < args.quantity) throw new Error(`Insufficient warehouse stock. Available: ${stock.qty}`);

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        // 2. Deduct from Main Warehouse
        await ctx.db.patch(args.stockId, {
            qty: stock.qty - args.quantity,
        });

        // 3. Add to Shop Inventory
        const existingItemIndex = shop.issuedStocks.findIndex(s => s.stockId === args.stockId);
        let newIssuedStocks = [...shop.issuedStocks];

        if (existingItemIndex >= 0) {
            // Update existing item
            const item = newIssuedStocks[existingItemIndex];
            newIssuedStocks[existingItemIndex] = {
                ...item,
                qty: item.qty + args.quantity,
                // Update details in case they changed in master stock
                price: stock.price,
                pv: stock.pv,
                bv: stock.bv,
                halfPrice: stock.halfPrice || false,
            };
        } else {
            // Add new item
            newIssuedStocks.push({
                stockId: stock._id,
                name: stock.name,
                productCode: stock.productCode,
                qty: args.quantity,
                price: stock.price,
                pv: stock.pv,
                bv: stock.bv,
                halfPrice: stock.halfPrice || false,
            });
        }

        await ctx.db.patch(args.shopId, { issuedStocks: newIssuedStocks });

        // 4. Record Issue History
        await ctx.db.insert("shopIssueRecords", {
            businessId,
            shopId: args.shopId,
            stockId: args.stockId,
            quantity: args.quantity,
            date: new Date().toISOString(),
            userId: tenant.user._id,
        });

        // 5. Log Activity
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Transfer Stock",
            `Transferred ${args.quantity}x ${stock.name} to ${shop.name}`
        );
    },
});

export const batchTransferStock = mutation({
    args: {
        shopId: v.id("shops"),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        items: v.array(v.object({
            stockId: v.id("stocks"),
            quantity: v.number(),
        })),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "inventory.transfer");
        const businessId = tenant.businessId;

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        let newIssuedStocks = [...shop.issuedStocks];
        let logs: string[] = [];

        for (const itemRequest of args.items) {
            const stock = await ctx.db.get(itemRequest.stockId);
            if (!stock) throw new Error(`Stock item ${itemRequest.stockId} not found`);
            if (stock.businessId !== businessId) {
                throw new ConvexError("Forbidden: that product belongs to another business.");
            }
            if (stock.qty < itemRequest.quantity) throw new Error(`Insufficient stock for ${stock.name}`);

            // Deduct from warehouse
            await ctx.db.patch(itemRequest.stockId, {
                qty: stock.qty - itemRequest.quantity
            });

            const existingIndex = newIssuedStocks.findIndex(s => s.stockId === itemRequest.stockId);
            if (existingIndex >= 0) {
                newIssuedStocks[existingIndex] = {
                    ...newIssuedStocks[existingIndex],
                    qty: newIssuedStocks[existingIndex].qty + itemRequest.quantity,
                    price: stock.price,
                    pv: stock.pv,
                    bv: stock.bv,
                    halfPrice: stock.halfPrice || false,
                };
            } else {
                newIssuedStocks.push({
                    stockId: stock._id,
                    name: stock.name,
                    productCode: stock.productCode,
                    qty: itemRequest.quantity,
                    price: stock.price,
                    pv: stock.pv,
                    bv: stock.bv,
                    halfPrice: stock.halfPrice || false,
                });
            }
            logs.push(`${itemRequest.quantity}x ${stock.name}`);
        }

        await ctx.db.patch(args.shopId, { issuedStocks: newIssuedStocks });

        // 4. Record Issue History
        for (const itemRequest of args.items) {
            await ctx.db.insert("shopIssueRecords", {
                businessId,
                shopId: args.shopId,
                stockId: itemRequest.stockId,
                quantity: itemRequest.quantity,
                date: new Date().toISOString(),
                userId: tenant.user._id,
            });
        }

        // 5. Log Activity
        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Batch Transfer Stock",
            `Transferred ${logs.join(", ")} to ${shop.name}`
        );
    }
});

export const getShopIssueRecords = query({
    args: {
        shopId: v.id("shops"),
        startDate: v.string(), // ISO
        endDate: v.string(),   // ISO
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");
        const businessId = tenant.businessId;

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");
        if (shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        // Query records within date range
        // Note: Convex doesn't support complex filtering on multiple fields easily without index
        // We use the index on shopId and date range
        const records = await ctx.db
            .query("shopIssueRecords")
            // using the index defined in schema: .index("by_shop_date", ["shopId", "date"])
            .withIndex("by_shop_date", (q) =>
                q.eq("shopId", args.shopId)
                    .gte("date", args.startDate)
                    .lte("date", args.endDate)
            )
            .order("desc")
            .collect();

        // Enrich with Stock and User details
        // We do this in-memory join. For large datasets, pagination would be better,
        // but for a daily/weekly report, this is acceptable.
        const enriched = await Promise.all(records.map(async (record) => {
            const stock = await ctx.db.get(record.stockId);
            const user = await ctx.db.get(record.userId);
            return {
                ...record,
                stockName: stock?.name || "Unknown Product",
                productCode: stock?.productCode || "N/A",
                userName: user ? `${user.first_name} ${user.last_name}` : "Unknown User"
            };
        }));

        return enriched;
    },
});
