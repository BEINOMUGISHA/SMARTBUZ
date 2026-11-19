/**
 * SMARTBUZ — the internal bridge.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this module exists
 * ────────────────────────────────────────────────────────────────────────
 *
 * In this Convex version an **action has no database**. It can read the
 * database only by calling a query, and it can write only by calling a
 * mutation.
 *
 * That matters here, because the integration adapters live in actions —
 * `fetch` is only allowed in an action — and an action needs three things
 * before it may call a provider:
 *
 *   1. to know who is calling and which tenant they belong to,
 *   2. to know that they are allowed to use this adapter, and
 *   3. the adapter's decrypted credentials.
 *
 * All three are resolved here, in one place, so that every adapter call
 * goes through the same gate and none of them can forget it.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why these are internal functions
 * ────────────────────────────────────────────────────────────────────────
 *
 * These queries hand back the **decrypted credentials**. A public query
 * can be called by anyone who can reach the deployment, so a public query
 * that returned secrets would be a hole straight through the encryption.
 *
 * An `internalQuery` can only be called from another Convex function. The
 * browser cannot reach it at all, so the secrets stay on the server.
 */

import { internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requireMembership, resolveMemberPermissions } from "../tenancy";
import { requireUser } from "../tenancy";
import { loadIntegration } from "./config";
import { findAdapter } from "./registry";
import type { VerificationStatus } from "./types";

/**
 * Everything an action needs to make a provider call.
 */
export interface AdapterCallContext {
    businessId: Id<"businesses">;
    userId: Id<"users">;
    role: string;
    adapterKey: string;
    /** The non-secret configuration. */
    config: Record<string, unknown>;
    /** The decrypted secrets. Server-side only — never sent to a browser. */
    secrets: Record<string, string>;
    /** True when the adapter points at a sandbox. */
    sandbox: boolean;
    verificationStatus: VerificationStatus;
}

/**
 * Resolve the caller, the tenant, the permission and the adapter's
 * credentials — all in one call.
 *
 * The permission is checked here, not in the action, so that no adapter
 * call can happen without it.
 */
export const prepareAdapterCall = internalQuery({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
        /** The permission the caller must hold. */
        permission: v.string(),
        /**
         * Whether the adapter has to have passed its live test.
         *
         * Reading a configuration does not need a proven adapter; moving
         * money or sending a message does.
         */
        requireVerified: v.optional(v.boolean()),
    },
    handler: async (ctx, args): Promise<AdapterCallContext> => {
        const user = await requireUser(ctx);

        // The tenant is resolved from the caller's membership, never from
        // the argument alone.
        let businessId = args.businessId;
        if (!businessId) {
            businessId = (await resolveBusinessIdFor(ctx, user._id)) as Id<"businesses">;
        }

        const membership = await requireMembership(ctx, businessId, user._id);
        const permissions = await resolveMemberPermissions(
            ctx,
            businessId,
            membership
        );

        const permission = args.permission as never;
        if (!permissions.has(permission)) {
            throw new ConvexError(
                `Forbidden: your role (${membership.role}) cannot ${String(
                    permission
                ).replace(/\./g, " ")}.`
            );
        }

        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(
                `Unknown integration adapter: ${args.adapterKey}.`
            );
        }

        const loaded = await loadIntegration(ctx, businessId, args.adapterKey);

        if (!loaded.row || !loaded.enabled) {
            throw new ConvexError(
                `${adapter.label} is not switched on for this business. Turn it on in Integrations before using it.`
            );
        }

        const missing: string[] = [];
        for (const field of adapter.configFields) {
            if (!field.required) continue;
            const value = loaded.config[field.key];
            const present =
                value !== undefined &&
                value !== null &&
                String(value).trim() !== "" &&
                String(value) !== "false";
            const secretValue =
                field.type === "secret" ? loaded.secrets[field.key] : undefined;
            if (!present && !secretValue) missing.push(field.label);
        }

        if (missing.length > 0) {
            throw new ConvexError(
                `${adapter.label} is not fully configured. Still needed: ${missing.join(", ")}.`
            );
        }

        // The gate that matters: an adapter that has never reached the
        // real provider may not move money or send messages.
        if (args.requireVerified !== false && loaded.verificationStatus !== "verified") {
            throw new ConvexError(
                `${adapter.label} has not been verified against the live provider, so it cannot be used to move money or send messages. Run the live test in Integrations first.`
            );
        }

        return {
            businessId,
            userId: user._id,
            role: membership.role,
            adapterKey: args.adapterKey,
            config: loaded.config,
            secrets: loaded.secrets,
            sandbox: loaded.sandbox,
            verificationStatus: loaded.verificationStatus,
        };
    },
});

/**
 * The business the caller is working in, when they did not name one.
 *
 * The same order the tenancy module uses: the business they last used, or
 * the only one they are a member of.
 */
async function resolveBusinessIdFor(
    ctx: any,
    userId: Id<"users">
): Promise<Id<"businesses"> | null> {
    const user = await ctx.db.get(userId);
    if (user?.activeBusinessId) return user.activeBusinessId as Id<"businesses">;

    const memberships = await ctx.db
        .query("memberships")
        .withIndex("by_userId", (q: any) => q.eq("userId", userId))
        .collect();

    const active = memberships.filter(
        (m: any) => (m.status ?? "active") === "active"
    );

    if (active.length === 1) return active[0].businessId as Id<"businesses">;

    return null;
}

/**
 * Resolve the caller and the tenant, and check a permission.
 *
 * Used by the actions that need to know who they are acting for before
 * they know which adapter they will use.
 */
export const resolveActionContext = internalQuery({
    args: {
        businessId: v.optional(v.id("businesses")),
        /** The permission the caller must hold. */
        permission: v.string(),
    },
    handler: async (ctx, args) => {
        const user = await requireUser(ctx);

        let businessId = args.businessId;
        if (!businessId) {
            businessId = (await resolveBusinessIdFor(ctx, user._id)) as Id<"businesses">;
        }

        const membership = await requireMembership(ctx, businessId, user._id);
        const permissions = await resolveMemberPermissions(
            ctx,
            businessId,
            membership
        );

        const permission = args.permission as never;
        if (!permissions.has(permission)) {
            throw new ConvexError(
                `Forbidden: your role (${membership.role}) cannot ${String(
                    permission
                ).replace(/\./g, " ")}.`
            );
        }

        return {
            businessId,
            userId: user._id,
            role: membership.role,
        };
    },
});

/**
 * Find the payment a reference names.
 *
 * Internal, because a public query that answered "does this reference
 * exist?" would tell a stranger about another tenant's payments.
 */
export const findIntentForReference = internalQuery({
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
        };    },
});

/**
 * Everything a receipt needs, read in one place.
 *
 * The receipt is built from the sale as the server holds it — the stored
 * prices, the stored total — never from anything the browser sends. A
 * receipt that disagrees with the books is worse than no receipt.
 */
export const receiptContext = internalQuery({
    args: {
        businessId: v.id("businesses"),
        saleId: v.id("sales"),
    },
    handler: async (ctx, args) => {
        const sale = await ctx.db.get(args.saleId);
        if (!sale || sale.businessId !== args.businessId) {
            throw new ConvexError(
                "Forbidden: that sale belongs to another business."
            );
        }

        const business = await ctx.db.get(args.businessId);

        let phone = "";
        let email = "";
        let customerName = sale.manualCustomerName ?? "Customer";

        if (sale.customerId) {
            const customer = await ctx.db.get(sale.customerId);
            if (customer && customer.businessId === args.businessId) {
                phone = customer.phone ?? "";
                email = customer.email ?? "";
                customerName = customer.name || customerName;
            }
        }

        return {
            invoiceNumber: sale.invoiceNumber ?? "",
            date: sale.date ?? "",
            customerName,
            phone,
            email,
            total: sale.total ?? 0,
            paymentMode: sale.paymentMode ?? "Cash",
            isLoan: sale.isLoan ?? false,
            initialDeposit: sale.initialDeposit ?? 0,
            items: (sale.items ?? []).map((item) => ({
                name: item.name,
                quantity: item.quantity,
                price: item.price ?? 0,
            })),
            businessName: business?.name ?? "SMARTBUZ",
            currency: business?.currency ?? "UGX",
        };
    },
});

/**
 * The credit accounts that are overdue.
 *
 * Derived from the loans and the payments on the account, never from a
 * stored balance that could drift.
 */
export const overdueAccounts = internalQuery({
    args: {
        businessId: v.id("businesses"),
        minDaysOverdue: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        return collectOverdueAccounts(
            ctx,
            args.businessId,
            args.minDaysOverdue ?? 1
        );
    },
});

/**
 * Work out which credit accounts are overdue.
 *
 * Shared by the internal query and the public list, so the reminder run
 * and the list on the screen always agree about who is overdue.
 */
export async function collectOverdueAccounts(
    ctx: any,
    businessId: Id<"businesses">,
    minDaysOverdue: number
): Promise<{
    loanId: Id<"loans">;
    customerName: string;
    phone?: string;
    email?: string;
    amount: number;
    dueDate?: string;
    daysOverdue: number;
    invoiceNumber?: string;
}[]> {
    const loans = await ctx.db
        .query("loans")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .collect();

    const payments = await ctx.db
        .query("payments")
        .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
        .collect();

    const paidByLoan = new Map<string, number>();
    for (const payment of payments) {
        if (!payment.loanId) continue;
        paidByLoan.set(
            payment.loanId,
            (paidByLoan.get(payment.loanId) ?? 0) + (payment.amount ?? 0)
        );
    }

    const now = Date.now();
    const accounts: {
        loanId: Id<"loans">;
        customerName: string;
        phone?: string;
        email?: string;
        amount: number;
        dueDate?: string;
        daysOverdue: number;
        invoiceNumber?: string;
    }[] = [];

    for (const loan of loans) {
        const balance = (loan.balance ?? 0) - (paidByLoan.get(loan._id) ?? 0);
        if (balance <= 0) continue;

        // The due date belongs to the sale the credit was taken on.
        let dueDate: string | undefined;
        let invoiceNumber: string | undefined;

        if (loan.salesId) {
            const sale = await ctx.db.get(loan.salesId);
            if (sale && sale.businessId === businessId) {
                dueDate = sale.paymentDueDate ?? sale.date;
                invoiceNumber = sale.invoiceNumber;
            }
        }

        dueDate = dueDate ?? loan.date;

        const dueTime = dueDate ? new Date(dueDate).getTime() : NaN;
        if (!Number.isFinite(dueTime)) continue;

        const daysOverdue = Math.floor((now - dueTime) / 86_400_000);
        if (daysOverdue < minDaysOverdue) continue;

        let customerName = loan.manualCustomerName ?? "Customer";
        let phone: string | undefined;
        let email: string | undefined;

        if (loan.customerId) {
            const customer = await ctx.db.get(loan.customerId);
            if (customer && customer.businessId === businessId) {
                customerName = customer.name || customerName;
                phone = customer.phone;
                email = customer.email;
            }
        }

        accounts.push({
            loanId: loan._id,
            customerName,
            phone,
            email,
            amount: balance,
            dueDate,
            daysOverdue,
            invoiceNumber,
        });
    }

    accounts.sort((a, b) => b.daysOverdue - a.daysOverdue);

    return accounts;
}

/**
 * The business's own name and currency.
 *
 * A message says who it is from, and money is written in the business's
 * own currency rather than a default one.
 */
export const businessSummary = internalQuery({
    args: { businessId: v.id("businesses") },
    handler: async (ctx, args) => {
        const business = await ctx.db.get(args.businessId);
        return {
            name: business?.name ?? "SMARTBUZ",
            currency: business?.currency ?? "UGX",
        };
    },
});

/**
 * The secrets for one adapter, for the webhook receiver.
 *
 * The webhook has no signed-in caller, so it cannot ask for the tenant
 * the usual way. It is given the business and the adapter, and the
 * reference has already been checked.
 */
export const adapterSecrets = internalQuery({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
    },
    handler: async (ctx, args) => {
        const loaded = await loadIntegration(ctx, args.businessId, args.adapterKey);
        return loaded.secrets;
    },
});
