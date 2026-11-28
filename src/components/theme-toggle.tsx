"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * The theme switch.
 *
 * The product shipped a dark palette that nothing could reach, because no
 * theme provider was mounted. This is the control that makes it reachable —
 * and it follows the system setting until the person chooses otherwise.
 */
export function ThemeToggle({
    className,
    showLabel = false,
}: {
    className?: string;
    showLabel?: boolean;
}) {
    const { theme, setTheme, resolvedTheme } = useTheme();
    const [mounted, setMounted] = React.useState(false);

    // The theme is only known on the client. Rendering the icon before then
    // would produce a different tree on the server and on the client, which
    // React reports as a hydration error.
    React.useEffect(() => setMounted(true), []);

    const current = mounted ? resolvedTheme ?? theme : undefined;

    const next = current === "dark" ? "light" : "dark";

    return (
        <Button
            variant="ghost"
            size={showLabel ? "sm" : "icon"}
            className={cn("text-muted-foreground hover:text-foreground", className)}
            onClick={() => setTheme(next)}
            title={mounted ? `Switch to ${next} mode` : "Switch theme"}
            aria-label={
                mounted ? `Switch to ${next} mode` : "Switch theme"
            }
        >
            {showLabel ? (
                <>
                    <ThemeIcon theme={current} />
                    <span className="ml-2 capitalize">
                        {current === "dark" ? "Dark" : "Light"}
                    </span>
                </>
            ) : (
                <ThemeIcon theme={current} />
            )}
        </Button>
    );
}

function ThemeIcon({ theme }: { theme?: string }) {
    if (!theme) {
        // Before the client knows the theme, show the system icon rather than
        // guessing and swapping the icon after hydration.
        return <Monitor className="size-4" aria-hidden />;
    }
    return theme === "dark" ? (
        <Moon className="size-4" aria-hidden />
    ) : (
        <Sun className="size-4" aria-hidden />
    );
}
