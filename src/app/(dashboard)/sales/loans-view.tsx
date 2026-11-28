"use client";

/**
 * SMART_BUZ — the credit book.
 *
 * Every credit the business has given, what is still owed on it, and what is
 * late. The screen has two jobs:
 *
 *  1. **Originate credit.** A sale that has not been paid can be put on the
 *     book. The figures are the server's: the amount is the sale's own
 *     total, the balance is that total less the deposit, and the customer's
 *     credit limit is checked before anything is written. The form shows the
 *     server's own preview and sends no figure of its own.
 *
 *  2. **Show the truth about what is owed.** The balance, what falls due this
 *     week, what is late, and by how many days.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { useCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { formatError } from "@/lib/utils";
import {
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
    Toolbar,
    ToolbarGroup,
    CountBadge,
    ActionButton,
    Eyebrow,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import {
    FormDialog,
    RecordDetail,
    SearchBox,
    StatusBadge,
    shortDate,
    type FormField,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AlertTriangle, Banknote, CreditCard, Plus } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/provider";

type CreditRow = {
    _id: Id<"loans">;
    customerId: Id<"customers"> | null;
    customerName: string;
    customerPhone: string | null;
    salesId: Id<"sales">;
    invoiceNumber: string | null;
    date: string;
    dueDate: string | null;
    amount: number;
    paid: number;
    balance: number;
    daysOverdue: number;
    overdue: boolean;
    dueSoon: boolean;
    status: string;
};

const PAYMENT_FIELDS: FormField[] = [
    {
        name: "amount",
        label: "Amount received",
        type: "number",
        required: true,
        min: 1,
    },
    {
        name: "method",
        label: "How it was paid",
        type: "select",
        required: true,
        options: [
            { value: "cash", label: "Cash" },
            { value: "mobile_money", label: "Mobile money" },
            { value: "bank", label: "Bank transfer" },
            { value: "card", label: "Card" },
            { value: "cheque", label: "Cheque" },
        ],
    },
    {
        name: "note",
        label: "Note",
        type: "text",
        full: true,
        placeholder: "Optional — a reference for this payment",
    },
];

export function LoansView() {
    
    const t = useT();const { permissions } = useAuth();
    const { currency } = useCurrency();

    // The permission names the backend uses for the debt book.
    const canView = permissions.includes("loans.view");
    const canManage = permissions.includes("loans.manage");

    const [search, setSearch] = useState("");
    const [paying, setPaying] = useState<CreditRow | null>(null);
    const [viewing, setViewing] = useState<CreditRow | null>(null);

    // Origination form.
    const [originating, setOriginating] = useState(false);
    const [customerId, setCustomerId] = useState("");
    const [salesId, setSalesId] = useState("");
    const [dueDate, setDueDate] = useState("");
    const [deposit, setDeposit] = useState("");
    const [originError, setOriginError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const book = useQuery(api.loans.getCreditBook, canView ? {} : "skip");
    const customers = useQuery(
        api.customers.listAll,
        canManage ? {} : "skip"
    );
    const candidates = useQuery(
        api.loans.listOriginationCandidates,
        canManage && customerId
            ? { customerId: customerId as Id<"customers"> }
            : "skip"
    );
    const preview = useQuery(
        api.loans.getOriginationPreview,
        canManage && salesId
            ? {
                  salesId: salesId as Id<"sales">,
                  deposit: Number(deposit) || 0,
              }
            : "skip"
    );

    const originate = useMutation(api.loans.add);
    const makePayment = useMutation(api.loans.makePayment);

    const rows = useMemo(() => {
        const all = (book?.page ?? []) as CreditRow[];
        const needle = search.trim().toLowerCase();
        if (!needle) return all;
        return all.filter(
            (row) =>
                row.customerName.toLowerCase().includes(needle) ||
                (row.invoiceNumber ?? "").toLowerCase().includes(needle)
        );
    }, [book, search]);

    const totals = book?.totals;

    const columns: DataTableColumn<CreditRow>[] = [
        {
            id: "customer",
            header: "Customer",
            accessor: (r) => r.customerName,
            cell: (r) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{r.customerName}</p>
                    {r.customerPhone ? (
                        <p className="truncate text-xs text-muted-foreground">
                            {r.customerPhone}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "invoice",
            header: "Sale",
            accessor: (r) => r.invoiceNumber ?? "",
            hideBelow: "md",
        },
        {
            id: "date",
            header: "Credit given",
            accessor: (r) => r.date,
            cell: (r) => shortDate(r.date),
        },
        {
            id: "dueDate",
            header: "Due",
            accessor: (r) => r.dueDate ?? "",
            cell: (r) => (r.dueDate ? shortDate(r.dueDate) : "—"),
        },
        {
            id: "amount",
            header: "Credit",
            accessor: (r) => r.amount,
            align: "right",
            cell: (r) => (
                <span className="tabular-nums">{formatMoney(r.amount, currency)}</span>
            ),
        },
        {
            id: "paid",
            header: "Paid",
            accessor: (r) => r.paid,
            align: "right",
            hideBelow: "lg",
            cell: (r) => (
                <span className="tabular-nums text-muted-foreground">
                    {formatMoney(r.paid, currency)}
                </span>
            ),
        },
        {
            id: "balance",
            header: "Owed",
            accessor: (r) => r.balance,
            align: "right",
            cell: (r) => (
                <span className="font-medium tabular-nums">
                    {formatMoney(r.balance, currency)}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (r) => r.status,
            width: "9rem",
            cell: (r) => (
                <div className="flex flex-col items-start gap-1">
                    <StatusBadge status={r.status} />
                    {r.overdue ? (
                        <span className="text-xs text-danger">
                            {r.daysOverdue} day{r.daysOverdue === 1 ? "" : "s"} late
                        </span>
                    ) : null}
                </div>
            ),
        },
        {
            id: "actions",
            header: "",
            width: "9rem",
            cell: (r) => (
                <div className="flex justify-end gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setViewing(r)}
                    >
                        {t("View")}
                    </Button>
                    {canManage && r.balance > 0 ? (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPaying(r)}
                        >
                            <Banknote className="mr-1.5 size-3.5" />
                            {t("Payment")}
                        </Button>
                    ) : null}
                </div>
            ),
        },
    ];

    const resetOrigination = () => {
        setCustomerId("");
        setSalesId("");
        setDueDate("");
        setDeposit("");
        setOriginError(null);
    };

    const handleOriginate = async () => {
        setOriginError(null);
        if (!customerId) {
            setOriginError("Choose the customer the credit is for.");
            return;
        }
        if (!salesId) {
            setOriginError("Choose the sale the credit is for.");
            return;
        }
        if (!dueDate) {
            setOriginError("Say when the credit falls due.");
            return;
        }
        const depositValue = Number(deposit) || 0;
        if (depositValue < 0) {
            setOriginError("A deposit cannot be negative.");
            return;
        }
        if (preview?.overLimit) {
            setOriginError(
                `${preview.customerName ?? "This customer"} is over their credit limit. Raise the limit before opening more credit.`
            );
            return;
        }

        setSubmitting(true);
        try {
            const result: any = await originate({
                customerId: customerId as Id<"customers">,
                salesId: salesId as Id<"sales">,
                deposit: depositValue || undefined,
                dueDate,
            });
            toast.success(
                `Credit opened: ${formatMoney(result.amount, currency)}. ${formatMoney(
                    result.balance,
                    currency
                )} is owed.`,
                { description: "The sale is now on the credit book." }
            );
            setOriginating(false);
            resetOrigination();
        } catch (err) {
            setOriginError(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const handlePayment = async (values: Record<string, string>) => {
        if (!paying) return;
        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Enter the amount that was paid.");
        }
        if (amount > paying.balance) {
            throw new Error(
                `That is more than the ${formatMoney(paying.balance, currency)} owed.`
            );
        }
        try {
            await makePayment({
                loanId: paying._id,
                amount,
                method: values.method,
                note: values.note?.trim() || undefined,
            });
            toast.success(
                `Payment of ${formatMoney(amount, currency)} recorded.`,
                { description: `${formatMoney(paying.balance - amount, currency)} is still owed.` }
            );
            setPaying(null);
        } catch (err) {
            toast.error(formatError(err));
            throw err;
        }
    };

    if (!canView) {
        return (
            <div className="space-y-6">
                <PageHeader
                    icon={CreditCard}
                    title={t("Credit book")}
                    description={t("What the business has given on credit, and what is still owed.")}
                />
                <SectionCard>
                    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
                        <p className="text-sm font-semibold text-foreground">
                            {t("You do not have access to the credit book")}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t("Ask the owner or an administrator for the &quot;view loans&quot; permission.")}
                        </p>
                    </div>
                </SectionCard>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <PageHeader
                icon={CreditCard}
                title={t("Credit book")}
                description={t("What the business has given on credit, what is still owed, and what is late.")}
                actions={
                    canManage ? (
                        <ActionButton
                            onClick={() => {
                                resetOrigination();
                                setOriginating(true);
                            }}
                        >
                            <Plus className="mr-2 size-4" />
                            {t("Give credit")}
                        </ActionButton>
                    ) : undefined
                }
                toolbar={
                    <Toolbar>
                        <ToolbarGroup>
                            <SearchBox
                                value={search}
                                onChange={setSearch}
                                placeholder={t("Search by customer or sale number…")}
                            />
                            <CountBadge>{rows.length}</CountBadge>
                        </ToolbarGroup>
                        <ToolbarGroup>
                            <DataTableExport
                                title={t("Credit book")}
                                rows={rows}
                                columns={columns}
                            />
                        </ToolbarGroup>
                    </Toolbar>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Outstanding")}
                    value={formatMoney(totals?.outstanding ?? 0, currency)}
                    hint={t("What the business is owed right now.")}
                />
                <StatCard
                    label={t("Due within 7 days")}
                    value={formatMoney(totals?.dueSoonAmount ?? 0, currency)}
                    tone={totals?.dueSoonCount ? "warning" : "default"}
                    hint={t("{0} credit(s) fall due this week.", {
            0: totals?.dueSoonCount ?? 0,
        })}
                />
                <StatCard
                    label={t("Overdue")}
                    value={formatMoney(totals?.overdueAmount ?? 0, currency)}
                    tone={totals?.overdueCount ? "danger" : "default"}
                    hint={t("{0} credit(s) are late.", {
            0: totals?.overdueCount ?? 0,
        })}
                />
                <StatCard
                    label={t("Longest overdue")}
                    value={
                        totals?.maxDaysOverdue
                            ? `${totals.maxDaysOverdue} day${
                                  totals.maxDaysOverdue === 1 ? "" : "s"
                              }`
                            : "—"
                    }
                    tone={totals?.maxDaysOverdue ? "danger" : "default"}
                    hint={t("The oldest credit that is still unpaid.")}
                />
            </StatGrid>

            <SectionCard
                title={t("Every credit")}
                description={t("The money the business is owed, newest first.")}
            >
                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={book === undefined}
                    isEmpty={rows.length === 0}
                    emptyTitle={t("No credit has been given")}
                    emptyHint={
                        canManage
                            ? "When a customer takes goods and will pay later, give the credit here and it lands on this page."
                            : "Nothing has been given on credit yet."
                    }
                    emptyAction={
                        canManage ? (
                            <Button
                                onClick={() => {
                                    resetOrigination();
                                    setOriginating(true);
                                }}
                            >
                                <Plus className="mr-2 size-4" />
                                {t("Give credit")}
                            </Button>
                        ) : undefined
                    }
                    defaultSort={{ id: "date", direction: "desc" }}
                />
            </SectionCard>

            {/* ───────────────────── give credit ───────────────────── */}
            <Dialog
                open={originating}
                onOpenChange={(open) => {
                    if (!open) setOriginating(false);
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{t("Give credit")}</DialogTitle>
                        <DialogDescription>
                            {t("Credit is opened on a sale that has not been paid. The amounts below are the server&apos;s own — the browser sends no figure of its own.")}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="credit-customer">{t("Customer")}</Label>
                            <Select
                                value={customerId}
                                onValueChange={(value) => {
                                    setCustomerId(value);
                                    setSalesId("");
                                }}
                            >
                                <SelectTrigger id="credit-customer" className="w-full">
                                    <SelectValue placeholder={t("Choose a customer…")} />
                                </SelectTrigger>
                                <SelectContent>
                                    {(customers ?? []).map((c: any) => (
                                        <SelectItem key={c._id} value={c._id}>
                                            {c.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="credit-sale">{t("Sale")}</Label>
                            <Select
                                value={salesId}
                                onValueChange={setSalesId}
                                disabled={!customerId}
                            >
                                <SelectTrigger id="credit-sale" className="w-full">
                                    <SelectValue
                                        placeholder={
                                            customerId
                                                ? "Choose the sale…"
                                                : "Choose a customer first"
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {(candidates ?? []).map((c: any) => (
                                        <SelectItem key={c.salesId} value={c.salesId}>
                                            {shortDate(c.date)} —{" "}
                                            {formatMoney(c.total, currency)}
                                            {c.invoiceNumber
                                                ? ` (${c.invoiceNumber})`
                                                : ""}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {customerId && (candidates ?? []).length === 0 ? (
                                <p className="text-xs text-muted-foreground">
                                    {t("This customer has no unpaid sale that credit can be opened on.")}
                                </p>
                            ) : null}
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="credit-due">{t("Falls due on")}</Label>
                                <Input
                                    id="credit-due"
                                    type="date"
                                    value={dueDate}
                                    onChange={(e) => setDueDate(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="credit-deposit">
                                    {t("Deposit taken now")}
                                </Label>
                                <Input
                                    id="credit-deposit"
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={deposit}
                                    onChange={(e) => setDeposit(e.target.value)}
                                    placeholder="0"
                                />
                            </div>
                        </div>

                        {preview ? (
                            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
                                <Eyebrow>{t("What the server will use")}</Eyebrow>
                                <dl className="mt-3 space-y-1.5 text-sm">
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-muted-foreground">
                                            {t("Credit issued")}
                                        </dt>
                                        <dd className="tabular-nums">
                                            {formatMoney(preview.amount, currency)}
                                        </dd>
                                    </div>
                                    {preview.taken > 0 ? (
                                        <div className="flex justify-between gap-4">
                                            <dt className="text-muted-foreground">
                                                {t("Deposit already taken")}
                                            </dt>
                                            <dd className="tabular-nums">
                                                −{formatMoney(preview.taken, currency)}
                                            </dd>
                                        </div>
                                    ) : null}
                                    {preview.deposit > 0 ? (
                                        <div className="flex justify-between gap-4">
                                            <dt className="text-muted-foreground">
                                                {t("Deposit now")}
                                            </dt>
                                            <dd className="tabular-nums">
                                                −{formatMoney(preview.deposit, currency)}
                                            </dd>
                                        </div>
                                    ) : null}
                                    <div className="flex justify-between gap-4 border-t border-border/70 pt-1.5">
                                        <dt className="font-medium">{t("Owed now")}</dt>
                                        <dd className="font-medium tabular-nums">
                                            {formatMoney(preview.balance, currency)}
                                        </dd>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                        <dt className="text-muted-foreground">
                                            {t("Already owed by this customer")}
                                        </dt>
                                        <dd className="tabular-nums">
                                            {formatMoney(preview.outstanding, currency)}
                                        </dd>
                                    </div>
                                    {preview.creditLimit > 0 ? (
                                        <div className="flex justify-between gap-4">
                                            <dt className="text-muted-foreground">
                                                {t("Credit limit")}
                                            </dt>
                                            <dd className="tabular-nums">
                                                {formatMoney(preview.creditLimit, currency)}
                                            </dd>
                                        </div>
                                    ) : null}
                                </dl>
                                {preview.overLimit ? (
                                    <p className="mt-3 flex items-start gap-2 text-xs text-danger">
                                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                                        {t("This customer would be over their credit limit. The server will refuse the credit.")}
                                    </p>
                                ) : null}
                            </div>
                        ) : null}

                        {originError ? (
                            <p
                                role="alert"
                                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
                            >
                                {originError}
                            </p>
                        ) : null}
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setOriginating(false)}
                            disabled={submitting}
                        >
                            {t("Cancel")}
                        </Button>
                        <Button onClick={handleOriginate} disabled={submitting}>
                            {submitting ? "Opening the credit…" : "Open the credit"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ───────────────────── take a payment ───────────────────── */}
            <FormDialog
                open={paying !== null}
                onOpenChange={(open) => {
                    if (!open) setPaying(null);
                }}
                title={t("Record a payment")}
                description={
                    paying
                        ? `${paying.customerName} owes ${formatMoney(
                              paying.balance,
                              currency
                          )}.`
                        : undefined
                }
                fields={PAYMENT_FIELDS}
                submitLabel="Record the payment"
                onSubmit={handlePayment}
            />

            <RecordDetail
                open={viewing !== null}
                onOpenChange={(open) => {
                    if (!open) setViewing(null);
                }}
                title={viewing?.customerName ?? "Credit"}
                description={viewing?.invoiceNumber ?? undefined}
                status={viewing?.status}
                rows={
                    viewing
                        ? [
                              { label: "Credit given", value: shortDate(viewing.date) },
                              {
                                  label: "Credit issued",
                                  value: formatMoney(viewing.amount, currency),
                              },
                              {
                                  label: "Paid",
                                  value: formatMoney(viewing.paid, currency),
                              },
                              {
                                  label: "Owed",
                                  value: formatMoney(viewing.balance, currency),
                              },
                              {
                                  label: "Falls due",
                                  value: viewing.dueDate
                                      ? shortDate(viewing.dueDate)
                                      : "No due date",
                              },
                              {
                                  label: "Days overdue",
                                  value: viewing.daysOverdue
                                      ? `${viewing.daysOverdue}`
                                      : "0",
                              },
                          ]
                        : []
                }
                footer={
                    viewing && canManage && viewing.balance > 0 ? (
                        <Button onClick={() => setPaying(viewing)}>
                            <Banknote className="mr-2 size-4" />
                            {t("Record a payment")}
                        </Button>
                    ) : undefined
                }
            />
        </div>
    );
}
