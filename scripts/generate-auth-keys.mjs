/**
 * SMART_BUZ — Convex access key generation.
 *
 * Generates the RSA keypair used to sign the short-lived JWTs that the
 * Next.js server hands to the browser, and that the Convex backend verifies
 * through the JWKS endpoint.
 *
 *   node scripts/generate-auth-keys.mjs
 *
 * Writes:
 *   - SMART_BUZ_JWT_PRIVATE_KEY  (PKCS#8 PEM, base64 encoded for the env file)
 *   - SMARTBUZ_JWK               (the public JWK served by convex/http.ts)
 *
 * The private key never leaves the server. The public JWK is a public
 * artefact: it is safe to commit, and is embedded in convex/authJwks.ts.
 */
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "jwk" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const jwk = publicKey;

/**
 * The env var stores the PKCS#8 DER bytes, base64url encoded — that is the
 * form Web Crypto's `importKey("pkcs8", …)` expects on the Next.js side.
 */
const privateKeyDer = crypto
  .createPrivateKey(privateKey)
  .export({ format: "der", type: "pkcs8" })
  .toString("base64url");

// Convex validates RS256 signatures, so the JWK must carry the alg/kid/use
// fields it expects. The key id is a short fingerprint of the modulus.
const kid = crypto.createHash("sha256").update(jwk.n).digest("hex").slice(0, 16);

const publicJwk = {
  kty: "RSA",
  use: "sig",
  alg: "RS256",
  kid,
  n: jwk.n,
  e: jwk.e,
};

console.log("/* ── Paste into convex/authJwks.ts ─────────────────────────────── */");
console.log(`export const SMARTBUZ_JWK = ${JSON.stringify(publicJwk, null, 2)} as const;`);
console.log();
console.log("/* ── Add to .env.local (NOT committed) ─────────────────────────── */");
console.log(`SMARTBUZ_JWT_PRIVATE_KEY=${privateKeyDer}`);
console.log();
console.log("kid:", kid);
