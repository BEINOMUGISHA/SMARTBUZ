"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import "./globals.css";

/**
 * The last-resort boundary.
 *
 * It catches a failure in the root layout itself, which means it replaces
 * the whole document — so it has to render its own `<html>` and `<body>`,
 * and it cannot rely on anything the root layout provides (the providers,
 * the toast host, the shared styles). The stylesheet is imported here for
 * that reason.
 */
export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // The digest is the only link between what the operator saw and the
        // server log.
        console.error("[SMARTBUZ] global error:", error, error?.digest ?? "");
    }, [error]);

    return (
        <html lang="en">
            <body className="font-sans antialiased">
                <div
                    role="alert"
                    className="flex min-h-screen w-full items-center justify-center bg-background p-6"
                >
                    <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                            <AlertTriangle className="h-6 w-6" />
                        </div>

                        <h1 className="mt-4 text-xl font-bold tracking-tight">
                            SMARTBUZ could not start
                        </h1>

                        <p className="mt-2 text-sm text-muted-foreground">
                            The application failed to load. This is a fault on our
                            side, not something you did. Please try again — if it
                            keeps happening, tell your administrator.
                        </p>

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
