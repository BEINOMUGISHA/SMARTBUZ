/**
 * SMARTBUZ — bank and mobile-money reconciliation.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What this replaces
 * ────────────────────────────────────────────────────────────────────────
 *
 * Until now, reconciling meant an accountant typing the provider's total
 * into a form by hand and hoping the number was right. There was no way to
 * see *which* transactions differed, and no way to match a single
 * provider line to the payment the books recorded.
 *
 * This module imports the statement, matches each line against the
 * payments the books already hold, and leaves the unmatched ones visible.
 *
 * ────────────────────────────────────────────────────────────────────────
 * The rule
 * ────────────────────────────────────────────────────────────────────────
 *
 * **A line is only marked matched when a real payment was found.**
 *
 * The import never invents a match to make the numbers look tidy, and it
 * never adjusts a balance. Rows that cannot be read are reported as
 * warnings rather than skipped, because a silently dropped row is a hole
 * in the books that nobody will notice until the quarter closes.
 */

import { mutation, query } from "../_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";
import type { Id } from "../_generated/dataModel";
import { requirePermission, requireTenant } from "../tenancy";
import { loadIntegration } from "./config";
import type { StatementLine } from "./types";

/* ────────────────────────────────────────────────────────────────────────
 * Parsing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Split a line of a statement into its fields.
 *
 * The separator is configurable because banks disagree about it, and a
 * quoted field may contain the separator — a description with a comma in
 * it is the common case.
 */
export function splitLine(line: string, separator: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (!inQuotes && line.startsWith(separator, i)) {
            fields.push(current.trim());
            current = "";
            i += separator.length - 1;
            continue;
        }

        current += char;
    }

    fields.push(current.trim());
    return fields;
}

/**
 * Read a money amount.
 *
 * A statement writes money in several ways: `1,250.00`, `1250`, `(250)`
 * for a negative, `UGX 1,250`. All of them are read; anything else is
 * refused rather than guessed at.
 */
export function parseAmount(value: string): number | null {
    if (!value) return null;

    let text = value.trim();
    let negative = false;

    // Accounting style: (250) means 250 below zero.
    if (text.startsWith("(") && text.endsWith(")")) {
        negative = true;
        text = text.slice(1, -1);
    }

    // Strip a currency word or symbol from either end.
    text = text.replace(/^[A-Za-z]{2,4}\s*/, "");
    text = text.replace(/\s*[A-Za-z]{2,4}$/, "");
    text = text.replace(/[^\d.,\-]/g, "");

    // Nothing left but punctuation means there was no number there.
    // `Number("")` is zero, which would quietly turn an unreadable
    // amount — or a column header — into a figure of nought.
    if (!/\d/.test(text)) return null;

    if (text.startsWith("-")) {
        negative = true;
        text = text.slice(1);
    }

    // A European statement writes 1.250,00; an American one writes 1,250.00.
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");

    if (lastComma > -1 && lastDot > -1) {
        // Whichever comes last is the decimal point.
        text =
            lastComma > lastDot
                ? text.replace(/\./g, "").replace(",", ".")
                : text.replace(/,/g, "");
    } else if (lastComma > -1) {
        // A single comma is a decimal point only when it is followed by
        // one or two digits; otherwise it is a thousands separator.
        const after = text.length - lastComma - 1;
        text = after === 3 ? text.replace(/,/g, "") : text.replace(",", ".");
    }

    const number = Number(text);
    if (!Number.isFinite(number)) return null;

    return negative ? -number : number;
}

/**
 * Read a date into an ISO string.
 *
 * `2026-03-04`, `04/03/2026` and `04-Mar-2026` are all read. A date that
 * cannot be read is refused — a statement line with no date cannot be
 * matched against anything.
 */
export function parseDate(value: string): string | null {
    if (!value) return null;
    const text = value.trim();

    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
    if (iso) {
        return `${iso[1]}-${String(iso[2]).padStart(2, "0")}-${String(
            iso[3]
        ).padStart(2, "0")}`;
    }

    const slash = /^(\d{1,2})[/](\d{1,2})[/](\d{2,4})/.exec(text);
    if (slash) {
        const year = slash[3].length === 2 ? `20${slash[3]}` : slash[3];
        return `${year}-${String(slash[2]).padStart(2, "0")}-${String(
            slash[1]
        ).padStart(2, "0")}`;
    }

    const named = /^(\d{1,2})[-/. ]([A-Za-z]{3,})[-/. ](\d{2,4})/.exec(text);
    if (named) {
        const months: Record<string, string> = {
            jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
            jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
        };
        const month = months[named[2].slice(0, 3).toLowerCase()];
        if (!month) return null;
        const year = named[3].length === 2 ? `20${named[3]}` : named[3];
        return `${year}-${month}-${String(named[1]).padStart(2, "0")}`;
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 10);
    }

    return null;
}

/**
 * The separator a statement uses, from the setting.
 */
export function separatorFor(value: string | undefined): string {
    switch (value) {
        case "semicolon":
            return ";";
        case "tab":
            return "\t";
        default:
            return ",";
    }
}

/**
 * Parse a whole statement.
 *
 * The first row is treated as a header when it has no readable amount in
 * the amount column — which is how almost every bank export starts. It is
 * also skipped when it *does* have an amount, because a statement with no
 * header is legitimate.
 */
export function parseStatement(
    raw: string,
    columns: {
        date: string;
        reference: string;
        amount: string;
        description?: string;
    },
    separator: string
): { lines: StatementLine[]; warnings: string[]; headerSkipped: boolean } {
    const warnings: string[] = [];
    const lines: StatementLine[] = [];

    const rows = raw
        .split(/\r?\n/)
        .map((row) => row.trim())
        .filter((row) => row.length > 0);

    if (rows.length === 0) {
        return { lines, warnings, headerSkipped: false };
    }

    // The column positions come from the first row, which is a header on
    // nearly every bank export.
    const firstRow = rows[0];
    const firstFields = splitLine(firstRow, separator);

    const dateIndex = indexOfColumn(firstRow, separator, columns.date);
    const amountIndex = indexOfColumn(firstRow, separator, columns.amount);
    const referenceIndex = indexOfColumn(firstRow, separator, columns.reference);
    const descriptionIndex = columns.description
        ? indexOfColumn(firstRow, separator, columns.description)
        : -1;

    // A header row names the columns and holds no money. A statement
    // without a header is legitimate too, so the decision is made by
    // looking at the amount rather than by assuming.
    const looksLikeHeader =
        dateIndex > -1 &&
        amountIndex > -1 &&
        referenceIndex > -1 &&
        parseAmount(firstFields[amountIndex] ?? "") === null;

    const positions =
        dateIndex > -1 && amountIndex > -1 && referenceIndex > -1
            ? { date: dateIndex, reference: referenceIndex, amount: amountIndex, description: descriptionIndex }
            : { date: 0, reference: 1, amount: 2, description: 3 };

    let headerSkipped = false;
    let lineNumber = 0;

    for (const row of rows) {
        const fields = splitLine(row, separator);
        lineNumber++;

        if (lineNumber === 1 && looksLikeHeader) {
            headerSkipped = true;
            continue;
        }

        const parsed = readLine(fields, positions, lineNumber, warnings);
        if (parsed) lines.push(parsed);
    }

    return { lines, warnings, headerSkipped };
}

/**
 * Where a named column sits in the header row.
 */
function indexOfColumn(
    headerRow: string,
    separator: string,
    name: string
): number {
    const header = splitLine(headerRow, separator);
    const wanted = name.toLowerCase();
    return header.findIndex(
        (field) => field.toLowerCase().replace(/[^a-z]/g, "") === wanted.replace(/[^a-z]/g, "")
    );
}

/**
 * Read one line of a statement into a `StatementLine`.
 */
function readLine(
    values: string[],
    positions: { date: number; reference: number; amount: number; description: number },
    lineNumber: number,
    warnings: string[]
): StatementLine | null {
    const date = parseDate(values[positions.date] ?? "");
    if (!date) {
        warnings.push(
            `Row ${lineNumber} was skipped: the date "${values[positions.date] ?? ""}" could not be read.`
        );
        return null;
    }

    const amount = parseAmount(values[positions.amount] ?? "");
    if (amount === null) {
        warnings.push(
            `Row ${lineNumber} was skipped: the amount "${values[positions.amount] ?? ""}" could not be read.`
        );
        return null;
    }

    return {
        date,
        reference: (values[positions.reference] ?? "").trim(),
        amount,
        description: positions.description > -1
            ? (values[positions.description] ?? "").trim() || undefined
            : undefined,
    };
}

/* ────────────────────────────────────────────────────────────────────────
 * Importing
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Import a statement.
 *
 * The file is read, never edited. The import writes down what it read and
 * where each line landed, and the reconciliation is a separate act — so
 * the import can be repeated without touching the books.
 */
export const importStatement = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        adapterKey: v.optional(v.string()),
        raw: v.string(),
        filename: v.optional(v.string()),
        period: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "finance.reconcile.manage"
        );

        const adapterKey = args.adapterKey ?? "bank.statement";
        const loaded = await loadIntegration(ctx, businessId, adapterKey);

        const config = loaded.config;
        const columns = {
            date: String(config.dateColumn ?? "Date"),
            reference: String(config.referenceColumn ?? "Reference"),
            amount: String(config.amountColumn ?? "Amount"),
            description: config.descriptionColumn
                ? String(config.descriptionColumn)
                : undefined,
        };
        const separator = separatorFor(
            config.separator ? String(config.separator) : undefined
        );

        const parsed = parseStatement(args.raw, columns, separator);

        if (parsed.lines.length === 0) {
            throw new ConvexError(
                "No lines could be read from that statement. Check the column names and the separator in the integration settings."
            );
        }

        const now = new Date().toISOString();
        const total = parsed.lines.reduce((sum, line) => sum + line.amount, 0);

        const importId = await ctx.db.insert("statementImports", {
            businessId,
            adapterKey,
            providerName: String(config.providerName ?? "Provider"),
            accountLabel: config.accountLabel
                ? String(config.accountLabel)
                : undefined,
            period: args.period,
            filename: args.filename,
            rowCount: parsed.lines.length,
            total,
            currency: config.currency ? String(config.currency) : undefined,
            warnings: parsed.warnings,
            importedBy: membership.userId,
            createdAt: now,
        });

        // Each line is matched against the payments the books recorded.
        const payments = await ctx.db
            .query("payments")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        for (let index = 0; index < parsed.lines.length; index++) {
            const line = parsed.lines[index];
            const match = findMatch(line, payments);

            await ctx.db.insert("statementLines", {
                businessId,
                importId,
                lineNumber: index + 1,
                date: line.date,
                reference: line.reference,
                amount: line.amount,
                description: line.description,
                status: match ? "matched" : "unmatched",
                matchedPaymentId: match?.paymentId,
                matchedSaleId: match?.saleId,
                matchType: match?.matchType,
            });
        }

        return {
            importId,
            rowCount: parsed.lines.length,
            matched: parsed.lines.filter((line) => Boolean(findMatch(line, payments)))
                .length,
            total,
            warnings: parsed.warnings,
        };
    },
});

/**
 * Find the payment a statement line settles.
 *
 * Three ways, in order of confidence:
 *   1. the same reference,
 *   2. the same amount on the same day,
 *   3. the same amount on the same day, allowing for a fee.
 *
 * A match is only made when exactly one candidate fits. Two payments of
 * the same amount on the same day are **not** matched, because choosing
 * between them would be a guess, and a wrong guess would mark the wrong
 * payment as settled.
 */
export function findMatch(
    line: StatementLine,
    payments: {
        _id: Id<"payments">;
        amount: number;
        date: string;
        reference?: string;
        saleId?: Id<"sales">;
        loanId?: Id<"loans">;
    }[]
): {
    paymentId: Id<"payments">;
    saleId?: Id<"sales">;
    matchType: "exact" | "amount_and_date";
} | null {
    const reference = line.reference.trim().toLowerCase();

    if (reference) {
        const exact = payments.filter(
            (payment) =>
                (payment.reference ?? "").trim().toLowerCase() === reference
        );
        if (exact.length === 1) {
            return {
                paymentId: exact[0]._id,
                saleId: exact[0].saleId,
                matchType: "exact",
            };
        }
    }

    const sameDay = payments.filter((payment) => {
        const paymentDate = (payment.date ?? "").slice(0, 10);
        return paymentDate === line.date;
    });

    const sameAmount = sameDay.filter(
        (payment) => Math.abs((payment.amount ?? 0) - line.amount) < 0.005
    );
    if (sameAmount.length === 1) {
        return {
            paymentId: sameAmount[0]._id,
            saleId: sameAmount[0].saleId,
            matchType: "amount_and_date",
        };
    }

    // The provider may have taken a fee out, so the statement line can be
    // a little smaller than the payment.
    const withFee = sameDay.filter((payment) => {
        const difference = (payment.amount ?? 0) - line.amount;
        return difference > 0 && difference <= Math.max(1, (payment.amount ?? 0) * 0.05);
    });
    if (withFee.length === 1) {
        return {
            paymentId: withFee[0]._id,
            saleId: withFee[0].saleId,
            matchType: "amount_and_date",
        };
    }

    return null;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The statement imports, newest first.
 */
export const listStatementImports = query({
    args: { businessId: v.optional(v.id("businesses")) },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "finance.reconcile.manage");

        const rows = await ctx.db
            .query("statementImports")
            .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
            .collect();

        rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        return rows.map((row) => ({
            id: row._id,
            providerName: row.providerName,
            accountLabel: row.accountLabel,
            period: row.period,
            filename: row.filename,
            rowCount: row.rowCount,
            total: row.total,
            currency: row.currency,
            warnings: row.warnings ?? [],
            createdAt: row.createdAt,
        }));
    },
});

/**
 * The lines of one import, with the ones that did not match first.
 */
export const listStatementLines = query({
    args: {
        businessId: v.optional(v.id("businesses")),
        importId: v.id("statementImports"),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "finance.reconcile.manage");

        const importRow = await ctx.db.get(args.importId);
        if (!importRow || importRow.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that statement belongs to another business."
            );
        }

        const lines = await ctx.db
            .query("statementLines")
            .withIndex("by_importId", (q) => q.eq("importId", args.importId))
            .collect();

        lines.sort((a, b) => {
            if (a.status === b.status) return a.lineNumber - b.lineNumber;
            return a.status === "unmatched" ? -1 : 1;
        });

        return lines.map((line) => ({
            id: line._id,
            lineNumber: line.lineNumber,
            date: line.date,
            reference: line.reference,
            amount: line.amount,
            description: line.description,
            status: line.status,
            matchedPaymentId: line.matchedPaymentId,
            matchedSaleId: line.matchedSaleId,
            matchType: line.matchType,
            note: line.note,
        }));
    },
});

/**
 * Match a statement line to a payment by hand.
 *
 * For the lines the automatic match could not settle. A person chooses;
 * SMARTBUZ records who chose and why.
 */
export const matchLineManually = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        lineId: v.id("statementLines"),
        paymentId: v.optional(v.id("payments")),
        note: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        await requirePermission(ctx, businessId, "finance.reconcile.manage");

        const line = await ctx.db.get(args.lineId);
        if (!line || line.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that statement line belongs to another business."
            );
        }

        if (!args.paymentId) {
            await ctx.db.patch(line._id, {
                status: "unmatched",
                matchedPaymentId: undefined,
                matchedSaleId: undefined,
                matchType: undefined,
                note: args.note,
            });
            return null;
        }

        const payment = await ctx.db.get(args.paymentId);
        if (!payment || payment.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that payment belongs to another business."
            );
        }

        let saleId: Id<"sales"> | undefined;
        if (payment.loanId) {
            const loan = await ctx.db.get(payment.loanId);
            if (loan && loan.businessId === businessId) saleId = loan.salesId;
        }

        await ctx.db.patch(line._id, {
            status: "matched",
            matchedPaymentId: payment._id,
            matchedSaleId: saleId,
            matchType: "manual",
            note: args.note,
        });

        return null;
    },
});

/**
 * Settle an import: write the reconciliation for it.
 *
 * The reconciliation records what the provider says was received and what
 * the books recorded, and the difference between them.
 */
export const settleImport = mutation({
    args: {
        businessId: v.optional(v.id("businesses")),
        importId: v.id("statementImports"),
        method: v.optional(v.string()),
        notes: v.optional(v.string()),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        const businessId = tenant.businessId;
        const membership = await requirePermission(
            ctx,
            businessId,
            "finance.reconcile.manage"
        );

        const importRow = await ctx.db.get(args.importId);
        if (!importRow || importRow.businessId !== businessId) {
            throw new ConvexError(
                "Forbidden: that statement belongs to another business."
            );
        }

        const lines = await ctx.db
            .query("statementLines")
            .withIndex("by_importId", (q) => q.eq("importId", args.importId))
            .collect();

        const matched = lines.filter((line) => line.status === "matched");
        const unmatched = lines.filter((line) => line.status === "unmatched");

        let recordedAmount = 0;
        for (const line of matched) {
            if (!line.matchedPaymentId) continue;
            const payment = await ctx.db.get(line.matchedPaymentId);
            recordedAmount += payment?.amount ?? 0;
        }

        const variance = importRow.total - recordedAmount;
        const status = variance === 0 && unmatched.length === 0 ? "reconciled" : "discrepancy";

        const period =
            importRow.period ??
            (importRow.createdAt.slice(0, 7) as string);

        const reconciliationId = await ctx.db.insert("reconciliations", {
            businessId,
            kind: "bank",
            method: args.method ?? "bank",
            period,
            statementReference:
                importRow.filename ?? `import-${importRow._id}`,
            statementAmount: importRow.total,
            recordedAmount,
            variance,
            status,
            notes:
                args.notes ??
                (unmatched.length > 0
                    ? `${unmatched.length} line(s) did not match a payment in the books.`
                    : undefined),
            userId: membership.userId,
            createdAt: new Date().toISOString(),
        });

        for (const line of matched) {
            await ctx.db.patch(line._id, { reconciliationId });
        }

        return {
            reconciliationId,
            status,
            statementAmount: importRow.total,
            recordedAmount,
            variance,
            matched: matched.length,
            unmatched: unmatched.length,
        };
    },
});
