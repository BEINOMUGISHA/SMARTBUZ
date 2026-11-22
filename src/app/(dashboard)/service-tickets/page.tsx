"use client";

/**
 * SMART_BUZ — Service Jobs (Repair, laundry, cleaning, alterations)
 *
 * A job-ticket board for the trades that sell work rather than goods.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Scissors, Plus } from "lucide-react";
import { toast } from "sonner";
import { useCurrency } from "@/hooks/use-currency";

const JOB_STATUSES = [
    { value: "all", label: "All" },
    { value: "received", label: "Received" },
    { value: "in_progress", label: "In progress" },
    { value: "ready", label: "Ready" },
    { value: "delivered", label: "Delivered" },
    { value: "cancelled", label: "Cancelled" },
];

export default function ServiceTicketsPage() {
    const { currency } = useCurrency();
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);

    const tickets = useQuery(api.verticals.operations.listServiceTickets, {
        status: status === "all" ? undefined : status,
        limit: 200,
    });

    const createTicket = useMutation(api.verticals.operations.createServiceTicket);
    const updateTicket = useMutation(api.verticals.operations.updateServiceTicket);

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createTicket({
            customerName: values.customerName,
            customerPhone: values.customerPhone || undefined,
            serviceType: values.serviceType,
            description: values.description || undefined,
            estimatedCost: values.estimatedCost
                ? Number(values.estimatedCost)
                : undefined,
            priority: values.priority || "normal",
            dueDate: values.dueDate || undefined,
            userId: user._id,
        });
        toast.success("Job ticket created");
    };

    const advance = async (id: string, next: string) => {
        if (!user) return;
        try {
            await updateTicket({ id: id as any, status: next });
            toast.success(`Job marked ${next.replace("_", " ")}`);
        } catch (err: any) {
            toast.error(err?.message ?? "Could not update the job.");
        }
    };

    const nextStatus: Record<string, string | null> = {
        received: "in_progress",
        in_progress: "ready",
        ready: "delivered",
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Scissors}
                title="Service Jobs"
                description="Track every repair, wash or visit from intake to hand-over."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="New job" />}
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {JOB_STATUSES.map((s) => (
                        <TabsTrigger
                            key={s.value}
                            value={s.value}
                            className="rounded-lg text-sm font-bold"
                        >
                            {s.label}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!tickets ? (
                        <LoadingState />
                    ) : tickets.length === 0 ? (
                        <EmptyState
                            title="No jobs here"
                            hint="Create a job ticket when a customer brings work in. Jobs move from received → in progress → ready → delivered."
                        />
                    ) : (
                        <RecordList
                            records={tickets}
                            renderItem={(t: any) => (
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold text-muted-foreground">
                                                {t.ticketNumber}
                                            </p>
                                            <StatusBadge status={t.status} />
                                            {t.priority === "high" && (
                                                <Badge variant="destructive" className="text-[10px]">
                                                    High priority
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="mt-1 font-black">{t.customerName}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {t.serviceType}
                                            {t.customerPhone ? ` · ${t.customerPhone}` : ""}
                                        </p>
                                        {t.description && (
                                            <p className="mt-1 text-xs italic text-muted-foreground">
                                                {t.description}
                                            </p>
                                        )}
                                        <p className="mt-1 text-[10px] text-muted-foreground">
                                            Received {shortDate(t.receivedDate)}
                                            {t.dueDate ? ` · due ${shortDate(t.dueDate)}` : ""}
                                        </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        <div className="text-right">
                                            <p className="text-sm font-black tabular-nums">
                                                {ugx(t.finalCost ?? t.estimatedCost ?? 0)}
                                            </p>
                                            <p className="text-[10px] text-muted-foreground">
                                                {t.finalCost ? "final" : "estimate"}
                                            </p>
                                        </div>
                                        {nextStatus[t.status] && (
                                            <Button
                                                size="sm"
                                                onClick={() =>
                                                    advance(t._id, nextStatus[t.status]!)
                                                }
                                            >
                                                {nextStatus[t.status]!.replace("_", " ")}
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
                title="New service job"
                submitLabel="Create job"
                fields={[
                    { name: "customerName", label: "Customer name", required: true },
                    {
                        name: "customerPhone",
                        label: "Phone",
                        type: "tel",
                        placeholder: "0772 123 456",
                    },
                    { name: "serviceType", label: "Service type", required: true, full: true },
                    { name: "description", label: "Job description", type: "textarea", full: true },
                    {
                        name: "estimatedCost",
                        label: `Estimated cost (${currency})`,
                        type: "number",
                        min: 0,
                    },
                    {
                        name: "priority",
                        label: "Priority",
                        type: "select",
                        options: [
                            { value: "low", label: "Low" },
                            { value: "normal", label: "Normal" },
                            { value: "high", label: "High" },
                        ],
                    },
                    { name: "dueDate", label: "Due date", type: "date" },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
