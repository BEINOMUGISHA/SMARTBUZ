"use client";

/**
 * SMART_BUZ — Appointments & Bookings
 *
 * The scheduling desk for service verticals: salons, barbershops, clinics,
 * hotels, driving schools, photographers and event planners.
 *
 * Every booking can be booked, amended, inspected and removed from here.
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
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { reportError } from "@/components/error-feedback";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarClock, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useT } from "@/i18n/provider";

const STATUS_TABS = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Confirmed" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
];

const STATUS_OPTIONS = [
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Confirmed" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
];

export default function AppointmentsPage() {
    
    const tr = useT();const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [createOpen, setCreateOpen] = useState(false);
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const summary = useQuery(api.verticals.scheduling.getScheduleSummary, { date });
    const appointments = useQuery(api.verticals.scheduling.listAppointments, {
        date,
        status: status === "all" ? undefined : status,
        limit: 200,
    });
    const staff = useQuery(api.users.listAll, {});

    const createAppointment = useMutation(api.verticals.scheduling.createAppointment);
    const updateStatus = useMutation(api.verticals.scheduling.updateAppointmentStatus);
    const updateAppointment = useMutation(api.verticals.scheduling.updateAppointment);
    const deleteAppointment = useMutation(api.verticals.scheduling.deleteAppointment);

    const staffOptions = (staff ?? []).map((s: any) => ({
        value: s._id,
        label: `${s.first_name} ${s.last_name}`,
    }));

    const createFields: FormField[] = [
        { name: "customerName", label: "Customer name", required: true },
        {
            name: "customerPhone",
            label: "Phone",
            type: "tel",
            placeholder: "0772 123 456",
        },
        { name: "serviceName", label: "Service", required: true, full: true },
        {
            name: "staffId",
            label: "Staff member",
            type: "select",
            options: staffOptions,
        },
        { name: "date", label: "Date", type: "date", required: true, defaultValue: date },
        { name: "startTime", label: "Start time", type: "time", required: true, defaultValue: "09:00" },
        { name: "endTime", label: "End time", type: "time" },
        { name: "notes", label: "Notes", type: "textarea", full: true },
    ];

    const editFields: FormField[] = [
        ...createFields.map((f) =>
            f.name === "date" ? { ...f, defaultValue: undefined } : f
        ),
        { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        const selectedStaff = (staff ?? []).find((s: any) => s._id === values.staffId);
        await createAppointment({
            businessType: "appointment",
            customerName: values.customerName,
            customerPhone: values.customerPhone || undefined,
            staffId: values.staffId ? (values.staffId as any) : undefined,
            staffName: selectedStaff
                ? `${selectedStaff.first_name} ${selectedStaff.last_name}`
                : undefined,
            serviceName: values.serviceName,
            date: values.date,
            startTime: values.startTime,
            endTime: values.endTime || undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Appointment booked");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        const selectedStaff = (staff ?? []).find((s: any) => s._id === values.staffId);
        try {
            await updateAppointment({
                id: editRow._id,
                customerName: values.customerName,
                customerPhone: values.customerPhone || undefined,
                staffId: values.staffId ? (values.staffId as any) : undefined,
                staffName: selectedStaff
                    ? `${selectedStaff.first_name} ${selectedStaff.last_name}`
                    : undefined,
                serviceName: values.serviceName,
                date: values.date,
                startTime: values.startTime,
                endTime: values.endTime || undefined,
                status: values.status || undefined,
                notes: values.notes || undefined,
                userId: user._id,
            });
            toast.success("Appointment updated");
        } catch (err) {
            reportError(err, "Could not update the appointment.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteAppointment({ id: deleteRow._id, userId: user._id });
            toast.success("Appointment deleted");
        } catch (err) {
            reportError(err, "Could not delete the appointment.");
            throw err;
        }
    };

    const setApptStatus = async (id: string, next: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status: next, userId: user._id });
            toast.success(`Marked as ${next}`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "customer",
            header: "Customer",
            accessor: (a: any) => a.customerName ?? "",
            cell: (a: any) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{a.customerName}</p>
                    {a.customerPhone ? (
                        <p className="text-xs text-muted-foreground">{a.customerPhone}</p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "service",
            header: "Service",
            accessor: (a: any) => a.serviceName ?? "",
            cell: (a: any) => (
                <div className="min-w-0">
                    <p className="truncate">{a.serviceName}</p>
                    {a.staffName ? (
                        <p className="text-xs text-muted-foreground">{a.staffName}</p>
                    ) : null}
                </div>
            ),
            hideBelow: "sm",
        },
        {
            id: "time",
            header: "Time",
            accessor: (a: any) => `${a.date} ${a.startTime ?? ""}`,
            cell: (a: any) => (
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap tabular-nums">
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    {a.startTime}
                    {a.endTime ? ` – ${a.endTime}` : ""}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (a: any) => a.status ?? "",
            cell: (a: any) => <StatusBadge status={a.status ?? "pending"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "14rem",
            cell: (a: any) => (
                <div className="flex items-center justify-end gap-1">
                    {a.status === "pending" ? (
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setApptStatus(a._id, "confirmed")}
                        >
                            <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                            {tr("Confirm")}
                        </Button>
                    ) : null}
                    {a.status !== "completed" && a.status !== "cancelled" ? (
                        <Button
                            size="sm"
                            onClick={() => setApptStatus(a._id, "completed")}
                        >
                            {tr("Complete")}
                        </Button>
                    ) : null}
                    {a.status !== "cancelled" && a.status !== "completed" ? (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10"
                            onClick={() => setApptStatus(a._id, "cancelled")}
                        >
                            <XCircle className="mr-1.5 h-3.5 w-3.5" />
                            {tr("Cancel")}
                        </Button>
                    ) : null}
                    <RecordActions
                        onView={() => setDetailRow(a)}
                        onEdit={() => setEditRow(a)}
                        onDelete={() => setDeleteRow(a)}
                        label={tr("Actions for {0}", {
            0: a.customerName,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={CalendarClock}
                title={tr("Appointments & Bookings")}
                description={tr("Manage your diary and keep every chair, room and practitioner booked.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={tr("Book appointment")} />}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="space-y-2">
                    <Label htmlFor="appt-date">{tr("Date")}</Label>
                    <Input
                        id="appt-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full sm:w-52"
                    />
                </div>
                <SearchBox
                    value={search}
                    onChange={setSearch}
                    placeholder={tr("Search customer, service or staff…")}
                    className="sm:max-w-sm"
                />
            </div>

            {summary && (
                <StatStrip
                    stats={[
                        { label: "Total", value: summary.total },
                        { label: "Confirmed", value: summary.confirmed, tone: "good" },
                        { label: "Pending", value: summary.pending, tone: "warn" },
                        { label: "Completed", value: summary.completed },
                    ]}
                />
            )}

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {STATUS_TABS.map((t) => (
                        <TabsTrigger
                            key={t.value}
                            value={t.value}
                            className="rounded-lg text-sm font-bold"
                        >
                            {tr(t.label)}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!appointments ? (
                        <LoadingState />
                    ) : (
                        <DataTable
                            data={appointments}
                            columns={columns}
                            getRowId={(row: any) => row._id}
                            searchTerm={search}
                            defaultSort={{ id: "time", direction: "asc" }}
                            emptyTitle={tr("No appointments for this date")}
                            emptyHint={tr("Book an appointment and it will appear here with its status.")}
                            ariaLabel="Appointments"
                            caption={tr("{0} booking(s) on {1}.", {
            0: appointments.length,
            1: date,
        })}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={tr("Book an appointment")}
                description={tr("Double-booking the same staff member at the same time is blocked automatically.")}
                submitLabel="Book"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={tr("Edit appointment")}
                description={tr("Change the booking and save it back to the diary.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.customerName ?? "Appointment"}
                description={detailRow?.serviceName}
                status={detailRow?.status}
                rows={[
                    { label: "Customer", value: detailRow?.customerName ?? "—" },
                    { label: "Phone", value: detailRow?.customerPhone ?? "—" },
                    { label: "Service", value: detailRow?.serviceName ?? "—" },
                    { label: "Staff", value: detailRow?.staffName ?? "—" },
                    { label: "Date", value: detailRow?.date ?? "—" },
                    {
                        label: "Time",
                        value: detailRow
                            ? `${detailRow.startTime}${detailRow.endTime ? ` – ${detailRow.endTime}` : ""}`
                            : "—",
                    },
                    { label: "Status", value: detailRow?.status ?? "—" },
                    { label: "Notes", value: detailRow?.notes ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="appointment"
                description={
                    deleteRow
                        ? `This removes the booking for ${deleteRow.customerName} on ${deleteRow.date}. This cannot be undone.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
