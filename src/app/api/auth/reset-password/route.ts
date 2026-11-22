/**
 * SMARTBUZ — completing a password reset.
 *
 * The browser used to call the backend through the Convex client; it calls
 * this server instead, so that the public routes carry no Convex client.
 *
 * The code is the proof. It is checked by the backend against the hash it
 * stored, counted so that it cannot be guessed, and refused once it has
 * been used or has expired.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleResetPassword } from "@/lib/public-auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/reset-password */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const result = await handleResetPassword(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error("Reset password error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
