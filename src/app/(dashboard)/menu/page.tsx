"use client";

/**
 * SMART_BUZ — Menu Management (Restaurant / Café / Food Service)
 *
 * A full menu editor: dishes and drinks grouped by section, per-item pricing,
 * prep times, dietary tags and a one-tap "sold out" switch. Prices are shown
 * VAT-inclusive, matching how Ugandan restaurants actually quote a menu.
 *
 * Every item can be added, amended, inspected and removed from here.
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
    EditFormDialog,
    ConfirmDeleteDialog,
    RecordDetail,
    RecordActions,
    CreateButton,
    ugx,
    toFormValues,
    type FormField,
} from "@/components/vertical/ui-kit";
import { useActiveCategory } from "@/hooks/use-active-category";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { reportError } from "@/components/error-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { UtensilsCrossed, BookOpen, ChefHat } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export default function MenuPage() {
    
    const t = useT();const { currency } = useCurrency();
    const { user } = useAuth();
    const { profile } = useActiveCategory();
    const [search, setSearch] = useState("");
    const [createOpen, setCreateOpen] = useState(false);
    const [detailRow, setDetailRow] = useState<any>(null);
    const [editRow, setEditRow] = useState<any>(null);
    const [deleteRow, setDeleteRow] = useState<any>(null);

    const menu = useQuery(api.verticals.scheduling.listMenu, {});
    const upsertMenu = useMutation(api.verticals.scheduling.upsertMenuItem);
    const toggleAvailability = useMutation(api.verticals.scheduling.toggleMenuAvailability);
    const deleteMenuItem = useMutation(api.verticals.scheduling.deleteMenuItem);

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

    const stats = useMemo(() => {
        const rows = (menu ?? []) as any[];
        const available = rows.filter((m) => m.available !== false).length;
        const categories = new Set(rows.map((m) => m.category || "General")).size;
        const avg = rows.length
            ? rows.reduce((s, m) => s + (m.price ?? 0), 0) / rows.length
            : 0;
        return { total: rows.length, available, categories, avg };
    }, [menu]);

    const createFields: FormField[] = [
        { name: "name", label: "Item name", required: true },
        {
            name: "category",
            label: "Section",
            placeholder: "e.g. Main, Drinks",
            defaultValue: "General",
        },
        {
            name: "price",
            label: `Price (${currency})`,
            type: "number",
            required: true,
            min: 0,
        },
        {
            name: "prepMinutes",
            label: "Prep minutes",
            type: "number",
            min: 0,
        },
        {
            name: "dietary",
            label: "Dietary tags",
            placeholder: "e.g. Vegetarian, Gluten-free",
            full: true,
            hint: "Separate multiple tags with a comma.",
        },
        {
            name: "description",
            label: "Description",
            type: "textarea",
            full: true,
        },
    ];

    const editFields: FormField[] = [
        { name: "name", label: "Item name", required: true },
        { name: "category", label: "Section" },
        {
            name: "price",
            label: `Price (${currency})`,
            type: "number",
            required: true,
            min: 0,
        },
        {
            name: "preparationMinutes",
            label: "Prep minutes",
            type: "number",
            min: 0,
        },
        {
            name: "dietary",
            label: "Dietary tags",
            full: true,
            hint: "Separate multiple tags with a comma.",
        },
        {
            name: "description",
            label: "Description",
            type: "textarea",
            full: true,
        },
    ];

    const parseDietary = (value?: string) =>
        value
            ? value
                  .split(",")
                  .map((d) => d.trim())
                  .filter(Boolean)
            : undefined;

    const handleCreate = async (values: Record<string, string>) => {
        if (!user) return;
        const price = Number(values.price);
        if (Number.isNaN(price) || price < 0) {
            throw new Error("Enter a valid price in shillings.");
        }
        await upsertMenu({
            name: values.name.trim(),
            category: (values.category || "General").trim(),
            price: Math.round(price),
            description: values.description || undefined,
            available: true,
            preparationMinutes: values.prepMinutes ? Number(values.prepMinutes) : undefined,
            dietary: parseDietary(values.dietary),
            userId: user._id,
        });
        toast.success("Menu item added");
    };

    const handleEdit = async (values: Record<string, string>) => {
        if (!user || !editRow) return;
        const price = Number(values.price);
        if (Number.isNaN(price) || price < 0) {
            throw new Error("Enter a valid price in shillings.");
        }
        try {
            await upsertMenu({
                id: editRow._id,
                stockId: editRow.stockId,
                name: values.name.trim(),
                category: (values.category || "General").trim(),
                price: Math.round(price),
                description: values.description || undefined,
                available: editRow.available !== false,
                preparationMinutes: values.preparationMinutes
                    ? Number(values.preparationMinutes)
                    : undefined,
                dietary: parseDietary(values.dietary),
                userId: user._id,
            });
            toast.success("Menu item updated");
        } catch (err) {
            reportError(err, "Could not update the menu item.");
            throw err;
        }
    };

    const handleDelete = async () => {
        if (!user || !deleteRow) return;
        try {
            await deleteMenuItem({ id: deleteRow._id, userId: user._id });
            toast.success("Menu item deleted");
        } catch (err) {
            reportError(err, "Could not delete the menu item.");
            throw err;
        }
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

    const columns: DataTableColumn<any>[] = [
        {
            id: "name",
            header: "Item",
            accessor: (m: any) => m.name ?? "",
            cell: (m: any) => (
                <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">{m.name}</p>
                    {m.description ? (
                        <p className="line-clamp-1 text-xs text-muted-foreground">
                            {t(m.description)}
                        </p>
                    ) : null}
                </div>
            ),
        },
        {
            id: "category",
            header: "Section",
            accessor: (m: any) => m.category ?? "",
            cell: (m: any) => (
                <Badge variant="outline">{m.category || "General"}</Badge>
            ),
        },
        {
            id: "price",
            header: "Price",
            accessor: (m: any) => m.price ?? 0,
            align: "right",
            cell: (m: any) => <span className="tabular-nums">{ugx(m.price)}</span>,
        },
        {
            id: "prep",
            header: "Prep",
            accessor: (m: any) => m.preparationMinutes ?? 0,
            align: "right",
            hideBelow: "sm",
            cell: (m: any) =>
                m.preparationMinutes ? (
                    <span className="tabular-nums text-muted-foreground">
                        {m.preparationMinutes} min
                    </span>
                ) : (
                    <span className="text-muted-foreground">—</span>
                ),
        },
        {
            id: "dietary",
            header: "Dietary",
            accessor: (m: any) => (m.dietary ?? []).join(", "),
            hideBelow: "lg",
            cell: (m: any) => (
                <div className="flex flex-wrap gap-1">
                    {(m.dietary ?? []).map((d: string) => (
                        <Badge key={d} variant="secondary">
                            {d}
                        </Badge>
                    ))}
                </div>
            ),
        },
        {
            id: "available",
            header: "Available",
            accessor: (m: any) => (m.available === false ? "sold out" : "available"),
            cell: (m: any) => (
                <div className="flex items-center gap-2">
                    <Switch
                        checked={m.available !== false}
                        onCheckedChange={() => toggle(m)}
                        aria-label={t("Toggle availability for {0}", {
            0: m.name,
        })}
                    />
                    {m.available === false ? (
                        <StatusBadge status="sold_out" />
                    ) : null}
                </div>
            ),
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "8rem",
            cell: (m: any) => (
                <div className="flex items-center justify-end">
                    <RecordActions
                        onView={() => setDetailRow(m)}
                        onEdit={() => setEditRow(m)}
                        onDelete={() => setDeleteRow(m)}
                        label={t("Actions for {0}", {
            0: m.name,
        })}
                    />
                </div>
            ),
        },
    ];

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={BookOpen}
                title={t("Menu")}
                description={t("Manage your dishes and drinks, prices and what is available today.")}
                actions={
                    <>
                        <CreateButton onClick={() => setCreateOpen(true)} label={t("Add menu item")} />
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
                    placeholder={t("Search dishes, drinks or sections...")}
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
                    title={t("Your menu is empty")}
                    hint={t("Add your first dish or drink so it can be ordered straight from the table.")}
                    action={
                        <Button className="mt-2" onClick={() => setCreateOpen(true)}>
                            <ChefHat className="mr-2 h-4 w-4" />
                            {t("Add menu item")}
                        </Button>
                    }
                />
            ) : items.length === 0 ? (
                <EmptyState
                    title={t("No matches")}
                    hint={t("Nothing on the menu matches \"{0}\". Try another word.", {
            0: search,
        })}
                />
            ) : (
                <DataTable
                    data={items}
                    columns={columns}
                    getRowId={(row: any) => row._id}
                    searchTerm={search}
                    defaultSort={{ id: "name", direction: "asc" }}
                    emptyTitle={t("No matches")}
                    emptyHint={t("Nothing on the menu matches \"{0}\". Try another word.", {
            0: search,
        })}
                    ariaLabel="Menu items"
                    caption={t("{0} item(s) on the menu.", {
            0: items.length,
        })}
                />
            )}

            <FormDialog
                open={createOpen}
                onOpenChange={setCreateOpen}
                title={t("Add menu item")}
                description={t("Add a dish or drink to your menu.")}
                submitLabel="Add item"
                fields={createFields}
                onSubmit={handleCreate}
            />

            <EditFormDialog
                key={editRow?._id ?? "none"}
                open={Boolean(editRow)}
                onOpenChange={(v) => !v && setEditRow(null)}
                title={t("Edit menu item")}
                description={t("Update the price, section or details of this item.")}
                fields={editFields}
                record={toFormValues(editRow, editFields)}
                onSubmit={handleEdit}
            />

            <RecordDetail
                open={Boolean(detailRow)}
                onOpenChange={(v) => !v && setDetailRow(null)}
                title={detailRow?.name ?? "Menu item"}
                description={detailRow?.category}
                status={detailRow?.available === false ? "sold_out" : "available"}
                rows={[
                    { label: "Item", value: detailRow?.name ?? "—" },
                    { label: "Section", value: detailRow?.category ?? "—" },
                    { label: "Price", value: ugx(detailRow?.price ?? 0) },
                    {
                        label: "Prep minutes",
                        value: detailRow?.preparationMinutes ?? "—",
                    },
                    {
                        label: "Dietary",
                        value: (detailRow?.dietary ?? []).join(", ") || "—",
                    },
                    {
                        label: "Availability",
                        value: detailRow?.available === false ? "Sold out" : "Available",
                    },
                    { label: "Description", value: detailRow?.description ?? "—" },
                ]}
            />

            <ConfirmDeleteDialog
                open={Boolean(deleteRow)}
                onOpenChange={(v) => !v && setDeleteRow(null)}
                entityName="menu item"
                description={
                    deleteRow
                        ? `This removes ${deleteRow.name} from your menu permanently.`
                        : undefined
                }
                onConfirm={handleDelete}
            />

            <div className="flex items-center gap-2 rounded-xl border border-dashed p-4 text-xs text-muted-foreground">
                <UtensilsCrossed className="h-4 w-4 shrink-0" />
                <span>
                    {t("Selling a table? Open")} <strong>{t("Tables &amp; Orders")}</strong> {t("to open a tab and add these items in one tap.")}
                </span>
            </div>
        </div>
    );
}
