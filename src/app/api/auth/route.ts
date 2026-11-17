/**
 * SMARTBUZ Auth API Routes
 *
 * POST /api/auth/login   - Validate credentials, open a session, issue the
 *                          HttpOnly session cookie
 * POST /api/auth/logout  - Revoke the session and clear the cookie
 * GET  /api/auth/me      - Return current session user info (for client hydration)
 */

import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, clearSessionCookie, getSessionFromRequest } from "@/lib/session";
import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";

/**
 * The shared secret that proves a call comes from this server.
 *
 * The Convex deployment holds the same value. It gates the operations a
 * browser must never reach: opening a session, reading a reset code,
 * emailing a verification code.
 */
function serverSecret(): string | undefined {
  return (
    process.env.SMARTBUZ_SERVER_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.SESSION_SECRET
  );
}

/**
 * Call a Convex mutation and return its value, or null when it failed.
 */
async function convexMutation(path: string, args: Record<string, unknown>) {
  try {
    const res = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, args, format: "json" }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== "success") return null;
    return data.value ?? null;
  } catch {
    return null;
  }
}

/**
 * Simple in-memory login throttling.
 * Blocks credential-stuffing / brute-force attempts against a single account.
 */
const MAX_LOGIN_ATTEMPTS = 8;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const loginAttempts = new Map<string, { count: number; firstAt: number }>();

function recordFailedLogin(email: string, now: number) {
  const existing = loginAttempts.get(email);
  if (!existing || now - existing.firstAt > LOGIN_WINDOW_MS) {
    loginAttempts.set(email, { count: 1, firstAt: now });
  } else {
    existing.count += 1;
  }
}

/**
 * POST to Convex, retrying once when the connection itself fails.
 *
 * Only a thrown error (DNS failure, connection reset) is retried - an HTTP
 * response, including a 401 from Convex, is returned as it is. Returns null
 * when the backend could not be reached at all.
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
/** POST /api/auth/login */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "logout") {
    // Revoke the session on the server first, so the access token stops
    // working straight away rather than lingering until it expires.
    const session = await getSessionFromRequest(request);
    if (session?.sessionId) {
      await convexMutation("users:endSession", {
        sessionId: session.sessionId,
        serverSecret: serverSecret(),
      });
    }

    const res = NextResponse.json({ success: true });
    clearSessionCookie(res);
    return res;
  }

  // Default: login
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!IS_CONVEX_URL_CONFIGURED) {
      console.error("SMARTBUZ: NEXT_PUBLIC_CONVEX_URL is not set. Cannot authenticate.");
      return NextResponse.json(
        { success: false, error: "Server is not configured. Contact support." },
        { status: 503 }
      );
    }

    // In-memory rate limit: blunt but effective against credential stuffing.
    // Note: this is per server instance, so on serverless it is best-effort.
    const now = Date.now();
    const attempts = loginAttempts.get(normalizedEmail);
    if (attempts && attempts.count >= MAX_LOGIN_ATTEMPTS && now - attempts.firstAt < LOGIN_WINDOW_MS) {
      const waitSeconds = Math.ceil((LOGIN_WINDOW_MS - (now - attempts.firstAt)) / 1000);
      return NextResponse.json(
        {
          success: false,
          error: `Too many failed login attempts. Please try again in ${waitSeconds} seconds.`,
        },
        { status: 429 }
      );
    }

    // Call Convex HTTP API to validate credentials.
    // A transient DNS/network failure must not read as a wrong password, so
    // the call is retried once before it is treated as a failure.
    const convexRes = await convexFetchWithRetry(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users:login",
        args: { email: normalizedEmail, password },
        format: "json",
      }),
    });

    if (!convexRes) {
      recordFailedLogin(normalizedEmail, now);
      return NextResponse.json(
        { success: false, error: "Could not reach the server. Please try again." },
        { status: 503 }
      );
    }

    if (!convexRes.ok) {
      const text = await convexRes.text();
      console.error("Convex login error:", text);
      recordFailedLogin(normalizedEmail, now);
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const data = await convexRes.json();

    // Convex mutations return { status: "success", value: ... }
    if (data.status !== "success" || !data.value) {
      // The account may simply need its email verified. The backend only
      // says that *after* the password has been checked, so surfacing the
      // message reveals nothing that a correct password does not already
      // prove — and it is the only way the person can learn what to do
      // next.
      const message: string | undefined = data.errorMessage;
      if (typeof message === "string" && /verify your email/i.test(message)) {
        return NextResponse.json(
          { success: false, error: message },
          { status: 403 }
        );
      }

      recordFailedLogin(normalizedEmail, now);
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Successful login — clear the counter for this email
    loginAttempts.delete(normalizedEmail);

    const user = data.value;

    // Open a server-side session. The browser gets an HttpOnly cookie
    // holding the session id and secret; the backend keeps only the hash
    // of the secret, and the session can be revoked at any time.
    const secret = serverSecret();
    let sessionId: string | undefined;
    let sessionSecret: string | undefined;

    if (secret) {
      const session = await convexMutation("users:startSession", {
        userId: user._id,
        ip: request.headers.get("x-forwarded-for") ?? undefined,
        userAgent: request.headers.get("user-agent") ?? undefined,
        serverSecret: secret,
      });
      sessionId = session?.sessionId;
      sessionSecret = session?.secret;
    }

    const res = NextResponse.json({ success: true, user });
    await setSessionCookie(res, {
      userId: user._id,
      email: user.email,
      sessionId,
      sessionSecret,
    });
    return res;
  } catch (err: any) {
    console.error("Auth login error:", err);

    // A missing/short SESSION_SECRET throws while signing the cookie. Say so
    // plainly — a generic "Authentication failed" sends people hunting for a
    // password problem that does not exist.
    const isSecretMisconfigured =
        typeof err?.message === "string" && err.message.includes("SESSION_SECRET");

    return NextResponse.json(
      {
        success: false,
        error: isSecretMisconfigured
          ? "Server configuration error: SESSION_SECRET is missing or too short (needs 32+ characters). See .env.example."
          : "Authentication failed",
      },
      { status: 500 }
    );
  }
}

/** GET /api/auth/me */
export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: session });
}
