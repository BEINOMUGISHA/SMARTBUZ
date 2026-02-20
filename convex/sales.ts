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
        initialDeposit: v.optional(v.number()),
        packageType: v.optional(v.string()), // Bronze, Silver, Gold
        deliveryStatus: v.optional(v.string()), // Taken, Pending
        customerPhone: v.optional(v.string()),
        customerLocation: v.optional(v.string()),
        transactionType: v.optional(v.string()), // Sale, Swap
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
            // SHOP SALE: Deduct from shop.issuedStocks (ALLOW NEGATIVE)
            const updatedStocks = [...shop.issuedStocks];

            for (const item of args.items) {
                const stockIndex = updatedStocks.findIndex(s => s.stockId === item.stockId);
                if (stockIndex === -1) {
                    throw new Error(`Item ${item.name} not found in shop stock`);
                }

                const currentQty = updatedStocks[stockIndex].qty;
                // [CHANGED] We allow negative stock now as per user request
                // if (currentQty < item.quantity) {
                //     throw new Error(`Insufficient stock for ${item.name} in shop. Available: ${currentQty}`);
                // }

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
            // HQ SALE: Deduct from main warehouse 'stocks' (ALLOW NEGATIVE)
            // [OPTIMIZED] Batch fetch all stocks first to avoid N+1
            const stockIds = args.items.map(i => i.stockId);
            const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
            const stockMap = new Map(stockDocs.filter((s): s is NonNullable<typeof s> => s !== null).map(s => [s._id, s]));

            for (const item of args.items) {
                const stock = stockMap.get(item.stockId);
                if (!stock) {
                    throw new Error(`Item ${item.name} not found in warehouse`);
                }

                // [CHANGED] We allow negative stock now as per user request
                // if (stock.qty < item.quantity) {
                //     throw new Error(`Insufficient stock for ${item.name} in warehouse. Available: ${stock.qty}`);
                // }

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
            initialDeposit: args.initialDeposit,
            packageType: args.packageType,
            deliveryStatus: args.deliveryStatus,
            customerPhone: args.customerPhone,
            customerLocation: args.customerLocation,
            transactionType: args.transactionType || "Sale",
        });

        // ---------------------------------------------------------
        // PROMOTION TRIGGER LOGIC
        // ---------------------------------------------------------
        const triggeredRedemptions = [];

        // 1. Fetch all active promotions
        const activePromotions = await ctx.db
            .query("promotions")
            .filter(q => q.eq(q.field("isActive"), true))
            .collect();

        if (activePromotions.length > 0) {
            const activePromoIds = new Set(activePromotions.map(p => p._id));

            // 2. Fetch products linked to these promotions (for Product-type triggers)
            const cartStockIds = new Set(args.items.map(i => i.stockId));
            const allPromotionProducts = await ctx.db
                .query("promotionProducts")
                .collect();
            const relevantPromoProducts = allPromotionProducts.filter(pp =>
                activePromoIds.has(pp.promotionId) && cartStockIds.has(pp.stockId)
            );

            // 3. Check for Product Triggers
            for (const item of args.items) {
                const triggers = relevantPromoProducts.filter(pp => pp.stockId === item.stockId);
                for (const trigger of triggers) {
                    const promotion = activePromotions.find(p => p._id === trigger.promotionId);
                    if (!promotion) continue;
                    const redemptionCount = Math.floor(item.quantity / trigger.requiredQuantity);
                    if (redemptionCount > 0) {
                        const redemptionData = {
                            promotionId: promotion._id,
                            salesId: saleId,
                            customerId: args.customerId,
                            userId: args.userId,
                            shopId: shop ? shop._id : args.shopId,
                            date,
                            redeemedQuantity: redemptionCount,
                            productName: item.name,
                            productCode: item.productCode,
                            prize: promotion.prize,
                        };
                        await ctx.db.insert("promotionRedemptions", redemptionData);
                        triggeredRedemptions.push({ ...redemptionData, promotionName: promotion.name });
                    }
                }
            }

            // 4. Check for Global Threshold Triggers (Total PV/BV)
            const totalPV = args.items.reduce((sum, item) => sum + (item.pv * item.quantity), 0);
            const totalBV = args.items.reduce((sum, item) => sum + (item.bv * item.quantity), 0);

            for (const promotion of activePromotions) {
                if (promotion.triggerType === "TotalPV" && promotion.threshold && totalPV >= promotion.threshold) {
                    const redemptionCount = Math.floor(totalPV / promotion.threshold);
                    if (redemptionCount > 0) {
                        const redemptionData = {
                            promotionId: promotion._id,
                            salesId: saleId,
                            customerId: args.customerId,
                            userId: args.userId,
                            shopId: shop ? shop._id : args.shopId,
                            date,
                            redeemedQuantity: redemptionCount,
                            productName: "WHOLE SALE (PV)",
                            productCode: "THRESHOLD",
                            prize: promotion.prize,
                        };
                        await ctx.db.insert("promotionRedemptions", redemptionData);
                        triggeredRedemptions.push({ ...redemptionData, promotionName: promotion.name });
                    }
                } else if (promotion.triggerType === "TotalBV" && promotion.threshold && totalBV >= promotion.threshold) {
                    const redemptionCount = Math.floor(totalBV / promotion.threshold);
                    if (redemptionCount > 0) {
                        const redemptionData = {
                            promotionId: promotion._id,
                            salesId: saleId,
                            customerId: args.customerId,
                            userId: args.userId,
                            shopId: shop ? shop._id : args.shopId,
                            date,
                            redeemedQuantity: redemptionCount,
                            productName: "WHOLE SALE (BV)",
                            productCode: "THRESHOLD",
                            prize: promotion.prize,
                        };
                        await ctx.db.insert("promotionRedemptions", redemptionData);
                        triggeredRedemptions.push({ ...redemptionData, promotionName: promotion.name });
                    }
                }
            }
        }
        // ---------------------------------------------------------

        // Handle Loans
        if (args.isLoan && args.paymentDueDate) {
            const deposit = args.initialDeposit || 0;
            const loanBalance = args.total - deposit;

            const loanId = await ctx.db.insert("loans", {
                customerId: args.customerId !== undefined ? args.customerId : undefined, // Explicitly undefined if missing
                manualCustomerName: args.manualCustomerName,
                salesId: saleId,
                amount: args.total,
                balance: loanBalance,
                date: new Date().toISOString(),
            });

            // If there's an initial deposit, record it as a payment
            if (deposit > 0) {
                await ctx.db.insert("payments", {
                    loanId: loanId,
                    shopId: shop?._id,
                    customerId: args.customerId,
                    amount: deposit,
                    date: new Date().toISOString(),
                    balance: loanBalance,
                });
            }
        }

        // Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Create Sale",
            details: `${args.clientType} sale of UGX ${args.total.toLocaleString()} created at ${shop ? shop.name : "HQ"}.`,
            timestamp: new Date().toISOString(),
        });

        return { saleId, redemptions: triggeredRedemptions };
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
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        transactionType: v.optional(v.string()),
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

        // 2. Apply Filters (REMOVE loan exclusion for Hybrid view)
        if (args.customerId) {
            salesQuery = salesQuery.filter((q: any) => q.eq(q.field("customerId"), args.customerId));
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                salesQuery = salesQuery.filter((q: any) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                salesQuery = salesQuery.filter((q: any) =>
                    q.or(
                        q.eq(q.field("isLoan"), true),
                        q.eq(q.field("paymentMode"), "Loan")
                    )
                );
            } else if (args.filterType === "Walk-in") {
                salesQuery = salesQuery.filter((q: any) => q.eq(q.field("customerId"), undefined));
            } else {
                salesQuery = salesQuery.filter((q: any) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        if (args.packageType) {
            salesQuery = salesQuery.filter((q: any) => q.eq(q.field("packageType"), args.packageType));
        }

        if (args.deliveryStatus) {
            salesQuery = salesQuery.filter((q: any) => q.eq(q.field("deliveryStatus"), args.deliveryStatus));
        }
        if (args.transactionType && args.transactionType !== "All") {
            salesQuery = salesQuery.filter((q: any) => q.eq(q.field("transactionType"), args.transactionType));
        }

        // 3. Fetch Data for Audit
        const sales = await salesQuery.collect();
        const paymentsQuery = ctx.db
            .query("payments")
            .withIndex("by_shop_date", (q: any) =>
                q.eq("shopId", shop._id)
                    .gte("date", args.from || "0")
                    .lte("date", args.to || "z")
            );

        const allPayments = await paymentsQuery.collect();

        // 4. apply Search/Customer filters to both Sales AND Payments for consistent auditing
        let filteredSales = sales;
        let filteredPayments = allPayments;

        if (args.customerId) {
            filteredPayments = allPayments.filter((p: any) => p.customerId === args.customerId);
        }

        if (args.searchTerm) {
            const lowerSearch = args.searchTerm.toLowerCase();
            const customerIds = [...new Set(sales.map((s: any) => s.customerId).filter((id: any): id is Id<"customers"> => !!id))];
            const customers = await Promise.all(customerIds.map((id: any) => ctx.db.get(id)));
            const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));

            filteredSales = sales.filter((s: any) => {
                const customer = s.customerId ? (customerMap.get(s.customerId) as any) : null;
                return s.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                    s._id.toLowerCase().includes(lowerSearch) ||
                    customer?.name?.toLowerCase().includes(lowerSearch) ||
                    customer?.distributorId?.toLowerCase().includes(lowerSearch);
            });

            // For payments search, we'd need to fetch loans/sales... For now, we'll audit against filtered sales
            // A professional audit usually filters Volume by search, but Collection is often "All Cash In".
            // However, for consistency, let's just use the shop-scoped flows if no specific customer is selected.
        }

        // 5. Calculate Stats (Comprehensive Net Audit Model)
        let totalVolume = 0;
        let totalCollected = 0;
        let totalOutstanding = 0;

        // VOLUME: Value of goods moved in this period
        filteredSales.forEach((s: any) => {
            totalVolume += (s.total || 0);
        });

        // COLLECTION: Total physical cash received in this period (Retail + Deposits + Installments)
        // Includes non-loan sales + all payments in the period
        const cashSalesOnly = filteredSales.filter((s: any) => !s.isLoan && s.paymentMode !== "Loan" && s.paymentMode !== "Swap");
        const cashTotals = cashSalesOnly.reduce((sum: number, s: any) => sum + (s.total || 0), 0);
        const paymentTotals = filteredPayments.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

        totalCollected = cashTotals + paymentTotals;

        // OUTSTANDING: The net growth/reduction of debt in the shop's books for this period
        // Identity: Volume (Items Out) = Collection (Cash In) + Outstanding (Unpaid Gap)
        totalOutstanding = totalVolume - totalCollected;

        return {
            totalVolume,
            totalCollected,
            totalOutstanding,
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
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        transactionType: v.optional(v.string()),
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

        // 2. Apply Filters (REMOVE restriction for Hybrid view)
        let filteredQuery = salesQuery;

        if (args.customerId) { // Apply customer filter if present, after shop scope
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("customerId"), args.customerId));
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                filteredQuery = filteredQuery.filter((q: any) =>
                    q.or(
                        q.eq(q.field("isLoan"), true),
                        q.eq(q.field("paymentMode"), "Loan")
                    )
                );
            } else if (args.filterType === "Walk-in") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("customerId"), undefined));
            } else {
                filteredQuery = filteredQuery.filter((q: any) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        if (args.packageType) {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("packageType"), args.packageType));
        }

        if (args.deliveryStatus) {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("deliveryStatus"), args.deliveryStatus));
        }

        if (args.transactionType && args.transactionType !== "All") {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("transactionType"), args.transactionType));
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

        const [customers, shops, users, loans] = await Promise.all([
            Promise.all(customerIds.map((id: any) => ctx.db.get(id))),
            Promise.all(shopIds.map((id: any) => ctx.db.get(id))),
            Promise.all(userIds.map((id: any) => ctx.db.get(id))),
            Promise.all(results.page.filter((s: any) => s.isLoan === true || s.paymentMode === "Loan").map((s: any) =>
                ctx.db.query("loans").withIndex("by_salesId", (q: any) => q.eq("salesId", s._id)).first()
            )),
        ]);

        const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));
        const shopMap = new Map(shops.filter(s => s !== null).map(s => [s!._id, s]));
        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));
        const loanMap = new Map(loans.filter(l => l !== null).map(l => [l!.salesId, l]));

        // 4. Enrich & Client-Side Filter for Search (Paginated page only - acceptable for now)
        // To do full search properly, we'd need a separate endpoint or search index.

        const enrichedPage = results.page.map((sale: any) => {
            const customer = sale.customerId ? (customerMap.get(sale.customerId) ?? null) : null;
            const shop = sale.shopId ? (shopMap.get(sale.shopId) ?? null) : null;
            const userDoc = userMap.get(sale.userId) as Doc<"users"> | undefined;
            const loan = loanMap.get(sale._id) ?? null;

            const operatorName = userDoc
                ? `${userDoc.first_name} ${userDoc.last_name}${userDoc.middle_name ? ` ${userDoc.middle_name}` : ""}`
                : "Unknown";

            return {
                ...sale,
                customer,
                shop,
                loan,
                operator: userDoc ? {
                    name: operatorName,
                    phone: userDoc.phone_number,
                    email: userDoc.email,
                } : null,
            };
        });

        // Filter enriched page by search term if exists (Note: this effectively reduces page size, which is a trade-off)
        const filteredPage = enrichedPage.filter((s: any) => {
            const matchesSearch = !args.searchTerm || (
                s.manualCustomerName?.toLowerCase().includes(args.searchTerm.toLowerCase()) ||
                s.customer?.name.toLowerCase().includes(args.searchTerm.toLowerCase()) ||
                s.customer?.distributorId?.toLowerCase().includes(args.searchTerm.toLowerCase()) ||
                s._id.toLowerCase().includes(args.searchTerm.toLowerCase())
            );
            return matchesSearch;
        });

        return {
            ...results,
            page: filteredPage,
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
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        transactionType: v.optional(v.string()),
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

        // Apply Filters (REMOVE restriction for Hybrid view)
        let filteredQuery = salesQuery;

        if (args.customerId) {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("customerId"), args.customerId));
        }

        if (args.filterType && args.filterType !== "All") {
            if (args.filterType === "HP") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("clientType"), "HP Client"));
            } else if (args.filterType === "Loans") {
                filteredQuery = filteredQuery.filter((q: any) =>
                    q.or(
                        q.eq(q.field("isLoan"), true),
                        q.eq(q.field("paymentMode"), "Loan")
                    )
                );
            } else if (args.filterType === "Walk-in") {
                filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("customerId"), undefined));
            } else {
                filteredQuery = filteredQuery.filter((q: any) => q.neq(q.field("clientType"), "HP Client"));
            }
        }

        if (args.packageType) {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("packageType"), args.packageType));
        }

        if (args.deliveryStatus) {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("deliveryStatus"), args.deliveryStatus));
        }

        if (args.transactionType && args.transactionType !== "All") {
            filteredQuery = filteredQuery.filter((q: any) => q.eq(q.field("transactionType"), args.transactionType));
        }

        // Apply Search Filter if needed
        if (args.searchTerm) {
            const lowerSearch = args.searchTerm.toLowerCase();
            const sales = await filteredQuery.collect();

            const customerIds = [...new Set(sales.map((s: any) => s.customerId).filter((id: any): id is Id<"customers"> => !!id))];
            const customers = await Promise.all(customerIds.map((id: any) => ctx.db.get(id)));
            const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));

            const searchedSales = sales.filter((s: any) => {
                const customer = s.customerId ? (customerMap.get(s.customerId) as any) : null;
                return s.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                    s._id.toLowerCase().includes(lowerSearch) ||
                    customer?.name?.toLowerCase().includes(lowerSearch) ||
                    customer?.distributorId?.toLowerCase().includes(lowerSearch);
            });
            return searchedSales.length;
        }

        return (await filteredQuery.collect()).length;
    },
});


export const swap = mutation({
    args: {
        userId: v.id("users"),
        shopId: v.optional(v.id("shops")),
        customerPhone: v.optional(v.string()),
        customerLocation: v.optional(v.string()),
        returnedItems: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            quantity: v.number(),
            productCode: v.optional(v.string()),
        })),
        takenItems: v.array(v.object({
            stockId: v.id("stocks"),
            name: v.string(),
            quantity: v.number(),
            productCode: v.optional(v.string()),
            price: v.number(),
            pv: v.number(),
            bv: v.number(),
        })),
    },
    handler: async (ctx, args) => {
        const date = new Date().toISOString();

        // 1. Identify Shop/Warehouse
        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", args.userId))
            .first();

        // 2. Handle Returned Items (Increase Stock)
        if (shop) {
            const updatedShopStocks = [...shop.issuedStocks];
            for (const item of args.returnedItems) {
                const idx = updatedShopStocks.findIndex(s => s.stockId === item.stockId);
                if (idx !== -1) {
                    updatedShopStocks[idx] = { ...updatedShopStocks[idx], qty: updatedShopStocks[idx].qty + item.quantity };
                }
            }
            await ctx.db.patch(shop._id, { issuedStocks: updatedShopStocks });
        } else {
            for (const item of args.returnedItems) {
                const stock = await ctx.db.get(item.stockId);
                if (stock) {
                    await ctx.db.patch(item.stockId, { qty: stock.qty + item.quantity });
                }
            }
        }

        // 3. Handle Taken Items (Decrease Stock)
        if (shop) {
            const updatedShopStocks = [...shop.issuedStocks];
            for (const item of args.takenItems) {
                const idx = updatedShopStocks.findIndex(s => s.stockId === item.stockId);
                if (idx !== -1) {
                    updatedShopStocks[idx] = { ...updatedShopStocks[idx], qty: updatedShopStocks[idx].qty - item.quantity };
                }
            }
            await ctx.db.patch(shop._id, { issuedStocks: updatedShopStocks });
        } else {
            for (const item of args.takenItems) {
                const stock = await ctx.db.get(item.stockId);
                if (stock) {
                    await ctx.db.patch(item.stockId, { qty: stock.qty - item.quantity });
                }
            }
        }

        // 4. Record as a Swap Entry in Sales
        // We use the 'taken' items as the 'sale' items for indexing, but mark type as "Swap"
        const totalValue = args.takenItems.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        const saleId = await ctx.db.insert("sales", {
            userId: args.userId,
            shopId: shop?._id || args.shopId,
            total: totalValue,
            date,
            clientType: "Retail", // Default for swap
            paymentMode: "Swap",
            transactionType: "Swap",
            customerPhone: args.customerPhone,
            customerLocation: args.customerLocation,
            items: args.takenItems.map(i => ({
                ...i,
                productCode: i.productCode || "N/A",
            })),
            returnedItems: args.returnedItems.map(i => ({
                ...i,
                productCode: i.productCode || "N/A",
            })),
            deliveryStatus: "Taken",
        });

        // 5. Log activity
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Product Swap",
            details: `Swapped items for customer at ${shop ? shop.name : "HQ"}.`,
            timestamp: date,
        });

        return saleId;
    },
});

export const getSale = query({
    args: { id: v.id("sales") },
    handler: async (ctx, args) => {
        const sale = await ctx.db.get(args.id);
        if (!sale) return null;

        const [customer, shop, user] = await Promise.all([
            sale.customerId ? ctx.db.get(sale.customerId) : null,
            sale.shopId ? ctx.db.get(sale.shopId) : null,
            ctx.db.get(sale.userId),
        ]);

        return {
            ...sale,
            customer,
            shop,
            user,
        };
    },
});
