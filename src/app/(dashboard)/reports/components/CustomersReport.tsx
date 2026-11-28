"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths, differenceInDays } from "date-fns";
import { Search, Users, TrendingUp, DollarSign, Eye } from "lucide-react";
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
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export function CustomersReport() {
    
    const t = useT();const { currency } = useCurrency();
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [clientType, setClientType] = useState<string>("All");
    const [search, setSearch] = useState("");

    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    // View Details state
    const [viewingCustomer, setViewingCustomer] = useState<any>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const shops = useQuery(api.shops.listAll, {});

    const args = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        clientType: clientType === "All" ? undefined : clientType,
        search: search || undefined,
    };

    const customers = useQuery(api.reports.getCustomerAnalyticsReport, args);
    const summary = useQuery(api.reports.getCustomerAnalyticsSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        clientType: clientType === "All" ? undefined : clientType,
    });

    const totalCount = customers?.length || 0;

    const customStats = summary ? [
        {
            title: "Total Customers",
            value: `${summary.customerCount}`,
            description: "ACTIVE CUSTOMERS",
            color: "border-l-blue-500",
        },
        {
            title: "Total Revenue",
            value: `${currency} ${summary.totalRevenue.toLocaleString()}`,
            description: `${summary.totalSalesCount} TRANSACTIONS`,
            color: "border-l-emerald-500",
        },
        {
            title: "Avg per Customer",
            value: `${currency} ${Math.round(summary.avgSpentPerCustomer).toLocaleString()}`,
            description: "AVERAGE LIFETIME VALUE",
            color: "border-l-purple-500",
        },
        {
            title: "Top Customer",
            value: `${currency} ${summary.topCustomer?.spent.toLocaleString() || "0"}`,
            description: `${summary.topCustomer?.purchases || 0} PURCHASES`,
            color: "border-l-amber-500",
        },
    ] : undefined;

    const handleViewDetails = (customer: any) => {
        setViewingCustomer(customer);
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
                        setClientType("All");
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
                    placeholder={t("Select Shop")}
                    width="160px"
                />

                <SearchableSelect
                    options={[
                        { value: "All", label: "All Client Types" },
                        { value: "Standard Client", label: "Standard Client" },
                        { value: "HP Client", label: "HP Client" }
                    ]}
                    value={clientType}
                    onValueChange={setClientType}
                    placeholder={t("Client Type")}
                    width="150px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder={t("Search customer name or phone...")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary customStats={customStats} isLoading={summary === undefined} />

            <ReportTable
                title={t("Customer Analytics Report")}
                subtitle={t("Analysis of customer behavior, lifetime value, and purchase patterns.")}
                data={customers?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={customers === undefined}
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
                        header: "Customer",
                        accessor: (c: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[160px]">
                                <span className="font-semibold text-primary leading-none">{c.customerName}</span>
                                <span className="text-xs font-bold text-muted-foreground">{c.customerPhone}</span>
                            </div>
                        ),
                        exportValue: (c: any) => c.customerName,
                    },
                    {
                        header: "Type",
                        accessor: (c: any) => (
                            <Badge variant={c.clientType === "HP Client" ? "secondary" : "outline"} className="text-xs h-4">
                                {c.clientType}
                            </Badge>
                        ),
                        exportValue: (c: any) => c.clientType,
                        className: "text-center",
                    },
                    {
                        header: "Total Spent",
                        accessor: (c: any) => (
                            <span className="font-semibold text-emerald-700 text-sm">{currency} {c.totalSpent.toLocaleString()}</span>
                        ),
                        exportValue: (c: any) => c.totalSpent.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Purchases",
                        accessor: (c: any) => (
                            <Badge variant="outline" className="tracking-tighter text-eyebrow uppercase tracking-eyebrow">
                                {c.purchaseCount} {t("SALES")}
                            </Badge>
                        ),
                        exportValue: (c: any) => c.purchaseCount,
                        className: "text-center",
                    },
                    {
                        header: "Avg Purchase",
                        accessor: (c: any) => (
                            <span className="font-bold text-muted-foreground text-sm">{currency} {Math.round(c.totalSpent / c.purchaseCount).toLocaleString()}</span>
                        ),
                        exportValue: (c: any) => Math.round(c.totalSpent / c.purchaseCount).toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "PV / BV",
                        accessor: (c: any) => (
                            <div className="text-right">
                                <div className="font-semibold text-purple-700 text-xs">{c.totalPV.toLocaleString()} {t("PV")}</div>
                                <div className="font-semibold text-indigo-700 text-xs">{c.totalBV.toLocaleString()} {t("BV")}</div>
                            </div>
                        ),
                        exportValue: (c: any) => `${c.totalPV.toLocaleString()} PV / ${c.totalBV.toLocaleString()} BV`,
                        className: "text-right",
                    },
                    {
                        header: "Last Purchase",
                        accessor: (c: any) => (
                            <span className="text-xs font-bold text-muted-foreground">{format(new Date(c.lastPurchaseDate), "dd MMM yyyy")}</span>
                        ),
                        exportValue: (c: any) => format(new Date(c.lastPurchaseDate), "dd MMM yyyy"),
                        className: "text-center",
                    },
                ]}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>{t("Customer Details")}</SheetTitle>
                        <SheetDescription>
                            {t("Complete customer analytics and purchase history.")}
                        </SheetDescription>
                    </SheetHeader>
                    {viewingCustomer ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Customer Name")}</span>
                                    <span className="font-semibold">{viewingCustomer.customerName}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Phone")}</span>
                                    <span className="font-semibold">{viewingCustomer.customerPhone}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Client Type")}</span>
                                    <Badge variant={viewingCustomer.clientType === "HP Client" ? "secondary" : "outline"} className="text-xs">
                                        {viewingCustomer.clientType}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("Purchase Metrics")}</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Total Spent")}</span>
                                        <span className="font-bold text-lg text-emerald-600">{currency} {viewingCustomer.totalSpent.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Number of Purchases")}</span>
                                        <Badge variant="outline" className="text-xs uppercase font-semibold tracking-tighter">
                                            {viewingCustomer.purchaseCount} {t("SALES")}
                                        </Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Avg per Purchase")}</span>
                                        <span className="font-semibold">{currency} {Math.round(viewingCustomer.totalSpent / viewingCustomer.purchaseCount).toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("PV / BV Contribution")}</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Total PV")}</span>
                                        <span className="font-bold text-purple-700">{viewingCustomer.totalPV.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Total BV")}</span>
                                        <span className="font-bold text-indigo-700">{viewingCustomer.totalBV.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("Purchase History")}</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("First Purchase")}</span>
                                        <span className="font-semibold">{format(new Date(viewingCustomer.firstPurchaseDate), "dd MMM yyyy")}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-muted-foreground">{t("Last Purchase")}</span>
                                        <span className="font-semibold">{format(new Date(viewingCustomer.lastPurchaseDate), "dd MMM yyyy")}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Days Since Last")}</span>
                                        <span className={cn("font-semibold", differenceInDays(new Date(), new Date(viewingCustomer.lastPurchaseDate)) > 30 ? "text-destructive" : "text-emerald-600")}>
                                            {differenceInDays(new Date(), new Date(viewingCustomer.lastPurchaseDate))} days
                                        </span>
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
