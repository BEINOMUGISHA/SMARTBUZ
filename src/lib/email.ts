/**
 * SMARTBUZ — transactional auth email.
 *
 * Two emails go out from the server: the password-reset code and the
 * email-verification code. Both carry a short numeric code that is
 * generated on the backend and delivered here.
 *
 * The code is **never** returned to the browser. The caller of this module
 * is the Next.js server, which asks the backend for the code over the
 * private Convex API using the shared server secret, then emails it. That
 * is what stops anybody from requesting a reset for an account they do
 * not own and completing the takeover without reading the inbox.
 */

import { Resend } from "resend";

export interface AuthEmailOptions {
  to: string;
  code: string;
  /** e.g. "Password Reset Request" */
  heading: string;
  /** One sentence explaining what the code is for. */
  description: string;
  /** How long the code stays valid, e.g. "1 hour". */
  expiresIn: string;
  subject: string;
}

const APP_NAME = "SMARTBUZ POS";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Build the HTML body of an auth email.
 */
export function authEmailHtml(options: AuthEmailOptions): string {
  const heading = escapeHtml(options.heading);
  const description = escapeHtml(options.description);
  const expiresIn = escapeHtml(options.expiresIn);

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${heading}</title>
    </head>
    <body style="margin:0;padding:0;background:#f4f4f4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 20px;">
        <tr>
          <td align="center">
            <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
              <tr>
                <td style="background:linear-gradient(135deg,#059669,#0d9488);padding:32px 40px;text-align:center;">
                  <div style="display:inline-flex;align-items:center;gap:10px;">
                    <div style="width:36px;height:36px;background:rgba(255,255,255,0.2);border-radius:8px;display:inline-flex;align-items:center;justify-content:center;">
                      <span style="color:#fff;font-size:18px;font-weight:900;">S</span>
                    </div>
                    <span style="color:#ffffff;font-size:18px;font-weight:700;letter-spacing:-0.3px;">${APP_NAME}</span>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:40px;">
                  <h1 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.5px;">${heading}</h1>
                  <p style="margin:0 0 28px;color:#6b7280;font-size:15px;line-height:1.6;">${description}</p>
                  <div style="background:#f9fafb;border:2px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;margin-bottom:28px;">
                    <p style="margin:0 0 8px;font-size:12px;font-weight:600;color:#9ca3af;text-transform:uppercase;letter-spacing:1px;">Verification Code</p>
                    <p style="margin:0;font-size:40px;font-weight:900;letter-spacing:12px;color:#059669;font-variant-numeric:tabular-nums;">${escapeHtml(options.code)}</p>
                  </div>
                  <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;text-align:center;">This code expires in <strong>${expiresIn}</strong>.</p>
                  <p style="margin:0;font-size:13px;color:#9ca3af;text-align:center;">If you did not request this, please ignore this email. Your account is safe.</p>
                </td>
              </tr>
              <tr>
                <td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #f3f4f6;text-align:center;">
                  <p style="margin:0;font-size:12px;color:#9ca3af;">&copy; ${new Date().getFullYear()} SMARTBUZ. All rights reserved.<br>This is an automated message — please do not reply.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

/**
 * Send an auth email.
 *
 * Returns the provider's message id, or null when email delivery is not
 * configured or failed. It never throws: a missing API key must not take
 * the whole application down.
 */
export async function sendAuthEmail(
  options: AuthEmailOptions
): Promise<string | null> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.error("SMARTBUZ: RESEND_API_KEY is not set. Cannot send auth email.");
    return null;
  }

  try {
    const resend = new Resend(apiKey);
    const fromEmail = process.env.RESEND_FROM_EMAIL || "noreply@smartbuz.app";
    const { data, error } = await resend.emails.send({
      from: `${APP_NAME} <${fromEmail}>`,
      to: [options.to],
      subject: options.subject,
      html: authEmailHtml(options),
    });

    if (error) {
      console.error("SMARTBUZ: auth email error:", error);
      return null;
    }
    return data?.id ?? null;
  } catch (err) {
    console.error("SMARTBUZ: auth email failed:", err);
    return null;
  }
}
