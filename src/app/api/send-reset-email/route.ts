/**
 * SMARTBUZ Password Reset Email API
 *
 * FIX #5: Password reset codes are sent via real email (Resend).
 * The Convex mutation generates the code and stores only its hash; this
 * route asks for it with the shared server secret and emails it.
 *
 * Because the code is only ever handed to the server, nobody can request a
 * reset for somebody else's account and complete the takeover without
 * reading the victim's inbox.
 *
 * Setup required:
 *   1. Create a free Resend account at https://resend.com
 *   2. Add your domain and get an API key
 *   3. Set RESEND_API_KEY=re_xxxx in .env.local
 *   4. Set RESEND_FROM_EMAIL=noreply@yourdomain.com in .env.local
 */

import { NextRequest, NextResponse } from "next/server";
import { sendAuthEmail } from "@/lib/email";
import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";
import { clientIp, throttleKey } from "@/lib/client-ip";

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
      console.error("SMARTBUZ: NEXT_PUBLIC_CONVEX_URL is not set. Cannot send reset email.");
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

    // Step 1: generate the reset code server-side.
    // `serverSecret` proves this call comes from our own server, so the
    // Convex mutation only reveals the code to us — never to a browser.
    // `clientIp` lets the backend cap how much mail one caller can cause.
    const convexRes = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users:requestPasswordReset",
        args: {
          email: normalizedEmail,
          serverSecret: secret,
          clientIp: throttleKey("ip", clientIp(request) ?? "unknown"),
        },
        format: "json",
      }),
    });

    const convexData = await convexRes.json().catch(() => null);
    const code = convexData?.value?.code;

    // No code means no account with that email (or delivery is unavailable).
    // We still return success so the endpoint cannot be used to enumerate
    // registered email addresses.
    if (!code) {
      return NextResponse.json({ success: true, messageId: null });
    }

    const messageId = await sendAuthEmail({
      to: normalizedEmail,
      code,
      heading: "Password Reset Request",
      description: `We received a request to reset the password for your account associated with ${normalizedEmail}. Use the 6-digit code below to proceed.`,
      expiresIn: "1 hour",
      subject: "Your SMARTBUZ Password Reset Code",
    });

    return NextResponse.json({ success: true, messageId });
  } catch (err: any) {
    console.error("Send reset email error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
