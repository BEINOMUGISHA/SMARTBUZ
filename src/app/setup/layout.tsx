"use client";

/**
 * The setup wizard's providers.
 *
 * The wizard creates a business and reads the categories, so it needs the
 * backend — and it needs to know who is asking. The providers are mounted
 * here rather than in the root layout so that the public sign-in route
 * does not have to download them.
 */

import { ReactNode } from "react";
import { ConvexClientProvider } from "@/components/convex-client-provider";
import { AuthProvider } from "@/context/auth-context";

export default function SetupLayout({ children }: { children: ReactNode }) {
    return (
        <ConvexClientProvider>
            <AuthProvider>{children}</AuthProvider>
        </ConvexClientProvider>
    );
}
