/**
 * SMARTBUZ — small cryptographic helpers.
 *
 * Kept in one place so the backend hashes a value the same way wherever it
 * is checked.
 */

/**
 * The bcrypt cost factor used for stored passwords.
 *
 * 10 — which is what this codebase was using — is bcrypt's *minimum*. It
 * is fast enough to be worth attacking: commodity hardware checks
 * millions of candidates a second at that cost, so a database that leaks
 * turns a password into a lookup rather than a guessing problem.
 *
 * 12 is the usual floor for a password a human chose and can remember.
 * It costs about a quarter of a second to verify, which is invisible to
 * the person signing in and expensive for whoever is trying every word in
 * a list.
 *
 * The cost is stored inside each hash, so passwords hashed at the old
 * factor still verify. They are re-hashed at the new factor the next time
 * their owner signs in, which upgrades the whole table gradually without
 * ever locking anybody out.
 */
export const PASSWORD_HASH_COST = 12;

/**
 * The cost factor a stored hash was created with, or `null` when the value
 * is not a bcrypt hash at all.
 *
 * It is used to notice a hash that is weaker than the current setting, so
 * that it can be replaced while its owner is signing in.
 */
export function bcryptCostOf(hash: string): number | null {
    const match = /^\$2[aby]\$(\d{2})\$/.exec(hash);
    if (!match) return null;
    const cost = Number(match[1]);
    return Number.isFinite(cost) ? cost : null;
}

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

/* ────────────────────────────────────────────────────────────────────────
 * Encryption — for provider credentials
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * A sealed secret, ready to be stored in the database.
 *
 * `iv` and `salt` are stored in the clear because they are not secret —
 * they are the salt and the nonce that make the ciphertext unique. The
 * passphrase never leaves the server environment.
 */
export interface SealedSecret {
  /** Base64 ciphertext, including the GCM authentication tag. */
  ciphertext: string;
  /** Base64 initialisation vector. */
  iv: string;
  /** Base64 key-derivation salt. */
  salt: string;
  /** The cipher used, so an old value stays readable after a change. */
  alg: "AES-GCM";
}

/** The number of PBKDF2 iterations used to derive the key. */
const PBKDF2_ITERATIONS = 120_000;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  // `btoa` is available in both the Convex runtime and the browser.
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derive an encryption key from a passphrase.
 *
 * PBKDF2 with a random salt, so the same passphrase produces a different
 * key for every secret. That means one stolen ciphertext cannot be used to
 * test a guess against every other stored secret at once.
 */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as unknown as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/**
 * Encrypt a secret for storage.
 *
 * AES-GCM, so the ciphertext is authenticated: if anyone alters the stored
 * value, decryption fails loudly rather than returning a wrong key.
 */
export async function encryptSecret(
  plaintext: string,
  passphrase: string
): Promise<SealedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  );

  return {
    ciphertext: toBase64(new Uint8Array(encrypted)),
    iv: toBase64(iv),
    salt: toBase64(salt),
    alg: "AES-GCM",
  };
}

/**
 * Decrypt a stored secret.
 *
 * Returns `null` rather than throwing when the value cannot be read — a
 * secret that was encrypted under a different passphrase, or that has been
 * tampered with, is treated as "not configured" so the operator is told to
 * re-enter it instead of the whole page failing.
 */
export async function decryptSecret(
  sealed: SealedSecret | null | undefined,
  passphrase: string
): Promise<string | null> {
  if (!sealed || !sealed.ciphertext || !sealed.iv || !sealed.salt) {
    return null;
  }

  try {
    const key = await deriveKey(passphrase, fromBase64(sealed.salt));
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.iv) as unknown as BufferSource },
      key,
      fromBase64(sealed.ciphertext) as unknown as BufferSource
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return null;
  }
}
