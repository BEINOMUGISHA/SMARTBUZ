export default function PosPage() {
    return (
        <div className="flex h-full flex-col gap-4">
            <h1 className="text-2xl font-bold tracking-tight">POS Terminal</h1>
            <div className="grid flex-1 gap-6 md:grid-cols-3">
                <div className="md:col-span-2 rounded-xl border bg-card p-6 shadow-sm">
                    <h2 className="text-lg font-semibold">Product Selection</h2>
                    <div className="mt-4 h-[500px] animate-pulse rounded bg-muted" />
                </div>
                <div className="rounded-xl border bg-card p-6 shadow-sm flex flex-col">
                    <h2 className="text-lg font-semibold">Current Cart</h2>
                    <div className="mt-4 flex-1 animate-pulse rounded bg-muted" />
                    <div className="mt-6 h-20 animate-pulse rounded bg-muted" />
                </div>
            </div>
        </div>
    );
}
