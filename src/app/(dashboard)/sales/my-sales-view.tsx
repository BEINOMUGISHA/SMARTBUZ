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
import { Loader2, ChevronLeft, ChevronRight, Check, ChevronsUpDown, Search } from "lucide-react";
import { startOfMonth, endOfMonth, endOfDay } from "date-fns";
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
import { Id } from "../../../../convex/_generated/dataModel";

import { ReceiptModal } from "@/components/ReceiptModal";
import { ReceiptData } from "@/components/ReceiptTemplate";
import { Printer } from "lucide-react";

export function MySalesView() {
    const { user } = useAuth();
    // Default to current month
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    const [filterType, setFilterType] = useState("All");
    const [selectedCustomerId, setSelectedCustomerId] = useState<Id<"customers"> | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState("");

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
        from: date?.from?.toISOString(),
        to: date?.to?.toISOString(),
        filterType,
        customerId: selectedCustomerId,
        searchTerm,
        email: user?.email || undefined
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

    return (
        <div className="flex flex-col h-full space-y-4">
            {/* Top Controls */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-muted/20 p-4 rounded-lg border">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                        <Label className="whitespace-nowrap">Date Range:</Label>
                        <DatePickerWithRange date={date} setDate={setDate} />
                    </div>
                    <div className="flex items-center gap-2">
                        <Label>Filter Type:</Label>
                        <Select value={filterType} onValueChange={setFilterType}>
                            <SelectTrigger className="w-[140px] bg-white">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">All Sales</SelectItem>
                                <SelectItem value="Regular">Regular Sales</SelectItem>
                                <SelectItem value="HP">HP Sales</SelectItem>
                                <SelectItem value="Loans">Loans</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <div className="relative w-full sm:w-[250px]">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search customer, invoice..."
                            className="pl-9 bg-white"
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <DistributorValues selectedId={selectedCustomerId} onSelect={setSelectedCustomerId} />
                    </div>
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
                            {!results ? (
                                <TableRow>
                                    <TableCell colSpan={5} className="h-24 text-center">
                                        <Loader2 className="animate-spin mx-auto" />
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
                                            <TableCell className="text-right font-bold">
                                                {sale.total.toLocaleString()}
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
                                                                name: "Unknown",
                                                                phone: "N/A",
                                                                email: "N/A",
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
                                                            balance: s.isLoan ? s.total : undefined, // Could fetch from actual loan record if needed
                                                        };

                                                        // If manual name exists, override customer name if it was a walk-in
                                                        if (s.manualCustomerName && !receiptData.customer) {
                                                            receiptData.customer = {
                                                                name: s.manualCustomerName,
                                                                phone: "N/A",
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
            </div>

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
    );
}

function DistributorValues({ selectedId, onSelect }: { selectedId: Id<"customers"> | undefined, onSelect: (id: Id<"customers"> | undefined) => void }) {
    const [open, setOpen] = useState(false);
    const customers = useQuery(api.customers.listAll);

    const selectedCustomer = customers?.find((c) => c._id === selectedId);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-[200px] justify-between bg-white font-normal text-sm"
                >
                    <span className="truncate">
                        {selectedCustomer ? selectedCustomer.name : "All Distributors"}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[200px] p-0">
                <Command>
                    <CommandInput placeholder="Search distributor..." />
                    <CommandList>
                        <CommandEmpty>No distributor found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="all"
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
                                        <span>{customer.name}</span>
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
    );
}
