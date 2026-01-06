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
        manualCustomerName: v.optional(v.string()),
        shopId: v.optional(v.id("shops")),
        userId: v.id("users"),
        total: v.number(),
        clientType: v.string(), // "Member", "Non-Member", "Working Client", "Half-Price (HP) Client"
        paymentMode: v.string(),
        items: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            productCode: v.string(),
            price: v.number(),
            quantity: v.number(),
            pv: v.number(),
            bv: v.number(),
        })),
        isLoan: v.optional(v.boolean()),
        paymentDueDate: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        console.log(`Creating sale for user ${args.userId} (Client: ${args.clientType})`);
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
            manualCustomerName: args.manualCustomerName,
            shopId: shop ? shop._id : args.shopId, // Prioritize found shop, else fallback to arg
            userId: args.userId,
            total: args.total,
            date,
            clientType: args.clientType,
            paymentMode: args.paymentMode,
            items: args.items,
            isLoan: args.isLoan,
            paymentDueDate: args.paymentDueDate,
        });

        // Handle Loans
        if (args.isLoan && args.customerId && args.paymentDueDate) {
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

// Get My Sales Stats (Total, Cash, HP, etc.) for a date range
export const mySalesStats = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        filterType: v.optional(v.string()), // "All", "Regular", "HP"
        email: v.optional(v.string()), // Manual Auth
        customerId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        if (!args.email) throw new Error("Unauthorized");

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first();
        if (!user) throw new Error("User not found");

        // Find user's shop
        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        // Base Query
        let salesQuery = ctx.db.query("sales");

        // Filter by Shop (if user has one)
        if (shop) {
            salesQuery = salesQuery.filter((q) => q.eq(q.field("shopId"), shop._id));
        }
        // If no shop, do we show ALL sales? Or just their own?
        // User said "display sales for this shop". If HQ (no shop), maybe show all?
        // Let's assume HQ sees all, Shop User sees Shop.

        // Date Filter
        if (args.from && args.to) {
            const fromDate = args.from;
            const toDate = args.to;
            salesQuery = salesQuery.filter((q) =>
                q.and(
                    q.gte(q.field("date"), fromDate),
                    q.lte(q.field("date"), toDate)
                )
            );
        }

        // Type Filter
        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                salesQuery = salesQuery.filter((q) => q.eq(q.field("clientType"), "HP Client"));
            } else {
                salesQuery = salesQuery.filter((q) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        if (args.customerId) {
            salesQuery = salesQuery.filter((q) => q.eq(q.field("customerId"), args.customerId));
        }

        const sales = await salesQuery.collect();

        // Calculate Stats
        const totalSales = sales.reduce((sum, s) => sum + s.total, 0);
        const totalHP = sales
            .filter((s) => s.clientType === "HP Client")
            .reduce((sum, s) => sum + s.total, 0);
        // Assuming "regular" is non-HP
        const totalRegular = totalSales - totalHP;

        return {
            totalSales,
            totalRegular,
            totalHP,
            count: sales.length
        };
    },
});

// Paginated My Sales List
export const mySales = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        filterType: v.optional(v.string()), // "All", "Regular", "HP"
        email: v.optional(v.string()), // Manual Auth
        customerId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        if (!args.email) throw new Error("Unauthorized");

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first();
        if (!user) throw new Error("User not found");

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        let salesQuery = ctx.db.query("sales");

        if (shop) {
            salesQuery = salesQuery.filter((q) => q.eq(q.field("shopId"), shop._id));
        }

        if (args.from && args.to) {
            const fromDate = args.from;
            const toDate = args.to;
            salesQuery = salesQuery.filter((q) =>
                q.and(
                    q.gte(q.field("date"), fromDate),
                    q.lte(q.field("date"), toDate)
                )
            );
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                salesQuery = salesQuery.filter((q) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                salesQuery = salesQuery.filter((q) => q.eq(q.field("isLoan"), true));
            } else {
                salesQuery = salesQuery.filter((q) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        if (args.customerId) {
            salesQuery = salesQuery.filter((q) => q.eq(q.field("customerId"), args.customerId));
        }

        const results = await salesQuery.order("desc").paginate(args.paginationOpts);

        return {
            ...results,
            page: await Promise.all(
                results.page.map(async (sale) => {
                    const customer = sale.customerId ? await ctx.db.get(sale.customerId) : null;
                    const shop = sale.shopId ? await ctx.db.get(sale.shopId) : null;
                    const userDoc = await ctx.db.get(sale.userId);

                    const operatorName = userDoc
                        ? `${userDoc.first_name} ${userDoc.last_name}${userDoc.middle_name ? ` ${userDoc.middle_name}` : ""}`
                        : "Unknown";

                    return {
                        ...sale,
                        customer,
                        shop,
                        operator: userDoc ? {
                            name: operatorName,
                            phone: userDoc.phone_number,
                            email: userDoc.email,
                        } : null,
                    };
                })
            ),
        };
    },
});

export const mySalesCount = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        filterType: v.optional(v.string()),
        email: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        if (!args.email) return 0;

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first();
        if (!user) return 0;

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        let salesQuery = ctx.db.query("sales");

        if (shop) {
            salesQuery = salesQuery.filter((q) => q.eq(q.field("shopId"), shop._id));
        }

        if (args.from && args.to) {
            const fromDate = args.from;
            const toDate = args.to;
            salesQuery = salesQuery.filter((q) =>
                q.and(
                    q.gte(q.field("date"), fromDate),
                    q.lte(q.field("date"), toDate)
                )
            );
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                salesQuery = salesQuery.filter((q) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                salesQuery = salesQuery.filter((q) => q.eq(q.field("isLoan"), true));
            } else {
                salesQuery = salesQuery.filter((q) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        if (args.customerId) {
            salesQuery = salesQuery.filter((q) => q.eq(q.field("customerId"), args.customerId));
        }

        return (await salesQuery.collect()).length;
    },
});
