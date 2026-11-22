/**
 * SMARTBUZ — account registration.
 *
 * The register screen used to call the backend through the Convex client,
 * which meant the sign-in route carried the whole client in order to let a
 * stranger create an account. It calls the server instead.
 *
 * The server creates the account and emails the verification code. The
 * code never travels through the browser — it goes from the backend, to
 * this server, to the inbox.
 */

import { NextRequest, NextResponse } from "next/server";
import { handleRegister } from "@/lib/public-auth";

export const dynamic = "force-dynamic";

/** POST /api/auth/register */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const result = await handleRegister(body, request);
    return NextResponse.json(result.body, { status: result.status });
  } catch (err: unknown) {
    console.error("Register error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
