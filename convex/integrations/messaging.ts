/**
 * SMARTBUZ — sending messages.
 *
 * Receipts, reminders and confirmations, sent through whichever messaging
 * adapter the business has configured and proved.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What "sent" means here
 * ────────────────────────────────────────────────────────────────────────
 *
 * `sent` means the **gateway accepted** the message for delivery. It does
 * not mean the customer read it, and in some cases it does not even mean
 * the message left the country — a carrier can reject it afterwards.
 *
 * The log records the gateway's own answer, and nothing in the interface
 * claims more than that. A message that failed says so.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Who may send what
 * ────────────────────────────────────────────────────────────────────────
 *
 * A receipt goes to a customer, so the money is not moving and the books
 * are not changing: `messages.send` is enough. A **payment reminder** is
 * different — it tells a customer their account is overdue, and sending it
 * to the wrong person would be a real harm — so it also needs
 * `payments.verify`, the same authority that confirms money arrived.
 */

import { action, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { requirePermission, requireTenant, requireUser } from "../tenancy";
import { messagingProvider } from "./engine";
import { collectOverdueAccounts } from "./internal";
import { findAdapter } from "./registry";
import {
    balanceLine,
    findTemplate,
    formatItems,
    formatMoney,
    overdueLine,
    renderMessage,
    templatesForChannel,
    type MessageTemplate,
} from "./templates";
import type { MessageChannel } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * The catalogue
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The message templates, so the interface can offer them.
 */
export const listTemplates = query({
    args: { channel: v.optional(v.string()) },
    handler: async (ctx, args) => {
        await requireUser(ctx);
        if (args.channel) {
            return templatesForChannel(args.channel as MessageChannel);
        }
        return templatesForChannel("sms")
            .concat(templatesForChannel("whatsapp"))
            .concat(templatesForChannel("email"));
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Sending
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Send one message.
 *
 * The adapter has to be switched on and proved against the real provider.
 * A message is not sent through an adapter nobody has tested.
 */
export const sendMessage = action({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
        channel: v.string(),
        to: v.string(),
        body: v.string(),
        subject: v.optional(v.string()),
        templateKey: v.optional(v.string()),
        relatedType: v.optional(v.string()),
        relatedId: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{
        status: string;
        providerMessageId?: string;
        error?: string;
    }> => {
        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(
                `Unknown integration adapter: ${args.adapterKey}.`
            );
        }
        if (adapter.category !== "messaging") {
            throw new ConvexError(`${adapter.label} is not a messaging adapter.`);
        }

        if (!args.to || !args.to.trim()) {
            throw new ConvexError("The message has no destination.");
        }

        // The tenant, the permission and the credentials are resolved in
        // one internal call. The adapter has to have been proved against
        // the real provider before it may send anything.
        const prepared = await ctx.runQuery(
            internal.integrations.internal.prepareAdapterCall,
            {
                businessId: args.businessId,
                adapterKey: args.adapterKey,
                permission: "messages.send",
                requireVerified: true,
            }
        );

        const businessId = prepared.businessId;

        const provider = messagingProvider(args.adapterKey);

        const context = {
            config: prepared.config,
            secrets: prepared.secrets,
            sandbox: prepared.sandbox,
        };

        let result;
        try {
            result = await provider.send(context, {
                adapterKey: args.adapterKey,
                channel: args.channel as MessageChannel,
                to: args.to.trim(),
                subject: args.subject,
                body: args.body,
                templateKey: args.templateKey,
                relatedType: args.relatedType as never,
                relatedId: args.relatedId,
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            await ctx.runMutation(api.integrations.messaging.recordMessage, {
                businessId,
                adapterKey: args.adapterKey,
                channel: args.channel,
                to: args.to.trim(),
                subject: args.subject,
                body: args.body,
                templateKey: args.templateKey,
                status: "failed",
                error: message,
                relatedType: args.relatedType,
                relatedId: args.relatedId,
                userId: prepared.userId,
            });
            throw new ConvexError(message);
        }

        await ctx.runMutation(api.integrations.messaging.recordMessage, {
            businessId,
            adapterKey: args.adapterKey,
            channel: args.channel,
            to: args.to.trim(),
            subject: args.subject,
            body: args.body,
            templateKey: args.templateKey,
            status: result.status,
            providerMessageId: result.providerMessageId,
            error: result.error,
            relatedType: args.relatedType,
            relatedId: args.relatedId,
            userId: prepared.userId,
        });

        return {
            status: result.status,
            providerMessageId: result.providerMessageId,
            error: result.error,
        };
    },
});

/**
 * Write a message into the log.
 */
export const recordMessage = mutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        channel: v.string(),
        to: v.string(),
        body: v.string(),
        subject: v.optional(v.string()),
        templateKey: v.optional(v.string()),
        status: v.string(),
        providerMessageId: v.optional(v.string()),
        deliveryStatus: v.optional(v.string()),
        error: v.optional(v.string()),
        relatedType: v.optional(v.string()),
        relatedId: v.optional(v.string()),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const now = new Date().toISOString();

        await ctx.db.insert("messages", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            channel: args.channel,
            to: args.to,
            subject: args.subject,
            body: args.body,
            templateKey: args.templateKey,
            status: args.status,
            providerMessageId: args.providerMessageId,
            deliveryStatus: args.deliveryStatus,
            error: args.error,
            relatedType: args.relatedType,
            relatedId: args.relatedId,
            sentBy: args.userId,
            sentAt: now,
            createdAt: now,
        });

        await ctx.db.insert("integrationEvents", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            direction: "outbound",
            kind: "message_sent",
            status: args.status === "sent" ? "ok" : "failed",
            summary: `${args.channel} to ${args.to}`,
            error: args.error,
            userId: args.userId,
            createdAt: now,
        });

        return null;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Receipts
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Send a customer a copy of their receipt.
 *
 * The receipt is built from the sale as the server has it — the stored
 * prices, the stored total — never from anything the browser sends. A
 * receipt that disagrees with the books is worse than no receipt.
 */
export const sendSaleReceipt = action({
    args: {
        businessId: v.optional(v.id("businesses")),
        saleId: v.id("sales"),
        adapterKey: v.string(),
        templateKey: v.optional(v.string()),
    },
    handler: async (ctx, args): Promise<{
        status: string;
        to: string;
        error?: string;
        missing: string[];
    }> => {
        const adapter = findAdapter(args.adapterKey);
        if (!adapter || adapter.category !== "messaging") {
            throw new ConvexError(
                "Choose a messaging integration to send the receipt with."
            );
        }

        const prepared = await ctx.runQuery(
            internal.integrations.internal.prepareAdapterCall,
            {
                businessId: args.businessId,
                adapterKey: args.adapterKey,
                permission: "messages.send",
                requireVerified: true,
            }
        );

        const businessId = prepared.businessId;

        // The sale is read on the server, from the stored record.
        const sale = await ctx.runQuery(
            internal.integrations.internal.receiptContext,
            { businessId, saleId: args.saleId }
        );

        // A receipt goes to a contact the customer has on file. A receipt
        // sent to a number typed at the till is a receipt to whoever
        // answers it.
        const destination =
            adapter.channel === "email" ? sale.email : sale.phone;

        if (!destination) {
            throw new ConvexError(
                "This customer has no contact details saved, so there is nowhere to send the receipt. Add a phone number or email address to the customer first."
            );
        }

        const templateKey =
            args.templateKey ??
            (adapter.channel === "email" ? "sale.receipt" : "sale.receipt.sms");
        const template = findTemplate(templateKey);
        if (!template) {
            throw new ConvexError(`There is no message template called "${templateKey}".`);
        }

        const rendered = renderMessage(template, {
            businessName: sale.businessName,
            invoiceNumber: sale.invoiceNumber,
            date: sale.date,
            customerName: sale.customerName,
            items: formatItems(sale.items),
            total: formatMoney(sale.total, sale.currency),
            paymentMode: sale.paymentMode,
            balance: sale.isLoan ? sale.total - sale.initialDeposit : undefined,
            balanceLine: balanceLine(
                sale.isLoan ? sale.total - sale.initialDeposit : undefined
            ),
        });

        const provider = messagingProvider(args.adapterKey);

        const result = await provider.send(
            {
                config: prepared.config,
                secrets: prepared.secrets,
                sandbox: prepared.sandbox,
            },
            {
                adapterKey: args.adapterKey,
                channel: adapter.channel as MessageChannel,
                to: destination,
                subject: rendered.subject,
                body: rendered.body,
                templateKey: template.key,
                relatedType: "sale",
                relatedId: args.saleId,
            }
        );

        await ctx.runMutation(api.integrations.messaging.recordMessage, {
            businessId,
            adapterKey: args.adapterKey,
            channel: adapter.channel ?? "sms",
            to: destination,
            subject: rendered.subject,
            body: rendered.body,
            templateKey: template.key,
            status: result.status,
            providerMessageId: result.providerMessageId,
            error: result.error,
            relatedType: "sale",
            relatedId: args.saleId,
            userId: prepared.userId,
        });

        return {
            status: result.status,
            to: destination,
            error: result.error,
            missing: rendered.missing,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Payment reminders
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The credit accounts that are overdue.
 *
 * Derived from the loans and payments on the account, never from a stored
 * balance that could drift.
 */
export const listOverdueAccounts = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        minDaysOverdue: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "finance.view");

        const accounts = await collectOverdueAccounts(
            ctx,
            businessId,
            args.minDaysOverdue ?? 1
        );

        return accounts.map((account) => ({
            ...account,
            customerId: undefined,
        }));
    },
});

/**
 * Send payment reminders.
 *
 * Every reminder is sent on its own, so one that fails does not stop the
 * rest. The result says exactly how many were sent and how many failed —
 * a reminder run that silently skipped half the accounts would be worse
 * than one that did not run at all.
 */
export const sendPaymentReminders = action({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
        templateKey: v.optional(v.string()),
        minDaysOverdue: v.optional(v.number()),
        /** Only consider these accounts. */
        loanIds: v.optional(v.array(v.id("loans"))),
    },
    handler: async (ctx, args): Promise<{
        considered: number;
        sent: number;
        failed: number;
        skipped: number;
        problems: string[];
    }> => {
        const adapter = findAdapter(args.adapterKey);
        if (!adapter || adapter.category !== "messaging") {
            throw new ConvexError(
                "Choose a messaging integration to send the reminders with."
            );
        }

        const prepared = await ctx.runQuery(
            internal.integrations.internal.prepareAdapterCall,
            {
                businessId: args.businessId,
                adapterKey: args.adapterKey,
                permission: "payments.verify",
                requireVerified: true,
            }
        );

        const businessId = prepared.businessId;

        const templateKey = args.templateKey ?? "payment.reminder";
        const template = findTemplate(templateKey);
        if (!template) {
            throw new ConvexError(
                `There is no message template called "${templateKey}".`
            );
        }

        // The overdue accounts are read through an internal query, because
        // an action has no database of its own.
        const allAccounts = await ctx.runQuery(
            internal.integrations.internal.overdueAccounts,
            { businessId, minDaysOverdue: args.minDaysOverdue ?? 1 }
        );

        const accounts = args.loanIds
            ? allAccounts.filter((account) => args.loanIds!.includes(account.loanId))
            : allAccounts;

        const businessName = await ctx.runQuery(
            internal.integrations.internal.businessSummary,
            { businessId }
        );

        const provider = messagingProvider(args.adapterKey);
        const context = {
            config: prepared.config,
            secrets: prepared.secrets,
            sandbox: prepared.sandbox,
        };

        let sent = 0;
        let failed = 0;
        let skipped = 0;
        const problems: string[] = [];

        for (const account of accounts) {
            const destination =
                adapter.channel === "email" ? account.email : account.phone;

            if (!destination) {
                skipped++;
                problems.push(
                    `${account.customerName} has no ${
                        adapter.channel === "email" ? "email address" : "phone number"
                    }, so no reminder was sent.`
                );
                continue;
            }

            const rendered = renderMessage(template, {
                businessName: businessName.name,
                customerName: account.customerName,
                amount: formatMoney(account.amount, businessName.currency),
                dueDate: account.dueDate ?? "",
                daysOverdue: account.daysOverdue,
                overdueLine: overdueLine(account.daysOverdue),
                invoiceNumber: account.invoiceNumber ?? "",
            });

            try {
                const result = await provider.send(context, {
                    adapterKey: args.adapterKey,
                    channel: adapter.channel as MessageChannel,
                    to: destination,
                    subject: rendered.subject,
                    body: rendered.body,
                    templateKey: template.key,
                    relatedType: "payment",
                    relatedId: account.loanId,
                });

                if (result.status === "sent") {
                    sent++;
                } else {
                    failed++;
                    problems.push(
                        `${account.customerName}: ${result.error ?? "the gateway refused the message"}`
                    );
                }

                await ctx.runMutation(api.integrations.messaging.recordMessage, {
                    businessId,
                    adapterKey: args.adapterKey,
                    channel: adapter.channel ?? "sms",
                    to: destination,
                    subject: rendered.subject,
                    body: rendered.body,
                    templateKey: template.key,
                    status: result.status,
                    providerMessageId: result.providerMessageId,
                    error: result.error,
                    relatedType: "payment",
                    relatedId: account.loanId,
                    userId: prepared.userId,
                });
            } catch (err) {
                failed++;
                problems.push(
                    `${account.customerName}: ${
                        err instanceof Error ? err.message : String(err)
                    }`
                );
            }
        }

        return {
            considered: accounts.length,
            sent,
            failed,
            skipped,
            problems,
        };
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * Reading the log
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The messages this business has sent.
 */
export const listMessages = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        channel: v.optional(v.string()),
        status: v.optional(v.string()),
        limit: v.optional(v.number()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "messages.view");

        const limit = Math.min(args.limit ?? 100, 500);

        let rows = await ctx.db
            .query("messages")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        if (args.channel) rows = rows.filter((r) => r.channel === args.channel);
        if (args.status) rows = rows.filter((r) => r.status === args.status);

        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return rows.slice(0, limit).map((row) => ({
            id: row._id,
            adapterKey: row.adapterKey,
            channel: row.channel,
            to: row.to,
            subject: row.subject,
            body: row.body,
            templateKey: row.templateKey,
            status: row.status,
            providerMessageId: row.providerMessageId,
            deliveryStatus: row.deliveryStatus,
            error: row.error,
            relatedType: row.relatedType,
            relatedId: row.relatedId,
            createdAt: row.createdAt,
        }));
    },
});

/** The template type is used in the argument shapes above. */
export type { MessageTemplate };
