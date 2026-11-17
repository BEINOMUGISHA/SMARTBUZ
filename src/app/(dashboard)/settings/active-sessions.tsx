"use client";

/**
 * SMARTBUZ — Active sessions.
 *
 * Every sign-in creates a server-side session row. The access token the
 * browser receives carries that session's id, so revoking the session
 * stops the token immediately — it does not wait out its 15-minute
 * lifetime.
 *
 * This panel lets somebody see where their account is signed in and sign
 * it out.
 */

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { useAuth } from "@/context/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Monitor, MapPin, Clock, Loader2, LogOut } from "lucide-react";
import { formatError } from "@/lib/utils";

function formatWhen(timestamp: number | undefined): string {
    if (!timestamp) return "Unknown";
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return "Just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.floor(hours / 24);
    return `${days} day${days === 1 ? "" : "s"} ago`;
}

/** A short, readable description of a user agent string. */
function describeAgent(userAgent: string | undefined): string {
    if (!userAgent) return "Unknown device";
    if (/mobile|iphone|android/i.test(userAgent)) return "Mobile device";
    if (/ipad|tablet/i.test(userAgent)) return "Tablet";
    if (/windows/i.test(userAgent)) return "Windows";
    if (/mac os|macintosh/i.test(userAgent)) return "macOS";
    if (/linux/i.test(userAgent)) return "Linux";
    if (/chrome|crios/i.test(userAgent)) return "Chrome";
    if (/safari/i.test(userAgent)) return "Safari";
    if (/firefox/i.test(userAgent)) return "Firefox";
    return "Browser";
}

export function ActiveSessions() {
    const { user } = useAuth();
    const sessions = useQuery(
        api.users.listSessions,
        user ? {} : "skip"
    );
    const revokeSession = useMutation(api.users.revokeSession);
    const revokeOthers = useMutation(api.users.revokeOtherSessions);
    const [busy, setBusy] = useState<string | null>(null);

    const handleRevoke = async (sessionId: string) => {
        setBusy(sessionId);
        try {
            await revokeSession({ sessionId });
            toast.success("Session signed out");
        } catch (error: any) {
            toast.error(formatError(error));
        } finally {
            setBusy(null);
        }
    };

    const handleRevokeOthers = async () => {
        setBusy("others");
        try {
            const result = await revokeOthers({});
            toast.success(
                result.revoked > 0
                    ? `Signed out ${result.revoked} other session${result.revoked === 1 ? "" : "s"}`
                    : "No other sessions to sign out"
            );
        } catch (error: any) {
            toast.error(formatError(error));
        } finally {
            setBusy(null);
        }
    };

    const list = sessions ?? [];

    return (
        <Card className="shadow-sm border mt-6">
            <CardHeader>
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <CardTitle className="text-lg font-black">Active sessions</CardTitle>
                        <CardDescription className="font-medium">
                            Where your account is currently signed in. Signing one out
                            stops it immediately.
                        </CardDescription>
                    </div>
                    {list.length > 1 && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={busy !== null}
                            onClick={handleRevokeOthers}
                            className="shrink-0"
                        >
                            {busy === "others" && (
                                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            )}
                            Sign out others
                        </Button>
                    )}
                </div>
            </CardHeader>
            <CardContent>
                {list.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                        No active sessions.
                    </p>
                ) : (
                    <ul className="space-y-3">
                        {list.map((session) => (
                            <li
                                key={session.sessionId}
                                className="flex items-center justify-between gap-4 rounded-xl border border-border/60 p-4"
                            >
                                <div className="flex items-start gap-3 min-w-0">
                                    <div className="mt-0.5 rounded-lg bg-muted p-2 shrink-0">
                                        <Monitor className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-sm truncate">
                                            {describeAgent(session.userAgent)}
                                        </p>
                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-muted-foreground">
                                            <span className="inline-flex items-center gap-1">
                                                <MapPin className="h-3 w-3" />
                                                {session.ip ?? "Unknown location"}
                                            </span>
                                            <span className="inline-flex items-center gap-1">
                                                <Clock className="h-3 w-3" />
                                                Last seen {formatWhen(session.lastSeenAt ?? session.createdAt)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    disabled={busy !== null}
                                    onClick={() => handleRevoke(session.sessionId)}
                                    className="shrink-0 text-destructive hover:text-destructive"
                                >
                                    {busy === session.sessionId ? (
                                        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                        <LogOut className="mr-2 h-3.5 w-3.5" />
                                    )}
                                    Sign out
                                </Button>
                            </li>
                        ))}
                    </ul>
                )}

                <p className="mt-4 text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-2">
                        <LogOut className="mr-1 h-3 w-3" />
                        Revoked
                    </Badge>
                    A revoked session cannot be used again, even if its access
                    token has not yet expired.
                </p>
            </CardContent>
        </Card>
    );
}
