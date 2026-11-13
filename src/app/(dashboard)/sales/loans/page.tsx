"use client";

/**
 * SMART_BUZ — Loans
 *
 * The sidebar links straight to /sales/loans, so the loans view gets its own
 * route instead of only existing as a tab inside the till.
 */

import { LoansView } from "../loans-view";

export default function LoansPage() {
    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-4">
                <h1 className="text-3xl font-black tracking-tight text-foreground">Loans</h1>
                <p className="text-muted-foreground">
                    What customers owe you, and the repayments you have recorded.
                </p>
            </div>

            <LoansView />
        </div>
    );
}
