"use client";

import { useState, useEffect } from "react";
import { usePaginatedQuery, useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id, Doc } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShoppingCart, Trash2, Plus, Minus, Store, MoveRight, Loader2, PackageCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";

// Types
type TransferItem = {
    stockId: Id<"stocks">;
    name: string;
    productCode: string;
    qty: number;
    maxQty: number; // Available in warehouse
};

export default function ShopsPage() {
    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-black tracking-tight">Stock Transfer Terminal</h1>
                <p className="text-muted-foreground">Assign and transfer stock from Main Warehouse to Shops/Branches.</p>
            </div>

            <Tabs defaultValue="regular" className="flex-1 flex flex-col">
                <TabsList className="grid w-full grid-cols-3 lg:w-[600px]">
                    <TabsTrigger value="regular">Regular Stock</TabsTrigger>
                    <TabsTrigger value="hp">HP Stock</TabsTrigger>
                    <TabsTrigger value="view">View Stock</TabsTrigger>
                </TabsList>

                <div className="flex-1 mt-4 overflow-hidden">
                    <TabsContent value="regular" className="h-full m-0">
                        <StockTransferInterface isHp={false} />
                    </TabsContent>
                    <TabsContent value="hp" className="h-full m-0">
                        <StockTransferInterface isHp={true} />
                    </TabsContent>
                    <TabsContent value="view" className="h-full m-0">
                        <ShopStockViewer />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}

function ShopStockViewer() {
    const shops = useQuery(api.shops.listAll);
    const [selectedShopId, setSelectedShopId] = useState<Id<"shops"> | "">("");
    const [search, setSearch] = useState("");
    const [viewType, setViewType] = useState<"regular" | "hp">("regular");

    // Edit State
    const [editingItem, setEditingItem] = useState<{ stockId: Id<"stocks">; name: string; qty: number } | null>(null);
    const [newQty, setNewQty] = useState<string>("");
    const [isUpdating, setIsUpdating] = useState(false);

    const shopData = useQuery(api.shops.getShop, selectedShopId ? { id: selectedShopId as Id<"shops"> } : "skip");
    const adjustStock = useMutation(api.shops.adjustShopStock);
    const returnStock = useMutation(api.shops.returnShopStock);

    // Derived State
    const allStocks = shopData?.issuedStocks || [];

    // Filter
    const filteredStocks = allStocks.filter(s => {
        const matchesSearch = (s.name?.toLowerCase().includes(search.toLowerCase()) || false) ||
            (s.productCode?.toLowerCase().includes(search.toLowerCase()) || false);
        const isHpItem = !!s.halfPrice;
        const matchesType = viewType === "hp" ? isHpItem : !isHpItem;
        return matchesSearch && matchesType;
    });

    // Stats
    const totalItems = filteredStocks.reduce((acc, s) => acc + s.qty, 0);
    const totalValue = filteredStocks.reduce((acc, s) => acc + (s.qty * s.price), 0);
    const totalPV = filteredStocks.reduce((acc, s) => acc + (s.qty * s.pv), 0);
    const totalBV = filteredStocks.reduce((acc, s) => acc + (s.qty * s.bv), 0);

    // Pagination
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(15);

    useEffect(() => {
        const saved = localStorage.getItem("pos_shop_viewer_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
    }, []);

    const totalPages = Math.ceil(filteredStocks.length / rowsPerPage);
    const paginatedStocks = filteredStocks.slice((page - 1) * rowsPerPage, page * rowsPerPage);

    useEffect(() => { setPage(1); }, [search, selectedShopId, viewType]);

    // Handlers
    const handleEditClick = (item: any) => {
        setEditingItem({ stockId: item.stockId, name: item.name, qty: item.qty });
        setNewQty(item.qty.toString());
    };

    const handleSaveEdit = async () => {
        if (!editingItem || !selectedShopId) return;
        const q = parseInt(newQty);
        if (isNaN(q) || q < 0) {
            toast.error("Invalid quantity");
            return;
        }

        try {
            setIsUpdating(true);
            await adjustStock({
                shopId: selectedShopId as Id<"shops">,
                stockId: editingItem.stockId,
                newQty: q
            });
            toast.success("Stock updated successfully");
            setEditingItem(null);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsUpdating(false);
        }
    };

    const handleDelete = async (stockId: Id<"stocks">) => {
        if (!selectedShopId) return;
        if (!confirm("Are you sure? This will return ALL items to the warehouse.")) return;

        try {
            await returnStock({
                shopId: selectedShopId as Id<"shops">,
                stockId: stockId
            });
            toast.success("Item returned to warehouse");
        } catch (error) {
            toast.error(formatError(error));
        }
    };


    return (
        <div className="grid grid-cols-1 gap-6 h-full flex flex-col">
            {/* Controls & Summary */}
            <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card p-4 rounded-xl border shadow-sm">
                    <div className="w-full sm:w-[300px]">
                        <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider mb-1.5 block">Select Shop</Label>
                        <Select value={selectedShopId} onValueChange={(v) => setSelectedShopId(v as Id<"shops">)}>
                            <SelectTrigger className="h-10">
                                <SelectValue placeholder="Choose a shop to view..." />
                            </SelectTrigger>
                            <SelectContent>
                                {shops?.map(shop => (
                                    <SelectItem key={shop._id} value={shop._id}>
                                        {shop.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Stock Type Toggles */}
                    <div className="flex items-center bg-muted/50 p-1 rounded-lg border">
                        <Button
                            variant={viewType === "regular" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setViewType("regular")}
                            className="text-xs font-semibold"
                        >
                            Regular Stock
                        </Button>
                        <Button
                            variant={viewType === "hp" ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setViewType("hp")}
                            className="text-xs font-semibold"
                        >
                            HP Stock
                        </Button>
                    </div>
                </div>

                {/* Summaries */}
                {selectedShopId && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="p-4 shadow-sm border-none bg-blue-50/50">
                            <p className="text-xs text-muted-foreground uppercase font-bold">Total Value</p>
                            <p className="text-xl font-black text-primary">UGX {totalValue.toLocaleString()}</p>
                        </Card>
                        <Card className="p-4 shadow-sm border-none bg-green-50/50">
                            <p className="text-xs text-muted-foreground uppercase font-bold text-green-700">Total Items</p>
                            <p className="text-xl font-black text-green-900">{totalItems.toLocaleString()}</p>
                        </Card>
                        <Card className="p-4 shadow-sm border-none bg-orange-50/50">
                            <p className="text-xs text-muted-foreground uppercase font-bold text-orange-700">Total PV</p>
                            <p className="text-xl font-black text-orange-900">{totalPV}</p>
                        </Card>
                        <Card className="p-4 shadow-sm border-none bg-purple-50/50">
                            <p className="text-xs text-muted-foreground uppercase font-bold text-purple-700">Total BV</p>
                            <p className="text-xl font-black text-purple-900">{totalBV}</p>
                        </Card>
                    </div>
                )}


                <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder={`Search ${viewType === 'hp' ? 'HP' : 'Regular'} inventory...`}
                        className="pl-9 h-10"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-hidden border rounded-xl bg-card shadow-sm flex flex-col">
                {!selectedShopId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                        <Store className="h-16 w-16 mb-4 opacity-10" />
                        <p className="text-lg font-medium">No Shop Selected</p>
                        <p className="text-sm">Please select a shop to view its inventory.</p>
                    </div>
                ) : filteredStocks.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
                        <p>No {viewType === 'hp' ? 'HP' : 'Regular'} products found in this shop.</p>
                    </div>
                ) : (
                    <>
                        <div className="flex-1 overflow-auto">
                            <Table>
                                <TableHeader className="sticky top-0 bg-background z-10">
                                    <TableRow>
                                        <TableHead>Product Name</TableHead>
                                        <TableHead className="text-right">Unit Price</TableHead>
                                        <TableHead className="text-center">PV</TableHead>
                                        <TableHead className="text-center">BV</TableHead>
                                        <TableHead className="text-center">Qty</TableHead>
                                        <TableHead className="text-right">Total Value</TableHead>
                                        <TableHead className="text-right">Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {paginatedStocks.map((stock) => (
                                        <TableRow key={stock.stockId}>
                                            <TableCell>
                                                <div className="font-medium">{stock.name}</div>
                                                <div className="text-xs text-muted-foreground font-mono">{stock.productCode}</div>
                                                {stock.halfPrice && <Badge variant="secondary" className="mt-1 text-[10px]">HP</Badge>}
                                            </TableCell>
                                            <TableCell className="text-right">{stock.price.toLocaleString()}</TableCell>
                                            <TableCell className="text-center text-muted-foreground">{stock.pv}</TableCell>
                                            <TableCell className="text-center text-muted-foreground">{stock.bv}</TableCell>
                                            <TableCell className="text-center">
                                                <Badge variant={stock.qty < 5 ? "destructive" : "outline"} className={stock.qty < 5 ? "" : "bg-green-50 text-green-700 border-green-200"}>
                                                    {stock.qty}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-medium">
                                                {(stock.qty * stock.price).toLocaleString()}
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button variant="ghost" size="sm" onClick={() => handleEditClick(stock)}>
                                                        Edit
                                                    </Button>
                                                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(stock.stockId)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {/* Standard Pagination */}
                        <div className="flex items-center justify-end border-t bg-muted/20 px-4 py-4 space-x-2">
                            <div className="flex items-center space-x-2 mr-auto">
                                <p className="text-xs font-medium hidden sm:inline-block">Rows</p>
                                <Select
                                    value={`${rowsPerPage}`}
                                    onValueChange={(value) => {
                                        const newSize = Number(value);
                                        setRowsPerPage(newSize);
                                        localStorage.setItem("pos_shop_viewer_rows_per_page", String(newSize));
                                        setPage(1);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[65px]">
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

                            <div className="text-xs font-medium mr-2">
                                {Math.min((page - 1) * rowsPerPage + 1, filteredStocks.length)}-{Math.min(page * rowsPerPage, filteredStocks.length)} of {filteredStocks.length}
                            </div>

                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                disabled={page === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                disabled={page === totalPages || totalPages === 0}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </>
                )}
            </div>

            {/* Edit Dialog */}
            <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Adjust Shop Stock</DialogTitle>
                        <DialogDescription>
                            Change the quantity for <b>{editingItem?.name}</b>.
                            <br />
                            <span className="text-xs text-muted-foreground">
                                Increasing will deduct from warehouse. Decreasing will return to warehouse.
                            </span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <Label>Quantity</Label>
                        <Input
                            value={newQty}
                            onChange={(e) => setNewQty(e.target.value)}
                            type="number"
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditingItem(null)}>Cancel</Button>
                        <Button onClick={handleSaveEdit} disabled={isUpdating}>
                            {isUpdating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            Save Changes
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}

function StockTransferInterface({ isHp }: { isHp: boolean }) {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [transferQueue, setTransferQueue] = useState<TransferItem[]>([]);
    const [selectedShopId, setSelectedShopId] = useState<Id<"shops"> | "">("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // 1. Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Persist rowsPerPage
    useEffect(() => {
        const saved = localStorage.getItem("pos_stock_rows_per_page"); // Use same key for consistency across app? Or "pos_transfer_rows"? User said "consistent".
        // Let's use the same key for a unified experience, or a similar valid one.
        // Actually, user might want different view sizes. I'll use a specific one but generic naming style.
        // "consistent localstorage" -> likely means "it should assume the same behavior".
        // I will use "pos_transfer_rows_per_page" to avoid cross-page confusion if context differs.
        const savedSpecific = localStorage.getItem("pos_transfer_rows_per_page");
        if (savedSpecific) {
            setRowsPerPage(Number(savedSpecific));
        }
    }, []);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setCurrentPage(1); // Reset page on search
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Data Fetching
    const { results: stocks, status, loadMore, isLoading: isStocksLoading } = usePaginatedQuery(
        api.stocks.list,
        {
            searchTerm: debouncedSearch || undefined,
            halfPrice: isHp,
        },
        { initialNumItems: rowsPerPage }
    );

    // Tab/State Sync
    useEffect(() => {
        if (status === "CanLoadMore" && stocks && stocks.length < rowsPerPage) {
            loadMore(rowsPerPage - stocks.length);
        }
    }, [rowsPerPage, stocks, status, loadMore]);

    // Count Query
    const totalItems = useQuery(api.stocks.count, {
        halfPrice: isHp,
        searchTerm: debouncedSearch || undefined
    }) || 0;

    const shops = useQuery(api.shops.listAll);
    const transferStock = useMutation(api.shops.transferStock);

    // Client-side Slicing
    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);

    // Loaded check
    const loadedCount = stocks?.length || 0;
    const currentView = stocks?.slice(startIndex, endIndex) || [];

    const handleNextPage = () => {
        if (currentPage < totalPages) {
            const nextPageIndex = startIndex + rowsPerPage;
            if (nextPageIndex >= loadedCount && status === "CanLoadMore") {
                loadMore(rowsPerPage);
            }
            setCurrentPage(p => p + 1);
        }
    };

    // Queue Actions
    const addToQueue = (stock: Doc<"stocks">) => {
        setTransferQueue(prev => {
            const existing = prev.find(i => i.stockId === stock._id);
            if (existing) {
                if (existing.qty >= stock.qty) {
                    toast.error("Cannot add more than available stock");
                    return prev;
                }
                return prev.map(i => i.stockId === stock._id ? { ...i, qty: i.qty + 1 } : i);
            }
            return [...prev, {
                stockId: stock._id,
                name: stock.name,
                productCode: stock.productCode,
                qty: 1,
                maxQty: stock.qty
            }];
        });
    };

    const updateQueueQty = (stockId: Id<"stocks">, delta: number) => {
        setTransferQueue(prev => {
            return prev.map(item => {
                if (item.stockId === stockId) {
                    const newQty = item.qty + delta;
                    if (newQty <= 0) return null;
                    if (newQty > item.maxQty) {
                        toast.error("Available stock limit reached");
                        return item;
                    }
                    return { ...item, qty: newQty };
                }
                return item;
            }).filter(Boolean) as TransferItem[];
        });
    };

    const removeFromQueue = (stockId: Id<"stocks">) => {
        setTransferQueue(prev => prev.filter(i => i.stockId !== stockId));
    };

    const handleTransfer = async () => {
        if (!user || user.roles?.length === 0) { // Basic auth check
            toast.error("Unauthorized");
            return;
        }
        if (!selectedShopId) {
            toast.error("Please select a destination shop");
            return;
        }
        if (transferQueue.length === 0) {
            toast.error("Transfer queue is empty");
            return;
        }

        try {
            setIsSubmitting(true);
            // Process sequentially to ensure order and handle errors individually if needed
            // For a "Transaction" feel, we loop.
            for (const item of transferQueue) {
                await transferStock({
                    shopId: selectedShopId as Id<"shops">,
                    stockId: item.stockId,
                    quantity: item.qty,
                    userId: user._id,
                });
            }

            toast.success(`Successfully transferred ${transferQueue.length} items`);
            setTransferQueue([]);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full">
            {/* Left Panel: Source (Main Warehouse) */}
            <div className="lg:col-span-7 flex flex-col gap-4 h-full overflow-hidden">
                <Card className="h-full flex flex-col border-none shadow-none bg-transparent">
                    <div className="flex flex-col gap-4 mb-4">
                        <div className="relative">
                            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search warehouse stock..."
                                className="pl-9 h-11"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto border rounded-xl bg-card shadow-sm p-0 flex flex-col">
                        {!stocks ? (
                            <div className="flex items-center justify-center flex-1 h-40"><Loader2 className="animate-spin" /></div>
                        ) : currentView.length === 0 ? (
                            <div className="text-center py-10 flex-1 text-muted-foreground flex flex-col items-center justify-center">
                                {status === "LoadingMore" || status === "LoadingFirstPage" ? (
                                    <div className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4" /> Loading...</div>
                                ) : "No stocks found matching your criteria"}
                            </div>
                        ) : (
                            <div className="flex-1 overflow-auto">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-10">
                                        <TableRow>
                                            <TableHead>Product</TableHead>
                                            <TableHead className="text-center">Available</TableHead>
                                            <TableHead className="text-right">Action</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {currentView.map((stock) => (
                                            <TableRow key={stock._id} className={stock.qty === 0 ? "opacity-50" : ""}>
                                                <TableCell className="py-3">
                                                    <div className="font-medium text-sm">{stock.name}</div>
                                                    <div className="text-xs text-muted-foreground flex gap-2">
                                                        <span className="font-mono bg-muted px-1 rounded">{stock.productCode}</span>
                                                        <span>PV: {stock.pv}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant={stock.qty > 0 ? "outline" : "destructive"} className={stock.qty > 0 ? "bg-blue-50 text-blue-700 border-blue-200" : ""}>
                                                        {stock.qty}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        className="h-8"
                                                        disabled={stock.qty === 0}
                                                        onClick={() => addToQueue(stock)}
                                                    >
                                                        <MoveRight className="h-4 w-4 mr-1" /> Transfer
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}

                        {/* Pagination Footer */}
                        <div className="flex items-center justify-end border-t bg-muted/20 px-4 py-4 space-x-2">
                            <div className="flex items-center space-x-2 mr-auto">
                                <p className="text-xs font-medium hidden sm:inline-block">Rows</p>
                                <Select
                                    value={`${rowsPerPage}`}
                                    onValueChange={(value) => {
                                        const newSize = Number(value);
                                        setRowsPerPage(newSize);
                                        localStorage.setItem("pos_transfer_rows_per_page", String(newSize));
                                        setCurrentPage(1);
                                    }}
                                >
                                    <SelectTrigger className="h-8 w-[65px]">
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

                            <div className="text-xs font-medium mr-2">
                                {Math.min(startIndex + 1, totalItems)}-{Math.min(endIndex, totalItems)} of {totalItems}
                            </div>

                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                            >
                                <ChevronLeft className="h-4 w-4" />
                            </Button>
                            <Button
                                variant="outline"
                                className="h-8 w-8 p-0"
                                onClick={handleNextPage}
                                disabled={currentPage >= totalPages || (currentPage === totalPages && status === "Exhausted")}
                            >
                                <ChevronRight className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Right Panel: Destination (Queue) */}
            <div className="lg:col-span-5 h-full flex flex-col gap-4 overflow-hidden">
                <Card className="flex-1 flex flex-col overflow-hidden border-2 shadow-md flex h-full">
                    <CardHeader className="bg-muted/30 pb-4 border-b">
                        <div className="space-y-4">
                            <CardTitle className="flex items-center gap-2 text-lg">
                                <PackageCheck className="h-5 w-5" /> Transfer Queue
                            </CardTitle>
                            <div className="space-y-1.5">
                                <Label className="text-xs text-muted-foreground uppercase font-bold tracking-wider">Destination Shop</Label>
                                <Select value={selectedShopId} onValueChange={(v) => setSelectedShopId(v as Id<"shops">)}>
                                    <SelectTrigger className="h-10 border-primary/20 focus:ring-primary/20 bg-background">
                                        <SelectValue placeholder="Select a shop..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {shops?.map(shop => (
                                            <SelectItem key={shop._id} value={shop._id}>
                                                <span className="font-medium">{shop.name}</span>
                                                <span className="ml-2 text-muted-foreground text-xs">({shop.location})</span>
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </CardHeader>

                    <CardContent className="flex-1 overflow-y-auto p-0 bg-muted/5">
                        {transferQueue.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                                <Store className="h-12 w-12 mb-4 opacity-10" />
                                <p className="font-medium">Queue Empty</p>
                                <p className="text-xs text-center mt-1">Select items from the warehouse to begin transfer</p>
                            </div>
                        ) : (
                            <Table>
                                <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                    <TableRow>
                                        <TableHead className="w-[50%]">Item</TableHead>
                                        <TableHead className="w-[30%] text-center">Qty</TableHead>
                                        <TableHead className="w-[20%]"></TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {transferQueue.map(item => (
                                        <TableRow key={item.stockId} className="bg-background">
                                            <TableCell className="py-2">
                                                <div className="font-medium text-sm line-clamp-1">{item.name}</div>
                                                <div className="text-xs text-muted-foreground">{item.productCode}</div>
                                            </TableCell>
                                            <TableCell className="p-0">
                                                <div className="flex items-center justify-center gap-1">
                                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQueueQty(item.stockId, -1)}>
                                                        <Minus className="h-3 w-3" />
                                                    </Button>
                                                    <span className="w-8 text-center text-sm font-bold bg-muted/50 rounded py-1">{item.qty}</span>
                                                    <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQueueQty(item.stockId, 1)}>
                                                        <Plus className="h-3 w-3" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-right pr-4">
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => removeFromQueue(item.stockId)}>
                                                    <Trash2 className="h-4 w-4" />
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </CardContent>

                    <div className="p-4 border-t bg-background">
                        <div className="flex justify-between items-center mb-4 text-sm">
                            <span className="text-muted-foreground">Total Items</span>
                            <span className="font-bold text-lg">{transferQueue.reduce((acc, i) => acc + i.qty, 0)}</span>
                        </div>
                        <Button
                            className="w-full font-bold text-md h-12"
                            size="lg"
                            disabled={transferQueue.length === 0 || !selectedShopId || isSubmitting}
                            onClick={handleTransfer}
                        >
                            {isSubmitting ? <Loader2 className="animate-spin mr-2" /> : <MoveRight className="mr-2 h-5 w-5" />}
                            Confirm Transfer
                        </Button>
                    </div>
                </Card>
            </div>
        </div>
    );
}
