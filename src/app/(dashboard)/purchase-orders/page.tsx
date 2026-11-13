"use client";

/**
 * SMART_BUZ — Purchase Orders
 *
 * Order stock from a supplier, track it, and receive it. Receiving goods
 * increases stock and writes the goods receipt note, so the purchase trail
 * stays intact from order to shelf.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    ClipboardList,
    Plus,
    Loader2,
    PackageCheck,
    Trash2,
    Truck,
    CalendarIcon,
    ShoppingCart,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";

type PoStatus = "draft" | "ordered" | "received" | "cancelled";

type LineDraft = {
    name: string;
    quantity: string;
    unitCost: string;
};

const emptyLine: LineDraft = { name: "", quantity: "1", unitCost: "" };

const STATUS_STYLES: Record<string, string> = {
    draft: "bg-amber-100 text-amber-800 border-amber-200",
    ordered: "bg-sky-100 text-sky-800 border-sky-200",
    received: "bg-emerald-100 text-emerald-800 border-emerald-200",
    cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

function statusLabel(status: string) {
    switch (status) {
        case "ordered":
            return "Ordered";
        case "received":
            return "Received";
        case "cancelled":
            return "Cancelled";
        default:
            return "Draft";
    }
}

export default function PurchaseOrdersPage() {
    const { user } = useAuth();
    const [statusFilter, setStatusFilter] = useState<string>("all");

    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [supplierId, setSupplierId] = useState<string>("");
    const [expectedDate, setExpectedDate] = useState("");
    const [notes, setNotes] = useState("");
    const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
    const [saving, setSaving] = useState(false);

    const [receiving, setReceiving] = useState<Doc<"purchaseOrders"> | null>(null);
    const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
    const [receivingBusy, setReceivingBusy] = useState(false);

    const purchaseOrders = useQuery(api.verticals.operations.listPurchaseOrders, {
        status: statusFilter === "all" ? undefined : statusFilter,
    });
    const suppliers = useQuery(api.verticals.operations.listSuppliers, {});
    const goodsReceipts = useQuery(api.verticals.operations.listGoodsReceipts, { limit: 50 });

    const createPurchaseOrder = useMutation(api.verticals.operations.createPurchaseOrder);
    const updateStatus = useMutation(api.verticals.operations.updatePurchaseOrderStatus);
    const receiveGoods = useMutation(api.verticals.operations.receiveGoods);

    const orders = useMemo(
        () => purchaseOrders ?? [],
        [purchaseOrders]
    );

    const stats = useMemo(() => {
        const draft = orders.filter((o) => o.status === "draft").length;
        const outstanding = orders
            .filter((o) => o.status === "draft" || o.status === "ordered")
            .reduce((sum, o) => sum + (o.total ?? 0), 0);
        return { total: orders.length, draft, outstanding };
    }, [orders]);

    const lineTotal = useMemo(
        () =>
            lines.reduce(
                (sum, l) => sum + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitCost) || 0),
                0
            ),
        [lines]
    );

    const resetForm = () => {
        setSupplierId("");
        setExpectedDate("");
        setNotes("");
        setLines([{ ...emptyLine }]);
    };

    const submitOrder = async () => {
        if (!user) return;

        const supplier = suppliers?.find((s) => s._id === supplierId);
        if (!supplier) {
            toast.error("Choose the supplier you are ordering from");
            return;
        }

        const items = lines
            .map((l) => ({
                name: l.name.trim(),
                quantity: parseFloat(l.quantity) || 0,
                unitCost: parseFloat(l.unitCost) || 0,
            }))
            .filter((i) => i.name && i.quantity > 0 && i.unitCost >= 0);

        if (items.length === 0) {
            toast.error("Add at least one line with a name, quantity and cost");
            return;
        }

        setSaving(true);
        try {
            const result = await createPurchaseOrder({
                supplierId: supplier._id,
                supplierName: supplier.name,
                expectedDate: expectedDate || undefined,
                notes: notes.trim() || undefined,
                items,
                userId: user._id,
            });
            toast.success("Purchase order created", { description: result.poNumber });
            setIsCreateOpen(false);
            resetForm();
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setSaving(false);
        }
    };

    const changeStatus = async (order: Doc<"purchaseOrders">, status: PoStatus) => {
        try {
            await updateStatus({ id: order._id, status });
            toast.success(`${order.poNumber} marked ${statusLabel(status).toLowerCase()}`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const openReceive = (order: Doc<"purchaseOrders">) => {
        const draft: Record<string, string> = {};
        order.items.forEach((item, index) => {
            const outstanding = item.quantity - (item.receivedQty ?? 0);
            draft[String(index)] = String(Math.max(0, outstanding));
        });
        setReceiveQtys(draft);
        setReceiving(order);
    };

    const submitReceive = async () => {
        if (!receiving || !user) return;
        const items = receiving.items
            .map((item, index) => ({
                stockId: item.stockId,
                name: item.name,
                quantity: parseFloat(receiveQtys[String(index)] ?? "0") || 0,
                unitCost: item.unitCost,
            }))
            .filter((i) => i.quantity > 0);

        if (items.length === 0) {
            toast.error("Enter the quantity you are receiving");
            return;
        }

        setReceivingBusy(true);
        try {
            await receiveGoods({ poId: receiving._id, items, userId: user._id });
            toast.success("Goods received", {
                description: `Stock updated for ${receiving.poNumber}`,
            });
            setReceiving(null);
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setReceivingBusy(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <h1 className="text-3xl font-black tracking-tight text-foreground">
                        Purchase Orders
                    </h1>
                    <p className="text-muted-foreground">
                        Order from suppliers, track what is on the way and receive it into stock.
                    </p>
                </div>
                <Button
                    onClick={() => {
                        resetForm();
                        setIsCreateOpen(true);
                    }}
                    className="transition-transform active:scale-[0.98]"
                >
                    <Plus className="mr-2 h-4 w-4" />
                    New purchase order
                </Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
                <StatCard
                    icon={<ClipboardList className="h-4 w-4" />}
                    label="Purchase orders"
                    value={String(stats.total)}
                />
                <StatCard
                    icon={<ShoppingCart className="h-4 w-4" />}
                    label="Still open"
                    value={String(stats.draft)}
                />
                <StatCard
                    icon={<Truck className="h-4 w-4" />}
                    label="Value outstanding"
                    value={`UGX ${stats.outstanding.toLocaleString()}`}
                />
            </div>

            <Card className="shadow-sm">
                <CardContent className="p-0">
                    <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                        <Select
                            value={statusFilter}
                            onValueChange={setStatusFilter}
                        >
                            <SelectTrigger className="w-full sm:w-56" aria-label="Filter by status">
                                <SelectValue placeholder="All statuses" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All statuses</SelectItem>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="ordered">Ordered</SelectItem>
                                <SelectItem value="received">Received</SelectItem>
                                <SelectItem value="cancelled">Cancelled</SelectItem>
                            </SelectContent>
                        </Select>
                        <p className="text-sm text-muted-foreground tabular-nums">
                            {orders.length} order{orders.length === 1 ? "" : "s"}
                        </p>
                    </div>

                    {purchaseOrders === undefined ? (
                        <div className="space-y-2 p-4">
                            {Array.from({ length: 5 }).map((_, i) => (
                                <div key={i} className="flex items-center gap-4 px-2 py-3">
                                    <Skeleton className="h-4 w-24 rounded" />
                                    <Skeleton className="h-4 flex-1 rounded" />
                                    <Skeleton className="h-4 w-20 rounded" />
                                    <Skeleton className="h-6 w-24 rounded-full" />
                                    <Skeleton className="h-4 w-28 rounded" />
                                </div>
                            ))}
                        </div>
                    ) : orders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
                            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
                                <ClipboardList className="h-7 w-7 text-muted-foreground/60" />
                            </div>
                            <div>
                                <p className="font-medium">
                                    {statusFilter === "all"
                                        ? "No purchase orders yet"
                                        : `No ${statusLabel(statusFilter).toLowerCase()} orders`}
                                </p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    {statusFilter === "all"
                                        ? "Create one to order stock from a supplier and track it here."
                                        : "Try a different status filter."}
                                </p>
                            </div>
                            {statusFilter === "all" && (
                                <Button
                                    size="sm"
                                    className="rounded-lg"
                                    onClick={() => {
                                        resetForm();
                                        setIsCreateOpen(true);
                                    }}
                                >
                                    <Plus className="mr-2 h-4 w-4" />
                                    New purchase order
                                </Button>
                            )}
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-background">
                                    <TableRow>
                                        <TableHead>PO number</TableHead>
                                        <TableHead>Supplier</TableHead>
                                        <TableHead>Ordered</TableHead>
                                        <TableHead>Expected</TableHead>
                                        <TableHead className="text-right">Lines</TableHead>
                                        <TableHead className="text-right">Total</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="w-[200px] text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {orders.map((order) => (
                                        <TableRow
                                            key={order._id}
                                            className="animate-in fade-in duration-300 transition-colors"
                                        >
                                            <TableCell className="font-mono text-xs">
                                                {order.poNumber}
                                            </TableCell>
                                            <TableCell className="font-medium">
                                                {order.supplierName}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground tabular-nums">
                                                {new Date(order.date).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell className="text-muted-foreground tabular-nums">
                                                {order.expectedDate
                                                    ? new Date(order.expectedDate).toLocaleDateString()
                                                    : "—"}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {order.items.length}
                                            </TableCell>
                                            <TableCell className="text-right font-medium tabular-nums">
                                                UGX {order.total.toLocaleString()}
                                            </TableCell>
                                            <TableCell>
                                                <Badge
                                                    variant="outline"
                                                    className={STATUS_STYLES[order.status] ?? STATUS_STYLES.draft}
                                                >
                                                    {statusLabel(order.status)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    {order.status === "draft" && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            className="h-8 rounded-lg text-xs active:scale-95 transition-transform"
                                                            onClick={() => changeStatus(order, "ordered")}
                                                        >
                                                            Mark ordered
                                                        </Button>
                                                    )}
                                                    {order.status === "ordered" && (
                                                        <Button
                                                            size="sm"
                                                            className="h-8 rounded-lg text-xs transition-transform active:scale-[0.98]"
                                                            onClick={() => openReceive(order)}
                                                        >
                                                            <PackageCheck className="mr-1.5 h-3.5 w-3.5" />
                                                            Receive
                                                        </Button>
                                                    )}
                                                    {order.status === "received" && (
                                                        <span className="text-xs text-muted-foreground">
                                                            In stock
                                                        </span>
                                                    )}
                                                    {order.status !== "received" &&
                                                        order.status !== "cancelled" && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 rounded-lg text-xs text-destructive hover:bg-destructive/10"
                                                                onClick={() => changeStatus(order, "cancelled")}
                                                            >
                                                                Cancel
                                                            </Button>
                                                        )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>

            {goodsReceipts && goodsReceipts.length > 0 && (
                <Card className="shadow-sm">
                    <CardContent className="p-0">
                        <div className="border-b p-4">
                            <h2 className="font-semibold">Recent goods received</h2>
                            <p className="text-sm text-muted-foreground">
                                Every receipt increases stock and leaves an audit trail.
                            </p>
                        </div>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader className="sticky top-0 z-10 bg-background">
                                    <TableRow>
                                        <TableHead>Receipt</TableHead>
                                        <TableHead>Supplier</TableHead>
                                        <TableHead>Date</TableHead>
                                        <TableHead className="text-right">Lines</TableHead>
                                        <TableHead className="text-right">Value</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {goodsReceipts.slice(0, 8).map((receipt) => (
                                        <TableRow key={receipt._id}>
                                            <TableCell className="font-mono text-xs">
                                                {receipt.receiptNumber}
                                            </TableCell>
                                            <TableCell>{receipt.supplierName}</TableCell>
                                            <TableCell className="text-muted-foreground tabular-nums">
                                                {new Date(receipt.date).toLocaleDateString()}
                                            </TableCell>
                                            <TableCell className="text-right tabular-nums">
                                                {receipt.items.length}
                                            </TableCell>
                                            <TableCell className="text-right font-medium tabular-nums">
                                                UGX {receipt.total.toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* New purchase order */}
            <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
                <DialogContent className="sm:max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <ClipboardList className="h-5 w-5 text-primary" />
                            New purchase order
                        </DialogTitle>
                        <DialogDescription>
                            Pick a supplier and list what you are ordering. Receiving the order later
                            puts the stock straight into inventory.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-1.5">
                                <Label htmlFor="po-supplier">Supplier</Label>
                                <Select value={supplierId} onValueChange={setSupplierId}>
                                    <SelectTrigger id="po-supplier">
                                        <SelectValue placeholder="Choose a supplier" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {(suppliers ?? []).map((s) => (
                                            <SelectItem key={s._id} value={s._id}>
                                                {s.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="po-expected">Expected date</Label>
                                <div className="relative">
                                    <CalendarIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <Input
                                        id="po-expected"
                                        type="date"
                                        value={expectedDate}
                                        onChange={(e) => setExpectedDate(e.target.value)}
                                        className="pl-9"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label>Items</Label>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-8 rounded-lg"
                                    onClick={() => setLines([...lines, { ...emptyLine }])}
                                >
                                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                                    Add line
                                </Button>
                            </div>

                            <div className="space-y-2">
                                {lines.map((line, index) => (
                                    <div
                                        key={index}
                                        className="grid grid-cols-12 items-center gap-2 rounded-xl border bg-muted/30 p-2"
                                    >
                                        <Input
                                            className="col-span-12 sm:col-span-5"
                                            placeholder="Item name"
                                            value={line.name}
                                            aria-label={`Item ${index + 1} name`}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[index] = { ...line, name: e.target.value };
                                                setLines(next);
                                            }}
                                        />
                                        <Input
                                            className="col-span-4 sm:col-span-2"
                                            type="number"
                                            min="0"
                                            placeholder="Qty"
                                            value={line.quantity}
                                            aria-label={`Item ${index + 1} quantity`}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[index] = { ...line, quantity: e.target.value };
                                                setLines(next);
                                            }}
                                        />
                                        <Input
                                            className="col-span-6 sm:col-span-4"
                                            type="number"
                                            min="0"
                                            placeholder="Unit cost (UGX)"
                                            value={line.unitCost}
                                            aria-label={`Item ${index + 1} unit cost`}
                                            onChange={(e) => {
                                                const next = [...lines];
                                                next[index] = { ...line, unitCost: e.target.value };
                                                setLines(next);
                                            }}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="col-span-2 h-8 w-8 rounded-lg text-destructive hover:bg-destructive/10 active:scale-95 transition-transform sm:col-span-1"
                                            aria-label={`Remove line ${index + 1}`}
                                            onClick={() =>
                                                setLines(lines.filter((_, i) => i !== index))
                                            }
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    </div>
                                ))}
                            </div>

                            <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-3 py-2">
                                <span className="text-sm text-muted-foreground">Order total</span>
                                <span className="font-bold tabular-nums">
                                    UGX {lineTotal.toLocaleString()}
                                </span>
                            </div>
                        </div>

                        <div className="space-y-1.5">
                            <Label htmlFor="po-notes">Notes (optional)</Label>
                            <Input
                                id="po-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Delivery instructions, invoice reference..."
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={submitOrder}
                            disabled={saving}
                            className="transition-transform active:scale-[0.98]"
                        >
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                            Create order
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Receive goods */}
            <Dialog open={!!receiving} onOpenChange={(open) => !open && setReceiving(null)}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <PackageCheck className="h-5 w-5 text-primary" />
                            Receive goods
                        </DialogTitle>
                        <DialogDescription>
                            {receiving
                                ? `${receiving.poNumber} from ${receiving.supplierName}. Enter what actually arrived — stock is increased immediately.`
                                : ""}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-3">
                        {receiving?.items.map((item, index) => {
                            const outstanding = item.quantity - (item.receivedQty ?? 0);
                            return (
                                <div
                                    key={index}
                                    className="flex items-center justify-between gap-3 rounded-xl border bg-muted/30 p-3"
                                >
                                    <div className="min-w-0">
                                        <p className="truncate font-medium">{item.name}</p>
                                        <p className="text-xs text-muted-foreground tabular-nums">
                                            Ordered {item.quantity} · Received {item.receivedQty ?? 0} ·
                                            Outstanding {outstanding}
                                        </p>
                                    </div>
                                    <Input
                                        type="number"
                                        min="0"
                                        max={outstanding}
                                        className="w-24"
                                        value={receiveQtys[String(index)] ?? ""}
                                        aria-label={`Quantity received for ${item.name}`}
                                        onChange={(e) =>
                                            setReceiveQtys({ ...receiveQtys, [String(index)]: e.target.value })
                                        }
                                    />
                                </div>
                            );
                        })}
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReceiving(null)}>
                            Cancel
                        </Button>
                        <Button
                            onClick={submitReceive}
                            disabled={receivingBusy}
                            className="transition-transform active:scale-[0.98]"
                        >
                            {receivingBusy ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : null}
                            Receive into stock
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StatCard({
    icon,
    label,
    value,
}: {
    icon: React.ReactNode;
    label: string;
    value: string;
}) {
    return (
        <Card className="shadow-sm">
            <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    {icon}
                </div>
                <div className="min-w-0">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <p className="truncate text-xl font-bold tabular-nums">{value}</p>
                </div>
            </CardContent>
        </Card>
    );
}
