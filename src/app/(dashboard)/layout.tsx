"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Image from "next/image";
import {
    LayoutDashboard,
    ShoppingCart,
    Users,
    BarChart3,
    Store,
    Settings,
    LogOut,
    Package,
    Menu,
    ChevronRight,
    Receipt,
    ChevronDown,
    TrendingUp,
    DollarSign,
    CreditCard,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/context/auth-context";
import { cn } from "@/lib/utils";

const navItems = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/systemconfig", label: "System Config", icon: ShoppingCart },
    { href: "/stock", label: "Stock", icon: Package },
    { href: "/inventory", label: "Inventory", icon: BarChart3 },
    { href: "/sales", label: "Sales", icon: ShoppingCart },
    { href: "/shops", label: "Shops", icon: Store },
    { href: "/expenditures", label: "Expenditures", icon: Receipt },
];

const reportsSubItems = [
    { href: "/reports/overview", label: "Overview", icon: BarChart3 },
    { href: "/reports/sales", label: "Sales", icon: ShoppingCart },
    { href: "/reports/shops", label: "Shops", icon: Store },
    { href: "/reports/stock", label: "Global Stock", icon: Package },
    { href: "/reports/loans", label: "Loans", icon: CreditCard },
    { href: "/reports/expenses", label: "Expenses", icon: Receipt },
    { href: "/reports/products", label: "Products", icon: TrendingUp },
    { href: "/reports/customers", label: "Customers", icon: Users },
    { href: "/reports/users", label: "Staff", icon: Users },
    { href: "/reports/profit", label: "Profit Margin", icon: DollarSign },
];

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { logout, user, isLoading } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isReportsOpen, setIsReportsOpen] = useState(false);

    useEffect(() => {
        if (!isLoading && !user) {
            router.push("/auth/login");
        }
    }, [user, isLoading, router]);

    // Auto-expand Reports if on a reports route
    useEffect(() => {
        if (pathname.startsWith("/reports")) {
            setIsReportsOpen(true);
        }
    }, [pathname]);

    if (isLoading || !user) {
        return (
            <div className="flex h-screen w-full items-center justify-center bg-background">
                <div className="flex flex-col items-center gap-4">
                    <Image src="/logo.ico" alt="Loading" width={150} height={50} className="animate-pulse" />
                    <div className="h-1 w-32 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary animate-loading-bar" style={{ width: '50%' }} />
                    </div>
                </div>
            </div>
        );
    }

    const SidebarContent = () => (
        <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
            {/* Logo Area */}
            <div className={cn("flex h-20 items-center border-b border-sidebar-border/50 transition-all", isCollapsed ? "justify-center px-2" : "px-6")}>
                <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
                    <div className="relative h-10 w-10 overflow-hidden rounded-lg bg-white/90 p-1 shadow-md shrink-0">
                        <Image src="/logo.ico" alt="Tiens Logo" fill className="object-contain" />
                    </div>
                    {!isCollapsed && (
                        <div className="flex flex-col animate-in fade-in duration-300">
                            <span className="text-lg font-black tracking-tight text-sidebar-primary">TIENS POS</span>
                            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Tiens Uganda</span>
                        </div>
                    )}
                </Link>
            </div>

            {/* Navigation */}
            <div className="flex-1 overflow-y-auto py-6 px-4">
                <nav className="space-y-1.5">
                    {navItems
                        .filter(item => {
                            if (user.roles.includes("admin")) return true;
                            if (user.roles.includes("sales")) {
                                return item.label === "Dashboard" || item.label === "Sales" || item.label === "Expenditures";
                            }
                            return false;
                        })
                        .map((item) => {
                            const isActive = pathname === item.href;
                            return (
                                <Link
                                    key={item.href}
                                    href={item.href}
                                    onClick={() => setIsMobileOpen(false)}
                                    className={cn(
                                        "group flex items-center rounded-xl py-3 text-sm font-medium transition-all duration-200 ease-in-out hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                                        isActive
                                            ? "bg-linear-to-r from-sidebar-primary/10 to-sidebar-primary/5 text-sidebar-primary shadow-sm ring-1 ring-sidebar-primary/20"
                                            : "text-muted-foreground",
                                        isCollapsed ? "justify-center px-2" : "justify-between px-4"
                                    )}
                                    title={isCollapsed ? item.label : undefined}
                                >
                                    <div className="flex items-center gap-3">
                                        <item.icon className={cn("h-5 w-5 transition-colors", isActive ? "text-sidebar-primary" : "text-muted-foreground group-hover:text-sidebar-primary")} />
                                        {!isCollapsed && <span>{item.label}</span>}
                                    </div>
                                    {isActive && !isCollapsed && <ChevronRight className="h-4 w-4 text-sidebar-primary animate-in fade-in slide-in-from-left-2" />}
                                </Link>
                            );
                        })}

                    {/* Reports Collapsible Section */}
                    {user.roles.includes("admin") && (
                        <div className="pt-2">
                            {!isCollapsed && (
                                <button
                                    onClick={() => setIsReportsOpen(!isReportsOpen)}
                                    className={cn(
                                        "w-full flex items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-sidebar-accent",
                                        pathname.startsWith("/reports") ? "text-sidebar-primary" : "text-muted-foreground"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <BarChart3 className="h-5 w-5" />
                                        <span>Reports</span>
                                    </div>
                                    <ChevronDown className={cn("h-4 w-4 transition-transform", isReportsOpen ? "rotate-180" : "")} />
                                </button>
                            )}
                            {isCollapsed && (
                                <Link
                                    href="/reports/overview"
                                    className="flex justify-center items-center rounded-xl px-2 py-3 text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-primary transition-colors"
                                    title="Reports"
                                >
                                    <BarChart3 className="h-5 w-5" />
                                </Link>
                            )}
                            {isReportsOpen && !isCollapsed && (
                                <div className="mt-1 ml-4 space-y-1 animate-in slide-in-from-left-2 duration-200">
                                    {reportsSubItems.map((item) => {
                                        const isActive = pathname === item.href;
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                onClick={() => setIsMobileOpen(false)}
                                                className={cn(
                                                    "flex items-center gap-3 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:bg-sidebar-accent/50",
                                                    isActive ? "text-sidebar-primary bg-sidebar-accent/50" : "text-muted-foreground"
                                                )}
                                            >
                                                <item.icon className="h-4 w-4" />
                                                <span>{item.label}</span>
                                            </Link>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                </nav>
            </div>

            {/* Footer Area */}
            <div className="border-t border-sidebar-border/50 p-4 space-y-2">
                <Link
                    href="/settings"
                    onClick={() => setIsMobileOpen(false)}
                    className={cn(
                        "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        pathname === "/settings" && "bg-sidebar-accent text-sidebar-accent-foreground",
                        isCollapsed && "justify-center px-2"
                    )}
                    title={isCollapsed ? "Settings" : undefined}
                >
                    <Settings className="h-5 w-5" />
                    {!isCollapsed && <span>Settings</span>}
                </Link>

                <div className="my-2 h-px bg-linear-to-r from-transparent via-sidebar-border to-transparent" />

                <div className={cn("flex items-center gap-3 rounded-xl bg-sidebar-accent/50 p-3 shadow-sm border border-sidebar-border/30", isCollapsed && "justify-center p-2")}>
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 text-sidebar-primary font-bold">
                        {user.first_name?.[0]}{user.last_name?.[0]}
                    </div>
                    {!isCollapsed && (
                        <div className="flex-1 overflow-hidden">
                            <p className="truncate text-sm font-semibold capitalize">{user.first_name} {user.last_name}</p>
                            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                    )}
                    {!isCollapsed && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            onClick={() => logout()}
                            title="Logout"
                        >
                            <LogOut className="h-4 w-4" />
                        </Button>
                    )}
                </div>
                {isCollapsed && (
                    <div className="flex justify-center pt-2">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                            onClick={() => logout()}
                            title="Logout"
                        >
                            <LogOut className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>

            <div className="absolute right-[-12px] top-20 hidden lg:block z-50">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 rounded-full border shadow-md bg-background"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <ChevronRight className={cn("h-3 w-3 transition-transform", isCollapsed ? "rotate-0" : "rotate-180")} />
                </Button>
            </div>
        </div>
    );

    return (
        <div className="flex min-h-screen w-full bg-background/50">
            {/* Desktop Sidebar */}
            <aside
                className={cn(
                    "hidden flex-col border-r bg-sidebar shadow-2xl lg:flex fixed inset-y-0 z-50 transition-all duration-300",
                    isCollapsed ? "w-[80px]" : "w-[280px]"
                )}
            >
                <SidebarContent />
            </aside>

            {/* Main Content Area */}
            <div
                className={cn(
                    "flex flex-1 flex-col transition-all duration-300",
                    isCollapsed ? "lg:pl-[80px]" : "lg:pl-[280px]"
                )}
            >
                {/* Mobile Header (Only visible on small screens to toggle sidebar) */}
                <div className="sticky top-0 z-40 flex h-16 items-center border-b bg-background/95 px-6 backdrop-blur lg:hidden justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                        <Image src="/logo.ico" alt="Logo" width={32} height={32} />
                        <span className="font-bold text-lg text-primary">TIENS POS</span>
                    </div>
                    <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                        <SheetTrigger asChild>
                            <Button variant="ghost" size="icon" className="-mr-2">
                                <Menu className="h-6 w-6" />
                                <span className="sr-only">Toggle navigation menu</span>
                            </Button>
                        </SheetTrigger>
                        <SheetContent side="left" className="w-[300px] p-0 border-r-0">
                            <SidebarContent />
                        </SheetContent>
                    </Sheet>
                </div>

                <main className="flex-1 p-4 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="mx-auto max-w-7xl">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
