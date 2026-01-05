export default function ReportsPage() {
    return (
        <div className="space-y-4">
            <h1 className="text-2xl font-bold tracking-tight">Analytics & Reports</h1>
            <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Revenue Analysis</h2>
                    <div className="mt-4 h-[300px] animate-pulse rounded bg-muted" />
                </div>
                <div className="rounded-xl border bg-card p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Profit/Loss Summary</h2>
                    <div className="mt-4 h-[300px] animate-pulse rounded bg-muted" />
                </div>
            </div>
        </div>
    );
}
