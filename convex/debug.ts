import { query } from "./_generated/server";
import { v } from "convex/values";

export const inspectUser = query({
    args: { email: v.string() },
    handler: async (ctx, args) => {
        const users = await ctx.db
            .query("users")
            .withIndex("by_email", (q) => q.eq("email", args.email))
            .collect();

        const diagnostics = await Promise.all(users.map(async (u) => {
            const shop = await ctx.db
                .query("shops")
                .withIndex("by_user", (q) => q.eq("userId", u._id))
                .first();
            return {
                user_id: u._id,
                name: `${u.first_name} ${u.last_name}`,
                email: u.email,
                shop_assigned: shop ? { id: shop._id, name: shop.name } : null
            };
        }));

        return {
            found_users_count: users.length,
            details: diagnostics
        };
    },
});
