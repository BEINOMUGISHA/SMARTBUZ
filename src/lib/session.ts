/**
 * SMARTBUZ Session Management
 *
 * Provides server-side session helpers using a signed HttpOnly cookie.
 * The cookie stores a simple signed payload: base64(userId + email) + "." + HMAC-SHA256 signature.
 * This prevents client-side tampering and eliminates the plain-email-in-localStorage vulnerability.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "crypto";

const SESSION_COOKIE = "sb_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET env variable is missing or too short (must be ≥ 32 chars)."
    );
  }
  return secret;
}

/** Create a signed session token string */
export function signSession(payload: { userId: string; email: string }): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", getSecret()).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/** Verify and decode a session token. Returns null if invalid / tampered. */
export function verifySession(token: string): { userId: string; email: string } | null {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = createHmac("sha256", getSecret()).update(data).digest("base64url");
    // Constant-time comparison to prevent timing attacks
    if (sig.length !== expected.length) return null;
    let diff = 0;
    for (let i = 0; i < sig.length; i++) {
      diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    if (diff !== 0) return null;
    return JSON.parse(Buffer.from(data, "base64url").toString());
  } catch {
    return null;
  }
}

/** Set the session cookie on a NextResponse */
export function setSessionCookie(res: NextResponse, payload: { userId: string; email: string }): void {
  const token = signSession(payload);
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });
}

/** Clear the session cookie (logout) */
export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}

/** Read and verify the session from incoming request cookies */
export function getSessionFromRequest(req: NextRequest): { userId: string; email: string } | null {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Read and verify the session inside a Server Component or Route Handler (Next.js 13+) */
export async function getSession(): Promise<{ userId: string; email: string } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
