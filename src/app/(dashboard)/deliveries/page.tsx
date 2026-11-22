"use client";

/**
 * SMART_BUZ — Deliveries & Dispatch
 *
 * A dispatch board for wholesale distributors and construction suppliers
 * running van deliveries.
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Truck, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";

const DELIVERY_STATUSES = [
    { value: "all", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "dispatched", label: "Dispatched" },
    { value: "delivered", label: "Delivered" },
    { value: "failed", label: "Failed" },
];

const NEXT_STATUS: Record<string, string | null> = {
    pending: "dispatched",
    dispatched: "delivered",
    delivered: null,
    failed: null,
};

export default function DeliveriesPage() {
    const { currency } = useCurrency();
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);

    const deliveries = useQuery(api.verticals.operations.listDeliveries, {
        status: status === "all" ? undefined : status,
    });

    const createDelivery = useMutation(api.verticals.operations.createDelivery);
    const updateStatus = useMutation(api.verticals.operations.updateDeliveryStatus);

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createDelivery({
            customerName: values.customerName,
            destination: values.destination || undefined,
            assignedToName: values.assignedToName || undefined,
            amount: values.amount ? Number(values.amount) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Delivery scheduled");
    };

    const advance = async (id: string, next: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status: next });
            toast.success(`Marked as ${next}`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Truck}
                title="Deliveries & Dispatch"
                description="Plan van runs and keep customers informed on delivery status."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="Schedule delivery" />}
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {DELIVERY_STATUSES.map((s) => (
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
                    {!deliveries ? (
                        <LoadingState />
                    ) : deliveries.length === 0 ? (
                        <EmptyState
                            title="No deliveries here"
                            hint="Schedule a delivery when an order goes out for dispatch, then track it to hand-over."
                        />
                    ) : (
                        <RecordList
                            records={deliveries}
                            renderItem={(d: any) => (
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold text-muted-foreground">
                                                {d.reference}
                                            </p>
                                            <StatusBadge status={d.status} />
                                        </div>
                                        <p className="mt-1 font-black">{d.customerName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {d.destination ?? "Destination not set"}
                                            {d.assignedToName ? ` · ${d.assignedToName}` : ""}
                                            {d.dispatchDate
                                                ? ` · dispatched ${shortDate(d.dispatchDate)}`
                                                : ""}
                                            {d.deliveryDate
                                                ? ` · delivered ${shortDate(d.deliveryDate)}`
                                                : ""}
                                        </p>
                                        {d.notes && (
                                            <p className="mt-1 text-xs italic text-muted-foreground">
                                                {d.notes}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        {d.amount ? (
                                            <p className="text-sm font-black tabular-nums">
                                                {ugx(d.amount)}
                                            </p>
                                        ) : null}
                                        {NEXT_STATUS[d.status] && (
                                            <Button
                                                size="sm"
                                                onClick={() =>
                                                    advance(d._id, NEXT_STATUS[d.status]!)
                                                }
                                            >
                                                {NEXT_STATUS[d.status]}
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
                title="Schedule a delivery"
                submitLabel="Schedule"
                fields={[
                    { name: "customerName", label: "Customer name", required: true },
                    { name: "destination", label: "Destination", placeholder: "e.g. Masaka, Kampala Road" },
                    { name: "assignedToName", label: "Driver / dispatcher" },
                    { name: "amount", label: `Amount (${currency})`, type: "number", min: 0 },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
