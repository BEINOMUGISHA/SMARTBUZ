"use client";

/**
 * SMART_BUZ — Members & Accounts
 *
 * The community desk: SACCO members and share accounts, school students,
 * gym subscriptions, church congregations, NGO beneficiaries and real-estate
 * tenants — each with a running balance and a full transaction ledger.
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
    CreateButton,
    RecordList,
    ugx,
    shortDate,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UsersRound, Plus, Wallet, History, X } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

const TX_TYPES = [
    { value: "deposit", label: "Deposit / Savings" },
    { value: "withdrawal", label: "Withdrawal" },
    { value: "share_purchase", label: "Share purchase" },
    { value: "loan", label: "Loan disbursement" },
    { value: "repayment", label: "Loan repayment" },
    { value: "fee", label: "Fee / charge" },
    { value: "refund", label: "Refund" },
];

export default function MembersPage() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [txOpen, setTxOpen] = useState(false);
    const [selected, setSelected] = useState<any>(null);

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

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={UsersRound}
                title="Members & Accounts"
                description="Manage members, savings, shares and loans with a full account ledger."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="Add member" />}
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
                        placeholder="Search name, member number or phone…"
                    />

                    {!members ? (
                        <LoadingState />
                    ) : members.length === 0 ? (
                        <EmptyState
                            title="No members yet"
                            hint="Add your first member to start tracking savings, shares and loan balances."
                        />
                    ) : (
                        <RecordList
                            records={members}
                            renderItem={(m: any) => (
                                <button
                                    type="button"
                                    onClick={() => setSelected(m)}
                                    className={cnRow(selected?._id === m._id)}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-black text-primary">
                                            {m.name.charAt(0)}
                                        </div>
                                        <div className="min-w-0 flex-1 text-left">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="truncate font-black">{m.name}</p>
                                                <StatusBadge status={m.status ?? "active"} />
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {m.memberNumber}
                                                {m.phone ? ` · ${m.phone}` : ""}
                                                {m.memberType ? ` · ${m.memberType}` : ""}
                                            </p>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <p className="text-sm font-black tabular-nums">
                                                {ugx(m.balance)}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                balance
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            )}
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
                                        <p className="text-lg font-black">{selected.name}</p>
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
                                        <p className="text-[10px] font-bold uppercase text-muted-foreground">
                                            Balance
                                        </p>
                                        <p className="text-lg font-black tabular-nums">
                                            {ugx(selected.balance)}
                                        </p>
                                    </div>
                                    <div className="rounded-lg bg-muted/50 p-3">
                                        <p className="text-[10px] font-bold uppercase text-muted-foreground">
                                            Shares
                                        </p>
                                        <p className="text-lg font-black tabular-nums">
                                            {ugx(selected.shares ?? 0)}
                                        </p>
                                    </div>
                                </div>

                                <Button className="w-full" onClick={() => setTxOpen(true)}>
                                    <Wallet className="mr-2 h-4 w-4" />
                                    Record transaction
                                </Button>

                                <div>
                                    <p className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-muted-foreground">
                                        <History className="h-3.5 w-3.5" /> Statement
                                    </p>
                                    {!transactions ? (
                                        <LoadingState rows={2} />
                                    ) : transactions.length === 0 ? (
                                        <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                            No transactions yet.
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
                                                        <p className="text-[10px] text-muted-foreground">
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
                                                        <p className="text-[10px] text-muted-foreground">
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
                                <p className="text-sm font-bold">Select a member</p>
                                <p className="text-xs text-muted-foreground">
                                    Choose someone from the list to view their balance, shares and
                                    full transaction statement.
                                </p>
                            </CardContent>
                        </Card>
                    )}
                </div>
            </div>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Add member"
                description="The member number is generated automatically if you leave it blank."
                submitLabel="Add member"
                fields={[
                    { name: "name", label: "Full name", required: true },
                    { name: "phone", label: "Phone", type: "tel", placeholder: "0772 123 456" },
                    { name: "email", label: "Email", type: "email" },
                    {
                        name: "memberType",
                        label: "Member type",
                        type: "select",
                        options: [
                            { value: "shareholder", label: "Shareholder" },
                            { value: "saver", label: "Saver" },
                            { value: "student", label: "Student" },
                            { value: "beneficiary", label: "Beneficiary" },
                            { value: "tenant", label: "Tenant" },
                            { value: "member", label: "Member" },
                        ],
                    },
                    { name: "openingBalance", label: "Opening balance (UGX)", type: "number", min: 0 },
                    { name: "shares", label: "Shares held (UGX)", type: "number", min: 0 },
                ]}
                onSubmit={handleCreate}
            />

            <FormDialog
                open={txOpen}
                onOpenChange={setTxOpen}
                title={`Record transaction${selected ? ` — ${selected.name}` : ""}`}
                description="Withdrawals and repayments are checked against the available balance."
                submitLabel="Record"
                fields={[
                    { name: "type", label: "Type", type: "select", required: true, options: TX_TYPES, full: true },
                    { name: "amount", label: "Amount (UGX)", type: "number", required: true, min: 1 },
                    { name: "reference", label: "Reference" },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleTx}
            />
        </div>
    );
}

/* Small local helpers to keep the file readable. */
function cnRow(active: boolean): string {
    return `w-full rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-primary/40 ${
        active ? "border-primary ring-2 ring-primary/20" : ""
    }`;
}

function cnAmt(credit: boolean): string {
    return `text-sm font-black tabular-nums ${credit ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`;
}
