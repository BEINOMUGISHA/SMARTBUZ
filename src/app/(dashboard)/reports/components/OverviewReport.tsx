"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Package, ShoppingCart, CreditCard } from "lucide-react";
import { format, subMonths } from "date-fns";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";

export function OverviewReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const summaryData = useQuery(api.reports.getReportsSummary, {
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

            <ReportSummary data={summaryData || undefined} isLoading={summaryData === undefined} variant="overview" />

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
