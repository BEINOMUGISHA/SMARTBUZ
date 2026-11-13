"use client";

/**
 * SMART_BUZ — AnimatedNumber
 *
 * Counts from the previous value to the next one instead of jumping. Used for
 * the till total so a cashier sees money move when a line is added, changed
 * or removed, and for the PV/BV counters.
 *
 * Respects `prefers-reduced-motion`: when the user asks for less motion the
 * value is set instantly.
 */

import { useEffect, useRef, useState } from "react";

function prefersReducedMotion() {
    if (typeof window === "undefined") return false;
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export function AnimatedNumber({
    value,
    duration = 420,
    format,
    className,
}: {
    value: number;
    duration?: number;
    format?: (n: number) => string;
    className?: string;
}) {
    const [display, setDisplay] = useState(value);
    const fromRef = useRef(value);
    const frameRef = useRef<number | null>(null);

    useEffect(() => {
        const from = fromRef.current;
        if (from === value) return;

        if (prefersReducedMotion() || duration <= 0) {
            fromRef.current = value;
            setDisplay(value);
            return;
        }

        const start = performance.now();
        const tick = (now: number) => {
            const progress = Math.min(1, (now - start) / duration);
            // easeOutCubic — fast at first, settles gently.
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(from + (value - from) * eased);
            if (progress < 1) {
                frameRef.current = requestAnimationFrame(tick);
            } else {
                fromRef.current = value;
            }
        };

        frameRef.current = requestAnimationFrame(tick);

        return () => {
            if (frameRef.current !== null) {
                cancelAnimationFrame(frameRef.current);
                frameRef.current = null;
            }
            fromRef.current = value;
        };
    }, [value, duration]);

    const text = format ? format(display) : Math.round(display).toLocaleString();

    return <span className={className}>{text}</span>;
}
