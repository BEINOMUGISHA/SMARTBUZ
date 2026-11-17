/**
 * SMARTBUZ Session Management
 *
 * Provides server-side session helpers using a signed HttpOnly cookie.
 * The cookie stores a signed payload: base64(userId + email + session
 * credentials) + "." + HMAC-SHA256 signature.
 * This prevents client-side tampering and eliminates the plain-email-in-localStorage vulnerability.
 *
 * ────────────────────────────────────────────────────────────────────────
 * What the cookie carries (Phase 2)
 * ────────────────────────────────────────────────────────────────────────
 *
 * Besides the user's identity, the cookie now carries the *session
 * credentials*:
 *
 *  - `sessionId` — the public id of a server-side session row;
 *  - `sessionSecret` — a high-entropy secret, of which the backend only
 *    keeps a hash.
 *
 * The Convex access token minted from this cookie carries the same two
 * values as claims, so the backend can check that the token belongs to a
 * live session *and* that the session secret matches. Signing a session
 * out revokes the row, which stops the token immediately instead of
 * waiting out its 15-minute lifetime.
 */

import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "sb_session";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  userId: string;
  email: string;
  /** The server-side session this cookie stands for. */
  sessionId?: string;
  /** The secret bound to that session. */
  sessionSecret?: string;
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET env variable is missing or too short (must be ≥ 32 chars)."
    );
  }
  return secret;
}

/**
 * Base64url encode a UTF-8 string.
 * Uses btoa (available in Edge runtime) instead of Buffer (Node-only).
 */
function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Base64url decode back to a UTF-8 string. */
function decodeBase64Url(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const withPadding = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

/**
 * HMAC-SHA256 using the Web Crypto API.
 * Web Crypto is available in both the Edge runtime (middleware) and Node 18+,
 * unlike `node:crypto`, which is unsupported on Edge.
 */
async function hmacSha256Base64Url(secret: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Constant-time string comparison to prevent timing attacks. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Create a signed session token string */
export async function signSession(payload: SessionPayload): Promise<string> {
  const data = encodeBase64Url(JSON.stringify(payload));
  const sig = await hmacSha256Base64Url(getSecret(), data);
  return `${data}.${sig}`;
}

/** Verify and decode a session token. Returns null if invalid / tampered. */
export async function verifySession(
  token: string
): Promise<SessionPayload | null> {
  try {
    const [data, sig] = token.split(".");
    if (!data || !sig) return null;
    const expected = await hmacSha256Base64Url(getSecret(), data);
    if (!timingSafeEqual(sig, expected)) return null;
    return JSON.parse(decodeBase64Url(data));
  } catch {
    return null;
  }
}

/** Set the session cookie on a NextResponse */
export async function setSessionCookie(
  res: NextResponse,
  payload: SessionPayload
): Promise<void> {
  const token = await signSession(payload);
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
export async function getSessionFromRequest(
  req: NextRequest
): Promise<SessionPayload | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/** Read and verify the session inside a Server Component or Route Handler (Next.js 13+) */
export async function getSession(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}
