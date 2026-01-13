"use client";

import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { Id, Doc } from "../../../../convex/_generated/dataModel";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardFooter, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, Package, User, Loader2, ChevronLeft, ChevronRight, CalendarIcon, Store } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

import { ReceiptModal } from "@/components/ReceiptModal";
import { MySalesView } from "./my-sales-view";
// Types
type CartItem = {
    stockId: Id<"stocks">;
    name: string;
    productCode: string;
    price: number;
    qty: number;
    maxQty: number;
    pv: number;
    bv: number;
};

export default function SalesPage() {
    return (
        <div className="space-y-6 h-[calc(100vh-100px)] flex flex-col">
            <SalesHeader />
            <Tabs defaultValue="regular" className="flex-1 flex flex-col">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-4 lg:w-[600px] h-auto p-1 bg-muted/50 border shadow-sm">
                    <TabsTrigger value="regular" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Regular Sales</TabsTrigger>
                    <TabsTrigger value="hp" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">HP Sales</TabsTrigger>
                    <TabsTrigger value="packages" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">Packages</TabsTrigger>
                    <TabsTrigger value="mysales" className="py-2.5 font-bold uppercase text-[10px] tracking-widest">My Sales</TabsTrigger>
                </TabsList>

                <div className="flex-1 mt-4 overflow-hidden">
                    <TabsContent value="regular" className="h-full m-0">
                        <SalesInterface isHp={false} />
                    </TabsContent>
                    <TabsContent value="hp" className="h-full m-0">
                        <SalesInterface isHp={true} />
                    </TabsContent>
                    <TabsContent value="packages" className="h-full m-0">
                        <div className="flex flex-col items-center justify-center h-full text-muted-foreground bg-muted/10 rounded-lg border border-dashed border-muted p-12">
                            <Package className="h-16 w-16 mb-4 opacity-50" />
                            <h3 className="text-xl font-semibold">Package Sales Module</h3>
                            <p className="mt-2 text-center max-w-sm">This module is currently under development. Please check back later for package selling capabilities.</p>
                        </div>
                    </TabsContent>
                    <TabsContent value="mysales" className="h-full m-0">
                        <MySalesView />
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );
}

function SalesHeader() {
    const { user } = useAuth();
    const shopData = useQuery(api.stocks.getShopStock, { email: user?.email || undefined });
    const shopName = shopData?.shop?.name;
    const isShopUser = !!shopData?.shop;

    return (
        <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-black tracking-tight flex items-center gap-3">
                {isShopUser ? (
                    <>
                        <Store className="h-8 w-8 text-primary" />
                        {shopName} <span className="text-muted-foreground font-normal text-lg">| Sales Terminal</span>
                    </>
                ) : (
                    "Sales Terminal"
                )}
            </h1>
            <div className="text-muted-foreground text-sm">
                {isShopUser
                    ? `Managing sales for ${shopName}.`
                    : "No shop assigned. You cannot process sales."}
            </div>
        </div>
    );
}

function SalesInterface({ isHp }: { isHp: boolean }) {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [cart, setCart] = useState<CartItem[]>([]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    // Checkout State
    const [selectedCustomerId, setSelectedCustomerId] = useState<Id<"customers"> | "walk-in">("walk-in");
    const [clientType, setClientType] = useState(isHp ? "HP Client" : "Non-Member");
    const [paymentMethod, setPaymentMethod] = useState("Cash");
    const [isLoan, setIsLoan] = useState(false);
    const [manualName, setManualName] = useState("");
    const [paymentDate, setPaymentDate] = useState<string>("");
    const [isLoading, setIsLoading] = useState(false);
    const [receiptData, setReceiptData] = useState<any | null>(null);
    const [formErrors, setFormErrors] = useState<Record<string, boolean>>({});

    // Auto-select "Loan" payment method when isLoan is true
    useEffect(() => {
        if (isLoan) {
            setPaymentMethod("Loan");
        } else if (paymentMethod === "Loan") {
            setPaymentMethod("Cash");
        }
    }, [isLoan]);

    // Pagination State
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Data Fetching: Shop Stock ONLY
    // We pass user.email because the app uses custom auth, not Convex Auth
    const shopData = useQuery(api.stocks.getShopStock, {
        searchTerm: debouncedSearch || undefined,
        halfPrice: isHp,
        email: user?.email || undefined,
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
    });

    const isShopUser = !!shopData?.shop;
    const stocks = shopData?.stocks || [];
    const totalStocksCount = shopData?.totalCount || 0;
    const status = "Loaded";
    const isStocksLoading = shopData === undefined;

    const customers = useQuery(api.customers.listAll);
    const createSale = useMutation(api.sales.create);

    useEffect(() => {
        const saved = localStorage.getItem("pos_sales_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
        setCurrentPage(1); // Reset page on view change/init
    }, [isHp]);

    // Reset page on search
    useEffect(() => { setCurrentPage(1); }, [debouncedSearch]);

    const totalPages = Math.ceil(totalStocksCount / rowsPerPage);
    const paginatedStocks = stocks; // Already paginated on server

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalPV = cart.reduce((sum, item) => sum + (item.pv * item.qty), 0);
    const totalBV = cart.reduce((sum, item) => sum + (item.bv * item.qty), 0);

    // Cart Actions
    const addToCart = (stock: any) => { // Type loose for compatibility
        setCart(prev => {
            const existing = prev.find(i => i.stockId === stock._id || i.stockId === stock.stockId);
            const stockId = stock._id || stock.stockId; // Handle both stock doc and refined shop item

            if (existing) {
                if (existing.qty >= existing.maxQty) {
                    toast.error("Not enough stock available");
                    return prev;
                }
                return prev.map(i => i.stockId === stockId ? { ...i, qty: i.qty + 1 } : i);
            }
            return [...prev, {
                stockId: stockId,
                name: stock.name,
                productCode: stock.productCode,
                price: stock.price,
                qty: 1,
                maxQty: stock.qty,
                pv: stock.pv,
                bv: stock.bv
            }];
        });
        toast.success(`Added ${stock.name} to cart`);
    };

    const updateQty = (stockId: Id<"stocks">, delta: number) => {
        setCart(prev => {
            return prev.map(item => {
                if (item.stockId === stockId) {
                    const newQty = item.qty + delta;
                    if (newQty <= 0) return null;
                    if (newQty > item.maxQty) {
                        toast.error("Max stock reached");
                        return item;
                    }
                    return { ...item, qty: newQty };
                }
                return item;
            }).filter(Boolean) as CartItem[];
        });
    };

    const updatePrice = (stockId: Id<"stocks">, newPrice: string) => {
        const parsedPrice = parseInt(newPrice.replace(/,/g, ""));
        if (isNaN(parsedPrice) || parsedPrice < 0) return;

        setCart(prev => prev.map(item => {
            if (item.stockId === stockId) {
                return { ...item, price: parsedPrice };
            }
            return item;
        }));
    };

    const removeFromCart = (stockId: Id<"stocks">) => {
        setCart(prev => prev.filter(i => i.stockId !== stockId));
    };

    // Checkout Handler
    const handleCheckout = async () => {
        const newErrors: Record<string, boolean> = {};

        if (cart.length === 0) {
            toast.error("Please add items to your cart first.");
            return;
        }

        // Validate Business Rules
        if (clientType === "Member" && selectedCustomerId === "walk-in") {
            newErrors.customer = true;
            toast.error("Members must have a selected customer.");
        }

        if (isLoan) {
            if (selectedCustomerId === "walk-in") {
                newErrors.customer = true;
                toast.error("Loans require a selected customer.");
            }
            if (!paymentDate) {
                newErrors.paymentDate = true;
                toast.error("Please set a payment due date for the loan.");
            }
        }

        if (Object.keys(newErrors).length > 0) {
            setFormErrors(newErrors);
            return;
        }

        setFormErrors({});

        if (!user) {
            toast.error("You must be logged in to process sales.");
            return;
        }

        try {
            setIsLoading(true);
            const saleId = await createSale({
                userId: user._id,
                total: cartTotal,
                clientType,
                paymentMode: paymentMethod,
                manualCustomerName: ((clientType === "Non-Member" || clientType === "HP Client") && manualName) ? manualName : undefined,
                items: cart.map(item => ({
                    stockId: item.stockId,
                    name: item.name,
                    productCode: item.productCode,
                    price: item.price,
                    quantity: item.qty,
                    pv: item.pv,
                    bv: item.bv
                })),
                customerId: selectedCustomerId === "walk-in" ? undefined : selectedCustomerId,
                isLoan,
                paymentDueDate: isLoan ? paymentDate : undefined,
            });

            // Prepare Receipt Data
            const selectedCustomer = customers?.find(c => c._id === selectedCustomerId);
            const fullName = `${user.first_name} ${user.last_name}${user.middle_name ? ` ${user.middle_name}` : ""}`;

            const receipt = {
                customer: selectedCustomer ? {
                    name: selectedCustomer.name,
                    phone: selectedCustomer.phone,
                    email: selectedCustomer.email,
                    distributorId: selectedCustomer.distributorId
                } : (manualName ? { name: manualName, phone: "N/A", email: "" } : undefined),
                shop: {
                    name: isShopUser ? shopData.shop.name : "Main Warehouse",
                    location: isShopUser ? shopData.shop.location : "Headquarters",
                    contact: isShopUser ? shopData.shop.contact : "N/A",
                    serialNumber: isShopUser ? shopData.shop.serialNumber : "MAIN-001"
                },
                operator: {
                    name: fullName,
                    email: user?.email,
                    phone: user?.phone_number
                },
                clientType,
                paymentMode: paymentMethod,
                date: new Date().toISOString(),
                paymentDueDate: isLoan ? paymentDate : undefined,
                invoiceNumber: `INV-${Date.now()}`,
                items: cart.map(item => ({
                    ...item,
                    price: item.price
                })),
                total: cartTotal,
                totalPV: totalPV,
                totalBV: totalBV,
            };

            setReceiptData(receipt);
            setCart([]);
            setPaymentDate("");
            setManualName("");
            setPaymentMethod("Cash");
            setIsLoan(false);
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-10 lg:pb-0">
            {/* Left Col: Product Selection (Table View) */}
            <div className="lg:col-span-7 flex flex-col gap-4 h-[500px] lg:h-full overflow-hidden">
                <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search products..."
                        className="pl-9 h-12 text-lg"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        autoFocus
                    />
                </div>

                <div className="flex-1 overflow-auto border rounded-xl bg-card shadow-sm p-4 flex flex-col">
                    {isStocksLoading ? (
                        <div className="flex items-center justify-center h-40"><Loader2 className="animate-spin" /></div>
                    ) : stocks.length === 0 ? (
                        <div className="text-center py-10 text-muted-foreground">No products found</div>
                    ) : (
                        <div className="flex-1 overflow-x-auto flex flex-col h-full">
                            <div className="min-w-[800px] lg:min-w-0 flex-1">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-10">
                                        <TableRow>
                                            <TableHead className="w-[100px]">Code</TableHead>
                                            <TableHead>Product Name</TableHead>
                                            <TableHead className="text-right">Price</TableHead>
                                            <TableHead className="text-right">PV / BV</TableHead>
                                            <TableHead className="text-center">Stock</TableHead>
                                            <TableHead></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {paginatedStocks.map((stock: any) => (
                                            <TableRow key={stock._id || stock.stockId} className={stock.qty === 0 ? "opacity-50" : ""}>
                                                <TableCell className="font-mono text-xs">{stock.productCode}</TableCell>
                                                <TableCell className="font-medium">
                                                    {stock.name}
                                                    {isShopUser && <Badge variant="secondary" className="ml-2 text-[10px] h-4">Shop Stock</Badge>}
                                                </TableCell>
                                                <TableCell className="text-right">{stock.price.toLocaleString()}</TableCell>
                                                <TableCell className="text-right text-xs text-muted-foreground">
                                                    {stock.pv} / {stock.bv}
                                                </TableCell>
                                                <TableCell className="text-center">
                                                    {stock.qty > 0 ? (
                                                        <Badge variant="outline" className="bg-green-50 text-green-700 hover:bg-green-100 border-green-200">
                                                            {stock.qty}
                                                        </Badge>
                                                    ) : (
                                                        <Badge variant="destructive">Out</Badge>
                                                    )}
                                                </TableCell>
                                                <TableCell>
                                                    <Button
                                                        size="sm"
                                                        variant="secondary"
                                                        disabled={stock.qty === 0}
                                                        onClick={() => addToCart(stock)}
                                                    >
                                                        Add
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            {/* Pagination Footer */}
                            <div className="flex flex-col sm:flex-row items-center justify-between border-t bg-muted/20 px-4 py-4 gap-4 mt-auto">
                                <div className="flex items-center space-x-2">
                                    <p className="text-xs font-medium">Rows</p>
                                    <Select
                                        value={`${rowsPerPage}`}
                                        onValueChange={(value) => {
                                            const newSize = Number(value);
                                            setRowsPerPage(newSize);
                                            localStorage.setItem("pos_sales_rows_per_page", String(newSize));
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
                                        {Math.min((currentPage - 1) * rowsPerPage + 1, totalStocksCount)}-{Math.min(currentPage * rowsPerPage, totalStocksCount)} of {totalStocksCount}
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
                                            onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                            disabled={currentPage >= totalPages || totalPages === 0}
                                        >
                                            <ChevronRight className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Right Col: Cart & Checkout */}
            <div className="lg:col-span-5 h-[650px] lg:h-full flex flex-col gap-4 overflow-hidden">
                <Card className="flex-1 flex flex-col overflow-hidden border-2 shadow-md">
                    <CardHeader className="bg-muted/30 pb-4">
                        <CardTitle className="flex items-center gap-2">
                            <ShoppingCart className="h-5 w-5" /> Current Order
                        </CardTitle>
                    </CardHeader>

                    <CardContent className="flex-1 overflow-y-auto p-0">
                        {cart.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
                                <ShoppingCart className="h-12 w-12 mb-4 opacity-20" />
                                <p>Cart is empty</p>
                                <p className="text-xs">Select items from the left to start a sale</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader className="sticky top-0 bg-background z-10">
                                        <TableRow>
                                            <TableHead className="w-[45%]">Item & Price Override</TableHead>
                                            <TableHead className="w-[20%] text-center">Qty</TableHead>
                                            <TableHead className="text-right">Total</TableHead>
                                            <TableHead className="w-[10%]"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {cart.map(item => (
                                            <TableRow key={item.stockId}>
                                                <TableCell className="py-2">
                                                    <div className="font-medium text-[11px] lg:text-sm line-clamp-1 mb-1">{item.name}</div>
                                                    <Input
                                                        className="h-7 w-20 lg:w-24 text-[10px] lg:text-xs"
                                                        value={item.price}
                                                        type="number"
                                                        onChange={(e) => updatePrice(item.stockId, e.target.value)}
                                                    />
                                                </TableCell>
                                                <TableCell className="p-0">
                                                    <div className="flex items-center justify-center gap-1">
                                                        <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(item.stockId, -1)}>
                                                            <Minus className="h-3 w-3" />
                                                        </Button>
                                                        <span className="w-5 text-center text-xs font-medium">{item.qty}</span>
                                                        <Button variant="outline" size="icon" className="h-6 w-6" onClick={() => updateQty(item.stockId, 1)}>
                                                            <Plus className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-right font-medium text-[11px]">
                                                    {(item.price * item.qty).toLocaleString()}
                                                </TableCell>
                                                <TableCell className="p-2 text-right">
                                                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive/90" onClick={() => removeFromCart(item.stockId)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>

                    <div className="bg-muted/50 p-6 space-y-4 border-t">
                        <div className="space-y-1">
                            <div className="flex justify-between text-sm">
                                <span className="text-muted-foreground">Total PV / BV</span>
                                <span className="font-mono">{totalPV} / {totalBV}</span>
                            </div>
                            <div className="flex justify-between items-baseline border-t pt-2 mt-2">
                                <span className="text-lg font-semibold">Total Amount</span>
                                <span className="text-2xl font-bold text-primary">UGX {cartTotal.toLocaleString()}</span>
                            </div>
                        </div>

                        {/* Checkout Controls */}
                        <div className="grid gap-3 pt-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Client Type</Label>
                                    <Select value={clientType} onValueChange={setClientType}>
                                        <SelectTrigger className="h-8">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Non-Member">Non-Member</SelectItem>
                                            <SelectItem value="Member">Member</SelectItem>
                                            <SelectItem value="HP Client">HP Client</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Customer</Label>
                                    <Select
                                        value={selectedCustomerId}
                                        onValueChange={(v) => {
                                            setSelectedCustomerId(v as any);
                                            setFormErrors(prev => ({ ...prev, customer: false }));
                                        }}
                                    >
                                        <SelectTrigger className={`h-8 ${formErrors.customer ? "border-destructive ring-1 ring-destructive" : ""}`}>
                                            <SelectValue placeholder="Walk-in Client" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="walk-in">
                                                <span className="flex items-center text-muted-foreground"><User className="mr-2 h-3 w-3" /> Walk-in Client</span>
                                            </SelectItem>
                                            {customers?.map(c => (
                                                <SelectItem key={c._id} value={c._id}>{c.name}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>

                            {/* Payment Logic */}
                            <div className="space-y-3 pt-2 border-t mt-2">
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Payment Method</Label>
                                        <Select
                                            value={paymentMethod}
                                            onValueChange={(v) => {
                                                setPaymentMethod(v);
                                                if (v === "Loan") setIsLoan(true);
                                                else if (isLoan) setIsLoan(false);
                                            }}
                                        >
                                            <SelectTrigger className="h-9">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="None">None</SelectItem>
                                                <SelectItem value="Cash">Cash</SelectItem>
                                                <SelectItem value="Mobile Money">Mobile Money</SelectItem>
                                                <SelectItem value="Bank Transfer">Bank Transfer</SelectItem>
                                                <SelectItem value="Loan">Loan</SelectItem>
                                            </SelectContent>
                                        </Select>
                                    </div>

                                    <div className="flex items-center justify-between bg-background p-2 px-3 rounded-lg border h-9 mt-6">
                                        <Label htmlFor="loan-toggle" className="text-xs font-medium cursor-pointer">Loan Sale?</Label>
                                        <Switch
                                            id="loan-toggle"
                                            checked={isLoan}
                                            onCheckedChange={(val) => {
                                                setIsLoan(val);
                                                if (!val && paymentMethod === "Loan") setPaymentMethod("Cash");
                                                if (val) setPaymentMethod("Loan");
                                                setFormErrors(prev => ({ ...prev, paymentDate: false }));
                                            }}
                                        />
                                    </div>
                                </div>

                                {(clientType === "HP Client" || (clientType === "Non-Member" && selectedCustomerId === "walk-in")) && (
                                    <div className="space-y-1 animate-in fade-in slide-in-from-top-1">
                                        <Label className="text-xs">Customer/Walk-in Name (Optional)</Label>
                                        <Input
                                            placeholder="Type customer name..."
                                            className="h-8 shadow-sm border-primary/20"
                                            value={manualName}
                                            onChange={(e) => setManualName(e.target.value)}
                                        />
                                    </div>
                                )}

                                {isLoan && (
                                    <div className={`space-y-1 animate-in fade-in slide-in-from-top-2 p-2 rounded-md border ${formErrors.paymentDate ? "bg-destructive/5 border-destructive" : "bg-orange-50 border-orange-100"}`}>
                                        <Label className={`text-xs font-medium flex items-center gap-2 ${formErrors.paymentDate ? "text-destructive" : "text-orange-700"}`}>
                                            <CalendarIcon className="h-3 w-3" />
                                            Payment Due Date
                                        </Label>
                                        <Input
                                            type="date"
                                            value={paymentDate}
                                            onChange={(e) => {
                                                setPaymentDate(e.target.value);
                                                setFormErrors(prev => ({ ...prev, paymentDate: false }));
                                            }}
                                            className={`h-8 bg-white focus-visible:ring-orange-500 ${formErrors.paymentDate ? "border-destructive" : "border-orange-200"}`}
                                            min={new Date().toISOString().split("T")[0]}
                                        />
                                    </div>
                                )}
                            </div>

                            <Button
                                size="lg"
                                className={`w-full font-bold text-lg ${isLoan ? "bg-orange-600 hover:bg-orange-700" : "bg-green-600 hover:bg-green-700"}`}
                                disabled={cart.length === 0 || !user}
                                onClick={handleCheckout}
                            >
                                {isLoading || !user ? <Loader2 className="animate-spin mr-2" /> : isLoan ? <CreditCard className="mr-2 h-5 w-5" /> : <Banknote className="mr-2 h-5 w-5" />}
                                {isLoan ? "Record Loan Sale" : "Complete Sale"}
                            </Button>
                        </div>
                    </div>
                </Card>
            </div>

            {/* Receipt Modal */}
            <ReceiptModal
                isOpen={!!receiptData}
                onClose={() => setReceiptData(null)}
                data={receiptData}
            />
        </div>
    );
}
