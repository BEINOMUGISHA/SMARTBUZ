"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths, parseISO } from "date-fns";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";

export function DetailedSalesReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [clientType, setClientType] = useState<string>("All");
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    const shops = useQuery(api.shops.listAll);

    const salesArgs = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: selectedShop === "all" ? undefined : (selectedShop as any),
        clientType: clientType === "All" ? undefined : clientType,
    };

    const { results: salesRecords, status: salesStatus, loadMore: loadMoreSales, isLoading: salesLoading } = usePaginatedQuery(
        api.reports.getDetailedSalesReport,
        salesArgs,
        { initialNumItems: rowsPerPage }
    );

    const totalSalesCount = useQuery(api.reports.getDetailedSalesReportCount, salesArgs) || 0;

    useEffect(() => {
        if (salesStatus === "CanLoadMore" && salesRecords.length < (page * rowsPerPage)) {
            loadMoreSales(rowsPerPage);
        }
    }, [page, rowsPerPage, salesRecords.length, salesStatus, loadMoreSales]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 bg-white p-3 rounded-xl border shadow-xs">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <ReportFilters
                        dateRange={dateRange}
                        reportMode={reportMode}
                        onDateRangeChange={setDateRange}
                        onReportModeChange={setReportMode}
                    />

                    <div className="flex items-center gap-2 ml-auto">
                        <Select value={selectedShop} onValueChange={setSelectedShop}>
                            <SelectTrigger className="w-[160px] h-8 text-[10px] font-bold border-muted-foreground/20">
                                <SelectValue placeholder="All Branches" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Branches</SelectItem>
                                {shops?.map(s => (
                                    <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={clientType} onValueChange={setClientType}>
                            <SelectTrigger className="w-[130px] h-8 text-[10px] font-bold border-muted-foreground/20">
                                <SelectValue placeholder="All Clients" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">All Clients</SelectItem>
                                <SelectItem value="Member">Regular Member</SelectItem>
                                <SelectItem value="HP Client">HP Client</SelectItem>
                                <SelectItem value="Walk-in">Walk-in</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="relative w-full">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search within records (name, transaction ID...)"
                        className="pl-9 h-9 text-xs border-muted-foreground/10 bg-muted/5 focus:bg-white transition-all"
                    />
                </div>
            </div>

            <ReportTable
                title="Comprehensive Sales Report"
                subtitle="Complete itemized transaction history."
                data={salesRecords?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={salesLoading}
                pagination={{
                    currentPage: page,
                    totalPages: Math.ceil(totalSalesCount / rowsPerPage),
                    rowsPerPage: rowsPerPage,
                    onRowsPerPageChange: (rows) => {
                        setRowsPerPage(rows);
                        setPage(1);
                        localStorage.setItem("pos_reports_sales_rows", String(rows));
                    },
                    totalItems: totalSalesCount,
                    onNext: () => {
                        const totalPages = Math.ceil(totalSalesCount / rowsPerPage);
                        if (page < totalPages) setPage(p => p + 1);
                    },
                    onPrev: () => setPage(p => Math.max(1, p - 1)),
                    canLoadMore: salesStatus === "CanLoadMore"
                }}
                columns={[
                    {
                        header: "Date/Time",
                        accessor: (s: any) => (
                            <div className="font-mono leading-tight">
                                <div className="font-black">{format(new Date(s._creationTime), "dd MMM yyyy")}</div>
                                <div className="text-[9px] text-muted-foreground">{format(new Date(s._creationTime), "HH:mm:ss")}</div>
                            </div>
                        )
                    },
                    {
                        header: "Client Name",
                        accessor: "customerName",
                        className: "font-black text-primary"
                    },
                    {
                        header: "Type",
                        accessor: "clientType",
                        className: "text-[9px] uppercase font-black text-muted-foreground"
                    },
                    {
                        header: "Items Sold",
                        accessor: (s: any) => (
                            <div className="flex flex-col gap-0.5 py-1">
                                {s.items.map((item: any, idx: number) => (
                                    <div key={idx} className="text-[9px] leading-tight flex items-center gap-2">
                                        <span className="font-black text-primary min-w-[15px]">{item.quantity}x</span>
                                        <span className="truncate max-w-[120px]">{item.name}</span>
                                    </div>
                                ))}
                            </div>
                        ),
                        exportValue: (s: any) => `${s.items.reduce((acc: number, item: any) => acc + item.quantity, 0)} Items`
                    },
                    {
                        header: "Total PV",
                        accessor: (s: any) => {
                            const total = s.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0);
                            return <span className="font-black text-amber-600">{total.toLocaleString()}</span>;
                        },
                        className: "text-center bg-amber-50/20"
                    },
                    {
                        header: "Total BV",
                        accessor: (s: any) => {
                            const total = s.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0);
                            return <span className="font-black text-blue-600">{total.toLocaleString()}</span>;
                        },
                        className: "text-center bg-blue-50/20"
                    },
                    {
                        header: "Total (UGX)",
                        accessor: (s: any) => (
                            <span className="font-black text-gray-900">{s.total.toLocaleString()}</span>
                        ),
                        className: "text-right"
                    },
                    {
                        header: "Branch",
                        accessor: "shopName",
                        className: "text-[10px] font-bold"
                    },
                    {
                        header: "Pay Mode",
                        accessor: (s: any) => (
                            <Badge variant={s.paymentMode === "Loan" ? "destructive" : "outline"} className="text-[9px] h-4 font-black">
                                {s.paymentMode || "Cash"}
                            </Badge>
                        ),
                        className: "text-center"
                    }
                ]}
            />
        </div>
    );
}
