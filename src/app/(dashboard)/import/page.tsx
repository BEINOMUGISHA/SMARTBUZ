"use client";

/**
 * SMART_BUZ — bulk import.
 *
 * A business that already trades somewhere else has its products, its
 * customers and its opening stock in a spreadsheet. This is the screen
 * that brings that spreadsheet in.
 *
 * The file is read in the browser; the rows are checked by the server
 * against this business's own records; the person sees a preview of
 * every row and what is wrong with it; and only then is anything
 * written.
 */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import {
    AlertTriangle,
    CheckCircle2,
    FileSpreadsheet,
    Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    CountBadge,
    PageContainer,
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * The types of thing that can be brought in
 * ──────────────────────────────────────────────────────────────────────── */

const IMPORT_TYPES = [
    { value: "products", label: "Products" },
    { value: "customers", label: "Customers" },
    { value: "stock", label: "Opening stock" },
] as const;

type ImportType = (typeof IMPORT_TYPES)[number]["value"];

interface PreviewRow {
    index: number;
    values: Record<string, string>;
    problems: string[];
    ok: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * Reading a CSV in the browser
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Split one line of CSV into its fields.
 *
 * A field may be wrapped in quotes, and a quoted field may contain a
 * comma — which is why the line is read a character at a time rather than
 * split on every comma.
 */
function splitLine(line: string): string[] {
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const character = line[index];

        if (character === '"') {
            if (inQuotes && line[index + 1] === '"') {
                current += '"';
                index += 1;
                continue;
            }
            inQuotes = !inQuotes;
            continue;
        }

        if (character === "," && !inQuotes) {
            fields.push(current.trim());
            current = "";
            continue;
        }

        current += character;
    }

    fields.push(current.trim());
    return fields;
}

/**
 * Read a CSV file into rows of values, keyed by the headings.
 */
function parseCsv(text: string): Record<string, string>[] {
    const lines = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);

    if (lines.length === 0) return [];

    const headings = splitLine(lines[0]).map((heading) =>
        heading.toLowerCase().replace(/\s+/g, "_")
    );

    const rows: Record<string, string>[] = [];
    for (let index = 1; index < lines.length; index += 1) {
        const values = splitLine(lines[index]);
        const row: Record<string, string> = {};
        headings.forEach((heading, position) => {
            row[heading] = values[position] ?? "";
        });
        rows.push(row);
    }

    return rows;
}

/* ────────────────────────────────────────────────────────────────────────
 * The page
 * ──────────────────────────────────────────────────────────────────────── */

export default function ImportPage() {
    
    const t = useT();const [type, setType] = useState<ImportType>("products");
    const [fileName, setFileName] = useState<string | null>(null);
    const [rows, setRows] = useState<Record<string, string>[]>([]);
    const [preview, setPreview] = useState<PreviewRow[] | null>(null);
    const [excluded, setExcluded] = useState<Set<number>>(new Set());
    const fileInput = useRef<HTMLInputElement>(null);

    const templates = useQuery(api.packages.imports.getImportTemplates, {});
    const summary = useQuery(api.packages.imports.getImportSummary, {});

    const validate = useQuery(
        api.packages.imports.validateImport,
        rows.length > 0 ? { type, rows } : "skip"
    );
    const commit = useMutation(api.packages.imports.commitImport);

    const template = templates ? templates[type] : null;

    const keptRows = useMemo(
        () =>
            rows.filter((_, index) => !excluded.has(index)),
        [rows, excluded]
    );

    const previewRows = useMemo(() => {
        if (!validate) return [];
        return validate.rows.map((row: PreviewRow) => ({
            ...row,
            ok: row.ok && !excluded.has(row.index),
        }));
    }, [validate, excluded]);

    const importableCount = previewRows.filter((row) => row.ok).length;
    const refusedCount = previewRows.filter((row) => !row.ok).length;

    /* ── The file ───────────────────────────────────────────────────── */

    const onFile = async (file: File) => {
        const text = await file.text();
        const parsed = parseCsv(text);
        if (parsed.length === 0) {
            toast.error("That file has no rows in it.");
            return;
        }
        setFileName(file.name);
        setRows(parsed);
        setExcluded(new Set());
        setPreview(null);
    };

    const downloadTemplate = () => {
        if (!template) return;
        const headings = template.columns.map((column) => column.name).join(",");
        const sample = template.columns
            .map((column) =>
                column.required ? `${column.name}` : `${column.name}`
            )
            .join(",");
        const blob = new Blob([`${headings}\n${sample}\n`], {
            type: "text/csv;charset=utf-8;",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${type}-template.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    /* ── The table ──────────────────────────────────────────────────── */

    const columns: DataTableColumn<PreviewRow>[] = [
        {
            id: "row",
            header: "Row",
            accessor: (row) => row.index + 1,
            width: "5rem",
            cell: (row) => (
                <span className="tabular-nums text-muted-foreground">
                    {row.index + 1}
                </span>
            ),
        },
        ...(template
            ? template.columns.map((column) => ({
                  id: column.name,
                  header: column.label,
                  accessor: (row: PreviewRow) => row.values[column.name] ?? "",
                  cell: (row: PreviewRow) => (
                      <span className="text-sm">
                          {row.values[column.name] || "—"}
                      </span>
                  ),
              }))
            : []),
        {
            id: "verdict",
            header: "Verdict",
            sortable: false,
            cell: (row: PreviewRow) =>
                row.ok ? (
                    <span className="inline-flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="size-4" />
                        {t("Ready")}
                    </span>
                ) : (
                    <span className="inline-flex items-start gap-1 text-sm text-destructive">
                        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                        {row.problems.join(" ") ||
                            (excluded.has(row.index) ? "Skipped" : "Not ready")}
                    </span>
                ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            cell: (row: PreviewRow) => (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        setExcluded((current) => {
                            const next = new Set(current);
                            if (next.has(row.index)) next.delete(row.index);
                            else next.add(row.index);
                            return next;
                        });
                    }}
                >
                    {excluded.has(row.index) ? "Bring back" : "Skip"}
                </Button>
            ),
        },
    ];

    /* ── The page ───────────────────────────────────────────────────── */

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Data"
                title={t("Bulk Import")}
                description={t("Bring a catalogue, a customer list or an opening stock in from a spreadsheet — checked before anything is written.")}
                icon={Upload}
                actions={
                    <Button variant="outline" onClick={downloadTemplate} disabled={!template}>
                        <FileSpreadsheet className="mr-2 size-4" />
                        {t("Download the template")}
                    </Button>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Products on file")}
                    value={summary ? summary.products : "—"}
                    hint={t("What an import would be added to")}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Customers on file")}
                    value={summary ? summary.customers : "—"}
                    hint={t("The customer book as it stands")}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Ready to import")}
                    value={rows.length > 0 ? importableCount : "—"}
                    hint={t("Rows that passed the check")}
                    tone={importableCount > 0 ? "success" : "default"}
                />
                <StatCard
                    label={t("Refused")}
                    value={rows.length > 0 ? refusedCount : "—"}
                    hint={t("Rows with something wrong in them")}
                    tone={refusedCount > 0 ? "warning" : "default"}
                />
            </StatGrid>

            <SectionCard
                title={t("The file")}
                description={
                    template
                        ? template.description
                        : "Choose what you are bringing in."
                }
                icon={FileSpreadsheet}
                actions={
                    <div className="flex items-center gap-2">
                        <select
                            value={type}
                            onChange={(event) => {
                                setType(event.target.value as ImportType);
                                setRows([]);
                                setExcluded(new Set());
                                setFileName(null);
                            }}
                            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                            aria-label={t("What to import")}
                        >
                            {IMPORT_TYPES.map((option) => (
                                <option key={option.value} value={option.value}>
                                    {t(option.label)}
                                </option>
                            ))}
                        </select>
                        <Button
                            onClick={() => fileInput.current?.click()}
                        >
                            {t("Choose a file")}
                        </Button>
                        <input
                            ref={fileInput}
                            type="file"
                            accept=".csv,text/csv"
                            className="hidden"
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (file) void onFile(file);
                                event.target.value = "";
                            }}
                        />
                    </div>
                }
            >
                {fileName ? (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/40 px-4 py-3">
                        <div className="min-w-0">
                            <p className="truncate font-medium">{fileName}</p>
                            <p className="text-xs text-muted-foreground">
                                {rows.length} row{rows.length === 1 ? "" : "s"} read
                                {template
                                    ? ` — the headings must be: ${template.columns
                                          .map((column) => column.name)
                                          .join(", ")}`
                                    : ""}
                            </p>
                        </div>
                        <Button
                            onClick={async () => {
                                try {
                                    const outcome = await commit({
                                        type,
                                        rows: keptRows,
                                    });
                                    toast.success(
                                        `Imported ${outcome.imported} row(s).${
                                            outcome.skipped.length > 0
                                                ? ` ${outcome.skipped.length} were skipped.`
                                                : ""
                                        }`
                                    );
                                    setRows([]);
                                    setExcluded(new Set());
                                    setFileName(null);
                                } catch (err) {
                                    toast.error(
                                        err instanceof Error
                                            ? err.message
                                            : "Could not import the file."
                                    );
                                }
                            }}
                            disabled={importableCount === 0}
                        >
                            {t("Import")} {importableCount} row
                            {importableCount === 1 ? "" : "s"}
                        </Button>
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">
                        {t("Choose a CSV file. Nothing is written until you have seen the check and asked for the import.")}
                    </p>
                )}
            </SectionCard>

            <SectionCard
                title={t("The check")}
                description={t("Every row, and what is wrong with it.")}
                icon={AlertTriangle}
                actions={
                    rows.length > 0 ? (
                        <CountBadge>{rows.length} rows</CountBadge>
                    ) : null
                }
                bodyClassName="p-0"
            >
                <DataTable
                    data={previewRows}
                    columns={columns}
                    getRowId={(row) => String(row.index)}
                    isLoading={rows.length > 0 && validate === undefined}
                    isEmpty={rows.length === 0}
                    emptyTitle={t("No file read yet")}
                    emptyHint={t("Choose a CSV file and every row in it is checked here, with the reason for any row that cannot be brought in.")}
                    caption={t("Preview")}
                />
            </SectionCard>
        </PageContainer>
    );
}
