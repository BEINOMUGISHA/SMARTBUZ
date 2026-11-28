"use client";

/**
 * SMART_BUZ — payroll.
 *
 * The screen the person who signs the wages works from: the runs, the
 * people on them, what each person is owed, and what has been paid.
 *
 * Every figure on this page is the server's. The commission is worked out
 * from the sales the person actually made, the gross and the net are
 * counted on the server, and the money that leaves the business is
 * written into the books by the same action that marks the person paid.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import type { Id } from "../../../../convex/_generated/dataModel";
import { api } from "../../../../convex/_generated/api";
import { toast } from "sonner";
import {
    BadgeCheck,
    Banknote,
    CalendarRange,
    CircleDollarSign,
    Users,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
    CountBadge,
    PageContainer,
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { FormDialog, type FormField } from "@/components/vertical/ui-kit";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * The shapes the server sends back
 * ──────────────────────────────────────────────────────────────────────── */

interface RunRow {
    _id: Id<"payrollRuns">;
    periodStart: string;
    periodEnd: string;
    status: string;
    total: number;
    headcount: number;
    notes: string | null;
    approvedAt: string | null;
    paidAt: string | null;
    createdAt: string;
}

interface ItemRow {
    _id: Id<"payrollItems">;
    runId: Id<"payrollRuns">;
    employeeId: Id<"employees"> | null;
    employeeName: string;
    commission: number;
    allowance: number;
    gross: number;
    deductions: number;
    net: number;
    status: string;
    notes: string | null;
}

/* ────────────────────────────────────────────────────────────────────────
 * The page
 * ──────────────────────────────────────────────────────────────────────── */

export default function PayrollPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [statusFilter, setStatusFilter] = useState("all");
    const [openRun, setOpenRun] = useState(false);
    const [selectedRun, setSelectedRun] = useState<RunRow | null>(null);
    const [editItem, setEditItem] = useState<ItemRow | null>(null);
    const [cancelRun, setCancelRun] = useState<RunRow | null>(null);

    const [runValues, setRunValues] = useState<Record<string, string>>({});
    const [itemValues, setItemValues] = useState<Record<string, string>>({});

    const summary = useQuery(api.packages.workforce.getPayrollSummary, {});
    const runs = useQuery(
        api.packages.workforce.listPayrollRuns,
        statusFilter === "all" ? {} : { status: statusFilter }
    );
    const items = useQuery(
        api.packages.workforce.listPayrollItems,
        selectedRun ? { runId: selectedRun._id } : "skip"
    );

    const createRun = useMutation(api.packages.workforce.createPayrollRun);
    const updateItem = useMutation(api.packages.workforce.updatePayrollItem);
    const approveRun = useMutation(api.packages.workforce.approvePayrollRun);
    const payItem = useMutation(api.packages.workforce.recordPayrollPayment);
    const cancelRunMutation = useMutation(api.packages.workforce.cancelPayrollRun);

    const runRows = useMemo(() => runs ?? [], [runs]);
    const itemRows = useMemo(() => items ?? [], [items]);

    const money = (value: number) => `${currency} ${value.toLocaleString()}`;

    /* ── The tables ─────────────────────────────────────────────────── */

    const runColumns: DataTableColumn<RunRow>[] = [
        {
            id: "period",
            header: "Period",
            accessor: (row) => row.periodStart,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="font-medium tabular-nums">
                        {row.periodStart} → {row.periodEnd}
                    </p>
                    <p className="text-xs text-muted-foreground">
                        {row.headcount} on the run
                    </p>
                </div>
            ),
        },
        {
            id: "total",
            header: "Total",
            accessor: (row) => row.total,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">
                    {money(row.total)}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => (
                <span className="text-sm capitalize text-muted-foreground">
                    {row.status}
                </span>
            ),
        },
        {
            id: "paidAt",
            header: "Paid",
            accessor: (row) => row.paidAt ?? "",
            hideBelow: "lg",
            cell: (row) => (
                <span className="text-sm text-muted-foreground">
                    {row.paidAt ? row.paidAt.slice(0, 10) : "—"}
                </span>
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            cell: (row) => (
                <div className="flex items-center justify-end gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                            setSelectedRun(row);
                            setEditItem(null);
                        }}
                    >
                        {t("Open")}
                    </Button>
                    {row.status === "draft" ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await approveRun({ runId: row._id });
                                    toast.success("The run is approved.");
                                } catch (err) {
                                    toast.error(
                                        err instanceof Error
                                            ? err.message
                                            : "Could not approve the run."
                                    );
                                }
                            }}
                        >
                            {t("Approve")}
                        </Button>
                    ) : null}
                    {row.status === "draft" || row.status === "approved" ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive"
                            onClick={() => setCancelRun(row)}
                        >
                            {t("Cancel")}
                        </Button>
                    ) : null}
                </div>
            ),
        },
    ];

    const itemColumns: DataTableColumn<ItemRow>[] = [
        {
            id: "name",
            header: "Person",
            accessor: (row) => row.employeeName,
            cell: (row) => (
                <p className="truncate font-medium">{row.employeeName}</p>
            ),
        },
        {
            id: "commission",
            header: "Commission",
            accessor: (row) => row.commission,
            align: "right",
            hideBelow: "md",
            cell: (row) => (
                <span className="tabular-nums">{money(row.commission)}</span>
            ),
        },
        {
            id: "allowance",
            header: "Allowance",
            accessor: (row) => row.allowance,
            align: "right",
            hideBelow: "lg",
            cell: (row) => (
                <span className="tabular-nums">{money(row.allowance)}</span>
            ),
        },
        {
            id: "deductions",
            header: "Deductions",
            accessor: (row) => row.deductions,
            align: "right",
            hideBelow: "lg",
            cell: (row) => (
                <span className="tabular-nums">{money(row.deductions)}</span>
            ),
        },
        {
            id: "net",
            header: "Net",
            accessor: (row) => row.net,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">
                    {money(row.net)}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => (
                <span className="text-sm capitalize text-muted-foreground">
                    {row.status}
                </span>
            ),
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            cell: (row) => (
                <div className="flex items-center justify-end gap-1">
                    {selectedRun?.status === "draft" ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setEditItem(row);
                                setItemValues({
                                    allowance: String(row.allowance),
                                    deductions: String(row.deductions),
                                    notes: row.notes ?? "",
                                });
                            }}
                        >
                            {t("Adjust")}
                        </Button>
                    ) : null}
                    {selectedRun?.status === "approved" &&
                    row.status !== "paid" ? (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                                try {
                                    await payItem({ itemId: row._id });
                                    toast.success(
                                        `${row.employeeName} has been paid.`
                                    );
                                } catch (err) {
                                    toast.error(
                                        err instanceof Error
                                            ? err.message
                                            : "Could not pay this person."
                                    );
                                }
                            }}
                        >
                            {t("Pay")}
                        </Button>
                    ) : null}
                </div>
            ),
        },
    ];

    /* ── The forms ──────────────────────────────────────────────────── */

    const runFields: FormField[] = [
        {
            name: "periodStart",
            label: "Period starts",
            type: "date",
            required: true,
        },
        {
            name: "periodEnd",
            label: "Period ends",
            type: "date",
            required: true,
        },
        {
            name: "commissionRate",
            label: "Commission rate",
            type: "number",
            required: true,
            min: 0,
            step: 0.01,
            hint: "The share of their own sales each person is paid on, as a percentage.",
        },
        {
            name: "notes",
            label: "Notes",
            type: "textarea",
            full: true,
            placeholder: "Anything about this period",
        },
    ];

    const itemFields: FormField[] = [
        {
            name: "allowance",
            label: "Allowance",
            type: "number",
            min: 0,
            step: 0.01,
            hint: "Anything else this person is paid for the period.",
        },
        {
            name: "deductions",
            label: "Deductions",
            type: "number",
            min: 0,
            step: 0.01,
            hint: "What is taken off before they are paid.",
        },
        {
            name: "notes",
            label: "Notes",
            type: "textarea",
            full: true,
            placeholder: "A note on this line",
        },
    ];

    /* ── The page ───────────────────────────────────────────────────── */

    return (
        <PageContainer>
            <PageHeader
                eyebrow="People"
                title={t("Payroll")}
                description={t("The runs, the people on them, and what each person is owed.")}
                icon={Banknote}
                actions={
                    <Button onClick={() => setOpenRun(true)}>
                        <CalendarRange className="mr-2 size-4" />
                        {t("Open a run")}
                    </Button>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Runs")}
                    value={summary ? summary.runs : "—"}
                    hint={t("Runs opened for this period")}
                    icon={CalendarRange}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Staff on file")}
                    value={summary ? summary.staffOnFile : "—"}
                    hint={
                        summary
                            ? `${summary.staffWithoutPay} without a salary on file`
                            : undefined
                    }
                    icon={Users}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Gross")}
                    value={summary ? money(summary.gross) : "—"}
                    hint={t("Before deductions")}
                    icon={CircleDollarSign}
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Still to pay")}
                    value={summary ? money(summary.unpaid) : "—"}
                    hint={t("{0} already paid", {
            0: money(summary?.paid ?? 0),
        })}
                    tone={summary && summary.unpaid > 0 ? "warning" : "success"}
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Payroll runs")}
                description={t("A run is opened, worked out, approved and then paid.")}
                icon={Banknote}
                actions={
                    <div className="flex items-center gap-2">
                        <select
                            value={statusFilter}
                            onChange={(event) => setStatusFilter(event.target.value)}
                            className="h-9 rounded-lg border border-border bg-background px-3 text-sm"
                            aria-label={t("Filter by status")}
                        >
                            <option value="all">{t("All runs")}</option>
                            <option value="draft">{t("Draft")}</option>
                            <option value="approved">{t("Approved")}</option>
                            <option value="paid">{t("Paid")}</option>
                            <option value="cancelled">{t("Cancelled")}</option>
                        </select>
                        <CountBadge>{runRows.length} runs</CountBadge>
                    </div>
                }
                bodyClassName="p-0"
            >
                <DataTable
                    data={runRows}
                    columns={runColumns}
                    getRowId={(row) => row._id}
                    isLoading={runs === undefined}
                    isEmpty={runRows.length === 0}
                    emptyTitle={t("No payroll run yet")}
                    emptyHint={t("Open a run for a period and the commission on each person is worked out from the sales they made.")}
                    caption={t("Payroll runs")}
                />
            </SectionCard>

            {selectedRun ? (
                <SectionCard
                    title={t("The run — {0} to {1}", {
            0: selectedRun.periodStart,
            1: selectedRun.periodEnd,
        })}
                    description={
                        selectedRun.status === "draft"
                            ? "A run in draft can still be adjusted."
                            : selectedRun.status === "approved"
                              ? "Approved pay cannot be edited — it can only be paid."
                              : "This run has been paid."
                    }
                    icon={BadgeCheck}
                    actions={
                        <div className="flex items-center gap-2">
                            <CountBadge>{itemRows.length} people</CountBadge>
                            <Button variant="outline" size="sm" onClick={() => setSelectedRun(null)}>
                                {t("Close")}
                            </Button>
                        </div>
                    }
                    bodyClassName="p-0"
                >
                    <DataTable
                        data={itemRows}
                        columns={itemColumns}
                        getRowId={(row) => row._id}
                        isLoading={items === undefined}
                        isEmpty={itemRows.length === 0}
                        emptyTitle={t("Nobody on this run")}
                        emptyHint={t("The business's active staff are put on a run when it is opened.")}
                        caption={t("Payslips")}
                    />
                </SectionCard>
            ) : null}

            <FormDialog
                open={openRun}
                onOpenChange={(open) => {
                    setOpenRun(open);
                    if (!open) setRunValues({});
                }}
                title={t("Open a payroll run")}
                description={t("The people are the business's own staff; the commission on each of them is worked out from the sales they made.")}
                fields={runFields}
                initialValues={runValues}
                submitLabel="Open the run"
                onSubmit={async (values) => {
                    try {
                        const outcome = await createRun({
                            periodStart: values.periodStart,
                            periodEnd: values.periodEnd,
                            commissionRate: Number(values.commissionRate),
                            notes: values.notes || undefined,
                        });
                        toast.success(
                            `Run opened — ${outcome.headcount} staff, ${money(outcome.total)}.`
                        );
                        setOpenRun(false);
                        setRunValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not open the run."
                        );
                        throw err;
                    }
                }}
            />

            <FormDialog
                open={editItem !== null}
                onOpenChange={(open) => {
                    if (!open) setEditItem(null);
                }}
                title={t("Adjust this payslip")}
                description={
                    editItem
                        ? `${editItem.employeeName} — the gross and the net are worked out by the server.`
                        : undefined
                }
                fields={itemFields}
                initialValues={itemValues}
                onSubmit={async (values) => {
                    if (!editItem) return;
                    try {
                        const outcome = await updateItem({
                            itemId: editItem._id,
                            allowance: Number(values.allowance || 0),
                            deductions: Number(values.deductions || 0),
                            notes: values.notes || undefined,
                        });
                        toast.success(`Net pay is now ${money(outcome.net)}.`);
                        setEditItem(null);
                        setItemValues({});
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not adjust the payslip."
                        );
                        throw err;
                    }
                }}
            />

            <FormDialog
                open={cancelRun !== null}
                onOpenChange={(open) => {
                    if (!open) setCancelRun(null);
                }}
                title={t("Cancel this run")}
                description={
                    cancelRun
                        ? `Cancel the run for ${cancelRun.periodStart} to ${cancelRun.periodEnd}? Nothing is paid from a cancelled run.`
                        : undefined
                }
                fields={[
                    {
                        name: "reason",
                        label: "Why",
                        type: "textarea",
                        full: true,
                        placeholder: "Opened for the wrong period",
                    },
                ]}
                initialValues={{ reason: "" }}
                submitLabel="Cancel the run"
                onSubmit={async (values) => {
                    if (!cancelRun) return;
                    try {
                        await cancelRunMutation({
                            runId: cancelRun._id,
                            reason: values.reason || undefined,
                        });
                        toast.success("The run was cancelled.");
                        setCancelRun(null);
                    } catch (err) {
                        toast.error(
                            err instanceof Error
                                ? err.message
                                : "Could not cancel the run."
                        );
                        throw err;
                    }
                }}
            />
        </PageContainer>
    );
}
