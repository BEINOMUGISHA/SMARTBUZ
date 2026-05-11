"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { Search, User, TrendingUp, DollarSign, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";
import { SearchableSelect } from "./SearchableSelect";
import { Id } from "../../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";

export function UsersReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [search, setSearch] = useState("");

    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    // View Details state
    const [viewingUser, setViewingUser] = useState<any>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const shops = useQuery(api.shops.listAll);

    const args = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        search: search || undefined,
    };

    const users = useQuery(api.reports.getUserPerformanceReport, args);
    const summary = useQuery(api.reports.getUserPerformanceSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
    });

    const totalCount = users?.length || 0;

    const customStats = summary ? [
        {
            title: "Total Users",
            value: `${summary.userCount}`,
            description: "ACTIVE STAFF",
            color: "border-l-blue-500",
        },
        {
            title: "Total Revenue",
            value: `UGX ${summary.totalRevenue.toLocaleString()}`,
            description: `${summary.totalSalesCount} TRANSACTIONS`,
            color: "border-l-emerald-500",
        },
        {
            title: "Avg per User",
            value: `UGX ${Math.round(summary.avgRevenuePerUser).toLocaleString()}`,
            description: "AVERAGE REVENUE",
            color: "border-l-purple-500",
        },
        {
            title: "Top Performer",
            value: `UGX ${summary.topUser?.revenue.toLocaleString() || "0"}`,
            description: `${summary.topUser?.sales || 0} SALES`,
            color: "border-l-amber-500",
        },
    ] : undefined;

    const handleViewDetails = (user: any) => {
        setViewingUser(user);
        setIsViewSheetOpen(true);
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                <ReportFilters
                    dateRange={dateRange}
                    reportMode={reportMode}
                    onDateRangeChange={setDateRange}
                    onReportModeChange={setReportMode}
                    onClearFilters={() => {
                        setDateRange({
                            from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                            to: format(new Date(), "yyyy-MM-dd")
                        });
                        setSelectedShop("all");
                        setSearch("");
                    }}
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Shops" },
                        ...(shops || []).map((s: any) => ({ value: s._id, label: s.name }))
                    ]}
                    value={selectedShop}
                    onValueChange={setSelectedShop}
                    placeholder="Select Shop"
                    width="160px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search user name or email..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary customStats={customStats} isLoading={summary === undefined} />

            <ReportTable
                title="User/Staff Performance Report"
                subtitle="Analysis of staff sales performance, revenue generation, and productivity."
                data={users?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={users === undefined}
                onViewDetails={handleViewDetails}
                pagination={{
                    currentPage: page,
                    totalPages: Math.max(1, Math.ceil(totalCount / rowsPerPage)),
                    rowsPerPage: rowsPerPage,
                    onRowsPerPageChange: (rows) => {
                        setRowsPerPage(rows);
                        setPage(1);
                    },
                    totalItems: totalCount,
                    onNext: () => {
                        const totalPages = Math.ceil(totalCount / rowsPerPage);
                        if (page < totalPages) setPage(p => p + 1);
                    },
                    onPrev: () => setPage(p => Math.max(1, p - 1)),
                    canLoadMore: false,
                }}
                columns={[
                    {
                        header: "User",
                        accessor: (u: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[160px]">
                                <span className="font-black text-primary leading-none capitalize">{u.userName}</span>
                                <span className="text-[9px] font-bold text-muted-foreground">{u.userEmail}</span>
                            </div>
                        ),
                        exportValue: (u: any) => u.userName,
                    },
                    {
                        header: "Sales",
                        accessor: (u: any) => (
                            <Badge variant="outline" className="text-[9px] uppercase font-black tracking-tighter">
                                {u.totalSales} SALES
                            </Badge>
                        ),
                        exportValue: (u: any) => u.totalSales,
                        className: "text-center",
                    },
                    {
                        header: "Revenue",
                        accessor: (u: any) => (
                            <span className="font-black text-emerald-700 text-sm">UGX {u.totalRevenue.toLocaleString()}</span>
                        ),
                        exportValue: (u: any) => u.totalRevenue.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Avg per Sale",
                        accessor: (u: any) => (
                            <span className="font-bold text-muted-foreground text-sm">UGX {Math.round(u.totalRevenue / u.totalSales).toLocaleString()}</span>
                        ),
                        exportValue: (u: any) => Math.round(u.totalRevenue / u.totalSales).toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Items Sold",
                        accessor: (u: any) => (
                            <span className="font-bold text-blue-600 text-sm">{u.totalItems.toLocaleString()}</span>
                        ),
                        exportValue: (u: any) => u.totalItems.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "PV / BV",
                        accessor: (u: any) => (
                            <div className="text-right">
                                <div className="font-black text-purple-700 text-xs">{u.totalPV.toLocaleString()} PV</div>
                                <div className="font-black text-indigo-700 text-xs">{u.totalBV.toLocaleString()} BV</div>
                            </div>
                        ),
                        exportValue: (u: any) => `${u.totalPV.toLocaleString()} PV / ${u.totalBV.toLocaleString()} BV`,
                        className: "text-right",
                    },
                ]}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>User Performance Details</SheetTitle>
                        <SheetDescription>
                            Complete performance analysis for this staff member.
                        </SheetDescription>
                    </SheetHeader>
                    {viewingUser ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Name</span>
                                    <span className="font-semibold capitalize">{viewingUser.userName}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Email</span>
                                    <span className="font-semibold text-sm">{viewingUser.userEmail}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Total Sales</span>
                                    <Badge variant="outline" className="text-xs uppercase font-black tracking-tighter">
                                        {viewingUser.totalSales} SALES
                                    </Badge>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Total Revenue</span>
                                    <span className="font-bold text-lg text-emerald-600">UGX {viewingUser.totalRevenue.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Avg per Sale</span>
                                    <span className="font-semibold">UGX {Math.round(viewingUser.totalRevenue / viewingUser.totalSales).toLocaleString()}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Productivity Metrics</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Items Sold</span>
                                        <span className="font-bold text-blue-600">{viewingUser.totalItems.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Avg Items per Sale</span>
                                        <span className="font-semibold">{Math.round(viewingUser.totalItems / viewingUser.totalSales)} items</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">PV / BV Contribution</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Total PV</span>
                                        <span className="font-bold text-purple-700">{viewingUser.totalPV.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Total BV</span>
                                        <span className="font-bold text-indigo-700">{viewingUser.totalBV.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
