import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id } from "./_generated/dataModel";

// List sales with pagination
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        let salesQuery = ctx.db.query("sales");

        // Simple filter by date range if provided
        if (args.startDate && args.endDate) {
            const start = args.startDate;
            const end = args.endDate;
            salesQuery = salesQuery.filter((q) =>
                q.and(
                    q.gte(q.field("date"), start),
                    q.lte(q.field("date"), end)
                )
            );
        }

        return await salesQuery.order("desc").paginate(args.paginationOpts);
    },
});

// Create sale (Mutation includes updating stock quantities and optional loans)
export const create = mutation({
    args: {
        customerId: v.optional(v.id("customers")),
        shopId: v.optional(v.id("shops")),
        userId: v.id("users"),
        total: v.number(),
        clientType: v.string(), // "Member", "Non-Member", "Working Client", "Half-Price (HP) Client"
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            price: v.number(),
            quantity: v.number(),
            pv: v.number(),
            bv: v.number(),
        })),
        isLoan: v.optional(v.boolean()),
        paymentDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const date = new Date().toISOString();

        // Check if user is assigned to a shop
        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .first();

        // Deduct Stock
        if (shop) {
            // SHOP SALE: Deduct from shop.issuedStocks
            const updatedStocks = [...shop.issuedStocks];

            for (const item of args.items) {
                const stockIndex = updatedStocks.findIndex(s => s.stockId === item.stockId);
                if (stockIndex === -1) {
                    throw new Error(`Item ${item.name} not found in shop stock`);
                }

                const currentQty = updatedStocks[stockIndex].qty;
                if (currentQty < item.quantity) {
                    throw new Error(`Insufficient stock for ${item.name} in shop. Available: ${currentQty}`);
                }

                updatedStocks[stockIndex] = {
                    ...updatedStocks[stockIndex],
                    qty: currentQty - item.quantity
                };
            }

            // Update shop stocks
            await ctx.db.patch(shop._id, {
                issuedStocks: updatedStocks
            });

        } else {
            // HQ SALE: Deduct from main warehouse 'stocks'
            for (const item of args.items) {
                const stock = await ctx.db.get(item.stockId);
                if (!stock) {
                    throw new Error(`Item ${item.name} not found in warehouse`);
                }

                if (stock.qty < item.quantity) {
                    throw new Error(`Insufficient stock for ${item.name} in warehouse. Available: ${stock.qty}`);
                }

                await ctx.db.patch(item.stockId, {
                    qty: stock.qty - item.quantity,
                });
            }
        }

        // Record the sale
        const saleId = await ctx.db.insert("sales", {
            customerId: args.customerId,
            shopId: shop ? shop._id : args.shopId, // Prioritize found shop, else fallback to arg
            userId: args.userId,
            total: args.total,
            date,
            clientType: args.clientType,
            items: args.items,
        });

        // Handle Loans
        if (args.isLoan && args.customerId && args.paymentDate) {
            await ctx.db.insert("loans", {
                customerId: args.customerId,
                salesId: saleId,
                amount: args.total,
                balance: args.total,
                date: new Date().toISOString(),
            });
        }

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Create Sale",
            details: `${args.clientType} sale of UGX ${args.total.toLocaleString()} created at ${shop ? shop.name : "HQ"}.`,
            timestamp: new Date().toISOString(),
        });

        return saleId;
    },
});
