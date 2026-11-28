/**
 * SMARTBUZ — Vertical Module 3: Members, Wallets & Commissions
 *
 * Powers the community & finance verticals plus loyalty across retail:
 *   - SACCO / microfinance: share accounts, savings, member ledger
 *   - schools & churches: student/member enrolment, fees, attendance
 *   - gyms: membership subscriptions and attendance
 *   - NGOs: donations and programme disbursements
 *   - retail: customer wallet (top-up, layaway, credit book)
 *   - salons & barbershops: stylist commission calculation
 */

import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { ConvexError } from "convex/values";
import { writeAudit } from "../audit";
import { logActivity, requirePermission, requireTenant } from "../tenancy";
import { assertScreenAvailable } from "../packages/manage";

/* ───────────────────────── members ───────────────────────── */

export const listMembers = query({
    args: {
        search: v.optional(v.string()),
        status: v.optional(v.string()),
        memberType: v.optional(v.string()),
        limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("members").collect();
        rows = rows.filter((r) => r.businessId === businessId);

        if (args.search) {
            const s = args.search.toLowerCase();
            rows = rows.filter(
                (r) =>
                    r.name.toLowerCase().includes(s) ||
                    r.memberNumber.toLowerCase().includes(s) ||
                    (r.phone ?? "").includes(s)
            );
        }
        if (args.status) rows = rows.filter((r) => r.status === args.status);
        if (args.memberType) rows = rows.filter((r) => r.memberType === args.memberType);

        rows.sort((a, b) => a.name.localeCompare(b.name));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

export const createMember = mutation({
    args: {
        memberNumber: v.optional(v.string()),
        name: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        memberType: v.optional(v.string()),
        openingBalance: v.optional(v.number()),
        shares: v.optional(v.number()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["members"]);

        // Auto-generate a member number when one is not supplied.
        let memberNumber = args.memberNumber;
        if (!memberNumber) {
            const existing = await ctx.db.query("members").collect();
            const scoped = existing.filter((m) => m.businessId === businessId);
            const nums = scoped
                .map((m) => parseInt(m.memberNumber.replace(/\D/g, ""), 10))
                .filter((n) => !Number.isNaN(n));
            const next = (nums.length ? Math.max(...nums) : 0) + 1;
            memberNumber = `M-${String(next).padStart(5, "0")}`;
        } else {
            const dupe = await ctx.db
                .query("members")
                .withIndex("by_memberNumber", (q) => q.eq("memberNumber", memberNumber!))
                .first();
            if (dupe) throw new ConvexError(`Member number ${memberNumber} is already in use`);
        }

        const id = await ctx.db.insert("members", {
            businessId,
            memberNumber,
            name: args.name,
            phone: args.phone,
            email: args.email,
            memberType: args.memberType,
            balance: args.openingBalance ?? 0,
            shares: args.shares ?? 0,
            status: "active",
            joinedDate: new Date().toISOString(),
            userId: tenant.user._id,
        });

        if ((args.openingBalance ?? 0) > 0) {
            await ctx.db.insert("memberTransactions", {
                businessId,
                memberId: id,
                type: "deposit",
                amount: args.openingBalance!,
                balanceAfter: args.openingBalance!,
                date: new Date().toISOString(),
                notes: "Opening balance",
                userId: tenant.user._id,
            });
        }

        await ctx.db.insert("activityLogs", {
            businessId,
            userId: tenant.user._id,
            action: "Create Member",
            details: `Created member ${memberNumber} — ${args.name}`,
            timestamp: new Date().toISOString(),
        });

        return id;
    },
});

/**
 * Record a member transaction and update the running balance.
 * Withdrawal and repayment amounts are validated against the balance so a
 * member can never over-draw a savings account.
 */
export const recordMemberTransaction = mutation({
    args: {
        memberId: v.id("members"),
        type: v.string(),
        amount: v.number(),
        date: v.optional(v.string()),
        reference: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "members.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["members"]);
        const member = await ctx.db.get(args.memberId);
        if (!member) throw new ConvexError("Member not found");
        if (member.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        if (args.amount <= 0) throw new ConvexError("Amount must be greater than zero");

        const isCredit = ["deposit", "share_purchase", "loan", "repayment", "refund"].includes(args.type);
        const delta = isCredit ? args.amount : -args.amount;
        const newBalance = member.balance + delta;

        if (newBalance < 0) {
            throw new ConvexError(`Insufficient balance. Available: ${member.balance}`);
        }

        await ctx.db.patch(args.memberId, {
            balance: newBalance,
            shares:
                args.type === "share_purchase"
                    ? (member.shares ?? 0) + args.amount
                    : member.shares,
        });

        const txId = await ctx.db.insert("memberTransactions", {
            businessId,
            memberId: args.memberId,
            type: args.type,
            amount: args.amount,
            balanceAfter: newBalance,
            date: args.date || new Date().toISOString(),
            reference: args.reference,
            notes: args.notes,
            userId: tenant.user._id,
        });

        await ctx.db.insert("activityLogs", {
            businessId,
            userId: tenant.user._id,
            action: "Member Transaction",
            details: `${args.type} of ${args.amount} for ${member.name}. New balance: ${newBalance}`,
            timestamp: new Date().toISOString(),
        });

        return txId;
    },
});

export const listMemberTransactions = query({
    args: {
        memberId: v.id("members"),
        limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db
            .query("memberTransactions")
            .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
            .collect();
        rows = rows.filter((r) => r.businessId === businessId);
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

export const getMembersSummary = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let members = await ctx.db.query("members").collect();
        members = members.filter((r) => r.businessId === businessId);

        const active = members.filter((m) => (m.status ?? "active") === "active");
        const totalBalance = members.reduce((s, m) => s + (m.balance ?? 0), 0);
        const totalShares = members.reduce((s, m) => s + (m.shares ?? 0), 0);

        return {
            totalMembers: members.length,
            activeMembers: active.length,
            dormantMembers: members.length - active.length,
            totalBalance,
            totalShares,
            averageBalance: members.length ? totalBalance / members.length : 0,
        };
    },
});

/* ───────────────────────── customer wallets (layaway / credit) ───────────────────────── */

export const getWallet = query({
    args: { customerId: v.id("customers"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const wallet = await ctx.db
            .query("customerWallets")
            .withIndex("by_customerId", (q) => q.eq("customerId", args.customerId))
            .first();
        return wallet ?? { customerId: args.customerId, balance: 0, updatedAt: new Date().toISOString() };
    },
});

export const walletTransaction = mutation({
    args: {
        customerId: v.id("customers"),
        type: v.string(),
        amount: v.number(),
        saleId: v.optional(v.id("sales")),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "customers.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["members"]);
        if (args.amount <= 0) throw new ConvexError("Amount must be greater than zero");

        const wallet = await ctx.db
            .query("customerWallets")
            .withIndex("by_customerId", (q) => q.eq("customerId", args.customerId))
            .first();

        const current = wallet?.balance ?? 0;
        const delta = args.type === "topup" ? args.amount : -args.amount;
        const newBalance = current + delta;

        if (newBalance < 0) {
            throw new ConvexError(`Insufficient wallet balance. Available: UGX ${current.toLocaleString()}`);
        }

        if (wallet) {
            await ctx.db.patch(wallet._id, { balance: newBalance, updatedAt: new Date().toISOString() });
        } else {
            await ctx.db.insert("customerWallets", {
                businessId,
                customerId: args.customerId,
                balance: newBalance,
                updatedAt: new Date().toISOString(),
            });
        }

        const id = await ctx.db.insert("walletTransactions", {
            businessId,
            customerId: args.customerId,
            type: args.type,
            amount: args.amount,
            balanceAfter: newBalance,
            date: new Date().toISOString(),
            saleId: args.saleId,
            userId: tenant.user._id,
            notes: args.notes,
        });

        return { id, balance: newBalance };
    },
});

export const listWalletTransactions = query({
    args: { customerId: v.id("customers"), limit: v.optional(v.number()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db
            .query("walletTransactions")
            .withIndex("by_customerId", (q) => q.eq("customerId", args.customerId))
            .collect();
        rows = rows.filter((r) => r.businessId === businessId);
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

/* ───────────────────────── staff commissions ───────────────────────── */

/**
 * Record a staff commission for a completed sale.
 * `rate` is a percentage (e.g. 15 for 15% of the gross sale).
 */
export const recordCommission = mutation({
    args: {
        userId: v.id("users"),
        staffName: v.string(),
        saleId: v.optional(v.id("sales")),
        saleDate: v.optional(v.string()),
        grossAmount: v.number(),
        rate: v.number(),
        paid: v.optional(v.boolean()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "employees.manage");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["members"]);
        if (args.rate < 0 || args.rate > 100) throw new ConvexError("Commission rate must be between 0 and 100");

        const commission = Math.round((args.grossAmount * args.rate) / 100);
        const id = await ctx.db.insert("staffCommissions", {
            businessId,
            userId: tenant.user._id,
            staffName: args.staffName,
            saleId: args.saleId,
            saleDate: args.saleDate || new Date().toISOString(),
            grossAmount: args.grossAmount,
            rate: args.rate,
            commission,
            paid: args.paid ?? false,
        });
        return { id, commission };
    },
});

export const listCommissions = query({
    args: { userId: v.optional(v.id("users")), startDate: v.optional(v.string()), endDate: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("staffCommissions").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.userId) rows = rows.filter((r) => r.userId === args.userId);
        if (args.startDate) rows = rows.filter((r) => r.saleDate >= args.startDate!);
        if (args.endDate) rows = rows.filter((r) => r.saleDate <= args.endDate!);

        rows.sort((a, b) => b.saleDate.localeCompare(a.saleDate));

        const byStaff = new Map<string, { staffName: string; total: number; count: number }>();
        for (const r of rows) {
            const cur = byStaff.get(r.userId) ?? { staffName: r.staffName, total: 0, count: 0 };
            cur.total += r.commission;
            cur.count += 1;
            byStaff.set(r.userId, cur);
        }

        return {
            rows,
            totalCommission: rows.reduce((s, r) => s + r.commission, 0),
            unpaidCommission: rows.filter((r) => !r.paid).reduce((s, r) => s + r.commission, 0),
            byStaff: Array.from(byStaff.entries()).map(([id, v]) => ({ userId: id, ...v })),
        };
    },
});

export const markCommissionPaid = mutation({
    args: { id: v.id("staffCommissions"), paidDate: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.expenses.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["members"]);
        await ctx.db.patch(args.id, { paid: true, paidDate: args.paidDate || new Date().toISOString() });
        return args.id;
    },
});

/* ───────────────────────── donations (church / NGO) ───────────────────────── */

export const recordDonation = mutation({
    args: {
        donorName: v.string(),
        donorPhone: v.optional(v.string()),
        memberId: v.optional(v.id("members")),
        type: v.string(),
        amount: v.number(),
        purpose: v.optional(v.string()),
        reference: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.income.create");
        const businessId = tenant.businessId;
        await assertScreenAvailable(ctx, businessId, ["members"]);
        if (args.amount <= 0) throw new ConvexError("Amount must be greater than zero");

        const id = await ctx.db.insert("donations", {
            businessId,
            donorName: args.donorName,
            donorPhone: args.donorPhone,
            memberId: args.memberId,
            type: args.type,
            amount: args.amount,
            purpose: args.purpose,
            reference: args.reference,
            date: new Date().toISOString(),
            userId: tenant.user._id,
        });

        // A donation from a known member also credits their account.
        if (args.memberId) {
            const member = await ctx.db.get(args.memberId);
            if (member) {
                const newBalance = member.balance + args.amount;
                await ctx.db.patch(args.memberId, { balance: newBalance });
                await ctx.db.insert("memberTransactions", {
                    businessId,
                    memberId: args.memberId,
                    type: "deposit",
                    amount: args.amount,
                    balanceAfter: newBalance,
                    date: new Date().toISOString(),
                    notes: args.purpose ?? args.type,
                    userId: tenant.user._id,
                });
            }
        }

        await ctx.db.insert("activityLogs", {
            businessId,
            userId: tenant.user._id,
            action: "Record Donation",
            details: `${args.type} of UGX ${args.amount.toLocaleString()} from ${args.donorName}`,
            timestamp: new Date().toISOString(),
        });

        return id;
    },
});

export const getDonationsSummary = query({
    args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        let rows = await ctx.db.query("donations").collect();
        rows = rows.filter((r) => r.businessId === businessId);
        if (args.startDate) rows = rows.filter((r) => r.date >= args.startDate!);
        if (args.endDate) rows = rows.filter((r) => r.date <= args.endDate!);

        const byType = rows.reduce((acc: Record<string, number>, r) => {
            acc[r.type] = (acc[r.type] ?? 0) + r.amount;
            return acc;
        }, {});

        return {
            total: rows.reduce((s, r) => s + r.amount, 0),
            count: rows.length,
            byType,
            recent: rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
        };
    },
});

/* ───────────────────────── record lifecycle ───────────────────────── */

/**
 * Amend a member.
 *
 * The balance and the share count are never writable here: they are the
 * running totals of the member ledger, so they can only move through a
 * transaction.
 */
export const updateMember = mutation({
    args: {
        id: v.id("members"),
        name: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        memberType: v.optional(v.string()),
        status: v.optional(v.string()),
        notes: v.optional(v.string()),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "members.manage");

        const member = await ctx.db.get(args.id);
        if (!member) throw new ConvexError("Member not found");
        if (member.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        await ctx.db.patch(args.id, {
            ...(args.name !== undefined ? { name: args.name } : {}),
            ...(args.phone !== undefined ? { phone: args.phone } : {}),
            ...(args.email !== undefined ? { email: args.email } : {}),
            ...(args.memberType !== undefined ? { memberType: args.memberType } : {}),
            ...(args.status !== undefined ? { status: args.status } : {}),
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
        });

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Update Member",
            `${member.memberNumber} — ${args.name ?? member.name} updated`
        );
        await assertScreenAvailable(ctx, businessId, ["members"]);
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "member.update",
            targetType: "member",
            targetId: args.id,
            metadata: {
                memberNumber: member.memberNumber,
                name: args.name ?? member.name,
                memberType: args.memberType ?? member.memberType,
                status: args.status ?? member.status,
            },
        });

        return args.id;
    },
});

/**
 * Delete a member.
 *
 * Refused when the member already has ledger entries, class enrolments or
 * attendance on record: those rows point at the member, so removing it would
 * orphan financial history.
 */
export const deleteMember = mutation({
    args: {
        id: v.id("members"),
        userId: v.id("users"), businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "members.manage");

        const member = await ctx.db.get(args.id);
        if (!member) throw new ConvexError("Member not found");
        if (member.businessId !== businessId) {
            throw new ConvexError("Forbidden: that record belongs to another business.");
        }

        const transactions = await ctx.db.query("memberTransactions").collect();
        const ledger = transactions.find((t) => t.businessId === businessId && t.memberId === args.id);
        if (ledger) {
            throw new ConvexError(
                `${member.name} has transactions on record. The ledger must be kept — set the member to exited instead.`
            );
        await assertScreenAvailable(ctx, businessId, ["members"]);
        }

        const enrolments = await ctx.db.query("classEnrolments").collect();
        const enrolled = enrolments.find((e) => e.businessId === businessId && e.studentId === args.id);
        if (enrolled) {
            throw new ConvexError(`${member.name} is enrolled in a class. Remove the enrolment first.`);
        }

        const attendance = await ctx.db.query("attendance").collect();
        const marked = attendance.find((a) => a.businessId === businessId && a.personId === args.id);
        if (marked) {
            throw new ConvexError(`${member.name} has attendance on record and cannot be deleted.`);
        }

        await ctx.db.delete(args.id);

        await logActivity(
            ctx,
            businessId,
            tenant.user._id,
            "Delete Member",
            `${member.memberNumber} — ${member.name} deleted`
        );
        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "member.delete",
            targetType: "member",
            targetId: args.id,
            metadata: { memberNumber: member.memberNumber, name: member.name, memberType: member.memberType },
        });

        return args.id;
    },
});
