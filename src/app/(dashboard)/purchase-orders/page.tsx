"use client";

/**
 * SMART_BUZ — Purchase Orders
 *
 * Order from suppliers, then receive the goods. Receiving a PO increases
 * stock, writes to the stock ledger and produces a goods-received note —
 * the audit trail the ledger was missing before.
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
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ClipboardList, Plus, Trash2, PackageCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

interface PoLine {
    name: string;
    quantity: string;
    unitCost: string;
}

const PO_STATUSES = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "ordered", label: "Ordered" },
    { value: "received", label: "Received" },
    { value: "cancelled", label: "Cancelled" },
];

export default function PurchaseOrdersPage() {
    const { user } = useAuth();
    const [status, setStatus] = useState("all");
    const [createOpen, setCreateOpen] = useState(false);
    const [receiveFor, setReceiveFor] = useState<any>(null);
    const [lines, setLines] = useState<PoLine[]>([{ name: "", quantity: "1", unitCost: "0" }]);
    const [supplierName, setSupplierName] = useState("");
    const [expectedDate, setExpectedDate] = useState("");
    const [notes, setNotes] = useState("");
    const [submitting, setSubmitting] = useState(false);

    const pos = useQuery(api.verticals.operations.listPurchaseOrders, {
        status: status === "all" ? undefined : status,
    });
    const suppliers = useQuery(api.verticals.operations.listSuppliers, {});

    const createPo = useMutation(api.verticals.operations.createPurchaseOrder);
    const updateStatus = useMutation(api.verticals.operations.updatePurchaseOrderStatus);
    const receiveGoods = useMutation(api.verticals.operations.receiveGoods);

    const poTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);

    const resetForm = () => {
        setLines([{ name: "", quantity: "1", unitCost: "0" }]);
        setSupplierName("");
        setExpectedDate("");
        setNotes("");
    };

    const handleCreate = async () => {
        if (!user) return;
        if (!supplierName.trim()) {
            toast.error("Select or type a supplier first.");
            return;
        }
        const valid = lines.filter((l) => l.name.trim() && Number(l.quantity) > 0);
        if (valid.length === 0) {
            toast.error("Add at least one line item with a name and quantity.");
            return;
        }

        setSubmitting(true);
        try {
            const supplier = (suppliers ?? []).find(
                (s: any) => s.name.toLowerCase() === supplierName.trim().toLowerCase()
            );
            await createPo({
                supplierId: supplier?._id,
                supplierName: supplierName.trim(),
                expectedDate: expectedDate || undefined,
                notes: notes || undefined,
                items: valid.map((l) => ({
                    name: l.name.trim(),
                    quantity: Number(l.quantity),
                    unitCost: Number(l.unitCost) || 0,
                })),
                userId: user._id,
            });
            toast.success("Purchase order created");
            setCreateOpen(false);
            resetForm();
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const handleReceive = async () => {
        if (!user || !receiveFor) return;
        setSubmitting(true);
        try {
            const res: any = await receiveGoods({
                poId: receiveFor._id,
                items: receiveFor.items.map((i: any) => ({
                    stockId: i.stockId,
                    name: i.name,
                    quantity: i.receivedQty ?? i.quantity,
                    unitCost: i.unitCost,
                })),
                userId: user._id,
            });
            toast.success(`Goods received — ${res.receiptNumber}. Stock updated.`);
            setReceiveFor(null);
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const markOrdered = async (id: string) => {
        if (!user) return;
        try {
            await updateStatus({ id: id as any, status: "ordered" });
            toast.success("Marked as ordered");
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={ClipboardList}
                title="Purchase Orders"
                description="Order from suppliers and receive stock with a proper audit trail."
                actions={
                    <CreateButton
                        onClick={() => {
                            resetForm();
                            setCreateOpen(true);
                        }}
                        label="New purchase order"
                    />
                }
            />

            <Tabs value={status} onValueChange={setStatus}>
                <TabsList className="flex h-11 w-full flex-wrap gap-1 rounded-xl border bg-muted/50 p-1.5">
                    {PO_STATUSES.map((s) => (
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
                    {!pos ? (
                        <LoadingState />
                    ) : pos.length === 0 ? (
                        <EmptyState
                            title="No purchase orders"
                            hint="Create a purchase order to plan your buying. When the goods arrive, receive them to increase stock automatically."
                        />
                    ) : (
                        <RecordList
                            records={pos}
                            renderItem={(po: any) => (
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold text-muted-foreground">
                                                {po.poNumber}
                                            </p>
                                            <StatusBadge status={po.status} />
                                        </div>
                                        <p className="mt-1 font-black">{po.supplierName}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {po.items.length} line(s) · {shortDate(po.date)}
                                            {po.expectedDate
                                                ? ` · expected ${shortDate(po.expectedDate)}`
                                                : ""}
                                        </p>
                                        <ul className="mt-1.5 space-y-0.5">
                                            {po.items.slice(0, 3).map((i: any, idx: number) => (
                                                <li
                                                    key={idx}
                                                    className="text-[11px] text-muted-foreground"
                                                >
                                                    {i.quantity} × {i.name} @ {ugx(i.unitCost)}
                                                </li>
                                            ))}
                                            {po.items.length > 3 && (
                                                <li className="text-[11px] italic text-muted-foreground">
                                                    +{po.items.length - 3} more…
                                                </li>
                                            )}
                                        </ul>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-2">
                                        <p className="text-lg font-black tabular-nums">
                                            {ugx(po.total)}
                                        </p>
                                        {po.status === "draft" && (
                                            <Button size="sm" onClick={() => markOrdered(po._id)}>
                                                Mark ordered
                                            </Button>
                                        )}
                                        {po.status === "ordered" && (
                                            <Button
                                                size="sm"
                                                onClick={() => setReceiveFor(po)}
                                            >
                                                <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                                                Receive goods
                                            </Button>
                                        )}
                                        {po.status === "received" && (
                                            <Badge variant="outline" className="text-[10px] text-emerald-600">
                                                Received {shortDate(po.receivedDate)}
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            {/* Create PO */}
            {createOpen && (
                <Card className="border-primary/30">
                    <CardContent className="space-y-4 p-5">
                        <h3 className="text-base font-black">New purchase order</h3>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="po-supplier">Supplier</Label>
                                <Input
                                    id="po-supplier"
                                    list="supplier-options"
                                    value={supplierName}
                                    onChange={(e) => setSupplierName(e.target.value)}
                                    placeholder="Type or pick a supplier"
                                />
                                <datalist id="supplier-options">
                                    {(suppliers ?? []).map((s: any) => (
                                        <option key={s._id} value={s.name} />
                                    ))}
                                </datalist>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="po-expected">Expected date</Label>
                                <Input
                                    id="po-expected"
                                    type="date"
                                    value={expectedDate}
                                    onChange={(e) => setExpectedDate(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Line items</Label>
                            <div className="space-y-2">
                                {lines.map((l, i) => (
                                    <div key={i} className="flex gap-2">
                                        <Input
                                            value={l.name}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[i] = { ...l, name: e.target.value };
                                                setLines(next);
                                            }}
                                            placeholder="Item name"
                                            className="flex-1"
                                        />
                                        <Input
                                            type="number"
                                            min="1"
                                            value={l.quantity}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[i] = { ...l, quantity: e.target.value };
                                                setLines(next);
                                            }}
                                            className="w-24"
                                            placeholder="Qty"
                                        />
                                        <Input
                                            type="number"
                                            min="0"
                                            value={l.unitCost}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[i] = { ...l, unitCost: e.target.value };
                                                setLines(next);
                                            }}
                                            className="w-32"
                                            placeholder="Unit cost"
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            disabled={lines.length === 1}
                                            onClick={() => setLines(lines.filter((_, x) => x !== i))}
                                        >
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    </div>
                                ))}
                            </div>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                    setLines([...lines, { name: "", quantity: "1", unitCost: "0" }])
                                }
                            >
                                <Plus className="mr-1.5 h-3.5 w-3.5" /> Add line
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="po-notes">Notes</Label>
                            <Input
                                id="po-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Optional notes for this order"
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-xl bg-primary/10 p-3">
                            <span className="text-sm font-black uppercase">Order total</span>
                            <span className="text-xl font-black tabular-nums">{ugx(poTotal)}</span>
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>
                                Cancel
                            </Button>
                            <Button onClick={handleCreate} disabled={submitting}>
                                {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                Create purchase order
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Receive goods confirm */}
            {receiveFor && (
                <Card className="border-emerald-500/40 bg-emerald-500/5">
                    <CardContent className="space-y-4 p-5">
                        <div>
                            <h3 className="text-base font-black">Receive goods — {receiveFor.poNumber}</h3>
                            <p className="text-xs text-muted-foreground">
                                This adds {receiveFor.items.length} line(s) to stock, writes to the
                                stock ledger and creates a goods-received note.
                            </p>
                        </div>
                        <ul className="space-y-1">
                            {receiveFor.items.map((i: any, idx: number) => (
                                <li
                                    key={idx}
                                    className="flex justify-between rounded-lg bg-muted/40 px-3 py-1.5 text-xs"
                                >
                                    <span className="font-semibold">
                                        {i.quantity} × {i.name}
                                    </span>
                                    <span className="tabular-nums">{ugx(i.unitCost)} each</span>
                                </li>
                            ))}
                        </ul>
                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setReceiveFor(null)}>
                                Cancel
                            </Button>
                            <Button onClick={handleReceive} disabled={submitting}>
                                {submitting ? (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                    <PackageCheck className="mr-2 h-4 w-4" />
                                )}
                                Confirm receipt
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
