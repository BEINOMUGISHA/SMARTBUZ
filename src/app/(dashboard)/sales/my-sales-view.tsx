"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Loader2,
    ChevronLeft,
    ChevronRight,
    Check,
    ChevronsUpDown,
    Search,
    Calendar as CalendarIcon,
    FileSpreadsheet,
    FileText,
    Printer
} from "lucide-react";
import { exportToExcel, exportToPDF, extractTextFromReact } from "@/lib/export-utils";
import { getStatsForVariant } from "../reports/components/ReportSummary";
import { startOfMonth, endOfMonth, endOfDay, format, startOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { cn } from "@/lib/utils";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Id } from "../../../../convex/_generated/dataModel";

import { ReceiptModal } from "@/components/ReceiptModal";
import { ReceiptData } from "@/components/ReceiptTemplate";

export function MySalesView() {
    const { user } = useAuth();
    const [dateMode, setDateMode] = useState<"audit" | "range">("audit");
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    // Default to current month for range
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    const [filterType, setFilterType] = useState("All");
    const [selectedCustomerId, setSelectedCustomerId] = useState<Id<"customers"> | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState("");
    const [filterPackageType, setFilterPackageType] = useState("All");
    const [filterDeliveryStatus, setFilterDeliveryStatus] = useState("All");

    // Receipt Modal State
    const [printReceiptData, setPrintReceiptData] = useState<ReceiptData | null>(null);
    const [isReceiptOpen, setIsReceiptOpen] = useState(false);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Persist rowsPerPage
    useEffect(() => {
        const saved = localStorage.getItem("pos_mysales_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
    }, []);

    // Params for queries
    const queryArgs = {
        from: dateMode === "audit" ? (selectedDate ? startOfDay(selectedDate).toISOString() : undefined) : date?.from?.toISOString(),
        to: dateMode === "audit" ? (selectedDate ? endOfDay(selectedDate).toISOString() : undefined) : date?.to?.toISOString(),
        filterType,
        customerId: selectedCustomerId,
        searchTerm,
        email: user?.email || undefined,
        packageType: filterPackageType === "All" ? undefined : filterPackageType,
        deliveryStatus: filterDeliveryStatus === "All" ? undefined : filterDeliveryStatus,
    };

    // 1. Stats
    const stats = useQuery(api.sales.mySalesStats, queryArgs);

    // 2. Paginated List
    const { results, status, loadMore, isLoading } = usePaginatedQuery(
        api.sales.mySales,
        queryArgs,
        { initialNumItems: rowsPerPage }
    );

    // Sync Load
    useEffect(() => {
        if (status === "CanLoadMore" && results && results.length < rowsPerPage) {
            loadMore(rowsPerPage - results.length);
        }
    }, [rowsPerPage, results, status, loadMore]);

    const totalItems = useQuery(api.sales.mySalesCount, queryArgs) || 0;

    // View Slicing
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);

    // Loaded check
    const loadedCount = results?.length || 0;
    const currentView = results?.slice(startIndex, endIndex) || [];

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            const nextPageIndex = startIndex + rowsPerPage;
            if (nextPageIndex >= loadedCount && status === "CanLoadMore") {
                loadMore(rowsPerPage);
            }
            setCurrentPage(p => p + 1);
        }
    };

    // Formatting helper
    const fmt = (n: number) => n?.toLocaleString() ?? "0";

    const columns = [
        {
            header: "Date/Time",
            accessor: (s: any) => format(new Date(s._creationTime), "dd MMM yyyy HH:mm"),
            exportValue: (s: any) => format(new Date(s._creationTime), "dd/MM/yyyy HH:mm")
        },
        {
            header: "Client Type",
            accessor: (s: any) => (
                <div className="flex flex-col gap-1">
                    <Badge variant={s.clientType === "HP Client" ? "secondary" : "outline"}>{s.clientType}</Badge>
                    {s.packageType && (
                        <Badge variant="outline" className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px]">
                            {s.packageType}
                        </Badge>
                    )}
                </div>
            ),
            exportValue: (s: any) => s.packageType ? `${s.clientType} (${s.packageType})` : s.clientType
        },
        {
            header: "Delivery",
            accessor: (s: any) => (
                <Badge variant={s.deliveryStatus === "Pending" ? "destructive" : "default"} className="text-[10px]">
                    {s.deliveryStatus === "Pending" ? "Pending" : "Taken"}
                </Badge>
            ),
            exportValue: (s: any) => s.deliveryStatus || "Taken"
        },
        {
            header: "Customer",
            accessor: (s: any) => s.customer?.name || s.manualCustomerName || "Walk-in"
        },
        {
            header: "Items Sold",
            accessor: (s: any) => s.items.map((i: any) => `${i.quantity}x ${i.name}`).join(", "),
            exportValue: (s: any) => s.items.map((i: any) => `${i.quantity}x ${i.name}`).join("\n")
        },
        {
            header: "Total PV",
            accessor: (s: any) => s.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0),
        },
        {
            header: "Total BV",
            accessor: (s: any) => s.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0),
        },
        {
            header: "Total (UGX)",
            accessor: (s: any) => s.total,
            exportValue: (s: any) => s.total.toLocaleString()
        },
        {
            header: "Payment",
            accessor: (s: any) => s.paymentMode || "Cash"
        }
    ];

    const handlePrint = () => {
        const style = document.createElement('style');
        style.id = 'print-style-temp';
        style.innerHTML = `
            @media print {
                body * { visibility: hidden !important; }
                #my-sales-print, #my-sales-print * { visibility: visible !important; }
                #my-sales-print { 
                    position: absolute !important; 
                    left: 0 !important; 
                    top: 0 !important; 
                    width: 100% !important; 
                    display: block !important; 
                    padding: 15mm !important;
                    background: white !important;
                }
                @page { size: auto; margin: 0mm; }
            }
        `;
        document.head.appendChild(style);
        window.print();
        setTimeout(() => {
            const el = document.getElementById('print-style-temp');
            if (el) el.remove();
        }, 1000);
    };

    return (
        <>
            <div className="flex flex-col h-full space-y-4">
                {/* Filters */}
                <div className="flex flex-wrap items-center gap-4 bg-muted/20 p-3 rounded-xl border shadow-sm">
                    <div className="flex items-center gap-3">
                        <Tabs value={dateMode} onValueChange={(v: any) => setDateMode(v)} className="w-auto">
                            <TabsList className="h-9 p-1 bg-linear-to-b from-muted/50 to-muted/80 border shadow-xs rounded-lg">
                                <TabsTrigger
                                    value="audit"
                                    className="text-[10px] font-bold uppercase tracking-wider h-7 px-3 rounded-md transition-all
                                           data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm
                                           data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
                                >
                                    Daily Audit
                                </TabsTrigger>
                                <TabsTrigger
                                    value="range"
                                    className="text-[10px] font-bold uppercase tracking-wider h-7 px-3 rounded-md transition-all
                                           data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm
                                           data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground"
                                >
                                    Date Range
                                </TabsTrigger>
                            </TabsList>
                        </Tabs>

                        {dateMode === "audit" ? (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={cn("w-[160px] justify-start text-left font-normal h-9 bg-white", !selectedDate && "text-muted-foreground")}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {selectedDate ? format(selectedDate, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar
                                        mode="single"
                                        selected={selectedDate}
                                        onSelect={setSelectedDate}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        ) : (
                            <DatePickerWithRange date={date} setDate={setDate} />
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Package:</Label>
                        <Select value={filterPackageType} onValueChange={setFilterPackageType}>
                            <SelectTrigger className="w-[110px] bg-white h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent side="top">
                                <SelectItem value="All">All</SelectItem>
                                <SelectItem value="Bronze">Bronze</SelectItem>
                                <SelectItem value="Silver">Silver</SelectItem>
                                <SelectItem value="Gold">Gold</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex items-center gap-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Delivery:</Label>
                        <Select value={filterDeliveryStatus} onValueChange={setFilterDeliveryStatus}>
                            <SelectTrigger className="w-[110px] bg-white h-9 text-xs">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent side="top">
                                <SelectItem value="All">All</SelectItem>
                                <SelectItem value="Taken">Taken</SelectItem>
                                <SelectItem value="Pending">Pending</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="flex-1 min-w-[200px] relative">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search items, client, ID..."
                            className="pl-9 bg-white h-9 text-xs"
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <DistributorValues selectedId={selectedCustomerId} onSelect={setSelectedCustomerId} />

                    <div className="flex items-center gap-2 ml-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportToExcel(results || [], columns as any, "My_Sales_Report")}
                            className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-emerald-600/20 text-emerald-700 hover:bg-emerald-50 bg-white"
                        >
                            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                const summaryStats = [
                                    { title: "Total Volume", value: `UGX ${fmt(stats?.totalVolume || 0)}`, description: "Items moved" },
                                    { title: "Today's Collection", value: `UGX ${fmt(stats?.totalCollected || 0)}`, description: "Cash received" },
                                    { title: "Outstanding Credit", value: `UGX ${fmt(stats?.totalOutstanding || 0)}`, description: "Awaiting payment" }
                                ];

                                let logoBase64 = undefined;
                                try {
                                    const response = await fetch("/logo.ico");
                                    const blob = await response.blob();
                                    logoBase64 = await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onloadend = () => resolve(reader.result as string);
                                        reader.readAsDataURL(blob);
                                    });
                                } catch (error) {
                                    console.error("Failed to load logo for PDF", error);
                                }

                                exportToPDF(results || [], columns as any, "My_Sales_Report", "My Sales Report", summaryStats, logoBase64);
                            }}
                            className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-red-600/20 text-red-700 hover:bg-red-50 bg-white"
                        >
                            <FileText className="h-3.5 w-3.5" /> PDF
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handlePrint}
                            className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-muted-foreground/20 bg-white"
                        >
                            <Printer className="h-3.5 w-3.5" /> Print
                        </Button>
                    </div>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-primary/5 border-primary/20 shadow-sm">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Total Sales Volume</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">UGX {fmt(stats?.totalVolume || 0)}</div>
                            <p className="text-[10px] text-muted-foreground mt-1">Total value of all items moved</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-emerald-50/50 border-emerald-100">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-emerald-700 uppercase tracking-wider">Today's Collection</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-emerald-600">UGX {fmt(stats?.totalCollected || 0)}</div>
                            <p className="text-[10px] text-emerald-600/70 mt-1">Actual cash & deposits received</p>
                        </CardContent>
                    </Card>

                    <Card className="bg-orange-50/50 border-orange-100">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-orange-700 uppercase tracking-wider">Outstanding Credit</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-orange-600">UGX {fmt(stats?.totalOutstanding || 0)}</div>
                            <p className="text-[10px] text-orange-600/70 mt-1">Remaining balance on credit</p>
                        </CardContent>
                    </Card>
                </div >

                {/* Sales Table */}
                < div className="flex-1 border rounded-md overflow-hidden bg-background flex flex-col" >
                    <div className="flex-1 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead className="w-[150px]">Date</TableHead>
                                    <TableHead>Client Type</TableHead>
                                    <TableHead className="w-[40%]">Items (Qty x Name [PV/BV])</TableHead>
                                    <TableHead className="text-right">Total PV/BV</TableHead>
                                    <TableHead className="text-right">Total (UGX)</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {isLoading ? (
                                    <TableRow>
                                        <TableCell colSpan={6} className="h-24 text-center">
                                            <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                                        </TableCell>
                                    </TableRow>
                                ) : currentView.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                                            {status === "LoadingFirstPage" ? <Loader2 className="animate-spin mx-auto" /> : "No sales found for this period."}
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentView.map((sale) => {
                                        const totalPV = sale.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0);
                                        const totalBV = sale.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0);

                                        return (
                                            <TableRow key={sale._id} className="hover:bg-muted/5">
                                                <TableCell className="font-mono text-xs">
                                                    <div className="font-semibold">{new Date(sale._creationTime).toLocaleDateString()}</div>
                                                    <div className="text-[10px] text-muted-foreground">{new Date(sale._creationTime).toLocaleTimeString()}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1 items-start">
                                                        <div className="flex gap-1 flex-wrap">
                                                            <Badge variant={(sale as any).clientType === "HP Client" ? "secondary" : "outline"}>
                                                                {(sale as any).clientType}
                                                            </Badge>
                                                            <Badge variant={(sale as any).paymentMode === "Loan" ? "destructive" : "outline"} className="text-[10px] h-5">
                                                                {(sale as any).paymentMode || "Cash"}
                                                            </Badge>
                                                        </div>

                                                        {(sale as any).manualCustomerName && (
                                                            <div className="text-[10px] font-medium text-blue-600 mt-1">
                                                                Cust: {(sale as any).manualCustomerName}
                                                            </div>
                                                        )}

                                                        {(sale as any).paymentDueDate && (
                                                            <Badge variant="outline" className="text-[10px] border-orange-200 text-orange-700 bg-orange-50">
                                                                Due: {new Date((sale as any).paymentDueDate).toLocaleDateString()}
                                                            </Badge>
                                                        )}
                                                    </div>
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
                                                <TableCell className="text-right">
                                                    <div className="font-bold">{sale.total.toLocaleString()}</div>
                                                    {sale.loan && (
                                                        <div className="text-[10px] space-y-0.5 mt-1">
                                                            <div className="text-emerald-600 font-medium">Paid: {(sale.total - sale.loan.balance).toLocaleString()}</div>
                                                            <div className="text-orange-600 font-medium">Due: {sale.loan.balance.toLocaleString()}</div>
                                                        </div>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        title="Print Receipt"
                                                        onClick={() => {
                                                            const s = sale as any;
                                                            const receiptData: ReceiptData = {
                                                                customer: s.customer ? {
                                                                    name: s.customer.name,
                                                                    phone: s.customer.phone,
                                                                    email: s.customer.email || "",
                                                                    distributorId: s.customer.distributorId,
                                                                } : undefined,
                                                                shop: {
                                                                    name: s.shop?.name || "HQ",
                                                                    location: s.shop?.location || "Main Warehouse",
                                                                    contact: s.shop?.contact || "",
                                                                    serialNumber: s.shop?.serialNumber || "HQ-001",
                                                                },
                                                                operator: s.operator || {
                                                                    name: "",
                                                                    phone: "",
                                                                    email: "",
                                                                },
                                                                clientType: s.clientType,
                                                                paymentMode: s.paymentMode || "Cash",
                                                                date: new Date(s._creationTime).toISOString(),
                                                                paymentDueDate: s.paymentDueDate,
                                                                invoiceNumber: s._id.slice(0, 8).toUpperCase(),
                                                                items: s.items.map((i: any) => ({
                                                                    ...i,
                                                                    qty: i.quantity, // MAP quantity to qty for ReceiptTemplate
                                                                    productCode: i.productCode || "000",
                                                                })),
                                                                total: s.total,
                                                                totalPV: totalPV,
                                                                totalBV: totalBV,
                                                                initialDeposit: s.initialDeposit, // Pass recorded deposit
                                                                balance: s.isLoan ? (s.total - (s.initialDeposit || 0)) : undefined, // Calculate remaining balance
                                                            };

                                                            // If manual name exists, override customer name if it was a walk-in
                                                            if (s.manualCustomerName && !receiptData.customer) {
                                                                receiptData.customer = {
                                                                    name: s.manualCustomerName,
                                                                    phone: "",
                                                                    email: ""
                                                                };
                                                            }
                                                            setPrintReceiptData(receiptData);
                                                            setIsReceiptOpen(true);
                                                        }}
                                                    >
                                                        <Printer className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination Footer */}
                    <div className="flex items-center justify-end border-t bg-muted/20 px-4 py-4 space-x-2">
                        <div className="flex items-center space-x-2 mr-auto">
                            <p className="text-xs font-medium hidden sm:inline-block">Rows</p>
                            <Select
                                value={`${rowsPerPage}`}
                                onValueChange={(value) => {
                                    const newSize = Number(value);
                                    setRowsPerPage(newSize);
                                    localStorage.setItem("pos_mysales_rows_per_page", String(newSize));
                                    setCurrentPage(1);
                                }}
                            >
                                <SelectTrigger className="h-8 w-[65px]">
                                    <SelectValue placeholder={rowsPerPage} />
                                </SelectTrigger>
                                <SelectContent side="top">
                                    {[5, 10, 20, 30, 50, 100].map((pageSize) => (
                                        <SelectItem key={pageSize} value={`${pageSize}`}>
                                            {pageSize}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="text-xs font-medium mr-2">
                            {Math.min(startIndex + 1, totalItems)}-{Math.min(endIndex, totalItems)} of {totalItems}
                        </div>

                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            className="h-8 w-8 p-0"
                            onClick={handleNextPage}
                            disabled={currentPage >= totalPages || (currentPage === totalPages && status === "Exhausted")}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div >

                {
                    printReceiptData && (
                        <ReceiptModal
                            isOpen={isReceiptOpen}
                            onClose={() => setIsReceiptOpen(false)}
                            data={printReceiptData}
                        />
                    )
                }
            </div >

            {/* HIDDEN PRINT CONTENT */}
            < div id="my-sales-print" className="hidden print:report-print-view bg-white text-black p-4 min-h-screen report-print-view" >
                <div className="pb-6 border-b-2 border-emerald-600 mb-6 font-sans relative">
                    <div className="text-center px-20">
                        <h2 className="text-3xl font-black text-emerald-800 tracking-tight uppercase mb-1">TIENS HEALTH PRODUCTS</h2>
                        <p className="text-[11px] leading-tight font-bold text-gray-600">6th Floor, King Fahd Plaza, Plot 52 Kampala Rd</p>
                        <p className="text-[11px] font-bold text-gray-500">P.O.Box .... Kampala, Tel: +256 (0) 702 794 458 | 0773 662 136</p>
                        <div className="mt-2 inline-block px-4 py-1 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
                            OFFICIAL MY SALES REPORT
                        </div>
                    </div>
                    <div className="absolute right-0 top-0 h-full flex items-start pt-1">
                        <img src="/logo.ico" alt="Logo" className="h-20 w-20 object-contain" />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 border-b border-gray-100 pb-4">
                    <div className="flex flex-col pl-4 border-l border-gray-100 first:pl-0 first:border-0">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">TOTAL VOLUME</p>
                        <p className="text-xs font-black text-black">UGX {fmt(stats?.totalVolume || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Value of all items moved</p>
                    </div>
                    <div className="flex flex-col pl-4 border-l border-gray-100">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">TODAY'S COLLECTION</p>
                        <p className="text-xs font-black text-black">UGX {fmt(stats?.totalCollected || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Actual cash received</p>
                    </div>
                    <div className="flex flex-col pl-4 border-l border-gray-100">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">OUTSTANDING CREDIT</p>
                        <p className="text-xs font-black text-black">UGX {fmt(stats?.totalOutstanding || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Remaining balance</p>
                    </div>
                </div>

                <div className="mb-4">
                    <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Sales Records</h3>
                    <p className="text-[10px] font-bold text-gray-500 uppercase mt-0.5 tracking-wide">
                        {dateMode === "audit" ? `Audit Date: ${format(selectedDate || new Date(), "PPP")}` : `Range: ${format(date?.from || new Date(), "PP")} - ${format(date?.to || new Date(), "PP")}`}
                    </p>
                </div>

                <table className="w-full border-collapse border border-gray-300 print:text-[10px]">
                    <thead>
                        <tr className="bg-[#008542] border-b-2 border-emerald-800">
                            <th className="px-1 py-3 text-center font-black uppercase text-[10px] border-r border-emerald-700 w-8 text-white">#</th>
                            {columns.map((col, idx) => (
                                <th key={idx} className="px-3 py-2 text-[10px] border-r border-gray-300 last:border-0 text-white text-left font-black uppercase">
                                    {col.header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {(results || []).map((item, rowIdx) => (
                            <tr key={rowIdx} className={rowIdx % 2 === 1 ? "bg-gray-50" : "bg-white"}>
                                <td className="px-1 py-2 text-[10px] border-r border-gray-300 text-center font-bold text-gray-500 w-8">{rowIdx + 1}</td>
                                {columns.map((col, colIdx) => (
                                    <td key={colIdx} className="px-3 py-2 text-[10px] border-r border-gray-300 last:border-0 text-black font-medium whitespace-pre-line">
                                        {(col as any).exportValue
                                            ? (col as any).exportValue(item)
                                            : typeof col.accessor === "function"
                                                ? extractTextFromReact(col.accessor(item))
                                                : (item as any)[col.accessor as any]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>

                <div className="mt-8 flex justify-between text-[10px] font-bold text-gray-400 italic">
                    <span>Generated by System on {new Date().toLocaleString()}</span>
                    <span>Verified Official Document</span>
                </div>
            </div >
        </>
    );
}

function DistributorValues({ selectedId, onSelect }: { selectedId: Id<"customers"> | undefined, onSelect: (id: Id<"customers"> | undefined) => void }) {
    const [open, setOpen] = useState(false);
    const customers = useQuery(api.customers.listAll);

    const selectedCustomer = customers?.find((c) => c._id === selectedId);

    return (
        <div className="flex items-center gap-2">
            <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Distributor:</Label>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        className="w-[180px] justify-between bg-white font-normal h-9 text-xs"
                    >
                        <span className="truncate">
                            {selectedCustomer ? selectedCustomer.name : "All Distributors"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
                    <Command>
                        <CommandInput placeholder="Search..." />
                        <CommandList>
                            <CommandEmpty>Not found</CommandEmpty>
                            <CommandGroup>
                                <CommandItem
                                    onSelect={() => {
                                        onSelect(undefined);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            !selectedId ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    All Distributors
                                </CommandItem>
                                {customers?.map((customer) => (
                                    <CommandItem
                                        key={customer._id}
                                        value={`${customer.name} ${customer.distributorId || ""}`}
                                        onSelect={() => {
                                            onSelect(customer._id);
                                            setOpen(false);
                                        }}
                                    >
                                        <Check
                                            className={cn(
                                                "mr-2 h-4 w-4",
                                                selectedId === customer._id ? "opacity-100" : "opacity-0"
                                            )}
                                        />
                                        <div className="flex flex-col">
                                            <span className="font-medium">{customer.name}</span>
                                            {customer.distributorId && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    ID: {customer.distributorId}
                                                </span>
                                            )}
                                        </div>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        </CommandList>
                    </Command>
                </PopoverContent>
            </Popover>
        </div>
    );
}
