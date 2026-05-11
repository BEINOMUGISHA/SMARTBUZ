"use client";

import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import {
    Card, CardContent, CardHeader, CardTitle, CardDescription
} from "@/components/ui/card";
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow
} from "@/components/ui/table";
import {
    Package, TrendingUp, AlertTriangle, Database, Activity, BarChart3,
    ArrowRight, Loader2, DollarSign, Layers, ChevronRight
} from "lucide-react";
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
    PieChart, Pie
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

export default function InventoryPage() {
    const stats = useQuery(api.stocks.getInventoryStats);
    const lowStockAudit = useQuery(api.stocks.getLowStockAudit, { threshold: 15 });
    const activities = useQuery(api.activityLogs.list, { paginationOpts: { numItems: 8, cursor: null } });

    if (!stats) {
        return (
            <div className="flex h-[60vh] items-center justify-center">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="h-10 w-10 animate-spin text-primary" />
                    <p className="font-bold text-muted-foreground animate-pulse">Analyzing Warehouse Data...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-8 pb-12">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="text-3xl font-black tracking-tight">Inventory Management Hub</h1>
                    <p className="text-muted-foreground font-medium">Global warehouse valuation and distribution analytics.</p>
                </div>
                <div className="flex items-center gap-2">
                    <Link href="/stock">
                        <Button variant="outline" className="font-bold">
                            <Layers className="mr-2 h-4 w-4" /> Manage Stocks
                        </Button>
                    </Link>
                </div>
            </div>

            {/* Top Level KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Warehouse Valuation"
                    description="Total selling price of all inventory items"
                    value={`UGX ${stats.totalSellValue.toLocaleString()}`}
                    subValue={`Cost: UGX ${stats.totalCostValue.toLocaleString()}`}
                    icon={DollarSign}
                    color="bg-blue-500"
                />
                <StatCard
                    title="Estimated Margin"
                    description="Profit percentage across entire inventory"
                    value={`${(((stats.totalSellValue - stats.totalCostValue) / (stats.totalSellValue || 1)) * 100).toFixed(1)}%`}
                    subValue={`Profit: UGX ${(stats.totalSellValue - stats.totalCostValue).toLocaleString()}`}
                    icon={TrendingUp}
                    color="bg-green-500"
                />
                <StatCard
                    title="Total SKU Volume"
                    description="Total quantity of all items in stock"
                    value={stats.totalItems.toLocaleString()}
                    subValue={`${stats.skuCount} Unique Products`}
                    icon={Package}
                    color="bg-purple-500"
                />
                <StatCard
                    title="Stock Risks"
                    description="Products with low inventory needing restock"
                    value={lowStockAudit?.length.toString() || "0"}
                    subValue="Items below reorder point"
                    icon={AlertTriangle}
                    color={lowStockAudit && lowStockAudit.length > 0 ? "bg-red-500" : "bg-emerald-500"}
                />
            </div>

            {/* Secondary KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatCard
                    title="Total BV"
                    description="Business Volume - points for distributor commissions"
                    value={stats.totalBV.toLocaleString()}
                    subValue="Business Volume"
                    icon={BarChart3}
                    color="bg-indigo-500"
                />
                <StatCard
                    title="Total PV"
                    description="Point Value - qualification points for rank advancement"
                    value={stats.totalPV.toLocaleString()}
                    subValue="Point Value"
                    icon={Activity}
                    color="bg-pink-500"
                />
                <StatCard
                    title="Out of Stock"
                    description="Products completely unavailable in warehouse"
                    value={stats.outOfStockCount.toString()}
                    subValue="Products with zero quantity"
                    icon={AlertTriangle}
                    color={stats.outOfStockCount > 0 ? "bg-red-500" : "bg-emerald-500"}
                />
                <StatCard
                    title="Active Suppliers"
                    description="Number of suppliers and shops in operation"
                    value={stats.supplierCount.toString()}
                    subValue={`${stats.shopCount} Active Shops`}
                    icon={Database}
                    color="bg-orange-500"
                />
            </div>

            {/* Stock Distribution */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <StatCard
                    title="Warehouse Stock"
                    description="Inventory remaining in main warehouse (not yet issued)"
                    value={stats.warehouseStock.toLocaleString()}
                    subValue="Items in main warehouse"
                    icon={Package}
                    color="bg-cyan-500"
                />
                <StatCard
                    title="Shop Stock"
                    description="Total inventory currently allocated to all shops"
                    value={stats.totalShopStock.toLocaleString()}
                    subValue="Items distributed to shops"
                    icon={Layers}
                    color="bg-teal-500"
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* Category Distribution Chart */}
                <Card className="lg:col-span-1 shadow-sm border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BarChart3 className="h-5 w-5 text-primary" />
                            Category Distribution
                        </CardTitle>
                        <CardDescription>Stock volume by category</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.categoryDistribution} layout="vertical" margin={{ left: 60, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 11, fontWeight: 600 }}
                                        width={55}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'transparent' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length && payload[0]?.payload) {
                                                return (
                                                    <div className="bg-white border rounded-lg shadow-xl p-3 border-primary/20">
                                                        <p className="text-xs font-black text-muted-foreground uppercase">{payload[0].payload.name}</p>
                                                        <p className="text-xl font-black text-primary">{payload[0].value?.toLocaleString()} items</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                        {stats.categoryDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Supplier Distribution Chart */}
                <Card className="lg:col-span-1 shadow-sm border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Database className="h-5 w-5 text-primary" />
                            Supplier Distribution
                        </CardTitle>
                        <CardDescription>Stock volume by supplier</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <PieChart>
                                    <Pie
                                        data={stats.supplierDistribution}
                                        cx="50%"
                                        cy="50%"
                                        innerRadius={40}
                                        outerRadius={80}
                                        paddingAngle={2}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                                        labelLine={false}
                                    >
                                        {stats.supplierDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Pie>
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length && payload[0]?.payload) {
                                                return (
                                                    <div className="bg-white border rounded-lg shadow-xl p-3 border-primary/20">
                                                        <p className="text-xs font-black text-muted-foreground uppercase">{payload[0].payload.name}</p>
                                                        <p className="text-xl font-black text-primary">{payload[0].value?.toLocaleString()} items</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                </PieChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                {/* Shop Distribution Chart */}
                <Card className="lg:col-span-1 shadow-sm border-none bg-card/50 backdrop-blur-sm">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Layers className="h-5 w-5 text-primary" />
                            Shop Distribution
                        </CardTitle>
                        <CardDescription>Stock allocated to shops</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[300px] w-full pt-4">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={stats.shopDistribution} layout="vertical" margin={{ left: 60, right: 20 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                                    <XAxis type="number" hide />
                                    <YAxis
                                        dataKey="name"
                                        type="category"
                                        axisLine={false}
                                        tickLine={false}
                                        tick={{ fontSize: 11, fontWeight: 600 }}
                                        width={55}
                                    />
                                    <Tooltip
                                        cursor={{ fill: 'transparent' }}
                                        content={({ active, payload }) => {
                                            if (active && payload && payload.length && payload[0]?.payload) {
                                                return (
                                                    <div className="bg-white border rounded-lg shadow-xl p-3 border-primary/20">
                                                        <p className="text-xs font-black text-muted-foreground uppercase">{payload[0].payload.name}</p>
                                                        <p className="text-xl font-black text-primary">{payload[0].value?.toLocaleString()} items</p>
                                                    </div>
                                                );
                                            }
                                            return null;
                                        }}
                                    />
                                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={20}>
                                        {stats.shopDistribution.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Recent Activity Feed */}
            <Card className="shadow-sm border-none bg-card/50 backdrop-blur-sm">
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Activity className="h-5 w-5 text-primary" />
                        Stock Movements
                    </CardTitle>
                    <CardDescription>Latest logs from warehouse operations</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-6">
                        {activities?.page.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-12">No recent warehouse activity</p>
                        ) : (
                            activities?.page.map((log: any) => (
                                <div key={log._id} className="relative pl-6 pb-6 border-l last:pb-0 border-muted">
                                    <div className="absolute left-[-5px] top-0 h-2.5 w-2.5 rounded-full bg-primary" />
                                    <div className="space-y-1">
                                        <p className="text-xs font-black text-primary uppercase tracking-wider">{log.action}</p>
                                        <p className="text-sm font-medium line-clamp-2">{log.details}</p>
                                        <p className="text-[10px] text-muted-foreground font-mono">
                                            {new Date(log.timestamp).toLocaleString()}
                                        </p>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Audit Section */}
            <Card className="shadow-sm border-none bg-card/50 backdrop-blur-sm overflow-hidden">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-5 w-5 text-red-500" />
                            Low Stock Audit Tool
                        </CardTitle>
                        <CardDescription>Items with quantity below 15 units. Prioritize for restocking.</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="pl-6 font-bold py-4">Product</TableHead>
                                <TableHead className="font-bold">Category</TableHead>
                                <TableHead className="text-center font-bold">Qty Left</TableHead>
                                <TableHead className="text-right font-bold">Valuation</TableHead>
                                <TableHead className="text-right pr-6 font-bold">Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {lowStockAudit?.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-32 text-center text-muted-foreground font-medium">
                                        No low stock items detected. Warehouse levels are healthy.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                lowStockAudit?.map((item: any) => (
                                    <TableRow key={item._id} className="hover:bg-muted/20 transition-colors group">
                                        <TableCell className="pl-6 py-4">
                                            <div className="font-bold text-sm">{item.name}</div>
                                            <div className="text-[10px] font-mono text-muted-foreground">{item.productCode}</div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-normal text-[10px] uppercase">{item.categoryName}</Badge>
                                        </TableCell>
                                        <TableCell className="text-center">
                                            <span className={item.qty <= 5 ? "text-red-500 font-black" : "font-bold"}>
                                                {item.qty}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            UGX {item.valuation.toLocaleString()}
                                        </TableCell>
                                        <TableCell className="text-right pr-6">
                                            {item.qty === 0 ? (
                                                <Badge variant="destructive" className="font-black text-[10px] uppercase">Out of Stock</Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50 font-black text-[10px] uppercase">Restock Soon</Badge>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
}

function StatCard({ title, description, value, subValue, icon: Icon, color }: any) {
    return (
        <Card className="border-none shadow-sm overflow-hidden relative group">
            <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4 relative z-10">
                    <div className={`p-2.5 rounded-xl ${color} text-white shadow-lg shadow-${color.split('-')[1]}-200`}>
                        <Icon className="h-5 w-5" />
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
                <div className="relative z-10">
                    <p className="text-xs font-black text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
                    <p className="text-2xl font-black mb-1">{value}</p>
                    <p className="text-xs text-muted-foreground font-medium mb-1">{subValue}</p>
                    {description && <p className="text-[10px] text-muted-foreground/70 leading-tight">{description}</p>}
                </div>
                {/* Background Decor */}
                <div className={`absolute -right-6 -bottom-6 opacity-[0.03] transition-transform group-hover:scale-110 duration-500`}>
                    <Icon className="h-32 w-32" />
                </div>
            </CardContent>
        </Card>
    );
}
