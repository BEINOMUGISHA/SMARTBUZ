"use client";

import { useEffect, useSyncExternalStore } from "react";
import { AlertTriangle, RefreshCw, ServerCrash } from "lucide-react";

import "./globals.css";
import {
    connectionFailure,
    connectionFailureMessage,
    subscribeToConnectionFailure,
} from "@/lib/connection-state";

/**
 * The last-resort boundary.
 *
 * It catches a failure in the root layout itself, which means it replaces
 * the whole document — so it has to render its own `<html>` and `<body>`,
 * and it cannot rely on anything the root layout provides (the providers,
 * the toast host, the shared styles). The stylesheet is imported here for
 * that reason.
 *
 * ────────────────────────────────────────────────────────────────────────
 * A deployment that cannot mint a token is not a crash
 * ────────────────────────────────────────────────────────────────────────
 *
 * When the server cannot issue a Convex access token — because the
 * deployment is missing its signing key — every query the application makes
 * comes back "Unauthorized: you must be signed in to access business data",
 * and the first of those errors lands here.
 *
 * That message is false, and showing it as a crash page is worse than
 * useless: it tells the operator they have been signed out, when what has
 * actually happened is that the deployment is misconfigured. So when the
 * reason is known, it is shown instead, in the words the server used.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    const failure = useSyncExternalStore(
        subscribeToConnectionFailure,
        connectionFailure,
        () => null
    );

    useEffect(() => {
        // The digest is the only link between what the operator saw and the
        // server log.
        console.error("[SMARTBUZ] global error:", error, error?.digest ?? "");
    }, [error]);

    const misconfigured = Boolean(failure);

    return (
        <html lang="en">
            <body className="font-sans antialiased">
                <div
                    role="alert"
                    className="flex min-h-screen w-full items-center justify-center bg-background p-6"
                >
                    <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
                        <div
                            className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
                                misconfigured
                                    ? "bg-amber-500/15 text-amber-600"
                                    : "bg-destructive/10 text-destructive"
                            }`}
                        >
                            {misconfigured ? (
                                <ServerCrash className="h-6 w-6" />
                            ) : (
                                <AlertTriangle className="h-6 w-6" />
                            )}
                        </div>

                        <h1 className="mt-4 text-xl font-bold tracking-tight">
                            {misconfigured
                                ? "The server is not configured yet"
                                : "SMARTBUZ could not start"}
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            {misconfigured
                                ? connectionFailureMessage(failure)
                                : "The application failed to load. This is a fault on our side, not something you did. Please try again — if it keeps happening, tell your administrator."}
                        </p>

                        {misconfigured ? (
                            <p className="mt-3 text-sm text-muted-foreground">
                                You are signed in. The problem is on the server: it
                                cannot issue an access token, so it cannot confirm
                                which account you are.
                            </p>
                        ) : null}

                        <div className="mt-6 flex justify-center">
                            <button
                                type="button"
                                onClick={reset}
                                className="inline-flex items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
                            >
                                <RefreshCw className="mr-2 h-4 w-4" />
                                Try again
                            </button>
                        </div>
                    </div>
                </div>
            </body>
        </html>
    );
}
