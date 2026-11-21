/**
 * SMARTBUZ — the integration engine.
 *
 * The one place that runs an adapter, checks it, and writes down what
 * happened.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The live test
 * ────────────────────────────────────────────────────────────────────────
 *
 * An adapter is not working until it has been tested against the real
 * provider. This module is where that test happens, and it is deliberately
 * a **real** call: the provider's own token endpoint, its own accounts
 * endpoint, its own balance endpoint. Nothing is stubbed, nothing is
 * simulated, and nothing is assumed.
 *
 * The result of that call is what decides whether the adapter is
 * `verified`. A test that could not reach the network is a failure, not a
 * pass — "we did not hear back" is not "it works".
 *
 * ────────────────────────────────────────────────────────────────────────
 * The audit trail
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every outbound call and every inbound callback is written to
 * `integrationEvents`. That table is what an owner reads when they ask
 * "did that payment actually go through?", and it is the first place to
 * look when a provider and the books disagree.
 */

import { action, internalMutation, mutation } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { api, internal } from "../_generated/api";
import { findAdapter } from "./registry";
import { airtelMoneyProvider, mtnMoMoProvider } from "./providers/mobileMoney";
import {
    flutterwaveProvider,
    paystackProvider,
    stripeProvider,
} from "./providers/cards";
import {
    emailResendProvider,
    smsAfricasTalkingProvider,
    smsGenericProvider,
    whatsappCloudProvider,
} from "./providers/messaging";
import type {
    MessagingProvider,
    PaymentProvider,
    ProviderTestResult,
} from "./providers/types";

/* ────────────────────────────────────────────────────────────────────────
 * The provider table
 * ──────────────────────────────────────────────────────────────────────── */

/** Every payment provider, by adapter key. */
export const PAYMENT_PROVIDERS: Record<string, PaymentProvider> = {
    "mtn.momo": mtnMoMoProvider,
    "airtel.money": airtelMoneyProvider,
    "card.flutterwave": flutterwaveProvider,
    "card.paystack": paystackProvider,
    "card.stripe": stripeProvider,
};

/** Every messaging provider, by adapter key. */
export const MESSAGING_PROVIDERS: Record<string, MessagingProvider> = {
    "sms.generic": smsGenericProvider,
    "sms.africasTalking": smsAfricasTalkingProvider,
    "whatsapp.cloud": whatsappCloudProvider,
    "email.resend": emailResendProvider,
};

/** The payment provider for an adapter key, or a thrown error. */
export function paymentProvider(adapterKey: string): PaymentProvider {
    const provider = PAYMENT_PROVIDERS[adapterKey];
    if (!provider) {
        throw new ConvexError(
            `There is no payment provider for "${adapterKey}". It may be an adapter that reads rather than collects.`
        );
    }
    return provider;
}

/** The messaging provider for an adapter key, or a thrown error. */
export function messagingProvider(adapterKey: string): MessagingProvider {
    const provider = MESSAGING_PROVIDERS[adapterKey];
    if (!provider) {
        throw new ConvexError(
            `There is no messaging provider for "${adapterKey}".`
        );
    }
    return provider;
}

/* ────────────────────────────────────────────────────────────────────────
 * Recording
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Write one line into the integration audit trail.
 *
 * Kept as a mutation so that actions can call it — an action cannot write
 * to the database itself, it has to ask a mutation to do it.
 */
export const recordEvent = internalMutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        direction: v.string(),
        kind: v.string(),
        status: v.string(),
        reference: v.optional(v.string()),
        summary: v.optional(v.string()),
        error: v.optional(v.string()),
        payload: v.optional(v.any()),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("integrationEvents", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            direction: args.direction,
            kind: args.kind,
            status: args.status,
            reference: args.reference,
            summary: args.summary,
            error: args.error,
            payload: args.payload,
            userId: args.userId,
            createdAt: new Date().toISOString(),
        });
        return null;
    },
});

/* ────────────────────────────────────────────────────────────────────────
 * The live test
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Run a real test against a provider.
 *
 * This makes an actual network call to the provider using the saved
 * credentials. It never moves money and never sends a message to a
 * customer — the provider's `test` function is written to be harmless.
 *
 * The outcome is written to the adapter's own record and to the audit
 * trail. Only a call that the provider itself accepted makes the adapter
 * `verified`.
 */
export const runLiveTest = action({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.string(),
    },
    handler: async (ctx, args) => {
        const adapter = findAdapter(args.adapterKey);
        if (!adapter) {
            throw new ConvexError(`Unknown integration adapter: ${args.adapterKey}`);
        }

        if (!adapter.supportsLiveTest) {
            throw new ConvexError(
                `${adapter.label} has no live test of its own. ${adapter.verification.testDescription}`
            );
        }

        // The tenant, the permission and the credentials are all resolved
        // in one internal call — an action cannot read the database
        // itself, and the credentials must never reach a browser.
        const prepared = await ctx.runQuery(
            internal.integrations.internal.prepareAdapterCall,
            {
                businessId: args.businessId,
                adapterKey: args.adapterKey,
                permission: "integrations.test",
                // A test is exactly what an unverified adapter needs, so
                // the verification gate is not applied here.
                requireVerified: false,
            }
        );

        const businessId = prepared.businessId;

        const provider =
            PAYMENT_PROVIDERS[args.adapterKey] ?? MESSAGING_PROVIDERS[args.adapterKey];

        if (!provider) {
            throw new ConvexError(
                `There is no test for ${adapter.label}. ${adapter.verification.testDescription}`
            );
        }

        const context = {
            config: prepared.config,
            secrets: prepared.secrets,
            sandbox: prepared.sandbox,
        };

        let result: ProviderTestResult;
        try {
            result = await provider.test(context);
        } catch (err) {
            result = {
                ok: false,
                detail: `The test could not be completed: ${
                    err instanceof Error ? err.message : String(err)
                }`,
                error: err instanceof Error ? err.message : String(err),
            };
        }

        const now = new Date().toISOString();

        // The status follows the provider's answer and nothing else. A
        // network failure is a failure; it is never recorded as a pass.
        const status = result.ok ? "verified" : "failed";

        // The verification outcome is written by a mutation, because an
        // action cannot write to the database itself.
        await ctx.runMutation(internal.integrations.engine.saveTestResult, {
            businessId,
            adapterKey: args.adapterKey,
            verificationStatus: status,
            verifiedAt: result.ok ? now : undefined,
            lastTestedAt: now,
            lastTestResult: result.detail,
            lastTestPassed: result.ok,
            userId: prepared.userId,
        });

        await ctx.runMutation(internal.integrations.engine.recordEvent, {
            businessId,
            adapterKey: args.adapterKey,
            direction: "outbound",
            kind: "live_test",
            status: result.ok ? "ok" : "failed",
            summary: result.detail,
            error: result.error,
            payload: result.raw,
            userId: prepared.userId,
        });

        return {
            ok: result.ok,
            detail: result.detail,
            error: result.error,
            verificationStatus: status,
            testedAt: now,
        };
    },
});

/**
 * Record the outcome of a live test.
 *
 * Split out because an action cannot write to the database — it has to
 * ask a mutation to do it.
 */
export const saveTestResult = internalMutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        verificationStatus: v.string(),
        verifiedAt: v.optional(v.string()),
        lastTestedAt: v.string(),
        lastTestResult: v.string(),
        lastTestPassed: v.boolean(),
        userId: v.optional(v.id("users")),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("integrationConfigs")
            .withIndex("by_businessId_adapterKey", (q) =>
                q.eq("businessId", args.businessId).eq("adapterKey", args.adapterKey)
            )
            .unique();

        if (!existing) {
            throw new ConvexError(
                "That adapter has no configuration to record the test against."
            );
        }

        await ctx.db.patch(existing._id, {
            verificationStatus: args.verificationStatus,
            verifiedAt: args.verifiedAt,
            lastTestedAt: args.lastTestedAt,
            lastTestResult: args.lastTestResult,
            lastTestPassed: args.lastTestPassed,
            updatedBy: args.userId,
            updatedAt: new Date().toISOString(),
        });

        return null;
    },
});
