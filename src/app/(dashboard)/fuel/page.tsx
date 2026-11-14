"use client";

/**
 * SMART_BUZ — Fuel Station Console
 *
 * Pump management, per-litre dispensing and attendant reconciliation.
 * A fuel station loses money to pump tampering and unrecorded sales, so the
 * console tracks litres, price per litre and who dispensed it.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    LoadingState,
    EmptyState,
    FormDialog,
    CreateButton,
    RecordList,
    ugx,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Fuel, Droplets, Plus, Gauge } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

const FUEL_TYPES = [
    { value: "petrol", label: "Petrol" },
    { value: "diesel", label: "Diesel" },
    { value: "kerosene", label: "Kerosene" },
    { value: "premium", label: "Premium Petrol" },
];

export default function FuelPage() {
    const { user } = useAuth();
    const [tab, setTab] = useState("pumps");
    const [dispenseOpen, setDispenseOpen] = useState(false);
    const [pumpOpen, setPumpOpen] = useState(false);
    const [selectedPump, setSelectedPump] = useState<any>(null);

    const summary = useQuery(api.verticals.operations.getFuelSummary, {});
    const pumps = useQuery(api.verticals.operations.listAssets, { category: "pump" });

    const recordDispense = useMutation(api.verticals.operations.recordFuelDispense);
    const upsertAsset = useMutation(api.verticals.operations.upsertAsset);

    const handleDispense = async (values: Record<string, string>) => {
        if (!user) return;
        const litres = Number(values.litres);
        const pricePerLitre = Number(values.pricePerLitre);
        const res = await recordDispense({
            pumpName: values.pumpName,
            fuelType: values.fuelType,
            litres,
            pricePerLitre,
            vehicleReg: values.vehicleReg || undefined,
            userId: user._id,
        });
        toast.success(`Dispensed ${litres} L — ${ugx(res.total)}`);
    };

    const handleAddPump = async (values: Record<string, string>) => {
        if (!user) return;
        await upsertAsset({
            assetTag: values.assetTag,
            name: values.name,
            category: "pump",
            serialNumber: values.serialNumber || undefined,
            status: "in_use",
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Pump added");
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Fuel}
                title="Fuel Station"
                description="Track pumps, litres dispensed and attendant reconciliation."
                actions={
                    <>
                        <CreateButton
                            onClick={() => {
                                setSelectedPump(null);
                                setPumpOpen(true);
                            }}
                            label="Add pump"
                        />
                        <CreateButton
                            onClick={() => {
                                setSelectedPump(null);
                                setDispenseOpen(true);
                            }}
                            label="Record dispense"
                        />
                    </>
                }
            />

            {summary && (
                <StatStrip
                    stats={[
                        { label: "Litres dispensed", value: summary.totalLitres.toFixed(1) },
                        { label: "Revenue", value: ugx(summary.totalRevenue), tone: "good" },
                        { label: "Transactions", value: summary.count },
                        {
                            label: "Pumps",
                            value: pumps?.length ?? 0,
                        },
                    ]}
                />
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="pumps" className="rounded-lg text-sm font-bold">
                        <Gauge className="mr-2 h-4 w-4" /> Pumps
                    </TabsTrigger>
                    <TabsTrigger value="types" className="rounded-lg text-sm font-bold">
                        <Droplets className="mr-2 h-4 w-4" /> By fuel type
                    </TabsTrigger>
                    <TabsTrigger value="attendants" className="rounded-lg text-sm font-bold">
                        Attendants
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="pumps" className="mt-4">
                    {!pumps ? (
                        <LoadingState />
                    ) : pumps.length === 0 ? (
                        <EmptyState
                            title="No pumps registered"
                            hint="Add your pumps so staff can record which pump dispensed which fuel."
                        />
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {pumps.map((p: any) => (
                                <button
                                    key={p._id}
                                    type="button"
                                    onClick={() => {
                                        setSelectedPump(p);
                                        setDispenseOpen(true);
                                    }}
                                    className="rounded-2xl border-2 border-emerald-500/40 bg-emerald-500/5 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-emerald-500 hover:shadow-md"
                                >
                                    <div className="flex items-start justify-between">
                                        <p className="text-lg font-black">{p.name}</p>
                                        <Badge variant="outline" className="text-[10px]">
                                            {p.assetTag}
                                        </Badge>
                                    </div>
                                    <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                                        <Droplets className="h-3.5 w-3.5" />
                                        Tap to dispense
                                    </p>
                                </button>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="types" className="mt-4">
                    {!summary ? (
                        <LoadingState />
                    ) : Object.keys(summary.byType).length === 0 ? (
                        <EmptyState title="No dispensing recorded yet" />
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            {Object.entries(summary.byType).map(([type, v]: any) => (
                                <Card key={type}>
                                    <CardContent className="space-y-2 p-5">
                                        <p className="text-sm font-black capitalize">{type}</p>
                                        <p className="text-3xl font-black tabular-nums text-emerald-600 dark:text-emerald-400">
                                            {v.litres.toFixed(1)}
                                            <span className="ml-1 text-sm font-bold text-muted-foreground">
                                                L
                                            </span>
                                        </p>
                                        <Separator />
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">Revenue</span>
                                            <span className="font-black tabular-nums">
                                                {ugx(v.revenue)}
                                            </span>
                                        </div>
                                        <div className="flex justify-between text-xs">
                                            <span className="text-muted-foreground">
                                                Dispenses
                                            </span>
                                            <span className="font-black tabular-nums">{v.count}</span>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="attendants" className="mt-4">
                    {!summary ? (
                        <LoadingState />
                    ) : summary.byAttendant.length === 0 ? (
                        <EmptyState title="No attendant records yet" />
                    ) : (
                        <RecordList
                            records={summary.byAttendant}
                            renderItem={(a: any) => (
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-black">{a.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {a.litres.toFixed(1)} litres dispensed
                                        </p>
                                    </div>
                                    <p className="text-sm font-black tabular-nums">
                                        {ugx(a.revenue)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={dispenseOpen}
                onOpenChange={setDispenseOpen}
                title="Record fuel dispense"
                description="Litres and price per litre are recorded for reconciliation."
                submitLabel="Record dispense"
                fields={[
                    {
                        name: "pumpName",
                        label: "Pump",
                        type: "select",
                        required: true,
                        options: (pumps ?? []).map((p: any) => ({
                            value: p.name,
                            label: p.name,
                        })),
                        defaultValue: selectedPump?.name,
                        full: true,
                    },
                    { name: "fuelType", label: "Fuel type", type: "select", required: true, options: FUEL_TYPES },
                    { name: "litres", label: "Litres", type: "number", required: true, min: 0.01, step: 0.01 },
                    { name: "pricePerLitre", label: "Price per litre (UGX)", type: "number", required: true, min: 0 },
                    {
                        name: "vehicleReg",
                        label: "Vehicle registration",
                        placeholder: "e.g. KAA 123A",
                        full: true,
                    },
                ]}
                onSubmit={handleDispense}
            />

            <FormDialog
                open={pumpOpen}
                onOpenChange={setPumpOpen}
                title="Add pump"
                submitLabel="Add pump"
                fields={[
                    { name: "assetTag", label: "Pump tag", required: true, placeholder: "e.g. PUMP-01" },
                    { name: "name", label: "Pump name", required: true, placeholder: "e.g. Pump 1" },
                    { name: "serialNumber", label: "Serial number" },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleAddPump}
            />
        </div>
    );
}
