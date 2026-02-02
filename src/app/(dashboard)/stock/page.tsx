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
import { Plus, Search, Edit, Trash2, MoreHorizontal, Loader2, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
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

export default function StockPage() {
    const [activeTab, setActiveTab] = useState("regular");

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4">
                <h1 className="text-3xl font-black tracking-tight text-foreground">Stock Management</h1>
                <p className="text-muted-foreground">Manage your inventory, prices, and product categories.</p>
            </div>

            <Tabs defaultValue="regular" value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-3 lg:w-[400px]">
                    <TabsTrigger value="regular">Regular Stock</TabsTrigger>
                    <TabsTrigger value="hp">HP Stock</TabsTrigger>
                    <TabsTrigger value="categories">Categories</TabsTrigger>
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
    const [search, setSearch] = useState("");
    const [isAddOpen, setIsAddOpen] = useState(false);
    const [editingStock, setEditingStock] = useState<Doc<"stocks"> | null>(null);
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

    const categories = useQuery(api.categories.get);
    // [OPTIMIZED] O(1) Category Lookup Map
    const categoryMap = new Map(categories?.map(c => [c._id, c.type]) || []);

    const addStock = useMutation(api.stocks.add);
    const updateStock = useMutation(api.stocks.update);
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

    return (
        <div className="space-y-4">
            <ConfirmDeleteModal
                isOpen={!!deletingId}
                onClose={() => setDeletingId(null)}
                onConfirm={handleDelete}
                title="Delete Stock Item?"
                description="This will permanently delete this stock item and remove it from all shops. This action cannot be undone."
            />

            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2 bg-card p-2 rounded-lg border shadow-sm w-full sm:max-w-sm">
                    <Search className="h-4 w-4 text-muted-foreground ml-2" />
                    <Input
                        placeholder="Search by code or name..."
                        value={search}
                        onChange={(e) => {
                            setSearch(e.target.value);
                            setCurrentPage(1); // Reset to page 1 on search
                        }}
                        className="border-0 bg-transparent shadow-none focus-visible:ring-0 h-8 w-full"
                    />
                </div>
                <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" /> Add {halfPrice ? "HP" : "Regular"} Product
                </Button>
            </div>

            <div className="rounded-xl border bg-card shadow-sm overflow-hidden flex flex-col">
                <div className="flex-1 overflow-x-auto">
                    <div className="min-w-[1000px] lg:min-w-0">
                        <Table>
                            <TableHeader className="bg-muted/50">
                                <TableRow>
                                    <TableHead>Code</TableHead>
                                    <TableHead>Product Name</TableHead>
                                    <TableHead>Category</TableHead>
                                    <TableHead className="text-right">Price (UGX)</TableHead>
                                    <TableHead className="text-center">Qty</TableHead>
                                    <TableHead className="text-center">PV</TableHead>
                                    <TableHead className="text-center">BV</TableHead>
                                    <TableHead className="text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {paginatedResult === undefined ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-24 text-center">
                                            <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                                        </TableCell>
                                    </TableRow>
                                ) : currentView.length === 0 ? (
                                    <TableRow>
                                        <TableCell colSpan={8} className="h-32 text-center text-muted-foreground">
                                            No items found.
                                        </TableCell>
                                    </TableRow>
                                ) : (
                                    currentView.map((stock) => (
                                        <TableRow key={stock._id} className="hover:bg-muted/50">
                                            <TableCell className="font-mono text-xs">{stock.productCode}</TableCell>
                                            <TableCell className="font-medium">{stock.name}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="font-normal">
                                                    {categoryMap.get(stock.categoryId) || "Unknown"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-bold">{stock.price.toLocaleString()}</TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={stock.qty < 10 ? "destructive" : "secondary"}>{stock.qty}</Badge>
                                            </TableCell>
                                            <TableCell className="text-center text-xs">{stock.pv}</TableCell>
                                            <TableCell className="text-center text-xs">{stock.bv}</TableCell>
                                            <TableCell className="text-right">
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" className="h-8 w-8 p-0">
                                                            <MoreHorizontal className="h-4 w-4" />
                                                        </Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => setEditingStock(stock)}>
                                                            <Edit className="mr-2 h-4 w-4" /> Edit
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem className="text-destructive" onClick={() => setDeletingId(stock._id)}>
                                                            <Trash2 className="mr-2 h-4 w-4" /> Delete
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </TableCell>
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>

                    {/* Full Pagination Footer */}
                    <div className="flex items-center justify-end border-t bg-muted/20 px-4 py-4 space-x-6 lg:space-x-8">
                        <div className="flex items-center space-x-2">
                            <p className="text-sm font-medium">Rows per page</p>
                            <Select
                                value={`${rowsPerPage}`}
                                onValueChange={(value) => {
                                    const newSize = Number(value);
                                    setRowsPerPage(newSize);
                                    localStorage.setItem("pos_stock_rows_per_page", String(newSize));
                                    setCurrentPage(1);
                                }}
                            >
                                <SelectTrigger className="h-8 w-[70px]">
                                    <SelectValue placeholder={rowsPerPage} />
                                </SelectTrigger>
                                <SelectContent side="top">
                                    {[5, 10, 20, 30, 50, 100].map((pageSize) => (
                                        <SelectItem key={pageSize} value={`${pageSize}`}>
                                            {pageSize}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex w-[100px] items-center justify-center text-sm font-medium">
                            Page {currentPage} of {totalPages || 1}
                        </div>
                        <div className="flex items-center space-x-2">
                            <span className="text-sm text-muted-foreground hidden md:inline-block mr-4">
                                Showing {Math.min(startIndex + 1, totalItems)}-{Math.min(endIndex, totalItems)} of {totalItems} items
                            </span>
                            <Button
                                variant="outline"
                                className="hidden h-8 w-8 p-0 lg:flex"
                                onClick={() => setCurrentPage(1)}
                                disabled={currentPage === 1}
                            >
                                <span className="sr-only">Go to first page</span>
                                <ChevronsLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                <span className="sr-only">Go to previous page</span>
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={handleNextPage}
                                disabled={currentPage >= totalPages}
                            >
                                <span className="sr-only">Go to next page</span>
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="hidden h-8 w-8 p-0 lg:flex"
                                onClick={() => setCurrentPage(totalPages)}
                                disabled={currentPage >= totalPages}
                            >
                                <span className="sr-only">Go to last page</span>
                                <ChevronsRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Add/Edit Dialogs Reuse */}
                <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Add {halfPrice ? "HP" : "Regular"} Stock</DialogTitle>
                        </DialogHeader>
                        <form onSubmit={handleCreate} className="space-y-4 py-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label>Product Name</Label>
                                    <Input name="name" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Product Code</Label>
                                    <Input name="productCode" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Category</Label>
                                    <Select name="categoryId" required>
                                        <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                        <SelectContent>
                                            {categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.type}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label>Selling Price</Label>
                                    <Input name="price" type="number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Purchase Price</Label>
                                    <Input name="purchasePrice" type="number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>Quantity</Label>
                                    <Input name="qty" type="number" required />
                                </div>
                                <div className="space-y-2">
                                    <Label>PV</Label>
                                    <Input name="pv" type="number" required step="0.1" />
                                </div>
                                <div className="space-y-2">
                                    <Label>BV</Label>
                                    <Input name="bv" type="number" required step="0.1" />
                                </div>
                            </div>
                            <Input name="description" placeholder="Description (Optional)" className="mt-4" />
                            <DialogFooter className="mt-4">
                                <Button type="submit">Create</Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>

                <Dialog open={!!editingStock} onOpenChange={(o) => !o && setEditingStock(null)}>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle>Edit Stock</DialogTitle>
                        </DialogHeader>
                        {editingStock && (
                            <form onSubmit={handleUpdate} className="space-y-4 py-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Product Name</Label>
                                        <Input name="name" defaultValue={editingStock.name} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Product Code</Label>
                                        <Input name="productCode" defaultValue={editingStock.productCode} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Category</Label>
                                        <Select name="categoryId" defaultValue={editingStock.categoryId} required>
                                            <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                                            <SelectContent>
                                                {categories?.map((c) => <SelectItem key={c._id} value={c._id}>{c.type}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Selling Price</Label>
                                        <Input name="price" type="number" defaultValue={editingStock.price} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Purchase Price</Label>
                                        <Input name="purchasePrice" type="number" defaultValue={editingStock.purchasePrice} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Quantity</Label>
                                        <Input name="qty" type="number" defaultValue={editingStock.qty} required />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>PV</Label>
                                        <Input name="pv" type="number" defaultValue={editingStock.pv} required step="0.1" />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>BV</Label>
                                        <Input name="bv" type="number" defaultValue={editingStock.bv} required step="0.1" />
                                    </div>
                                </div>
                                <Input name="description" defaultValue={editingStock.description} placeholder="Description" className="mt-4" />
                                <DialogFooter className="mt-4">
                                    <Button type="submit">Update</Button>
                                </DialogFooter>
                            </form>
                        )}
                    </DialogContent>
                </Dialog>
            </div>
        </div>
    );
}

function CategoryManager() {
    const categories = useQuery(api.categories.get);
    const addCategory = useMutation(api.categories.add);
    const deleteCategory = useMutation(api.categories.remove);
    const [name, setName] = useState("");
    const [deletingId, setDeletingId] = useState<Id<"categories"> | null>(null);

    const handleAdd = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name) return;
        try {
            await addCategory({ type: name });
            toast.success("Category added");
            setName("");
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    const handleDelete = async () => {
        if (!deletingId) return;
        try {
            await deleteCategory({ id: deletingId });
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
                title="Delete Category?"
                description="This will permanently delete this category. Products using this category will still exist but point to a missing category."
            />
            <div className="space-y-4">
                <div className="p-4 rounded-xl border bg-card shadow-sm">
                    <h3 className="font-semibold mb-4">Add New Category</h3>
                    <form onSubmit={handleAdd} className="flex gap-2">
                        <Input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Category Name"
                            required
                        />
                        <Button type="submit">Add</Button>
                    </form>
                </div>
            </div>
            <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Category Name</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
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
                                <TableCell colSpan={2} className="text-center text-muted-foreground py-8">No categories found.</TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>
    );
}
