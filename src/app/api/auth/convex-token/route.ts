/**
 * SMART_BUZ — Convex access token endpoint.
 *
 * The browser cannot read the HttpOnly session cookie, and it must never
 * hold the signing key. This route is the bridge: it verifies the session
 * cookie server-side and mints a short-lived RS256 token that the Convex
 * backend verifies against the deployment's own JWKS endpoint.
 *
 * The token carries the caller's user id and the id and secret of the
 * server-side session it belongs to. Which business they may act in is
 * decided on the server from their membership — never from the token — and
 * the session binding is what lets a sign-out take effect immediately
 * rather than at the end of the token's 15-minute life.
 */

import { NextRequest, NextResponse } from "next/server";
import { clearSessionCookie, getSessionFromRequest } from "@/lib/session";
import { signAccessToken } from "@/lib/convex-token";
import { CONVEX_URL } from "@/lib/convex-url";

export const dynamic = "force-dynamic";

/**
 * The shared secret that proves a call comes from this server.
 */
function serverSecret(): string | undefined {
  return (
    process.env.SMARTBUZ_SERVER_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.SESSION_SECRET
  );
}

/** GET /api/auth/convex-token */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json(
      { error: "Not signed in." },
      { status: 401 }
    );
  }

  // The session must still be live. A revoked or expired session gets no
  // token — the cookie is cleared so the interface can send the person back
  // to the sign-in screen instead of failing every request.
  if (session.sessionId) {
    let alive = true;
    try {
      const res = await fetch(`${CONVEX_URL}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "users:touchSession",
          args: { sessionId: session.sessionId, serverSecret: serverSecret() },
          format: "json",
        }),
      });
      const data = await res.json().catch(() => null);
      alive = data?.value?.success === true;
    } catch {
      // A network failure is not proof that the session is dead. Let the
      // backend decide when the token is actually used.
      alive = true;
    }

    if (!alive) {
      const res = NextResponse.json(
        { error: "Your session has ended. Please sign in again." },
        { status: 401 }
      );
      clearSessionCookie(res);
      return res;
    }
  }

  try {
    const token = await signAccessToken({
      userId: session.userId,
      email: session.email,
      // Bind the token to the server-side session, so signing out or
      // revoking the session stops this token immediately.
      sessionId: session.sessionId,
      sessionSecret: session.sessionSecret,
    });

    return NextResponse.json(
      { token, expiresIn: 15 * 60 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const message = String(err?.message ?? "");
    const isMisconfigured =
      message.includes("SMARTBUZ_JWT_PRIVATE_KEY") ||
      message.includes("site URL");

    console.error("SMARTBUZ: could not mint a Convex access token:", message);

    return NextResponse.json(
      {
        error: isMisconfigured
          ? "Server is not configured for Convex authentication. Run `node scripts/generate-auth-keys.mjs` and add SMARTBUZ_JWT_PRIVATE_KEY to .env.local."
          : "Could not issue an access token.",
      },
      { status: isMisconfigured ? 503 : 500 }
    );
  }
}
