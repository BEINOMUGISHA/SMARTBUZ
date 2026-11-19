/**
 * SMARTBUZ — the integration adapter contract.
 *
 * This module is the one place where "what an integration looks like" is
 * decided. It is a **pure** module: no Convex runtime, no database, no
 * network. That keeps it unit-testable offline and lets the browser and the
 * server agree on the same shapes without either importing the other.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why adapters
 * ────────────────────────────────────────────────────────────────────────
 *
 * A POS grows integrations one at a time: MTN Money, Airtel Money, a card
 * gateway, an SMS provider, WhatsApp, a thermal printer, a weighing scale.
 * Written ad hoc, each one grows its own configuration table, its own
 * credential storage, its own error handling and its own way of saying
 * "that did not work". Four integrations later there are four incompatible
 * ways to do the same job, and the owner has to learn all of them.
 *
 * An adapter is the opposite: every integration is a value in a registry
 * that declares the same things — what it is called, what it can do, what
 * the business must configure, how it proves it works — and then behaves
 * through a small number of standard calls. Adding the fifth provider means
 * adding one entry to the registry, not a new pattern across the codebase.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The honesty rule
 * ────────────────────────────────────────────────────────────────────────
 *
 * SMARTBUZ does not claim an integration works until it has been tested
 * against the real provider on real hardware. That is not a disclaimer
 * bolted onto the end — it is built into the contract:
 *
 *   - Every adapter ships in the state `unverified`.
 *   - An adapter can only reach `verified` by passing the **live test**,
 *     which makes a real call to the real provider and records what came
 *     back.
 *   - The descriptor states, before anything is configured, what the
 *     business must supply and how the test is performed.
 *
 * A green tick in the interface therefore means "this made a real call and
 * the provider answered", not "someone ticked a box".
 */

import type { Id } from "../_generated/dataModel";

/* ────────────────────────────────────────────────────────────────────────
 * The catalogue shape
 * ──────────────────────────────────────────────────────────────────────── */

/** What kind of thing an adapter is. */
export type AdapterCategory =
    | "payment"
    | "messaging"
    | "hardware"
    | "industry";

/**
 * How far an adapter has been proved.
 *
 * `unverified`  Nothing has been tested. This is where every adapter ships.
 * `configured`  Credentials are saved, but no live call has been made.
 * `verified`    A live test reached the real provider and succeeded.
 * `failed`      A live test was attempted and the provider refused it.
 */
export type VerificationStatus =
    | "unverified"
    | "configured"
    | "verified"
    | "failed";

/** The kind of value a configuration field holds. */
export type ConfigFieldType =
    | "string"
    | "secret"
    | "number"
    | "boolean"
    | "enum"
    | "url"
    | "phone";

/**
 * One thing the business must fill in before an adapter can be used.
 *
 * Fields of type `secret` are encrypted before they are stored and are
 * never returned to the browser — the interface shows only whether a secret
 * is present, never its value.
 */
export interface AdapterConfigField {
    key: string;
    label: string;
    type: ConfigFieldType;
    required?: boolean;
    placeholder?: string;
    /** A sentence explaining the field to the person filling it in. */
    help?: string;
    options?: { value: string; label: string }[];
    default?: string | number | boolean;
    /** Whether the field may be changed without re-testing. */
    /** Changing a secret invalidates the verification. */
    resetsVerification?: boolean;
}

/**
 * What it takes to turn this adapter from "written" into "working".
 *
 * This is shown in the interface next to the adapter, before the business
 * has configured anything, so nobody believes a button works because it is
 * on the screen.
 */
export interface AdapterVerificationGuide {
    /** One line: how the business proves it works. */
    method: string;
    /** What must be supplied before the test can even run. */
    requires: string[];
    /** The provider's own documentation, when there is one. */
    docs?: string;
    /** What the live test actually does. */
    testDescription: string;
}

/** Everything the catalogue knows about one adapter. */
export interface AdapterDescriptor {
    /** Stable machine name, e.g. `mtn.momo`. Never shown to a user. */
    key: string;
    category: AdapterCategory;
    /** The name a business sees. */
    label: string;
    /** Who provides it. */
    vendor: string;
    /**
     * The channel a messaging adapter delivers on.
     *
     * Only set on messaging adapters — it is what tells the interface
     * whether to ask for a phone number or an email address.
     */
    channel?: "sms" | "whatsapp" | "email";
    /** One sentence on what it does. */
    summary: string;
    /** Free-form capability tags, used for grouping and for entitlements. */
    capabilities: string[];
    /** What the business must configure. */
    configFields: AdapterConfigField[];
    /** How it proves it works. */
    verification: AdapterVerificationGuide;
    /** Limits that are true today, stated up front rather than discovered. */
    limitations?: string[];
    /**
     * Whether the adapter exposes a live test that can be run from the
     * interface. Adapters that only read — a statement importer, say —
     * have no test of their own.
     */
    supportsLiveTest: boolean;
    /**
     * Whether the adapter runs on the server or in the browser.
     *
     * Hardware adapters run in the browser because the browser is what
     * talks to the USB and serial port; the server only records the
     * configuration and the last time the device was seen.
     */
    runsOn: "server" | "client";
}

/* ────────────────────────────────────────────────────────────────────────
 * Payments
 * ──────────────────────────────────────────────────────────────────────── */

/** How a provider says a payment ended up. */
export type PaymentStatus =
    | "pending"
    | "succeeded"
    | "failed"
    | "cancelled";

/** A request to take money through a provider. */
export interface PaymentInitiation {
    adapterKey: string;
    /** In the currency's minor units where the provider wants them. */
    amount: number;
    currency: string;
    /** The payer's MSISDN, for mobile money. */
    phone?: string;
    /** The payer's email, for card gateways that collect it. */
    email?: string;
    /**
     * Our own reference for this payment.
     *
     * It is sent to the provider as the idempotency key, so a retry after a
     * timeout cannot charge the customer twice.
     */
    reference: string;
    description?: string;
    saleId?: Id<"sales">;
    customerId?: Id<"customers">;
    metadata?: Record<string, string>;
}

/** What the provider said. */
export interface PaymentResult {
    status: PaymentStatus;
    /** The provider's own identifier for the transaction. */
    providerReference?: string;
    /** The provider's message, in words an operator can act on. */
    message?: string;
    /** The raw response, kept for the audit log. */
    raw?: unknown;
    /** True when the call went to a sandbox rather than live. */
    sandbox: boolean;
}

/** One line of a provider statement. */
export interface StatementLine {
    /** ISO date. */
    date: string;
    /** The provider's reference for this line. */
    reference: string;
    /** The amount credited. */
    amount: number;
    description?: string;
    /** Who paid or who was paid. */
    counterparty?: string;
    /** The fee the provider charged, when the statement shows one. */
    fee?: number;
}

/** A parsed provider statement. */
export interface ParsedStatement {
    /** The period the statement covers, `YYYY-MM`. */
    period?: string;
    lines: StatementLine[];
    /** The sum of the lines. */
    total: number;
    currency?: string;
    /**
     * Rows that could not be read.
     *
     * A statement with skipped rows is still usable, but the operator has
     * to be told, because a silent skip is a silent hole in the books.
     */
    warnings: string[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Messaging
 * ──────────────────────────────────────────────────────────────────────── */

/** The channel a message goes out on. */
export type MessageChannel = "sms" | "whatsapp" | "email";

/** A message to send. */
export interface OutboundMessage {
    adapterKey: string;
    channel: MessageChannel;
    /** The destination — a phone number or an email address. */
    to: string;
    subject?: string;
    body: string;
    /** The template this was built from, when it was built from one. */
    templateKey?: string;
    /**
     * Our own reference for this message.
     *
     * It is handed to the provider so a gateway template can quote it,
     * and so a retry can be recognised as the same message.
     */
    reference?: string;
    /** What the message is about, so it can be found later. */
    relatedType?: "sale" | "customer" | "invoice" | "loan" | "payment";
    relatedId?: string;
}

/** What happened to the message. */
export interface MessageResult {
    status: "sent" | "failed";
    /** The provider's identifier for the message. */
    providerMessageId?: string;
    error?: string;
    raw?: unknown;
}

/* ────────────────────────────────────────────────────────────────────────
 * Hardware
 * ──────────────────────────────────────────────────────────────────────── */

/** The hardware a till may have. */
export type HardwareKind =
    | "barcode_scanner"
    | "thermal_printer"
    | "cash_drawer"
    | "weighing_scale";

/** How the till reaches a device. */
export type HardwareTransport =
    | "keyboard_wedge"
    | "web_serial"
    | "web_usb"
    | "http";

/** The configuration of one piece of hardware. */
export interface HardwareDescriptor {
    key: string;
    kind: HardwareKind;
    label: string;
    vendor: string;
    summary: string;
    /** How the browser talks to it. */
    transport: HardwareTransport;
    /** What has to be true for it to work. */
    requirements: string[];
    /** The limits, stated up front. */
    limitations: string[];
    /** How the business proves it works. */
    verification: AdapterVerificationGuide;
}

/* ────────────────────────────────────────────────────────────────────────
 * Industry packages
 * ──────────────────────────────────────────────────────────────────────── */

/** A feature inside an industry package. */
export interface IndustryFeature {
    key: string;
    label: string;
    summary: string;
    /** Whether it is on when the package is first enabled. */
    defaultEnabled: boolean;
}

/** One industry package. */
export interface IndustryPackageDescriptor {
    /** Stable machine name, e.g. `supermarket`. */
    key: string;
    label: string;
    summary: string;
    /** The category id this package lines up with. */
    categoryId: string;
    /** What it does for the business. */
    features: IndustryFeature[];
    /** The settings the package understands, with their defaults. */
    settings: {
        key: string;
        label: string;
        type: ConfigFieldType;
        default?: string | number | boolean;
        help?: string;
        options?: { value: string; label: string }[];
    }[];
    /** Limits that are true today. */
    limitations: string[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Small shared helpers
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The status of a verification, in the order of "how much has been proved".
 *
 * Used to decide whether a badge should say "verified" or "not verified".
 */
export const VERIFICATION_ORDER: VerificationStatus[] = [
    "unverified",
    "configured",
    "failed",
    "verified",
];

/** Has this adapter been proved against the real provider? */
export function isVerified(status: VerificationStatus | undefined): boolean {
    return status === "verified";
}

/**
 * A one-line statement of what a verification state means.
 *
 * The interface shows this next to the badge so that a business owner can
 * tell the difference between "we wrote this" and "this works".
 */
export function verificationLabel(status: VerificationStatus | undefined): string {
    switch (status) {
        case "verified":
            return "Verified against the live provider";
        case "configured":
            return "Configured, but never tested against the live provider";
        case "failed":
            return "The last live test failed";
        case "unverified":
        default:
            return "Not verified — no live provider test has been run";
    }
}
