"use client";

import React, { useState, useMemo, useEffect } from "react";
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
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, Package, User, Loader2, ChevronLeft, ChevronRight, CalendarIcon, Store, Check, ChevronsUpDown, Download } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";

import { ReceiptModal } from "@/components/ReceiptModal";
import { MySalesView } from "./my-sales-view";
import { LoansView } from "./loans-view";
// import { ActivityLogView } from "../reports/components/ActivityLogView";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn, formatError } from "@/lib/utils";
import { generateRestockPDF } from "@/lib/restock-pdf";
import { PromotionsReportView } from "./promotions-report-view";
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
                <TabsList className="grid w-full grid-cols-2 md:grid-cols-4 lg:grid-cols-7 h-auto p-1 bg-linear-to-b from-muted/50 to-muted/80 border shadow-sm rounded-xl">
                    <TabsTrigger value="regular" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">Regular Sales</TabsTrigger>
                    <TabsTrigger value="hp" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">HP Sales</TabsTrigger>
                    <TabsTrigger value="swap" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all text-blue-600">Product Swap</TabsTrigger>
                    <TabsTrigger value="promotions" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">Promotions</TabsTrigger>
                    <TabsTrigger value="restock" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all text-destructive">Restock</TabsTrigger>
                    <TabsTrigger value="mysales" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all">My Sales</TabsTrigger>
                    <TabsTrigger value="loans" className="py-2.5 font-bold uppercase text-[10px] tracking-widest rounded-lg data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all text-orange-600">Loans</TabsTrigger>
                </TabsList>

                <div className="flex-1 mt-4 overflow-hidden">
                    <TabsContent value="regular" className="h-full m-0">
                        <SalesInterface isHp={false} />
                    </TabsContent>
                    <TabsContent value="hp" className="h-full m-0">
                        <SalesInterface isHp={true} />
                    </TabsContent>
                    <TabsContent value="swap" className="h-full m-0">
                        <SwapView />
                    </TabsContent>
                    <TabsContent value="loans" className="h-full m-0">
                        <LoansView />
                    </TabsContent>
                    <TabsContent value="restock" className="h-full m-0">
                        <RestockView />
                    </TabsContent>
                    <TabsContent value="promotions" className="h-full m-0">
                        <PromotionsReportView />
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
    const [initialDeposit, setInitialDeposit] = useState<string>("");
    const [deliveryStatus, setDeliveryStatus] = useState<"Taken" | "Pending">("Taken");
    const [customerPhone, setCustomerPhone] = useState("");
    const [customerLocation, setCustomerLocation] = useState("");
    const [isPackageSale, setIsPackageSale] = useState(false);
    const [packageType, setPackageType] = useState<"Bronze" | "Silver" | "Gold">("Bronze");
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
    const [isLoaded, setIsLoaded] = useState(false);

    // Data Fetching: Shop Stock ONLY
    // We pass user.email because the app uses custom auth, not Convex Auth
    const shopData = useQuery(api.stocks.getShopStock, {
        searchTerm: debouncedSearch || undefined,
        halfPrice: isHp,
        availability: "all",
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
    const activePromotions = useQuery(api.promotions.getActivePromotionsWithProducts);

    useEffect(() => {
        const saved = localStorage.getItem("pos_sales_rows_per_page");
        if (saved) setRowsPerPage(Number(saved));
        setCurrentPage(1); // Reset page on view change/init
    }, [isHp]);

    // Reset page on search or availability change
    useEffect(() => { setCurrentPage(1); }, [debouncedSearch]);

    // Cart Local Storage Persistence
    useEffect(() => {
        const key = isHp ? "pos_cart_hp" : "pos_cart_regular";
        const savedCart = localStorage.getItem(key);
        if (savedCart) {
            try {
                setCart(JSON.parse(savedCart));
            } catch (e) {
                console.error("Failed to parse saved cart", e);
            }
        }
        setIsLoaded(true);
    }, [isHp]);

    useEffect(() => {
        if (!isLoaded) return;
        const key = isHp ? "pos_cart_hp" : "pos_cart_regular";
        if (cart.length > 0) {
            localStorage.setItem(key, JSON.stringify(cart));
        } else {
            localStorage.removeItem(key);
        }
    }, [cart, isHp, isLoaded]);

    const totalPages = Math.ceil(totalStocksCount / rowsPerPage);
    const paginatedStocks = stocks; // Already paginated on server

    const cartTotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalPV = cart.reduce((sum, item) => sum + (item.pv * item.qty), 0);
    const totalBV = cart.reduce((sum, item) => sum + (item.bv * item.qty), 0);

    // Cart Actions
    const addToCart = (stock: any) => {
        setCart(prev => {
            const existing = prev.find(i => i.stockId === stock._id || i.stockId === stock.stockId);
            const stockId = stock._id || stock.stockId;

            if (existing) {
                // [CHANGED] Removed stock limit check to allow negative stock selling
                // if (existing.qty >= existing.maxQty) {
                //     toast.error("Not enough stock available");
                //     return prev;
                // }
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
    };

    const updateQty = (stockId: Id<"stocks">, delta: number) => {
        setCart(prev => {
            return prev.map(item => {
                if (item.stockId === stockId) {
                    const newQty = item.qty + delta;
                    if (newQty <= 0) return null;
                    // [CHANGED] Removed maxQty check to allow negative stock selling
                    // if (newQty > item.maxQty) {
                    //     toast.error("Max stock reached");
                    //     return item;
                    // }
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
            // RELAXED: Loans CAN be for walk-ins, but must have a manual name
            if (selectedCustomerId === "walk-in" && !manualName) {
                newErrors.customer = true;
                toast.error("Walk-in loans require a customer Name.");
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

        const depositValue = initialDeposit ? parseInt(initialDeposit.replace(/,/g, "")) : 0;

        try {
            setIsLoading(true);
            const result = await createSale({
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
                initialDeposit: isLoan ? depositValue : undefined, // Pass deposit
                packageType: isPackageSale ? packageType : undefined,
                deliveryStatus,
                customerPhone: customerPhone || undefined,
                customerLocation: customerLocation || undefined,
                transactionType: "Sale",
            });

            // Handle both legacy (string ID) and new (object) return types for safety
            // const saleId = typeof result === "object" ? result.saleId : result;
            const promotions = typeof result === "object" ? result.redemptions : [];

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
                invoiceNumber: (result as any).invoiceNumber || `INV-${Date.now()}`,
                items: cart.map(item => ({
                    ...item,
                    price: item.price
                })),
                total: cartTotal,
                totalPV: totalPV,
                totalBV: totalBV,
                initialDeposit: isLoan ? depositValue : undefined,
                balance: isLoan ? (cartTotal - depositValue) : undefined,
                promotions,
                packageType: isPackageSale ? packageType : undefined,
                deliveryStatus,
                customerPhone: customerPhone || selectedCustomer?.phone,
                customerLocation: customerLocation,
                transactionType: "Sale",
            };

            setReceiptData(receipt);
            toast.success("Sale completed successfully!");

            // Clear Cart and Local Storage
            setCart([]);
            const key = isHp ? "pos_cart_hp" : "pos_cart_regular";
            localStorage.removeItem(key);
            setManualName("");
            setPaymentDate("");
            setInitialDeposit("");
            setIsLoan(false);

        } catch (error) {
            console.error(error);
            toast.error(formatError(error));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-10 lg:pb-0">
                {/* Left Col: Product Selection (Table View) */}
                <div className="lg:col-span-7 flex flex-col gap-4 h-[500px] lg:h-full overflow-hidden">
                    <div className="relative">
                        <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by code or name..."
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
                                            {paginatedStocks.map((stock: any) => {
                                                const cartItem = cart.find(i => i.stockId === (stock._id || stock.stockId));
                                                const virtualQty = stock.qty - (cartItem?.qty || 0);
                                                const promoData = activePromotions?.productPromotions?.[(stock._id || stock.stockId)];

                                                return (
                                                    <TableRow key={stock._id || stock.stockId} className={virtualQty === 0 ? "opacity-50" : ""}>
                                                        <TableCell className="font-mono text-xs">{stock.productCode}</TableCell>
                                                        <TableCell className="font-medium">
                                                            <div className="flex flex-col">
                                                                <span>{stock.name}</span>
                                                                {/* PROMO BADGE */}
                                                                {(!isHp && promoData) && (
                                                                    <Badge variant="secondary" className="w-fit mt-1 bg-purple-100 text-purple-700 hover:bg-purple-200 border-purple-200 text-[10px] px-1 py-0 h-5">
                                                                        PROMO: {promoData.promotionName}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-mono">{stock.price.toLocaleString()}</TableCell>
                                                        <TableCell className="text-right text-xs text-muted-foreground">
                                                            {stock.pv} / {stock.bv}
                                                        </TableCell>
                                                        <TableCell className="text-center">
                                                            <div className="flex flex-col items-center">
                                                                <span className={cn("font-bold px-2 py-0.5 rounded-full", virtualQty === 0 ? "bg-destructive/10 text-destructive" : "bg-green-50 text-green-700")}>
                                                                    {virtualQty}
                                                                </span>
                                                                {cartItem && (
                                                                    <span className="text-[10px] font-medium text-primary mt-1">
                                                                        {cartItem.qty} in cart
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right">
                                                            <Button
                                                                size="sm"
                                                                className="h-8 rounded-lg font-bold transition-transform active:scale-95"
                                                                variant={virtualQty > 0 ? "secondary" : "destructive"}
                                                                onClick={() => addToCart(stock)}
                                                            >
                                                                {virtualQty > 0 ? "Add" : "Sell Negative"}
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>
                                                );
                                            })}
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

                        {/* GLOBAL PROMOTION BANNER */}
                        {(!isHp && activePromotions?.globalPromotions) && (
                            <div className="px-4 pt-2 space-y-2">
                                {activePromotions.globalPromotions.map((p: any) => {
                                    const isQualified = (p.triggerType === "TotalPV" && totalPV >= p.threshold) ||
                                        (p.triggerType === "TotalBV" && totalBV >= p.threshold);
                                    if (!isQualified) return null;
                                    return (
                                        <div key={p._id} className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white px-3 py-2 rounded-lg shadow-sm flex items-center justify-between animate-in slide-in-from-top-2">
                                            <div className="flex items-center gap-2">
                                                <div className="bg-white/20 p-1.5 rounded-full"><Package className="h-4 w-4" /></div>
                                                <div className="flex flex-col">
                                                    <span className="text-xs font-bold uppercase tracking-wider">Promotion Unlocked!</span>
                                                    <span className="text-sm font-medium leading-none">{p.name}: {p.prize}</span>
                                                </div>
                                            </div>
                                            <div className="bg-white/20 px-2 py-0.5 rounded text-[10px] font-mono font-bold">
                                                {p.triggerType === "TotalPV" ? `${totalPV} PV` : `${totalBV} BV`} / {p.threshold}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}

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
                                                <React.Fragment key={item.stockId}>
                                                    <TableRow className="border-b last:border-0 relative">
                                                        <TableCell className="py-2 w-[45%]">
                                                            <div className="font-medium text-[11px] lg:text-sm line-clamp-1 mb-1">{item.name}</div>
                                                            <Input
                                                                className="h-7 w-20 lg:w-24 text-[10px] lg:text-xs"
                                                                value={item.price}
                                                                type="number"
                                                                onChange={(e) => updatePrice(item.stockId, e.target.value)}
                                                            />
                                                        </TableCell>
                                                        <TableCell className="p-0 w-[20%]">
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
                                                        <TableCell className="text-right font-medium text-[11px] flex-1">
                                                            {(item.price * item.qty).toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="p-2 text-right w-[10%]">
                                                            <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive/90" onClick={() => removeFromCart(item.stockId)}>
                                                                <Trash2 className="h-4 w-4" />
                                                            </Button>
                                                        </TableCell>
                                                    </TableRow>

                                                    {/* PROMOTION TRIGGER FEEDBACK */}
                                                    {(() => {
                                                        const promoData = activePromotions?.productPromotions?.[item.stockId];
                                                        if (isHp || !promoData) return null;

                                                        return (
                                                            <TableRow className="border-none">
                                                                <TableCell colSpan={4} className="p-0">
                                                                    <div className="w-full px-2 pb-2">
                                                                        {item.qty >= promoData.requiredQty ? (
                                                                            <div className="text-[10px] text-green-600 font-bold bg-green-50 p-1 rounded-sm border border-green-200 flex items-center gap-1 animate-in fade-in slide-in-from-top-1">
                                                                                🎉 Promotion Triggered: {Math.floor(item.qty / promoData.requiredQty)}x {promoData.prize}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="text-[10px] text-purple-600 bg-purple-50 p-1 rounded-sm border border-purple-100">
                                                                                Add {promoData.requiredQty - (item.qty % promoData.requiredQty)} more for {promoData.prize}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                </TableCell>
                                                            </TableRow>
                                                        );
                                                    })()}
                                                </React.Fragment>
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
                                        <DistributorSearch
                                            customers={customers || []}
                                            selectedId={selectedCustomerId}
                                            onSelect={(id) => {
                                                setSelectedCustomerId(id as any);
                                                setFormErrors(prev => ({ ...prev, customer: false }));
                                            }}
                                            error={formErrors.customer}
                                        />
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
                                                    <SelectItem value="Bonus Transfer">Bonus Transfer</SelectItem>
                                                    <SelectItem value="Loan">Loan</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>

                                        <div className="space-y-1">
                                            <Label className="text-xs">Delivery Status</Label>
                                            <Select
                                                value={deliveryStatus}
                                                onValueChange={(v) => setDeliveryStatus(v as "Taken" | "Pending")}
                                            >
                                                <SelectTrigger className="h-9">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Taken">Fully Delivered</SelectItem>
                                                    <SelectItem value="Pending">Paid But Not Taken</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
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

                                    <div className="flex items-center justify-between bg-indigo-50/50 p-2 px-3 rounded-lg border border-indigo-100 h-9">
                                        <Label htmlFor="package-toggle" className="text-[10px] font-black uppercase text-indigo-700 cursor-pointer flex items-center gap-2">
                                            <Package className="h-3.5 w-3.5" />
                                            Package Sale?
                                        </Label>
                                        <Switch
                                            id="package-toggle"
                                            checked={isPackageSale}
                                            onCheckedChange={setIsPackageSale}
                                        />
                                    </div>

                                    {isPackageSale && (
                                        <div className="space-y-1 p-3 bg-indigo-50 border border-indigo-100 rounded-lg animate-in fade-in slide-in-from-top-1">
                                            <Label className="text-xs font-bold text-indigo-700">
                                                Select Package Type
                                            </Label>
                                            <Select
                                                value={packageType}
                                                onValueChange={(v) => setPackageType(v as "Bronze" | "Silver" | "Gold")}
                                            >
                                                <SelectTrigger className="h-9 bg-white border-indigo-200">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="Bronze">Bronze Package</SelectItem>
                                                    <SelectItem value="Silver">Silver Package</SelectItem>
                                                    <SelectItem value="Gold">Gold Package</SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {(clientType === "HP Client" || (clientType === "Non-Member" && selectedCustomerId === "walk-in") || (isLoan && selectedCustomerId === "walk-in")) && (
                                <div className="space-y-3 animate-in fade-in slide-in-from-top-1">
                                    <div className="space-y-1">
                                        <Label className="text-xs">Customer/Walk-in Name (Optional)</Label>
                                        <Input
                                            placeholder="Type customer name..."
                                            className="h-8 shadow-sm border-primary/20"
                                            value={manualName}
                                            onChange={(e) => setManualName(e.target.value)}
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div className="space-y-1">
                                            <Label className="text-xs">Customer Phone</Label>
                                            <Input
                                                placeholder="Phone number..."
                                                className="h-8 shadow-sm border-primary/20"
                                                value={customerPhone}
                                                onChange={(e) => setCustomerPhone(e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label className="text-xs">Customer Location</Label>
                                            <Input
                                                placeholder="Current location..."
                                                className="h-8 shadow-sm border-primary/20"
                                                value={customerLocation}
                                                onChange={(e) => setCustomerLocation(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {isLoan && (
                                <div className="grid grid-cols-2 gap-3 animate-in fade-in slide-in-from-top-2">
                                    <div className={`space-y-1 p-2 rounded-md border ${formErrors.paymentDate ? "bg-destructive/5 border-destructive" : "bg-orange-50 border-orange-100"}`}>
                                        <Label className={`text-xs font-medium flex items-center gap-2 ${formErrors.paymentDate ? "text-destructive" : "text-orange-700"}`}>
                                            <CalendarIcon className="h-3 w-3" />
                                            Due Date
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

                                    <div className="space-y-1 p-2 rounded-md border bg-blue-50 border-blue-100">
                                        <Label className="text-xs font-medium flex items-center gap-2 text-blue-700">
                                            <Banknote className="h-3 w-3" />
                                            Initial Deposit
                                        </Label>
                                        <Input
                                            placeholder="Amount"
                                            value={initialDeposit}
                                            onChange={(e) => setInitialDeposit(e.target.value)}
                                            className="h-8 bg-white border-blue-200 focus-visible:ring-blue-500"
                                        />
                                    </div>
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
                    </Card>
                </div>
            </div>

            {/* Receipt Modal */}
            <ReceiptModal
                isOpen={!!receiptData}
                onClose={() => setReceiptData(null)}
                data={receiptData}
            />
        </>
    );
}

function RestockView() {
    const { user } = useAuth();
    const [hpFilter, setHpFilter] = useState<"regular" | "hp">("regular");
    const [currentPage, setCurrentPage] = useState(1);
    const rowsPerPage = 10;

    const restockData = useQuery(api.stocks.getShopStock, {
        halfPrice: hpFilter === "hp",
        availability: "outOfStock",
        email: user?.email || undefined,
        limit: rowsPerPage,
        offset: (currentPage - 1) * rowsPerPage,
    });

    const items = restockData?.stocks || [];
    const totalCount = restockData?.totalCount || 0;
    const totalPages = Math.ceil(totalCount / rowsPerPage);

    return (
        <div className="flex flex-col gap-6 h-full">
            <div className="flex items-center justify-between">
                <Tabs value={hpFilter} onValueChange={(v) => { setHpFilter(v as any); setCurrentPage(1); }} className="w-[300px]">
                    <TabsList className="grid w-full grid-cols-2 rounded-lg border shadow-sm">
                        <TabsTrigger value="regular" className="text-xs uppercase tracking-wider font-bold">Regular Stock</TabsTrigger>
                        <TabsTrigger value="hp" className="text-xs uppercase tracking-wider font-bold text-primary">HP Stock</TabsTrigger>
                    </TabsList>
                </Tabs>

                <div className="flex items-center gap-3">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9 gap-2 font-bold border-primary/20 hover:bg-primary/5 text-primary"
                        disabled={items.length === 0}
                        onClick={() => {
                            if (restockData?.shop && user) {
                                generateRestockPDF(
                                    items.map(i => ({
                                        productCode: i.productCode || "N/A",
                                        name: i.name,
                                        price: i.price,
                                        qty: i.qty
                                    })),
                                    {
                                        name: restockData.shop.name,
                                        location: restockData.shop.location,
                                        contact: restockData.shop.contact,
                                        serialNumber: restockData.shop.serialNumber
                                    },
                                    {
                                        name: `${user.first_name} ${user.last_name}`,
                                        email: user.email
                                    },
                                    hpFilter === "hp"
                                );
                                toast.success("PDF generated successfully!");
                            }
                        }}
                    >
                        <Download className="h-4 w-4" />
                        Download PDF
                    </Button>

                    <div className="flex items-center gap-2 px-3 py-1.5 bg-destructive/10 text-destructive rounded-lg border border-destructive/20 animate-pulse">
                        <Package className="h-4 w-4" />
                        <span className="text-xs font-bold uppercase tracking-tighter">Items Needing Restock</span>
                        <Badge variant="destructive" className="h-5 min-w-[20px] px-1 flex justify-center">{totalCount}</Badge>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-hidden border rounded-xl bg-card shadow-sm flex flex-col">
                <Table>
                    <TableHeader className="bg-muted/50">
                        <TableRow>
                            <TableHead className="font-bold">Product Code</TableHead>
                            <TableHead className="font-bold">Product Name</TableHead>
                            <TableHead className="text-right font-bold">Price</TableHead>
                            <TableHead className="text-center font-bold">Current Qty</TableHead>
                            <TableHead className="text-right font-bold">Status</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {restockData === undefined ? (
                            Array.from({ length: 5 }).map((_, i) => (
                                <TableRow key={i}>
                                    <TableCell colSpan={5} className="h-12 animate-pulse bg-muted/20" />
                                </TableRow>
                            ))
                        ) : items.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="h-40 text-center text-muted-foreground">
                                    <div className="flex flex-col items-center gap-2 opacity-50">
                                        <Check className="h-8 w-8 text-green-500" />
                                        <p className="font-medium">All products are currently in stock!</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            items.map((item) => (
                                <TableRow key={item.stockId} className="hover:bg-muted/30 transition-colors">
                                    <TableCell className="font-mono text-xs">{item.productCode}</TableCell>
                                    <TableCell className="font-medium">{item.name}</TableCell>
                                    <TableCell className="text-right">{item.price.toLocaleString()}</TableCell>
                                    <TableCell className="text-center">
                                        <Badge variant="outline" className="bg-destructive/5 text-destructive border-destructive/20 font-bold">
                                            {item.qty}
                                        </Badge>
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Badge variant="destructive" className="uppercase text-[10px] tracking-tighter font-black shadow-sm">OUT OF STOCK</Badge>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>

                <div className="mt-auto border-t bg-muted/20 px-4 py-3 flex items-center justify-between">
                    <p className="text-xs text-muted-foreground font-medium">
                        Showing {items.length} out of {totalCount} items
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                            className="h-8 text-[10px] uppercase font-bold"
                        >
                            Previous
                        </Button>
                        <span className="text-xs font-bold px-2">Page {currentPage} of {totalPages || 1}</span>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                            disabled={currentPage >= totalPages || totalPages === 0}
                            className="h-8 text-[10px] uppercase font-bold"
                        >
                            Next
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

interface DistributorSearchProps {
    selectedId: Id<"customers"> | "walk-in";
    onSelect: (id: Id<"customers"> | "walk-in") => void;
    customers: Doc<"customers">[];
    error?: boolean;
}

function DistributorSearch({ selectedId, onSelect, customers, error }: DistributorSearchProps) {
    const [open, setOpen] = useState(false);
    const selectedCustomer = customers.find(c => c._id === selectedId);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className={cn(
                        "w-full justify-between h-9 shadow-sm transition-colors bg-white/50 backdrop-blur-sm px-3",
                        error ? "border-destructive ring-1 ring-destructive/20" : "border-primary/20 hover:border-primary/40"
                    )}
                >
                    <span className="truncate">
                        {selectedId === "walk-in" ? (
                            <span className="flex items-center text-muted-foreground">
                                <User className="mr-2 h-3 w-3" /> Walk-in Client
                            </span>
                        ) : selectedCustomer?.name}
                    </span>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[300px] p-0" align="start">
                <Command>
                    <CommandInput placeholder="Search name or ID..." />
                    <CommandList>
                        <CommandEmpty>No customer found.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem
                                value="walk-in"
                                onSelect={() => {
                                    onSelect("walk-in");
                                    setOpen(false);
                                }}
                            >
                                <Check
                                    className={cn(
                                        "mr-2 h-4 w-4",
                                        selectedId === "walk-in" ? "opacity-100" : "opacity-0"
                                    )}
                                />
                                <User className="mr-2 h-3 w-3 text-muted-foreground" />
                                Walk-in Client
                            </CommandItem>
                            {customers.map((customer) => (
                                <CommandItem
                                    key={customer._id}
                                    value={`${customer.name} ${customer.distributorId || ""}`}
                                    onSelect={() => {
                                        onSelect(customer._id);
                                        setOpen(false);
                                    }}
                                >
                                    <Check
                                        className={cn(
                                            "mr-2 h-4 w-4",
                                            selectedId === customer._id ? "opacity-100" : "opacity-0"
                                        )}
                                    />
                                    <div className="flex flex-col">
                                        <span>{customer.name}</span>
                                        {customer.distributorId && (
                                            <span className="text-[10px] text-muted-foreground">
                                                ID: {customer.distributorId}
                                            </span>
                                        )}
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}

function SwapView() {
    const { user } = useAuth();
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [returnedItems, setReturnedItems] = useState<CartItem[]>([]);
    const [takenItems, setTakenItems] = useState<CartItem[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [receiptData, setReceiptData] = useState<any | null>(null);

    const [customerPhone, setCustomerPhone] = useState("");
    const [customerLocation, setCustomerLocation] = useState("");

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
        }, 500);
        return () => clearTimeout(timer);
    }, [search]);

    const shopData = useQuery(api.stocks.getShopStock, {
        searchTerm: debouncedSearch || undefined,
        email: user?.email || undefined,
        limit: 10,
    });

    const swapMutation = useMutation(api.sales.swap);

    const stocks = shopData?.stocks || [];

    const totalReturn = returnedItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const totalTake = takenItems.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const diff = totalTake - totalReturn;

    const handleSwap = async () => {
        if (!user) return;
        if (returnedItems.length === 0 && takenItems.length === 0) {
            toast.error("Please add items to swap.");
            return;
        }

        try {
            setIsLoading(true);
            const result = await swapMutation({
                userId: user._id,
                shopId: shopData?.shop?._id,
                returnedItems: returnedItems.map(i => ({ stockId: i.stockId, quantity: i.qty, name: i.name, productCode: i.productCode })),
                takenItems: takenItems.map(i => ({ stockId: i.stockId, quantity: i.qty, price: i.price, name: i.name, productCode: i.productCode, pv: i.pv, bv: i.bv })),
                customerPhone: customerPhone || undefined,
                customerLocation: customerLocation || undefined,
            }) as any;

            // Prepare Receipt
            const fullName = `${user.first_name} ${user.last_name}`;
            const totalPVVal = takenItems.reduce((sum, item) => sum + (item.pv * item.qty), 0);
            const totalBVVal = takenItems.reduce((sum, item) => sum + (item.bv * item.qty), 0);

            const receipt = {
                customer: { name: "Swap Customer", phone: customerPhone, email: "" },
                shop: {
                    name: shopData?.shop?.name || "Main Warehouse",
                    location: shopData?.shop?.location || "Headquarters",
                    contact: shopData?.shop?.contact || "N/A",
                    serialNumber: shopData?.shop?.serialNumber || "MAIN-001"
                },
                operator: { name: fullName, email: user?.email },
                clientType: "Retail (Swap)",
                paymentMode: "Swap",
                transactionType: "Swap",
                date: new Date().toISOString(),
                invoiceNumber: result.invoiceNumber || `SWAP-${Date.now()}`,
                items: takenItems.map(i => ({ ...i })),
                returnedItems: returnedItems.map(i => ({ ...i })),
                total: diff,
                totalPV: totalPVVal,
                totalBV: totalBVVal,
                customerPhone,
                customerLocation,
            };

            setReceiptData(receipt);
            toast.success("Swap completed successfully!");
            setReturnedItems([]);
            setTakenItems([]);
            setCustomerPhone("");
            setCustomerLocation("");
        } catch (error) {
            toast.error(formatError(error));
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full pb-10">
            <div className="lg:col-span-7 flex flex-col gap-4">
                <div className="relative">
                    <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Search products to swap..."
                        className="pl-9 h-12"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="flex-1 overflow-auto border rounded-xl bg-card shadow-sm p-4">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Product</TableHead>
                                <TableHead className="text-right">Price</TableHead>
                                <TableHead className="text-center">Action</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {stocks.map((stock: any) => (
                                <TableRow key={stock._id || stock.stockId}>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium">{stock.name}</span>
                                            <span className="text-[10px] text-muted-foreground">{stock.productCode}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-right font-mono">{stock.price.toLocaleString()}</TableCell>
                                    <TableCell className="text-center">
                                        <div className="flex gap-2 justify-center">
                                            <Button size="sm" variant="outline" className="h-7 text-[10px] bg-red-50 text-red-700 border-red-200" onClick={() => {
                                                setReturnedItems(prev => {
                                                    const exists = prev.find(i => i.stockId === (stock._id || stock.stockId));
                                                    if (exists) return prev.map(i => i.stockId === (stock._id || stock.stockId) ? { ...i, qty: i.qty + 1 } : i);
                                                    return [...prev, { stockId: (stock._id || stock.stockId), name: stock.name, productCode: stock.productCode, price: stock.price, qty: 1, maxQty: 999, pv: 0, bv: 0 }];
                                                });
                                            }}>Return (In)</Button>
                                            <Button size="sm" variant="outline" className="h-7 text-[10px] bg-green-50 text-green-700 border-green-200" onClick={() => {
                                                setTakenItems(prev => {
                                                    const exists = prev.find(i => i.stockId === (stock._id || stock.stockId));
                                                    if (exists) return prev.map(i => i.stockId === (stock._id || stock.stockId) ? { ...i, qty: i.qty + 1 } : i);
                                                    return [...prev, { stockId: (stock._id || stock.stockId), name: stock.name, productCode: stock.productCode, price: stock.price, qty: 1, maxQty: 999, pv: 0, bv: 0 }];
                                                });
                                            }}>Take (Out)</Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </div>

            <div className="lg:col-span-5 flex flex-col gap-4">
                <Card className="flex-1 flex flex-col border-2 shadow-md overflow-hidden">
                    <CardHeader className="bg-blue-50 py-3">
                        <CardTitle className="text-sm flex items-center gap-2">
                            Product Swap Details
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
                        <div className="space-y-2">
                            <h4 className="text-[10px] font-bold uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded w-fit">Items being Returned (Stock IN)</h4>
                            {returnedItems.length === 0 && <p className="text-xs text-muted-foreground italic">None</p>}
                            {returnedItems.map(item => (
                                <div key={item.stockId} className="flex justify-between items-center text-xs border-b pb-1">
                                    <span className="flex-1 truncate">{item.name}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold">x{item.qty}</span>
                                        <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive" onClick={() => setReturnedItems(prev => prev.filter(i => i.stockId !== item.stockId))}><Trash2 className="h-3 w-3" /></Button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-2 pt-4 border-t border-dashed">
                            <h4 className="text-[10px] font-bold uppercase text-green-600 bg-green-50 px-2 py-0.5 rounded w-fit">Items being Taken (Stock OUT)</h4>
                            {takenItems.length === 0 && <p className="text-xs text-muted-foreground italic">None</p>}
                            {takenItems.map(item => (
                                <div key={item.stockId} className="flex justify-between items-center text-xs border-b pb-1">
                                    <span className="flex-1 truncate">{item.name}</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-bold">x{item.qty}</span>
                                        <Button size="icon" variant="ghost" className="h-5 w-5 text-destructive" onClick={() => setTakenItems(prev => prev.filter(i => i.stockId !== item.stockId))}><Trash2 className="h-3 w-3" /></Button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="space-y-3 pt-4 border-t">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Customer Phone</Label>
                                    <Input placeholder="07..." className="h-8 text-xs" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-[10px] uppercase font-bold text-muted-foreground">Location</Label>
                                    <Input placeholder="Kampala..." className="h-8 text-xs" value={customerLocation} onChange={(e) => setCustomerLocation(e.target.value)} />
                                </div>
                            </div>
                        </div>
                    </CardContent>
                    <CardFooter className="bg-muted/50 p-4 flex flex-col gap-3 mt-auto">
                        <div className="w-full space-y-1">
                            <div className="flex justify-between text-xs font-bold text-red-600">
                                <span>Total Return Value</span>
                                <span>UGX {totalReturn.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-xs font-bold text-green-600 border-b pb-1">
                                <span>Total Taken Value</span>
                                <span>UGX {totalTake.toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between text-sm font-black pt-1">
                                <span>Balance Difference</span>
                                <span className={diff >= 0 ? "text-primary" : "text-destructive"}>UGX {diff.toLocaleString()}</span>
                            </div>
                        </div>
                        <Button className="w-full bg-blue-600 hover:bg-blue-700 font-bold" onClick={handleSwap} disabled={isLoading || (returnedItems.length === 0 && takenItems.length === 0)}>
                            {isLoading ? <Loader2 className="animate-spin mr-2" /> : <Plus className="mr-2 h-4 w-4" />}
                            Process Product Swap
                        </Button>
                    </CardFooter>
                </Card>
            </div>

            <ReceiptModal
                isOpen={!!receiptData}
                onClose={() => setReceiptData(null)}
                data={receiptData}
            />
        </div>
    );
}
