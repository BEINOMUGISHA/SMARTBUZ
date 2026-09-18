import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("businessProfiles").order("desc").collect();
  },
});

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db
      .query("businessProfiles")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();

    return profiles[0] ?? null;
  },
});

export const create = mutation({
  args: {
    businessName: v.string(),
    businessType: v.string(),
    industry: v.optional(v.string()),
    modules: v.array(v.string()),
    currency: v.optional(v.string()),
    country: v.optional(v.string()),
    taxEnabled: v.optional(v.boolean()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("businessProfiles")
      .filter((q) => q.eq(q.field("businessName"), args.businessName))
      .first();

    if (existing) {
      throw new Error("A business profile with this name already exists.");
    }

    const now = new Date().toISOString();

    return await ctx.db.insert("businessProfiles", {
      businessName: args.businessName,
      businessType: args.businessType,
      industry: args.industry,
      modules: args.modules,
      currency: args.currency ?? "UGX",
      country: args.country ?? "Uganda",
      taxEnabled: args.taxEnabled ?? false,
      isActive: true,
      createdBy: args.createdBy,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("businessProfiles"),
    businessName: v.optional(v.string()),
    businessType: v.optional(v.string()),
    industry: v.optional(v.string()),
    modules: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    country: v.optional(v.string()),
    taxEnabled: v.optional(v.boolean()),
    isActive: v.optional(v.boolean()),
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const { id, updatedBy, ...rest } = args;
    const profile = await ctx.db.get(id);

    if (!profile) {
      throw new Error("Business profile not found.");
    }

    await ctx.db.patch(id, {
      ...rest,
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert("activityLogs", {
      userId: updatedBy,
      action: "Update Business Profile",
      details: `Updated business profile: ${profile.businessName}`,
      timestamp: new Date().toISOString(),
    });

    return id;
  },
});

export const remove = mutation({
  args: { id: v.id("businessProfiles"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.id);
    if (!profile) throw new Error("Business profile not found.");

    await ctx.db.delete(args.id);

    await ctx.db.insert("activityLogs", {
      userId: args.userId,
      action: "Delete Business Profile",
      details: `Deleted business profile: ${profile.businessName}`,
      timestamp: new Date().toISOString(),
    });

    return true;
  },
});
