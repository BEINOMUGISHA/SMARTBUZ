"use client";

/**
 * SMART_BUZ — Appointments & Bookings
 *
 * The scheduling desk for service verticals: salons, barbershops, clinics,
 * hotels, driving schools, photographers and event planners.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    LoadingState,
    EmptyState,
    FormDialog,
    CreateButton,
    RecordList,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CalendarClock, Plus, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

const STATUS_TABS = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "confirmed", label: "Confirmed" },
    { value: "completed", label: "Completed" },
    { value: "cancelled", label: "Cancelled" },
];

export default function AppointmentsPage() {
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
    const [createOpen, setCreateOpen] = useState(false);

    const summary = useQuery(api.verticals.scheduling.getScheduleSummary, { date });
    const appointments = useQuery(api.verticals.scheduling.listAppointments, {
        date,
        status: status === "all" ? undefined : status,
        limit: 200,
    });
    const staff = useQuery(api.users.listAll, {});

    const createAppointment = useMutation(api.verticals.scheduling.createAppointment);
    const updateStatus = useMutation(api.verticals.scheduling.updateAppointmentStatus);

    const staffOptions = (staff ?? []).map((s: any) => ({
        value: s._id,
        label: `${s.first_name} ${s.last_name}`,
    }));

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

    const setApptStatus = async (id: string, next: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status: next, userId: user._id });
            toast.success(`Marked as ${next}`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={CalendarClock}
                title="Appointments & Bookings"
                description="Manage your diary and keep every chair, room and practitioner booked."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="Book appointment" />}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="space-y-2">
                    <Label htmlFor="appt-date">Date</Label>
                    <Input
                        id="appt-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                        className="w-full sm:w-52"
                    />
                </div>
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
                            {t.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!appointments ? (
                        <LoadingState />
                    ) : appointments.length === 0 ? (
                        <EmptyState
                            title="No appointments for this date"
                            hint="Book an appointment and it will appear here with its status."
                        />
                    ) : (
                        <RecordList
                            records={appointments}
                            renderItem={(a: any) => (
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-black">{a.customerName}</p>
                                            <StatusBadge status={a.status} />
                                        </div>
                                        <p className="mt-1 text-sm text-muted-foreground">
                                            {a.serviceName}
                                            {a.staffName ? ` · ${a.staffName}` : ""}
                                        </p>
                                        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                                            <Clock className="h-3 w-3" />
                                            {a.startTime}
                                            {a.endTime ? ` – ${a.endTime}` : ""}
                                            {a.customerPhone ? ` · ${a.customerPhone}` : ""}
                                        </p>
                                        {a.notes && (
                                            <p className="mt-1 text-xs italic text-muted-foreground">
                                                {a.notes}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 gap-2">
                                        {a.status === "pending" && (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => setApptStatus(a._id, "confirmed")}
                                            >
                                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                                Confirm
                                            </Button>
                                        )}
                                        {a.status !== "completed" && a.status !== "cancelled" && (
                                            <Button
                                                size="sm"
                                                onClick={() => setApptStatus(a._id, "completed")}
                                            >
                                                Complete
                                            </Button>
                                        )}
                                        {a.status !== "cancelled" && a.status !== "completed" && (
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                className="text-destructive hover:bg-destructive/10"
                                                onClick={() => setApptStatus(a._id, "cancelled")}
                                            >
                                                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                                Cancel
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Book an appointment"
                description="Double-booking the same staff member at the same time is blocked automatically."
                submitLabel="Book"
                fields={[
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
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
