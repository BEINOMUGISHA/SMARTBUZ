"use client";

/**
 * SMART_BUZ — Members & Accounts
 *
 * The community desk: SACCO members and share accounts, school students,
 * gym subscriptions, church congregations, NGO beneficiaries and real-estate
 * tenants — each with a running balance and a full transaction ledger.
 *
 * A member's identity can be amended and inspected here; the balance and the
 * share count can only move through a transaction, so they are never
 * editable. A member with history on record cannot be deleted.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    SearchBox,
    LoadingState,
    EmptyState,
    FormDialog,
    EditFormDialog,
    ConfirmDeleteDialog,
    RecordDetail,
    RecordActions,
    CreateButton,
    ugx,
    shortDate,
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { reportError } from "@/components/error-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UsersRound, Wallet, History, X } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

const TX_TYPES = [
    { value: "deposit", label: "Deposit / Savings" },
    { value: "withdrawal", label: "Withdrawal" },
    { value: "share_purchase", label: "Share purchase" },
    { value: "loan", label: "Loan disbursement" },
    { value: "repayment", label: "Loan repayment" },
    { value: "fee", label: "Fee / charge" },
    { value: "refund", label: "Refund" },
];

const MEMBER_TYPES = [
    { value: "shareholder", label: "Shareholder" },
    { value: "saver", label: "Saver" },
    { value: "student", label: "Student" },
    { value: "beneficiary", label: "Beneficiary" },
    { value: "tenant", label: "Tenant" },
    { value: "member", label: "Member" },
];

const MEMBER_STATUSES = [
    { value: "active", label: "Active" },
    { value: "dormant", label: "Dormant" },
    { value: "exited", label: "Exited" },
];

export default function MembersPage() {
    
    const tr = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [txOpen, setTxOpen] = useState(false);
    const [selected, setSelected] = useState<any>(null);
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const members = useQuery(api.verticals.members.listMembers, {
        search: search || undefined,
        limit: 200,
    });
    const summary = useQuery(api.verticals.members.getMembersSummary, {});
    const transactions = useQuery(
        api.verticals.members.listMemberTransactions,
        selected ? { memberId: selected._id, limit: 50 } : "skip"
    );

    const createMember = useMutation(api.verticals.members.createMember);
    const recordTx = useMutation(api.verticals.members.recordMemberTransaction);
    const updateMember = useMutation(api.verticals.members.updateMember);
    const deleteMember = useMutation(api.verticals.members.deleteMember);

    const createFields: FormField[] = [
        { name: "name", label: "Full name", required: true },
        { name: "phone", label: "Phone", type: "tel", placeholder: "0772 123 456" },
        { name: "email", label: "Email", type: "email" },
        {
            name: "memberType",
            label: "Member type",
            type: "select",
            options: MEMBER_TYPES,
        },
        { name: "openingBalance", label: `Opening balance (${currency})`, type: "number", min: 0 },
        { name: "shares", label: `Shares held (${currency})`, type: "number", min: 0 },
    ];

    const editFields: FormField[] = [
        { name: "name", label: "Full name", required: true },
        { name: "phone", label: "Phone", type: "tel" },
        { name: "email", label: "Email", type: "email" },
        { name: "memberType", label: "Member type", type: "select", options: MEMBER_TYPES },
        { name: "status", label: "Status", type: "select", options: MEMBER_STATUSES },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createMember({
            name: values.name,
            phone: values.phone || undefined,
            email: values.email || undefined,
            memberType: values.memberType || undefined,
            openingBalance: values.openingBalance
                ? Number(values.openingBalance)
                : undefined,
            shares: values.shares ? Number(values.shares) : undefined,
            userId: user._id,
        });
        toast.success("Member added");
    };

    const handleTx = async (values: Record<string, string>) => {
        if (!user || !selected) return;
        await recordTx({
            memberId: selected._id,
            type: values.type,
            amount: Number(values.amount),
            reference: values.reference || undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Transaction recorded");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateMember({
                id: editRow._id,
                name: values.name,
                phone: values.phone || undefined,
                email: values.email || undefined,
                memberType: values.memberType || undefined,
                status: values.status || undefined,
                notes: values.notes || undefined,
                userId: user._id,
            });
            toast.success("Member updated");
        } catch (err) {
            reportError(err, "Could not update the member.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteMember({ id: deleteRow._id, userId: user._id });
            toast.success("Member deleted");
        } catch (err) {
            reportError(err, "Could not delete the member.");
            throw err;
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "name",
            header: "Member",
            accessor: (m: any) => m.name ?? "",
            cell: (m: any) => (
                <div className="flex items-center gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                        {String(m.name ?? "").trim().charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{m.name}</p>
                        <p className="text-xs text-muted-foreground">
                            {m.memberNumber}
                            {m.phone ? ` · ${m.phone}` : ""}
                        </p>
                    </div>
                </div>
            ),
        },
        {
            id: "memberType",
            header: "Type",
            accessor: (m: any) => m.memberType ?? "",
            cell: (m: any) => m.memberType || "—",
            hideBelow: "sm",
        },
        {
            id: "balance",
            header: "Balance",
            accessor: (m: any) => m.balance ?? 0,
            align: "right",
            cell: (m: any) => (
                <span className="tabular-nums">{ugx(m.balance ?? 0)}</span>
            ),
        },
        {
            id: "shares",
            header: "Shares",
            accessor: (m: any) => m.shares ?? 0,
            align: "right",
            hideBelow: "lg",
            cell: (m: any) => (
                <span className="tabular-nums text-muted-foreground">
                    {ugx(m.shares ?? 0)}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (m: any) => m.status ?? "",
            cell: (m: any) => <StatusBadge status={m.status ?? "active"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "8rem",
            cell: (m: any) => (
                <div className="flex items-center justify-end">
                    <RecordActions
                        onView={() => setDetailRow(m)}
                        onEdit={() => setEditRow(m)}
                        onDelete={() => setDeleteRow(m)}
                        label={tr("Actions for {0}", {
            0: m.name,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={UsersRound}
                title={tr("Members & Accounts")}
                description={tr("Manage members, savings, shares and loans with a full account ledger.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={tr("Add member")} />}
            />

            {summary && (
                <StatStrip
                    stats={[
                        { label: "Total members", value: summary.totalMembers },
                        { label: "Active", value: summary.activeMembers, tone: "good" },
                        { label: "Total savings", value: ugx(summary.totalBalance), tone: "good" },
                        { label: "Total shares", value: ugx(summary.totalShares) },
                    ]}
                />
            )}

            <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
                <div className="space-y-4">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder={tr("Search name, member number or phone…")}
                    />

                    {!members ? (
                        <LoadingState />
                    ) : (
                        <DataTable
                            data={members}
                            columns={columns}
                            getRowId={(row: any) => row._id}
                            searchTerm={search}
                            onRowClick={(row: any) => setSelected(row)}
                            defaultSort={{ id: "name", direction: "asc" }}
                            emptyTitle={tr("No members yet")}
                            emptyHint={tr("Add your first member to start tracking savings, shares and loan balances.")}
                            ariaLabel="Members"
                            caption={tr("{0} member(s). Select a row to open their statement.", {
            0: members.length,
        })}
                        />
                    )}
                </div>

                {/* Member detail panel */}
                <div className="space-y-4">
                    {selected ? (
                        <Card className="sticky top-4">
                            <CardContent className="space-y-4 p-5">
                                <div className="flex items-start justify-between gap-2">
                                    <div>
                                        <p className="text-lg font-semibold">{selected.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {selected.memberNumber}
                                            {selected.phone ? ` · ${selected.phone}` : ""}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => setSelected(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                <Separator />

                                <div className="grid grid-cols-2 gap-3">
                                    <div className="rounded-lg bg-muted/50 p-3">
                                        <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                            {tr("Balance")}
                                        </p>
                                        <p className="text-lg font-semibold tabular-nums">
                                            {ugx(selected.balance)}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 p-3">
                                        <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                            {tr("Shares")}
                                        </p>
                                        <p className="text-lg font-semibold tabular-nums">
                                            {ugx(selected.shares ?? 0)}
                                        </p>
                                    </div>
                                </div>

                                <Button className="w-full" onClick={() => setTxOpen(true)}>
                                    <Wallet className="mr-2 h-4 w-4" />
                                    {tr("Record transaction")}
                                </Button>

                                <div>
                                    <p className="mb-2 flex items-center gap-1.5 text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                        <History className="h-3.5 w-3.5" /> {tr("Statement")}
                                    </p>
                                    {!transactions ? (
                                        <LoadingState rows={2} />
                                    ) : transactions.length === 0 ? (
                                        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                            {tr("No transactions yet.")}
                                        </p>
                                    ) : (
                                        <ul className="max-h-72 space-y-1.5 overflow-y-auto">
                                            {transactions.map((t: any) => (
                                                <li
                                                    key={t._id}
                                                    className="flex items-center justify-between rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                                                >
                                                    <div className="min-w-0">
                                                        <p className="truncate font-semibold capitalize">
                                                            {String(t.type).replace(/_/g, " ")}
                                                        </p>
                                                        <p className="text-eyebrow text-muted-foreground">
                                                            {shortDate(t.date)}
                                                        </p>
                                                    </div>
                                                    <div className="shrink-0 text-right">
                                                        <p
                                                            className={cnAmt(
                                                                ["deposit", "share_purchase", "loan", "repayment", "refund"].includes(
                                                                    t.type
                                                                )
                                                            )}
                                                        >
                                                            {["deposit", "share_purchase", "loan", "repayment", "refund"].includes(
                                                                t.type
                                                            )
                                                                ? "+"
                                                                : "−"}
                                                            {ugx(t.amount)}
                                                        </p>
                                                        <p className="text-eyebrow text-muted-foreground">
                                                            bal {ugx(t.balanceAfter)}
                                                        </p>
                                                    </div>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    ) : (
                        <Card className="border-dashed">
                            <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                                <Wallet className="h-8 w-8 text-muted-foreground opacity-40" />
                                <p className="text-sm font-bold">{tr("Select a member")}</p>
                                <p className="text-xs text-muted-foreground">
                                    {tr("Choose someone from the list to view their balance, shares and full transaction statement.")}
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={tr("Add member")}
                description={tr("The member number is generated automatically if you leave it blank.")}
                submitLabel="Add member"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <FormDialog
                open={txOpen}
                onOpenChange={setTxOpen}
                title={tr("Record transaction{0}", {
            0: selected ? ` — ${selected.name}` : "",
        })}
                description={tr("Withdrawals and repayments are checked against the available balance.")}
                submitLabel="Record"
                fields={[
                    { name: "type", label: "Type", type: "select", required: true, options: TX_TYPES, full: true },
                    { name: "amount", label: `Amount (${currency})`, type: "number", required: true, min: 1 },
                    { name: "reference", label: "Reference" },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleTx}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={tr("Edit member")}
                description={tr("The balance and the share count are not editable — they move through transactions.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.name ?? "Member"}
                description={detailRow?.memberNumber}
                status={detailRow?.status}
                rows={[
                    { label: "Member number", value: detailRow?.memberNumber ?? "—" },
                    { label: "Name", value: detailRow?.name ?? "—" },
                    { label: "Phone", value: detailRow?.phone ?? "—" },
                    { label: "Email", value: detailRow?.email ?? "—" },
                    { label: "Member type", value: detailRow?.memberType ?? "—" },
                    { label: "Status", value: detailRow?.status ?? "—" },
                    { label: "Balance", value: ugx(detailRow?.balance ?? 0) },
                    { label: "Shares", value: ugx(detailRow?.shares ?? 0) },
                    { label: "Joined", value: shortDate(detailRow?.joinedDate) },
                    { label: "Notes", value: detailRow?.notes ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="member"
                description={
                    deleteRow
                        ? `This removes ${deleteRow.name} (${deleteRow.memberNumber}) permanently. A member with transactions, enrolments or attendance on record cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}

/* Small local helpers to keep the file readable. */
function cnAmt(credit: boolean): string {
    return `text-sm font-semibold tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`;
}
