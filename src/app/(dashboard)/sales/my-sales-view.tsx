"use client";

import { useState } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { startOfMonth, endOfMonth, endOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/date-range-picker";

export function MySalesView() {
    const { user } = useAuth();
    // Default to current month
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    const [filterType, setFilterType] = useState("All");

    // Params for queries
    const queryArgs = {
        from: date?.from?.toISOString(),
        to: date?.to?.toISOString(),
        filterType,
        email: user?.email || undefined
    };

    // 1. Stats
    const stats = useQuery(api.sales.mySalesStats, queryArgs);

    // 2. Paginated List
    const { results, status, loadMore, isLoading } = usePaginatedQuery(
        api.sales.mySales,
        queryArgs,
        { initialNumItems: 10 }
    );

    // Formatting helper
    const fmt = (n: number) => n?.toLocaleString() ?? "0";

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Top Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-muted/20 p-4 rounded-lg border">
                <div className="flex items-center gap-2">
                    <Label className="whitespace-nowrap">Date Range:</Label>
                    <DatePickerWithRange date={date} setDate={setDate} />
                </div>
                <div className="flex items-center gap-2">
                    <Label>Filter Type:</Label>
                    <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="w-[180px] bg-white">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">All Sales</SelectItem>
                            <SelectItem value="Regular">Regular Sales</SelectItem>
                            <SelectItem value="HP">HP Sales</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-primary/5 border-primary/20 shadow-sm">
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Total Sales</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">UGX {fmt(stats?.totalSales || 0)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">Regular / Cash</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">UGX {fmt(stats?.totalRegular || 0)}</div></CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground">HP / Partial</CardTitle></CardHeader>
                    <CardContent><div className="text-2xl font-bold">UGX {fmt(stats?.totalHP || 0)}</div></CardContent>
                </Card>
            </div>

            {/* Sales Table */}
            <div className="flex-1 border rounded-md overflow-hidden bg-background flex flex-col">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-[150px]">Date</TableHead>
                            <TableHead>Client Type</TableHead>
                            <TableHead className="w-[40%]">Items (Qty x Name [PV/BV])</TableHead>
                            <TableHead className="text-right">Total PV/BV</TableHead>
                            <TableHead className="text-right">Total (UGX)</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!results || results.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                                    {status === "LoadingFirstPage" ? <Loader2 className="animate-spin mx-auto" /> : "No sales found for this period."}
                                </TableCell>
                            </TableRow>
                        ) : (
                            results.map((sale) => {
                                const totalPV = sale.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0);
                                const totalBV = sale.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0);

                                return (
                                    <TableRow key={sale._id} className="hover:bg-muted/5">
                                        <TableCell className="font-mono text-xs">
                                            <div className="font-semibold">{new Date(sale._creationTime).toLocaleDateString()}</div>
                                            <div className="text-[10px] text-muted-foreground">{new Date(sale._creationTime).toLocaleTimeString()}</div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={sale.clientType === "HP Client" ? "secondary" : "outline"}>
                                                {sale.clientType}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="max-w-[400px]">
                                            <div className="flex flex-col gap-1">
                                                {sale.items.map((i: any, idx: number) => (
                                                    <div key={idx} className="text-xs border-b border-dashed last:border-0 pb-1 last:pb-0 flex items-center justify-between">
                                                        <span><span className="font-bold mr-1">{i.quantity}x</span> {i.name}</span>
                                                        <span className="text-muted-foreground ml-2 text-[10px] whitespace-nowrap">
                                                            [{i.pv} PV / {i.bv} BV]
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-right font-mono text-xs">
                                            <div className="font-medium text-emerald-600">{totalPV.toLocaleString()} PV</div>
                                            <div className="text-muted-foreground">{totalBV.toLocaleString()} BV</div>
                                        </TableCell>
                                        <TableCell className="text-right font-bold">
                                            {sale.total.toLocaleString()}
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>

                {/* Pagination */}
                <div className="p-4 border-t bg-muted/5 flex justify-center">
                    {status === "CanLoadMore" && (
                        <Button variant="outline" onClick={() => loadMore(10)} disabled={isLoading}>
                            {isLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : null}
                            Load More
                        </Button>
                    )}
                </div>
            </div>
        </div>
    );
}
