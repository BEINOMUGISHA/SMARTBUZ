/**
 * Resolves the Convex deployment URL.
 *
 * `NEXT_PUBLIC_CONVEX_URL` is inlined at build time. When it is missing the
 * build would otherwise crash with an opaque "No address provided to
 * ConvexReactClient" error during prerender, so we fall back to a placeholder
 * and surface a clear, actionable error in the browser instead.
 *
 * The placeholder is intentionally not a working endpoint: any real request
 * fails loudly at runtime, which is far better than silently pointing a
 * production deployment at the wrong backend.
 */

export const CONVEX_URL =
  process.env.NEXT_PUBLIC_CONVEX_URL || "https://placeholder.convex.cloud";

export const IS_CONVEX_URL_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_CONVEX_URL);

/** Warn once per process when the deployment URL has not been configured. */
export function warnIfConvexUnconfigured() {
  if (IS_CONVEX_URL_CONFIGURED) return;
  if (typeof window === "undefined") return;
  console.error(
    "[SMARTBUZ] NEXT_PUBLIC_CONVEX_URL is not set. The app cannot talk to its " +
      "database. Add it to .env.local (or your host's environment variables) " +
      "and restart the dev server."
  );
}
