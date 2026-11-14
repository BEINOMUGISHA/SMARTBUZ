"use client";

/**
 * SMART_BUZ — Vertical UI Kit
 *
 * Shared building blocks for the per-vertical pages. Every vertical page uses
 * these so the whole product looks like one system regardless of trade.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/* ───────────────────────── page header ───────────────────────── */

export function VerticalPageHeader({
    title,
    description,
    icon: Icon,
    actions,
}: {
    title: string;
    description: string;
    icon?: React.ComponentType<{ className?: string }>;
    actions?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
                {Icon && (
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                        <Icon className="h-5 w-5" />
                    </div>
                )}
                <div>
                    <h1 className="text-2xl font-black tracking-tight">{title}</h1>
                    <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                </div>
            </div>
            {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

/* ───────────────────────── stat strip ───────────────────────── */

export function StatStrip({
    stats,
}: {
    stats: Array<{
        label: string;
        value: string | number;
        tone?: "default" | "warn" | "danger" | "good";
    }>;
}) {
    const tones = {
        default: "text-foreground",
        warn: "text-amber-600 dark:text-amber-400",
        danger: "text-red-600 dark:text-red-400",
        good: "text-emerald-600 dark:text-emerald-400",
    };
    return (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {stats.map((s) => (
                <div key={s.label} className="rounded-xl border bg-card p-4 shadow-sm">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        {s.label}
                    </p>
                    <p className={cn("mt-1 text-2xl font-black tabular-nums", tones[s.tone ?? "default"])}>
                        {s.value}
                    </p>
                </div>
            ))}
        </div>
    );
}

/* ───────────────────────── status badge ───────────────────────── */

const STATUS_TONES: Record<string, string> = {
    // success family
    available: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    completed: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    delivered: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    received: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    paid: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    present: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    good: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    // warning family
    pending: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    occupied: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    reserved: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    confirmed: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    in_progress: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    dispatched: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    ordered: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    cleaning: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    ready: "bg-teal-500/10 text-teal-700 dark:text-teal-400 border-teal-500/20",
    // danger family
    expired: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    cancelled: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    failed: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    absent: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    // neutral
    draft: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    open: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    out: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    returned: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    idle: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    late: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    excused: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/20",
    no_show: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    in_stock: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
    sold: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    returned_stock: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    faulty: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    overdue: "bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/20",
    expiring: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20",
    no_expiry: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
    closed: "bg-zinc-500/10 text-zinc-700 dark:text-zinc-400 border-zinc-500/20",
};

export function StatusBadge({
    status,
    className,
}: {
    status: string;
    className?: string;
}) {
    const key = status.toLowerCase().replace(/\s+/g, "_");
    const tone =
        STATUS_TONES[key] ?? "bg-muted text-muted-foreground border-border";
    return (
        <Badge variant="outline" className={cn("text-[10px] font-bold capitalize", tone, className)}>
            {status.replace(/_/g, " ")}
        </Badge>
    );
}

/* ───────────────────────── search box ───────────────────────── */

export function SearchBox({
    value,
    onChange,
    placeholder = "Search...",
    className,
}: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string;
}) {
    return (
        <div className={cn("relative", className)}>
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="pl-9"
            />
        </div>
    );
}

/* ───────────────────────── states ───────────────────────── */

export function LoadingState({ rows = 3 }: { rows?: number }) {
    return (
        <div className="space-y-3">
            {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
            ))}
        </div>
    );
}

export function EmptyState({
    title = "No records yet",
    hint,
    action,
}: {
    title?: string;
    hint?: string;
    action?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-center">
            <p className="text-sm font-bold">{title}</p>
            {hint && <p className="max-w-sm text-xs text-muted-foreground">{hint}</p>}
            {action}
        </div>
    );
}

/* ───────────────────────── form dialog ───────────────────────── */

export interface FormField {
    name: string;
    label: string;
    type?: "text" | "number" | "date" | "time" | "email" | "tel" | "textarea" | "select";
    placeholder?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
    defaultValue?: string | number;
    hint?: string;
    min?: number;
    step?: number;
    full?: boolean;
}

export function FormDialog({
    open,
    onOpenChange,
    title,
    description,
    fields,
    onSubmit,
    submitLabel = "Save",
    children,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    title: string;
    description?: string;
    fields: FormField[];
    onSubmit: (values: Record<string, string>) => Promise<void>;
    submitLabel?: string;
    children?: React.ReactNode;
}) {
    const [values, setValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const setValue = (name: string, v: string) =>
        setValues((prev) => ({ ...prev, [name]: v }));

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        // Validate required fields before hitting the backend.
        for (const f of fields) {
            if (f.required && !String(values[f.name] ?? "").trim()) {
                setError(`${f.label} is required.`);
                return;
            }
            if (f.type === "number" && values[f.name]) {
                const n = Number(values[f.name]);
                if (Number.isNaN(n)) {
                    setError(`${f.label} must be a number.`);
                    return;
                }
                if (f.min !== undefined && n < f.min) {
                    setError(`${f.label} must be at least ${f.min}.`);
                    return;
                }
            }
        }

        setSubmitting(true);
        try {
            await onSubmit(values);
            setValues({});
            onOpenChange(false);
        } catch (err: any) {
            setError(err?.message ?? "Could not save. Please try again.");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </DialogHeader>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid gap-4 sm:grid-cols-2">
                        {fields.map((f) => (
                            <div key={f.name} className={cn("space-y-2", f.full && "sm:col-span-2")}>
                                <Label htmlFor={`vf-${f.name}`}>
                                    {f.label}
                                    {f.required && <span className="text-destructive"> *</span>}
                                </Label>
                                {f.type === "textarea" ? (
                                    <textarea
                                        id={`vf-${f.name}`}
                                        value={values[f.name] ?? f.defaultValue ?? ""}
                                        onChange={(e) => setValue(f.name, e.target.value)}
                                        placeholder={f.placeholder}
                                        className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    />
                                ) : f.type === "select" ? (
                                    <select
                                        id={`vf-${f.name}`}
                                        value={values[f.name] ?? f.defaultValue ?? ""}
                                        onChange={(e) => setValue(f.name, e.target.value)}
                                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    >
                                        <option value="">Select…</option>
                                        {f.options?.map((o) => (
                                            <option key={o.value} value={o.value}>
                                                {o.label}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <Input
                                        id={`vf-${f.name}`}
                                        type={f.type ?? "text"}
                                        min={f.min}
                                        step={f.step}
                                        value={values[f.name] ?? f.defaultValue ?? ""}
                                        onChange={(e) => setValue(f.name, e.target.value)}
                                        placeholder={f.placeholder}
                                    />
                                )}
                                {f.hint && (
                                    <p className="text-[10px] text-muted-foreground">{f.hint}</p>
                                )}
                            </div>
                        ))}
                    </div>

                    {children}

                    {error && (
                        <p className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                            {error}
                        </p>
                    )}

                    <DialogFooter>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => onOpenChange(false)}
                            disabled={submitting}
                        >
                            Cancel
                        </Button>
                        <Button type="submit" disabled={submitting}>
                            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                            {submitLabel}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}

/** Convenience: a "New" button that opens a FormDialog. */
export function CreateButton({
    onClick,
    label = "New",
}: {
    onClick: () => void;
    label?: string;
}) {
    return (
        <Button onClick={onClick} size="sm">
            <Plus className="mr-2 h-4 w-4" />
            {label}
        </Button>
    );
}

/* ───────────────────────── list card ───────────────────────── */

export function RecordList({
    records,
    renderItem,
    empty,
}: {
    records: unknown[];
    renderItem: (record: any, index: number) => React.ReactNode;
    empty?: React.ReactNode;
}) {
    if (records.length === 0) {
        return <>{empty ?? <EmptyState />}</>;
    }
    return (
        <div className="space-y-2">
            {records.map((r, i) => (
                <div
                    key={(r as any)?._id ?? i}
                    className="rounded-xl border bg-card p-3 shadow-sm transition-colors hover:border-primary/30"
                >
                    {renderItem(r, i)}
                </div>
            ))}
        </div>
    );
}

/* ───────────────────────── formatters ───────────────────────── */

export function ugx(amount: number | undefined | null): string {
    return `UGX ${Math.round(amount ?? 0).toLocaleString("en-UG")}`;
}

export function shortDate(value?: string | null): string {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-UG", { day: "2-digit", month: "short", year: "numeric" });
}

export function today(): string {
    return new Date().toISOString().slice(0, 10);
}
