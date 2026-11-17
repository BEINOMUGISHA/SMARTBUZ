"use client";

/**
 * SMARTBUZ — the security audit trail.
 *
 * `activityLogs` (the panel above) is the business-scoped feed of ordinary
 * events. This is the *security* trail: the privileged actions that decide
 * who can do what, and who was on the other end of a sign-in.
 *
 * The trail is append-only — nothing in the backend edits or deletes a
 * row — and it is tenant-scoped, so one business never sees another's.
 */

import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck, ShieldAlert, Search } from "lucide-react";
import { formatError } from "@/lib/utils";

/** The action families the trail records, for the filter. */
const ACTION_GROUPS: { label: string; prefix: string }[] = [
    { label: "All events", prefix: "" },
    { label: "Sign-in & sessions", prefix: "auth." },
    { label: "Roles & permissions", prefix: "rbac." },
    { label: "Sales & refunds", prefix: "sales." },
    { label: "Platform", prefix: "platform." },
];

function formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return timestamp;
    return date.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
    });
}

export function SecurityAuditTrail() {
    const { user } = useAuth();
    const [group, setGroup] = useState("");
    const [search, setSearch] = useState("");

    // Only the owner, an administrator, an accountant or an auditor may read
    // the trail — and the backend enforces that, not this panel.
    const result = useQuery(
        api.audit.list,
        user
            ? {
                paginationOpts: { numItems: 100, cursor: null },
            }
            : "skip"
    );

    const rows = (result?.page ?? []).filter((row) => {
        if (group && !row.action.startsWith(group)) return false;
        if (!search) return true;
        const needle = search.toLowerCase();
        return (
            row.action.toLowerCase().includes(needle) ||
            (row.actorRole ?? "").toLowerCase().includes(needle) ||
            (row.targetType ?? "").toLowerCase().includes(needle) ||
            JSON.stringify(row.metadata ?? {}).toLowerCase().includes(needle)
        );
    });

    return (
        <Card className="shadow-sm border">
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-primary" />
                    Security audit trail
                </CardTitle>
                <CardDescription className="font-medium">
                    Privileged actions — sign-ins, session revocations, role and
                    permission changes, refunds and platform operations. This log
                    is append-only.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Event type
                        </Label>
                        <div className="flex flex-wrap gap-2">
                            {ACTION_GROUPS.map((option) => (
                                <Button
                                    key={option.prefix}
                                    type="button"
                                    size="sm"
                                    variant={group === option.prefix ? "default" : "outline"}
                                    onClick={() => setGroup(option.prefix)}
                                >
                                    {option.label}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label className="text-xs font-semibold uppercase text-muted-foreground">
                            Search
                        </Label>
                        <div className="relative">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search events..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="pl-9"
                            />
                        </div>
                    </div>
                </div>

                {result === undefined ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                ) : result === null ? (
                    <p className="text-sm text-muted-foreground">
                        You do not have access to the security audit trail.
                    </p>
                ) : rows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No matching events.
                    </p>
                ) : (
                    <div className="overflow-x-auto rounded-xl border border-border/60">
                        <table className="w-full text-sm">
                            <thead className="bg-muted/40">
                                <tr className="text-left">
                                    <th className="px-4 py-3 font-bold">When</th>
                                    <th className="px-4 py-3 font-bold">Action</th>
                                    <th className="px-4 py-3 font-bold">Actor</th>
                                    <th className="px-4 py-3 font-bold">Target</th>
                                    <th className="px-4 py-3 font-bold">Details</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((row) => (
                                    <tr key={row._id} className="border-t border-border/50 align-top">
                                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                            {formatTimestamp(row.timestamp)}
                                        </td>
                                        <td className="px-4 py-3">
                                            <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                                                {row.outcome === "denied" ? (
                                                    <ShieldAlert className="h-3.5 w-3.5 text-destructive" />
                                                ) : (
                                                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                                                )}
                                                {row.action}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3">
                                            {row.actorRole ? (
                                                <Badge variant="outline">{row.actorRole}</Badge>
                                            ) : (
                                                <span className="text-muted-foreground">—</span>
                                            )}
                                        </td>
                                        <td className="px-4 py-3 text-muted-foreground">
                                            {row.targetType
                                                ? `${row.targetType}${row.targetId ? ` · ${row.targetId}` : ""}`
                                                : "—"}
                                        </td>
                                        <td className="px-4 py-3 text-xs text-muted-foreground">
                                            <code className="break-all">
                                                {row.metadata
                                                    ? JSON.stringify(row.metadata)
                                                    : "—"}
                                            </code>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}
