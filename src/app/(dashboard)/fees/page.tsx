"use client";

/**
 * SMART_BUZ — school fees.
 *
 * The screen a bursar works from: the invoices of a term, the money taken
 * against them, what is still owed, and how old each unpaid balance is.
 *
 * The figures on this screen are the server's. The browser asks for the
 * invoices and for the summary and is told what they are; it never adds up
 * a total of its own, because a total that two people compute two
 * different ways is a total the school cannot trust.
 *
 * The two money queries are read through `useQueries` rather than
 * `useQuery` on purpose: a query that fails takes the whole screen down
 * with it, and a bursar without the finance permission should still be able
 * to see the invoices they are chasing.
 */

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { toast } from "sonner";
import {
    AlertTriangle,
    Ban,
    GraduationCap,
    Plus,
    Receipt,
    ScrollText,
    Trash2,
    Users,
    Wallet,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    PageContainer,
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
    Toolbar,
    ToolbarGroup,
    CountBadge,
    DataState,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import {
    FormDialog,
    RecordActions,
    RecordDetail,
    StatusBadge,
    shortDate,
    today,
    type DetailRow,
    type FormField,
} from "@/components/vertical/ui-kit";
import { reportError } from "@/components/error-feedback";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

/* ────────────────────────────────────────────────────────────────────────
 * The shapes the server sends back
 * ──────────────────────────────────────────────────────────────────────── */

interface FeesSummary {
    term: string | null;
    terms: string[];
    invoiced: number;
    collected: number;
    outstanding: number;
    invoiceCount: number;
    studentsInArrears: number;
}

interface ArrearsBucket {
    key: string;
    label: string;
    count: number;
    amount: number;
}

interface FeeArrears {
    asOf: string;
    term: string | null;
    buckets: ArrearsBucket[];
    invoiceCount: number;
    totalOutstanding: number;
}

/** One line of an invoice, as the operator typed it in the dialog. */
interface LineDraft {
    description: string;
    amount: string;
    quantity: string;
}

const STATUS_FILTERS = [
    { value: "all", label: "Every status" },
    { value: "unpaid", label: "Unpaid" },
    { value: "partial", label: "Part paid" },
    { value: "overdue", label: "Overdue" },
    { value: "paid", label: "Paid" },
    { value: "void", label: "Void" },
];

const PAYMENT_METHODS = [
    { value: "cash", label: "Cash" },
    { value: "mobile_money", label: "Mobile money" },
    { value: "bank", label: "Bank transfer" },
    { value: "card", label: "Card" },
    { value: "cheque", label: "Cheque" },
];

/** When a bill is raised, it is normally due a month later. */
function defaultDueDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return date.toISOString().slice(0, 10);
}

export default function FeesPage() {
    
    const t = useT();const { currency } = useCurrency();

    const [termFilter, setTermFilter] = useState("all");
    const [statusFilter, setStatusFilter] = useState("all");
    const [searchTerm, setSearchTerm] = useState("");

    const [raiseOpen, setRaiseOpen] = useState(false);
    const [draftLines, setDraftLines] = useState<LineDraft[]>([]);

    const [payOpen, setPayOpen] = useState(false);
    const [payTarget, setPayTarget] = useState<FeeInvoice | null>(null);

    const [detailInvoice, setDetailInvoice] = useState<FeeInvoice | null>(null);
    const [statementMemberId, setStatementMemberId] = useState<Id<"members"> | null>(null);
    const [voidTarget, setVoidTarget] = useState<FeeInvoice | null>(null);

    /* ── the data ── */

    // The invoice list. Every business role may read a student's record, so
    // this query is the one that always answers.
    const invoices = useQuery(api.packages.education.listFeeInvoices, {
        term: termFilter === "all" ? undefined : termFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
    });
    type FeeInvoice = NonNullable<typeof invoices>[number];

    const students = useQuery(api.verticals.members.listMembers, {
        memberType: "student",
        limit: 500,
    });

    const statement = useQuery(
        api.packages.education.getStudentStatement,
        statementMemberId ? { memberId: statementMemberId } : "skip"
    );

    // The two money queries are read together so that a role without the
    // finance permission loses the figures and not the screen. The arguments
    // are kept in one memo so that the queries are only re-read when the
    // term actually changes.
    const summaryArgs = useMemo<Record<string, string>>(
        () =>
            termFilter === "all"
                ? ({} as Record<string, string>)
                : ({ term: termFilter } as Record<string, string>),
        [termFilter]
    );
    const money = useMemo(
        () => ({
            summary: {
                query: api.packages.education.getFeesSummary,
                args: summaryArgs,
            },
            arrears: {
                query: api.packages.education.getFeeArrears,
                args: {},
            },
        }),
        [summaryArgs]
    );
    const moneyResults = useQueries(money);

    const summaryError = moneyResults.summary instanceof Error ? moneyResults.summary : undefined;
    const arrearsError = moneyResults.arrears instanceof Error ? moneyResults.arrears : undefined;
    const summary = (summaryError ? undefined : moneyResults.summary) as
        | FeesSummary
        | undefined;
    const arrears = (arrearsError ? undefined : moneyResults.arrears) as
        | FeeArrears
        | undefined;

    const raiseInvoice = useMutation(api.packages.education.raiseFeeInvoice);
    const payInvoice = useMutation(api.packages.education.payFeeInvoice);
    const voidInvoice = useMutation(api.packages.education.voidFeeInvoice);

    /* ── the money on screen ── */

    const formatMoney = (amount: number) => `${currency} ${amount.toLocaleString()}`;

    const rows = useMemo(() => invoices ?? [], [invoices]);

    const terms = useMemo(() => {
        const fromServer = summary?.terms ?? [];
        if (fromServer.length > 0) return fromServer;
        return Array.from(new Set(rows.map((row) => row.term)));
    }, [summary?.terms, rows]);

    /* ── what the operator does ── */

    const openRaise = () => {
        setDraftLines([{ description: "", amount: "", quantity: "" }]);
        setRaiseOpen(true);
    };

    const handleRaise = async (values: Record<string, string>) => {
        const lines = draftLines
            .filter((line) => line.description.trim() !== "" || line.amount.trim() !== "")
            .map((line) => ({
                description: line.description.trim(),
                amount: Number(line.amount),
                quantity: line.quantity.trim() === "" ? undefined : Number(line.quantity),
            }));

        if (lines.length === 0) {
            throw new Error("Add at least one line to the invoice.");
        }

        const student = values.student && values.student !== "none" ? values.student : undefined;

        try {
            await raiseInvoice({
                memberId: student as Id<"members"> | undefined,
                payerName: values.payerName?.trim() ?? "",
                payerPhone: values.payerPhone?.trim() || undefined,
                term: values.term?.trim() ?? "",
                lines,
                dueDate: values.dueDate ?? "",
                notes: values.notes?.trim() || undefined,
            });
            toast.success("The fee invoice has been raised.");
            setRaiseOpen(false);
        } catch (error) {
            // The server's own sentence is the one the bursar needs, and the
            // dialog stays open so the lines they typed are not lost.
            reportError(error, "The invoice could not be raised.");
            throw error;
        }
    };

    const openPay = (invoice: FeeInvoice) => {
        setPayTarget(invoice);
        setPayOpen(true);
    };

    const handlePay = async (values: Record<string, string>) => {
        if (!payTarget) return;

        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Enter the amount that was paid.");
        }

        try {
            const receipt = await payInvoice({
                invoiceId: payTarget._id,
                amount,
                method: values.method,
                reference: values.reference?.trim() || undefined,
                date: values.date || undefined,
            });
            toast.success(
                `Payment recorded — receipt ${receipt.receiptNumber}. ${formatMoney(receipt.balanceAfter)} still outstanding.`
            );
            setPayOpen(false);
            setPayTarget(null);
        } catch (error) {
            reportError(error, "The payment could not be recorded.");
            throw error;
        }
    };

    const handleVoid = async () => {
        if (!voidTarget) return;
        try {
            await voidInvoice({ invoiceId: voidTarget._id });
            toast.success("The invoice has been voided.");
            setVoidTarget(null);
        } catch (error) {
            reportError(error, "The invoice could not be voided.");
        }
    };

    const openStatement = (memberId: Id<"members">) => {
        setDetailInvoice(null);
        setStatementMemberId(memberId);
    };

    /* ── the form ── */

    const studentOptions = [
        { value: "none", label: "No student record" },
        ...(students ?? []).map((student) => ({
            value: student._id as string,
            label: `${student.name} · ${student.memberNumber}`,
        })),
    ];

    const raiseFields: FormField[] = [
        {
            name: "term",
            label: "Term",
            type: "text",
            required: true,
            placeholder: "Term 1 2026",
            defaultValue: termFilter !== "all" ? termFilter : summary?.term ?? "",
            hint: "The term this invoice bills for.",
        },
        {
            name: "student",
            label: "Student",
            type: "select",
            options: studentOptions,
            defaultValue: "none",
            hint: "Link the bill to a student record to give them a statement.",
        },
        {
            name: "payerName",
            label: "Who is paying",
            type: "text",
            placeholder: "Parent or guardian",
            hint: "Leave empty to bill the student.",
        },
        {
            name: "payerPhone",
            label: "Phone",
            type: "tel",
            placeholder: "07…",
        },
        {
            name: "dueDate",
            label: "Due date",
            type: "date",
            required: true,
            defaultValue: defaultDueDate(),
        },
        {
            name: "notes",
            label: "Notes",
            type: "textarea",
            full: true,
            placeholder: "Anything the bursar should know about this bill.",
        },
    ];

    const payFields: FormField[] = [
        {
            name: "amount",
            label: `Amount paid (${currency})`,
            type: "number",
            required: true,
            min: 0,
            step: 0.01,
        },
        {
            name: "method",
            label: "Paid by",
            type: "select",
            required: true,
            options: PAYMENT_METHODS,
            defaultValue: "cash",
        },
        {
            name: "reference",
            label: "Reference",
            type: "text",
            placeholder: "Mobile money or cheque reference",
        },
        {
            name: "date",
            label: "Date received",
            type: "date",
            defaultValue: today(),
        },
    ];

    /* ── the tables ── */

    const columns: DataTableColumn<FeeInvoice>[] = [
        {
            id: "payer",
            header: "Student",
            accessor: (row) => row.payerName,
            cell: (row) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{row.payerName}</p>
                    {row.memberName ? (
                        <p className="truncate text-xs text-muted-foreground">
                            {row.memberName}
                        </p>
                    ) : (
                        <p className="truncate text-xs text-muted-foreground">
                            {t("No student record")}
                        </p>
                    )}
                </div>
            ),
        },
        {
            id: "term",
            header: "Term",
            accessor: (row) => row.term,
            cell: (row) => <span className="text-sm">{row.term}</span>,
        },
        {
            id: "dueDate",
            header: "Due",
            accessor: (row) => row.dueDate,
            cell: (row) => (
                <div>
                    <p className="tabular-nums">{shortDate(row.dueDate)}</p>
                    {row.daysOverdue > 0 ? (
                        <p className="text-xs font-medium text-danger">
                            {row.daysOverdue} days late
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "total",
            header: `Total (${currency})`,
            accessor: (row) => row.total,
            align: "right",
            cell: (row) => <span className="tabular-nums">{row.total.toLocaleString()}</span>,
        },
        {
            id: "amountPaid",
            header: `Paid (${currency})`,
            accessor: (row) => row.amountPaid,
            align: "right",
            hideBelow: "md",
            cell: (row) => (
                <span className="tabular-nums text-muted-foreground">
                    {row.amountPaid.toLocaleString()}
                </span>
            ),
        },
        {
            id: "balance",
            header: `Balance (${currency})`,
            accessor: (row) => row.balance,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">{row.balance.toLocaleString()}</span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (row) => row.status,
            cell: (row) => <StatusBadge status={row.status} />,
        },
        {
            id: "actions",
            header: "",
            sortable: false,
            align: "right",
            excludeFromSearch: true,
            cell: (row) => (
                <div className="flex items-center justify-end gap-1">
                    {row.status !== "void" && row.balance > 0 ? (
                        <Button variant="outline" size="sm" onClick={() => openPay(row)}>
                            {t("Record payment")}
                        </Button>
                    ) : null}
                    <RecordActions
                        label={t("Actions for {0}", {
            0: row.payerName,
        })}
                        onView={() => setDetailInvoice(row)}
                    />
                </div>
            ),
        },
    ];

    const ageingRows: ArrearsBucket[] = arrears?.buckets ?? [];

    const ageingColumns: DataTableColumn<ArrearsBucket>[] = [
        {
            id: "label",
            header: "How old it is",
            accessor: (row) => row.label,
            cell: (row) => <span className="font-medium">{t(row.label)}</span>,
        },
        {
            id: "count",
            header: "Invoices",
            accessor: (row) => row.count,
            align: "right",
            cell: (row) => <span className="tabular-nums">{row.count}</span>,
        },
        {
            id: "amount",
            header: `Amount (${currency})`,
            accessor: (row) => row.amount,
            align: "right",
            cell: (row) => (
                <span className="font-semibold tabular-nums">{row.amount.toLocaleString()}</span>
            ),
        },
    ];

    /* ── the panels ── */

    const detailRows: DetailRow[] = detailInvoice
        ? [
              { label: "Student", value: detailInvoice.memberName ?? "No student record" },
              { label: "Paid by", value: detailInvoice.payerName },
              { label: "Phone", value: detailInvoice.payerPhone ?? "—" },
              { label: "Term", value: detailInvoice.term },
              { label: "Due", value: shortDate(detailInvoice.dueDate) },
              { label: "Total", value: formatMoney(detailInvoice.total) },
              { label: "Paid", value: formatMoney(detailInvoice.amountPaid) },
              { label: "Balance", value: formatMoney(detailInvoice.balance) },
              {
                  label: "Days late",
                  value: detailInvoice.daysOverdue > 0 ? detailInvoice.daysOverdue : "—",
              },
              {
                  label: "Charged for",
                  value: (
                      <ul className="space-y-1 text-right">
                          {detailInvoice.lines.map((line, index) => (
                              <li key={`${line.description}-${index}`}>
                                  <span className="block">{t(line.description)}</span>
                                  <span className="text-xs text-muted-foreground">
                                      {line.quantity ? `${line.quantity} × ` : ""}
                                      {formatMoney(line.amount)}
                                  </span>
                              </li>
                          ))}
                      </ul>
                  ),
              },
              { label: "Raised", value: shortDate(detailInvoice.createdAt) },
              { label: "Notes", value: detailInvoice.notes ?? "—" },
          ]
        : [];

    const statementRows: DetailRow[] = statement
        ? [
              { label: "Student", value: statement.student.name },
              { label: "Member number", value: statement.student.memberNumber },
              { label: "Phone", value: statement.student.phone ?? "—" },
              { label: "Invoiced", value: formatMoney(statement.totals.invoiced) },
              { label: "Paid", value: formatMoney(statement.totals.paid) },
              { label: "Owed", value: formatMoney(statement.totals.owed) },
              {
                  label: "In arrears",
                  value: `${statement.totals.overdueCount} ${
                      statement.totals.overdueCount === 1 ? "bill" : "bills"
                  }`,
              },
              {
                  label: "Bills",
                  value: statement.invoices.length === 0 ? (
                      <span className="text-muted-foreground">{t("No bills raised yet")}</span>
                  ) : (
                      <ul className="space-y-2 text-right">
                          {statement.invoices.map((invoice) => (
                              <li key={invoice._id}>
                                  <span className="block font-medium">{invoice.term}</span>
                                  <span className="text-xs text-muted-foreground">
                                      {t("Due")} {shortDate(invoice.dueDate)} ·{" "}
                                      {formatMoney(invoice.balance)} {t("outstanding ·")}{" "}
                                      {invoice.status}
                                  </span>
                              </li>
                          ))}
                      </ul>
                  ),
              },
              {
                  label: "Payments",
                  value: statement.payments.length === 0 ? (
                      <span className="text-muted-foreground">{t("Nothing paid yet")}</span>
                  ) : (
                      <ul className="space-y-2 text-right">
                          {statement.payments.map((payment, index) => (
                              <li key={`${payment.receiptNumber}-${index}`}>
                                  <span className="block font-medium">
                                      {formatMoney(payment.amount)}
                                  </span>
                                  <span className="text-xs text-muted-foreground">
                                      {payment.receiptNumber ?? "Receipt"} ·{" "}
                                      {shortDate(payment.date)}
                                      {payment.method ? ` · ${payment.method}` : ""}
                                  </span>
                              </li>
                          ))}
                      </ul>
                  ),
              },
          ]
        : [];

    /* ── the screen ── */

    return (
        <PageContainer>
            <PageHeader
                eyebrow="Education"
                title={t("Fees")}
                description={t("What each term's fees are, what has been paid against them, and what is still owed.")}
                icon={GraduationCap}
                badge={<CountBadge tone="neutral">{rows.length}</CountBadge>}
                actions={
                    <>
                        <DataTableExport
                            title={t("Fee invoices")}
                            subtitle={summary?.term ? summary.term : undefined}
                            rows={rows}
                            columns={columns}
                        />
                        <Button onClick={openRaise}>
                            <Plus className="mr-2 size-4" /> {t("Raise invoice")}
                        </Button>
                    </>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Invoiced this term")}
                    value={summary ? formatMoney(summary.invoiced) : "—"}
                    hint={summary?.term ? `For ${summary.term}` : "No term billed yet"}
                    icon={Receipt}
                    tone="default"
                    isLoading={summary === undefined && !summaryError}
                />
                <StatCard
                    label={t("Collected this term")}
                    value={summary ? formatMoney(summary.collected) : "—"}
                    hint={t("Taken against this term's invoices")}
                    icon={Wallet}
                    tone="success"
                    isLoading={summary === undefined && !summaryError}
                />
                <StatCard
                    label={t("Outstanding")}
                    value={summary ? formatMoney(summary.outstanding) : "—"}
                    hint={t("Still owed on this term's invoices")}
                    icon={AlertTriangle}
                    tone="danger"
                    isLoading={summary === undefined && !summaryError}
                />
                <StatCard
                    label={t("Students in arrears")}
                    value={summary ? summary.studentsInArrears : "—"}
                    hint={t("With a bill past its due date")}
                    icon={Users}
                    tone="warning"
                    isLoading={summary === undefined && !summaryError}
                />
            </StatGrid>

            <SectionCard
                title={t("Fee invoices")}
                description={
                    summary?.term
                        ? `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"} for ${summary.term}.`
                        : `${rows.length} ${rows.length === 1 ? "invoice" : "invoices"}.`
                }
                padded={false}
            >
                <div className="border-b border-border/60 p-4 sm:p-5">
                    <Toolbar>
                        <ToolbarGroup>
                            <Select value={termFilter} onValueChange={setTermFilter}>
                                <SelectTrigger className="h-9 w-[170px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">{t("Every term")}</SelectItem>
                                    {terms.map((term) => (
                                        <SelectItem key={term} value={term}>
                                            {term}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="h-9 w-[170px]">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {STATUS_FILTERS.map((status) => (
                                        <SelectItem key={status.value} value={status.value}>
                                            {t(status.label)}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </ToolbarGroup>

                        <div className="relative sm:w-72">
                            <Input
                                placeholder={t("Search invoices…")}
                                value={searchTerm}
                                onChange={(event) => setSearchTerm(event.target.value)}
                                className="h-9"
                            />
                        </div>
                    </Toolbar>
                </div>

                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={invoices === undefined}
                    isEmpty={invoices !== undefined && rows.length === 0}
                    emptyTitle={t("No fee invoices yet")}
                    emptyHint={t("Raise an invoice for a term and the bill, the balance and the ageing start from there.")}
                    emptyAction={
                        <Button variant="outline" size="sm" onClick={openRaise}>
                            <Plus className="mr-2 size-4" /> {t("Raise invoice")}
                        </Button>
                    }
                    searchTerm={searchTerm}
                    pageSize={25}
                    defaultSort={{ id: "dueDate", direction: "asc" }}
                    ariaLabel="Fee invoices"
                    className="px-4 pb-5 sm:px-5"
                />
            </SectionCard>

            <SectionCard
                title={t("Arrears ageing")}
                description={
                    arrears
                        ? `${formatMoney(arrears.totalOutstanding)} outstanding across ${arrears.invoiceCount} ${
                              arrears.invoiceCount === 1 ? "invoice" : "invoices"
                          }, every term.`
                        : "What is owed, and how long it has been owed."
                }
                actions={
                    <DataTableExport
                        title={t("Arrears ageing")}
                        subtitle={arrears ? `As at ${shortDate(arrears.asOf)}` : undefined}
                        rows={ageingRows}
                        columns={ageingColumns}
                    />
                }
            >
                <DataState
                    isLoading={arrears === undefined && !arrearsError}
                    error={arrearsError}
                    isEmpty={arrears !== undefined && ageingRows.length === 0}
                    emptyTitle={t("Nothing to age yet")}
                    emptyHint={t("Raise an invoice and the balances will be aged here.")}
                >
                    <DataTable
                        data={ageingRows}
                        columns={ageingColumns}
                        getRowId={(row) => row.key}
                        isLoading={arrears === undefined}
                        isEmpty={arrears !== undefined && ageingRows.length === 0}
                        emptyTitle={t("Nothing to age yet")}
                        emptyHint={t("Raise an invoice and the balances will be aged here.")}
                        pageSize={0}
                        ariaLabel="Arrears ageing"
                    />
                </DataState>
            </SectionCard>

            {/* Raising an invoice — the lines are typed here, because what a
                school charges is not a price list but a bill. */}
            <FormDialog
                open={raiseOpen}
                onOpenChange={setRaiseOpen}
                title={t("Raise a fee invoice")}
                description={t("Charge a student for a term. The server adds the lines up and works out the balance and the status.")}
                fields={raiseFields}
                onSubmit={handleRaise}
                submitLabel="Raise invoice"
            >
                <div className="space-y-3 rounded-xl border border-border/70 p-4">
                    <div className="flex items-center justify-between gap-2">
                        <Label>{t("What is being charged")}</Label>
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                setDraftLines((lines) => [
                                    ...lines,
                                    { description: "", amount: "", quantity: "" },
                                ])
                            }
                        >
                            <Plus className="mr-2 size-4" /> {t("Add line")}
                        </Button>
                    </div>

                    {draftLines.map((line, index) => (
                        <div
                            key={index}
                            className="grid grid-cols-12 items-center gap-2"
                        >
                            <Input
                                className="col-span-12 sm:col-span-5"
                                placeholder={t("Tuition")}
                                aria-label={t("Line {0} description", {
            0: index + 1,
        })}
                                value={t(line.description)}
                                onChange={(event) =>
                                    setDraftLines((lines) =>
                                        lines.map((current, position) =>
                                            position === index
                                                ? {
                                                      ...current,
                                                      description: event.target.value,
                                                  }
                                                : current
                                        )
                                    )
                                }
                            />
                            <Input
                                className="col-span-5 sm:col-span-2"
                                type="number"
                                min={0}
                                placeholder={t("Qty")}
                                aria-label={t("Line {0} quantity", {
            0: index + 1,
        })}
                                value={line.quantity}
                                onChange={(event) =>
                                    setDraftLines((lines) =>
                                        lines.map((current, position) =>
                                            position === index
                                                ? {
                                                      ...current,
                                                      quantity: event.target.value,
                                                  }
                                                : current
                                        )
                                    )
                                }
                            />
                            <Input
                                className="col-span-6 sm:col-span-4"
                                type="number"
                                min={0}
                                placeholder={t("Amount")}
                                aria-label={t("Line {0} amount", {
            0: index + 1,
        })}
                                value={line.amount}
                                onChange={(event) =>
                                    setDraftLines((lines) =>
                                        lines.map((current, position) =>
                                            position === index
                                                ? {
                                                      ...current,
                                                      amount: event.target.value,
                                                  }
                                                : current
                                        )
                                    )
                                }
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={t("Remove line {0}", {
            0: index + 1,
        })}
                                onClick={() =>
                                    setDraftLines((lines) =>
                                        lines.length === 1
                                            ? lines
                                            : lines.filter((_, position) => position !== index)
                                    )
                                }
                            >
                                <Trash2 className="size-4" />
                            </Button>
                        </div>
                    ))}

                    <p className="text-xs text-muted-foreground">
                        {t("The amount is for one item. A quantity multiplies it. The server adds the lines up and works out the total, the balance and the status.")}
                    </p>
                </div>
            </FormDialog>

            {/* Taking a payment against a bill. */}
            <FormDialog
                open={payOpen}
                onOpenChange={setPayOpen}
                title={t("Record a payment")}
                description={
                    payTarget
                        ? `${payTarget.payerName} — ${payTarget.term}. ${formatMoney(
                              payTarget.balance
                          )} outstanding.`
                        : "Take a payment against a fee invoice."
                }
                fields={payFields}
                initialValues={
                    payTarget ? { amount: String(payTarget.balance), method: "cash" } : undefined
                }
                onSubmit={handlePay}
                submitLabel="Record payment"
            />

            {/* The invoice on file. */}
            <RecordDetail
                open={detailInvoice !== null}
                onOpenChange={(open) => !open && setDetailInvoice(null)}
                title={detailInvoice?.payerName ?? "Invoice"}
                description={detailInvoice ? detailInvoice.term : undefined}
                status={detailInvoice?.status}
                rows={detailRows}
                footer={
                    detailInvoice ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                            {detailInvoice.memberId ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openStatement(detailInvoice.memberId!)}
                                >
                                    <ScrollText className="mr-2 size-4" /> {t("Student statement")}
                                </Button>
                            ) : null}
                            {detailInvoice.status !== "void" && detailInvoice.balance > 0 ? (
                                <Button
                                    size="sm"
                                    onClick={() => {
                                        const invoice = detailInvoice;
                                        setDetailInvoice(null);
                                        openPay(invoice);
                                    }}
                                >
                                    {t("Record payment")}
                                </Button>
                            ) : null}
                            {detailInvoice.status !== "void" ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setVoidTarget(detailInvoice)}
                                >
                                    <Ban className="mr-2 size-4" /> {t("Void invoice")}
                                </Button>
                            ) : null}
                        </div>
                    ) : null
                }
            />

            {/* One student's account, written for a parent to read. */}
            <RecordDetail
                open={statementMemberId !== null}
                onOpenChange={(open) => !open && setStatementMemberId(null)}
                title={statement?.student.name ?? "Statement"}
                description={t("What this student has been billed, what they have paid and what they owe.")}
                rows={statementRows}
            />

            {/* Voiding is confirmed, not assumed — and it is named. */}
            <AlertDialog
                open={voidTarget !== null}
                onOpenChange={(open) => !open && setVoidTarget(null)}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {t("Void this invoice for")} {voidTarget?.payerName}?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("The invoice stays on file and stops counting towards what is owed. An invoice that has money against it cannot be voided.")}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>{t("Keep it")}</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(event) => {
                                event.preventDefault();
                                void handleVoid();
                            }}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {t("Void invoice")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </PageContainer>
    );
}
