"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ReportTable } from "./reports-table";
import { format, subMonths, isSameDay, parseISO } from "date-fns";
import {
    BarChart3,
    ShoppingCart,
    Store,
    Package,
    CreditCard,
    TrendingUp,
    Search,
    Calendar as CalendarIcon,
    ArrowRight,
    Info
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export default function ReportsPage() {
    const [activeTab, setActiveTab] = useState("overview");
    const [selectedShop, setSelectedShop] = useState<string>("all");
    const [clientType, setClientType] = useState<string>("All");
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");

    // Date Range State (Default to last 30 days)
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    // Queries
    const stats = useQuery(api.reports.summaryStats, {
        startDate: dateRange.from,
        endDate: dateRange.to
    });
    const shopSummary = useQuery(api.reports.getShopSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to
    });
    const stockSummary = useQuery(api.reports.getStockSummary);
    const shops = useQuery(api.shops.listAll);

    const salesReport = useQuery(api.reports.getDetailedSalesReport, {
        paginationOpts: { numItems: 20, cursor: null },
        shopId: selectedShop === "all" ? undefined : (selectedShop as any),
        clientType: clientType === "All" ? undefined : clientType,
        startDate: dateRange.from,
        endDate: dateRange.to
    });

    const loansReport = useQuery(api.reports.getLoanSummary, {
        paginationOpts: { numItems: 20, cursor: null },
        startDate: dateRange.from,
        endDate: dateRange.to
    });

    const formatPrice = (p: number) => `UGX ${p.toLocaleString()}`;

    const handleSingleDayChange = (date: Date | undefined) => {
        if (date) {
            const formatted = format(date, "yyyy-MM-dd");
            setDateRange({ from: formatted, to: formatted });
            setReportMode("daily");
        }
    };

    const handleRangeChange = (type: "from" | "to", date: Date | undefined) => {
        if (date) {
            const formatted = format(date, "yyyy-MM-dd");
            setDateRange(prev => ({ ...prev, [type]: formatted }));
            setReportMode("range");
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 bg-white p-4 lg:p-6 rounded-2xl border shadow-sm print:hidden">
                <div className="flex items-center gap-4">
                    <div className="flex flex-col gap-0.5 min-w-fit">
                        <h1 className="text-2xl font-black tracking-tight text-primary leading-none">BUSINESS REPORTS</h1>
                        <p className="text-muted-foreground text-[10px] font-bold uppercase tracking-widest">Analytics & Oversight</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 lg:gap-6 flex-1 max-w-4xl">
                    <div className="flex items-center gap-3">
                        {/* Single Day Audit Picker */}
                        <div className="space-y-1">
                            <label className="text-[9px] font-black uppercase text-primary tracking-wider ml-1 flex items-center gap-1.5">
                                <div className="h-1 w-1 rounded-full bg-primary animate-pulse" />
                                Daily Audit
                            </label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        className={cn(
                                            "h-9 w-[150px] justify-start text-left font-bold border-2 transition-all text-[11px]",
                                            reportMode === "daily" ? "border-primary bg-primary/5 text-primary" : "border-muted-foreground/10"
                                        )}
                                    >
                                        <CalendarIcon className="mr-2 h-3.5 w-3.5 opacity-50" />
                                        {reportMode === "daily" ? format(parseISO(dateRange.from), "dd MMM yyyy") : "Audit a day..."}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={parseISO(dateRange.from)}
                                        onSelect={handleSingleDayChange}
                                        initialFocus
                                        captionLayout="dropdown"
                                        fromYear={2023}
                                        toYear={2030}
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>

                        <div className="h-8 w-px bg-muted mx-1 mt-3" />

                        {/* Date Range Picker */}
                        <div className="flex items-center gap-2">
                            <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider ml-1">Range From</label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "h-9 w-[135px] justify-start text-left font-bold border-2 transition-all text-[11px]",
                                                reportMode === "range" ? "border-muted-foreground/30 bg-muted/5 text-muted-foreground" : "border-muted-foreground/10"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-3.5 w-3.5 opacity-50" />
                                            {format(parseISO(dateRange.from), "dd MMM yyyy")}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={parseISO(dateRange.from)}
                                            onSelect={(d) => handleRangeChange("from", d)}
                                            initialFocus
                                            captionLayout="dropdown"
                                            fromYear={2023}
                                            toYear={2030}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div className="h-9 flex items-end pb-2 text-muted-foreground opacity-50 mt-3">
                                <ArrowRight className="h-3 w-3" />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[9px] font-black uppercase text-muted-foreground tracking-wider ml-1">Range To</label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="outline"
                                            className={cn(
                                                "h-9 w-[135px] justify-start text-left font-bold border-2 transition-all text-[11px]",
                                                reportMode === "range" ? "border-muted-foreground/30 bg-muted/5 text-muted-foreground" : "border-muted-foreground/10"
                                            )}
                                        >
                                            <CalendarIcon className="mr-2 h-3.5 w-3.5 opacity-50" />
                                            {format(parseISO(dateRange.to), "dd MMM yyyy")}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar
                                            mode="single"
                                            selected={parseISO(dateRange.to)}
                                            onSelect={(d) => handleRangeChange("to", d)}
                                            initialFocus
                                            captionLayout="dropdown"
                                            fromYear={2023}
                                            toYear={2030}
                                        />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Report Mode Banner */}
            <div className={cn(
                "flex items-center justify-between px-6 py-3 rounded-xl border font-bold text-sm shadow-sm transition-all",
                reportMode === "daily"
                    ? "bg-primary text-white border-primary border-b-4 border-b-black/20"
                    : "bg-muted/50 text-muted-foreground border-muted-foreground/10"
            )}>
                <div className="flex items-center gap-2 italic">
                    <Info className="h-4 w-4" />
                    <span>
                        NOW VIEWING: {reportMode === "daily"
                            ? `DAILY AUDIT FOR ${format(parseISO(dateRange.from), "MMMM dd, yyyy").toUpperCase()}`
                            : `BUSINESS PERFORMANCE FROM ${format(parseISO(dateRange.from), "MMM dd").toUpperCase()} TO ${format(parseISO(dateRange.to), "MMM dd, yyyy").toUpperCase()}`
                        }
                    </span>
                </div>
                <Badge variant={reportMode === "daily" ? "secondary" : "outline"} className="font-black uppercase tracking-widest text-[10px]">
                    {reportMode === "daily" ? "Live Audit" : "Range Insight"}
                </Badge>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="bg-primary/10 p-1.5 rounded-2xl h-auto flex flex-wrap lg:flex-nowrap gap-2 border-2 border-primary/20 shadow-inner">
                    <TabsTrigger value="overview" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-11 px-8 rounded-xl transition-all uppercase text-xs tracking-widest">
                        <BarChart3 className="h-4 w-4" /> Overview
                    </TabsTrigger>
                    <TabsTrigger value="sales" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-11 px-8 rounded-xl transition-all uppercase text-xs tracking-widest">
                        <ShoppingCart className="h-4 w-4" /> Detailed Sales
                    </TabsTrigger>
                    <TabsTrigger value="shops" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-11 px-8 rounded-xl transition-all uppercase text-xs tracking-widest">
                        <Store className="h-4 w-4" /> Shops
                    </TabsTrigger>
                    <TabsTrigger value="stock" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-11 px-8 rounded-xl transition-all uppercase text-xs tracking-widest">
                        <Package className="h-4 w-4" /> Global Stock
                    </TabsTrigger>
                    <TabsTrigger value="loans" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-11 px-8 rounded-xl transition-all uppercase text-xs tracking-widest">
                        <CreditCard className="h-4 w-4" /> Loans
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="border-none shadow-md bg-gradient-to-br from-primary/10 to-transparent">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Total Revenue</CardTitle>
                                <TrendingUp className="h-4 w-4 text-primary" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black">{stats ? formatPrice(stats.totalRevenue) : "..."}</div>
                                <p className="text-xs text-muted-foreground mt-1">Gross sales from all branches</p>
                            </CardContent>
                        </Card>
                        <Card className="border-none shadow-md bg-gradient-to-br from-green-500/10 to-transparent">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Total PV</CardTitle>
                                <Package className="h-4 w-4 text-green-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black">{stats ? stats.totalPV.toLocaleString() : "..."}</div>
                                <p className="text-xs text-muted-foreground mt-1">Accumulated Point Value</p>
                            </CardContent>
                        </Card>
                        <Card className="border-none shadow-md bg-gradient-to-br from-blue-500/10 to-transparent">
                            <CardHeader className="flex flex-row items-center justify-between pb-2">
                                <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">Transactions</CardTitle>
                                <ShoppingCart className="h-4 w-4 text-blue-600" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-black">{stats ? stats.salesCount.toLocaleString() : "..."}</div>
                                <p className="text-xs text-muted-foreground mt-1">Total orders processed</p>
                            </CardContent>
                        </Card>
                        <Card className="border-none shadow-md bg-gradient-to-br from-purple-500/10 to-transparent">
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
                        <Card className="rounded-xl shadow-sm border-muted/50 overflow-hidden">
                            <CardHeader className="bg-muted/30 border-b">
                                <CardTitle className="text-lg font-black">Quick Actions</CardTitle>
                            </CardHeader>
                            <CardContent className="p-4 flex flex-col gap-2">
                                <div className="text-sm text-muted-foreground mb-2">Generate quick summary reports:</div>
                                <div className="grid grid-cols-2 gap-2">
                                    <button onClick={() => setActiveTab("sales")} className="p-3 text-left rounded-lg bg-muted/50 hover:bg-muted font-bold text-xs transition-colors border">TODAY'S SALES</button>
                                    <button onClick={() => setActiveTab("stock")} className="p-3 text-left rounded-lg bg-muted/50 hover:bg-muted font-bold text-xs transition-colors border">LOW STOCK LIST</button>
                                    <button onClick={() => setActiveTab("shops")} className="p-3 text-left rounded-lg bg-muted/50 hover:bg-muted font-bold text-xs transition-colors border">BRANCH AUDIT</button>
                                    <button onClick={() => setActiveTab("loans")} className="p-3 text-left rounded-lg bg-muted/50 hover:bg-muted font-bold text-xs transition-colors border">DEBTORS LIST</button>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>

                <TabsContent value="sales" className="space-y-4">
                    <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-xl border">
                        <div className="relative flex-1 w-full">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input placeholder="Search within sales..." className="pl-10 h-10 border-muted-foreground/20" />
                        </div>
                        <div className="flex items-center gap-4 w-full md:w-auto">
                            <Select value={selectedShop} onValueChange={setSelectedShop}>
                                <SelectTrigger className="w-full md:w-[200px] h-10 border-muted-foreground/20 font-bold">
                                    <SelectValue placeholder="All Branches" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Branches</SelectItem>
                                    {shops?.map(s => (
                                        <SelectItem key={s._id} value={s._id}>{s.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select value={clientType} onValueChange={setClientType}>
                                <SelectTrigger className="w-full md:w-[150px] h-10 border-muted-foreground/20 font-bold">
                                    <SelectValue placeholder="All Clients" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">All Clients</SelectItem>
                                    <SelectItem value="Member">Regular Member</SelectItem>
                                    <SelectItem value="HP Client">HP Client</SelectItem>
                                    <SelectItem value="Walk-in">Walk-in</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <ReportTable
                        title="Comprehensive Sales Report"
                        subtitle="Complete itemized transaction history."
                        data={salesReport?.page || []}
                        isLoading={salesReport === undefined}
                        columns={[
                            {
                                header: "Date/Time",
                                accessor: (s: any) => (
                                    <div className="font-mono leading-tight">
                                        <div className="font-black">{format(new Date(s._creationTime), "dd MMM yyyy")}</div>
                                        <div className="text-[9px] text-muted-foreground">{format(new Date(s._creationTime), "HH:mm:ss")}</div>
                                    </div>
                                )
                            },
                            {
                                header: "Client Info",
                                accessor: (s: any) => (
                                    <div className="space-y-1">
                                        <div className="flex gap-1 flex-wrap">
                                            <Badge variant={s.clientType === "HP Client" ? "secondary" : "outline"} className="text-[9px] h-4">
                                                {s.clientType}
                                            </Badge>
                                            <Badge variant={s.paymentMode === "Loan" ? "destructive" : "outline"} className="text-[9px] h-4">
                                                {s.paymentMode || "Cash"}
                                            </Badge>
                                        </div>
                                        <div className="text-[10px] font-bold text-primary truncate max-w-[120px]">
                                            {s.customerName}
                                        </div>
                                        <div className="text-[9px] font-medium text-muted-foreground italic">
                                            {s.shopName}
                                        </div>
                                    </div>
                                )
                            },
                            {
                                header: "Items (Qty x Name)",
                                accessor: (s: any) => (
                                    <div className="space-y-1 max-w-[300px]">
                                        {s.items.map((item: any, idx: number) => (
                                            <div key={idx} className="text-[10px] flex justify-between gap-4 border-b border-dashed border-muted pb-0.5 last:border-0">
                                                <span className="truncate">
                                                    <span className="font-black text-primary mr-1">{item.quantity}x</span>
                                                    {item.name}
                                                </span>
                                                <span className="text-muted-foreground shrink-0 font-medium">[{item.pv} PV / {item.bv} BV]</span>
                                            </div>
                                        ))}
                                    </div>
                                ),
                                className: "min-w-[200px]"
                            },
                            {
                                header: "PV/BV",
                                accessor: (s: any) => {
                                    const totalPV = s.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0);
                                    const totalBV = s.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0);
                                    return (
                                        <div className="text-right font-mono">
                                            <div className="font-black text-emerald-600">{totalPV.toLocaleString()} PV</div>
                                            <div className="text-[9px] text-muted-foreground">{totalBV.toLocaleString()} BV</div>
                                        </div>
                                    )
                                },
                                className: "text-right"
                            },
                            {
                                header: "Total UGX",
                                accessor: (s: any) => <div className="text-right font-black text-xs">{s.total.toLocaleString()}</div>,
                                className: "text-right"
                            }
                        ]}
                    />
                </TabsContent>

                <TabsContent value="shops" className="space-y-4">
                    <ReportTable
                        title="Branch Performance Summary"
                        subtitle="Key metrics per active shop"
                        data={shopSummary || []}
                        isLoading={shopSummary === undefined}
                        columns={[
                            { header: "Branch Name", accessor: (item: any) => <span className="font-bold">{item.name}</span> },
                            { header: "Location", accessor: "location" },
                            { header: "Transactions", accessor: (item: any) => item.transactionCount.toLocaleString(), className: "text-center" },
                            { header: "Total Sales", accessor: (item: any) => formatPrice(item.totalSales), className: "font-black text-right" },
                            { header: "Last Active", accessor: (item: any) => item.lastSaleDate ? format(new Date(item.lastSaleDate), "dd MMM yyyy") : "Never" },
                        ]}
                    />
                </TabsContent>

                <TabsContent value="stock" className="space-y-4">
                    <ReportTable
                        title="Global Inventory Status"
                        subtitle="Combined view of HQ and all shop holdings"
                        data={stockSummary || []}
                        isLoading={stockSummary === undefined}
                        columns={[
                            {
                                header: "Product", accessor: (item: any) => (
                                    <div>
                                        <p className="font-bold">{item.name}</p>
                                        <p className="text-[10px] uppercase text-muted-foreground">{item.productCode}</p>
                                    </div>
                                )
                            },
                            { header: "Category", accessor: (item: any) => item.categoryId || "General" },
                            { header: "HQ", accessor: (item: any) => item.hqQty.toLocaleString(), className: "text-center font-bold" },
                            { header: "Shops", accessor: (item: any) => item.shopQty.toLocaleString(), className: "text-center" },
                            { header: "System", accessor: (item: any) => item.totalQty.toLocaleString(), className: "text-center font-black bg-primary/5" },
                            { header: "Sell Price", accessor: (item: any) => formatPrice(item.sellingPrice || item.price), className: "text-right" },
                            { header: "PV/BV", accessor: (item: any) => `${item.pv}/${item.bv}`, className: "text-right font-medium text-muted-foreground" },
                        ]}
                    />
                </TabsContent>

                <TabsContent value="loans" className="space-y-4">
                    <ReportTable
                        title="Outstanding Loans Report"
                        subtitle="Detailed tracking of credit-based sales and debtor balances."
                        data={loansReport?.page || []}
                        isLoading={loansReport === undefined}
                        columns={[
                            {
                                header: "Date/Time",
                                accessor: (l: any) => (
                                    <div className="font-mono leading-tight">
                                        <div className="font-black">{format(new Date(l.date || l._creationTime), "dd MMM yyyy")}</div>
                                        <div className="text-[9px] text-muted-foreground">{format(new Date(l.date || l._creationTime), "HH:mm")}</div>
                                    </div>
                                )
                            },
                            {
                                header: "Debtor Info",
                                accessor: (l: any) => (
                                    <div className="space-y-1">
                                        <div className="flex gap-1 flex-wrap">
                                            <Badge variant={l.clientType === "HP Client" ? "secondary" : "outline"} className="text-[9px] h-4">
                                                {l.clientType}
                                            </Badge>
                                            <Badge variant="destructive" className="text-[9px] h-4">
                                                Loan
                                            </Badge>
                                        </div>
                                        <div className="text-[10px] font-black text-primary truncate max-w-[120px]">
                                            {l.customerName}
                                        </div>
                                        <div className="text-[9px] font-medium text-muted-foreground italic">
                                            {l.customerPhone}
                                        </div>
                                    </div>
                                )
                            },
                            {
                                header: "Items (Qty x Name)",
                                accessor: (l: any) => (
                                    <div className="space-y-1 max-w-[300px]">
                                        {(l.items || []).map((item: any, idx: number) => (
                                            <div key={idx} className="text-[10px] flex justify-between gap-4 border-b border-dashed border-muted pb-0.5 last:border-0">
                                                <span className="truncate">
                                                    <span className="font-black text-primary mr-1">{item.quantity}x</span>
                                                    {item.name}
                                                </span>
                                                <span className="text-muted-foreground shrink-0 font-medium">[{item.pv} PV / {item.bv} BV]</span>
                                            </div>
                                        ))}
                                    </div>
                                ),
                                className: "min-w-[200px]"
                            },
                            {
                                header: "Balances",
                                accessor: (l: any) => (
                                    <div className="text-right space-y-0.5 font-mono">
                                        <div className="text-[9px] text-muted-foreground">Original: {(l.totalAmount || 0).toLocaleString()}</div>
                                        <div className="font-black text-destructive text-xs">Due: {(l.balance || 0).toLocaleString()}</div>
                                        {l.dueDate && (
                                            <div className="text-[8px] font-bold text-orange-600 bg-orange-50 px-1 py-0.5 rounded inline-block">
                                                Due: {format(new Date(l.dueDate), "dd MMM")}
                                            </div>
                                        )}
                                    </div>
                                ),
                                className: "text-right"
                            },
                            {
                                header: "Status",
                                accessor: (l: any) => (
                                    <Badge variant={(l.balance || 0) > 0 ? "destructive" : "outline"} className="text-[9px] uppercase font-black tracking-tighter">
                                        {(l.balance || 0) > 0 ? "Outstanding" : "Cleared"}
                                    </Badge>
                                ),
                                className: "text-center"
                            }
                        ]}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
