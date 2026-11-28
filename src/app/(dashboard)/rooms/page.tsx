"use client";

/**
 * SMART_BUZ — Rooms
 *
 * Room management for hotels, guest houses and beauty studios. Shows live
 * availability, room rates and lets you check guests in and out.
 *
 * A room can be added, amended, inspected and removed — unless it already
 * carries order history.
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
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { reportError } from "@/components/error-feedback";
import { Button } from "@/components/ui/button";
import { Building2 } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

const OUTLET_TYPE = "room";

export default function RoomsPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [createOpen, setCreateOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const rooms = useQuery(api.verticals.scheduling.listOutlets, {
        businessType: OUTLET_TYPE,
    });

    const createOutlet = useMutation(api.verticals.scheduling.createOutlet);
    const updateStatus = useMutation(api.verticals.scheduling.updateOutletStatus);
    const updateOutlet = useMutation(api.verticals.scheduling.updateOutlet);
    const deleteOutlet = useMutation(api.verticals.scheduling.deleteOutlet);

    const createFields: FormField[] = [
        { name: "name", label: "Room name / number", required: true, full: true },
        { name: "capacity", label: "Sleeps", type: "number", min: 1 },
        { name: "rate", label: `Rate per night (${currency})`, type: "number", min: 0 },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const editFields: FormField[] = createFields;

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createOutlet({
            businessType: OUTLET_TYPE,
            name: values.name,
            capacity: values.capacity ? Number(values.capacity) : undefined,
            rate: values.rate ? Number(values.rate) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Room added");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateOutlet({
                id: editRow._id,
                name: values.name,
                capacity: values.capacity ? Number(values.capacity) : undefined,
                rate: values.rate ? Number(values.rate) : undefined,
                notes: values.notes || undefined,
                userId: user._id,
            });
            toast.success("Room updated");
        } catch (err) {
            reportError(err, "Could not update the room.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteOutlet({ id: deleteRow._id, userId: user._id });
            toast.success("Room deleted");
        } catch (err) {
            reportError(err, "Could not delete the room.");
            throw err;
        }
    };

    const setStatus = async (id: string, status: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status, userId: user._id });
            toast.success(`Room marked ${status}`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const rows = rooms ?? [];
    const available = rows.filter((r: any) => r.status === "available").length;
    const occupied = rows.filter((r: any) => r.status === "occupied").length;

    const columns: DataTableColumn<any>[] = [
        {
            id: "name",
            header: "Room",
            accessor: (r: any) => r.name ?? "",
            cell: (r: any) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{r.name}</p>
                    {r.notes ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">{r.notes}</p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "capacity",
            header: "Sleeps",
            accessor: (r: any) => r.capacity ?? 0,
            align: "right",
            cell: (r: any) =>
                r.capacity ? (
                    <span className="tabular-nums">{r.capacity}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: "rate",
            header: "Rate / night",
            accessor: (r: any) => r.rate ?? 0,
            align: "right",
            cell: (r: any) =>
                r.rate ? (
                    <span className="tabular-nums">{ugx(r.rate)}</span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (r: any) => r.status ?? "",
            cell: (r: any) => <StatusBadge status={r.status ?? "available"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "14rem",
            cell: (r: any) => (
                <div className="flex items-center justify-end gap-1">
                    {r.status !== "occupied" ? (
                        <Button
                            size="sm"
                            onClick={() => setStatus(r._id, "occupied")}
                        >
                            {t("Check in")}
                        </Button>
                    ) : null}
                    {r.status === "occupied" ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setStatus(r._id, "cleaning")}
                        >
                            {t("Check out")}
                        </Button>
                    ) : null}
                    <RecordActions
                        onView={() => setDetailRow(r)}
                        onEdit={() => setEditRow(r)}
                        onDelete={() => setDeleteRow(r)}
                        label={t("Actions for {0}", {
            0: r.name,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Building2}
                title={t("Rooms")}
                description={t("Track room availability, rates and guest check-in.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={t("Add room")} />}
            />

            <StatStrip
                stats={[
                    { label: "Total rooms", value: rows.length },
                    { label: "Available", value: available, tone: "good" },
                    { label: "Occupied", value: occupied, tone: "warn" },
                    {
                        label: "Room nights (est.)",
                        value: rows.reduce(
                            (s, r: any) => s + (r.status === "occupied" ? 1 : 0),
                            0
                        ),
                    },
                ]}
            />

            <SearchBox
                value={search}
                onChange={setSearch}
                placeholder={t("Search room or note…")}
                className="sm:max-w-sm"
            />

            {!rooms ? (
                <LoadingState />
            ) : (
                <DataTable
                    data={rows}
                    columns={columns}
                    getRowId={(row: any) => row._id}
                    searchTerm={search}
                    defaultSort={{ id: "name", direction: "asc" }}
                    emptyTitle={t("No rooms yet")}
                    emptyHint={t("Add your rooms or chalets so you can see availability at a glance and check guests in.")}
                    ariaLabel="Rooms"
                    caption={t("{0} room(s).", {
            0: rows.length,
        })}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Add a room")}
                submitLabel="Add room"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit room")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.name ?? "Room"}
                description={t("Room details")}
                status={detailRow?.status}
                rows={[
                    { label: "Room", value: detailRow?.name ?? "—" },
                    { label: "Sleeps", value: detailRow?.capacity ?? "—" },
                    {
                        label: "Rate per night",
                        value: detailRow?.rate ? ugx(detailRow.rate) : "—",
                    },
                    { label: "Status", value: detailRow?.status ?? "—" },
                    { label: "Notes", value: detailRow?.notes ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="room"
                description={
                    deleteRow
                        ? `This removes ${deleteRow.name} permanently. A room with order history or an open booking cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
