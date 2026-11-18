"use client";

/**
 * SMARTBUZ — Finance.
 *
 * The cash side of the business: the till and the shifts that run it, money
 * in and out of the drawer, income that is not a sale, the running costs,
 * and the reconciliation of what a provider says against what the books
 * recorded.
 *
 * Every figure on this page is computed by the backend from the
 * transaction and ledger records. Nothing here is a sample number, and
 * nothing here is typed in by the browser and trusted.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    LoadingState,
    EmptyState,
    FormDialog,
    CreateButton,
    RecordList,
    ugx,
    shortDate,
} from "@/components/vertical/ui-kit";
import {
    FinanceFilterBar,
    type FinanceFilters,
} from "@/components/finance/report-filters";
import { ExportMenu } from "@/components/finance/export-menu";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Wallet,
    Landmark,
    ArrowDownLeft,
    ArrowUpRight,
    Coins,
    Scale,
    Receipt,
    Banknote,
    AlertTriangle,
    RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import type { ExportColumn } from "@/lib/export";
import { number } from "@/lib/export";
/** The first day of this month — the default period for the reports. */
function startOfMonth(): string {
    return new Date().toISOString().slice(0, 8) + "01";
}

function today(): string {
    return new Date().toISOString().slice(0, 10);
}

const DEFAULT_FILTERS: FinanceFilters = {
    from: startOfMonth(),
    to: today(),
};

export default function FinancePage() {
    const { can } = useAuth();
    const [tab, setTab] = useState("overview");
    const [filters, setFilters] = useState<FinanceFilters>(DEFAULT_FILTERS);

    const canSeeReports = can("finance.reports.view");
    const canManageShifts = can("finance.cash.shift.manage");
    const canManageCash = can("finance.cash.manage");
    const canRecordIncome = can("finance.income.create");
    const canReconcile = can("finance.reconcile.manage");

    const summary = useQuery(
        api.finance.getFinancialSummary,
        canSeeReports ? { from: filters.from, to: filters.to, branchId: filters.branchId } : "skip"
    );

    const drawer = useQuery(
        api.finance.getCashDrawer,
        canManageShifts
            ? { from: filters.from, to: filters.to, branchId: filters.branchId }
            : "skip"
    );

    if (!canSeeReports && !canManageShifts && !canManageCash && !canRecordIncome && !canReconcile) {
        return (
            <div className="space-y-6">
                <VerticalPageHeader
                    icon={Wallet}
                    title="Finance"
                    description="The till, the cash book and the running costs of the business."
                />
                <EmptyState
                    title="Finance is not available to your role"
                    hint="Ask an administrator if you need to work with the cash drawer, the shifts or the books."
                />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Wallet}
                title="Finance"
                description="The till, the cash book and the running costs of the business."
            />

            <FinanceFilterBar
                filters={filters}
                onChange={setFilters}
                onReset={() => setFilters(DEFAULT_FILTERS)}
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {canSeeReports && (
                        <TabsTrigger value="overview" className="rounded-lg text-sm font-bold">
                            Overview
                        </TabsTrigger>
                    )}
                    {canManageShifts && (
                        <TabsTrigger value="till" className="rounded-lg text-sm font-bold">
                            Till &amp; shifts
                        </TabsTrigger>
                    )}
                    {canManageCash && (
                        <TabsTrigger value="cash" className="rounded-lg text-sm font-bold">
                            Cash in / out
                        </TabsTrigger>
                    )}
                    {canRecordIncome && (
                        <TabsTrigger value="income" className="rounded-lg text-sm font-bold">
                            Income
                        </TabsTrigger>
                    )}
                    {canSeeReports && (
                        <TabsTrigger value="expenses" className="rounded-lg text-sm font-bold">
                            Expenses
                        </TabsTrigger>
                    )}
                    {canReconcile && (
                        <TabsTrigger value="reconciliation" className="rounded-lg text-sm font-bold">
                            Reconciliation
                        </TabsTrigger>
                    )}
                </TabsList>

                {canSeeReports && (
                    <TabsContent value="overview" className="mt-4 space-y-4">
                        <OverviewTab summary={summary} />
                    </TabsContent>
                )}

                {canManageShifts && (
                    <TabsContent value="till" className="mt-4 space-y-4">
                        <TillTab drawer={drawer} filters={filters} />
                    </TabsContent>
                )}

                {canManageCash && (
                    <TabsContent value="cash" className="mt-4 space-y-4">
                        <CashTab filters={filters} />
                    </TabsContent>
                )}

                {canRecordIncome && (
                    <TabsContent value="income" className="mt-4 space-y-4">
                        <IncomeTab filters={filters} />
                    </TabsContent>
                )}

                {canSeeReports && (
                    <TabsContent value="expenses" className="mt-4 space-y-4">
                        <ExpensesTab filters={filters} />
                    </TabsContent>
                )}

                {canReconcile && (
                    <TabsContent value="reconciliation" className="mt-4 space-y-4">
                        <ReconciliationTab />
                    </TabsContent>
                )}
            </Tabs>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Overview
 * ──────────────────────────────────────────────────────────────────────── */

function OverviewTab({ summary }: { summary: any }) {
    if (!summary) return <LoadingState />;

    const expenseColumns: ExportColumn[] = [
        { header: "Type", key: "type" },
        { header: "Amount", key: "total", format: (v) => number(v) },
        { header: "Entries", key: "count" },
    ];

    return (
        <div className="space-y-4">
            <StatStrip
                stats={[
                    { label: "Revenue", value: ugx(summary.revenue) },
                    {
                        label: "Gross profit",
                        value: ugx(summary.grossProfit),
                        tone: summary.grossProfit >= 0 ? "good" : "danger",
                    },
                    { label: "Running costs", value: ugx(summary.operatingExpenses) },
                    {
                        label: "Net profit",
                        value: ugx(summary.netProfit),
                        tone: summary.netProfit >= 0 ? "good" : "danger",
                    },
                ]}
            />

            <StatStrip
                stats={[
                    {
                        label: "Owed by customers",
                        value: ugx(summary.receivables),
                        tone: summary.receivables > 0 ? "warn" : "default",
                    },
                    {
                        label: "Owed to suppliers",
                        value: ugx(summary.payables),
                        tone: summary.payables > 0 ? "warn" : "default",
                    },
                    { label: "Other income", value: ugx(summary.otherIncome) },
                    { label: "Transactions", value: String(summary.transactions) },
                ]}
            />

            <div className="grid gap-4 lg:grid-cols-2">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Receipt className="h-4 w-4 text-muted-foreground" />
                            Running costs by type
                        </CardTitle>
                        <ExportMenu
                            title="expenses-by-type"
                            rows={summary.expensesByType as any[]}
                            columns={expenseColumns}
                        />
                    </CardHeader>
                    <CardContent>
                        {summary.expensesByType.length === 0 ? (
                            <p className="py-6 text-center text-sm text-muted-foreground">
                                No running costs recorded in this period.
                            </p>
                        ) : (
                            <ul className="divide-y">
                                {summary.expensesByType.map((row: any) => (
                                    <li
                                        key={row.type}
                                        className="flex items-center justify-between py-2 text-sm"
                                    >
                                        <span className="font-medium">{row.type}</span>
                                        <span className="flex items-center gap-3">
                                            <Badge variant="secondary" className="text-[10px]">
                                                {row.count} item(s)
                                            </Badge>
                                            <span className="font-black tabular-nums">
                                                {ugx(row.total)}
                                            </span>
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Scale className="h-4 w-4 text-muted-foreground" />
                            How the money came in
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Row
                            label="Cash"
                            value={ugx(summary.cashRevenue)}
                        />
                        <Row
                            label="Card and transfer"
                            value={ugx(summary.otherRevenue)}
                        />
                        <Row
                            label="Sold on credit"
                            value={ugx(summary.creditRevenue)}
                            hint={`${summary.creditTransactions} sale(s) on credit`}
                        />
                        <div className="border-t pt-3">
                            <Row label="Cost of the goods sold" value={ugx(summary.costOfGoodsSold)} />
                            <Row label="Gross profit" value={ugx(summary.grossProfit)} />
                            <Row label="Other income" value={ugx(summary.otherIncome)} />
                            <Row label="Running costs" value={`− ${ugx(summary.operatingExpenses)}`} />
                            <div className="mt-2 flex items-center justify-between border-t pt-2 text-base">
                                <span className="font-black">Net profit</span>
                                <span
                                    className={`font-black tabular-nums ${
                                        summary.netProfit >= 0
                                            ? "text-emerald-600 dark:text-emerald-400"
                                            : "text-destructive"
                                    }`}
                                >
                                    {ugx(summary.netProfit)}
                                </span>
                            </div>
                            <p className="text-[10px] text-muted-foreground">
                                Gross margin {summary.grossMargin.toFixed(1)}% · net margin{" "}
                                {summary.netMargin.toFixed(1)}%
                            </p>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function Row({
    label,
    value,
    hint,
}: {
    label: string;
    value: string;
    hint?: string;
}) {
    return (
        <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
                {label}
                {hint && <span className="ml-1 text-[10px]">({hint})</span>}
            </span>
            <span className="font-bold tabular-nums">{value}</span>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Till and shifts
 * ──────────────────────────────────────────────────────────────────────── */

function TillTab({
    drawer,
    filters,
}: {
    drawer: any;
    filters: FinanceFilters;
}) {
    const { can } = useAuth();
    const [openShift, setOpenShift] = useState(false);
    const [closeShift, setCloseShift] = useState<any>(null);

    const current = useQuery(api.finance.getCurrentShift, {});
    const shifts = useQuery(api.finance.listShifts, {
        from: filters.from,
        to: filters.to,
        branchId: filters.branchId,
        limit: 25,
    });

    const startShift = useMutation(api.finance.openShift);
    const endShift = useMutation(api.finance.closeShift);

    const branches = useQuery(api.branches.list, {});

    const shiftColumns: ExportColumn[] = [
        { header: "Opened", key: "openedAt", format: (v) => String(v).slice(0, 16).replace("T", " ") },
        { header: "Cashier", key: "userName" },
        { header: "Status", key: "status" },
        { header: "Float", key: "openingFloat", format: (v) => number(v) },
        { header: "Expected", key: "expectedCash", format: (v) => number(v) },
        { header: "Counted", key: "countedCash", format: (v) => number(v) },
        { header: "Variance", key: "variance", format: (v) => number(v) },
    ];

    const canManageCash = can("finance.cash.manage");

    return (
        <div className="space-y-4">
            {current === undefined ? (
                <LoadingState rows={1} />
            ) : current ? (
                <Card className="border-emerald-500/40 bg-emerald-500/5">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="flex items-center gap-2 text-base">
                            <Banknote className="h-4 w-4 text-emerald-600" />
                            Your shift is open
                        </CardTitle>
                        <Button size="sm" onClick={() => setCloseShift(current)}>
                            Count the drawer and close
                        </Button>
                    </CardHeader>
                    <CardContent className="grid gap-3 sm:grid-cols-4">
                        <Mini label="Opening float" value={ugx(current.openingFloat)} />
                        <Mini label="Cash taken" value={ugx(current.breakdown.cashSales)} />
                        <Mini label="Put in" value={ugx(current.breakdown.cashIn)} />
                        <Mini label="Should be in the drawer" value={ugx(current.expectedCash)} strong />
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 p-8 text-center">
                        <Banknote className="h-10 w-10 text-muted-foreground opacity-40" />
                        <div>
                            <p className="font-bold">You have no open shift</p>
                            <p className="text-sm text-muted-foreground">
                                Open a shift to get your float and start taking money.
                            </p>
                        </div>
                        <Button onClick={() => setOpenShift(true)}>Open a shift</Button>
                    </CardContent>
                </Card>
            )}

            {drawer && (
                <StatStrip
                    stats={[
                        { label: "Opening float", value: ugx(drawer.openingFloat) },
                        { label: "Cash sales", value: ugx(drawer.cashSales) },
                        { label: "Paid in", value: ugx(drawer.cashIn) },
                        { label: "Paid out", value: ugx(drawer.cashOut) },
                    ]}
                />
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Shifts</CardTitle>
                    <ExportMenu
                        title="cash-shifts"
                        rows={(shifts?.page ?? []) as any[]}
                        columns={shiftColumns}
                    />
                </CardHeader>
                <CardContent>
                    {!shifts ? (
                        <LoadingState />
                    ) : shifts.page.length === 0 ? (
                        <EmptyState
                            title="No shifts in this period"
                            hint="Shifts appear here once the till has been opened and closed."
                        />
                    ) : (
                        <RecordList
                            records={shifts.page}
                            renderItem={(shift: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-bold">{shift.userName}</p>
                                            <StatusBadge
                                                status={
                                                    shift.status === "open"
                                                        ? "ordered"
                                                        : shift.variance === 0
                                                          ? "received"
                                                          : "cancelled"
                                                }
                                            />
                                            {shift.variance !== undefined &&
                                                shift.variance !== 0 && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-[10px] font-bold text-destructive"
                                                    >
                                                        <AlertTriangle className="mr-1 h-3 w-3" />
                                                        {ugx(shift.variance)}
                                                    </Badge>
                                                )}
                                        </div>
                                        <p className="text-xs text-muted-foreground">
                                            Opened {shortDate(shift.openedAt)}
                                            {shift.closedAt
                                                ? ` · closed ${shortDate(shift.closedAt)}`
                                                : " · still open"}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 text-xs">
                                        <span className="text-muted-foreground">
                                            Float{" "}
                                            <span className="font-bold text-foreground">
                                                {ugx(shift.openingFloat)}
                                            </span>
                                        </span>
                                        <span className="text-muted-foreground">
                                            Expected{" "}
                                            <span className="font-bold text-foreground">
                                                {ugx(shift.expectedCash)}
                                            </span>
                                        </span>
                                        {shift.countedCash !== undefined && (
                                            <span className="text-muted-foreground">
                                                Counted{" "}
                                                <span className="font-bold text-foreground">
                                                    {ugx(shift.countedCash)}
                                                </span>
                                            </span>
                                        )}
                                        {canManageCash && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setCloseShift(shift)}
                                            >
                                                {shift.status === "open"
                                                    ? "Close"
                                                    : "View"}
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </CardContent>
            </Card>

            <FormDialog
                open={openShift}
                onOpenChange={setOpenShift}
                title="Open a shift"
                description="The cash you are given to start with."
                submitLabel="Open shift"
                fields={[
                    {
                        name: "openingFloat",
                        label: "Opening float",
                        type: "number",
                        required: true,
                        min: 0,
                        placeholder: "0",
                    },
                    {
                        name: "branchId",
                        label: "Branch",
                        type: "select",
                        options: (branches ?? []).map((b: any) => ({
                            value: b._id,
                            label: b.name,
                        })),
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={async (values) => {
                    await startShift({
                        openingFloat: Number(values.openingFloat),
                        branchId: (values.branchId || undefined) as Id<"branches"> | undefined,
                        notes: values.notes || undefined,
                    });
                    toast.success("Shift opened");
                }}
            />

            <FormDialog
                open={!!closeShift}
                onOpenChange={(v) => {
                    if (!v) setCloseShift(null);
                }}
                title="Close the shift"
                description={
                    closeShift
                        ? `Count the cash in the drawer. It should hold ${ugx(
                              closeShift.expectedCash
                          )}.`
                        : undefined
                }
                submitLabel="Close shift"
                fields={[
                    {
                        name: "countedCash",
                        label: "Cash counted",
                        type: "number",
                        required: true,
                        min: 0,
                        placeholder: "0",
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={async (values) => {
                    const result = await endShift({
                        shiftId: closeShift._id,
                        countedCash: Number(values.countedCash),
                        notes: values.notes || undefined,
                    });
                    toast.success("Shift closed", {
                        description:
                            result.variance === 0
                                ? "The drawer balanced exactly."
                                : `Variance of ${ugx(result.variance)} recorded.`,
                    });
                    setCloseShift(null);
                }}
            />
        </div>
    );
}

function Mini({
    label,
    value,
    strong,
}: {
    label: string;
    value: string;
    strong?: boolean;
}) {
    return (
        <div className="rounded-lg border bg-card p-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {label}
            </p>
            <p
                className={`mt-0.5 text-lg font-black tabular-nums ${
                    strong ? "text-emerald-600 dark:text-emerald-400" : ""
                }`}
            >
                {value}
            </p>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Cash in and cash out
 * ──────────────────────────────────────────────────────────────────────── */

function CashTab({ filters }: { filters: FinanceFilters }) {
    const [open, setOpen] = useState(false);
    const movements = useQuery(api.finance.listCashMovements, {
        from: filters.from,
        to: filters.to,
        branchId: filters.branchId,
        limit: 100,
    });
    const record = useMutation(api.finance.recordCashMovement);

    const columns: ExportColumn[] = [
        { header: "Date", key: "date", format: (v) => String(v).slice(0, 10) },
        { header: "Direction", key: "type" },
        { header: "Category", key: "category" },
        { header: "Reason", key: "reason" },
        { header: "Reference", key: "reference" },
        { header: "By", key: "userName" },
        { header: "Amount", key: "amount", format: (v) => number(v) },
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <StatStrip
                    className="flex-1"
                    stats={[
                        { label: "Paid in", value: ugx(movements?.totalIn ?? 0), tone: "good" },
                        { label: "Paid out", value: ugx(movements?.totalOut ?? 0), tone: "warn" },
                        { label: "Net", value: ugx(movements?.net ?? 0) },
                    ]}
                />
                <CreateButton onClick={() => setOpen(true)} label="Record a movement" />
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Cash movements</CardTitle>
                    <ExportMenu
                        title="cash-movements"
                        rows={(movements?.page ?? []) as any[]}
                        columns={columns}
                    />
                </CardHeader>
                <CardContent>
                    {!movements ? (
                        <LoadingState />
                    ) : movements.page.length === 0 ? (
                        <EmptyState
                            title="No cash movements"
                            hint="Money put into the till and money taken out of it appears here."
                        />
                    ) : (
                        <RecordList
                            records={movements.page}
                            renderItem={(movement: any) => (
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span
                                                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${
                                                    movement.type === "in"
                                                        ? "bg-emerald-500/10 text-emerald-600"
                                                        : "bg-amber-500/10 text-amber-600"
                                                }`}
                                            >
                                                {movement.type === "in" ? (
                                                    <ArrowDownLeft className="h-3.5 w-3.5" />
                                                ) : (
                                                    <ArrowUpRight className="h-3.5 w-3.5" />
                                                )}
                                            </span>
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-semibold">
                                                    {movement.reason}
                                                </p>
                                                <p className="text-[11px] text-muted-foreground">
                                                    {movement.category} ·{" "}
                                                    {shortDate(movement.date)}
                                                    {movement.reference
                                                        ? ` · ${movement.reference}`
                                                        : ""}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <p
                                        className={`shrink-0 text-sm font-black tabular-nums ${
                                            movement.type === "in"
                                                ? "text-emerald-600 dark:text-emerald-400"
                                                : "text-amber-600 dark:text-amber-400"
                                        }`}
                                    >
                                        {movement.type === "in" ? "+" : "−"}
                                        {ugx(movement.amount)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </CardContent>
            </Card>

            <FormDialog
                open={open}
                onOpenChange={setOpen}
                title="Record a cash movement"
                description="Money into the till, or money out of it. A reference stops the same movement being recorded twice."
                submitLabel="Record movement"
                fields={[
                    {
                        name: "type",
                        label: "Direction",
                        type: "select",
                        required: true,
                        options: [
                            { value: "in", label: "In — money into the till" },
                            { value: "out", label: "Out — money out of the till" },
                        ],
                    },
                    {
                        name: "amount",
                        label: "Amount",
                        type: "number",
                        required: true,
                        min: 1,
                        placeholder: "0",
                    },
                    {
                        name: "category",
                        label: "Category",
                        type: "select",
                        required: true,
                        options: [
                            { value: "float", label: "Float top-up" },
                            { value: "deposit", label: "Bank deposit" },
                            { value: "petty_cash", label: "Petty cash" },
                            { value: "supplier", label: "Paid a supplier" },
                            { value: "bank", label: "Taken to the bank" },
                            { value: "other", label: "Other" },
                        ],
                    },
                    { name: "reason", label: "Reason", required: true, full: true },
                    {
                        name: "reference",
                        label: "Reference",
                        placeholder: "Receipt or slip number",
                        hint: "Used to stop the same movement being recorded twice.",
                    },
                    { name: "date", label: "Date", type: "date" },
                ]}
                onSubmit={async (values) => {
                    await record({
                        type: values.type as "in" | "out",
                        amount: Number(values.amount),
                        category: values.category,
                        reason: values.reason,
                        reference: values.reference || undefined,
                        date: values.date ? new Date(values.date).toISOString() : undefined,
                    });
                    toast.success("Cash movement recorded");
                }}
            />
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Income
 * ──────────────────────────────────────────────────────────────────────── */

function IncomeTab({ filters }: { filters: FinanceFilters }) {
    const [open, setOpen] = useState(false);
    const income = useQuery(api.finance.listIncome, {
        from: filters.from,
        to: filters.to,
        branchId: filters.branchId,
        limit: 100,
    });
    const record = useMutation(api.finance.recordIncome);

    const columns: ExportColumn[] = [
        { header: "Date", key: "date", format: (v) => String(v).slice(0, 10) },
        { header: "Source", key: "source" },
        { header: "Description", key: "description" },
        { header: "Reference", key: "reference" },
        { header: "Amount", key: "amount", format: (v) => number(v) },
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <StatStrip
                    className="flex-1"
                    stats={[
                        { label: "Other income", value: ugx(income?.total ?? 0), tone: "good" },
                        { label: "Records", value: String(income?.totalCount ?? 0) },
                    ]}
                />
                <CreateButton onClick={() => setOpen(true)} label="Record income" />
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Income that is not a sale</CardTitle>
                    <ExportMenu
                        title="other-income"
                        rows={(income?.page ?? []) as any[]}
                        columns={columns}
                    />
                </CardHeader>
                <CardContent>
                    {!income ? (
                        <LoadingState />
                    ) : income.page.length === 0 ? (
                        <EmptyState
                            title="No other income"
                            hint="Rent from a third party, a service fee, a grant — money that came in without goods leaving the shelf."
                        />
                    ) : (
                        <RecordList
                            records={income.page}
                            renderItem={(row: any) => (
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">
                                            {row.source}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            {shortDate(row.date)}
                                            {row.description ? ` · ${row.description}` : ""}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                                        +{ugx(row.amount)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </CardContent>
            </Card>

            <FormDialog
                open={open}
                onOpenChange={setOpen}
                title="Record income"
                description="Money that came in without goods leaving the shelf."
                submitLabel="Record income"
                fields={[
                    {
                        name: "amount",
                        label: "Amount",
                        type: "number",
                        required: true,
                        min: 1,
                        placeholder: "0",
                    },
                    {
                        name: "source",
                        label: "Source",
                        required: true,
                        placeholder: "e.g. Rent from a stall",
                    },
                    {
                        name: "description",
                        label: "Description",
                        type: "textarea",
                        full: true,
                    },
                    { name: "reference", label: "Reference" },
                    { name: "date", label: "Date", type: "date" },
                ]}
                onSubmit={async (values) => {
                    await record({
                        amount: Number(values.amount),
                        source: values.source,
                        description: values.description || undefined,
                        reference: values.reference || undefined,
                        date: values.date ? new Date(values.date).toISOString() : undefined,
                    });
                    toast.success("Income recorded");
                }}
            />
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Expenses
 * ──────────────────────────────────────────────────────────────────────── */

function ExpensesTab({ filters }: { filters: FinanceFilters }) {
    const report = useQuery(api.analytics.getExpenseReport, {
        from: filters.from,
        to: filters.to,
        branchId: filters.branchId,
        limit: 100,
    });

    const columns: ExportColumn[] = [
        { header: "Date", key: "date", format: (v) => String(v).slice(0, 10) },
        { header: "Type", key: "type" },
        { header: "Expense", key: "expense" },
        { header: "Received by", key: "receivedBy" },
        { header: "Amount", key: "amount", format: (v) => number(v) },
    ];

    if (!report) return <LoadingState />;

    return (
        <div className="space-y-4">
            <StatStrip
                stats={[
                    { label: "Total running costs", value: ugx(report.total), tone: "warn" },
                    { label: "Entries", value: String(report.count) },
                    { label: "Categories", value: String(report.byType.length) },
                    {
                        label: "Average entry",
                        value: ugx(report.count > 0 ? report.total / report.count : 0),
                    },
                ]}
            />

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">Running costs</CardTitle>
                    <ExportMenu
                        title="expenses"
                        rows={(report.page ?? []) as any[]}
                        columns={columns}
                    />
                </CardHeader>
                <CardContent>
                    {report.page.length === 0 ? (
                        <EmptyState
                            title="No running costs"
                            hint="The costs of running the business appear here once they are recorded."
                        />
                    ) : (
                        <RecordList
                            records={report.page}
                            renderItem={(row: any) => (
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="truncate text-sm font-semibold">
                                            {row.expense}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">
                                            {row.type} · {shortDate(row.date)} · received by{" "}
                                            {row.receivedBy}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums">
                                        {ugx(row.amount)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────────────────
 * Reconciliation
 * ──────────────────────────────────────────────────────────────────────── */

function ReconciliationTab() {
    const [open, setOpen] = useState(false);
    const list = useQuery(api.finance.listReconciliations, { limit: 50 });
    const reconcile = useMutation(api.finance.reconcile);

    const columns: ExportColumn[] = [
        { header: "Period", key: "period" },
        { header: "Method", key: "method" },
        { header: "Statement", key: "statementReference" },
        { header: "Statement amount", key: "statementAmount", format: (v) => number(v) },
        { header: "Recorded", key: "recordedAmount", format: (v) => number(v) },
        { header: "Variance", key: "variance", format: (v) => number(v) },
        { header: "Status", key: "status" },
    ];

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
                <StatStrip
                    className="flex-1"
                    stats={[
                        { label: "Reconciliations", value: String(list?.totalCount ?? 0) },
                        {
                            label: "Total variance",
                            value: ugx(list?.totalVariance ?? 0),
                            tone: (list?.totalVariance ?? 0) === 0 ? "good" : "warn",
                        },
                    ]}
                />
                <CreateButton onClick={() => setOpen(true)} label="Reconcile" />
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <RefreshCw className="h-4 w-4 text-muted-foreground" />
                        Reconciliations
                    </CardTitle>
                    <ExportMenu
                        title="reconciliations"
                        rows={(list?.page ?? []) as any[]}
                        columns={columns}
                    />
                </CardHeader>
                <CardContent>
                    {!list ? (
                        <LoadingState />
                    ) : list.page.length === 0 ? (
                        <EmptyState
                            title="Nothing reconciled yet"
                            hint="Compare what a provider says was paid in against what the books recorded."
                        />
                    ) : (
                        <RecordList
                            records={list.page}
                            renderItem={(row: any) => (
                                <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="text-sm font-bold">
                                                {row.method} · {row.period}
                                            </p>
                                            <Badge
                                                variant={
                                                    row.status === "reconciled"
                                                        ? "secondary"
                                                        : "destructive"
                                                }
                                                className="text-[10px] font-bold"
                                            >
                                                {row.status === "reconciled"
                                                    ? "BALANCED"
                                                    : "DISCREPANCY"}
                                            </Badge>
                                        </div>
                                        <p className="text-[11px] text-muted-foreground">
                                            {row.statementReference} · statement{" "}
                                            {ugx(row.statementAmount)} · books{" "}
                                            {ugx(row.recordedAmount)}
                                        </p>
                                    </div>
                                    <p
                                        className={`shrink-0 text-sm font-black tabular-nums ${
                                            row.variance === 0
                                                ? "text-emerald-600 dark:text-emerald-400"
                                                : "text-destructive"
                                        }`}
                                    >
                                        {row.variance > 0 ? "+" : ""}
                                        {ugx(row.variance)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </CardContent>
            </Card>

            <FormDialog
                open={open}
                onOpenChange={setOpen}
                title="Reconcile a payment method"
                description="What the provider says was paid in, against what the books recorded."
                submitLabel="Reconcile"
                fields={[
                    {
                        name: "kind",
                        label: "What is being reconciled",
                        type: "select",
                        required: true,
                        options: [
                            { value: "bank", label: "Bank statement" },
                            { value: "mobile_money", label: "Mobile money statement" },
                            { value: "cash", label: "Cash" },
                        ],
                    },
                    {
                        name: "method",
                        label: "Payment method",
                        type: "select",
                        required: true,
                        options: [
                            { value: "Cash", label: "Cash" },
                            { value: "Mobile Money", label: "Mobile money" },
                            { value: "Bank Transfer", label: "Bank transfer" },
                            { value: "Card", label: "Card" },
                        ],
                    },
                    {
                        name: "period",
                        label: "Period",
                        type: "text",
                        required: true,
                        placeholder: "YYYY-MM",
                        hint: "The month being reconciled, written as YYYY-MM.",
                    },
                    {
                        name: "statementReference",
                        label: "Statement reference",
                        required: true,
                        placeholder: "The provider's reference",
                    },
                    {
                        name: "statementAmount",
                        label: "Statement amount",
                        type: "number",
                        required: true,
                        placeholder: "0",
                    },
                    {
                        name: "recordedAmount",
                        label: "Recorded amount",
                        type: "number",
                        placeholder: "Left blank to work it out from the books",
                        hint: "Leave blank and the books will be used.",
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={async (values) => {
                    const result = await reconcile({
                        kind: values.kind,
                        method: values.method,
                        period: values.period,
                        statementReference: values.statementReference,
                        statementAmount: Number(values.statementAmount),
                        recordedAmount: values.recordedAmount
                            ? Number(values.recordedAmount)
                            : undefined,
                        notes: values.notes || undefined,
                    });
                    toast.success(
                        result.status === "reconciled"
                            ? "Reconciled — the books match the statement"
                            : `Discrepancy of ${ugx(result.variance)} recorded`,
                        {
                            description:
                                result.status === "reconciled"
                                    ? undefined
                                    : "The difference is now on the record.",
                        }
                    );
                }}
            />
        </div>
    );
}
