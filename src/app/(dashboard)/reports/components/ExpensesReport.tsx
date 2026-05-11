"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import { format, subMonths } from "date-fns";
import { Search, Receipt, TrendingDown, PieChart, Eye } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ReportTable } from "./reports-table";
import { ReportFilters } from "./ReportFilters";
import { ReportSummary } from "./ReportSummary";
import { SearchableSelect } from "./SearchableSelect";
import { Id } from "../../../../../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";

export function ExpensesReport() {
    const [reportMode, setReportMode] = useState<"daily" | "range">("range");
    const [dateRange, setDateRange] = useState({
        from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
        to: format(new Date(), "yyyy-MM-dd")
    });

    const [selectedType, setSelectedType] = useState<string>("all");
    const [selectedUser, setSelectedUser] = useState<string>("all");
    const [search, setSearch] = useState("");

    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(20);

    // View Details state
    const [viewingExpense, setViewingExpense] = useState<any>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    const users = useQuery(api.users.listAll);

    const args = {
        startDate: dateRange.from,
        endDate: dateRange.to,
        type: selectedType === "all" ? undefined : selectedType,
        userId: !selectedUser || selectedUser === "all" ? undefined : (selectedUser as Id<"users">),
        search: search || undefined,
    };

    const expenses = useQuery(api.reports.getExpensesReport, args);
    const summary = useQuery(api.reports.getExpensesReportSummary, {
        startDate: dateRange.from,
        endDate: dateRange.to,
        type: selectedType === "all" ? undefined : selectedType,
    });

    const totalCount = expenses?.length || 0;

    const customStats = summary ? [
        {
            title: "Total Expenses",
            value: `UGX ${summary.totalExpenses.toLocaleString()}`,
            description: `${summary.expenseCount} TRANSACTIONS`,
            color: "border-l-red-500",
        },
        {
            title: "Avg Expense",
            value: `UGX ${Math.round(summary.avgExpense).toLocaleString()}`,
            description: "PER TRANSACTION",
            color: "border-l-blue-500",
        },
        {
            title: "Top Category",
            value: summary.categories[0]?.type || "N/A",
            description: `UGX ${(summary.categories[0]?.total || 0).toLocaleString()}`,
            color: "border-l-amber-500",
        },
        {
            title: "Categories",
            value: `${summary.categories.length}`,
            description: "DIFFERENT TYPES",
            color: "border-l-purple-500",
        },
    ] : undefined;

    // Get unique expense types for filter dropdown
    const expenseTypes = expenses ? [...new Set(expenses.map(e => e.type))].sort() : [];

    const handleViewDetails = (expense: any) => {
        setViewingExpense(expense);
        setIsViewSheetOpen(true);
    };

    return (
        <div className="space-y-4">
            <div className="bg-white p-4 rounded-xl border shadow-xs flex flex-wrap items-center gap-3">
                <ReportFilters
                    dateRange={dateRange}
                    reportMode={reportMode}
                    onDateRangeChange={setDateRange}
                    onReportModeChange={setReportMode}
                    onClearFilters={() => {
                        setDateRange({
                            from: format(subMonths(new Date(), 1), "yyyy-MM-dd"),
                            to: format(new Date(), "yyyy-MM-dd")
                        });
                        setSelectedType("all");
                        setSelectedUser("all");
                        setSearch("");
                    }}
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Categories" },
                        ...expenseTypes.map((t) => ({ value: t, label: t }))
                    ]}
                    value={selectedType}
                    onValueChange={setSelectedType}
                    placeholder="Category"
                    width="160px"
                />

                <SearchableSelect
                    options={[
                        { value: "all", label: "All Users" },
                        ...(users || []).map((u: any) => ({ value: u._id, label: `${u.first_name} ${u.last_name}` }))
                    ]}
                    value={selectedUser}
                    onValueChange={setSelectedUser}
                    placeholder="User"
                    width="180px"
                />

                <div className="relative flex-1 min-w-[200px]">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground opacity-50" />
                    <Input
                        placeholder="Search expense, category, or user..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="pl-9 h-10 text-xs border-input bg-background focus:bg-white transition-all shadow-sm"
                    />
                </div>
            </div>

            <ReportSummary customStats={customStats} isLoading={summary === undefined} />

            <ReportTable
                title="Expenses Report"
                subtitle="Detailed tracking of all expenses with category breakdown."
                data={expenses?.slice((page - 1) * rowsPerPage, page * rowsPerPage) || []}
                isLoading={expenses === undefined}
                onViewDetails={handleViewDetails}
                pagination={{
                    currentPage: page,
                    totalPages: Math.max(1, Math.ceil(totalCount / rowsPerPage)),
                    rowsPerPage: rowsPerPage,
                    onRowsPerPageChange: (rows) => {
                        setRowsPerPage(rows);
                        setPage(1);
                    },
                    totalItems: totalCount,
                    onNext: () => {
                        const totalPages = Math.ceil(totalCount / rowsPerPage);
                        if (page < totalPages) setPage(p => p + 1);
                    },
                    onPrev: () => setPage(p => Math.max(1, p - 1)),
                    canLoadMore: false,
                }}
                columns={[
                    {
                        header: "Date",
                        accessor: (e: any) => (
                            <div className="font-mono leading-tight">
                                <div className="font-black">{format(new Date(e.date), "dd MMM yyyy")}</div>
                            </div>
                        )
                    },
                    {
                        header: "Expense",
                        accessor: (e: any) => (
                            <div className="flex flex-col gap-0.5 min-w-[140px]">
                                <span className="font-black text-primary leading-none">{e.expense}</span>
                                <Badge variant="outline" className="text-[8px] uppercase font-black tracking-tighter px-1 h-3.5 w-fit mt-0.5">
                                    {e.type}
                                </Badge>
                            </div>
                        ),
                        exportValue: (e: any) => e.expense,
                    },
                    {
                        header: "Amount",
                        accessor: (e: any) => (
                            <span className="font-black text-red-600 text-sm">UGX {e.amount.toLocaleString()}</span>
                        ),
                        exportValue: (e: any) => e.amount.toLocaleString(),
                        className: "text-right",
                    },
                    {
                        header: "Recorded By",
                        accessor: (e: any) => (
                            <div className="flex flex-col gap-0.5">
                                <span className="text-[10px] font-bold capitalize text-muted-foreground">{e.userName}</span>
                                <span className="text-[9px] text-muted-foreground italic">{e.receivedBy}</span>
                            </div>
                        ),
                        exportValue: (e: any) => e.userName,
                    },
                ]}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[600px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>Expense Details</SheetTitle>
                        <SheetDescription>
                            Complete information about this expense record.
                        </SheetDescription>
                    </SheetHeader>
                    {viewingExpense ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Date</span>
                                    <span className="font-semibold">{format(new Date(viewingExpense.date), "dd MMM yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Amount</span>
                                    <span className="font-bold text-lg text-red-600">UGX {viewingExpense.amount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Category</span>
                                    <Badge variant="outline" className="text-xs uppercase font-black tracking-tighter">
                                        {viewingExpense.type}
                                    </Badge>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Expense Information</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Description</span>
                                        <span className="font-semibold text-sm text-right max-w-[200px]">{viewingExpense.expense}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Received By</span>
                                        <span className="font-semibold">{viewingExpense.receivedBy}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Recorded By</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm text-muted-foreground">Name</span>
                                        <span className="font-semibold capitalize">{viewingExpense.userName}</span>
                                    </div>
                                    {viewingExpense.userEmail && viewingExpense.userEmail !== "-" && (
                                        <div className="flex items-center justify-between">
                                            <span className="text-sm text-muted-foreground">Email</span>
                                            <span className="font-semibold text-sm">{viewingExpense.userEmail}</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
