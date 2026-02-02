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
import { exportToExcel, exportToPDF } from "@/lib/export-utils";
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
}

export function ReportTable<T>({
    title,
    subtitle,
    columns,
    data,
    isLoading,
    pagination,
    footer,
}: ReportTableProps<T>) {
    const handlePrint = () => {
        window.print();
    };

    // Pagination calculations
    const startIndex = pagination ? (pagination.currentPage - 1) * pagination.rowsPerPage : 0;
    const endIndex = pagination ? Math.min(startIndex + pagination.rowsPerPage, pagination.totalItems) : data.length;

    return (
        <div className="space-y-4 h-full flex flex-col">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-sm font-black uppercase tracking-widest text-primary italic leading-none">{title}</h2>
                    {subtitle && <p className="text-[10px] text-muted-foreground font-bold mt-1 uppercase tracking-tighter">{subtitle}</p>}
                </div>
                <div className="flex items-center gap-2 print:hidden">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportToExcel(data, columns as any, title.replace(/\s+/g, "_").toLowerCase())}
                        className="h-7 px-3 gap-2 text-[10px] font-black uppercase border-emerald-600/20 text-emerald-700 hover:bg-emerald-50"
                    >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportToPDF(data, columns as any, title.replace(/\s+/g, "_").toLowerCase(), title)}
                        className="h-7 px-3 gap-2 text-[10px] font-black uppercase border-red-600/20 text-red-700 hover:bg-red-50"
                    >
                        <FileText className="h-3.5 w-3.5" /> PDF
                    </Button>
                    <Button variant="outline" size="sm" onClick={handlePrint} className="h-7 px-3 gap-2 text-[10px] font-black uppercase border-muted-foreground/20">
                        <Printer className="h-3.5 w-3.5" /> Print
                    </Button>
                </div>
            </div>

            <div className="flex-1 overflow-auto rounded-xl border bg-card/50">
                <div className="min-w-[800px] lg:min-w-0">
                    <Table>
                        <TableHeader className="bg-primary/5 sticky top-0 z-10 border-b-2 border-primary/20">
                            <TableRow className="hover:bg-transparent">
                                {columns.map((col, idx) => (
                                    <TableHead key={idx} className={cn("font-black text-primary uppercase text-[10px] tracking-wider py-4", col.className)}>
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
                                            <TableCell key={colIdx} className={cn("py-3 text-[11px]", col.className)}>
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
                    }

                    @page { margin: 1.5cm; size: auto; }
                    
                    .print-break-inside-avoid {
                        page-break-inside: avoid;
                    }
                }
            `}</style>

            {/* HIDDEN PRINT CONTENT */}
            {/* HIDDEN PRINT CONTENT */}
            <div id="report-print-container" className="hidden print:block bg-white text-black p-8">
                {/* OFFICIAL TIENS BANNER */}
                <div className="flex flex-col items-center mb-10 pb-6 border-b-4 border-emerald-600 print-break-inside-avoid">
                    <h1 className="text-3xl font-black uppercase tracking-tighter text-emerald-800">TIENS HEALTH PRODUCTS</h1>
                    <div className="flex items-center gap-4 mt-2">
                        <span className="h-px w-10 bg-emerald-600/30"></span>
                        <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-600">OFFICIAL {title}</p>
                        <span className="h-px w-10 bg-emerald-600/30"></span>
                    </div>
                    <div className="mt-4 flex justify-between w-full text-[9px] font-bold text-gray-400 px-4">
                        <span>GENERATED: {new Date().toLocaleString()}</span>
                        <span>INTERNAL SECURITY DOCUMENT</span>
                    </div>
                </div>

                <div className="mb-6">
                    <h2 className="text-xl font-black text-gray-900 uppercase tracking-tight">{title}</h2>
                    {subtitle && <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mt-1">{subtitle}</p>}
                </div>

                <table className="w-full border-collapse">
                    <thead>
                        <tr className="bg-emerald-600 text-white">
                            {columns.map((col, idx) => (
                                <th key={idx} className={cn("px-4 py-3 text-left font-black uppercase text-[10px] border-r border-emerald-500 last:border-0", col.className)}>
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item, rowIdx) => (
                            <tr key={rowIdx} className="border-b last:border-b-2 border-gray-100">
                                {columns.map((col, colIdx) => (
                                    <td key={colIdx} className={cn("px-4 py-2 text-[10px] border-r border-gray-50 last:border-0", col.className)}>
                                        {(col as any).exportValue
                                            ? (col as any).exportValue(item)
                                            : (typeof col.accessor === "function"
                                                ? (col as any).accessor(item)
                                                : (item as any)[col.accessor as string])}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="mt-8 grid grid-cols-2 gap-8 text-[10px] print-break-inside-avoid">
                    <div className="border-t border-black pt-2">
                        <p className="font-bold">Authorized Signatory</p>
                        <div className="h-12" />
                        <p>Name: ________________________</p>
                    </div>
                    <div className="border-t border-black pt-2 text-right">
                        <p className="font-bold">Office Stamp</p>
                        <div className="h-12" />
                        <p>Date: {new Date().toLocaleDateString()}</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
