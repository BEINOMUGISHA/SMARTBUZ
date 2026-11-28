/**
 * SMART_BUZ — instalment plans.
 *
 * Hire purchase, layaway, a phone on monthly payments, a school fee paid
 * over a term: the same contract in every case.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this is not a sale
 * ────────────────────────────────────────────────────────────────────────
 *
 * A customer who is going to pay over three months has not bought the
 * thing yet. If the money were taken as a sale, the stock would leave the
 * shelf, the takings would count it as revenue on the first day, and the
 * customer would own nothing and owe everything.
 *
 * So a plan is a **contract**, kept apart from the sales ledger:
 *
 *   • the stock stays on the shelf until the plan is complete;
 *   • the money is taken as payments against the plan, not as a sale;
 *   • what the customer still owes is tracked here, not inferred from
 *     sales — so what is owed is never a guess.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The arithmetic belongs to the server
 * ────────────────────────────────────────────────────────────────────────
 *
 * The deposit, the instalment, the balance and the next payment date are
 * all worked out here. The browser says how much the thing costs, how
 * much was paid up front and how many payments there are; the server
 * says what each payment is and when it is due.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this module does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * There is no interest and no penalty rate, no credit scoring, and no
 * automatic dunning. The plan records what is owed and when; it does not
 * decide what it is worth to the business to lend.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertPackageFeature, assertScreenAvailable } from "./manage";
import { writeAudit } from "../audit";

/** How often a payment falls due. */
const FREQUENCIES = ["weekly", "fortnightly", "monthly"] as const;

/** Days between payments, for each frequency. */
const FREQUENCY_DAYS: Record<string, number> = {
    weekly: 7,
    fortnightly: 14,
    monthly: 30,
};

/**
 * The date the payment after `from` falls due.
 *
 * A month is thirty days rather than a calendar month on purpose: a plan
 * that pays on the 31st of a month and a plan that pays on the 1st of
 * the next month are the same plan to the person paying it, and a
 * calendar month would drift a payment by a day every time the month was
 * short.
 */
function nextDueDate(from: string, frequency: string): string {
    const days = FREQUENCY_DAYS[frequency] ?? FREQUENCY_DAYS.monthly;
    const date = new Date(`${from}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
}

/** The money, to the cent. */
function money(value: number): number {
    return Math.round(value * 100) / 100;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The plans this business has open, newest first.
 */
export const listPlans = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        status: v.optional(v.string()),
        customerId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.view");

        const rows = await ctx.db
            .query("installmentPlans")
            .withIndex("by_businessId", (q) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        const today = new Date().toISOString().slice(0, 10);

        return rows
            .filter((row) => {
                if (args.status && row.status !== args.status) return false;
                if (args.customerId && row.customerId !== args.customerId) {
                    return false;
                }
                return true;
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((row) => ({
                _id: row._id,
                customerId: row.customerId,
                customerName: row.customerName,
                customerPhone: row.customerPhone,
                stockId: row.stockId,
                description: row.description,
                total: row.total,
                deposit: row.deposit,
                instalmentCount: row.instalmentCount,
                instalmentAmount: row.instalmentAmount,
                amountPaid: row.amountPaid,
                balance: row.balance,
                startDate: row.startDate,
                nextDueDate: row.nextDueDate,
                frequency: row.frequency ?? "monthly",
                status: row.status,
                notes: row.notes,
                /** Whether the payment that is due has gone past its date. */
                overdue:
                    row.status === "active" && row.nextDueDate < today,
                daysOverdue:
                    row.status === "active" && row.nextDueDate < today
                        ? Math.floor(
                              (Date.parse(today) -
                                  Date.parse(row.nextDueDate)) /
                                  86400000
                          )
                        : 0,
            }));
    },
});

/**
 * Every payment taken against one plan.
 */
export const listPlanPayments = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        planId: v.id("installmentPlans"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.view");

        const plan = await ctx.db.get(args.planId);
        if (!plan || plan.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that plan belongs to another business."
            );
        }

        const rows = await ctx.db
            .query("installmentPayments")
            .withIndex("by_planId", (q) => q.eq("planId", args.planId))
            .collect();

        return rows
            .sort((a, b) => b.date.localeCompare(a.date))
            .map((row) => ({
                _id: row._id,
                amount: row.amount,
                balanceAfter: row.balanceAfter,
                date: row.date,
                method: row.method,
                reference: row.reference,
                createdAt: row.createdAt,
            }));
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Opening a plan
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Open a plan.
 *
 * The price comes from the product when there is one, so a customer
 * cannot be quoted a price of their own making at the counter. The
 * deposit, the instalment and the dates are worked out here.
 */
export const createPlan = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        customerId: v.optional(v.id("customers")),
        customerName: v.string(),
        customerPhone: v.optional(v.string()),
        stockId: v.optional(v.id("stocks")),
        description: v.string(),
        /** The price of the thing, when there is no product for it. */
        total: v.optional(v.number()),
        deposit: v.number(),
        instalmentCount: v.number(),
        frequency: v.optional(v.string()),
        startDate: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");
        await assertPackageFeature(ctx, businessId, "layaway");

        if (!args.description.trim()) {
            throw new ConvexError("A plan needs to say what it is for.");
        }

        if (!args.customerName.trim()) {
            throw new ConvexError("A plan needs to say who it is for.");
        }

        // The price is the product's price, not the browser's.
        let total = args.total;
        if (args.stockId) {
            const stock = await ctx.db.get(args.stockId);
            if (!stock || stock.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that product belongs to another business."
                );
            }
            total = stock.price;
        }

        if (total === undefined || !Number.isFinite(total) || total <= 0) {
            throw new ConvexError("A plan needs a price greater than zero.");
        }

        if (!Number.isFinite(args.deposit) || args.deposit < 0) {
            throw new ConvexError("The deposit cannot be negative.");
        }

        if (args.deposit > total) {
            throw new ConvexError(
                "The deposit cannot be more than the price of the thing."
            );
        }

        if (
            !Number.isFinite(args.instalmentCount) ||
            args.instalmentCount < 1 ||
            !Number.isInteger(args.instalmentCount)
        ) {
            throw new ConvexError(
                "A plan needs at least one payment, and the number of payments must be a whole number."
            );
        }

        const frequency = args.frequency ?? "monthly";
        if (!FREQUENCIES.includes(frequency as (typeof FREQUENCIES)[number])) {
            throw new ConvexError(
                `A plan pays ${FREQUENCIES.join(", ")}.`
            );
        }

        if (args.customerId) {
            const customer = await ctx.db.get(args.customerId);
            if (!customer || customer.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that customer belongs to another business."
                );
            }
        }

        const startDate = args.startDate ?? new Date().toISOString().slice(0, 10);
        const instalmentAmount = money(
            (total - args.deposit) / args.instalmentCount
        );
        const balance = money(total - args.deposit);
        const now = new Date().toISOString();

        const id = await ctx.db.insert("installmentPlans", {
            businessId,
            customerId: args.customerId,
            customerName: args.customerName.trim(),
            customerPhone: args.customerPhone,
            stockId: args.stockId,
            description: args.description.trim(),
            total: money(total),
            deposit: money(args.deposit),
            instalmentCount: args.instalmentCount,
            frequency,
            instalmentAmount,
            amountPaid: money(args.deposit),
            balance,
            startDate,
            nextDueDate: nextDueDate(startDate, frequency),
            status: "active",
            notes: args.notes,
            createdAt: now,
            updatedAt: now,
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Open instalment plan",
            `${args.description} for ${args.customerName} — ${args.instalmentCount} payments of ${instalmentAmount}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "installment_plan.create",
            targetType: "installmentPlan",
            targetId: id,
            metadata: {
                total: money(total),
                deposit: money(args.deposit),
                instalmentCount: args.instalmentCount,
                balance,
            },
        });

        return id;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Paying
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Take a payment against a plan.
 *
 * The money taken is recorded against the plan and the balance is worked
 * out here. A plan that reaches its full amount is closed; one that is
 * overpaid is refused rather than quietly absorbing the difference.
 */
export const recordPlanPayment = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        planId: v.id("installmentPlans"),
        amount: v.number(),
        method: v.optional(v.string()),
        reference: v.optional(v.string()),
        date: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const plan = await ctx.db.get(args.planId);
        if (!plan || plan.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that plan belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["plans"]);
        }

        if (plan.status !== "active") {
            throw new ConvexError(
                `This plan is ${plan.status}, so no payment can be taken against it.`
            );
        }

        if (!Number.isFinite(args.amount) || args.amount <= 0) {
            throw new ConvexError("A payment must be a number greater than zero.");
        }

        if (args.amount > plan.balance) {
            throw new ConvexError(
                `The payment is more than what is left to pay. ${plan.balance} is still owed.`
            );
        }

        const balanceAfter = money(plan.balance - args.amount);
        const amountPaid = money(plan.amountPaid + args.amount);
        const date = args.date ?? new Date().toISOString().slice(0, 10);
        const now = new Date().toISOString();

        await ctx.db.insert("installmentPayments", {
            businessId,
            planId: args.planId,
            amount: money(args.amount),
            balanceAfter,
            date,
            method: args.method,
            reference: args.reference,
            takenBy: tenant.user._id,
            createdAt: now,
        });

        await ctx.db.patch(args.planId, {
            amountPaid,
            balance: balanceAfter,
            status: balanceAfter <= 0 ? "completed" : "active",
            nextDueDate:
                balanceAfter <= 0
                    ? plan.nextDueDate
                    : nextDueDate(plan.nextDueDate, plan.frequency ?? "monthly"),
            updatedAt: now,
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Instalment payment",
            `${args.amount} against ${plan.description} for ${plan.customerName} — ${balanceAfter} still owed`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "installment_plan.payment",
            targetType: "installmentPlan",
            targetId: args.planId,
            metadata: { amount: money(args.amount), balanceAfter },
        });

        return { balanceAfter, status: balanceAfter <= 0 ? "completed" : "active" };
    },
});

/**
 * Close a plan without taking the rest of the money.
 *
 * The stock goes back and the customer is released. The reason is kept,
 * because a plan that was cancelled is a fact somebody will ask about.
 */
export const cancelPlan = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        planId: v.id("installmentPlans"),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const plan = await ctx.db.get(args.planId);
        if (!plan || plan.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that plan belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["plans"]);
        }

        if (plan.status !== "active") {
            throw new ConvexError(`This plan is already ${plan.status}.`);
        }

        await ctx.db.patch(args.planId, {
            status: "cancelled",
            notes: args.reason
                ? `${plan.notes ? `${plan.notes} — ` : ""}Cancelled: ${args.reason}`
                : plan.notes,
            updatedAt: new Date().toISOString(),
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Cancel instalment plan",
            `${plan.description} for ${plan.customerName} — ${args.reason ?? "no reason given"}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "installment_plan.cancel",
            targetType: "installmentPlan",
            targetId: args.planId,
            metadata: { reason: args.reason, balance: plan.balance },
        });

        return args.planId;
    },
});

/**
 * Mark a plan as defaulted — the customer has stopped paying.
 *
 * This does not take any money; it says the plan has gone wrong, so it
 * stops counting as an ordinary plan and shows up on the list of things
 * that need a person.
 */
export const markPlanDefaulted = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        planId: v.id("installmentPlans"),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "customers.manage");

        const plan = await ctx.db.get(args.planId);
        if (!plan || plan.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that plan belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["plans"]);
        }

        if (plan.status !== "active") {
            throw new ConvexError(`This plan is ${plan.status}.`);
        }

        await ctx.db.patch(args.planId, {
            status: "defaulted",
            notes: args.reason
                ? `${plan.notes ? `${plan.notes} — ` : ""}Defaulted: ${args.reason}`
                : plan.notes,
            updatedAt: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "installment_plan.default",
            targetType: "installmentPlan",
            targetId: args.planId,
            metadata: { reason: args.reason, balance: plan.balance },
        });

        return args.planId;
    },
});

/**
 * What the plans come to.
 */
export const getPlanSummary = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.view");

        const rows = await ctx.db
            .query("installmentPlans")
            .withIndex("by_businessId", (q) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        const today = new Date().toISOString().slice(0, 10);

        const active = rows.filter((row) => row.status === "active");
        const overdue = active.filter((row) => row.nextDueDate < today);
        const completed = rows.filter((row) => row.status === "completed");
        const defaulted = rows.filter((row) => row.status === "defaulted");

        return {
            active: active.length,
            overdue: overdue.length,
            completed: completed.length,
            defaulted: defaulted.length,
            /** What the business is owed on the plans that are still open. */
            outstanding: money(
                active.reduce((sum, row) => sum + row.balance, 0)
            ),
            /** What has been taken against plans altogether. */
            collected: money(
                rows.reduce((sum, row) => sum + row.amountPaid, 0)
            ),
            /** What the next payments come to. */
            dueThisMonth: money(
                active
                    .filter((row) => row.nextDueDate.slice(0, 7) === today.slice(0, 7))
                    .reduce((sum, row) => sum + row.instalmentAmount, 0)
            ),
        };
    },
});
