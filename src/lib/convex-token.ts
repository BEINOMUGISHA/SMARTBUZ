/**
 * SMARTBUZ — Convex access tokens.
 *
 * The Next.js server is the only component that knows the session secret, so
 * it is also the only component that can mint a token the Convex backend will
 * accept. The browser never holds the signing key: it receives a short-lived
 * RS256 JWT that Convex verifies against the deployment's own JWKS endpoint
 * (`/auth/jwks`).
 *
 * This is what makes `ctx.auth.getUserIdentity()` trustworthy, which in turn
 * is what every tenant guard in `convex/tenancy.ts` relies on. Before this
 * existed, the Convex deployment was a public API (AUDIT.md §2.1) and any
 * caller could pass any `adminUserId` (§2.2).
 *
 * The token is deliberately short-lived (15 minutes). The browser refreshes
 * it through `GET /api/auth/convex-token`, which re-reads the HttpOnly
 * session cookie server-side.
 */

import { SMARTBUZ_JWK, SMARTBUZ_JWT_AUDIENCE } from "../../convex/authJwks";

/** Access token lifetime. Short enough that a leaked token expires quickly. */
const TOKEN_TTL_SECONDS = 15 * 60;

export interface AccessTokenClaims {
  /** The Convex `users` document id of the signed-in user. */
  userId: string;
  email: string;
  name?: string;
  /**
   * The server-side session this token belongs to.
   *
   * The backend checks that the session still exists and has not been
   * revoked, so signing out stops the token immediately rather than
   * letting it live out its remaining lifetime.
   */
  sessionId?: string;
  /**
   * The secret bound to that session. The backend stores only its hash,
   * so a stolen session id on its own is not enough to use a session.
   */
  sessionSecret?: string;
}

/* ── base64url helpers (Edge + Node, no Buffer) ─────────────────────── */

function encodeBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function encodeBytesBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* ── issuer resolution ───────────────────────────────────────────────── */

/**
 * The `iss` claim must match the issuer declared in `convex/auth.config.ts`
 * exactly, otherwise Convex rejects the token. Both sides derive it from the
 * deployment's site URL.
 */
export function getAuthIssuer(): string {
  const explicit = process.env.SMARTBUZ_AUTH_ISSUER;
  if (explicit) return explicit.replace(/\/+$/, "");

  const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
  if (siteUrl) return siteUrl.replace(/\/+$/, "");

  // Derive it from the client URL: <name>.convex.cloud → <name>.convex.site
  const clientUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (clientUrl) {
    return clientUrl.replace(/\/+$/, "").replace(/\.convex\.cloud$/, ".convex.site");
  }

  return "";
}

/* ── key handling ────────────────────────────────────────────────────── */

function getPrivateKeyMaterial(): string {
  const encoded = process.env.SMARTBUZ_JWT_PRIVATE_KEY;
  if (!encoded) {
    throw new Error(
      "SMARTBUZ_JWT_PRIVATE_KEY is missing. Run `node scripts/generate-auth-keys.mjs` " +
        "and add the result to .env.local."
    );
  }
  return encoded;
}

async function importPrivateKey(): Promise<CryptoKey> {
  const der = decodeBase64UrlToBytes(getPrivateKeyMaterial());
  try {
    return await crypto.subtle.importKey(
      "pkcs8",
      der,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"]
    );
  } catch (err: any) {
    // A key that is present but unreadable — pasted as PEM, truncated, or
    // generated for a different pair — is still a configuration problem, and
    // it must say so by name rather than surfacing as an opaque failure.
    throw new Error(
      "SMARTBUZ_JWT_PRIVATE_KEY is set but could not be read as a PKCS#8 DER " +
        `key (${String(err?.message ?? err)}). Regenerate it with ` +
        "`node scripts/generate-auth-keys.mjs`."
    );
  }
}

function decodeBase64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/* ── token minting ───────────────────────────────────────────────────── */

/**
 * Mint a signed access token for the given user.
 *
 * The token carries the user id as `sub`; the Convex side resolves that to a
 * `users` document and then reads the caller's *memberships* to decide which
 * business they may act in. No tenant information is trusted from the token
 * beyond the subject, because tenant access is a server-side fact, not a
 * client claim.
 */
export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const issuer = getAuthIssuer();
  if (!issuer) {
    throw new Error(
      "Cannot mint a Convex access token: the deployment site URL is unknown. " +
        "Set NEXT_PUBLIC_CONVEX_SITE_URL (or SMARTBUZ_AUTH_ISSUER) in .env.local."
    );
  }

  const key = await importPrivateKey();
  const now = Math.floor(Date.now() / 1000);

  const header = {
    alg: "RS256",
    typ: "JWT",
    kid: SMARTBUZ_JWK.kid,
  };

  const payload = {
    iss: issuer,
    aud: SMARTBUZ_JWT_AUDIENCE,
    sub: claims.userId,
    email: claims.email,
    name: claims.name,
    // The session binding. The backend rejects a token whose session has
    // been revoked or has expired.
    sid: claims.sessionId,
    ses: claims.sessionSecret,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  };

  const signingInput = `${encodeBase64Url(JSON.stringify(header))}.${encodeBase64Url(
    JSON.stringify(payload)
  )}`;

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  return `${signingInput}.${encodeBytesBase64Url(new Uint8Array(signature))}`;
}

/** True when the deployment is configured well enough to mint tokens. */
export function isTokenIssuingConfigured(): boolean {
  return Boolean(process.env.SMARTBUZ_JWT_PRIVATE_KEY) && Boolean(getAuthIssuer());
}

/**
 * A precise account of what the deployment is missing.
 *
 * "The server is not configured" is not an actionable error message: the
 * missing private key and the unknown issuer are different problems with
 * different fixes, and both surface at the same moment — the browser asking
 * for a token. Naming the variable turns a silent 503 into a one-line fix.
 */
export function describeTokenConfiguration(): {
  /** A private key is present. It may still be unreadable — see importPrivateKey. */
  privateKey: boolean;
  /** The issuer the tokens will claim. */
  issuer: string;
  /** The environment variables that must be set. Empty when nothing is missing. */
  missing: string[];
} {
  const issuer = getAuthIssuer();
  const missing: string[] = [];

  if (!process.env.SMARTBUZ_JWT_PRIVATE_KEY) missing.push("SMARTBUZ_JWT_PRIVATE_KEY");
  if (!issuer) {
    missing.push("NEXT_PUBLIC_CONVEX_SITE_URL (or SMARTBUZ_AUTH_ISSUER)");
  }

  return {
    privateKey: Boolean(process.env.SMARTBUZ_JWT_PRIVATE_KEY),
    issuer,
    missing,
  };
}
