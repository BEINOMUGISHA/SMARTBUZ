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
    if (!res.ok) {
      // Say why, and say it here. Returning null silently makes Convex treat
      // every request as anonymous, and the backend then reports "you must be
      // signed in to access business data" — which is wrong: the person IS
      // signed in, the server simply cannot mint a token for them (a missing
      // environment variable on the deployment, for instance). The real
      // reason is in this response body.
      const body = await res.json().catch(() => null);
      console.error(
        `[SMARTBUZ] could not get a Convex access token (HTTP ${res.status}):`,
        body?.error ?? "no error message"
      );
      return null;
    }
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
