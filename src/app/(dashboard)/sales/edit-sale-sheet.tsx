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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Loader2, Plus, Trash2, Check, ChevronsUpDown, Save, Pencil } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
    const { user } = useAuth();
    const editSaleMutation = useMutation(api.sales.editSale);
    const customers = useQuery(api.customers.listAll);
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
            toast.error(err?.message || "Failed to update sale");
        } finally {
            setIsSaving(false);
        }
    };

    const selectedCustomer = customers?.find((c) => c._id === customerId);

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="w-full sm:max-w-2xl p-6 overflow-y-auto">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        <Pencil className="h-5 w-5" />
                        Edit Sale {sale?.invoiceNumber ? `- ${sale.invoiceNumber}` : ""}
                    </SheetTitle>
                    <SheetDescription>
                        Modify this sale. Changes will reverse all original effects (stock, loans, payments,
                        promotions) and re-apply the new values across reports and summaries.
                    </SheetDescription>
                </SheetHeader>

                <div className="space-y-6 mt-6">
                    {/* Client + Payment */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                Client Type
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
                                Payment Mode
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
                            Customer
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
                                    <CommandInput placeholder="Search customer..." />
                                    <CommandList>
                                        <CommandEmpty>No customer found.</CommandEmpty>
                                        <CommandGroup>
                                            <CommandItem
                                                onSelect={() => {
                                                    setCustomerId(undefined);
                                                    setCustomerOpen(false);
                                                }}
                                            >
                                                <Check className={cn("mr-2 h-4 w-4", !customerId ? "opacity-100" : "opacity-0")} />
                                                Walk-in (no customer)
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
                                                        <span className="text-[10px] text-muted-foreground">{c.phone}</span>
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
                                Manual Customer Name
                            </Label>
                            <Input
                                value={manualName}
                                onChange={(e) => setManualName(e.target.value)}
                                placeholder="Walk-in customer name (optional)"
                            />
                        </div>
                    )}

                    {/* Customer contact */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                Customer Phone
                            </Label>
                            <Input
                                value={customerPhone}
                                onChange={(e) => setCustomerPhone(e.target.value)}
                                placeholder="Optional"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                Customer Location
                            </Label>
                            <Input
                                value={customerLocation}
                                onChange={(e) => setCustomerLocation(e.target.value)}
                                placeholder="Optional"
                            />
                        </div>
                    </div>

                    {/* Items */}
                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">Items</Label>
                            <Popover open={stockOpen} onOpenChange={setStockOpen}>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" size="sm">
                                        <Plus className="h-4 w-4 mr-1" /> Add Item
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[400px] p-0">
                                    <Command>
                                        <CommandInput placeholder="Search product..." />
                                        <CommandList>
                                            <CommandEmpty>No product found.</CommandEmpty>
                                            <CommandGroup>
                                                {availableStocks.map((stock: any) => (
                                                    <CommandItem
                                                        key={stock._id || stock.stockId}
                                                        value={`${stock.name} ${stock.productCode || ""}`}
                                                        onSelect={() => addStockToCart(stock)}
                                                    >
                                                        <div className="flex flex-col">
                                                            <span className="font-medium">{stock.name}</span>
                                                            <span className="text-[10px] text-muted-foreground">
                                                                {stock.productCode} • UGX {stock.price?.toLocaleString()} • Qty: {stock.qty}
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
                                        <TableHead>Item</TableHead>
                                        <TableHead className="w-[90px]">Qty</TableHead>
                                        <TableHead className="w-[120px]">Price</TableHead>
                                        <TableHead className="text-right">Subtotal</TableHead>
                                        <TableHead className="w-[40px]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {items.length === 0 ? (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4">
                                                No items. Click "Add Item" above.
                                            </TableCell>
                                        </TableRow>
                                    ) : (
                                        items.map((item, idx) => (
                                            <TableRow key={`${item.stockId}-${idx}`}>
                                                <TableCell className="text-xs">
                                                    <div className="font-medium">{item.name}</div>
                                                    <div className="text-[10px] text-muted-foreground">{item.productCode}</div>
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
                                                                "text-[10px] mt-0.5",
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
                            <div className="text-[10px] uppercase text-muted-foreground font-bold">Total</div>
                            <div className="font-mono font-bold text-base">UGX {total.toLocaleString()}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase text-muted-foreground font-bold">PV</div>
                            <div className="font-mono font-bold text-base text-emerald-600">{totalPV.toLocaleString()}</div>
                        </div>
                        <div>
                            <div className="text-[10px] uppercase text-muted-foreground font-bold">BV</div>
                            <div className="font-mono font-bold text-base text-blue-600">{totalBV.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Loan / Delivery / Package */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label className="text-xs font-semibold uppercase text-muted-foreground">
                                Delivery Status
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
                                Package Type
                            </Label>
                            <Select value={packageType || "none"} onValueChange={(v) => setPackageType(v === "none" ? "" : v)}>
                                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">None</SelectItem>
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
                                This Sale is a Loan
                            </Label>
                            <Switch checked={isLoan} onCheckedChange={setIsLoan} />
                        </div>
                        {isLoan && (
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label className="text-xs">Payment Due Date</Label>
                                    <Input
                                        type="date"
                                        value={paymentDueDate}
                                        onChange={(e) => setPaymentDueDate(e.target.value)}
                                    />
                                </div>
                                <div className="space-y-2">
                                    <Label className="text-xs">Initial Deposit (UGX)</Label>
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
                </div>

                <SheetFooter className="mt-6 flex-row gap-2 sm:gap-2">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving} className="flex-1">
                        Cancel
                    </Button>
                    <Button onClick={handleSave} disabled={isSaving} className="flex-1">
                        {isSaving ? (
                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving...</>
                        ) : (
                            <><Save className="h-4 w-4 mr-2" /> Save Changes</>
                        )}
                    </Button>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    );
}
