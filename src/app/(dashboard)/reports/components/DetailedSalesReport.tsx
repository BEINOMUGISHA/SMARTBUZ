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
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export function DetailedSalesReport() {
    
    const t = useT();const { currency } = useCurrency();
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

    // View Details state
    const [viewingSaleId, setViewingSaleId] = useState<Id<"sales"> | null>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const shops = useQuery(api.shops.listAll, {});
    const customers = useQuery(api.customers.listAll, {});

    const salesArgs = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: !customerId || customerId === "all" ? undefined : (customerId as Id<"customers">),
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
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        customerId: !customerId || customerId === "all" ? undefined : (customerId as Id<"customers">),
        clientType: clientType === "All" ? undefined : clientType,
        search: search || undefined
    });

    const saleWithDetails = useQuery(api.sales.getSale, viewingSaleId ? { id: viewingSaleId } : "skip");

    const handleViewDetails = (sale: any) => {
        setViewingSaleId(sale._id);
        setIsViewSheetOpen(true);
    };

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
                    placeholder={t("All Branches")}
                    width="140px"
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Clients/Distributors" },
                        ...(customers || []).map(c => ({ value: c._id, label: `${c.name} (${c.distributorId || 'N/A'})` }))
                    ]}
                    value={customerId}
                    onValueChange={setCustomerId}
                    placeholder={t("Select Client")}
                    width="180px"
                />

                <Select value={clientType} onValueChange={setClientType}>
                    <SelectTrigger className="w-[120px] h-10 border-input tracking-tighter text-eyebrow uppercase tracking-eyebrow">
                        <SelectValue placeholder={t("Client Type")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="All">{t("All Types")}</SelectItem>
                        <SelectItem value="Member">{t("Regular Member")}</SelectItem>
                        <SelectItem value="HP Client">{t("HP Client")}</SelectItem>
                        <SelectItem value="Walk-in">{t("Walk-in")}</SelectItem>
                    </SelectContent>
                </Select>

                <Select value={transactionType} onValueChange={setTransactionType}>
                    <SelectTrigger className="w-[120px] h-10 border-input tracking-tighter text-blue-700 text-eyebrow uppercase tracking-eyebrow">
                        <SelectValue placeholder={t("Transaction")} />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="All">{t("All Trans")}</SelectItem>
                        <SelectItem value="Sale">{t("Sale Only")}</SelectItem>
                        <SelectItem value="Swap">{t("Product Swap")}</SelectItem>
                    </SelectContent>
                </Select>

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder={t("Search within records (name, transaction ID...)")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} variant="sales" />

            <ReportTable
                title={t("Comprehensive Sales Report")}
                subtitle={t("Complete itemized transaction history.")}
                data={salesRecords || []}
                summaryData={summaryData}
                isLoading={salesLoading}
                search={search}
                variant="sales"
                onViewDetails={handleViewDetails}
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
                                <div className="font-semibold text-xs">{format(new Date(s._creationTime), "dd MMM")}</div>
                                <div className="font-semibold text-xs">{format(new Date(s._creationTime), "yyyy")}</div>
                                <div className="text-xs text-muted-foreground">{format(new Date(s._creationTime), "HH:mm:ss")}</div>
                            </div>
                        )
                    },
                    {
                        header: "Invoice No",
                        accessor: (s: any) => (
                            <span className="font-mono font-semibold text-xs text-emerald-800">
                                {s.invoiceNumber || "---"}
                            </span>
                        ),
                        className: "w-[100px]"
                    },
                    {
                        header: "Client Name & Info",
                        accessor: (s: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                                <span className="font-semibold text-primary leading-none">{s.customerName}</span>
                                {s.customerPhone && <span className="text-xs font-bold text-muted-foreground">{s.customerPhone}</span>}
                                {s.customerLocation && <span className="text-xs italic opacity-70">📍 {s.customerLocation}</span>}
                            </div>
                        ),
                        exportValue: (s: any) => s.customerName
                    },
                    {
                        header: "Type",
                        accessor: (s: any) => (
                            <div className="flex flex-col gap-1">
                                <Badge variant="outline" className="tracking-tighter px-1 h-3.5 w-fit text-eyebrow uppercase tracking-eyebrow">
                                    {s.clientType}
                                </Badge>
                                <Badge variant="secondary" className={cn(
                                    "px-1 h-3.5 w-fit text-eyebrow uppercase tracking-eyebrow",
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
                                    <span className="text-emerald-700 tracking-tighter text-eyebrow uppercase tracking-eyebrow">{t("Products Taken:")}</span>
                                    {s.items.map((item: any, idx: number) => (
                                        <div key={idx} className="text-xs leading-tight flex items-center gap-2">
                                            <span className="font-semibold text-primary min-w-[15px]">{item.quantity}x</span>
                                            <span className="truncate max-w-[120px]">{item.name}</span>
                                        </div>
                                    ))}
                                </div>
                                {s.transactionType === "Swap" && s.returnedItems && s.returnedItems.length > 0 && (
                                    <div className="flex flex-col gap-0.5 border-t border-blue-100 pt-1 mt-1 bg-blue-50/50 p-1 rounded-sm">
                                        <span className="text-blue-700 tracking-tighter text-eyebrow uppercase tracking-eyebrow">{t("Items Returned:")}</span>
                                        {s.returnedItems.map((item: any, idx: number) => (
                                            <div key={idx} className="text-xs leading-tight flex items-center gap-2 opacity-70">
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
                            return <span className="font-semibold text-amber-600">{total.toLocaleString()}</span>;
                        },
                        className: "text-center bg-amber-50/20"
                    },
                    {
                        header: "Total BV",
                        accessor: (s: any) => {
                            const total = s.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0);
                            return <span className="font-semibold text-blue-600">{total.toLocaleString()}</span>;
                        },
                        className: "text-center bg-blue-50/20"
                    },
                    {
                        header: `Total (${currency})`,
                        accessor: (s: any) => (
                            <span className="font-semibold text-gray-900">{s.total.toLocaleString()}</span>
                        ),
                        className: "text-right"
                    },
                    {
                        header: "Branch",
                        accessor: "shopName",
                        className: "text-xs font-bold"
                    },
                    {
                        header: "Pay Mode",
                        accessor: (s: any) => (
                            <Badge variant={s.paymentMode === "Loan" ? "destructive" : "outline"} className="text-xs h-4 font-semibold">
                                {s.paymentMode || "Cash"}
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
                        <SheetTitle>{t("Sale Details")}</SheetTitle>
                        <SheetDescription>
                            {t("Complete information about this sale transaction.")}
                        </SheetDescription>
                    </SheetHeader>
                    {saleWithDetails ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Date/Time")}</span>
                                    <span className="font-semibold">{format(new Date(saleWithDetails._creationTime), "dd MMM yyyy HH:mm:ss")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Invoice No")}</span>
                                    <span className="font-semibold">{saleWithDetails.invoiceNumber || "---"}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Total Amount")}</span>
                                    <span className="font-bold text-lg text-emerald-600">{currency} {saleWithDetails.total.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Payment Mode")}</span>
                                    <Badge variant={saleWithDetails.paymentMode === "Loan" ? "destructive" : "outline"}>
                                        {saleWithDetails.paymentMode || "Cash"}
                                    </Badge>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Client Type")}</span>
                                    <span className="font-semibold">{saleWithDetails.clientType}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{t("Branch")}</span>
                                    <span className="font-semibold">{saleWithDetails.shop?.name || "Main Warehouse"}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("Customer Information")}</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">{t("Name")}</span>
                                        <span className="font-semibold">{saleWithDetails.customer?.name || saleWithDetails.manualCustomerName || "Walk-in"}</span>
                                    </div>
                                    {saleWithDetails.customerPhone && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">{t("Phone")}</span>
                                            <span className="font-semibold text-sm">{saleWithDetails.customerPhone}</span>
                                        </div>
                                    )}
                                    {saleWithDetails.customerLocation && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">{t("Location")}</span>
                                            <span className="font-semibold text-sm">{saleWithDetails.customerLocation}</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("Sold By")}</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    {saleWithDetails.user ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">{t("Name")}</span>
                                                <span className="font-semibold capitalize">{saleWithDetails.user.first_name} {saleWithDetails.user.last_name}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">{t("Email")}</span>
                                                <span className="font-semibold text-sm">{saleWithDetails.user.email}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">{t("Role")}</span>
                                                <Badge className="capitalize">{saleWithDetails.user.roles?.[0] || "N/A"}</Badge>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">{t("User information not available")}</div>
                                    )}
                                </div>
                            </div>

                            {saleWithDetails.items && saleWithDetails.items.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">{t("Items (")}{saleWithDetails.items.length})</h3>
                                    <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                        {saleWithDetails.items.map((item: any, idx: number) => (
                                            <div key={idx} className="flex items-center justify-between py-2 border-b last:border-0">
                                                <div className="flex-1">
                                                    <div className="font-semibold text-sm">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground">{item.productCode || "N/A"}</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-semibold text-sm">{item.quantity} x {item.price.toLocaleString()}</div>
                                                    <div className="text-xs text-muted-foreground">{(item.quantity * item.price).toLocaleString()}</div>
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
        </div >
    );
}
