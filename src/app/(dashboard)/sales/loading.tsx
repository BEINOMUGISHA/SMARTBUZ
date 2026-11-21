import { LoadingState } from "@/components/vertical/ui-kit";

/**
 * The placeholder shown while the till is loading.
 *
 * The sales screen is the busiest one in the product, and it is the one the
 * cashier is waiting on, so it gets a placeholder of its own rather than the
 * generic dashboard one.
 */
export default function SalesLoading() {
    return (
        <div className="space-y-6" aria-busy="true" aria-live="polite">
            <div className="h-9 w-72 animate-pulse rounded-lg bg-muted" />
            <LoadingState rows={5} />
        </div>
    );
}
