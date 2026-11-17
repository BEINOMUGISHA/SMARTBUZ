"use strict";
"use client";

import { ReactNode, useEffect } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { CONVEX_URL, warnIfConvexUnconfigured } from "@/lib/convex-url";

const convex = new ConvexReactClient(CONVEX_URL);

/**
 * Fetch a fresh access token for the signed-in user.
 *
 * The Convex client calls this whenever it needs to (re)authenticate: on
 * connect, when a token is close to expiry, and when the server rejects
 * one. It returns null when nobody is signed in, which makes Convex treat
 * the request as anonymous — and every tenant guard on the server rejects
 * anonymous requests.
 */
async function fetchAccessToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/convex-token", {
      cache: "no-store",
      credentials: "include",
    });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.token === "string" ? data.token : null;
  } catch {
    return null;
  }
}

export function ConvexClientProvider({ children }: { children: ReactNode }) {
    warnIfConvexUnconfigured();

    useEffect(() => {
        // Attach the signed session to every Convex request. Until this runs,
        // requests are anonymous — the server refuses them rather than
        // serving them.
        convex.setAuth(fetchAccessToken, () => {});
    }, []);

    return <ConvexProvider client={convex}>{children}</ConvexProvider>;
}
