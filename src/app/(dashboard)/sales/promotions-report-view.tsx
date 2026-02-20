"use client";

import React, { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, startOfDay, endOfDay, startOfMonth } from "date-fns";
import { toast } from "sonner";
import { exportToExcel, exportToPDF, extractTextFromReact } from "@/lib/export-utils";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Calendar as CalendarIcon, Loader2, Printer, Download, FileSpreadsheet, FileText, ChevronLeft, ChevronRight } from "lucide-react";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";

export function PromotionsReportView() {
    const { user } = useAuth();
    const [dateMode, setDateMode] = useState<"audit" | "range">("audit");
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [currentPage, setCurrentPage] = useState(1);

    // Persist rowsPerPage
    useEffect(() => {
        const saved = localStorage.getItem("pos_promotions_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
    }, []);

    const queryArgs = {
        email: user?.email,
        from: dateMode === "audit" ? (selectedDate ? startOfDay(selectedDate).toISOString() : undefined) : date?.from?.toISOString(),
        to: dateMode === "audit" ? (selectedDate ? endOfDay(selectedDate).toISOString() : undefined) : date?.to?.toISOString(),
    };

    // 1. Stats
    const stats = useQuery(api.promotions.redemptionsStats, queryArgs);

    // 2. Paginated List
    const { results, status, loadMore } = usePaginatedQuery(
        api.promotions.listRedemptions,
        queryArgs,
        { initialNumItems: rowsPerPage }
    );

    const columns = [
        {
            header: "Date",
            accessor: (r: any) => format(new Date(r.date), "dd/MM/yyyy HH:mm"),
        },
        {
            header: "Promotion",
            accessor: "promotionName",
        },
        {
            header: "Product",
            accessor: "productName",
        },
        {
            header: "Qty",
            accessor: "redeemedQuantity",
        },
        {
            header: "Prize",
            accessor: "prize",
        },
        {
            header: "Customer",
            accessor: "customerName",
        },
        {
            header: "Operator",
            accessor: "operatorName",
        }
    ];

    const handlePrint = () => {
        const style = document.createElement('style');
        style.id = 'print-style-temp';
        style.innerHTML = `
            @media print {
                body * { visibility: hidden !important; }
                #promotions-report-print, #promotions-report-print * { visibility: visible !important; }
                #promotions-report-print { 
                    position: absolute !important; 
                    left: 0 !important; 
                    top: 0 !important; 
                    width: 100% !important; 
                    display: block !important; 
                    padding: 15mm !important;
                    background: white !important;
                }
                @page { size: A5; margin: 5mm; }
            }
        `;
        document.head.appendChild(style);
        window.print();
        setTimeout(() => {
            const el = document.getElementById('print-style-temp');
            if (el) el.remove();
        }, 1000);
    };

    const fmt = (n: number) => n?.toLocaleString() ?? "0";

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Filters & Export Buttons */}
            <div className="flex flex-wrap items-center gap-4 bg-muted/20 p-3 rounded-xl border shadow-sm print:hidden">
                <div className="flex items-center gap-3">
                    <Tabs value={dateMode} onValueChange={(v: any) => setDateMode(v)} className="w-auto">
                        <TabsList className="h-9 p-1 bg-linear-to-b from-muted double border shadow-xs rounded-lg">
                            <TabsTrigger value="audit" className="text-[10px] font-bold uppercase tracking-wider h-7 px-3">Daily Audit</TabsTrigger>
                            <TabsTrigger value="range" className="text-[10px] font-bold uppercase tracking-wider h-7 px-3">Date Range</TabsTrigger>
                        </TabsList>
                    </Tabs>

                    {dateMode === "audit" ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal h-9 bg-white", !selectedDate && "text-muted-foreground")}>
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar mode="single" selected={selectedDate} onSelect={setSelectedDate} initialFocus />
                            </PopoverContent>
                        </Popover>
                    ) : (
                        <DatePickerWithRange date={date} setDate={setDate} />
                    )}
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => exportToExcel(results || [], columns as any, "Promotions_Report")}
                        className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-emerald-600/20 text-emerald-700 hover:bg-emerald-50 bg-white"
                    >
                        <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                            const summaryStats = [
                                { title: "Total Redemptions", value: fmt(stats?.totalRedemptions || 0), description: "Times prize won" },
                                { title: "Unique Customers", value: fmt(stats?.uniqueCustomers || 0), description: "Beneficiaries" },
                                { title: "Unique Products", value: fmt(stats?.uniqueProducts || 0), description: "Driving items" }
                            ];

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

                            exportToPDF(results || [], columns as any, "Promotions_Report", "Promotions Redemptions Report", summaryStats, logoBase64);
                        }}
                        className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-red-600/20 text-red-700 hover:bg-red-50 bg-white"
                    >
                        <FileText className="h-3.5 w-3.5" /> PDF
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={handlePrint}
                        className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-muted-foreground/20 bg-white"
                    >
                        <Printer className="h-3.5 w-3.5" /> Print
                    </Button>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 print:hidden">
                <Card className="bg-primary/5 border-primary/20 shadow-sm">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Redemptions</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{fmt(stats?.totalRedemptions || 0)}</div>
                        <p className="text-[10px] text-muted-foreground mt-1">Total times promotions were triggered</p>
                    </CardContent>
                </Card>

                <Card className="bg-emerald-50/50 border-emerald-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-700 uppercase tracking-wider">Unique Customers</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">{fmt(stats?.uniqueCustomers || 0)}</div>
                        <p className="text-[10px] text-emerald-600/70 mt-1">Number of customers who won prizes</p>
                    </CardContent>
                </Card>

                <Card className="bg-orange-50/50 border-orange-100">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-orange-700 uppercase tracking-wider">Products Source</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-orange-600">{fmt(stats?.uniqueProducts || 0)}</div>
                        <p className="text-[10px] text-orange-600/70 mt-1">Number of unique products involved</p>
                    </CardContent>
                </Card>
            </div>

            {/* Redemptions Table */}
            <div className="flex-1 border rounded-md overflow-hidden bg-background flex flex-col">
                <div className="flex-1 overflow-auto">
                    <Table>
                        <TableHeader className="sticky top-0 bg-background z-10">
                            <TableRow>
                                <TableHead>Date</TableHead>
                                <TableHead>Promotion</TableHead>
                                <TableHead>Product</TableHead>
                                <TableHead className="text-center">Qty</TableHead>
                                <TableHead>Prize</TableHead>
                                <TableHead>Customer</TableHead>
                                <TableHead>Operator</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {status === "LoadingFirstPage" ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center">
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin inline" />
                                        Loading...
                                    </TableCell>
                                </TableRow>
                            ) : results.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={7} className="h-24 text-center text-muted-foreground">
                                        No redemptions found.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                results.map((record) => (
                                    <TableRow key={record._id} className="hover:bg-muted/5">
                                        <TableCell className="text-xs">{format(new Date(record.date), "dd/MM/yyyy HH:mm")}</TableCell>
                                        <TableCell className="font-medium text-xs">{record.promotionName}</TableCell>
                                        <TableCell className="text-xs">{record.productName}</TableCell>
                                        <TableCell className="text-center text-xs">{record.redeemedQuantity}</TableCell>
                                        <TableCell className="text-xs">{record.prize}</TableCell>
                                        <TableCell className="text-xs">{record.customerName}</TableCell>
                                        <TableCell className="text-xs">{record.operatorName}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>

                {/* Pagination (Similar to MySalesView) */}
                <div className="flex items-center justify-end border-t bg-muted/20 px-4 py-4 space-x-2 print:hidden">
                    <div className="flex items-center space-x-2 mr-auto">
                        <p className="text-xs font-medium uppercase tracking-tighter">Rows per page</p>
                        <Select
                            value={`${rowsPerPage}`}
                            onValueChange={(value) => {
                                const newSize = Number(value);
                                setRowsPerPage(newSize);
                                localStorage.setItem("pos_promotions_rows_per_page", String(newSize));
                            }}
                        >
                            <SelectTrigger className="h-8 w-[70px] bg-white">
                                <SelectValue placeholder={rowsPerPage} />
                            </SelectTrigger>
                            <SelectContent side="top">
                                {[10, 20, 50, 100].map((pageSize) => (
                                    <SelectItem key={pageSize} value={`${pageSize}`}>
                                        {pageSize}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {status === "CanLoadMore" && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => loadMore(rowsPerPage)}
                            className="h-8 px-3 text-xs"
                        >
                            Load More
                        </Button>
                    )}
                </div>
            </div>

            {/* HIDDEN PRINT CONTENT */}
            <div id="promotions-report-print" className="hidden print:report-print-view bg-white text-black p-4 min-h-screen">
                <div className="pb-6 border-b-2 border-emerald-600 mb-6 font-sans relative">
                    <div className="text-center px-20">
                        <h2 className="text-3xl font-black text-emerald-800 tracking-tight uppercase mb-1">TIENS HEALTH PRODUCTS</h2>
                        <p className="text-[11px] leading-tight font-bold text-gray-600">6th Floor, King Fahd Plaza, Plot 52 Kampala Rd</p>
                        <p className="text-[11px] font-bold text-gray-500">P.O.Box .... Kampala, Tel: +256 (0) 702 794 458 | 0773 662 136</p>
                        <div className="mt-2 inline-block px-4 py-1 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
                            OFFICIAL PROMOTIONS REDEMPTIONS REPORT
                        </div>
                    </div>
                    <div className="absolute right-0 top-0 h-full flex items-start pt-1">
                        <img src="/logo.ico" alt="Logo" className="h-20 w-20 object-contain" />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 border-b border-gray-100 pb-4">
                    <div className="flex flex-col pl-4 border-l border-gray-100 first:pl-0 first:border-0">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">TOTAL REDEMPTIONS</p>
                        <p className="text-xs font-black text-black">{fmt(stats?.totalRedemptions || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Total prizes given</p>
                    </div>
                    <div className="flex flex-col pl-4 border-l border-gray-100">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">UNIQUE CUSTOMERS</p>
                        <p className="text-xs font-black text-black">{fmt(stats?.uniqueCustomers || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Unique beneficiaries</p>
                    </div>
                    <div className="flex flex-col pl-4 border-l border-gray-100">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">PRODUCTS SOURCE</p>
                        <p className="text-xs font-black text-black">{fmt(stats?.uniqueProducts || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Different products triggered</p>
                    </div>
                </div>

                <div className="mb-4">
                    <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Redemption Records</h3>
                    <p className="text-[10px] font-bold text-gray-500 uppercase mt-0.5 tracking-wide">
                        {dateMode === "audit" ? `Audit Date: ${format(selectedDate || new Date(), "PPP")}` : `Range: ${format(date?.from || new Date(), "PP")} - ${format(date?.to || new Date(), "PP")}`}
                    </p>
                </div>

                <table className="w-full border-collapse border border-gray-300 print:text-[10px]">
                    <thead>
                        <tr className="bg-[#008542] border-b-2 border-emerald-800">
                            <th className="px-1 py-3 text-center font-black uppercase text-[10px] border-r border-emerald-700 w-8 text-white">#</th>
                            {columns.map((col, idx) => (
                                <th key={idx} className="px-3 py-2 text-[10px] border-r border-gray-300 last:border-0 text-white text-left font-black uppercase">
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {(results || []).map((item, rowIdx) => (
                            <tr key={rowIdx} className={rowIdx % 2 === 1 ? "bg-gray-50" : "bg-white"}>
                                <td className="px-1 py-2 text-[10px] border-r border-gray-300 text-center font-bold text-gray-500 w-8">{rowIdx + 1}</td>
                                {columns.map((col, colIdx) => (
                                    <td key={colIdx} className="px-3 py-2 text-[10px] border-r border-gray-300 last:border-0 text-black font-medium whitespace-pre-line">
                                        {typeof col.accessor === "function"
                                            ? extractTextFromReact(col.accessor(item))
                                            : (item as any)[col.accessor as any]}
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
            </div>
        </div>
    );
}
