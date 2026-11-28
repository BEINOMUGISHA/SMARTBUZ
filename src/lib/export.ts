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

/* ────────────────────────────────────────────────────────────────────────
 * What an exported report looks like
 * ──────────────────────────────────────────────────────────────────────── */

/** A figure shown above an exported table. */
export interface ExportStat {
    label: string;
    value: string;
    /** A short line under the figure. */
    hint?: string;
}

/** The business the report belongs to, printed on the document. */
export interface ExportBranding {
    name?: string;
    address?: string;
    phone?: string;
    /** A logo as a data URL, so the PDF carries the business's own mark. */
    logoDataUrl?: string;
}

/** Everything an exported report can carry beyond its rows and columns. */
export interface ExportOptions {
    /** A line under the title. */
    subtitle?: string;
    /** Figures shown above the table. */
    stats?: ExportStat[];
    /** The business the report belongs to. */
    business?: ExportBranding;
}

/**
 * Read the plain text out of a React element.
 *
 * A column that renders a badge or a bold figure has no plain value to put in
 * a spreadsheet, and guessing one would put `<span>` markup in the file. This
 * pulls the text back out of the element tree.
 */
export function extractTextFromReact(element: unknown): string {
    if (typeof element === "string" || typeof element === "number") {
        return String(element);
    }
    if (!element || typeof element !== "object") return "";

    const props = (element as { props?: { children?: unknown } }).props;
    if (!props) return "";

    const children = props.children;
    if (Array.isArray(children)) {
        return children
            .map((child) => extractTextFromReact(child))
            .filter((text) => text.length > 0)
            .join("\n");
    }
    return extractTextFromReact(children);
}

/**
 * Turn a screen column into an export column.
 *
 * Screen tables describe a column by how to *draw* it — a React node, or a
 * key on the record. An export needs a plain value instead. This is the one
 * place that translation happens, so every exported file agrees with the
 * screen it came from.
 */
export function toExportColumn<T>(
    column: {
        header: string;
        /** A key on the record, or a function that draws the cell. */
        accessor?: unknown;
        exportValue?: (item: T) => string | number;
    },
    index: number
): ExportColumn {
    const accessor = column.accessor;
    const key = typeof accessor === "string" ? accessor : `column_${index}`;

    return {
        header: column.header,
        key,
        numeric: false,
        format: (_value, row) => {
            const item = row as unknown as T;
            if (column.exportValue) return column.exportValue(item);
            if (typeof accessor === "function") {
                const draw = accessor as (item: T) => unknown;
                return extractTextFromReact(draw(item));
            }
            return (item as Record<string, unknown>)[key] as string | number;
        },
    };
}

/** Turn a list of screen columns into export columns. */
export function toExportColumns<T>(
    columns: Array<{
        header: string;
        accessor?: unknown;
        exportValue?: (item: T) => string | number;
    }>
): ExportColumn[] {
    return columns.map((column, index) => toExportColumn(column, index));
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
    columns: ExportColumn[],
    options?: ExportOptions
): Promise<void> {
    const ExcelJS = (await import("exceljs")).default;
    const { saveAs } = await import("file-saver");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = options?.business?.name || "SMARTBUZ";
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
        row.eachCell((cell) => {
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
 * not squeezed into an unreadable strip. It carries the business's own name,
 * address and mark at the top, because a statement that leaves the building
 * has to say whose it is.
 */
export async function exportPdf(
    title: string,
    rows: Record<string, unknown>[],
    columns: ExportColumn[],
    options?: ExportOptions | string
): Promise<void> {
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    // An older caller may pass the subtitle straight in.
    const opts: ExportOptions =
        typeof options === "string" ? { subtitle: options } : options ?? {};

    const landscape = columns.length > 5;
    const doc = new jsPDF({
        orientation: landscape ? "landscape" : "portrait",
        unit: "pt",
        format: "a4",
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 40;
    const business = opts.business ?? {};
    const stamp = new Date().toISOString().slice(0, 10);

    let y = 40;

    // The business's own mark, printed on the document.
    if (business.logoDataUrl) {
        try {
            doc.addImage(business.logoDataUrl, "PNG", pageWidth - margin - 28, 30, 28, 28);
        } catch {
            // A logo that cannot be read is not worth failing the export for.
        }
    }

    // The business, then the report.
    if (business.name) {
        doc.setFontSize(15);
        doc.setTextColor(15, 118, 110);
        doc.text(business.name.toUpperCase(), margin, y);
        y += 14;
    }
    if (business.address) {
        doc.setFontSize(8);
        doc.setTextColor(110);
        doc.text(business.address, margin, y);
        y += 11;
    }
    if (business.phone) {
        doc.setFontSize(8);
        doc.setTextColor(110);
        doc.text(`Tel: ${business.phone}`, margin, y);
        y += 11;
    }

    y += 6;
    doc.setDrawColor(15, 118, 110);
    doc.setLineWidth(1);
    doc.line(margin, y, pageWidth - margin, y);
    y += 18;

    doc.setFontSize(13);
    doc.setTextColor(0);
    doc.text(title, margin, y);
    y += 14;

    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(
        opts.subtitle ?? `Generated ${stamp} by SMARTBUZ`,
        margin,
        y
    );
    y += 16;

    // The figures that sit above the table.
    if (opts.stats && opts.stats.length > 0) {
        const columnsCount = opts.stats.length;
        const cellWidth = Math.min(180, (pageWidth - margin * 2) / columnsCount);
        const startX = margin;

        opts.stats.forEach((stat, index) => {
            const x = startX + index * cellWidth;
            if (index > 0) {
                doc.setDrawColor(224, 224, 224);
                doc.setLineWidth(0.5);
                doc.line(x - 8, y - 10, x - 8, y + 24);
            }
            doc.setFontSize(7);
            doc.setTextColor(0, 133, 66);
            doc.text(String(stat.label).toUpperCase(), x, y);
            doc.setFontSize(11);
            doc.setTextColor(0);
            doc.text(String(stat.value), x, y + 13);
            if (stat.hint) {
                doc.setFontSize(7);
                doc.setTextColor(150);
                doc.text(String(stat.hint), x, y + 24);
            }
        });

        y += 38;
    }

    doc.setTextColor(0);

    autoTable(doc, {
        startY: y,
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
        margin: { left: margin, right: margin },
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
