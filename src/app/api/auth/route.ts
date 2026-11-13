/**
 * SMARTBUZ Auth API Routes
 *
 * POST /api/auth/login   - Validate credentials, issue HttpOnly session cookie
 * POST /api/auth/logout  - Clear session cookie
 * GET  /api/auth/me      - Return current session user info (for client hydration)
 */

import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, clearSessionCookie, getSessionFromRequest } from "@/lib/session";
import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";

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

/** POST /api/auth/login */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");

  if (action === "logout") {
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

    // Call Convex HTTP API to validate credentials
    const convexRes = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users:login",
        args: { email: normalizedEmail, password },
        format: "json",
      }),
    });

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
      recordFailedLogin(normalizedEmail, now);
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Successful login — clear the counter for this email
    loginAttempts.delete(normalizedEmail);

    const user = data.value;

    const res = NextResponse.json({ success: true, user });
    await setSessionCookie(res, { userId: user._id, email: user.email });
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
