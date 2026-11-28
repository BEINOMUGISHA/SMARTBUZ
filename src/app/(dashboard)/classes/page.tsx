"use client";

/**
 * SMART_BUZ — Classes & Students
 *
 * Fee collection and enrolment for schools, driving schools and training
 * centres. Shows what each class owes and what has been paid.
 *
 * An enrolment can be created, amended, inspected and removed — but only
 * while no fees have been collected against it.
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
import { GraduationCap } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

const ENROLMENT_STATUSES = [
    { value: "active", label: "Active" },
    { value: "graduated", label: "Graduated" },
    { value: "withdrawn", label: "Withdrawn" },
];

export default function ClassesPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [createOpen, setCreateOpen] = useState(false);
    const [classFilter, setClassFilter] = useState("");
    const [search, setSearch] = useState("");
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const enrolments = useQuery(api.verticals.operations.listEnrolments, {
        className: classFilter || undefined,
    });
    const attendance = useQuery(api.verticals.operations.listAttendance, {
        className: classFilter || undefined,
    });

    const createEnrolment = useMutation(api.verticals.operations.createEnrolment);
    const updateEnrolment = useMutation(api.verticals.operations.updateEnrolment);
    const deleteEnrolment = useMutation(api.verticals.operations.deleteEnrolment);

    // Group enrolments by class.
    const byClass = new Map<string, any[]>();
    for (const e of enrolments ?? []) {
        const list = byClass.get(e.className) ?? [];
        list.push(e);
        byClass.set(e.className, list);
    }

    const totalDue = (enrolments ?? []).reduce(
        (s, e: any) => s + ((e.amountDue ?? 0) - (e.amountPaid ?? 0)),
        0
    );
    const totalPaid = (enrolments ?? []).reduce((s, e: any) => s + (e.amountPaid ?? 0), 0);

    const createFields: FormField[] = [
        { name: "className", label: "Class", required: true, placeholder: "e.g. Primary 4" },
        { name: "studentName", label: "Student name", required: true },
        { name: "term", label: "Term", placeholder: "e.g. Term 2, 2026" },
        { name: "amountDue", label: `Fees due (${currency})`, type: "number", min: 0 },
    ];

    const editFields: FormField[] = [
        ...createFields,
        { name: "status", label: "Status", type: "select", options: ENROLMENT_STATUSES },
    ];

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createEnrolment({
            className: values.className,
            studentName: values.studentName,
            term: values.term || undefined,
            amountDue: values.amountDue ? Number(values.amountDue) : undefined,
            userId: user._id,
        });
        toast.success("Student enrolled");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        try {
            await updateEnrolment({
                id: editRow._id,
                className: values.className,
                studentName: values.studentName,
                term: values.term || undefined,
                amountDue: values.amountDue ? Number(values.amountDue) : undefined,
                status: values.status || undefined,
                userId: user._id,
            });
            toast.success("Enrolment updated");
        } catch (err) {
            reportError(err, "Could not update the enrolment.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteEnrolment({ id: deleteRow._id, userId: user._id });
            toast.success("Enrolment removed");
        } catch (err) {
            reportError(err, "Could not remove the enrolment.");
            throw err;
        }
    };

    const columns: DataTableColumn<any>[] = [
        {
            id: "student",
            header: "Student",
            accessor: (e: any) => e.studentName ?? "",
            cell: (e: any) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{e.studentName}</p>
                    <p className="text-xs text-muted-foreground">
                        {e.term ? `${e.term} · ` : ""}enrolled {shortDate(e.enrolledDate)}
                    </p>
                </div>
            ),
        },
        {
            id: "class",
            header: "Class",
            accessor: (e: any) => e.className ?? "",
            cell: (e: any) => e.className || "—",
        },
        {
            id: "paid",
            header: "Paid",
            accessor: (e: any) => e.amountPaid ?? 0,
            align: "right",
            cell: (e: any) => (
                <span className="tabular-nums text-success">{ugx(e.amountPaid ?? 0)}</span>
            ),
        },
        {
            id: "outstanding",
            header: "Outstanding",
            accessor: (e: any) => (e.amountDue ?? 0) - (e.amountPaid ?? 0),
            align: "right",
            cell: (e: any) => {
                const outstanding = (e.amountDue ?? 0) - (e.amountPaid ?? 0);
                return (
                    <span
                        className={
                            outstanding > 0
                                ? "font-medium tabular-nums text-warning"
                                : "tabular-nums text-muted-foreground"
                        }
                    >
                        {ugx(Math.max(0, outstanding))}
                    </span>
                );
            },
        },
        {
            id: "status",
            header: "Status",
            accessor: (e: any) => e.status ?? "",
            cell: (e: any) => <StatusBadge status={e.status ?? "active"} />,
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "8rem",
            cell: (e: any) => (
                <div className="flex items-center justify-end">
                    <RecordActions
                        onView={() => setDetailRow(e)}
                        onEdit={() => setEditRow(e)}
                        onDelete={() => setDeleteRow(e)}
                        label={t("Actions for {0}", {
            0: e.studentName,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={GraduationCap}
                title={t("Classes & Students")}
                description={t("Enrol students, track fees due and see attendance at a glance.")}
                actions={<CreateButton onClick={() => setCreateOpen(true)} label={t("Enrol student")} />}
            />

            <StatStrip
                stats={[
                    { label: "Enrolled", value: enrolments?.length ?? 0 },
                    { label: "Classes", value: byClass.size },
                    { label: "Fees collected", value: ugx(totalPaid), tone: "good" },
                    { label: "Fees outstanding", value: ugx(Math.max(0, totalDue)), tone: "warn" },
                ]}
            />

            <div className="flex flex-wrap gap-1.5">
                <Button
                    size="sm"
                    variant={classFilter === "" ? "default" : "outline"}
                    onClick={() => setClassFilter("")}
                >
                    {t("All classes")}
                </Button>
                {Array.from(byClass.keys()).map((c) => (
                    <Button
                        key={c}
                        size="sm"
                        variant={classFilter === c ? "default" : "outline"}
                        onClick={() => setClassFilter(c)}
                    >
                        {c}
                    </Button>
                ))}
            </div>

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
                        <p className="text-xs text-muted-foreground">
                            {attendance.present} {t("present ·")} {attendance.absent} absent of{" "}
                            {attendance.total} records
                        </p>
                    </CardContent>
                </Card>
            )}

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-section-title">{t("Enrolments")}</h2>
                <SearchBox
                    value={search}
                    onChange={setSearch}
                    placeholder={t("Search student or class…")}
                    className="sm:max-w-xs"
                />
            </div>

            {!enrolments ? (
                <LoadingState />
            ) : (
                <DataTable
                    data={enrolments}
                    columns={columns}
                    getRowId={(row: any) => row._id}
                    searchTerm={search}
                    defaultSort={{ id: "student", direction: "asc" }}
                    emptyTitle={t("No students enrolled")}
                    emptyHint={t("Enrol your students or learners and track the fees owed per class.")}
                    ariaLabel="Class enrolments"
                    caption={t("{0} enrolment(s).", {
            0: enrolments.length,
        })}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Enrol a student")}
                submitLabel="Enrol"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit enrolment")}
                description={t("The amount already paid is not editable — it only moves through a fee payment.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.studentName ?? "Enrolment"}
                description={detailRow?.className}
                status={detailRow?.status}
                rows={[
                    { label: "Student", value: detailRow?.studentName ?? "—" },
                    { label: "Class", value: detailRow?.className ?? "—" },
                    { label: "Term", value: detailRow?.term ?? "—" },
                    { label: "Enrolled", value: shortDate(detailRow?.enrolledDate) },
                    { label: "Fees due", value: ugx(detailRow?.amountDue ?? 0) },
                    { label: "Paid", value: ugx(detailRow?.amountPaid ?? 0) },
                    {
                        label: "Outstanding",
                        value: ugx(
                            Math.max(
                                0,
                                (detailRow?.amountDue ?? 0) - (detailRow?.amountPaid ?? 0)
                            )
                        ),
                    },
                    { label: "Status", value: detailRow?.status ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="enrolment"
                description={
                    deleteRow
                        ? `This removes ${deleteRow.studentName} from ${deleteRow.className}. Enrolments with fees collected cannot be deleted.`
                        : undefined
                }
                onConfirm={handleDelete}
            />
        </div>
    );
}
