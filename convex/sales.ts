import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id, Doc } from "./_generated/dataModel";

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
            // [OPTIMIZED] Batch fetch all stocks first to avoid N+1
            const stockIds = args.items.map(i => i.stockId);
            const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
            const stockMap = new Map(stockDocs.filter((s): s is NonNullable<typeof s> => s !== null).map(s => [s._id, s]));

            for (const item of args.items) {
                const stock = stockMap.get(item.stockId);
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
        searchTerm: v.optional(v.string()),
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

        // Base Query Selection
        let salesQuery: any = ctx.db.query("sales"); // Use any to bypass complex Query vs QueryInitializer mismatch

        // 1. Determining Scope
        // If user is Shop User AND NOT Admin, restrict to shop.
        // If user is Admin, allow viewing all, or restrict to shop if they want (not implemented yet, defaults to all if no other filters)
        // However, if Admin IS assigned to a shop, they might want to see that shop's data by default?
        // User complaint: "Only and only sales for that shop".
        // Fix: If Admin, ignore shop restriction unless we add a UI toggle later. For now, assume Admin wants ALL.

        // User MUST be assigned to a shop
        if (!shop) {
            return {
                totalSales: 0,
                totalRegular: 0,
                totalHP: 0,
                count: 0
            };
        }

        if (args.from && args.to) {
            salesQuery = salesQuery.withIndex("by_shop_date", (q: any) =>
                q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!)
            );
        } else {
            salesQuery = salesQuery.withIndex("by_shop_date", (q: any) =>
                q.eq("shopId", shop._id)
            );
        }

        // 2. Apply Filters
        if (args.customerId) {
            salesQuery = salesQuery.filter((q: any) => q.eq(q.field("customerId"), args.customerId));
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                salesQuery = salesQuery.filter((q: any) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                salesQuery = salesQuery.filter((q: any) => q.eq(q.field("isLoan"), true));
            } else {
                salesQuery = salesQuery.filter((q: any) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        // 3. Collect & Search
        const sales = await salesQuery.collect();
        let filteredSales = sales;

        if (args.searchTerm) {
            const lowerSearch = args.searchTerm.toLowerCase();
            filteredSales = sales.filter((s: any) =>
                s.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                s._id.toLowerCase().includes(lowerSearch)
            );
        }

        // Calculate Stats
        const totalSales = filteredSales.reduce((sum: number, s: any) => sum + s.total, 0);
        const totalHP = filteredSales
            .filter((s: any) => s.clientType === "HP Client")
            .reduce((sum: number, s: any) => sum + s.total, 0);

        const totalRegular = totalSales - totalHP;

        return {
            totalSales,
            totalRegular,
            totalHP,
            count: filteredSales.length
        };
    },
});

// Paginated My Sales List
export const mySales = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        filterType: v.optional(v.string()), // "All", "Regular", "HP", "Loans"
        email: v.optional(v.string()), // Manual Auth
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()),
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

        // User MUST be assigned to a shop
        if (!shop) {
            return {
                page: [],
                isDone: true,
                continueCursor: "",
            };
        }

        // 1. Base Query Construction
        let salesQuery: any = ctx.db.query("sales");

        if (args.from && args.to) {
            salesQuery = salesQuery.withIndex("by_shop_date", (q: any) => q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        } else {
            salesQuery = salesQuery.withIndex("by_shop_date", (q: any) => q.eq("shopId", shop._id));
        }

        // 2. Apply Filters
        let filteredQuery = salesQuery;

        if (args.customerId) { // Apply customer filter if present, after shop scope
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("customerId"), args.customerId));
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("isLoan"), true));
            } else {
                filteredQuery = filteredQuery.filter((q: any) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        // 3. Search Logic (Pre-pagination filter is tricky without dedicated search index)
        // For now, we will paginate the filtered query.
        // Note: Real text search should use ctx.db.query("sales").withSearchIndex(...) but we are mixing filters.
        // If searchTerm exists, we might need to filter in memory or restricted scan.
        // Given pagination requirement, strict backend filtering is needed.
        // We will skip search filtering inside the pagination query for now to avoid breaking pagination logic,
        // but since we need search, we'll implement a 'scan' if search term is present.
        // WARNING: This is expensive on large datasets. Search Index is better long term.

        const results = await filteredQuery.order("desc").paginate(args.paginationOpts);

        // [OPTIMIZED] Enrichment Map Pattern
        const customerIds = [...new Set(results.page.map((s: any) => s.customerId).filter((id: any): id is Id<"customers"> => !!id))];
        const shopIds = [...new Set(results.page.map((s: any) => s.shopId).filter((id: any): id is Id<"shops"> => !!id))];
        const userIds = [...new Set(results.page.map((s: any) => s.userId))];

        const [customers, shops, users] = await Promise.all([
            Promise.all(customerIds.map((id: any) => ctx.db.get(id))),
            Promise.all(shopIds.map((id: any) => ctx.db.get(id))),
            Promise.all(userIds.map((id: any) => ctx.db.get(id))),
        ]);

        const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));
        const shopMap = new Map(shops.filter(s => s !== null).map(s => [s!._id, s]));
        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));

        // 4. Enrich & Client-Side Filter for Search (Paginated page only - acceptable for now)
        // To do full search properly, we'd need a separate endpoint or search index.

        const enrichedPage = results.page.map((sale: any) => {
            const customer = sale.customerId ? (customerMap.get(sale.customerId) ?? null) : null;
            const shop = sale.shopId ? (shopMap.get(sale.shopId) ?? null) : null;
            const userDoc = userMap.get(sale.userId) as Doc<"users"> | undefined;

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
        });

        // Filter enriched page by search term if exists (Note: this effectively reduces page size, which is a trade-off)
        if (args.searchTerm) {
            const lowerSearch = args.searchTerm.toLowerCase();
            const filteredPage = enrichedPage.filter((s: any) =>
                s.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                s.customer?.name.toLowerCase().includes(lowerSearch) ||
                s._id.toLowerCase().includes(lowerSearch)
            );
            return {
                ...results,
                page: filteredPage
            };
        }

        return {
            ...results,
            page: enrichedPage,
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
        searchTerm: v.optional(v.string()), // Added for consistency
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

        // User MUST be assigned to a shop to see "My Sales" stats (even Admin)
        if (!shop) return 0;

        let salesQuery: any = ctx.db.query("sales");

        // Always scope by shop
        if (args.from && args.to) {
            salesQuery = salesQuery.withIndex("by_shop_date", (q: any) => q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        } else {
            salesQuery = salesQuery.withIndex("by_shop_date", (q: any) => q.eq("shopId", shop._id));
        }

        // Apply Filters
        let filteredQuery = salesQuery;

        if (args.customerId) {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("customerId"), args.customerId));
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("isLoan"), true));
            } else {
                filteredQuery = filteredQuery.filter((q: any) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        return (await filteredQuery.collect()).length;
    },
});

