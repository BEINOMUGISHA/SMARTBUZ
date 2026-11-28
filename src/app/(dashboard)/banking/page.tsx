"use client";

/**
 * SMART_BUZ — Banking
 *
 * The business's money book: what came in, what went out, and what is left.
 *
 * A banking record is a signed amount — positive for money in, negative for
 * money out — with the day it happened and a note saying what it was. The
 * server owns that rule (see `convex/banking.ts`), so the form here picks a
 * direction and the amount, and the sign is applied once, in one place.
 *
 * The ledger is read with the "view financial reports" permission and written
 * with "manage settings". A person who may look but not write sees the book
 * without the buttons that would change it.
 */

import { useMemo, useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
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
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import {
    FormDialog,
    EditFormDialog,
    ConfirmDeleteDialog,
    SearchBox,
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Landmark, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/provider";

type BankingRecord = {
    _id: Id<"banking">;
    _creationTime: number;
    date: string;
    amount: number;
    comment: string;
};

const FIELDS: FormField[] = [
    {
        name: "date",
        label: "Date",
        type: "date",
        required: true,
    },
    {
        name: "direction",
        label: "Direction",
        type: "select",
        required: true,
        options: [
            { value: "in", label: "Money in" },
            { value: "out", label: "Money out" },
        ],
    },
    {
        name: "amount",
        label: "Amount",
        type: "number",
        required: true,
        min: 0,
        step: 1,
    },
    {
        name: "comment",
        label: "What was it for",
        type: "textarea",
        required: true,
        full: true,
    },
];

/** The sign carries the direction of the money. */
function signedAmount(direction: string, amount: number): number {
    return direction === "out" ? -Math.abs(amount) : Math.abs(amount);
}

function BankingLedger({ canManage }: { canManage: boolean }) {
    
    const t = useT();const { currency } = useCurrency();

    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<BankingRecord | null>(null);
    const [deleting, setDeleting] = useState<BankingRecord | null>(null);

    const { results, status, loadMore } = usePaginatedQuery(
        api.banking.list,
        {},
        { initialNumItems: 50 }
    );

    const createRecord = useMutation(api.banking.create);
    const updateRecord = useMutation(api.banking.update);
    const removeRecord = useMutation(api.banking.remove);

    const rows = useMemo(() => {
        const all = (results ?? []) as BankingRecord[];
        const needle = search.trim().toLowerCase();
        if (!needle) return all;
        return all.filter(
            (r) =>
                r.comment.toLowerCase().includes(needle) ||
                (r.date ?? "").toLowerCase().includes(needle)
        );
    }, [results, search]);

    const totals = useMemo(() => {
        let moneyIn = 0;
        let moneyOut = 0;
        for (const row of rows) {
            if (row.amount >= 0) moneyIn += row.amount;
            else moneyOut += Math.abs(row.amount);
        }
        return { moneyIn, moneyOut, net: moneyIn - moneyOut, count: rows.length };
    }, [rows]);

    const columns: DataTableColumn<BankingRecord>[] = [
        {
            id: "date",
            header: "Date",
            accessor: (r) => r.date,
            width: "9rem",
        },
        {
            id: "direction",
            header: "Direction",
            accessor: (r) => (r.amount >= 0 ? "Money in" : "Money out"),
            width: "9rem",
            cell: (r) => (
                <span className={r.amount >= 0 ? "text-success" : "text-danger"}>
                    {r.amount >= 0 ? "Money in" : "Money out"}
                </span>
            ),
        },
        {
            id: "amount",
            header: "Amount",
            accessor: (r) => r.amount,
            align: "right",
            cell: (r) => (
                <span className="tabular-nums">
                    {formatMoney(Math.abs(r.amount), currency)}
                </span>
            ),
        },
        {
            id: "comment",
            header: "What it was for",
            accessor: (r) => r.comment,
        },
        ...(canManage
            ? [
                  {
                      id: "actions",
                      header: "",
                      width: "7rem",
                      cell: (r: BankingRecord) => (
                          <div className="flex justify-end gap-1">
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8"
                                  aria-label={t("Edit this record")}
                                  onClick={() => setEditing(r)}
                              >
                                  <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-destructive"
                                  aria-label={t("Delete this record")}
                                  onClick={() => setDeleting(r)}
                              >
                                  <Trash2 className="h-4 w-4" />
                              </Button>
                          </div>
                      ),
                  } as DataTableColumn<BankingRecord>,
              ]
            : []),
    ];

    const handleCreate = async (values: Record<string, string>) => {
        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Enter the amount of money that moved.");
        }
        try {
            await createRecord({
                date: values.date,
                amount: signedAmount(values.direction, amount),
                comment: values.comment.trim(),
            });
            toast.success("Recorded in the banking ledger.");
        } catch (err) {
            toast.error(formatError(err));
            throw err;
        }
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!editing) return;
        const amount = Number(values.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("Enter the amount of money that moved.");
        }
        try {
            await updateRecord({
                id: editing._id,
                date: values.date,
                amount: signedAmount(values.direction, amount),
                comment: values.comment.trim(),
            });
            toast.success("Banking record updated.");
        } catch (err) {
            toast.error(formatError(err));
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        try {
            await removeRecord({ id: deleting._id });
            toast.success("Banking record deleted.");
        } catch (err) {
            toast.error(formatError(err));
            throw err;
        }
    };

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Landmark}
                title={t("Banking")}
                description={t("Every amount that came into the business, and every amount that went out.")}
                actions={
                    canManage ? (
                        <ActionButton onClick={() => setCreateOpen(true)}>
                            <Plus className="mr-2 size-4" />
                            {t("Record money")}
                        </ActionButton>
                    ) : undefined
                }
                toolbar={
                    <Toolbar>
                        <ToolbarGroup>
                            <SearchBox
                                value={search}
                                onChange={setSearch}
                                placeholder={t("Search by note or date…")}
                            />
                            <CountBadge>{rows.length}</CountBadge>
                        </ToolbarGroup>
                        <ToolbarGroup>
                            <DataTableExport
                                title={t("Banking ledger")}
                                rows={rows}
                                columns={columns}
                            />
                        </ToolbarGroup>
                    </Toolbar>
                }
            />

            <StatGrid columns={4}>
                <StatCard
                    label={t("Money in")}
                    value={formatMoney(totals.moneyIn, currency)}
                    tone="success"
                />
                <StatCard
                    label={t("Money out")}
                    value={formatMoney(totals.moneyOut, currency)}
                    tone="warning"
                />
                <StatCard
                    label={t("Net")}
                    value={formatMoney(totals.net, currency)}
                    tone={totals.net < 0 ? "danger" : "default"}
                    hint={t("Money in, less money out.")}
                />
                <StatCard label={t("Entries")} value={totals.count} />
            </StatGrid>

            <SectionCard
                title={t("The ledger")}
                description={t("The oldest entries are at the bottom of the list.")}
            >
                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row) => row._id}
                    isLoading={status === "LoadingFirstPage"}
                    isEmpty={rows.length === 0}
                    emptyTitle={t("No banking records yet")}
                    emptyHint={
                        canManage
                            ? "Record the money that comes in and the money that goes out, and the balance always tells the truth."
                            : "Nothing has been recorded in the banking ledger yet."
                    }
                    emptyAction={
                        canManage ? (
                            <Button onClick={() => setCreateOpen(true)}>
                                <Plus className="mr-2 size-4" />
                                {t("Record money")}
                            </Button>
                        ) : undefined
                    }
                    onRowClick={canManage ? (row) => setEditing(row) : undefined}
                    defaultSort={{ id: "date", direction: "desc" }}
                />

                {status === "CanLoadMore" ? (
                    <div className="mt-4 flex justify-center">
                        <Button variant="outline" onClick={() => loadMore(50)}>
                            {t("Load more")}
                        </Button>
                    </div>
                ) : null}
            </SectionCard>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Record money")}
                description={t("Money in is a positive amount; money out is a negative one. The sign is what the ledger keeps.")}
                fields={FIELDS}
                submitLabel="Record it"
                onSubmit={handleCreate}
            />

            <EditFormDialog
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) setEditing(null);
                }}
                title={t("Edit banking record")}
                description={t("The ledger keeps the amount signed the same way.")}
                fields={FIELDS}
                record={
                    editing
                        ? toFormValues(
                              {
                                  date: editing.date,
                                  direction:
                                      editing.amount >= 0 ? "in" : "out",
                                  amount: Math.abs(editing.amount),
                                  comment: editing.comment,
                              },
                              FIELDS
                          )
                        : {}
                }
                onSubmit={handleEdit}
            />

            <ConfirmDeleteDialog
                open={deleting !== null}
                onOpenChange={(open) => {
                    if (!open) setDeleting(null);
                }}
                onConfirm={handleDelete}
                entityName="banking record"
                description={
                    deleting
                        ? `${formatMoney(Math.abs(deleting.amount), currency)} — ${deleting.comment}. This removes the line from the ledger for good.`
                        : undefined
                }
            />
        </div>
    );
}

/**
 * The gate.
 *
 * The ledger is read with the "view financial reports" permission, so
 * someone without it is told so plainly instead of the server throwing a
 * forbidden error at the page. The ledger itself is only mounted once the
 * permission is there, so no query is ever fired that would fail.
 */
export default function BankingPage() {
    
    const t = useT();const { can, permissions } = useAuth();

    // Reading the ledger is a financial report; changing it is a settings
    // change. Both are the server's decision — this only decides what is
    // offered.
    const canView = can("finance.reports.view");
    const canManage = permissions.includes("settings.manage");

    if (!canView) {
        return (
            <div className="space-y-6">
                <PageHeader
                    icon={Landmark}
                    title={t("Banking")}
                    description={t("What came in, what went out, and what is left.")}
                />
                <SectionCard>
                    <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
                        <p className="text-sm font-semibold text-foreground">
                            {t("You do not have access to the banking ledger")}
                        </p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            {t("Ask the owner or an administrator for the &quot;view financial reports&quot; permission.")}
                        </p>
                    </div>
                </SectionCard>
            </div>
        );
    }

    return <BankingLedger canManage={canManage} />;
}
