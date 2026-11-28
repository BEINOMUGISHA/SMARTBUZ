"use client";

/**
 * SMART_BUZ — Vertical UI Kit
 *
 * Shared building blocks for the per-vertical pages. Every vertical page uses
 * these so the whole product looks like one system regardless of trade.
 *
 * The kit used to be create-only: thirteen pages could add a record and
 * never amend one, because the only form it offered was "new record". It
 * now carries the whole lifecycle — create, edit, delete, view — so a page
 * gets all four by using the kit, not by writing them again.
 */

import { useEffect, useRef, useState } from "react";
import { businessCurrency } from "@/lib/currency";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Eye,
    Loader2,
    MoreHorizontal,
    Pencil,
    Plus,
    Search,
    Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { describeError, isReported } from "@/components/error-feedback";
import { statusLabel, statusTone } from "@/lib/status-tone";
import { useT } from "@/i18n/provider";
import {
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
} from "@/components/app/page-shell";

/* ───────────────────────── page header ───────────────────────── */

/**
 * The vertical page header. It is now the same component the rest of the
 * product uses — there is one header system, not two.
 */
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
        <PageHeader
            title={title}
            description={description}
            icon={Icon}
            actions={actions}
        />
    );
}

/* ───────────────────────── stat strip ───────────────────────── */

export function StatStrip({
    stats,
    className,
}: {
    stats: Array<{
        label: string;
        value: string | number;
        tone?: "default" | "warn" | "danger" | "good";
    }>;
    className?: string;
}) {
    
    const t = useT();const toneMap = {
        default: "default",
        warn: "warning",
        danger: "danger",
        good: "success",
    } as const;

    return (
        <StatGrid columns={stats.length >= 5 ? 5 : 4} className={className}>
            {stats.map((s) => (
                <StatCard
                    key={s.label}
                    label={t(s.label)}
                    value={s.value}
                    tone={toneMap[s.tone ?? "default"]}
                />
            ))}
        </StatGrid>
    );
}

/* ───────────────────────── status badge ───────────────────────── */

/**
 * The status badge. Its colours now come from the one status map in the
 * product, so a state reads the same on every screen.
 */
export function StatusBadge({
    status,
    className,
}: {
    status: string;
    className?: string;
}) {
    const tone = statusTone(status);
    return (
        <Badge
            variant={tone}
            className={cn("font-medium capitalize", className)}
        >
            {statusLabel(status)}
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
        <div className="space-y-3" aria-busy="true" aria-live="polite">
            {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-lg" />
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
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
            <p className="text-sm font-semibold text-foreground">{title}</p>
            {hint ? (
                <p className="max-w-md text-sm text-muted-foreground">{hint}</p>
            ) : null}
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

/**
 * The record form.
 *
 * It serves both "create" and "edit": hand it `initialValues` and the form
 * opens on the record as it stands, and the submit button says "Save
 * changes" instead of "Create". Before this, a page could only ever add.
 */
export function FormDialog({
    open,
    onOpenChange,
    title,
    description,
    fields,
    onSubmit,
    submitLabel = "Save",
    initialValues,
    children,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    title: string;
    description?: string;
    fields: FormField[];
    onSubmit: (values: Record<string, string>) => Promise<void>;
    submitLabel?: string;
    /** The record as it stands. Presence turns the form into an edit form. */
    initialValues?: Record<string, string>;
    children?: React.ReactNode;
}) {
    /**
     * `values` holds only what the operator actually typed. Everything else
     * falls back to the record as it stands.
     *
     * It used to hold the whole form, which meant an operator who changed one
     * field and left the rest alone sent a partial update — the untouched
     * fields arrived empty and the server blanked them. The form now always
     * submits every field, changed or not.
     */
    
    const t = useT();const [values, setValues] = useState<Record<string, string>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // The record being edited, kept fresh without making it an effect
    // dependency — the object is rebuilt on every render, and depending on it
    // would reset the form while the operator is typing in it.
    const initialRef = useRef(initialValues);
    initialRef.current = initialValues;
    const initialSignature = JSON.stringify(initialValues ?? null);

    // Start every opening on a clean sheet for the record in hand. Without
    // this, the edits of one record followed the operator to the next one.
    useEffect(() => {
        if (!open) return;
        setValues({});
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, initialSignature]);

    const setValue = (name: string, v: string) =>
        setValues((prev) => ({ ...prev, [name]: v }));

    /** The value of a field as it stands right now. */
    const currentValue = (name: string): string => {
        const typed = values[name];
        if (typed !== undefined) return typed;
        const record = initialRef.current;
        if (record && record[name] !== undefined) return record[name];
        const field = fields.find((f) => f.name === name);
        return field?.defaultValue !== undefined ? String(field.defaultValue) : "";
    };

    /** Every field's value — typed, recorded or default. */
    const resolvedValues = (): Record<string, string> => {
        const out: Record<string, string> = {};
        for (const f of fields) out[f.name] = currentValue(f.name);
        return out;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        const submitted = resolvedValues();

        // Validate required fields before hitting the backend.
        for (const f of fields) {
            if (f.required && !String(submitted[f.name] ?? "").trim()) {
                setError(`${f.label} is required.`);
                return;
            }
            if (f.type === "number" && submitted[f.name]) {
                const n = Number(submitted[f.name]);
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
            await onSubmit(submitted);
            setValues({});
            onOpenChange(false);
        } catch (err: any) {
            // The raw Convex message carries a request id and a stack trace.
            // The operator needs the sentence, not the telemetry. A failure
            // the caller has already reported is left alone, so the same
            // sentence is not shown twice.
            if (!isReported(err)) {
                setError(describeError(err, "Could not save. Please try again."));
            }
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
                        {fields.map((f) => {
                            const value = currentValue(f.name);

                            return (
                                <div key={f.name} className={cn("space-y-2", f.full && "sm:col-span-2")}>
                                    <Label htmlFor={`vf-${f.name}`}>
                                        {t(f.label)}
                                        {f.required && <span className="text-destructive"> *</span>}
                                    </Label>
                                    {f.type === "textarea" ? (
                                        <Textarea
                                            id={`vf-${f.name}`}
                                            value={value}
                                            onChange={(e) => setValue(f.name, e.target.value)}
                                            placeholder={t(f.placeholder)}
                                            rows={3}
                                        />
                                    ) : f.type === "select" ? (
                                        <Select
                                            value={value}
                                            onValueChange={(v) => setValue(f.name, v)}
                                        >
                                            <SelectTrigger id={`vf-${f.name}`} className="w-full">
                                                <SelectValue placeholder={t("Select…")} />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {f.options?.map((o) => (
                                                    <SelectItem key={o.value} value={o.value}>
                                                        {t(o.label)}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    ) : (
                                        <Input
                                            id={`vf-${f.name}`}
                                            type={f.type ?? "text"}
                                            min={f.min}
                                            step={f.step}
                                            value={value}
                                            onChange={(e) => setValue(f.name, e.target.value)}
                                            placeholder={t(f.placeholder)}
                                        />
                                    )}
                                    {f.hint && (
                                        <p className="text-xs text-muted-foreground">{t(f.hint)}</p>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {children}

                    {error && (
                        <p
                            role="alert"
                            className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
                        >
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
                            {t("Cancel")}
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

/**
 * The edit form. A thin wrapper that says what it is, so a page does not
 * have to pass `initialValues` and wonder which mode it is in.
 */
export function EditFormDialog({
    open,
    onOpenChange,
    title,
    description,
    fields,
    record,
    onSubmit,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    title: string;
    description?: string;
    fields: FormField[];
    /** The record being edited, already flattened into form values. */
    record: Record<string, string>;
    onSubmit: (values: Record<string, string>) => Promise<void>;
}) {
    return (
        <FormDialog
            open={open}
            onOpenChange={onOpenChange}
            title={title}
            description={description}
            fields={fields}
            initialValues={record}
            submitLabel="Save changes"
            onSubmit={onSubmit}
        />
    );
}

/* ───────────────────────── delete confirmation ───────────────────────── */

/**
 * Deleting something is not undoable, so it is always confirmed, and the
 * confirmation names the thing being deleted.
 */
export function ConfirmDeleteDialog({
    open,
    onOpenChange,
    onConfirm,
    entityName = "record",
    description,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    onConfirm: () => Promise<void>;
    entityName?: string;
    description?: string;
}) {
    
    const t = useT();const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleConfirm = async () => {
        setDeleting(true);
        setError(null);
        try {
            await onConfirm();
            onOpenChange(false);
        } catch (err: any) {
            if (!isReported(err)) {
                setError(describeError(err, "Could not delete. Please try again."));
            }
        } finally {
            setDeleting(false);
        }
    };

    return (
        <AlertDialog open={open} onOpenChange={onOpenChange}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{t("Delete this")} {entityName}?</AlertDialogTitle>
                    <AlertDialogDescription>
                        {description ??
                            `This removes the ${entityName} permanently. This cannot be undone.`}
                    </AlertDialogDescription>
                </AlertDialogHeader>

                {error ? (
                    <p
                        role="alert"
                        className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive"
                    >
                        {error}
                    </p>
                ) : null}

                <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleting}>{t("Keep it")}</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={(event) => {
                            // The alert dialog closes on click. Keep it open
                            // until the delete has actually succeeded.
                            event.preventDefault();
                            void handleConfirm();
                        }}
                        disabled={deleting}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {t("Delete")}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}

/* ───────────────────────── detail panel ───────────────────────── */

export interface DetailRow {
    label: string;
    value: React.ReactNode;
}

/**
 * The record detail, in a side panel.
 *
 * Before this, the only way to see anything about a record was the row it
 * sat in. A record with more than a name and a status had nowhere to put
 * the rest of itself.
 */
export function RecordDetail({
    open,
    onOpenChange,
    title,
    description,
    status,
    rows,
    footer,
}: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    title: React.ReactNode;
    description?: React.ReactNode;
    status?: string;
    rows: DetailRow[];
    footer?: React.ReactNode;
}) {
    
    const t = useT();return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
                <SheetHeader>
                    <SheetTitle className="flex items-center gap-2">
                        {title}
                        {status ? <StatusBadge status={status} /> : null}
                    </SheetTitle>
                    {description ? (
                        <SheetDescription>{description}</SheetDescription>
                    ) : null}
                </SheetHeader>

                <dl className="mt-6 space-y-px overflow-hidden rounded-xl border border-border/70">
                    {rows.map((row) => (
                        <div
                            key={row.label}
                            className="flex items-start justify-between gap-4 bg-card px-4 py-3"
                        >
                            <dt className="text-eyebrow uppercase tracking-eyebrow text-muted-foreground">
                                {t(row.label)}
                            </dt>
                            <dd className="min-w-0 break-words text-right text-sm font-medium text-foreground">
                                {row.value}
                            </dd>
                        </div>
                    ))}
                </dl>

                {footer ? (
                    <SheetFooter className="mt-6 sm:justify-end">{footer}</SheetFooter>
                ) : null}
            </SheetContent>
        </Sheet>
    );
}

/* ───────────────────────── row actions ───────────────────────── */

/**
 * The actions on a record row: view, edit, delete.
 *
 * A page that has a record it can look at should give the operator the
 * choice, in one place, instead of scattering three buttons across the row.
 */
export function RecordActions({
    onView,
    onEdit,
    onDelete,
    label = "Record actions",
}: {
    onView?: () => void;
    onEdit?: () => void;
    onDelete?: () => void;
    label?: string;
}) {
    
    const t = useT();if (!onView && !onEdit && !onDelete) return null;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 text-muted-foreground hover:text-foreground"
                >
                    <MoreHorizontal className="h-4 w-4" />
                    <span className="sr-only">{label}</span>
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                {onView ? (
                    <DropdownMenuItem onSelect={onView}>
                        <Eye className="h-4 w-4" />
                        {t("View details")}
                    </DropdownMenuItem>
                ) : null}
                {onEdit ? (
                    <DropdownMenuItem onSelect={onEdit}>
                        <Pencil className="h-4 w-4" />
                        {t("Edit")}
                    </DropdownMenuItem>
                ) : null}
                {onDelete ? (
                    <DropdownMenuItem
                        onSelect={onDelete}
                        className="text-destructive focus:text-destructive"
                    >
                        <Trash2 className="h-4 w-4" />
                        {t("Delete")}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
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
                    className="rounded-xl border border-border/70 bg-card p-3 shadow-xs transition-colors hover:border-primary/30"
                >
                    {renderItem(r, i)}
                </div>
            ))}
        </div>
    );
}

/* ───────────────────────── formatters ───────────────────────── */

export function ugx(amount: number | undefined | null, currency?: string | null): string {
    return `${businessCurrency(currency)} ${Math.round(amount ?? 0).toLocaleString("en-UG")}`;
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

/**
 * Flattens a record into the flat string map a `FormDialog` needs.
 *
 * Dates are trimmed to the day, because an `<input type="date">` will not
 * accept a full timestamp and would silently show the field as empty.
 */
export function toFormValues(
    record: Record<string, unknown> | null | undefined,
    fields: FormField[]
): Record<string, string> {
    const out: Record<string, string> = {};
    if (!record) return out;

    for (const field of fields) {
        const raw = record[field.name];
        if (raw === null || raw === undefined) {
            out[field.name] = "";
            continue;
        }
        if (field.type === "date") {
            const d = new Date(String(raw));
            out[field.name] = Number.isNaN(d.getTime())
                ? String(raw).slice(0, 10)
                : d.toISOString().slice(0, 10);
            continue;
        }
        out[field.name] = String(raw);
    }
    return out;
}
