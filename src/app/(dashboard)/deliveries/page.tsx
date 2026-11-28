"use client";

/**
 * SMART_BUZ — Deliveries & Dispatch
 *
 * A dispatch board for wholesale distributors and construction suppliers
 * running van deliveries.
 *
 * Every delivery note can be amended, inspected and removed — except once it
 * has been handed over, because that note is the proof of the hand-over.
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
import { Truck } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

const DELIVERY_STATUSES = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "dispatched", label: "Dispatched" },
    { value: "delivered", label: "Delivered" },
    { value: "failed", label: "Failed" },
];

const NEXT_STATUS: Record<string, string | null> = {
    pending: "dispatched",
    dispatched: "delivered",
    delivered: null,
    failed: null,
};

export default function DeliveriesPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const deliveries = useQuery(api.verticals.operations.listDeliveries, {
        status: status === "all" ? undefined : status,
    });

    const createDelivery = useMutation(api.verticals.operations.createDelivery);
    const updateStatus = useMutation(api.verticals.operations.updateDeliveryStatus);
    const updateDelivery = useMutation(api.verticals.operations.updateDelivery);
    const deleteDelivery = useMutation(api.verticals.operations.deleteDelivery);

    const createFields: FormField[] = [
        { name: "customerName", label: "Customer name", required: true },
        { name: "destination", label: "Destination", placeholder: "e.g. Masaka, Kampala Road" },
        { name: "assignedToName", label: "Driver / dispatcher" },
        { name: "amount", label: `Amount (${currency})`, type: "number", min: 0 },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const editFields: FormField[] = [
        ...createFields,
        {
            name: "status",
            label: "Status",
            type: "select",
            options: DELIVERY_STATUSES.filter((s) => s.value !== "all").map((s) => ({
                value: s.value,
                label: s.label,
            })),
        },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createDelivery({
            customerName: values.customerName,
            destination: values.destination || undefined,
            assignedToName: values.assignedToName || undefined,
            amount: values.amount ? Number(values.amount) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Delivery scheduled");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateDelivery({
                id: editRow._id,
                customerName: values.customerName,
                destination: values.destination || undefined,
                assignedToName: values.assignedToName || undefined,
                amount: values.amount ? Number(values.amount) : undefined,
                status: values.status || undefined,
                notes: values.notes || undefined,
                userId: user._id,
            });
            toast.success("Delivery updated");
        } catch (err) {
            reportError(err, "Could not update the delivery.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteDelivery({ id: deleteRow._id, userId: user._id });
            toast.success("Delivery deleted");
        } catch (err) {
            reportError(err, "Could not delete the delivery.");
            throw err;
        }
    };

    const advance = async (id: string, next: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status: next });
            toast.success(`Marked as ${next}`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "reference",
            header: "Reference",
            accessor: (d: any) => d.reference ?? "",
            cell: (d: any) => (
                <span className="font-mono text-xs font-semibold text-muted-foreground">
                    {d.reference}
                </span>
            ),
        },
        {
            id: "customer",
            header: "Customer",
            accessor: (d: any) => d.customerName ?? "",
            cell: (d: any) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{d.customerName}</p>
                    <p className="text-xs text-muted-foreground">
                        {d.destination ?? "Destination not set"}
                    </p>
                </div>
            ),
        },
        {
            id: "assignedTo",
            header: "Driver",
            accessor: (d: any) => d.assignedToName ?? "",
            cell: (d: any) => d.assignedToName || "—",
            hideBelow: "sm",
        },
        {
            id: "amount",
            header: "Amount",
            accessor: (d: any) => d.amount ?? 0,
            align: "right",
            cell: (d: any) =>
                d.amount ? (
                    <span className="tabular-nums">{ugx(d.amount)}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (d: any) => d.status ?? "",
            cell: (d: any) => (
                <div className="space-y-1">
                    <StatusBadge status={d.status ?? "pending"} />
                    {d.dispatchDate ? (
                        <p className="text-xs text-muted-foreground">
                            dispatched {shortDate(d.dispatchDate)}
                        </p>
                    ) : null}
                    {d.deliveryDate ? (
                        <p className="text-xs text-muted-foreground">
                            delivered {shortDate(d.deliveryDate)}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "12rem",
            cell: (d: any) => (
                <div className="flex items-center justify-end gap-1">
                    {NEXT_STATUS[d.status] ? (
                        <Button
                            size="sm"
                            onClick={() => advance(d._id, NEXT_STATUS[d.status]!)}
                        >
                            {NEXT_STATUS[d.status]}
                        </Button>
                    ) : null}
                    <RecordActions
                        onView={() => setDetailRow(d)}
                        onEdit={() => setEditRow(d)}
                        onDelete={() => setDeleteRow(d)}
                        label={t("Actions for {0}", {
            0: d.reference,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Truck}
                title={t("Deliveries & Dispatch")}
                description={t("Plan van runs and keep customers informed on delivery status.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={t("Schedule delivery")} />}
            />

            <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t("Search reference, customer or destination…")}
                className="sm:max-w-sm"
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {DELIVERY_STATUSES.map((s) => (
                        <TabsTrigger
                            key={s.value}
                            value={s.value}
                            className="rounded-lg text-sm font-bold"
                        >
                            {t(s.label)}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!deliveries ? (
                        <LoadingState />
                    ) : (
                        <DataTable
                            data={deliveries}
                            columns={columns}
                            getRowId={(row: any) => row._id}
                            searchTerm={search}
                            defaultSort={{ id: "reference", direction: "desc" }}
                            emptyTitle={t("No deliveries here")}
                            emptyHint={t("Schedule a delivery when an order goes out for dispatch, then track it to hand-over.")}
                            ariaLabel="Deliveries"
                            caption={t("{0} delivery note(s).", {
            0: deliveries.length,
        })}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Schedule a delivery")}
                submitLabel="Schedule"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit delivery")}
                description={t("The dispatch and delivery dates are stamped by the server.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.reference ?? "Delivery"}
                description={detailRow?.customerName}
                status={detailRow?.status}
                rows={[
                    { label: "Reference", value: detailRow?.reference ?? "—" },
                    { label: "Customer", value: detailRow?.customerName ?? "—" },
                    { label: "Destination", value: detailRow?.destination ?? "—" },
                    { label: "Driver", value: detailRow?.assignedToName ?? "—" },
                    { label: "Amount", value: detailRow?.amount ? ugx(detailRow.amount) : "—" },
                    { label: "Status", value: detailRow?.status ?? "—" },
                    { label: "Dispatched", value: shortDate(detailRow?.dispatchDate) },
                    { label: "Delivered", value: shortDate(detailRow?.deliveryDate) },
                    { label: "Notes", value: detailRow?.notes ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="delivery"
                description={
                    deleteRow
                        ? `This removes the delivery note ${deleteRow.reference} for ${deleteRow.customerName}. A delivery that was already handed over cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
