"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
    TrendingUp,
    Users,
    ShoppingCart,
    AlertTriangle,
    CreditCard,
    ArrowUpRight,
    Search
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardPage() {
    const stats = useQuery(api.dashboard.getStats);

    if (!stats) {
        return <DashboardSkeleton />;
    }

    return (
        <div className="space-y-8">
            {/* Header / Welcome Section */}
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">Dashboard</h1>
                    <p className="text-muted-foreground">
                        Overview of your business performance.
                    </p>
                </div>
                {/* Optional: Add Date Range Picker here if needed later */}
            </div>

            {/* KPI Cards Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title="Total Revenue"
                    value={`UGX ${stats.totalRevenue.toLocaleString()}`}
                    icon={CreditCard}
                    description="Total earnings to date"
                    trend="+12.5%"
                    trendUp={true}
                    className="bg-gradient-to-br from-primary/90 to-primary text-primary-foreground"
                    iconClassName="text-primary-foreground/80"
                />
                <KpiCard
                    title="Total Orders"
                    value={stats.totalOrders.toLocaleString()}
                    icon={ShoppingCart}
                    description="Completed transactions"
                    trend="+4.3%"
                    trendUp={true}
                    className="bg-card"
                    iconClassName="text-blue-500"
                />
                <KpiCard
                    title="Total Customers"
                    value={stats.totalCustomers.toLocaleString()}
                    icon={Users}
                    description="Registered clients"
                    trend="+2.1%"
                    trendUp={true}
                    className="bg-card"
                    iconClassName="text-purple-500"
                />
                <KpiCard
                    title="Low Stock Items"
                    value={stats.lowStockCount.toLocaleString()}
                    icon={AlertTriangle}
                    description="Products needing restock"
                    trend={`${stats.lowStockCount > 0 ? "Action needed" : "Healthy"}`}
                    trendUp={stats.lowStockCount === 0}
                    className="bg-card"
                    iconClassName="text-orange-500"
                />
            </div>

            {/* Main Content Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                {/* Revenue Chart Placeholder */}
                <Card className="col-span-4 shadow-sm border-sidebar-border/50">
                    <CardHeader>
                        <CardTitle>Revenue Overview</CardTitle>
                        <CardDescription>Monthly revenue performance</CardDescription>
                    </CardHeader>
                    <CardContent className="pl-2">
                        <div className="h-[300px] flex items-center justify-center rounded-xl bg-muted/20 border-2 border-dashed border-muted">
                            <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                <TrendingUp className="h-8 w-8 opacity-50" />
                                <span className="text-sm font-medium">Chart Visualization Coming Soon</span>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                {/* Recent Sales List */}
                <Card className="col-span-3 shadow-sm border-sidebar-border/50">
                    <CardHeader>
                        <CardTitle>Recent Sales</CardTitle>
                        <CardDescription>Latest transactions from shops</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-6">
                            {stats.recentSales.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">No recent transactions</p>
                            ) : (
                                stats.recentSales.map((sale) => (
                                    <div key={sale._id} className="flex items-center justify-between group">
                                        <div className="flex items-center gap-4">
                                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 group-hover:bg-primary/20 transition-colors">
                                                <ArrowUpRight className="h-4 w-4 text-primary" />
                                            </div>
                                            <div className="space-y-1">
                                                <p className="text-sm font-medium leading-none">{sale.customerName}</p>
                                                <p className="text-xs text-muted-foreground">{new Date(sale.date).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        <div className="font-bold text-sm">
                                            +UGX {sale.amount.toLocaleString()}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function KpiCard({
    title,
    value,
    icon: Icon,
    description,
    trend,
    trendUp,
    className,
    iconClassName,
}: {
    title: string;
    value: string;
    icon: any;
    description: string;
    trend?: string;
    trendUp?: boolean;
    className?: string;
    iconClassName?: string;
}) {
    return (
        <Card className={`shadow-sm border-sidebar-border/50 overflow-hidden relative ${className}`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                <CardTitle className={`text-sm font-medium ${className?.includes('text-primary-foreground') ? 'text-primary-foreground/90' : 'text-muted-foreground'}`}>
                    {title}
                </CardTitle>
                <Icon className={`h-4 w-4 ${iconClassName}`} />
            </CardHeader>
            <CardContent className="relative z-10">
                <div className="text-2xl font-bold tracking-tight">{value}</div>
                <p className={`text-xs mt-1 ${className?.includes('text-primary-foreground') ? 'text-primary-foreground/80' : 'text-muted-foreground'}`}>
                    {description}
                </p>
                {trend && (
                    <div className={`absolute bottom-4 right-4 text-xs font-medium flex items-center gap-1 
                        ${className?.includes('text-primary-foreground')
                            ? 'text-primary-foreground'
                            : trendUp ? 'text-green-600' : 'text-red-500'
                        }`}
                    >
                        {trend}
                    </div>
                )}
            </CardContent>
            {/* Background decoration for plain cards */}
            {!className?.includes('bg-gradient') && (
                <div className="absolute -right-6 -bottom-6 opacity-[0.03]">
                    <Icon className="h-32 w-32" />
                </div>
            )}
        </Card>
    );
}

function DashboardSkeleton() {
    return (
        <div className="space-y-8">
            <div className="space-y-2">
                <Skeleton className="h-8 w-[200px]" />
                <Skeleton className="h-4 w-[300px]" />
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[...Array(4)].map((_, i) => (
                    <Card key={i}>
                        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                            <Skeleton className="h-4 w-[100px]" />
                            <Skeleton className="h-4 w-4 rounded-full" />
                        </CardHeader>
                        <CardContent>
                            <Skeleton className="h-8 w-[120px] mb-2" />
                            <Skeleton className="h-3 w-[150px]" />
                        </CardContent>
                    </Card>
                ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Skeleton className="col-span-4 h-[350px] rounded-xl" />
                <Skeleton className="col-span-3 h-[350px] rounded-xl" />
            </div>
        </div>
    );
}
