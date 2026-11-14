"use client";

/**
 * SMART_BUZ — Rooms
 *
 * Room management for hotels, guest houses and beauty studios. Shows live
 * availability, room rates and lets you check guests in and out.
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
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Building2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

const OUTLET_TYPE = "room";

export default function RoomsPage() {
    const { user } = useAuth();
    const [createOpen, setCreateOpen] = useState(false);

    const rooms = useQuery(api.verticals.scheduling.listOutlets, {
        businessType: OUTLET_TYPE,
    });

    const createOutlet = useMutation(api.verticals.scheduling.createOutlet);
    const updateStatus = useMutation(api.verticals.scheduling.updateOutletStatus);

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

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Building2}
                title="Rooms"
                description="Track room availability, rates and guest check-in."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="Add room" />}
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

            {!rooms ? (
                <LoadingState />
            ) : rows.length === 0 ? (
                <EmptyState
                    title="No rooms yet"
                    hint="Add your rooms or chalets so you can see availability at a glance and check guests in."
                />
            ) : (
                <RecordList
                    records={rows}
                    renderItem={(r: any) => (
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-black">{r.name}</p>
                                    <StatusBadge status={r.status} />
                                </div>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {r.capacity ? `Sleeps ${r.capacity}` : ""}
                                    {r.rate ? ` · ${ugx(r.rate)} per night` : ""}
                                </p>
                                {r.notes && (
                                    <p className="mt-1 text-xs italic text-muted-foreground">
                                        {r.notes}
                                    </p>
                                )}
                            </div>
                            <div className="flex shrink-0 gap-2">
                                {r.status !== "occupied" && (
                                    <Button
                                        size="sm"
                                        onClick={() => setStatus(r._id, "occupied")}
                                    >
                                        Check in
                                    </Button>
                                )}
                                {r.status === "occupied" && (
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => setStatus(r._id, "cleaning")}
                                    >
                                        Check out
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Add a room"
                submitLabel="Add room"
                fields={[
                    { name: "name", label: "Room name / number", required: true, full: true },
                    { name: "capacity", label: "Sleeps", type: "number", min: 1 },
                    { name: "rate", label: "Rate per night (UGX)", type: "number", min: 0 },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
