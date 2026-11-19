/**
 * SMARTBUZ — mobile money providers.
 *
 * MTN Mobile Money and Airtel Money, implemented against the collection
 * APIs each provider documents.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What these adapters do not do
 * ────────────────────────────────────────────────────────────────────────
 *
 * They do not pretend a payment happened.
 *
 * A collection request that is accepted is **pending**, not successful.
 * The money is only `succeeded` when the provider's own callback says so,
 * or when a status query against the provider says so. A cashier who walks
 * away after the push must come back to a sale that still says "to confirm",
 * because at that moment nobody knows whether the customer entered their PIN.
 *
 * The reference sent to the provider is ours and is used as the
 * idempotency key, so a retry after a timeout cannot collect twice.
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

/* ────────────────────────────────────────────────────────────────────────
 * MTN Mobile Money
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * MTN's collection base URLs.
 *
 * The sandbox and production collections are separate deployments with
 * separate credentials, which is why the environment is part of the
 * configuration rather than a guess.
 */
const MTN_BASES: Record<string, string> = {
    sandbox: "https://sandbox.mtn.com/collection",
    staging: "https://staging.mtn.com/collection",
    production: "https://api.mtn.com/collection",
};

/**
 * The token endpoint.
 *
 * MTN issues a short-lived token that the collection call carries as a
 * bearer token. It is fetched fresh each time rather than cached, because
 * an action cannot hold state between runs and a stale token is a failed
 * call.
 */
async function mtnToken(context: ProviderContext): Promise<string> {
    const base = MTN_BASES[configString(context, "targetEnvironment", "sandbox")] ?? MTN_BASES.sandbox;
    const subscriptionId = configString(context, "subscriptionId");
    const apiUser = configString(context, "apiUser");
    const apiPassword = secret(context, "apiPassword");
    const apiKey = secret(context, "apiKey");

    if (!subscriptionId || !apiUser || !apiPassword || !apiKey) {
        throw new ProviderError(
            "The MTN adapter is not fully configured. It needs a subscription ID, API user, API password and API key before it can be used."
        );
    }

    const payload = await callProvider(
        `${base}/token/`,
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${base64(`${apiUser}:${apiPassword}`)}`,
                "X-Target-Environment": configString(
                    context,
                    "targetEnvironment",
                    "sandbox"
                ),
            },
            body: { grant_type: "client_credentials", subscription_id: subscriptionId },
        }
    );

    const token = (payload as Record<string, unknown>)?.access_token;
    if (typeof token !== "string" || !token) {
        throw new ProviderError(
            "MTN did not return an access token. The credentials were refused.",
            payload
        );
    }

    return token;
}

/** Base64 without relying on Node's Buffer. */
function base64(value: string): string {
    let binary = "";
    for (let i = 0; i < value.length; i++) {
        binary += String.fromCharCode(value.charCodeAt(i));
    }
    return btoa(binary);
}

/**
 * MTN's own status vocabulary, mapped onto ours.
 *
 * MTN reports `SUCCESSFUL`, `FAILED`, `PENDING` and `REVERSED`.
 */
function mtnStatus(value: unknown): PaymentResult["status"] {
    switch (String(value ?? "").toUpperCase()) {
        case "SUCCESSFUL":
            return "succeeded";
        case "FAILED":
            return "failed";
        case "CANCELLED":
            return "cancelled";
        case "REVERSED":
            return "failed";
        default:
            return "pending";
    }
}

export const mtnMoMoProvider: PaymentProvider = {
    key: "mtn.momo",

    async initiate(
        context: ProviderContext,
        request: PaymentInitiation
    ): Promise<PaymentResult> {
        const token = await mtnToken(context);
        const base =
            MTN_BASES[configString(context, "targetEnvironment", "sandbox")] ??
            MTN_BASES.sandbox;

        const currency = request.currency || configString(context, "currency", "UGX");

        const payload = await callProvider(`${base}/request-to-pay/`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "X-Target-Environment": configString(
                    context,
                    "targetEnvironment",
                    "sandbox"
                ),
                "X-Reference-Id": request.reference,
            },
            body: {
                amount: String(request.amount),
                currency,
                externalId: request.reference,
                payer: { partyId: { partyIdType: "MSISDN", partyId: request.phone } },
                payerMessage: request.description || "Payment for your purchase",
                canPartiallyPay: false,
                validityTime: 120,
            },
        });

        const record = (payload ?? {}) as Record<string, unknown>;

        // MTN answers 202 Accepted for a request it has taken. That is a
        // request to collect, not a collection.
        const status = mtnStatus(record.status);

        return {
            status: status === "succeeded" ? "pending" : status,
            providerReference:
                extractProviderReference(record) ??
                (typeof record.payerReference === "string"
                    ? record.payerReference
                    : undefined),
            message:
                typeof record.status === "string"
                    ? `MTN accepted the request (${record.status}). The customer still has to enter their PIN.`
                    : "MTN accepted the request. The customer still has to enter their PIN.",
            raw: payload,
            sandbox: !isLiveEnvironment(context),
        };
    },

    async verify(
        context: ProviderContext,
        reference: string
    ): Promise<PaymentResult> {
        const token = await mtnToken(context);
        const base =
            MTN_BASES[configString(context, "targetEnvironment", "sandbox")] ??
            MTN_BASES.sandbox;

        const payload = await callProvider(
            `${base}/request-to-pay/${encodeURIComponent(reference)}`,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    "X-Target-Environment": configString(
                        context,
                        "targetEnvironment",
                        "sandbox"
                    ),
                },
            }
        );

        const record = (payload ?? {}) as Record<string, unknown>;

        return {
            status: mtnStatus(record.status),
            providerReference: extractProviderReference(record),
            message:
                typeof record.status === "string"
                    ? `MTN reports the payment as ${record.status}.`
                    : "MTN did not report a status.",
            raw: payload,
            sandbox: !isLiveEnvironment(context),
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            await mtnToken(context);
            return {
                ok: true,
                detail:
                    "MTN issued an access token for the saved credentials. The credentials and the network path work. This does not prove a customer can pay — the sandbox cannot deliver a push to a real handset.",
                raw: { token: "issued" },
            };
        } catch (err) {
            return {
                ok: false,
                detail:
                    "MTN did not issue an access token for the saved credentials.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/* ────────────────────────────────────────────────────────────────────────
 * Airtel Money
 * ──────────────────────────────────────────────────────────────────────── */

/** Airtel's collection base URLs. */
const AIRTEL_BASES: Record<string, string> = {
    sandbox: "https://openapi.airtel.africa",
    production: "https://openapi.airtel.africa",
};

/**
 * Airtel's collections token.
 *
 * Airtel issues a token that is then used to encrypt the payload with the
 * client's own key, and the result is wrapped in an RSA-encrypted blob.
 */
async function airtelToken(context: ProviderContext): Promise<string> {
    const clientId = configString(context, "clientId");
    const clientSecret = secret(context, "clientSecret");

    if (!clientId || !clientSecret) {
        throw new ProviderError(
            "The Airtel adapter is not fully configured. It needs a client id and client secret before it can be used."
        );
    }

    const payload = await callProvider(`${AIRTEL_BASES.production}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { client_id: clientId, client_secret: clientSecret },
    });

    const token = (payload as Record<string, unknown>)?.access_token;
    if (typeof token !== "string" || !token) {
        throw new ProviderError(
            "Airtel did not return an access token. The credentials were refused.",
            payload
        );
    }

    return token;
}

/**
 * The RSA-encrypted wrapper Airtel expects around a collections request.
 *
 * The payload is encrypted with the client key using RSA OAEP, then the
 * result is base64-encoded and placed in the `encrypted_field`.
 *
 * `crypto.subtle` is used rather than a library, because a Convex action
 * has no Node built-ins.
 */
async function rsaEncrypt(
    plaintext: string,
    publicKeyBase64: string
): Promise<string> {
    const binary = atob(publicKeyBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }

    const key = await crypto.subtle.importKey(
        "spki",
        bytes as unknown as BufferSource,
        { name: "RSA-OAEP", hash: "SHA-256" },
        false,
        ["encrypt"]
    );

    const encrypted = await crypto.subtle.encrypt(
        { name: "RSA-OAEP" },
        key,
        new TextEncoder().encode(plaintext) as unknown as BufferSource
    );

    return base64(String.fromCharCode(...new Uint8Array(encrypted)));
}

export const airtelMoneyProvider: PaymentProvider = {
    key: "airtel.money",

    async initiate(
        context: ProviderContext,
        request: PaymentInitiation
    ): Promise<PaymentResult> {
        const token = await airtelToken(context);
        const clientKey = configString(context, "clientKey");

        if (!clientKey) {
            throw new ProviderError(
                "The Airtel adapter is not fully configured. It needs a client key to encrypt the collection request."
            );
        }

        const inner = {
            reference: request.reference,
            amount: request.amount,
            currency: request.currency || "UGX",
            msisdn: request.phone,
            description: request.description || "Payment for your purchase",
            transaction_type: "Collection",
        };

        const payload = await callProvider(
            `${AIRTEL_BASES.production}/merchant/v1/payments/collection/`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "X-Client-Key": clientKey,
                    Accept: "application/json",
                },
                body: {
                    encrypted_field: await rsaEncrypt(
                        JSON.stringify(inner),
                        clientKey
                    ),
                    encrypted_key: clientKey,
                },
            }
        );

        const record = (payload ?? {}) as Record<string, unknown>;
        const status = (record.status ?? "").toString().toUpperCase();

        return {
            status: status === "SUCCESS" ? "pending" : "pending",
            providerReference: extractProviderReference(record),
            message:
                "Airtel accepted the collection request. The customer still has to enter their PIN.",
            raw: payload,
            sandbox: !isLiveEnvironment(context),
        };
    },

    async verify(
        context: ProviderContext,
        reference: string
    ): Promise<PaymentResult> {
        const token = await airtelToken(context);

        const payload = await callProvider(
            `${AIRTEL_BASES.production}/standard/v1/payments/status/?reference=${encodeURIComponent(
                reference
            )}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );

        const record = (payload ?? {}) as Record<string, unknown>;
        const status = (record.status ?? "").toString().toUpperCase();

        return {
            status:
                status === "SUCCESS"
                    ? "succeeded"
                    : status === "FAILED"
                      ? "failed"
                      : "pending",
            providerReference: extractProviderReference(record),
            message: `Airtel reports the transaction as ${status || "unknown"}.`,
            raw: payload,
            sandbox: !isLiveEnvironment(context),
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            await airtelToken(context);
            return {
                ok: true,
                detail:
                    "Airtel issued a collections token for the saved credentials. The credentials and the network path work. This does not prove a customer can pay — the sandbox cannot deliver a push to a real handset.",
                raw: { token: "issued" },
            };
        } catch (err) {
            return {
                ok: false,
                detail:
                    "Airtel did not issue a collections token for the saved credentials.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/**
 * Is this adapter pointed at a live environment?
 *
 * Airtel uses one host for both, so its live/sandbox switch is the
 * configured environment rather than the host.
 */
function isLiveEnvironment(context: ProviderContext): boolean {
    const environment = configString(context, "environment", "sandbox");
    if (environment === "live") return true;
    const target = configString(context, "targetEnvironment", "sandbox");
    return target === "production";
}
