import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";

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

        // 1. Record the sale
        const saleId = await ctx.db.insert("sales", {
            customerId: args.customerId,
            shopId: args.shopId,
            userId: args.userId,
            total: args.total,
            date,
            clientType: args.clientType,
            items: args.items,
        });

        // 2. Update stock quantities (Deduct)
        for (const item of args.items) {
            // Deduct from main stock
            const stock = await ctx.db.get(item.stockId);
            if (stock) {
                await ctx.db.patch(item.stockId, {
                    qty: Math.max(0, stock.qty - item.quantity),
                });
            }

            // If shop sale, deduct from shop issuedStocks too
            if (args.shopId) {
                const shop = await ctx.db.get(args.shopId);
                if (shop) {
                    const issuedStocks = shop.issuedStocks.map((s) => {
                        if (s.stockId === item.stockId) {
                            return { ...s, qty: Math.max(0, s.qty - item.quantity) };
                        }
                        return s;
                    });
                    await ctx.db.patch(args.shopId, { issuedStocks });
                }
            }
        }

        // 3. Handle Loan
        if (args.isLoan && args.customerId && args.paymentDate) {
            await ctx.db.insert("loans", {
                customerId: args.customerId,
                salesId: saleId,
                amount: args.total,
                balance: args.total,
                date: args.paymentDate,
            });
        }

        // 4. Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Create Sale",
            details: `${args.clientType} sale of UGX ${args.total.toLocaleString()} created.`,
            timestamp: date,
        });

        return saleId;
    },
});
