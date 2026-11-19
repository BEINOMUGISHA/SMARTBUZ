/**
 * SMARTBUZ — card gateway providers.
 *
 * Flutterwave, Paystack and Stripe. All three follow the same shape: the
 * business sends the customer to the provider's hosted page, the provider
 * takes the card, and the provider calls SMARTBUZ back when the payment
 * has actually been made.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule these all obey
 * ────────────────────────────────────────────────────────────────────────
 *
 * A card payment is never confirmed by the browser returning to the till.
 *
 * The redirect is a courtesy: it tells the customer the payment is done. It
 * is not proof. Proof is the provider's callback, or a status query
 * against the provider. Until one of those arrives, the sale stays
 * `pending_verification` — the same rule the mobile money adapters obey,
 * and the same rule the offline engine obeys.
 *
 * The reference is sent as the provider's idempotency key, so a customer
 * who double-clicks "pay" is charged once.
 */

import {
    callProvider,
    configString,
    extractProviderReference,
    ProviderError,
    secret,
    type PaymentProvider,
    type ProviderContext,
    type ProviderTestResult,
} from "./types";
import type { PaymentInitiation, PaymentResult } from "../types";

/**
 * The URL the customer is sent to.
 *
 * Every gateway here uses a hosted page that carries the payment
 * reference, so the callback can be matched to the sale.
 */
function callbackUrl(context: ProviderContext, reference: string): string {
    const host = configString(context, "callbackHost").replace(/\/+$/, "");
    const currency = configString(context, "currency", "UGX");
    return (
        `${host}/api/payments/return?reference=${encodeURIComponent(reference)}` +
        `&currency=${encodeURIComponent(currency)}`
    );
}

/** Map a gateway's status vocabulary onto ours. */
function normaliseStatus(value: unknown): PaymentResult["status"] {
    switch (String(value ?? "").toLowerCase()) {
        case "successful":
        case "success":
        case "succeeded":
        case "paid":
        case "complete":
        case "completed":
        case "captured":
            return "succeeded";
        case "failed":
        case "failure":
        case "declined":
        case "reversed":
            return "failed";
        case "cancelled":
        case "canceled":
        case "abandoned":
            return "cancelled";
        default:
            return "pending";
    }
}

/* ────────────────────────────────────────────────────────────────────────
 * Flutterwave
 * ──────────────────────────────────────────────────────────────────────── */

const FLUTTERWAVE_BASE = "https://api.flutterwave.com/v3";
const FLUTTERWAVE_SANDBOX_BASE = "https://api.flutterwave.com/v3";

export const flutterwaveProvider: PaymentProvider = {
    key: "card.flutterwave",

    async initiate(
        context: ProviderContext,
        request: PaymentInitiation
    ): Promise<PaymentResult> {
        const key = secret(context, "publicKey");
        if (!key) {
            throw new ProviderError(
                "The Flutterwave adapter is not configured. It needs its secret API key before it can be used."
            );
        }

        const payload = await callProvider(`${FLUTTERWAVE_BASE}/payments`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: {
                tx_ref: request.reference,
                amount: request.amount,
                currency: request.currency || "UGX",
                redirect_url: callbackUrl(context, request.reference),
                customer: {
                    email: request.email,
                    phonenumber: request.phone,
                },
                customizations: {
                    title: request.description || "Payment",
                },
                meta: { reference: request.reference },
            },
        });

        const record = (payload ?? {}) as Record<string, unknown>;
        const data = (record.data ?? {}) as Record<string, unknown>;

        return {
            // Flutterwave has not taken the money yet — the customer is
            // still on the hosted page.
            status: "pending",
            providerReference:
                extractProviderReference(data) ?? extractProviderReference(record),
            message: "Flutterwave created the payment. The customer still has to complete it.",
            raw: payload,
            sandbox: !isLive(context),
        };
    },

    async verify(
        context: ProviderContext,
        reference: string
    ): Promise<PaymentResult> {
        const key = secret(context, "publicKey");
        if (!key) {
            throw new ProviderError(
                "The Flutterwave adapter is not configured. It needs its secret API key before it can be used."
            );
        }

        const payload = await callProvider(
            `${FLUTTERWAVE_BASE}/transactions/${encodeURIComponent(reference)}`,
            { headers: { Authorization: `Bearer ${key}` } }
        );

        const record = (payload ?? {}) as Record<string, unknown>;
        const data = (record.data ?? {}) as Record<string, unknown>;

        return {
            status: normaliseStatus(data.status ?? record.status),
            providerReference: extractProviderReference(data),
            message: `Flutterwave reports the transaction as ${String(
                data.status ?? record.status ?? "unknown"
            )}.`,
            raw: payload,
            sandbox: !isLive(context),
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            const key = secret(context, "publicKey");
            if (!key) {
                return {
                    ok: false,
                    detail: "No API key has been saved for the Flutterwave adapter.",
                };
            }
            const payload = await callProvider(
                `${FLUTTERWAVE_SANDBOX_BASE}/payment-accounts`,
                { headers: { Authorization: `Bearer ${key}` } }
            );
            const record = (payload ?? {}) as Record<string, unknown>;
            const accounts = Array.isArray(record.data) ? record.data.length : 0;
            return {
                ok: true,
                detail: `Flutterwave accepted the key and returned ${accounts} payment account(s). The credentials work; this does not prove a card can be charged.`,
                raw: payload,
            };
        } catch (err) {
            return {
                ok: false,
                detail: "Flutterwave refused the saved key.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/* ────────────────────────────────────────────────────────────────────────
 * Paystack
 * ──────────────────────────────────────────────────────────────────────── */

const PAYSTACK_BASE = "https://api.paystack.co";

export const paystackProvider: PaymentProvider = {
    key: "card.paystack",

    async initiate(
        context: ProviderContext,
        request: PaymentInitiation
    ): Promise<PaymentResult> {
        const key = secret(context, "publicKey");
        if (!key) {
            throw new ProviderError(
                "The Paystack adapter is not configured. It needs its secret API key before it can be used."
            );
        }

        const payload = await callProvider(`${PAYSTACK_BASE}/transaction/initialize`, {
            method: "POST",
            headers: { Authorization: `Bearer ${key}` },
            body: {
                reference: request.reference,
                amount: Math.round(request.amount * 100),
                currency: request.currency || "UGX",
                callback_url: callbackUrl(context, request.reference),
                email: request.email,
                phone: request.phone,
                metadata: { reference: request.reference },
            },
        });

        const record = (payload ?? {}) as Record<string, unknown>;
        const data = (record.data ?? {}) as Record<string, unknown>;

        return {
            status: "pending",
            providerReference: extractProviderReference(data),
            message: "Paystack created the transaction. The customer still has to complete it.",
            raw: payload,
            sandbox: !isLive(context),
        };
    },

    async verify(
        context: ProviderContext,
        reference: string
    ): Promise<PaymentResult> {
        const key = secret(context, "publicKey");
        if (!key) {
            throw new ProviderError(
                "The Paystack adapter is not configured. It needs its secret API key before it can be used."
            );
        }

        const payload = await callProvider(
            `${PAYSTACK_BASE}/transaction/verify/${encodeURIComponent(reference)}`,
            { headers: { Authorization: `Bearer ${key}` } }
        );

        const record = (payload ?? {}) as Record<string, unknown>;
        const data = (record.data ?? {}) as Record<string, unknown>;

        return {
            status: normaliseStatus(data.status),
            providerReference: extractProviderReference(data),
            message: `Paystack reports the transaction as ${String(
                data.status ?? "unknown"
            )}.`,
            raw: payload,
            sandbox: !isLive(context),
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            const key = secret(context, "publicKey");
            if (!key) {
                return {
                    ok: false,
                    detail: "No API key has been saved for the Paystack adapter.",
                };
            }
            const payload = await callProvider(`${PAYSTACK_BASE}/transaction`, {
                headers: { Authorization: `Bearer ${key}` },
            });
            const record = (payload ?? {}) as Record<string, unknown>;
            const count = Array.isArray(record.data) ? record.data.length : 0;
            return {
                ok: true,
                detail: `Paystack accepted the key and returned ${count} transaction(s). The credentials work; this does not prove a card can be charged.`,
                raw: payload,
            };
        } catch (err) {
            return {
                ok: false,
                detail: "Paystack refused the saved key.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/* ────────────────────────────────────────────────────────────────────────
 * Stripe
 * ──────────────────────────────────────────────────────────────────────── */

const STRIPE_BASE = "https://api.stripe.com/v1";

/**
 * Stripe wants the amount in the currency's smallest unit, and the
 * currency in its own lowercase code.
 */
function stripeAmount(amount: number, currency: string): number {
    // The currencies with no minor unit.
    const zeroDecimal = new Set(["jpy", "krw", "vnd", "ugx", "rwf", "bif", "djf", "gnf", "kmf", "mga", "pyg", "ugx"]);
    const code = currency.toLowerCase();
    return zeroDecimal.has(code) ? Math.round(amount) : Math.round(amount * 100);
}

export const stripeProvider: PaymentProvider = {
    key: "card.stripe",

    async initiate(
        context: ProviderContext,
        request: PaymentInitiation
    ): Promise<PaymentResult> {
        const key = secret(context, "publicKey");
        if (!key) {
            throw new ProviderError(
                "The Stripe adapter is not configured. It needs its secret API key before it can be used."
            );
        }

        const currency = (request.currency || "ugx").toLowerCase();

        // Stripe is called with a form-encoded body rather than JSON.
        const body = new URLSearchParams();
        body.set("amount", String(stripeAmount(request.amount, currency)));
        body.set("currency", currency);
        body.set("reference", request.reference);
        body.set("success_url", callbackUrl(context, request.reference));
        body.set("cancel_url", callbackUrl(context, request.reference));
        body.set("description", request.description || "Payment");
        if (request.email) body.set("receipt_email", request.email);
        body.set("metadata[reference]", request.reference);

        const payload = await callProvider(`${STRIPE_BASE}/checkout/sessions`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${key}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: body.toString(),
        });

        const record = (payload ?? {}) as Record<string, unknown>;

        return {
            status: "pending",
            providerReference: extractProviderReference(record),
            message: "Stripe created the checkout session. The customer still has to complete it.",
            raw: payload,
            sandbox: !isLive(context),
        };
    },

    async verify(
        context: ProviderContext,
        reference: string
    ): Promise<PaymentResult> {
        const key = secret(context, "publicKey");
        if (!key) {
            throw new ProviderError(
                "The Stripe adapter is not configured. It needs its secret API key before it can be used."
            );
        }

        const payload = await callProvider(
            `${STRIPE_BASE}/checkout/sessions?limit=100`,
            { headers: { Authorization: `Bearer ${key}` } }
        );

        const record = (payload ?? {}) as Record<string, unknown>;
        const sessions = (record.data ?? []) as Record<string, unknown>[];
        const match = sessions.find((session) => {
            const metadata = (session.metadata ?? {}) as Record<string, unknown>;
            return metadata.reference === reference;
        });

        if (!match) {
            return {
                status: "pending",
                message:
                    "Stripe has no checkout session with that reference. It may not have been created, or it may be older than the last hundred sessions.",
                raw: payload,
                sandbox: !isLive(context),
            };
        }

        return {
            status: normaliseStatus(match.payment_status ?? match.status),
            providerReference: extractProviderReference(match),
            message: `Stripe reports the session as ${String(
                match.payment_status ?? match.status ?? "unknown"
            )}.`,
            raw: match,
            sandbox: !isLive(context),
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            const key = secret(context, "publicKey");
            if (!key) {
                return {
                    ok: false,
                    detail: "No API key has been saved for the Stripe adapter.",
                };
            }
            const payload = await callProvider(`${STRIPE_BASE}/balance`, {
                headers: { Authorization: `Bearer ${key}` },
            });
            return {
                ok: true,
                detail:
                    "Stripe accepted the key and returned the account balance. The credentials work; this does not prove a card can be charged.",
                raw: payload,
            };
        } catch (err) {
            return {
                ok: false,
                detail: "Stripe refused the saved key.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/** Is this adapter pointed at a live environment? */
function isLive(context: ProviderContext): boolean {
    return configString(context, "environment", "sandbox") === "live";
}
