"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { Search, Store, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";
import { SearchableSelect } from "./SearchableSelect";
import { usePaginatedQuery } from "convex/react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Id } from "../../../../../convex/_generated/dataModel";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";

export function ShopsReport() {
    const [activeNestedTab, setActiveNestedTab] = useState("overview");

    // --- OVERVIEW TAB STATE ---
    const [overviewReportMode, setOverviewReportMode] = useState<"daily" | "range">("range");
    const [overviewDateRange, setOverviewDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });
    const [overviewShop, setOverviewShop] = useState<string>("all");
    const [overviewCustomer, setOverviewCustomer] = useState<string>("all");
    const [overviewSearch, setOverviewSearch] = useState("");
    const [dashView, setDashView] = useState<"sales" | "loans">("sales");

    // View Details state
    const [viewingSaleId, setViewingSaleId] = useState<Id<"sales"> | null>(null);
    const [viewingLoanId, setViewingLoanId] = useState<Id<"loans"> | null>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);
    const [viewType, setViewType] = useState<"sale" | "loan">("sale");

    // --- ISSUED STOCK TAB STATE ---
    const [issuedReportMode, setIssuedReportMode] = useState<"daily" | "range">("range");
    const [issuedDateRange, setIssuedDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });
    const [issuedShop, setIssuedShop] = useState<string>("all");
    const [issuedType, setIssuedType] = useState<"all" | "regular" | "hp">("all");
    const [issuedSearch, setIssuedSearch] = useState("");

    // --- PROMOTIONS TAB STATE ---
    const [promotionsReportMode, setPromotionsReportMode] = useState<"daily" | "range">("range");
    const [promotionsDateRange, setPromotionsDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });
    const [promotionsShop, setPromotionsShop] = useState<string>("all");

    const shops = useQuery(api.shops.listAll);
    const customers = useQuery(api.customers.listAll);

    // 1. OVERVIEW QUERIES
    const shopSummary = useQuery(api.reports.getShopSummary, {
        startDate: overviewDateRange.from,
        endDate: overviewDateRange.to,
        search: overviewSearch || undefined
    });

    const salesArgs = {
        startDate: overviewDateRange.from,
        endDate: overviewDateRange.to,
        shopId: !overviewShop || overviewShop === "all" ? undefined : (overviewShop as Id<"shops">),
        customerId: !overviewCustomer || overviewCustomer === "all" ? undefined : (overviewCustomer as Id<"customers">),
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
        search: overviewSearch || undefined
    });

    // 2. ISSUED STOCK QUERIES
    const issueRecords = useQuery(api.stocks.getShopIssueRecords, {
        shopId: issuedShop === "all" ? undefined : (issuedShop as Id<"shops">),
        from: issuedDateRange.from,
        to: issuedDateRange.to,
        searchTerm: issuedSearch || undefined,
    });

    // 3. PROMOTIONS QUERIES
    const promotionsStatsArgs = {
        shopId: promotionsShop === "all" ? undefined : (promotionsShop as Id<"shops">),
        from: promotionsDateRange.from,
        to: promotionsDateRange.to
    };
    const stats = useQuery(api.promotions.redemptionsStats, promotionsStatsArgs);
    const listArgs = {
        ...promotionsStatsArgs,
        email: "admin@tiens.com" // Backend allows override with targetShopId
    };
    const { results: redemptions, status: redemptionStatus } = usePaginatedQuery(
        api.promotions.listRedemptions,
        listArgs,
        { initialNumItems: 50 }
    );

    // View Details queries
    const saleWithDetails = useQuery(api.sales.getSale, viewType === "sale" && viewingSaleId ? { id: viewingSaleId } : "skip");
    const loanWithDetails = useQuery(api.loans.getLoanWithDetails, viewType === "loan" && viewingLoanId ? { id: viewingLoanId } : "skip");

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    const handleViewSale = (sale: any) => {
        setViewingSaleId(sale._id);
        setViewType("sale");
        setIsViewSheetOpen(true);
    };

    const handleViewLoan = (loan: any) => {
        setViewingLoanId(loan._id);
        setViewType("loan");
        setIsViewSheetOpen(true);
    };

    return (
        <div className="space-y-6">
            <Tabs value={activeNestedTab} onValueChange={setActiveNestedTab} className="w-full">
                <div className="flex items-center justify-between mb-2">
                    <TabsList className="bg-muted/50 p-1 rounded-xl h-10 border shadow-xs">
                        <TabsTrigger value="overview" className="rounded-lg px-5 h-8 font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white">
                            Overview
                        </TabsTrigger>
                        <TabsTrigger value="issued" className="rounded-lg px-5 h-8 font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-emerald-600 data-[state=active]:text-white text-emerald-600">
                            Issued Stock
                        </TabsTrigger>
                        <TabsTrigger value="promotions" className="rounded-lg px-5 h-8 font-black uppercase text-[9px] tracking-widest data-[state=active]:bg-amber-500 data-[state=active]:text-white text-amber-600">
                            Promotions
                        </TabsTrigger>
                    </TabsList>

                    {activeNestedTab === "overview" && overviewShop !== "all" && (
                        <div className="flex bg-muted/40 p-1 rounded-lg h-9 gap-1 border border-border shrink-0">
                            <button
                                onClick={() => setDashView("sales")}
                                className={cn(
                                    "px-3 h-full rounded-md text-[9px] font-black uppercase tracking-widest transition-all",
                                    dashView === "sales" ? "bg-primary text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
                                )}
                            >
                                Sales
                            </button>
                            <button
                                onClick={() => setDashView("loans")}
                                className={cn(
                                    "px-3 h-full rounded-md text-[9px] font-black uppercase tracking-widest transition-all",
                                    dashView === "loans" ? "bg-destructive text-white shadow-sm" : "text-muted-foreground hover:bg-muted"
                                )}
                            >
                                Loans
                            </button>
                        </div>
                    )}
                </div>

                <TabsContent value="overview" className="focus-visible:outline-none space-y-6">
                    {/* OVERVIEW SPECIFIC FILTERS */}
                    <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                        <ReportFilters
                            dateRange={overviewDateRange}
                            reportMode={overviewReportMode}
                            onDateRangeChange={setOverviewDateRange}
                            onReportModeChange={setOverviewReportMode}
                            onClearFilters={() => {
                                setOverviewDateRange({
                                    from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                                    to: format(new Date(), "yyyy-MM-dd")
                                });
                                setOverviewReportMode("range");
                                setOverviewShop("all");
                                setOverviewCustomer("all");
                                setOverviewSearch("");
                                setDashView("sales");
                            }}
                        />

                        <SearchableSelect
                            options={[
                                { value: "all", label: "Overview: All Branches" },
                                ...(shops || []).map(s => ({ value: s._id, label: s.name }))
                            ]}
                            value={overviewShop}
                            onValueChange={setOverviewShop}
                            placeholder="Select Branch"
                            width="200px"
                        />

                        {overviewShop !== "all" && (
                            <SearchableSelect
                                options={[
                                    { value: "all", label: "All Distributors" },
                                    ...(customers || []).map(c => ({ value: c._id, label: c.name }))
                                ]}
                                value={overviewCustomer}
                                onValueChange={setOverviewCustomer}
                                placeholder="Filter Client"
                                width="180px"
                            />
                        )}

                        {/* <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
                            <Input
                                placeholder={overviewShop === "all" ? "Search branches..." : "Search within branch transactions..."}
                                value={overviewSearch}
                                onChange={(e) => setOverviewSearch(e.target.value)}
                                className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                            />
                        </div> */}
                    </div>

                    <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} variant="shops" />

                    {overviewShop !== "all" && dashView === "loans" ? (
                        <ReportTable
                            title={`${shops?.find(s => String(s._id) === overviewShop)?.name || "Shop"} - Detailed Loans`}
                            subtitle={`Comprehensive loan records from ${overviewDateRange.from} to ${overviewDateRange.to}`}
                            data={shopLoans || []}
                            isLoading={loansLoading}
                            summaryData={summaryData}
                            variant="loans"
                            onViewDetails={handleViewLoan}
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
                    ) : overviewShop !== "all" && dashView === "sales" ? (
                        <ReportTable
                            title={`${shops?.find(s => String(s._id) === overviewShop)?.name || "Branch"} - Detailed Sales`}
                            subtitle={`Sales transactions from ${overviewDateRange.from} to ${overviewDateRange.to}`}
                            data={shopSales || []}
                            isLoading={salesLoading}
                            summaryData={summaryData}
                            variant="sales"
                            onViewDetails={handleViewSale}
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
                    )}
                </TabsContent>

                <TabsContent value="issued" className="focus-visible:outline-none space-y-6">
                    {/* ISSUED STOCK FILTERS */}
                    <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                        <ReportFilters
                            dateRange={issuedDateRange}
                            reportMode={issuedReportMode}
                            onDateRangeChange={setIssuedDateRange}
                            onReportModeChange={setIssuedReportMode}
                            onClearFilters={() => {
                                setIssuedDateRange({
                                    from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                                    to: format(new Date(), "yyyy-MM-dd")
                                });
                                setIssuedReportMode("range");
                                setIssuedShop("all");
                                setIssuedType("all");
                                setIssuedSearch("");
                            }}
                        />

                        <SearchableSelect
                            options={[
                                { value: "all", label: "All Branches" },
                                ...(shops || []).map(s => ({ value: s._id, label: s.name }))
                            ]}
                            value={issuedShop}
                            onValueChange={setIssuedShop}
                            placeholder="Select Branch"
                            width="200px"
                        />

                        <SearchableSelect
                            options={[
                                { value: "all", label: "All Stock Types" },
                                { value: "regular", label: "Regular Stock" },
                                { value: "hp", label: "HP Stock (Half Price)" },
                            ]}
                            value={issuedType}
                            onValueChange={(val: any) => setIssuedType(val)}
                            placeholder="Stock Type"
                            width="180px"
                        />

                        <div className="relative flex-1 min-w-[200px]">
                            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
                            <Input
                                placeholder="Search by product name or code..."
                                value={issuedSearch}
                                onChange={(e) => setIssuedSearch(e.target.value)}
                                className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                            />
                        </div>
                    </div>

                    {/* Issued Stock Summary */}
                    {(() => {
                        const filteredRecords = (issueRecords || []).filter(r => {
                            if (issuedType === "regular") return !r.halfPrice;
                            if (issuedType === "hp") return r.halfPrice;
                            return true;
                        });

                        const totalQty = filteredRecords.reduce((sum, r) => sum + r.quantity, 0);
                        const uniqueProducts = new Set(filteredRecords.map(r => r.stockId)).size;

                        return (
                            <>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <Card className="bg-emerald-50 border-emerald-100 shadow-sm p-4 rounded-xl border-l-4 border-l-emerald-600">
                                        <div className="text-[10px] font-black uppercase text-emerald-700 tracking-widest mb-1 font-mono">Total quantity Issued</div>
                                        <div className="text-2xl font-black text-emerald-800">
                                            {totalQty.toLocaleString()}
                                        </div>
                                        <div className="text-[9px] font-bold text-emerald-600/70 uppercase mt-0.5">Physical items sent</div>
                                    </Card>

                                    <Card className="bg-blue-50 border-blue-100 shadow-sm p-4 rounded-xl border-l-4 border-l-blue-600">
                                        <div className="text-[10px] font-black uppercase text-blue-700 tracking-widest mb-1 font-mono">No. of Different Products</div>
                                        <div className="text-2xl font-black text-blue-800">
                                            {uniqueProducts.toLocaleString()}
                                        </div>
                                        <div className="text-[9px] font-bold text-blue-600/70 uppercase mt-0.5">Unique product types</div>
                                    </Card>
                                </div>

                                <ReportTable
                                    title={issuedShop === "all" ? "Branch Stock Issue Log" : `${shops?.find(s => String(s._id) === issuedShop)?.name} - Issue Audit`}
                                    subtitle={`Audit trail of ${issuedType !== "all" ? issuedType.toUpperCase() : "all"} stock transferred from HQ`}
                                    data={filteredRecords}
                                    isLoading={issueRecords === undefined}
                                    variant="overview"
                                    columns={[
                                        {
                                            header: "Date/Time",
                                            accessor: (r: any) => (
                                                <div className="font-mono leading-tight">
                                                    <div className="font-black">{format(new Date(r.date), "dd MMM yyyy")}</div>
                                                    <div className="text-[9px] text-muted-foreground">{format(new Date(r.date), "HH:mm")}</div>
                                                </div>
                                            )
                                        },
                                        {
                                            header: "Branch",
                                            accessor: (r: any) => (
                                                <div className="flex items-center gap-2 font-black text-primary">
                                                    <Store className="h-3 w-3 opacity-50" />
                                                    {r.shopName}
                                                </div>
                                            )
                                        },
                                        {
                                            header: "Product",
                                            accessor: (r: any) => (
                                                <div className="flex flex-col">
                                                    <span className="text-[11px] font-black flex items-center gap-1">
                                                        {r.stockName}
                                                        {r.halfPrice && <Badge variant="outline" className="text-[8px] h-3.5 px-1 bg-amber-50 text-amber-700 border-amber-200">HP</Badge>}
                                                    </span>
                                                    <span className="text-[9px] text-muted-foreground font-mono leading-none tracking-tighter uppercase">{r.productCode}</span>
                                                </div>
                                            )
                                        },
                                        {
                                            header: "Qty Issued",
                                            accessor: (r: any) => (
                                                <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 border-emerald-200 font-black h-5">
                                                    {r.quantity}
                                                </Badge>
                                            ),
                                            className: "text-center"
                                        },
                                        {
                                            header: "Issued By",
                                            accessor: "userName",
                                            className: "text-right text-[10px] font-bold text-muted-foreground"
                                        }
                                    ]}
                                />
                            </>
                        );
                    })()}
                </TabsContent>

                <TabsContent value="promotions" className="focus-visible:outline-none space-y-6">
                    {/* PROMOTIONS FILTERS */}
                    <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                        <ReportFilters
                            dateRange={promotionsDateRange}
                            reportMode={promotionsReportMode}
                            onDateRangeChange={setPromotionsDateRange}
                            onReportModeChange={setPromotionsReportMode}
                            onClearFilters={() => {
                                setPromotionsDateRange({
                                    from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                                    to: format(new Date(), "yyyy-MM-dd")
                                });
                                setPromotionsReportMode("range");
                                setPromotionsShop("all");
                            }}
                        />

                        <SearchableSelect
                            options={[
                                { value: "all", label: "All Branches" },
                                ...(shops || []).map(s => ({ value: s._id, label: s.name }))
                            ]}
                            value={promotionsShop}
                            onValueChange={setPromotionsShop}
                            placeholder="Select Branch"
                            width="200px"
                        />
                    </div>

                    {/* Summary Cards */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <Card className="bg-primary/5 border-primary/20 shadow-sm p-4 rounded-xl border-l-4 border-l-primary">
                            <div className="text-[10px] font-black uppercase text-muted-foreground tracking-widest mb-1 font-mono">Total Gifts Given</div>
                            <div className="text-2xl font-black text-primary">
                                {stats?.totalRedemptions?.toLocaleString() || "0"}
                            </div>
                            <div className="text-[9px] font-bold text-primary/70 uppercase mt-0.5">Overall redemptions</div>
                        </Card>
                        <Card className="bg-emerald-50 border-emerald-100 shadow-sm p-4 rounded-xl border-l-4 border-l-emerald-500">
                            <div className="text-[10px] font-black uppercase text-emerald-700 tracking-widest mb-1 font-mono">People Given Gifts</div>
                            <div className="text-2xl font-black text-emerald-600">
                                {stats?.uniqueCustomers?.toLocaleString() || "0"}
                            </div>
                            <div className="text-[9px] font-bold text-emerald-600/70 uppercase mt-0.5">Unique customers</div>
                        </Card>
                        <Card className="bg-amber-50 border-amber-100 shadow-sm p-4 rounded-xl border-l-4 border-l-amber-500">
                            <div className="text-[10px] font-black uppercase text-amber-700 tracking-widest mb-1 font-mono">Main Products Sold</div>
                            <div className="text-2xl font-black text-amber-600">
                                {stats?.uniqueProducts?.toLocaleString() || "0"}
                            </div>
                            <div className="text-[9px] font-bold text-amber-600/70 uppercase mt-0.5">Unique item types</div>
                        </Card>
                    </div>

                    <ReportTable
                        title={promotionsShop === "all" ? "Branch Promotions Hub" : `${shops?.find(s => String(s._id) === promotionsShop)?.name} - Promotion Audit`}
                        subtitle={`Detailed log of rewards redeemed from ${promotionsDateRange.from} to ${promotionsDateRange.to}`}
                        data={redemptions || []}
                        isLoading={redemptionStatus === "LoadingFirstPage"}
                        summaryData={stats}
                        variant="promotions"
                        columns={[
                            {
                                header: "Date/Time",
                                accessor: (r: any) => (
                                    <div className="font-mono leading-tight">
                                        <div className="font-black text-[11px]">{format(new Date(r.date), "dd MMM yyyy")}</div>
                                        <div className="text-[9px] text-muted-foreground">{format(new Date(r.date), "HH:mm")}</div>
                                    </div>
                                )
                            },
                            {
                                header: "Promotion & Reward",
                                accessor: (r: any) => (
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-black text-primary uppercase tracking-tighter">{r.promotionName}</span>
                                        <Badge variant="outline" className="text-[9px] h-4 mt-1 border-amber-200 bg-amber-50 text-amber-700 font-black uppercase tracking-widest w-fit">
                                            🎁 {r.prize}
                                        </Badge>
                                    </div>
                                )
                            },
                            {
                                header: "Trigger Product",
                                accessor: (r: any) => (
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-bold text-slate-700">{r.productName}</span>
                                        <span className="text-[9px] font-mono text-muted-foreground">Qty: {r.redeemedQuantity}</span>
                                    </div>
                                )
                            },
                            {
                                header: "Beneficiary",
                                accessor: (r: any) => (
                                    <div className="flex flex-col">
                                        <span className="text-[11px] font-black text-slate-800">{r.customerName}</span>
                                        <div className="flex items-center gap-1 mt-0.5">
                                            <Store className="h-3 w-3 text-muted-foreground opacity-50" />
                                            <span className="text-[9px] text-muted-foreground font-medium uppercase tracking-tighter">{shops?.find(s => s._id === r.shopId)?.name || 'Branch'}</span>
                                        </div>
                                    </div>
                                )
                            },
                            {
                                header: "Operator",
                                accessor: "operatorName",
                                className: "text-right text-[10px] font-bold text-muted-foreground uppercase tracking-widest"
                            }
                        ]}
                    />
                </TabsContent>
            </Tabs>

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>
                            {viewType === "sale" ? "Sale Details" : "Loan Details"}
                        </SheetTitle>
                        <SheetDescription>
                            Complete information about this {viewType} record.
                        </SheetDescription>
                    </SheetHeader>
                    {viewType === "sale" && saleWithDetails ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Date/Time</span>
                                    <span className="font-semibold">{format(new Date(saleWithDetails._creationTime), "dd MMM yyyy HH:mm:ss")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Total Amount</span>
                                    <span className="font-bold text-lg text-emerald-600">UGX {saleWithDetails.total.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Branch</span>
                                    <span className="font-semibold">{saleWithDetails.shop?.name || "Main Warehouse"}</span>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Sold By</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    {saleWithDetails.user ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Name</span>
                                                <span className="font-semibold capitalize">{saleWithDetails.user.first_name} {saleWithDetails.user.last_name}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Email</span>
                                                <span className="font-semibold text-sm">{saleWithDetails.user.email}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Role</span>
                                                <Badge className="capitalize">{saleWithDetails.user.roles?.[0] || "N/A"}</Badge>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">User information not available</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : viewType === "loan" && loanWithDetails ? (
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
                            </div>
                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Customer Information</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Name</span>
                                        <span className="font-semibold">{loanWithDetails.customer?.name || loanWithDetails.manualCustomerName || "N/A"}</span>
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
        </div >
    );
}
