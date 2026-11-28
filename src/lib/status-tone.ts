/**
 * SMART_BUZ — the status map.
 *
 * The product used to carry three separate status palettes: one in the
 * vertical UI kit, one in the category map and one in the report tables. The
 * same state was a different colour depending on the screen, so an operator
 * could not learn the colours once and read them everywhere.
 *
 * This is the only map. It answers a single question: given a status string
 * the backend produced, what tone should it be shown in?
 *
 * The four tones are deliberately about *meaning*, not about colour:
 *
 *   success — the thing happened, and the world is fine
 *   warning — the thing is in motion, or about to need attention
 *   danger  — the thing went wrong, or something is overdue
 *   info    — the thing is scheduled, partial, or in review
 *   neutral — the thing is simply not in play
 */

export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_BY_STATUS: Record<string, StatusTone> = {
    /* ── Finished, and fine ─────────────────────────────────────────── */
    completed: "success",
    complete: "success",
    delivered: "success",
    received: "success",
    paid: "success",
    settled: "success",
    present: "success",
    available: "success",
    active: "success",
    approved: "success",
    reconciled: "success",
    checked_out: "success",
    checked_in: "success",
    good: "success",
    ready: "success",
    sold: "success",
    in_stock: "success",
    successful: "success",
    success: "success",
    fulfilled: "success",
    cleared: "success",
    closed_positive: "success",

    /* ── In motion, or nearly a problem ─────────────────────────────── */
    pending: "warning",
    reserved: "warning",
    occupied: "warning",
    ordered: "warning",
    dispatched: "warning",
    partially_received: "warning",
    cleaning: "warning",
    late: "warning",
    expiring: "warning",
    due: "warning",
    low: "warning",
    awaiting_payment: "warning",
    awaiting: "warning",
    awaiting_approval: "warning",
    partially_paid: "warning",
    hold: "warning",
    on_hold: "warning",
    scheduled: "warning",
    queued: "warning",
    processing: "warning",
    expiring_soon: "warning",
    near_expiry: "warning",

    /* ── Wrong, overdue, or blocked ─────────────────────────────────── */
    expired: "danger",
    cancelled: "danger",
    canceled: "danger",
    failed: "danger",
    absent: "danger",
    overdue: "danger",
    faulty: "danger",
    rejected: "danger",
    suspended: "danger",
    out_of_stock: "danger",
    void: "danger",
    voided: "danger",
    critical: "danger",
    unmatched: "danger",
    reversed: "danger",
    declined: "danger",
    written_off: "danger",
    damaged: "danger",
    lost: "danger",

    /* ── Scheduled, partial, or in review ───────────────────────────── */
    confirmed: "info",
    in_progress: "info",
    partial: "info",
    invited: "info",
    transferred: "info",
    paused: "info",
    on_leave: "info",
    escalated: "info",
    review: "info",
    needs_review: "info",
    discrepancy: "info",
    return: "info",
    refund_pending: "info",

    /* ── Simply not in play ─────────────────────────────────────────── */
    draft: "neutral",
    open: "neutral",
    returned: "neutral",
    idle: "neutral",
    excused: "neutral",
    no_show: "neutral",
    no_expiry: "neutral",
    returned_stock: "neutral",
    archived: "neutral",
    unused: "neutral",
    inactive: "neutral",
    unknown: "neutral",
    not_applicable: "neutral",
};

/**
 * Words that appear inside a longer status — "partially_received",
 * "awaiting_payment", "out_of_stock".
 */
const TONE_BY_FRAGMENT: Array<[string, StatusTone]> = [
    ["partial", "info"],
    ["awaiting", "warning"],
    ["pending", "warning"],
    ["overdue", "danger"],
    ["expired", "danger"],
    ["failed", "danger"],
    ["cancelled", "danger"],
    ["canceled", "danger"],
    ["refunded", "info"],
    ["completed", "success"],
    ["received", "success"],
    ["delivered", "success"],
    ["paid", "success"],
    ["out_of_stock", "danger"],
    ["low_stock", "warning"],
    ["in_progress", "info"],
    ["scheduled", "info"],
];

/**
 * The tone for a status string.
 *
 * Unrecognised statuses fall back to neutral rather than throwing — the
 * backend is free to add a state before the UI learns it, and an unknown
 * state should read as "ordinary", not as an error.
 */
export function statusTone(status: string | null | undefined): StatusTone {
    if (!status) return "neutral";
    const key = status.toLowerCase().trim().replace(/[\s-]+/g, "_");

    const exact = TONE_BY_STATUS[key];
    if (exact) return exact;

    for (const [fragment, tone] of TONE_BY_FRAGMENT) {
        if (key.includes(fragment)) return tone;
    }

    return "neutral";
}

/** A readable label for a status string: "in_progress" → "In progress". */
export function statusLabel(status: string | null | undefined): string {
    if (!status) return "—";
    const cleaned = status.toLowerCase().trim().replace(/[_-]+/g, " ");
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
