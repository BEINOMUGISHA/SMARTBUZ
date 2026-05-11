"use client";

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
    // Optional loan-specific data
    totalOutstandingBalance?: number;
    totalLoanedAmount?: number;
    loanCount?: number;
}

export type SummaryVariant = "sales" | "overview" | "shops" | "stock" | "loans" | "promotions" | "payments" | "aged" | "expenses" | "products" | "customers" | "users" | "profit";

interface ReportSummaryProps {
    data?: SummaryData;
    isLoading?: boolean;
    variant?: SummaryVariant;
    // Optional override stats for custom displays
    customStats?: Array<{
        title: string;
        value: string;
        description: string;
        color: string;
    }>;
}

export function ReportSummary({ data, isLoading, variant = "overview", customStats }: ReportSummaryProps) {
    if (isLoading) {
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-16 bg-muted/50 rounded-xl animate-pulse" />
                ))}
            </div>
        );
    }

    if (!data && !customStats) return null;

    // Use custom stats if provided, otherwise generate based on variant
    const stats = customStats || getStatsForVariant(variant, data!);

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

export function getStatsForVariant(variant: SummaryVariant, data: SummaryData) {
    switch (variant) {
        case "sales":
        case "overview":
            return [
                {
                    title: "Total Sales",
                    value: `UGX ${data.totalRevenue.toLocaleString()}`,
                    description: `${data.itemCount} ITEMS SOLD`,
                    color: "border-l-emerald-500"
                },
                {
                    title: "Tied PV / BV",
                    value: `${data.totalPV.toLocaleString()} PV`,
                    description: `${data.totalBV.toLocaleString()} BV TOTAL`,
                    color: "border-l-amber-500"
                },
                {
                    title: "Est. Net Profit",
                    value: `UGX ${data.totalProfit.toLocaleString()}`,
                    description: "AFTER COS & EXPENSES",
                    color: "border-l-blue-500"
                },
                {
                    title: "Inventory Value",
                    value: `UGX ${data.totalInventorySellingPrice.toLocaleString()}`,
                    description: `COST: UGX ${data.totalInventoryCostPrice.toLocaleString()}`,
                    color: "border-l-purple-500"
                }
            ];

        case "shops":
            return [
                {
                    title: "Total Sales",
                    value: `UGX ${data.totalRevenue.toLocaleString()}`,
                    description: `${data.itemCount} TRANSACTIONS`,
                    color: "border-l-emerald-500"
                },
                {
                    title: "Tied PV / BV",
                    value: `${data.totalPV.toLocaleString()} PV`,
                    description: `${data.totalBV.toLocaleString()} BV TOTAL`,
                    color: "border-l-amber-500"
                },
                {
                    title: "Est. Net Profit",
                    value: `UGX ${data.totalProfit.toLocaleString()}`,
                    description: "AFTER COS & EXPENSES",
                    color: "border-l-blue-500"
                },
                {
                    title: "Expenses",
                    value: `UGX ${data.totalExpenses.toLocaleString()}`,
                    description: "TOTAL RECORDED",
                    color: "border-l-red-500"
                }
            ];

        case "stock":
            return [
                {
                    title: "Inventory Value",
                    value: `UGX ${data.totalInventorySellingPrice.toLocaleString()}`,
                    description: "SELLING PRICE TOTAL",
                    color: "border-l-emerald-500"
                },
                {
                    title: "Cost Value",
                    value: `UGX ${data.totalInventoryCostPrice.toLocaleString()}`,
                    description: "PURCHASE PRICE TOTAL",
                    color: "border-l-blue-500"
                },
                {
                    title: "Total PV",
                    value: `${data.totalPV.toLocaleString()} PV`,
                    description: "TIED IN STOCK",
                    color: "border-l-amber-500"
                },
                {
                    title: "Total BV",
                    value: `${data.totalBV.toLocaleString()} BV`,
                    description: "TIED IN STOCK",
                    color: "border-l-purple-500"
                }
            ];

        case "loans": {
            const totalLoaned = data.totalLoanedAmount ?? 0;
            const totalOutstanding = data.totalOutstandingBalance ?? 0;
            return [
                {
                    title: "Total Loaned",
                    value: `UGX ${totalLoaned.toLocaleString()}`,
                    description: `${data.loanCount || 0} LOAN RECORDS`,
                    color: "border-l-red-500"
                },
                {
                    title: "Outstanding",
                    value: `UGX ${totalOutstanding.toLocaleString()}`,
                    description: "BALANCE DUE",
                    color: "border-l-orange-500"
                },
                {
                    title: "Tied PV / BV",
                    value: `${data.totalPV.toLocaleString()} PV`,
                    description: `${data.totalBV.toLocaleString()} BV ON CREDIT`,
                    color: "border-l-amber-500"
                },
                {
                    title: "Paid Amount",
                    value: `UGX ${Math.max(0, totalLoaned - totalOutstanding).toLocaleString()}`,
                    description: "ALREADY COLLECTED",
                    color: "border-l-emerald-500"
                }
            ];
        }

        case "promotions":
            return [
                {
                    title: "Total Redemptions",
                    value: (data as any).totalRedemptions?.toLocaleString() || "0",
                    description: "TIMES REWARDED",
                    color: "border-l-primary"
                },
                {
                    title: "Unique Customers",
                    value: (data as any).uniqueCustomers?.toLocaleString() || "0",
                    description: "BENEFICIARIES",
                    color: "border-l-emerald-500"
                },
                {
                    title: "Driving Products",
                    value: (data as any).uniqueProducts?.toLocaleString() || "0",
                    description: "SOURCE ITEMS",
                    color: "border-l-amber-500"
                }
            ];

        default:
            return [];
    }
}
