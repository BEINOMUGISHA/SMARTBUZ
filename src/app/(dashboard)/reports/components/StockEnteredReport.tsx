"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, addDays, subDays } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Package, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ReportTable } from "./reports-table";

export function StockEnteredReport({ search, searchType }: { search?: string; searchType?: string }) {
    const [date, setDate] = useState<Date>(new Date());

    const formattedDate = format(date, "yyyy-MM-dd");
    const entries = useQuery(api.reports.getStockEntries, {
        date: formattedDate,
        search: search || undefined,
        searchType: searchType || undefined
    });

    const handlePrevDay = () => setDate(d => subDays(d, 1));
    const handleNextDay = () => setDate(d => addDays(d, 1));

    return (
        <div className="space-y-6">
            {/* DATE CONTROLS */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-4 rounded-2xl border shadow-sm">
                <div>
                    <h2 className="text-lg font-black tracking-tight flex items-center gap-2">
                        <Package className="h-5 w-5 text-primary" />
                        Stock Entry Log
                    </h2>
                    <p className="text-xs text-muted-foreground font-medium uppercase tracking-wider">
                        Tracking inventory additions for {format(date, "MMMM dd, yyyy")}
                    </p>
                </div>

                <div className="flex items-center gap-2">
                    <Button variant="outline" size="icon" onClick={handlePrevDay} className="rounded-xl border-2">
                        <ChevronLeft className="h-4 w-4" />
                    </Button>

                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant={"outline"}
                                className={cn(
                                    "w-[240px] justify-start text-left font-black border-2 rounded-xl",
                                    !date && "text-muted-foreground"
                                )}
                            >
                                <CalendarIcon className="mr-2 h-4 w-4" />
                                {date ? format(date, "PPP") : <span>Pick a date</span>}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 rounded-2xl" align="end">
                            <Calendar
                                mode="single"
                                selected={date}
                                onSelect={(d) => d && setDate(d)}
                                initialFocus
                            />
                        </PopoverContent>
                    </Popover>

                    <Button variant="outline" size="icon" onClick={handleNextDay} className="rounded-xl border-2">
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            {/* TABLE */}
            <ReportTable
                title={`Stock Entries - ${formattedDate}`}
                subtitle={`Daily inventory audit for ${format(date, "PPPP")}`}
                columns={[
                    {
                        header: "Time",
                        accessor: (e: any) => format(new Date(e.date), "HH:mm:ss"),
                        className: "font-mono"
                    },
                    {
                        header: "Product",
                        accessor: (e: any) => (
                            <div className="flex flex-col">
                                <span className="font-black text-primary">{e.productName}</span>
                                <span className="text-[10px] text-muted-foreground uppercase font-bold">{e.productCode}</span>
                            </div>
                        )
                    },
                    {
                        header: "Qty Added",
                        accessor: (e: any) => (
                            <div className="flex items-center gap-2">
                                <span className="font-black text-emerald-600">+{e.quantity}</span>
                                <Badge variant="secondary" className="text-[8px] h-4 uppercase font-black tracking-tighter">
                                    {e.type}
                                </Badge>
                            </div>
                        ),
                        className: "text-center"
                    },
                    {
                        header: "Financials",
                        accessor: (e: any) => (
                            <div className="flex flex-col text-[10px]">
                                <span className="font-bold">Buy: UGX {e.purchasePrice.toLocaleString()}</span>
                                <span className="text-muted-foreground">Sell: UGX {e.price.toLocaleString()}</span>
                            </div>
                        )
                    },
                    {
                        header: "PV/BV",
                        accessor: (e: any) => (
                            <div className="flex flex-col text-[10px] font-mono">
                                <span className="text-amber-600 font-bold">{e.pv} PV</span>
                                <span className="text-blue-600 font-bold">{e.bv} BV</span>
                            </div>
                        )
                    },
                    {
                        header: "Total PV",
                        accessor: (e: any) => (
                            <span className="font-black text-amber-600 text-xs">{(e.pv * e.quantity).toLocaleString()}</span>
                        ),
                        exportValue: (e: any) => (e.pv * e.quantity).toLocaleString(),
                        className: "text-right"
                    },
                    {
                        header: "Total BV",
                        accessor: (e: any) => (
                            <span className="font-black text-blue-600 text-xs">{(e.bv * e.quantity).toLocaleString()}</span>
                        ),
                        exportValue: (e: any) => (e.bv * e.quantity).toLocaleString(),
                        className: "text-right"
                    },
                    {
                        header: "Total Cost",
                        accessor: (e: any) => (
                            <span className="font-black text-emerald-700 text-xs">{(e.purchasePrice * e.quantity).toLocaleString()}</span>
                        ),
                        exportValue: (e: any) => (e.purchasePrice * e.quantity).toLocaleString(),
                        className: "text-right"
                    },
                    {
                        header: "Total Value",
                        accessor: (e: any) => (
                            <span className="font-black text-primary text-xs">{(e.price * e.quantity).toLocaleString()}</span>
                        ),
                        exportValue: (e: any) => (e.price * e.quantity).toLocaleString(),
                        className: "text-right"
                    },
                    {
                        header: "Supplier",
                        accessor: (e: any) => (
                            <span className="italic text-muted-foreground font-black text-[10px]">
                                {e.supplier || "-"}
                            </span>
                        ),
                        className: "text-left"
                    },
                    {
                        header: "Verified By",
                        accessor: (e: any) => (
                            <div className="flex items-center gap-2">
                                <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center text-[10px] font-black text-primary">
                                    {e.userName.split(" ").map((n: string) => n[0]).join("")}
                                </div>
                                <span className="font-bold text-xs">{e.userName}</span>
                            </div>
                        )
                    }
                ]}
                data={entries || []}
                isLoading={entries === undefined}
            />
        </div>
    );
}
