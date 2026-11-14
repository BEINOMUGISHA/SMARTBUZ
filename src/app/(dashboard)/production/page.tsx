"use client";

/**
 * SMART_BUZ — Production Batches
 *
 * The production log for bakeries, workshops and agro-processing. Tracks
 * what was made, what has sold and what is about to expire.
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
import { Badge } from "@/components/ui/badge";
import { PackagePlus } from "lucide-react";
import { toast } from "sonner";

export default function ProductionPage() {
    const { user } = useAuth();
    const [createOpen, setCreateOpen] = useState(false);

    const batches = useQuery(api.verticals.operations.listProductionBatches, {});
    const createBatch = useMutation(api.verticals.operations.createProductionBatch);

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        await createBatch({
            productName: values.productName,
            category: values.category || undefined,
            quantityProduced: Number(values.quantityProduced),
            unit: values.unit || undefined,
            batchNumber: values.batchNumber || undefined,
            expiryDate: values.expiryDate || undefined,
            costPerUnit: values.costPerUnit ? Number(values.costPerUnit) : undefined,
            userId: user._id,
        });
        toast.success("Production batch recorded");
    };

    const rows = batches ?? [];
    const totalProduced = rows.reduce((s, b: any) => s + (b.quantityProduced ?? 0), 0);
    const totalSold = rows.reduce((s, b: any) => s + (b.quantitySold ?? 0), 0);
    const expiringSoon = rows.filter((b: any) => {
        if (!b.expiryDate) return false;
        const days = (new Date(b.expiryDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
        return days >= 0 && days <= 3;
    });

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={PackagePlus}
                title="Production Batches"
                description="Log what you produce, how much sold and when it expires."
                actions={<CreateButton onClick={() => setCreateOpen(true)} label="Record batch" />}
            />

            <StatStrip
                stats={[
                    { label: "Batches", value: rows.length },
                    { label: "Units produced", value: totalProduced },
                    { label: "Units sold", value: totalSold, tone: "good" },
                    {
                        label: "Expiring in 3 days",
                        value: expiringSoon.length,
                        tone: expiringSoon.length > 0 ? "warn" : "good",
                    },
                ]}
            />

            {!batches ? (
                <LoadingState />
            ) : rows.length === 0 ? (
                <EmptyState
                    title="No production recorded"
                    hint="Log each batch you make so you can track what sells, what is wasted and what needs discounting before it expires."
                />
            ) : (
                <RecordList
                    records={rows}
                    renderItem={(b: any) => {
                        const remaining = (b.quantityProduced ?? 0) - (b.quantitySold ?? 0);
                        const days = b.expiryDate
                            ? Math.ceil(
                                  (new Date(b.expiryDate).getTime() - Date.now()) /
                                      (24 * 60 * 60 * 1000)
                              )
                            : null;
                        return (
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-black">{b.productName}</p>
                                        <StatusBadge status={b.status ?? "active"} />
                                        {b.category && (
                                            <Badge variant="outline" className="text-[10px]">
                                                {b.category}
                                            </Badge>
                                        )}
                                        {days !== null && days >= 0 && days <= 3 && (
                                            <Badge variant="destructive" className="text-[10px]">
                                                Expires in {days}d
                                            </Badge>
                                        )}
                                    </div>
                                    <p className="mt-0.5 text-xs text-muted-foreground">
                                        {b.quantityProduced} produced · {b.quantitySold ?? 0} sold ·{" "}
                                        <span className="font-bold">{remaining} remaining</span>
                                        {b.unit ? ` ${b.unit}` : ""}
                                        {b.batchNumber ? ` · batch ${b.batchNumber}` : ""}
                                    </p>
                                    {b.expiryDate && (
                                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                                            Expires {shortDate(b.expiryDate)}
                                        </p>
                                    )}
                                </div>
                                {b.costPerUnit ? (
                                    <p className="shrink-0 text-sm font-black tabular-nums">
                                        {ugx(b.costPerUnit)}
                                        <span className="text-[10px] font-normal text-muted-foreground">
                                            {" "}
                                            / unit
                                        </span>
                                    </p>
                                ) : null}
                            </div>
                        );
                    }}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title="Record a production batch"
                submitLabel="Record batch"
                fields={[
                    { name: "productName", label: "Product", required: true, full: true },
                    { name: "category", label: "Category", placeholder: "e.g. Bread, Cakes" },
                    {
                        name: "quantityProduced",
                        label: "Quantity produced",
                        type: "number",
                        required: true,
                        min: 1,
                    },
                    { name: "unit", label: "Unit", placeholder: "e.g. pcs, trays" },
                    { name: "batchNumber", label: "Batch number" },
                    { name: "expiryDate", label: "Expiry date", type: "date" },
                    {
                        name: "costPerUnit",
                        label: "Cost per unit (UGX)",
                        type: "number",
                        min: 0,
                    },
                ]}
                onSubmit={handleCreate}
            />
        </div>
    );
}
