"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
    Users,
    ShoppingCart,
    ArrowUpRight,
    ArrowDownRight,
    DollarSign,
    Zap,
    Activity,
    Package,
    TrendingUp
} from "lucide-react";
import { cn } from "@/lib/utils";

interface SummaryData {
    totalRevenue: number;
    totalCostOfSales: number;
    totalProfit: number;
    totalExpenses: number;
    totalPV: number;
    totalBV: number;
    totalInventorySellingPrice: number;
    totalInventoryCostPrice: number;
    itemCount: number;
}

export function ReportSummary({ data, isLoading }: { data?: SummaryData; isLoading?: boolean }) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
                ))}
            </div>
        );
    }

    if (!data) return null;

    const stats = [
        {
            title: "Total Sales",
            value: `UGX ${data.totalRevenue.toLocaleString()}`,
            description: `${data.itemCount} ITEMS SOLD`,
            color: "border-l-emerald-500",
            textColor: "text-emerald-700"
        },
        {
            title: "Tied PV / BV",
            value: `${data.totalPV.toLocaleString()} PV`,
            description: `${data.totalBV.toLocaleString()} BV TOTAL`,
            color: "border-l-amber-500",
            textColor: "text-amber-700"
        },
        {
            title: "Est. Net Profit",
            value: `UGX ${data.totalProfit.toLocaleString()}`,
            description: "AFTER COS & EXPENSES",
            color: "border-l-blue-500",
            textColor: "text-blue-700"
        },
        {
            title: "Inventory Value",
            value: `UGX ${data.totalInventorySellingPrice.toLocaleString()}`,
            description: `COST: UGX ${data.totalInventoryCostPrice.toLocaleString()}`,
            color: "border-l-purple-500",
            textColor: "text-purple-700"
        }
    ];

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {stats.map((stat, i) => (
                <div key={i} className={cn(
                    "bg-white border-2 border-muted/20 rounded-xl p-3 pl-4 border-l-4 transition-all hover:bg-muted/5",
                    stat.color
                )}>
                    <div className="text-[15px] font-black tracking-tight text-gray-900 leading-none">
                        {stat.value}
                    </div>
                    <div className="text-[9px] font-black text-muted-foreground mt-1.5 uppercase tracking-tighter">
                        {stat.description}
                    </div>
                </div>
            ))}
        </div>
    );
}
