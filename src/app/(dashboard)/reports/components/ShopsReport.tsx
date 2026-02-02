"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";

export function ShopsReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const shopSummary = useQuery(api.reports.getShopSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to
    });

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    return (
        <div className="space-y-6">
            <div className="bg-white p-3 rounded-xl border shadow-xs flex items-center justify-between gap-3">
                <ReportFilters
                    dateRange={dateRange}
                    reportMode={reportMode}
                    onDateRangeChange={setDateRange}
                    onReportModeChange={setReportMode}
                />
                <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-3 bg-muted/20 h-8 flex items-center rounded-lg">
                    Branch Audit
                </div>
            </div>

            <ReportTable
                title="Branch Performance Summary"
                subtitle="Key metrics per active shop"
                data={shopSummary || []}
                isLoading={shopSummary === undefined}
                columns={[
                    { header: "Branch Name", accessor: (item: any) => <span className="font-bold">{item.name}</span> },
                    { header: "Location", accessor: "location" },
                    { header: "Transactions", accessor: (item: any) => item.transactionCount.toLocaleString(), className: "text-center" },
                    { header: "Total Sales", accessor: (item: any) => formatPrice(item.totalSales), className: "font-black text-right" },
                    { header: "Last Active", accessor: (item: any) => item.lastSaleDate ? format(new Date(item.lastSaleDate), "dd MMM yyyy") : "Never" },
                ]}
            />
        </div>
    );
}
