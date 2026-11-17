"use client";

/**
 * SMART_BUZ — Purchase Orders
 *
 * Order from suppliers, then receive the goods.
 *
 * Receiving is deliberately **partial-friendly**: goods arrive in parts, so
 * each line carries its own quantity and the order stays open until every
 * line is complete. The order then says `partially received`, which is the
 * truth — pretending a half-delivered order is finished is how a business
 * ends up ordering the same goods twice.
 *
 * Every receipt increases stock, writes to the stock ledger and records what
 * the goods actually cost, so the purchase price of a product is never lost
 * when the price changes.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatusBadge,
    LoadingState,
    EmptyState,
    SearchBox,
    StatStrip,
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
import {
    ClipboardList,
    Plus,
    Trash2,
    PackageCheck,
    Loader2,
    Building2,
    Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

interface PoLine {
    stockId: Id<"stocks"> | "";
    name: string;
    productCode?: string;
    quantity: string;
    unitCost: string;
}

const PO_STATUSES = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "ordered", label: "Ordered" },
    { value: "partially_received", label: "Part received" },
    { value: "received", label: "Received" },
    { value: "cancelled", label: "Cancelled" },
];

export default function PurchaseOrdersPage() {
    const { user, can } = useAuth();
    const [status, setStatus] = useState("all");
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [receiveFor, setReceiveFor] = useState<any>(null);
    const [submitting, setSubmitting] = useState(false);

    // New order form.
    const [lines, setLines] = useState<PoLine[]>([
        { stockId: "", name: "", quantity: "1", unitCost: "0" },
    ]);
    const [supplierId, setSupplierId] = useState("");
    const [branchId, setBranchId] = useState<Id<"branches"> | "">("");
    const [warehouseId, setWarehouseId] = useState<Id<"warehouses"> | "">("");
    const [expectedDate, setExpectedDate] = useState("");
    const [notes, setNotes] = useState("");

    // Receipt form — one quantity per line.
    const [receiveQtys, setReceiveQtys] = useState<Record<number, string>>({});
    const [receiveNotes, setReceiveNotes] = useState("");

    const pos = useQuery(api.purchasing.listPurchaseOrders, {
        status: status === "all" ? undefined : status,
        searchTerm: search || undefined,
    });
    const suppliers = useQuery(api.suppliers.listAll, {});
    const stocks = useQuery(api.stocks.listAll, {});
    const branches = useQuery(api.branches.list, {});
    const warehouses = useQuery(api.warehouses.list, {});
    const receipts = useQuery(api.purchasing.listGoodsReceipts, { limit: 50 });

    const createPo = useMutation(api.purchasing.createPurchaseOrder);
    const updateStatus = useMutation(api.purchasing.updatePurchaseOrderStatus);
    const receiveGoods = useMutation(api.purchasing.receiveGoods);

    const orders = pos?.page ?? [];

    const branchName = (id: string): string => {
        const b = (branches ?? []).find((x: any) => x._id === id);
        return b?.name ?? "Branch";
    };

    const warehouseName = (id: string): string => {
        const w = (warehouses ?? []).find((x: any) => x._id === id);
        return w?.name ?? "Warehouse";
    };

    const stats = useMemo(() => {
        const s = pos?.statuses;
        const committed = (pos?.page ?? []).reduce(
            (sum: number, po: any) => sum + (po.total ?? 0),
            0
        );
        return [
            { label: "Draft", value: String(s?.draft ?? 0) },
            { label: "Ordered", value: String(s?.ordered ?? 0) },
            {
                label: "Part received",
                value: String(s?.partiallyReceived ?? 0),
                tone: "warn" as const,
            },
            { label: "Committed value", value: ugx(committed) },
        ];
    }, [pos]);

    const poTotal = lines.reduce(
        (s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0),
        0
    );

    const resetForm = () => {
        setLines([{ stockId: "", name: "", quantity: "1", unitCost: "0" }]);
        setSupplierId("");
        setBranchId("");
        setWarehouseId("");
        setExpectedDate("");
        setNotes("");
    };

    const handleCreate = async () => {
        if (!user) return;

        const supplier = (suppliers ?? []).find((s: any) => s._id === supplierId);
        if (!supplier) {
            toast.error("Pick a supplier for this order.");
            return;
        }

        const valid = lines.filter(
            (l) => l.stockId && Number(l.quantity) > 0
        );
        if (valid.length === 0) {
            toast.error("Add at least one product with a quantity.");
            return;
        }

        setSubmitting(true);
        try {
            const result = await createPo({
                supplierId: supplier._id,
                supplierName: supplier.name,
                expectedDate: expectedDate || undefined,
                notes: notes || undefined,
                branchId: branchId || undefined,
                warehouseId: warehouseId || undefined,
                items: valid.map((l) => {
                    const stock = (stocks ?? []).find((s: any) => s._id === l.stockId);
                    return {
                        stockId: l.stockId as Id<"stocks">,
                        name: l.name || stock?.name || "Item",
                        productCode: stock?.productCode,
                        quantity: Number(l.quantity),
                        unitCost: Number(l.unitCost) || 0,
                    };
                }),
            });
            toast.success(`Purchase order ${result.poNumber} created`);
            setCreateOpen(false);
            resetForm();
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const openReceive = (po: any) => {
        setReceiveFor(po);
        setReceiveNotes("");
        // Default to everything still outstanding on each line.
        const defaults: Record<number, string> = {};
        po.items.forEach((item: any, index: number) => {
            const outstanding = (item.quantity ?? 0) - (item.receivedQty ?? 0);
            defaults[index] = String(Math.max(0, outstanding));
        });
        setReceiveQtys(defaults);
    };

    const handleReceive = async () => {
        if (!user || !receiveFor) return;

        const items = receiveFor.items
            .map((item: any, index: number) => ({
                stockId: item.stockId,
                name: item.name,
                productCode: item.productCode,
                quantity: Number(receiveQtys[index] ?? 0),
                unitCost: item.unitCost,
                poItemIndex: index,
            }))
            .filter((i: any) => i.quantity > 0);

        if (items.length === 0) {
            toast.error("Enter at least one quantity to receive.");
            return;
        }

        setSubmitting(true);
        try {
            const res: any = await receiveGoods({
                poId: receiveFor._id,
                items,
                // The goods land where the order said they would land.
                branchId: (receiveFor.branchId ?? (branchId || undefined)) as
                    | Id<"branches">
                    | undefined,
                warehouseId: (receiveFor.warehouseId ??
                    (warehouseId || undefined)) as
                    | Id<"warehouses">
                    | undefined,
                notes: receiveNotes || undefined,
            });
            toast.success(
                `Goods received — ${res.receiptNumber}. ${
                    res.fullyReceived
                        ? "Order fully received."
                        : "Order is partly received; the rest is still outstanding."
                }`,
                { description: "Stock updated." }
            );
            setReceiveFor(null);
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const markOrdered = async (id: string) => {
        try {
            await updateStatus({ id: id as any, status: "ordered" });
            toast.success("Marked as ordered");
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const cancelOrder = async (id: string) => {
        try {
            await updateStatus({ id: id as any, status: "cancelled" });
            toast.success("Purchase order cancelled");
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
                    can("purchasing.manage") ? (
                        <CreateButton
                            onClick={() => {
                                resetForm();
                                setCreateOpen(true);
                            }}
                            label="New purchase order"
                        />
                    ) : undefined
                }
            />

            <StatStrip stats={stats} />

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

                <TabsContent value={status} className="mt-4 space-y-4">
                    <SearchBox
                        value={search}
                        onChange={setSearch}
                        placeholder="Search by PO number, supplier or note…"
                    />

                    {!pos ? (
                        <LoadingState />
                    ) : orders.length === 0 ? (
                        <EmptyState
                            title="No purchase orders"
                            hint="Create a purchase order to plan your buying. When the goods arrive, receive them to increase stock automatically."
                        />
                    ) : (
                        <RecordList
                            records={orders}
                            renderItem={(po: any) => (
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-mono text-xs font-bold text-muted-foreground">
                                                {po.poNumber}
                                            </p>
                                            <StatusBadge status={po.status} />
                                            {po.branchId && (
                                                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold">
                                                    {branchName(po.branchId)}
                                                </span>
                                            )}
                                            {po.warehouseId && (
                                                <span className="rounded-md bg-muted px-2 py-0.5 text-[10px] font-bold">
                                                    {warehouseName(po.warehouseId)}
                                                </span>
                                            )}
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
                                                    {i.receivedQty
                                                        ? ` — ${i.receivedQty} received`
                                                        : ""}
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
                                        {can("purchasing.manage") && po.status === "draft" && (
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={() => markOrdered(po._id)}>
                                                    Mark ordered
                                                </Button>
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => cancelOrder(po._id)}
                                                >
                                                    Cancel
                                                </Button>
                                            </div>
                                        )}
                                        {can("purchasing.manage") &&
                                            (po.status === "ordered" ||
                                                po.status === "partially_received") && (
                                                <Button
                                                    size="sm"
                                                    onClick={() => openReceive(po)}
                                                >
                                                    <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                                                    Receive goods
                                                </Button>
                                            )}
                                        {po.status === "received" && (
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] text-emerald-600"
                                            >
                                                Received {shortDate(po.receivedDate)}
                                            </Badge>
                                        )}
                                        {po.status === "partially_received" && (
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] text-amber-600"
                                            >
                                                Part received — {po.items.length} line(s) open
                                            </Badge>
                                        )}
                                    </div>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            {/* ───────────────────── goods received ───────────────────── */}
            {receipts && receipts.page.length > 0 && (
                <div className="space-y-2">
                    <h3 className="text-sm font-black uppercase tracking-wide text-muted-foreground">
                        Recent goods received
                    </h3>
                    <RecordList
                        records={receipts.page.slice(0, 10)}
                        renderItem={(r: any) => (
                            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                                <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <p className="font-mono text-xs font-bold">
                                            {r.receiptNumber}
                                        </p>
                                        <span className="rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-400">
                                            RECEIVED
                                        </span>
                                    </div>
                                    <p className="text-xs text-muted-foreground">
                                        {r.supplierName} · {r.items.length} line(s) ·{" "}
                                        {shortDate(r.date)}
                                    </p>
                                </div>
                                <p className="shrink-0 text-sm font-black tabular-nums">
                                    {ugx(r.total)}
                                </p>
                            </div>
                        )}
                    />
                </div>
            )}

            {/* ───────────────────── create purchase order ───────────────────── */}
            {createOpen && (
                <Card className="border-primary/30">
                    <CardContent className="space-y-4 p-5">
                        <h3 className="text-base font-black">New purchase order</h3>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="po-supplier">Supplier</Label>
                                <select
                                    id="po-supplier"
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">Select a supplier…</option>
                                    {(suppliers ?? []).map((s: any) => (
                                        <option key={s._id} value={s._id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
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

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="po-branch">
                                    <span className="flex items-center gap-1.5">
                                        <Building2 className="h-3.5 w-3.5" /> Branch
                                    </span>
                                </Label>
                                <select
                                    id="po-branch"
                                    value={branchId}
                                    onChange={(e) => setBranchId(e.target.value as Id<"branches">)}
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">All branches</option>
                                    {(branches ?? []).map((b: any) => (
                                        <option key={b._id} value={b._id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="po-warehouse">
                                    <span className="flex items-center gap-1.5">
                                        <Warehouse className="h-3.5 w-3.5" /> Warehouse
                                    </span>
                                </Label>
                                <select
                                    id="po-warehouse"
                                    value={warehouseId}
                                    onChange={(e) => setWarehouseId(e.target.value as Id<"warehouses">)}
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">No specific warehouse</option>
                                    {(warehouses ?? []).map((w: any) => (
                                        <option key={w._id} value={w._id}>
                                            {w.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>Line items</Label>
                            <div className="space-y-2">
                                {lines.map((l, i) => (
                                    <div key={i} className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_2.5rem]">
                                        <select
                                            value={l.stockId}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                const stock = (stocks ?? []).find(
                                                    (s: any) => s._id === e.target.value
                                                );
                                                next[i] = {
                                                    ...l,
                                                    stockId: e.target.value as Id<"stocks">,
                                                    name: stock?.name ?? "",
                                                    productCode: stock?.productCode,
                                                    unitCost:
                                                        l.unitCost === "0" && stock?.purchasePrice
                                                            ? String(stock.purchasePrice)
                                                            : l.unitCost,
                                                };
                                                setLines(next);
                                            }}
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            <option value="">Select a product…</option>
                                            {(stocks ?? []).map((s: any) => (
                                                <option key={s._id} value={s._id}>
                                                    {s.name}
                                                    {s.productCode ? ` (${s.productCode})` : ""}
                                                </option>
                                            ))}
                                        </select>
                                        <Input
                                            type="number"
                                            min="1"
                                            value={l.quantity}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[i] = { ...l, quantity: e.target.value };
                                                setLines(next);
                                            }}
                                            placeholder="Qty"
                                            aria-label="Quantity"
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
                                            placeholder="Unit cost"
                                            aria-label="Unit cost"
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            disabled={lines.length === 1}
                                            onClick={() => setLines(lines.filter((_, x) => x !== i))}
                                            aria-label="Remove line"
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
                                    setLines([
                                        ...lines,
                                        { stockId: "", name: "", quantity: "1", unitCost: "0" },
                                    ])
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
                                {submitting && (
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                Create purchase order
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* ───────────────────── receive goods ───────────────────── */}
            {receiveFor && (
                <Card className="border-emerald-500/40 bg-emerald-500/5">
                    <CardContent className="space-y-4 p-5">
                        <div>
                            <h3 className="text-base font-black">
                                Receive goods — {receiveFor.poNumber}
                            </h3>
                            <p className="text-xs text-muted-foreground">
                                Enter what actually turned up. Anything left keeps the order open.
                            </p>
                        </div>

                        <ul className="space-y-2">
                            {receiveFor.items.map((item: any, index: number) => {
                                const outstanding =
                                    (item.quantity ?? 0) - (item.receivedQty ?? 0);
                                return (
                                    <li
                                        key={index}
                                        className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between"
                                    >
                                        <div className="min-w-0">
                                            <p className="font-semibold">
                                                {item.quantity} × {item.name}
                                            </p>
                                            <p className="text-muted-foreground">
                                                {item.receivedQty ?? 0} received ·{" "}
                                                {outstanding} outstanding ·{" "}
                                                {ugx(item.unitCost)} each
                                            </p>
                                            {!item.stockId && (
                                                <p className="text-destructive">
                                                    This line is not linked to a product, so it
                                                    cannot be received.
                                                </p>
                                            )}
                                        </div>
                                        <Input
                                            type="number"
                                            min="0"
                                            max={outstanding}
                                            disabled={!item.stockId || outstanding <= 0}
                                            value={receiveQtys[index] ?? ""}
                                            onChange={(e) =>
                                                setReceiveQtys({
                                                    ...receiveQtys,
                                                    [index]: e.target.value,
                                                })
                                            }
                                            className="w-28"
                                            aria-label={`Quantity received for ${item.name}`}
                                        />
                                    </li>
                                );
                            })}
                        </ul>

                        <div className="space-y-2">
                            <Label htmlFor="grn-notes">Note</Label>
                            <Input
                                id="grn-notes"
                                value={receiveNotes}
                                onChange={(e) => setReceiveNotes(e.target.value)}
                                placeholder="Optional note on this receipt"
                            />
                        </div>

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
