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
import { ChevronLeft, ChevronRight, Printer } from "lucide-react";
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
            <div className="flex items-center justify-between border-b pb-4">
                <div>
                    <h2 className="text-xl font-bold tracking-tight">{title}</h2>
                    {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
                </div>
                <div className="flex items-center gap-2">
                    <Button onClick={handlePrint} className="gap-2 shrink-0">
                        <Printer className="h-4 w-4" /> Print
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
                    /* Hide everything by default */
                    body > * { display: none !important; }
                    
                    /* Show ONLY the print container */
                    #report-print-container { 
                        display: block !important; 
                        position: static !important;
                        width: 100% !important;
                        height: auto !important;
                        background: white !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }
                    
                    #report-print-container * { 
                        visibility: visible !important; 
                    }

                    @page { margin: 1cm; size: auto; }
                    
                    .print-break-inside-avoid {
                        page-break-inside: avoid;
                    }
                }
            `}</style>

            {/* HIDDEN PRINT CONTENT */}
            <div id="report-print-container" className="hidden print:block text-black">
                <div className="text-center mb-8 pb-4 border-b-2 border-black print-break-inside-avoid">
                    <h1 className="text-2xl font-black uppercase tracking-widest">TIENS HEALTH PRODUCTS</h1>
                    <p className="text-sm font-bold mt-1 uppercase">Official {title}</p>
                    {subtitle && <p className="text-xs italic mt-1">{subtitle}</p>}
                    <div className="mt-4 flex justify-between text-[10px] font-medium">
                        <span>Printed on: {new Date().toLocaleString()}</span>
                        <span>System Generated Report</span>
                    </div>
                </div>

                <table className="w-full border-collapse text-[10px]">
                    <thead>
                        <tr className="bg-gray-100 border-y-2 border-black">
                            {columns.map((col, idx) => (
                                <th key={idx} className={cn("px-2 py-2 text-left font-black uppercase border border-black", col.className)}>
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((item, rowIdx) => (
                            <tr key={rowIdx} className="border-b border-gray-300">
                                {columns.map((col, colIdx) => (
                                    <td key={colIdx} className={cn("px-2 py-1.5 border border-gray-300", col.className)}>
                                        {typeof col.accessor === "function"
                                            ? col.accessor(item)
                                            : (item[col.accessor] as React.ReactNode)}
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
