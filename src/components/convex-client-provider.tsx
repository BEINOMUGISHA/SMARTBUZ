"use strict";
"use client";

import { ReactNode } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { CONVEX_URL, warnIfConvexUnconfigured } from "@/lib/convex-url";

const convex = new ConvexReactClient(CONVEX_URL);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
    warnIfConvexUnconfigured();
    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
