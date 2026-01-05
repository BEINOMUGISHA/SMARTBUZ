import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
// Trigger sync
import { paginationOptsValidator } from "convex/server";

export const list = query({
    args: { paginationOpts: paginationOptsValidator },
    handler: async (ctx, args) => {
        return await ctx.db.query("shops").order("desc").paginate(args.paginationOpts);
    },
});

export const listAll = query({
    args: {},
    handler: async (ctx) => {
        return await ctx.db.query("shops").order("desc").collect();
    },
});

export const getShop = query({
    args: { id: v.id("shops") },
    handler: async (ctx, args) => {
        return await ctx.db.get(args.id);
    },
});

export const create = mutation({
    args: {
        name: v.string(),
        serialNumber: v.string(),
        location: v.string(),
        contact: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        return await ctx.db.insert("shops", {
            ...args,
            issuedStocks: [],
        });
    },
});

export const update = mutation({
    args: {
        id: v.id("shops"),
        name: v.optional(v.string()),
        serialNumber: v.optional(v.string()),
        location: v.optional(v.string()),
        contact: v.optional(v.string()),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const { id, ...rest } = args;
        await ctx.db.patch(id, rest);
    },
});

export const remove = mutation({
    args: { id: v.id("shops") },
    handler: async (ctx, args) => {
        await ctx.db.delete(args.id);
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
    },
    handler: async (ctx, args) => {
        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

        // Merge or replace depending on business need - original logic seems to append
        const updatedStock = [...shop.issuedStocks, ...args.items];
        await ctx.db.patch(args.shopId, { issuedStocks: updatedStock });
    },
});

export const removeStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
    },
    handler: async (ctx, args) => {
        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

        const updatedStock = shop.issuedStocks.filter(s => s.stockId !== args.stockId);
        await ctx.db.patch(args.shopId, { issuedStocks: updatedStock });
    },
});

// Clear all stock from a shop (Dangerous)
export const clearStocks = mutation({
    args: { shopId: v.id("shops") },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.shopId, { issuedStocks: [] });
    },
});

// Adjust shop stock (Increase or Decrease)
export const adjustShopStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        newQty: v.number(),
    },
    handler: async (ctx, args) => {
        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

        const stockIndex = shop.issuedStocks.findIndex(s => s.stockId === args.stockId);
        if (stockIndex === -1) throw new Error("Item not found in shop");

        const currentQty = shop.issuedStocks[stockIndex].qty;
        const delta = args.newQty - currentQty;

        if (delta === 0) return; // No change

        if (delta > 0) {
            // INCREASE: Deduct from Warehouse, Add to Shop
            const warehouseStock = await ctx.db.get(args.stockId);
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
            const warehouseStock = await ctx.db.get(args.stockId);
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
    },
});

// Return entire stock to warehouse
export const returnShopStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
    },
    handler: async (ctx, args) => {
        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

        const stockItem = shop.issuedStocks.find(s => s.stockId === args.stockId);
        if (!stockItem) throw new Error("Item not found in shop");

        // Return quantity to warehouse
        const warehouseStock = await ctx.db.get(args.stockId);
        if (warehouseStock) {
            await ctx.db.patch(args.stockId, {
                qty: warehouseStock.qty + stockItem.qty
            });
        }

        // Remove from shop
        const updatedStocks = shop.issuedStocks.filter(s => s.stockId !== args.stockId);
        await ctx.db.patch(args.shopId, {
            issuedStocks: updatedStocks
        });
    },
});


export const transferStock = mutation({
    args: {
        shopId: v.id("shops"),
        stockId: v.id("stocks"),
        quantity: v.number(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        // 1. Validation
        if (args.quantity <= 0) throw new Error("Quantity must be greater than zero");

        const stock = await ctx.db.get(args.stockId);
        if (!stock) throw new Error("Stock item not found in warehouse");
        if (stock.qty < args.quantity) throw new Error(`Insufficient warehouse stock. Available: ${stock.qty}`);

        const shop = await ctx.db.get(args.shopId);
        if (!shop) throw new Error("Shop not found");

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

        // 4. Log Activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Transfer Stock",
            details: `Transferred ${args.quantity}x ${stock.name} to ${shop.name}`,
            timestamp: new Date().toISOString(),
        });
    },
});
