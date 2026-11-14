"use client";

/**
 * SMART_BUZ — Prescriptions
 *
 * Capture prescriptions for pharmacies and clinics, then dispense against
 * them. Keeps the prescriber, the patient and the drug together.
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
    CreateButton,
    RecordList,
    ugx,
    today,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ClipboardCheck, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

/**
 * Prescriptions are stored as appointments with businessType "prescription".
 * This keeps the schema lean while giving pharmacies a dedicated workflow.
 */
export default function PrescriptionsPage() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [medicine, setMedicine] = useState("");
    const [dosage, setDosage] = useState("");
    const [notes, setNotes] = useState("");

    const prescriptions = useQuery(api.verticals.scheduling.listAppointments, {
        businessType: "prescription",
        limit: 200,
    });

    const createPrescription = useMutation(api.verticals.scheduling.createAppointment);
    const updateStatus = useMutation(api.verticals.scheduling.updateAppointmentStatus);

    const visible = (prescriptions ?? []).filter(
        (p: any) =>
            !search ||
            p.customerName?.toLowerCase().includes(search.toLowerCase()) ||
            p.serviceName?.toLowerCase().includes(search.toLowerCase())
    );

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createPrescription({
            businessType: "prescription",
            customerName: values.customerName,
            customerPhone: values.customerPhone || undefined,
            serviceName: values.medicine,
            date: values.date || today(),
            startTime: values.time || "09:00",
            notes: [values.dosage, values.notes].filter(Boolean).join(" — ") || undefined,
            userId: user._id,
        });
        toast.success("Prescription captured");
    };

    const dispense = async (id: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status: "completed", userId: user._id });
            toast.success("Marked as dispensed");
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const pending = (prescriptions ?? []).filter((p: any) => p.status !== "completed").length;

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={ClipboardCheck}
                title="Prescriptions"
                description="Capture prescriptions from prescribers and track them through to dispensing."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="New prescription" />}
            />

            <StatStrip
                stats={[
                    { label: "Total", value: prescriptions?.length ?? 0 },
                    { label: "Awaiting dispensing", value: pending, tone: "warn" },
                    {
                        label: "Dispensed",
                        value: (prescriptions?.length ?? 0) - pending,
                        tone: "good",
                    },
                ]}
            />

            <SearchBox
                value={search}
                onChange={setSearch}
                placeholder="Search patient or medicine…"
            />

            {!prescriptions ? (
                <LoadingState />
            ) : visible.length === 0 ? (
                <EmptyState
                    title="No prescriptions"
                    hint="Capture a prescription to record what a patient was prescribed, by whom and when."
                />
            ) : (
                <RecordList
                    records={visible}
                    renderItem={(p: any) => (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-black">{p.customerName}</p>
                                    <StatusBadge status={p.status} />
                                </div>
                                <p className="mt-0.5 text-sm font-semibold">{p.serviceName}</p>
                                <p className="text-xs text-muted-foreground">
                                    {p.date}
                                    {p.customerPhone ? ` · ${p.customerPhone}` : ""}
                                </p>
                                {p.notes && (
                                    <p className="mt-1 text-xs italic text-muted-foreground">
                                        {p.notes}
                                    </p>
                                )}
                            </div>
                            {p.status !== "completed" && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="shrink-0"
                                    onClick={() => dispense(p._id)}
                                >
                                    Mark dispensed
                                </Button>
                            )}
                        </div>
                    )}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Capture a prescription"
                description="Record the patient, the medicine and the dosage. Dispensing is tracked from here."
                submitLabel="Capture"
                fields={[
                    { name: "customerName", label: "Patient name", required: true },
                    {
                        name: "customerPhone",
                        label: "Phone",
                        type: "tel",
                        placeholder: "0772 123 456",
                    },
                    { name: "medicine", label: "Medicine / service", required: true, full: true },
                    { name: "dosage", label: "Dosage", placeholder: "e.g. 1 tablet twice daily" },
                    { name: "date", label: "Date", type: "date", defaultValue: today() },
                    { name: "time", label: "Time", type: "time", defaultValue: "09:00" },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
