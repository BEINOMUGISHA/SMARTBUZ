"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import {
    LogOut,
    Menu,
    ChevronRight,
    ChevronDown,
    BarChart3,
    Settings,
    CreditCard,
    ShieldCheck,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useAuth } from "@/context/auth-context";
import { useActiveCategory } from "@/hooks/use-active-category";
import { groupNavigation } from "@/lib/category-nav";
import { cn } from "@/lib/utils";
import { OfflineStatusBanner } from "@/components/offline-status-banner";
import { BusinessSwitcher } from "@/components/business-switcher";

const reportsSubItems = [
    { href: "/reports/overview", label: "Overview" },
    { href: "/reports/sales", label: "Sales" },
    { href: "/reports/shops", label: "Branches" },
    { href: "/reports/stock", label: "Global Stock" },
    { href: "/reports/loans", label: "Credit Book" },
    { href: "/reports/expenses", label: "Expenses" },
    { href: "/reports/products", label: "Products" },
    { href: "/reports/customers", label: "Customers" },
    { href: "/reports/users", label: "Staff" },
    { href: "/reports/profit", label: "Profit Margin" },
];

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { logout, user, isLoading, activeBusiness } = useAuth();
    const router = useRouter();
    const pathname = usePathname();
    const [isMobileOpen, setIsMobileOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [isReportsOpen, setIsReportsOpen] = useState(false);

    const { category, profile, navigation, accent } = useActiveCategory(activeBusiness?.role);

    // The platform console is for the SMARTBUZ team, not for tenants.
    const whoami = useQuery(api.platform.whoami, {});
    const isPlatformAdmin = Boolean(whoami?.platformRole);

    const businessName = profile?.name || "SMARTBUZ POS";
    const businessSubtitle = category?.name || "Point of Sale";

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
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-400 text-2xl font-black text-white shadow-lg animate-pulse">
                        {businessName.charAt(0)}
                    </div>
                    <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                        {businessName}
                    </div>
                    <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
                        <div
                            className="h-full w-1/2 animate-loading-bar bg-primary"
                            style={{ width: "50%" }}
                        />
                    </div>
                </div>
            </div>
        );
    }

    const navGroups = groupNavigation(navigation);

    const SidebarContent = () => (
        <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
            {/* Logo Area */}
            <div
                className={cn(
                    "flex h-20 items-center border-b border-sidebar-border/50 transition-all",
                    isCollapsed ? "justify-center px-2" : "px-6"
                )}
            >
                <Link href="/" className="flex items-center gap-3 transition-opacity hover:opacity-80">
                    <div
                        className={cn(
                            "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-gradient-to-tr p-1 text-lg font-black text-white shadow-md",
                            accent.gradient
                        )}
                        style={{
                            backgroundImage: `linear-gradient(135deg, var(--color-${category.accent}-600), var(--color-${category.accent}-400))`,
                        }}
                    >
                        {businessName.charAt(0)}
                    </div>
                    {!isCollapsed && (
                        <div className="flex flex-col animate-in fade-in duration-300">
                            <span className="text-lg font-black tracking-tight text-sidebar-primary">
                                {businessName}
                            </span>
                            <span
                                className={cn(
                                    "text-[10px] font-bold uppercase tracking-wider",
                                    accent.text
                                )}
                            >
                                {businessSubtitle}
                            </span>
                        </div>
                    )}
                </Link>
            </div>

            {/* Business switcher — move between the businesses you belong to */}
            <div className={cn("border-b border-sidebar-border/50", isCollapsed ? "px-2 pb-3" : "px-4 pb-3")}>
                <BusinessSwitcher collapsed={isCollapsed} />
            </div>

            {/* Navigation — driven by the active business category */}
            <div className="flex-1 overflow-y-auto px-4 py-6">
                <nav className="space-y-4">
                    {navGroups.map((group) => (
                        <div key={group.group} className="space-y-1.5">
                            {group.label && !isCollapsed && (
                                <p className="px-4 pb-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground/70">
                                    {group.label}
                                </p>
                            )}
                            {group.items.map((item) => {
                                const isActive =
                                    pathname === item.href ||
                                    (item.href !== "/" && pathname.startsWith(item.href));
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
                                            <item.icon
                                                className={cn(
                                                    "h-5 w-5 transition-colors",
                                                    isActive
                                                        ? "text-sidebar-primary"
                                                        : "text-muted-foreground group-hover:text-sidebar-primary"
                                                )}
                                            />
                                            {!isCollapsed && <span>{item.label}</span>}
                                        </div>
                                        {isActive && !isCollapsed && (
                                            <ChevronRight className="h-4 w-4 animate-in fade-in slide-in-from-left-2 text-sidebar-primary" />
                                        )}
                                    </Link>
                                );
                            })}
                        </div>
                    ))}

                    {/* Reports Collapsible Section */}
                    {navigation.some((i) => i.href === "/reports") && (
                        <div className="pt-2">
                            {!isCollapsed && (
                                <button
                                    onClick={() => setIsReportsOpen(!isReportsOpen)}
                                    className={cn(
                                        "flex w-full items-center justify-between rounded-xl px-4 py-3 text-sm font-medium transition-all hover:bg-sidebar-accent",
                                        pathname.startsWith("/reports")
                                            ? "text-sidebar-primary"
                                            : "text-muted-foreground"
                                    )}
                                >
                                    <div className="flex items-center gap-3">
                                        <BarChart3 className="h-5 w-5" />
                                        <span>Reports</span>
                                    </div>
                                    <ChevronDown
                                        className={cn(
                                            "h-4 w-4 transition-transform",
                                            isReportsOpen ? "rotate-180" : ""
                                        )}
                                    />
                                </button>
                            )}
                            {isCollapsed && (
                                <Link
                                    href="/reports/overview"
                                    className="flex items-center justify-center rounded-xl px-2 py-3 text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-primary"
                                    title="Reports"
                                >
                                    <BarChart3 className="h-5 w-5" />
                                </Link>
                            )}
                            {isReportsOpen && !isCollapsed && (
                                <div className="mt-1 ml-4 animate-in slide-in-from-left-2 space-y-1 duration-200">
                                    {reportsSubItems.map((item) => {
                                        const isActive = pathname === item.href;
                                        return (
                                            <Link
                                                key={item.href}
                                                href={item.href}
                                                onClick={() => setIsMobileOpen(false)}
                                                className={cn(
                                                    "flex items-center gap-3 rounded-lg px-4 py-2 text-sm font-medium transition-all hover:bg-sidebar-accent/50",
                                                    isActive
                                                        ? "bg-sidebar-accent/50 text-sidebar-primary"
                                                        : "text-muted-foreground"
                                                )}
                                            >
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
            <div className="space-y-2 border-t border-sidebar-border/50 p-4">
                <Link
                    href="/subscription"
                    onClick={() => setIsMobileOpen(false)}
                    className={cn(
                        "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                        pathname === "/subscription" && "bg-sidebar-accent text-sidebar-accent-foreground",
                        isCollapsed && "justify-center px-2"
                    )}
                    title={isCollapsed ? "Subscription" : undefined}
                >
                    <CreditCard className="h-5 w-5" />
                    {!isCollapsed && <span>Subscription</span>}
                </Link>

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

                {isPlatformAdmin && (
                    <Link
                        href="/platform"
                        onClick={() => setIsMobileOpen(false)}
                        className={cn(
                            "flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium text-muted-foreground transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                            pathname === "/platform" && "bg-sidebar-accent text-sidebar-accent-foreground",
                            isCollapsed && "justify-center px-2"
                        )}
                        title={isCollapsed ? "Platform" : undefined}
                    >
                        <ShieldCheck className="h-5 w-5" />
                        {!isCollapsed && <span>Platform</span>}
                    </Link>
                )}

                <div className="my-2 h-px bg-linear-to-r from-transparent via-sidebar-border to-transparent" />

                <div
                    className={cn(
                        "flex items-center gap-3 rounded-xl border border-sidebar-border/30 bg-sidebar-accent/50 p-3 shadow-sm",
                        isCollapsed && "justify-center p-2"
                    )}
                >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sidebar-primary/10 font-bold text-sidebar-primary">
                        {user.first_name?.[0]}
                        {user.last_name?.[0]}
                    </div>
                    {!isCollapsed && (
                        <div className="flex-1 overflow-hidden">
                            <p className="truncate text-sm font-semibold capitalize">
                                {user.first_name} {user.last_name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                    )}
                    {!isCollapsed && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
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
                            className="h-8 w-8 rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => logout()}
                            title="Logout"
                        >
                            <LogOut className="h-4 w-4" />
                        </Button>
                    </div>
                )}
            </div>

            <div className="absolute right-[-12px] top-20 z-50 hidden lg:block">
                <Button
                    variant="outline"
                    size="icon"
                    className="h-6 w-6 rounded-full border bg-background shadow-md"
                    onClick={() => setIsCollapsed(!isCollapsed)}
                >
                    <ChevronRight
                        className={cn(
                            "h-3 w-3 transition-transform",
                            isCollapsed ? "rotate-0" : "rotate-180"
                        )}
                    />
                </Button>
            </div>
        </div>
    );

    return (
        <div className="flex min-h-screen w-full bg-background/50">
            {/* Desktop Sidebar */}
            <aside
                className={cn(
                    "fixed inset-y-0 z-50 hidden flex-col border-r bg-sidebar shadow-2xl transition-all duration-300 lg:flex",
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
                {/* Mobile Header */}
                <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b bg-background/95 px-6 shadow-sm backdrop-blur lg:hidden">
                    <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-400 text-sm font-black text-white shadow-sm">
                            {businessName.charAt(0)}
                        </div>
                        <span className="text-base font-bold tracking-tight text-primary">
                            {businessName}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <OfflineStatusBanner />
                        <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
                            <SheetTrigger asChild>
                                <Button variant="ghost" size="icon" className="-mr-2">
                                    <Menu className="h-6 w-6" />
                                    <span className="sr-only">Toggle navigation menu</span>
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-[300px] border-r-0 p-0">
                                <SidebarContent />
                            </SheetContent>
                        </Sheet>
                    </div>
                </div>

                <main className="flex-1 p-4 lg:p-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="mx-auto max-w-7xl space-y-4">
                        <div className="hidden justify-end lg:flex">
                            <OfflineStatusBanner />
                        </div>
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
}
