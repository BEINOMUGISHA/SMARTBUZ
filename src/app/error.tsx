"use client";

import { RouteError } from "@/components/route-error";

/**
 * The route-level boundary for everything outside the dashboard.
 *
 * Without it, a failure in any of these segments takes the whole application
 * down to a blank page.
 */
export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return (
        <RouteError
            error={error}
            reset={reset}
            backHref="/auth/login"
            backLabel="Go to the sign-in page"
        />
    );
}
