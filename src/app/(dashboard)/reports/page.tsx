"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    BarChart3,
    ShoppingCart,
    Store,
    Package,
    CreditCard,
} from "lucide-react";

import { OverviewReport } from "./components/OverviewReport";
import { DetailedSalesReport } from "./components/DetailedSalesReport";
import { ShopsReport } from "./components/ShopsReport";
import { GlobalStockReport } from "./components/GlobalStockReport";
import { LoansReport } from "./components/LoansReport";

export default function ReportsPage() {
    return (
        <div className="space-y-3">
            <Tabs defaultValue="overview" className="space-y-4">
                <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-md py-1.5 print:hidden">
                    <TabsList className="bg-muted/30 p-1 rounded-xl h-auto flex flex-wrap lg:flex-nowrap gap-1">
                        <TabsTrigger value="overview" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-9 px-5 rounded-xl transition-all uppercase text-xs tracking-widest">
                            <BarChart3 className="h-4 w-4" /> Overview
                        </TabsTrigger>
                        <TabsTrigger value="sales" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-9 px-5 rounded-xl transition-all uppercase text-xs tracking-widest">
                            <ShoppingCart className="h-4 w-4" /> Detailed Sales
                        </TabsTrigger>
                        <TabsTrigger value="shops" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-9 px-5 rounded-xl transition-all uppercase text-xs tracking-widest">
                            <Store className="h-4 w-4" /> Shops
                        </TabsTrigger>
                        <TabsTrigger value="stock" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-9 px-5 rounded-xl transition-all uppercase text-xs tracking-widest">
                            <Package className="h-4 w-4" /> Global Stock
                        </TabsTrigger>
                        <TabsTrigger value="loans" className="flex items-center gap-2 data-[state=active]:bg-primary data-[state=active]:text-white font-black h-9 px-5 rounded-xl transition-all uppercase text-xs tracking-widest">
                            <CreditCard className="h-4 w-4" /> Loans
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="overview" className="focus-visible:outline-none">
                    <OverviewReport />
                </TabsContent>
                <TabsContent value="sales" className="focus-visible:outline-none">
                    <DetailedSalesReport />
                </TabsContent>
                <TabsContent value="shops" className="focus-visible:outline-none">
                    <ShopsReport />
                </TabsContent>
                <TabsContent value="stock" className="focus-visible:outline-none">
                    <GlobalStockReport />
                </TabsContent>
                <TabsContent value="loans" className="focus-visible:outline-none">
                    <LoansReport />
                </TabsContent>
            </Tabs>
        </div>
    );
}
