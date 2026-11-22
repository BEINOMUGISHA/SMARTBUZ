"use client";

/**
 * SMART_BUZ — Menu Management (Restaurant / Café / Food Service)
 *
 * A full menu editor: dishes and drinks grouped by section, per-item pricing,
 * prep times, dietary tags and a one-tap "sold out" switch. Prices are shown
 * VAT-inclusive, matching how Ugandan restaurants actually quote a menu.
 */

import { useMemo, useState } from "react";
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
    ugx,
} from "@/components/vertical/ui-kit";
import { useActiveCategory } from "@/hooks/use-active-category";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { UtensilsCrossed, BookOpen, Pencil, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";

export default function MenuPage() {
    const { currency } = useCurrency();
    const { user } = useAuth();
    const { profile } = useActiveCategory();
    const [search, setSearch] = useState("");
    const [editOpen, setEditOpen] = useState(false);
    const [editing, setEditing] = useState<any>(null);

    const menu = useQuery(api.verticals.scheduling.listMenu, {});
    const upsertMenu = useMutation(api.verticals.scheduling.upsertMenuItem);
    const toggleAvailability = useMutation(api.verticals.scheduling.toggleMenuAvailability);

    const vatRate = profile?.taxRate ?? 18;
    const vatInclusive = profile?.taxInclusive ?? true;

    const items = useMemo(() => {
        const rows = menu ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return rows;
        return rows.filter(
            (m: any) =>
                m.name?.toLowerCase().includes(q) ||
                m.category?.toLowerCase().includes(q) ||
                m.description?.toLowerCase().includes(q)
        );
    }, [menu, search]);

    const grouped = useMemo(() => {
        const map = new Map<string, any[]>();
        for (const m of items as any[]) {
            const key = m.category || "General";
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(m);
        }
        return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [items]);

    const stats = useMemo(() => {
        const rows = (menu ?? []) as any[];
        const available = rows.filter((m) => m.available !== false).length;
        const categories = new Set(rows.map((m) => m.category || "General")).size;
        const avg = rows.length
            ? rows.reduce((s, m) => s + (m.price ?? 0), 0) / rows.length
            : 0;
        return { total: rows.length, available, categories, avg };
    }, [menu]);

    const openCreate = () => {
        setEditing(null);
        setEditOpen(true);
    };

    const openEdit = (item: any) => {
        setEditing(item);
        setEditOpen(true);
    };

    const handleSave = async (values: Record<string, string>) => {
        if (!user) return;
        const price = Number(values.price);
        if (Number.isNaN(price) || price < 0) {
            throw new Error("Enter a valid price in shillings.");
        }
        await upsertMenu({
            id: editing?._id,
            stockId: editing?.stockId,
            name: values.name.trim(),
            category: (values.category || "General").trim(),
            price: Math.round(price),
            description: values.description || undefined,
            available: editing ? editing.available !== false : true,
            preparationMinutes: values.prepMinutes ? Number(values.prepMinutes) : undefined,
            dietary: values.dietary
                ? values.dietary
                      .split(",")
                      .map((d) => d.trim())
                      .filter(Boolean)
                : undefined,
            userId: user._id,
        });
        toast.success(editing ? "Menu item updated" : "Menu item added");
    };

    const toggle = async (item: any) => {
        try {
            await toggleAvailability({ id: item._id, available: item.available === false });
            toast.success(
                item.available === false ? `${item.name} is back on the menu` : `${item.name} marked sold out`
            );
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={BookOpen}
                title="Menu"
                description="Manage your dishes and drinks, prices and what is available today."
                actions={
                    <>
                        <CreateButton onClick={openCreate} label="Add menu item" />
                    </>
                }
            />

            <StatStrip
                stats={[
                    { label: "Menu items", value: stats.total },
                    { label: "Available", value: stats.available, tone: "good" },
                    { label: "Sections", value: stats.categories },
                    { label: "Average price", value: ugx(stats.avg) },
                ]}
            />

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <SearchBox
                    value={search}
                    onChange={setSearch}
                    placeholder="Search dishes, drinks or sections..."
                    className="sm:max-w-sm"
                />
                <p className="text-xs text-muted-foreground">
                    {vatInclusive
                        ? `Prices are VAT-inclusive at ${vatRate}%`
                        : `Prices are VAT-exclusive at ${vatRate}%`}
                </p>
            </div>

            {!menu ? (
                <LoadingState rows={4} />
            ) : menu.length === 0 ? (
                <EmptyState
                    title="Your menu is empty"
                    hint="Add your first dish or drink so it can be ordered straight from the table."
                    action={
                        <Button className="mt-2" onClick={openCreate}>
                            <ChefHat className="mr-2 h-4 w-4" />
                            Add menu item
                        </Button>
                    }
                />
            ) : items.length === 0 ? (
                <EmptyState
                    title="No matches"
                    hint={`Nothing on the menu matches "${search}". Try another word.`}
                />
            ) : (
                <div className="space-y-6">
                    {grouped.map(([category, rows]) => (
                        <section key={category} className="space-y-2">
                            <div className="flex items-center gap-2">
                                <h2 className="text-sm font-black uppercase tracking-wider text-muted-foreground">
                                    {category}
                                </h2>
                                <Badge variant="outline" className="text-[10px]">
                                    {rows.length}
                                </Badge>
                            </div>

                            <div className="grid gap-2 sm:grid-cols-2">
                                {rows.map((m: any) => (
                                    <div
                                        key={m._id}
                                        className={cn(
                                            "flex items-start justify-between gap-3 rounded-xl border bg-card p-3 shadow-sm",
                                            m.available === false && "opacity-60"
                                        )}
                                    >
                                        <div className="min-w-0 flex-1">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="font-black">{m.name}</p>
                                                {m.available === false && (
                                                    <StatusBadge status="sold_out" />
                                                )}
                                            </div>
                                            {m.description && (
                                                <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
                                                    {m.description}
                                                </p>
                                            )}
                                            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                                {m.preparationMinutes ? (
                                                    <Badge variant="outline" className="text-[10px]">
                                                        {m.preparationMinutes} min
                                                    </Badge>
                                                ) : null}
                                                {(m.dietary ?? []).map((d: string) => (
                                                    <Badge
                                                        key={d}
                                                        variant="secondary"
                                                        className="text-[10px]"
                                                    >
                                                        {d}
                                                    </Badge>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="flex shrink-0 flex-col items-end gap-2">
                                            <p className="text-sm font-black tabular-nums">
                                                {ugx(m.price)}
                                            </p>
                                            <div className="flex items-center gap-1">
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="h-7 w-7"
                                                    onClick={() => openEdit(m)}
                                                    title="Edit item"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Switch
                                                    checked={m.available !== false}
                                                    onCheckedChange={() => toggle(m)}
                                                    aria-label={`Toggle availability for ${m.name}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}

            <FormDialog
                open={editOpen}
                onOpenChange={setEditOpen}
                title={editing ? "Edit menu item" : "Add menu item"}
                description={
                    editing
                        ? "Update the price, section or details of this item."
                        : "Add a dish or drink to your menu."
                }
                submitLabel={editing ? "Save changes" : "Add item"}
                fields={[
                    { name: "name", label: "Item name", required: true },
                    {
                        name: "category",
                        label: "Section",
                        placeholder: "e.g. Main, Drinks",
                        defaultValue: editing?.category ?? "General",
                    },
                    {
                        name: "price",
                        label: `Price (${currency})`,
                        type: "number",
                        required: true,
                        min: 0,
                        defaultValue: editing?.price ?? "",
                    },
                    {
                        name: "prepMinutes",
                        label: "Prep minutes",
                        type: "number",
                        min: 0,
                        defaultValue: editing?.preparationMinutes ?? "",
                    },
                    {
                        name: "dietary",
                        label: "Dietary tags",
                        placeholder: "e.g. Vegetarian, Gluten-free",
                        defaultValue: (editing?.dietary ?? []).join(", "),
                        full: true,
                        hint: "Separate multiple tags with a comma.",
                    },
                    {
                        name: "description",
                        label: "Description",
                        type: "textarea",
                        full: true,
                        defaultValue: editing?.description ?? "",
                    },
                ]}
                onSubmit={handleSave}
            />

            <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                <UtensilsCrossed className="h-4 w-4 shrink-0" />
                <span>
                    Selling a table? Open <strong>Tables &amp; Orders</strong> to open a tab and add these
                    items in one tap.
                </span>
            </div>
        </div>
    );
}
