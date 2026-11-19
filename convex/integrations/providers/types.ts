/**
 * SMARTBUZ — the provider contract.
 *
 * A *provider* is the running half of an adapter: the part that actually
 * talks to a payment gateway, a messaging service or a bank. The catalogue
 * half lives in `convex/integrations/registry.ts`.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why providers are separate from the catalogue
 * ────────────────────────────────────────────────────────────────────────
 *
 * The catalogue is pure — no network, no database — so the browser can
 * import it and so it can be tested offline. The providers make real HTTP
 * calls and must run inside a Convex **action**, because an action is the
 * only place `fetch` is allowed.
 *
 * The split also keeps the honesty rule in one place. A provider cannot
 * declare itself working; it can only report what the provider actually
 * said, and the engine decides what that means.
 */

import type {
    MessageResult,
    OutboundMessage,
    PaymentInitiation,
    PaymentResult,
    StatementLine,
} from "../types";

/**
 * What a provider is given when it runs.
 *
 * `secrets` are decrypted for the duration of the call and never written
 * anywhere except the provider's own request.
 */
export interface ProviderContext {
    /** The non-secret configuration. */
    config: Record<string, unknown>;
    /** The decrypted secrets, keyed by field name. */
    secrets: Record<string, string>;
    /** True when the adapter is configured for a sandbox. */
    sandbox: boolean;
}

/**
 * The outcome of a live test.
 *
 * `ok` is only true when the provider itself said so. A provider that
 * cannot reach its network reports `ok: false` with the reason — it never
 * reports a success it did not get.
 */
export interface ProviderTestResult {
    ok: boolean;
    /** What was actually done, in words an operator can read. */
    detail: string;
    /** The provider's raw response, for the audit log. */
    raw?: unknown;
    /** The provider's error message, when it failed. */
    error?: string;
}

/** A provider that takes money. */
export interface PaymentProvider {
    /** The adapter key this provider implements. */
    key: string;
    /**
     * Start a collection.
     *
     * The provider must use `request.reference` as the idempotency key, so
     * that a retry after a timeout cannot charge the customer twice.
     */
    initiate(
        context: ProviderContext,
        request: PaymentInitiation
    ): Promise<PaymentResult>;
    /**
     * Look a payment up with the provider.
     *
     * Used to settle a payment whose callback never arrived, and to check
     * a collection before deciding it failed.
     */
    verify(
        context: ProviderContext,
        reference: string
    ): Promise<PaymentResult>;
    /**
     * A cheap, real call that proves the credentials and the network path.
     *
     * It must not move money and must not send a message to a customer.
     */
    test(context: ProviderContext): Promise<ProviderTestResult>;
}

/** A provider that sends messages. */
export interface MessagingProvider {
    /** The adapter key this provider implements. */
    key: string;
    /** The channel this provider delivers on. */
    channel: "sms" | "whatsapp" | "email";
    /**
     * Send one message.
     *
     * The provider reports only what the gateway told it. "Accepted by the
     * gateway" is not "read by the customer", and the result says so.
     */
    send(
        context: ProviderContext,
        message: OutboundMessage
    ): Promise<MessageResult>;
    /** A cheap, real call that proves the credentials. */
    test(context: ProviderContext): Promise<ProviderTestResult>;
}

/**
 * A provider that reads statements.
 *
 * Statement readers do not call anyone — they parse a file — so they have
 * no live test. Their correctness is proved by importing a real statement
 * and checking every line.
 */
export interface StatementProvider {
    key: string;
    /**
     * Turn the raw text of a statement into lines.
     *
     * Rows that cannot be read are reported as warnings rather than
     * dropped, because a silently skipped row is a hole in the books.
     */
    parse(
        context: ProviderContext,
        raw: string
    ): { lines: StatementLine[]; warnings: string[] };
}

/* ────────────────────────────────────────────────────────────────────────
 * Shared helpers
 * ──────────────────────────────────────────────────────────────────────── */

/** Read a config value as a string. */
export function configString(
    context: ProviderContext,
    key: string,
    fallback = ""
): string {
    const value = context.config[key];
    if (typeof value === "string") return value;
    if (value === undefined || value === null) return fallback;
    return String(value);
}

/** Read a config value as a number. */
export function configNumber(
    context: ProviderContext,
    key: string,
    fallback = 0
): number {
    const value = Number(context.config[key]);
    return Number.isFinite(value) ? value : fallback;
}

/** Read a secret. */
export function secret(
    context: ProviderContext,
    key: string
): string {
    return context.secrets[key] ?? "";
}

/**
 * The base URL a provider should call.
 *
 * Sandbox and live are different places at every provider, and mixing them
 * up is how a test ends up charging a real customer. The base URL is
 * therefore derived from the saved environment, never from the caller.
 */
export function isLive(context: ProviderContext): boolean {
    const environment = configString(context, "environment", "sandbox");
    return environment === "live" || environment === "production";
}

/**
 * Call a provider's API and read the JSON back.
 *
 * Every provider uses this, so that a network failure and a provider
 * refusal are reported the same way everywhere: as a thrown error with the
 * provider's own message attached.
 */
export async function callProvider(
    url: string,
    init: {
        method?: string;
        headers?: Record<string, string>;
        body?: unknown;
        timeoutMs?: number;
    } = {}
): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
        () => controller.abort(),
        init.timeoutMs ?? 20_000
    );

    let response: Response;
    try {
        response = await fetch(url, {
            method: init.method ?? "GET",
            headers: {
                Accept: "application/json",
                ...(init.body !== undefined
                    ? { "Content-Type": "application/json" }
                    : {}),
                ...(init.headers ?? {}),
            },
            body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
            signal: controller.signal,
        });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "The provider could not be reached.";
        throw new ProviderError(
            `Could not reach the provider: ${message}. Check the network, the endpoint and any firewall in between.`
        );
    } finally {
        clearTimeout(timeout);
    }

    const text = await response.text();

    let payload: unknown = text;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            // Not JSON. The raw text is the payload — some providers answer
            // a bad key with a plain-text page.
            payload = text;
        }
    }

    if (!response.ok) {
        throw new ProviderError(
            providerErrorMessage(payload, response.status),
            payload
        );
    }

    return payload;
}

/**
 * Pull a useful error message out of a provider's response.
 *
 * Providers disagree about the shape of their errors, so several common
 * shapes are tried before giving up and using the status line.
 */
export function providerErrorMessage(payload: unknown, status: number): string {
    if (typeof payload === "string" && payload.trim()) {
        return `The provider returned ${status}: ${payload.trim().slice(0, 300)}`;
    }

    if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;

        for (const key of ["message", "error_description", "errorMessage", "reason", "detail"]) {
            const value = record[key];
            if (typeof value === "string" && value.trim()) return value.trim();
        }

        const error = record.error;
        if (typeof error === "string" && error.trim()) return error.trim();
        if (error && typeof error === "object") {
            const nested = error as Record<string, unknown>;
            const message = nested.message ?? nested.reason ?? nested.description;
            if (typeof message === "string" && message.trim()) return message.trim();
        }

        const errors = record.errors;
        if (Array.isArray(errors) && errors.length > 0) {
            const first = errors[0] as Record<string, unknown> | string;
            if (typeof first === "string") return first;
            const message = first.message ?? first.reason;
            if (typeof message === "string") return message;
        }
    }

    return `The provider returned HTTP ${status}.`;
}

/**
 * An error raised by a provider, with its payload attached.
 *
 * The payload is kept so the audit log can show what the provider actually
 * said, which is usually the difference between "it failed" and "it failed
 * because the account is not enabled for collections".
 */
export class ProviderError extends Error {
    readonly payload?: unknown;

    constructor(message: string, payload?: unknown) {
        super(message);
        this.name = "ProviderError";
        this.payload = payload;
    }
}

/**
 * The reference a provider echoes back.
 *
 * MTN returns the reference under `externalId`, Airtel under
 * `reference`, the card gateways under `txn_id` or `id`. All of them are
 * accepted so the common shape works everywhere.
 */
export function extractProviderReference(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const record = payload as Record<string, unknown>;

    for (const key of [
        "externalId",
        "providerReference",
        "txn_id",
        "transaction_id",
        "reference",
        "id",
        "data",
    ]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
        if (value && typeof value === "object") {
            const nested = value as Record<string, unknown>;
            for (const innerKey of ["id", "reference", "transactionId", "externalId"]) {
                const inner = nested[innerKey];
                if (typeof inner === "string" && inner.trim()) return inner.trim();
            }
        }
    }

    return undefined;
}
