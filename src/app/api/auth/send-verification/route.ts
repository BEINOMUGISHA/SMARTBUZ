/**
 * SMARTBUZ — email verification delivery.
 *
 * A new account cannot sign in until its address is proven. This route is
 * the only thing that can produce the code: it asks the backend for one
 * using the shared server secret and emails it out.
 *
 * The browser never sees the code. That is deliberate — otherwise anybody
 * could verify an address they do not own.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendAuthEmail } from "@/lib/email";
import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";

export const dynamic = "force-dynamic";

/**
 * The shared secret that proves a call comes from this server.
 */
function serverSecret(): string | undefined {
  return (
    process.env.SMARTBUZ_SERVER_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.SESSION_SECRET
  );
}

/** POST /api/auth/send-verification */
export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== "string") {
      return NextResponse.json(
        { success: false, error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    if (!IS_CONVEX_URL_CONFIGURED) {
      console.error("SMARTBUZ: NEXT_PUBLIC_CONVEX_URL is not set.");
      return NextResponse.json(
        { success: false, error: "Server is not configured. Contact support." },
        { status: 503 }
      );
    }

    const secret = serverSecret();
    if (!secret) {
      console.error(
        "SMARTBUZ: no server secret configured (SMARTBUZ_SERVER_SECRET / RESEND_API_KEY / SESSION_SECRET)."
      );
      return NextResponse.json(
        { success: false, error: "Email delivery is not configured on this server." },
        { status: 503 }
      );
    }

    // Ask the backend for a code. It answers "success" even when the
    // address is unknown, so this endpoint cannot be used to discover
    // which addresses have accounts.
    const convexRes = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users:requestVerification",
        args: { email: normalizedEmail, serverSecret: secret },
        format: "json",
      }),
    });

    const convexData = await convexRes.json().catch(() => null);
    const code = convexData?.value?.code;

    if (!code) {
      // No account, or the address is already verified. Answer the same
      // way either way.
      return NextResponse.json({ success: true, messageId: null });
    }

    const messageId = await sendAuthEmail({
      to: normalizedEmail,
      code,
      heading: "Verify your email address",
      description: `Welcome to SMARTBUZ. Use the 6-digit code below to verify ${normalizedEmail} and activate your account.`,
      expiresIn: "24 hours",
      subject: "Your SMARTBUZ Verification Code",
    });

    return NextResponse.json({ success: true, messageId });
  } catch (err: any) {
    console.error("Send verification email error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
