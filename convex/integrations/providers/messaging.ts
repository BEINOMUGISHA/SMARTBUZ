/**
 * SMARTBUZ — messaging providers.
 *
 * SMS through any HTTP gateway or Africa's Talking, WhatsApp through
 * Meta's Cloud API, and email through Resend.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What "sent" means
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every one of these providers reports **only what their gateway said**.
 *
 * "Sent" means the gateway accepted the message for delivery. It does not
 * mean the customer read it, and in some cases it does not even mean the
 * message left the country — a carrier can reject it afterwards. The
 * message log records the gateway's own status, and the interface never
 * claims more than that.
 *
 * The one thing no provider may do is report success when the call
 * failed. A failed send is a failure, and it is written down.
 */

import {
    callProvider,
    configString,
    ProviderError,
    secret,
    type MessagingProvider,
    type ProviderContext,
    type ProviderTestResult,
} from "./types";
import type { MessageResult, OutboundMessage } from "../types";

/* ────────────────────────────────────────────────────────────────────────
 * SMS — any HTTP gateway
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Fill a template.
 *
 * The placeholders are deliberately few and plain: `{{to}}`, `{{body}}`,
 * `{{reference}}` and `{{business}}`. A business that needs something
 * else can put it in the body of the message instead.
 */
export function fillTemplate(
    template: string,
    values: Record<string, string>
): string {
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
        values[key] !== undefined ? values[key] : match
    );
}

export const smsGenericProvider: MessagingProvider = {
    key: "sms.generic",
    channel: "sms",

    async send(
        context: ProviderContext,
        message: OutboundMessage
    ): Promise<MessageResult> {
        const endpoint = configString(context, "endpoint");
        if (!endpoint) {
            throw new ProviderError(
                "The SMS adapter is not configured. It needs a send endpoint before it can be used."
            );
        }

        const apiKey = secret(context, "apiKey");
        const authHeader = configString(context, "authHeader", "Bearer");

        const headers: Record<string, string> = {};
        if (apiKey) {
            headers["Authorization"] = authHeader
                ? `${authHeader} ${apiKey}`
                : apiKey;
        }

        const bodyTemplate =
            configString(
                context,
                "bodyTemplate",
                '{"to":"{{to}}","message":"{{body}}"}'
            );

        const body = fillTemplate(bodyTemplate, {
            to: message.to,
            body: message.body,
            reference: message.reference ?? message.templateKey ?? "",
            business: configString(context, "businessName", ""),
        });

        let payload: unknown;
        try {
            payload = await callProvider(endpoint, {
                method: configString(context, "method", "POST"),
                headers,
                body: configString(context, "method", "POST") === "GET" ? undefined : body,
            });
        } catch (err) {
            return {
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }

        return {
            status: "sent",
            providerMessageId: extractMessageId(payload),
            raw: payload,
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        const endpoint = configString(context, "endpoint");
        if (!endpoint) {
            return {
                ok: false,
                detail: "No send endpoint has been saved for the SMS adapter.",
            };
        }
        if (!secret(context, "apiKey")) {
            return {
                ok: false,
                detail: "No API key has been saved for the SMS adapter.",
            };
        }
        return {
            ok: false,
            detail:
                "The generic SMS gateway cannot be proved without sending a message, and this test will not send one. Use 'Send test message' with a number you control — that makes the real call and records what the gateway answered.",
            error:
                "A generic gateway has no harmless endpoint to call. The verification is done by sending one real message.",
        };
    },
};

/* ────────────────────────────────────────────────────────────────────────
 * SMS — Africa's Talking
 * ──────────────────────────────────────────────────────────────────────── */

const AT_BASE = "https://api.africastalking.com/version1";

export const smsAfricasTalkingProvider: MessagingProvider = {
    key: "sms.africasTalking",
    channel: "sms",

    async send(
        context: ProviderContext,
        message: OutboundMessage
    ): Promise<MessageResult> {
        const username = configString(context, "username");
        const apiKey = secret(context, "apiKey");

        if (!username || !apiKey) {
            throw new ProviderError(
                "The Africa's Talking adapter is not configured. It needs a username and API key before it can be used."
            );
        }

        const body = new URLSearchParams();
        body.set("username", username);
        body.set("to", message.to);
        body.set("message", message.body);
        const sender = configString(context, "senderId");
        if (sender) body.set("from", sender);

        let payload: unknown;
        try {
            payload = await callProvider(`${AT_BASE}/sms/send`, {
                method: "POST",
                headers: {
                    api_key: apiKey,
                    "Content-Type": "application/x-www-form-urlencoded",
                    Accept: "application/json",
                },
                body: body.toString(),
            });
        } catch (err) {
            return {
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }

        const record = (payload ?? {}) as Record<string, unknown>;
        const status = String(record.status ?? "").toLowerCase();
        const recipients = (record.SMSMessageText ?? []) as Record<string, unknown>[];

        if (status && status !== "success" && status !== "ok") {
            return {
                status: "failed",
                error:
                    typeof record.errorMessage === "string"
                        ? record.errorMessage
                        : `Africa's Talking refused the message (${status}).`,
                raw: payload,
            };
        }

        return {
            status: "sent",
            providerMessageId:
                typeof recipients[0]?.id === "string" ? recipients[0].id : undefined,
            raw: payload,
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            const username = configString(context, "username");
            const apiKey = secret(context, "apiKey");
            if (!username || !apiKey) {
                return {
                    ok: false,
                    detail:
                        "No username and API key have been saved for the Africa's Talking adapter.",
                };
            }
            const payload = await callProvider(`${AT_BASE}/user?username=${encodeURIComponent(username)}`, {
                headers: { api_key: apiKey, Accept: "application/json" },
            });
            return {
                ok: true,
                detail:
                    "Africa's Talking accepted the credentials for the saved account. The credentials work; this does not prove a message reaches a handset — use 'Send test message' with a number you control for that.",
                raw: payload,
            };
        } catch (err) {
            return {
                ok: false,
                detail: "Africa's Talking refused the saved credentials.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/* ────────────────────────────────────────────────────────────────────────
 * WhatsApp — Meta Cloud API
 * ──────────────────────────────────────────────────────────────────────── */

const WHATSAPP_BASE = "https://graph.facebook.com/v20.0";

export const whatsappCloudProvider: MessagingProvider = {
    key: "whatsapp.cloud",
    channel: "whatsapp",

    async send(
        context: ProviderContext,
        message: OutboundMessage
    ): Promise<MessageResult> {
        const token = secret(context, "accessToken");
        const phoneNumberId = configString(context, "phoneNumberId");

        if (!token || !phoneNumberId) {
            throw new ProviderError(
                "The WhatsApp adapter is not configured. It needs a phone number id and an access token before it can be used."
            );
        }

        const to = normaliseWhatsappNumber(
            message.to,
            configString(context, "defaultCountryCode", "256")
        );

        const payload = await callProvider(
            `${WHATSAPP_BASE}/${encodeURIComponent(phoneNumberId)}/messages`,
            {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${token}`,
                    "Content-Type": "application/json",
                },
                body: {
                    messaging_product: "whatsapp",
                    to,
                    type: "text",
                    text: { body: message.body },
                },
            }
        );

        const record = (payload ?? {}) as Record<string, unknown>;
        const messages = (record.messages ?? []) as Record<string, unknown>[];

        return {
            status: "sent",
            providerMessageId:
                typeof messages[0]?.id === "string" ? messages[0].id : undefined,
            raw: payload,
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            const token = secret(context, "accessToken");
            const phoneNumberId = configString(context, "phoneNumberId");
            if (!token || !phoneNumberId) {
                return {
                    ok: false,
                    detail:
                        "No phone number id and access token have been saved for the WhatsApp adapter.",
                };
            }
            const payload = await callProvider(
                `${WHATSAPP_BASE}/${encodeURIComponent(phoneNumberId)}`,
                { headers: { Authorization: `Bearer ${token}` } }
            );
            const record = (payload ?? {}) as Record<string, unknown>;
            return {
                ok: true,
                detail: `Meta accepted the token for phone number ${
                    record.display_phone_number ?? phoneNumberId
                }. The credentials work; this does not prove a message reaches a handset.`,
                raw: payload,
            };
        } catch (err) {
            return {
                ok: false,
                detail: "Meta refused the saved WhatsApp token.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/**
 * Put a number into the form WhatsApp expects.
 *
 * WhatsApp wants a full international number with no `+` and no spaces.
 */
export function normaliseWhatsappNumber(
    phone: string,
    defaultCountryCode: string
): string {
    const digits = phone.replace(/[^0-9]/g, "");
    if (digits.startsWith(defaultCountryCode) && digits.length > 8) {
        return digits;
    }
    if (digits.startsWith("0")) {
        return `${defaultCountryCode}${digits.slice(1)}`;
    }
    return digits;
}

/* ────────────────────────────────────────────────────────────────────────
 * Email — Resend
 * ──────────────────────────────────────────────────────────────────────── */

const RESEND_BASE = "https://api.resend.com";

export const emailResendProvider: MessagingProvider = {
    key: "email.resend",
    channel: "email",

    async send(
        context: ProviderContext,
        message: OutboundMessage
    ): Promise<MessageResult> {
        const apiKey = secret(context, "apiKey");
        const from = configString(context, "fromAddress");

        if (!apiKey || !from) {
            throw new ProviderError(
                "The email adapter is not configured. It needs an API key and a from address before it can be used."
            );
        }

        const replyTo = configString(context, "replyTo");

        let payload: unknown;
        try {
            payload = await callProvider(`${RESEND_BASE}/emails`, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    "Content-Type": "application/json",
                },
                body: {
                    from,
                    to: [message.to],
                    subject: message.subject || "Your receipt",
                    html: toHtml(message.body),
                    ...(replyTo ? { reply_to: replyTo } : {}),
                },
            });
        } catch (err) {
            return {
                status: "failed",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }

        const record = (payload ?? {}) as Record<string, unknown>;

        return {
            status: "sent",
            providerMessageId:
                typeof record.id === "string" ? record.id : undefined,
            raw: payload,
        };
    },

    async test(context: ProviderContext): Promise<ProviderTestResult> {
        try {
            const apiKey = secret(context, "apiKey");
            if (!apiKey) {
                return {
                    ok: false,
                    detail: "No API key has been saved for the email adapter.",
                };
            }
            const payload = await callProvider(`${RESEND_BASE}/domains`, {
                headers: { Authorization: `Bearer ${apiKey}` } }
            );
            const record = (payload ?? {}) as Record<string, unknown>;
            const data = (record.data ?? []) as Record<string, unknown>[];
            return {
                ok: true,
                detail: `Resend accepted the key and returned ${data.length} domain(s). The credentials work; this does not prove mail is delivered — use 'Send test email' with an address you control for that.`,
                raw: payload,
            };
        } catch (err) {
            return {
                ok: false,
                detail: "Resend refused the saved API key.",
                error: err instanceof Error ? err.message : String(err),
                raw: err instanceof ProviderError ? err.payload : undefined,
            };
        }
    },
};

/**
 * Turn plain text into a simple HTML body.
 *
 * A receipt is text with lines in it, so the text is escaped and the line
 * breaks become paragraphs. Nothing more elaborate is needed, and nothing
 * here can inject markup.
 */
export function toHtml(text: string): string {
    const escaped = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const paragraphs = escaped
        .split(/\n{2,}/)
        .map((block) => `<p>${block.replace(/\n/g, "<br/>")}</p>`)
        .join("");

    return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;color:#111827;">${paragraphs}</div>`;
}

/**
 * Pull the provider's message id out of a response.
 */
function extractMessageId(payload: unknown): string | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const record = payload as Record<string, unknown>;
    for (const key of ["id", "message_id", "messageId", "SmsMessageId", "ref"]) {
        const value = record[key];
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return undefined;
}
