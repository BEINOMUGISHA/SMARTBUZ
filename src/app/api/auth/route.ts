/**
 * SMARTBUZ Auth API Routes
 *
 * POST /api/auth/login   - Validate credentials, issue HttpOnly session cookie
 * POST /api/auth/logout  - Clear session cookie
 * GET  /api/auth/me      - Return current session user info (for client hydration)
 */

import { NextRequest, NextResponse } from "next/server";
import { setSessionCookie, clearSessionCookie, getSessionFromRequest } from "@/lib/session";

const CONVEX_URL = process.env.NEXT_PUBLIC_CONVEX_URL!;

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

    // Call Convex HTTP API to validate credentials
    const convexRes = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users:login",
        args: { email: email.trim().toLowerCase(), password },
        format: "json",
      }),
    });

    if (!convexRes.ok) {
      const text = await convexRes.text();
      console.error("Convex login error:", text);
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const data = await convexRes.json();

    // Convex mutations return { status: "success", value: ... }
    if (data.status !== "success" || !data.value) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const user = data.value;

    const res = NextResponse.json({ success: true, user });
    setSessionCookie(res, { userId: user._id, email: user.email });
    return res;
  } catch (err: any) {
    console.error("Auth login error:", err);
    return NextResponse.json(
      { success: false, error: "Authentication failed" },
      { status: 500 }
    );
  }
}

/** GET /api/auth/me */
export async function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }
  return NextResponse.json({ user: session });
}
