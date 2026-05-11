"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import { Loader2, Plus, Trash2, Pencil, Search, Calendar, FileSpreadsheet, FileText, Eye } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, endOfDay, startOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { exportToExcel, exportToPDF, extractTextFromReact } from "@/lib/export-utils";

type ExpenseForm = {
    amount: string;
    expense: string;
    receivedBy: string;
    type: string;
    date: string;
};

const EXPENSE_TYPES = [
    "Rent",
    "Utilities",
    "Salaries",
    "Office Supplies",
    "Transportation",
    "Marketing",
    "Maintenance",
    "Training",
    "Miscellaneous",
    "Others",
];

export default function ExpendituresPage() {
    const { user } = useAuth();
    const [dateMode, setDateMode] = useState<"audit" | "range">("audit");
    const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date());
    const [date, setDate] = useState<DateRange | undefined>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    const [searchTerm, setSearchTerm] = useState("");
    const [filterType, setFilterType] = useState("All");

    // Dialog state
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingExpense, setEditingExpense] = useState<any | null>(null);
    const [customType, setCustomType] = useState("");
    const [formData, setFormData] = useState<ExpenseForm>({
        amount: "",
        expense: "",
        receivedBy: "",
        type: "Miscellaneous",
        date: new Date().toISOString().split("T")[0],
    });

    // View Details state
    const [viewingExpenseId, setViewingExpenseId] = useState<Id<"expenses"> | null>(null);
    const [isViewSheetOpen, setIsViewSheetOpen] = useState(false);

    // Query params
    const queryArgs = {
        from: dateMode === "audit" ? (selectedDate ? startOfDay(selectedDate).toISOString() : undefined) : date?.from?.toISOString(),
        to: dateMode === "audit" ? (selectedDate ? endOfDay(selectedDate).toISOString() : undefined) : date?.to?.toISOString(),
    };

    const expenses = useQuery(api.expenses.listByDateRange, queryArgs);
    const stats = useQuery(api.expenses.getStats, queryArgs);
    const expenseWithUser = useQuery(api.expenses.getExpenseWithUser, viewingExpenseId ? { id: viewingExpenseId } : "skip");

    const addExpense = useMutation(api.expenses.add);
    const updateExpense = useMutation(api.expenses.update);
    const removeExpense = useMutation(api.expenses.remove);

    // Filter expenses
    const filteredExpenses = (expenses || []).filter((e) => {
        const matchesSearch = searchTerm === "" || 
            e.expense.toLowerCase().includes(searchTerm.toLowerCase()) ||
            e.receivedBy.toLowerCase().includes(searchTerm.toLowerCase()) ||
            e.type.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesType = filterType === "All" || e.type === filterType;
        return matchesSearch && matchesType;
    });

    const totalAmount = stats?.total || 0;
    const totalCount = stats?.count || 0;

    const handleSave = async () => {
        if (!user) return;
        if (!formData.amount || !formData.expense || !formData.receivedBy) {
            toast.error("Please fill in all required fields");
            return;
        }

        const expenseType = formData.type === "Others" ? customType : formData.type;
        if (!expenseType) {
            toast.error("Please specify the expense type");
            return;
        }

        try {
            if (editingExpense) {
                await updateExpense({
                    id: editingExpense._id,
                    amount: parseFloat(formData.amount),
                    expense: formData.expense,
                    receivedBy: formData.receivedBy,
                    type: expenseType,
                    date: formData.date,
                    userId: user._id,
                });
                toast.success("Expense updated successfully");
            } else {
                await addExpense({
                    amount: parseFloat(formData.amount),
                    expense: formData.expense,
                    receivedBy: formData.receivedBy,
                    type: expenseType,
                    date: formData.date,
                    userId: user._id,
                });
                toast.success("Expense added successfully");
            }
            setIsDialogOpen(false);
            resetForm();
        } catch (error) {
            console.error(error);
            toast.error("Failed to save expense");
        }
    };

    const handleDelete = async (id: Id<"expenses">) => {
        if (!user) return;
        if (!confirm("Are you sure you want to delete this expense?")) return;

        try {
            await removeExpense({ id, userId: user._id });
            toast.success("Expense deleted successfully");
        } catch (error) {
            console.error(error);
            toast.error("Failed to delete expense");
        }
    };

    const openAddDialog = () => {
        setEditingExpense(null);
        setCustomType("");
        setFormData({
            amount: "",
            expense: "",
            receivedBy: "",
            type: "Miscellaneous",
            date: new Date().toISOString().split("T")[0],
        });
        setIsDialogOpen(true);
    };

    const openEditDialog = (expense: any) => {
        setEditingExpense(expense);
        const isCustomType = !EXPENSE_TYPES.includes(expense.type);
        setFormData({
            amount: String(expense.amount),
            expense: expense.expense,
            receivedBy: expense.receivedBy,
            type: isCustomType ? "Others" : expense.type,
            date: expense.date.split("T")[0],
        });
        setCustomType(isCustomType ? expense.type : "");
        setIsDialogOpen(true);
    };

    const openViewSheet = (expenseId: Id<"expenses">) => {
        setViewingExpenseId(expenseId);
        setIsViewSheetOpen(true);
    };

    const resetForm = () => {
        setFormData({
            amount: "",
            expense: "",
            receivedBy: "",
            type: "Miscellaneous",
            date: new Date().toISOString().split("T")[0],
        });
        setCustomType("");
        setEditingExpense(null);
    };

    // Export handlers
    const handleExportExcel = () => {
        const columns = [
            { header: "Date", accessor: (e: any) => format(new Date(e.date), "MMM dd, yyyy") },
            { header: "Expense", accessor: "expense" },
            { header: "Type", accessor: "type" },
            { header: "Received By", accessor: "receivedBy" },
            { header: "Amount (UGX)", accessor: (e: any) => e.amount.toLocaleString() },
        ];
        exportToExcel(filteredExpenses, columns, `Expenditures_${format(new Date(), "yyyy-MM-dd")}`);
    };

    const handleExportPDF = () => {
        const columns = [
            { header: "Date", accessor: (e: any) => format(new Date(e.date), "MMM dd, yyyy") },
            { header: "Expense", accessor: "expense" },
            { header: "Type", accessor: "type" },
            { header: "Received By", accessor: "receivedBy" },
            { header: "Amount (UGX)", accessor: (e: any) => e.amount.toLocaleString() },
        ];
        exportToPDF(filteredExpenses, columns, "Expenditures Report", `Expenditures_${format(new Date(), "yyyy-MM-dd")}`);
    };

    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-black tracking-tight">Expenditures</h1>
                <p className="text-muted-foreground">Track and manage all business expenses.</p>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-emerald-700 uppercase tracking-wider">Total Expenditure</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-emerald-600">UGX {totalAmount.toLocaleString()}</div>
                        <p className="text-[10px] text-emerald-600/70 mt-1">Total amount spent</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-blue-700 uppercase tracking-wider">Total Transactions</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">{totalCount}</div>
                        <p className="text-[10px] text-blue-600/70 mt-1">Number of expense entries</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-purple-700 uppercase tracking-wider">Categories</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-purple-600">{Object.keys(stats?.byType || {}).length}</div>
                        <p className="text-[10px] text-purple-600/70 mt-1">Expense types used</p>
                    </CardContent>
                </Card>
            </div>

            {/* Filters */}
            <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Date Mode:</Label>
                    <Select value={dateMode} onValueChange={(v: any) => setDateMode(v)}>
                        <SelectTrigger className="w-[140px] h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="audit">Audit Date</SelectItem>
                            <SelectItem value="range">Date Range</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {dateMode === "audit" ? (
                    <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <Input
                            type="date"
                            value={selectedDate ? selectedDate.toISOString().split("T")[0] : ""}
                            onChange={(e) => setSelectedDate(e.target.value ? new Date(e.target.value) : undefined)}
                            className="w-[160px] h-9"
                        />
                    </div>
                ) : (
                    <DatePickerWithRange date={date} setDate={setDate} />
                )}

                <div className="flex items-center gap-2">
                    <Label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Type:</Label>
                    <Select value={filterType} onValueChange={setFilterType}>
                        <SelectTrigger className="w-[180px] h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="All">All Types</SelectItem>
                            {EXPENSE_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>{t}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex-1 min-w-[200px]">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search expenses..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10 h-9"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-2 ml-auto">
                    <Button variant="outline" size="sm" onClick={handleExportExcel}>
                        <FileSpreadsheet className="h-4 w-4 mr-2" /> Excel
                    </Button>
                    <Button variant="outline" size="sm" onClick={handleExportPDF}>
                        <FileText className="h-4 w-4 mr-2" /> PDF
                    </Button>
                    <Button onClick={openAddDialog}>
                        <Plus className="h-4 w-4 mr-2" /> Add Expense
                    </Button>
                </div>
            </div>

            {/* Table */}
            <Card>
                <CardContent className="p-0">
                    {expenses === undefined ? (
                        <div className="flex items-center justify-center h-full">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : filteredExpenses.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            No expenses found for the selected criteria.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader className="sticky top-0 bg-background z-10">
                                <TableRow>
                                    <TableHead className="w-[150px]">Date</TableHead>
                                    <TableHead>Expense</TableHead>
                                    <TableHead>Type</TableHead>
                                    <TableHead>Received By</TableHead>
                                    <TableHead className="text-right">Amount (UGX)</TableHead>
                                    <TableHead className="w-[150px] text-center">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredExpenses.map((expense) => (
                                    <TableRow key={expense._id} className="hover:bg-muted/5">
                                        <TableCell className="font-mono text-xs">
                                            <div className="font-semibold">{format(new Date(expense.date), "MMM dd, yyyy")}</div>
                                        </TableCell>
                                        <TableCell className="font-medium">{expense.expense}</TableCell>
                                        <TableCell>
                                            <Badge variant="outline">{expense.type}</Badge>
                                        </TableCell>
                                        <TableCell className="text-sm">{expense.receivedBy}</TableCell>
                                        <TableCell className="text-right font-bold">
                                            {expense.amount.toLocaleString()}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center justify-center gap-1">
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => openViewSheet(expense._id)}
                                                >
                                                    <Eye className="h-4 w-4 text-green-600" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => openEditDialog(expense)}
                                                >
                                                    <Pencil className="h-4 w-4 text-blue-600" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    onClick={() => handleDelete(expense._id)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Add/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{editingExpense ? "Edit Expense" : "Add New Expense"}</DialogTitle>
                        <DialogDescription>
                            {editingExpense ? "Update the expense details below." : "Enter the expense details below."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="expense">Expense Description *</Label>
                            <Input
                                id="expense"
                                placeholder="e.g., Office rent for January"
                                value={formData.expense}
                                onChange={(e) => setFormData({ ...formData, expense: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="amount">Amount (UGX) *</Label>
                            <Input
                                id="amount"
                                type="number"
                                placeholder="0"
                                value={formData.amount}
                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="type">Expense Type</Label>
                            <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {EXPENSE_TYPES.map((t) => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {formData.type === "Others" && (
                                <div className="mt-2">
                                    <Label htmlFor="customType">Specify Type *</Label>
                                    <Input
                                        id="customType"
                                        placeholder="e.g., Travel, Entertainment, etc."
                                        value={customType}
                                        onChange={(e) => setCustomType(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="receivedBy">Received By *</Label>
                            <Input
                                id="receivedBy"
                                placeholder="e.g., John Doe"
                                value={formData.receivedBy}
                                onChange={(e) => setFormData({ ...formData, receivedBy: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="date">Date</Label>
                            <Input
                                id="date"
                                type="date"
                                value={formData.date}
                                onChange={(e) => setFormData({ ...formData, date: e.target.value })}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                            Cancel
                        </Button>
                        <Button onClick={handleSave}>
                            {editingExpense ? "Update" : "Add"} Expense
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[500px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>Expense Details</SheetTitle>
                        <SheetDescription>
                            Complete information about this expense record.
                        </SheetDescription>
                    </SheetHeader>
                    {expenseWithUser ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Date</span>
                                    <span className="font-semibold">{format(new Date(expenseWithUser.date), "MMM dd, yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Expense Description</span>
                                    <span className="font-semibold">{expenseWithUser.expense}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Type</span>
                                    <Badge variant="outline">{expenseWithUser.type}</Badge>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Amount</span>
                                    <span className="font-bold text-lg text-emerald-600">UGX {expenseWithUser.amount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">Received By</span>
                                    <span className="font-semibold">{expenseWithUser.receivedBy}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-sm font-bold text-muted-foreground uppercase tracking-wider">Recorded By</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    {expenseWithUser.user ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Name</span>
                                                <span className="font-semibold capitalize">{expenseWithUser.user.first_name} {expenseWithUser.user.last_name}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Email</span>
                                                <span className="font-semibold text-sm">{expenseWithUser.user.email}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">Role</span>
                                                <Badge className="capitalize">{expenseWithUser.user.roles?.[0] || "N/A"}</Badge>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">User information not available</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}
