/**
 * SMARTBUZ Next.js Middleware
 *
 * FIX #3: Server-side enforcement of license and authentication.
 *
 * This middleware runs on the Edge before any page renders.
 * It checks:
 *   1. License cookie (sb_license) — if missing/invalid → redirect to /locked
 *   2. Session cookie (sb_session) — if missing on protected routes → redirect to /auth/login
 *
 * Auth pages (/auth/*) and public API routes are excluded from session checks.
 * The /locked page and /api/validate-license are excluded from license checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

const LICENSE_COOKIE = "sb_license";

// Routes that are always public (no license or session needed)
const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/locked",
  "/api/validate-license",
  "/api/auth",
  "/_next",
  "/favicon.ico",
  "/manifest.json",
  "/sw.js",
  "/images",
  "/bac.jpg",
  "/logo.ico",
  "/notfound.png",
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?"));
}

function isValidLicense(req: NextRequest): boolean {
  const licenseCookie = req.cookies.get(LICENSE_COOKIE)?.value;
  if (!licenseCookie) return false;

  const rawKeys = process.env.LICENSE_KEYS ?? "";
  const validKeys = new Set(
    rawKeys
      .split(",")
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean)
  );

  return validKeys.size > 0 && validKeys.has(licenseCookie.trim().toUpperCase());
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public/static paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // 1. License gate — redirect to /locked if no valid license cookie
  if (!isValidLicense(req)) {
    const url = req.nextUrl.clone();
    url.pathname = "/locked";
    return NextResponse.redirect(url);
  }

  // 2. Session gate — redirect to login if not authenticated on dashboard routes
  const session = getSessionFromRequest(req);
  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
