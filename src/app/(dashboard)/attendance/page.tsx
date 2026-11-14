"use client";

/**
 * SMART_BUZ — Attendance Register
 *
 * A daily register for schools, gyms, security companies and churches.
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
    RecordList,
    today,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClipboardCheck, Check, X, Clock, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const MARKS = [
    { value: "present", label: "Present", icon: Check, tone: "text-emerald-600 dark:text-emerald-400" },
    { value: "absent", label: "Absent", icon: X, tone: "text-red-600 dark:text-red-400" },
    { value: "late", label: "Late", icon: Clock, tone: "text-amber-600 dark:text-amber-400" },
    { value: "excused", label: "Excused", icon: ShieldQuestion, tone: "text-blue-600 dark:text-blue-400" },
];

export default function AttendancePage() {
    const { user } = useAuth();
    const [date, setDate] = useState(today());
    const [className, setClassName] = useState("");

    const attendance = useQuery(api.verticals.operations.listAttendance, {
        date,
        className: className || undefined,
    });
    const enrolments = useQuery(api.verticals.operations.listEnrolments, {
        className: className || undefined,
    });

    const recordAttendance = useMutation(api.verticals.operations.recordAttendance);

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

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={ClipboardCheck}
                title="Attendance"
                description="Mark the register and keep a daily attendance rate."
            />

            <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                    <Label htmlFor="att-date">Date</Label>
                    <Input
                        id="att-date"
                        type="date"
                        value={date}
                        onChange={(e) => setDate(e.target.value)}
                    />
                </div>
                <div className="space-y-2">
                    <Label htmlFor="att-class">Class (optional)</Label>
                    <Input
                        id="att-class"
                        value={className}
                        onChange={(e) => setClassName(e.target.value)}
                        placeholder="All classes"
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
                    </CardContent>
                </Card>
            )}

            {roster.length === 0 ? (
                <EmptyState
                    title="No register for this date"
                    hint="Enrol students in the Classes tab first, then mark them present, absent, late or excused here."
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
                                        <p className="font-black">{e.studentName}</p>
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
                                            {m.label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        );
                    }}
                />
            )}
        </div>
    );
}
