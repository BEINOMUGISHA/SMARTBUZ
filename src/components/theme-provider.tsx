"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";

/**
 * SMART_BUZ — the theme provider.
 *
 * `next-themes` was a dependency and the whole `.dark` token block in
 * `globals.css` was written, but no provider was ever mounted, so nothing
 * ever put `.dark` on `<html>`. The dark palette and all 41 `dark:` variants
 * across the app were dead code, and the product ran light-only.
 *
 * Mounting this makes them live. It has to sit in the root layout because
 * the class is set on `<html>`, and it has to be a client component because
 * the choice is read from storage on the client.
 */
export function ThemeProvider({
    children,
    ...props
}: ThemeProviderProps) {
    return (
        <NextThemesProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
            {...props}
        >
            {children}
        </NextThemesProvider>
    );
}
