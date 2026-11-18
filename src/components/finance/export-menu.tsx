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
import { exportCsv, exportExcel, exportPdf, type ExportColumn } from "@/lib/export";

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
}: {
    title: string;
    rows: Record<string, unknown>[];
    columns: ExportColumn[];
    subtitle?: string;
}) {
    const { can } = useAuth();
    const [busy, setBusy] = useState<string | null>(null);

    if (!can("finance.reports.export")) return null;

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
                    Export
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-widest">
                    Export as
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    onClick={() => run("csv", () => exportCsv(title, rows, columns))}
                >
                    <Table2 className="mr-2 h-4 w-4" />
                    CSV file
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() =>
                        run("excel", () => exportExcel(title, rows, columns))
                    }
                >
                    <FileSpreadsheet className="mr-2 h-4 w-4" />
                    Excel workbook
                </DropdownMenuItem>
                <DropdownMenuItem
                    onClick={() =>
                        run("pdf", () => exportPdf(title, rows, columns, subtitle))
                    }
                >
                    <FileText className="mr-2 h-4 w-4" />
                    PDF document
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
