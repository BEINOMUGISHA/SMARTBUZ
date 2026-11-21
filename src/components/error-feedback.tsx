"use client";

import { toast } from "sonner";
import { AlertTriangle, X } from "lucide-react";
import { formatError } from "@/lib/utils";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { connectionFailure, connectionFailureMessage } from "@/lib/connection-state";

/**
 * The backend refuses a request when the caller's session is no longer good.
 *
 * A query that throws this blanks the screen, and a mutation that fails with
 * it looks like any other refusal — so it is worth recognising on its own.
 */
export function isSessionExpired(error: unknown): boolean {
    // When the server cannot mint a token at all, every request comes back
    // "you must be signed in" — and it is not the session that has expired.
    // The person is signed in; the deployment is misconfigured. Saying
    // "sign in again" would send them to the sign-in page, where exactly
    // the same thing would happen again.
    if (connectionFailure()) return false;

    const message = error instanceof Error ? error.message : String(error ?? "");
    return /unauthori[sz]ed/i.test(message) || /must be signed in/i.test(message);
}

/**
 * A plain-language description of a failed backend call.
 *
 * `formatError` already strips the Convex request-id and the stack trace;
 * this adds the two things it cannot know about — a session that has expired,
 * and what the screen was trying to do when the server gave no reason.
 */
export function describeError(error: unknown, fallback?: string): string {
    // The server said why it could not mint a token. That is the real
    // reason the call failed, and it is the one the owner has to act on.
    const failure = connectionFailure();
    if (failure) return connectionFailureMessage(failure);

    if (isSessionExpired(error)) {
        return "Your session has expired. Please sign in again.";
    }

    const formatted = formatError(error);
    if (fallback && formatted === "An error occurred on the server. Please try again.") {
        return fallback;
    }
    return formatted;
}

/**
 * Show a failed backend call to the operator.
 *
 * The operator must never walk away believing a save the server refused went
 * through, so every failed mutation ends up here rather than in the console.
 */
export function reportError(error: unknown, fallback?: string): string {
    const message = describeError(error, fallback);
    toast.error(message);

    // The error is marked so that a caller which also renders it inline does
    // not show the operator the same sentence twice.
    if (error && typeof error === "object") {
        (error as { reported?: boolean }).reported = true;
    }

    return message;
}

/**
 * Was this failure already shown to the operator?
 *
 * A caller that reports the failure and then re-throws it — so a dialog can
 * stay open with the operator's input — uses this to avoid repeating itself.
 */
export function isReported(error: unknown): boolean {
    return Boolean(error && typeof error === "object" && (error as { reported?: boolean }).reported);
}

/**
 * An inline, dismissible error state.
 *
 * Some screens lose the toast before it is read — a long form, a full-screen
 * dialog — so the failure also stays on the page until it is dismissed.
 */
export function ErrorBanner({
    message,
    onDismiss,
    className,
}: {
    message: string;
    onDismiss?: () => void;
    className?: string;
}) {
    if (!message) return null;

    return (
        <Alert variant="destructive" className={className}>
            <AlertTriangle />
            <AlertTitle>That did not work</AlertTitle>
            <AlertDescription>
                <span>{message}</span>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss this message"
                        className="ml-2 inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium underline underline-offset-2"
                    >
                        <X className="h-3 w-3" />
                        Dismiss
                    </button>
                )}
            </AlertDescription>
        </Alert>
    );
}
