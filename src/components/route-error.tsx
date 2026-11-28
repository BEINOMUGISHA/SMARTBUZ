"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { AlertTriangle, Home, LogIn, RefreshCw, ServerCrash, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSessionExpired, isPlanLimit, planLimitMessage } from "@/components/error-feedback";
import { useT } from "@/i18n/provider";
import {
    connectionFailure,
    connectionFailureMessage,
    subscribeToConnectionFailure,
} from "@/lib/connection-state";

/**
 * What every route-level error boundary shows.
 *
 * A stack trace belongs in the server log, not on the screen of the person
 * standing at the till, so it is never rendered here. The digest is the only
 * handle the support team has on a server-side crash, so it is kept — in the
 * console, not on the page.
 */
export function RouteError({
    error,
    reset,
    backHref = "/",
    backLabel = "Go to the dashboard",
}: {
    error: Error & { digest?: string };
    reset: () => void;
    backHref?: string;
    backLabel?: string;
}) {
    // The server refuses a call it thinks came from a stale session. That is
    // not a crash, and telling the operator to "try again" would only send
    // them round in circles — they have to sign in again.
    
    const t = useT();const sessionExpired = isSessionExpired(error);

    /**
     * The business's plan does not carry this part of the product. That is
     * not a fault, and the only thing the owner can do about it is change
     * the plan — so the screen says so, and offers that.
     */
    const planLimited = isPlanLimit(error);
    const planReason = planLimitMessage(error);

    // The server cannot issue an access token at all — the deployment is
    // missing its signing key. The person is signed in; the server cannot
    // confirm who they are. Saying "your session has expired" would send
    // them to the sign-in page, where the same thing would happen again.
    const failure = useSyncExternalStore(
        subscribeToConnectionFailure,
        connectionFailure,
        () => null
    );
    const serverMisconfigured = Boolean(failure);

    useEffect(() => {
        console.error("[SMARTBUZ] route error:", error, error?.digest ?? "");
    }, [error]);

    const title = serverMisconfigured
        ? "The server is not configured yet"
        : planLimited
          ? "This feature is not in your plan"
          : sessionExpired
            ? "Your session has expired"
            : "This screen could not be loaded";

    const explanation = serverMisconfigured
        ? connectionFailureMessage(failure)
        : planLimited
          ? `${
                planReason ??
                "Your current plan does not include this part of SMART_BUZ."
            } Change the plan to switch it on — nothing you have already set up is affected.`
          : sessionExpired
            ? "The server refused the request because the session is no longer valid. Sign in again and you will pick up where you left off."
            : "Something went wrong on our side. Nothing you entered has been lost — you can try again, or go back and start from a different screen.";

    return (
        <div
            role="alert"
            className="flex min-h-[60vh] w-full items-center justify-center p-6"
        >
            <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
                <div
                    className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${serverMisconfigured
                            ? "bg-amber-500/15 text-amber-600"
                            : planLimited
                              ? "bg-primary/10 text-primary"
                              : "bg-destructive/10 text-destructive"}`}
                >
                    {serverMisconfigured ? (
                        <ServerCrash className="h-6 w-6" />
                    ) : planLimited ? (
                        <Sparkles className="h-6 w-6" />
                    ) : (
                        <AlertTriangle className="h-6 w-6" />
                    )}
                </div>

                <h1 className="mt-4 text-xl font-bold tracking-tight">{title}</h1>

                <p className="mt-2 text-sm text-muted-foreground">{explanation}</p>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    {serverMisconfigured ? (
                        <Button onClick={reset}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {t("Try again")}
                        </Button>
                    ) : planLimited ? (
                        <Button asChild>
                            <Link href="/subscription">
                                <Sparkles className="mr-2 h-4 w-4" />
                                {t("See the plans")}
                            </Link>
                        </Button>
                    ) : sessionExpired ? (
                        <Button asChild>
                            <Link href="/auth/login">
                                <LogIn className="mr-2 h-4 w-4" />
                                {t("Sign in again")}
                            </Link>
                        </Button>
                    ) : (
                        <Button onClick={reset}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            {t("Try again")}
                        </Button>
                    )}

                    <Button variant="outline" asChild>
                        <Link href={backHref}>
                            <Home className="mr-2 h-4 w-4" />
                            {backLabel}
                        </Link>
                    </Button>
                </div>
            </div>
        </div>
    );
}
