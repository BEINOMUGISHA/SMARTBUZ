/**
 * SMART_BUZ — notifications.
 *
 * Two kinds of thing reach a person in SMART_BUZ:
 *
 *   • a **notification** — something happened, and it is on the record:
 *     a sale was refunded, a payment was taken, a till did not balance.
 *   • an **attention item** — something is true *now* and needs a person:
 *     stock is below its reorder point, a layaway payment is late, a
 *     term fee is overdue.
 *
 * The difference matters. A notification is a fact that happened once; an
 * attention item is a fact that is still true. If the stock is still low
 * tomorrow, it is still on the list tomorrow — it is not a notification
 * that has been dealt with.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Who a notification is for
 * ────────────────────────────────────────────────────────────────────────
 *
 * A notification belongs to a **person**, not to a business. The owner and
 * the cashier both get their own copy of the same event, and each of them
 * marks it read for themselves. Nobody else sees it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this module does not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * It does not send email or SMS. Those go out through the messaging
 * integration, which is a different thing: a notification is what the
 * system knows, a message is what was sent to a customer.
 */

import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { requirePermission, requireTenant } from "./tenancy";

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The notifications addressed to the person asking, newest first.
 */
export const listNotifications = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** How many to bring back. */
        limit: v.optional(v.number()),
        /** Only the ones that have not been read. */
        unreadOnly: v.optional(v.boolean()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);

        const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);

        const rows = await ctx.db
            .query("notifications")
            .withIndex("by_userId_readAt", (q) =>
                q.eq("userId", tenant.user._id)
            )
            .collect();

        return rows
            .filter((row) => {
                if (row.businessId !== tenant.businessId) return false;
                if (args.unreadOnly && row.readAt) return false;
                return true;
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, limit)
            .map((row) => ({
                _id: row._id,
                kind: row.kind,
                title: row.title,
                body: row.body,
                link: row.link,
                severity: row.severity ?? "info",
                readAt: row.readAt,
                createdAt: row.createdAt,
            }));
    },
});

/**
 * How many are waiting to be read.
 *
 * The header shows this on the bell, so it is a separate query: it is
 * asked for on every screen, and it must not drag the whole list with it.
 */
export const unreadCount = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);

        const rows = await ctx.db
            .query("notifications")
            .withIndex("by_userId", (q) => q.eq("userId", tenant.user._id))
            .collect();

        return rows.filter(
            (row) => row.businessId === tenant.businessId && !row.readAt
        ).length;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Reading them
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Mark one notification as read.
 *
 * Only the person it is addressed to may mark it read — a notification is
 * their own, and reading it on somebody else's behalf would hide it from
 * them.
 */
export const markRead = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        id: v.id("notifications"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);

        const row = await ctx.db.get(args.id);
        if (!row || row.businessId !== tenant.businessId) {
            throw new ConvexError("Forbidden: that notification belongs to another business.");
        }
        if (row.userId !== tenant.user._id) {
            throw new ConvexError("That notification is addressed to somebody else.");
        }
        if (row.readAt) return row._id;

        await ctx.db.patch(args.id, { readAt: new Date().toISOString() });
        return args.id;
    },
});

/**
 * Mark everything as read.
 */
export const markAllRead = mutation({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);

        const rows = await ctx.db
            .query("notifications")
            .withIndex("by_userId", (q) => q.eq("userId", tenant.user._id))
            .collect();

        const now = new Date().toISOString();
        let changed = 0;

        for (const row of rows) {
            if (row.businessId !== tenant.businessId) continue;
            if (row.readAt) continue;
            await ctx.db.patch(row._id, { readAt: now });
            changed += 1;
        }

        return changed;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Leaving one
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Leave a notification for somebody.
 *
 * This is the helper other modules call. It is deliberately small: the
 * caller has already decided what happened, and this only records it in
 * the one place that knows how notifications are written.
 *
 * It returns the id of the row so the caller can point at it later.
 */
export async function notify(
    ctx: any,
    args: {
        businessId: Id<"businesses">;
        userId: Id<"users">;
        kind: string;
        title: string;
        body?: string;
        link?: string;
        severity?: "info" | "warning" | "critical";
        sourceType?: string;
        sourceId?: string;
    }
): Promise<Id<"notifications">> {
    return await ctx.db.insert("notifications", {
        businessId: args.businessId,
        userId: args.userId,
        kind: args.kind,
        title: args.title,
        body: args.body,
        link: args.link,
        severity: args.severity ?? "info",
        sourceType: args.sourceType,
        sourceId: args.sourceId,
        createdAt: new Date().toISOString(),
    });
}

/**
 * Leave the same notification for everybody who should see it.
 *
 * Some events belong to the business rather than to one person: a refund,
 * a fee invoice that has gone out, a quotation that has been sent. The
 * people who need to know are the ones who hold the job that makes the
 * decision — the owner, the admins, the accountant — not the whole staff
 * list, who would each get the same nudge.
 *
 * `exceptUserId` skips the person who caused it. They did it; they know.
 */
export async function notifyBusiness(
    ctx: any,
    args: {
        businessId: Id<"businesses">;
        kind: string;
        title: string;
        body?: string;
        link?: string;
        severity?: "info" | "warning" | "critical";
        sourceType?: string;
        sourceId?: string;
        /** The roles that should be told. Empty means everybody. */
        roles?: string[];
        /** The person who caused it, who does not need telling. */
        exceptUserId?: Id<"users">;
    }
): Promise<number> {
    const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_businessId", (q: any) =>
            q.eq("businessId", args.businessId)
        )
        .collect();

    const roles = args.roles ?? [];

    let written = 0;
    for (const membership of memberships) {
        if (membership.status === "suspended") continue;
        if (roles.length > 0 && !roles.includes(membership.role)) continue;
        if (args.exceptUserId && membership.userId === args.exceptUserId) {
            continue;
        }

        await notify(ctx, {
            businessId: args.businessId,
            userId: membership.userId,
            kind: args.kind,
            title: args.title,
            body: args.body,
            link: args.link,
            severity: args.severity,
            sourceType: args.sourceType,
            sourceId: args.sourceId,
        });
        written += 1;
    }

    return written;
}

/* ────────────────────────────────────────────────────────────────────────
 * What needs a person
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The things that are true right now and need somebody to deal with them.
 *
 * These are worked out on the server from the records themselves, rather
 * than being written when something happened. A stock level that is still
 * low tomorrow is still low tomorrow — and saying so is more useful than
 * a notification somebody has already read and forgotten.
 */
export const listAttentionItems = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "products.view");

        const today = new Date().toISOString().slice(0, 10);
        const inThirtyDays = new Date(Date.now() + 30 * 86400000)
            .toISOString()
            .slice(0, 10);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
            .toISOString()
            .slice(0, 10);

        const items: Array<{
            key: string;
            kind: string;
            title: string;
            body: string;
            link: string;
            severity: "info" | "warning" | "critical";
            amount?: number;
        }> = [];

        /* ── Stock below its reorder point ────────────────────────────── */

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        for (const stock of stocks) {
            if (stock.isActive === false) continue;

            const reorderPoint = stock.reorderPoint;
            if (reorderPoint === undefined) continue;
            if (stock.qty > reorderPoint) continue;

            const critical = stock.qty <= 0;
            items.push({
                key: `stock:${stock._id}`,
                kind: "stock",
                title: critical
                    ? `${stock.name} is out of stock`
                    : `${stock.name} is below its reorder point`,
                body: `${stock.qty} in hand, ${reorderPoint} is the reorder point.`,
                link: "/stock",
                severity: critical ? "critical" : "warning",
            });
        }

        /* ── A layaway or hire-purchase plan that is late ───────────── */

        const plans = await ctx.db
            .query("installmentPlans")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        for (const plan of plans) {
            if (plan.status !== "active") continue;
            if (plan.nextDueDate > today) continue;

            items.push({
                key: `plan:${plan._id}`,
                kind: "finance",
                title: `${plan.description} has a payment due`,
                body: `Due ${plan.nextDueDate}. ${plan.balance.toLocaleString()} still owed.`,
                link: "/plans",
                severity: "warning",
                amount: plan.balance,
            });
        }

        /* ── School fees that are overdue ───────────────────────────── */

        const invoices = await ctx.db
            .query("feeInvoices")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        for (const invoice of invoices) {
            if (invoice.status === "paid" || invoice.status === "void") continue;
            if (invoice.dueDate > today) continue;

            const daysLate = Math.max(
                1,
                Math.floor(
                    (Date.parse(today) - Date.parse(invoice.dueDate)) / 86400000
                )
            );

            items.push({
                key: `invoice:${invoice._id}`,
                kind: "finance",
                title: `${invoice.payerName} is overdue on fees`,
                body: `${invoice.term} — ${daysLate} ${daysLate === 1 ? "day" : "days"} late. ${invoice.balance.toLocaleString()} owed.`,
                link: "/fees",
                severity: daysLate > 30 ? "critical" : "warning",
                amount: invoice.balance,
            });
        }

        /* ── Stock that is about to expire ──────────────────────────── */

        const batches = await ctx.db
            .query("productBatches")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        for (const batch of batches) {
            if (!batch.expiryDate) continue;
            if (batch.expiryDate < thirtyDaysAgo) continue;
            if (batch.expiryDate > inThirtyDays) continue;
            if (batch.qtyRemaining <= 0) continue;

            items.push({
                key: `batch:${batch._id}`,
                kind: "stock",
                title: `${batch.batchNumber ?? "A batch"} expires on ${batch.expiryDate}`,
                body: `${batch.qtyRemaining} still in stock.`,
                link: "/batches",
                severity: batch.expiryDate < today ? "critical" : "warning",
            });
        }

        const order: Record<string, number> = {
            critical: 0,
            warning: 1,
            info: 2,
        };

        items.sort((a, b) => order[a.severity] - order[b.severity]);

        return items;
    },
});

/**
 * How many things need a person.
 */
export const attentionCount = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "products.view");

        const businessId = tenant.businessId;
        const today = new Date().toISOString().slice(0, 10);

        const stocks = await ctx.db
            .query("stocks")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const lowStock = stocks.filter(
            (stock) =>
                stock.isActive !== false &&
                stock.reorderPoint !== undefined &&
                stock.qty <= stock.reorderPoint
        ).length;

        const plans = await ctx.db
            .query("installmentPlans")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const latePlans = plans.filter(
            (plan) => plan.status === "active" && plan.nextDueDate <= today
        ).length;

        const invoices = await ctx.db
            .query("feeInvoices")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        const overdue = invoices.filter(
            (invoice) =>
                invoice.status !== "paid" &&
                invoice.status !== "void" &&
                invoice.dueDate <= today
        ).length;

        return lowStock + latePlans + overdue;
    },
});
