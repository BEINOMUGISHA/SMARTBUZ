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
import { formatError, cn } from "@/lib/utils";
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
                <TabsList className="grid w-full grid-cols-3 lg:w-[600px] h-auto p-1 bg-muted/50 border shadow-sm">
                    <TabsTrigger value="regular" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Regular Stock</TabsTrigger>
                    <TabsTrigger value="hp" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">HP Stock</TabsTrigger>
                    <TabsTrigger value="view" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">View Stock</TabsTrigger>
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
    const { user } = useAuth();
    const shops = useQuery(api.shops.listAll);
    const [selectedShopId, setSelectedShopId] = useState<Id<"shops"> | "">("");
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");

    // View Mode & Filters
    const [activeTab, setActiveTab] = useState("inventory");
    const [viewType, setViewType] = useState<"regular" | "hp">("regular");
    const [inventoryFilter, setInventoryFilter] = useState<"all" | "out" | "negative">("all");

    // History Filters
    const [dateFilter, setDateFilter] = useState("daily"); // daily | range
    const [date, setDate] = useState<Date | undefined>(new Date());
    const [dateRange, setDateRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
        from: new Date(),
        to: new Date(),
    });

    // Edit State
    const [editingItem, setEditingItem] = useState<{ stockId: Id<"stocks">; name: string; qty: number } | null>(null);
    const [newQty, setNewQty] = useState<string>("");
    const [isUpdating, setIsUpdating] = useState(false);

    // Pagination
    const [page, setPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(15);

    useEffect(() => {
        const saved = localStorage.getItem("pos_shop_viewer_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    useEffect(() => { setPage(1); }, [selectedShopId, viewType, inventoryFilter]);

    // Data Fetching: Current Stock
    const paginatedResult = useQuery(api.shops.getPaginatedShopStock, selectedShopId ? {
        shopId: selectedShopId as Id<"shops">,
        limit: rowsPerPage,
        offset: (page - 1) * rowsPerPage,
        searchTerm: debouncedSearch || undefined,
        halfPrice: viewType === "hp"
    } : "skip");

    const stocks = paginatedResult?.page || [];
    // Client-side filtering for Out/Negative stock since backend args didn't change yet
    // For large datasets, this should be moved to backend, but for typical shop size it's fine.
    const filteredStocks = stocks.filter(s => {
        if (inventoryFilter === "out") return s.qty === 0;
        if (inventoryFilter === "negative") return s.qty < 0;
        return true;
    });

    const totalCount = paginatedResult?.totalCount || 0;
    const stats = paginatedResult?.stats || { totalValue: 0, totalPV: 0, totalBV: 0, totalItems: 0 };
    const totalPages = Math.ceil(totalCount / rowsPerPage);

    const adjustStock = useMutation(api.shops.adjustShopStock);
    const returnStock = useMutation(api.shops.returnShopStock);

    // Data Fetching: Stock History
    const historyStartDate = dateFilter === "daily"
        ? (date ? new Date(new Date(date).setHours(0, 0, 0, 0)).toISOString() : "")
        : (dateRange.from ? new Date(new Date(dateRange.from).setHours(0, 0, 0, 0)).toISOString() : "");

    const historyEndDate = dateFilter === "daily"
        ? (date ? new Date(new Date(date).setHours(23, 59, 59, 999)).toISOString() : "")
        : (dateRange.to ? new Date(new Date(dateRange.to).setHours(23, 59, 59, 999)).toISOString() : "");

    const stockHistory = useQuery(api.shops.getShopIssueRecords,
        (selectedShopId && activeTab === "history" && historyStartDate && historyEndDate) ? {
            shopId: selectedShopId as Id<"shops">,
            startDate: historyStartDate,
            endDate: historyEndDate,
        } : "skip"
    );

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
                newQty: q,
                userId: user!._id,
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
                stockId: stockId,
                userId: user!._id,
            });
            toast.success("Item returned to warehouse");
        } catch (error) {
            toast.error(formatError(error));
        }
    };

    return (
        <div className="flex flex-col gap-6 h-full">
            {/* Header Controls */}
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

                    {selectedShopId && (
                        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
                            <TabsList className="grid w-full grid-cols-2">
                                <TabsTrigger value="inventory">Current Inventory</TabsTrigger>
                                <TabsTrigger value="history">Stock History</TabsTrigger>
                            </TabsList>
                        </Tabs>
                    )}
                </div>

                {selectedShopId && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <Card className="p-4 shadow-sm border-none bg-blue-50/50">
                            <p className="text-xs text-muted-foreground uppercase font-bold">Total Value</p>
                            <p className="text-xl font-black text-primary">UGX {stats.totalValue.toLocaleString()}</p>
                        </Card>
                        <Card className="p-4 shadow-sm border-none bg-green-50/50">
                            <p className="text-xs uppercase font-bold text-green-700">Total Items</p>
                            <p className="text-xl font-black text-green-900">{stats.totalItems.toLocaleString()}</p>
                        </Card>
                        <Card className="p-4 shadow-sm border-none bg-orange-50/50">
                            <p className="text-xs uppercase font-bold text-orange-700">Total PV</p>
                            <p className="text-xl font-black text-orange-900">{stats.totalPV}</p>
                        </Card>
                        <Card className="p-4 shadow-sm border-none bg-purple-50/50">
                            <p className="text-xs uppercase font-bold text-purple-700">Total BV</p>
                            <p className="text-xl font-black text-purple-900">{stats.totalBV}</p>
                        </Card>
                    </div>
                )}
            </div>

            <div className="flex-1 overflow-hidden border rounded-xl bg-card shadow-sm flex flex-col">
                {!selectedShopId ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground min-h-[300px]">
                        <Store className="h-16 w-16 mb-4 opacity-10" />
                        <p className="text-lg font-medium">No Shop Selected</p>
                        <p className="text-sm">Please select a shop to view details.</p>
                    </div>
                ) : activeTab === "inventory" ? (
                    /* INVENTORY VIEW */
                    <div className="flex flex-col h-full">
                        {/* Filters Bar */}
                        <div className="p-4 border-b bg-muted/20 flex flex-col sm:flex-row gap-4 items-center justify-between">
                            <div className="flex items-center gap-2">
                                <div className="relative w-full sm:w-[300px]">
                                    <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder={`Search ${viewType} stock...`}
                                        className="pl-9 h-9"
                                        value={search}
                                        onChange={(e) => setSearch(e.target.value)}
                                    />
                                </div>
                                <div className="flex items-center border rounded-md bg-background p-1 h-9">
                                    <Button variant={viewType === "regular" ? "secondary" : "ghost"} size="sm" onClick={() => setViewType("regular")} className="h-7 text-xs px-2">Regular</Button>
                                    <Button variant={viewType === "hp" ? "secondary" : "ghost"} size="sm" onClick={() => setViewType("hp")} className="h-7 text-xs px-2">HP</Button>
                                </div>
                            </div>
                            <Select value={inventoryFilter} onValueChange={(v: any) => setInventoryFilter(v)}>
                                <SelectTrigger className="w-[180px] h-9">
                                    <SelectValue placeholder="Filter Stock" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">All Items</SelectItem>
                                    <SelectItem value="out">Out of Stock (0)</SelectItem>
                                    <SelectItem value="negative">Negative Stock (&lt; 0)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>

                        {/* Table */}
                        <div className="flex-1 overflow-auto">
                            {stocks.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
                                    <p>No products found matching criteria.</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-10">
                                        <TableRow>
                                            <TableHead>Product Name</TableHead>
                                            <TableHead className="text-right">Unit Price</TableHead>
                                            <TableHead className="text-center">PV / BV</TableHead>
                                            <TableHead className="text-center">Qty</TableHead>
                                            <TableHead className="text-right">Total Value</TableHead>
                                            <TableHead className="text-right">Actions</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {filteredStocks.map((stock) => (
                                            <TableRow key={stock.stockId} className={cn(stock.qty === 0 ? "bg-red-50 hover:bg-red-100/50" : stock.qty < 0 ? "bg-red-100 hover:bg-red-200/50" : "")}>
                                                <TableCell>
                                                    <div className={cn("font-medium", stock.qty < 0 ? "text-red-900" : "")}>{stock.name}</div>
                                                    <div className="text-xs text-muted-foreground font-mono">{stock.productCode}</div>
                                                    {stock.halfPrice && <Badge variant="secondary" className="mt-1 text-[10px]">HP</Badge>}
                                                </TableCell>
                                                <TableCell className="text-right">{stock.price.toLocaleString()}</TableCell>
                                                <TableCell className="text-center text-xs text-muted-foreground">{stock.pv} / {stock.bv}</TableCell>
                                                <TableCell className="text-center">
                                                    <Badge variant={stock.qty <= 0 ? "destructive" : "outline"} className={cn(stock.qty > 0 ? "bg-green-50 text-green-700 border-green-200" : "font-bold shadow-xs")}>
                                                        {stock.qty}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right font-medium">
                                                    {(stock.qty * stock.price).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <Button variant="ghost" size="sm" onClick={() => handleEditClick(stock)}>Edit</Button>
                                                        <Button variant="ghost" size="icon" className="text-destructive" onClick={() => handleDelete(stock.stockId)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            )}
                        </div>

                        {/* Pagination Footer */}
                        <div className="flex flex-col sm:flex-row items-center justify-between border-t bg-muted/20 px-4 py-4 gap-4 mt-auto">
                            <div className="flex items-center space-x-2">
                                <p className="text-xs font-medium">Rows</p>
                                <Select value={`${rowsPerPage}`} onValueChange={(v) => { setRowsPerPage(Number(v)); setPage(1); }}>
                                    <SelectTrigger className="h-8 w-[65px]"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {[5, 10, 20, 30, 50, 100].map(p => <SelectItem key={p} value={`${p}`}>{p}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex items-center gap-4">
                                <div className="text-xs font-medium">
                                    {Math.min((page - 1) * rowsPerPage + 1, totalCount)}-{Math.min(page * rowsPerPage, totalCount)} of {totalCount}
                                </div>
                                <div className="flex items-center space-x-2">
                                    <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}><ChevronLeft className="h-4 w-4" /></Button>
                                    <Button variant="outline" className="h-8 w-8 p-0" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages || totalPages === 0}><ChevronRight className="h-4 w-4" /></Button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* HISTORY VIEW */
                    <div className="flex flex-col h-full bg-muted/5">
                        {/* History Filters */}
                        <div className="p-4 border-b bg-background flex flex-col gap-4">
                            <Tabs value={dateFilter} onValueChange={setDateFilter} className="w-[400px]">
                                <TabsList className="grid w-full grid-cols-2">
                                    <TabsTrigger value="daily">Daily Audit</TabsTrigger>
                                    <TabsTrigger value="range">Date Range</TabsTrigger>
                                </TabsList>
                            </Tabs>

                            <div className="flex items-center gap-4">
                                {dateFilter === "daily" ? (
                                    <div className="flex items-center gap-2">
                                        <Label>Select Date:</Label>
                                        <Input
                                            type="date"
                                            value={date ? date.toISOString().split("T")[0] : ""}
                                            onChange={(e) => setDate(e.target.value ? new Date(e.target.value) : undefined)}
                                            className="w-[180px]"
                                        />
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2">
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">From</Label>
                                            <Input
                                                type="date"
                                                value={dateRange.from ? dateRange.from.toISOString().split("T")[0] : ""}
                                                onChange={(e) => setDateRange(prev => ({ ...prev, from: e.target.value ? new Date(e.target.value) : undefined }))}
                                                className="w-[150px]"
                                            />
                                        </div>
                                        <div className="grid gap-1.5">
                                            <Label className="text-xs">To</Label>
                                            <Input
                                                type="date"
                                                value={dateRange.to ? dateRange.to.toISOString().split("T")[0] : ""}
                                                onChange={(e) => setDateRange(prev => ({ ...prev, to: e.target.value ? new Date(e.target.value) : undefined }))}
                                                className="w-[150px]"
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* History Table */}
                        <div className="flex-1 overflow-auto p-4">
                            {!stockHistory ? (
                                <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin" /></div>
                            ) : stockHistory.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground opacity-50">
                                    <p>No restock records found for this period.</p>
                                </div>
                            ) : (
                                <Card>
                                    <Table>
                                        <TableHeader className="bg-muted/50">
                                            <TableRow>
                                                <TableHead>Date & Time</TableHead>
                                                <TableHead>Product</TableHead>
                                                <TableHead className="text-center">Qty Added</TableHead>
                                                <TableHead className="text-right">Issued By</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {stockHistory.map((record: any) => (
                                                <TableRow key={record._id}>
                                                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                                                        {new Date(record.date).toLocaleString()}
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="font-medium">{record.stockName}</div>
                                                        <div className="text-xs text-muted-foreground font-mono">{record.productCode}</div>
                                                    </TableCell>
                                                    <TableCell className="text-center">
                                                        <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                                            +{record.quantity}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-right text-xs">
                                                        {record.userName}
                                                    </TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </Card>
                            )}
                        </div>
                    </div>
                )}
            </div>

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

    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    useEffect(() => {
        const savedSpecific = localStorage.getItem("pos_transfer_rows_per_page");
        if (savedSpecific) {
            setRowsPerPage(Number(savedSpecific));
        }
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setCurrentPage(1);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    const { results: stocks, status, loadMore, isLoading: isStocksLoading } = usePaginatedQuery(
        api.stocks.list,
        {
            searchTerm: debouncedSearch || undefined,
            halfPrice: isHp,
        },
        { initialNumItems: rowsPerPage }
    );

    useEffect(() => {
        if (status === "CanLoadMore" && stocks && stocks.length < rowsPerPage) {
            loadMore(rowsPerPage - stocks.length);
        }
    }, [rowsPerPage, stocks, status, loadMore]);

    const totalItems = useQuery(api.stocks.count, {
        halfPrice: isHp,
        searchTerm: debouncedSearch || undefined
    }) || 0;

    const shops = useQuery(api.shops.listAll);
    const batchTransfer = useMutation(api.shops.batchTransferStock);

    const totalPages = Math.ceil(totalItems / rowsPerPage);
    const startIndex = (currentPage - 1) * rowsPerPage;
    const endIndex = Math.min(startIndex + rowsPerPage, totalItems);

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
        if (!user || user.roles?.length === 0) {
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
            await batchTransfer({
                shopId: selectedShopId as Id<"shops">,
                userId: user._id,
                items: transferQueue.map(i => ({
                    stockId: i.stockId,
                    quantity: i.qty
                }))
            });
            toast.success(`Successfully transferred ${transferQueue.length} items`);
            setTransferQueue([]);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-10 lg:pb-0">
            <div className="lg:col-span-7 flex flex-col gap-4 h-[500px] lg:h-full overflow-hidden">
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

                    <div className="flex-1 border rounded-xl bg-card shadow-sm p-0 flex flex-col overflow-hidden">
                        {!stocks ? (
                            <div className="flex items-center justify-center flex-1 h-40"><Loader2 className="animate-spin" /></div>
                        ) : currentView.length === 0 ? (
                            <div className="text-center py-10 flex-1 text-muted-foreground flex flex-col items-center justify-center">
                                {status === "LoadingMore" || status === "LoadingFirstPage" ? (
                                    <div className="flex items-center gap-2"><Loader2 className="animate-spin h-4 w-4" /> Loading...</div>
                                ) : "No stocks found matching your criteria"}
                            </div>
                        ) : (
                            <div className="flex-1 overflow-x-auto">
                                <div className="min-w-[600px] lg:min-w-0">
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
                            </div>
                        )}

                        <div className="flex flex-col sm:flex-row items-center justify-between border-t bg-muted/20 px-4 py-4 gap-4 mt-auto">
                            <div className="flex items-center space-x-2">
                                <p className="text-xs font-medium">Rows</p>
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

                            <div className="flex items-center gap-4">
                                <div className="text-xs font-medium">
                                    {Math.min(startIndex + 1, totalItems)}-{Math.min(endIndex, totalItems)} of {totalItems}
                                </div>

                                <div className="flex items-center space-x-2">
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
                        </div>
                    </div>
                </Card>
            </div>

            <div className="lg:col-span-5 h-[650px] lg:h-full flex flex-col gap-4 overflow-hidden">
                <Card className="flex-1 flex flex-col overflow-hidden border-2 shadow-md h-full">
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
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 min-h-[300px]">
                                <Store className="h-12 w-12 mb-4 opacity-10" />
                                <p className="font-medium">Queue Empty</p>
                                <p className="text-xs text-center mt-1">Select items from the warehouse to begin transfer</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-10 shadow-sm">
                                        <TableRow>
                                            <TableHead className="w-[50%]">Item & Qty</TableHead>
                                            <TableHead className="w-[30%] text-center">Transfer</TableHead>
                                            <TableHead className="w-[20%]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {transferQueue.map(item => (
                                            <TableRow key={item.stockId} className="bg-background">
                                                <TableCell className="py-2">
                                                    <div className="font-medium text-[11px] line-clamp-1">{item.name}</div>
                                                    <div className="text-[10px] text-muted-foreground">{item.productCode}</div>
                                                </TableCell>
                                                <TableCell className="p-0">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQueueQty(item.stockId, -1)}>
                                                            <Minus className="h-3 w-3" />
                                                        </Button>
                                                        <span className="w-6 text-center text-xs font-bold bg-muted/50 rounded py-0.5">{item.qty}</span>
                                                        <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQueueQty(item.stockId, 1)}>
                                                            <Plus className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right pr-2">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => removeFromQueue(item.stockId)}>
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
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
