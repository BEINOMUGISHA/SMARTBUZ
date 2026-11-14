"use client";

/**
 * SMART_BUZ — Classes & Students
 *
 * Fee collection and enrolment for schools, driving schools and training
 * centres. Shows what each class owes and what has been paid.
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
    ugx,
    shortDate,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { GraduationCap, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export default function ClassesPage() {
    const { user } = useAuth();
    const [createOpen, setCreateOpen] = useState(false);
    const [classFilter, setClassFilter] = useState("");

    const enrolments = useQuery(api.verticals.operations.listEnrolments, {
        className: classFilter || undefined,
    });
    const attendance = useQuery(api.verticals.operations.listAttendance, {
        className: classFilter || undefined,
    });

    const createEnrolment = useMutation(api.verticals.operations.createEnrolment);

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

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={GraduationCap}
                title="Classes & Students"
                description="Enrol students, track fees due and see attendance at a glance."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="Enrol student" />}
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
                    All classes
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
                            <p className="text-sm font-black">Attendance rate</p>
                            <p className="text-lg font-black tabular-nums text-emerald-600 dark:text-emerald-400">
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
                            {attendance.present} present · {attendance.absent} absent of{" "}
                            {attendance.total} records
                        </p>
                    </CardContent>
                </Card>
            )}

            {!enrolments ? (
                <LoadingState />
            ) : enrolments.length === 0 ? (
                <EmptyState
                    title="No students enrolled"
                    hint="Enrol your students or learners and track the fees owed per class."
                />
            ) : (
                <div className="space-y-6">
                    {Array.from(byClass.entries()).map(([className, students]) => {
                        const due = students.reduce(
                            (s, e: any) => s + ((e.amountDue ?? 0) - (e.amountPaid ?? 0)),
                            0
                        );
                        const paid = students.reduce((s, e: any) => s + (e.amountPaid ?? 0), 0);
                        return (
                            <div key={className} className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-black">{className}</h3>
                                    <p className="text-xs text-muted-foreground">
                                        {students.length} student(s) ·{" "}
                                        <span className="font-bold text-amber-600 dark:text-amber-400">
                                            {ugx(Math.max(0, due))} outstanding
                                        </span>
                                    </p>
                                </div>
                                <RecordList
                                    records={students}
                                    renderItem={(e: any) => {
                                        const outstanding = (e.amountDue ?? 0) - (e.amountPaid ?? 0);
                                        return (
                                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                                <div className="min-w-0">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                        <p className="font-black">{e.studentName}</p>
                                                        <StatusBadge status={e.status ?? "active"} />
                                                    </div>
                                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                                        {e.term ? `${e.term} · ` : ""}enrolled{" "}
                                                        {shortDate(e.enrolledDate)}
                                                    </p>
                                                </div>
                                                <div className="flex shrink-0 items-center gap-4 text-right">
                                                    <div>
                                                        <p className="text-[10px] uppercase text-muted-foreground">
                                                            Paid
                                                        </p>
                                                        <p className="text-xs font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                                                            {ugx(e.amountPaid ?? 0)}
                                                        </p>
                                                    </div>
                                                    <div>
                                                        <p className="text-[10px] uppercase text-muted-foreground">
                                                            Outstanding
                                                        </p>
                                                        <p
                                                            className={`text-xs font-black tabular-nums ${
                                                                outstanding > 0
                                                                    ? "text-amber-600 dark:text-amber-400"
                                                                    : "text-muted-foreground"
                                                            }`}
                                                        >
                                                            {ugx(Math.max(0, outstanding))}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    }}
                                />
                            </div>
                        );
                    })}
                </div>
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Enrol a student"
                submitLabel="Enrol"
                fields={[
                    { name: "className", label: "Class", required: true, placeholder: "e.g. Primary 4" },
                    { name: "studentName", label: "Student name", required: true },
                    { name: "term", label: "Term", placeholder: "e.g. Term 2, 2026" },
                    { name: "amountDue", label: "Fees due (UGX)", type: "number", min: 0 },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
