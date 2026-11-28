"use client";

/**
 * SMART_BUZ — the page shell.
 *
 * Every screen in the product is built from these five pieces. Before they
 * existed there were two different page-header systems, two different
 * spacing scales and three different status palettes, so two screens that
 * sat side by side in the sidebar did not look like they belonged to the
 * same product.
 *
 * The rule the whole app now follows:
 *
 *   PageContainer
 *     └── PageHeader      — who you are and what you can do here
 *           └── StatGrid  — the numbers, if there are numbers
 *                 └── SectionCard — a titled block of content
 *
 * Anything that is not one of those is a bug waiting to happen.
 */

import Link from "next/link";
import * as React from "react";
import {
    ArrowDownRight,
    ArrowUpRight,
    Loader2,
    type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n/provider";

/* ────────────────────────────── container ────────────────────────────── */

/**
 * The single page container. One width, one padding, one vertical rhythm.
 */
export function PageContainer({
    className,
    children,
    ...props
}: React.ComponentProps<"div">) {
    return (
        <div
            className={cn(
                "mx-auto w-full max-w-[1600px] space-y-6 px-4 py-5 sm:px-6 sm:py-6 lg:px-8",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}

/* ──────────────────────────────── header ─────────────────────────────── */

export interface PageHeaderProps {
    title: React.ReactNode;
    description?: React.ReactNode;
    /** The small line above the title: a business vertical, a record type. */
    eyebrow?: React.ReactNode;
    /** A badge beside the title — a count, a status, a branch. */
    badge?: React.ReactNode;
    /**
     * The icon beside the title. Any component that takes a `className` works,
     * so a page can pass a Lucide icon without the shell demanding a
     * particular icon type.
     */
    icon?: React.ComponentType<{ className?: string }>;
    /** Buttons on the right. */
    actions?: React.ReactNode;
    /** A second row under the title: filters, tabs, a scope control. */
    toolbar?: React.ReactNode;
    className?: string;
}

export function PageHeader({
    title,
    description,
    eyebrow,
    badge,
    icon: Icon,
    actions,
    toolbar,
    className,
}: PageHeaderProps) {
    return (
        <header
            className={cn(
                "flex flex-col gap-4 border-b border-border/60 pb-5",
                "lg:flex-row lg:items-start lg:justify-between lg:gap-6",
                className
            )}
        >
            <div className="flex min-w-0 items-start gap-3">
                {Icon ? (
                    <div
                        className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-xl",
                            "bg-primary/10 text-primary ring-1 ring-inset ring-primary/15"
                        )}
                    >
                        <Icon className="size-5" aria-hidden />
                    </div>
                ) : null}

                <div className="min-w-0 space-y-1">
                    {eyebrow ? (
                        <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                            {eyebrow}
                        </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2.5">
                        <h1 className="truncate text-page-title text-foreground">
                            {title}
                        </h1>
                        {badge}
                    </div>

                    {description ? (
                        <p className="max-w-3xl text-sm text-muted-foreground">
                            {description}
                        </p>
                    ) : null}
                </div>
            </div>

            {actions ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                    {actions}
                </div>
            ) : null}

            {toolbar ? (
                <div className="flex flex-wrap items-center gap-2 lg:hidden">
                    {toolbar}
                </div>
            ) : null}
        </header>
    );
}

/* ───────────────────────────────── stats ─────────────────────────────── */

export type StatTone = "default" | "success" | "warning" | "danger" | "info";

const STAT_TONES: Record<StatTone, string> = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
};

const STAT_ICON_TONES: Record<StatTone, string> = {
    default: "bg-muted text-muted-foreground",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    danger: "bg-danger/10 text-danger",
    info: "bg-info/10 text-info",
};

export interface StatCardProps {
    label: string;
    value: React.ReactNode;
    /** A short sentence under the value explaining what the number means. */
    hint?: React.ReactNode;
    /** The change against the previous period. */
    delta?: number | null;
    deltaLabel?: string;
    icon?: LucideIcon;
    tone?: StatTone;
    /** Makes the whole card a link. */
    href?: string;
    isLoading?: boolean;
    className?: string;
}

/**
 * One number, said clearly.
 *
 * The product had three different stat-tile implementations, each with its
 * own padding and its own idea of what a label looks like. This is the only
 * one.
 */
export function StatCard({
    label,
    value,
    hint,
    delta,
    deltaLabel,
    icon: Icon,
    tone = "default",
    href,
    isLoading,
    className,
}: StatCardProps) {
    const body = (
        <>
            <div className="flex items-start justify-between gap-3">
                <p className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                    {label}
                </p>
                {Icon ? (
                    <span
                        className={cn(
                            "flex size-7 shrink-0 items-center justify-center rounded-lg",
                            STAT_ICON_TONES[tone]
                        )}
                    >
                        <Icon className="size-3.5" aria-hidden />
                    </span>
                ) : null}
            </div>

            {isLoading ? (
                <Skeleton className="mt-2 h-8 w-28" />
            ) : (
                <p
                    className={cn(
                        "mt-1.5 text-stat tabular-nums",
                        STAT_TONES[tone]
                    )}
                >
                    {value}
                </p>
            )}

            {delta !== undefined && delta !== null && !isLoading ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <span
                        className={cn(
                            "inline-flex items-center gap-0.5 font-semibold tabular-nums",
                            delta > 0
                                ? "text-success"
                                : delta < 0
                                  ? "text-danger"
                                  : "text-muted-foreground"
                        )}
                    >
                        {delta > 0 ? (
                            <ArrowUpRight className="size-3.5" aria-hidden />
                        ) : delta < 0 ? (
                            <ArrowDownRight className="size-3.5" aria-hidden />
                        ) : null}
                        {delta > 0 ? "+" : ""}
                        {delta}%
                    </span>
                    {deltaLabel ? (
                        <span className="text-muted-foreground">{deltaLabel}</span>
                    ) : null}
                </div>
            ) : null}

            {hint && !isLoading ? (
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {hint}
                </p>
            ) : null}
        </>
    );

    const shell = cn(
        "group rounded-xl border border-border/70 bg-card p-4 shadow-xs transition-all",
        "hover:border-border hover:shadow-sm",
        href && "hover:border-primary/40 focus-visible:border-primary",
        className
    );

    if (href) {
        return (
            <Link href={href} className={cn(shell, "block")}>
                {body}
            </Link>
        );
    }

    return <div className={shell}>{body}</div>;
}

export function StatGrid({
    children,
    columns = 4,
    className,
}: {
    children: React.ReactNode;
    columns?: 2 | 3 | 4 | 5;
    className?: string;
}) {
    return (
        <div
            className={cn(
                "grid gap-3",
                columns === 2 && "sm:grid-cols-2",
                columns === 3 && "sm:grid-cols-2 lg:grid-cols-3",
                columns === 4 && "sm:grid-cols-2 lg:grid-cols-4",
                columns === 5 && "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5",
                className
            )}
        >
            {children}
        </div>
    );
}

/* ──────────────────────────────── sections ───────────────────────────── */

export function SectionCard({
    title,
    description,
    actions,
    icon: Icon,
    footer,
    padded = true,
    className,
    bodyClassName,
    children,
    ...props
}: React.ComponentProps<"section"> & {
    title?: React.ReactNode;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    icon?: LucideIcon;
    footer?: React.ReactNode;
    padded?: boolean;
    bodyClassName?: string;
}) {
    return (
        <section
            className={cn(
                "flex flex-col overflow-hidden rounded-xl border border-border/70 bg-card shadow-xs",
                className
            )}
            {...props}
        >
            {title || actions ? (
                <header className="flex flex-col gap-3 border-b border-border/60 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-start gap-2.5">
                        {Icon ? (
                            <Icon
                                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                            />
                        ) : null}
                        <div className="min-w-0">
                            {title ? (
                                <h2 className="text-section-title text-foreground">
                                    {title}
                                </h2>
                            ) : null}
                            {description ? (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                    {description}
                                </p>
                            ) : null}
                        </div>
                    </div>
                    {actions ? (
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {actions}
                        </div>
                    ) : null}
                </header>
            ) : null}

            <div
                className={cn(
                    "flex-1",
                    padded ? "p-4 sm:p-5" : "",
                    bodyClassName
                )}
            >
                {children}
            </div>

            {footer ? (
                <footer className="border-t border-border/60 bg-muted/30 px-4 py-3 sm:px-5">
                    {footer}
                </footer>
            ) : null}
        </section>
    );
}

/* ───────────────────────────────── states ────────────────────────────── */

/**
 * The three states every data view can be in, in one place.
 *
 * Before this, 18 of the 45 dashboard pages had no empty state at all — they
 * just showed a blank table — and the loading states were ad-hoc blocks of
 * grey bars. An operator could not tell "no results" from "still loading".
 */
export function DataState({
    isLoading,
    error,
    isEmpty,
    loadingRows = 4,
    emptyTitle = "Nothing here yet",
    emptyHint,
    emptyAction,
    onRetry,
    children,
}: {
    isLoading?: boolean;
    error?: unknown;
    isEmpty?: boolean;
    loadingRows?: number;
    emptyTitle?: string;
    emptyHint?: React.ReactNode;
    emptyAction?: React.ReactNode;
    onRetry?: () => void;
    children: React.ReactNode;
}) {
    
    const t = useT();if (isLoading) {
        return (
            <div className="space-y-2" aria-busy="true" aria-live="polite">
                <span className="sr-only">{t("Loading")}</span>
                {Array.from({ length: loadingRows }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
            </div>
        );
    }

    if (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Something went wrong while loading this.";
        return (
            <div
                role="alert"
                className="flex flex-col items-start gap-3 rounded-xl border border-danger/25 bg-danger/5 p-4"
            >
                <div className="space-y-1">
                    <p className="text-sm font-semibold text-danger">
                        {t("This could not be loaded")}
                    </p>
                    <p className="text-sm text-muted-foreground">{message}</p>
                </div>
                {onRetry ? (
                    <Button variant="outline" size="sm" onClick={onRetry}>
                        {t("Try again")}
                    </Button>
                ) : null}
            </div>
        );
    }

    if (isEmpty) {
        return (
            <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
                <p className="text-sm font-semibold text-foreground">
                    {emptyTitle}
                </p>
                {emptyHint ? (
                    <p className="max-w-md text-sm text-muted-foreground">
                        {emptyHint}
                    </p>
                ) : null}
                {emptyAction}
            </div>
        );
    }

    return <>{children}</>;
}

/* ─────────────────────────────── toolbar ─────────────────────────────── */

/**
 * The strip above a table: the search box, the filters, the export button and
 * the bulk actions. Every list screen used to arrange these differently.
 */
export function Toolbar({
    children,
    className,
    ...props
}: React.ComponentProps<"div">) {
    return (
        <div
            className={cn(
                "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}

export function ToolbarGroup({
    children,
    className,
    ...props
}: React.ComponentProps<"div">) {
    return (
        <div
            className={cn("flex flex-wrap items-center gap-2", className)}
            {...props}
        >
            {children}
        </div>
    );
}

/* ──────────────────────────────── misc ───────────────────────────────── */

/** A quiet, consistent label for a column heading or a field. */
export function Eyebrow({
    children,
    className,
}: {
    children: React.ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                "text-eyebrow uppercase tracking-eyebrow text-muted-foreground",
                className
            )}
        >
            {children}
        </span>
    );
}

/** A count that sits beside a heading. */
export function CountBadge({
    children,
    tone = "neutral",
}: {
    children: React.ReactNode;
    tone?: "neutral" | "info" | "success" | "warning" | "danger";
}) {
    return (
        <Badge variant={tone} className="font-semibold tabular-nums">
            {children}
        </Badge>
    );
}

/** A button that shows a spinner and cannot be pressed twice. */
export function ActionButton({
    pending,
    children,
    ...props
}: React.ComponentProps<typeof Button> & { pending?: boolean }) {
    return (
        <Button {...props} disabled={props.disabled || pending}>
            {pending ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            {children}
        </Button>
    );
}
