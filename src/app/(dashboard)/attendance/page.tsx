"use client";

/**
 * SMART_BUZ — Attendance Register
 *
 * A daily register for schools, gyms, security companies and churches.
 *
 * The roster marks the students in; the register below is the record of what
 * was marked, and every mark can be inspected, amended or removed.
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
    RecordList,
    toFormValues,
    today,
    type FormField,
} from "@/components/vertical/ui-kit";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { reportError } from "@/components/error-feedback";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClipboardCheck, Check, X, Clock, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/provider";

const MARKS = [
    { value: "present", label: "Present", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
    { value: "absent", label: "Absent", icon: X, tone: "text-red-600 dark:text-red-400" },
    { value: "late", label: "Late", icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
    { value: "excused", label: "Excused", icon: ShieldQuestion, tone: "text-blue-600 dark:text-blue-400" },
];

const MARK_OPTIONS = MARKS.map((m) => ({ value: m.value, label: m.label }));

export default function AttendancePage() {
    
    const t = useT();const { user } = useAuth();
    const [date, setDate] = useState(today());
    const [className, setClassName] = useState("");
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const attendance = useQuery(api.verticals.operations.listAttendance, {
        date,
        className: className || undefined,
    });
    const enrolments = useQuery(api.verticals.operations.listEnrolments, {
        className: className || undefined,
    });

    const recordAttendance = useMutation(api.verticals.operations.recordAttendance);
    const updateAttendance = useMutation(api.verticals.operations.updateAttendance);
    const deleteAttendance = useMutation(api.verticals.operations.deleteAttendance);

    const mark = async (person: any, status: string) => {
        if (!user) return;
        try {
            await recordAttendance({
                personId: person.studentId,
                personName: person.studentName,
                className: person.className,
                date,
                status,
                userId: user._id,
            });
        } catch (err: any) {
            toast.error(err?.message ?? "Could not record attendance.");
        }
    };

    // Merge enrolled students with anyone already marked today.
    const marked = new Map<string, any>();
    for (const r of attendance?.rows ?? []) {
        marked.set(r.personName, r);
    }

    const roster = (enrolments ?? []).filter((e: any) => {
        if (className && e.className !== className) return false;
        return true;
    });

    const markFields: FormField[] = [
        { name: "personName", label: "Person", required: true, full: true },
        { name: "className", label: "Class", defaultValue: className },
        { name: "date", label: "Date", type: "date", required: true, defaultValue: date },
        { name: "status", label: "Mark", type: "select", required: true, options: MARK_OPTIONS },
    ];

    const editFields: FormField[] = [
        { name: "personName", label: "Person", required: true, full: true },
        { name: "className", label: "Class" },
        { name: "date", label: "Date", type: "date", required: true },
        { name: "status", label: "Mark", type: "select", required: true, options: MARK_OPTIONS },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        try {
            await recordAttendance({
                personName: values.personName,
                className: values.className || undefined,
                date: values.date,
                status: values.status,
                userId: user._id,
            });
            toast.success("Attendance recorded");
        } catch (err) {
            reportError(err, "Could not record the attendance mark.");
            throw err;
        }
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateAttendance({
                id: editRow._id,
                personName: values.personName,
                className: values.className || undefined,
                date: values.date,
                status: values.status,
                userId: user._id,
            });
            toast.success("Attendance updated");
        } catch (err) {
            reportError(err, "Could not update the attendance mark.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteAttendance({ id: deleteRow._id, userId: user._id });
            toast.success("Attendance mark removed");
        } catch (err) {
            reportError(err, "Could not remove the attendance mark.");
            throw err;
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "person",
            header: "Person",
            accessor: (r: any) => r.personName ?? "",
            cell: (r: any) => (
                <p className="truncate font-medium text-foreground">{r.personName}</p>
            ),
        },
        {
            id: "class",
            header: "Class",
            accessor: (r: any) => r.className ?? "",
            cell: (r: any) => r.className || "—",
            hideBelow: "sm",
        },
        {
            id: "date",
            header: "Date",
            accessor: (r: any) => r.date ?? "",
            cell: (r: any) => <span className="tabular-nums">{r.date}</span>,
        },
        {
            id: "status",
            header: "Mark",
            accessor: (r: any) => r.status ?? "",
            cell: (r: any) => <StatusBadge status={r.status ?? "present"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "8rem",
            cell: (r: any) => (
                <div className="flex items-center justify-end">
                    <RecordActions
                        onView={() => setDetailRow(r)}
                        onEdit={() => setEditRow(r)}
                        onDelete={() => setDeleteRow(r)}
                        label={t("Actions for {0}", {
            0: r.personName,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={ClipboardCheck}
                title={t("Attendance")}
                description={t("Mark the register and keep a daily attendance rate.")}
                actions={
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                        {t("Record a mark")}
                    </Button>
                }
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="att-date">{t("Date")}</Label>
                    <Input
                        id="att-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="att-class">{t("Class (optional)")}</Label>
                    <Input
                        id="att-class"
                        value={className}
                        onChange={(e) => setClassName(e.target.value)}
                        placeholder={t("All classes")}
                    />
                </div>
            </div>

            {attendance && (
                <StatStrip
                    stats={[
                        { label: "Records", value: attendance.total },
                        { label: "Present", value: attendance.present, tone: "good" },
                        { label: "Absent", value: attendance.absent, tone: "danger" },
                        { label: "Attendance rate", value: `${attendance.attendanceRate}%` },
                    ]}
                />
            )}

            {attendance && attendance.total > 0 && (
                <Card>
                    <CardContent className="space-y-3 p-5">
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-semibold">{t("Attendance rate")}</p>
                            <p className="text-lg font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                                {attendance.attendanceRate}%
                            </p>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                            <div
                                className="h-full rounded-full bg-emerald-500 transition-all"
                                style={{ width: `${attendance.attendanceRate}%` }}
                            />
                        </div>
                    </CardContent>
                </Card>
            )}

            <section className="space-y-3">
                <h2 className="text-section-title">{t("Register")}</h2>
                {roster.length === 0 ? (
                    <EmptyState
                        title={t("No register for this date")}
                        hint={t("Enrol students in the Classes tab first, then mark them present, absent, late or excused here.")}
                    />
                ) : (
                    <RecordList
                        records={roster}
                        renderItem={(e: any) => {
                            const record = marked.get(e.studentName);
                            const current = record?.status;
                            return (
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold">{e.studentName}</p>
                                            {current && <StatusBadge status={current} />}
                                        </div>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {e.className}
                                            {e.term ? ` · ${e.term}` : ""}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 flex-wrap gap-1.5">
                                        {MARKS.map((m) => (
                                            <Button
                                                key={m.value}
                                                size="sm"
                                                variant={
                                                    current === m.value ? "default" : "outline"
                                                }
                                                onClick={() => mark(e, m.value)}
                                                className={cn(
                                                    current === m.value && "bg-transparent",
                                                    current === m.value && m.tone,
                                                    current === m.value &&
                                                        "border-current hover:bg-transparent"
                                                )}
                                            >
                                                <m.icon className="mr-1.5 h-3.5 w-3.5" />
                                                {t(m.label)}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            );
                        }}
                    />
                )}
            </section>

            <section className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <h2 className="text-section-title">{t("Recorded marks")}</h2>
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder={t("Search person or class…")}
                        className="sm:max-w-xs"
                    />
                </div>
                {!attendance ? (
                    <LoadingState />
                ) : (
                    <DataTable
                        data={attendance.rows}
                        columns={columns}
                        getRowId={(row: any) => row._id}
                        searchTerm={search}
                        defaultSort={{ id: "person", direction: "asc" }}
                        emptyTitle={t("Nothing recorded yet")}
                        emptyHint={t("Mark the register above and the record will appear here.")}
                        ariaLabel="Attendance records"
                        caption={t("{0} record(s) on {1}.", {
            0: attendance.total,
            1: date,
        })}
                    />
                )}
            </section>

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Record an attendance mark")}
                description={t("Use this for anyone who is not on the class roster.")}
                submitLabel="Record mark"
                fields={markFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit attendance mark")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.personName ?? "Attendance"}
                description={detailRow?.className}
                status={detailRow?.status}
                rows={[
                    { label: "Person", value: detailRow?.personName ?? "—" },
                    { label: "Class", value: detailRow?.className ?? "—" },
                    { label: "Date", value: detailRow?.date ?? "—" },
                    { label: "Mark", value: detailRow?.status ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="attendance mark"
                description={
                    deleteRow
                        ? `This removes the ${deleteRow.status} mark for ${deleteRow.personName} on ${deleteRow.date}.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
