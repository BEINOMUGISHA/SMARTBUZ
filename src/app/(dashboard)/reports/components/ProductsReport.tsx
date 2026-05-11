"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { Search, Package, TrendingUp, BarChart3, Eye } from "lucide-react";
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

export function ProductsReport() {
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
    const [viewingProduct, setViewingProduct] = useState<any>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const shops = useQuery(api.shops.listAll);

    const args = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
        search: search || undefined,
    };

    const products = useQuery(api.reports.getProductPerformanceReport, args);
    const summary = useQuery(api.reports.getProductPerformanceSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        shopId: !selectedShop || selectedShop === "all" ? undefined : (selectedShop as Id<"shops">),
    });

    const totalCount = products?.length || 0;

    const customStats = summary ? [
        {
            title: "Total Revenue",
            value: `UGX ${summary.totalRevenue.toLocaleString()}`,
            description: `${summary.totalSalesCount} SALES TRANSACTIONS`,
            color: "border-l-emerald-500",
        },
        {
            title: "Products Sold",
            value: `${summary.totalQuantity.toLocaleString()}`,
            description: `${summary.productCount} UNIQUE PRODUCTS`,
            color: "border-l-blue-500",
        },
        {
            title: "Top Product",
            value: summary.topProduct?.name || "N/A",
            description: `UGX ${(summary.topProduct?.revenue || 0).toLocaleString()} REVENUE`,
            color: "border-l-amber-500",
        },
        {
            title: "PV / BV Generated",
            value: `${summary.totalPV.toLocaleString()} / ${summary.totalBV.toLocaleString()}`,
            description: "POINT VOLUME / BUSINESS VOLUME",
            color: "border-l-purple-500",
        },
    ] : undefined;

    const handleViewDetails = (product: any) => {
        setViewingProduct(product);
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
                        placeholder="Search product name or code..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary customStats={customStats} isLoading={summary === undefined} />

            <ReportTable
                title="Product Performance Report"
                subtitle="Analysis of product sales performance, revenue, and PV/BV contribution."
                data={products?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={products === undefined}
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
                        header: "Product",
                        accessor: (p: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[160px]">
                                <span className="font-black text-primary leading-none">{p.productName}</span>
                                <span className="text-[9px] font-bold text-muted-foreground">{p.productCode}</span>
                            </div>
                        ),
                        exportValue: (p: any) => p.productName,
                    },
                    {
                        header: "Quantity Sold",
                        accessor: (p: any) => (
                            <span className="font-black text-blue-600 text-sm">{p.totalQuantity.toLocaleString()}</span>
                        ),
                        exportValue: (p: any) => p.totalQuantity.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Revenue",
                        accessor: (p: any) => (
                            <span className="font-black text-emerald-700 text-sm">UGX {p.totalRevenue.toLocaleString()}</span>
                        ),
                        exportValue: (p: any) => p.totalRevenue.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "PV / BV",
                        accessor: (p: any) => (
                            <div className="text-right">
                                <div className="font-black text-purple-700 text-xs">{p.totalPV.toLocaleString()} PV</div>
                                <div className="font-black text-indigo-700 text-xs">{p.totalBV.toLocaleString()} BV</div>
                            </div>
                        ),
                        exportValue: (p: any) => `${p.totalPV.toLocaleString()} PV / ${p.totalBV.toLocaleString()} BV`,
                        className: "text-right",
                    },
                    {
                        header: "Avg Price",
                        accessor: (p: any) => (
                            <span className="font-bold text-muted-foreground text-sm">UGX {Math.round(p.totalRevenue / p.totalQuantity).toLocaleString()}</span>
                        ),
                        exportValue: (p: any) => Math.round(p.totalRevenue / p.totalQuantity).toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Sales Count",
                        accessor: (p: any) => (
                            <Badge variant="outline" className="text-[9px] uppercase font-black tracking-tighter">
                                {p.saleCount} SALES
                            </Badge>
                        ),
                        exportValue: (p: any) => p.saleCount,
                        className: "text-center",
                    },
                ]}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>Product Performance Details</SheetTitle>
                        <SheetDescription>
                            Complete performance analysis for this product.
                        </SheetDescription>
                    </SheetHeader>
                    {viewingProduct ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Product Name</span>
                                    <span className="font-semibold">{viewingProduct.productName}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Product Code</span>
                                    <span className="font-semibold">{viewingProduct.productCode}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Total Quantity Sold</span>
                                    <span className="font-bold text-lg text-blue-600">{viewingProduct.totalQuantity.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Total Revenue</span>
                                    <span className="font-bold text-lg text-emerald-600">UGX {viewingProduct.totalRevenue.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Average Price</span>
                                    <span className="font-semibold">UGX {Math.round(viewingProduct.totalRevenue / viewingProduct.totalQuantity).toLocaleString()}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">PV / BV Contribution</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Total PV</span>
                                        <span className="font-bold text-purple-700">{viewingProduct.totalPV.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Total BV</span>
                                        <span className="font-bold text-indigo-700">{viewingProduct.totalBV.toLocaleString()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Sales Metrics</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Number of Sales</span>
                                        <Badge variant="outline" className="text-xs uppercase font-black tracking-tighter">
                                            {viewingProduct.saleCount} SALES
                                        </Badge>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Avg Qty per Sale</span>
                                        <span className="font-semibold">{Math.round(viewingProduct.totalQuantity / viewingProduct.saleCount)} units</span>
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
