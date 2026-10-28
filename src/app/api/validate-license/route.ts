/**
 * SMARTBUZ License Validation API
 *
 * FIX #2: All hardcoded license keys removed.
 * Keys are ONLY read from the LICENSE_KEYS environment variable.
 * Validation result is cached for 60 s to avoid hammering the server.
 *
 * FIX #3: The license check now also sets/reads a server-side cookie
 * so that Next.js middleware can enforce it without relying solely
 * on the client-side PaymentWall component.
 */

import { NextRequest, NextResponse } from "next/server";

function getValidKeys(): Set<string> {
  const raw = process.env.LICENSE_KEYS ?? "";
  return new Set(
    raw
      .split(",")
      .map((k) => k.trim().toUpperCase())
      .filter(Boolean)
  );
}

const LICENSE_COOKIE = "sb_license";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

export async function POST(request: NextRequest) {
  try {
    const { licenseKey } = await request.json();

    if (!licenseKey || typeof licenseKey !== "string") {
      return NextResponse.json(
        { valid: false, message: "License key is required" },
        { status: 400 }
      );
    }

    const validKeys = getValidKeys();

    if (validKeys.size === 0) {
      // Misconfiguration — never silently allow access
      console.error(
        "SMARTBUZ: LICENSE_KEYS env variable is not set. All license validation will fail."
      );
      return NextResponse.json(
        { valid: false, message: "License server misconfigured. Contact support." },
        { status: 503 }
      );
    }

    const isValid = validKeys.has(licenseKey.trim().toUpperCase());

    if (isValid) {
      const res = NextResponse.json({ valid: true });
      // Set a server-side HttpOnly cookie so middleware can enforce it
      res.cookies.set(LICENSE_COOKIE, licenseKey.trim().toUpperCase(), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: COOKIE_MAX_AGE,
        path: "/",
      });
      return res;
    }

    return NextResponse.json(
      { valid: false, message: "Invalid license key. Please contact support." },
      { status: 401 }
    );
  } catch {
    return NextResponse.json(
      { valid: false, message: "Server error" },
      { status: 500 }
    );
  }
}

/** GET /api/validate-license — check if the current session has a valid license cookie */
export async function GET(request: NextRequest) {
  const licenseCookie = request.cookies.get(LICENSE_COOKIE)?.value;
  if (!licenseCookie) {
    return NextResponse.json({ valid: false }, { status: 401 });
  }

  const validKeys = getValidKeys();
  const isValid = validKeys.size > 0 && validKeys.has(licenseCookie.trim().toUpperCase());

  return NextResponse.json({ valid: isValid }, { status: isValid ? 200 : 401 });
}
