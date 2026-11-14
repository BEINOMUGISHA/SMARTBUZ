"use client";

/**
 * SMART_BUZ — Till & Cash Reconciliation
 *
 * Cash-shift management. Every cashier opens a till with a float and closes
 * it against counted cash, so variance is visible instead of guessed.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import {
    VerticalPageHeader,
    StatStrip,
    StatusBadge,
    LoadingState,
    EmptyState,
    FormDialog,
    CreateButton,
    RecordList,
    ugx,
    shortDate,
} from "@/components/vertical/ui-kit";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Wallet, Plus, Lock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { formatError } from "@/lib/utils";
import { cn } from "@/lib/utils";

export default function TillPage() {
    const { user } = useAuth();
    const [openOpen, setOpenOpen] = useState(false);
    const [closeFor, setCloseFor] = useState<any>(null);
    const [tab, setTab] = useState("open");

    const openSessions = useQuery(api.verticals.operations.listTillSessions, {
        status: "open",
        limit: 50,
    });
    const closedSessions = useQuery(api.verticals.operations.listTillSessions, {
        status: "closed",
        limit: 50,
    });

    const openTill = useMutation(api.verticals.operations.openTillSession);
    const closeTill = useMutation(api.verticals.operations.closeTillSession);

    const handleOpen = async (values: Record<string, string>) => {
        if (!user) return;
        await openTill({
            userId: user._id,
            userName: `${user.first_name} ${user.last_name}`,
            openingFloat: Number(values.openingFloat) || 0,
            notes: values.notes || undefined,
        });
        toast.success("Till opened");
    };

    const handleClose = async (values: Record<string, string>) => {
        if (!closeFor) return;
        const expected = Number(values.expectedCash);
        const counted = Number(values.countedCash);
        try {
            const res: any = await closeTill({
                id: closeFor._id,
                expectedCash: expected,
                countedCash: counted,
                notes: values.notes || undefined,
            });
            const v = res.variance ?? 0;
            toast.success(
                v === 0
                    ? "Till closed — cash matches perfectly"
                    : `Till closed — variance ${v > 0 ? "+" : ""}${ugx(v)}`
            );
            setCloseFor(null);
        } catch (err) {
            toast.error(formatError(err));
        }
    };

    const sessions = tab === "open" ? openSessions : closedSessions;
    const totalFloat = (openSessions ?? []).reduce(
        (s, x: any) => s + (x.openingFloat ?? 0),
        0
    );
    const variances = (closedSessions ?? []).filter((x: any) => x.variance !== undefined);
    const totalVariance = variances.reduce((s: number, x: any) => s + (x.variance ?? 0), 0);

    return (
        <div className="space-y-6">
            <VerticalPageHeader
                icon={Wallet}
                title="Till & Cash Reconciliation"
                description="Open a cash float at the start of a shift and reconcile it at close."
                actions={<CreateButton onClick={() => setOpenOpen(true)} label="Open till" />}
            />

            <StatStrip
                stats={[
                    { label: "Open tills", value: openSessions?.length ?? 0 },
                    { label: "Total float", value: ugx(totalFloat) },
                    { label: "Closed shifts", value: closedSessions?.length ?? 0 },
                    {
                        label: "Net variance",
                        value: ugx(totalVariance),
                        tone: totalVariance < 0 ? "danger" : totalVariance > 0 ? "warn" : "good",
                    },
                ]}
            />

            <div className="flex gap-1.5">
                <Button
                    size="sm"
                    variant={tab === "open" ? "default" : "outline"}
                    onClick={() => setTab("open")}
                >
                    Open tills
                </Button>
                <Button
                    size="sm"
                    variant={tab === "closed" ? "default" : "outline"}
                    onClick={() => setTab("closed")}
                >
                    Closed shifts
                </Button>
            </div>

            {!sessions ? (
                <LoadingState />
            ) : sessions.length === 0 ? (
                <EmptyState
                    title={tab === "open" ? "No open tills" : "No closed shifts yet"}
                    hint={
                        tab === "open"
                            ? "Open a till with your cash float before you start selling."
                            : "Closed shifts with their cash variance will appear here."
                    }
                />
            ) : (
                <RecordList
                    records={sessions}
                    renderItem={(s: any) => (
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <p className="font-mono text-xs font-bold text-muted-foreground">
                                        {s.sessionNumber}
                                    </p>
                                    <StatusBadge status={s.status} />
                                </div>
                                <p className="mt-1 font-black">{s.userName}</p>
                                <p className="text-xs text-muted-foreground">
                                    Opened {shortDate(s.openedAt)}
                                    {s.closedAt ? ` · closed ${shortDate(s.closedAt)}` : ""}
                                    {s.shopId ? "" : " · Head Office"}
                                </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-4">
                                <div className="text-right">
                                    <p className="text-[10px] uppercase text-muted-foreground">
                                        Float
                                    </p>
                                    <p className="text-sm font-black tabular-nums">
                                        {ugx(s.openingFloat)}
                                    </p>
                                </div>
                                {s.status === "closed" ? (
                                    <div className="text-right">
                                        <p className="text-[10px] uppercase text-muted-foreground">
                                            Variance
                                        </p>
                                        <p
                                            className={cn(
                                                "text-sm font-black tabular-nums",
                                                (s.variance ?? 0) < 0
                                                    ? "text-red-600 dark:text-red-400"
                                                    : (s.variance ?? 0) > 0
                                                      ? "text-amber-600 dark:text-amber-400"
                                                      : "text-emerald-600 dark:text-emerald-400"
                                            )}
                                        >
                                            {ugx(s.variance ?? 0)}
                                        </p>
                                    </div>
                                ) : (
                                    <Button size="sm" onClick={() => setCloseFor(s)}>
                                        <Lock className="mr-1.5 h-3.5 w-3.5" />
                                        Close till
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                />
            )}

            <FormDialog
                open={openOpen}
                onOpenChange={setOpenOpen}
                title="Open a till session"
                description="Enter the cash you are starting the shift with. You can only have one open session at a time."
                submitLabel="Open till"
                fields={[
                    {
                        name: "openingFloat",
                        label: "Opening cash float (UGX)",
                        type: "number",
                        required: true,
                        min: 0,
                        defaultValue: "0",
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleOpen}
            />

            <FormDialog
                open={!!closeFor}
                onOpenChange={(v) => !v && setCloseFor(null)}
                title={closeFor ? `Close till — ${closeFor.sessionNumber}` : "Close till"}
                description="Count the cash and enter it. Any difference from the expected amount is recorded as a variance."
                submitLabel="Close till"
                fields={[
                    {
                        name: "expectedCash",
                        label: "Expected cash (UGX)",
                        type: "number",
                        required: true,
                        min: 0,
                        defaultValue: closeFor?.openingFloat,
                    },
                    {
                        name: "countedCash",
                        label: "Counted cash (UGX)",
                        type: "number",
                        required: true,
                        min: 0,
                    },
                    { name: "notes", label: "Notes", type: "textarea", full: true },
                ]}
                onSubmit={handleClose}
            />
        </div>
    );
}
