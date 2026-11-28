"use client";

/**
 * SMART_BUZ — Till & Cash Reconciliation
 *
 * Cash-shift management. Every cashier opens a till with a float and closes
 * it against counted cash, so variance is visible instead of guessed.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Why this page reads from `finance` and not from `verticals.operations`
 * ────────────────────────────────────────────────────────────────────────
 *
 * It used to use a second, parallel set of tables (`tillSessions`) whose
 * "expected cash" was a number the browser supplied. The form pre-filled it
 * with the opening float, so the variance was counted minus the float — the
 * cash taken during the shift was never part of the comparison, and a till
 * that had taken a thousand in sales would report a thousand missing.
 *
 * The real shift model already exists in `convex/finance.ts`: it adds the
 * cash sales, the money put in and the money taken out to the opening float
 * and works out the variance on the server, where the numbers cannot be
 * faked. This page uses that model, and the expected figure is shown to the
 * operator rather than asked of them.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    PageHeader,
    SectionCard,
    StatCard,
    StatGrid,
    DataState,
} from "@/components/app/page-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Wallet, Lock, AlertTriangle, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { useCurrency } from "@/hooks/use-currency";
import { statusTone } from "@/lib/status-tone";
import { useT } from "@/i18n/provider";

function money(amount: number | undefined | null, currency: string): string {
    return `${currency} ${Math.round(amount ?? 0).toLocaleString("en-UG")}`;
}

function shortDate(value?: string | null): string {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-UG", {
        day: "2-digit",
        month: "short",
        year: "numeric",
    });
}

function shortTime(value?: string | null): string {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleTimeString("en-UG", {
        hour: "2-digit",
        minute: "2-digit",
    });
}

export default function TillPage() {
    
    const t = useT();const { currency } = useCurrency();
    const [openOpen, setOpenOpen] = useState(false);
    const [closeFor, setCloseFor] = useState<any>(null);
    const [tab, setTab] = useState<"open" | "closed">("open");

    const [floatValue, setFloatValue] = useState("0");
    const [openNotes, setOpenNotes] = useState("");
    const [opening, setOpening] = useState(false);

    const [countedCash, setCountedCash] = useState("");
    const [closeNotes, setCloseNotes] = useState("");
    const [closing, setClosing] = useState(false);

    const openSessions = useQuery(api.finance.listShifts, {
        status: "open",
        limit: 50,
    });
    const closedSessions = useQuery(api.finance.listShifts, {
        status: "closed",
        limit: 50,
    });

    const openShift = useMutation(api.finance.openShift);
    const closeShift = useMutation(api.finance.closeShift);

    const sessions = tab === "open" ? openSessions : closedSessions;
    const rows = sessions?.page ?? [];

    const totalFloat = (openSessions?.page ?? []).reduce(
        (s: number, x: any) => s + (x.openingFloat ?? 0),
        0
    );
    const totalVariance = (closedSessions?.page ?? []).reduce(
        (s: number, x: any) => s + (x.variance ?? 0),
        0
    );
    const shortCount = (closedSessions?.page ?? []).filter(
        (x: any) => Math.abs(x.variance ?? 0) > 0.01
    ).length;

    /* ── Open a shift ─────────────────────────────────────────────── */
    const handleOpen = async () => {
        setOpening(true);
        try {
            await openShift({
                openingFloat: Number(floatValue) || 0,
                notes: openNotes || undefined,
            });
            toast.success("Till opened");
            setOpenOpen(false);
            setFloatValue("0");
            setOpenNotes("");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setOpening(false);
        }
    };

    /* ── Close a shift ─────────────────────────────────────────────── */
    const handleClose = async () => {
        if (!closeFor) return;
        setClosing(true);
        try {
            const res: any = await closeShift({
                shiftId: closeFor._id,
                countedCash: Number(countedCash) || 0,
                notes: closeNotes || undefined,
            });
            const v = res?.variance ?? 0;
            toast.success(
                Math.abs(v) < 0.01
                    ? "Till closed — the cash matches exactly"
                    : `Till closed — variance ${v > 0 ? "+" : ""}${money(v, currency)}`
            );
            setCloseFor(null);
            setCountedCash("");
            setCloseNotes("");
        } catch (err) {
            toast.error(formatError(err));
        } finally {
            setClosing(false);
        }
    };

    const varianceTone = (value: number) =>
        value < 0 ? "text-danger" : value > 0 ? "text-warning" : "text-success";

    return (
        <div className="space-y-6">
            <PageHeader
                icon={Wallet}
                title={t("Till & Cash Reconciliation")}
                description={t("Open a cash float at the start of a shift, and reconcile the drawer against what should be in it.")}
                badge={
                    <Badge variant="neutral">
                        {openSessions?.totalCount ?? 0} open
                    </Badge>
                }
                actions={
                    <Button onClick={() => setOpenOpen(true)}>
                        <Lock className="mr-2 size-4" />
                        {t("Open till")}
                    </Button>
                }
            />

            <StatGrid>
                <StatCard
                    label={t("Open tills")}
                    value={openSessions?.totalCount ?? 0}
                    hint={t("Shifts currently in progress")}
                />
                <StatCard
                    label={t("Cash in the drawer")}
                    value={money(totalFloat, currency)}
                    hint={t("Opening float across open shifts")}
                />
                <StatCard
                    label={t("Closed shifts")}
                    value={closedSessions?.totalCount ?? 0}
                />
                <StatCard
                    label={t("Net variance")}
                    value={money(totalVariance, currency)}
                    tone={
                        totalVariance < 0
                            ? "danger"
                            : totalVariance > 0
                              ? "warning"
                              : "success"
                    }
                    hint={
                        shortCount > 0
                            ? `${shortCount} of these shifts did not balance`
                            : "Every closed shift balanced"
                    }
                />
            </StatGrid>

            <SectionCard
                title={tab === "open" ? "Open tills" : "Closed shifts"}
                description={
                    tab === "open"
                        ? "Shifts that are still running. Close one to reconcile its cash."
                        : "Every closed shift, with the difference between the count and what should have been there."
                }
                padded={false}
                actions={
                    <div className="flex items-center gap-1.5">
                        <Button
                            size="sm"
                            variant={tab === "open" ? "default" : "outline"}
                            onClick={() => setTab("open")}
                        >
                            {t("Open")}
                        </Button>
                        <Button
                            size="sm"
                            variant={tab === "closed" ? "default" : "outline"}
                            onClick={() => setTab("closed")}
                        >
                            {t("Closed")}
                        </Button>
                    </div>
                }
                bodyClassName="px-0 pb-0"
            >
                <DataState
                    isLoading={!sessions}
                    isEmpty={rows.length === 0}
                    emptyTitle={
                        tab === "open" ? "No open tills" : "No closed shifts yet"
                    }
                    emptyHint={
                        tab === "open"
                            ? "Open a till with your cash float before you start selling."
                            : "Closed shifts, with their cash variance, will appear here."
                    }
                    emptyAction={
                        tab === "open" ? (
                            <Button size="sm" onClick={() => setOpenOpen(true)}>
                                {t("Open till")}
                            </Button>
                        ) : undefined
                    }
                    loadingRows={3}
                >
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent">
                                <TableHead className="pl-4">{t("Shift")}</TableHead>
                                <TableHead>{t("Cashier")}</TableHead>
                                <TableHead>{t("Opened")}</TableHead>
                                <TableHead className="text-right">{t("Float")}</TableHead>
                                <TableHead className="text-right">
                                    {tab === "open" ? "Cash taken" : "Variance"}
                                </TableHead>
                                <TableHead className="pr-4 text-right">
                                    <span className="sr-only">{t("Actions")}</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {rows.map((s: any) => (
                                <TableRow key={s._id}>
                                    <TableCell className="pl-4">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono text-xs text-muted-foreground">
                                                {s.sessionNumber ??
                                                    shortTime(s.openedAt)}
                                            </span>
                                            <Badge
                                                variant={
                                                    s.status === "open"
                                                        ? "success"
                                                        : statusTone(s.status)
                                                }
                                            >
                                                {s.status}
                                            </Badge>
                                        </div>
                                    </TableCell>
                                    <TableCell className="font-medium">
                                        {s.userName ?? "—"}
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground">
                                        {shortDate(s.openedAt)}
                                        {s.closedAt
                                            ? ` · ${shortTime(s.closedAt)}`
                                            : ""}
                                    </TableCell>
                                    <TableCell className="text-right tabular-nums">
                                        {money(s.openingFloat, currency)}
                                    </TableCell>
                                    <TableCell
                                        className={cn(
                                            "text-right tabular-nums",
                                            tab === "closed"
                                                ? varianceTone(s.variance ?? 0)
                                                : "text-muted-foreground"
                                        )}
                                    >
                                        {tab === "open"
                                            ? "—"
                                            : money(s.variance ?? 0, currency)}
                                    </TableCell>
                                    <TableCell className="pr-4 text-right">
                                        {s.status === "open" ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => {
                                                    setCloseFor(s);
                                                    setCountedCash("");
                                                    setCloseNotes("");
                                                }}
                                            >
                                                {t("Close")}
                                            </Button>
                                        ) : null}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </DataState>
            </SectionCard>

            {/* ── Open a shift ─────────────────────────────────────── */}
            <Dialog open={openOpen} onOpenChange={setOpenOpen}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{t("Open a till session")}</DialogTitle>
                        <DialogDescription>
                            {t("Enter the cash you are starting the shift with. You can only have one open session at a time.")}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="openingFloat">
                                {t("Opening cash float (")}{currency})
                            </Label>
                            <Input
                                id="openingFloat"
                                type="number"
                                min={0}
                                value={floatValue}
                                onChange={(e) => setFloatValue(e.target.value)}
                                className="tabular-nums"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="openNotes">{t("Notes")}</Label>
                            <Textarea
                                id="openNotes"
                                rows={3}
                                value={openNotes}
                                onChange={(e) => setOpenNotes(e.target.value)}
                                placeholder={t("Anything worth remembering about this shift")}
                            />
                        </div>
                    </div>

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setOpenOpen(false)}
                            disabled={opening}
                        >
                            {t("Cancel")}
                        </Button>
                        <Button onClick={handleOpen} disabled={opening}>
                            {opening ? "Opening…" : "Open till"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Close a shift ────────────────────────────────────── */}
            <Dialog
                open={!!closeFor}
                onOpenChange={(v) => !v && setCloseFor(null)}
            >
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>
                            {t("Close the till")}
                            {closeFor?.sessionNumber
                                ? ` — ${closeFor.sessionNumber}`
                                : ""}
                        </DialogTitle>
                        <DialogDescription>
                            {t("Count the cash in the drawer and enter it. The expected figure is worked out from the sales you took and the money you moved in and out — it is not asked of you.")}
                        </DialogDescription>
                    </DialogHeader>

                    {closeFor ? (
                        <div className="space-y-4">
                            <div className="rounded-xl border border-border/70 bg-muted/40 p-4">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        {t("Opening float")}
                                    </span>
                                    <span className="font-medium tabular-nums">
                                        {money(closeFor.openingFloat, currency)}
                                    </span>
                                </div>
                                <div className="mt-2 flex items-center justify-between text-sm">
                                    <span className="text-muted-foreground">
                                        {t("Expected in the drawer")}
                                    </span>
                                    <span className="font-semibold tabular-nums text-foreground">
                                        {money(
                                            closeFor.expectedCash ??
                                                closeFor.openingFloat,
                                            currency
                                        )}
                                    </span>
                                </div>
                                <p className="mt-2 text-xs text-muted-foreground">
                                    {t("The expected figure is finalised by the server when you close, from the cash sales and the cash movements on this shift.")}
                                </p>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="countedCash">
                                    {t("Counted cash (")}{currency})
                                </Label>
                                <Input
                                    id="countedCash"
                                    type="number"
                                    min={0}
                                    value={countedCash}
                                    onChange={(e) => setCountedCash(e.target.value)}
                                    className="tabular-nums"
                                    placeholder="0"
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="closeNotes">{t("Notes")}</Label>
                                <Textarea
                                    id="closeNotes"
                                    rows={3}
                                    value={closeNotes}
                                    onChange={(e) => setCloseNotes(e.target.value)}
                                    placeholder={t("Why the drawer did not balance, if it did not")}
                                />
                            </div>
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setCloseFor(null)}
                            disabled={closing}
                        >
                            {t("Cancel")}
                        </Button>
                        <Button onClick={handleClose} disabled={closing}>
                            {closing ? "Closing…" : "Close till"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
