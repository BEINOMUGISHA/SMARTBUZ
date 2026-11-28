import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";
import { assertPaymentMethod, resolvePaymentDates } from "./paymentRules";
import { writeAudit } from "./audit";
import { outstandingBalance } from "./customers";

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

/**
 * A bound moved by whole days.
 *
 * A loan is written just after the sale it belongs to, so the two can fall
 * either side of midnight. The extra day keeps every loan that could
 * belong to a sale in the period — the ones that do not belong are thrown
 * away by the sales check.
 */
function widenBound(bound: string | undefined, days: number): string | undefined {
    if (!bound) return undefined;
    const parsed = Date.parse(bound);
    if (Number.isNaN(parsed)) return bound;
    return new Date(parsed + days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * The loans of a business for a period.
 *
 * The debt book is the longest-lived record in the product: every credit
 * sale adds a row to it, and it is never shortened. Reading all of it to
 * show one period cost the business's whole history on every request.
 *
 * It is now read for the period it is asked for — the same period the
 * sales it came from are read for.
 */
async function loadBusinessLoans(
    ctx: QueryCtx,
    businessId: Id<"businesses">,
    from: string | undefined,
    to: string | undefined
): Promise<Doc<"loans">[]> {
    const lower = widenBound(from, -1);
    const upper = widenBound(to, 1);

    if (lower && upper) {
        return await ctx.db
            .query("loans")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", lower).lte("date", upper)
            )
            .order("desc")
            .collect();
    }

    if (lower) {
        return await ctx.db
            .query("loans")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).gte("date", lower)
            )
            .order("desc")
            .collect();
    }

    if (upper) {
        return await ctx.db
            .query("loans")
            .withIndex("by_businessId_date", (q) =>
                q.eq("businessId", businessId).lte("date", upper)
            )
            .order("desc")
            .collect();
    }

    return await ctx.db
        .query("loans")
        .withIndex("by_businessId_date", (q) => q.eq("businessId", businessId))
        .order("desc")
        .collect();
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

        const allLoans = await loadBusinessLoans(
            ctx,
            tenant.businessId,
            args.from,
            args.to
        );
        const scopedLoans = allLoans.filter((l) => saleIds.has(l.salesId));

        const filteredLoans = await filterLoans(ctx, scopedLoans, sales, args);

        // The cursor is the offset of the first row of this page, so the
        // next page starts where this one ended.
        //
        // It used to be the *page number*, which the pagination hook does
        // not send: the hook passes back whatever the server returned as
        // the cursor, so "page 2" asked for rows 1 to 20 again and the
        // list repeated itself instead of moving on.
        const start = Number(args.paginationOpts.cursor || 0) || 0;
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

        const allLoans = await loadBusinessLoans(
            ctx,
            tenant.businessId,
            args.from,
            args.to
        );
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
        if (!loan) throw new ConvexError("Loan not found");
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

        const allLoans = await loadBusinessLoans(
            ctx,
            tenant.businessId,
            args.from,
            args.to
        );
        const scopedLoans = allLoans.filter((l) => saleIds.has(l.salesId));

        const filteredLoans = await filterLoans(ctx, scopedLoans, sales, args);

        return filteredLoans.length;
    },
});

/**
 * Open credit on a sale.
 *
 * The figures are not the browser's. The amount is the sale's own total, the
 * balance is that total less the deposit, and the credit limit is checked
 * against what the customer already owes — all worked out here, on the
 * server, so a tampered client cannot open a million of credit on a tin of
 * milk, and cannot open credit on a sale that has already been paid.
 */
export const add = mutation({
    args: {
        customerId: v.id("customers"),
        salesId: v.id("sales"),
        /** A deposit taken at the counter when the credit was opened. */
        deposit: v.optional(v.number()),
        /** The day the credit falls due. Stored on the sale it belongs to. */
        dueDate: v.optional(v.string()),
        /** @deprecated — the amount is derived from the sale, not from the browser. */
        amount: v.optional(v.number()),
        /** @deprecated — the balance is derived from the sale, not from the browser. */
        balance: v.optional(v.number()),
        /** @deprecated — the server stamps the date itself. */
        date: v.optional(v.string()),
        /** @deprecated — the caller is derived from the session. */
        userId: v.optional(v.id("users")),
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
        if (!sale.customerId || sale.customerId !== customer._id) {
            throw new ConvexError("That sale was not rung up for this customer.");
        }

        // One sale, one credit.
        const already = await ctx.db
            .query("loans")
            .withIndex("by_salesId", (q) => q.eq("salesId", sale._id))
            .first();
        if (already) {
            throw new ConvexError("That sale is already on credit.");
        }

        // A sale that was rung up as paid cannot be put on credit afterwards:
        // the money is already in the till, and opening a credit as well
        // would count the same goods twice.
        const mode = (sale.paymentMode ?? "").trim().toLowerCase();
        const creditable = mode === "" || mode === "none" || mode === "loan" || mode === "credit";
        if (!creditable) {
            throw new ConvexError(
                `That sale was rung up as ${sale.paymentMode}, so it has already been paid. Credit can only be opened on a sale that has not been paid.`
            );
        }

        // The amount is the sale's own total. The browser never decides it.
        const amount = sale.total;
        // A deposit already taken at the till when the sale was rung up is
        // money already collected, so it is not owed.
        const taken = Math.max(0, sale.initialDeposit ?? 0);
        const deposit = Math.max(0, args.deposit ?? 0);
        if (taken + deposit > amount) {
            throw new ConvexError(
                "The deposit cannot be more than the sale it is paid against."
            );
        }
        const balance = Math.max(0, amount - taken - deposit);

        // The credit limit. A limit of zero means "no limit" — the same
        // convention the till uses when it sells on credit.
        const limit = customer.creditLimit ?? 0;
        if (limit > 0) {
            const outstanding = await outstandingBalance(ctx, customer._id);
            if (outstanding + balance > limit) {
                throw new ConvexError(
                    `${customer.name} is over their credit limit. They owe ${outstanding}, this credit adds ${balance}, and their limit is ${limit}.`
                );
            }
        }

        const now = new Date().toISOString();
        const dueDate = args.dueDate ?? sale.paymentDueDate;

        // The sale becomes a credit sale, so it shows in the credit book and
        // in the till's own loan view.
        await ctx.db.patch(sale._id, {
            isLoan: true,
            paymentDueDate: dueDate,
            ...(mode === "" || mode === "none" ? { paymentMode: "Loan" } : {}),
        });

        const loanId = await ctx.db.insert("loans", {
            businessId: tenant.businessId,
            customerId: customer._id,
            salesId: sale._id,
            amount,
            balance,
            date: now,
        });

        // A deposit is a payment against the credit, and is recorded as one.
        if (deposit > 0) {
            await ctx.db.insert("payments", {
                businessId: tenant.businessId,
                loanId,
                shopId: sale.shopId,
                customerId: customer._id,
                amount: deposit,
                date: now,
                paymentDate: now,
                balance,
                method: "cash",
                userId: tenant.user._id,
                note: "Deposit taken when the credit was opened",
            });
        }

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Create Loan",
            `Opened credit of ${amount.toLocaleString()} for ${customer.name} - Deposit: ${deposit.toLocaleString()}, Balance: ${balance.toLocaleString()}`
        );

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "loans.create",
            targetType: "loan",
            targetId: loanId,
            metadata: {
                customerId: customer._id,
                customerName: customer.name,
                salesId: sale._id,
                amount,
                deposit,
                balance,
                dueDate: dueDate ?? null,
            },
        });

        return { loanId, amount, deposit, balance, dueDate: dueDate ?? null };
    },
});

/**
 * The credit book: every credit this business has given, and what is still
 * owed on it.
 *
 * The due date belongs to the sale the credit was taken on, so the days
 * overdue are counted from there. A cashier sees the credit given at their
 * own counter; a manager sees the whole business.
 */
export const getCreditBook = query({
    args: {
        customerId: v.optional(v.id("customers")),
        searchTerm: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        const shopId = await callerShopId(ctx, tenant.user._id, tenant.businessId);

        const loans = await ctx.db
            .query("loans")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        const saleIds = [...new Set(loans.map((l) => l.salesId))];
        const customerIds = [
            ...new Set(loans.map((l) => l.customerId).filter((id): id is Id<"customers"> => !!id)),
        ];

        const [sales, customers] = (await Promise.all([
            Promise.all(saleIds.map((id) => ctx.db.get(id))),
            Promise.all(customerIds.map((id) => ctx.db.get(id))),
        ])) as any[];

        const saleMap = new Map<any, any>(
            sales.filter((s: any) => s !== null).map((s: any) => [s._id, s])
        );
        const customerMap = new Map<any, any>(
            customers.filter((c: any) => c !== null).map((c: any) => [c._id, c])
        );

        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);
        const today = startOfToday.getTime();
        const weekAhead = today + 7 * 24 * 60 * 60 * 1000;

        const rows = loans
            .map((loan) => {
                const sale = saleMap.get(loan.salesId);
                if (!sale) return null;
                // A cashier sees the credit given at their own counter.
                if (shopId && sale.shopId !== shopId) return null;

                const customer = loan.customerId ? customerMap.get(loan.customerId) : null;
                const dueDate = sale.paymentDueDate ?? null;
                const dueTime = dueDate ? Date.parse(dueDate) : NaN;
                const hasDueDate = !Number.isNaN(dueTime);
                const daysOverdue =
                    hasDueDate && loan.balance > 0 && dueTime < today
                        ? Math.floor((today - dueTime) / (24 * 60 * 60 * 1000))
                        : 0;
                const overdue = daysOverdue > 0;
                const dueSoon =
                    hasDueDate && loan.balance > 0 && dueTime >= today && dueTime <= weekAhead;

                return {
                    _id: loan._id,
                    customerId: loan.customerId ?? null,
                    customerName:
                        customer?.name ?? loan.manualCustomerName ?? "Walk-in customer",
                    customerPhone: customer?.phone ?? null,
                    salesId: loan.salesId,
                    invoiceNumber: sale.invoiceNumber ?? null,
                    date: loan.date,
                    dueDate,
                    amount: loan.amount,
                    paid: Math.max(0, loan.amount - loan.balance),
                    balance: loan.balance,
                    daysOverdue,
                    overdue,
                    dueSoon,
                    status: loan.balance <= 0 ? "cleared" : overdue ? "overdue" : "pending",
                };
            })
            .filter((row): row is NonNullable<typeof row> => row !== null);

        let filtered = rows;
        if (args.customerId) {
            filtered = filtered.filter((row) => row.customerId === args.customerId);
        }
        if (args.searchTerm && args.searchTerm.trim()) {
            const needle = args.searchTerm.trim().toLowerCase();
            filtered = filtered.filter(
                (row) =>
                    row.customerName.toLowerCase().includes(needle) ||
                    (row.invoiceNumber ?? "").toLowerCase().includes(needle)
            );
        }

        const outstanding = filtered.reduce((sum, row) => sum + row.balance, 0);
        const issued = filtered.reduce((sum, row) => sum + row.amount, 0);
        const overdueRows = filtered.filter((row) => row.overdue);
        const dueSoonRows = filtered.filter((row) => row.dueSoon);
        const maxDaysOverdue = overdueRows.reduce((max, row) => Math.max(max, row.daysOverdue), 0);

        return {
            page: filtered,
            totals: {
                loans: filtered.length,
                openLoans: filtered.filter((row) => row.balance > 0).length,
                issued,
                outstanding,
                paid: Math.max(0, issued - outstanding),
                overdueAmount: overdueRows.reduce((sum, row) => sum + row.balance, 0),
                overdueCount: overdueRows.length,
                dueSoonAmount: dueSoonRows.reduce((sum, row) => sum + row.balance, 0),
                dueSoonCount: dueSoonRows.length,
                maxDaysOverdue,
            },
        };
    },
});

/**
 * What opening credit on a sale would actually do.
 *
 * The form shows this, so the operator sees the figures the server will use
 * before they commit to them. The arithmetic is the server's — the browser
 * never sends an amount of its own, and never gets to change one.
 */
export const getOriginationPreview = query({
    args: {
        salesId: v.id("sales"),
        deposit: v.optional(v.number()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");

        const sale = await ctx.db.get(args.salesId);
        if (!sale || sale.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that sale belongs to another business.");
        }
        const customer = sale.customerId ? await ctx.db.get(sale.customerId) : null;

        const amount = sale.total;
        const taken = Math.max(0, sale.initialDeposit ?? 0);
        const deposit = Math.max(0, args.deposit ?? 0);
        const balance = Math.max(0, amount - taken - deposit);

        const outstanding = sale.customerId
            ? await outstandingBalance(ctx, sale.customerId)
            : 0;
        const creditLimit = customer?.creditLimit ?? 0;

        return {
            customerId: sale.customerId ?? null,
            customerName: customer?.name ?? null,
            date: sale.date,
            invoiceNumber: sale.invoiceNumber ?? null,
            amount,
            taken,
            deposit,
            balance,
            outstanding,
            creditLimit,
            /** Null when the customer has no limit set — no limit at all. */
            availableCredit:
                creditLimit > 0 ? Math.max(0, creditLimit - outstanding) : null,
            overLimit: creditLimit > 0 && outstanding + balance > creditLimit,
            dueDate: sale.paymentDueDate ?? null,
        };
    },
});

/**
 * The sales that credit can still be opened on.
 *
 * A sale can only be put on the book when it has not been paid and has not
 * already been given credit. The credit position of the customer is worked
 * out here, so the form can show what the server will use — the browser
 * never sends a figure of its own.
 */
export const listOriginationCandidates = query({
    args: {
        customerId: v.optional(v.id("customers")),
        limit: v.optional(v.number()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "loans.view");
        const businessId = tenant.businessId;

        const limit = args.limit ?? 50;

        const loans = await ctx.db
            .query("loans")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const onCredit = new Set(loans.map((l) => l.salesId));

        const outstandingByCustomer = new Map<string, number>();
        for (const loan of loans) {
            if (!loan.customerId) continue;
            outstandingByCustomer.set(
                loan.customerId,
                (outstandingByCustomer.get(loan.customerId) ?? 0) + loan.balance
            );
        }

        const sales = await ctx.db
            .query("sales")
            .withIndex("by_businessId_date", (q) => q.eq("businessId", businessId))
            .order("desc")
            .take(200);

        const candidates = sales.filter((sale) => {
            if (onCredit.has(sale._id)) return false;
            if (!sale.customerId) return false;
            if (args.customerId && sale.customerId !== args.customerId) return false;
            const mode = (sale.paymentMode ?? "").trim().toLowerCase();
            return mode === "" || mode === "none" || mode === "loan" || mode === "credit";
        });

        const customerIds = [
            ...new Set(candidates.map((s) => s.customerId!)),
        ];
        const customers = (await Promise.all(
            customerIds.map((id) => ctx.db.get(id))
        )) as any[];
        const customerMap = new Map<any, any>(
            customers.filter((c: any) => c !== null).map((c: any) => [c._id, c])
        );

        return candidates.slice(0, limit).map((sale) => {
            const customer = customerMap.get(sale.customerId!);
            const outstanding = outstandingByCustomer.get(sale.customerId!) ?? 0;
            const limit_ = customer?.creditLimit ?? 0;
            return {
                salesId: sale._id,
                date: sale.date,
                invoiceNumber: sale.invoiceNumber ?? null,
                total: sale.total,
                initialDeposit: sale.initialDeposit ?? 0,
                paymentMode: sale.paymentMode ?? null,
                dueDate: sale.paymentDueDate ?? null,
                customerId: sale.customerId!,
                customerName: customer?.name ?? "Customer",
                outstanding,
                creditLimit: limit_,
                /** Null when the customer has no limit set — no limit at all. */
                availableCredit: limit_ > 0 ? Math.max(0, limit_ - outstanding) : null,
            };
        });
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
        /** @deprecated — the caller is derived from the session. */
        userId: v.optional(v.id("users")),
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
        if (!loan) throw new ConvexError("Loan not found");
        if (loan.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that loan belongs to another business.");
        }

        const sale = await ctx.db.get(loan.salesId);
        if (!sale) throw new ConvexError("Sale associated with loan not found");

        const newBalance = loan.balance - args.amount;
        if (newBalance < 0) throw new ConvexError("Payment exceeds balance");

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
