"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Package, ShoppingCart, CreditCard } from "lucide-react";
import { format, subMonths } from "date-fns";
import { ReportFilters } from "./ReportFilters";

export function OverviewReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const stats = useQuery(api.reports.summaryStats, {
        startDate: dateRange.from,
        endDate: dateRange.to
    });

    const shopSummary = useQuery(api.reports.getShopSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to
    });

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    return (
        <div className="space-y-6">
            <div className="bg-white p-3 rounded-xl border shadow-xs flex items-center justify-between gap-3">
                <ReportFilters
                    dateRange={dateRange}
                    reportMode={reportMode}
                    onDateRangeChange={setDateRange}
                    onReportModeChange={setReportMode}
                />
                <div className="text-[10px] font-black text-muted-foreground uppercase tracking-widest px-3 bg-muted/20 h-8 flex items-center rounded-lg">
                    Business Snapshot
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card className="border-none shadow-md bg-linear-to-br from-primary/10 to-transparent">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Total Revenue</CardTitle>
                        <TrendingUp className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black">{stats ? formatPrice(stats.totalRevenue) : "..."}</div>
                        <p className="text-xs text-muted-foreground mt-1">Gross sales from all branches</p>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-md bg-linear-to-br from-green-500/10 to-transparent">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Total PV</CardTitle>
                        <Package className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black">{stats ? stats.totalPV.toLocaleString() : "..."}</div>
                        <p className="text-xs text-muted-foreground mt-1">Accumulated Point Value</p>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-md bg-linear-to-br from-blue-500/10 to-transparent">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Transactions</CardTitle>
                        <ShoppingCart className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black">{stats ? stats.salesCount.toLocaleString() : "..."}</div>
                        <p className="text-xs text-muted-foreground mt-1">Total orders processed</p>
                    </CardContent>
                </Card>
                <Card className="border-none shadow-md bg-linear-to-br from-purple-500/10 to-transparent">
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Outstanding Loans</CardTitle>
                        <CreditCard className="h-4 w-4 text-purple-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-black">{stats ? formatPrice(stats.totalLoansBalance) : "..."}</div>
                        <p className="text-xs text-muted-foreground mt-1">Pending payments</p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="rounded-xl shadow-sm border-muted/50 overflow-hidden">
                    <CardHeader className="bg-muted/30 border-b">
                        <CardTitle className="text-lg font-black">Top Performing Shops</CardTitle>
                    </CardHeader>
                    <CardContent className="p-0">
                        <div className="divide-y">
                            {(shopSummary || []).sort((a: any, b: any) => b.totalSales - a.totalSales).slice(0, 5).map((shop: any, i: number) => (
                                <div key={i} className="flex items-center justify-between p-4 hover:bg-muted/10 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary font-bold">{i + 1}</div>
                                        <div>
                                            <p className="font-bold">{shop.name}</p>
                                            <p className="text-xs text-muted-foreground truncate max-w-[150px]">{shop.location}</p>
                                        </div>
                                    </div>
                                    <div className="text-right font-black text-sm">{formatPrice(shop.totalSales)}</div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
