/**
 * SMART_BUZ — the workforce.
 *
 * Two things a business with staff has to get right:
 *
 *   • **Payroll** — what the people who work for the business are owed for
 *     a period, worked out here and paid through the business's own books.
 *   • **Measurements** — the sizes a customer is, kept against the
 *     customer so that a tailor, a carpenter or a fitter has them to
 *     hand next time.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What the server owns
 *
 * A payslip is not something the browser hands over. The commission is
 * worked out from the sales the person actually made in the period, the
 * gross and the net are counted here, and the money that leaves the
 * business is written into the expenses the reports read. The clerk at
 * the desk sets the policy — the commission rate, the allowances, the
 * deductions — and the server does the arithmetic.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why a run is a run
 *
 * Pay is approved before it is paid. A run is opened in draft, worked
 * out, approved, and only then paid; a run that has been paid cannot be
 * worked on again. That is the whole point of a run: it is the record of
 * a decision, and a decision that can still be edited is not a decision.
 */

import { mutation, query } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { writeAudit } from "../audit";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertPackageFeature, assertScreenAvailable } from "./manage";

/* ────────────────────────────────────────────────────────────────────────
 * The vocabulary
 * ──────────────────────────────────────────────────────────────────────── */

/** The states a payroll run moves through. */
const RUN_STATUSES = ["draft", "approved", "paid", "cancelled"] as const;
type RunStatus = (typeof RUN_STATUSES)[number];

/** The states one person's pay moves through. */
const ITEM_STATUSES = ["pending", "approved", "paid"] as const;
type ItemStatus = (typeof ITEM_STATUSES)[number];

/** The moves a run is allowed to make. */
const RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
    draft: ["approved", "cancelled"],
    approved: ["paid", "cancelled"],
    paid: [],
    cancelled: [],
};

/** `YYYY-MM-DD` for today, on the server's clock. */
function today(): string {
    return new Date().toISOString().slice(0, 10);
}

/**
 * Round to two decimals.
 *
 * Money is worked out here, and money that is worked out in floats drifts.
 * Every figure that leaves this module has been through this.
 */
function money(value: number): number {
    return Math.round(value * 100) / 100;
}

/**
 * The sales a person made in a period.
 *
 * The sale carries the member who rang it up, so the commission is
 * worked out from the business's own sales and not from a number somebody
 * typed in.
 */
async function salesInPeriod(
    ctx: { db: any },
    businessId: Id<"businesses">,
    userId: Id<"users">,
    periodStart: string,
    periodEnd: string
): Promise<number> {
    const sales = await ctx.db
        .query("sales")
        .withIndex("by_businessId_date", (q: any) =>
            q.eq("businessId", businessId).gte("date", periodStart)
        )
        .collect();

    let total = 0;
    for (const sale of sales) {
        if (sale.userId !== userId) continue;
        const date = (sale.date as string | undefined)?.slice(0, 10);
        if (!date) continue;
        if (date < periodStart) continue;
        if (date > periodEnd) continue;
        total += sale.total;
    }
    return total;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The payroll runs this business has done, newest first.
 */
export const listPayrollRuns = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        status: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.view");

        const rows = await ctx.db
            .query("payrollRuns")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .collect();

        return rows
            .filter((row) => (args.status ? row.status === args.status : true))
            .sort((a, b) => b.periodStart.localeCompare(a.periodStart))
            .map((row) => ({
                _id: row._id,
                periodStart: row.periodStart,
                periodEnd: row.periodEnd,
                status: row.status,
                total: row.total,
                headcount: row.headcount,
                notes: row.notes ?? null,
                approvedAt: row.approvedAt ?? null,
                paidAt: row.paidAt ?? null,
                createdAt: row.createdAt,
            }));
    },
});

/**
 * The people on one run.
 */
export const listPayrollItems = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        runId: v.id("payrollRuns"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.view");

        const run = await ctx.db.get(args.runId);
        if (!run || run.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that payroll run belongs to another business."
            );
        }

        const items = await ctx.db
            .query("payrollItems")
            .withIndex("by_runId", (q) => q.eq("runId", args.runId))
            .collect();

        return items
            .sort((a, b) => a.employeeName.localeCompare(b.employeeName))
            .map((item) => ({
                _id: item._id,
                runId: item.runId,
                employeeId: item.employeeId ?? null,
                employeeName: item.employeeName,
                commission: item.commission,
                allowance: item.allowance,
                gross: item.gross,
                deductions: item.deductions,
                net: item.net,
                status: item.status,
                notes: item.notes ?? null,
            }));
    },
});

/**
 * What the payroll costs, over a period.
 */
export const getPayrollSummary = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        periodStart: v.optional(v.string()),
        periodEnd: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.view");

        const businessId = tenant.businessId;

        const runs = await ctx.db
            .query("payrollRuns")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const periodRuns = runs.filter((run) => {
            if (run.status === "cancelled") return false;
            if (args.periodStart && run.periodEnd < args.periodStart) return false;
            if (args.periodEnd && run.periodStart > args.periodEnd) return false;
            return true;
        });

        let gross = 0;
        let net = 0;
        let deductions = 0;
        let paid = 0;
        let unpaid = 0;
        let headcount = 0;

        for (const run of periodRuns) {
            const items = await ctx.db
                .query("payrollItems")
                .withIndex("by_runId", (q) => q.eq("runId", run._id))
                .collect();

            headcount = Math.max(headcount, run.headcount);

            for (const item of items) {
                gross += item.gross;
                net += item.net;
                deductions += item.deductions;
                if (item.status === "paid") paid += item.net;
                else unpaid += item.net;
            }
        }

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        return {
            runs: periodRuns.length,
            headcount,
            gross: money(gross),
            deductions: money(deductions),
            net: money(net),
            paid: money(paid),
            unpaid: money(unpaid),
            staffOnFile: employees.filter((e) => e.status !== "inactive").length,
            staffWithoutPay: employees.filter(
                (e) => e.status !== "inactive" && !e.salary
            ).length,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Working
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Open a payroll run.
 *
 * The people on it are the business's own staff; the commission on each of
 * them is worked out from the sales they made in the period, and the
 * gross and the net are counted here. The clerk does not type a total in
 * and hope.
 */
export const createPayrollRun = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** `YYYY-MM-DD` — the first day of the period. */
        periodStart: v.string(),
        /** `YYYY-MM-DD` — the last day of the period. */
        periodEnd: v.string(),
        /** The share of a person's sales they are paid on, as a percentage. */
        commissionRate: v.number(),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        if (args.periodStart > args.periodEnd) {
            throw new ConvexError("The period cannot end before it starts.");
        }
        if (
            !Number.isFinite(args.commissionRate) ||
            args.commissionRate < 0 ||
            args.commissionRate > 100
        ) {
            throw new ConvexError(
                "The commission rate must be between 0 and 100 percent."
            );
        await assertScreenAvailable(ctx, businessId, ["payroll"]);
        }

        // Only one run for a period, so two clerks cannot pay the same
        // fortnight twice.
        const existing = await ctx.db
            .query("payrollRuns")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();
        const clash = existing.find(
            (run) =>
                run.status !== "cancelled" &&
                run.periodStart === args.periodStart &&
                run.periodEnd === args.periodEnd
        );
        if (clash) {
            throw new ConvexError(
                "A run for that period already exists. Open the existing one instead."
            );
        }

        const employees = await ctx.db
            .query("employees")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const staff = employees.filter(
            (employee) => employee.status !== "inactive" && employee.status !== "suspended"
        );

        const now = new Date().toISOString();
        const runId = await ctx.db.insert("payrollRuns", {
            businessId,
            periodStart: args.periodStart,
            periodEnd: args.periodEnd,
            status: "draft",
            total: 0,
            headcount: staff.length,
            notes: args.notes,
            createdBy: userId,
            createdAt: now,
            updatedAt: now,
        });

        let total = 0;
        for (const employee of staff) {
            let commission = 0;
            if (employee.userId) {
                const made = await salesInPeriod(
                    ctx,
                    businessId,
                    employee.userId,
                    args.periodStart,
                    args.periodEnd
                );
                commission = money((made * args.commissionRate) / 100);
            }

            const base = employee.salary ?? 0;
            const gross = money(base + commission);

            await ctx.db.insert("payrollItems", {
                businessId,
                runId,
                employeeId: employee._id,
                employeeName: employee.fullName,
                commission,
                allowance: 0,
                gross,
                deductions: 0,
                net: gross,
                status: "pending",
            });

            total += gross;
        }

        await ctx.db.patch(runId, { total: money(total) });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Payroll Run",
            `${args.periodStart} → ${args.periodEnd}: ${staff.length} staff, ${money(total)}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "employees.manage",
            targetType: "payrollRun",
            targetId: runId,
            metadata: {
                periodStart: args.periodStart,
                periodEnd: args.periodEnd,
                commissionRate: args.commissionRate,
                headcount: staff.length,
                total: money(total),
            },
        });

        return { runId, total: money(total), headcount: staff.length };
    },
});

/**
 * Change one person's pay on a run.
 *
 * The gross and the net are counted here every time, so the line can
 * never say one thing on the screen and another in the totals.
 */
export const updatePayrollItem = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        itemId: v.id("payrollItems"),
        allowance: v.optional(v.number()),
        deductions: v.optional(v.number()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const item = await ctx.db.get(args.itemId);
        if (!item || item.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that payslip belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["payroll"]);
        }

        const run = await ctx.db.get(item.runId);
        if (!run || run.businessId !== businessId) {
            throw new ConvexError("That payroll run could not be found.");
        }
        if (run.status !== "draft") {
            throw new ConvexError(
                "This run has been approved. Approved pay cannot be edited."
            );
        }

        const allowance = args.allowance ?? item.allowance;
        const deductions = args.deductions ?? item.deductions;

        if (allowance < 0) {
            throw new ConvexError("An allowance cannot be negative.");
        }
        if (deductions < 0) {
            throw new ConvexError("A deduction cannot be negative.");
        }

        const base = money(item.gross - item.commission - item.allowance);
        const gross = money(base + item.commission + allowance);
        const net = money(gross - deductions);
        if (net < 0) {
            throw new ConvexError(
                "The deductions are more than the pay. That is not a payslip."
            );
        }

        await ctx.db.patch(item._id, {
            allowance,
            deductions,
            gross,
            net,
            notes: args.notes ?? item.notes,
        });

        // The run's total is brought back into step with its lines.
        const items = await ctx.db
            .query("payrollItems")
            .withIndex("by_runId", (q) => q.eq("runId", run._id))
            .collect();
        const total = money(items.reduce((sum, line) => sum + line.net, 0));

        await ctx.db.patch(run._id, { total, updatedAt: new Date().toISOString() });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Payslip",
            `${item.employeeName}: net ${net}`
        );

        return { itemId: item._id, gross, net, runTotal: total };
    },
});

/**
 * Approve a run — the decision that the pay is right.
 */
export const approvePayrollRun = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        runId: v.id("payrollRuns"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const run = await ctx.db.get(args.runId);
        if (!run || run.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that payroll run belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["payroll"]);
        }

        const current = run.status as RunStatus;
        if (!RUN_TRANSITIONS[current]?.includes("approved")) {
            throw new ConvexError(
                `A run that is ${current} cannot be approved.`
            );
        }

        const items = await ctx.db
            .query("payrollItems")
            .withIndex("by_runId", (q) => q.eq("runId", args.runId))
            .collect();

        const now = new Date().toISOString();
        for (const item of items) {
            if (item.status === "pending") {
                await ctx.db.patch(item._id, { status: "approved" });
            }
        }

        await ctx.db.patch(args.runId, {
            status: "approved",
            approvedBy: userId,
            approvedAt: now,
            updatedAt: now,
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Payroll Approved",
            `${run.periodStart} → ${run.periodEnd}: ${run.total}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "employees.manage",
            targetType: "payrollRun",
            targetId: args.runId,
            metadata: { total: run.total, headcount: run.headcount },
        });

        return { runId: args.runId, status: "approved" as RunStatus };
    },
});

/**
 * Pay one person.
 *
 * The amount is the line's own net — it is not typed in — and the money
 * that leaves the business is written into the expenses the reports read,
 * so payroll shows up in the business figures where it belongs.
 */
export const recordPayrollPayment = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        itemId: v.id("payrollItems"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.expenses.create");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const item = await ctx.db.get(args.itemId);
        if (!item || item.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that payslip belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["payroll"]);
        }

        const run = await ctx.db.get(item.runId);
        if (!run || run.businessId !== businessId) {
            throw new ConvexError("That payroll run could not be found.");
        }

        if (run.status !== "approved" && run.status !== "paid") {
            throw new ConvexError(
                "The run has to be approved before anyone is paid from it."
            );
        }
        if (item.status === "paid") {
            throw new ConvexError("This person has already been paid.");
        }
        if (item.net <= 0) {
            throw new ConvexError("There is nothing to pay.");
        }

        const now = new Date().toISOString();

        // The money leaving the business is an expense, and it is written
        // here so that it lands in the business figures the same night.
        await ctx.db.insert("expenses", {
            businessId,
            date: today(),
            amount: item.net,
            expense: `Payroll — ${item.employeeName} (${run.periodStart} to ${run.periodEnd})`,
            receivedBy: item.employeeName,
            type: "Salaries",
            userId,
        });

        await ctx.db.patch(item._id, { status: "paid" });

        // When the last person on the run has been paid, the run is paid.
        const items = await ctx.db
            .query("payrollItems")
            .withIndex("by_runId", (q) => q.eq("runId", run._id))
            .collect();
        const allPaid = items.every((line) => line.status === "paid");
        if (allPaid) {
            await ctx.db.patch(run._id, {
                status: "paid",
                paidAt: now,
                updatedAt: now,
            });
        }

        await logActivity(
            ctx,
            businessId,
            userId,
            "Payroll Paid",
            `${item.employeeName}: ${item.net}`
        );

        await writeAudit(ctx, {
            businessId,
            actorUserId: userId,
            actorRole: tenant.membership.role,
            action: "finance.expenses.create",
            targetType: "payrollItem",
            targetId: item._id,
            metadata: {
                employeeName: item.employeeName,
                amount: item.net,
                periodStart: run.periodStart,
                periodEnd: run.periodEnd,
            },
        });

        return { itemId: item._id, amount: item.net, runPaid: allPaid };
    },
});

/**
 * Cancel a run that was opened by mistake.
 */
export const cancelPayrollRun = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        runId: v.id("payrollRuns"),
        reason: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const run = await ctx.db.get(args.runId);
        if (!run || run.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that payroll run belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["payroll"]);
        }

        const current = run.status as RunStatus;
        if (!RUN_TRANSITIONS[current]?.includes("cancelled")) {
            throw new ConvexError(
                `A run that is ${current} cannot be cancelled.`
            );
        }

        await ctx.db.patch(args.runId, {
            status: "cancelled",
            notes: args.reason ?? run.notes,
            updatedAt: new Date().toISOString(),
        });

        await logActivity(
            ctx,
            businessId,
            userId,
            "Payroll Cancelled",
            `${run.periodStart} → ${run.periodEnd}${args.reason ? ` — ${args.reason}` : ""}`
        );

        return { runId: args.runId, status: "cancelled" as RunStatus };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Measurements
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The measurement sets this business holds.
 */
export const listMeasurements = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        customerId: v.optional(v.id("customers")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.view");
        const businessId = tenant.businessId;

        const rows = await ctx.db
            .query("customerMeasurements")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        return rows
            .filter((row) =>
                args.customerId ? row.customerId === args.customerId : true
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
            .map((row) => ({
                _id: row._id,
                customerId: row.customerId,
                customerName: row.customerName,
                measurements: row.measurements,
                notes: row.notes ?? null,
                updatedAt: row.updatedAt,
            }));
    },
});

/**
 * Record a customer's measurements.
 *
 * A customer has one set of measurements, and taking them again replaces
 * the set: a tailor wants the sizes as they are now, not the sizes and
 * then the sizes that were true before.
 */
export const saveMeasurement = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        customerId: v.id("customers"),
        /** The measurements themselves, e.g. `{ chest: 42, waist: 34 }`. */
        measurements: v.record(v.string(), v.number()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.manage");
        await assertPackageFeature(ctx, tenant.businessId, [
            "measurements",
            "custom_dimensions",
        ]);
        const businessId = tenant.businessId;
        const userId = tenant.user._id;

        const customer = await ctx.db.get(args.customerId);
        if (!customer || customer.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that customer belongs to another business."
            );
        await assertScreenAvailable(ctx, businessId, ["measurements"]);
        }

        const names = Object.keys(args.measurements);
        if (names.length === 0) {
            throw new ConvexError("There is nothing to record.");
        }
        for (const name of names) {
            const value = args.measurements[name];
            if (!name.trim()) {
                throw new ConvexError("A measurement needs a name.");
            }
            if (!Number.isFinite(value) || value < 0) {
                throw new ConvexError(
                    `The measurement "${name}" must be a number that is not negative.`
                );
            }
        }

        const now = new Date().toISOString();
        const existing = await ctx.db
            .query("customerMeasurements")
            .withIndex("by_customerId", (q) => q.eq("customerId", args.customerId))
            .collect();

        const customerName = (customer.name as string | undefined) ?? "Customer";

        if (existing.length > 0) {
            await ctx.db.patch(existing[0]._id, {
                measurements: args.measurements,
                notes: args.notes ?? existing[0].notes,
                updatedAt: now,
            });
        } else {
            await ctx.db.insert("customerMeasurements", {
                businessId,
                customerId: args.customerId,
                customerName,
                measurements: args.measurements,
                notes: args.notes,
                updatedAt: now,
            });
        }

        await logActivity(
            ctx,
            businessId,
            userId,
            "Measurements",
            `${customerName}: ${names.join(", ")}`
        );

        return {
            customerId: args.customerId,
            customerName,
            measurements: args.measurements,
            updatedAt: now,
        };
    },
});

/**
 * What the measurement book holds.
 */
export const getMeasurementSummary = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.view");
        const businessId = tenant.businessId;

        const rows = await ctx.db
            .query("customerMeasurements")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const counts: Record<string, number> = {};
        for (const row of rows) {
            for (const name of Object.keys(row.measurements)) {
                counts[name] = (counts[name] ?? 0) + 1;
            }
        }

        const mostMeasured = Object.entries(counts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([name, count]) => ({ name, count }));

        const latest = rows
            .slice()
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];

        return {
            customersMeasured: rows.length,
            measurementCount: Object.values(counts).reduce(
                (sum, count) => sum + count,
                0
            ),
            mostMeasured,
            lastCustomer: latest?.customerName ?? null,
            lastTakenAt: latest?.updatedAt ?? null,
        };
    },
});
