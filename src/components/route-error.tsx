"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, Home, LogIn, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isSessionExpired } from "@/components/error-feedback";

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
    const sessionExpired = isSessionExpired(error);

    useEffect(() => {
        console.error("[SMARTBUZ] route error:", error, error?.digest ?? "");
    }, [error]);

    return (
        <div
            role="alert"
            className="flex min-h-[60vh] w-full items-center justify-center p-6"
        >
            <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                    <AlertTriangle className="h-6 w-6" />
                </div>

                <h1 className="mt-4 text-xl font-bold tracking-tight">
                    {sessionExpired
                        ? "Your session has expired"
                        : "This screen could not be loaded"}
                </h1>

                <p className="mt-2 text-sm text-muted-foreground">
                    {sessionExpired
                        ? "The server refused the request because the session is no longer valid. Sign in again and you will pick up where you left off."
                        : "Something went wrong on our side. Nothing you entered has been lost — you can try again, or go back and start from a different screen."}
                </p>

                <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
                    {sessionExpired ? (
                        <Button asChild>
                            <Link href="/auth/login">
                                <LogIn className="mr-2 h-4 w-4" />
                                Sign in again
                            </Link>
                        </Button>
                    ) : (
                        <Button onClick={reset}>
                            <RefreshCw className="mr-2 h-4 w-4" />
                            Try again
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
