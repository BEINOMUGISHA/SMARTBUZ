"use client";

/**
 * SMART_BUZ — Purchase Orders
 *
 * Order from suppliers, receive the goods, and send back what has to go
 * back.
 *
 * Receiving is deliberately **partial-friendly**: goods arrive in parts, so
 * each line carries its own quantity and the order stays open until every
 * line is complete. The order then says `partially received`, which is the
 * truth — pretending a half-delivered order is finished is how a business
 * ends up ordering the same goods twice.
 *
 * Every receipt increases stock, writes to the stock ledger and records what
 * the goods actually cost, so the purchase price of a product is never lost
 * when the price changes. The **cost history** section reads that record
 * back: what each purchase cost, and what the price is today.
 *
 * A **return to supplier** sends goods back out. The browser may only offer
 * what was actually received and not already returned; the server works the
 * credit out from the price this business paid, so a tampered client cannot
 * credit itself a million for a tin of milk.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { useCurrency } from "@/hooks/use-currency";
import { formatMoney } from "@/lib/currency";
import { formatError } from "@/lib/utils";
import {
    PageHeader,
    StatGrid,
    StatCard,
    SectionCard,
    Toolbar,
    ToolbarGroup,
    CountBadge,
    ActionButton,
    Eyebrow,
} from "@/components/app/page-shell";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DataTableExport } from "@/components/app/data-table-export";
import {
    RecordDetail,
    SearchBox,
    StatusBadge,
    shortDate,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
    History,
    PackageCheck,
    Plus,
    Trash2,
    Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { useT } from "@/i18n/provider";

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

type PurchaseOrder = {
    _id: Id<"purchaseOrders">;
    poNumber: string;
    supplierId?: Id<"suppliers">;
    supplierName: string;
    status: string;
    date: string;
    expectedDate?: string;
    total: number;
    receivedDate?: string;
    branchId?: Id<"branches">;
    warehouseId?: Id<"warehouses">;
    notes?: string;
    items: Array<{
        stockId?: Id<"stocks">;
        name: string;
        productCode?: string;
        quantity: number;
        unitCost: number;
        receivedQty?: number;
        returnedQty?: number;
    }>;
};

export default function PurchaseOrdersPage() {
    
    const t = useT();const { can } = useAuth();
    const { currency } = useCurrency();

    const [status, setStatus] = useState("all");
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [receiveFor, setReceiveFor] = useState<PurchaseOrder | null>(null);
    const [returnFor, setReturnFor] = useState<PurchaseOrder | null>(null);
    const [viewing, setViewing] = useState<PurchaseOrder | null>(null);
    const [costStockId, setCostStockId] = useState<string>("");
    const [submitting, setSubmitting] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);

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

    // Return form — one quantity per line, and the reason.
    const [returnQtys, setReturnQtys] = useState<Record<number, string>>({});
    const [returnNotes, setReturnNotes] = useState("");

    const canManage = can("purchasing.manage");
    // The server asks for both of these before it moves a return.
    const canReturn = can("purchasing.return") && can("inventory.adjust");

    const pos = useQuery(api.purchasing.listPurchaseOrders, {
        status: status === "all" ? undefined : status,
        searchTerm: search || undefined,
    });
    const suppliers = useQuery(api.suppliers.listAll, {});
    const stocks = useQuery(api.stocks.listAll, {});
    const branches = useQuery(api.branches.list, {});
    const warehouses = useQuery(api.warehouses.list, {});
    const receipts = useQuery(api.purchasing.listGoodsReceipts, { limit: 50 });
    const returns = useQuery(api.purchasing.listPurchaseReturns, { limit: 50 });
    const costHistory = useQuery(
        api.purchasing.getCostHistory,
        costStockId ? { stockId: costStockId as Id<"stocks"> } : "skip"
    );

    const createPo = useMutation(api.purchasing.createPurchaseOrder);
    const updateStatus = useMutation(api.purchasing.updatePurchaseOrderStatus);
    const receiveGoods = useMutation(api.purchasing.receiveGoods);
    const createReturn = useMutation(api.purchasing.createPurchaseReturn);

    const orders = (pos?.page ?? []) as PurchaseOrder[];

    const branchName = (id?: string): string => {
        const branch = (branches ?? []).find((b: any) => b._id === id);
        return branch?.name ?? "—";
    };
    const warehouseName = (id?: string): string => {
        const warehouse = (warehouses ?? []).find((w: any) => w._id === id);
        return warehouse?.name ?? "—";
    };

    const stats = useMemo(() => {
        const s = pos?.statuses;
        const committed = orders.reduce((sum, po) => sum + (po.total ?? 0), 0);
        const returned = (returns?.page ?? []).reduce(
            (sum: number, r: any) => sum + (r.total ?? 0),
            0
        );
        return {
            draft: s?.draft ?? 0,
            ordered: s?.ordered ?? 0,
            partial: s?.partiallyReceived ?? 0,
            committed,
            returned,
            returns: (returns?.page ?? []).length,
        };
    }, [pos, orders, returns]);

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
        setFormError(null);
    };

    const handleCreate = async () => {
        setFormError(null);
        const supplier = (suppliers ?? []).find((s: any) => s._id === supplierId);
        if (!supplier) {
            setFormError("Pick a supplier for this order.");
            return;
        }

        const valid = lines.filter((l) => l.stockId && Number(l.quantity) > 0);
        if (valid.length === 0) {
            setFormError("Add at least one product with a quantity.");
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
            setFormError(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const openReceive = (po: PurchaseOrder) => {
        setReceiveFor(po);
        setReceiveNotes("");
        setFormError(null);
        // Default to everything still outstanding on each line.
        const defaults: Record<number, string> = {};
        po.items.forEach((item, index) => {
            const outstanding = (item.quantity ?? 0) - (item.receivedQty ?? 0);
            defaults[index] = String(Math.max(0, outstanding));
        });
        setReceiveQtys(defaults);
    };

    const handleReceive = async () => {
        if (!receiveFor) return;
        setFormError(null);

        const items: Array<{
            stockId: Id<"stocks">;
            name: string;
            productCode?: string;
            quantity: number;
            unitCost: number;
            poItemIndex: number;
        }> = [];

        receiveFor.items.forEach((item, index) => {
            if (!item.stockId) return;
            const quantity = Number(receiveQtys[index] ?? 0);
            if (!(quantity > 0)) return;
            items.push({
                stockId: item.stockId,
                name: item.name,
                productCode: item.productCode,
                quantity,
                unitCost: item.unitCost,
                poItemIndex: index,
            });
        });

        if (items.length === 0) {
            setFormError("Enter at least one quantity to receive.");
            return;
        }

        setSubmitting(true);
        try {
            const res: any = await receiveGoods({
                poId: receiveFor._id,
                items,
                branchId: (receiveFor.branchId ??
                    (branchId || undefined)) as Id<"branches"> | undefined,
                warehouseId: (receiveFor.warehouseId ??
                    (warehouseId || undefined)) as Id<"warehouses"> | undefined,
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
            setFormError(formatError(err));
        } finally {
            setSubmitting(false);
        }
    };

    const openReturn = (po: PurchaseOrder) => {
        setReturnFor(po);
        setReturnNotes("");
        setFormError(null);
        const defaults: Record<number, string> = {};
        po.items.forEach((item, index) => {
            const returnable = (item.receivedQty ?? 0) - (item.returnedQty ?? 0);
            defaults[index] = returnable > 0 ? String(returnable) : "";
        });
        setReturnQtys(defaults);
    };

    const handleReturn = async () => {
        if (!returnFor) return;
        setFormError(null);

        const items: Array<{
            stockId: Id<"stocks">;
            name: string;
            productCode?: string;
            quantity: number;
        }> = [];

        returnFor.items.forEach((item, index) => {
            if (!item.stockId) return;
            const returnable = (item.receivedQty ?? 0) - (item.returnedQty ?? 0);
            if (returnable <= 0) return;
            // The browser may not offer more than what was received.
            const quantity = Math.min(Number(returnQtys[index] ?? 0), returnable);
            if (!(quantity > 0)) return;
            items.push({
                stockId: item.stockId,
                name: item.name,
                productCode: item.productCode,
                quantity,
            });
        });

        if (items.length === 0) {
            setFormError("Enter at least one quantity to send back.");
            return;
        }

        setSubmitting(true);
        try {
            // The server prices the credit itself, from the price this
            // business paid — the figure the browser sends is not used.
            const result: any = await createReturn({
                supplierId: returnFor.supplierId as Id<"suppliers">,
                purchaseOrderId: returnFor._id,
                items,
                notes: returnNotes.trim() || undefined,
            });
            toast.success(
                `Returned to ${returnFor.supplierName} — ${result.returnNumber}`,
                {
                    description: `${formatMoney(
                        result.total,
                        currency
                    )} credited to the supplier.`,
                }
            );
            setReturnFor(null);
        } catch (err) {
            setFormError(formatError(err));
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

    const orderColumns: DataTableColumn<PurchaseOrder>[] = [
        {
            id: "poNumber",
            header: "Order",
            accessor: (po) => po.poNumber,
            width: "9rem",
            cell: (po) => (
                <span className="font-mono text-xs">{po.poNumber}</span>
            ),
        },
        {
            id: "supplier",
            header: "Supplier",
            accessor: (po) => po.supplierName,
            cell: (po) => (
                <div className="min-w-0">
                    <p className="truncate font-medium">{po.supplierName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                        {po.items.length} {t("line(s) ·")} {shortDate(po.date)}
                        {po.branchId ? ` · ${branchName(po.branchId)}` : ""}
                    </p>
                </div>
            ),
        },
        {
            id: "items",
            header: "Items",
            accessor: (po) =>
                po.items.map((i) => `${i.quantity} × ${i.name}`).join(", "),
            hideBelow: "lg",
            cell: (po) => (
                <span className="text-xs text-muted-foreground">
                    {po.items
                        .slice(0, 2)
                        .map((i) => `${i.quantity} × ${i.name}`)
                        .join(", ")}
                    {po.items.length > 2
                        ? ` +${po.items.length - 2} more`
                        : ""}
                </span>
            ),
        },
        {
            id: "status",
            header: "Status",
            accessor: (po) => po.status,
            width: "11rem",
            cell: (po) => <StatusBadge status={po.status} />,
        },
        {
            id: "total",
            header: "Value",
            accessor: (po) => po.total,
            align: "right",
            cell: (po) => (
                <span className="font-medium tabular-nums">
                    {formatMoney(po.total, currency)}
                </span>
            ),
        },
        {
            id: "actions",
            header: "",
            width: "20rem",
            cell: (po) => (
                <div className="flex flex-wrap justify-end gap-1.5">
                    {canManage && po.status === "draft" ? (
                        <>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => markOrdered(po._id)}
                            >
                                {t("Mark ordered")}
                            </Button>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => cancelOrder(po._id)}
                            >
                                {t("Cancel")}
                            </Button>
                        </>
                    ) : null}
                    {canManage &&
                    (po.status === "ordered" ||
                        po.status === "partially_received") ? (
                        <Button variant="outline" size="sm" onClick={() => openReceive(po)}>
                            <PackageCheck className="mr-1.5 size-3.5" />
                            {t("Receive")}
                        </Button>
                    ) : null}
                    {canReturn &&
                    (po.status === "received" ||
                        po.status === "partially_received") ? (
                        <Button variant="outline" size="sm" onClick={() => openReturn(po)}>
                            <Undo2 className="mr-1.5 size-3.5" />
                            {t("Return to supplier")}
                        </Button>
                    ) : null}
                    <Button variant="ghost" size="sm" onClick={() => setViewing(po)}>
                        {t("View")}
                    </Button>
                </div>
            ),
        },
    ];

    const returnColumns: DataTableColumn<any>[] = [
        {
            id: "date",
            header: "Date",
            accessor: (r: any) => r.date,
            cell: (r: any) => shortDate(r.date),
        },
        {
            id: "number",
            header: "Return",
            accessor: (r: any) => r.returnNumber,
            width: "9rem",
            cell: (r: any) => (
                <span className="font-mono text-xs">{r.returnNumber}</span>
            ),
        },
        {
            id: "supplier",
            header: "Supplier",
            accessor: (r: any) => r.supplierName,
        },
        {
            id: "items",
            header: "Items",
            accessor: (r: any) =>
                (r.items ?? [])
                    .map((i: any) => `${i.quantity} × ${i.name}`)
                    .join(", "),
            cell: (r: any) => (
                <span className="text-xs text-muted-foreground">
                    {(r.items ?? [])
                        .map((i: any) => `${i.quantity} × ${i.name}`)
                        .join(", ")}
                </span>
            ),
        },
        {
            id: "total",
            header: "Value",
            accessor: (r: any) => r.total,
            align: "right",
            cell: (r: any) => (
                <span className="font-medium tabular-nums">
                    {formatMoney(r.total, currency)}
                </span>
            ),
        },
    ];

    const costRows = (costHistory?.page ?? []) as any[];
    const currentCost =
        costStockId && costHistory
            ? (costHistory as any).currentCostByStock?.[costStockId]
            : undefined;

    return (
        <div className="space-y-6">
            <PageHeader
                icon={ClipboardList}
                title={t("Purchase Orders")}
                description={t("Order from suppliers, receive the goods, and send back what has to go back.")}
                actions={
                    canManage ? (
                        <ActionButton
                            onClick={() => {
                                resetForm();
                                setCreateOpen(true);
                            }}
                        >
                            <Plus className="mr-2 size-4" />
                            {t("New purchase order")}
                        </ActionButton>
                    ) : undefined
                }
            />

            <StatGrid columns={4}>
                <StatCard label={t("Draft")} value={stats.draft} />
                <StatCard label={t("Ordered")} value={stats.ordered} />
                <StatCard
                    label={t("Part received")}
                    value={stats.partial}
                    tone={stats.partial ? "warning" : "default"}
                />
                <StatCard
                    label={t("Committed value")}
                    value={formatMoney(stats.committed, currency)}
                    hint={
                        stats.returned
                            ? `${formatMoney(stats.returned, currency)} credited back to suppliers.`
                            : undefined
                    }
                />
            </StatGrid>

            {/* ───────────────────── the orders ───────────────────── */}
            <SectionCard
                title={t("Purchase orders")}
                description={t("Every order this business has raised with a supplier.")}
            >
                <Toolbar>
                    <ToolbarGroup>
                        <SearchBox
                            value={search}
                            onChange={setSearch}
                            placeholder={t("Search by PO number, supplier or note…")}
                        />
                        <CountBadge>{orders.length}</CountBadge>
                    </ToolbarGroup>
                    <ToolbarGroup>
                        {PO_STATUSES.map((s) => (
                            <Button
                                key={s.value}
                                size="sm"
                                variant={status === s.value ? "default" : "outline"}
                                onClick={() => setStatus(s.value)}
                            >
                                {t(s.label)}
                            </Button>
                        ))}
                        <DataTableExport
                            title={t("Purchase orders")}
                            rows={orders}
                            columns={orderColumns}
                        />
                    </ToolbarGroup>
                </Toolbar>

                <div className="mt-4">
                    <DataTable
                        data={orders}
                        columns={orderColumns}
                        getRowId={(row) => row._id}
                        isLoading={pos === undefined}
                        isEmpty={orders.length === 0}
                        emptyTitle={t("No purchase orders")}
                        emptyHint={t("Create a purchase order to plan your buying. When the goods arrive, receive them to increase stock automatically.")}
                    />
                </div>
            </SectionCard>

            {/* ───────────────────── returns ───────────────────── */}
            <SectionCard
                title={t("Returns to suppliers")}
                description={t("Goods sent back, and the credit they gave in return.")}
            >
                <DataTable
                    data={(returns?.page ?? []) as any[]}
                    columns={returnColumns}
                    getRowId={(row: any) => row._id}
                    isLoading={returns === undefined}
                    isEmpty={(returns?.page ?? []).length === 0}
                    emptyTitle={t("Nothing has been returned")}
                    emptyHint={t("When goods have to go back to a supplier, return them from the order and the credit appears here.")}
                />
            </SectionCard>

            {/* ───────────────────── cost history ───────────────────── */}
            <SectionCard
                title={t("Cost history")}
                description={t("What each product has cost, and what it costs today.")}
                icon={History}
            >
                <Toolbar>
                    <ToolbarGroup>
                        <Label htmlFor="cost-stock" className="text-sm">
                            {t("Product")}
                        </Label>
                        <Select value={costStockId} onValueChange={setCostStockId}>
                            <SelectTrigger id="cost-stock" className="w-72">
                                <SelectValue placeholder={t("Choose a product…")} />
                            </SelectTrigger>
                            <SelectContent>
                                {(stocks ?? []).map((s: any) => (
                                    <SelectItem key={s._id} value={s._id}>
                                        {s.name}
                                        {s.productCode ? ` (${s.productCode})` : ""}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </ToolbarGroup>
                </Toolbar>

                {currentCost !== undefined ? (
                    <p className="mt-4 rounded-xl border border-border/70 bg-muted/30 p-3 text-sm">
                        <Eyebrow>{t("The price that applies now")}</Eyebrow>
                        <span className="mt-1 block text-stat tabular-nums">
                            {formatMoney(currentCost, currency)}
                        </span>
                    </p>
                ) : null}

                <div className="mt-4">
                    <DataTable
                        data={costRows}
                        columns={[
                            {
                                id: "date",
                                header: "Bought on",
                                accessor: (r: any) => r.date,
                                cell: (r: any) => shortDate(r.date),
                            },
                            {
                                id: "supplier",
                                header: "Supplier",
                                accessor: (r: any) => r.supplierName ?? "",
                                cell: (r: any) => (
                                    <span className="text-muted-foreground">
                                        {r.supplierName ?? "—"}
                                    </span>
                                ),
                            },
                            {
                                id: "quantity",
                                header: "Quantity",
                                accessor: (r: any) => r.quantity,
                                align: "right",
                                cell: (r: any) => (
                                    <span className="tabular-nums">{r.quantity}</span>
                                ),
                            },
                            {
                                id: "unitCost",
                                header: "Price paid each",
                                accessor: (r: any) => r.unitCost,
                                align: "right",
                                cell: (r: any) => (
                                    <span className="tabular-nums">
                                        {formatMoney(r.unitCost, currency)}
                                    </span>
                                ),
                            },
                            {
                                id: "totalCost",
                                header: "Cost of the purchase",
                                accessor: (r: any) => r.totalCost,
                                align: "right",
                                cell: (r: any) => (
                                    <span className="tabular-nums">
                                        {formatMoney(r.totalCost, currency)}
                                    </span>
                                ),
                            },
                        ]}
                        getRowId={(row: any) => row._id}
                        isLoading={costStockId ? costHistory === undefined : false}
                        isEmpty={costStockId ? costRows.length === 0 : false}
                        emptyTitle={t("No purchases recorded for this product yet")}
                        emptyHint={t("The cost is recorded when goods are received.")}
                    />
                </div>
            </SectionCard>

            {/* ───────────────────── goods received ───────────────────── */}
            {receipts && receipts.page.length > 0 ? (
                <SectionCard
                    title={t("Recent goods received")}
                    description={t("The last receipts, with what they were worth.")}
                >
                    <ul className="space-y-2">
                        {receipts.page.slice(0, 10).map((r: any) => (
                            <li
                                key={r._id}
                                className="flex flex-col gap-1 border-b pb-2 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between"
                            >
                                <div className="min-w-0">
                                    <p className="font-mono text-xs">
                                        {r.receiptNumber}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {r.supplierName} · {r.items.length} {t("line(s) ·")}{" "}
                                        {shortDate(r.date)}
                                    </p>
                                </div>
                                <p className="tabular-nums">
                                    {formatMoney(r.total, currency)}
                                </p>
                            </li>
                        ))}
                    </ul>
                </SectionCard>
            ) : null}

            {/* ───────────────────── create purchase order ───────────────────── */}
            {createOpen ? (
                <Card>
                    <CardContent className="space-y-4 p-5">
                        <h3 className="text-section-title">{t("New purchase order")}</h3>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div className="space-y-2">
                                <Label htmlFor="po-supplier">{t("Supplier")}</Label>
                                <select
                                    id="po-supplier"
                                    value={supplierId}
                                    onChange={(e) => setSupplierId(e.target.value)}
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">{t("Select a supplier…")}</option>
                                    {(suppliers ?? []).map((s: any) => (
                                        <option key={s._id} value={s._id}>
                                            {s.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="po-expected">{t("Expected date")}</Label>
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
                                <Label htmlFor="po-branch">{t("Branch")}</Label>
                                <select
                                    id="po-branch"
                                    value={branchId}
                                    onChange={(e) =>
                                        setBranchId(e.target.value as Id<"branches">)
                                    }
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">{t("All branches")}</option>
                                    {(branches ?? []).map((b: any) => (
                                        <option key={b._id} value={b._id}>
                                            {b.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="po-warehouse">{t("Warehouse")}</Label>
                                <select
                                    id="po-warehouse"
                                    value={warehouseId}
                                    onChange={(e) =>
                                        setWarehouseId(e.target.value as Id<"warehouses">)
                                    }
                                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                >
                                    <option value="">{t("No specific warehouse")}</option>
                                    {(warehouses ?? []).map((w: any) => (
                                        <option key={w._id} value={w._id}>
                                            {w.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <Label>{t("Line items")}</Label>
                            <div className="space-y-2">
                                {lines.map((l, i) => (
                                    <div
                                        key={i}
                                        className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_2.5rem]"
                                    >
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
                                                        l.unitCost === "0" &&
                                                        stock?.purchasePrice
                                                            ? String(stock.purchasePrice)
                                                            : l.unitCost,
                                                };
                                                setLines(next);
                                            }}
                                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                        >
                                            <option value="">{t("Select a product…")}</option>
                                            {(stocks ?? []).map((s: any) => (
                                                <option key={s._id} value={s._id}>
                                                    {s.name}
                                                    {s.productCode
                                                        ? ` (${s.productCode})`
                                                        : ""}
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
                                            placeholder={t("Qty")}
                                            aria-label={t("Quantity")}
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
                                            placeholder={t("Unit cost")}
                                            aria-label={t("Unit cost")}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            disabled={lines.length === 1}
                                            onClick={() =>
                                                setLines(lines.filter((_, x) => x !== i))
                                            }
                                            aria-label={t("Remove line")}
                                        >
                                            <Trash2 className="size-4 text-destructive" />
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
                                        {
                                            stockId: "",
                                            name: "",
                                            quantity: "1",
                                            unitCost: "0",
                                        },
                                    ])
                                }
                            >
                                <Plus className="mr-1.5 size-3.5" /> {t("Add line")}
                            </Button>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="po-notes">{t("Notes")}</Label>
                            <Input
                                id="po-notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder={t("Optional notes for this order")}
                            />
                        </div>

                        <div className="flex items-center justify-between rounded-xl bg-muted/40 p-3">
                            <span className="text-sm font-medium">{t("Order total")}</span>
                            <span className="text-stat tabular-nums">
                                {formatMoney(poTotal, currency)}
                            </span>
                        </div>

                        {formError ? (
                            <p
                                role="alert"
                                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
                            >
                                {formError}
                            </p>
                        ) : null}

                        <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setCreateOpen(false)}>
                                {t("Cancel")}
                            </Button>
                            <Button onClick={handleCreate} disabled={submitting}>
                                {submitting ? "Creating…" : "Create purchase order"}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            ) : null}

            {/* ───────────────────── receive goods ───────────────────── */}
            <Dialog
                open={receiveFor !== null}
                onOpenChange={(open) => {
                    if (!open) setReceiveFor(null);
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {t("Receive goods —")} {receiveFor?.poNumber}
                        </DialogTitle>
                        <DialogDescription>
                            {t("Enter what actually turned up. Anything left keeps the order open.")}
                        </DialogDescription>
                    </DialogHeader>

                    <ul className="space-y-2">
                        {receiveFor?.items.map((item, index) => {
                            const outstanding =
                                (item.quantity ?? 0) - (item.receivedQty ?? 0);
                            return (
                                <li
                                    key={index}
                                    className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium">
                                            {item.quantity} × {item.name}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {item.receivedQty ?? 0} {t("received ·")}{" "}
                                            {outstanding} {t("outstanding ·")}{" "}
                                            {formatMoney(item.unitCost, currency)} each
                                        </p>
                                        {!item.stockId ? (
                                            <p className="text-xs text-destructive">
                                                {t("This line is not linked to a product, so it cannot be received.")}
                                            </p>
                                        ) : null}
                                    </div>
                                    <Input
                                        type="number"
                                        min={0}
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
                                        aria-label={t("Quantity received for {0}", {
            0: item.name,
        })}
                                    />
                                </li>
                            );
                        })}
                    </ul>

                    <div className="space-y-2">
                        <Label htmlFor="grn-notes">{t("Note")}</Label>
                        <Input
                            id="grn-notes"
                            value={receiveNotes}
                            onChange={(e) => setReceiveNotes(e.target.value)}
                            placeholder={t("Optional note on this receipt")}
                        />
                    </div>

                    {formError ? (
                        <p
                            role="alert"
                            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
                        >
                            {formError}
                        </p>
                    ) : null}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReceiveFor(null)}>
                            {t("Cancel")}
                        </Button>
                        <Button onClick={handleReceive} disabled={submitting}>
                            {submitting ? "Recording…" : "Confirm receipt"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ───────────────────── return to supplier ───────────────────── */}
            <Dialog
                open={returnFor !== null}
                onOpenChange={(open) => {
                    if (!open) setReturnFor(null);
                }}
            >
                <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>
                            {t("Return to supplier —")} {returnFor?.supplierName}
                        </DialogTitle>
                        <DialogDescription>
                            {t("Only what was received, and not already returned, can go back. The credit is worked out by the server from the price this business paid.")}
                        </DialogDescription>
                    </DialogHeader>

                    <ul className="space-y-2">
                        {returnFor?.items.map((item, index) => {
                            const received = item.receivedQty ?? 0;
                            const returned = item.returnedQty ?? 0;
                            const returnable = Math.max(0, received - returned);
                            return (
                                <li
                                    key={index}
                                    className="flex flex-col gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                                >
                                    <div className="min-w-0">
                                        <p className="font-medium">{item.name}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {received} {t("received ·")} {returned} {t("already returned ·")} {returnable} can go back
                                        </p>
                                        {!item.stockId ? (
                                            <p className="text-xs text-destructive">
                                                {t("This line is not linked to a product, so it cannot be returned.")}
                                            </p>
                                        ) : null}
                                    </div>
                                    <Input
                                        type="number"
                                        min={0}
                                        max={returnable}
                                        disabled={!item.stockId || returnable <= 0}
                                        value={returnQtys[index] ?? ""}
                                        onChange={(e) =>
                                            setReturnQtys({
                                                ...returnQtys,
                                                [index]: e.target.value,
                                            })
                                        }
                                        className="w-28"
                                        aria-label={t("Quantity to return for {0}", {
            0: item.name,
        })}
                                    />
                                </li>
                            );
                        })}
                    </ul>

                    <div className="space-y-2">
                        <Label htmlFor="return-notes">{t("Reason")}</Label>
                        <Input
                            id="return-notes"
                            value={returnNotes}
                            onChange={(e) => setReturnNotes(e.target.value)}
                            placeholder={t("Why the goods are going back — damaged, wrong item, over-ordered")}
                        />
                    </div>

                    {formError ? (
                        <p
                            role="alert"
                            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
                        >
                            {formError}
                        </p>
                    ) : null}

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setReturnFor(null)}>
                            {t("Cancel")}
                        </Button>
                        <Button onClick={handleReturn} disabled={submitting}>
                            {submitting ? "Recording…" : "Record the return"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ───────────────────── order detail ───────────────────── */}
            <RecordDetail
                open={viewing !== null}
                onOpenChange={(open) => {
                    if (!open) setViewing(null);
                }}
                title={viewing?.poNumber ?? "Purchase order"}
                description={viewing?.supplierName}
                status={viewing?.status}
                rows={
                    viewing
                        ? [
                              {
                                  label: "Raised on",
                                  value: shortDate(viewing.date),
                              },
                              {
                                  label: "Expected",
                                  value: viewing.expectedDate
                                      ? shortDate(viewing.expectedDate)
                                      : "—",
                              },
                              {
                                  label: "Branch",
                                  value: branchName(viewing.branchId),
                              },
                              {
                                  label: "Warehouse",
                                  value: warehouseName(viewing.warehouseId),
                              },
                              {
                                  label: "Value",
                                  value: formatMoney(viewing.total, currency),
                              },
                              ...viewing.items.map((item, index) => ({
                                  label: item.name,
                                  value: (
                                      <span className="tabular-nums">
                                          {item.quantity} ×{" "}
                                          {formatMoney(item.unitCost, currency)}
                                          {" · "}
                                          {item.receivedQty ?? 0} received
                                          {item.returnedQty
                                              ? ` · ${item.returnedQty} returned`
                                              : ""}
                                      </span>
                                  ),
                              })),
                          ]
                        : []
                }
                footer={
                    viewing?.items.some((i) => i.stockId) ? (
                        <Button
                            variant="outline"
                            onClick={() => {
                                const stock = viewing.items.find((i) => i.stockId);
                                if (stock?.stockId) setCostStockId(stock.stockId);
                            }}
                        >
                            <History className="mr-2 size-4" />
                            {t("Cost history")}
                        </Button>
                    ) : undefined
                }
            />
        </div>
    );
}
