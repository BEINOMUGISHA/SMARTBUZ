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
import { cn } from "@/lib/utils";

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
    const [dashView, setDashView] = useState<"sales" | "loans">("sales");

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
            <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-end gap-3">

                {/* 1. Date Filters */}
                <ReportFilters
                    dateRange={dateRange}
                    reportMode={reportMode}
                    onDateRangeChange={setDateRange}
                    onReportModeChange={setReportMode}
                />

                {/* 2. Shop Select */}
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

                {/* 3. Conditional Client Select */}
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

                {/* 4. Search Input (Flexible width, with border) */}
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
                    <Input
                        placeholder={selectedShop === "all" ? "Search branches..." : "Search within branch transactions..."}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>

                {/* 5. View Toggle (Right aligned if space permits, or wraps) */}
                {selectedShop !== "all" && (
                    <div className="flex bg-muted/40 p-1 rounded-lg h-10 gap-1 border border-border shrink-0 ml-auto md:ml-0">
                        <button
                            onClick={() => setDashView("sales")}
                            className={cn(
                                "px-3 h-full rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                                dashView === "sales" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
                            )}
                        >
                            Sales
                        </button>
                        <button
                            onClick={() => setDashView("loans")}
                            className={cn(
                                "px-3 h-full rounded-md text-[10px] font-black uppercase tracking-widest transition-all",
                                dashView === "loans" ? "bg-destructive text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
                            )}
                        >
                            Loans
                        </button>
                    </div>
                )}
            </div>

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} variant="shops" />

            {
                selectedShop !== "all" && dashView === "loans" ? (
                    <ReportTable
                        title={`${shops?.find(s => String(s._id) === selectedShop)?.name || "Shop"} - Detailed Loans`}
                        subtitle={`Comprehensive loan records from ${dateRange.from} to ${dateRange.to}`}
                        data={shopLoans || []}
                        isLoading={loansLoading}
                        summaryData={summaryData}
                        variant="loans"
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
                ) : selectedShop !== "all" && dashView === "sales" ? (
                    <ReportTable
                        title={`${shops?.find(s => String(s._id) === selectedShop)?.name || "Branch"} - Detailed Sales`}
                        subtitle={`Sales transactions from ${dateRange.from} to ${dateRange.to}`}
                        data={shopSales || []}
                        isLoading={salesLoading}
                        summaryData={summaryData}
                        variant="sales"
                        columns={[
                            {
                                header: "Date/Time",
                                accessor: (s: any) => (
                                    <div className="font-mono leading-tight">
                                        <div className="font-black">{format(new Date(s._creationTime), "dd MMM yyyy")}</div>
                                        <div className="text-[9px] text-muted-foreground">{format(new Date(s._creationTime), "HH:mm")}</div>
                                    </div>
                                ),
                                exportValue: (s: any) => format(new Date(s._creationTime), "dd/MM/yyyy HH:mm")
                            },
                            {
                                header: "Customer Info",
                                accessor: (s: any) => (
                                    <div className="space-y-1">
                                        <div className="flex gap-1 flex-wrap">
                                            <Badge variant={s.clientType === "HP Client" ? "secondary" : "outline"} className="text-[9px] h-4">
                                                {s.clientType}
                                            </Badge>
                                            <Badge variant={s.paymentMode === "Loan" ? "destructive" : "default"} className="text-[9px] h-4">
                                                {s.paymentMode}
                                            </Badge>
                                        </div>
                                        <div className="text-[10px] font-black text-primary truncate max-w-[120px]">
                                            {s.customerName}
                                        </div>
                                    </div>
                                ),
                                exportValue: (s: any) => `${s.customerName} (${s.clientType})`
                            },
                            {
                                header: "Items (Qty x Name)",
                                accessor: (s: any) => (
                                    <div className="space-y-1 max-w-[300px]">
                                        {(s.items || []).map((item: any, idx: number) => (
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
                                exportValue: (s: any) => (s.items || []).map((i: any) => `${i.quantity}x ${i.name}`).join(", "),
                                className: "min-w-[200px]"
                            },
                            {
                                header: "Total",
                                accessor: (s: any) => (
                                    <span className="font-black text-primary text-sm">{s.total.toLocaleString()}</span>
                                ),
                                exportValue: (s: any) => s.total.toLocaleString(),
                                className: "text-right"
                            },
                            {
                                header: "Paid",
                                accessor: (s: any) => (
                                    <span className="font-bold text-emerald-600 text-xs">{(s.amountPaid || 0).toLocaleString()}</span>
                                ),
                                exportValue: (s: any) => (s.amountPaid || 0).toLocaleString(),
                                className: "text-right"
                            }
                        ]}
                    />
                ) : (
                    <ReportTable
                        title="Branch Performance Summary"
                        subtitle="Key metrics per active shop"
                        data={shopSummary || []}
                        summaryData={summaryData}
                        isLoading={shopSummary === undefined}
                        variant="shops"
                        columns={[
                            { header: "Branch Name", accessor: (item: any) => <span className="font-bold">{item.name}</span> },
                            { header: "Location", accessor: "location" },
                            { header: "Transactions", accessor: (item: any) => item.transactionCount.toLocaleString(), className: "text-center" },
                            { header: "Total Sales", accessor: (item: any) => formatPrice(item.totalSales), className: "font-black text-right" },
                            { header: "Last Active", accessor: (item: any) => item.lastSaleDate ? format(new Date(item.lastSaleDate), "dd MMM yyyy") : "Never" },
                        ]}
                    />
                )
            }
        </div >
    );
}
