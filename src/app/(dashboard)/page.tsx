"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { subMonths, startOfDay, endOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import {
    TrendingUp,
    TrendingDown,
    DollarSign,
    ShoppingCart,
    Package,
    BarChart3
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
    const [date, setDate] = useState<DateRange | undefined>({
        from: subMonths(new Date(), 1),
        to: new Date(),
    });

    const reports = useQuery(api.reports.getSalesAndExpenses, {
        startDate: date?.from?.toISOString() ?? subMonths(new Date(), 1).toISOString(),
        endDate: date?.to?.toISOString() ?? new Date().toISOString(),
    });

    // Calculate totals from reports
    const totalRevenue = reports?.sales.reduce((sum, s) => sum + s.total, 0) ?? 0;
    const salesCount = reports?.sales.length ?? 0;
    const totalExpenses = reports?.expenses.reduce((sum, e) => sum + e.amount, 0) ?? 0;

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Dashboard Overview</h1>
                    <p className="text-muted-foreground text-sm">
                        Monitor your business performance in real-time.
                    </p>
                </div>
                <DatePickerWithRange date={date} setDate={setDate} />
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
                        <DollarSign className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">UGX {totalRevenue.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">
                            Across selected date range
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Sales Count</CardTitle>
                        <ShoppingCart className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{salesCount}</div>
                        <p className="text-xs text-muted-foreground">
                            Total orders completed
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Expenses</CardTitle>
                        <TrendingDown className="h-4 w-4 text-destructive" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">UGX {totalExpenses.toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">
                            Operational costs
                        </p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Net Growth</CardTitle>
                        <TrendingUp className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">UGX {(totalRevenue - totalExpenses).toLocaleString()}</div>
                        <p className="text-xs text-muted-foreground">
                            Net profit for period
                        </p>
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4">
                    <CardHeader>
                        <CardTitle>Recent Sales</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {reports === undefined ? (
                            <div className="h-[300px] animate-pulse rounded bg-muted" />
                        ) : (
                            <div className="space-y-4">
                                {reports.sales.length === 0 ? (
                                    <p className="text-center text-muted-foreground py-20">No sales found for this period.</p>
                                ) : (
                                    reports.sales.slice(0, 5).map((sale) => (
                                        <div key={sale._id} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                                            <div>
                                                <p className="font-medium text-sm">{sale.clientType}</p>
                                                <p className="text-xs text-muted-foreground">{new Date(sale.date).toLocaleDateString()}</p>
                                            </div>
                                            <p className="font-bold">UGX {sale.total.toLocaleString()}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
                <Card className="col-span-3">
                    <CardHeader>
                        <CardTitle>Overview Statistics</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="flex h-[300px] flex-col items-center justify-center gap-4 text-center">
                            <BarChart3 className="h-12 w-12 text-muted" />
                            <p className="text-sm text-muted-foreground">Visual analytics will be integrated here using Recharts.</p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
