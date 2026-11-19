/**
 * SMARTBUZ — payments through the integration adapters.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The one rule that matters
 * ────────────────────────────────────────────────────────────────────────
 *
 * **A payment is confirmed by the provider, never by the browser.**
 *
 * When a cashier starts a mobile-money collection, the money has not been
 * taken. The customer still has to enter their PIN. The sale is therefore
 * left at `pending_verification` — exactly as an offline sale is — and it
 * only moves to `confirmed` when the provider's own callback arrives, or
 * when a status query against the provider says so.
 *
 * This is the same rule the offline engine follows, and it exists for the
 * same reason: if SMARTBUZ says a customer paid and they did not, the
 * books are wrong and nobody can find out why.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Idempotency
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every collection carries a reference that is ours. It is sent to the
 * provider as the idempotency key and it is stored against the intent, so
 * a retry after a timeout cannot take the money twice — and if the same
 * reference is ever pushed again, the existing intent is found and the
 * duplicate is refused.
 */

import { action, internalQuery, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { requirePermission, requireTenant } from "../tenancy";
import { loadIntegration, requireUsableIntegration } from "./config";
import { paymentProvider } from "./engine";
import { findAdapter } from "./registry";
import type { PaymentInitiation, PaymentStatus } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * References
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A reference for one collection.
 *
 * It has to be unique, and it has to be unguessable enough that a
 * callback cannot be forged by guessing it. The random part comes from
 * the platform's own randomness, not from a counter.
 */
export function paymentReference(): string {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    const suffix = Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return `SBZ-PAY-${Date.now().toString(36)}-${suffix.toUpperCase()}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Starting a collection
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Ask a provider to take a payment.
 *
 * The reference is ours and is the same one that is sent to the provider,
 * so a retry of this call with the same reference cannot take the money
 * twice.
 */
export const initiatePayment = action({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
        amount: v.number(),
        currency: v.optional(v.string()),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        description: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),
        customerId: v.optional(v.id("customers")),
        /** Supply a reference to make the call idempotent. */
        reference: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{
        reference: string;
        status: string;
        providerReference?: string;
        message?: string;
        duplicate: boolean;
        sandbox: boolean;
    }> => {
        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(
                `Unknown integration adapter: ${args.adapterKey}.`
            );
        }
        if (adapter.category !== "payment") {
            throw new ConvexError(`${adapter.label} is not a payment adapter.`);
        }

        if (args.amount <= 0) {
            throw new ConvexError("The amount must be greater than zero.");
        }

        // The tenant, the permission and the adapter's credentials are
        // resolved in one internal call. The adapter must have been proved
        // against the real provider — "configured" is not "works".
        const prepared = await ctx.runQuery(
            internal.integrations.internal.prepareAdapterCall,
            {
                businessId: args.businessId,
                adapterKey: args.adapterKey,
                permission: "sales.create",
                requireVerified: true,
            }
        );

        const businessId = prepared.businessId;

        const reference = args.reference ?? paymentReference();

        // If this reference has already been used, the collection is
        // already in flight — return what is known rather than asking the
        // provider to take the money a second time.
        const existing = await ctx.runQuery(
            internal.integrations.payments.findPaymentByReference,
            { reference }
        );

        if (existing) {
            if (existing.businessId !== businessId) {
                throw new ConvexError(
                    "Forbidden: that payment reference belongs to another business."
                );
            }
            return {
                reference: existing.reference,
                status: existing.status,
                providerReference: existing.providerReference,
                message:
                    existing.status === "succeeded"
                        ? "This payment has already been confirmed by the provider."
                        : "This payment is already in progress.",
                duplicate: true,
                sandbox: prepared.sandbox,
            };
        }

        const provider = paymentProvider(args.adapterKey);

        const request: PaymentInitiation = {
            adapterKey: args.adapterKey,
            amount: args.amount,
            currency: args.currency ?? String(prepared.config.currency ?? "UGX"),
            phone: args.phone,
            email: args.email,
            reference,
            description: args.description,
            saleId: args.saleId,
            customerId: args.customerId,
        };

        const context = {
            config: prepared.config,
            secrets: prepared.secrets,
            sandbox: prepared.sandbox,
        };

        let result;
        try {
            result = await provider.initiate(context, request);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await ctx.runMutation(api.integrations.payments.recordPaymentOutcome, {
                businessId,
                adapterKey: args.adapterKey,
                reference,
                amount: args.amount,
                currency: request.currency,
                phone: args.phone,
                email: args.email,
                status: "failed",
                error: message,
                description: args.description,
                saleId: args.saleId,
                customerId: args.customerId,
                sandbox: prepared.sandbox,
                userId: prepared.userId,
            });
            throw new ConvexError(message);
        }

        await ctx.runMutation(api.integrations.payments.recordPaymentOutcome, {
            businessId,
            adapterKey: args.adapterKey,
            reference,
            amount: args.amount,
            currency: request.currency,
            phone: args.phone,
            email: args.email,
            status: result.status,
            providerReference: result.providerReference,
            providerPayload: result.raw,
            message: result.message,
            description: args.description,
            saleId: args.saleId,
            customerId: args.customerId,
            sandbox: prepared.sandbox,
            userId: prepared.userId,
        });

        return {
            reference,
            status: result.status,
            providerReference: result.providerReference,
            message: result.message,
            duplicate: false,
            sandbox: prepared.sandbox,
        };
    },
});

/**
 * Record what a provider said about a payment.
 *
 * An action cannot write to the database, so the action calls this.
 */
export const recordPaymentOutcome = mutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        reference: v.string(),
        amount: v.number(),
        currency: v.string(),
        phone: v.optional(v.string()),
        email: v.optional(v.string()),
        status: v.string(),
        providerReference: v.optional(v.string()),
        providerPayload: v.optional(v.any()),
        message: v.optional(v.string()),
        error: v.optional(v.string()),
        description: v.optional(v.string()),
        saleId: v.optional(v.id("sales")),
        customerId: v.optional(v.id("customers")),
        sandbox: v.optional(v.boolean()),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const now = new Date().toISOString();

        const existing = await ctx.db
            .query("paymentIntents")
            .withIndex("by_reference", (q) => q.eq("reference", args.reference))
            .unique();

        const payload = {
            status: args.status,
            providerReference: args.providerReference,
            providerPayload: args.providerPayload,
            error: args.error,
            updatedAt: now,
        };

        if (existing) {
            await ctx.db.patch(existing._id, payload);
        } else {
            await ctx.db.insert("paymentIntents", {
                businessId: args.businessId,
                adapterKey: args.adapterKey,
                provider: args.adapterKey.split(".")[0],
                reference: args.reference,
                providerReference: args.providerReference,
                amount: args.amount,
                currency: args.currency,
                phone: args.phone,
                email: args.email,
                status: args.status,
                saleId: args.saleId,
                customerId: args.customerId,
                confirmedByProvider: false,
                description: args.description,
                providerPayload: args.providerPayload,
                error: args.error,
                sandbox: args.sandbox,
                createdAt: now,
                updatedAt: now,
            });
        }

        await ctx.db.insert("integrationEvents", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            direction: "outbound",
            kind: "payment_initiated",
            status: args.error ? "failed" : "ok",
            reference: args.reference,
            summary: args.message ?? args.error,
            error: args.error,
            payload: args.providerPayload,
            userId: args.userId,
            createdAt: now,
        });

        return null;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Confirming a payment
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Confirm a payment, and move its sale with it.
 *
 * This is called by two things: the provider's own callback, and an
 * operator who has checked the provider's app or statement by hand. Both
 * paths end up here, and both end up writing down who or what confirmed
 * it.
 */
export const confirmPayment = mutation({
    args: {
        businessId: v.id("businesses"),
        reference: v.string(),
        providerReference: v.optional(v.string()),
        status: v.optional(v.string()),
        providerPayload: v.optional(v.any()),
        /** `provider` — the provider's own callback. `manual` — a person. */
        confirmedBy: v.string(),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const now = new Date().toISOString();

        const intent = await ctx.db
            .query("paymentIntents")
            .withIndex("by_reference", (q) => q.eq("reference", args.reference))
            .unique();

        if (!intent) {
            throw new ConvexError(
                "No payment was found with that reference. Nothing was confirmed."
            );
        }

        if (intent.businessId !== args.businessId) {
            throw new ConvexError(
                "Forbidden: that payment belongs to another business."
            );
        }

        const status = args.status ?? "succeeded";

        await ctx.db.patch(intent._id, {
            status,
            providerReference: args.providerReference ?? intent.providerReference,
            providerPayload: args.providerPayload ?? intent.providerPayload,
            confirmedByProvider: true,
            error: undefined,
            updatedAt: now,
        });

        // The sale follows the payment. A sale whose payment has been
        // confirmed by the provider is a confirmed sale; one whose payment
        // failed is not.
        if (intent.saleId) {
            const sale = await ctx.db.get(intent.saleId);
            if (sale && sale.businessId === args.businessId) {
                await ctx.db.patch(intent.saleId, {
                    paymentConfirmation:
                        status === "succeeded" ? "confirmed" : "pending_verification",
                });
            }
        }

        await ctx.db.insert("integrationEvents", {
            businessId: args.businessId,
            adapterKey: intent.adapterKey,
            direction: args.confirmedBy === "provider" ? "inbound" : "outbound",
            kind: "payment_confirmed",
            status: status === "succeeded" ? "ok" : "failed",
            reference: args.reference,
            summary:
                args.confirmedBy === "provider"
                    ? `The provider confirmed the payment as ${status}.`
                    : `A member of staff confirmed the payment as ${status} by hand.`,
            payload: args.providerPayload,
            userId: args.userId,
            createdAt: now,
        });

        return { reference: args.reference, status };
    },
});

/**
 * Ask the provider about a payment whose callback never arrived.
 *
 * This is what an operator does when a customer says they paid but the
 * till never settled. The answer comes from the provider, not from us.
 */
export const verifyPaymentWithProvider = action({
    args: {
        businessId: v.optional(v.id("businesses")),
        reference: v.string(),
    },
    handler: async (ctx, args): Promise<{
        reference: string;
        status: string;
        message?: string;
        providerReference?: string;
    }> => {
        const prepared = await ctx.runQuery(
            internal.integrations.internal.resolveActionContext,
            {
                businessId: args.businessId,
                permission: "payments.verify",
            }
        );

        const businessId = prepared.businessId;

        const intent = await ctx.runQuery(
            internal.integrations.internal.findIntentForReference,
            { reference: args.reference }
        );

        if (!intent) {
            throw new ConvexError(
                "No payment was found with that reference."
            );
        }

        if (intent.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that payment belongs to another business."
            );
        }

        const adapterContext = await ctx.runQuery(
            internal.integrations.internal.prepareAdapterCall,
            {
                businessId,
                adapterKey: intent.adapterKey,
                permission: "payments.verify",
                requireVerified: false,
            }
        );

        const provider = paymentProvider(intent.adapterKey);

        const context = {
            config: adapterContext.config,
            secrets: adapterContext.secrets,
            sandbox: adapterContext.sandbox,
        };

        let result;
        try {
            result = await provider.verify(context, args.reference);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await ctx.runMutation(api.integrations.payments.recordProviderError, {
                businessId,
                adapterKey: intent.adapterKey,
                reference: args.reference,
                error: message,
                userId: prepared.userId,
            });
            throw new ConvexError(message);
        }

        if (result.status === "succeeded" || result.status === "failed") {
            await ctx.runMutation(api.integrations.payments.confirmPayment, {
                businessId,
                reference: args.reference,
                providerReference: result.providerReference,
                status: result.status,
                providerPayload: result.raw,
                confirmedBy: "provider",
                userId: prepared.userId,
            });
        }

        return {
            reference: args.reference,
            status: result.status,
            message: result.message,
            providerReference: result.providerReference,
        };
    },
});

/** Write down a provider call that failed. */
export const recordProviderError = mutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        reference: v.string(),
        error: v.string(),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("integrationEvents", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            direction: "outbound",
            kind: "payment_lookup_failed",
            status: "failed",
            reference: args.reference,
            error: args.error,
            userId: args.userId,
            createdAt: new Date().toISOString(),
        });
        return null;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The payments this business has started.
 *
 * Newest first, so the operator sees the one they are waiting for at the
 * top.
 */
export const listPaymentIntents = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        status: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "finance.view");

        const limit = Math.min(args.limit ?? 50, 200);

        let rows = await ctx.db
            .query("paymentIntents")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.status) {
            rows = rows.filter((r) => r.status === args.status);
        }

        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return rows.slice(0, limit).map((row) => ({
            id: row._id,
            adapterKey: row.adapterKey,
            provider: row.provider,
            reference: row.reference,
            providerReference: row.providerReference,
            amount: row.amount,
            currency: row.currency,
            phone: row.phone,
            status: row.status,
            confirmedByProvider: row.confirmedByProvider ?? false,
            saleId: row.saleId,
            description: row.description,
            error: row.error,
            sandbox: row.sandbox ?? false,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
        }));
    },
});

/**
 * The payments that are still waiting for the provider.
 *
 * These are the ones that need a person to look at them.
 */
export const listPendingPayments = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "finance.view");

        const rows = await ctx.db
            .query("paymentIntents")
            .withIndex("by_businessId_status", (q) =>
                q.eq("businessId", businessId).eq("status", "pending")
            )
            .collect();

        rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

        return rows.map((row) => ({
            id: row._id,
            adapterKey: row.adapterKey,
            reference: row.reference,
            amount: row.amount,
            currency: row.currency,
            phone: row.phone,
            saleId: row.saleId,
            description: row.description,
            createdAt: row.createdAt,
        }));
    },
});

/**
 * Find a payment by its reference.
 *
 * Internal, because a public query that answered "does this reference
 * exist?" would tell a stranger about another tenant's payments.
 */
export const findPaymentByReference = internalQuery({
    args: { reference: v.string() },
    handler: async (ctx, args) => {
        const intent = await ctx.db
            .query("paymentIntents")
            .withIndex("by_reference", (q) => q.eq("reference", args.reference))
            .unique();

        if (!intent) return null;

        return {
            businessId: intent.businessId,
            adapterKey: intent.adapterKey,
            reference: intent.reference,
            status: intent.status,
            providerReference: intent.providerReference,
        };
    },
});

/** The status vocabulary a payment may have. */
export const PAYMENT_STATUSES: PaymentStatus[] = [
    "pending",
    "succeeded",
    "failed",
    "cancelled",
];

/** The Id type is used in the argument shapes above. */
export type PaymentBusinessId = Id<"businesses">;
