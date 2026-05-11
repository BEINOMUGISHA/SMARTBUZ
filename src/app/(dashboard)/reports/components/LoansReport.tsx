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
import { SearchableSelect } from "./SearchableSelect";
import { Id } from "../../../../../convex/_generated/dataModel";
import { CreditCard, Store, Users, UserCircle } from "lucide-react";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";

export function LoansReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [search, setSearch] = useState("");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [customerId, setCustomerId] = useState<string>("all");
    const [clientType, setClientType] = useState<string>("All");

    const shops = useQuery(api.shops.listAll);
    const customers = useQuery(api.customers.listAll);

    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    // View Details state
    const [viewingLoanId, setViewingLoanId] = useState<Id<"loans"> | null>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const loansArgs = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: !customerId || customerId === "all" ? undefined : (customerId as Id<"customers">),
        clientType: clientType === "All" ? undefined : clientType,
    };

    const { results: loansRecords, status: loansStatus, loadMore: loadMoreLoans, isLoading: loansLoading } = usePaginatedQuery(
        api.reports.getLoanSummary,
        loansArgs,
        { initialNumItems: rowsPerPage }
    );

    const totalLoansCount = useQuery(api.reports.getLoanSummaryCount, loansArgs) || 0;
    const summaryData = useQuery(api.reports.getLoanReportSummary, loansArgs);

    const loanWithDetails = useQuery(api.loans.getLoanWithDetails, viewingLoanId ? { id: viewingLoanId } : "skip");

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    const handleViewDetails = (loan: any) => {
        setViewingLoanId(loan._id);
        setIsViewSheetOpen(true);
    };

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
                        setSearch("");
                        setSelectedShop("all");
                        setCustomerId("all");
                        setClientType("All");
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
                    placeholder="Select Branch"
                    width="180px"
                />

                <SearchableSelect
                    options={[
                        { value: "All", label: "All Client Types" },
                        { value: "Standard Client", label: "Standard Client" },
                        { value: "HP Client", label: "HP Client" }
                    ]}
                    value={clientType}
                    onValueChange={setClientType}
                    placeholder="Client Type"
                    width="150px"
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Distributors" },
                        ...(customers || []).map(c => ({ value: c._id, label: c.name }))
                    ]}
                    value={customerId}
                    onValueChange={setCustomerId}
                    placeholder="Distributor"
                    width="180px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search debtors by name, phone or product..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} variant="loans" />

            <ReportTable
                title="Outstanding Loans Report"
                subtitle="Detailed tracking of credit-based sales and debtor balances."
                data={loansRecords?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                summaryData={summaryData || undefined}
                isLoading={loansLoading}
                search={search}
                variant="loans"
                onViewDetails={handleViewDetails}
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

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>Loan Details</SheetTitle>
                        <SheetDescription>
                            Complete information about this loan record.
                        </SheetDescription>
                    </SheetHeader>
                    {loanWithDetails ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Date</span>
                                    <span className="font-semibold">{format(new Date(loanWithDetails.date), "dd MMM yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Total Amount</span>
                                    <span className="font-bold text-lg text-emerald-600">UGX {loanWithDetails.amount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Balance Due</span>
                                    <span className="font-bold text-lg text-destructive">UGX {loanWithDetails.balance.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Status</span>
                                    <Badge variant={loanWithDetails.balance > 0 ? "destructive" : "outline"}>
                                        {loanWithDetails.balance > 0 ? "Outstanding" : "Cleared"}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Customer Information</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Name</span>
                                        <span className="font-semibold">{loanWithDetails.customer?.name || loanWithDetails.manualCustomerName || "N/A"}</span>
                                    </div>
                                    {loanWithDetails.customer?.phone && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">Phone</span>
                                            <span className="font-semibold text-sm">{loanWithDetails.customer.phone}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Sold By</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    {loanWithDetails.user ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Name</span>
                                                <span className="font-semibold capitalize">{loanWithDetails.user.first_name} {loanWithDetails.user.last_name}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Email</span>
                                                <span className="font-semibold text-sm">{loanWithDetails.user.email}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Role</span>
                                                <Badge className="capitalize">{loanWithDetails.user.roles?.[0] || "N/A"}</Badge>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">User information not available</div>
                                    )}
                                </div>
                            </div>

                            {loanWithDetails.sale && loanWithDetails.sale.items && loanWithDetails.sale.items.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Items ({loanWithDetails.sale.items.length})</h3>
                                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                        {loanWithDetails.sale.items.map((item: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                                                <div className="flex-1">
                                                    <div className="font-semibold text-sm">{item.name}</div>
                                                    <div className="text-[10px] text-muted-foreground">{item.productCode || "N/A"}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-semibold text-sm">{item.quantity} x {item.price.toLocaleString()}</div>
                                                    <div className="text-[10px] text-muted-foreground">{(item.quantity * item.price).toLocaleString()}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
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
