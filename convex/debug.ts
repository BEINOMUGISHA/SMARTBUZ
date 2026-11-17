import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { query } from "./_generated/server";
import { requirePermission, requireTenant } from "./tenancy";

/**
 * SMART_BUZ — diagnostic helper.
 *
 * This used to be a public query: anybody who knew the deployment URL
 * could pass any email address and learn whether that person had an
 * account and which shop they ran (AUDIT.md §2.1).
 *
 * It is now an administrator diagnostic, scoped to the caller's own
 * business: an operator can only look up people who work for them.
 */
export const inspectUser = query({
    args: {
        email: v.string(),
        businessId: v.optional(v.id("businesses")),
    },
    handler: async (ctx, args) => {
        const tenant = await requireTenant(ctx, args.businessId);
        await requirePermission(ctx, tenant.businessId, "settings.manage");

        const email = args.email.trim().toLowerCase();
        const candidate = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", email))
            .unique();

        if (!candidate) {
            return { found_users_count: 0, details: [] };
        }

        // Only people who are members of the caller's business are visible.
        const membership = await ctx.db
            .query("memberships")
            .withIndex("by_businessId_userId", (q) =>
                q.eq("businessId", tenant.businessId).eq("userId", candidate._id)
            )
            .unique();

        if (!membership) {
            throw new ConvexError(
                "Forbidden: that person is not a member of this business."
            );
        }

        const shop = await ctx.db
            .query("shops")
            .withIndex("by_user", (q) => q.eq("userId", candidate._id))
            .filter((q) => q.eq(q.field("businessId"), tenant.businessId))
            .first();

        return {
            found_users_count: 1,
            details: [
                {
                    user_id: candidate._id,
                    name: `${candidate.first_name} ${candidate.last_name}`,
                    email: candidate.email,
                    role: membership.role,
                    shop_assigned: shop ? { id: shop._id, name: shop.name } : null,
                },
            ],
        };
    },
});
