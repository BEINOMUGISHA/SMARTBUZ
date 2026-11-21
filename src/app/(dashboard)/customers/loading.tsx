import { LoadingState } from "@/components/vertical/ui-kit";

/** The placeholder shown while the customer list is loading. */
export default function CustomersLoading() {
    return (
        <div className="space-y-6" aria-busy="true" aria-live="polite">
            <div className="h-9 w-64 animate-pulse rounded-lg bg-muted" />
            <LoadingState rows={4} />
        </div>
    );
}
