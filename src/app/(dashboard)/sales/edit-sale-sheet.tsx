"use client";

import { useState, useEffect, useMemo } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { Loader2, Plus, Trash2, Check, ChevronsUpDown, Save, Pencil, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { describeError } from "@/components/error-feedback";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

interface EditItem {
    stockId: Id<"stocks">;
    name: string;
    productCode: string;
    price: number;
    quantity: number;
    pv: number;
    bv: number;
}

interface EditSaleSheetProps {
    sale: any | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSaved?: () => void;
}

const CLIENT_TYPES = ["Member", "Non-Member", "Working Client", "HP Client"];
const PAYMENT_MODES = ["Cash", "Mobile Money", "Bank Transfer", "Bonus Transfer", "Loan", "None"];
const PACKAGE_TYPES = ["Bronze", "Silver", "Gold"];
const DELIVERY_STATUSES = ["Taken", "Pending"];

export function EditSaleSheet({ sale, open, onOpenChange, onSaved }: EditSaleSheetProps) {
    
    const tr = useT();const { currency } = useCurrency();
    const { user, can } = useAuth();
    const editSaleMutation = useMutation(api.sales.editSale);
    const customers = useQuery(api.customers.listAll, {});
    const shopData = useQuery(api.stocks.getShopStock, {
        email: user?.email || undefined,
        limit: 500,
    });

    const availableStocks = shopData?.stocks || [];

    // Map of current stock qty by stockId (raw shop qty before this edit)
    const stockQtyById = useMemo(() => {
        const m = new Map<string, number>();
        for (const s of availableStocks as any[]) {
            m.set(s.stockId || s._id, s.qty ?? 0);
        }
        return m;
    }, [availableStocks]);

    // Original sale's items qty by stockId (since edit reverses them, they become available again)
    const originalQtyById = useMemo(() => {
        const m = new Map<string, number>();
        for (const i of (sale?.items || []) as any[]) {
            m.set(i.stockId, (m.get(i.stockId) || 0) + i.quantity);
        }
        return m;
    }, [sale]);

    // Effective available = current shop qty + qty being returned by reversal
    const effectiveAvailable = (stockId: string) =>
        (stockQtyById.get(stockId) ?? 0) + (originalQtyById.get(stockId) ?? 0);

    // Form state
    const [items, setItems] = useState<EditItem[]>([]);
    const [clientType, setClientType] = useState("Member");
    const [paymentMode, setPaymentMode] = useState("Cash");
    const [customerId, setCustomerId] = useState<Id<"customers"> | undefined>(undefined);
    const [manualName, setManualName] = useState("");
    const [isLoan, setIsLoan] = useState(false);
    const [paymentDueDate, setPaymentDueDate] = useState("");
    const [initialDeposit, setInitialDeposit] = useState("");
    const [packageType, setPackageType] = useState<string>("");
    const [deliveryStatus, setDeliveryStatus] = useState("Taken");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerLocation, setCustomerLocation] = useState("");
    const [isSaving, setIsSaving] = useState(false);
    const [customerOpen, setCustomerOpen] = useState(false);
    const [stockOpen, setStockOpen] = useState(false);
    const [refundOpen, setRefundOpen] = useState(false);

    // Hydrate form when sale opens
    useEffect(() => {
        if (sale && open) {
            setItems(
                (sale.items || []).map((i: any) => ({
                    stockId: i.stockId,
                    name: i.name,
                    productCode: i.productCode || "",
                    price: i.price,
                    quantity: i.quantity,
                    pv: i.pv,
                    bv: i.bv,
                }))
            );
            setClientType(sale.clientType || "Member");
            setPaymentMode(sale.paymentMode || "Cash");
            setCustomerId(sale.customerId);
            setManualName(sale.manualCustomerName || "");
            setIsLoan(!!sale.isLoan);
            setPaymentDueDate(sale.paymentDueDate ? sale.paymentDueDate.split("T")[0] : "");
            setInitialDeposit(sale.initialDeposit ? String(sale.initialDeposit) : "");
            setPackageType(sale.packageType || "");
            setDeliveryStatus(sale.deliveryStatus || "Taken");
            setCustomerPhone(sale.customerPhone || "");
            setCustomerLocation(sale.customerLocation || "");
        }
    }, [sale, open]);

    const total = useMemo(
        () => items.reduce((sum, i) => sum + i.price * i.quantity, 0),
        [items]
    );
    const totalPV = useMemo(
        () => items.reduce((sum, i) => sum + i.pv * i.quantity, 0),
        [items]
    );
    const totalBV = useMemo(
        () => items.reduce((sum, i) => sum + i.bv * i.quantity, 0),
        [items]
    );

    const updateItem = (idx: number, patch: Partial<EditItem>) => {
        setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
    };

    const removeItem = (idx: number) => {
        setItems((prev) => prev.filter((_, i) => i !== idx));
    };

    const addStockToCart = (stock: any) => {
        const stockId = stock._id || stock.stockId;
        const existing = items.find((i) => i.stockId === stockId);
        if (existing) {
            updateItem(items.indexOf(existing), { quantity: existing.quantity + 1 });
        } else {
            setItems((prev) => [
                ...prev,
                {
                    stockId,
                    name: stock.name,
                    productCode: stock.productCode || "",
                    price: stock.price,
                    quantity: 1,
                    pv: stock.pv || 0,
                    bv: stock.bv || 0,
                },
            ]);
        }
        setStockOpen(false);
    };

    const handleSave = async () => {
        if (!sale || !user) return;
        if (items.length === 0) {
            toast.error("A sale must have at least one item.");
            return;
        }
        if (isLoan && !paymentDueDate) {
            toast.error("Payment due date is required for loans.");
            return;
        }

        try {
            setIsSaving(true);
            await editSaleMutation({
                saleId: sale._id,
                userId: user._id,
                customerId,
                manualCustomerName: manualName || undefined,
                total,
                clientType,
                paymentMode,
                items,
                isLoan,
                paymentDueDate: isLoan ? paymentDueDate : undefined,
                initialDeposit: isLoan && initialDeposit ? parseInt(initialDeposit) : undefined,
                packageType: packageType || undefined,
                deliveryStatus,
                customerPhone: customerPhone || undefined,
                customerLocation: customerLocation || undefined,
            });
            toast.success("Sale updated successfully. All related records have been refreshed.");
            onOpenChange(false);
            onSaved?.();
        } catch (err: any) {
            console.error(err);
            // The raw Convex message carries a request id and a stack trace;
            // the operator needs the sentence that says what went wrong.
            toast.error(describeError(err, "The sale could not be updated."));
        } finally {
            setIsSaving(false);
        }
    };

    const selectedCustomer = customers?.find((c) => c._id === customerId);

    // Handing money back is a separate, permissioned action — the people who
    // can ring up a sale are not the people who can undo one.
    const canRefund = can("sales.refund");

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-2xl p-6 overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <Pencil className="h-5 w-5" />
                        {tr("Edit Sale")} {sale?.invoiceNumber ? `- ${sale.invoiceNumber}` : ""}
                    </SheetTitle>
                    <SheetDescription>
                        {tr("Modify this sale. Changes will reverse all original effects (stock, loans, payments, promotions) and re-apply the new values across reports and summaries.")}
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6 mt-6">
                    {/* Client + Payment */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Client Type")}
                            </Label>
                            <Select value={clientType} onValueChange={setClientType}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CLIENT_TYPES.map((t) => (
                                        <SelectItem key={t} value={t}>{t}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Payment Mode")}
                            </Label>
                            <Select value={paymentMode} onValueChange={setPaymentMode}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {PAYMENT_MODES.map((p) => (
                                        <SelectItem key={p} value={p}>{p}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Customer */}
                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            {tr("Customer")}
                        </Label>
                        <Popover open={customerOpen} onOpenChange={setCustomerOpen}>
                            <PopoverTrigger asChild>
                                <Button variant="outline" role="combobox" className="w-full justify-between font-normal">
                                    {selectedCustomer ? selectedCustomer.name : "Walk-in / Not selected"}
                                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-[400px] p-0">
                                <Command>
                                    <CommandInput placeholder={tr("Search customer...")} />
                                    <CommandList>
                                        <CommandEmpty>{tr("No customer found.")}</CommandEmpty>
                                        <CommandGroup>
                                            <CommandItem
                                                onSelect={() => {
                                                    setCustomerId(undefined);
                                                    setCustomerOpen(false);
                                                }}
                                            >
                                                <Check className={cn("mr-2 h-4 w-4", !customerId ? "opacity-100" : "opacity-0")} />
                                                {tr("Walk-in (no customer)")}
                                            </CommandItem>
                                            {customers?.map((c) => (
                                                <CommandItem
                                                    key={c._id}
                                                    value={`${c.name} ${c.phone || ""}`}
                                                    onSelect={() => {
                                                        setCustomerId(c._id);
                                                        setCustomerOpen(false);
                                                    }}
                                                >
                                                    <Check className={cn("mr-2 h-4 w-4", customerId === c._id ? "opacity-100" : "opacity-0")} />
                                                    <div className="flex flex-col">
                                                        <span>{c.name}</span>
                                                        <span className="text-xs text-muted-foreground">{c.phone}</span>
                                                    </div>
                                                </CommandItem>
                                            ))}
                                        </CommandGroup>
                                    </CommandList>
                                </Command>
                            </PopoverContent>
                        </Popover>
                    </div>

                    {/* Manual customer name (for walk-ins / loans) */}
                    {!customerId && (
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Manual Customer Name")}
                            </Label>
                            <Input
                                value={manualName}
                                onChange={(e) => setManualName(e.target.value)}
                                placeholder={tr("Walk-in customer name (optional)")}
                            />
                        </div>
                    )}

                    {/* Customer contact */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Customer Phone")}
                            </Label>
                            <Input
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder={tr("Optional")}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Customer Location")}
                            </Label>
                            <Input
                                value={customerLocation}
                                onChange={(e) => setCustomerLocation(e.target.value)}
                                placeholder={tr("Optional")}
                            />
                        </div>
                    </div>

                    {/* Items */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">{tr("Items")}</Label>
                            <Popover open={stockOpen} onOpenChange={setStockOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Plus className="h-4 w-4 mr-1" /> {tr("Add Item")}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[400px] p-0">
                                    <Command>
                                        <CommandInput placeholder={tr("Search product...")} />
                                        <CommandList>
                                            <CommandEmpty>{tr("No product found.")}</CommandEmpty>
                                            <CommandGroup>
                                                {availableStocks.map((stock: any) => (
                                                    <CommandItem
                                                        key={stock._id || stock.stockId}
                                                        value={`${stock.name} ${stock.productCode || ""}`}
                                                        onSelect={() => addStockToCart(stock)}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{stock.name}</span>
                                                            <span className="text-xs text-muted-foreground">
                                                                {stock.productCode} • {currency} {stock.price?.toLocaleString()} {tr("• Qty:")} {stock.qty}
                                                            </span>
                                                        </div>
                                                    </CommandItem>
                                                ))}
                                            </CommandGroup>
                                        </CommandList>
                                    </Command>
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="border rounded-md overflow-hidden">
                            <Table>
                                <TableHeader className="bg-muted/40">
                                    <TableRow>
                                        <TableHead>{tr("Item")}</TableHead>
                                        <TableHead className="w-[90px]">{tr("Qty")}</TableHead>
                                        <TableHead className="w-[120px]">{tr("Price")}</TableHead>
                                        <TableHead className="text-right">{tr("Subtotal")}</TableHead>
                                        <TableHead className="w-[40px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                                                {tr("No items. Click \"Add Item\" above.")}
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        items.map((item, idx) => (
                                            <TableRow key={`${item.stockId}-${idx}`}>
                                                <TableCell className="text-xs">
                                                    <div className="font-medium">{item.name}</div>
                                                    <div className="text-xs text-muted-foreground">{item.productCode}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min={1}
                                                        value={item.quantity}
                                                        onChange={(e) =>
                                                            updateItem(idx, { quantity: Math.max(1, parseInt(e.target.value) || 1) })
                                                        }
                                                        className="h-8 text-xs"
                                                    />
                                                    {(() => {
                                                        const avail = effectiveAvailable(item.stockId);
                                                        const willGoNegative = item.quantity > avail;
                                                        return (
                                                            <div className={cn(
                                                                "text-xs mt-0.5",
                                                                willGoNegative ? "text-orange-600 font-semibold" : "text-muted-foreground"
                                                            )}>
                                                                {willGoNegative
                                                                    ? `Will go negative (${avail - item.quantity})`
                                                                    : `Available: ${avail}`}
                                                            </div>
                                                        );
                                                    })()}
                                                </TableCell>
                                                <TableCell>
                                                    <Input
                                                        type="number"
                                                        min={0}
                                                        value={item.price}
                                                        onChange={(e) =>
                                                            updateItem(idx, { price: Math.max(0, parseInt(e.target.value) || 0) })
                                                        }
                                                        className="h-8 text-xs"
                                                    />
                                                </TableCell>
                                                <TableCell className="text-right text-xs font-mono">
                                                    {(item.price * item.quantity).toLocaleString()}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        className="h-7 w-7 text-destructive hover:text-destructive"
                                                        onClick={() => removeItem(idx)}
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))
                                    )}
                                </TableBody>
                            </Table>
                        </div>
                    </div>

                    {/* Totals */}
                    <div className="grid grid-cols-3 gap-2 p-3 rounded-md bg-muted/40 text-xs">
                        <div>
                            <div className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">{tr("Total")}</div>
                            <div className="font-mono font-bold text-base">{currency} {total.toLocaleString()}</div>
                        </div>
                        <div>
                            <div className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">{tr("PV")}</div>
                            <div className="font-mono font-bold text-base text-emerald-600">{totalPV.toLocaleString()}</div>
                        </div>
                        <div>
                            <div className="text-muted-foreground text-eyebrow uppercase tracking-eyebrow">{tr("BV")}</div>
                            <div className="font-mono font-bold text-base text-blue-600">{totalBV.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Loan / Delivery / Package */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Delivery Status")}
                            </Label>
                            <Select value={deliveryStatus} onValueChange={setDeliveryStatus}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {DELIVERY_STATUSES.map((s) => (
                                        <SelectItem key={s} value={s}>{s}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("Package Type")}
                            </Label>
                            <Select value={packageType || "none"} onValueChange={(v) => setPackageType(v === "none" ? "" : v)}>
                                <SelectTrigger><SelectValue placeholder={tr("None")} /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">{tr("None")}</SelectItem>
                                    {PACKAGE_TYPES.map((p) => (
                                        <SelectItem key={p} value={p}>{p}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Loan toggle */}
                    <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                {tr("This Sale is a Loan")}
                            </Label>
                            <Switch checked={isLoan} onCheckedChange={setIsLoan} />
                        </div>
                        {isLoan && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">{tr("Payment Due Date")}</Label>
                                    <Input
                                        type="date"
                                        value={paymentDueDate}
                                        onChange={(e) => setPaymentDueDate(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">{tr("Initial Deposit (")}{currency})</Label>
                                    <Input
                                        type="number"
                                        min={0}
                                        value={initialDeposit}
                                        onChange={(e) => setInitialDeposit(e.target.value)}
                                        placeholder="0"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                    {/* Money back */}
                    <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="text-sm font-semibold text-foreground">
                                    {tr("Money back")}
                                </p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {isSaleFullyRefunded(sale)
                                        ? `This sale has been refunded in full — ${currency} ${(sale?.refundAmount ?? 0).toLocaleString()}.`
                                        : (sale?.refundAmount ?? 0) > 0
                                          ? `${currency} ${(sale?.refundAmount ?? 0).toLocaleString()} of ${currency} ${(sale?.total ?? 0).toLocaleString()} has already been handed back.`
                                          : "A refund puts the goods back on the shelf, takes the money off the drawer and the ledger, and is written against this sale."}
                                </p>
                            </div>
                            {canRefund ? (
                                isSaleFullyRefunded(sale) ? (
                                    <Badge variant="info">{tr("Refunded")}</Badge>
                                ) : (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setRefundOpen(true)}
                                        disabled={isSaving}
                                    >
                                        <Undo2 className="mr-2 h-4 w-4" /> {tr("Refund")}
                                    </Button>
                                )
                            ) : null}
                        </div>
                    </div>
                </div>

                <SheetFooter className="mt-6 flex-row gap-2 sm:gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="flex-1">
                        {tr("Cancel")}
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                        {isSaving ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {tr("Saving...")}</>
                        ) : (
                            <><Save className="h-4 w-4 mr-2" /> {tr("Save Changes")}</>
                        )}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>

        <RefundSaleDialog
            sale={sale}
            open={refundOpen}
            onOpenChange={setRefundOpen}
            onRefunded={() => {
                onOpenChange(false);
                onSaved?.();
            }}
        />
        </>
    );
}

/* ───────────────────────────── the refund ───────────────────────────── */

/**
 * How much of a sold line is still refundable.
 *
 * A line can be refunded in parts, and a second refund of the same line
 * continues where the first one stopped, so what is left is what was sold
 * less what has already been handed back.
 */
function refundableLines(sale: any) {
    const soldLines = (sale?.items ?? []) as any[];
    const refunded = (sale?.refundedItems ?? []) as any[];

    const lines: {
        stockId: string;
        name: string;
        productCode?: string;
        sold: number;
        already: number;
        remaining: number;
    }[] = [];

    const seen = new Set<string>();
    for (const item of soldLines) {
        const key = String(item.stockId);
        // The server reads a line by its first match, so the form does too.
        if (seen.has(key)) continue;
        seen.add(key);
        const already = refunded
            .filter((r) => String(r.stockId) === key)
            .reduce((sum, r) => sum + (r.quantity ?? 0), 0);
        lines.push({
            stockId: key,
            name: item.name,
            productCode: item.productCode,
            sold: item.quantity ?? 0,
            already,
            remaining: Math.max(0, (item.quantity ?? 0) - already),
        });
    }

    return lines;
}

/** Whether the whole sale has already been handed back. */
export function isSaleFullyRefunded(sale: any): boolean {
    if (!sale) return false;
    const refunded = sale.refundAmount ?? 0;
    if (refunded <= 0) return false;
    return refunded >= (sale.total ?? 0) || sale.deliveryStatus === "Refunded";
}

/**
 * Hand money back for a sale.
 *
 * The amount is never typed in and never sent from the browser: the server
 * prices the refund from the prices the sale was rung up at, and the figure
 * it returns is the figure the operator is shown — before the refund, in
 * the confirmation, and in the message that says the money is back.
 */
export function RefundSaleDialog({
    sale,
    open,
    onOpenChange,
    onRefunded,
}: {
    sale: any | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onRefunded?: () => void;
}) {
    
    const t = useT();const { currency } = useCurrency();
    const refundSale = useMutation(api.sales.refundSale);

    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const [reason, setReason] = useState("");
    const [step, setStep] = useState<"choose" | "confirm">("choose");
    const [isRefunding, setIsRefunding] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const lines = useMemo(() => refundableLines(sale), [sale]);
    const refundableCount = lines.reduce((sum, l) => sum + l.remaining, 0);

    // A fresh sale, a fresh form.
    useEffect(() => {
        if (!open) return;
        setQuantities({});
        setReason("");
        setStep("choose");
        setError(null);
    }, [open, sale?._id]);

    const requested = useMemo(
        () =>
            Object.entries(quantities)
                .filter(([, quantity]) => quantity > 0)
                .map(([stockId, quantity]) => ({
                    stockId: stockId as Id<"stocks">,
                    quantity,
                })),
        [quantities]
    );

    // The server prices the refund. The browser only asks.
    const quote = useQuery(
        api.sales.quoteRefund,
        open && sale && requested.length > 0
            ? { saleId: sale._id, items: requested }
            : "skip"
    );

    const setQuantity = (stockId: string, quantity: number) => {
        setQuantities((prev) => ({ ...prev, [stockId]: Math.max(0, quantity) }));
    };

    const refundEverything = () => {
        const next: Record<string, number> = {};
        for (const line of lines) {
            next[line.stockId] = line.remaining;
        }
        setQuantities(next);
    };

    const handleRefund = async () => {
        if (!sale || isRefunding || requested.length === 0) return;
        try {
            setIsRefunding(true);
            setError(null);
            const result = await refundSale({
                saleId: sale._id,
                items: requested,
                reason: reason.trim() || undefined,
            });
            toast.success(
                `Refunded ${currency} ${result.refundAmount.toLocaleString()} on sale ${
                    sale.invoiceNumber || sale._id
                }. The stock is back and the money is off the drawer.`
            );
            onOpenChange(false);
            onRefunded?.();
        } catch (err) {
            const message = describeError(
                err,
                "The refund could not be completed. Nothing has been changed."
            );
            setError(message);
            toast.error(message);
        } finally {
            setIsRefunding(false);
        }
    };

    const invoice = sale?.invoiceNumber || "this sale";

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (isRefunding) return;
                onOpenChange(next);
            }}
        >
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle>
                        {step === "choose"
                            ? `Refund sale ${invoice}`
                            : `Confirm ${currency} ${(quote?.refundAmount ?? 0).toLocaleString()} refund`}
                    </DialogTitle>
                    <DialogDescription>
                        {step === "choose"
                            ? "Choose what to hand back. The server prices the refund from the prices this sale was rung up at."
                            : `The money goes back to the drawer and the ledger, and the goods go back on the shelf.`}
                    </DialogDescription>
                </DialogHeader>

                {step === "choose" ? (
                    <div className="space-y-4">
                        {lines.length === 0 ? (
                            <p className="text-sm text-muted-foreground">
                                {t("This sale has no lines left to refund.")}
                            </p>
                        ) : (
                            <>
                                <div className="flex items-center justify-between">
                                    <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                        {t("Items on this sale")}
                                    </p>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={refundEverything}
                                        disabled={refundableCount === 0}
                                    >
                                        {t("Refund everything")}
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    {lines.map((line) => (
                                        <div
                                            key={line.stockId}
                                            className="flex items-center justify-between gap-3 rounded-lg border border-border/70 p-3"
                                        >
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">
                                                    {line.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {line.productCode
                                                        ? `${line.productCode} • `
                                                        : ""}
                                                    sold {line.sold}
                                                    {line.already > 0
                                                        ? ` • ${line.already} already refunded`
                                                        : ""}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Label
                                                    htmlFor={`refund-qty-${line.stockId}`}
                                                    className="text-xs text-muted-foreground"
                                                >
                                                    {t("Qty")}
                                                </Label>
                                                <Input
                                                    id={`refund-qty-${line.stockId}`}
                                                    type="number"
                                                    min={0}
                                                    max={line.remaining}
                                                    value={
                                                        quantities[line.stockId] ?? 0
                                                    }
                                                    onChange={(e) =>
                                                        setQuantity(
                                                            line.stockId,
                                                            Math.min(
                                                                line.remaining,
                                                                Math.max(
                                                                    0,
                                                                    parseInt(
                                                                        e.target
                                                                            .value,
                                                                        10
                                                                    ) || 0
                                                                )
                                                            )
                                                        )
                                                    }
                                                    disabled={
                                                        line.remaining === 0
                                                    }
                                                    className="h-8 w-20 text-sm tabular-nums"
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="space-y-1.5">
                                    <Label htmlFor="refund-reason">
                                        {t("Reason (optional)")}
                                    </Label>
                                    <Textarea
                                        id="refund-reason"
                                        value={reason}
                                        onChange={(e) => setReason(e.target.value)}
                                        placeholder={t("Why is this money being handed back?")}
                                        rows={2}
                                    />
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="space-y-3">
                        <p className="text-sm">
                            {t("Hand back")}{" "}
                            <span className="font-semibold">
                                {currency}{" "}
                                {(quote?.refundAmount ?? 0).toLocaleString()}
                            </span>{" "}
                            on sale{" "}
                            <span className="font-semibold">{invoice}</span>?
                        </p>

                        <ul className="divide-y divide-border/60 rounded-lg border border-border/70">
                            {(quote?.lines ?? []).map((line) => (
                                <li
                                    key={line.stockId}
                                    className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                                >
                                    <span className="truncate">
                                        {line.quantity} × {line.name}
                                    </span>
                                    <span className="tabular-nums text-muted-foreground">
                                        {currency}{" "}
                                        {line.amount.toLocaleString()}
                                    </span>
                                </li>
                            ))}
                        </ul>

                        {quote?.fullyRefunded ? (
                            <p className="text-xs text-muted-foreground">
                                {t("This refund empties the sale: the whole invoice will have been handed back.")}
                            </p>
                        ) : null}
                    </div>
                )}

                {error ? (
                    <p role="alert" className="text-sm text-danger">
                        {error}
                    </p>
                ) : null}

                <DialogFooter>
                    {step === "choose" ? (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => onOpenChange(false)}
                                disabled={isRefunding}
                            >
                                {t("Cancel")}
                            </Button>
                            <Button
                                onClick={() => {
                                    setError(null);
                                    setStep("confirm");
                                }}
                                disabled={requested.length === 0}
                            >
                                {t("Review refund")}
                            </Button>
                        </>
                    ) : (
                        <>
                            <Button
                                variant="outline"
                                onClick={() => setStep("choose")}
                                disabled={isRefunding}
                            >
                                {t("Back")}
                            </Button>
                            <Button
                                variant="destructive"
                                onClick={handleRefund}
                                disabled={isRefunding || requested.length === 0}
                            >
                                {isRefunding ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        {t("Refunding...")}
                                    </>
                                ) : (
                                    <>
                                        <Undo2 className="mr-2 h-4 w-4" />
                                        {t("Refund")}{" "}
                                        {currency}{" "}
                                        {(quote?.refundAmount ?? 0).toLocaleString()}
                                    </>
                                )}
                            </Button>
                        </>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
