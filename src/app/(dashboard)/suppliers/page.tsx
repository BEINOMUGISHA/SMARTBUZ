"use client";

/**
 * SMART_BUZ — Suppliers
 *
 * Real purchasing relationships: supplier records with payment terms, and the
 * goods-received history that backs every stock increase.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
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
import { Truck, Plus, Pencil, PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

export default function SuppliersPage() {
    const { user } = useAuth();
    const [tab, setTab] = useState("suppliers");
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const suppliers = useQuery(api.verticals.operations.listSuppliers, {
        search: search || undefined,
    });
    const receipts = useQuery(api.verticals.operations.listGoodsReceipts, { limit: 100 });

    const upsertSupplier = useMutation(api.verticals.operations.upsertSupplier);

    const handleSave = async (values: Record<string, string>) => {
        if (!user) return;
        await upsertSupplier({
            id: editing?._id,
            name: values.name,
            contact: values.contact || undefined,
            phone: values.phone || undefined,
            email: values.email || undefined,
            address: values.address || undefined,
            paymentTerms: values.paymentTerms || undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success(editing ? "Supplier updated" : "Supplier added");
        setEditing(null);
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Truck}
                title="Suppliers"
                description="Keep supplier details and payment terms, with a full goods-received history."
                actions={
                    <CreateButton
                        onClick={() => {
                            setEditing(null);
                            setCreateOpen(true);
                        }}
                        label="Add supplier"
                    />
                }
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="suppliers" className="rounded-lg text-sm font-bold">
                        <Truck className="mr-2 h-4 w-4" /> Suppliers
                    </TabsTrigger>
                    <TabsTrigger value="receipts" className="rounded-lg text-sm font-bold">
                        <PackageCheck className="mr-2 h-4 w-4" /> Goods received
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="suppliers" className="mt-4 space-y-4">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Search suppliers…"
                    />

                    {!suppliers ? (
                        <LoadingState />
                    ) : suppliers.length === 0 ? (
                        <EmptyState
                            title="No suppliers yet"
                            hint="Add the companies you buy from so purchase orders and goods receipts can be tracked against them."
                        />
                    ) : (
                        <RecordList
                            records={suppliers}
                            renderItem={(s: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <p className="font-black">{s.name}</p>
                                        <p className="mt-0.5 text-xs text-muted-foreground">
                                            {s.contact ? `${s.contact} · ` : ""}
                                            {s.phone ?? ""}
                                            {s.email ? ` · ${s.email}` : ""}
                                        </p>
                                        {s.address && (
                                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                {s.address}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2">
                                        {s.paymentTerms && (
                                            <span className="rounded-md bg-muted px-2 py-1 text-[10px] font-bold">
                                                {s.paymentTerms}
                                            </span>
                                        )}
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => {
                                                setEditing(s);
                                                setCreateOpen(true);
                                            }}
                                        >
                                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                                            Edit
                                        </Button>
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>

                <TabsContent value="receipts" className="mt-4">
                    {!receipts ? (
                        <LoadingState />
                    ) : receipts.length === 0 ? (
                        <EmptyState
                            title="No goods received yet"
                            hint="Receive goods against a purchase order to create a GRN and increase your stock."
                        />
                    ) : (
                        <RecordList
                            records={receipts}
                            renderItem={(r: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold">{r.receiptNumber}</p>
                                            <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                                RECEIVED
                                            </span>
                                        </div>
                                        <p className="mt-1 font-black">{r.supplierName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {r.items.length} line(s) · {shortDate(r.date)}
                                        </p>
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums">
                                        {ugx(r.total)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={createOpen}
                onOpenChange={(v) => {
                    setCreateOpen(v);
                    if (!v) setEditing(null);
                }}
                title={editing ? "Edit supplier" : "Add supplier"}
                submitLabel={editing ? "Save changes" : "Add supplier"}
                fields={[
                    { name: "name", label: "Supplier name", required: true, full: true },
                    { name: "contact", label: "Contact person" },
                    { name: "phone", label: "Phone", type: "tel", placeholder: "0772 123 456" },
                    { name: "email", label: "Email", type: "email" },
                    {
                        name: "paymentTerms",
                        label: "Payment terms",
                        placeholder: "e.g. Net 30",
                    },
                    { name: "address", label: "Address", full: true },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleSave}
            />
        </div>
    );
}
