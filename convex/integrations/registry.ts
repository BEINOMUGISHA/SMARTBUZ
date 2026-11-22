/**
 * SMARTBUZ — the integration adapter registry.
 *
 * One catalogue, one shape. Every payment provider, messaging channel,
 * piece of hardware and industry package in SMARTBUZ is described here by
 * the same descriptor, so the interface can render them all the same way
 * and a new integration is one more entry rather than a new pattern.
 *
 * This module is **pure**: no database, no network, no Convex runtime. The
 * catalogue is therefore testable offline, and the browser can import it to
 * render labels without pulling the server into the bundle.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule this file exists to enforce
 * ────────────────────────────────────────────────────────────────────────
 *
 * Nothing in here claims to work.
 *
 * Every adapter carries a `verification` block saying what the business
 * must supply, what the live test does, and — where the provider has
 * limitations worth knowing before the money is spent — a `limitations`
 * list. The `supportsLiveTest` flag says whether the built-in test can
 * exercise it at all.
 *
 * An adapter reaches `verified` only by making a real call to the real
 * provider and having the answer recorded. See
 * `convex/integrations/engine.ts`.
 */

import type {
    AdapterCategory,
    AdapterConfigField,
    AdapterDescriptor,
    HardwareDescriptor,
    HardwareKind,
    IndustryPackageDescriptor,
} from "./types";
import { ConvexError } from "convex/values";

/* ────────────────────────────────────────────────────────────────────────
 * Shared configuration fields
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The sandbox/live switch.
 *
 * It is on every provider that charges money or sends messages, because
 * the single most damaging thing that can happen to a new installation is a
 * test call that reaches a customer's real account.
 */
const environmentField: AdapterConfigField = {
    key: "environment",
    label: "Environment",
    type: "enum",
    default: "sandbox",
    required: true,
    help: "Sandbox calls never touch a real account. Switch to live only after the sandbox test has passed.",
    options: [
        { value: "sandbox", label: "Sandbox" },
        { value: "live", label: "Live" },
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Payments
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The secret a provider's callback is signed with.
 *
 * Every adapter that receives a callback needs one. Without it the callback
 * cannot be checked against anything, so it is refused — which means an
 * adapter that takes a callback and has no secret here will never confirm
 * a payment. The field is required for exactly that reason, and the help
 * text says so.
 */
const webhookSecretField: AdapterConfigField = {
    key: "webhookSecret",
    label: "Webhook secret",
    type: "secret",
    required: true,
    resetsVerification: true,
    help: "A secret of your own choosing, at least 32 characters. The provider signs its callback with it, and SMARTBUZ refuses any callback that does not carry a matching signature. Choose a long, random value and give the provider the same one.",
};

/* ────────────────────────────────────────────────────────────────────────
 * The MTN Mobile Money adapter
 * ──────────────────────────────────────────────────────────────────────── */

const mtnMoMo: AdapterDescriptor = {
    key: "mtn.momo",
    category: "payment",
    label: "MTN Mobile Money",
    vendor: "MTN Group",
    summary:
        "Collects money from a customer through an MTN Mobile Money request-to-pay push, and confirms it from the provider's own callback.",
    capabilities: ["collect", "request_to_pay", "status_callback", "reconcile"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        environmentField,
        {
            key: "subscriptionId",
            label: "Subscription ID",
            type: "string",
            required: true,
            placeholder: "00000000-0000-0000-0000-000000000000",
            help: "The UUID MTN issues for your API subscription.",
        },
        {
            key: "targetEnvironment",
            label: "Target environment",
            type: "enum",
            default: "sandbox",
            required: true,
            options: [
                { value: "sandbox", label: "Sandbox" },
                { value: "production", label: "Production" },
                { value: "staging", label: "Staging" },
            ],
            help: "Which MTN collection environment to call.",
        },
        {
            key: "apiKey",
            label: "API key",
            type: "secret",
            required: true,
            resetsVerification: true,
            help: "The subscription API key from the MTN developer portal.",
        },
        {
            key: "apiUser",
            label: "API user",
            type: "string",
            required: true,
            placeholder: "user@smartbuz",
            help: "The API user MTN issued with the subscription.",
        },
        {
            key: "apiPassword",
            label: "API password",
            type: "secret",
            required: true,
            resetsVerification: true,
        },
        {
            key: "callbackHost",
            label: "Callback host",
            type: "url",
            required: true,
            placeholder: "https://your-domain.com",
            help: "The public base URL MTN will send payment callbacks to. It must be reachable from the internet.",
        },
        {
            key: "currency",
            label: "Currency",
            type: "string",
            default: "UGX",
            required: true,
        },
        webhookSecretField,
    ],
    verification: {
        method: "Request a sandbox collection and confirm the callback arrives.",
        requires: [
            "An MTN MoMo API subscription (sandbox is enough to start)",
            "The subscription ID, API user, API key and API password",
            "A public HTTPS host MTN can call back",
        ],
        docs: "https://developers.mtn.com/docs",
        testDescription:
            "Fetches a token from MTN's collection token endpoint using the saved credentials. A successful token proves the credentials and the network path work; it does not move money.",
    },
    limitations: [
        "Sandbox collection requests do not reach a real handset, so the end-to-end push and callback cannot be proved on the sandbox alone.",
        "The callback host must be reachable from the public internet; a laptop on a local network cannot receive it.",
        "MTN does not settle same-day for every merchant tier, so a cash book will not always agree with the provider on the same day.",
        "The signature scheme MTN uses on its callbacks must be confirmed against MTN's own documentation during live testing; until it is confirmed, a callback that carries no matching signature is refused rather than believed.",
    ],
};

const airtelMoney: AdapterDescriptor = {
    key: "airtel.money",
    category: "payment",
    label: "Airtel Money",
    vendor: "Airtel Africa",
    summary:
        "Collects money from a customer through an Airtel Money collections request, and confirms it from the provider's own callback.",
    capabilities: ["collect", "collections_request", "status_callback", "reconcile"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        environmentField,
        {
            key: "clientId",
            label: "Client ID",
            type: "string",
            required: true,
            help: "The client id from the Airtel Africa business portal.",
        },
        {
            key: "clientSecret",
            label: "Client secret",
            type: "secret",
            required: true,
            resetsVerification: true,
        },
        {
            key: "clientKey",
            label: "Client key",
            type: "string",
            required: true,
            help: "The encryption key issued with the client id.",
        },
        {
            key: "callbackHost",
            label: "Callback host",
            type: "url",
            required: true,
            placeholder: "https://your-domain.com",
            help: "The public base URL Airtel will send transaction notifications to.",
        },
        {
            key: "currency",
            label: "Currency",
            type: "string",
            default: "UGX",
            required: true,
        },
        webhookSecretField,
    ],
    verification: {
        method: "Request a sandbox collections token and confirm it is issued.",
        requires: [
            "An Airtel Africa business account with the collections product enabled",
            "The client id, client secret and client key",
            "A public HTTPS host Airtel can call back",
        ],
        docs: "https://developer.airtel.africa/",
        testDescription:
            "Requests a collections access token from Airtel using the saved credentials. A successful token proves the credentials work; it does not move money.",
    },
    limitations: [
        "The sandbox cannot deliver a push to a real handset, so the customer-facing flow has to be proved against a live test account.",
        "The callback host must be reachable from the public internet.",
        "Airtel's collections product has to be enabled on the account by Airtel itself.",
        "The signature scheme Airtel uses on its callbacks must be confirmed against Airtel's own documentation during live testing.",
    ],
};

const cardGatewayFields: AdapterConfigField[] = [
    environmentField,
    {
        key: "publicKey",
        label: "Public key / secret key",
        type: "secret",
        required: true,
        resetsVerification: true,
        help: "The gateway's secret API key. Never the publishable key — that is public and cannot make calls.",
    },
    webhookSecretField,
];

const flutterwave: AdapterDescriptor = {
    key: "card.flutterwave",
    category: "payment",
    label: "Flutterwave cards",
    vendor: "Flutterwave",
    summary:
        "Takes a card payment through Flutterwave, then confirms it from the provider's own callback before the sale is treated as paid.",
    capabilities: ["collect", "card", "hosted_checkout", "status_callback"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        ...cardGatewayFields,
        {
            key: "callbackHost",
            label: "Callback host",
            type: "url",
            required: true,
            placeholder: "https://your-domain.com",
            help: "The public base URL Flutterwave will call back on.",
        },
        {
            key: "currency",
            label: "Currency",
            type: "string",
            default: "UGX",
            required: true,
        },
    ],
    verification: {
        method: "List the merchant's payment accounts with the saved key.",
        requires: [
            "A Flutterwave merchant account",
            "The secret API key",
            "A public HTTPS host for the callback",
        ],
        docs: "https://docs.flutterwave.com/docs",
        testDescription:
            "Calls Flutterwave's payment-accounts endpoint with the saved secret key. A successful call proves the key and the network path; it does not charge a card.",
    },
    limitations: [
        "A card payment is only confirmed once the provider's callback arrives — a browser redirect alone is never treated as proof of payment.",
        "Card-present and card-not-present rules differ per merchant account and are the merchant's responsibility.",
    ],
};

const paystack: AdapterDescriptor = {
    key: "card.paystack",
    category: "payment",
    label: "Paystack cards",
    vendor: "Paystack",
    summary:
        "Takes a card payment through Paystack, then confirms it from the provider's own callback before the sale is treated as paid.",
    capabilities: ["collect", "card", "hosted_checkout", "status_callback"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        ...cardGatewayFields,
        {
            key: "callbackHost",
            label: "Callback host",
            type: "url",
            required: true,
            placeholder: "https://your-domain.com",
        },
        {
            key: "currency",
            label: "Currency",
            type: "string",
            default: "UGX",
            required: true,
        },
    ],
    verification: {
        method: "List the merchant's transaction splits or banks with the saved key.",
        requires: [
            "A Paystack merchant account",
            "The secret API key",
            "A public HTTPS host for the callback",
        ],
        docs: "https://paystack.com/docs/api",
        testDescription:
            "Calls Paystack's transaction-list endpoint with the saved secret key. A successful call proves the key and the network path; it does not charge a card.",
    },
    limitations: [
        "A card payment is only confirmed once the provider's callback arrives.",
        "Paystack settles in the currency it was set up in; a business trading in a currency it cannot settle in will see a conversion.",
    ],
};

const stripe: AdapterDescriptor = {
    key: "card.stripe",
    category: "payment",
    label: "Stripe cards",
    vendor: "Stripe",
    summary:
        "Takes a card payment through Stripe, then confirms it from the provider's own callback before the sale is treated as paid.",
    capabilities: ["collect", "card", "hosted_checkout", "status_callback"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        ...cardGatewayFields,
        {
            key: "callbackHost",
            label: "Callback host",
            type: "url",
            required: true,
            placeholder: "https://your-domain.com",
        },
        {
            key: "currency",
            label: "Currency",
            type: "string",
            default: "UGX",
            required: true,
        },
    ],
    verification: {
        method: "List the merchant's balance with the saved key.",
        requires: [
            "A Stripe account with payments enabled",
            "The secret API key",
            "A public HTTPS host for the callback",
        ],
        docs: "https://docs.stripe.com/api",
        testDescription:
            "Calls Stripe's balance endpoint with the saved secret key. A successful call proves the key and the network path; it does not charge a card.",
    },
    limitations: [
        "A card payment is only confirmed once the provider's callback arrives.",
        "Stripe is not available in every country a SMARTBUZ business trades in; check the merchant's country before enabling it.",
    ],
};

const bankStatement: AdapterDescriptor = {
    key: "bank.statement",
    category: "payment",
    label: "Bank statement import",
    vendor: "Any bank",
    summary:
        "Imports a bank or mobile-money statement — a CSV, or a pasted table — and matches each line against the payments the books recorded.",
    capabilities: ["reconcile", "statement_import", "matching"],
    runsOn: "server",
    supportsLiveTest: false,
    configFields: [
        {
            key: "providerName",
            label: "Provider name",
            type: "string",
            required: true,
            placeholder: "Stanbic Bank",
            help: "Shown on the reconciliation so the operator knows which statement this is.",
        },
        {
            key: "accountLabel",
            label: "Account label",
            type: "string",
            required: true,
            placeholder: "Operations account",
            help: "Shown against each imported line.",
        },
        {
            key: "dateColumn",
            label: "Date column",
            type: "string",
            default: "Date",
            required: true,
        },
        {
            key: "referenceColumn",
            label: "Reference column",
            type: "string",
            default: "Reference",
            required: true,
        },
        {
            key: "amountColumn",
            label: "Amount column",
            type: "string",
            default: "Amount",
            required: true,
        },
        {
            key: "descriptionColumn",
            label: "Description column",
            type: "string",
            default: "Description",
            required: false,
        },
        {
            key: "separator",
            label: "Separator",
            type: "enum",
            default: "comma",
            required: true,
            options: [
                { value: "comma", label: "Comma" },
                { value: "semicolon", label: "Semicolon" },
                { value: "tab", label: "Tab" },
            ],
        },
    ],
    verification: {
        method: "Import the business's own statement and check the match rate.",
        requires: [
            "A statement exported from the business's bank or mobile-money account",
            "The column names used in that export",
        ],
        testDescription:
            "This adapter has no live test of its own: it reads a file rather than talking to a provider. Its correctness is proved by importing a real statement and checking that every line is either matched or listed as unmatched — never by a green tick.",
    },
    limitations: [
        "Every bank exports statements differently, so the column names have to be set for the bank actually used.",
        "Only lines that carry a reference the books also carry can be matched automatically; the rest are listed for a person to resolve.",
        "A statement is read, never edited — the books are changed by the reconciliation, not by the import.",
    ],
};

const bankTransfer: AdapterDescriptor = {
    key: "bank.transfer",
    category: "payment",
    label: "Bank transfer (manual)",
    vendor: "Any bank",
    summary:
        "Records a payment a customer made by bank transfer, and settles it only once the money appears on a statement.",
    capabilities: ["record", "pending_settlement", "reconcile"],
    runsOn: "server",
    supportsLiveTest: false,
    configFields: [
        {
            key: "bankName",
            label: "Bank name",
            type: "string",
            required: true,
        },
        {
            key: "accountNumber",
            label: "Account number",
            type: "string",
            required: true,
        },
        {
            key: "accountName",
            label: "Account name",
            type: "string",
            required: true,
        },
        {
            key: "settlementDays",
            label: "Expected settlement (days)",
            type: "number",
            default: 2,
            help: "How long the bank normally takes to pay the money in. Used to chase the customer if it does not arrive.",
        },
    ],
    verification: {
        method: "Confirm the account details with the bank and settle one real transfer.",
        requires: ["The business's own bank account details"],
        testDescription:
            "This adapter records rather than calls, so it has no live test. It is proved by settling one real transfer against a statement.",
    },
    limitations: [
        "A bank transfer is never confirmed by SMARTBUZ alone — it is confirmed by a statement line.",
        "The customer must quote the right reference or the payment cannot be matched automatically.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Messaging
 * ──────────────────────────────────────────────────────────────────────── */

const smsGeneric: AdapterDescriptor = {
    key: "sms.generic",
    category: "messaging",
    label: "SMS (any HTTP gateway)",
    channel: "sms",
    vendor: "Bring your own",
    summary:
        "Sends SMS through any provider that accepts an HTTP request, using a template the business fills in.",
    capabilities: ["sms", "send"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        environmentField,
        {
            key: "endpoint",
            label: "Send endpoint",
            type: "url",
            required: true,
            placeholder: "https://api.your-gateway.com/send",
            help: "The URL the SMS request is posted to.",
        },
        {
            key: "method",
            label: "HTTP method",
            type: "enum",
            default: "POST",
            required: true,
            options: [
                { value: "POST", label: "POST" },
                { value: "GET", label: "GET" },
            ],
        },
        {
            key: "authHeader",
            label: "Authorization header",
            type: "string",
            default: "Bearer",
            required: false,
            help: "The scheme used in the Authorization header. Leave blank to send no authorization header at all.",
        },
        {
            key: "apiKey",
            label: "API key",
            type: "secret",
            required: true,
            resetsVerification: true,
        },
        {
            key: "bodyTemplate",
            label: "Request body template",
            type: "string",
            required: true,
            default: '{"to":"{{to}}","message":"{{body}}"}',
            help: "The JSON body to send. {{to}}, {{body}}, {{reference}} and {{business}} are replaced before sending.",
        },
        {
            key: "senderId",
            label: "Sender ID",
            type: "string",
            required: false,
            help: "The sender the customer sees on their handset, when the provider supports one.",
        },
    ],
    verification: {
        method: "Send one SMS to a number the business controls and read it.",
        requires: [
            "An account with an HTTP SMS gateway",
            "The gateway's send endpoint, API key and body format",
            "A mobile number the business controls, for the test",
        ],
        testDescription:
            "Sends a real SMS to the test number the business provides, through the configured endpoint, and records the provider's response.",
    },
    limitations: [
        "The gateway decides which numbers may be sent to and what it costs; SMARTBUZ cannot see its pricing.",
        "Delivery is not guaranteed by the network. A message marked sent means accepted by the gateway, not read by the customer.",
    ],
};

const smsAfricasTalking: AdapterDescriptor = {
    key: "sms.africasTalking",
    category: "messaging",
    label: "Africa's Talking SMS",
    channel: "sms",
    vendor: "Africa's Talking",
    summary:
        "Sends SMS through Africa's Talking, with delivery receipts reported back to SMARTBUZ.",
    capabilities: ["sms", "send", "delivery_receipt"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        environmentField,
        {
            key: "username",
            label: "Username",
            type: "string",
            required: true,
        },
        {
            key: "apiKey",
            label: "API key",
            type: "secret",
            required: true,
            resetsVerification: true,
        },
        {
            key: "senderId",
            label: "Sender ID",
            type: "string",
            required: false,
            help: "The alphanumeric sender shown on the handset, when the account has one approved.",
        },
        {
            key: "callbackHost",
            label: "Callback host",
            type: "url",
            required: false,
            placeholder: "https://your-domain.com",
            help: "Where delivery receipts are sent. Without it, delivery is not tracked.",
        },
    ],
    verification: {
        method: "Send one SMS to a number the business controls and read it.",
        requires: [
            "An Africa's Talking account with the SMS product enabled",
            "The account username and API key",
            "A mobile number the business controls, for the test",
        ],
        docs: "https://developers.africastalking.com/docs/sms/",
        testDescription:
            "Sends a real SMS through Africa's Talking to the test number and records the gateway's response.",
    },
    limitations: [
        "Delivery receipts need a public callback host; without one, a sent message stays unconfirmed.",
        "Sender IDs have to be approved by Africa's Talking before they appear on a handset.",
    ],
};

const whatsappCloud: AdapterDescriptor = {
    key: "whatsapp.cloud",
    category: "messaging",
    label: "WhatsApp (Meta Cloud API)",
    channel: "whatsapp",
    vendor: "Meta",
    summary:
        "Sends WhatsApp messages through Meta's Cloud API from a business phone number, with template messages where WhatsApp requires one.",
    capabilities: ["whatsapp", "send", "template"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        environmentField,
        {
            key: "phoneNumberId",
            label: "Phone number ID",
            type: "string",
            required: true,
            help: "The id of the business phone number messages are sent from.",
        },
        {
            key: "accessToken",
            label: "Permanent access token",
            type: "secret",
            required: true,
            resetsVerification: true,
            help: "The permanent token from the WhatsApp Business account. A temporary token expires and is not usable here.",
        },
        {
            key: "wabaId",
            label: "WhatsApp Business Account ID",
            type: "string",
            required: false,
        },
        {
            key: "defaultCountryCode",
            label: "Default country code",
            type: "string",
            default: "256",
            required: true,
            help: "Used when a number is saved without one.",
        },
    ],
    verification: {
        method: "Send one WhatsApp message to a number the business controls and read it.",
        requires: [
            "A Meta Business account with the WhatsApp Business API enabled",
            "A business phone number and its phone number id",
            "A permanent access token",
            "An approved message template, for any message sent outside the 24-hour customer service window",
        ],
        docs: "https://developers.facebook.com/docs/whatsapp/cloud-api",
        testDescription:
            "Calls Meta's phone-numbers endpoint with the saved token. A successful call proves the token and the number; it does not send a message.",
    },
    limitations: [
        "Outside the 24-hour customer service window, WhatsApp only accepts messages built from an approved template.",
        "Templates have to be reviewed and approved by Meta, which takes time.",
        "Conversation charges apply per message and are set by Meta's pricing for the business's country.",
    ],
};

const emailResend: AdapterDescriptor = {
    key: "email.resend",
    category: "messaging",
    label: "Email (Resend)",
    channel: "email",
    vendor: "Resend",
    summary:
        "Sends email through Resend — receipts, reminders and statements — from the business's own verified domain.",
    capabilities: ["email", "send", "attachment"],
    runsOn: "server",
    supportsLiveTest: true,
    configFields: [
        environmentField,
        {
            key: "apiKey",
            label: "API key",
            type: "secret",
            required: true,
            resetsVerification: true,
        },
        {
            key: "fromAddress",
            label: "From address",
            type: "string",
            required: true,
            placeholder: "receipts@your-domain.com",
            help: "Must be on a domain you have verified with Resend.",
        },
        {
            key: "replyTo",
            label: "Reply-to address",
            type: "string",
            required: false,
        },
    ],
    verification: {
        method: "Send a test email to an address the business controls and read it.",
        requires: [
            "A Resend account with a verified sending domain",
            "The API key",
            "An address on the verified domain to send from",
        ],
        docs: "https://resend.com/docs",
        testDescription:
            "Calls Resend's domains endpoint with the saved API key. A successful call proves the key and the account; it does not send an email.",
    },
    limitations: [
        "The sending domain has to be verified with Resend before mail will be delivered.",
        "An email is not a receipt the customer can rely on for a cash sale; it is a copy of one.",
    ],
};

/* ────────────────────────────────────────────────────────────────────────
 * Hardware
 * ──────────────────────────────────────────────────────────────────────── */

const barcodeScanner: HardwareDescriptor = {
    key: "hardware.barcode.wedge",
    kind: "barcode_scanner",
    label: "Barcode scanner",
    vendor: "Any HID keyboard-wedge scanner",
    summary:
        "Reads a barcode from a scanner that behaves like a keyboard, and looks the product up by its barcode.",
    transport: "keyboard_wedge",
    requirements: [
        "A scanner in HID keyboard-wedge mode — the default on most USB scanners",
        "A product barcode recorded against the product",
    ],
    limitations: [
        "A keyboard-wedge scanner types into whatever has focus, so the till must watch for its input deliberately.",
        "Only products with a barcode recorded can be found by scanning; the rest are found by name.",
    ],
    verification: {
        method: "Scan a product in the till and confirm the right product comes up.",
        requires: [
            "A HID keyboard-wedge scanner",
            "A barcode recorded against at least one product",
            "The product's barcode printed on it",
        ],
        testDescription:
            "The scanner is proved by scanning a real barcode in the browser and confirming that the right product was matched.",
    },
};

const thermalPrinter: HardwareDescriptor = {
    key: "hardware.printer.escpos",
    kind: "thermal_printer",
    label: "Thermal receipt printer",
    vendor: "Epson, Xprinter, Zjiang and other ESC/POS printers",
    summary:
        "Prints receipts straight to an ESC/POS thermal printer over a serial or USB connection.",
    transport: "web_serial",
    requirements: [
        "An ESC/POS thermal printer",
        "A browser with the Web Serial API — Chrome or Edge on a desktop",
        "The printer connected before the receipt is printed",
    ],
    limitations: [
        "Web Serial is not available in Safari or Firefox, and not on iOS at all.",
        "The browser must be granted permission to use the serial port, and that permission does not survive a restart in some builds.",
        "Only 80mm and 58mm paper widths are supported.",
    ],
    verification: {
        method: "Print a test receipt and read it off the paper.",
        requires: [
            "An ESC/POS thermal printer connected to the till",
            "A desktop Chrome or Edge browser",
        ],
        testDescription:
            "Sends a short test receipt to the printer and reports what the browser's serial API reported back.",
    },
};

const cashDrawer: HardwareDescriptor = {
    key: "hardware.drawer.escpos",
    kind: "cash_drawer",
    label: "Cash drawer",
    vendor: "Any drawer wired to an ESC/POS printer",
    summary:
        "Opens the cash drawer through the receipt printer's pulse output, at the end of a sale or on demand.",
    transport: "web_serial",
    requirements: [
        "A cash drawer connected to the printer's drawer output",
        "A compatible ESC/POS printer",
    ],
    limitations: [
        "Most drawers report their status on a serial pin, which a browser cannot read — so SMARTBUZ cannot confirm that the drawer physically opened.",
        "The drawer only opens when a printer is connected and a print job is sent.",
    ],
    verification: {
        method: "Open the drawer and confirm it opens.",
        requires: [
            "A cash drawer connected to a compatible ESC/POS printer",
        ],
        testDescription:
            "Sends the drawer pulse and asks the operator whether the drawer opened. SMARTBUZ cannot read the drawer's own status line, so this test is confirmed by a person, not by the software.",
    },
};

const weighingScale: HardwareDescriptor = {
    key: "hardware.scale.serial",
    kind: "weighing_scale",
    label: "Weighing scale",
    vendor: "Any serial or HTTP scale",
    summary:
        "Reads a weight from a scale — over a serial line or over the network — and puts it into the sale.",
    transport: "web_serial",
    requirements: [
        "A scale that reports a stable weight over a serial line or HTTP",
        "The scale's configured precision and unit",
    ],
    limitations: [
        "A browser cannot read a USB scale without the Web Serial API, which means Chrome or Edge on a desktop.",
        "The scale's unit has to be configured correctly, or the price per unit will be wrong — SMARTBUZ cannot detect a mis-set scale.",
        "The reading is only taken when the operator asks for it, so a drifting scale is caught by the operator, not by the software.",
    ],
    verification: {
        method: "Put a known weight on the scale and compare it with the reading.",
        requires: [
            "A scale connected to the till",
            "A weight the business knows the value of",
        ],
        testDescription:
            "Reads the scale and shows the reading next to what the operator entered, so the two can be compared by eye.",
    },
};

/* ────────────────────────────────────────────────────────────────────────
 * The catalogues
 * ──────────────────────────────────────────────────────────────────────── */

/** Every adapter in SMARTBUZ. */
export const ADAPTERS: AdapterDescriptor[] = [
    mtnMoMo,
    airtelMoney,
    flutterwave,
    paystack,
    stripe,
    bankStatement,
    bankTransfer,
    smsGeneric,
    smsAfricasTalking,
    whatsappCloud,
    emailResend,
];

/** Every piece of hardware the till knows about. */
export const HARDWARE: HardwareDescriptor[] = [
    barcodeScanner,
    thermalPrinter,
    cashDrawer,
    weighingScale,
];

const ADAPTERS_BY_KEY: Record<string, AdapterDescriptor> = Object.fromEntries(
    ADAPTERS.map((a) => [a.key, a])
);

const HARDWARE_BY_KEY: Record<string, HardwareDescriptor> = Object.fromEntries(
    HARDWARE.map((h) => [h.key, h])
);

/** The adapter with this key, or undefined. */
export function findAdapter(key: string): AdapterDescriptor | undefined {
    return ADAPTERS_BY_KEY[key];
}

/** The adapter with this key, or a thrown error. */
export function requireAdapter(key: string): AdapterDescriptor {
    const adapter = ADAPTERS_BY_KEY[key];
    if (!adapter) {
        throw new ConvexError(`Unknown integration adapter: ${key}`);
    }
    return adapter;
}

/** The hardware with this key, or undefined. */
export function findHardware(key: string): HardwareDescriptor | undefined {
    return HARDWARE_BY_KEY[key];
}

/** Every adapter in a category. */
export function adaptersByCategory(
    category: AdapterCategory
): AdapterDescriptor[] {
    return ADAPTERS.filter((a) => a.category === category);
}

/** Every adapter that does one of these things. */
export function adaptersWithCapability(capability: string): AdapterDescriptor[] {
    return ADAPTERS.filter((a) => a.capabilities.includes(capability));
}

/** Every piece of hardware of one kind. */
export function hardwareByKind(kind: HardwareKind): HardwareDescriptor[] {
    return HARDWARE.filter((h) => h.kind === kind);
}

/**
 * The configuration fields an adapter needs, as a lookup by key.
 *
 * Used by the configuration screen to render a form without knowing which
 * adapter it is showing.
 */
export function configFieldMap(
    key: string
): Record<string, AdapterConfigField> {
    const adapter = findAdapter(key);
    if (!adapter) return {};
    return Object.fromEntries(adapter.configFields.map((f) => [f.key, f]));
}

/**
 * The secret fields of an adapter — the ones that are encrypted and never
 * sent back to the browser.
 */
export function secretFieldKeys(key: string): string[] {
    const adapter = findAdapter(key);
    if (!adapter) return [];
    return adapter.configFields
        .filter((f) => f.type === "secret")
        .map((f) => f.key);
}

/**
 * The fields that must be filled in before the adapter can be used.
 */
export function requiredFieldKeys(key: string): string[] {
    const adapter = findAdapter(key);
    if (!adapter) return [];
    return adapter.configFields.filter((f) => f.required).map((f) => f.key);
}
