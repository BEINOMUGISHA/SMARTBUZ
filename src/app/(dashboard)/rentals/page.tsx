"use client";

/**
 * SMART_BUZ — Rentals & Hire
 *
 * Hire-out tracking for power tools, event equipment and vehicles.
 *
 * A hire can be recorded, amended, inspected and removed — but not while the
 * item is still out with the customer.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export default function RentalsPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const rentals = useQuery(api.verticals.operations.listRentals, {
        status: status === "all" ? undefined : status,
    });
    const assets = useQuery(api.verticals.operations.listAssets, {});

    const createRental = useMutation(api.verticals.operations.createRental);
    const returnRental = useMutation(api.verticals.operations.returnRental);
    const updateRental = useMutation(api.verticals.operations.updateRental);
    const deleteRental = useMutation(api.verticals.operations.deleteRental);

    const createFields: FormField[] = [
        {
            name: "assetId",
            label: "Item",
            type: "select",
            required: true,
            options: (assets ?? []).map((a: any) => ({
                value: a._id,
                label: `${a.name} (${a.assetTag})`,
            })),
            full: true,
        },
        { name: "customerName", label: "Customer name", required: true },
        { name: "startDate", label: "Start date", type: "date", required: true },
        { name: "endDate", label: "Expected return", type: "date" },
        { name: "rate", label: `Rate (${currency})`, type: "number", required: true, min: 0 },
        { name: "deposit", label: `Deposit (${currency})`, type: "number", min: 0 },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const editFields: FormField[] = [
        { name: "assetName", label: "Item", required: true, full: true },
        { name: "customerName", label: "Customer name", required: true },
        { name: "startDate", label: "Start date", type: "date", required: true },
        { name: "endDate", label: "Expected return", type: "date" },
        { name: "rate", label: `Rate (${currency})`, type: "number", required: true, min: 0 },
        { name: "deposit", label: `Deposit (${currency})`, type: "number", min: 0 },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        const asset = (assets ?? []).find((a: any) => a._id === values.assetId);
        await createRental({
            assetId: values.assetId ? (values.assetId as any) : undefined,
            assetName: asset?.name ?? values.assetName,
            customerName: values.customerName,
            startDate: values.startDate,
            endDate: values.endDate || undefined,
            rate: Number(values.rate) || 0,
            deposit: values.deposit ? Number(values.deposit) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Hire recorded");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateRental({
                id: editRow._id,
                assetName: values.assetName,
                customerName: values.customerName,
                startDate: values.startDate,
                endDate: values.endDate || undefined,
                rate: Number(values.rate) || 0,
                deposit: values.deposit ? Number(values.deposit) : undefined,
                notes: values.notes || undefined,
                userId: user._id,
            });
            toast.success("Hire updated");
        } catch (err) {
            reportError(err, "Could not update the hire.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteRental({ id: deleteRow._id, userId: user._id });
            toast.success("Hire deleted");
        } catch (err) {
            reportError(err, "Could not delete the hire.");
            throw err;
        }
    };

    const doReturn = async (id: string) => {
        if (!user) return;
        try {
            await returnRental({ id: id as any });
            toast.success("Item returned");
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "asset",
            header: "Item",
            accessor: (r: any) => r.assetName ?? "",
            cell: (r: any) => (
                <p className="truncate font-medium text-foreground">{r.assetName}</p>
            ),
        },
        {
            id: "customer",
            header: "Customer",
            accessor: (r: any) => r.customerName ?? "",
            cell: (r: any) => (
                <div className="min-w-0">
                    <p className="truncate">{r.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                        from {shortDate(r.startDate)}
                        {r.endDate ? ` to ${shortDate(r.endDate)}` : ""}
                    </p>
                </div>
            ),
        },
        {
            id: "rate",
            header: "Rate",
            accessor: (r: any) => r.rate ?? 0,
            align: "right",
            cell: (r: any) => <span className="tabular-nums">{ugx(r.rate)}</span>,
        },
        {
            id: "deposit",
            header: "Deposit",
            accessor: (r: any) => r.deposit ?? 0,
            align: "right",
            hideBelow: "sm",
            cell: (r: any) =>
                r.deposit ? (
                    <span className="tabular-nums">{ugx(r.deposit)}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (r: any) => r.status ?? "",
            cell: (r: any) => <StatusBadge status={r.status ?? "reserved"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "12rem",
            cell: (r: any) => (
                <div className="flex items-center justify-end gap-1">
                    {r.status !== "returned" ? (
                        <Button size="sm" onClick={() => doReturn(r._id)}>
                            <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                            {t("Return")}
                        </Button>
                    ) : null}
                    <RecordActions
                        onView={() => setDetailRow(r)}
                        onEdit={() => setEditRow(r)}
                        onDelete={() => setDeleteRow(r)}
                        label={t("Actions for {0}", {
            0: r.assetName,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Sparkles}
                title={t("Rentals & Hire")}
                description={t("Track what is out on hire and when it comes back.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={t("New hire")} />}
            />

            <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t("Search item or customer…")}
                className="sm:max-w-sm"
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {["all", "out", "reserved", "returned", "overdue"].map((s) => (
                        <TabsTrigger
                            key={s}
                            value={s}
                            className="rounded-lg text-sm font-bold capitalize"
                        >
                            {s}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!rentals ? (
                        <LoadingState />
                    ) : (
                        <DataTable
                            data={rentals}
                            columns={columns}
                            getRowId={(row: any) => row._id}
                            searchTerm={search}
                            defaultSort={{ id: "asset", direction: "asc" }}
                            emptyTitle={t("No hires here")}
                            emptyHint={t("Record an item going out on hire so you know where your equipment is.")}
                            ariaLabel="Rentals"
                            caption={t("{0} hire(s).", {
            0: rentals.length,
        })}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Record a hire")}
                description={t("Pick the item going out and who has it.")}
                submitLabel="Record hire"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit hire")}
                description={t("Change the item, the customer or the hire period.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.assetName ?? "Hire"}
                description={detailRow?.customerName}
                status={detailRow?.status}
                rows={[
                    { label: "Item", value: detailRow?.assetName ?? "—" },
                    { label: "Customer", value: detailRow?.customerName ?? "—" },
                    { label: "Out from", value: shortDate(detailRow?.startDate) },
                    { label: "Expected back", value: shortDate(detailRow?.endDate) },
                    { label: "Rate", value: ugx(detailRow?.rate ?? 0) },
                    { label: "Deposit", value: detailRow?.deposit ? ugx(detailRow.deposit) : "—" },
                    { label: "Status", value: detailRow?.status ?? "—" },
                    { label: "Notes", value: detailRow?.notes ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="hire"
                description={
                    deleteRow
                        ? `This removes the hire of ${deleteRow.assetName} by ${deleteRow.customerName}. An item that is still out on hire cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
