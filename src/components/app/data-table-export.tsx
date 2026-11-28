"use client";

/**
 * Export for a `DataTable`.
 *
 * The product had two export stacks. One took structured rows and typed
 * columns — correct, and the numbers stayed numbers. The other scraped the
 * rendered DOM for text, so a column it could not find in the markup was
 * silently dropped from the file.
 *
 * This adapter joins the good stack to the shared table: hand it the same
 * columns the table shows and the file always contains exactly what is on
 * screen.
 */

import { ExportMenu } from "@/components/finance/export-menu";
import type { DataTableColumn } from "@/components/ui/data-table";
import type { ExportColumn } from "@/lib/export";

export function DataTableExport<T>({
    title,
    rows,
    columns,
    subtitle,
}: {
    title: string;
    rows: T[];
    columns: DataTableColumn<T>[];
    subtitle?: string;
}) {
    // Only columns that know how to read a raw value can be exported. A
    // column that renders JSX without an accessor has no plain value, and
    // guessing one would put a React element in a spreadsheet.
    const exportColumns: ExportColumn[] = columns
        .filter((column) => Boolean(column.accessor))
        .map((column) => ({
            header:
                typeof column.header === "string"
                    ? column.header
                    : column.id,
            key: column.id,
            numeric: column.align === "right",
            format: (value: unknown, row: Record<string, unknown>) => {
                const raw = column.accessor!(row as unknown as T);
                if (raw === null || raw === undefined) return "";
                if (typeof raw === "object") return String(raw);
                return raw as string | number;
            },
        }));

    if (exportColumns.length === 0) return null;

    return (
        <ExportMenu
            title={title}
            rows={rows as unknown as Record<string, unknown>[]}
            columns={exportColumns}
            subtitle={subtitle}
        />
    );
}
