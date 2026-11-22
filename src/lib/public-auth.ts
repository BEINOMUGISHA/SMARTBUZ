/**
 * SMARTBUZ — what the public auth routes do.
 *
 * The sign-in, register, address-verification and password-reset routes
 * used to call the backend through the Convex client, which meant the
 * sign-in screen downloaded 24 KB gzipped of client it did not use. They
 * call this server instead, and the server calls the backend.
 *
 * The logic lives here rather than in the route files so that it can be
 * tested without the Next.js server runtime: a route file is a thin wrapper
 * that turns a `Request` into an HTTP response.
 *
 * Two rules hold throughout:
 *
 *   - when the backend cannot be reached, the answer says so. It must not
 *     report success (that would tell a person their account was made when
 *     it was not), and it must not report the backend's error message
 *     (that would tell a person their password was wrong when the server
 *     was down);
 *   - when the backend *did* answer, its message is passed back untouched,
 *     because "An account with this email already exists" is the answer
 *     the person needs.
 */

import { sendAuthEmail } from "@/lib/email";
import { clientIp, throttleKey } from "@/lib/client-ip";
import { convexMutation, serverSecret } from "@/lib/convex-server";

/** What a public auth route answers with. */
export type PublicAuthResult = {
  status: number;
  body: {
    success: boolean;
    error?: string;
    /** Whether a verification code was actually sent. */
    emailed?: boolean;
    messageId?: string | null;
  };
};

function badRequest(error: string): PublicAuthResult {
  return { status: 400, body: { success: false, error } };
}

function unreachable(): PublicAuthResult {
  return {
    status: 503,
    body: { success: false, error: "Could not reach the server. Please try again." },
  };
}

/** Read a field out of a request body that may be anything at all. */
function textField(body: unknown, name: string): string {
  if (!body || typeof body !== "object") return "";
  const value = (body as Record<string, unknown>)[name];
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Create an account and email the verification code.
 *
 * The code never travels through the browser: it goes from the backend, to
 * this server, to the inbox. That is what makes the verification worth
 * something — otherwise anybody could create an account for an address they
 * do not own and then activate it.
 */
export async function handleRegister(
  rawBody: unknown,
  request: Request
): Promise<PublicAuthResult> {
  const firstName = textField(rawBody, "first_name");
  const lastName = textField(rawBody, "last_name");
  const email = textField(rawBody, "email").toLowerCase();
  const password = textField(rawBody, "password");
  const phone = textField(rawBody, "phone_number");

  if (!firstName || !lastName) {
    return badRequest("First and last name are required");
  }

  if (!email) {
    return badRequest("Email is required");
  }

  if (password.length < 8) {
    return badRequest("Password must be at least 8 characters long");
  }

  const created = await convexMutation<{ success: boolean; userId: string }>("users:register", {
    first_name: firstName,
    last_name: lastName,
    email,
    password,
    phone_number: phone || undefined,
  });

  if (!created.ok) {
    if (created.unreachable) return unreachable();
    return badRequest(created.error ?? "Could not create the account.");
  }

  // Ask for a verification code and email it.
  //
  // The code is only handed to a caller holding the server secret, so it
  // never reaches the browser. The send is throttled by the backend, so
  // this route cannot be used to make the server mail anybody at will.
  const secret = serverSecret();
  if (!secret) {
    // The account exists. Say so, and let the person ask for the code
    // again from the verification screen once delivery is configured.
    console.error(
      "SMARTBUZ: no server secret configured (SMARTBUZ_SERVER_SECRET / RESEND_API_KEY / SESSION_SECRET)."
    );
    return { status: 200, body: { success: true, emailed: false } };
  }

  const requested = await convexMutation<{ success: boolean; code?: string }>(
    "users:requestVerification",
    {
      email,
      serverSecret: secret,
      clientIp: throttleKey("ip", clientIp(request) ?? "unknown"),
    }
  );

  const code = requested.ok ? requested.value?.code : undefined;

  if (!code) {
    // The account is created but the code could not be issued. The person
    // can ask for another code from the verification screen.
    return { status: 200, body: { success: true, emailed: false } };
  }

  const messageId = await sendAuthEmail({
    to: email,
    code,
    heading: "Verify your email address",
    description: `Welcome to SMARTBUZ. Use the 6-digit code below to verify ${email} and activate your account.`,
    expiresIn: "24 hours",
    subject: "Your SMARTBUZ Verification Code",
  });

  return { status: 200, body: { success: true, emailed: true, messageId } };
}

/**
 * Prove an email address with the code that was sent to it.
 *
 * The backend stores only the hash of the code, counts the attempts and
 * refuses a code that has expired or has already been used.
 */
export async function handleVerifyEmail(rawBody: unknown): Promise<PublicAuthResult> {
  const email = textField(rawBody, "email").toLowerCase();
  const code = textField(rawBody, "code");

  if (!email || !code) {
    return badRequest("Email and code are required");
  }

  const result = await convexMutation<{ success: boolean }>("users:verifyEmail", {
    email,
    code,
  });

  if (!result.ok) {
    if (result.unreachable) return unreachable();
    return badRequest(result.error ?? "That code is not valid.");
  }

  return { status: 200, body: { success: true } };
}

/**
 * Complete a password reset.
 *
 * The code is the proof. It is checked by the backend against the hash it
 * stored, counted so that it cannot be guessed, and refused once it has
 * been used or has expired.
 */
export async function handleResetPassword(rawBody: unknown): Promise<PublicAuthResult> {
  const email = textField(rawBody, "email").toLowerCase();
  const code = textField(rawBody, "code");
  const newPassword = textField(rawBody, "newPassword");

  if (!email || !code || !newPassword) {
    return badRequest("Email, code and a new password are required");
  }

  if (newPassword.length < 8) {
    return badRequest("Password must be at least 8 characters long");
  }

  const result = await convexMutation<{ success: boolean }>("users:resetPassword", {
    email,
    code,
    newPassword,
  });

  if (!result.ok) {
    if (result.unreachable) return unreachable();
    return badRequest(result.error ?? "That code is not valid.");
  }

  return { status: 200, body: { success: true } };
}
