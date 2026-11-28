"use client";

/**
 * SMART_BUZ — Batches, Expiry Watch & Serials
 *
 * The pharmacy / supermarket / butchery screen. Batch tracking with FEFO
 * consumption, expiry alerting, and IMEI/serial registration for phones,
 * appliances and salvage goods.
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
    shortDate,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Boxes,
    PackagePlus,
    AlertTriangle,
    ScanLine,
    Plus,
    Loader2,
    Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export default function BatchesPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const [tab, setTab] = useState("batches");
    const [search, setSearch] = useState("");
    const [addOpen, setAddOpen] = useState(false);
    const [serialOpen, setSerialOpen] = useState(false);
    const [stockId, setStockId] = useState("");

    const stocks = useQuery(api.stocks.listAll, {} as any);
    const expiry = useQuery(api.verticals.batches.getExpirySummary, { withinDays: 30 });
    const batches = useQuery(api.verticals.batches.listBatches, {});
    const serials = useQuery(api.verticals.batches.listSerials, {
        search: search || undefined,
        limit: 100,
    });

    const addBatch = useMutation(api.verticals.batches.addBatch);
    const addSerial = useMutation(api.verticals.batches.addSerial);

    const stockOptions = (stocks ?? []).map((s: any) => ({
        value: s._id,
        label: `${s.name} (${s.productCode})`,
    }));

    const visibleBatches = (batches ?? []).filter(
        (b: any) =>
            !search ||
            b.batchNumber.toLowerCase().includes(search.toLowerCase()) ||
            (b.supplier ?? "").toLowerCase().includes(search.toLowerCase())
    );

    const handleAddBatch = async (values: Record<string, string>) => {
        if (!user) return;
        await addBatch({
            stockId: values.stockId as any,
            batchNumber: values.batchNumber,
            expiryDate: values.expiryDate || undefined,
            qtyReceived: Number(values.qtyReceived),
            costPrice: values.costPrice ? Number(values.costPrice) : undefined,
            supplier: values.supplier || undefined,
            userId: user._id,
        });
        toast.success("Batch added and stock updated");
    };

    const handleAddSerial = async (values: Record<string, string>) => {
        if (!user) return;
        await addSerial({
            stockId: values.stockId as any,
            serialNumber: values.serialNumber,
            imei: values.imei || undefined,
            condition: values.condition || undefined,
            warrantyExpiry: values.warrantyExpiry || undefined,
            userId: user._id,
        });
        toast.success("Serial registered");
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Boxes}
                title={t("Batches & Expiry")}
                description={t("Track batch numbers, expiry dates and serial/IMEI numbers for every stock line.")}
                actions={
                    tab === "serials" ? (
                        <CreateButton onClick={() => setSerialOpen(true)} label={t("Register serial")} />
                    ) : (
                        <CreateButton onClick={() => setAddOpen(true)} label={t("Add batch")} />
                    )
                }
            />

            {expiry && (
                <StatStrip
                    stats={[
                        { label: "Total batches", value: expiry.totalBatches },
                        { label: "Expiring ≤30 days", value: expiry.expiring, tone: "warn" },
                        { label: "Already expired", value: expiry.expired, tone: "danger" },
                        {
                            label: "Value at risk",
                            value: ugx(expiry.expiringValue),
                            tone: expiry.expiringValue > 0 ? "warn" : "good",
                        },
                    ]}
                />
            )}

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-11 w-full grid-cols-3 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="batches" className="rounded-lg text-sm font-bold">
                        <Boxes className="mr-2 h-4 w-4" /> {t("Batches")}
                    </TabsTrigger>
                    <TabsTrigger value="expiry" className="rounded-lg text-sm font-bold">
                        <AlertTriangle className="mr-2 h-4 w-4" /> {t("Expiry watch")}
                    </TabsTrigger>
                    <TabsTrigger value="serials" className="rounded-lg text-sm font-bold">
                        <ScanLine className="mr-2 h-4 w-4" /> {t("Serials &amp; IMEI")}
                    </TabsTrigger>
                </TabsList>

                {/* ── Batches ── */}
                <TabsContent value="batches" className="mt-4 space-y-4">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder={t("Search batch number or supplier…")}
                    />

                    {!batches ? (
                        <LoadingState />
                    ) : visibleBatches.length === 0 ? (
                        <EmptyState
                            title={t("No batches recorded")}
                            hint={t("Add a batch whenever you receive stock with a batch number or expiry date. Quantities are added to your stock automatically.")}
                        />
                    ) : (
                        <RecordList
                            records={visibleBatches}
                            renderItem={(b: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold">{b.batchNumber}</p>
                                            <StatusBadge status={b.status} />
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {b.qtyRemaining} of {b.qtyReceived} remaining
                                            {b.supplier ? ` · ${b.supplier}` : ""}
                                            {b.expiryDate
                                                ? ` · expires ${shortDate(b.expiryDate)}`
                                                : " · no expiry"}
                                        </p>
                                    </div>
                                    <div className="text-left sm:text-right">
                                        {b.costPrice ? (
                                            <p className="text-sm font-bold tabular-nums">
                                                {ugx(b.costPrice)}
                                            </p>
                                        ) : null}
                                        <p className="text-xs text-muted-foreground">
                                            {shortDate(b.date)}
                                        </p>
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                {/* ── Expiry watch ── */}
                <TabsContent value="expiry" className="mt-4 space-y-4">
                    {!expiry ? (
                        <LoadingState />
                    ) : expiry.soon.length === 0 ? (
                        <EmptyState
                            title={t("Nothing is expiring")}
                            hint={t("No batch expires within the next 30 days. Keep up the good work.")}
                        />
                    ) : (
                        <RecordList
                            records={expiry.soon}
                            renderItem={(b: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-semibold">{b.productName}</p>
                                            <StatusBadge status={b.status} />
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {t("Batch")} {b.batchNumber} · {b.qtyRemaining} units
                                            {b.expiryDate ? ` · ${shortDate(b.expiryDate)}` : ""}
                                        </p>
                                    </div>
                                    <Badge
                                        variant={b.daysToExpiry < 0 ? "destructive" : "outline"}
                                        className="shrink-0 text-xs font-bold"
                                    >
                                        {b.daysToExpiry < 0
                                            ? `Expired ${Math.abs(b.daysToExpiry)}d ago`
                                            : `${b.daysToExpiry}d left`}
                                    </Badge>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                {/* ── Serials ── */}
                <TabsContent value="serials" className="mt-4 space-y-4">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder={t("Search serial number or IMEI…")}
                    />

                    {!serials ? (
                        <LoadingState />
                    ) : serials.length === 0 ? (
                        <EmptyState
                            title={t("No serials registered")}
                            hint={t("Register IMEI and serial numbers for phones, appliances and second-hand goods so you can trace every unit.")}
                        />
                    ) : (
                        <RecordList
                            records={serials}
                            renderItem={(s: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-sm font-semibold">
                                                {s.serialNumber}
                                            </p>
                                            <StatusBadge status={s.status} />
                                            {s.condition && (
                                                <Badge variant="outline" className="text-xs capitalize">
                                                    {s.condition.replace(/_/g, " ")}
                                                </Badge>
                                            )}
                                        </div>
                                        {s.imei && (
                                            <p className="mt-1 flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                                                <Smartphone className="h-3 w-3" /> {t("IMEI")} {s.imei}
                                            </p>
                                        )}
                                        {s.warrantyExpiry && (
                                            <p className="mt-1 text-xs text-muted-foreground">
                                                {t("Warranty until")} {shortDate(s.warrantyExpiry)}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            {/* Add batch dialog */}
            <FormDialog
                open={addOpen}
                onOpenChange={setAddOpen}
                title={t("Add stock batch")}
                description={t("Adds the received quantity to your stock and starts tracking the expiry date.")}
                submitLabel="Add batch"
                fields={[
                    {
                        name: "stockId",
                        label: "Product",
                        type: "select",
                        required: true,
                        options: stockOptions,
                        full: true,
                    },
                    { name: "batchNumber", label: "Batch number", required: true },
                    { name: "qtyReceived", label: "Quantity received", type: "number", required: true, min: 1 },
                    { name: "expiryDate", label: "Expiry date", type: "date" },
                    { name: "costPrice", label: `Cost price (${currency})`, type: "number", min: 0 },
                    { name: "supplier", label: "Supplier", placeholder: "e.g. Kampala Pharmaceuticals" },
                ]}
                onSubmit={handleAddBatch}
            />

            {/* Register serial dialog */}
            <FormDialog
                open={serialOpen}
                onOpenChange={setSerialOpen}
                title={t("Register serial / IMEI")}
                description={t("Every unit gets a traceable identity for warranty and resale.")}
                submitLabel="Register"
                fields={[
                    {
                        name: "stockId",
                        label: "Product",
                        type: "select",
                        required: true,
                        options: stockOptions,
                        full: true,
                    },
                    { name: "serialNumber", label: "Serial number", required: true },
                    { name: "imei", label: "IMEI", hint: "For mobile phones" },
                    {
                        name: "condition",
                        label: "Condition",
                        type: "select",
                        options: [
                            { value: "new", label: "New" },
                            { value: "grade_a", label: "Grade A" },
                            { value: "grade_b", label: "Grade B" },
                            { value: "used", label: "Used" },
                        ],
                    },
                    { name: "warrantyExpiry", label: "Warranty expiry", type: "date" },
                ]}
                onSubmit={handleAddSerial}
            />
        </div>
    );
}
