/**
 * SMARTBUZ — calling the backend from the Next.js server.
 *
 * The browser talks to Convex through the Convex client, which is a
 * sizeable download. The public routes — signing in, registering, proving
 * an address, resetting a password — have no business data to read, so
 * they have no need of that client, and the performance audit found that
 * it was costing the sign-in screen 24 KB gzipped it did not use.
 *
 * Those routes reach the backend through this module instead: the server
 * calls Convex over its HTTP API, and the browser talks to the server.
 *
 * It also means the server is the only thing that ever holds the shared
 * server secret, so the code in a verification or reset email is never
 * returned to a browser that asks for it.
 */

import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";

/**
 * The shared secret that proves a call comes from this server.
 *
 * The Convex deployment holds the same value. It gates the operations a
 * browser must never reach: opening a session, reading a reset code,
 * emailing a verification code.
 */
export function serverSecret(): string | undefined {
  return (
    process.env.SMARTBUZ_SERVER_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.SESSION_SECRET
  );
}

/** The outcome of a call to the backend. */
export type ConvexCall<T> =
  | { ok: true; value: T }
  | { ok: false; error?: string; unreachable: boolean };

/**
 * Pull the backend's error message out of a response body, if there is one.
 *
 * Convex reports a thrown mutation as HTTP 200 with `{status: "error"}` in
 * the body, so the body has to be read whether or not the status was OK.
 */
export function extractConvexErrorMessage(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const record = data as { errorMessage?: unknown; message?: unknown };
  if (typeof record.errorMessage === "string") return record.errorMessage;
  if (typeof record.message === "string") return record.message;
  return undefined;
}

/**
 * POST to Convex, retrying once when the connection itself fails.
 *
 * Only a thrown error (DNS failure, connection reset) is retried — an HTTP
 * response, including a 401 from Convex, is returned as it is.
 */
async function convexFetchWithRetry(
  url: string,
  init: RequestInit
): Promise<Response | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      console.error("Convex request failed:", err);
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }
  return null;
}

/**
 * Call a Convex mutation and return its value.
 *
 * `unreachable` distinguishes "the backend said no" from "the backend could
 * not be reached" — the two need different answers, because a network
 * failure must never read to the operator as a wrong password.
 */
export async function convexMutation<T = unknown>(
  path: string,
  args: Record<string, unknown>
): Promise<ConvexCall<T>> {
  if (!IS_CONVEX_URL_CONFIGURED) {
    return { ok: false, unreachable: true };
  }

  const response = await convexFetchWithRetry(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });

  if (!response) {
    return { ok: false, unreachable: true };
  }

  const data = await response.json().catch(() => null);

  if (!response.ok || !data || data.status !== "success") {
    return { ok: false, error: extractConvexErrorMessage(data), unreachable: false };
  }

  return { ok: true, value: (data.value ?? null) as T };
}
