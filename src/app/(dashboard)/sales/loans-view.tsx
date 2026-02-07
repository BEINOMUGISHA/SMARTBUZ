"use client";

import { useState, useEffect } from "react";
import { useQuery, usePaginatedQuery, useMutation } from "convex/react";
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
    MoreVertical,
    CreditCard,
    History,
    Printer,
    Banknote,
    Calendar as CalendarIcon,
    FileSpreadsheet,
    FileText
} from "lucide-react";
import { exportToExcel, exportToPDF, extractTextFromReact } from "@/lib/export-utils";
import { startOfMonth, endOfDay, startOfDay, format } from "date-fns";
import { DateRange } from "react-day-picker";
import { Calendar } from "@/components/ui/calendar";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn, formatError } from "@/lib/utils";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { ReceiptModal } from "@/components/ReceiptModal";
import { ReceiptData } from "@/components/ReceiptTemplate";

export function LoansView() {
    const { user } = useAuth();
    const [dateMode, setDateMode] = useState<"audit" | "range">("audit");
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [dateRange, setDateRange] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    const [clientType, setClientType] = useState("All");
    const [selectedCustomerId, setSelectedCustomerId] = useState<Id<"customers"> | undefined>(undefined);
    const [searchTerm, setSearchTerm] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Modals
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState<any>(null);
    const [paymentAmount, setPaymentAmount] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Receipt for payment
    const [printReceiptData, setPrintReceiptData] = useState<ReceiptData | null>(null);
    const [isReceiptOpen, setIsReceiptOpen] = useState(false);

    // Backend Hooks
    const queryArgs = {
        from: dateMode === "audit"
            ? (selectedDate ? startOfDay(selectedDate).toISOString() : undefined)
            : (dateRange?.from ? startOfDay(dateRange.from).toISOString() : undefined),
        to: dateMode === "audit"
            ? (selectedDate ? endOfDay(selectedDate).toISOString() : undefined)
            : (dateRange?.to ? endOfDay(dateRange.to).toISOString() : undefined),
        email: user?.email || undefined,
        customerId: selectedCustomerId,
        searchTerm,
        clientType,
    };

    const stats = useQuery(api.loans.getLoanStats, queryArgs);
    const totalItems = useQuery(api.loans.getLoansCount, queryArgs) || 0;
    const { results, status, loadMore } = usePaginatedQuery(
        api.loans.getLoans,
        queryArgs,
        { initialNumItems: rowsPerPage }
    );

    const makePayment = useMutation(api.loans.makePayment);

    // Sync Load
    useEffect(() => {
        if (status === "CanLoadMore" && results && results.length < rowsPerPage) {
            loadMore(rowsPerPage - results.length);
        }
    }, [rowsPerPage, results, status, loadMore]);

    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    const currentView = results?.slice(startIndex, startIndex + rowsPerPage) || [];
    const totalPages = Math.ceil(totalItems / rowsPerPage);

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            const nextPageIndex = startIndex + rowsPerPage;
            if (nextPageIndex >= (results?.length || 0) && status === "CanLoadMore") {
                loadMore(rowsPerPage);
            }
            setCurrentPage(p => p + 1);
        }
    };

    const handlePayment = async () => {
        if (!selectedLoan || !paymentAmount) return;
        const amount = parseInt(paymentAmount.replace(/,/g, ""));
        if (isNaN(amount) || amount <= 0) {
            toast.error("Valid amount required");
            return;
        }
        if (amount > selectedLoan.balance) {
            toast.error("Amount exceeds balance");
            return;
        }

        try {
            setIsSubmitting(true);
            await makePayment({
                loanId: selectedLoan._id,
                amount,
                date: new Date().toISOString(),
            });

            toast.success("Payment recorded successfully");

            // Prepare Receipt Data
            // We need sale details for the receipt. selectedLoan.sale should have it from backend enrichment.
            if (selectedLoan.sale) {
                const s = selectedLoan.sale;
                const receipt: ReceiptData = {
                    customer: selectedLoan.customer ? {
                        name: selectedLoan.customer.name,
                        phone: selectedLoan.customer.phone,
                        email: selectedLoan.customer.email || "",
                        distributorId: selectedLoan.customer.distributorId,
                    } : {
                        name: selectedLoan.manualCustomerName || "Walk-in",
                        phone: "",
                        email: ""
                    },
                    shop: {
                        name: s.shop?.name || "HQ",
                        location: s.shop?.location || "Main Warehouse",
                        contact: s.shop?.contact || "",
                        serialNumber: s.shop?.serialNumber || "HQ-001",
                    },
                    operator: { name: user?.first_name || "Operator" },
                    clientType: s.clientType,
                    paymentMode: "Loan Payment",
                    date: new Date().toISOString(),
                    invoiceNumber: s._id.slice(0, 8).toUpperCase(),
                    items: [{ name: "Loan Installment Payment", price: amount, qty: 1, productCode: "PAY" }],
                    total: amount,
                    totalPV: 0,
                    totalBV: 0,
                    balance: selectedLoan.balance - amount // New balance
                };
                setPrintReceiptData(receipt);
                setIsReceiptOpen(true);
            }

            setIsPaymentModalOpen(false);
            setPaymentAmount("");
        } catch (e) {
            toast.error(formatError(e));
        } finally {
            setIsSubmitting(false);
        }
    };

    const fmt = (n: number) => n?.toLocaleString() ?? "0";

    const columns = [
        {
            header: "Date",
            accessor: (l: any) => format(new Date(l.date || l._creationTime), "dd MMM yyyy"),
            exportValue: (l: any) => format(new Date(l.date || l._creationTime), "dd/MM/yyyy")
        },
        {
            header: "Customer",
            accessor: (l: any) => l.customer?.name || l.manualCustomerName || "Unknown"
        },
        {
            header: "Items Sold",
            accessor: (l: any) => l.sale?.items.map((i: any) => `${i.quantity}x ${i.name}`).join(", ") || "N/A",
            exportValue: (l: any) => l.sale?.items.map((i: any) => `${i.quantity}x ${i.name}`).join("\n") || ""
        },
        {
            header: "Total PV",
            accessor: (l: any) => l.sale?.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0) || 0,
        },
        {
            header: "Loan Amount",
            accessor: (l: any) => l.amount,
            exportValue: (l: any) => l.amount.toLocaleString()
        },
        {
            header: "Paid",
            accessor: (l: any) => l.amount - l.balance,
            exportValue: (l: any) => (l.amount - l.balance).toLocaleString()
        },
        {
            header: "Balance",
            accessor: (l: any) => l.balance,
            exportValue: (l: any) => l.balance.toLocaleString()
        },
        {
            header: "Status",
            accessor: (l: any) => l.balance === 0 ? "Cleared" : "Pending"
        }
    ];

    const handlePrint = () => {
        const style = document.createElement('style');
        style.id = 'print-style-temp';
        style.innerHTML = `
            @media print {
                body * { visibility: hidden !important; }
                #loans-report-print, #loans-report-print * { visibility: visible !important; }
                #loans-report-print { 
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
                            <DatePickerWithRange date={dateRange} setDate={setDateRange} />
                        )}
                    </div>

                    <div className="h-6 w-px bg-border mx-1 hidden lg:block" />

                    <div className="flex items-center gap-2">
                        <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Type:</Label>
                        <Select value={clientType} onValueChange={setClientType}>
                            <SelectTrigger className="w-[120px] bg-white h-9">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="All">All Types</SelectItem>
                                <SelectItem value="Regular">Regular</SelectItem>
                                <SelectItem value="HP">HP Client</SelectItem>
                                <SelectItem value="Walk-in">Walk-in</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="h-6 w-px bg-border mx-1 hidden lg:block" />

                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search customer, code, or operator..."
                            className="pl-9 bg-white h-9 border-input focus:ring-primary shadow-none"
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    <div className="h-6 w-px bg-border mx-1 hidden xl:block" />

                    <DistributorDropdown selectedId={selectedCustomerId} onSelect={setSelectedCustomerId} />

                    <div className="flex items-center gap-2 ml-auto">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => exportToExcel(results || [], columns as any, "Loans_Report")}
                            className="h-9 px-3 gap-2 text-[10px] font-black uppercase border-emerald-600/20 text-emerald-700 hover:bg-emerald-50 bg-white"
                        >
                            <FileSpreadsheet className="h-3.5 w-3.5" /> Excel
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={async () => {
                                const summaryStats = [
                                    { title: "Total Loans", value: `UGX ${fmt(stats?.totalLoan || 0)}`, description: "Issued credit" },
                                    { title: "Total Paid", value: `UGX ${fmt(stats?.totalPaid || 0)}`, description: "Recovered amount" },
                                    { title: "Outstanding", value: `UGX ${fmt(stats?.totalBalance || 0)}`, description: "Awaiting recovery" }
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

                                exportToPDF(results || [], columns as any, "Loans_Report", "Loans Report", summaryStats, logoBase64);
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

                {/* Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className="bg-orange-50 border-orange-200 shadow-sm">
                        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-orange-600">Total Loans</CardTitle></CardHeader>
                        <CardContent><div className="text-2xl font-black text-orange-700">UGX {fmt(stats?.totalLoan || 0)}</div></CardContent>
                    </Card>
                    <Card className="bg-green-50 border-green-200">
                        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-green-600">Total Paid</CardTitle></CardHeader>
                        <CardContent><div className="text-2xl font-black text-green-700">UGX {fmt(stats?.totalPaid || 0)}</div></CardContent>
                    </Card>
                    <Card className="bg-destructive/5 border-destructive/20">
                        <CardHeader className="pb-2"><CardTitle className="text-xs font-bold uppercase tracking-wider text-destructive">Outstanding Balance</CardTitle></CardHeader>
                        <CardContent><div className="text-2xl font-black text-destructive">UGX {fmt(stats?.totalBalance || 0)}</div></CardContent>
                    </Card>
                </div>

                {/* Table */}
                <div className="flex-1 border rounded-md overflow-hidden bg-background flex flex-col">
                    <div className="flex-1 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead className="w-[120px]">Date</TableHead>
                                    <TableHead>Customer / Daily Audit</TableHead>
                                    <TableHead className="w-[30%]">Items (Qty x Name [PV/BV])</TableHead>
                                    <TableHead className="text-right">Total PV/BV</TableHead>
                                    <TableHead className="text-right">Loan Amount</TableHead>
                                    <TableHead className="text-right">Paid</TableHead>
                                    <TableHead className="text-right">Balance</TableHead>
                                    <TableHead className="text-center">Status</TableHead>
                                    <TableHead className="w-[50px]"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {!results ? (
                                    <TableRow><TableCell colSpan={9} className="h-40 text-center"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                                ) : results.length === 0 ? (
                                    <TableRow><TableCell colSpan={9} className="h-40 text-center text-muted-foreground">No loans found.</TableCell></TableRow>
                                ) : (
                                    currentView.map((loan: any) => {
                                        const totalPV = loan.sale?.items.reduce((sum: number, i: any) => sum + (i.pv * i.quantity), 0) || 0;
                                        const totalBV = loan.sale?.items.reduce((sum: number, i: any) => sum + (i.bv * i.quantity), 0) || 0;

                                        return (
                                            <TableRow key={loan._id} className="hover:bg-muted/5 group">
                                                <TableCell className="text-xs font-mono">
                                                    <div className="font-semibold">{new Date(loan.date || loan._creationTime).toLocaleDateString()}</div>
                                                    <div className="text-[10px] text-muted-foreground">{new Date(loan.date || loan._creationTime).toLocaleTimeString()}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold">{loan.customer?.name || loan.manualCustomerName || "Unknown"}</span>
                                                            <span className="text-[10px] text-muted-foreground">{loan.customer?.phone || "No Contact"}</span>
                                                        </div>
                                                        <div className="flex gap-1 flex-wrap">
                                                            <Badge variant={loan.sale?.clientType === "HP Client" ? "secondary" : "outline"} className="text-[10px]">
                                                                {loan.sale?.clientType || "Retail"}
                                                            </Badge>
                                                            {loan.sale?.operator && (
                                                                <Badge variant="outline" className="text-[10px] bg-blue-50/50 border-blue-200 text-blue-700">
                                                                    Op: {loan.sale.operator.name}
                                                                </Badge>
                                                            )}
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="max-w-[300px]">
                                                    <div className="flex flex-col gap-1">
                                                        {loan.sale?.items.map((i: any, idx: number) => (
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
                                                <TableCell className="text-right font-mono text-xs">{fmt(loan.amount)}</TableCell>
                                                <TableCell className="text-right font-mono text-xs text-green-600">{fmt(loan.amount - loan.balance)}</TableCell>
                                                <TableCell className="text-right font-bold text-destructive">{fmt(loan.balance)}</TableCell>
                                                <TableCell className="text-center">
                                                    {loan.balance === 0 ? (
                                                        <Badge className="bg-green-600 uppercase text-[10px]">Cleared</Badge>
                                                    ) : (
                                                        <Badge variant="destructive" className="uppercase text-[10px]">Pending</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="icon" className="h-8 w-8"><MoreVertical className="h-4 w-4" /></Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => { setSelectedLoan(loan); setIsPaymentModalOpen(true); }} disabled={loan.balance === 0}>
                                                                <Banknote className="mr-2 h-4 w-4" /> Pay Debt
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => { setSelectedLoan(loan); setIsHistoryModalOpen(true); }}>
                                                                <History className="mr-2 h-4 w-4" /> Installments
                                                            </DropdownMenuItem>
                                                            <DropdownMenuItem onClick={() => { /* Print logic */ }}>
                                                                <Printer className="mr-2 h-4 w-4" /> Print Statement
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-end px-4 py-3 border-t bg-muted/20 gap-2">
                        <div className="text-xs font-medium mr-auto">
                            {Math.min(startIndex + 1, totalItems)}-{Math.min(endIndex, totalItems)} of {totalItems}
                        </div>
                        <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                        <Button variant="outline" size="sm" disabled={currentPage >= totalPages && status !== "CanLoadMore"} onClick={handleNextPage}><ChevronRight className="h-4 w-4" /></Button>
                    </div>
                </div>

                {/* Modals */}
                <PaymentModal
                    isOpen={isPaymentModalOpen}
                    onClose={() => setIsPaymentModalOpen(false)}
                    loan={selectedLoan}
                    amount={paymentAmount}
                    setAmount={setPaymentAmount}
                    onConfirm={handlePayment}
                    isLoading={isSubmitting}
                />

                <HistoryModal
                    isOpen={isHistoryModalOpen}
                    onClose={() => setIsHistoryModalOpen(false)}
                    loan={selectedLoan}
                />

                {printReceiptData && (
                    <ReceiptModal
                        isOpen={isReceiptOpen}
                        onClose={() => setIsReceiptOpen(false)}
                        data={printReceiptData}
                    />
                )}
            </div>

            {/* HIDDEN PRINT CONTENT */}
            <div id="loans-report-print" className="hidden print:report-print-view bg-white text-black p-4 min-h-screen report-print-view">
                <div className="pb-6 border-b-2 border-emerald-600 mb-6 font-sans relative">
                    <div className="text-center px-20">
                        <h2 className="text-3xl font-black text-emerald-800 tracking-tight uppercase mb-1">TIENS HEALTH PRODUCTS</h2>
                        <p className="text-[11px] leading-tight font-bold text-gray-600">6th Floor, King Fahd Plaza, Plot 52 Kampala Rd</p>
                        <p className="text-[11px] font-bold text-gray-500">P.O.Box .... Kampala, Tel: +256 (0) 702 794 458 | 0773 662 136</p>
                        <div className="mt-2 inline-block px-4 py-1 bg-emerald-600 text-white text-[10px] font-black uppercase tracking-widest rounded-full">
                            OFFICIAL LOANS REPORT
                        </div>
                    </div>
                    <div className="absolute right-0 top-0 h-full flex items-start pt-1">
                        <img src="/logo.ico" alt="Logo" className="h-20 w-20 object-contain" />
                    </div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-4 border-b border-gray-100 pb-4">
                    <div className="flex flex-col pl-4 border-l border-gray-100 first:pl-0 first:border-0">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">TOTAL LOANS</p>
                        <p className="text-xs font-black text-black">UGX {fmt(stats?.totalLoan || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Issued credit</p>
                    </div>
                    <div className="flex flex-col pl-4 border-l border-gray-100">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">TOTAL PAID</p>
                        <p className="text-xs font-black text-black">UGX {fmt(stats?.totalPaid || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Recovered amount</p>
                    </div>
                    <div className="flex flex-col pl-4 border-l border-gray-100">
                        <p className="text-[9px] font-black text-[#008542] uppercase tracking-tighter">OUTSTANDING</p>
                        <p className="text-xs font-black text-black">UGX {fmt(stats?.totalBalance || 0)}</p>
                        <p className="text-[7px] font-bold text-gray-400 italic font-mono">Awaiting recovery</p>
                    </div>
                </div>

                <div className="mb-4">
                    <h3 className="text-lg font-black text-gray-900 uppercase tracking-tight">Loan Records</h3>
                    <p className="text-[10px] font-bold text-gray-500 uppercase mt-0.5 tracking-wide">
                        {dateMode === "audit" ? `Audit Date: ${format(selectedDate || new Date(), "PPP")}` : `Range: ${format(dateRange?.from || new Date(), "PP")} - ${format(dateRange?.to || new Date(), "PP")}`}
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
            </div>
        </>
    );
}

function PaymentModal({ isOpen, onClose, loan, amount, setAmount, onConfirm, isLoading }: any) {
    if (!loan) return null;
    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>Record Payment</DialogTitle>
                    <DialogDescription>Apply payment to {loan.customer?.name || loan.manualCustomerName}'s debt.</DialogDescription>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="flex justify-between items-center text-sm p-3 bg-muted rounded-lg border">
                        <span className="font-medium text-muted-foreground">Outstanding Balance:</span>
                        <span className="font-bold text-destructive">UGX {loan.balance.toLocaleString()}</span>
                    </div>
                    <div className="space-y-2">
                        <Label>Payment Amount (UGX)</Label>
                        <Input
                            autoFocus
                            placeholder="Enter amount"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            className="text-lg font-bold"
                        />
                    </div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isLoading}>Cancel</Button>
                    <Button onClick={onConfirm} disabled={isLoading} className="bg-primary hover:bg-primary/90">
                        {isLoading ? <Loader2 className="animate-spin mr-2 h-4 w-4" /> : <Banknote className="mr-2 h-4 w-4" />}
                        Confirm Payment
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function HistoryModal({ isOpen, onClose, loan }: any) {
    const history = useQuery(api.loans.getLoanPayments, loan ? { loanId: loan._id } : "skip" as any);
    if (!loan) return null;

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Installment History</DialogTitle>
                    <DialogDescription>Payment logs for {loan.customer?.name || loan.manualCustomerName}</DialogDescription>
                </DialogHeader>
                <div className="max-h-[300px] overflow-auto border rounded-xl my-4">
                    <Table>
                        <TableHeader className="bg-muted/50">
                            <TableRow>
                                <TableHead className="text-xs">Date</TableHead>
                                <TableHead className="text-right text-xs">Amount</TableHead>
                                <TableHead className="text-right text-xs">New Balance</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {!history ? (
                                <TableRow><TableCell colSpan={3} className="h-20 text-center"><Loader2 className="animate-spin mx-auto" /></TableCell></TableRow>
                            ) : history.length === 0 ? (
                                <TableRow><TableCell colSpan={3} className="h-20 text-center text-muted-foreground">No payments recorded yet.</TableCell></TableRow>
                            ) : (
                                history.map((p: any) => (
                                    <TableRow key={p._id}>
                                        <TableCell className="text-xs font-mono">{new Date(p.date).toLocaleString()}</TableCell>
                                        <TableCell className="text-right font-bold text-green-600 text-xs">{p.amount.toLocaleString()}</TableCell>
                                        <TableCell className="text-right font-mono text-xs">{p.balance.toLocaleString()}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </div>
                <div className="flex justify-between items-center bg-destructive/5 p-3 rounded-lg border border-destructive/10">
                    <span className="text-sm font-semibold">Current Balance:</span>
                    <span className="text-lg font-black text-destructive">UGX {loan.balance.toLocaleString()}</span>
                </div>
                <DialogFooter>
                    <Button onClick={onClose}>Close</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

function DistributorDropdown({ selectedId, onSelect }: any) {
    const [open, setOpen] = useState(false);
    const customers = useQuery(api.customers.listAll);
    const selected = customers?.find(c => c._id === selectedId);

    return (
        <div className="flex items-center gap-2">
            <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider whitespace-nowrap">Distributor:</Label>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button variant="outline" className="w-[180px] justify-between bg-white font-normal h-9">
                        <span className="truncate">{selected ? selected.name : "All Distributors"}</span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0">
                    <Command>
                        <CommandInput placeholder="Search..." />
                        <CommandList>
                            <CommandEmpty>Not found</CommandEmpty>
                            <CommandGroup>
                                <CommandItem onSelect={() => { onSelect(undefined); setOpen(false); }}>
                                    <Check className={cn("mr-2 h-4 w-4", !selectedId ? "opacity-100" : "opacity-0")} />
                                    All Distributors
                                </CommandItem>
                                {customers?.map(c => (
                                    <CommandItem key={c._id} onSelect={() => { onSelect(c._id); setOpen(false); }} value={`${c.name} ${c.distributorId || ""}`}>
                                        <Check className={cn("mr-2 h-4 w-4", selectedId === c._id ? "opacity-100" : "opacity-0")} />
                                        <div className="flex flex-col">
                                            <span className="font-medium">{c.name}</span>
                                            {c.distributorId && <span className="text-[10px] text-muted-foreground">ID: {c.distributorId}</span>}
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
