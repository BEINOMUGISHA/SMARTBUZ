"use client";

import { RouteError } from "@/components/route-error";

/**
 * The error boundary for the signed-in area.
 *
 * It sits at the dashboard segment, so the shell — the navigation, the
 * business switcher — stays on screen and the operator is not thrown out of
 * the application because one screen failed.
 */
export default function DashboardError({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    return <RouteError error={error} reset={reset} />;
}
