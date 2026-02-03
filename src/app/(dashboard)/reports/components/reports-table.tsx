import React from "react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Printer, FileSpreadsheet, FileText } from "lucide-react";
import { exportToExcel, exportToPDF, extractTextFromReact } from "@/lib/export-utils";
import { cn } from "@/lib/utils";
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
}: ReportTableProps<T>) {
    const handlePrint = () => {
        window.print();
    };

    // Pagination calculations
    const startIndex = pagination ? (pagination.currentPage - 1) * pagination.rowsPerPage : 0;
    const endIndex = pagination ? Math.min(startIndex + pagination.rowsPerPage, pagination.totalItems) : data.length;

    return (
        <div className={cn("space-y-4 h-full flex flex-col", compact && "space-y-2")}>
            <div className="flex items-center justify-between">
                <div>
                    <h2 className={cn("text-sm font-black uppercase tracking-widest text-primary italic leading-none", compact && "text-[11px]")}>{title}</h2>
                    {subtitle && <p className={cn("text-[10px] text-muted-foreground font-bold mt-1 uppercase tracking-tighter", compact && "text-[9px] mt-0.5")}>{subtitle}</p>}
                </div>
                <div className="flex items-center gap-2 print:hidden">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportToExcel(data, columns as any, title.replace(/\s+/g, "_").toLowerCase())}
                        className={cn("h-7 px-3 gap-2 text-[10px] font-black uppercase border-emerald-600/20 text-emerald-700 hover:bg-emerald-50", compact && "h-6 px-2 text-[8px]")}
                    >
                        <FileSpreadsheet className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> Excel
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportToPDF(data, columns as any, title.replace(/\s+/g, "_").toLowerCase(), title, summaryData)}
                        className={cn("h-7 px-3 gap-2 text-[10px] font-black uppercase border-red-600/20 text-red-700 hover:bg-red-50", compact && "h-6 px-2 text-[8px]")}
                    >
                        <FileText className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint} className={cn("h-7 px-3 gap-2 text-[10px] font-black uppercase border-muted-foreground/20", compact && "h-6 px-2 text-[8px]")}>
                        <Printer className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} /> Print
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border bg-card/50">
                <div className="min-w-[800px] lg:min-w-0">
                    <Table>
                        <TableHeader className="bg-primary/5 sticky top-0 z-10 border-b-2 border-primary/20">
                            <TableRow className="hover:bg-transparent">
                                {columns.map((col, idx) => (
                                    <TableHead key={idx} className={cn("font-black text-primary uppercase text-[10px] tracking-wider py-4", compact && "py-2 text-[9px]", col.className)}>
                                        {col.header}
                                    </TableHead>
                                ))}
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
                                    </TableRow>
                                ))
                            ) : data.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={columns.length} className="h-32 text-center text-muted-foreground">
                                        No data found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                data.map((item, rowIdx) => (
                                    <TableRow key={rowIdx} className="hover:bg-muted/30 transition-colors">
                                        {columns.map((col, colIdx) => (
                                            <TableCell key={colIdx} className={cn("py-3 text-[11px]", compact && "py-1.5 text-[10px]", col.className)}>
                                                {typeof col.accessor === "function"
                                                    ? col.accessor(item)
                                                    : (item[col.accessor] as React.ReactNode)}
                                            </TableCell>
                                        ))}
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
                        <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">Rows</p>
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
                        <div className="text-[10px] font-black uppercase tracking-tighter text-primary">
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
                    
                    /* Show ONLY the print container */
                    #report-print-container { 
                        visibility: visible !important;
                        display: block !important; 
                        position: absolute !important;
                        left: 0 !important;
                        top: 0 !important;
                        width: 100% !important;
                        margin: 0 !important;
                        padding: 0 !important;
                    }
                    
                    #report-print-container * { 
                        visibility: visible !important; 
                        -webkit-print-color-adjust: exact !important;
                        print-color-adjust: exact !important;
                    }

                    @page { margin: 0; size: auto; }
                    
                    #report-print-container {
                        padding: 1.5cm !important;
                    }
                    
                    .print-break-inside-avoid {
                        page-break-inside: avoid;
                    }
                }
            `}</style>

            {/* HIDDEN PRINT CONTENT */}
            {/* HIDDEN PRINT CONTENT */}
            {/* HIDDEN PRINT CONTENT */}
            <div id="report-print-container" className="hidden print:block bg-white text-black p-4 min-h-screen">
                {/* OFFICIAL TIENS HEADER (Matching Receipt Style) */}
                <div className="pb-6 border-b-2 border-emerald-600 mb-6 font-sans">
                    <div className="flex justify-between items-start">
                        <div className="flex-1 text-center">
                            <h2 className="text-3xl font-black text-emerald-800 tracking-tight uppercase">TIENS HEALTH PRODUCTS</h2>
                            <p className="text-[11px] leading-tight font-bold text-gray-600">6th Floor, King Fahd Plaza, Plot 52 Kampala Rd</p>
                            <p className="text-[11px] font-bold text-gray-500">P.O.Box .... Kampala, Tel: +256 (0) 702 794 458 | 0773 662 136</p>
                            <div className="mt-2 inline-block px-4 py-1 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
                                OFFICIAL {title}
                            </div>
                        </div>
                        <div className="w-[80px] h-[80px]">
                            <img src="/logo.ico" alt="TIENS Logo" className="w-full h-full object-contain" />
                        </div>
                    </div>
                </div>

                {/* SUMMARY CARDS IN PRINT */}
                {summaryData && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-8 border-b-2 border-gray-100 pb-8">
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-black text-[#008542] uppercase tracking-widest">Total Sales</p>
                            <p className="text-sm font-black text-black">UGX {summaryData.totalRevenue.toLocaleString()}</p>
                            <p className="text-[8px] font-bold text-gray-400 italic font-mono">{summaryData.totalSalesCount || 0} Items Sold</p>
                        </div>
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-black text-[#008542] uppercase tracking-widest">Tied PV/BV</p>
                            <p className="text-sm font-black text-black">{summaryData.totalPV.toLocaleString()} PV</p>
                            <p className="text-[8px] font-bold text-gray-400 italic font-mono">{summaryData.totalBV.toLocaleString()} BV</p>
                        </div>
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-black text-[#008542] uppercase tracking-widest">Net Profit</p>
                            <p className="text-sm font-black text-black">UGX {summaryData.totalProfit.toLocaleString()}</p>
                            <p className="text-[8px] font-bold text-gray-400 italic font-mono">After Expenses</p>
                        </div>
                        <div className="flex flex-col gap-1">
                            <p className="text-[10px] font-black text-[#008542] uppercase tracking-widest">Stock Value</p>
                            <p className="text-sm font-black text-black">UGX {summaryData.totalInventorySellingPrice.toLocaleString()}</p>
                            <p className="text-[8px] font-bold text-gray-400 italic font-mono">Est. Revenue</p>
                        </div>
                    </div>
                )}

                <div className="mb-4">
                    <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">{title}</h3>
                    {subtitle && <p className="text-[10px] font-bold text-gray-500 uppercase mt-0.5 tracking-wide">{subtitle}</p>}
                </div>

                <table className="w-full border-collapse border border-gray-300 print:text-[10px]">
                    <thead>
                        <tr className="!bg-[#008542] !print:bg-[#008542] border-b-2 border-emerald-800">
                            <th className="px-1 py-3 text-center font-black uppercase text-[10px] border-r border-emerald-700 w-8 text-white !print:text-white">#</th>
                            {columns.map((col, idx) => (
                                <th
                                    key={idx}
                                    className={cn(
                                        "px-3 py-2 text-[10px] border-r border-gray-300 last:border-0 !text-white !print:text-white",
                                        // Filter alignment: only keep text-center, text-right, text-left
                                        // This ensures it stays white even if col.className has text-primary
                                        col.className?.split(" ").filter(c =>
                                            c === "text-center" || c === "text-right" || c === "text-left" || (!c.startsWith("text-") && !c.startsWith("bg-"))
                                        ).join(" "),
                                        // Override global text-left if center/right is provided in col.className
                                        (col.className?.includes("text-center") || col.className?.includes("text-right")) ? "" : "text-left"
                                    )}
                                >
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item, rowIdx) => (
                            <tr key={rowIdx} className={cn("border-b border-gray-200", rowIdx % 2 === 1 ? "bg-gray-50" : "bg-white")}>
                                <td className="px-1 py-2 text-[10px] border-r border-gray-300 text-center font-bold text-gray-500 w-8">{rowIdx + 1}</td>
                                {columns.map((col, colIdx) => (
                                    <td
                                        key={colIdx}
                                        className={cn(
                                            "px-3 py-2 text-[10px] border-r border-gray-300 last:border-0 !text-black font-medium whitespace-pre-line",
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

                <div className="mt-8 flex justify-between text-[10px] font-bold text-gray-400 italic">
                    <span>Generated by System on {new Date().toLocaleString()}</span>
                    <span>Verified Official Document</span>
                </div>

                <div className="mt-12 grid grid-cols-2 gap-12 text-[10px] print-break-inside-avoid">
                    <div className="border-t-2 border-gray-200 pt-4">
                        <p className="font-black uppercase tracking-widest text-gray-800 border-b border-dashed border-gray-300 pb-1 mb-4">Authorized Signature</p>
                        <div className="h-10 text-gray-300">Space for signature</div>
                        <p className="mt-2 text-gray-500 font-bold">DATE: ________________________</p>
                    </div>
                    <div className="border-t-2 border-gray-200 pt-4 text-right">
                        <p className="font-black uppercase tracking-widest text-gray-800 border-b border-dashed border-gray-300 pb-1 mb-4">Official Stamp</p>
                        <div className="h-10 invisible">Stamp Space</div>
                        <p className="mt-2 text-gray-500 font-bold tracking-tight uppercase">TIENS HEALTH PRODUCTS CENTER</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
