"use client";

/**
 * SMART_BUZ — Expenditures.
 *
 * What the business spends money on. The screen is built from the shared
 * shell — header, figures, one table — so it sits next to the finance
 * screens instead of beside a different product.
 *
 * The figure the operator cares about is the total *for the period they
 * chose*, so the totals are read from the server's own statistics for that
 * same window rather than added up on the screen.
 */

import { useMemo, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from "@/components/ui/sheet";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Search, Calendar, Wallet, Receipt, Tags, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { format, startOfMonth, endOfMonth, endOfDay, startOfDay } from "date-fns";
import { DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/date-range-picker";
import { describeError } from "@/components/error-feedback";
import { useCurrency } from "@/hooks/use-currency";
import {
    PageContainer,
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
    Toolbar,
    ToolbarGroup,
    CountBadge,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import { ConfirmDeleteDialog, RecordActions } from "@/components/vertical/ui-kit";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { useT } from "@/i18n/provider";

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
    
    const tr = useT();const { currency } = useCurrency();
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

    // Deletion is confirmed, not assumed.
    const [pendingDeleteId, setPendingDeleteId] = useState<Id<"expenses"> | null>(null);

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

    // The search box is local, so the typing does not wait for the server.
    const debouncedSearch = useDebouncedValue(searchTerm, 200);

    const filteredExpenses = useMemo(() => {
        const rows = expenses || [];
        const term = debouncedSearch.trim().toLowerCase();
        return rows.filter((e: any) => {
            const matchesSearch =
                term === "" ||
                e.expense.toLowerCase().includes(term) ||
                e.receivedBy.toLowerCase().includes(term) ||
                e.type.toLowerCase().includes(term);
            const matchesType = filterType === "All" || e.type === filterType;
            return matchesSearch && matchesType;
        });
    }, [expenses, debouncedSearch, filterType]);

    const totalAmount = stats?.total || 0;
    const totalCount = stats?.count || 0;
    const categoryCount = Object.keys(stats?.byType || {}).length;

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
            // "Failed to save expense" tells the operator nothing about why
            // the server refused it, so the reason is carried through.
            toast.error(describeError(error, "The expense could not be saved."));
        }
    };

    const handleDelete = async () => {
        if (!user || !pendingDeleteId) return;
        try {
            await removeExpense({ id: pendingDeleteId, userId: user._id });
            toast.success("Expense deleted successfully");
            setPendingDeleteId(null);
        } catch (error) {
            console.error(error);
            toast.error(describeError(error, "The expense could not be deleted."));
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

    const columns: DataTableColumn<any>[] = [
        {
            id: "date",
            header: "Date",
            accessor: (row) => row.date,
            cell: (row) => (
                <span className="font-medium tabular-nums">
                    {format(new Date(row.date), "MMM dd, yyyy")}
                </span>
            ),
        },
        {
            id: "expense",
            header: "Expense",
            accessor: (row) => row.expense,
            cell: (row) => <span className="font-medium">{row.expense}</span>,
        },
        {
            id: "type",
            header: "Type",
            accessor: (row) => row.type,
            cell: (row) => <Badge variant="neutral">{row.type}</Badge>,
        },
        {
            id: "receivedBy",
            header: "Received by",
            accessor: (row) => row.receivedBy,
            hideBelow: "sm",
        },
        {
            id: "amount",
            header: `Amount (${currency})`,
            accessor: (row) => row.amount,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">
                    {row.amount.toLocaleString()}
                </span>
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            excludeFromSearch: true,
            cell: (row) => (
                <div className="flex justify-end">
                    <RecordActions
                        label={tr("Actions for {0}", {
            0: row.expense,
        })}
                        onView={() => openViewSheet(row._id)}
                        onEdit={() => openEditDialog(row)}
                        onDelete={() => setPendingDeleteId(row._id)}
                    />
                </div>
            ),
        },
    ];

    const periodLabel =
        dateMode === "audit"
            ? selectedDate
                ? format(selectedDate, "dd MMM yyyy")
                : "today"
            : date?.from
              ? `${format(date.from, "dd MMM yyyy")} – ${date.to ? format(date.to, "dd MMM yyyy") : "now"}`
              : "this month";

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Finance"
                title={tr("Expenditures")}
                description={tr("Every payment the business makes, what it was for and who received it.")}
                icon={Wallet}
                badge={<CountBadge tone="neutral">{totalCount}</CountBadge>}
                actions={
                    <>
                        <DataTableExport
                            title={tr("Expenditures")}
                            subtitle={periodLabel}
                            rows={filteredExpenses}
                            columns={columns}
                        />
                        <Button onClick={openAddDialog}>
                            <Plus className="mr-2 size-4" /> {tr("Add expense")}
                        </Button>
                    </>
                }
            />

            <StatGrid columns={3}>
                <StatCard
                    label={tr("Total expenditure")}
                    value={`${currency} ${totalAmount.toLocaleString()}`}
                    hint={tr("Spent in the period selected above")}
                    icon={Wallet}
                    tone="danger"
                    isLoading={stats === undefined}
                />
                <StatCard
                    label={tr("Transactions")}
                    value={totalCount}
                    hint={tr("Payment entries in the period")}
                    icon={Receipt}
                    tone="info"
                    isLoading={stats === undefined}
                />
                <StatCard
                    label={tr("Categories")}
                    value={categoryCount}
                    hint={tr("Different types of expense used")}
                    icon={Tags}
                    tone="default"
                    isLoading={stats === undefined}
                />
            </StatGrid>

            <SectionCard
                title={tr("Expense entries")}
                description={tr("Showing {0} of {1} entries for {2}.", {
            0: filteredExpenses.length,
            1: expenses?.length ?? 0,
            2: periodLabel,
        })}
                padded={false}
            >
                <div className="border-b border-border/60 p-4 sm:p-5">
                    <Toolbar>
                        <ToolbarGroup>
                            <Select value={dateMode} onValueChange={(v: any) => setDateMode(v)}>
                                <SelectTrigger className="h-9 w-[150px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="audit">{tr("Audit date")}</SelectItem>
                                    <SelectItem value="range">{tr("Date range")}</SelectItem>
                                </SelectContent>
                            </Select>

                            {dateMode === "audit" ? (
                                <div className="flex items-center gap-2">
                                    <Calendar className="size-4 text-muted-foreground" />
                                    <Input
                                        type="date"
                                        value={selectedDate ? selectedDate.toISOString().split("T")[0] : ""}
                                        onChange={(e) => setSelectedDate(e.target.value ? new Date(e.target.value) : undefined)}
                                        className="h-9 w-[160px]"
                                    />
                                </div>
                            ) : (
                                <DatePickerWithRange date={date} setDate={setDate} />
                            )}

                            <Select value={filterType} onValueChange={setFilterType}>
                                <SelectTrigger className="h-9 w-[180px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="All">{tr("All types")}</SelectItem>
                                    {EXPENSE_TYPES.map((t) => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </ToolbarGroup>

                        <div className="relative sm:w-72">
                            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder={tr("Search expenses…")}
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="h-9 pl-10"
                            />
                        </div>
                    </Toolbar>
                </div>

                <DataTable
                    data={filteredExpenses}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={expenses === undefined}
                    isEmpty={expenses !== undefined && filteredExpenses.length === 0}
                    emptyTitle={tr("No expenses for this period")}
                    emptyHint={tr("Change the date or the type filter, or record what the business has paid for.")}
                    emptyAction={
                        <Button variant="outline" size="sm" onClick={openAddDialog}>
                            <Plus className="mr-2 size-4" /> {tr("Add expense")}
                        </Button>
                    }
                    pageSize={25}
                    defaultSort={{ id: "date", direction: "desc" }}
                    ariaLabel="Expenditures"
                    className="px-4 pb-5 sm:px-5"
                />
            </SectionCard>

            {/* Add/Edit Dialog */}
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogContent className="sm:max-w-[500px]">
                    <DialogHeader>
                        <DialogTitle>{editingExpense ? "Edit expense" : "Add new expense"}</DialogTitle>
                        <DialogDescription>
                            {editingExpense ? "Update the expense details below." : "Enter the expense details below."}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label htmlFor="expense">{tr("Expense description *")}</Label>
                            <Input
                                id="expense"
                                placeholder={tr("e.g., Office rent for January")}
                                value={formData.expense}
                                onChange={(e) => setFormData({ ...formData, expense: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="amount">{tr("Amount (")}{currency}) *</Label>
                            <Input
                                id="amount"
                                type="number"
                                placeholder="0"
                                value={formData.amount}
                                onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="type">{tr("Expense type")}</Label>
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
                                    <Label htmlFor="customType">{tr("Specify type *")}</Label>
                                    <Input
                                        id="customType"
                                        placeholder={tr("e.g., Travel, Entertainment, etc.")}
                                        value={customType}
                                        onChange={(e) => setCustomType(e.target.value)}
                                    />
                                </div>
                            )}
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="receivedBy">{tr("Received by *")}</Label>
                            <Input
                                id="receivedBy"
                                placeholder={tr("e.g., John Doe")}
                                value={formData.receivedBy}
                                onChange={(e) => setFormData({ ...formData, receivedBy: e.target.value })}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="date">{tr("Date")}</Label>
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
                            {tr("Cancel")}
                        </Button>
                        <Button onClick={handleSave}>
                            {editingExpense ? "Update" : "Add"} expense
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Deletion is confirmed, and the confirmation names the thing. */}
            <ConfirmDeleteDialog
                open={pendingDeleteId !== null}
                onOpenChange={(v) => !v && setPendingDeleteId(null)}
                onConfirm={handleDelete}
                entityName="expense"
                description={tr("The payment record will be removed from the books. This cannot be undone.")}
            />

            {/* View Details Sheet */}
            <Sheet open={isViewSheetOpen} onOpenChange={setIsViewSheetOpen}>
                <SheetContent className="sm:max-w-[500px] overflow-y-auto p-6">
                    <SheetHeader>
                        <SheetTitle>{tr("Expense details")}</SheetTitle>
                        <SheetDescription>
                            {tr("Complete information about this expense record.")}
                        </SheetDescription>
                    </SheetHeader>
                    {expenseWithUser ? (
                        <div className="space-y-6 py-6">
                            <div className="space-y-4">
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{tr("Date")}</span>
                                    <span className="font-semibold">{format(new Date(expenseWithUser.date), "MMM dd, yyyy")}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{tr("Expense description")}</span>
                                    <span className="font-semibold">{expenseWithUser.expense}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{tr("Type")}</span>
                                    <Badge variant="neutral">{expenseWithUser.type}</Badge>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{tr("Amount")}</span>
                                    <span className="font-bold text-lg text-danger">{currency} {expenseWithUser.amount.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between pb-3 border-b">
                                    <span className="text-sm font-medium text-muted-foreground">{tr("Received by")}</span>
                                    <span className="font-semibold">{expenseWithUser.receivedBy}</span>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h3 className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">{tr("Recorded by")}</h3>
                                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                                    {expenseWithUser.user ? (
                                        <>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">{tr("Name")}</span>
                                                <span className="font-semibold capitalize">{expenseWithUser.user.first_name} {expenseWithUser.user.last_name}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">{tr("Email")}</span>
                                                <span className="font-semibold text-sm">{expenseWithUser.user.email}</span>
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <span className="text-sm text-muted-foreground">{tr("Role")}</span>
                                                <Badge className="capitalize">{expenseWithUser.user.roles?.[0] || "N/A"}</Badge>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="text-sm text-muted-foreground">{tr("User information not available")}</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="size-8 animate-spin text-muted-foreground" />
                        </div>
                    )}
                </SheetContent>
            </Sheet>
        </PageContainer>
    );
}
