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
import { getActiveBusinessId } from "./batches";

/* ───────────────────────── members ───────────────────────── */

export const listMembers = query({
    args: {
        search: v.optional(v.string()),
        status: v.optional(v.string()),
        memberType: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("members").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);

        // Auto-generate a member number when one is not supplied.
        let memberNumber = args.memberNumber;
        if (!memberNumber) {
            const existing = await ctx.db.query("members").collect();
            const scoped = businessId
                ? existing.filter((m) => !m.businessProfileId || m.businessProfileId === businessId)
                : existing;
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
            if (dupe) throw new Error(`Member number ${memberNumber} is already in use`);
        }

        const id = await ctx.db.insert("members", {
            businessProfileId: businessId,
            memberNumber,
            name: args.name,
            phone: args.phone,
            email: args.email,
            memberType: args.memberType,
            balance: args.openingBalance ?? 0,
            shares: args.shares ?? 0,
            status: "active",
            joinedDate: new Date().toISOString(),
            userId: args.userId,
        });

        if ((args.openingBalance ?? 0) > 0) {
            await ctx.db.insert("memberTransactions", {
                businessProfileId: businessId,
                memberId: id,
                type: "deposit",
                amount: args.openingBalance!,
                balanceAfter: args.openingBalance!,
                date: new Date().toISOString(),
                notes: "Opening balance",
                userId: args.userId,
            });
        }

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        const member = await ctx.db.get(args.memberId);
        if (!member) throw new Error("Member not found");

        if (args.amount <= 0) throw new Error("Amount must be greater than zero");

        const isCredit = ["deposit", "share_purchase", "loan", "repayment", "refund"].includes(args.type);
        const delta = isCredit ? args.amount : -args.amount;
        const newBalance = member.balance + delta;

        if (newBalance < 0) {
            throw new Error(`Insufficient balance. Available: ${member.balance}`);
        }

        await ctx.db.patch(args.memberId, {
            balance: newBalance,
            shares:
                args.type === "share_purchase"
                    ? (member.shares ?? 0) + args.amount
                    : member.shares,
        });

        const txId = await ctx.db.insert("memberTransactions", {
            businessProfileId: businessId,
            memberId: args.memberId,
            type: args.type,
            amount: args.amount,
            balanceAfter: newBalance,
            date: args.date || new Date().toISOString(),
            reference: args.reference,
            notes: args.notes,
            userId: args.userId,
        });

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
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
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db
            .query("memberTransactions")
            .withIndex("by_memberId", (q) => q.eq("memberId", args.memberId))
            .collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
        rows.sort((a, b) => b.date.localeCompare(a.date));
        return args.limit ? rows.slice(0, args.limit) : rows;
    },
});

export const getMembersSummary = query({
    args: {},
    handler: async (ctx) => {
        const businessId = await getActiveBusinessId(ctx);
        let members = await ctx.db.query("members").collect();
        if (businessId) members = members.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);

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
    args: { customerId: v.id("customers") },
    handler: async (ctx, args) => {
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        if (args.amount <= 0) throw new Error("Amount must be greater than zero");

        const wallet = await ctx.db
            .query("customerWallets")
            .withIndex("by_customerId", (q) => q.eq("customerId", args.customerId))
            .first();

        const current = wallet?.balance ?? 0;
        const delta = args.type === "topup" ? args.amount : -args.amount;
        const newBalance = current + delta;

        if (newBalance < 0) {
            throw new Error(`Insufficient wallet balance. Available: UGX ${current.toLocaleString()}`);
        }

        if (wallet) {
            await ctx.db.patch(wallet._id, { balance: newBalance, updatedAt: new Date().toISOString() });
        } else {
            await ctx.db.insert("customerWallets", {
                businessProfileId: businessId,
                customerId: args.customerId,
                balance: newBalance,
                updatedAt: new Date().toISOString(),
            });
        }

        const id = await ctx.db.insert("walletTransactions", {
            businessProfileId: businessId,
            customerId: args.customerId,
            type: args.type,
            amount: args.amount,
            balanceAfter: newBalance,
            date: new Date().toISOString(),
            saleId: args.saleId,
            userId: args.userId,
            notes: args.notes,
        });

        return { id, balance: newBalance };
    },
});

export const listWalletTransactions = query({
    args: { customerId: v.id("customers"), limit: v.optional(v.number()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db
            .query("walletTransactions")
            .withIndex("by_customerId", (q) => q.eq("customerId", args.customerId))
            .collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
        paid: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        if (args.rate < 0 || args.rate > 100) throw new Error("Commission rate must be between 0 and 100");

        const commission = Math.round((args.grossAmount * args.rate) / 100);
        const id = await ctx.db.insert("staffCommissions", {
            businessProfileId: businessId,
            userId: args.userId,
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
    args: { userId: v.optional(v.id("users")), startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("staffCommissions").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
    args: { id: v.id("staffCommissions"), paidDate: v.optional(v.string()) },
    handler: async (ctx, args) => {
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
        userId: v.id("users"),
    },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        if (args.amount <= 0) throw new Error("Amount must be greater than zero");

        const id = await ctx.db.insert("donations", {
            businessProfileId: businessId,
            donorName: args.donorName,
            donorPhone: args.donorPhone,
            memberId: args.memberId,
            type: args.type,
            amount: args.amount,
            purpose: args.purpose,
            reference: args.reference,
            date: new Date().toISOString(),
            userId: args.userId,
        });

        // A donation from a known member also credits their account.
        if (args.memberId) {
            const member = await ctx.db.get(args.memberId);
            if (member) {
                const newBalance = member.balance + args.amount;
                await ctx.db.patch(args.memberId, { balance: newBalance });
                await ctx.db.insert("memberTransactions", {
                    businessProfileId: businessId,
                    memberId: args.memberId,
                    type: "deposit",
                    amount: args.amount,
                    balanceAfter: newBalance,
                    date: new Date().toISOString(),
                    notes: args.purpose ?? args.type,
                    userId: args.userId,
                });
            }
        }

        await ctx.db.insert("activityLogs", {
            userId: args.userId,
            action: "Record Donation",
            details: `${args.type} of UGX ${args.amount.toLocaleString()} from ${args.donorName}`,
            timestamp: new Date().toISOString(),
        });

        return id;
    },
});

export const getDonationsSummary = query({
    args: { startDate: v.optional(v.string()), endDate: v.optional(v.string()) },
    handler: async (ctx, args) => {
        const businessId = await getActiveBusinessId(ctx);
        let rows = await ctx.db.query("donations").collect();
        if (businessId) rows = rows.filter((r) => !r.businessProfileId || r.businessProfileId === businessId);
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
