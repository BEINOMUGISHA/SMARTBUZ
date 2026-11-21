"use client";

/**
 * SMARTBUZ — report exports.
 *
 * A report that cannot be taken out of the application is a report that
 * cannot be argued with, shared or archived. So every report can be taken
 * as a **CSV**, an **Excel workbook** or a **PDF** — and all three are
 * generated from the same rows that are on screen, so the file and the
 * screen can never disagree.
 *
 * The Excel and PDF writers are loaded on demand: a business that never
 * exports should not pay for the libraries on every page load.
 */

import { businessCurrency } from "./currency";

export interface ExportColumn {
    /** The heading shown for this column. */
    header: string;
    /** The key on the row object. */
    key: string;
    /**
     * How to show the value in a CSV or a PDF.
     *
     * The raw value is what goes into Excel, so the numbers stay numbers and
     * can be summed in the spreadsheet.
     */
    format?: (value: unknown, row: Record<string, unknown>) => string | number;
    /** Right-align the column — the default for anything numeric. */
    numeric?: boolean;
}

/** The name of a report, used for the file name and the sheet heading. */
function slugify(value: string): string {
    return value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/** A readable name for a file: `daily sales` → `daily-sales-2026-01-31.csv`. */
function fileName(title: string, extension: string): string {
    const stamp = new Date().toISOString().slice(0, 10);
    return `${slugify(title) || "report"}-${stamp}.${extension}`;
}

/** Download a blob as a file. */
function download(blob: Blob, name: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Give the browser a moment to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The value of a cell, formatted for a CSV or a PDF. */
function cellValue(
    column: ExportColumn,
    row: Record<string, unknown>
): string | number {
    const raw = row[column.key];
    if (column.format) return column.format(raw, row);
    if (raw === null || raw === undefined) return "";
    if (typeof raw === "number") return raw;
    return String(raw);
}

/** Quote a CSV field, and escape the quotes inside it. */
function csvField(value: string | number): string {
    const text = String(value ?? "");
    if (/[",\n\r]/.test(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * Export rows as a CSV file.
 *
 * The file starts with a byte order mark so that Excel opens it with the
 * right encoding — without it, accented names come out as nonsense.
 */
export function exportCsv(
    title: string,
    rows: Record<string, unknown>[],
    columns: ExportColumn[]
): void {
    const header = columns.map((c) => csvField(c.header)).join(",");
    const body = rows.map((row) =>
        columns.map((c) => csvField(cellValue(c, row))).join(",")
    );

    const csv = [header, ...body].join("\r\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    download(blob, fileName(title, "csv"));
}

/**
 * Export rows as an Excel workbook.
 *
 * One sheet, the headings in bold, the columns sized to their contents and
 * the numbers left as numbers so the spreadsheet can do the arithmetic.
 */
export async function exportExcel(
    title: string,
    rows: Record<string, unknown>[],
    columns: ExportColumn[]
): Promise<void> {
    const ExcelJS = (await import("exceljs")).default;
    const { saveAs } = await import("file-saver");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "SMARTBUZ";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet(title.slice(0, 30) || "Report");

    sheet.columns = columns.map((c) => ({
        header: c.header,
        key: c.key,
        width: Math.min(40, Math.max(12, c.header.length + 4)),
    }));

    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF1F5F9" },
    };

    for (const row of rows) {
        const record: Record<string, unknown> = {};
        for (const column of columns) {
            record[column.key] = row[column.key] ?? null;
        }
        sheet.addRow(record);
    }

    sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        row.eachCell((cell, columnNumber) => {
            if (typeof cell.value === "number") {
                cell.numFmt = "#,##0";
                cell.alignment = { horizontal: "right" };
            }
        });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    saveAs(
        new Blob([buffer], {
            type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        fileName(title, "xlsx")
    );
}

/**
 * Export rows as a PDF.
 *
 * The document is landscape when there are many columns, so the table is
 * not squeezed into an unreadable strip.
 */
export async function exportPdf(
    title: string,
    rows: Record<string, unknown>[],
    columns: ExportColumn[],
    subtitle?: string
): Promise<void> {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF({
        orientation: columns.length > 5 ? "landscape" : "portrait",
        unit: "pt",
        format: "a4",
    });

    const stamp = new Date().toISOString().slice(0, 10);
    doc.setFontSize(15);
    doc.text(title, 40, 40);

    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(subtitle ?? `Generated ${stamp} by SMARTBUZ`, 40, 56);
    doc.setTextColor(0);

    autoTable(doc, {
        startY: 70,
        head: [columns.map((c) => c.header)],
        body: rows.map((row) =>
            columns.map((c) => {
                const value = cellValue(c, row);
                return typeof value === "number" ? value : String(value);
            })
        ),
        styles: { fontSize: 8, cellPadding: 4 },
        headStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        margin: { left: 40, right: 40 },
    });

    doc.save(fileName(title, "pdf"));
}

/* ────────────────────────────────────────────────────────────────────────
 * Formatting helpers for the columns
 * ──────────────────────────────────────────────────────────────────────── */

/** Format a number as a plain thousands-separated number. */
export function number(value: unknown): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "";
    return n.toLocaleString();
}

/**
 * Format a number as money.
 *
 * The currency is the business's own. It used to be the constant "UGX",
 * which meant an exported statement for a dollar business was labelled in
 * shillings — and, worse, nobody could tell which currency the figures
 * were actually in.
 */
export function ugx(value: unknown, currency?: string | null): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "";
    return `${businessCurrency(currency)} ${n.toLocaleString()}`;
}

/** Format a number as a percentage. */
export function percent(value: unknown): string {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "";
    return `${n.toFixed(1)}%`;
}

/** Format an ISO date as a plain day. */
export function date(value: unknown): string {
    if (!value) return "";
    return String(value).slice(0, 10);
}
