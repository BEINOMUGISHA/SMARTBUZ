import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Id } from "./_generated/dataModel";
import { logActivity, requirePermission, requireTenant } from "./tenancy";
import { assertPaymentMethod, resolvePaymentDates } from "./paymentRules";

/**
 * SMART_BUZ — credit sales (loans) and loan payments.
 *
 * Before the multi-tenant change this module authenticated with an `email`
 * argument the browser supplied ("Manual Auth"), so anybody could ask for
 * somebody else's loans. The caller is now derived from the session and
 * the records are filtered by the caller's business.
 */

/**
 * The shop the caller runs in this business, if any.
 *
 * A cashier sees the loans of their own counter; a manager or owner who
 * does not run a counter sees the whole business.
 */
async function callerShopId(
    ctx: any,
    userId: Id<"users">,
    businessId: Id<"businesses">
): Promise<Id<"shops"> | undefined> {
    const shop = await ctx.db
        .query("shops")
        .withIndex("by_user", (q: any) => q.eq("userId", userId))
        .filter((q: any) => q.eq(q.field("businessId"), businessId))
        .first();
    return shop?._id;
}

/** Sales of this business (optionally one counter) that are credit sales. */
async function loadCreditSales(
    ctx: any,
    businessId: Id<"businesses">,
    shopId: Id<"shops"> | undefined,
    from: string | undefined,
    to: string | undefined
) {
    let salesQuery = ctx.db.query("sales").withIndex(
        shopId ? "by_businessId_shop_date" : "by_businessId_date",
        (q: any) => {
            let query = q.eq("businessId", businessId);
            if (shopId) query = query.eq("shopId", shopId);
            if (from) query = query.gte("date", from);
            if (to) query = query.lte("date", to);
            return query;
        }
    );

    return await salesQuery.filter((q: any) => q.eq(q.field("isLoan"), true)).collect();
}

/** Apply the customer / search / client-type filters to a set of loans. */
async function filterLoans(
    ctx: any,
    loans: any[],
    sales: any[],
    args: { customerId?: Id<"customers">; searchTerm?: string; clientType?: string }
) {
    let filteredLoans = loans;

    if (args.customerId) {
        filteredLoans = filteredLoans.filter((l: any) => l.customerId === args.customerId);
    }

    if (args.searchTerm || args.clientType) {
        const lowerSearch = args.searchTerm?.toLowerCase();
        const salesMap = new Map(sales.map((s: any) => [s._id, s]));

        const customerIds = [...new Set(filteredLoans.map((l: any) => l.customerId).filter((id): id is Id<"customers"> => !!id))];
        const customers = await Promise.all(customerIds.map((id: any) => ctx.db.get(id)));
        const customerMap = new Map<any, any>(customers.filter((c: any) => c !== null).map((c: any) => [c!._id, c]));

        filteredLoans = filteredLoans.filter((l: any) => {
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

    return filteredLoans;
}

// List loans with pagination and filters
export const getLoans = query({
    args: {
        paginationOpts: paginationOptsValidator,
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()),
        clientType: v.optional(v.string()), // "Regular", "HP", "Walk-in"
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        if (args.customerId) {
            const customer = await ctx.db.get(args.customerId);
            if (!customer || customer.businessId !== tenant.businessId) {
                throw new ConvexError("Forbidden: that customer belongs to another business.");
            }
        }

        const shopId = await callerShopId(ctx, tenant.user._id, tenant.businessId);

        const sales = await loadCreditSales(
            ctx,
            tenant.businessId,
            shopId,
            args.from,
            args.to
        );
        const saleIds = new Set(sales.map((s: any) => s._id));

        const allLoans = await ctx.db
            .query("loans")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .collect();
        const scopedLoans = allLoans.filter((l) => saleIds.has(l.salesId));

        const filteredLoans = await filterLoans(ctx, scopedLoans, sales, args);

        // Manual Pagination as we filtered in memory
        const start = parseInt(args.paginationOpts.cursor || "0");
        const end = start + args.paginationOpts.numItems;
        const page = filteredLoans.slice(start, end);

        // Enrichment
        const customerIds = [...new Set(page.map((l) => l.customerId).filter((id): id is Id<"customers"> => !!id))];
        const saleIdsToFetch = [...new Set(page.map((l) => l.salesId))];

        const [customers, salesDocs] = await Promise.all([
            Promise.all(customerIds.map((id: any) => ctx.db.get(id))),
            Promise.all(saleIdsToFetch.map((id: any) => ctx.db.get(id))),
        ]) as any[];

        const customerMap = new Map<any, any>(customers.filter((c: any) => c !== null).map((c: any) => [c!._id, c]));
        const salesDocsMap = new Map<any, any>(salesDocs.filter((s: any) => s !== null).map((s: any) => [s!._id, s]));

        // Further enrichment: Operators (Users) and Shops from Sales
        const userIds = [...new Set(salesDocs.filter((s: any) => s !== null).map((s: any) => s!.userId))];
        const shopIds = [...new Set(salesDocs.filter((s: any) => s !== null).map((s: any) => s!.shopId).filter((id: any): id is Id<"shops"> => !!id))];

        const [users, shops] = await Promise.all([
            Promise.all(userIds.map((id: any) => ctx.db.get(id))),
            Promise.all(shopIds.map((id: any) => ctx.db.get(id))),
        ]) as any[];

        const userMap = new Map<any, any>(users.filter((u: any) => u !== null).map((u: any) => [u!._id, u]));
        const shopMap = new Map<any, any>(shops.filter((s: any) => s !== null).map((s: any) => [s!._id, s]));

        const enrichedPage = page.map((l) => {
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
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        customerId: v.optional(v.id("customers")),
        clientType: v.optional(v.string()),
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        const shopId = await callerShopId(ctx, tenant.user._id, tenant.businessId);

        const sales = await loadCreditSales(
            ctx,
            tenant.businessId,
            shopId,
            args.from,
            args.to
        );
        const saleIds = new Set(sales.map((s: any) => s._id));

        const allLoans = await ctx.db
            .query("loans")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();
        const scopedLoans = allLoans.filter((l) => saleIds.has(l.salesId));

        const filteredLoans = await filterLoans(ctx, scopedLoans, sales, args);

        const totalLoan = filteredLoans.reduce((sum: number, l: any) => sum + l.amount, 0);
        const totalBalance = filteredLoans.reduce((sum: number, l: any) => sum + l.balance, 0);
        const totalPaid = totalLoan - totalBalance;

        return { totalLoan, totalPaid, totalBalance };
    },
});

export const getLoanPayments = query({
    args: { loanId: v.id("loans"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        const loan = await ctx.db.get(args.loanId);
        if (!loan) throw new Error("Loan not found");
        if (loan.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that loan belongs to another business.");
        }

        return await ctx.db
            .query("payments")
            .withIndex("by_loan", (q) => q.eq("loanId", args.loanId))
            .order("desc")
            .collect();
    },
});

// Get a single loan with details
export const getLoanWithDetails = query({
    args: { id: v.id("loans"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        const loan = await ctx.db.get(args.id);
        if (!loan) return null;
        if (loan.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that loan belongs to another business.");
        }

        const [customer, sale] = await Promise.all([
            loan.customerId ? ctx.db.get(loan.customerId) : null,
            loan.salesId ? ctx.db.get(loan.salesId) : null,
        ]);

        // Get user from sale if available
        let user = null;
        if (sale) {
            user = await ctx.db.get(sale.userId);
        }

        return {
            ...loan,
            customer,
            user,
            sale,
        };
    },
});

export const getLoansCount = query({
    args: {
        from: v.optional(v.string()),
        to: v.optional(v.string()),
        email: v.optional(v.string()), // @deprecated — the caller is derived from the session
        customerId: v.optional(v.id("customers")),
        clientType: v.optional(v.string()), // "Regular", "HP", "Walk-in"
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        const shopId = await callerShopId(ctx, tenant.user._id, tenant.businessId);

        const sales = await loadCreditSales(
            ctx,
            tenant.businessId,
            shopId,
            args.from,
            args.to
        );
        const saleIds = new Set(sales.map((s: any) => s._id));

        const allLoans = await ctx.db
            .query("loans")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();
        const scopedLoans = allLoans.filter((l) => saleIds.has(l.salesId));

        const filteredLoans = await filterLoans(ctx, scopedLoans, sales, args);

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
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.manage");

        const customer = await ctx.db.get(args.customerId);
        if (!customer || customer.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that customer belongs to another business.");
        }
        const sale = await ctx.db.get(args.salesId);
        if (!sale || sale.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that sale belongs to another business.");
        }

        const { userId, businessId, ...loanArgs } = args;
        const loanId = await ctx.db.insert("loans", {
            ...loanArgs,
            businessId: tenant.businessId,
        });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Create Loan",
            `Created loan for ${customer?.name || 'customer'} - Amount: ${args.amount.toLocaleString()}, Balance: ${args.balance.toLocaleString()}`
        );

        return loanId;
    },
});

export const makePayment = mutation({
    args: {
        loanId: v.id("loans"),
        amount: v.number(),
        date: v.optional(v.string()),
        method: v.optional(v.string()),
        reference: v.optional(v.string()),
        note: v.optional(v.string()),
        userId: v.id("users"), // @deprecated — the caller is derived from the session
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.manage");

        // -----------------------------------------------------------------
        // THE SAME RULES AS THE CUSTOMER STATEMENT
        //
        // This mutation used to be the looser of the two doors into the
        // debt book: it accepted a negative amount (which *increased* what
        // the customer owed), took the date from the browser without any
        // bound, and recorded no method — so the payment never appeared in
        // the reconciliation that matches a provider's statement against the
        // ledger.
        //
        // It is now the same door as `customers.recordPayment`, so it does
        // not matter which one the till used: the answer is the same and the
        // ledger looks the same.
        // -----------------------------------------------------------------
        if (!Number.isFinite(args.amount) || args.amount <= 0) {
            throw new ConvexError("A payment must be greater than zero.");
        }
        const method = assertPaymentMethod(args.method);
        const { date, paymentDate } = resolvePaymentDates(args.date);

        const loan = await ctx.db.get(args.loanId);
        if (!loan) throw new Error("Loan not found");
        if (loan.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that loan belongs to another business.");
        }

        const sale = await ctx.db.get(loan.salesId);
        if (!sale) throw new Error("Sale associated with loan not found");

        const newBalance = loan.balance - args.amount;
        if (newBalance < 0) throw new Error("Payment exceeds balance");

        await ctx.db.patch(args.loanId, { balance: newBalance });

        const paymentId = await ctx.db.insert("payments", {
            businessId: tenant.businessId,
            loanId: args.loanId,
            shopId: sale.shopId,
            customerId: loan.customerId,
            amount: args.amount,
            date,
            paymentDate,
            balance: newBalance,
            method,
            reference: args.reference,
            userId: tenant.user._id,
            note: args.note,
        });

        // Log activity
        const customer = loan.customerId ? await ctx.db.get(loan.customerId) : null;
        const customerName = customer?.name || loan.manualCustomerName || 'customer';
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Loan Payment",
            `Payment of ${args.amount.toLocaleString()} for ${customerName} loan. Previous balance: ${loan.balance.toLocaleString()}, New balance: ${newBalance.toLocaleString()}`
        );

        return paymentId;
    },
});
