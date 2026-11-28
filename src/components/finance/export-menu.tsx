"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileSpreadsheet, FileText, Loader2, Table2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/context/auth-context";
import { exportCsv, exportExcel, exportPdf, type ExportColumn, type ExportOptions } from "@/lib/export";
import { useT } from "@/i18n/provider";

/**
 * The export menu of a report.
 *
 * CSV for the spreadsheet, Excel for the workbook, PDF for the file that
 * gets printed and filed. All three carry exactly the rows that are on
 * screen.
 *
 * The button only appears for somebody who holds `finance.reports.export`.
 * The interface decides what to *show*; the backend decides what to *allow*
 * — and a report that leaves the system is data leaving the system.
 */
export function ExportMenu({
    title,
    rows,
    columns,
    subtitle,
    options,
}: {
    title: string;
    rows: Record<string, unknown>[];
    columns: ExportColumn[];
    subtitle?: string;
    /** Business mark, figures and other furniture for the exported document. */
    options?: ExportOptions;
}) {
    
    const t = useT();const { can } = useAuth();
    const [busy, setBusy] = useState<string | null>(null);

    if (!can("finance.reports.export")) return null;

    const resolved: ExportOptions = {
        ...(options ?? {}),
        subtitle: options?.subtitle ?? subtitle,
    };

    const run = async (
        kind: "csv" | "excel" | "pdf",
        action: () => void | Promise<void>
    ) => {
        if (rows.length === 0) {
            toast.error("There is nothing to export");
            return;
        }
        setBusy(kind);
        try {
            await action();
            toast.success(`${title} exported`, { description: `${rows.length} row(s)` });
        } catch (error) {
            toast.error("The export failed", {
                description: error instanceof Error ? error.message : undefined,
            });
        } finally {
            setBusy(null);
        }
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={busy !== null}>
                    {busy ? (
                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    ) : (
                        <Download className="mr-2 h-3.5 w-3.5" />
                    )}
                    {t("Export")}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-eyebrow uppercase tracking-eyebrow">
                    {t("Export as")}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => run("csv", () => exportCsv(title, rows, columns))}
                >
                    <Table2 className="mr-2 h-4 w-4" />
                    {t("CSV file")}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() =>
                        run("excel", () => exportExcel(title, rows, columns, resolved))
                    }
                >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    {t("Excel workbook")}
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() =>
                        run("pdf", () => exportPdf(title, rows, columns, resolved))
                    }
                >
                    <FileText className="mr-2 h-4 w-4" />
                    {t("PDF document")}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
