/**
 * SMARTBUZ — the public JSON Web Key used to sign Convex access tokens.
 *
 * This is a *public* key: it is published by the JWKS endpoint so that the
 * Convex backend can verify the RS256 signature on every request. There is
 * nothing secret here — the matching private key lives in the Next.js
 * environment only (SMARTBUZ_JWT_PRIVATE_KEY) and never leaves the server.
 *
 * Regenerate the pair with:  node scripts/generate-auth-keys.mjs
 */
export const SMARTBUZ_JWK = {
  kty: "RSA",
  use: "sig",
  alg: "RS256",
  kid: "bfaad149116db910",
  n: "0Z2QnVeaaS_7Z80L48D0xsriGI2NaLg_kUjz_RfW_nPNNixqKDb2wB8rpEdcpB1H5_PMLRyjtSrC1PH77ezZLNOvzw9RNz_Y586eRiK5YKtk6pBKWscotZCkx0Oj9olgWs16VBlKBTkJtRrWcg59ON5qRxSgLXm11DLDLm84mvFeixE7KqEXMoRCnfyiAhzMKj4Z0r656UNfaN49Ty6nGBE0_MU1ae5K8k8UpvxrtR6KqNgLzmTViUCTU32xfdwu2hms2p85swUBBQcVqmVt8CTHE3GxI13CeXUTBnNSO1z0tlvA3pWwhvQoW8qRjKN3agOJ5JgumS8SwZpRUEIHhw",
  e: "AQAB",
} as const;

/** The audience Convex requires in the `aud` claim of an accepted token. */
export const SMARTBUZ_JWT_AUDIENCE = "smartbuz";
