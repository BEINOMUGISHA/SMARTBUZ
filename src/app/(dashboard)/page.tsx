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
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { useState, useMemo } from "react";
import { format, subDays, startOfDay, endOfDay } from "date-fns";
import {
    Calendar as CalendarIcon,
    Filter,
    CalendarDays,
    TrendingDown,
    PackageSearch,
    History
} from "lucide-react";
import {
    Popover,
    PopoverContent,
    PopoverTrigger
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table";
import {
    Area,
    AreaChart,
    ResponsiveContainer,
    XAxis,
    YAxis,
    Tooltip as RechartsTooltip,
    CartesianGrid
} from "recharts";

export default function DashboardPage() {
    const { user } = useAuth();
    const isAdmin = user?.roles.includes("admin");
    const isSales = user?.roles.includes("sales");

    // Date Range State
    const [date, setDate] = useState<{
        from: Date;
        to: Date;
    }>({
        from: startOfDay(subDays(new Date(), 30)),
        to: endOfDay(new Date()),
    });

    const [isAuditMode, setIsAuditMode] = useState(false);

    // If sales, find their shop
    const shops = useQuery(api.shops.listAll);
    const myShop = useMemo(() => {
        if (!isSales || !shops) return null;
        return shops.find(s => s.userId === user?._id);
    }, [isSales, shops, user?._id]);

    const stats = useQuery(api.dashboard.getStats, {
        startDate: date.from.toISOString(),
        endDate: date.to.toISOString(),
        shopId: isSales ? myShop?._id : undefined,
    });

    if (!stats || (isSales && !myShop && shops)) {
        if (isSales && !myShop && shops) {
            return (
                <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
                    <Store className="h-16 w-16 text-muted-foreground opacity-20" />
                    <h2 className="text-xl font-bold">No Shop Assigned</h2>
                    <p className="text-muted-foreground">You are currently not assigned to any shop branch.<br />Please contact an administrator.</p>
                </div>
            )
        }
        return <DashboardSkeleton />;
    }

    return (
        <div className="space-y-8">
            {/* Header / Welcome Section */}
            <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between sticky top-0 z-30 bg-background/95 backdrop-blur py-2 -mt-2">
                <div>
                    <div className="flex items-center gap-2 mb-1">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-widest font-black text-primary border-primary/20">
                            {isAdmin ? "Global Administrator" : `Sales Agent: ${myShop?.name}`}
                        </Badge>
                    </div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">
                        {isAuditMode ? "Daily Audit" : "Business Overview"}
                    </h1>
                    <p className="text-muted-foreground text-sm">
                        {isAuditMode
                            ? `Performance for ${format(date.from, "PPP")}`
                            : `Data from ${format(date.from, "MMM d")} to ${format(date.to, "MMM d, yyyy")}`
                        }
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant={isAuditMode ? "secondary" : "ghost"}
                        size="sm"
                        className="h-9 px-3 gap-2 font-bold transition-all"
                        onClick={() => {
                            const today = new Date();
                            setDate({ from: startOfDay(today), to: endOfDay(today) });
                            setIsAuditMode(!isAuditMode);
                        }}
                    >
                        {isAuditMode ? <History className="h-4 w-4" /> : <CalendarDays className="h-4 w-4" />}
                        {isAuditMode ? "Return to Range" : "Switch to Daily Audit"}
                    </Button>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                id="date"
                                variant={"outline"}
                                className={cn(
                                    "h-9 justify-start text-left font-bold w-[260px] border-sidebar-border bg-card shadow-sm",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                                {date?.from ? (
                                    date.to ? (
                                        <>
                                            {format(date.from, "LLL dd, y")} -{" "}
                                            {format(date.to, "LLL dd, y")}
                                        </>
                                    ) : (
                                        format(date.from, "LLL dd, y")
                                    )
                                ) : (
                                    <span>Pick a date range</span>
                                )}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="end">
                            <Calendar
                                initialFocus
                                mode="range"
                                defaultMonth={date?.from}
                                selected={date}
                                onSelect={(newRange: any) => {
                                    if (newRange?.from) {
                                        setDate({
                                            from: startOfDay(newRange.from),
                                            to: endOfDay(newRange.to || newRange.from)
                                        });
                                        if (newRange.to && isAuditMode) setIsAuditMode(false);
                                    }
                                }}
                                numberOfMonths={2}
                            />
                        </PopoverContent>
                    </Popover>
                </div>
            </div>

            {isAdmin ? <AdminDashboard stats={stats} /> : <SalesDashboard stats={stats} myShop={myShop} />}
        </div>
    );
}

function AdminDashboard({ stats }: { stats: any }) {
    const lowStock = useQuery(api.dashboard.getGlobalLowStock);

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* KPI Cards Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title="Gross Revenue"
                    value={`UGX ${stats.totalRevenue.toLocaleString()}`}
                    icon={CreditCard}
                    description="Total sales in selected period"
                    className="bg-primary hover:scale-[1.02] transition-transform text-primary-foreground border-none"
                    iconClassName="text-primary-foreground/40"
                />
                <KpiCard
                    title="Active Orders"
                    value={stats.totalOrders.toLocaleString()}
                    icon={ShoppingCart}
                    description="Successfully processed"
                    className="bg-card hover:border-sidebar-primary/30 transition-colors"
                    iconClassName="text-blue-500"
                />
                <KpiCard
                    title="Client Base"
                    value={stats.totalCustomers.toLocaleString()}
                    icon={Users}
                    description="Total registered distributors"
                    className="bg-card hover:border-sidebar-primary/30 transition-colors"
                    iconClassName="text-purple-500"
                />
                <KpiCard
                    title="Low Stock Alert"
                    value={stats.lowStockCount.toLocaleString()}
                    icon={AlertTriangle}
                    description="Items below HQ threshold"
                    trend={stats.lowStockCount > 0 ? "Check restock list" : "Healthy"}
                    trendUp={stats.lowStockCount === 0}
                    className="bg-card hover:border-sidebar-primary/30 transition-colors"
                    iconClassName={stats.lowStockCount > 0 ? "text-red-500" : "text-green-500"}
                />
            </div>

            {/* Admin Specific Content */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
                <Card className="col-span-4 shadow-sm border-sidebar-border/50">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>Global Performance</CardTitle>
                            <CardDescription>Visualizing revenue distribution</CardDescription>
                        </div>
                        <TrendingUp className="h-5 w-5 text-muted-foreground opacity-50" />
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            {!stats.chartData || stats.chartData.length === 0 ? (
                                <div className="h-full flex items-center justify-center rounded-xl bg-muted/20 border-2 border-dashed border-muted group overflow-hidden">
                                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                        <TrendingUp className="h-10 w-10 opacity-40 animate-pulse text-primary" />
                                        <span className="text-sm font-bold uppercase tracking-widest text-primary/60">No data for selected range</span>
                                    </div>
                                </div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={stats.chartData}>
                                        <defs>
                                            <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted-foreground)/0.1)" />
                                        <XAxis
                                            dataKey="date"
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                            tickFormatter={(str) => format(new Date(str), "MMM d")}
                                        />
                                        <YAxis
                                            axisLine={false}
                                            tickLine={false}
                                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                                            tickFormatter={(val) => `UGX ${(val / 1000)}k`}
                                        />
                                        <RechartsTooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    return (
                                                        <div className="bg-background border rounded-lg shadow-xl p-3 border-primary/20">
                                                            <p className="text-xs font-black text-muted-foreground uppercase">{format(new Date(payload[0].payload.date), "MMMM d, yyyy")}</p>
                                                            <p className="text-lg font-black text-primary">UGX {Number(payload[0].value).toLocaleString()}</p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="value"
                                            stroke="hsl(var(--primary))"
                                            strokeWidth={4}
                                            fillOpacity={1}
                                            fill="url(#colorValue)"
                                            animationDuration={1500}
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </CardContent>
                </Card>

                <Card className="col-span-3 shadow-sm border-sidebar-border/50">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-orange-500" />
                                Critical Low Stock
                            </CardTitle>
                            <CardDescription>Top 10 HQ restock priorities</CardDescription>
                        </div>
                        <PackageSearch className="h-4 w-4 text-muted-foreground opacity-30" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {!lowStock ? (
                                Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
                            ) : lowStock.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">All stock levels are healthy</p>
                            ) : (
                                <Table>
                                    <TableBody>
                                        {lowStock.map((item) => (
                                            <TableRow key={item._id} className="hover:bg-muted/50 transition-colors border-none h-12">
                                                <TableCell className="font-bold py-1 max-w-[150px] truncate">
                                                    {item.name}
                                                </TableCell>
                                                <TableCell className="text-right py-1">
                                                    <Badge variant={item.qty <= 5 ? "destructive" : "secondary"} className="font-black">
                                                        {item.qty} left
                                                    </Badge>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Sales List */}
            <Card className="shadow-sm border-sidebar-border/50">
                <CardHeader>
                    <CardTitle>Global Recent Sales</CardTitle>
                    <CardDescription>Latest transactions across all branches</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                        {stats.recentSales.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8 col-span-full font-bold uppercase tracking-widest opacity-20">No recent transactions in this range</p>
                        ) : (
                            stats.recentSales.map((sale: any) => (
                                <div key={sale._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 border bg-card/30 border-sidebar-border/20 transition-all hover:shadow-md">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                                            <ArrowUpRight className="h-5 w-5" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <p className="text-sm font-black leading-none">{sale.customerName}</p>
                                            <p className="text-[10px] text-muted-foreground font-mono">{format(new Date(sale.date), "MMM d, h:mm a")}</p>
                                        </div>
                                    </div>
                                    <div className="font-black text-sm text-primary">
                                        + {sale.amount.toLocaleString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function SalesDashboard({ stats, myShop }: { stats: any, myShop: any }) {
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* KPI Cards Grid */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title="My Shop Revenue"
                    value={`UGX ${stats.totalRevenue.toLocaleString()}`}
                    icon={CreditCard}
                    description="Total sales from your assigned branch"
                    className="bg-orange-500 hover:scale-[1.02] transition-transform text-white border-none"
                    iconClassName="text-white/40"
                />
                <KpiCard
                    title="Shop Orders"
                    value={stats.totalOrders.toLocaleString()}
                    icon={ShoppingCart}
                    description="Orders processed by you"
                    className="bg-card"
                    iconClassName="text-blue-500"
                />
                <KpiCard
                    title="Shop Stock Alerts"
                    value={stats.lowStockCount.toLocaleString()}
                    icon={AlertTriangle}
                    description="Items low in your local branch"
                    trend={stats.lowStockCount > 10 ? "Restock soon" : "Healthy"}
                    trendUp={stats.lowStockCount < 10}
                    className="bg-card"
                    iconClassName={stats.lowStockCount > 5 ? "text-orange-500" : "text-green-500"}
                />
                <KpiCard
                    title="Shop Performance"
                    value="Active"
                    icon={TrendingUp}
                    description={`Connected to ${myShop?.name}`}
                    className="bg-card"
                    iconClassName="text-primary"
                />
            </div>

            {/* Sales Specific Content */}
            <Card className="shadow-sm border-sidebar-border/50">
                <CardHeader>
                    <CardTitle>Your Recent Transactions</CardTitle>
                    <CardDescription>Manage your daily sales history</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border border-sidebar-border/30 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/30">
                                <TableRow>
                                    <TableHead className="font-bold">Customer</TableHead>
                                    <TableHead className="font-bold">Time</TableHead>
                                    <TableHead className="text-right font-bold">Total (UGX)</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.recentSales.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="h-32 text-center text-muted-foreground font-bold uppercase tracking-widest opacity-20">
                                            No sales recorded in this period
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    stats.recentSales.map((sale: any) => (
                                        <TableRow key={sale._id} className="hover:bg-muted/20 transition-colors">
                                            <TableCell className="font-medium">{sale.customerName}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground font-mono">
                                                {format(new Date(sale.date), "HH:mm")}
                                            </TableCell>
                                            <TableCell className="text-right font-black text-primary">
                                                {sale.amount.toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

import { Store } from "lucide-react"; // Added missing import

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
