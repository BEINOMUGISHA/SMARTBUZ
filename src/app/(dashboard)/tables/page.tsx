"use client";

/**
 * SMART_BUZ — Tables & Orders (Restaurant / Café)
 *
 * A live floor view: click a table, add menu items, watch the running total,
 * then close the tab when the guest pays.
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
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    UtensilsCrossed,
    Plus,
    X,
    CheckCircle2,
    BookOpen,
    Loader2,
    Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";

export default function TablesPage() {
    const { currency } = useCurrency();
    const { user } = useAuth();
    const [tab, setTab] = useState("floor");
    const [tableOpen, setTableOpen] = useState(false);
    const [orderFor, setOrderFor] = useState<any>(null);
    const [menuOpen, setMenuOpen] = useState(false);
    const [itemName, setItemName] = useState("");
    const [itemPrice, setItemPrice] = useState("");
    const [itemQty, setItemQty] = useState("1");

    const outlets = useQuery(api.verticals.scheduling.listOutlets, { businessType: "table" });
    const orders = useQuery(api.verticals.scheduling.listTableOrders, { status: "open" });
    const menu = useQuery(api.verticals.scheduling.listMenu, {});

    const createOutlet = useMutation(api.verticals.scheduling.createOutlet);
    const updateOutlet = useMutation(api.verticals.scheduling.updateOutletStatus);
    const openOrder = useMutation(api.verticals.scheduling.openTableOrder);
    const addItems = useMutation(api.verticals.scheduling.addTableOrderItems);
    const closeOrder = useMutation(api.verticals.scheduling.closeTableOrder);
    const upsertMenu = useMutation(api.verticals.scheduling.upsertMenuItem);

    const activeOrder = orders?.find((o: any) => o.outletId === orderFor?._id) ?? null;

    const handleCreateTable = async (values: Record<string, string>) => {
        if (!user) return;
        await createOutlet({
            businessType: "table",
            name: values.name,
            capacity: values.capacity ? Number(values.capacity) : undefined,
            rate: values.rate ? Number(values.rate) : undefined,
            notes: values.notes || undefined,
            userId: user._id,
        });
        toast.success("Table added");
    };

    const handleOpenOrder = async () => {
        if (!user || !orderFor) return;
        try {
            await openOrder({
                outletId: orderFor._id,
                userId: user._id,
            });
            toast.success(`${orderFor.name} opened`);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const handleAddMenuItem = async (values: Record<string, string>) => {
        if (!user) return;
        await upsertMenu({
            name: values.name,
            category: values.category || "General",
            price: Number(values.price),
            description: values.description || undefined,
            preparationMinutes: values.prepMinutes ? Number(values.prepMinutes) : undefined,
            userId: user._id,
        });
        toast.success("Menu item added");
    };

    const addMenuItemToOrder = async (item: any) => {
        if (!user || !activeOrder) return;
        try {
            await addItems({
                tableOrderId: activeOrder._id,
                items: [
                    {
                        stockId: item.stockId,
                        name: item.name,
                        price: item.price,
                        quantity: 1,
                    },
                ],
                userId: user._id,
            });
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const closeCurrentOrder = async () => {
        if (!user || !activeOrder) return;
        try {
            await closeOrder({ tableOrderId: activeOrder._id, userId: user._id });
            toast.success("Table closed");
            setOrderFor(null);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const TILE_TONES: Record<string, string> = {
        available: "border-emerald-500/40 bg-emerald-500/5 hover:border-emerald-500",
        occupied: "border-amber-500/40 bg-amber-500/5 hover:border-amber-500",
        reserved: "border-blue-500/40 bg-blue-500/5 hover:border-blue-500",
        cleaning: "border-zinc-500/40 bg-zinc-500/5 hover:border-zinc-500",
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={UtensilsCrossed}
                title="Tables & Orders"
                description="Run the floor, open tabs and close orders as guests pay."
                actions={
                    <>
                        <CreateButton
                            onClick={() => setMenuOpen(true)}
                            label="Add menu item"
                        />
                        <CreateButton onClick={() => setTableOpen(true)} label="Add table" />
                    </>
                }
            />

            <Tabs value={tab} onValueChange={setTab}>
                <TabsList className="grid h-11 w-full grid-cols-2 rounded-xl border bg-muted/50 p-1.5">
                    <TabsTrigger value="floor" className="rounded-lg text-sm font-bold">
                        <UtensilsCrossed className="mr-2 h-4 w-4" /> Floor
                    </TabsTrigger>
                    <TabsTrigger value="menu" className="rounded-lg text-sm font-bold">
                        <BookOpen className="mr-2 h-4 w-4" /> Menu
                    </TabsTrigger>
                </TabsList>

                {/* ── Floor ── */}
                <TabsContent value="floor" className="mt-4 space-y-4">
                    {!outlets ? (
                        <LoadingState />
                    ) : outlets.length === 0 ? (
                        <EmptyState
                            title="No tables yet"
                            hint="Add your tables and the floor view will let you open tabs and take orders."
                        />
                    ) : (
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
                            {outlets.map((t: any) => {
                                const order = orders?.find((o: any) => o.outletId === t._id);
                                const isSelected = orderFor?._id === t._id;
                                return (
                                    <button
                                        key={t._id}
                                        type="button"
                                        onClick={() => {
                                            setOrderFor(t);
                                            if (t.status === "occupied" && !order) {
                                                setOrderFor(null);
                                            }
                                        }}
                                        className={cn(
                                            "rounded-2xl border-2 p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md",
                                            TILE_TONES[t.status] ?? TILE_TONES.available,
                                            isSelected && "ring-2 ring-primary ring-offset-2"
                                        )}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <p className="text-lg font-black">{t.name}</p>
                                            <StatusBadge status={t.status} />
                                        </div>
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {t.capacity ? `Seats ${t.capacity}` : ""}
                                            {t.capacity && t.rate ? " · " : ""}
                                            {t.rate ? `${ugx(t.rate)}/session` : ""}
                                        </p>
                                        {order && (
                                            <p className="mt-2 text-sm font-black tabular-nums text-amber-700 dark:text-amber-400">
                                                {ugx(order.total)}
                                            </p>
                                        )}
                                        {order && (
                                            <p className="text-[10px] text-muted-foreground">
                                                {order.items.length} item(s)
                                            </p>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {/* Order panel */}
                    {orderFor && (
                        <Card className="border-primary/30">
                            <CardContent className="space-y-4 p-5">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <h3 className="text-lg font-black">{orderFor.name}</h3>
                                        <p className="text-xs text-muted-foreground">
                                            {activeOrder
                                                ? `${activeOrder.items.length} item(s) on the tab`
                                                : "No open tab — open one to start taking orders"}
                                        </p>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-7 w-7"
                                        onClick={() => setOrderFor(null)}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>

                                {!activeOrder ? (
                                    <Button onClick={handleOpenOrder} className="w-full">
                                        Open table
                                    </Button>
                                ) : (
                                    <>
                                        <Separator />
                                        <div className="max-h-64 space-y-1.5 overflow-y-auto">
                                            {activeOrder.items.length === 0 ? (
                                                <p className="rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground">
                                                    Tap a menu item below to add it.
                                                </p>
                                            ) : (
                                                activeOrder.items.map((i: any, idx: number) => (
                                                    <div
                                                        key={idx}
                                                        className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm"
                                                    >
                                                        <span className="font-semibold">
                                                            {i.quantity} × {i.name}
                                                        </span>
                                                        <span className="font-black tabular-nums">
                                                            {ugx(i.price * i.quantity)}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>

                                        <div className="flex items-center justify-between rounded-xl bg-primary/10 p-3">
                                            <span className="text-sm font-black uppercase">
                                                Tab total
                                            </span>
                                            <span className="text-xl font-black tabular-nums">
                                                {ugx(activeOrder.total)}
                                            </span>
                                        </div>

                                        <Button className="w-full" onClick={closeCurrentOrder}>
                                            <CheckCircle2 className="mr-2 h-4 w-4" />
                                            Close &amp; pay {ugx(activeOrder.total)}
                                        </Button>
                                    </>
                                )}

                                {activeOrder && (
                                    <div>
                                        <p className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">
                                            Quick add from menu
                                        </p>
                                        <div className="flex flex-wrap gap-1.5">
                                            {(menu ?? []).slice(0, 14).map((m: any) => (
                                                <Button
                                                    key={m._id}
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => addMenuItemToOrder(m)}
                                                >
                                                    {m.name} · {ugx(m.price)}
                                                </Button>
                                            ))}
                                            {(menu ?? []).length === 0 && (
                                                <p className="text-xs text-muted-foreground">
                                                    No menu items yet — add some from the Menu tab.
                                                </p>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </TabsContent>

                {/* ── Menu ── */}
                <TabsContent value="menu" className="mt-4 space-y-4">
                    {!menu ? (
                        <LoadingState />
                    ) : menu.length === 0 ? (
                        <EmptyState
                            title="No menu items"
                            hint="Add your dishes and drinks so staff can order them straight from the table."
                        />
                    ) : (
                        <RecordList
                            records={menu}
                            renderItem={(m: any) => (
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <p className="font-black">{m.name}</p>
                                            <Badge variant="outline" className="text-[10px]">
                                                {m.category}
                                            </Badge>
                                            {m.available === false && (
                                                <Badge variant="destructive" className="text-[10px]">
                                                    Unavailable
                                                </Badge>
                                            )}
                                        </div>
                                        {m.description && (
                                            <p className="mt-0.5 text-xs text-muted-foreground">
                                                {m.description}
                                            </p>
                                        )}
                                        {m.preparationMinutes && (
                                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                                                {m.preparationMinutes} min prep
                                            </p>
                                        )}
                                    </div>
                                    <p className="shrink-0 text-sm font-black tabular-nums">
                                        {ugx(m.price)}
                                    </p>
                                </div>
                            )}
                        />
                    )}
                </TabsContent>
            </Tabs>

            <FormDialog
                open={tableOpen}
                onOpenChange={setTableOpen}
                title="Add a table"
                submitLabel="Add table"
                fields={[
                    { name: "name", label: "Table name / number", required: true, full: true },
                    { name: "capacity", label: "Seats", type: "number", min: 1 },
                    { name: "rate", label: `Rate per session (${currency})`, type: "number", min: 0 },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleCreateTable}
            />

            <FormDialog
                open={menuOpen}
                onOpenChange={setMenuOpen}
                title="Add menu item"
                submitLabel="Add item"
                fields={[
                    { name: "name", label: "Item name", required: true },
                    { name: "category", label: "Category", placeholder: "e.g. Main, Drinks" },
                    { name: "price", label: `Price (${currency})`, type: "number", required: true, min: 0 },
                    { name: "prepMinutes", label: "Prep minutes", type: "number", min: 0 },
                    { name: "description", label: "Description", type: "textarea", full: true },
                ]}
                onSubmit={handleAddMenuItem}
            />
        </div>
    );
}
