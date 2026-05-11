"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Search, CreditCard, Wallet, AlertTriangle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";
import { SearchableSelect } from "./SearchableSelect";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function LoansReport() {
    const [subTab, setSubTab] = useState<"loans" | "collections" | "aged">("loans");
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

    return (
        <div className="space-y-6">
            <Tabs value={subTab} onValueChange={(v) => setSubTab(v as any)} className="w-full">
                <div className="flex items-center justify-between mb-2">
                    <TabsList className="bg-muted/50 p-1 rounded-xl h-10 border shadow-xs">
                        <TabsTrigger value="loans" className="rounded-lg px-5 h-8 font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white">
                            <CreditCard className="h-3 w-3 mr-2" /> Loans
                        </TabsTrigger>
                        <TabsTrigger value="collections" className="rounded-lg px-5 h-8 font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-emerald-600">
                            <Wallet className="h-3 w-3 mr-2" /> Collections
                        </TabsTrigger>
                        <TabsTrigger value="aged" className="rounded-lg px-5 h-8 font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-red-600 data-[state=active]:text-white text-red-600">
                            <AlertTriangle className="h-3 w-3 mr-2" /> Aged Debtors
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="loans" className="mt-0 focus-visible:outline-none">
                    <LoansTab
                        reportMode={reportMode}
                        setReportMode={setReportMode}
                        dateRange={dateRange}
                        setDateRange={setDateRange}
                        selectedShop={selectedShop}
                        setSelectedShop={setSelectedShop}
                        customerId={customerId}
                        setCustomerId={setCustomerId}
                        clientType={clientType}
                        setClientType={setClientType}
                        search={search}
                        setSearch={setSearch}
                        shops={shops}
                        customers={customers}
                        page={page}
                        setPage={setPage}
                        rowsPerPage={rowsPerPage}
                        setRowsPerPage={setRowsPerPage}
                        viewingLoanId={viewingLoanId}
                        setViewingLoanId={setViewingLoanId}
                        isViewSheetOpen={isViewSheetOpen}
                        setIsViewSheetOpen={setIsViewSheetOpen}
                    />
                </TabsContent>
                <TabsContent value="collections" className="mt-0 focus-visible:outline-none">
                    <CollectionsTab
                        reportMode={reportMode}
                        setReportMode={setReportMode}
                        dateRange={dateRange}
                        setDateRange={setDateRange}
                        selectedShop={selectedShop}
                        setSelectedShop={setSelectedShop}
                        customerId={customerId}
                        setCustomerId={setCustomerId}
                        search={search}
                        setSearch={setSearch}
                        shops={shops}
                        customers={customers}
                    />
                </TabsContent>
                <TabsContent value="aged" className="mt-0 focus-visible:outline-none">
                    <AgedDebtorsTab
                        selectedShop={selectedShop}
                        setSelectedShop={setSelectedShop}
                        customerId={customerId}
                        setCustomerId={setCustomerId}
                        search={search}
                        setSearch={setSearch}
                        shops={shops}
                        customers={customers}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}

// ============================================================
// LOANS TAB (original loan list)
// ============================================================
function LoansTab({
    reportMode, setReportMode, dateRange, setDateRange,
    selectedShop, setSelectedShop, customerId, setCustomerId,
    clientType, setClientType, search, setSearch,
    shops, customers, page, setPage, rowsPerPage, setRowsPerPage,
    viewingLoanId, setViewingLoanId, isViewSheetOpen, setIsViewSheetOpen,
}: any) {
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

    const handleViewDetails = (loan: any) => {
        setViewingLoanId(loan._id);
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
                        ...(shops || []).map((s: any) => ({ value: s._id, label: s.name }))
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
                        ...(customers || []).map((c: any) => ({ value: c._id, label: c.name }))
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
                        if (page < totalPages) setPage((p: number) => p + 1);
                    },
                    onPrev: () => setPage((p: number) => Math.max(1, p - 1)),
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
                                            <div key={idx} className="flex justify-between border-b border-muted pb-2 last:border-0">
                                                <div className="flex gap-2">
                                                    <span className="font-black text-primary">{item.quantity}x</span>
                                                    <span className="text-sm">{item.name}</span>
                                                </div>
                                                <span className="text-sm text-muted-foreground">[{item.pv} PV / {item.bv} BV]</span>
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

// ============================================================
// COLLECTIONS TAB (from PaymentsReport)
// ============================================================
function CollectionsTab({
    reportMode, setReportMode, dateRange, setDateRange,
    selectedShop, setSelectedShop, customerId, setCustomerId,
    search, setSearch, shops, customers,
}: any) {
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    // View Details state
    const [viewingPayment, setViewingPayment] = useState<any>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const args = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: !customerId || customerId === "all" ? undefined : (customerId as Id<"customers">),
        search: search || undefined,
    };

    const payments = useQuery(api.reports.getPaymentsReport, args);
    const summary = useQuery(api.reports.getPaymentsReportSummary, {
        startDate: args.startDate,
        endDate: args.endDate,
        shopId: args.shopId,
        customerId: args.customerId,
    });

    const totalCount = payments?.length || 0;

    const customStats = summary ? [
        {
            title: "Total Collected",
            value: `UGX ${summary.totalCollected.toLocaleString()}`,
            description: `${summary.paymentCount} PAYMENTS RECEIVED`,
            color: "border-l-emerald-500",
        },
        {
            title: "Avg Payment",
            value: `UGX ${Math.round(summary.avgPayment).toLocaleString()}`,
            description: `${summary.uniqueCustomers} UNIQUE CUSTOMERS`,
            color: "border-l-blue-500",
        },
        {
            title: "Total Outstanding",
            value: `UGX ${summary.totalOutstanding.toLocaleString()}`,
            description: "STILL OWED ACROSS ALL LOANS",
            color: "border-l-red-500",
        },
        {
            title: "Recovery Rate",
            value: `${summary.recoveryRate.toFixed(1)}%`,
            description: "COLLECTED / (COLLECTED + OUTSTANDING)",
            color: "border-l-amber-500",
        },
    ] : undefined;

    const handleViewPaymentDetails = (payment: any) => {
        setViewingPayment(payment);
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
                        setCustomerId("all");
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

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Customers" },
                        ...(customers || []).map((c: any) => ({ value: c._id, label: c.name }))
                    ]}
                    value={customerId}
                    onValueChange={setCustomerId}
                    placeholder="Customer"
                    width="180px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search customer, shop, recorded by..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary customStats={customStats} isLoading={summary === undefined} />

            <ReportTable
                title="Loan Collections / Payments"
                subtitle="All loan repayments received in the selected period."
                data={payments?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={payments === undefined}
                onViewDetails={handleViewPaymentDetails}
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
                        header: "Date/Time",
                        accessor: (p: any) => (
                            <div className="font-mono leading-tight">
                                <div className="font-black">{format(new Date(p.date || p._creationTime), "dd MMM yyyy")}</div>
                                <div className="text-[9px] text-muted-foreground">{format(new Date(p.date || p._creationTime), "HH:mm")}</div>
                            </div>
                        )
                    },
                    {
                        header: "Customer",
                        accessor: (p: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                                <span className="font-black text-primary leading-none">{p.customerName}</span>
                                <span className="text-[9px] font-bold text-muted-foreground">{p.customerPhone}</span>
                                <Badge variant="outline" className="text-[8px] uppercase font-black tracking-tighter px-1 h-3.5 w-fit mt-0.5">
                                    {p.customerType}
                                </Badge>
                            </div>
                        ),
                        exportValue: (p: any) => p.customerName,
                    },
                    {
                        header: "Shop",
                        accessor: (p: any) => (
                            <span className="text-[10px] font-bold uppercase text-muted-foreground">{p.shopName}</span>
                        ),
                        exportValue: (p: any) => p.shopName,
                    },
                    {
                        header: "Amount Paid",
                        accessor: (p: any) => (
                            <span className="font-black text-emerald-700 text-sm">UGX {p.amount.toLocaleString()}</span>
                        ),
                        exportValue: (p: any) => p.amount.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Remaining Balance",
                        accessor: (p: any) => (
                            <div className="text-right">
                                <div className={cn("font-black", p.balance > 0 ? "text-destructive" : "text-emerald-600")}>
                                    UGX {p.balance.toLocaleString()}
                                </div>
                                <div className="text-[9px] text-muted-foreground">of UGX {p.loanAmount.toLocaleString()}</div>
                            </div>
                        ),
                        exportValue: (p: any) => p.balance.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Status",
                        accessor: (p: any) => (
                            <Badge variant={p.balance > 0 ? "secondary" : "default"} className={cn(
                                "text-[9px] uppercase font-black tracking-tighter",
                                p.balance > 0 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"
                            )}>
                                {p.balance > 0 ? "Partial" : "Cleared"}
                            </Badge>
                        ),
                        className: "text-center",
                    },
                    {
                        header: "Recorded By",
                        accessor: (p: any) => (
                            <span className="text-[10px] font-bold capitalize text-muted-foreground">{p.recordedBy}</span>
                        ),
                        exportValue: (p: any) => p.recordedBy,
                    },
                ]}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>Payment Details</SheetTitle>
                        <SheetDescription>
                            Complete information about this loan payment record.
                        </SheetDescription>
                    </SheetHeader>
                    {viewingPayment ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Date</span>
                                    <span className="font-semibold">{format(new Date(viewingPayment.date || viewingPayment._creationTime), "dd MMM yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Amount Paid</span>
                                    <span className="font-bold text-lg text-emerald-600">UGX {viewingPayment.amount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Remaining Balance</span>
                                    <span className={cn("font-bold text-lg", viewingPayment.balance > 0 ? "text-destructive" : "text-emerald-600")}>
                                        UGX {viewingPayment.balance.toLocaleString()}
                                    </span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Status</span>
                                    <Badge variant={viewingPayment.balance > 0 ? "secondary" : "default"} className={cn(
                                        "uppercase font-black tracking-tighter",
                                        viewingPayment.balance > 0 ? "bg-orange-100 text-orange-700" : "bg-emerald-100 text-emerald-700"
                                    )}>
                                        {viewingPayment.balance > 0 ? "Partial" : "Cleared"}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Customer Information</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Name</span>
                                        <span className="font-semibold">{viewingPayment.customerName}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Phone</span>
                                        <span className="font-semibold text-sm">{viewingPayment.customerPhone}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Type</span>
                                        <Badge variant="outline" className="text-[10px] uppercase font-black tracking-tighter px-1 h-4">
                                            {viewingPayment.customerType}
                                        </Badge>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Loan Details</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Original Loan Amount</span>
                                        <span className="font-semibold">UGX {viewingPayment.loanAmount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Shop</span>
                                        <span className="font-semibold">{viewingPayment.shopName}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Recorded By</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Name</span>
                                        <span className="font-semibold capitalize">{viewingPayment.recordedBy}</span>
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

// ============================================================
// AGED DEBTORS TAB
// ============================================================
function AgedDebtorsTab({
    selectedShop, setSelectedShop, customerId, setCustomerId,
    search, setSearch, shops, customers,
}: any) {
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);
    const [bucketFilter, setBucketFilter] = useState<string>("all");

    // View Details state
    const [viewingLoan, setViewingLoan] = useState<any>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const data = useQuery(api.reports.getAgedDebtors, {
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: !customerId || customerId === "all" ? undefined : (customerId as Id<"customers">),
        search: search || undefined,
    });

    const filteredLoans = data?.loans.filter((l: any) => bucketFilter === "all" || l.bucket === bucketFilter) || [];
    const totalCount = filteredLoans.length;

    const customStats = data ? [
        {
            title: "Current (0-30d)",
            value: `UGX ${data.buckets.current.total.toLocaleString()}`,
            description: `${data.buckets.current.count} LOANS`,
            color: "border-l-emerald-500",
        },
        {
            title: "31-60 Days",
            value: `UGX ${data.buckets["30"].total.toLocaleString()}`,
            description: `${data.buckets["30"].count} LOANS`,
            color: "border-l-amber-500",
        },
        {
            title: "61-90 Days",
            value: `UGX ${data.buckets["60"].total.toLocaleString()}`,
            description: `${data.buckets["60"].count} LOANS`,
            color: "border-l-orange-500",
        },
        {
            title: "Over 90 Days",
            value: `UGX ${(data.buckets["90"].total + data.buckets.over90.total).toLocaleString()}`,
            description: `${data.buckets["90"].count + data.buckets.over90.count} LOANS - HIGH RISK`,
            color: "border-l-red-500",
        },
    ] : undefined;

    const bucketLabel = (b: string) => {
        switch (b) {
            case "current": return { text: "Current", className: "bg-emerald-100 text-emerald-700 border-emerald-200" };
            case "30": return { text: "31-60d", className: "bg-amber-100 text-amber-700 border-amber-200" };
            case "60": return { text: "61-90d", className: "bg-orange-100 text-orange-700 border-orange-200" };
            case "90": return { text: "91-120d", className: "bg-red-100 text-red-700 border-red-200" };
            case "over90": return { text: ">120d", className: "bg-red-200 text-red-900 border-red-300 font-black" };
            default: return { text: b, className: "" };
        }
    };

    const handleViewDetails = (loan: any) => {
        setViewingLoan(loan);
        setIsViewSheetOpen(true);
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
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

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Customers" },
                        ...(customers || []).map((c: any) => ({ value: c._id, label: c.name }))
                    ]}
                    value={customerId}
                    onValueChange={setCustomerId}
                    placeholder="Customer"
                    width="180px"
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Buckets" },
                        { value: "current", label: "Current (0-30d)" },
                        { value: "30", label: "31-60 days" },
                        { value: "60", label: "61-90 days" },
                        { value: "90", label: "91-120 days" },
                        { value: "over90", label: "Over 120 days" },
                    ]}
                    value={bucketFilter}
                    onValueChange={setBucketFilter}
                    placeholder="Age Bucket"
                    width="160px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search debtor name or phone..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary customStats={customStats} isLoading={data === undefined} />

            <ReportTable
                title="Aged Debtors Report"
                subtitle={`${data?.totalDebtors || 0} debtors with outstanding balances totaling UGX ${(data?.totalOutstanding || 0).toLocaleString()}`}
                data={filteredLoans.slice((page - 1) * rowsPerPage, page * rowsPerPage)}
                isLoading={data === undefined}
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
                        header: "Loan Date",
                        accessor: (l: any) => (
                            <div className="font-mono leading-tight">
                                <div className="font-black">{format(new Date(l.date || l._creationTime), "dd MMM yyyy")}</div>
                                <div className="text-[9px] text-muted-foreground">{l.ageDays} days ago</div>
                            </div>
                        )
                    },
                    {
                        header: "Debtor",
                        accessor: (l: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                                <span className="font-black text-primary leading-none">{l.customerName}</span>
                                <span className="text-[9px] font-bold text-muted-foreground">{l.customerPhone}</span>
                                <Badge variant="outline" className="text-[8px] uppercase font-black tracking-tighter px-1 h-3.5 w-fit mt-0.5">
                                    {l.clientType}
                                </Badge>
                            </div>
                        ),
                        exportValue: (l: any) => l.customerName,
                    },
                    {
                        header: "Age Bucket",
                        accessor: (l: any) => {
                            const b = bucketLabel(l.bucket);
                            return (
                                <Badge variant="outline" className={cn("text-[9px] uppercase font-black tracking-tighter", b.className)}>
                                    {b.text}
                                </Badge>
                            );
                        },
                        exportValue: (l: any) => bucketLabel(l.bucket).text,
                        className: "text-center",
                    },
                    {
                        header: "Original Amount",
                        accessor: (l: any) => (
                            <span className="font-bold text-muted-foreground">UGX {l.originalAmount.toLocaleString()}</span>
                        ),
                        exportValue: (l: any) => l.originalAmount.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Paid",
                        accessor: (l: any) => (
                            <span className="font-bold text-emerald-700">UGX {l.paidAmount.toLocaleString()}</span>
                        ),
                        exportValue: (l: any) => l.paidAmount.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Outstanding",
                        accessor: (l: any) => (
                            <span className="font-black text-destructive text-sm">UGX {l.outstandingBalance.toLocaleString()}</span>
                        ),
                        exportValue: (l: any) => l.outstandingBalance.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Due Date",
                        accessor: (l: any) => l.dueDate ? (
                            <span className="text-[9px] font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">
                                {format(new Date(l.dueDate), "dd MMM yyyy")}
                            </span>
                        ) : <span className="text-[9px] text-muted-foreground">—</span>,
                        exportValue: (l: any) => l.dueDate ? format(new Date(l.dueDate), "dd MMM yyyy") : "—",
                        className: "text-center",
                    },
                ]}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>Aged Debtor Details</SheetTitle>
                        <SheetDescription>
                            Complete information about this aged debtor loan record.
                        </SheetDescription>
                    </SheetHeader>
                    {viewingLoan ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Loan Date</span>
                                    <span className="font-semibold">{format(new Date(viewingLoan.date || viewingLoan._creationTime), "dd MMM yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Age</span>
                                    <span className="font-semibold">{viewingLoan.ageDays} days</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Original Amount</span>
                                    <span className="font-semibold">UGX {viewingLoan.originalAmount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Paid</span>
                                    <span className="font-bold text-emerald-600">UGX {viewingLoan.paidAmount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Outstanding</span>
                                    <span className="font-bold text-lg text-destructive">UGX {viewingLoan.outstandingBalance.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Age Bucket</span>
                                    <Badge variant="outline" className={cn("text-xs uppercase font-black tracking-tighter", bucketLabel(viewingLoan.bucket).className)}>
                                        {bucketLabel(viewingLoan.bucket).text}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Debtor Information</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Name</span>
                                        <span className="font-semibold">{viewingLoan.customerName}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Phone</span>
                                        <span className="font-semibold text-sm">{viewingLoan.customerPhone}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Client Type</span>
                                        <Badge variant="outline" className="text-[10px] uppercase font-black tracking-tighter px-1 h-4">
                                            {viewingLoan.clientType}
                                        </Badge>
                                    </div>
                                </div>
                            </div>

                            {viewingLoan.dueDate && (
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Due Date</h3>
                                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">Due Date</span>
                                            <span className="font-semibold">{format(new Date(viewingLoan.dueDate), "dd MMM yyyy")}</span>
                                        </div>
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
