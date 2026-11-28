/**
 * SMART_BUZ — Category-aware navigation
 *
 * Maps the `modules` declared by the active business category onto the
 * actual routes in the app. The sidebar reads this registry so a pharmacy
 * sees "Batches & Expiry" while a restaurant sees "Tables & Orders" and a
 * school sees "Students & Fees".
 */

import {
    LayoutDashboard,
    ShoppingCart,
    Package,
    BarChart3,
    Store,
    Settings,
    Receipt,
    Users,
    CreditCard,
    PackageSearch,
    Calendar,
    UtensilsCrossed,
    BookOpen,
    ClipboardList,
    Truck,
    Boxes,
    UserRound,
    Banknote,
    Fuel,
    CalendarClock,
    ClipboardCheck,
    Wallet,
    PackagePlus,
    UsersRound,
    ScanLine,
    Building2,
    HeartHandshake,
    Hammer,
    Scissors,
    GraduationCap,
    Car,
    Sparkles,
    Landmark,
    Wrench,
    PackageCheck,
    Tag,
    ConciergeBell,
    FileText,
    Target,
    Handshake,
    HandCoins,
    Ruler,
    Bell,
    Upload,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ModuleId, BusinessCategory } from "./business-categories";

export interface NavItem {
    id: ModuleId;
    href: string;
    label: string;
    icon: LucideIcon;
    /** Roles allowed to see this item. Empty means everyone. */
    roles?: string[];
    /** Grouping in the sidebar. */
    group: "main" | "operations" | "records" | "admin";
}

/**
 * Full registry of every module route in SMART_BUZ.
 * The category's `modules` array selects which of these are visible.
 */
export const MODULE_REGISTRY: Record<ModuleId, NavItem> = {
    dashboard: {
        id: "dashboard",
        href: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        group: "main",
    },
    sales: {
        id: "sales",
        href: "/sales",
        label: "Sales / POS",
        icon: ShoppingCart,
        group: "main",
    },
    pos: {
        id: "pos",
        href: "/sales",
        label: "Point of Sale",
        icon: ScanLine,
        group: "main",
    },
    stock: {
        id: "stock",
        href: "/stock",
        label: "Stock",
        icon: Package,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
    },
    inventory: {
        id: "inventory",
        href: "/inventory",
        label: "Inventory",
        icon: BarChart3,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
    },
    shops: {
        id: "shops",
        href: "/shops",
        label: "Branches",
        icon: Store,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager"],
    },
    suppliers: {
        id: "suppliers",
        href: "/suppliers",
        label: "Suppliers",
        icon: Truck,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager"],
    },
    purchaseOrders: {
        id: "purchaseOrders",
        href: "/purchase-orders",
        label: "Purchase Orders",
        icon: ClipboardList,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager"],
    },
    deliveries: {
        id: "deliveries",
        href: "/deliveries",
        label: "Deliveries",
        icon: Truck,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "inventory_manager"],
    },
    appointments: {
        id: "appointments",
        href: "/appointments",
        label: "Appointments",
        icon: CalendarClock,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    bookings: {
        id: "bookings",
        href: "/appointments",
        label: "Bookings",
        icon: Calendar,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    classes: {
        id: "classes",
        href: "/classes",
        label: "Classes & Students",
        icon: GraduationCap,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    tables: {
        id: "tables",
        href: "/tables",
        label: "Tables & Orders",
        icon: UtensilsCrossed,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "cashier", "salesperson"],
    },
    rooms: {
        id: "rooms",
        href: "/rooms",
        label: "Rooms",
        icon: Building2,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    menu: {
        id: "menu",
        href: "/menu",
        label: "Menu",
        icon: BookOpen,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "cashier", "salesperson", "inventory_manager"],
    },
    batches: {
        id: "batches",
        href: "/batches",
        label: "Batches",
        icon: Boxes,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
    },
    expiry: {
        id: "expiry",
        href: "/batches?view=expiry",
        label: "Expiry Watch",
        icon: PackageSearch,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
    },
    prescriptions: {
        id: "prescriptions",
        href: "/prescriptions",
        label: "Prescriptions",
        icon: ClipboardCheck,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    members: {
        id: "members",
        href: "/members",
        label: "Members",
        icon: UsersRound,
        group: "records",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "accountant", "auditor", "salesperson"],
    },
    attendance: {
        id: "attendance",
        href: "/attendance",
        label: "Attendance",
        icon: ClipboardCheck,
        group: "records",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    customers: {
        id: "customers",
        href: "/customers",
        label: "Customers",
        icon: Users,
        group: "records",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "cashier", "salesperson", "accountant"],
    },
    loans: {
        id: "loans",
        href: "/sales/loans",
        label: "Credit Book",
        icon: CreditCard,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant"],
    },
    receivables: {
        id: "receivables",
        href: "/reports/customers",
        label: "Receivables",
        icon: Banknote,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant", "auditor"],
    },
    services: {
        id: "services",
        href: "/service-tickets",
        label: "Service Jobs",
        icon: Scissors,
        group: "records",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor"],
    },
    production: {
        id: "production",
        href: "/production",
        label: "Production",
        icon: PackagePlus,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
    },
    fuelPump: {
        id: "fuelPump",
        href: "/fuel",
        label: "Fuel Pumps",
        icon: Fuel,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "cashier", "salesperson"],
    },
    assets: {
        id: "assets",
        href: "/assets",
        label: "Assets",
        icon: Boxes,
        group: "records",
        roles: ["business_owner", "business_admin"],
    },
    rentals: {
        id: "rentals",
        href: "/rentals",
        label: "Rentals / Hire",
        icon: Sparkles,
        group: "operations",
        roles: ["business_owner", "business_admin", "branch_manager", "supervisor", "salesperson"],
    },
    expenses: {
        id: "expenses",
        href: "/expenditures",
        label: "Expenditures",
        icon: Receipt,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant"],
    },
    reports: {
        id: "reports",
        href: "/reports",
        label: "Reports",
        icon: BarChart3,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant", "auditor"],
    },
    finance: {
        id: "finance",
        href: "/finance",
        label: "Finance",
        icon: Wallet,
        group: "records",
        roles: [
            "business_owner",
            "business_admin",
            "branch_manager",
            "supervisor",
            "cashier",
            "accountant",
        ],
    },
    /**
     * The money book: what came in, what went out, and what is left.
     *
     * It sits beside Finance in the records group because it answers a
     * different question — not what the business earned, but what actually
     * moved through its bank.
     */
    banking: {
        id: "banking",
        href: "/banking",
        label: "Banking",
        icon: Landmark,
        group: "records",
        roles: [
            "business_owner",
            "business_admin",
            "accountant",
            "auditor",
        ],
    },
    businessIntelligence: {
        id: "businessIntelligence",
        href: "/reports/analysis",
        label: "Business Intelligence",
        icon: BarChart3,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant", "auditor"],
    },
    /**
     * Pricing — volume bands, a customer's own price, and the units the
     * trade measures in. Every trade that sells goods prices differently;
     * this is where those rules are kept.
     */
    pricing: {
        id: "pricing",
        href: "/pricing",
        label: "Pricing",
        icon: Tag,
        group: "operations",
        roles: ["business_owner", "business_admin", "accountant"],
    },
    /** The hotel front desk — rooms, reservations, stays and the folio. */
    frontDesk: {
        id: "frontDesk",
        href: "/front-desk",
        label: "Front Desk",
        icon: ConciergeBell,
        group: "operations",
        roles: ["business_owner", "business_admin", "accountant", "auditor"],
    },
    /** School and institute fees — term invoices, payments and arrears. */
    fees: {
        id: "fees",
        href: "/fees",
        label: "Student Fees",
        icon: GraduationCap,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant", "auditor"],
    },
    /** Quotations — the offer a business makes before the work starts. */
    quotes: {
        id: "quotes",
        href: "/quotes",
        label: "Quotations",
        icon: FileText,
        group: "records",
        roles: ["business_owner", "business_admin", "sales_agent", "accountant"],
    },
    /** The pipeline — the people who might buy, before they are customers. */
    leads: {
        id: "leads",
        href: "/leads",
        label: "Pipeline",
        icon: Target,
        group: "records",
        roles: ["business_owner", "business_admin", "sales_agent"],
    },
    /**
     * Instalment plans — hire purchase and layaway contracts. Stock stays on
     * the shelf until the plan completes, and the balance is tracked so it
     * can never drift from the schedule.
     */
    plans: {
        id: "plans",
        href: "/plans",
        label: "Instalment Plans",
        icon: Handshake,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant", "auditor"],
    },
    /**
     * Payroll — the wages this business owes its staff, run by run and
     * staff member by staff member, with the figures worked out on the
     * server from the business's own records.
     */
    payroll: {
        id: "payroll",
        href: "/payroll",
        label: "Payroll",
        icon: HandCoins,
        group: "records",
        roles: ["business_owner", "business_admin", "accountant"],
    },
    /** Measurements — the sizes a customer is, kept against the customer. */
    measurements: {
        id: "measurements",
        href: "/measurements",
        label: "Measurements",
        icon: Ruler,
        group: "records",
        roles: ["business_owner", "business_admin", "sales_agent"],
    },
    /** The bell — what happened, and what still needs a person. */
    notifications: {
        id: "notifications",
        href: "/notifications",
        label: "Notifications",
        icon: Bell,
        group: "records",
    },
    /** Bulk import — a catalogue, a customer list or an opening stock. */
    imports: {
        id: "imports",
        href: "/import",
        label: "Bulk Import",
        icon: Upload,
        group: "operations",
        roles: ["business_owner", "business_admin"],
    },
    promotions: {
        id: "promotions",
        href: "/systemconfig",
        label: "Promotions",
        icon: Sparkles,
        group: "admin",
        roles: ["business_owner", "business_admin"],
    },
    systemconfig: {
        id: "systemconfig",
        href: "/systemconfig",
        label: "System Config",
        icon: Settings,
        group: "admin",
        roles: ["business_owner", "business_admin"],
    },
    maintenance: {
        id: "maintenance",
        href: "/assets",
        label: "Maintenance",
        icon: Wrench,
        group: "operations",
        roles: ["business_owner", "business_admin"],
    },
    grn: {
        id: "grn",
        href: "/purchase-orders",
        label: "Goods Received",
        icon: PackageCheck,
        group: "operations",
        roles: ["business_owner", "business_admin", "inventory_manager", "branch_manager"],
    },
};

/** Group display order and labels. */
export const NAV_GROUPS: Array<{ id: NavItem["group"]; label: string }> = [
    { id: "main", label: "" },
    { id: "operations", label: "Operations" },
    { id: "records", label: "Records" },
    { id: "admin", label: "Administration" },
];

/**
 * Build the sidebar.
 *
 * @param roles   the signed-in user's roles
 * @param screens the screens the menu is made of
 *
 * The screens are worked out by the caller, because there are two cases and
 * they are not the same: a business that has not chosen gets the vertical's
 * own screens with the business's choice and the industry packages' screens
 * on top, while a person who has chosen for themselves gets exactly their
 * own list — a screen they switched off must stay off.
 */
export function buildNavigation(
    roles: string[],
    screens: string[]
): NavItem[] {
    const enabled = new Set(screens);

    // De-duplicate by href: several modules can point at the same route
    // (e.g. "bookings" and "appointments"), and we only want one entry.
    const seen = new Set<string>();
    const items: NavItem[] = [];

    for (const moduleId of enabled) {
        // The ids come from the category, the business's own choice and the
        // industry packages. Only a registered module has a screen, so
        // anything else is quietly ignored.
        const item = MODULE_REGISTRY[moduleId as ModuleId];
        if (!item) continue;
        if (seen.has(item.href)) continue;
        if (item.roles && item.roles.length > 0 && !item.roles.some((r) => roles.includes(r))) {
            continue;
        }
        seen.add(item.href);
        items.push(item);
    }

    // Dashboard is always available.
    if (!items.some((i) => i.id === "dashboard")) {
        items.unshift(MODULE_REGISTRY.dashboard);
    }

    // Order by the canonical group order.
    return items.sort((a, b) => {
        const ai = NAV_GROUPS.findIndex((g) => g.id === a.group);
        const bi = NAV_GROUPS.findIndex((g) => g.id === b.group);
        return ai - bi;
    });
}

/**
 * Every module, for the screens that let a business choose its own.
 *
 * The list comes from the registry, so a module cannot be offered that
 * has no screen behind it, and a new module appears here the moment it
 * is registered.
 */
export const MODULE_OPTIONS = Object.values(MODULE_REGISTRY).map((item) => ({
    id: item.id,
    label: item.label,
    group: item.group,
}));

/** Group nav items for rendering. */
export function groupNavigation(items: NavItem[]): Array<{
    group: NavItem["group"];
    label: string;
    items: NavItem[];
}> {
    return NAV_GROUPS.map((g) => ({
        group: g.id,
        label: g.label,
        items: items.filter((i) => i.group === g.id),
    })).filter((g) => g.items.length > 0);
}

/**
 * Accent colour per vertical, used for theming the sidebar, headers and
 * dashboard cards so each business type feels like its own product.
 */
export const ACCENT_STYLES: Record<
    string,
    { badge: string; ring: string; text: string; gradient: string }
> = {
    emerald: {
        badge: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20",
        ring: "ring-emerald-500/30",
        text: "text-emerald-600 dark:text-emerald-400",
        gradient: "from-emerald-500/10 to-emerald-500/0",
    },
    teal: {
        badge: "bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20",
        ring: "ring-teal-500/30",
        text: "text-teal-600 dark:text-teal-400",
        gradient: "from-teal-500/10 to-teal-500/0",
    },
    lime: {
        badge: "bg-lime-500/10 text-lime-700 dark:text-lime-400 border-lime-500/20",
        ring: "ring-lime-500/30",
        text: "text-lime-700 dark:text-lime-400",
        gradient: "from-lime-500/10 to-lime-500/0",
    },
    amber: {
        badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
        ring: "ring-amber-500/30",
        text: "text-amber-700 dark:text-amber-400",
        gradient: "from-amber-500/10 to-amber-500/0",
    },
    orange: {
        badge: "bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/20",
        ring: "ring-orange-500/30",
        text: "text-orange-700 dark:text-orange-400",
        gradient: "from-orange-500/10 to-orange-500/0",
    },
    red: {
        badge: "bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20",
        ring: "ring-red-500/30",
        text: "text-red-600 dark:text-red-400",
        gradient: "from-red-500/10 to-red-500/0",
    },
    rose: {
        badge: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20",
        ring: "ring-rose-500/30",
        text: "text-rose-600 dark:text-rose-400",
        gradient: "from-rose-500/10 to-rose-500/0",
    },
    blue: {
        badge: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20",
        ring: "ring-blue-500/30",
        text: "text-blue-600 dark:text-blue-400",
        gradient: "from-blue-500/10 to-blue-500/0",
    },
    indigo: {
        badge: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20",
        ring: "ring-indigo-500/30",
        text: "text-indigo-600 dark:text-indigo-400",
        gradient: "from-indigo-500/10 to-indigo-500/0",
    },
    violet: {
        badge: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20",
        ring: "ring-violet-500/30",
        text: "text-violet-600 dark:text-violet-400",
        gradient: "from-violet-500/10 to-violet-500/0",
    },
    purple: {
        badge: "bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20",
        ring: "ring-purple-500/30",
        text: "text-purple-600 dark:text-purple-400",
        gradient: "from-purple-500/10 to-purple-500/0",
    },
    fuchsia: {
        badge: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400 border-fuchsia-500/20",
        ring: "ring-fuchsia-500/30",
        text: "text-fuchsia-600 dark:text-fuchsia-400",
        gradient: "from-fuchsia-500/10 to-fuchsia-500/0",
    },
    pink: {
        badge: "bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20",
        ring: "ring-pink-500/30",
        text: "text-pink-600 dark:text-pink-400",
        gradient: "from-pink-500/10 to-pink-500/0",
    },
    cyan: {
        badge: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-500/20",
        ring: "ring-cyan-500/30",
        text: "text-cyan-700 dark:text-cyan-400",
        gradient: "from-cyan-500/10 to-cyan-500/0",
    },
    sky: {
        badge: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20",
        ring: "ring-sky-500/30",
        text: "text-sky-600 dark:text-sky-400",
        gradient: "from-sky-500/10 to-sky-500/0",
    },
    yellow: {
        badge: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/20",
        ring: "ring-yellow-500/30",
        text: "text-yellow-700 dark:text-yellow-400",
        gradient: "from-yellow-500/10 to-yellow-500/0",
    },
    stone: {
        badge: "bg-stone-500/10 text-stone-700 dark:text-stone-400 border-stone-500/20",
        ring: "ring-stone-500/30",
        text: "text-stone-700 dark:text-stone-400",
        gradient: "from-stone-500/10 to-stone-500/0",
    },
    zinc: {
        badge: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
        ring: "ring-zinc-500/30",
        text: "text-zinc-700 dark:text-zinc-400",
        gradient: "from-zinc-500/10 to-zinc-500/0",
    },
    slate: {
        badge: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-500/20",
        ring: "ring-slate-500/30",
        text: "text-slate-700 dark:text-slate-400",
        gradient: "from-slate-500/10 to-slate-500/0",
    },
    green: {
        badge: "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20",
        ring: "ring-green-500/30",
        text: "text-green-700 dark:text-green-400",
        gradient: "from-green-500/10 to-green-500/0",
    },
    gray: {
        badge: "bg-gray-500/10 text-gray-700 dark:text-gray-400 border-gray-500/20",
        ring: "ring-gray-500/30",
        text: "text-gray-700 dark:text-gray-400",
        gradient: "from-gray-500/10 to-gray-500/0",
    },
};

/** Resolve the accent style for a category, with a safe fallback. */
export function accentFor(category: BusinessCategory) {
    return ACCENT_STYLES[category.accent] ?? ACCENT_STYLES.emerald;
}

/**
 * Resolve an accent by name.
 *
 * A person may pick the colour of their own workspace, whatever the trade
 * chose. An accent the shell has no colour for falls back to the trade's
 * own rather than leaving the workspace unstyled.
 */
export function accentForName(name: string | null | undefined, category: BusinessCategory) {
    if (!name) return accentFor(category);
    return ACCENT_STYLES[name] ?? accentFor(category);
}

/** The accent names a person may choose. */
export const ACCENT_NAMES = Object.keys(ACCENT_STYLES);

/** The accent colour of each name, for the picker. */
export const ACCENT_PREVIEW: Record<string, string> = {
    emerald: "bg-emerald-500",
    teal: "bg-teal-500",
    lime: "bg-lime-500",
    amber: "bg-amber-500",
    orange: "bg-orange-500",
    red: "bg-red-500",
    rose: "bg-rose-500",
    blue: "bg-blue-500",
    indigo: "bg-indigo-500",
    violet: "bg-violet-500",
    purple: "bg-purple-500",
    fuchsia: "bg-fuchsia-500",
    pink: "bg-pink-500",
    cyan: "bg-cyan-500",
    sky: "bg-sky-500",
    yellow: "bg-yellow-500",
    stone: "bg-stone-500",
    zinc: "bg-zinc-500",
    slate: "bg-slate-500",
    green: "bg-green-500",
    gray: "bg-gray-500",
};
