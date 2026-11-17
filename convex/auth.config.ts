import { AuthConfig } from "convex/server";

/**
 * SMARTBUZ — Convex authentication configuration.
 *
 * Until this file existed the whole Convex deployment was a public API:
 * `curl $CONVEX_URL/api/query` returned every sale, user and report to
 * anyone who knew the URL (see AUDIT.md §2.1). Adding a provider here makes
 * `ctx.auth.getUserIdentity()` the only trustworthy statement of *who is
 * calling*, which is what every tenant guard in `convex/tenancy.ts` is built
 * on.
 *
 * The tokens are RS256 JWTs minted by the Next.js server (see
 * `src/lib/convex-token.ts`) and verified by Convex against the JWKS
 * published by this deployment at `<site>/auth/jwks` (see `convex/http.ts`).
 *
 * The issuer must match the `iss` claim of the token exactly. It defaults to
 * the deployment's own site URL so the same code works on cloud deployments
 * and on a local backend. `CONVEX_SITE_URL` is provided by the platform, so
 * no deployment-specific environment variable is required.
 */
const siteUrl = (process.env.CONVEX_SITE_URL ?? "http://127.0.0.1:3211").replace(/\/+$/, "");

export default {
  providers: [
    {
      type: "customJwt",
      issuer: siteUrl,
      jwks: `${siteUrl}/auth/jwks`,
      algorithm: "RS256",
      applicationID: "smartbuz",
    },
  ],
} satisfies AuthConfig;
