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
import { ReportSummary } from "./ReportSummary";
import { SearchableSelect } from "./SearchableSelect";
import { Id } from "../../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";

export function DetailedSalesReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [customerId, setCustomerId] = useState<string>("all");
    const [clientType, setClientType] = useState<string>("All");
    const [transactionType, setTransactionType] = useState<string>("All");
    const [search, setSearch] = useState("");
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    const shops = useQuery(api.shops.listAll);
    const customers = useQuery(api.customers.listAll);

    const salesArgs = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: customerId === "all" ? undefined : (customerId as Id<"customers">),
        clientType: clientType === "All" ? undefined : clientType,
        transactionType: transactionType === "All" ? undefined : transactionType,
    };

    const { results: salesRecords, status: salesStatus, loadMore: loadMoreSales, isLoading: salesLoading } = usePaginatedQuery(
        api.reports.getDetailedSalesReport,
        salesArgs,
        { initialNumItems: rowsPerPage }
    );

    const totalSalesCount = useQuery(api.reports.getDetailedSalesReportCount, salesArgs) || 0;
    const summaryData = useQuery(api.reports.getReportsSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: customerId === "all" ? undefined : (customerId as Id<"customers">),
        clientType: clientType === "All" ? undefined : clientType,
        search: search || undefined
    });

    useEffect(() => {
        if (salesStatus === "CanLoadMore" && salesRecords.length < (page * rowsPerPage)) {
            loadMoreSales(rowsPerPage);
        }
    }, [page, rowsPerPage, salesRecords.length, salesStatus, loadMoreSales]);

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
                            from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                            to: format(new Date(), "yyyy-MM-dd")
                        });
                        setReportMode("range");
                        setSelectedShop("all");
                        setCustomerId("all");
                        setClientType("All");
                        setTransactionType("All");
                        setSearch("");
                        setPage(1);
                    }}
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Branches" },
                        ...(shops || []).map(s => ({ value: s._id, label: s.name }))
                    ]}
                    value={selectedShop}
                    onValueChange={setSelectedShop}
                    placeholder="All Branches"
                    width="140px"
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Clients/Distributors" },
                        ...(customers || []).map(c => ({ value: c._id, label: `${c.name} (${c.distributorId || 'N/A'})` }))
                    ]}
                    value={customerId}
                    onValueChange={setCustomerId}
                    placeholder="Select Client"
                    width="180px"
                />

                <Select value={clientType} onValueChange={setClientType}>
                    <SelectTrigger className="w-[120px] h-10 text-[10px] font-bold border-input font-black uppercase tracking-tighter">
                        <SelectValue placeholder="Client Type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="All">All Types</SelectItem>
                        <SelectItem value="Member">Regular Member</SelectItem>
                        <SelectItem value="HP Client">HP Client</SelectItem>
                        <SelectItem value="Walk-in">Walk-in</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={transactionType} onValueChange={setTransactionType}>
                    <SelectTrigger className="w-[120px] h-10 text-[10px] font-bold border-input font-black uppercase tracking-tighter text-blue-700">
                        <SelectValue placeholder="Transaction" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="All">All Trans</SelectItem>
                        <SelectItem value="Sale">Sale Only</SelectItem>
                        <SelectItem value="Swap">Product Swap</SelectItem>
                    </SelectContent>
                </Select>

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search within records (name, transaction ID...)"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} variant="sales" />

            <ReportTable
                title="Comprehensive Sales Report"
                subtitle="Complete itemized transaction history."
                data={salesRecords || []}
                summaryData={summaryData}
                isLoading={salesLoading}
                search={search}
                variant="sales"
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
                                <div className="font-black text-[10px]">{format(new Date(s._creationTime), "dd MMM")}</div>
                                <div className="font-black text-[10px]">{format(new Date(s._creationTime), "yyyy")}</div>
                                <div className="text-[9px] text-muted-foreground">{format(new Date(s._creationTime), "HH:mm:ss")}</div>
                            </div>
                        )
                    },
                    {
                        header: "Invoice No",
                        accessor: (s: any) => (
                            <span className="font-mono font-black text-[10px] text-emerald-800">
                                {s.invoiceNumber || "---"}
                            </span>
                        ),
                        className: "w-[100px]"
                    },
                    {
                        header: "Client Name & Info",
                        accessor: (s: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                                <span className="font-black text-primary leading-none">{s.customerName}</span>
                                {s.customerPhone && <span className="text-[9px] font-bold text-muted-foreground">{s.customerPhone}</span>}
                                {s.customerLocation && <span className="text-[9px] italic opacity-70">📍 {s.customerLocation}</span>}
                            </div>
                        ),
                        exportValue: (s: any) => s.customerName
                    },
                    {
                        header: "Type",
                        accessor: (s: any) => (
                            <div className="flex flex-col gap-1">
                                <Badge variant="outline" className="text-[8px] uppercase font-black tracking-tighter px-1 h-3.5 w-fit">
                                    {s.clientType}
                                </Badge>
                                <Badge variant="secondary" className={cn(
                                    "text-[8px] uppercase font-black px-1 h-3.5 w-fit",
                                    s.transactionType === "Swap" ? "bg-blue-100 text-blue-700 border-blue-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                )}>
                                    {s.transactionType || "Sale"}
                                </Badge>
                            </div>
                        ),
                        className: "w-[80px]"
                    },
                    {
                        header: "Items Details",
                        accessor: (s: any) => (
                            <div className="flex flex-col gap-1.5 py-1 min-w-[160px]">
                                <div className="flex flex-col gap-0.5">
                                    <span className="text-[8px] font-black uppercase text-emerald-700 tracking-tighter">Products Taken:</span>
                                    {s.items.map((item: any, idx: number) => (
                                        <div key={idx} className="text-[9px] leading-tight flex items-center gap-2">
                                            <span className="font-black text-primary min-w-[15px]">{item.quantity}x</span>
                                            <span className="truncate max-w-[120px]">{item.name}</span>
                                        </div>
                                    ))}
                                </div>
                                {s.transactionType === "Swap" && s.returnedItems && s.returnedItems.length > 0 && (
                                    <div className="flex flex-col gap-0.5 border-t border-blue-100 pt-1 mt-1 bg-blue-50/50 p-1 rounded-sm">
                                        <span className="text-[8px] font-black uppercase text-blue-700 tracking-tighter">Items Returned:</span>
                                        {s.returnedItems.map((item: any, idx: number) => (
                                            <div key={idx} className="text-[9px] leading-tight flex items-center gap-2 opacity-70">
                                                <span className="font-bold text-blue-600 min-w-[15px]">{item.quantity}x</span>
                                                <span className="truncate max-w-[120px] line-through decoration-blue-300">{item.name}</span>
                                            </div>
                                        ))}
                                    </div>
                                )}
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
        </div >
    );
}
