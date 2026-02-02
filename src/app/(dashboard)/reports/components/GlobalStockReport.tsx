"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";

export function GlobalStockReport() {
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    const { results: stockRecords, status: stockStatus, loadMore: loadMoreStock, isLoading: stockLoading } = usePaginatedQuery(
        api.reports.getStockSummary,
        {},
        { initialNumItems: rowsPerPage }
    );

    const totalStockCount = useQuery(api.reports.getStockSummaryCount) || 0;

    useEffect(() => {
        if (stockStatus === "CanLoadMore" && stockRecords.length < (page * rowsPerPage)) {
            loadMoreStock(rowsPerPage);
        }
    }, [page, rowsPerPage, stockRecords.length, stockStatus, loadMoreStock]);

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    return (
        <div className="space-y-4">
            <div className="bg-white p-3 rounded-xl border shadow-xs flex items-center justify-between gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search inventory by product name or code..."
                        className="pl-9 h-8 text-[11px] border-muted-foreground/10 bg-muted/5 focus:bg-white transition-all"
                    />
                </div>
                <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-3 bg-muted/20 h-8 flex items-center rounded-lg">
                    Stock Audit
                </div>
            </div>
            <ReportTable
                title="Global Inventory Status"
                subtitle="Combined view of HQ and all shop holdings"
                data={stockRecords?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={stockLoading}
                pagination={{
                    currentPage: page,
                    totalPages: Math.ceil(totalStockCount / rowsPerPage),
                    rowsPerPage: rowsPerPage,
                    onRowsPerPageChange: (rows) => {
                        setRowsPerPage(rows);
                        setPage(1);
                        localStorage.setItem("pos_reports_stock_rows", String(rows));
                    },
                    totalItems: totalStockCount,
                    onNext: () => {
                        const totalPages = Math.ceil(totalStockCount / rowsPerPage);
                        if (page < totalPages) setPage(p => p + 1);
                    },
                    onPrev: () => setPage(p => Math.max(1, p - 1)),
                    canLoadMore: stockStatus === "CanLoadMore"
                }}
                columns={[
                    {
                        header: "Product", accessor: (item: any) => (
                            <div>
                                <p className="font-bold">{item.name}</p>
                                <p className="text-[10px] uppercase text-muted-foreground">{item.productCode}</p>
                            </div>
                        )
                    },
                    { header: "Category", accessor: (item: any) => item.categoryName || "General" },
                    { header: "HQ", accessor: (item: any) => item.hqQty.toLocaleString(), className: "text-center font-bold" },
                    { header: "Shops", accessor: (item: any) => item.shopQty.toLocaleString(), className: "text-center" },
                    { header: "System", accessor: (item: any) => item.totalQty.toLocaleString(), className: "text-center font-black bg-primary/5" },
                    { header: "Sell Price", accessor: (item: any) => formatPrice(item.sellingPrice || item.price), className: "text-right" },
                    { header: "PV/BV", accessor: (item: any) => `${item.pv}/${item.bv}`, className: "text-right font-medium text-muted-foreground" },
                ]}
            />
        </div>
    );
}
