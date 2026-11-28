"use client";

/**
 * SMART_BUZ — the command palette.
 *
 * Every professional tool has one. It is the fastest route to anything in
 * the product: a module, a record, or an action.
 *
 *   ⌘K / Ctrl-K     open the palette
 *   ↑ ↓             move through the results
 *   ⏎              open the highlighted result
 *   ⎋              close it
 *
 * The results are permission-aware. Somebody who may not read the customer
 * list never sees customers in the palette, and somebody who may not issue
 * refunds never sees the refund action.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
    ArrowRight,
    CornerDownLeft,
    Loader2,
    Package,
    Search,
    Users,
    type LucideIcon,
} from "lucide-react";

import { useAuth } from "@/context/auth-context";
import { useActiveCategory } from "@/hooks/use-active-category";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import {
    CommandDialog,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
    CommandShortcut,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { useT } from "@/i18n/provider";

/* ──────────────────────────────── the hook ───────────────────────────── */

/**
 * The palette's open state, shared between the trigger button and the
 * palette itself.
 */
export function useCommandPalette() {
    const [open, setOpen] = React.useState(false);

    React.useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                setOpen((value) => !value);
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    return { open, setOpen };
}

/* ──────────────────────────────── actions ────────────────────────────── */

interface PaletteAction {
    id: string;
    label: string;
    hint?: string;
    icon: LucideIcon;
    onSelect: () => void;
    keywords?: string;
}

/* ─────────────────────────────── the palette ─────────────────────────── */

export function CommandPalette({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    
    const t = useT();const router = useRouter();
    const { can } = useAuth();
    const { navigation } = useActiveCategory();

    const [term, setTerm] = React.useState("");
    const debouncedTerm = useDebouncedValue(term, 250);

    // ── Record search ────────────────────────────────────────────────
    const trimmed = debouncedTerm.trim();
    const canSearchProducts = can("products.view");
    const canSearchCustomers = can("customers.view");

    const products = useQuery(
        api.stocks.getPaginated,
        canSearchProducts && trimmed.length >= 2
            ? { limit: 6, offset: 0, searchTerm: trimmed }
            : "skip"
    );

    const customers = useQuery(
        api.customers.getPaginated,
        canSearchCustomers && trimmed.length >= 2
            ? { limit: 6, offset: 0, searchTerm: trimmed }
            : "skip"
    );

    const go = React.useCallback(
        (href: string) => {
            onOpenChange(false);
            setTerm("");
            router.push(href);
        },
        [onOpenChange, router]
    );

    const actions: PaletteAction[] = React.useMemo(() => {
        const list: PaletteAction[] = [];

        if (can("sales.create")) {
            list.push({
                id: "new-sale",
                label: "New sale",
                hint: "Open the till",
                icon: ArrowRight,
                onSelect: () => go("/till"),
                keywords: "pos checkout transaction",
            });
        }
        if (can("customers.manage")) {
            list.push({
                id: "new-customer",
                label: "Add a customer",
                hint: "Create a new customer record",
                icon: Users,
                onSelect: () => go("/customers"),
                keywords: "client account create",
            });
        }
        if (can("products.view")) {
            list.push({
                id: "browse-stock",
                label: "Browse stock",
                hint: "Products, prices and levels",
                icon: Package,
                onSelect: () => go("/stock"),
                keywords: "inventory products sku",
            });
        }
        if (can("finance.reports.view")) {
            list.push({
                id: "open-reports",
                label: "Open the reports",
                hint: "Sales, profit and stock",
                icon: ArrowRight,
                onSelect: () => go("/reports/overview"),
                keywords: "analytics figures profit loss",
            });
        }

        return list;
    }, [can, go]);

    const isSearching = trimmed.length >= 2;
    const productRows = products?.page ?? [];
    const customerRows = customers?.page ?? [];
    const searching =
        isSearching && (canSearchProducts || canSearchCustomers);

    return (
        <CommandDialog
            open={open}
            onOpenChange={onOpenChange}
            title={t("Go to")}
            description={t("Search the product, or jump to a module.")}
            commandProps={{ shouldFilter: false }}
            className="sm:max-w-2xl"
        >
            <CommandInput
                value={term}
                onValueChange={setTerm}
                placeholder={t("Search products, customers, or type a module name…")}
            />
            <CommandList className="max-h-[26rem]">
                <CommandEmpty>
                    {searching ? (
                        <span className="flex items-center gap-2">
                            <Loader2 className="size-3.5 animate-spin" />
                            {t("Searching…")}
                        </span>
                    ) : (
                        "No results. Try a product name, a customer, or a module."
                    )}
                </CommandEmpty>

                {/* ── Records ───────────────────────────────────────── */}
                {productRows.length > 0 ? (
                    <CommandGroup heading="Products">
                        {productRows.map((product: any) => (
                            <CommandItem
                                key={product._id}
                                value={`product-${product._id}-${product.name ?? ""}`}
                                onSelect={() => go(`/stock?search=${encodeURIComponent(product.name ?? "")}`)}
                                keywords={[`product ${product.name ?? ""}`, product.code ?? "", product.barcode ?? ""]}
                            >
                                <Package className="size-4 text-muted-foreground" />
                                <span className="truncate">{product.name}</span>
                                {product.code ? (
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        {product.code}
                                    </span>
                                ) : null}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ) : null}

                {customerRows.length > 0 ? (
                    <CommandGroup heading="Customers">
                        {customerRows.map((customer: any) => (
                            <CommandItem
                                key={customer._id}
                                value={`customer-${customer._id}-${customer.name ?? ""}`}
                                onSelect={() =>
                                    go(
                                        `/customers?search=${encodeURIComponent(customer.name ?? "")}`
                                    )
                                }
                                keywords={[`customer ${customer.name ?? ""}`, customer.phone ?? "", customer.email ?? ""]}
                            >
                                <Users className="size-4 text-muted-foreground" />
                                <span className="truncate">{customer.name}</span>
                                {customer.phone ? (
                                    <span className="ml-auto text-xs text-muted-foreground">
                                        {customer.phone}
                                    </span>
                                ) : null}
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ) : null}

                {/* ── Modules ───────────────────────────────────────── */}
                {!isSearching ? (
                    <CommandGroup heading="Go to">
                        {navigation.map((item) => (
                            <CommandItem
                                key={item.href + item.label}
                                value={`nav-${item.href}-${item.label}`}
                                onSelect={() => go(item.href)}
                                keywords={[item.label, item.id, "module"]}
                            >
                                <item.icon className="size-4 text-muted-foreground" />
                                <span>{t(item.label)}</span>
                            </CommandItem>
                        ))}
                    </CommandGroup>
                ) : null}

                {/* ── Actions ───────────────────────────────────────── */}
                {!isSearching && actions.length > 0 ? (
                    <>
                        <CommandSeparator />
                        <CommandGroup heading="Actions">
                            {actions.map((action) => (
                                <CommandItem
                                    key={action.id}
                                    value={`action-${action.id}-${action.label}`}
                                    onSelect={action.onSelect}
                                    keywords={action.keywords ? action.keywords.split(" ") : undefined}
                                >
                                    <action.icon className="size-4 text-muted-foreground" />
                                    <span>{t(action.label)}</span>
                                    {action.hint ? (
                                        <span className="ml-auto text-xs text-muted-foreground">
                                            {t(action.hint)}
                                        </span>
                                    ) : null}
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </>
                ) : null}
            </CommandList>

            <div className="flex items-center justify-between gap-4 border-t border-border/60 px-3 py-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                    <CornerDownLeft className="size-3" aria-hidden />
                    to open
                    <span className="mx-1 h-3 w-px bg-border" aria-hidden />
                    <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-xs">
                        esc
                    </kbd>
                    to close
                </span>
                <Badge variant="neutral" className="gap-1">
                    <Search className="size-3" aria-hidden />
                    {searching ? "Searching" : "⌘K"}
                </Badge>
            </div>
        </CommandDialog>
    );
}

/* ────────────────────────────── the trigger ──────────────────────────── */

/**
 * The button that opens the palette. It shows the shortcut, because a
 * shortcut nobody can see is a shortcut nobody uses.
 */
export function CommandPaletteTrigger({
    onOpen,
    className,
}: {
    onOpen: () => void;
    className?: string;
}) {
    
    const t = useT();return (
        <button
            type="button"
            onClick={onOpen}
            className={cn(
                "group flex h-9 w-full items-center gap-2 rounded-lg border border-border/70 bg-muted/40 px-3 text-sm text-muted-foreground transition-colors",
                "hover:border-primary/40 hover:bg-muted hover:text-foreground",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                className
            )}
        >
            <Search className="size-4 shrink-0" aria-hidden />
            <span className="flex-1 text-left">{t("Search…")}</span>
            <kbd className="hidden shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-xs font-medium text-muted-foreground sm:inline-block">
                {t("⌘K")}
            </kbd>
        </button>
    );
}
