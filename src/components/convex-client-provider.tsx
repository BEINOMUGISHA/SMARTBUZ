"use strict";
"use client";

import { ReactNode, useEffect } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { toast } from "sonner";
import { CONVEX_URL, warnIfConvexUnconfigured } from "@/lib/convex-url";

const convex = new ConvexReactClient(CONVEX_URL);

/**
 * Whether the operator has already been told that the session could not be
 * confirmed.
 *
 * The Convex client asks for a new token repeatedly, so the failure is
 * reported once — a toast that repeats itself every few seconds is worse
 * than no toast at all.
 */
let tokenFailureReported = false;

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

      // The console is not where the operator is looking. Without this the
      // screen simply stops filling in, and nothing says why.
      if (!tokenFailureReported) {
        tokenFailureReported = true;
        toast.error(
          "The server could not confirm your session, so your data cannot be loaded. Please try again in a moment."
        );
      }
      return null;
    }
    const data = await res.json();
    tokenFailureReported = false;
    return typeof data?.token === "string" ? data.token : null;
  } catch {
    if (!tokenFailureReported) {
      tokenFailureReported = true;
      toast.error(
        "The server could not be reached, so your data cannot be loaded. Check your connection and try again."
      );
    }
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
