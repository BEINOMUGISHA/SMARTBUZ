"use client";

/**
 * SMART_BUZ — Rentals & Hire
 *
 * Hire-out tracking for power tools, event equipment and vehicles.
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
import { Sparkles, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";

export default function RentalsPage() {
    const { currency } = useCurrency();
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);

    const rentals = useQuery(api.verticals.operations.listRentals, {
        status: status === "all" ? undefined : status,
    });
    const assets = useQuery(api.verticals.operations.listAssets, {});

    const createRental = useMutation(api.verticals.operations.createRental);
    const returnRental = useMutation(api.verticals.operations.returnRental);

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        const asset = (assets ?? []).find((a: any) => a._id === values.assetId);
        await createRental({
            assetId: values.assetId ? (values.assetId as any) : undefined,
            assetName: asset?.name ?? values.assetName,
            customerName: values.customerName,
            startDate: values.startDate,
            endDate: values.endDate || undefined,
            rate: Number(values.rate) || 0,
            deposit: values.deposit ? Number(values.deposit) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Hire recorded");
    };

    const doReturn = async (id: string) => {
        if (!user) return;
        try {
            await returnRental({ id: id as any });
            toast.success("Item returned");
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Sparkles}
                title="Rentals & Hire"
                description="Track what is out on hire and when it comes back."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="New hire" />}
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {["all", "out", "reserved", "returned", "overdue"].map((s) => (
                        <TabsTrigger
                            key={s}
                            value={s}
                            className="rounded-lg text-sm font-bold capitalize"
                        >
                            {s}
                        </TabsTrigger>
                    ))}
                </TabsList>

                <TabsContent value={status} className="mt-4">
                    {!rentals ? (
                        <LoadingState />
                    ) : rentals.length === 0 ? (
                        <EmptyState
                            title="No hires here"
                            hint="Record an item going out on hire so you know where your equipment is."
                        />
                    ) : (
                        <RecordList
                            records={rentals}
                            renderItem={(r: any) => (
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-black">{r.assetName}</p>
                                            <StatusBadge status={r.status} />
                                        </div>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {r.customerName} · from {shortDate(r.startDate)}
                                            {r.endDate ? ` to ${shortDate(r.endDate)}` : ""}
                                        </p>
                                        {r.notes && (
                                            <p className="mt-1 text-xs italic text-muted-foreground">
                                                {r.notes}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-4">
                                        <div className="text-right">
                                            <p className="text-[10px] uppercase text-muted-foreground">
                                                Rate
                                            </p>
                                            <p className="text-sm font-black tabular-nums">
                                                {ugx(r.rate)}
                                            </p>
                                        </div>
                                        {r.deposit ? (
                                            <div className="text-right">
                                                <p className="text-[10px] uppercase text-muted-foreground">
                                                    Deposit
                                                </p>
                                                <p className="text-sm font-black tabular-nums">
                                                    {ugx(r.deposit)}
                                                </p>
                                            </div>
                                        ) : null}
                                        {r.status !== "returned" && (
                                            <Button size="sm" onClick={() => doReturn(r._id)}>
                                                <Undo2 className="mr-1.5 h-3.5 w-3.5" />
                                                Return
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
                title="Record a hire"
                description="Pick the item going out and who has it."
                submitLabel="Record hire"
                fields={[
                    {
                        name: "assetId",
                        label: "Item",
                        type: "select",
                        required: true,
                        options: (assets ?? []).map((a: any) => ({
                            value: a._id,
                            label: `${a.name} (${a.assetTag})`,
                        })),
                        full: true,
                    },
                    { name: "customerName", label: "Customer name", required: true },
                    { name: "startDate", label: "Start date", type: "date", required: true },
                    { name: "endDate", label: "Expected return", type: "date" },
                    { name: "rate", label: `Rate (${currency})`, type: "number", required: true, min: 0 },
                    { name: "deposit", label: `Deposit (${currency})`, type: "number", min: 0 },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
