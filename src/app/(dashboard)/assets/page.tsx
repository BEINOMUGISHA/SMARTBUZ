"use client";

/**
 * SMART_BUZ — Asset Register, Vehicles & Route Fares
 *
 * The heavy-equipment side of the business: what you own, what it is worth,
 * who drives it, and what passengers pay.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatusBadge,
    SearchBox,
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
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Boxes, Bus, Route, Plus, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export default function AssetsPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [tab, setTab] = useState("assets");
    const [search, setSearch] = useState("");
    const [assetOpen, setAssetOpen] = useState(false);
    const [vehicleOpen, setVehicleOpen] = useState(false);
    const [fareOpen, setFareOpen] = useState(false);
    const [editingAsset, setEditingAsset] = useState<any>(null);
    const [editingVehicle, setEditingVehicle] = useState<any>(null);
    const [editingFare, setEditingFare] = useState<any>(null);

    const assets = useQuery(api.verticals.operations.listAssets, {});
    const vehicles = useQuery(api.verticals.operations.listVehicles, {});
    const fares = useQuery(api.verticals.operations.listRouteFares, {});

    const upsertAsset = useMutation(api.verticals.operations.upsertAsset);
    const upsertVehicle = useMutation(api.verticals.operations.upsertVehicle);
    const upsertFare = useMutation(api.verticals.operations.upsertRouteFare);

    const visibleAssets = (assets ?? []).filter(
        (a: any) =>
            !search ||
            a.name.toLowerCase().includes(search.toLowerCase()) ||
            a.assetTag.toLowerCase().includes(search.toLowerCase())
    );

    const handleAsset = async (values: Record<string, string>) => {
        if (!user) return;
        await upsertAsset({
            id: editingAsset?._id,
            assetTag: values.assetTag,
            name: values.name,
            category: values.category || undefined,
            serialNumber: values.serialNumber || undefined,
            status: values.status || "in_use",
            purchaseDate: values.purchaseDate || undefined,
            purchaseCost: values.purchaseCost ? Number(values.purchaseCost) : undefined,
            currentValue: values.currentValue ? Number(values.currentValue) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success(editingAsset ? "Asset updated" : "Asset added");
        setEditingAsset(null);
    };

    const handleVehicle = async (values: Record<string, string>) => {
        await upsertVehicle({
            id: editingVehicle?._id,
            registration: values.registration,
            make: values.make || undefined,
            model: values.model || undefined,
            type: values.type || undefined,
            route: values.route || undefined,
            status: values.status || "active",
            nextServiceDate: values.nextServiceDate || undefined,
            notes: values.notes || undefined,
        });
        toast.success(editingVehicle ? "Vehicle updated" : "Vehicle added");
        setEditingVehicle(null);
    };

    const handleFare = async (values: Record<string, string>) => {
        await upsertFare({
            id: editingFare?._id,
            routeName: values.routeName,
            from: values.from || undefined,
            to: values.to || undefined,
            fare: Number(values.fare),
            vehicleType: values.vehicleType || undefined,
            active: values.active !== "no",
        });
        toast.success(editingFare ? "Fare updated" : "Fare added");
        setEditingFare(null);
    };

    const depreciation = (a: any) => {
        if (!a.purchaseCost || !a.currentValue) return null;
        return Math.round((1 - a.currentValue / a.purchaseCost) * 100);
    };

    const serviceOverdue = (v: any) =>
        v.nextServiceDate && new Date(v.nextServiceDate) < new Date();

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Boxes}
                title={t("Assets, Vehicles & Fares")}
                description={t("Track what you own, what it is worth and what it earns.")}
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="assets" className="rounded-lg text-sm font-bold">
                        <Boxes className="mr-2 h-4 w-4" /> {t("Asset register")}
                    </TabsTrigger>
                    <TabsTrigger value="vehicles" className="rounded-lg text-sm font-bold">
                        <Bus className="mr-2 h-4 w-4" /> {t("Vehicles")}
                    </TabsTrigger>
                    <TabsTrigger value="fares" className="rounded-lg text-sm font-bold">
                        <Route className="mr-2 h-4 w-4" /> {t("Route fares")}
                    </TabsTrigger>
                </TabsList>

                {/* ── Assets ── */}
                <TabsContent value="assets" className="mt-4 space-y-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <SearchBox
                            value={search}
                            onChange={setSearch}
                            placeholder={t("Search assets…")}
                            className="sm:max-w-sm"
                        />
                        <CreateButton
                            onClick={() => {
                                setEditingAsset(null);
                                setAssetOpen(true);
                            }}
                            label={t("Add asset")}
                        />
                    </div>

                    {!assets ? (
                        <LoadingState />
                    ) : visibleAssets.length === 0 ? (
                        <EmptyState
                            title={t("No assets recorded")}
                            hint={t("Register pumps, generators, tools and equipment so you know what the business owns and what it is worth.")}
                        />
                    ) : (
                        <RecordList
                            records={visibleAssets}
                            renderItem={(a: any) => {
                                const dep = depreciation(a);
                                return (
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="font-semibold">{a.name}</p>
                                                <Badge variant="outline" className="font-mono text-xs">
                                                    {a.assetTag}
                                                </Badge>
                                                <StatusBadge status={a.status} />
                                            </div>
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {a.category ?? "Uncategorised"}
                                                {a.serialNumber ? ` · ${a.serialNumber}` : ""}
                                                {a.purchaseDate ? ` · bought ${shortDate(a.purchaseDate)}` : ""}
                                            </p>
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3">
                                            <div className="text-right">
                                                <p className="text-sm font-semibold tabular-nums">
                                                    {ugx(a.currentValue ?? a.purchaseCost ?? 0)}
                                                </p>
                                                {dep !== null && (
                                                    <p className="text-xs text-muted-foreground">
                                                        {dep}{t("% depreciated")}
                                                    </p>
                                                )}
                                            </div>
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setEditingAsset(a);
                                                    setAssetOpen(true);
                                                }}
                                            >
                                                <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                                {t("Edit")}
                                            </Button>
                                        </div>
                                    </div>
                                );
                            }}
                        />
                    )}
                </TabsContent>

                {/* ── Vehicles ── */}
                <TabsContent value="vehicles" className="mt-4 space-y-4">
                    <div className="flex justify-end">
                        <CreateButton
                            onClick={() => {
                                setEditingVehicle(null);
                                setVehicleOpen(true);
                            }}
                            label={t("Add vehicle")}
                        />
                    </div>

                    {!vehicles ? (
                        <LoadingState />
                    ) : vehicles.length === 0 ? (
                        <EmptyState
                            title={t("No vehicles registered")}
                            hint={t("Add your taxis, buses and trucks to track drivers, routes and servicing dates.")}
                        />
                    ) : (
                        <RecordList
                            records={vehicles}
                            renderItem={(v: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-sm font-semibold">
                                                {v.registration}
                                            </p>
                                            <StatusBadge status={v.status ?? "active"} />
                                            {v.type && (
                                                <Badge variant="outline" className="text-xs capitalize">
                                                    {v.type}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {[v.make, v.model].filter(Boolean).join(" ")}
                                            {v.driverName ? ` · ${v.driverName}` : ""}
                                            {v.route ? ` · ${v.route}` : ""}
                                        </p>
                                        {v.nextServiceDate && (
                                            <p
                                                className={`mt-0.5 text-xs font-bold ${serviceOverdue(v)
                                                        ? "text-red-600 dark:text-red-400"
                                                        : "text-muted-foreground"}`}
                                            >
                                                {t("Next service")} {shortDate(v.nextServiceDate)}
                                                {serviceOverdue(v) ? " — OVERDUE" : ""}
                                            </p>
                                        )}
                                    </div>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => {
                                            setEditingVehicle(v);
                                            setVehicleOpen(true);
                                        }}
                                    >
                                        <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                        {t("Edit")}
                                    </Button>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                {/* ── Route fares ── */}
                <TabsContent value="fares" className="mt-4 space-y-4">
                    <div className="flex justify-end">
                        <CreateButton
                            onClick={() => {
                                setEditingFare(null);
                                setFareOpen(true);
                            }}
                            label={t("Add fare")}
                        />
                    </div>

                    {!fares ? (
                        <LoadingState />
                    ) : fares.length === 0 ? (
                        <EmptyState
                            title={t("No routes yet")}
                            hint={t("Add your routes and fares so trips can be priced consistently.")}
                        />
                    ) : (
                        <RecordList
                            records={fares}
                            renderItem={(f: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold">{f.routeName}</p>
                                            {f.vehicleType && (
                                                <Badge variant="outline" className="text-xs capitalize">
                                                    {f.vehicleType}
                                                </Badge>
                                            )}
                                            {f.active === false && (
                                                <Badge variant="destructive" className="text-xs">
                                                    {t("Inactive")}
                                                </Badge>
                                            )}
                                        </div>
                                        {(f.from || f.to) && (
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {f.from} → {f.to}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3">
                                        <p className="text-sm font-semibold tabular-nums">{ugx(f.fare)}</p>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setEditingFare(f);
                                                setFareOpen(true);
                                            }}
                                        >
                                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                            {t("Edit")}
                                        </Button>
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={assetOpen}
                onOpenChange={(v) => {
                    setAssetOpen(v);
                    if (!v) setEditingAsset(null);
                }}
                title={editingAsset ? "Edit asset" : "Add asset"}
                submitLabel={editingAsset ? "Save changes" : "Add asset"}
                fields={[
                    { name: "assetTag", label: "Asset tag", required: true, defaultValue: editingAsset?.assetTag },
                    { name: "name", label: "Asset name", required: true, defaultValue: editingAsset?.name },
                    {
                        name: "category",
                        label: "Category",
                        defaultValue: editingAsset?.category,
                        placeholder: "e.g. pump, generator, tool",
                    },
                    { name: "serialNumber", label: "Serial number", defaultValue: editingAsset?.serialNumber },
                    {
                        name: "status",
                        label: "Status",
                        type: "select",
                        defaultValue: editingAsset?.status ?? "in_use",
                        options: [
                            { value: "in_use", label: "In use" },
                            { value: "idle", label: "Idle" },
                            { value: "maintenance", label: "In maintenance" },
                            { value: "disposed", label: "Disposed" },
                        ],
                    },
                    { name: "purchaseDate", label: "Purchase date", type: "date", defaultValue: editingAsset?.purchaseDate },
                    {
                        name: "purchaseCost",
                        label: `Purchase cost (${currency})`,
                        type: "number",
                        min: 0,
                        defaultValue: editingAsset?.purchaseCost,
                    },
                    {
                        name: "currentValue",
                        label: `Current value (${currency})`,
                        type: "number",
                        min: 0,
                        defaultValue: editingAsset?.currentValue,
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true, defaultValue: editingAsset?.notes },
                ]}
                onSubmit={handleAsset}
            />

            <FormDialog
                open={vehicleOpen}
                onOpenChange={(v) => {
                    setVehicleOpen(v);
                    if (!v) setEditingVehicle(null);
                }}
                title={editingVehicle ? "Edit vehicle" : "Add vehicle"}
                submitLabel={editingVehicle ? "Save changes" : "Add vehicle"}
                fields={[
                    {
                        name: "registration",
                        label: "Registration",
                        required: true,
                        defaultValue: editingVehicle?.registration,
                        placeholder: "e.g. KAA 123A",
                    },
                    { name: "make", label: "Make", defaultValue: editingVehicle?.make },
                    { name: "model", label: "Model", defaultValue: editingVehicle?.model },
                    {
                        name: "type",
                        label: "Type",
                        type: "select",
                        defaultValue: editingVehicle?.type,
                        options: [
                            { value: "taxi", label: "Taxi" },
                            { value: "bus", label: "Bus" },
                            { value: "truck", label: "Truck" },
                            { value: "motorcycle", label: "Motorcycle (boda)" },
                            { value: "car", label: "Car" },
                        ],
                    },
                    { name: "route", label: "Route", defaultValue: editingVehicle?.route },
                    {
                        name: "status",
                        label: "Status",
                        type: "select",
                        defaultValue: editingVehicle?.status ?? "active",
                        options: [
                            { value: "active", label: "Active" },
                            { value: "maintenance", label: "In maintenance" },
                            { value: "off_road", label: "Off road" },
                        ],
                    },
                    {
                        name: "nextServiceDate",
                        label: "Next service date",
                        type: "date",
                        defaultValue: editingVehicle?.nextServiceDate,
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleVehicle}
            />

            <FormDialog
                open={fareOpen}
                onOpenChange={(v) => {
                    setFareOpen(v);
                    if (!v) setEditingFare(null);
                }}
                title={editingFare ? "Edit fare" : "Add route fare"}
                submitLabel={editingFare ? "Save changes" : "Add fare"}
                fields={[
                    {
                        name: "routeName",
                        label: "Route name",
                        required: true,
                        defaultValue: editingFare?.routeName,
                        placeholder: "e.g. Kampala – Entebbe",
                    },
                    { name: "from", label: "From", defaultValue: editingFare?.from },
                    { name: "to", label: "To", defaultValue: editingFare?.to },
                    {
                        name: "fare",
                        label: `Fare (${currency})`,
                        type: "number",
                        required: true,
                        min: 0,
                        defaultValue: editingFare?.fare,
                    },
                    {
                        name: "vehicleType",
                        label: "Vehicle type",
                        type: "select",
                        defaultValue: editingFare?.vehicleType,
                        options: [
                            { value: "taxi", label: "Taxi" },
                            { value: "bus", label: "Bus" },
                            { value: "motorcycle", label: "Boda boda" },
                            { value: "truck", label: "Truck" },
                        ],
                    },
                    {
                        name: "active",
                        label: "Active",
                        type: "select",
                        defaultValue: editingFare?.active === false ? "no" : "yes",
                        options: [
                            { value: "yes", label: "Yes" },
                            { value: "no", label: "No" },
                        ],
                    },
                ]}
                onSubmit={handleFare}
            />
        </div>
    );
}
