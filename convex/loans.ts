import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id } from "./_generated/dataModel";

// List loans with pagination and filters
export const getLoans = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()), // Manual Auth
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()),
        clientType: v.optional(v.string()), // "Regular", "HP", "Walk-in"
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

        // Must be assigned to a shop
        if (!shop) return { page: [], isDone: true, continueCursor: "" };

        // 1. Base query on loans. 
        // Note: Loans table doesn't have shopId, so we might need to filter by sales associated with the shop.
        // Optimization: Fetch all loans, then filter by Sales.

        // We paginate the loans. Filtering by shop/type will happen inside the handler (not ideal for large data but current schema requires it)
        // Alternative: Query sales first, then fetch loans.

        // Let's try Query Sales first if shop/date/type is provided, as sales has those indexes.
        let salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", shop._id));

        if (args.from && args.to) {
            salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        }

        const sales = await salesQuery.filter(q => q.eq(q.field("isLoan"), true)).collect();
        const saleIds = new Set(sales.map(s => s._id));

        // Now filter loans by these saleIds
        const allLoans = await ctx.db.query("loans").order("desc").collect();
        let filteredLoans = allLoans.filter(l => saleIds.has(l.salesId));

        // 2. Apply customerId Filter
        if (args.customerId) {
            filteredLoans = filteredLoans.filter(l => l.customerId === args.customerId);
        }

        // 3. Search Term & Client Type Filter
        if (args.searchTerm || args.clientType) {
            const lowerSearch = args.searchTerm?.toLowerCase();
            const salesMap = new Map(sales.map(s => [s._id, s]));

            // For customer names, we need a map
            const customerIds = [...new Set(filteredLoans.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];
            const customers = await Promise.all(customerIds.map(id => ctx.db.get(id)));
            const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));

            filteredLoans = filteredLoans.filter(l => {
                const sale = salesMap.get(l.salesId);
                if (!sale) return false;

                // Client Type Filter
                if (args.clientType && args.clientType !== "All") {
                    if (args.clientType === "HP" && sale.clientType !== "HP Client") return false;
                    if (args.clientType === "Regular" && (sale.clientType === "HP Client" || sale.customerId === undefined)) return false;
                    if (args.clientType === "Walk-in" && sale.customerId !== undefined) return false;
                }

                // Search Filter
                if (lowerSearch) {
                    const customer = l.customerId ? customerMap.get(l.customerId) : null;
                    const matchesName = l.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                        customer?.name.toLowerCase().includes(lowerSearch) ||
                        customer?.distributorId?.toLowerCase().includes(lowerSearch) ||
                        sale._id.toLowerCase().includes(lowerSearch);
                    if (!matchesName) return false;
                }

                return true;
            });
        }

        // Manual Pagination as we filtered in memory
        const start = parseInt(args.paginationOpts.cursor || "0");
        const end = start + args.paginationOpts.numItems;
        const page = filteredLoans.slice(start, end);

        // Enrichment
        const customerIds = [...new Set(page.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];
        const saleIdsToFetch = [...new Set(page.map(l => l.salesId))];

        const [customers, salesDocs] = await Promise.all([
            Promise.all(customerIds.map(id => ctx.db.get(id))),
            Promise.all(saleIdsToFetch.map(id => ctx.db.get(id))),
        ]);

        const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));
        const salesDocsMap = new Map(salesDocs.filter(s => s !== null).map(s => [s!._id, s]));

        // Further enrichment: Operators (Users) and Shops from Sales
        const userIds = [...new Set(salesDocs.filter(s => s !== null).map(s => s!.userId))];
        const shopIds = [...new Set(salesDocs.filter(s => s !== null).map(s => s!.shopId).filter((id): id is Id<"shops"> => !!id))];

        const [users, shops] = await Promise.all([
            Promise.all(userIds.map(id => ctx.db.get(id))),
            Promise.all(shopIds.map(id => ctx.db.get(id))),
        ]);

        const userMap = new Map(users.filter(u => u !== null).map(u => [u!._id, u]));
        const shopMap = new Map(shops.filter(s => s !== null).map(s => [s!._id, s]));

        const enrichedPage = page.map(l => {
            const sale = salesDocsMap.get(l.salesId);
            const userDoc: any = sale ? userMap.get(sale.userId) : null;
            const shopDoc = sale?.shopId ? shopMap.get(sale.shopId) : null;

            const operatorName = userDoc
                ? `${userDoc.first_name} ${userDoc.last_name}${userDoc.middle_name ? ` ${userDoc.middle_name}` : ""}`
                : "Unknown";

            return {
                ...l,
                customer: l.customerId ? customerMap.get(l.customerId) : null,
                sale: sale ? {
                    ...sale,
                    shop: shopDoc,
                    operator: userDoc ? {
                        name: operatorName,
                        phone: userDoc.phone_number,
                        email: userDoc.email,
                    } : null,
                } : null,
            };
        });

        return {
            page: enrichedPage,
            isDone: end >= filteredLoans.length,
            continueCursor: end.toString(),
        };
    },
});

export const getLoanStats = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
        clientType: v.optional(v.string()),
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!args.email) return { totalLoan: 0, totalPaid: 0, totalBalance: 0 };

        const user = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email!))
            .first();
        if (!user) return { totalLoan: 0, totalPaid: 0, totalBalance: 0 };

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", user._id))
            .first();

        if (!shop) return { totalLoan: 0, totalPaid: 0, totalBalance: 0 };

        // Duplicate logic for filtering
        let salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", shop._id));
        if (args.from && args.to) {
            salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        }

        const sales = await salesQuery.filter(q => q.eq(q.field("isLoan"), true)).collect();
        const saleIds = new Set(sales.map(s => s._id));

        const allLoans = await ctx.db.query("loans").collect();
        let filteredLoans = allLoans.filter(l => saleIds.has(l.salesId));

        if (args.customerId) {
            filteredLoans = filteredLoans.filter(l => l.customerId === args.customerId);
        }

        if (args.searchTerm || args.clientType) {
            const lowerSearch = args.searchTerm?.toLowerCase();
            const salesMap = new Map(sales.map(s => [s._id, s]));

            const customerIds = [...new Set(filteredLoans.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];
            const customers = await Promise.all(customerIds.map(id => ctx.db.get(id)));
            const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));

            filteredLoans = filteredLoans.filter(l => {
                const sale = salesMap.get(l.salesId);
                if (!sale) return false;

                if (args.clientType && args.clientType !== "All") {
                    if (args.clientType === "HP" && sale.clientType !== "HP Client") return false;
                    if (args.clientType === "Regular" && (sale.clientType === "HP Client" || sale.customerId === undefined)) return false;
                    if (args.clientType === "Walk-in" && sale.customerId !== undefined) return false;
                }

                if (lowerSearch) {
                    const customer = l.customerId ? customerMap.get(l.customerId) : null;
                    const matchesName = l.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                        customer?.name.toLowerCase().includes(lowerSearch) ||
                        customer?.distributorId?.toLowerCase().includes(lowerSearch) ||
                        sale._id.toLowerCase().includes(lowerSearch);
                    if (!matchesName) return false;
                }
                return true;
            });
        }

        const totalLoan = filteredLoans.reduce((sum, l) => sum + l.amount, 0);
        const totalBalance = filteredLoans.reduce((sum, l) => sum + l.balance, 0);
        const totalPaid = totalLoan - totalBalance;

        return { totalLoan, totalPaid, totalBalance };
    },
});

export const getLoanPayments = query({
    args: { loanId: v.id("loans") },
    handler: async (ctx, args) => {
        return await ctx.db
            .query("payments")
            .withIndex("by_loan", (q) => q.eq("loanId", args.loanId))
            .order("desc")
            .collect();
    },
});

export const getLoansCount = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
        clientType: v.optional(v.string()), // "Regular", "HP", "Walk-in"
        searchTerm: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        if (!args.email) return 0;
        const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", args.email!)).first();
        if (!user) return 0;
        const shop = await ctx.db.query("shops").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
        if (!shop) return 0;

        let salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", shop._id));
        if (args.from && args.to) {
            salesQuery = ctx.db.query("sales").withIndex("by_shop_date", q => q.eq("shopId", shop._id).gte("date", args.from!).lte("date", args.to!));
        }

        const sales = await salesQuery.filter(q => q.eq(q.field("isLoan"), true)).collect();
        const saleIds = new Set(sales.map(s => s._id));

        const allLoans = await ctx.db.query("loans").collect();
        let filteredLoans = allLoans.filter(l => saleIds.has(l.salesId));

        if (args.customerId) {
            filteredLoans = filteredLoans.filter(l => l.customerId === args.customerId);
        }

        if (args.searchTerm || args.clientType) {
            const lowerSearch = args.searchTerm?.toLowerCase();
            const salesMap = new Map(sales.map(s => [s._id, s]));

            const customerIds = [...new Set(filteredLoans.map(l => l.customerId).filter((id): id is Id<"customers"> => !!id))];
            const customers = await Promise.all(customerIds.map(id => ctx.db.get(id)));
            const customerMap = new Map(customers.filter(c => c !== null).map(c => [c!._id, c]));

            filteredLoans = filteredLoans.filter(l => {
                const sale = salesMap.get(l.salesId);
                if (!sale) return false;

                if (args.clientType && args.clientType !== "All") {
                    if (args.clientType === "HP" && sale.clientType !== "HP Client") return false;
                    if (args.clientType === "Regular" && (sale.clientType === "HP Client" || sale.customerId === undefined)) return false;
                    if (args.clientType === "Walk-in" && sale.customerId !== undefined) return false;
                }

                if (lowerSearch) {
                    const customer = l.customerId ? customerMap.get(l.customerId) : null;
                    const matchesName = l.manualCustomerName?.toLowerCase().includes(lowerSearch) ||
                        customer?.name.toLowerCase().includes(lowerSearch) ||
                        customer?.distributorId?.toLowerCase().includes(lowerSearch) ||
                        sale._id.toLowerCase().includes(lowerSearch);
                    if (!matchesName) return false;
                }
                return true;
            });
        }

        return filteredLoans.length;
    },
});

export const add = mutation({
    args: {
        customerId: v.id("customers"),
        salesId: v.id("sales"),
        amount: v.number(),
        balance: v.number(),
        date: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const { userId, ...loanArgs } = args;
        const loanId = await ctx.db.insert("loans", loanArgs);

        // Log activity
        const sale = await ctx.db.get(args.salesId);
        const customer = await ctx.db.get(args.customerId);
        await ctx.db.insert("activityLogs", {
            userId,
            action: "Create Loan",
            details: `Created loan for ${customer?.name || 'customer'} - Amount: UGX ${args.amount.toLocaleString()}, Balance: UGX ${args.balance.toLocaleString()}`,
            timestamp: new Date().toISOString(),
        });

        return loanId;
    },
});

export const makePayment = mutation({
    args: {
        loanId: v.id("loans"),
        amount: v.number(),
        date: v.string(),
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const loan = await ctx.db.get(args.loanId);
        if (!loan) throw new Error("Loan not found");

        const sale = await ctx.db.get(loan.salesId);
        if (!sale) throw new Error("Sale associated with loan not found");

        const newBalance = loan.balance - args.amount;
        if (newBalance < 0) throw new Error("Payment exceeds balance");

        await ctx.db.patch(args.loanId, { balance: newBalance });

        const paymentId = await ctx.db.insert("payments", {
            loanId: args.loanId,
            shopId: sale.shopId,
            customerId: loan.customerId,
            amount: args.amount,
            date: args.date,
            balance: newBalance,
        });

        // Log activity
        const customer = loan.customerId ? await ctx.db.get(loan.customerId) : null;
        const customerName = customer?.name || loan.manualCustomerName || 'customer';
        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Loan Payment",
            details: `Payment of UGX ${args.amount.toLocaleString()} for ${customerName} loan. Previous balance: UGX ${loan.balance.toLocaleString()}, New balance: UGX ${newBalance.toLocaleString()}`,
            timestamp: new Date().toISOString(),
        });

        return paymentId;
    },
});
