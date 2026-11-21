/**
 * SMARTBUZ — Phase 9, the integrations.
 *
 * The rules that decide whether an integration is *allowed* to do
 * something, and the rules that decide what a customer is told.
 *
 * These are the rules that keep the honesty promise in Phase 9: an
 * integration that has not been proved cannot move money, a payment is
 * only confirmed by the provider, and a prescription that could not be
 * filled in full says so.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
    ADAPTERS,
    HARDWARE,
    configFieldMap,
    findAdapter,
    findHardware,
    requiredFieldKeys,
    secretFieldKeys,
} from "../convex/integrations/registry";
import {
    isVerified,
    verificationLabel,
} from "../convex/integrations/types";
import {
    mapWebhookStatus,
    findReference,
    verifyWebhookSignature,
} from "../convex/integrations/webhooks";
import { hmacSha256Hex } from "../convex/crypto";
import {
    findTemplate,
    formatItems,
    formatMoney,
    overdueLine,
    balanceLine,
    renderMessage,
    renderTemplate,
    MESSAGE_TEMPLATES,
} from "../convex/integrations/templates";
import {
    findMatch,
    parseAmount,
    parseDate,
    parseStatement,
    separatorFor,
    splitLine,
} from "../convex/integrations/reconciliation";
import {
    INDUSTRY_PACKAGES,
    allPackages,
    defaultFeatures,
    defaultSettings,
    findPackage,
    isValidSetting,
} from "../convex/packages/registry";
import {
    calculateWeightedTotal,
    unitPriceFromPack,
} from "../convex/packages/supermarket";
import {
    allocateBatches,
    expiryStatus,
} from "../convex/packages/pharmacy";
import { resolvePrice } from "../convex/packages/wholesaler";
import { canTransition } from "../convex/packages/restaurant";
import {
    normaliseBarcode,
    looksLikeBarcode,
} from "../src/lib/hardware/barcode";
import { parseScaleLine } from "../src/lib/hardware/scale";
import {
    buildDrawerPulse,
    drawerCapabilities,
} from "../src/lib/hardware/drawer";
import {
    adapterKeyForNetwork,
    detectCarrier,
    formatUgandaPhone,
} from "../src/lib/mobile-money";

/* ────────────────────────────────────────────────────────────────────────
 * The catalogue
 * ──────────────────────────────────────────────────────────────────────── */

describe("the adapter catalogue", () => {
    it("describes every adapter with the same shape", () => {
        for (const adapter of ADAPTERS) {
            assert.ok(adapter.key, "every adapter has a key");
            assert.ok(adapter.label, `${adapter.key} has a label`);
            assert.ok(adapter.summary, `${adapter.key} has a summary`);
            assert.ok(adapter.vendor, `${adapter.key} has a vendor`);
            assert.ok(
                adapter.configFields.length > 0,
                `${adapter.key} declares the fields it needs`
            );
            assert.ok(
                adapter.verification.method,
                `${adapter.key} says how it is proved`
            );
            assert.ok(
                adapter.verification.testDescription.length > 0,
                `${adapter.key} says what its test does`
            );
        }
    });

    it("never gives two adapters the same key", () => {
        const keys = ADAPTERS.map((a) => a.key);
        assert.equal(new Set(keys).size, keys.length);
    });

    it("ships every adapter unverified — none of them may claim to work", () => {
        // The catalogue carries no status at all: status lives per
        // business, and it starts at "unverified" until a live test
        // passes. There is no way to declare an adapter working from the
        // catalogue.
        for (const adapter of ADAPTERS) {
            assert.equal(
                (adapter as unknown as { verificationStatus?: string })
                    .verificationStatus,
                undefined,
                `${adapter.key} must not carry a verification status`
            );
        }
    });

    it("states the limits of every adapter", () => {
        for (const adapter of ADAPTERS) {
            assert.ok(
                adapter.limitations && adapter.limitations.length > 0,
                `${adapter.key} says what it does not do`
            );
        }
    });

    it("covers the payments and messaging the phase asked for", () => {
        const keys = ADAPTERS.map((a) => a.key);
        for (const required of [
            "mtn.momo",
            "airtel.money",
            "card.flutterwave",
            "card.paystack",
            "card.stripe",
            "bank.statement",
            "sms.generic",
            "sms.africasTalking",
            "whatsapp.cloud",
            "email.resend",
        ]) {
            assert.ok(keys.includes(required), `${required} must be in the catalogue`);
        }
    });

    it("covers the hardware the phase asked for", () => {
        const kinds = HARDWARE.map((h) => h.kind);
        for (const required of [
            "barcode_scanner",
            "thermal_printer",
            "cash_drawer",
            "weighing_scale",
        ] as const) {
            assert.ok(kinds.includes(required), `${required} must be in the catalogue`);
        }
    });

    it("keeps the secrets out of the plain configuration", () => {
        for (const adapter of ADAPTERS) {
            const secrets = secretFieldKeys(adapter.key);
            for (const key of secrets) {
                assert.notEqual(
                    configFieldMap(adapter.key)[key]?.type,
                    "string",
                    `${adapter.key}.${key} must be a secret field`
                );
            }
        }
    });

    it("knows which fields an adapter cannot work without", () => {
        const required = requiredFieldKeys("mtn.momo");
        assert.ok(required.includes("subscriptionId"));
        assert.ok(required.includes("apiKey"));
    });

    it("finds an adapter by key and refuses an unknown one", () => {
        assert.ok(findAdapter("mtn.momo"));
        assert.equal(findAdapter("not.a.real.adapter"), undefined);
    });

    it("finds hardware by key", () => {
        assert.ok(findHardware("hardware.printer.escpos"));
        assert.equal(findHardware("hardware.microwave"), undefined);
    });
});

describe("what a verification status says", () => {
    it("only treats 'verified' as proved", () => {
        assert.equal(isVerified("verified"), true);
        for (const status of ["unverified", "configured", "failed", undefined]) {
            assert.equal(isVerified(status as never), false);
        }
    });

    it("never lets an unverified adapter sound working", () => {
        assert.match(verificationLabel("unverified"), /not verified/i);
        assert.match(verificationLabel("configured"), /never tested/i);
        assert.match(verificationLabel("failed"), /failed/i);
        assert.match(verificationLabel("verified"), /verified against the live provider/i);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Webhooks
 * ──────────────────────────────────────────────────────────────────────── */

describe("the payment callback", () => {
    it("finds our reference wherever the provider put it", () => {
        assert.equal(
            findReference({ reference: "SBZ-PAY-abc-123" }),
            "SBZ-PAY-abc-123"
        );
        assert.equal(
            findReference({ data: { externalId: "SBZ-PAY-xyz" } }),
            "SBZ-PAY-xyz"
        );
        assert.equal(
            findReference({ anything: { deeper: { tx_ref: "SBZ-PAY-999" } } }),
            "SBZ-PAY-999"
        );
    });

    it("finds nothing when there is no reference", () => {
        assert.equal(findReference({ status: "SUCCESSFUL" }), undefined);
        assert.equal(findReference("nothing here"), undefined);
        assert.equal(findReference(null), undefined);
    });

    it("only calls a payment successful when the provider says so", () => {
        for (const value of ["SUCCESSFUL", "SUCCESS", "COMPLETED", "CAPTURED", "PAID"]) {
            assert.equal(mapWebhookStatus(value), "succeeded");
        }
        for (const value of ["FAILED", "DECLINED", "REVERSED", "CANCELLED", "EXPIRED"]) {
            assert.equal(mapWebhookStatus(value), "failed");
        }
    });

    it("keeps an unrecognised status pending rather than guessing", () => {
        // "We did not understand this" is not a failure, and it is
        // certainly not a payment.
        assert.equal(mapWebhookStatus("SOMETHING_NEW"), "pending");
        assert.equal(mapWebhookStatus(undefined), "pending");
        assert.equal(mapWebhookStatus(""), "pending");
    });

    it("refuses a callback whose signature does not match", async () => {
        const body = JSON.stringify({ reference: "SBZ-PAY-1" });
        const signature = await hmacSha256Hex("s3cret", body);

        const good = await verifyWebhookSignature(body, signature, "s3cret");
        assert.equal(good.ok, true);

        const bad = await verifyWebhookSignature(body, "deadbeef", "s3cret");
        assert.equal(bad.ok, false);
        assert.match(bad.reason ?? "", /signature/i);
    });

    it("refuses a callback with no signature when a secret is set", async () => {
        const check = await verifyWebhookSignature("{}", null, "s3cret");
        assert.equal(check.ok, false);
    });

    it("refuses a callback when there is no secret to check it against", async () => {
        // A callback with no secret to check it against cannot be told
        // apart from a forged one, so it is refused. The reference is not a
        // secret — it is printed on the receipt and sent to the provider in
        // clear — so accepting the callback on the reference alone would
        // have meant accepting anybody's callback.
        const check = await verifyWebhookSignature("{}", null, undefined);
        assert.equal(check.ok, false);
        assert.match(check.reason ?? "", /webhook secret/i);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Messages
 * ──────────────────────────────────────────────────────────────────────── */

describe("message templates", () => {
    it("fills in what it knows", () => {
        const template = findTemplate("sale.receipt.sms");
        assert.ok(template);
        const rendered = renderMessage(template, {
            businessName: "Acme",
            invoiceNumber: "INV-1",
            total: "UGX 5,000",
            paymentMode: "Cash",
            balanceLine: "",
        });
        assert.match(rendered.body, /Acme/);
        assert.match(rendered.body, /INV-1/);
        assert.deepEqual(rendered.missing, []);
    });

    it("leaves an unknown value visible and reports it", () => {
        // "undefined" on a receipt looks broken; a visible {{name}} is
        // honest, and the caller is told which one was missing.
        const rendered = renderTemplate("Hello {{name}}, you owe {{amount}}", {
            name: "Jo",
        });
        assert.equal(rendered.text, "Hello Jo, you owe {{amount}}");
        assert.deepEqual(rendered.missing, ["amount"]);
    });

    it("gives every template a channel and a set of variables", () => {
        for (const template of MESSAGE_TEMPLATES) {
            assert.ok(
                ["sms", "whatsapp", "email"].includes(template.channel),
                `${template.key} has a channel`
            );
            assert.ok(
                template.variables.length > 0,
                `${template.key} says what it needs`
            );
        }
    });

    it("only mentions a balance when there is one", () => {
        assert.equal(balanceLine(0), "");
        assert.equal(balanceLine(undefined), "");
        assert.equal(balanceLine(-5), "");
        assert.match(balanceLine(2500), /2,500/);
    });

    it("only mentions overdue days when there are some", () => {
        assert.equal(overdueLine(0), "");
        assert.equal(overdueLine(undefined), "");
        assert.match(overdueLine(1), /1 day/);
        assert.match(overdueLine(5), /5 days/);
    });

    it("writes money so it can be read on a phone", () => {
        assert.equal(formatMoney(12500), "UGX 12,500");
        assert.equal(formatMoney(0), "UGX 0");
        assert.equal(formatMoney(Number.NaN), "UGX 0");
    });

    it("lists the items of a sale one to a line", () => {
        const text = formatItems([
            { name: "Sugar", quantity: 2, price: 5000 },
            { name: "Tea", quantity: 1, price: 8000 },
        ]);
        assert.equal(text.split("\n").length, 2);
        assert.match(text, /2 x Sugar/);
        assert.match(text, /10,000/);
    });

    it("says so when a sale had no items", () => {
        assert.match(formatItems([]), /No items/);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Reconciliation
 * ──────────────────────────────────────────────────────────────────────── */

describe("reading a statement", () => {
    it("splits a quoted field that holds the separator", () => {
        const fields = splitLine('2026-03-01,REF-1,"Beans, 1kg",5000', ",");
        assert.equal(fields.length, 4);
        assert.equal(fields[2], "Beans, 1kg");
    });

    it("reads the money a statement writes", () => {
        assert.equal(parseAmount("1,250.00"), 1250);
        assert.equal(parseAmount("1250"), 1250);
        assert.equal(parseAmount("UGX 1,250"), 1250);
        assert.equal(parseAmount("(250)"), -250);
        assert.equal(parseAmount("-250"), -250);
        assert.equal(parseAmount("1.250,00"), 1250);
    });

    it("refuses money it cannot read rather than guessing", () => {
        assert.equal(parseAmount(""), null);
        assert.equal(parseAmount("n/a"), null);
        assert.equal(parseAmount("--"), null);
    });

    it("reads the dates a statement writes", () => {
        assert.equal(parseDate("2026-03-04"), "2026-03-04");
        assert.equal(parseDate("04/03/2026"), "2026-03-04");
        assert.equal(parseDate("04-Mar-2026"), "2026-03-04");
        assert.equal(parseDate("not a date"), null);
    });

    it("knows which separator the statement uses", () => {
        assert.equal(separatorFor("comma"), ",");
        assert.equal(separatorFor("semicolon"), ";");
        assert.equal(separatorFor("tab"), "\t");
        assert.equal(separatorFor(undefined), ",");
    });

    it("reads a statement with a header row", () => {
        const csv = [
            "Date,Reference,Description,Amount",
            "2026-03-01,REF-1,Sale 1001,5000",
            "2026-03-02,REF-2,Sale 1002,7500",
        ].join("\n");

        const parsed = parseStatement(
            csv,
            {
                date: "Date",
                reference: "Reference",
                amount: "Amount",
                description: "Description",
            },
            ","
        );

        assert.equal(parsed.headerSkipped, true);
        assert.equal(parsed.lines.length, 2);
        assert.deepEqual(parsed.warnings, []);
        assert.equal(parsed.lines[0].reference, "REF-1");
        assert.equal(parsed.lines[1].amount, 7500);
    });

    it("reports the rows it could not read instead of dropping them", () => {
        const csv = [
            "Date,Reference,Amount",
            "2026-03-01,REF-1,5000",
            "not-a-date,REF-2,7500",
        ].join("\n");

        const parsed = parseStatement(
            csv,
            { date: "Date", reference: "Reference", amount: "Amount" },
            ","
        );

        assert.equal(parsed.lines.length, 1);
        assert.equal(parsed.warnings.length, 1);
        // The warning names the line in the file, header included.
        assert.match(parsed.warnings[0], /Row 3/);
    });

    it("reads a statement with no header row", () => {
        const csv = ["2026-03-01,REF-1,5000", "2026-03-02,REF-2,7500"].join("\n");
        const parsed = parseStatement(
            csv,
            { date: "Date", reference: "Reference", amount: "Amount" },
            ","
        );
        assert.equal(parsed.lines.length, 2);
        assert.equal(parsed.headerSkipped, false);
    });
});

describe("matching a statement line to a payment", () => {
    const payments = [
        {
            _id: "payments_1" as never,
            amount: 5000,
            date: "2026-03-01",
            reference: "REF-1",
        },
        {
            _id: "payments_2" as never,
            amount: 7500,
            date: "2026-03-02",
            reference: "REF-2",
        },
    ];

    it("matches on the reference", () => {
        const match = findMatch(
            { date: "2026-03-01", reference: "REF-1", amount: 5000 },
            payments
        );
        assert.equal(match?.paymentId, "payments_1");
        assert.equal(match?.matchType, "exact");
    });

    it("matches on the amount and the day", () => {
        const match = findMatch(
            { date: "2026-03-02", reference: "UNKNOWN", amount: 7500 },
            payments
        );
        assert.equal(match?.paymentId, "payments_2");
        assert.equal(match?.matchType, "amount_and_date");
    });

    it("refuses to guess when two payments could fit", () => {
        const ambiguous = [
            {
                _id: "payments_a" as never,
                amount: 5000,
                date: "2026-03-01",
                reference: "A",
            },
            {
                _id: "payments_b" as never,
                amount: 5000,
                date: "2026-03-01",
                reference: "B",
            },
        ];

        const match = findMatch(
            { date: "2026-03-01", reference: "UNKNOWN", amount: 5000 },
            ambiguous
        );

        // A wrong match would settle the wrong payment.
        assert.equal(match, null);
    });

    it("matches a line that is a little smaller because of a fee", () => {
        const withFee = [
            {
                _id: "payments_3" as never,
                amount: 5000,
                date: "2026-03-01",
                reference: "REF-3",
            },
        ];
        const match = findMatch(
            { date: "2026-03-01", reference: "OTHER", amount: 4900 },
            withFee
        );
        assert.equal(match?.paymentId, "payments_3");
    });

    it("leaves a line unmatched when nothing fits", () => {
        const match = findMatch(
            { date: "2026-03-01", reference: "NONE", amount: 999 },
            payments
        );
        assert.equal(match, null);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Industry packages
 * ──────────────────────────────────────────────────────────────────────── */

describe("the industry packages", () => {
    it("covers the four industries the phase asked for", () => {
        const keys = allPackages().map((p) => p.key);
        for (const required of [
            "supermarket",
            "restaurant",
            "pharmacy",
            "wholesaler",
        ]) {
            assert.ok(keys.includes(required), `${required} must be a package`);
        }
    });

    it("gives every package features, settings and limits", () => {
        for (const pkg of INDUSTRY_PACKAGES) {
            assert.ok(pkg.features.length > 0, `${pkg.key} has features`);
            assert.ok(pkg.limitations.length > 0, `${pkg.key} says what it does not do`);
            assert.ok(pkg.summary.length > 0, `${pkg.key} has a summary`);
        }
    });

    it("gives every feature a name and a default", () => {
        for (const pkg of INDUSTRY_PACKAGES) {
            for (const feature of pkg.features) {
                assert.ok(feature.label, `${pkg.key}.${feature.key} has a label`);
                assert.ok(
                    feature.summary,
                    `${pkg.key}.${feature.key} has a summary`
                );
                assert.equal(
                    typeof feature.defaultEnabled,
                    "boolean",
                    `${pkg.key}.${feature.key} says whether it is on by default`
                );
            }
        }
    });

    it("refuses a setting the package does not declare", () => {
        const pkg = findPackage("supermarket");
        assert.ok(pkg);
        assert.equal(isValidSetting(pkg, "notASetting", "x"), false);
        assert.equal(isValidSetting(pkg, "defaultUnit", "kg"), true);
        assert.equal(isValidSetting(pkg, "defaultUnit", "furlongs"), false);
        assert.equal(isValidSetting(pkg, "allowFractionalQuantity", true), true);
        assert.equal(isValidSetting(pkg, "allowFractionalQuantity", "yes"), false);
    });

    it("seeds a package with its defaults", () => {
        const pkg = findPackage("pharmacy");
        assert.ok(pkg);
        const settings = defaultSettings(pkg);
        assert.equal(settings.expiryWarningDays, 90);
        assert.equal(settings.blockExpiredStock, true);
        assert.ok(defaultFeatures(pkg).includes("batch_tracking"));
    });
});

describe("the supermarket package", () => {
    it("prices a weighed line", () => {
        assert.equal(calculateWeightedTotal(5000, 1.25), 6250);
        assert.equal(calculateWeightedTotal(5000, 0.5), 2500);
    });

    it("gives zero rather than a broken number", () => {
        assert.equal(calculateWeightedTotal(5000, 0), 0);
        assert.equal(calculateWeightedTotal(5000, undefined), 0);
        assert.equal(calculateWeightedTotal(5000, -2), 0);
        assert.equal(calculateWeightedTotal(Number.NaN, 2), 0);
        assert.equal(calculateWeightedTotal(5000, Number.NaN), 0);
    });

    it("turns a pack price into a unit price", () => {
        assert.equal(unitPriceFromPack(240000, 24), 10000);
        assert.equal(unitPriceFromPack(240000, 0), 240000);
        assert.equal(unitPriceFromPack(240000, undefined), 240000);
    });
});

describe("the pharmacy package", () => {
    // The dates are relative to today, because "the batch that expires
    // first" only means anything against the current clock.
    const day = 86_400_000;
    const soon = new Date(Date.now() + 30 * day).toISOString();
    const late = new Date(Date.now() + 300 * day).toISOString();
    const expired = new Date(Date.now() - 400 * day).toISOString();

    const batches = [
        {
            _id: "batches_late" as never,
            batchNumber: "LATE",
            expiryDate: late,
            qtyRemaining: 10,
        },
        {
            _id: "batches_soon" as never,
            batchNumber: "SOON",
            expiryDate: soon,
            qtyRemaining: 5,
        },
        {
            _id: "batches_expired" as never,
            batchNumber: "OLD",
            expiryDate: expired,
            qtyRemaining: 100,
        },
    ];

    it("uses the batch that expires first", () => {
        const { allocations } = allocateBatches(batches, 3);
        assert.equal(allocations[0].batchNumber, "SOON");
        assert.equal(allocations[0].quantity, 3);
    });

    it("never uses an expired batch", () => {
        const { allocations } = allocateBatches(batches, 5);
        assert.equal(
            allocations.some((a) => a.batchNumber === "OLD"),
            false
        );
    });

    it("says what it could not fill", () => {
        const { allocations, shortfall } = allocateBatches(batches, 50);
        assert.equal(shortfall, 35);
        assert.equal(allocations.length, 2);
    });

    it("says so when there is nothing to dispense", () => {
        const { allocations, shortfall } = allocateBatches(batches, 0);
        assert.equal(allocations.length, 0);
        assert.equal(shortfall, 0);
    });

    it("says how a batch stands", () => {
        assert.equal(expiryStatus("2025-01-01").status, "expired");
        assert.equal(expiryStatus(undefined).status, "no-expiry");
        const soon = expiryStatus(new Date(Date.now() + 10 * 86_400_000).toISOString(), 90);
        assert.equal(soon.status, "expiring");
        assert.ok((soon.daysToExpiry ?? 0) > 0);
    });
});

describe("the wholesaler package", () => {
    const tier = {
        priceListId: "lists_tier" as never,
        type: "tier" as const,
        price: 900,
        minQty: 10,
    };
    const bigTier = {
        priceListId: "lists_big" as never,
        type: "tier" as const,
        price: 800,
        minQty: 50,
    };
    const customerPrice = {
        priceListId: "lists_customer" as never,
        type: "customer" as const,
        customerId: "customers_1" as never,
        price: 850,
    };

    it("charges the list price when nothing applies", () => {
        const resolved = resolvePrice(1000, [], 1);
        assert.equal(resolved.price, 1000);
        assert.equal(resolved.matchType, undefined);
    });

    it("gives the customer their own price over a tier", () => {
        const resolved = resolvePrice(
            1000,
            [tier, bigTier, customerPrice],
            100,
            "customers_1" as never
        );
        assert.equal(resolved.price, 850);
        assert.equal(resolved.matchType, "customer");
    });

    it("gives the highest band the quantity reaches", () => {
        const resolved = resolvePrice(1000, [tier, bigTier], 60);
        assert.equal(resolved.price, 800);
        assert.equal(resolved.minQty, 50);
    });

    it("does not use a band the quantity falls short of", () => {
        const resolved = resolvePrice(1000, [tier, bigTier], 12);
        assert.equal(resolved.price, 900);
        assert.equal(resolved.minQty, 10);
    });

    it("ignores a band when the quantity is below all of them", () => {
        const resolved = resolvePrice(1000, [tier, bigTier], 2);
        assert.equal(resolved.price, 1000);
    });

    it("ignores a candidate with no usable price", () => {
        const resolved = resolvePrice(
            1000,
            [{ ...tier, price: 0 }],
            100
        );
        assert.equal(resolved.price, 1000);
    });
});

describe("the restaurant package", () => {
    it("moves a ticket forwards", () => {
        assert.equal(canTransition("queued", "preparing"), true);
        assert.equal(canTransition("preparing", "ready"), true);
        assert.equal(canTransition("ready", "served"), true);
    });

    it("does not move a ticket backwards", () => {
        assert.equal(canTransition("ready", "preparing"), false);
        assert.equal(canTransition("served", "ready"), false);
    });

    it("always lets a ticket be cancelled", () => {
        // A customer who walks out must not leave a ticket cooking.
        assert.equal(canTransition("queued", "cancelled"), true);
        assert.equal(canTransition("preparing", "cancelled"), true);
        assert.equal(canTransition("ready", "cancelled"), true);
    });

    it("refuses a status it does not know", () => {
        assert.equal(canTransition("queued", "incinerated"), false);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Hardware
 * ──────────────────────────────────────────────────────────────────────── */

describe("the barcode scanner", () => {
    it("puts a barcode in one form", () => {
        assert.equal(normaliseBarcode("abc-123"), "ABC-123");
        assert.equal(normaliseBarcode(" 123 456 "), "123456");
    });

    it("knows a barcode from a typed word", () => {
        assert.equal(looksLikeBarcode("12345678"), true);
        assert.equal(looksLikeBarcode("123"), false);
        assert.equal(looksLikeBarcode("hello world"), false);
        assert.equal(looksLikeBarcode(""), false);
    });
});

describe("the weighing scale", () => {
    it("reads the lines scales send", () => {
        assert.deepEqual(parseScaleLine("1.250 kg"), {
            weight: 1.25,
            unit: "kg",
            stable: false,
        });
        assert.deepEqual(parseScaleLine("+ 1.250 kg"), {
            weight: 1.25,
            unit: "kg",
            stable: false,
        });
        assert.equal(parseScaleLine("1.250kg ST")?.stable, true);
        assert.equal(parseScaleLine("ST,GS,+1.250 kg")?.stable, true);
    });

    it("refuses a line it cannot read rather than guessing", () => {
        assert.equal(parseScaleLine(""), null);
        assert.equal(parseScaleLine("   "), null);
        assert.equal(parseScaleLine("ERROR"), null);
    });

    it("never returns a broken number", () => {
        const reading = parseScaleLine("12,5 kg");
        assert.ok(reading);
        assert.ok(Number.isFinite(reading.weight));
        assert.equal(reading.weight, 12.5);
    });
});

describe("the cash drawer", () => {
    it("builds the pulse that opens a drawer", () => {
        const pulse = buildDrawerPulse();
        assert.equal(pulse[0], 0x1b);
        assert.equal(pulse[1], 0x70);
        assert.equal(pulse.length, 5);
    });

    it("admits that a browser cannot read the drawer's status", () => {
        const capabilities = drawerCapabilities();
        assert.equal(capabilities.statusReadable, false);
        assert.match(capabilities.detail, /cannot read|check it by eye/i);
    });
});

/* ────────────────────────────────────────────────────────────────────────
 * Mobile money
 * ──────────────────────────────────────────────────────────────────────── */

describe("mobile money from the till", () => {
    it("puts a Ugandan number in the form the providers use", () => {
        assert.equal(formatUgandaPhone("0772123456"), "256772123456");
        assert.equal(formatUgandaPhone("+256772123456"), "256772123456");
        assert.equal(formatUgandaPhone("256772123456"), "256772123456");
        assert.equal(formatUgandaPhone("772123456"), "256772123456");
    });

    it("knows which network a number belongs to", () => {
        assert.equal(detectCarrier("0772123456"), "MTN");
        assert.equal(detectCarrier("0701234567"), "AIRTEL");
        assert.equal(detectCarrier("0201234567"), "UNKNOWN");
    });

    it("picks the adapter that collects for a network", () => {
        assert.equal(adapterKeyForNetwork("MTN"), "mtn.momo");
        assert.equal(adapterKeyForNetwork("AIRTEL"), "airtel.money");
    });
});
