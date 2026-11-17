import { query } from "./_generated/server";

/**
 * Temporary diagnostic: echoes the authenticated identity.
 * Used by the auth smoke test; removed once the tenancy layer is verified.
 */
export const whoami = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.auth.getUserIdentity();
  },
});
