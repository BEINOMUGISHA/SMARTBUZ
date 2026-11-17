/**
 * SMARTBUZ — small cryptographic helpers.
 *
 * Kept in one place so the backend hashes a value the same way wherever it
 * is checked.
 */

/**
 * SHA-256 of a UTF-8 string, hex encoded.
 *
 * Used for the session secret: the server keeps the hash and the browser
 * keeps the secret, so a database read cannot be used to impersonate a
 * signed-in session.
 */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Constant-time comparison of two hex digests.
 *
 * The length check short-circuits, which is fine for a fixed-length
 * digest; the character loop then does not leak how much matched.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
