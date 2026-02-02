"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";
import { SearchableSelect } from "./SearchableSelect";
import { usePaginatedQuery } from "convex/react";
import { Id } from "../../../../../convex/_generated/dataModel";
import { Badge } from "@/components/ui/badge";

export function ShopsReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [customerId, setCustomerId] = useState<string>("all");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    const shops = useQuery(api.shops.listAll);
    const customers = useQuery(api.customers.listAll);

    // Summary of all shops (for the "All Branches" view)
    const shopSummary = useQuery(api.reports.getShopSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        search: search || undefined
    });

    // Detailed data for the selected shop dashboard
    const salesArgs = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: customerId === "all" ? undefined : (customerId as Id<"customers">),
    };

    const { results: shopSales, status: salesStatus, loadMore: loadMoreSales, isLoading: salesLoading } = usePaginatedQuery(
        api.reports.getDetailedSalesReport,
        salesArgs,
        { initialNumItems: 10 }
    );

    const { results: shopLoans, status: loansStatus, isLoading: loansLoading } = usePaginatedQuery(
        api.reports.getLoanSummary,
        salesArgs,
        { initialNumItems: 10 }
    );

    const summaryData = useQuery(api.reports.getReportsSummary, {
        ...salesArgs,
        search: search || undefined
    });

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    return (
        <div className="space-y-6">
            <div className="bg-white p-3 rounded-xl border shadow-xs flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <ReportFilters
                        dateRange={dateRange}
                        reportMode={reportMode}
                        onDateRangeChange={setDateRange}
                        onReportModeChange={setReportMode}
                    />

                    <div className="flex items-center gap-2">
                        <SearchableSelect
                            options={[
                                { value: "all", label: "Overview: All Branches" },
                                ...(shops || []).map(s => ({ value: s._id, label: s.name }))
                            ]}
                            value={selectedShop}
                            onValueChange={setSelectedShop}
                            placeholder="Select Branch"
                            width="180px"
                        />

                        {selectedShop !== "all" && (
                            <SearchableSelect
                                options={[
                                    { value: "all", label: "All Distributors" },
                                    ...(customers || []).map(c => ({ value: c._id, label: c.name }))
                                ]}
                                value={customerId}
                                onValueChange={setCustomerId}
                                placeholder="Filter Client"
                                width="160px"
                            />
                        )}
                    </div>
                </div>

                <div className="relative w-full">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
                    <Input
                        placeholder={selectedShop === "all" ? "Search branches..." : "Search within branch transactions..."}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-9 text-xs border-muted-foreground/10 bg-muted/5 focus:bg-white transition-all"
                    />
                </div>
            </div>

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} />

            {selectedShop === "all" ? (
                <ReportTable
                    title="Branch Performance Summary"
                    subtitle="Key metrics per active shop"
                    data={shopSummary || []}
                    summaryData={summaryData}
                    isLoading={shopSummary === undefined}
                    columns={[
                        { header: "Branch Name", accessor: (item: any) => <span className="font-bold">{item.name}</span> },
                        { header: "Location", accessor: "location" },
                        { header: "Transactions", accessor: (item: any) => item.transactionCount.toLocaleString(), className: "text-center" },
                        { header: "Total Sales", accessor: (item: any) => formatPrice(item.totalSales), className: "font-black text-right" },
                        { header: "Last Active", accessor: (item: any) => item.lastSaleDate ? format(new Date(item.lastSaleDate), "dd MMM yyyy") : "Never" },
                    ]}
                />
            ) : (
                <div className="space-y-6">
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <ReportTable
                            title="Recent Sales Activity"
                            subtitle="Latest transactions for this branch"
                            data={shopSales || []}
                            isLoading={salesLoading}
                            compact
                            columns={[
                                {
                                    header: "Date",
                                    accessor: (s: any) => format(new Date(s._creationTime), "dd MMM HH:mm")
                                },
                                {
                                    header: "Customer",
                                    accessor: "customerName"
                                },
                                {
                                    header: "Total",
                                    accessor: (s: any) => s.total.toLocaleString(),
                                    className: "text-right font-black"
                                },
                                {
                                    header: "Mode",
                                    accessor: (s: any) => (
                                        <Badge variant={s.paymentMode === "Loan" ? "destructive" : "outline"} className="text-[8px] h-3 font-black px-1">
                                            {s.paymentMode}
                                        </Badge>
                                    )
                                }
                            ]}
                        />

                        <ReportTable
                            title="Active Loans"
                            subtitle="Pending payments for this branch"
                            data={shopLoans || []}
                            isLoading={loansLoading}
                            compact
                            columns={[
                                {
                                    header: "Date",
                                    accessor: (l: any) => format(new Date(l.date || l._creationTime), "dd MMM")
                                },
                                {
                                    header: "Customer",
                                    accessor: "customerName"
                                },
                                {
                                    header: "Balance",
                                    accessor: (l: any) => (l.balance || 0).toLocaleString(),
                                    className: "text-right font-black text-red-600"
                                }
                            ]}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
