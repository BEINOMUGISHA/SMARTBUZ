"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import Image from "next/image";
import Link from "next/link";
import {
    TrendingUp,
    Users,
    ShoppingCart,
    AlertTriangle,
    CreditCard,
    ArrowUpRight,
    Search,
    Sparkles,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useAuth } from "@/context/auth-context";
import { useActiveCategory } from "@/hooks/use-active-category";
import { CategoryWidgets } from "@/components/category-widgets";
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
import { StatCard } from "@/components/app/page-shell";
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
    
    const t = useT();const { user, activeBusiness, can } = useAuth();

    // The permissions are reported by the backend for the active business.
    // They decide what to *show* here; the backend enforces them regardless.
    //
    // Somebody who may read the finance suite sees the whole business;
    // everybody else sees only their own till.
    const isAdmin = can("finance.view");
    const isSales = !isAdmin;

    const { category, profile, accent, needsSetup } = useActiveCategory(
        activeBusiness?.role
    );

    // Date Range State
    const [date, setDate] = useState<{
        from: Date;
        to: Date;
    }>({
        from: startOfDay(subDays(new Date(), 30)),
        to: endOfDay(new Date()),
    });

    const handleRangeChange = (newRange: any) => {
        if (newRange?.from) {
            setDate({
                from: startOfDay(newRange.from),
                to: endOfDay(newRange.to || newRange.from)
            });
        }
    };

    // If sales, find their shop
    const shops = useQuery(api.shops.listAll, {});
    const myShop = useMemo(() => {
        if (!isSales || !shops) return null;
        return shops.find(s => s.userId === user?._id);
    }, [isSales, shops, user?._id]);

    // The full business statistics need the finance reports permission.
    // Without it the query is skipped rather than called, so somebody who
    // may work the till is not met with a Forbidden error.
    const canSeeStats = can("finance.reports.view");
    const canSeeDashboard = can("finance.dashboard.view");

    const stats = useQuery(
        api.dashboard.getStats,
        canSeeStats
            ? {
                startDate: date.from.toISOString(),
                endDate: date.to.toISOString(),
                shopId: isSales ? myShop?._id : undefined,
            }
            : "skip"
    );

    // Today's position: sales, profit, what is running out and who owes what.
    const dashboard = useQuery(
        api.dashboard.getBusinessDashboard,
        canSeeDashboard ? {} : "skip"
    );

    const waitingForStats = canSeeStats && !stats;
    const salesAgentWithoutShop = isSales && !myShop && shops && !canSeeDashboard;

    if (waitingForStats) {
        return <DashboardSkeleton />;
    }

    if (salesAgentWithoutShop) {
        return (
            <div className="flex h-[60vh] flex-col items-center justify-center gap-4 text-center">
                <Store className="h-16 w-16 text-muted-foreground opacity-20" />
                <h2 className="text-xl font-bold">{t("No Shop Assigned")}</h2>
                <p className="text-muted-foreground">{t("You are currently not assigned to any shop branch.")}<br />{t("Please contact an administrator.")}</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 lg:space-y-8">
            {/* Header / Welcome Section */}
            <div className="flex flex-col gap-4 border-b border-border/60 pb-5">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                    <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <Badge
                                variant="outline"
                                className={cn(
                                    "border-primary/20 bg-primary/5 px-2 py-0.5 text-eyebrow uppercase tracking-eyebrow",
                                    accent.text
                                )}
                            >
                                {isAdmin
                                    ? "Global Administrator"
                                    : `Sales Agent: ${myShop?.name}`}
                            </Badge>
                            <Badge
                                variant="outline"
                                className={cn(
                                    "px-2 py-0.5 text-eyebrow uppercase tracking-eyebrow",
                                    accent.badge
                                )}
                            >
                                {category?.name}
                            </Badge>
                        </div>
                        <h1 className="text-page-title text-foreground">
                            {needsSetup
                                ? "Welcome to SMART_BUZ"
                                : `${category?.name ?? "Business"} Overview`}
                        </h1>
                        <p className="text-sm text-muted-foreground">
                            {needsSetup
                                ? "Tell us what kind of business you run and we'll tailor the whole system for it."
                                : `Analytics from ${format(date.from, "MMM dd")} — ${format(date.to, "MMM dd, yyyy")}`}
                        </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                        {/* Range Control */}
                        <div className="flex flex-col gap-1.5 flex-1 sm:flex-none">
                            <label className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground ml-1">
                                {t("Filter by Date Range")}
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        id="date"
                                        variant={"outline"}
                                        className={cn(
                                            "h-10 justify-start text-left font-medium transition-all w-full sm:w-[240px] bg-card shadow-sm text-xs"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-3.5 w-3.5 text-primary" />
                                        <span className="truncate">
                                            {format(date.from, "MMM dd")} - {format(date.to, "MMM dd, yyyy")}
                                        </span>
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="end">
                                    <Calendar
                                        initialFocus
                                        mode="range"
                                        defaultMonth={date?.from}
                                        selected={date}
                                        onSelect={handleRangeChange}
                                        numberOfMonths={2}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hero Graphic Banner */}
            <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-r from-emerald-950 via-slate-900 to-primary text-white shadow-xl min-h-[140px] flex items-center p-6 lg:p-8">
                <Image
                    src="/images/pos-hero.jpg"
                    alt={t("POS Hero")}
                    fill
                    className="object-cover opacity-25 mix-blend-overlay pointer-events-none"
                    priority
                />
                <div className="relative z-10 max-w-xl space-y-2">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md text-xs font-bold text-emerald-300 border border-white/15">
                        <Sparkles className="h-3.5 w-3.5" /> {t("Next-Gen Multi-Niche POS")}
                    </div>
                    <h2 className="text-xl lg:text-2xl font-semibold tracking-tight">
                        {t("Welcome back,")} {user?.first_name || "Manager"}
                    </h2>
                    <p className="text-xs lg:text-sm text-white/80 line-clamp-2">
                        {t("Real-time point-of-sale, intelligent inventory tracking, automated commissions, and multi-branch synchronization.")}
                    </p>
                </div>
            </div>

            {/* First-run: prompt the operator to choose their trade */}
            {needsSetup && (
                <div className="rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/10 via-background to-background p-8 shadow-sm">
                    <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                            <Store className="h-7 w-7" />
                        </div>
                        <div className="flex-1 space-y-1">
                            <h3 className="text-xl font-semibold tracking-tight">
                                {t("Tailor SMART_BUZ to your trade")}
                            </h3>
                            <p className="text-sm text-muted-foreground">
                                {t("Pick your business type and we&apos;ll set up the right modules, VAT handling, receipt format and starter stock for it.")}
                            </p>
                        </div>
                        <Button size="lg" className="shrink-0" asChild>
                            <Link href="/setup">{t("Choose my business")}</Link>
                        </Button>
                    </div>
                </div>
            )}

            {/* Category-specific operational widgets */}
            <CategoryWidgets category={category} />

            {canSeeDashboard && dashboard && <TodayPanel dashboard={dashboard} />}

            {canSeeStats ? (
                isAdmin ? (
                    <AdminDashboard stats={stats} />
                ) : (
                    <SalesDashboard stats={stats} myShop={myShop} />
                )
            ) : (
                !canSeeDashboard && (
                    <Card>
                        <CardContent className="flex flex-col items-center gap-2 p-10 text-center">
                            <AlertTriangle className="h-10 w-10 text-muted-foreground opacity-30" />
                            <p className="font-bold">{t("No dashboard for your role")}</p>
                            <p className="text-sm text-muted-foreground">
                                {t("Ask an administrator if you need to see the business figures.")}
                            </p>
                        </CardContent>
                    </Card>
                )
            )}
        </div>
    );
}

/**
 * Today's position.
 *
 * The first thing the owner wants to know: what did today bring in, what
 * did it cost, what is running out, and who owes what. Every figure comes
 * from the same calculation core as the profit and loss report, so the two
 * cannot disagree.
 */
function TodayPanel({ dashboard }: { dashboard: any }) {
    
    const t = useT();const { currency } = useCurrency();
    const chart = dashboard.chartData ?? [];

    return (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title={t("Today's sales")}
                    value={`${currency} ${(dashboard.today?.revenue ?? 0).toLocaleString()}`}
                    icon={TrendingUp}
                    iconClassName="text-emerald-600 dark:text-emerald-400"
                    description={t("{0} transaction(s)", {
            0: dashboard.today?.transactions ?? 0,
        })}
                />
                <KpiCard
                    title={t("Gross profit")}
                    value={`${currency} ${(dashboard.today?.grossProfit ?? 0).toLocaleString()}`}
                    icon={ShoppingCart}
                    iconClassName="text-emerald-600 dark:text-emerald-400"
                    description={t("Cost of goods sold {0} {1}", {
            0: currency,
            1: Math.max(
                        0,
                        (dashboard.today?.revenue ?? 0) - (dashboard.today?.grossProfit ?? 0)
                    ).toLocaleString(),
        })}
                />
                <KpiCard
                    title={t("Net profit")}
                    value={`${currency} ${(dashboard.today?.netProfit ?? 0).toLocaleString()}`}
                    icon={TrendingUp}
                    iconClassName={
                        (dashboard.today?.netProfit ?? 0) >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-destructive"
                    }
                    description={t("Running costs {0} {1}", {
            0: currency,
            1: (
                        dashboard.today?.operatingExpenses ?? 0
                    ).toLocaleString(),
        })}
                />
                <KpiCard
                    title={t("Owed to you")}
                    value={`${currency} ${(dashboard.balances?.receivables ?? 0).toLocaleString()}`}
                    icon={CreditCard}
                    iconClassName={
                        (dashboard.balances?.receivables ?? 0) > 0
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                    }
                    description={t("Suppliers are owed {0} {1}", {
            0: currency,
            1: (
                        dashboard.balances?.payables ?? 0
                    ).toLocaleString(),
        })}
                />
            </div>

            <div className="grid gap-6 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <TrendingUp className="h-4 w-4 text-muted-foreground" />
                            {t("The last fortnight")}
                        </CardTitle>
                        <CardDescription>{t("Revenue and gross profit, day by day")}</CardDescription>
                    </CardHeader>
                    <CardContent>
                        {chart.length === 0 ? (
                            <p className="py-10 text-center text-sm text-muted-foreground">
                                {t("Nothing sold yet.")}
                            </p>
                        ) : (
                            <div className="h-[240px] w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={chart}>
                                        <defs>
                                            <linearGradient id="todayRevenue" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                        <XAxis
                                            dataKey="date"
                                            tickFormatter={(value: string) =>
                                                String(value).slice(5)
                                            }
                                            fontSize={10}
                                        />
                                        <YAxis fontSize={10} />
                                        <RechartsTooltip
                                            formatter={(value: any) =>
                                                `${currency} ${Number(value).toLocaleString()}`
                                            }
                                            labelFormatter={(label: any) => String(label)}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="revenue"
                                            stroke="#10b981"
                                            fill="url(#todayRevenue)"
                                            strokeWidth={2}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="grossProfit"
                                            stroke="#6366f1"
                                            fill="transparent"
                                            strokeWidth={2}
                                            strokeDasharray="4 3"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">{t("Best sellers today")}</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {(dashboard.bestSellers ?? []).length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {t("Nothing sold yet today.")}
                            </p>
                        ) : (
                            <ul className="divide-y">
                                {dashboard.bestSellers.map((product: any) => (
                                    <li
                                        key={product.name}
                                        className="flex items-center justify-between py-2 text-sm"
                                    >
                                        <span className="min-w-0 truncate pr-3 font-medium">
                                            {product.name}
                                        </span>
                                        <span className="shrink-0 text-right">
                                            <span className="font-semibold tabular-nums">
                                                {product.quantity}
                                            </span>
                                            <span className="block text-xs text-muted-foreground">
                                                {currency} {product.revenue.toLocaleString()}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <AlertTriangle className="h-4 w-4 text-amber-600" />
                            {t("Running out")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {(dashboard.lowStock ?? []).length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {t("Nothing is running low.")}
                            </p>
                        ) : (
                            <ul className="divide-y">
                                {dashboard.lowStock.map((stock: any) => (
                                    <li
                                        key={stock.stockId}
                                        className="flex items-center justify-between py-2 text-sm"
                                    >
                                        <span className="min-w-0 truncate pr-3 font-medium">
                                            {stock.name}
                                        </span>
                                        <Badge
                                            variant="outline"
                                            className="shrink-0 border-amber-300 text-xs font-bold text-amber-700"
                                        >
                                            {stock.qty} left
                                        </Badge>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <History className="h-4 w-4 text-muted-foreground" />
                            {t("Recent transactions")}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {(dashboard.recentTransactions ?? []).length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">
                                {t("No sales yet today.")}
                            </p>
                        ) : (
                            <ul className="divide-y">
                                {dashboard.recentTransactions.map((sale: any) => (
                                    <li
                                        key={sale._id}
                                        className="flex items-center justify-between py-2 text-sm"
                                    >
                                        <span className="min-w-0">
                                            <span className="block truncate font-mono text-xs font-bold text-muted-foreground">
                                                {sale.invoiceNumber ?? "—"}
                                            </span>
                                            <span className="text-xs text-muted-foreground">
                                                {sale.paymentMode}
                                                {sale.isCredit ? " · on credit" : ""}
                                            </span>
                                        </span>
                                        <span className="shrink-0 font-semibold tabular-nums">
                                            {currency} {sale.total.toLocaleString()}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function AdminDashboard({ stats }: { stats: any }) {
    
    const t = useT();const { currency } = useCurrency();
    const lowStock = useQuery(api.dashboard.getGlobalLowStock, {});

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* KPI Cards Grid */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title={t("Gross Revenue")}
                    value={`${currency} ${stats.totalRevenue.toLocaleString()}`}
                    icon={CreditCard}
                    description={t("Total sales in selected period")}
                    className="bg-primary hover:scale-[1.02] transition-transform text-primary-foreground border-none"
                    iconClassName="text-primary-foreground/40"
                />
                <KpiCard
                    title={t("Active Orders")}
                    value={stats.totalOrders.toLocaleString()}
                    icon={ShoppingCart}
                    description={t("Successfully processed")}
                    className="bg-card hover:border-sidebar-primary/30 transition-colors"
                    iconClassName="text-blue-500"
                />
                <KpiCard
                    title={t("Client Base")}
                    value={stats.totalCustomers.toLocaleString()}
                    icon={Users}
                    description={t("Total registered distributors")}
                    className="bg-card hover:border-sidebar-primary/30 transition-colors"
                    iconClassName="text-purple-500"
                />
                <KpiCard
                    title={t("Low Stock Alert")}
                    value={stats.lowStockCount.toLocaleString()}
                    icon={AlertTriangle}
                    description={t("Items below HQ threshold")}
                    trend={stats.lowStockCount > 0 ? "Check restock list" : "Healthy"}
                    trendUp={stats.lowStockCount === 0}
                    className="bg-card hover:border-sidebar-primary/30 transition-colors"
                    iconClassName={stats.lowStockCount > 0 ? "text-red-500" : "text-green-500"}
                />
            </div>

            {/* Admin Specific Content */}
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
                <Card className="lg:col-span-4 shadow-sm border-sidebar-border/50">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle>{t("Global Performance")}</CardTitle>
                            <CardDescription>{t("Visualizing revenue distribution")}</CardDescription>
                        </div>
                        <TrendingUp className="h-5 w-5 text-muted-foreground opacity-50" />
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full mt-4">
                            {!stats.chartData || stats.chartData.length === 0 ? (
                                <div className="h-full flex items-center justify-center rounded-xl bg-muted/20 border-2 border-dashed border-muted group overflow-hidden">
                                    <div className="flex flex-col items-center gap-2 text-muted-foreground">
                                        <TrendingUp className="h-10 w-10 opacity-40 animate-pulse text-primary" />
                                        <span className="text-sm font-bold uppercase tracking-widest text-primary/60">{t("No data for selected range")}</span>
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
                                            tickFormatter={(val) => `${currency} ${(val / 1000)}k`}
                                        />
                                        <RechartsTooltip
                                            content={({ active, payload }) => {
                                                if (active && payload && payload.length) {
                                                    return (
                                                        <div className="bg-background border rounded-lg shadow-xl p-3 border-primary/20">
                                                            <p className="text-xs font-semibold text-muted-foreground uppercase">{format(new Date(payload[0].payload.date), "MMMM d, yyyy")}</p>
                                                            <p className="text-lg font-semibold text-primary">{currency} {Number(payload[0].value).toLocaleString()}</p>
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

                <Card className="lg:col-span-3 shadow-sm border-sidebar-border/50">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <div>
                            <CardTitle className="flex items-center gap-2">
                                <AlertTriangle className="h-4 w-4 text-orange-500" />
                                {t("Critical Low Stock")}
                            </CardTitle>
                            <CardDescription>{t("Top 10 HQ restock priorities")}</CardDescription>
                        </div>
                        <PackageSearch className="h-4 w-4 text-muted-foreground opacity-30" />
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-4">
                            {!lowStock ? (
                                Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)
                            ) : lowStock.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-8">{t("All stock levels are healthy")}</p>
                            ) : (
                                <Table>
                                    <TableBody>
                                        {lowStock.map((item) => (
                                            <TableRow key={item._id} className="hover:bg-muted/50 transition-colors border-none h-12">
                                                <TableCell className="font-bold py-1 max-w-[150px] truncate">
                                                    {item.name}
                                                </TableCell>
                                                <TableCell className="text-right py-1">
                                                    <Badge variant={item.qty <= 5 ? "destructive" : "secondary"} className="font-semibold">
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
                    <CardTitle>{t("Global Recent Sales")}</CardTitle>
                    <CardDescription>{t("Latest transactions across all branches")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-6 grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
                        {stats.recentSales.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-8 col-span-full font-bold uppercase tracking-widest opacity-20">{t("No recent transactions in this range")}</p>
                        ) : (
                            stats.recentSales.map((sale: any) => (
                                <div key={sale._id} className="flex items-center justify-between p-3 rounded-xl hover:bg-muted/50 border bg-card/30 border-sidebar-border/20 transition-all hover:shadow-md">
                                    <div className="flex items-center gap-4">
                                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary group-hover:bg-primary/20 transition-colors">
                                            <ArrowUpRight className="h-5 w-5" />
                                        </div>
                                        <div className="space-y-0.5">
                                            <p className="text-sm font-semibold leading-none">{sale.customerName}</p>
                                            <p className="text-xs text-muted-foreground font-mono">{format(new Date(sale.date), "MMM d, h:mm a")}</p>
                                        </div>
                                    </div>
                                    <div className="font-semibold text-sm text-primary">
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
    
    const t = useT();const { currency } = useCurrency();
    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            {/* KPI Cards Grid */}
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                <KpiCard
                    title={t("My Shop Revenue")}
                    value={`${currency} ${stats.totalRevenue.toLocaleString()}`}
                    icon={CreditCard}
                    description={t("Total sales from your assigned branch")}
                    className="bg-orange-500 hover:scale-[1.02] transition-transform text-white border-none"
                    iconClassName="text-white/40"
                />
                <KpiCard
                    title={t("Shop Orders")}
                    value={stats.totalOrders.toLocaleString()}
                    icon={ShoppingCart}
                    description={t("Orders processed by you")}
                    className="bg-card"
                    iconClassName="text-blue-500"
                />
                <KpiCard
                    title={t("Shop Stock Alerts")}
                    value={stats.lowStockCount.toLocaleString()}
                    icon={AlertTriangle}
                    description={t("Items low in your local branch")}
                    trend={stats.lowStockCount > 10 ? "Restock soon" : "Healthy"}
                    trendUp={stats.lowStockCount < 10}
                    className="bg-card"
                    iconClassName={stats.lowStockCount > 5 ? "text-orange-500" : "text-green-500"}
                />
                <KpiCard
                    title={t("Shop Performance")}
                    value="Active"
                    icon={TrendingUp}
                    description={t("Connected to {0}", {
            0: myShop?.name,
        })}
                    className="bg-card"
                    iconClassName="text-primary"
                />
            </div>

            {/* Sales Specific Content */}
            <Card className="shadow-sm border-sidebar-border/50">
                <CardHeader>
                    <CardTitle>{t("Your Recent Transactions")}</CardTitle>
                    <CardDescription>{t("Manage your daily sales history")}</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="rounded-xl border border-sidebar-border/30 overflow-hidden">
                        <Table>
                            <TableHeader className="bg-muted/30">
                                <TableRow>
                                    <TableHead className="font-bold">{t("Customer")}</TableHead>
                                    <TableHead className="font-bold">{t("Time")}</TableHead>
                                    <TableHead className="text-right font-bold">{t("Total (")}{currency})</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {stats.recentSales.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={3} className="h-32 text-center text-muted-foreground font-bold uppercase tracking-widest opacity-20">
                                            {t("No sales recorded in this period")}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    stats.recentSales.map((sale: any) => (
                                        <TableRow key={sale._id} className="hover:bg-muted/20 transition-colors">
                                            <TableCell className="font-medium">{sale.customerName}</TableCell>
                                            <TableCell className="text-xs text-muted-foreground font-mono">
                                                {format(new Date(sale.date), "HH:mm")}
                                            </TableCell>
                                            <TableCell className="text-right font-semibold text-primary">
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

import { Store } from "lucide-react";
import { useT } from "@/i18n/provider";
import { useCurrency } from "@/hooks/use-currency"; // Added missing import

/**
 * The dashboard's KPI card.
 *
 * It is now the shared `StatCard` from the page shell, so the numbers on the
 * home screen are laid out exactly like the numbers on every other screen.
 * The one card that is filled with the brand colour keeps its own treatment
 * so the day's revenue still stands out from the rest.
 */
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
    
    const t = useT();const highlighted = Boolean(
        className?.includes("text-primary-foreground")
    );

    if (highlighted) {
        return (
            <Card
                className={`shadow-sm overflow-hidden relative border-none bg-primary text-primary-foreground ${className ?? ""}`}
            >
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 relative z-10">
                    <CardTitle className="text-eyebrow uppercase tracking-eyebrow text-primary-foreground/90">
                        {title}
                    </CardTitle>
                    <Icon className={`size-4 ${iconClassName ?? ""}`} />
                </CardHeader>
                <CardContent className="relative z-10">
                    <div className="text-stat tabular-nums">{value}</div>
                    <p className="mt-1 text-xs text-primary-foreground/80">
                        {description}
                    </p>
                    {trend ? (
                        <div className="mt-2 flex items-center gap-1 text-xs font-medium text-primary-foreground">
                            {trend}
                        </div>
                    ) : null}
                </CardContent>
            </Card>
        );
    }

    return (
        <StatCard
            label={title}
            value={value}
            hint={description}
            icon={Icon}
            tone={trendUp === false ? "danger" : "default"}
        />
    );
}

function DashboardSkeleton() {
    return (
        <div className="space-y-8">
            <div className="space-y-2">
                <Skeleton className="h-8 w-[200px]" />
                <Skeleton className="h-4 w-[300px]" />
            </div>
            <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
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
            <div className="grid gap-4 grid-cols-1 lg:grid-cols-7">
                <Skeleton className="col-span-4 h-[350px] rounded-xl" />
                <Skeleton className="col-span-3 h-[350px] rounded-xl" />
            </div>
        </div>
    );
}
