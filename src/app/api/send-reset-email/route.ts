/**
 * SMARTBUZ Password Reset Email API
 *
 * FIX #5: Password reset codes are now sent via real email (Resend).
 * The Convex mutation generates the code and stores it.
 * The frontend then calls this API route to deliver it to the user's inbox.
 *
 * Setup required:
 *   1. Create a free Resend account at https://resend.com
 *   2. Add your domain and get an API key
 *   3. Set RESEND_API_KEY=re_xxxx in .env.local
 *   4. Set RESEND_FROM_EMAIL=noreply@yourdomain.com in .env.local
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { CONVEX_URL, IS_CONVEX_URL_CONFIGURED } from "@/lib/convex-url";

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

    // Instantiate Resend lazily so a missing API key cannot break the production
    // build (module-scope `new Resend(undefined)` throws during page data collection).
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("SMARTBUZ: RESEND_API_KEY is not set. Cannot send reset email.");
      return NextResponse.json(
        { success: false, error: "Email delivery is not configured on this server." },
        { status: 503 }
      );
    }
    const resend = new Resend(apiKey);

    // Step 1: generate the reset code server-side.
    // `serverSecret` proves this call comes from our own server, so the
    // Convex mutation only reveals the code to us — never to a browser.
    const convexRes = await fetch(`${CONVEX_URL}/api/mutation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: "users:requestPasswordReset",
        args: { email: normalizedEmail, serverSecret: apiKey },
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

    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@smartbuz.app";
    const appName = "SMARTBUZ POS";

    const { data, error } = await resend.emails.send({
      from: `${appName} <${fromEmail}>`,
      to: [email],
      subject: `Your ${appName} Password Reset Code`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Password Reset</title>
        </head>
        <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
            <tr>
              <td align="center">
                <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
                  <!-- Header -->
                  <tr>
                    <td style="background:linear-gradient(135deg,#059669,#0d9488);padding:32px 40px;text-align:center;">
                      <div style="display:inline-flex;align-items:center;gap:10px;">
                        <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;">
                          <span style="color:#fff;font-size:18px;font-weight:900;">S</span>
                        </div>
                        <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${appName}</span>
                      </div>
                    </td>
                  </tr>
                  <!-- Body -->
                  <tr>
                    <td style="padding:40px;">
                      <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.5px;">
                        Password Reset Request
                      </h1>
                      <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6;">
                        We received a request to reset the password for your account associated with
                        <strong style="color:#111827;">${email}</strong>.
                        Use the 6-digit code below to proceed.
                      </p>
                      <!-- OTP Code Box -->
                      <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
                        <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">
                          Verification Code
                        </p>
                        <p style="margin:0;font-size:40px;font-weight:900;letter-spacing:12px;color:#059669;font-variant-numeric:tabular-nums;">
                          ${code}
                        </p>
                      </div>
                      <p style="margin:0 0 8px;color:#9ca3af;font-size:13px;text-align:center;">
                        This code expires in <strong>1 hour</strong>.
                      </p>
                      <p style="margin:0;color:#9ca3af;font-size:13px;text-align:center;">
                        If you did not request a password reset, please ignore this email. Your account is safe.
                      </p>
                    </td>
                  </tr>
                  <!-- Footer -->
                  <tr>
                    <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #f3f4f6;">
                      <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">
                        &copy; ${new Date().getFullYear()} SMARTBUZ. All rights reserved.<br>
                        This is an automated message — please do not reply.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
    });

    if (error) {
      console.error("Resend email error:", error);
      return NextResponse.json(
        { success: false, error: "Failed to send email. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, messageId: data?.id });
  } catch (err: any) {
    console.error("Send reset email error:", err);
    return NextResponse.json(
      { success: false, error: "Internal server error" },
      { status: 500 }
    );
  }
}
