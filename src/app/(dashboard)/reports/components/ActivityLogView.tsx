"use client";

import { useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Badge } from "@/components/ui/badge";
import { format, startOfDay, endOfDay, parseISO } from "date-fns";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";

export function ActivityLogView() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("daily");
    const [dateRange, setDateRange] = useState({
        from: format(new Date(), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [rowsPerPage, setRowsPerPage] = useState(20);
    const [page, setPage] = useState(1);

    const queryArgs = {
        paginationOpts: { numItems: rowsPerPage, cursor: null },
        startDate: dateRange.from ? startOfDay(parseISO(dateRange.from)).toISOString() : undefined,
        endDate: dateRange.to ? endOfDay(parseISO(dateRange.to)).toISOString() : undefined,
    };

    const { results, status, loadMore, isLoading } = usePaginatedQuery(
        api.activityLogs.list,
        queryArgs,
        { initialNumItems: rowsPerPage }
    );

    const totalCount = results.length; // Approximate for logs

    return (
        <div className="space-y-6">
            <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                <ReportFilters
                    dateRange={dateRange}
                    reportMode={reportMode}
                    onDateRangeChange={setDateRange}
                    onReportModeChange={setReportMode}
                    onClearFilters={() => {
                        setDateRange({
                            from: format(new Date(), "yyyy-MM-dd"),
                            to: format(new Date(), "yyyy-MM-dd")
                        });
                        setReportMode("daily");
                        setSearchTerm("");
                        setPage(1);
                    }}
                />
            </div>

            <ReportTable
                title="System Activity Log"
                subtitle="Audit trail of all system actions and changes."
                data={results || []}
                isLoading={isLoading}
                search={searchTerm}
                variant="overview"
                pagination={{
                    currentPage: page,
                    totalPages: Math.ceil(totalCount / rowsPerPage) || 1,
                    rowsPerPage: rowsPerPage,
                    onRowsPerPageChange: (rows) => {
                        setRowsPerPage(rows);
                        setPage(1);
                    },
                    totalItems: totalCount,
                    onNext: () => {
                        if (status === "CanLoadMore") loadMore(rowsPerPage);
                        setPage(p => p + 1);
                    },
                    onPrev: () => setPage(p => Math.max(1, p - 1)),
                    canLoadMore: status === "CanLoadMore"
                }}
                columns={[
                    {
                        header: "Timestamp",
                        accessor: (log: any) => (
                            <div className="font-mono text-[10px] leading-tight flex flex-col">
                                <span className="font-black">{format(new Date(log.timestamp), "dd MMM yyyy")}</span>
                                <span className="text-muted-foreground">{format(new Date(log.timestamp), "HH:mm:ss")}</span>
                            </div>
                        ),
                        exportValue: (log: any) => format(new Date(log.timestamp), "yyyy-MM-dd HH:mm:ss")
                    },
                    {
                        header: "Action",
                        accessor: (log: any) => (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 uppercase text-[9px] font-black">
                                {log.action}
                            </Badge>
                        ),
                        className: "w-[120px]"
                    },
                    {
                        header: "Details",
                        accessor: "details",
                        className: "text-[11px] font-medium"
                    },
                    {
                        header: "User",
                        accessor: (log: any) => (
                            <span className="font-mono text-[10px] text-muted-foreground uppercase opacity-70">
                                {log.userId.slice(-6)}
                            </span>
                        ),
                        className: "text-right w-[80px]"
                    }
                ]}
                footer={
                    <div className="p-4 bg-muted/5 border-t">
                        <div className="flex items-center gap-2">
                            <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                            <span className="text-[10px] font-black uppercase text-muted-foreground">Live System Audit Enabled</span>
                        </div>
                    </div>
                }
            />
        </div>
    );
}
