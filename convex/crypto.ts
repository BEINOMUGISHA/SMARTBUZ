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

/**
 * HMAC-SHA256 of a message, hex encoded.
 *
 * This is what a license key is stored as. A plain hash would do the same
 * job for a key with enough entropy in it, but a keyed hash is better: even
 * somebody who reads the whole database cannot check a guessed key against
 * the stored value without the pepper, which lives in the environment and
 * never reaches the database.
 */
export async function hmacSha256Hex(
  secret: string,
  message: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message)
  );
  const bytes = new Uint8Array(signature);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * A random string made from an alphabet with no ambiguous characters.
 *
 * `0`/`O` and `1`/`I` are left out: a license key is read off a screen and
 * typed in by a person, and a key that cannot be misread is a key that
 * works.
 */
export function randomKeyString(
  length: number,
  alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}
