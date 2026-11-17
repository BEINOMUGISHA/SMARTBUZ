import { httpAction } from "./_generated/server";
import { SMARTBUZ_JWK } from "./authJwks";

/**
 * GET /auth/jwks — publishes the public key used to sign SMARTBUZ access
 * tokens.
 *
 * Convex verifies the RS256 signature of every incoming request against the
 * key set published here, so this endpoint must be publicly reachable from
 * the Convex backend. On a cloud deployment that is
 * `https://<deployment>.convex.site/auth/jwks`; on a local backend it is
 * `http://127.0.0.1:3211/auth/jwks`.
 *
 * Only public key material is served.
 */
export const jwks = httpAction(async () => {
  return new Response(
    JSON.stringify({ keys: [SMARTBUZ_JWK] }),
    {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    }
  );
});
