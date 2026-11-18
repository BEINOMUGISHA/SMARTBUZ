/**
 * SMARTBUZ — synchronisation.
 *
 * The server half of the offline engine. A till that lost its network kept
 * selling; when the network comes back it pushes what it sold, and this
 * module decides what happens to each sale.
 *
 * Four rules run through everything here:
 *
 *   1. **A sale is never lost.** If a sale was rung up, it gets recorded.
 *      A conflict about stock is recorded *alongside* the sale, not instead
 *      of it — the customer has the goods, so refusing the sale would leave
 *      the books wrong.
 *
 *   2. **A sale is never counted twice.** Every transaction carries a
 *      unique id. The same id arriving twice is recognised the second time
 *      and the original is returned.
 *
 *   3. **The money is not assumed.** An offline mobile-money payment has
 *      been seen by nobody but the customer and the cashier. It is recorded
 *      as pending verification, never as confirmed.
 *
 *   4. **Everything that arrives is written down.** Every push leaves a row
 *      in `syncLogs`, so "did my till's sales get in?" has an answer.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireTenant } from "./tenancy";
import { normalizeBusinessRole, roleHasPermission } from "./rbac";
import { writeAudit } from "./audit";
import { applySale, type SaleInput } from "./salesCore";
import { resolvePlan, subscriptionCoveredAt } from "./entitlements";
import { loadSubscriptionRow, loadSubscriptionStatus } from "./subscriptionState";

/* ────────────────────────────────────────────────────────────────────────
 * The shapes
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A sale as a till sends it.
 *
 * The shape is checked by `applySale` rather than by the argument validator,
 * on purpose. A validator that rejects the whole call would mean that one
 * malformed transaction in a batch of fifty stopped all fifty — and a
 * single bad record would then block the queue for ever. Checking each
 * transaction on its own means one bad sale is refused and the rest are
 * recorded.
 */
const salePayload = v.any();

const queuedTransaction = v.object({
    /** The unique id of the transaction, made by the till. */
    transactionId: v.string(),
    /** When the sale happened on the till. */
    occurredAt: v.string(),
    /** How many times the till had already tried. */
    attempts: v.optional(v.number()),
    /** The sale itself. */
    payload: salePayload,
});

/** What happened to one transaction. */
export interface PushResult {
    transactionId: string;
    /** applied | duplicate | rejected */
    status: "applied" | "duplicate" | "rejected";
    saleId?: Id<"sales">;
    invoiceNumber?: string;
    /** The stock conflicts this sale ran into. */
    conflicts?: Array<{
        stockId: Id<"stocks">;
        name: string;
        kind: "insufficient" | "drift";
        availableQty: number;
        requestedQty: number;
        expectedQty?: number;
        reason: string;
    }>;
    /** Why it was refused. */
    error?: string;
    /** confirmed | pending_verification */
    paymentConfirmation?: string;
    /** What the books say the sale came to. */
    total?: number;
    /**
     * What the till said it came to, when the two differ.
     *
     * The till was working from a price list that may have been out of
     * date. The books use the server's price; the difference is reported so
     * the cashier can tell the customer, rather than it being swallowed.
     */
    clientTotal?: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * Devices
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Register this installation.
 *
 * The device id is made by the till and is stable for as long as the
 * installation lasts, so the same till is always the same till. A device
 * that has been revoked cannot be registered again, and the plan's device
 * limit is enforced here.
 */
export const registerDevice = mutation({
    args: {
        deviceId: v.string(),
        platform: v.optional(v.string()),
        appVersion: v.optional(v.string()),
        deviceName: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;

        const deviceId = args.deviceId.trim();
        if (!deviceId) throw new ConvexError("A device needs an identifier.");

        const now = new Date().toISOString();

        const existing = await ctx.db
            .query("devices")
            .withIndex("by_businessId_deviceId", (q: any) =>
                q.eq("businessId", businessId).eq("deviceId", deviceId)
            )
            .unique();

        if (existing) {
            if (existing.status === "revoked") {
                throw new ConvexError(
                    "This device has been revoked. Ask an administrator to register it again."
                );
            }

            await ctx.db.patch(existing._id, {
                lastSeenAt: now,
                platform: args.platform ?? existing.platform,
                appVersion: args.appVersion ?? existing.appVersion,
                deviceName: args.deviceName ?? existing.deviceName,
            });

            return {
                deviceId,
                registered: true,
                alreadyRegistered: true,
                lastSyncAt: existing.lastSyncAt,
                lastSyncStatus: existing.lastSyncStatus,
            };
        }

        // How many devices does the plan allow?
        const subscription = await loadSubscriptionRow(ctx, businessId);
        const limit = subscription ? await deviceLimit(ctx, businessId) : 0;

        if (limit > 0) {
            const devices = await ctx.db
                .query("devices")
                .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
                .collect();
            const active = devices.filter((d: any) => d.status === "active");
            if (active.length >= limit) {
                throw new ConvexError(
                    `Your plan allows ${limit} device${
                        limit === 1 ? "" : "s"
                    }, and all ${limit} are in use. Revoke one, or upgrade your plan.`
                );
            }
        }

        await ctx.db.insert("devices", {
            businessId,
            deviceId,
            deviceName: args.deviceName?.trim() || `Device ${deviceId.slice(-4)}`,
            platform: args.platform,
            appVersion: args.appVersion,
            status: "active",
            registeredAt: now,
            lastSeenAt: now,
            lastSyncStatus: "idle",
            createdAt: now,
        });

        await writeAudit(ctx, {
            businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "sync.device.register",
            targetType: "device",
            targetId: deviceId,
            metadata: { platform: args.platform, appVersion: args.appVersion },
        });

        return {
            deviceId,
            registered: true,
            alreadyRegistered: false,
            lastSyncAt: undefined,
            lastSyncStatus: "idle",
        };
    },
});

/** How many devices the plan allows. */
async function deviceLimit(ctx: any, businessId: string): Promise<number> {
    const subscription = await loadSubscriptionRow(ctx, businessId);
    if (!subscription) return 0;
    const plan = await resolvePlan(ctx, subscription.planKey);
    return plan?.deviceLimit ?? 0;
}

/* ────────────────────────────────────────────────────────────────────────
 * Pushing the queue
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Take everything the till has been holding and record it.
 *
 * Each transaction is handled on its own: one bad sale does not stop the
 * rest of the queue, and one good sale is not held up by it.
 */
export const pushTransactions = mutation({
    args: {
        deviceId: v.string(),
        transactions: v.array(queuedTransaction),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const userId = tenant.user._id;
        const role = normalizeBusinessRole(tenant.membership.role);

        // The same permission a live sale needs. Checked here rather than
        // through `requirePermission` because an offline sale made while the
        // subscription was running must still be recordable after it has
        // lapsed — see `subscriptionCoveredAt` below.
        if (!roleHasPermission(role, "sales.create")) {
            throw new ConvexError(
                "Forbidden: your role cannot record sales."
            );
        }

        const deviceId = args.deviceId.trim();
        const now = new Date().toISOString();
        const results: PushResult[] = [];

        // The device must be known to this business.
        const device = await ctx.db
            .query("devices")
            .withIndex("by_businessId_deviceId", (q: any) =>
                q.eq("businessId", businessId).eq("deviceId", deviceId)
            )
            .unique();

        if (device && device.status === "revoked") {
            throw new ConvexError(
                "This device has been revoked. Its sales were not recorded — ask an administrator to register it again."
            );
        }

        for (const transaction of args.transactions) {
            const transactionId = transaction.transactionId.trim();
            if (!transactionId) continue;

            try {
                // ── 1. Has this one already been recorded? ─────────────
                const existing = await ctx.db
                    .query("sales")
                    .withIndex("by_clientOfflineId", (q: any) =>
                        q.eq("clientOfflineId", transactionId)
                    )
                    .filter((q: any) => q.eq(q.field("businessId"), businessId))
                    .first();

                if (existing) {
                    results.push({
                        transactionId,
                        status: "duplicate",
                        saleId: existing._id,
                        invoiceNumber: existing.invoiceNumber,
                    });

                    await writeSyncLog(ctx, {
                        businessId,
                        deviceId,
                        transactionId,
                        status: "duplicate",
                        attempts: transaction.attempts,
                        reason: "Already recorded.",
                        saleId: existing._id,
                        invoiceNumber: existing.invoiceNumber,
                        actorUserId: userId,
                    });

                    continue;
                }

                // ── 2. Was the business entitled to trade then? ─────────
                const status = await loadSubscriptionStatus(ctx, businessId);
                if (!status.writable) {
                    const occurredAt = new Date(transaction.occurredAt);
                    const covered = await subscriptionCoveredAt(
                        ctx,
                        businessId,
                        Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt
                    );
                    if (!covered) {
                        throw new ConvexError(
                            "This subscription was not active when the sale was made, so the sale was not recorded."
                        );
                    }
                }

                // ── 3. Record it ───────────────────────────────────────
                const payload = transaction.payload as SaleInput;
                const applied = await applySale(
                    ctx,
                    {
                        ...payload,
                        userId,
                        clientOfflineId: transactionId,
                        isOfflineSync: true,
                    },
                    {
                        businessId,
                        userId,
                        allowPriceOverrides:
                            tenant.business.allowPriceOverrides === true,
                        offline: {
                            deviceId,
                            transactionId,
                            occurredAt: transaction.occurredAt,
                        },
                    }
                );

                // ── 4. Record the stock conflicts ─────────────────────
                for (const conflict of applied.conflicts) {
                    await ctx.db.insert("stockConflicts", {
                        businessId,
                        deviceId,
                        transactionId,
                        stockId: conflict.stockId,
                        stockName: conflict.name,
                        expectedQty: conflict.expectedQty,
                        availableQty: conflict.availableQty,
                        requestedQty: conflict.requestedQty,
                        kind: conflict.kind,
                        status: "pending",
                        createdAt: now,
                    });
                }

                const sale = await ctx.db.get(applied.saleId);

                results.push({
                    transactionId,
                    status: "applied",
                    saleId: applied.saleId,
                    invoiceNumber: applied.invoiceNumber,
                    conflicts: applied.conflicts.map((c) => ({
                        stockId: c.stockId,
                        name: c.name,
                        kind: c.kind,
                        availableQty: c.availableQty,
                        requestedQty: c.requestedQty,
                        expectedQty: c.expectedQty,
                        reason: c.reason,
                    })),
                    paymentConfirmation: sale?.paymentConfirmation ?? undefined,
                    total: applied.total,
                    clientTotal: applied.clientTotal,
                });

                await writeSyncLog(ctx, {
                    businessId,
                    deviceId,
                    transactionId,
                    status: applied.conflicts.length > 0 ? "conflict" : "applied",
                    attempts: transaction.attempts,
                    reason:
                        applied.conflicts.length > 0
                            ? "Recorded, with a stock conflict."
                            : undefined,
                    saleId: applied.saleId,
                    invoiceNumber: applied.invoiceNumber,
                    conflictCount: applied.conflicts.length,
                    actorUserId: userId,
                });
            } catch (error: any) {
                const message =
                    error?.data?.message ?? error?.message ?? "The sale was refused.";

                results.push({
                    transactionId,
                    status: "rejected",
                    error: message,
                });

                await writeSyncLog(ctx, {
                    businessId,
                    deviceId,
                    transactionId,
                    status: "rejected",
                    attempts: transaction.attempts,
                    reason: message,
                    actorUserId: userId,
                });
            }
        }

        // The device has spoken to the server.
        if (device) {
            await ctx.db.patch(device._id, {
                lastSeenAt: now,
                lastSyncAt: now,
                lastSyncStatus: "ok",
                lastSyncError: undefined,
            });
        }

        return {
            results,
            processedAt: now,
            accepted: results.filter((r) => r.status !== "rejected").length,
            rejected: results.filter((r) => r.status === "rejected").length,
        };
    },
});

/** Write one row of the synchronisation audit trail. */
async function writeSyncLog(
    ctx: any,
    entry: {
        businessId: Id<"businesses">;
        deviceId?: string;
        transactionId?: string;
        status: string;
        attempts?: number;
        reason?: string;
        saleId?: Id<"sales">;
        invoiceNumber?: string;
        conflictCount?: number;
        actorUserId?: Id<"users">;
    }
) {
    await ctx.db.insert("syncLogs", {
        businessId: entry.businessId,
        deviceId: entry.deviceId,
        transactionId: entry.transactionId,
        direction: "push",
        status: entry.status,
        attempts: entry.attempts,
        reason: entry.reason,
        saleId: entry.saleId,
        invoiceNumber: entry.invoiceNumber,
        conflictCount: entry.conflictCount,
        actorUserId: entry.actorUserId,
        createdAt: new Date().toISOString(),
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * Conflicts
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The stock that two devices both sold while offline.
 *
 * These are the sales that went through, but where the stock they needed
 * had already gone. The owner decides what to do about each one.
 */
export const listConflicts = query({
    args: {
        status: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requireSalesViewer(ctx, tenant);

        let conflicts = await ctx.db
            .query("stockConflicts")
            .withIndex("by_businessId", (q: any) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        if (args.status) {
            conflicts = conflicts.filter((c: any) => c.status === args.status);
        }

        conflicts.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));

        return conflicts.map((c: any) => ({
            _id: c._id,
            deviceId: c.deviceId,
            transactionId: c.transactionId,
            stockId: c.stockId,
            stockName: c.stockName,
            expectedQty: c.expectedQty,
            availableQty: c.availableQty,
            requestedQty: c.requestedQty,
            kind: c.kind,
            status: c.status,
            resolution: c.resolution,
            resolvedAt: c.resolvedAt,
            note: c.note,
            createdAt: c.createdAt,
        }));
    },
});

/**
 * Decide what to do about a conflict.
 *
 * `accepted` — the sale stands; the stock was genuinely gone and the
 * shortfall is a stock-take matter.
 * `rejected` — the sale was a mistake and should be reversed.
 * `stock_adjusted` — the stock record has been corrected.
 */
export const resolveConflict = mutation({
    args: {
        conflictId: v.id("stockConflicts"),
        resolution: v.string(),
        note: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requireSalesViewer(ctx, tenant);

        const conflict = await ctx.db.get(args.conflictId);
        if (!conflict || conflict.businessId !== tenant.businessId) {
            throw new ConvexError("That conflict does not exist.");
        }
        if (conflict.status !== "pending") {
            return { conflictId: conflict._id, changed: false, status: conflict.status };
        }

        const allowed = ["accepted", "rejected", "stock_adjusted"];
        if (!allowed.includes(args.resolution)) {
            throw new ConvexError(
                `Choose one of: ${allowed.join(", ")}.`
            );
        }

        await ctx.db.patch(conflict._id, {
            status: "resolved",
            resolution: args.resolution,
            note: args.note,
            resolvedBy: tenant.user._id,
            resolvedAt: new Date().toISOString(),
        });

        await writeAudit(ctx, {
            businessId: tenant.businessId,
            actorUserId: tenant.user._id,
            actorRole: tenant.membership.role,
            action: "sync.conflict.resolve",
            targetType: "stock_conflict",
            targetId: conflict._id,
            metadata: { resolution: args.resolution, note: args.note },
        });

        return { conflictId: conflict._id, changed: true, status: "resolved" };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Status
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * How this device's queue is doing, from the server's side.
 *
 * The till's own view is what the cashier sees; this is what the owner
 * sees when they ask whether a till has caught up.
 */
export const getSyncStatus = query({
    args: {
        deviceId: v.optional(v.string()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requireSalesViewer(ctx, tenant);

        const devices = await ctx.db
            .query("devices")
            .withIndex("by_businessId", (q: any) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        const conflicts = await ctx.db
            .query("stockConflicts")
            .withIndex("by_businessId_status", (q: any) =>
                q.eq("businessId", tenant.businessId).eq("status", "pending")
            )
            .collect();

        const logs = await ctx.db
            .query("syncLogs")
            .withIndex("by_businessId_createdAt", (q: any) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        const wanted = args.deviceId
            ? devices.filter((d: any) => d.deviceId === args.deviceId)
            : devices;

        return {
            devices: wanted.map((d: any) => ({
                deviceId: d.deviceId,
                deviceName: d.deviceName,
                platform: d.platform,
                appVersion: d.appVersion,
                status: d.status,
                registeredAt: d.registeredAt,
                lastSeenAt: d.lastSeenAt,
                lastSyncAt: d.lastSyncAt,
                lastSyncStatus: d.lastSyncStatus,
                lastSyncError: d.lastSyncError,
            })),
            pendingConflicts: conflicts.length,
            lastActivityAt: logs.length
                ? logs.map((l: any) => l.createdAt).sort().slice(-1)[0]
                : undefined,
        };
    },
});

/**
 * The synchronisation audit trail.
 *
 * What arrived, from which device, and what the server did with it.
 */
export const listSyncLogs = query({
    args: {
        deviceId: v.optional(v.string()),
        limit: v.optional(v.number()),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requireSalesViewer(ctx, tenant);

        let logs = await ctx.db
            .query("syncLogs")
            .withIndex("by_businessId", (q: any) =>
                q.eq("businessId", tenant.businessId)
            )
            .collect();

        if (args.deviceId) {
            logs = logs.filter((l: any) => l.deviceId === args.deviceId);
        }

        logs.sort((a: any, b: any) => b.createdAt.localeCompare(a.createdAt));

        const limit = args.limit ?? 100;

        return logs.slice(0, limit).map((l: any) => ({
            _id: l._id,
            deviceId: l.deviceId,
            transactionId: l.transactionId,
            direction: l.direction,
            status: l.status,
            attempts: l.attempts,
            reason: l.reason,
            saleId: l.saleId,
            invoiceNumber: l.invoiceNumber,
            conflictCount: l.conflictCount,
            createdAt: l.createdAt,
        }));
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * A small helper
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Reading the sales of a business needs the sales viewing permission.
 *
 * The write gate is deliberately not applied here: reading the sync log is
 * reading, and a lapsed business must still be able to see what it owes.
 */
async function requireSalesViewer(ctx: any, tenant: any) {
    const role = normalizeBusinessRole(tenant.membership.role);
    if (!roleHasPermission(role, "sales.view")) {
        throw new ConvexError(
            "Forbidden: your role cannot view the synchronisation record."
        );
    }
}
