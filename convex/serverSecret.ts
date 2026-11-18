/**
 * SMARTBUZ — the server-to-backend shared secret.
 *
 * Some operations must never be reachable from a browser: opening a
 * session, reading a password-reset code, emailing a verification code.
 * They are guarded by a secret that only the Next.js server and the Convex
 * deployment know.
 *
 * The secret is read from the first of these environment variables that is
 * set:
 *
 *   1. `SMARTBUZ_SERVER_SECRET` — preferred, dedicated to this purpose;
 *   2. `RESEND_API_KEY` — the existing deployment secret;
 *   3. `SESSION_SECRET` — the cookie-signing secret.
 *
 * If none of them is configured, **no secret matches**. That is the safe
 * direction to fail in: the affected operations stay closed rather than
 * opening to anybody who sends an empty string.
 */

/** The configured secret, or `undefined` when none is available. */
function configuredSecret(): string | undefined {
  const secret =
    process.env.SMARTBUZ_SERVER_SECRET ||
    process.env.RESEND_API_KEY ||
    process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) return undefined;
  return secret;
}

/**
 * True when `provided` is the server secret.
 *
 * The comparison is length-checked first and then compared character by
 * character, so the time it takes does not depend on how many characters
 * matched.
 */
export function serverSecretMatches(provided: string | undefined): boolean {
  const secret = configuredSecret();
  if (!secret) return false;
  if (!provided) return false;
  if (provided.length !== secret.length) return false;

  let diff = 0;
  for (let i = 0; i < secret.length; i++) {
    diff |= secret.charCodeAt(i) ^ provided.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * True when a server secret is configured at all.
 *
 * The Next.js routes use this to report a misconfiguration plainly rather
 * than failing with a confusing "forbidden".
 */
export function isServerSecretConfigured(): boolean {
  return configuredSecret() !== undefined;
}

/**
 * The configured secret, for use as a **pepper** when hashing.
 *
 * This never leaves the server: it is not returned to a browser and it is
 * not stored in the database. It is used to hash license keys, so that a
 * stolen copy of the database cannot be checked against guessed keys.
 *
 * When no secret is configured, a fixed fallback is used so that license
 * keys still work in development. The fallback is public, so a deployment
 * that cares must set `SMARTBUZ_SERVER_SECRET`.
 */
export function serverSecretValue(): string {
  return configuredSecret() ?? "smartbuz-license-fallback-pepper";
}
