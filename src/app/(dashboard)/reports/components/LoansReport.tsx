"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";

export function LoansReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [search, setSearch] = useState("");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    const loansArgs = {
        startDate: dateRange.from,
        endDate: dateRange.to
    };

    const { results: loansRecords, status: loansStatus, loadMore: loadMoreLoans, isLoading: loansLoading } = usePaginatedQuery(
        api.reports.getLoanSummary,
        loansArgs,
        { initialNumItems: rowsPerPage }
    );

    const totalLoansCount = useQuery(api.reports.getLoanSummaryCount, loansArgs) || 0;
    const summaryData = useQuery(api.reports.getReportsSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        search: search || undefined
    });

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-3 bg-white p-3 rounded-xl border shadow-xs">
                <div className="flex items-center justify-between gap-3">
                    <ReportFilters
                        dateRange={dateRange}
                        reportMode={reportMode}
                        onDateRangeChange={setDateRange}
                        onReportModeChange={setReportMode}
                    />
                    <div className="text-[10px] font-black text-muted-foreground italic px-3 bg-muted/20 h-8 flex items-center rounded-lg">
                        CREDIT OVERSIGHT
                    </div>
                </div>

                <div className="relative w-full">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search debtors by name or phone..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-9 text-xs border-muted-foreground/10 bg-muted/5 focus:bg-white transition-all"
                    />
                </div>
            </div>

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} />

            <ReportTable
                title="Outstanding Loans Report"
                subtitle="Detailed tracking of credit-based sales and debtor balances."
                data={loansRecords?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                summaryData={summaryData || undefined}
                isLoading={loansLoading}
                search={search}
                pagination={{
                    currentPage: page,
                    totalPages: Math.ceil(totalLoansCount / rowsPerPage),
                    rowsPerPage: rowsPerPage,
                    onRowsPerPageChange: (rows) => {
                        setRowsPerPage(rows);
                        setPage(1);
                        localStorage.setItem("pos_reports_loans_rows", String(rows));
                    },
                    totalItems: totalLoansCount,
                    onNext: () => {
                        const totalPages = Math.ceil(totalLoansCount / rowsPerPage);
                        if (page < totalPages) setPage(p => p + 1);
                    },
                    onPrev: () => setPage(p => Math.max(1, p - 1)),
                    canLoadMore: loansStatus === "CanLoadMore"
                }}
                columns={[
                    {
                        header: "Date/Time",
                        accessor: (l: any) => (
                            <div className="font-mono leading-tight">
                                <div className="font-black">{format(new Date(l.date || l._creationTime), "dd MMM yyyy")}</div>
                                <div className="text-[9px] text-muted-foreground">{format(new Date(l.date || l._creationTime), "HH:mm")}</div>
                            </div>
                        )
                    },
                    {
                        header: "Debtor Info",
                        accessor: (l: any) => (
                            <div className="space-y-1">
                                <div className="flex gap-1 flex-wrap">
                                    <Badge variant={l.clientType === "HP Client" ? "secondary" : "outline"} className="text-[9px] h-4">
                                        {l.clientType}
                                    </Badge>
                                    <Badge variant="destructive" className="text-[9px] h-4">
                                        Loan
                                    </Badge>
                                </div>
                                <div className="text-[10px] font-black text-primary truncate max-w-[120px]">
                                    {l.customerName}
                                </div>
                                <div className="text-[9px] font-medium text-muted-foreground italic">
                                    {l.customerPhone}
                                </div>
                            </div>
                        )
                    },
                    {
                        header: "Items (Qty x Name)",
                        accessor: (l: any) => (
                            <div className="space-y-1 max-w-[300px]">
                                {(l.items || []).map((item: any, idx: number) => (
                                    <div key={idx} className="text-[10px] flex justify-between gap-4 border-b border-dashed border-muted pb-0.5 last:border-0">
                                        <span className="truncate">
                                            <span className="font-black text-primary mr-1">{item.quantity}x</span>
                                            {item.name}
                                        </span>
                                        <span className="text-muted-foreground shrink-0 font-medium">[{item.pv} PV / {item.bv} BV]</span>
                                    </div>
                                ))}
                            </div>
                        ),
                        className: "min-w-[200px]"
                    },
                    {
                        header: "Balances",
                        accessor: (l: any) => (
                            <div className="text-right space-y-0.5 font-mono">
                                <div className="text-[9px] text-muted-foreground">Original: {(l.totalAmount || 0).toLocaleString()}</div>
                                <div className="font-black text-destructive text-xs">Due: {(l.balance || 0).toLocaleString()}</div>
                                {l.dueDate && (
                                    <div className="text-[8px] font-bold text-orange-600 bg-orange-50 px-1 py-0.5 rounded inline-block">
                                        Due: {format(new Date(l.dueDate), "dd MMM")}
                                    </div>
                                )}
                            </div>
                        ),
                        className: "text-right"
                    },
                    {
                        header: "Status",
                        accessor: (l: any) => (
                            <Badge variant={(l.balance || 0) > 0 ? "destructive" : "outline"} className="text-[9px] uppercase font-black tracking-tighter">
                                {(l.balance || 0) > 0 ? "Outstanding" : "Cleared"}
                            </Badge>
                        ),
                        className: "text-center"
                    }
                ]}
            />
        </div>
    );
}
