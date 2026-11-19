/**
 * SMARTBUZ — message templates.
 *
 * A template is a piece of text with named holes in it. The holes are
 * filled from the record the message is about — a sale, an invoice, a
 * credit account — and what comes out is what the customer reads.
 *
 * This module is **pure**: no database, no network, no Convex runtime. That
 * means a template can be unit-tested on its own, and the same template
 * can be rendered on the server or previewed in the browser.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rules
 * ────────────────────────────────────────────────────────────────────────
 *
 * A hole that has no value is **left as it is**, not replaced with
 * "undefined" or "null". A receipt that reads "Balance: undefined" looks
 * broken; a receipt that reads "Balance: undefined" in a place where the
 * template said "{{balance}}" is worse, because the sender looks careless.
 * The placeholders that cannot be filled are reported, so the caller can
 * decide whether to send at all.
 *
 * An **empty string** is not a missing value — it means "there is
 * deliberately nothing here". A receipt for a sale that was paid in full
 * has no balance line, and that is a decision, not an omission.
 *
 * Nothing a template produces is trusted by the reader of this file: the
 * values come from the business's own records, and any customer-supplied
 * text (a customer's name, say) is inserted verbatim. It is sent as
 * plain text, and the email adapter escapes it.
 */

/** A message template. */
export interface MessageTemplate {
    key: string;
    label: string;
    /** Which channel this template is meant for. */
    channel: "sms" | "whatsapp" | "email";
    /** The subject, for email. */
    subject?: string;
    /** The body, with `{{name}}` holes in it. */
    body: string;
    /** The holes this template expects. */
    variables: string[];
    /** One line on what the template is for. */
    summary: string;
}

/** The templates SMARTBUZ ships with. */
export const MESSAGE_TEMPLATES: MessageTemplate[] = [
    {
        key: "sale.receipt",
        label: "Sale receipt",
        channel: "email",
        subject: "Your receipt {{invoiceNumber}} from {{businessName}}",
        summary:
            "A copy of the receipt for a sale, with the items and the total.",
        variables: [
            "businessName",
            "invoiceNumber",
            "date",
            "customerName",
            "items",
            "total",
            "paymentMode",
            "balance",
        ],
        body: [
            "Hello {{customerName}},",
            "",
            "Here is your receipt from {{businessName}}.",
            "",
            "Invoice: {{invoiceNumber}}",
            "Date: {{date}}",
            "",
            "{{items}}",
            "",
            "Total: {{total}}",
            "Paid by: {{paymentMode}}",
            "{{balanceLine}}",
            "",
            "Thank you for your business.",
            "",
            "{{businessName}}",
        ].join("\n"),
    },
    {
        key: "sale.receipt.sms",
        label: "Sale receipt (SMS)",
        channel: "sms",
        summary: "A short receipt for a sale, sent as a text message.",
        variables: [
            "businessName",
            "invoiceNumber",
            "total",
            "paymentMode",
            "balance",
        ],
        body: [
            "{{businessName}}: receipt {{invoiceNumber}}.",
            "Total {{total}} ({{paymentMode}}).",
            "{{balanceLine}}",
            "Thank you.",
        ].join("\n"),
    },
    {
        key: "payment.reminder",
        label: "Payment reminder",
        channel: "sms",
        summary:
            "A reminder that money is due on a credit account. Sent by SMS or WhatsApp.",
        variables: [
            "businessName",
            "customerName",
            "amount",
            "dueDate",
            "daysOverdue",
            "invoiceNumber",
        ],
        body: [
            "Hello {{customerName}}, this is {{businessName}}.",
            "Your account of {{amount}} is due on {{dueDate}}",
            "{{overdueLine}}",
            "Please settle it when you can.",
            "Ref {{invoiceNumber}}",
        ].join("\n"),
    },
    {
        key: "payment.reminder.email",
        label: "Payment reminder (email)",
        channel: "email",
        subject: "Payment due: {{amount}} — {{businessName}}",
        summary:
            "A reminder that money is due on a credit account, sent by email.",
        variables: [
            "businessName",
            "customerName",
            "amount",
            "dueDate",
            "daysOverdue",
            "invoiceNumber",
        ],
        body: [
            "Hello {{customerName}},",
            "",
            "Our records show a balance of {{amount}} on your account,",
            "due on {{dueDate}}.",
            "{{overdueLine}}",
            "When you have settled it, reply to this message and we will mark it paid.",
            "",
            "Thank you,",
            "{{businessName}}",
        ].join("\n"),
    },
    {
        key: "prescription.ready",
        label: "Prescription ready",
        channel: "sms",
        summary: "Tells a patient that their prescription is ready to collect.",
        variables: ["businessName", "patientName", "prescriptionNumber"],
        body: [
            "Hello {{patientName}}, your prescription is ready for collection",
            "at {{businessName}}.",
            "Ref {{prescriptionNumber}}",
        ].join("\n"),
    },
    {
        key: "order.confirmation",
        label: "Order confirmation",
        channel: "sms",
        summary: "Confirms that a table order was received.",
        variables: ["businessName", "customerName", "tableName", "total"],
        body: [
            "Hello {{customerName}}, your order at {{businessName}}",
            "for table {{tableName}} has been received.",
            "Total: {{total}}",
        ].join("\n"),
    },
];

/** The template with this key, or undefined. */
export function findTemplate(key: string): MessageTemplate | undefined {
    return MESSAGE_TEMPLATES.find((t) => t.key === key);
}

/** The templates for one channel. */
export function templatesForChannel(
    channel: "sms" | "whatsapp" | "email"
): MessageTemplate[] {
    return MESSAGE_TEMPLATES.filter((t) => t.channel === channel);
}

/**
 * Fill a template's holes.
 *
 * `values` holds what is known. A hole with no value is left exactly as it
 * was, and its name is reported in `missing` so the caller can decide
 * whether the message is fit to send.
 */
export function renderTemplate(
    template: string,
    values: Record<string, string | number | undefined | null>
): { text: string; missing: string[] } {
    const missing: string[] = [];

    const text = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
        const value = values[key];

        // `undefined` and `null` mean "we do not know this". An empty
        // string means "there is deliberately nothing here" — a receipt
        // for a paid sale has no balance line, and that is not a
        // missing value.
        if (value === undefined || value === null) {
            if (!missing.includes(key)) missing.push(key);
            return match;
        }

        return String(value);
    });

    return { text, missing };
}

/**
 * Render a whole template.
 *
 * The subject is rendered too, and a template with a missing subject
 * simply has none.
 */
export function renderMessage(
    template: MessageTemplate,
    values: Record<string, string | number | undefined | null>
): { subject?: string; body: string; missing: string[] } {
    const body = renderTemplate(template.body, values);
    const missing = [...body.missing];

    let subject: string | undefined;
    if (template.subject) {
        const rendered = renderTemplate(template.subject, values);
        subject = rendered.text;
        for (const key of rendered.missing) {
            if (!missing.includes(key)) missing.push(key);
        }
    }

    return { subject, body: body.text, missing };
}

/**
 * Format money for a message.
 *
 * Whole units with thousands separators, because a message is read on a
 * phone screen and `UGX 12,500` is easier to read at a glance than
 * `12500.00`.
 */
export function formatMoney(amount: number, currency = "UGX"): string {
    const value = Number(amount);
    if (!Number.isFinite(value)) return `${currency} 0`;
    const rounded = Math.round(value * 100) / 100;
    return `${currency} ${rounded.toLocaleString("en-US", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    })}`;
}

/**
 * Format the items of a sale for a receipt.
 *
 * One line per item, padded so the amounts line up.
 */
export function formatItems(
    items: { name: string; quantity: number; price: number }[]
): string {
    if (!items || items.length === 0) return "No items.";

    const lines = items.map((item) => {
        const quantity = Number(item.quantity) || 0;
        const price = Number(item.price) || 0;
        const total = quantity * price;
        const label = `${quantity} x ${item.name}`;
        return `${label} — ${total.toLocaleString("en-US", {
            maximumFractionDigits: 2,
        })}`;
    });

    return lines.join("\n");
}

/**
 * A line about what is still owed, or nothing at all.
 *
 * A receipt for a paid sale must not carry a "balance" line, and a
 * receipt for a credit sale must carry one.
 */
export function balanceLine(balance: number | undefined): string {
    if (balance === undefined || balance === null) return "";
    const value = Number(balance);
    if (!Number.isFinite(value) || value <= 0) return "";
    return `Balance still due: ${value.toLocaleString("en-US", {
        maximumFractionDigits: 2,
    })}`;
}

/**
 * A line about how late a payment is, or nothing at all.
 */
export function overdueLine(daysOverdue: number | undefined): string {
    const days = Number(daysOverdue);
    if (!Number.isFinite(days) || days <= 0) return "";
    if (days === 1) return "It is 1 day overdue.";
    return `It is ${Math.round(days)} days overdue.`;
}
