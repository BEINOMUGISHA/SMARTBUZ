"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Doc, Id } from "../../../../convex/_generated/dataModel";
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
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Plus, Search, Edit, Trash2, MoreHorizontal, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Package, PackagePlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { ConfirmDeleteModal } from "@/components/confirm-delete-modal";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { PageHeader } from "@/components/app/page-shell";
import { useCurrency } from "@/hooks/use-currency";
import { useT } from "@/i18n/provider";

export default function StockPage() {
    
    const t = useT();const [activeTab, setActiveTab] = useState("regular");

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Package}
                title={t("Stock Management")}
                description={t("Manage your inventory, prices, and product categories.")}
            />

            <Tabs defaultValue="regular" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
                    <TabsTrigger value="regular">{t("Regular Stock")}</TabsTrigger>
                    <TabsTrigger value="hp">{t("HP Stock")}</TabsTrigger>
                    <TabsTrigger value="categories">{t("Categories")}</TabsTrigger>
                </TabsList>

                <TabsContent value="regular" className="mt-6">
                    <StockManager halfPrice={false} />
                </TabsContent>
                <TabsContent value="hp" className="mt-6">
                    <StockManager halfPrice={true} />
                </TabsContent>
                <TabsContent value="categories" className="mt-6">
                    <CategoryManager />
                </TabsContent>
            </Tabs>
        </div>
    );
}

function StockManager({ halfPrice }: { halfPrice: boolean }) {
    
    const t = useT();const { currency } = useCurrency();
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingStock, setEditingStock] = useState<Doc<"stocks"> | null>(null);
    const [restockingStock, setRestockingStock] = useState<Doc<"stocks"> | null>(null);
    const [deletingId, setDeletingId] = useState<Id<"stocks"> | null>(null);
    const { user } = useAuth();

    // 1. Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10); // Default items per page

    // Persist rowsPerPage preference
    useEffect(() => {
        const saved = localStorage.getItem("pos_stock_rows_per_page");
        if (saved) {
            setRowsPerPage(Number(saved));
        }
    }, []);

    // 2. Data Fetching [TRUE PAGINATION]
    const paginatedResult = useQuery(api.stocks.getPaginated, {
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
        searchTerm: search || undefined,
        halfPrice
    });

    const categories = useQuery(api.categories.get, {});
    // [OPTIMIZED] O(1) Category Lookup Map
    const categoryMap = new Map(categories?.map(c => [c._id, c.type]) || []);

    const addStock = useMutation(api.stocks.add);
    const updateStock = useMutation(api.stocks.update);
    const restockStock = useMutation(api.stocks.restock);
    const deleteStock = useMutation(api.stocks.remove);

    const totalItems = paginatedResult?.totalCount || 0;
    const currentView = paginatedResult?.page || [];
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            setCurrentPage(p => p + 1);
        }
    };

    const stockColumns: DataTableColumn<any>[] = [
        {
            id: "code",
            header: "Code",
            accessor: (row: any) => row.productCode ?? "",
            cell: (row: any) => (
                <span className="font-mono text-xs">{row.productCode}</span>
            ),
        },
        {
            id: "name",
            header: "Product Name",
            accessor: (row: any) => row.name,
            cell: (row: any) => (
                <span className="font-medium">{row.name}</span>
            ),
        },
        {
            id: "category",
            header: "Category",
            accessor: (row: any) => categoryMap.get(row.categoryId) ?? "",
            cell: (row: any) => (
                <Badge variant="neutral" className="font-normal">
                    {categoryMap.get(row.categoryId) || "Unknown"}
                </Badge>
            ),
            hideBelow: "md",
        },
        {
            id: "price",
            header: "Price",
            accessor: (row: any) => row.price ?? 0,
            align: "right",
            cell: (row: any) => (
                <span className="font-semibold tabular-nums">
                    {row.price.toLocaleString()}
                </span>
            ),
        },
        {
            id: "qty",
            header: "Qty",
            accessor: (row: any) => row.qty ?? 0,
            align: "center",
            cell: (row: any) => (
                <Badge variant={row.qty < 10 ? "danger" : "neutral"}>
                    {row.qty}
                </Badge>
            ),
        },
        {
            id: "pv",
            header: "PV",
            accessor: (row: any) => row.pv ?? 0,
            align: "center",
            hideBelow: "lg",
            cell: (row: any) => (
                <span className="text-xs tabular-nums">{row.pv}</span>
            ),
        },
        {
            id: "bv",
            header: "BV",
            accessor: (row: any) => row.bv ?? 0,
            align: "center",
            hideBelow: "lg",
            cell: (row: any) => (
                <span className="text-xs tabular-nums">{row.bv}</span>
            ),
        },
        {
            id: "actions",
            header: "Actions",
            align: "right",
            width: "4rem",
            cell: (row: any) => (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground hover:text-foreground"
                        >
                            <MoreHorizontal className="size-4" />
                            <span className="sr-only">
                                {t("Actions for")} {row.name}
                            </span>
                        </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                        <DropdownMenuItem
                            onClick={() => setRestockingStock(row)}
                        >
                            <PackagePlus className="mr-2 size-4" /> {t("Restock")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            onClick={() => setEditingStock(row)}
                        >
                            <Edit className="mr-2 size-4" /> {t("Edit")}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeletingId(row._id)}
                        >
                            <Trash2 className="mr-2 size-4" /> {t("Delete")}
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            ),
        },
    ];

    const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        try {
            await addStock({
                name: formData.get("name") as string,
                productCode: formData.get("productCode") as string,
                categoryId: formData.get("categoryId") as Id<"categories">,
                price: parseFloat(formData.get("price") as string),
                purchasePrice: parseFloat(formData.get("purchasePrice") as string),
                qty: parseFloat(formData.get("qty") as string),
                pv: parseFloat(formData.get("pv") as string),
                bv: parseFloat(formData.get("bv") as string),
                halfPrice: halfPrice, // Use the prop to force correct type
                description: formData.get("description") as string,
                supplier: (formData.get("supplier") as string) || undefined,
                barcode: (formData.get("barcode") as string) || undefined,
            });
            toast.success("Stock added successfully");
            setIsAddOpen(false);
        } catch (error) {
            toast.error(formatError(error));
        }
    };


    const handleUpdate = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!editingStock) return;
        const formData = new FormData(e.currentTarget);
        try {
            await updateStock({
                id: editingStock._id,
                name: formData.get("name") as string,
                productCode: formData.get("productCode") as string,
                categoryId: formData.get("categoryId") as Id<"categories">,
                price: parseFloat(formData.get("price") as string),
                purchasePrice: parseFloat(formData.get("purchasePrice") as string),
                qty: parseFloat(formData.get("qty") as string),
                pv: parseFloat(formData.get("pv") as string),
                bv: parseFloat(formData.get("bv") as string),
                halfPrice: halfPrice, // Keep unchanged or allow edit? User implies strict tabs.
                description: formData.get("description") as string,
                supplier: (formData.get("supplier") as string) || undefined,
                barcode: (formData.get("barcode") as string) || undefined,
            });
            toast.success("Stock updated successfully");
            setEditingStock(null);
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteStock({ id: deletingId });
            toast.success("Stock deleted");
            setDeletingId(null);
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    const handleRestock = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (!restockingStock) return;
        const formData = new FormData(e.currentTarget);
        try {
            await restockStock({
                id: restockingStock._id,
                quantityToAdd: parseFloat(formData.get("quantityToAdd") as string),
                price: restockingStock.price,
                pv: restockingStock.pv,
                bv: restockingStock.bv,
                halfPrice: halfPrice,
                date: new Date().toISOString(), // Or allow user to pick date? Stick to now for simplicity unless requested
                supplier: (formData.get("supplier") as string) || undefined,
            });
            toast.success("Stock restocked successfully");
            setRestockingStock(null);
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    return (
        <div className="space-y-4">
            <ConfirmDeleteModal
                isOpen={!!deletingId}
                onClose={() => setDeletingId(null)}
                onConfirm={handleDelete}
                title={t("Delete Stock Item?")}
                description={t("This will permanently delete this stock item and remove it from all shops. This action cannot be undone.")}
            />

            <Dialog open={!!restockingStock} onOpenChange={(open) => !open && setRestockingStock(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{t("Restock Product")}</DialogTitle>
                    </DialogHeader>
                    {restockingStock && (
                        <form onSubmit={handleRestock} className="space-y-4">
                            <div className="grid gap-2">
                                <Label>{t("Product")}</Label>
                                <div className="font-medium">{restockingStock.name} ({restockingStock.productCode})</div>
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="quantityToAdd">{t("Quantity to Add")}</Label>
                                <Input
                                    id="quantityToAdd"
                                    name="quantityToAdd"
                                    type="number"
                                    required
                                    min="1"
                                    defaultValue="1"
                                    autoFocus
                                />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="supplier_restock">{t("Supplier (Optional)")}</Label>
                                <Input
                                    id="supplier_restock"
                                    name="supplier"
                                    placeholder={t("e.g. Acme Corp")}
                                />
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setRestockingStock(null)}>
                                    {t("Cancel")}
                                </Button>
                                <Button type="submit">{t("Confirm Restock")}</Button>
                            </DialogFooter>
                        </form>
                    )}
                </DialogContent>
            </Dialog>

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm w-full sm:max-w-sm">
                    <Search className="h-4 w-4 text-muted-foreground ml-2" />
                    <Input
                        placeholder={t("Search by code or name...")}
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setCurrentPage(1); // Reset to page 1 on search
                        }}
                        className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-8 w-full"
                    />
                </div>
                <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> {t("Add")} {halfPrice ? "HP" : "Regular"} {t("Product")}
                </Button>
            </div>

            <DataTable
                data={currentView}
                columns={stockColumns}
                getRowId={(row: any) => row._id}
                isLoading={paginatedResult === undefined}
                manual
                manualPage={currentPage}
                manualPageCount={Math.max(1, totalPages)}
                manualTotal={totalItems}
                onManualPageChange={(p) => setCurrentPage(p)}
                pageSize={rowsPerPage}
                ariaLabel="Stock items"
                emptyTitle={t("No products found")}
                emptyHint={t("Adjust your search, or add the first product.")}
            />

                {/* Add/Edit Dialogs Reuse */}
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{t("Add")} {halfPrice ? "HP" : "Regular"} {t("Stock")}</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>{t("Product Name")}</Label>
                                    <Input name="name" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Product Code")}</Label>
                                    <Input name="productCode" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Barcode")}</Label>
                                    <Input name="barcode" placeholder={t("Scanned or typed")} />
                                    <p className="text-xs text-muted-foreground">
                                        {t("Leave it empty if the product has none. A barcode belongs to one product.")}
                                    </p>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Category")}</Label>
                                    <Select name="categoryId" required>
                                        <SelectTrigger><SelectValue placeholder={t("Select")} /></SelectTrigger>
                                        <SelectContent>
                                            {categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.type}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Selling Price")}</Label>
                                    <Input name="price" type="number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Purchase Price")}</Label>
                                    <Input name="purchasePrice" type="number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Quantity")}</Label>
                                    <Input name="qty" type="number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("PV")}</Label>
                                    <Input name="pv" type="number" required step="0.1" />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("BV")}</Label>
                                    <Input name="bv" type="number" required step="0.1" />
                                </div>
                                <div className="space-y-2">
                                    <Label>{t("Supplier (Optional)")}</Label>
                                    <Input name="supplier" placeholder={t("e.g. Acme Corp")} />
                                </div>
                            </div>
                            <Input name="description" placeholder={t("Description (Optional)")} className="mt-4" />
                            <DialogFooter className="mt-4">
                                <Button type="submit">{t("Create")}</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                <Dialog open={!!editingStock} onOpenChange={(o) => !o && setEditingStock(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>{t("Edit Stock")}</DialogTitle>
                        </DialogHeader>
                        {editingStock && (
                            <form onSubmit={handleUpdate} className="space-y-4 py-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>{t("Product Name")}</Label>
                                        <Input name="name" defaultValue={editingStock.name} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Product Code")}</Label>
                                        <Input name="productCode" defaultValue={editingStock.productCode} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Barcode")}</Label>
                                        <Input name="barcode" defaultValue={editingStock.barcode ?? ""} placeholder={t("Scanned or typed")} />
                                        <p className="text-xs text-muted-foreground">
                                            {t("Leave it empty to clear the barcode. A barcode belongs to one product.")}
                                        </p>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Category")}</Label>
                                        <Select name="categoryId" defaultValue={editingStock.categoryId} required>
                                            <SelectTrigger><SelectValue placeholder={t("Select")} /></SelectTrigger>
                                            <SelectContent>
                                                {categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.type}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Selling Price")}</Label>
                                        <Input name="price" type="number" defaultValue={editingStock.price} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Purchase Price")}</Label>
                                        <Input name="purchasePrice" type="number" defaultValue={editingStock.purchasePrice} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Quantity")}</Label>
                                        <Input name="qty" type="number" defaultValue={editingStock.qty} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("PV")}</Label>
                                        <Input name="pv" type="number" defaultValue={editingStock.pv} required step="0.1" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("BV")}</Label>
                                        <Input name="bv" type="number" defaultValue={editingStock.bv} required step="0.1" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>{t("Supplier (Optional)")}</Label>
                                        <Input name="supplier" defaultValue={editingStock.supplier} placeholder={t("e.g. Acme Corp")} />
                                    </div>
                                </div>
                                <Input name="description" defaultValue={t(editingStock.description)} placeholder={t("Description")} className="mt-4" />
                                <DialogFooter className="mt-4">
                                    <Button type="submit">{t("Update")}</Button>
                                </DialogFooter>
                            </form>
                        )}
                    </DialogContent>
                </Dialog>
        </div>
    );
}

function CategoryManager() {
    
    const t = useT();const { user } = useAuth();
    const categories = useQuery(api.categories.get, {});
    const addCategory = useMutation(api.categories.add);
    const deleteCategory = useMutation(api.categories.remove);
    const [name, setName] = useState("");
    const [deletingId, setDeletingId] = useState<Id<"categories"> | null>(null);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name) return;
        try {
            await addCategory({ type: name, userId: user!._id });
            toast.success("Category added");
            setName("");
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteCategory({ id: deletingId, userId: user!._id });
            toast.success("Category removed");
            setDeletingId(null);
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    return (
        <div className="grid gap-6 md:grid-cols-2">
            <ConfirmDeleteModal
                isOpen={!!deletingId}
                onClose={() => setDeletingId(null)}
                onConfirm={handleDelete}
                title={t("Delete Category?")}
                description={t("This will permanently delete this category. Products using this category will still exist but point to a missing category.")}
            />
            <div className="space-y-4">
                <div className="p-4 rounded-xl border bg-card shadow-sm">
                    <h3 className="font-semibold mb-4">{t("Add New Category")}</h3>
                    <form onSubmit={handleAdd} className="flex gap-2">
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder={t("Category Name")}
                            required
                        />
                        <Button type="submit">{t("Add")}</Button>
                    </form>
                </div>
            </div>
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("Category Name")}</TableHead>
                            <TableHead className="text-right">{t("Actions")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {categories?.map((cat) => (
                            <TableRow key={cat._id}>
                                <TableCell className="font-medium">{cat.type}</TableCell>
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" className="hover:text-destructive" onClick={() => setDeletingId(cat._id)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {categories?.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">{t("No categories found.")}</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
