/**
 * SMART_BUZ Next.js Middleware
 *
 * Session enforcement only.
 *
 * The license/activation gate was removed on request: there is no license
 * cookie, no /locked page and no activation screen. Any visitor with a valid
 * session reaches the application; anyone without one is sent to the login
 * page.
 *
 * The middleware runs on the Edge before any page renders.
 *
 * Auth pages (/auth/*) and public API routes are excluded from session checks.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

// Routes that are always public (no session needed)
const PUBLIC_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow public/static paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Session gate — redirect to login if not authenticated on dashboard routes
  const session = await getSessionFromRequest(req);
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
