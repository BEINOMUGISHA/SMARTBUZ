"use client";

/**
 * SMART_BUZ — Production Batches
 *
 * The production log for bakeries, workshops and agro-processing. Tracks
 * what was made, what has sold and what is about to expire.
 *
 * A batch can be recorded, amended, inspected and removed — but only while
 * nothing of it has been sold.
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
import { Badge } from "@/components/ui/badge";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

const BATCH_STATUSES = [
    { value: "active", label: "Active" },
    { value: "completed", label: "Completed" },
    { value: "expired", label: "Expired" },
];

export default function ProductionPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [createOpen, setCreateOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const batches = useQuery(api.verticals.operations.listProductionBatches, {});
    const createBatch = useMutation(api.verticals.operations.createProductionBatch);
    const updateBatch = useMutation(api.verticals.operations.updateProductionBatch);
    const deleteBatch = useMutation(api.verticals.operations.deleteProductionBatch);

    const rows = batches ?? [];
    const totalProduced = rows.reduce((s, b: any) => s + (b.quantityProduced ?? 0), 0);
    const totalSold = rows.reduce((s, b: any) => s + (b.quantitySold ?? 0), 0);
    const expiringSoon = rows.filter((b: any) => {
        if (!b.expiryDate) return false;
        const days = (new Date(b.expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        return days >= 0 && days <= 3;
    });

    const createFields: FormField[] = [
        { name: "productName", label: "Product", required: true, full: true },
        { name: "category", label: "Category", placeholder: "e.g. Bread, Cakes" },
        {
            name: "quantityProduced",
            label: "Quantity produced",
            type: "number",
            required: true,
            min: 1,
        },
        { name: "unit", label: "Unit", placeholder: "e.g. pcs, trays" },
        { name: "batchNumber", label: "Batch number" },
        { name: "expiryDate", label: "Expiry date", type: "date" },
        {
            name: "costPerUnit",
            label: `Cost per unit (${currency})`,
            type: "number",
            min: 0,
        },
    ];

    const editFields: FormField[] = [
        ...createFields,
        { name: "status", label: "Status", type: "select", options: BATCH_STATUSES },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createBatch({
            productName: values.productName,
            category: values.category || undefined,
            quantityProduced: Number(values.quantityProduced),
            unit: values.unit || undefined,
            batchNumber: values.batchNumber || undefined,
            expiryDate: values.expiryDate || undefined,
            costPerUnit: values.costPerUnit ? Number(values.costPerUnit) : undefined,
            userId: user._id,
        });
        toast.success("Production batch recorded");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateBatch({
                id: editRow._id,
                productName: values.productName,
                category: values.category || undefined,
                quantityProduced: Number(values.quantityProduced),
                unit: values.unit || undefined,
                batchNumber: values.batchNumber || undefined,
                expiryDate: values.expiryDate || undefined,
                costPerUnit: values.costPerUnit ? Number(values.costPerUnit) : undefined,
                status: values.status || undefined,
                userId: user._id,
            });
            toast.success("Batch updated");
        } catch (err) {
            reportError(err, "Could not update the batch.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteBatch({ id: deleteRow._id, userId: user._id });
            toast.success("Batch deleted");
        } catch (err) {
            reportError(err, "Could not delete the batch.");
            throw err;
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "product",
            header: "Product",
            accessor: (b: any) => b.productName ?? "",
            cell: (b: any) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{b.productName}</p>
                    <p className="text-xs text-muted-foreground">
                        {b.batchNumber ? `Batch ${b.batchNumber} · ` : ""}
                        {shortDate(b.date)}
                    </p>
                </div>
            ),
        },
        {
            id: "category",
            header: "Category",
            accessor: (b: any) => b.category ?? "",
            cell: (b: any) =>
                b.category ? <Badge variant="outline">{b.category}</Badge> : "—",
            hideBelow: "sm",
        },
        {
            id: "produced",
            header: "Produced",
            accessor: (b: any) => b.quantityProduced ?? 0,
            align: "right",
            cell: (b: any) => (
                <span className="tabular-nums">
                    {b.quantityProduced} {b.unit ?? ""}
                </span>
            ),
        },
        {
            id: "sold",
            header: "Sold",
            accessor: (b: any) => b.quantitySold ?? 0,
            align: "right",
            cell: (b: any) => (
                <span className="tabular-nums">{b.quantitySold ?? 0}</span>
            ),
        },
        {
            id: "remaining",
            header: "Remaining",
            accessor: (b: any) =>
                (b.quantityProduced ?? 0) - (b.quantitySold ?? 0),
            align: "right",
            cell: (b: any) => (
                <span className="font-medium tabular-nums">
                    {(b.quantityProduced ?? 0) - (b.quantitySold ?? 0)}
                </span>
            ),
        },
        {
            id: "expiry",
            header: "Expiry",
            accessor: (b: any) => b.expiryDate ?? "",
            hideBelow: "lg",
            cell: (b: any) => {
                if (!b.expiryDate) return <span className="text-muted-foreground">—</span>;
                const days = Math.ceil(
                    (new Date(b.expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000)
                );
                return (
                    <div className="space-y-1">
                        <p className="tabular-nums">{shortDate(b.expiryDate)}</p>
                        {days >= 0 && days <= 3 ? (
                            <Badge variant="destructive">{t("Expires in")} {days}d</Badge>
                        ) : null}
                    </div>
                );
            },
        },
        {
            id: "cost",
            header: "Cost / unit",
            accessor: (b: any) => b.costPerUnit ?? 0,
            align: "right",
            hideBelow: "lg",
            cell: (b: any) =>
                b.costPerUnit ? (
                    <span className="tabular-nums">{ugx(b.costPerUnit)}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (b: any) => b.status ?? "",
            cell: (b: any) => <StatusBadge status={b.status ?? "active"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "8rem",
            cell: (b: any) => (
                <div className="flex items-center justify-end">
                    <RecordActions
                        onView={() => setDetailRow(b)}
                        onEdit={() => setEditRow(b)}
                        onDelete={() => setDeleteRow(b)}
                        label={t("Actions for {0}", {
            0: b.productName,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={PackagePlus}
                title={t("Production Batches")}
                description={t("Log what you produce, how much sold and when it expires.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={t("Record batch")} />}
            />

            <StatStrip
                stats={[
                    { label: "Batches", value: rows.length },
                    { label: "Units produced", value: totalProduced },
                    { label: "Units sold", value: totalSold, tone: "good" },
                    {
                        label: "Expiring in 3 days",
                        value: expiringSoon.length,
                        tone: expiringSoon.length > 0 ? "warn" : "good",
                    },
                ]}
            />

            <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t("Search product, batch or category…")}
                className="sm:max-w-sm"
            />

            {!batches ? (
                <LoadingState />
            ) : (
                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row: any) => row._id}
                    searchTerm={search}
                    defaultSort={{ id: "product", direction: "asc" }}
                    emptyTitle={t("No production recorded")}
                    emptyHint={t("Log each batch you make so you can track what sells, what is wasted and what needs discounting before it expires.")}
                    ariaLabel="Production batches"
                    caption={t("{0} batch(es) recorded.", {
            0: rows.length,
        })}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Record a production batch")}
                submitLabel="Record batch"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit production batch")}
                description={t("The quantity already sold is not editable — it is the running figure of what left the batch.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.productName ?? "Batch"}
                description={detailRow?.batchNumber}
                status={detailRow?.status}
                rows={[
                    { label: "Product", value: detailRow?.productName ?? "—" },
                    { label: "Category", value: detailRow?.category ?? "—" },
                    { label: "Batch number", value: detailRow?.batchNumber ?? "—" },
                    { label: "Produced", value: `${detailRow?.quantityProduced ?? 0} ${detailRow?.unit ?? ""}` },
                    { label: "Sold", value: detailRow?.quantitySold ?? 0 },
                    {
                        label: "Remaining",
                        value:
                            (detailRow?.quantityProduced ?? 0) - (detailRow?.quantitySold ?? 0),
                    },
                    { label: "Cost per unit", value: detailRow?.costPerUnit ? ugx(detailRow.costPerUnit) : "—" },
                    { label: "Produced on", value: shortDate(detailRow?.date) },
                    { label: "Expires", value: shortDate(detailRow?.expiryDate) },
                    { label: "Status", value: detailRow?.status ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="batch"
                description={
                    deleteRow
                        ? `This removes the ${deleteRow.productName} batch permanently. A batch with units already sold cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
