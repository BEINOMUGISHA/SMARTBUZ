/**
 * SMARTBUZ — the webhook receiver.
 *
 * This is where a provider tells SMARTBUZ that money has moved.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this matters more than it looks
 * ────────────────────────────────────────────────────────────────────────
 *
 * A collection request is not a payment. The customer still has to enter
 * their PIN. Until the provider says otherwise, SMARTBUZ does not know
 * whether the money arrived — so the sale stays at `pending_verification`,
 * exactly as it would for an offline sale.
 *
 * This route is where that "otherwise" arrives.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Who may post here
 * ────────────────────────────────────────────────────────────────────────
 *
 * A webhook is unauthenticated by nature — the provider cannot sign in as
 * a member of staff. It is authenticated instead by the **reference**: the
 * callback must name a payment that SMARTBUZ actually started, and that
 * payment must still be waiting for a result. A callback naming a
 * reference nobody issued is refused.
 *
 * On top of that, a business may set a `webhookSecret`. When it is set,
 * the callback must carry a matching HMAC signature over its own body, or
 * it is refused.
 *
 * This has to be confirmed against each provider's own documentation
 * during live testing — the scheme differs between MTN, Airtel and the
 * card gateways. Until that testing is done, an adapter stays `unverified`
 * and says so.
 */

import { httpAction, internalMutation, mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { api, internal } from "../_generated/api";
import { hmacSha256Hex, safeEqual } from "../crypto";
import { serverSecretValue } from "../serverSecret";
import { loadIntegration } from "./config";
import type { Id } from "../_generated/dataModel";

/**
 * The body a provider sent, as far as we can read it.
 */
export interface WebhookPayload {
    /** Our reference, wherever the provider put it. */
    reference?: string;
    /** The provider's own identifier. */
    providerReference?: string;
    /** `succeeded` | `failed` | `pending` */
    status?: string;
    /** The amount, when the provider sent one. */
    amount?: number;
    /** The raw body, for the audit log. */
    raw: unknown;
}

/**
 * Find our reference in a provider's callback.
 *
 * Every provider names it differently, so several places are looked at.
 * The reference SMARTBUZ generates always begins `SBZ-PAY-`, which makes
 * it recognisable wherever it turns up.
 */
export function findReference(payload: unknown): string | undefined {
    if (typeof payload === "string") {
        const match = /SBZ-PAY-[A-Za-z0-9-]+/.exec(payload);
        return match ? match[0] : undefined;
    }

    if (!payload || typeof payload !== "object") return undefined;

    const record = payload as Record<string, unknown>;

    for (const key of [
        "reference",
        "externalId",
        "merchantReference",
        "tx_ref",
        "txn_ref",
        "transactionReference",
        "orderReference",
    ]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    for (const key of ["data", "payload", "transaction", "result"]) {
        const nested = record[key];
        if (nested && typeof nested === "object") {
            const found = findReference(nested);
            if (found) return found;
        }
    }

    // Last resort: look for our reference anywhere in the body.
    try {
        const text = JSON.stringify(payload);
        const match = /SBZ-PAY-[A-Za-z0-9-]+/.exec(text);
        if (match) return match[0];
    } catch {
        // A body that cannot be stringified simply has no reference.
    }

    return undefined;
}

/**
 * Map a provider's status wording onto ours.
 *
 * Only a clear success is a success. Everything else stays pending,
 * because "we did not understand the status" is not a failure and is
 * certainly not a payment.
 */
export function mapWebhookStatus(value: unknown): "succeeded" | "failed" | "pending" {
    const text = String(value ?? "").toUpperCase().replace(/[\s_-]/g, "");

    if (
        ["SUCCESSFUL", "SUCCESS", "COMPLETED", "COMPLETE", "CAPTURED", "PAID", "APPROVED", "SETTLED"].includes(text)
    ) {
        return "succeeded";
    }

    if (
        ["FAILED", "FAILURE", "DECLINED", "REVERSED", "CANCELLED", "CANCELED", "REJECTED", "EXPIRED"].includes(text)
    ) {
        return "failed";
    }

    return "pending";
}

/**
 * Check the signature on a callback.
 *
 * The signature is an HMAC-SHA256 of the raw body, hex-encoded, under a
 * secret the business chose. The header name is `x-smartbuz-signature`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * A callback with no secret is refused
 * ────────────────────────────────────────────────────────────────────────
 *
 * When no secret was configured the check could not be made, and the
 * callback was accepted on its reference alone. That is the whole security
 * of the callback reduced to "do you know a string that appears in the
 * provider's message" — and the reference is not a secret: it is printed
 * on the payment, returned to the browser, and sent to the provider in
 * clear. Anything that can see a payment receipt could forge the callback
 * that says it was paid.
 *
 * So a callback for an adapter with no webhook secret is refused, and the
 * reason says exactly what the owner has to do about it. The alternative —
 * accepting the callback and mentioning the weakness afterwards — is how a
 * deployment ends up taking money for goods it never delivered.
 */
export async function verifyWebhookSignature(
    rawBody: string,
    signature: string | null | undefined,
    secret: string | undefined
): Promise<{ ok: boolean; reason?: string }> {
    if (!secret) {
        return {
            ok: false,
            reason:
                "This adapter has no webhook secret, so the callback cannot be trusted and was refused. Set a webhook secret for this adapter, then ask the provider to send the signature again.",
        };
    }

    if (!signature) {
        return {
            ok: false,
            reason:
                "The callback carried no signature, and this adapter has a webhook secret set.",
        };
    }

    const expected = await hmacSha256Hex(secret, rawBody);
    const given = signature.trim().replace(/^sha256=/i, "");

    if (!safeEqual(expected.toLowerCase(), given.toLowerCase())) {
        return {
            ok: false,
            reason: "The callback's signature did not match the secret on file.",
        };
    }

    return { ok: true };
}

/**
 * A payment callback from a provider.
 *
 * The route is mounted in `convex/http.ts`. It is deliberately
 * unauthenticated — the provider is not a signed-in member of staff — so
 * it authenticates the callback by the reference it names and by the
 * signature the business configured.
 */
export const paymentCallback = httpAction(async (ctx, request) => {
    const rawBody = await request.text();

    let payload: unknown;
    try {
        payload = rawBody ? JSON.parse(rawBody) : {};
    } catch {
        payload = rawBody;
    }

    const reference = findReference(payload);

    if (!reference) {
        return new Response(
            JSON.stringify({
                ok: false,
                error:
                    "The callback did not name a payment SMARTBUZ started, so it was refused.",
            }),
            { status: 400 }
        );
    }

    // Find the payment the callback is about.
    const intent = await ctx.runQuery(
        internal.integrations.internal.findIntentForReference,
        { reference }
    );

    if (!intent) {
        return new Response(
            JSON.stringify({
                ok: false,
                error:
                    "No payment with that reference is waiting for a result, so the callback was refused.",
            }),
            { status: 404 }
        );
    }

    const businessId = intent.businessId as Id<"businesses">;

    // The secret for this adapter, if the business set one.
    const secrets = await ctx.runQuery(
        internal.integrations.internal.adapterSecrets,
        {
            businessId,
            adapterKey: intent.adapterKey,
        }
    );

    const secret = secrets?.webhookSecret;

    const signature = request.headers.get("x-smartbuz-signature");
    const check = await verifyWebhookSignature(rawBody, signature, secret);

    if (!check.ok) {
        await ctx.runMutation(internal.integrations.webhooks.recordCallback, {
            businessId,
            adapterKey: intent.adapterKey,
            reference,
            status: "failed",
            summary: "A callback was refused because it could not be trusted.",
            error: check.reason,
        });

        return new Response(
            JSON.stringify({ ok: false, error: check.reason }),
            { status: 401 }
        );
    }

    const status = mapWebhookStatus(
        (payload as Record<string, unknown>)?.status ??
        (payload as Record<string, unknown>)?.state ??
        (payload as Record<string, unknown>)?.result
    );

    const providerReference = readProviderReference(payload);

    if (status === "pending") {
        // The provider has not finished deciding. The payment stays
        // pending, which is the honest answer.
        await ctx.runMutation(internal.integrations.webhooks.recordCallback, {
            businessId,
            adapterKey: intent.adapterKey,
            reference,
            status: "pending",
            summary:
                "The provider sent a callback that does not yet say whether the payment succeeded.",
            payload,
        });

        return new Response(JSON.stringify({ ok: true, status: "pending" }), {
            status: 200,
        });
    }

    await ctx.runMutation(internal.integrations.payments.confirmPayment, {
        businessId,
        reference,
        providerReference,
        status,
        providerPayload: payload,
        confirmedBy: "provider",
    });

    return new Response(
        JSON.stringify({ ok: true, status, reference }),
        { status: 200 }
    );
});

/**
 * Read the provider's own identifier out of a callback.
 */
export function readProviderReference(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const record = payload as Record<string, unknown>;

    for (const key of [
        "providerReference",
        "transactionId",
        "transaction_id",
        "txn_id",
        "id",
        "chargeId",
    ]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }

    for (const key of ["data", "transaction", "payload"]) {
        const nested = record[key];
        if (nested && typeof nested === "object") {
            const found = readProviderReference(nested);
            if (found) return found;
        }
    }

    return undefined;
}

/**
 * The secret a business set for this adapter's webhooks.
 *
 * It is stored encrypted like every other secret, and it is read only by
 * the server — it is never sent to a browser. The webhook receiver reads
 * it through `internal.integrations.internal.adapterSecrets`.
 */
export function webhookSecretName(): string {
    return "webhookSecret";
}

/**
 * Write an inbound callback into the audit trail.
 *
 * A callback that was refused is recorded too — a stream of refused
 * callbacks is worth knowing about.
 */
export const recordCallback = internalMutation({
    args: {
        businessId: v.id("businesses"),
        adapterKey: v.string(),
        reference: v.string(),
        status: v.string(),
        summary: v.optional(v.string()),
        error: v.optional(v.string()),
        payload: v.optional(v.any()),
    },
    handler: async (ctx, args) => {
        await ctx.db.insert("integrationEvents", {
            businessId: args.businessId,
            adapterKey: args.adapterKey,
            direction: "inbound",
            kind: "webhook",
            status: args.status === "failed" ? "failed" : "ok",
            reference: args.reference,
            summary: args.summary,
            error: args.error,
            payload: args.payload,
            createdAt: new Date().toISOString(),
        });
        return null;
    },
});

/**
 * The passphrase the webhook signature is checked with.
 *
 * It is the server secret, so the business's webhook secret is a second
 * secret rather than the same one used for encryption.
 */
export function webhookPepper(): string {
    return `${serverSecretValue()}:webhook`;
}

/** The Id type is used in the argument shapes above. */
export type WebhookBusinessId = Id<"businesses">;

/** The validator used for the webhook arguments. */
export const webhookArgs = {
    businessId: v.id("businesses"),
    adapterKey: v.string(),
};
