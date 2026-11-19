import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id, Doc } from "./_generated/dataModel";
import { logActivity, requireBranchAccess, requirePermission, requireTenant } from "./tenancy";
import { writeAudit } from "./audit";
import {
    applySale,
    generateInvoiceNumber,
    processPromotionTriggers,
} from "./salesCore";

/**
 * SMART_BUZ — sales.
 *
 * A sale belongs to a business. The caller is derived from the signed
 * session, the products and customers are re-read from the database (the
 * client is never trusted for money), and every row that is written is
 * stamped with the tenant.
 */

// List sales with pagination
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        startDate: v.optional(v.string()),
        endDate: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");

        // Only this business's sales are visible, whatever the date range.
        let salesQuery = ctx.db
            .query("sales")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId));

        if (args.startDate && args.endDate) {
            salesQuery = salesQuery.filter((f) =>
                f.and(
                    f.gte(f.field("date"), args.startDate!),
                    f.lte(f.field("date"), args.endDate!)
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
            /** What the till believed was on hand, for an offline sale. */
            expectedQty: v.optional(v.number()),
        })),
        isLoan: v.optional(v.boolean()),
        paymentDueDate: v.optional(v.string()),
        initialDeposit: v.optional(v.number()),
        packageType: v.optional(v.string()), // Bronze, Silver, Gold
        deliveryStatus: v.optional(v.string()), // Taken, Pending
        customerPhone: v.optional(v.string()),
        customerLocation: v.optional(v.string()),
        transactionType: v.optional(v.string()), // Sale, Swap
        clientOfflineId: v.optional(v.string()), // Offline sync idempotency key
        isOfflineSync: v.optional(v.boolean()),
        /**
         * The payment provider's reference, when the payment was taken
         * through a provider.
         *
         * A sale with a reference stays `pending_verification` until the
         * provider confirms it. A sale without one was paid for in front
         * of the cashier.
         */
        paymentReference: v.optional(v.string()),
        // Optional till-level price overrides. They are only honoured when the
        // active business profile has `allowPriceOverrides` enabled; otherwise
        // the master price always wins.
        priceOverrides: v.optional(v.array(v.object({
            stockId: v.id("stocks"),
            price: v.number(),
        }))),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");

        // The operator is the authenticated caller — the `userId` argument
        // the browser sends is ignored.
        const userId = tenant.user._id;

        // The sale itself is applied in one place, so that a sale made
        // offline and pushed later is recorded exactly like one made with
        // the network up.
        const result = await applySale(ctx, args, {
            businessId: tenant.businessId,
            userId,
            allowPriceOverrides: tenant.business.allowPriceOverrides === true,
        });

        return {
            saleId: result.saleId,
            invoiceNumber: result.invoiceNumber,
            redemptions: result.redemptions,
            ...(result.isDuplicateSync ? { isDuplicateSync: true } : {}),
        };
    },
});

// Edit an existing sale - reverses ALL side-effects of the original sale and re-applies new ones.
// This affects: stock (warehouse/shop), loans, payments, promotion redemptions.
export const editSale = mutation({
    args: {
        saleId: v.id("sales"),
        userId: v.id("users"), // Acting user (for audit)
        // Editable fields (mirrors create)
        customerId: v.optional(v.id("customers")),
        manualCustomerName: v.optional(v.string()),
        total: v.number(),
        clientType: v.string(),
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
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        customerPhone: v.optional(v.string()),
        customerLocation: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.cancel");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const existingSale = await ctx.db.get(args.saleId);
        if (!existingSale) throw new Error("Sale not found");
        if (existingSale.businessId !== businessId) {
            throw new ConvexError("Forbidden: that sale belongs to another business.");
        }

        // Determine the shop context from the original sale (preserve original location)
        const shopId = existingSale.shopId;
        const shop = shopId ? await ctx.db.get(shopId) : null;
        if (shop && shop.businessId !== businessId) {
            throw new ConvexError("Forbidden: that shop belongs to another business.");
        }

        // -----------------------------------------------------------------
        // 0) SERVER-SIDE PRICE + TOTAL VALIDATION (same rules as `create`)
        // -----------------------------------------------------------------
        const editStockIds = [...new Set(args.items.map((i) => i.stockId))];
        const editPricingDocs = await Promise.all(editStockIds.map((id) => ctx.db.get(id)));
        const editPricingMap = new Map(
            editPricingDocs.filter((s): s is NonNullable<typeof s> => s !== null).map((s) => [s._id, s])
        );

        let editComputedTotal = 0;
        // Prices already agreed when the sale was recorded (a price override)
        // survive an edit: the effective price of a line stays what the
        // customer was charged. New overrides cannot be introduced here.
        const recordedOverrides = new Map(
            (existingSale.priceOverrides ?? []).map((o) => [o.stockId, o.price])
        );
        const editTrustedItems = args.items.map((item) => {
            const stock = editPricingMap.get(item.stockId);
            if (!stock) throw new Error(`Item ${item.name} not found`);
            if (stock.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that product belongs to another business."
                );
            }
            if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
                throw new Error(`Invalid quantity for ${item.name}`);
            }
            const unitPrice = recordedOverrides.get(item.stockId) ?? stock.price;
            editComputedTotal += unitPrice * item.quantity;
            return { ...item, price: unitPrice, pv: stock.pv, bv: stock.bv };
        });

        if (Math.abs(editComputedTotal - args.total) > 0.01) {
            throw new Error(
                `Sale total mismatch: client sent ${args.total} but the server computed ${editComputedTotal}.`
            );
        }

        // -----------------------------------------------------------------
        // 1) REVERSE original stock deductions
        // -----------------------------------------------------------------
        if (shop) {
            const updatedShopStocks = [...shop.issuedStocks];
            for (const item of existingSale.items) {
                const idx = updatedShopStocks.findIndex(s => s.stockId === item.stockId);
                if (idx !== -1) {
                    updatedShopStocks[idx] = {
                        ...updatedShopStocks[idx],
                        qty: updatedShopStocks[idx].qty + item.quantity,
                    };
                } else {
                    // Item no longer present in shop list; add it back
                    const originalStock = await ctx.db.get(item.stockId);
                    updatedShopStocks.push({
                        stockId: item.stockId,
                        name: item.name,
                        productCode: item.productCode || "",
                        qty: item.quantity,
                        price: item.price,
                        pv: item.pv,
                        bv: item.bv,
                        halfPrice: originalStock?.halfPrice ?? false,
                    });
                }
            }
            await ctx.db.patch(shop._id, { issuedStocks: updatedShopStocks });
        } else {
            for (const item of existingSale.items) {
                const stock = await ctx.db.get(item.stockId);
                if (stock) {
                    await ctx.db.patch(item.stockId, { qty: stock.qty + item.quantity });
                }
            }
        }

        // Record compensating SALE_VOID events in stockLedger
        for (const item of existingSale.items) {
            await ctx.db.insert("stockLedger", {
                businessId,
                stockId: item.stockId,
                shopId: shopId,
                deltaQty: item.quantity,
                eventType: "SALE_VOID",
                referenceId: existingSale.invoiceNumber || args.saleId,
                userId,
                timestamp: new Date().toISOString(),
                notes: `Edit rollback for sale ${existingSale.invoiceNumber || args.saleId}`,
            });
        }

        // -----------------------------------------------------------------
        // 2) REVERSE original loan and its payments
        // -----------------------------------------------------------------
        const existingLoans = await ctx.db
            .query("loans")
            .withIndex("by_salesId", (q) => q.eq("salesId", args.saleId))
            .collect();

        for (const loan of existingLoans) {
            const payments = await ctx.db
                .query("payments")
                .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
                .collect();
            for (const p of payments) {
                await ctx.db.delete(p._id);
            }
            await ctx.db.delete(loan._id);
        }

        // -----------------------------------------------------------------
        // 3) REVERSE original promotion redemptions for this sale
        // -----------------------------------------------------------------
        const existingRedemptions = await ctx.db
            .query("promotionRedemptions")
            .filter((q) => q.eq(q.field("salesId"), args.saleId))
            .collect();
        for (const r of existingRedemptions) {
            await ctx.db.delete(r._id);
        }

        // -----------------------------------------------------------------
        // 4) APPLY new stock deductions
        // -----------------------------------------------------------------
        const refreshedShop = shopId ? await ctx.db.get(shopId) : null;
        if (refreshedShop) {
            const updatedStocks = [...refreshedShop.issuedStocks];
            for (const item of editTrustedItems) {
                const idx = updatedStocks.findIndex(s => s.stockId === item.stockId);
                if (idx === -1) {
                    throw new Error(`Item ${item.name} not found in shop stock`);
                }
                updatedStocks[idx] = {
                    ...updatedStocks[idx],
                    qty: updatedStocks[idx].qty - item.quantity,
                };
            }
            await ctx.db.patch(refreshedShop._id, { issuedStocks: updatedStocks });
        } else {
            const stockIds = editTrustedItems.map(i => i.stockId);
            const stockDocs = await Promise.all(stockIds.map(id => ctx.db.get(id)));
            const stockMap = new Map(
                stockDocs.filter((s): s is NonNullable<typeof s> => s !== null).map(s => [s._id, s])
            );
            for (const item of editTrustedItems) {
                const stock = stockMap.get(item.stockId);
                if (!stock) throw new Error(`Item ${item.name} not found in warehouse`);
                await ctx.db.patch(item.stockId, { qty: stock.qty - item.quantity });
            }
        }

        // Record new SALE events in stockLedger
        for (const item of editTrustedItems) {
            await ctx.db.insert("stockLedger", {
                businessId,
                stockId: item.stockId,
                shopId: shopId,
                deltaQty: -item.quantity,
                eventType: "SALE",
                referenceId: existingSale.invoiceNumber || args.saleId,
                userId,
                timestamp: new Date().toISOString(),
                notes: `Updated sale item for ${existingSale.invoiceNumber || args.saleId}`,
            });
        }

        // -----------------------------------------------------------------
        // 5) UPDATE sale record (preserve original invoiceNumber, date, shopId, userId, transactionType)
        // -----------------------------------------------------------------
        await ctx.db.patch(args.saleId, {
            customerId: args.customerId,
            manualCustomerName: args.manualCustomerName,
            total: editComputedTotal,
            clientType: args.clientType,
            paymentMode: args.paymentMode,
            items: editTrustedItems,
            isLoan: args.isLoan,
            paymentDueDate: args.paymentDueDate,
            initialDeposit: args.initialDeposit,
            packageType: args.packageType,
            deliveryStatus: args.deliveryStatus,
            customerPhone: args.customerPhone,
            customerLocation: args.customerLocation,
        });

        // -----------------------------------------------------------------
        // 6) RE-APPLY promotion redemptions (matches create logic)
        // -----------------------------------------------------------------
        const newDate = new Date().toISOString();
        const triggeredRedemptions = await processPromotionTriggers(ctx, {
            businessId,
            salesId: args.saleId,
            customerId: args.customerId,
            userId: existingSale.userId,
            shopId: shopId,
            date: newDate,
            items: editTrustedItems,
        });

        // -----------------------------------------------------------------
        // 7) RE-CREATE loan + initial deposit if applicable
        // -----------------------------------------------------------------
        if (args.isLoan && args.paymentDueDate) {
            const deposit = args.initialDeposit || 0;
            const loanBalance = editComputedTotal - deposit;

            const loanId = await ctx.db.insert("loans", {
                businessId,
                customerId: args.customerId,
                manualCustomerName: args.manualCustomerName,
                salesId: args.saleId,
                amount: editComputedTotal,
                balance: loanBalance,
                date: newDate,
            });

            if (deposit > 0) {
                await ctx.db.insert("payments", {
                    businessId,
                    loanId: loanId,
                    shopId: shopId,
                    customerId: args.customerId,
                    amount: deposit,
                    date: newDate,
                    balance: loanBalance,
                });
            }
        }

        // -----------------------------------------------------------------
        // 8) Log activity
        // -----------------------------------------------------------------
        await logActivity(
            ctx,
            businessId,
            userId,
            "Edit Sale",
            `Edited sale ${existingSale.invoiceNumber || args.saleId} - New total: ${args.total.toLocaleString()}, ${args.items.length} item(s), Payment: ${args.paymentMode}${args.isLoan ? " (Loan)" : ""}`
        );

        return { saleId: args.saleId, redemptions: triggeredRedemptions };
    },
});

// Get My Sales Stats (Total, Cash, HP, etc.) for a date range
export const mySalesStats = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        filterType: v.optional(v.string()), // "All", "Regular", "HP"
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()),
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        transactionType: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        // Find the caller's counter inside this business. The `email`
        // argument is ignored — the browser used to be able to ask for
        // somebody else's till.
        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", tenant.user._id))
            .filter((q) => q.eq(q.field("businessId"), businessId))
            .first();

        // Base Query Selection
        let salesQuery: any = ctx.db.query("sales"); // Use any to bypass complex Query vs QueryInitializer mismatch

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
            salesQuery = salesQuery.withIndex("by_businessId_shop_date", (q: any) =>
                q.eq("businessId", businessId).eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!)
            );
        } else {
            salesQuery = salesQuery.withIndex("by_businessId_shop_date", (q: any) =>
                q.eq("businessId", businessId).eq("shopId", shop._id)
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
            .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
            .filter((q: any) =>
                q.and(
                    q.eq(q.field("shopId"), shop._id),
                    q.gte(q.field("date"), args.from || "0"),
                    q.lte(q.field("date"), args.to || "z")
                )
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
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()),
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        transactionType: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", tenant.user._id))
            .filter((q) => q.eq(q.field("businessId"), businessId))
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
            salesQuery = salesQuery.withIndex("by_businessId_shop_date", (q: any) => q.eq("businessId", businessId).eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        } else {
            salesQuery = salesQuery.withIndex("by_businessId_shop_date", (q: any) => q.eq("businessId", businessId).eq("shopId", shop._id));
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
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()), // Added for consistency
        packageType: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        transactionType: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");
        const businessId = tenant.businessId;

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", tenant.user._id))
            .filter((q) => q.eq(q.field("businessId"), businessId))
            .first();

        // User MUST be assigned to a shop to see "My Sales" stats (even Admin)
        if (!shop) return 0;

        let salesQuery: any = ctx.db.query("sales");

        // Always scope by shop
        if (args.from && args.to) {
            salesQuery = salesQuery.withIndex("by_businessId_shop_date", (q: any) => q.eq("businessId", businessId).eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        } else {
            salesQuery = salesQuery.withIndex("by_businessId_shop_date", (q: any) => q.eq("businessId", businessId).eq("shopId", shop._id));
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
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.create");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const date = new Date().toISOString();

        // Every product involved must belong to this business.
        for (const item of [...args.returnedItems, ...args.takenItems]) {
            const stock = await ctx.db.get(item.stockId);
            if (!stock || stock.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that product belongs to another business."
                );
            }
        }

        // 1. Identify Shop/Warehouse
        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", userId))
            .filter((q) => q.eq(q.field("businessId"), businessId))
            .first();

        // 2. Handle Returned Items (Increase Stock)
        if (shop) {
            const updatedShopStocks = [...shop.issuedStocks];
            for (const item of args.returnedItems) {
                const idx = updatedShopStocks.findIndex(s => s.stockId === item.stockId);
                if (idx !== -1) {
                    updatedShopStocks[idx] = { ...updatedShopStocks[idx], qty: updatedShopStocks[idx].qty + item.quantity };
                } else {
                    const masterStock = await ctx.db.get(item.stockId);
                    if (masterStock) {
                        updatedShopStocks.push({
                            stockId: item.stockId,
                            name: masterStock.name,
                            qty: item.quantity,
                            price: masterStock.price,
                            productCode: masterStock.productCode,
                            pv: masterStock.pv,
                            bv: masterStock.bv,
                            halfPrice: masterStock.halfPrice || false,
                        });
                    }
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
            businessId,
            userId,
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
            invoiceNumber: await generateInvoiceNumber(ctx, businessId, shop ? shop._id : args.shopId),
        });

        const invoiceNumberValue = (await ctx.db.get(saleId))?.invoiceNumber;

        // Record stock movements in stockLedger
        for (const item of args.returnedItems) {
            await ctx.db.insert("stockLedger", {
                businessId,
                stockId: item.stockId,
                shopId: shop ? shop._id : args.shopId,
                deltaQty: item.quantity,
                eventType: "SALE",
                referenceId: invoiceNumberValue || saleId,
                userId,
                timestamp: date,
                notes: `Product Swap (Returned): ${item.name} (${item.quantity})`,
            });
        }

        for (const item of args.takenItems) {
            await ctx.db.insert("stockLedger", {
                businessId,
                stockId: item.stockId,
                shopId: shop ? shop._id : args.shopId,
                deltaQty: -item.quantity,
                eventType: "SALE",
                referenceId: invoiceNumberValue || saleId,
                userId,
                timestamp: date,
                notes: `Product Swap (Issued): ${item.name} (${item.quantity})`,
            });
        }

        // 5. Log activity
        const returnedSummary = args.returnedItems.map(i => `${i.name} (${i.quantity})`).join(", ");
        const takenSummary = args.takenItems.map(i => `${i.name} (${i.quantity})`).join(", ");
        await logActivity(
            ctx,
            businessId,
            userId,
            "Product Swap",
            `Swapped items at ${shop ? shop.name : "HQ"} - Returned: ${returnedSummary}, Taken: ${takenSummary}, Total Value: ${totalValue.toLocaleString()}`
        );

        return { saleId, invoiceNumber: invoiceNumberValue };
    },
});

export const getSale = query({
    args: { id: v.id("sales"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.view");

        const sale = await ctx.db.get(args.id);
        if (!sale) return null;
        if (sale.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that sale belongs to another business.");
        }

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

/**
 * Refund a completed sale.
 *
 * A refund is not a sale edit. It is a separate action with its own
 * permission (`sales.refund`), so the people who can ring up a sale are
 * not automatically the people who can hand money back � the owner,
 * an administrator and a supervisor can; a cashier cannot.
 *
 * The stock goes back to the warehouse, the money is recorded against the
 * original invoice, and the action is written to the audit trail.
 */
export const refundSale = mutation({
    args: {
        saleId: v.id("sales"),
        items: v.array(
            v.object({
                stockId: v.id("stocks"),
                quantity: v.number(),
            })
        ),
        reason: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "sales.refund");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const sale = await ctx.db.get(args.saleId);
        if (!sale) throw new ConvexError("Sale not found");
        if (sale.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that sale belongs to another business."
            );
        }
        if (args.items.length === 0) {
            throw new ConvexError("Choose at least one item to refund.");
        }

        // A branch manager may only refund sales from their own branches.
        if (sale.branchId) {
            await requireBranchAccess(ctx, tenant.membership, sale.branchId);
        }

        const alreadyRefunded = new Map<string, number>();
        for (const item of sale.refundedItems ?? []) {
            alreadyRefunded.set(item.stockId, (alreadyRefunded.get(item.stockId) ?? 0) + item.quantity);
        }

        const refundedItems: {
            stockId: Id<"stocks">;
            name: string;
            productCode?: string;
            quantity: number;
            amount: number;
        }[] = [];
        let refundTotal = 0;

        for (const line of args.items) {
            if (line.quantity <= 0) {
                throw new ConvexError("Refund quantities must be positive.");
            }

            const soldLine = sale.items.find((i) => i.stockId === line.stockId);
            if (!soldLine) {
                throw new ConvexError(
                    "Forbidden: that product was not on this sale."
                );
            }

            const already = alreadyRefunded.get(line.stockId) ?? 0;
            if (already + line.quantity > soldLine.quantity) {
                throw new ConvexError(
                    `Cannot refund ${line.quantity} of ${soldLine.name} � only ${
                        soldLine.quantity - already
                    } remain on this sale.`
                );
            }

            // The stock must belong to this business.
            const stock = await ctx.db.get(line.stockId);
            if (!stock || stock.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that product belongs to another business."
                );
            }

            // The amount refunded is computed on the server from the price
            // that was actually charged, never from the browser.
            const amount = soldLine.price * line.quantity;
            refundTotal += amount;

            refundedItems.push({
                stockId: line.stockId,
                name: soldLine.name,
                productCode: soldLine.productCode,
                quantity: line.quantity,
                amount,
            });

            await ctx.db.patch(line.stockId, { qty: stock.qty + line.quantity });

            await ctx.db.insert("stockLedger", {
                businessId,
                stockId: line.stockId,
                shopId: sale.shopId,
                deltaQty: line.quantity,
                eventType: "SALE_REFUND",
                referenceId: sale.invoiceNumber || args.saleId,
                userId,
                timestamp: new Date().toISOString(),
                notes: `Refund of ${soldLine.name} (${line.quantity}) on sale ${
                    sale.invoiceNumber || args.saleId
                }`,
            });
        }

        const nextRefunded = [...(sale.refundedItems ?? []), ...refundedItems];
        const totalRefunded = (sale.refundAmount ?? 0) + refundTotal;
        const isFullyRefunded = totalRefunded >= sale.total;

        await ctx.db.patch(args.saleId, {
            refundedItems: nextRefunded,
            refundAmount: totalRefunded,
            refundedAt: new Date().toISOString(),
            refundedBy: userId,
            refundReason: args.reason,
            deliveryStatus: isFullyRefunded ? "Refunded" : sale.deliveryStatus,
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Refund Sale",
            `Refunded ${refundedItems.length} line(s) worth ${refundTotal} on sale ${
                sale.invoiceNumber || args.saleId
            }${args.reason ? ` � ${args.reason}` : ""}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "sales.refund",
            targetType: "sale",
            targetId: args.saleId,
            metadata: {
                invoiceNumber: sale.invoiceNumber,
                refundAmount: refundTotal,
                totalRefunded,
                fullyRefunded: isFullyRefunded,
                items: refundedItems.map((i) => ({
                    name: i.name,
                    quantity: i.quantity,
                    amount: i.amount,
                })),
                reason: args.reason,
            },
        });

        return { refundAmount: refundTotal, totalRefunded, fullyRefunded: isFullyRefunded };
    },
});