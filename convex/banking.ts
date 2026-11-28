import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";
import { writeAudit } from "./audit";

/**
 * SMARTBUZ — banking records (money in and out of the till).
 *
 * Tenant-scoped: a business only ever sees its own banking records.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The sign of the amount is the direction of the money
 * ────────────────────────────────────────────────────────────────────────
 *
 * A banking record is a line in the business's money book. There is no
 * "type" column, so the direction of the money is carried by the sign of
 * the amount:
 *
 *   • a positive amount is money **in** — a cash drop, a bank transfer in;
 *   • a negative amount is money **out** — what was paid to a supplier.
 *
 * The browser is told this rule and sends the signed amount. The server
 * still refuses an amount of zero, because a line that moves no money is
 * not a line in a money book.
 */
export const create = mutation({
    args: {
        date: v.string(),
        /** Positive for money in, negative for money out. */
        amount: v.number(),
        comment: v.string(),
        /** @deprecated — the caller is derived from the session. */
        userId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        if (!Number.isFinite(args.amount) || args.amount === 0) {
            throw new ConvexError("A banking record must move some money.");
        }
        if (!args.comment.trim()) {
            throw new ConvexError("Say what the money was for.");
        }

        const { userId, businessId, ...record } = args;
        const id = await ctx.db.insert("banking", {
            ...record,
            businessId: tenant.businessId,
        });

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Create Banking Record",
            `Recorded ${args.amount.toLocaleString()} - ${args.comment}`
        );

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "banking.create",
            targetType: "banking",
            targetId: id,
            metadata: {
                amount: args.amount,
                date: args.date,
                comment: args.comment,
            },
        });

        return id;
    },
});
export const list = query({
    args: {
        paginationOpts: paginationOptsValidator,
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "finance.reports.view");

        return await ctx.db
            .query("banking")
            .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
            .order("desc")
            .paginate(args.paginationOpts);
    },
});

export const update = mutation({
    args: {
        id: v.id("banking"),
        date: v.optional(v.string()),
        amount: v.optional(v.number()),
        comment: v.optional(v.string()),
        /** @deprecated — the caller is derived from the session. */
        userId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        const banking = await ctx.db.get(args.id);
        if (!banking) throw new ConvexError("Banking record not found");
        if (banking.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that banking record belongs to another business."
            );
        }
        if (args.amount !== undefined && (!Number.isFinite(args.amount) || args.amount === 0)) {
            throw new ConvexError("A banking record must move some money.");
        }

        const { id, userId, businessId, ...rest } = args;
        await ctx.db.patch(id, rest as any);

        // Log activity
        const changes = Object.keys(rest).map(key => `${key}: ${rest[key as keyof typeof rest]}`).join(", ");
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Update Banking Record",
            `Updated banking record - Changes: ${changes}`
        );

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "banking.update",
            targetType: "banking",
            targetId: id,
            metadata: { changes: rest },
        });
    },
});

export const remove = mutation({
    args: {
        id: v.id("banking"),
        /** @deprecated — the caller is derived from the session. */
        userId: v.optional(v.id("users")),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        const banking = await ctx.db.get(args.id);
        if (!banking) throw new ConvexError("Banking record not found");
        if (banking.businessId !== tenant.businessId) {
            throw new ConvexError(
                "Forbidden: that banking record belongs to another business."
            );
        }

        await ctx.db.delete(args.id);

        // Log activity
        await logActivity(
            ctx,
            tenant.businessId,
            tenant.user._id,
            "Delete Banking Record",
            `Deleted banking record - Amount: ${banking.amount?.toLocaleString() || 'N/A'}, Comment: ${banking.comment || 'N/A'}`
        );

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "banking.delete",
            targetType: "banking",
            targetId: args.id,
            metadata: {
                amount: banking.amount,
                date: banking.date,
                comment: banking.comment,
            },
        });
    },
});
