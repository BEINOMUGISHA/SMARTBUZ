import { LoadingState } from "@/components/vertical/ui-kit";

/**
 * The placeholder shown while the dashboard is loading.
 *
 * It sits at the dashboard segment, so every screen inside it gets a
 * placeholder rather than an empty frame — the operator can tell the
 * difference between "nothing to show" and "not loaded yet".
 */
export default function DashboardLoading() {
    return (
        <div className="space-y-6" aria-busy="true" aria-live="polite">
            <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
            <LoadingState rows={4} />
        </div>
    );
}
