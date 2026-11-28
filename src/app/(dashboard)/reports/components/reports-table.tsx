"use client";

import React from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { getStatsForVariant, SummaryVariant } from "./ReportSummary";
import { useCurrency } from "@/hooks/use-currency";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Printer, FileSpreadsheet, FileText, Eye, Table2 } from "lucide-react";
import {
    exportCsv,
    exportExcel,
    exportPdf,
    extractTextFromReact,
    toExportColumns,
    type ExportStat,
} from "@/lib/export";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { useT } from "@/i18n/provider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

interface Column<T> {
    header: string;
    accessor: keyof T | ((item: T) => React.ReactNode);
    className?: string;
    exportValue?: (item: T) => string | number;
}

interface ReportTableProps<T> {
    title: string;
    subtitle?: string;
    columns: Column<T>[];
    data: T[];
    isLoading?: boolean;
    search?: string;
    pagination?: {
        currentPage: number;
        totalPages: number;
        rowsPerPage: number;
        onRowsPerPageChange: (rows: number) => void;
        totalItems: number;
        onNext: () => void;
        onPrev: () => void;
        canLoadMore?: boolean;
    };
    footer?: React.ReactNode;
    summaryData?: any;
    compact?: boolean;
    printId?: string;
    variant?: SummaryVariant;
    onViewDetails?: (item: T) => void;
}

export function ReportTable<T>({
    title,
    subtitle,
    columns,
    data,
    isLoading,
    pagination,
    footer,
    summaryData,
    compact,
    printId,
    variant,
    onViewDetails,
}: ReportTableProps<T>) {
    
    const t = useT();const internalId = React.useId().replace(/:/g, "");
    const actualPrintId = printId || `report-print-${internalId}`;
    const { currency } = useCurrency();

    const activeProfile = useQuery(api.businesses.getActive, {});
    const businessName = activeProfile?.name || "SMARTBUZ POS";
    const businessAddress = activeProfile?.businessAddress || "";
    const businessPhone = activeProfile?.businessPhone || "";

    const handlePrint = () => {
        // We need to set a temporary class on the body to target THIS specific report
        const style = document.createElement('style');
        style.id = 'print-style-temp';
        style.innerHTML = `
            @media print {
                #${actualPrintId} { visibility: visible !important; display: block !important; position: absolute !important; left: 0 !important; top: 0 !important; width: 100% !important; }
            }
        `;
        document.head.appendChild(style);
        window.print();
        setTimeout(() => {
            const el = document.getElementById('print-style-temp');
            if (el) el.remove();
        }, 1000);
    };

    // Pagination calculations
    const startIndex = pagination ? (pagination.currentPage - 1) * pagination.rowsPerPage : 0;
    const endIndex = pagination ? Math.min(startIndex + pagination.rowsPerPage, pagination.totalItems) : data.length;

    return (
        <div className={cn("space-y-4 h-full flex flex-col", compact && "space-y-2")}>
            <div className="flex items-center justify-between">
                <div>
                    <h2 className={cn("text-sm font-semibold uppercase tracking-widest text-primary italic leading-none", compact && "text-xs")}>{title}</h2>
                    {subtitle && <p className={cn("text-muted-foreground mt-1 tracking-tighter text-eyebrow uppercase tracking-eyebrow", compact && "text-xs mt-0.5")}>{subtitle}</p>}
                </div>
                <div className="flex items-center gap-2 print:hidden">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            exportCsv(
                                title,
                                data as unknown as Record<string, unknown>[],
                                toExportColumns<T>(columns)
                            )
                        }
                        className={cn("h-7 px-3 gap-2 border-muted-foreground/20 text-eyebrow uppercase tracking-eyebrow", compact && "h-6 px-2 text-xs")}
                    >
                        <Table2 className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> {t("CSV")}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                            exportExcel(
                                title,
                                data as unknown as Record<string, unknown>[],
                                toExportColumns<T>(columns)
                            )
                        }
                        className={cn("h-7 px-3 gap-2 border-emerald-600/20 text-emerald-700 hover:bg-emerald-50 text-eyebrow uppercase tracking-eyebrow", compact && "h-6 px-2 text-xs")}
                    >
                        <FileSpreadsheet className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> {t("Excel")}
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                            const stats: ExportStat[] = summaryData
                                ? getStatsForVariant(variant || "overview", summaryData, currency).map(
                                      (stat: any) => ({
                                          label: stat.title,
                                          value: String(stat.value),
                                          hint: stat.description,
                                      })
                                  )
                                : [];

                            // Fetch logo
                            let logoBase64 = undefined;
                            try {
                                const response = await fetch("/logo.ico");
                                const blob = await response.blob();
                                logoBase64 = await new Promise<string>((resolve) => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => resolve(reader.result as string);
                                    reader.readAsDataURL(blob);
                                });
                            } catch (error) {
                                console.error("Failed to load logo for PDF", error);
                            }

                            await exportPdf(
                                title,
                                data as unknown as Record<string, unknown>[],
                                toExportColumns<T>(columns),
                                {
                                    subtitle,
                                    stats,
                                    business: {
                                        name: businessName,
                                        address: businessAddress,
                                        phone: businessPhone,
                                        logoDataUrl: logoBase64,
                                    },
                                }
                            );
                        }}
                        className={cn("h-7 px-3 gap-2 border-red-600/20 text-red-700 hover:bg-red-50 text-eyebrow uppercase tracking-eyebrow", compact && "h-6 px-2 text-xs")}
                    >
                        <FileText className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> {t("PDF")}
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint} className={cn("h-7 px-3 gap-2 border-muted-foreground/20 text-eyebrow uppercase tracking-eyebrow", compact && "h-6 px-2 text-xs")}>
                        <Printer className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> {t("Print")}
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border bg-card/50">
                <div className="min-w-[800px] lg:min-w-0">
                    <Table>
                        <TableHeader className="bg-primary/5 sticky top-0 z-10 border-b-2 border-primary/20">
                            <TableRow className="hover:bg-transparent">
                                {columns.map((col, idx) => (
                                    <TableHead key={idx} className={cn("text-primary py-4 text-eyebrow uppercase tracking-eyebrow", compact && "py-2 text-xs", col.className)}>
                                        {t(col.header)}
                                    </TableHead>
                                ))}
                                {onViewDetails && (
                                    <TableHead className={cn("text-primary py-4 text-center w-[80px] text-eyebrow uppercase tracking-eyebrow", compact && "py-2 text-xs")}>
                                        {t("Actions")}
                                    </TableHead>
                                )}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <TableRow key={i}>
                                        {columns.map((_, idx) => (
                                            <TableCell key={idx}>
                                                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                                            </TableCell>
                                        ))}
                                        {onViewDetails && (
                                            <TableCell>
                                                <div className="h-4 w-full animate-pulse rounded bg-muted" />
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            ) : data.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={columns.length + (onViewDetails ? 1 : 0)} className="h-32 text-center text-muted-foreground">
                                        {t("No data found.")}
                                    </TableCell>
                                </TableRow>
                            ) : (
                                data.map((item, rowIdx) => (
                                    <TableRow key={rowIdx} className="hover:bg-muted/30 transition-colors">
                                        {columns.map((col, colIdx) => (
                                            <TableCell key={colIdx} className={cn("py-3 text-xs", compact && "py-1.5 text-xs", col.className)}>
                                                {typeof col.accessor === "function"
                                                    ? col.accessor(item)
                                                    : (item[col.accessor] as React.ReactNode)}
                                            </TableCell>
                                        ))}
                                        {onViewDetails && (
                                            <TableCell className={cn("py-3 text-center w-[80px]", compact && "py-1.5")}>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => onViewDetails(item)}
                                                    className="h-7 w-7"
                                                >
                                                    <Eye className="h-3.5 w-3.5 text-green-600" />
                                                </Button>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))
                            )}
                            {footer}
                        </TableBody>
                    </Table>
                </div>
            </div>

            {/* Pagination Footer */}
            {pagination && (
                <div className="flex flex-col sm:flex-row items-center justify-between border-t bg-muted/20 px-4 py-4 gap-4 rounded-b-xl border">
                    <div className="flex items-center space-x-2">
                        <p className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">{t("Rows")}</p>
                        <Select
                            value={`${pagination.rowsPerPage}`}
                            onValueChange={(value) => pagination.onRowsPerPageChange(Number(value))}
                        >
                            <SelectTrigger className="h-8 w-[70px] font-bold text-xs border-2">
                                <SelectValue placeholder={pagination.rowsPerPage} />
                            </SelectTrigger>
                            <SelectContent side="top">
                                {[5, 10, 20, 30, 50, 100].map((pageSize) => (
                                    <SelectItem key={pageSize} value={`${pageSize}`} className="text-xs font-bold">
                                        {pageSize}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="tracking-tighter text-primary text-eyebrow uppercase tracking-eyebrow">
                            {Math.min(startIndex + 1, pagination.totalItems)}-{Math.min(endIndex, pagination.totalItems)} of {pagination.totalItems}
                        </div>

                        <div className="flex items-center gap-1">
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0 border-2"
                                onClick={pagination.onPrev}
                                disabled={pagination.currentPage === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0 border-2"
                                onClick={pagination.onNext}
                                disabled={pagination.currentPage >= pagination.totalPages && !pagination.canLoadMore}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* PRINT VIEW STYLES */}
            <style jsx global>{`
                @media print {
                    /* Hide EVERYTHING */
                    body { visibility: hidden !important; background: white !important; }
                    
                    /* Common print styles for ANY report container */
                    .report-print-view { 
                        visibility: hidden;
                        display: none;
                    }
                    
                    .report-print-view * { 
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }

                    @page { margin: 0; size: auto; }
                }
            `}</style>

            {/* HIDDEN PRINT CONTENT */}
            {/* HIDDEN PRINT CONTENT */}
            <div id={actualPrintId} className="hidden print:report-print-view bg-white text-black p-4 min-h-screen report-print-view">
                {/* OFFICIAL BUSINESS HEADER */}
                <div className="pb-6 border-b-2 border-emerald-600 mb-6 font-sans relative">
                    <div className="text-center px-20">
                        <h2 className="text-3xl font-semibold text-emerald-800 tracking-tight uppercase mb-1">{businessName}</h2>
                        {businessAddress && <p className="text-xs leading-tight font-bold text-gray-600">{businessAddress}</p>}
                        {businessPhone && <p className="text-xs font-bold text-gray-500">{t("Tel:")} {businessPhone}</p>}
                        <div className="mt-2 inline-block px-4 py-1 bg-emerald-600 text-white rounded-full text-eyebrow uppercase tracking-eyebrow">
                            {t("OFFICIAL")} {title}
                        </div>
                    </div>

                    {/* Logo (Right Aligned Absolute) */}
                    <div className="absolute right-0 top-0 h-full flex items-start pt-1">
                        <div className="h-16 w-16 rounded-xl border-2 border-emerald-600 flex items-center justify-center font-semibold text-2xl text-emerald-800 bg-emerald-50">
                            {businessName.slice(0, 2).toUpperCase()}
                        </div>
                    </div>
                </div>

                {/* SUMMARY CARDS IN PRINT (Dynamic based on Variant) */}
                {summaryData && (
                    <div className="grid grid-cols-4 gap-4 mb-4 border-b border-gray-100 pb-4">
                        {getStatsForVariant(variant || "overview", summaryData, currency).map((stat, idx) => (
                            <div key={idx} className={cn("flex flex-col pl-4 border-l border-gray-100 first:pl-0 first:border-0")}>
                                <p className="text-[#008542] tracking-tighter text-eyebrow uppercase tracking-eyebrow">{t(stat.title)}</p>
                                <p className="text-xs font-semibold text-black">{stat.value}</p>
                                <p className="text-xs font-bold text-gray-400 italic font-mono">{t(stat.description)}</p>
                            </div>
                        ))}
                    </div>
                )}
                <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 uppercase tracking-tight">{title}</h3>
                    {subtitle && <p className="text-gray-500 mt-0.5 tracking-wide text-eyebrow uppercase tracking-eyebrow">{subtitle}</p>}
                </div>

                <table className="w-full border-collapse border border-gray-300 print:text-xs">
                    <thead>
                        <tr className="!bg-[#008542] !print:bg-[#008542] border-b-2 border-emerald-800">
                            <th className="px-1 py-3 text-center border-r border-emerald-700 w-8 text-white !print:text-white text-eyebrow uppercase tracking-eyebrow">#</th>
                            {columns.map((col, idx) => (
                                <th
                                    key={idx}
                                    className={cn(
                                        "px-3 py-2 text-xs border-r border-gray-300 last:border-0 !text-white !print:text-white",
                                        // Filter alignment: only keep text-center, text-right, text-left
                                        // This ensures it stays white even if col.className has text-primary
                                        col.className?.split(" ").filter(c =>
                                            c === "text-center" || c === "text-right" || c === "text-left" || (!c.startsWith("text-") && !c.startsWith("bg-"))
                                        ).join(" "),
                                        // Override global text-left if center/right is provided in col.className
                                        (col.className?.includes("text-center") || col.className?.includes("text-right")) ? "" : "text-left"
                                    )}
                                >
                                    {t(col.header)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item, rowIdx) => (
                            <tr key={rowIdx} className={cn("border-b border-gray-200", rowIdx % 2 === 1 ? "bg-gray-50" : "bg-white")}>
                                <td className="px-1 py-2 text-xs border-r border-gray-300 text-center font-bold text-gray-500 w-8">{(startIndex || 0) + rowIdx + 1}</td>
                                {columns.map((col, colIdx) => (
                                    <td
                                        key={colIdx}
                                        className={cn(
                                            "px-3 py-2 text-xs border-r border-gray-300 last:border-0 !text-black font-medium whitespace-pre-line",
                                            // Strip background and non-alignment text colors
                                            col.className?.split(" ").filter(c =>
                                                c === "text-center" || c === "text-right" || c === "text-left" || (!c.startsWith("text-") && !c.startsWith("bg-"))
                                            ).join(" ")
                                        )}
                                    >
                                        {(col as any).exportValue
                                            ? (col as any).exportValue(item)
                                            : extractTextFromReact(
                                                typeof col.accessor === "function"
                                                    ? col.accessor(item)
                                                    : (item as any)[col.accessor as any]
                                            )}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="mt-8 flex justify-between text-xs font-bold text-gray-400 italic">
                    <span>{t("Generated by System on")} {new Date().toLocaleString()}</span>
                    <span>{t("Verified Official Document")}</span>
                </div>

                <div className="mt-12 grid grid-cols-2 gap-12 text-xs print-break-inside-avoid">
                    <div className="border-t-2 border-gray-200 pt-4">
                        <p className="font-semibold uppercase tracking-widest text-gray-800 border-b border-dashed border-gray-300 pb-1 mb-4">{t("Authorized Signature")}</p>
                        <div className="h-10 text-gray-300">{t("Space for signature")}</div>
                        <p className="mt-2 text-gray-500 font-bold">{t("DATE: ________________________")}</p>
                    </div>
                    <div className="border-t-2 border-gray-200 pt-4 text-right">
                        <p className="font-semibold uppercase tracking-widest text-gray-800 border-b border-dashed border-gray-300 pb-1 mb-4">{t("Official Stamp")}</p>
                        <div className="h-10 invisible">{t("Stamp Space")}</div>
                        <p className="mt-2 text-gray-500 font-bold tracking-tight uppercase">{businessName} {t("MANAGEMENT")}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
