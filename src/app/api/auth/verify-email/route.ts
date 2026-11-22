/**
 * SMARTBUZ — proving an email address.
 *
 * The browser used to call the backend through the Convex client; it calls
 * this server instead, so that the public routes carry no Convex client.
 *
 * The code is checked by the backend, which stores only its hash, counts
 * the attempts and refuses a code that has expired or has already been
 * used.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleVerifyEmail } from "@/lib/public-auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/verify-email */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const result = await handleVerifyEmail(body);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error("Verify email error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
