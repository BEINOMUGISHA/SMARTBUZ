import { query } from "./_generated/server";

/**
 * The identity of whoever is calling.
 *
 * This query exists so that `scripts/verify-identity.mjs` can prove that
 * the backend tells the truth about who is calling. It is a diagnostic, and
 * it is deliberately not a window into anything else.
 *
 * ────────────────────────────────────────────────────────────────────────
 * Two claims are removed from the answer
 * ────────────────────────────────────────────────────────────────────────
 *
 * `ses` and `sid` bind the token to a session: `convex/tenancy.ts` reads
 * them to decide whether the session behind the token is still live. So
 * handing them back to the caller would hand over the very thing that
 * proves a token is good — which would make this diagnostic a way to
 * strengthen a stolen token rather than a way to check one.
 *
 * The claims that are kept — who the caller is, which issuer signed the
 * token, and when it expires — are the ones the verification script
 * actually asserts on.
 */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const safe: Record<string, unknown> = { ...identity };
    delete safe.ses;
    delete safe.sid;

    return safe;
  },
});
