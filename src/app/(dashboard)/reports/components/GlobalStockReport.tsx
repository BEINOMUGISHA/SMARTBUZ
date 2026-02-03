"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Search, Package, Zap, History } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ReportTable } from "./reports-table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StockEnteredReport } from "./StockEnteredReport";
import { ReportSummary } from "./ReportSummary";

export function GlobalStockReport() {
    const [subTab, setSubTab] = useState("regular");
    const [search, setSearch] = useState("");
    const summaryData = useQuery(api.reports.getReportsSummary, {
        halfPrice: subTab === "hp" ? true : subTab === "regular" ? false : undefined,
        search: search || undefined
    });

    return (
        <div className="space-y-6">
            <Tabs value={subTab} onValueChange={setSubTab} className="w-full">
                <div className="bg-white p-2 rounded-2xl border shadow-sm mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <TabsList className="bg-muted/50 p-1 rounded-xl h-11">
                        <TabsTrigger value="regular" className="rounded-lg px-6 h-9 font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white">
                            <Package className="h-3.5 w-3.5 mr-2" /> Regular Stock
                        </TabsTrigger>
                        <TabsTrigger value="hp" className="rounded-lg px-6 h-9 font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white">
                            <Zap className="h-3.5 w-3.5 mr-2" /> HP Stock
                        </TabsTrigger>
                        <TabsTrigger value="log" className="rounded-lg px-6 h-9 font-black uppercase text-[10px] tracking-widest data-[state=active]:bg-primary data-[state=active]:text-white">
                            <History className="h-3.5 w-3.5 mr-2" /> Entry Log
                        </TabsTrigger>
                    </TabsList>

                    {subTab !== "log" && (
                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-40" />
                            <Input
                                placeholder="Search by name or code..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-10 h-10 text-xs border-muted-foreground/10 bg-muted/20 focus:bg-white rounded-xl transition-all"
                            />
                        </div>
                    )}
                </div>

                {subTab !== "log" && (
                    <ReportSummary
                        data={summaryData || undefined}
                        isLoading={summaryData === undefined}
                    />
                )}

                <TabsContent value="regular" className="mt-0 focus-visible:outline-none">
                    <StockTable halfPrice={false} search={search} summaryData={summaryData} />
                </TabsContent>
                <TabsContent value="hp" className="mt-0 focus-visible:outline-none">
                    <StockTable halfPrice={true} search={search} summaryData={summaryData} />
                </TabsContent>
                <TabsContent value="log" className="mt-0 focus-visible:outline-none">
                    <StockEnteredReport />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function StockTable({ halfPrice, search, summaryData }: { halfPrice: boolean; search: string; summaryData: any }) {
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    const { results: stockRecords, status: stockStatus, loadMore: loadMoreStock, isLoading: stockLoading } = usePaginatedQuery(
        api.reports.getStockSummary,
        { halfPrice, search: search || undefined },
        { initialNumItems: rowsPerPage }
    );

    const totalStockCount = useQuery(api.reports.getStockSummaryCount, { halfPrice, search: search || undefined }) || 0;

    useEffect(() => {
        if (stockStatus === "CanLoadMore" && stockRecords.length < (page * rowsPerPage)) {
            loadMoreStock(rowsPerPage);
        }
    }, [page, rowsPerPage, stockRecords.length, stockStatus, loadMoreStock]);

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    return (
        <ReportTable
            title={`${halfPrice ? "HP" : "Regular"} Inventory Status`}
            subtitle={`Combined view of HQ and all shop holdings (${halfPrice ? "Half Price" : "Regular"})`}
            data={stockRecords?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
            summaryData={summaryData}
            isLoading={stockLoading}
            pagination={{
                currentPage: page,
                totalPages: Math.ceil(totalStockCount / rowsPerPage),
                rowsPerPage: rowsPerPage,
                onRowsPerPageChange: (rows) => {
                    setRowsPerPage(rows);
                    setPage(1);
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
                        <div className="flex flex-col">
                            <span className="font-black text-primary">{item.name}</span>
                            <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-tight">{item.productCode}</span>
                        </div>
                    )
                },
                {
                    header: "Category",
                    accessor: (item: any) => item.categoryName || "General",
                    className: "text-[10px] font-bold uppercase text-muted-foreground"
                },
                {
                    header: "HQ Qty",
                    accessor: (item: any) => (
                        <span className="font-bold">{item.hqQty.toLocaleString()}</span>
                    ),
                    className: "text-center"
                },
                {
                    header: "Shops Qty",
                    accessor: (item: any) => item.shopQty.toLocaleString(),
                    className: "text-center"
                },
                {
                    header: "Combined",
                    accessor: (item: any) => (
                        <div className="bg-primary/10 px-2 py-1 rounded-lg font-black text-primary text-center">
                            {item.totalQty.toLocaleString()}
                        </div>
                    ),
                    className: "text-center"
                },
                {
                    header: "PV/BV Units",
                    accessor: (item: any) => (
                        <div className="flex flex-col text-right text-[10px] font-mono">
                            <span className="text-amber-600 font-bold">{item.pv} PV</span>
                            <span className="text-blue-600 font-bold">{item.bv} BV</span>
                        </div>
                    ),
                    className: "text-right"
                },
                {
                    header: "Total PV/BV",
                    accessor: (item: any) => (
                        <div className="flex flex-col text-right text-[10px] font-mono whitespace-nowrap">
                            <span className="font-black">{(item.pv * item.totalQty).toLocaleString()} PV</span>
                            <span className="font-black text-muted-foreground">{(item.bv * item.totalQty).toLocaleString()} BV</span>
                        </div>
                    ),
                    exportValue: (item: any) => `${(item.pv * item.totalQty).toLocaleString()} PV / ${(item.bv * item.totalQty).toLocaleString()} BV`,
                    className: "text-right bg-amber-50/10"
                },
                {
                    header: "Total Cost/Value",
                    accessor: (item: any) => (
                        <div className="flex flex-col text-right text-[10px] font-mono whitespace-nowrap">
                            <span className="font-black text-emerald-700">{(item.purchasePrice * item.totalQty).toLocaleString()}</span>
                            <span className="font-black text-primary">{(item.price * item.totalQty).toLocaleString()}</span>
                        </div>
                    ),
                    exportValue: (item: any) => `Cost: ${(item.purchasePrice * item.totalQty).toLocaleString()} | Value: ${(item.price * item.totalQty).toLocaleString()}`,
                    className: "text-right bg-primary/5"
                },
            ]}
        />
    );
}
