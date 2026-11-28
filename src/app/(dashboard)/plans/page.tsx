"use client";

/**
 * SMART_BUZ — Instalment plans.
 *
 * Hire purchase, layaway, a phone on monthly payments: the money the
 * business is owed, and what is due next.
 *
 * A plan is not a sale. The stock stays on the shelf until the plan is
 * complete, and what the customer owes is tracked here — not inferred
 * from sales — so the figure on this screen is the figure the customer
 * agrees with.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { toast } from "sonner";
import {
    AlertTriangle,
    CalendarClock,
    CheckCircle2,
    HandCoins,
    Plus,
    Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
import {
    ConfirmDeleteDialog,
    FormDialog,
    RecordActions,
    RecordDetail,
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { describeError } from "@/components/error-feedback";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

interface PlanRow {
    _id: string;
    customerName: string;
    customerPhone?: string;
    description: string;
    total: number;
    deposit: number;
    instalmentCount: number;
    instalmentAmount: number;
    amountPaid: number;
    balance: number;
    startDate: string;
    nextDueDate: string;
    frequency: string;
    status: string;
    overdue: boolean;
    daysOverdue: number;
}

export default function PlansPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [statusFilter, setStatusFilter] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);
    const [detailId, setDetailId] = useState<Id<"installmentPlans"> | null>(null);
    const [payPlanId, setPayPlanId] = useState<Id<"installmentPlans"> | null>(null);
    const [cancelPlanId, setCancelPlanId] = useState<Id<"installmentPlans"> | null>(null);

    const [formValues, setFormValues] = useState<Record<string, string>>({});
    const [payValues, setPayValues] = useState<Record<string, string>>({});

    const summary = useQuery(api.packages.plans.getPlanSummary, {});
    const plans = useQuery(
        api.packages.plans.listPlans,
        statusFilter === "all" ? {} : { status: statusFilter }
    );
    const detail = useQuery(
        api.packages.plans.listPlanPayments,
        detailId ? { planId: detailId } : "skip"
    );

    const createPlan = useMutation(api.packages.plans.createPlan);
    const recordPayment = useMutation(api.packages.plans.recordPlanPayment);
    const cancelPlan = useMutation(api.packages.plans.cancelPlan);

    const rows = useMemo(() => plans ?? [], [plans]);

    const columns: DataTableColumn<PlanRow>[] = [
        {
            id: "customer",
            header: "Customer",
            accessor: (row) => row.customerName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.customerName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {t(row.description)}
                    </p>
                </div>
            ),
        },
        {
            id: "total",
            header: `Total (${currency})`,
            accessor: (row) => row.total,
            align: "right",
            cell: (row) => (
                <span className="tabular-nums">{row.total.toLocaleString()}</span>
            ),
        },
        {
            id: "paid",
            header: "Paid",
            accessor: (row) => row.amountPaid,
            align: "right",
            cell: (row) => (
                <span className="tabular-nums">
                    {row.amountPaid.toLocaleString()}
                </span>
            ),
            hideBelow: "sm",
        },
        {
            id: "balance",
            header: "Still owed",
            accessor: (row) => row.balance,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">
                    {row.balance.toLocaleString()}
                </span>
            ),
        },
        {
            id: "instalment",
            header: "Payment",
            accessor: (row) => row.instalmentAmount,
            align: "right",
            hideBelow: "md",
            cell: (row) => (
                <span className="tabular-nums">
                    {row.instalmentAmount.toLocaleString()} × {row.instalmentCount}
                </span>
            ),
        },
        {
            id: "due",
            header: "Next due",
            accessor: (row) => row.nextDueDate,
            cell: (row) =>
                row.overdue ? (
                    <Badge variant="danger">
                        {row.daysOverdue} {row.daysOverdue === 1 ? "day" : "days"} late
                    </Badge>
                ) : (
                    <span className="tabular-nums">{row.nextDueDate}</span>
                ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => (
                <Badge
                    variant={
                        row.status === "completed"
                            ? "success"
                            : row.status === "defaulted"
                              ? "danger"
                              : row.status === "cancelled"
                                ? "neutral"
                                : "warning"
                    }
                >
                    {row.status === "active"
                        ? "Open"
                        : row.status.charAt(0).toUpperCase() + row.status.slice(1)}
                </Badge>
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
                        label={t("Actions for the plan for {0}", {
            0: row.customerName,
        })}
                        onView={() => setDetailId(row._id as Id<"installmentPlans">)}
                        onEdit={() => setPayPlanId(row._id as Id<"installmentPlans">)}
                        onDelete={() => setCancelPlanId(row._id as Id<"installmentPlans">)}
                    />
                </div>
            ),
        },
    ];

    const createFields: FormField[] = [
        { name: "description", label: "What is it for", required: true },
        { name: "customerName", label: "Customer", required: true },
        { name: "customerPhone", label: "Phone", type: "tel" },
        { name: "total", label: `Price (${currency})`, type: "number", required: true },
        {
            name: "deposit",
            label: "Deposit",
            type: "number",
            required: true,
            hint: "What is paid up front.",
        },
        {
            name: "instalmentCount",
            label: "Number of payments",
            type: "number",
            required: true,
            defaultValue: 3,
        },
        {
            name: "frequency",
            label: "How often",
            type: "select",
            defaultValue: "monthly",
            options: [
                { value: "weekly", label: "Weekly" },
                { value: "fortnightly", label: "Every two weeks" },
                { value: "monthly", label: "Monthly" },
            ],
        },
        { name: "notes", label: "Notes", type: "textarea" },
    ];

    const payFields: FormField[] = [
        {
            name: "amount",
            label: `Amount (${currency})`,
            type: "number",
            required: true,
        },
        {
            name: "method",
            label: "How it was paid",
            type: "select",
            defaultValue: "cash",
            options: [
                { value: "cash", label: "Cash" },
                { value: "mobile_money", label: "Mobile money" },
                { value: "bank", label: "Bank transfer" },
                { value: "card", label: "Card" },
            ],
        },
        { name: "reference", label: "Reference" },
    ];

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Credit"
                title={t("Instalment plans")}
                description={t("What customers are paying off, and what falls due next.")}
                icon={HandCoins}
                badge={<CountBadge tone="warning">{summary?.active ?? 0}</CountBadge>}
                actions={
                    <Button onClick={() => setCreateOpen(true)}>
                        <Plus className="mr-2 size-4" /> {t("Open a plan")}
                    </Button>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Open plans")}
                    value={summary?.active ?? 0}
                    hint={t("Plans still being paid off")}
                    icon={Wallet}
                    tone="info"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Overdue")}
                    value={summary?.overdue ?? 0}
                    hint={t("A payment that has gone past its date")}
                    icon={AlertTriangle}
                    tone="danger"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Still owed")}
                    value={`${currency} ${(summary?.outstanding ?? 0).toLocaleString()}`}
                    hint={t("Across every open plan")}
                    icon={HandCoins}
                    tone="default"
                    isLoading={summary === undefined}
                />
                <StatCard
                    label={t("Due this month")}
                    value={`${currency} ${(summary?.dueThisMonth ?? 0).toLocaleString()}`}
                    hint={t("What the open plans fall due for")}
                    icon={CalendarClock}
                    tone="warning"
                    isLoading={summary === undefined}
                />
            </StatGrid>

            <SectionCard
                title={t("Plans")}
                description={t("Every plan this business has open.")}
                padded={false}
                actions={
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                        <SelectTrigger className="h-9 w-[170px]">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t("All plans")}</SelectItem>
                            <SelectItem value="active">{t("Open")}</SelectItem>
                            <SelectItem value="completed">{t("Completed")}</SelectItem>
                            <SelectItem value="defaulted">{t("Defaulted")}</SelectItem>
                            <SelectItem value="cancelled">{t("Cancelled")}</SelectItem>
                        </SelectContent>
                    </Select>
                }
            >
                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={plans === undefined}
                    isEmpty={plans !== undefined && rows.length === 0}
                    emptyTitle={t("No instalment plans yet")}
                    emptyHint={t("When a customer wants to pay over time, open a plan here and the payments are tracked against it.")}
                    emptyAction={
                        <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-2 size-4" /> {t("Open a plan")}
                        </Button>
                    }
                    pageSize={25}
                    defaultSort={{ id: "due", direction: "asc" }}
                    ariaLabel="Instalment plans"
                    className="px-4 pb-5 sm:px-5"
                />
                <div className="px-4 pb-5 sm:px-5">
                    <DataTableExport
                        title={t("Instalment plans")}
                        rows={rows}
                        columns={columns}
                    />
                </div>
            </SectionCard>

            <FormDialog
                open={createOpen}
                onOpenChange={(open) => {
                    setCreateOpen(open);
                    if (!open) setFormValues({});
                }}
                title={t("Open an instalment plan")}
                description={t("The price, the deposit and the number of payments. The instalment and the dates are worked out by the server.")}
                fields={createFields}
                initialValues={formValues}
                onSubmit={async (values) => {
                    try {
                        await createPlan({
                            description: values.description,
                            customerName: values.customerName,
                            customerPhone: values.customerPhone || undefined,
                            total: Number(values.total),
                            deposit: Number(values.deposit),
                            instalmentCount: Number(values.instalmentCount),
                            frequency: values.frequency || "monthly",
                            notes: values.notes || undefined,
                        });
                        toast.success("Plan opened.");
                        setFormValues({});
                    } catch (error) {
                        toast.error(describeError(error, "The plan could not be opened."));
                    }
                }}
            />

            <FormDialog
                open={payPlanId !== null}
                onOpenChange={(open) => {
                    if (!open) {
                        setPayPlanId(null);
                        setPayValues({});
                    }
                }}
                title={t("Record a payment")}
                description={t("The balance is worked out by the server, so what is left can never drift from what was taken.")}
                fields={payFields}
                initialValues={payValues}
                onSubmit={async (values) => {
                    if (!payPlanId) return;
                    try {
                        const outcome = await recordPayment({
                            planId: payPlanId,
                            amount: Number(values.amount),
                            method: values.method || undefined,
                            reference: values.reference || undefined,
                        });
                        toast.success(
                            outcome.status === "completed"
                                ? "Payment taken — the plan is now complete."
                                : `Payment taken. ${outcome.balanceAfter.toLocaleString()} still owed.`
                        );
                        setPayValues({});
                        setPayPlanId(null);
                    } catch (error) {
                        toast.error(describeError(error, "The payment could not be taken."));
                    }
                }}
            />

            <ConfirmDeleteDialog
                open={cancelPlanId !== null}
                onOpenChange={(open) => !open && setCancelPlanId(null)}
                onConfirm={async () => {
                    if (!cancelPlanId) return;
                    try {
                        await cancelPlan({ planId: cancelPlanId });
                        toast.success("Plan cancelled.");
                        setCancelPlanId(null);
                    } catch (error) {
                        toast.error(describeError(error, "The plan could not be cancelled."));
                    }
                }}
                entityName="instalment plan"
                description={t("The plan is closed and the customer is released. The money already taken is not affected.")}
            />

            <RecordDetail
                open={detailId !== null}
                onOpenChange={(open) => !open && setDetailId(null)}
                title={t("Payment history")}
                description={t("Every payment taken against this plan.")}
                rows={
                    detail && detail.length > 0
                        ? detail.map((payment: any) => ({
                              label: `${payment.date} — ${currency} ${payment.amount.toLocaleString()}`,
                              value: payment.method ?? "—",
                          }))
                        : [
                              {
                                  label: "No payments taken yet",
                                  value: "Payments against this plan will be listed here.",
                              },
                          ]
                }
                footer={
                    detail && detail.length > 0 ? (
                        <p className="flex items-center gap-2 text-sm text-muted-foreground">
                            <CheckCircle2 className="size-4" />
                            {detail.length} payment
                            {detail.length === 1 ? "" : "s"} taken
                        </p>
                    ) : null
                }
            />
        </PageContainer>
    );
}
