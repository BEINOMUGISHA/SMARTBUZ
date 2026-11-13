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

export const getById = query({
  args: { id: v.id("businessProfiles") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

/**
 * Switch the business to a different vertical.
 *
 * Applies the new vertical's module set and URA tax defaults to the profile
 * so the sidebar, dashboard, receipts and VAT handling all follow suit.
 */
export const setCategory = mutation({
  args: {
    id: v.id("businessProfiles"),
    categoryId: v.string(),
    modules: v.array(v.string()),
    taxEnabled: v.boolean(),
    taxRate: v.number(),
    taxInclusive: v.boolean(),
    taxNote: v.optional(v.string()),
    updatedBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.id);
    if (!profile) throw new Error("Business profile not found.");

    await ctx.db.patch(args.id, {
      categoryId: args.categoryId,
      businessType: args.categoryId,
      modules: args.modules,
      taxEnabled: args.taxEnabled,
      taxRate: args.taxRate,
      taxInclusive: args.taxInclusive,
      taxNote: args.taxNote,
      updatedAt: new Date().toISOString(),
    });

    await ctx.db.insert("activityLogs", {
      userId: args.updatedBy,
      action: "Change Business Category",
      details: `Switched ${profile.businessName} to vertical "${args.categoryId}"`,
      timestamp: new Date().toISOString(),
    });

    return args.id;
  },
});

export const create = mutation({
  args: {
    businessName: v.string(),
    businessType: v.string(),
    // Modern vertical id (e.g. "pharmacy"). Kept separate from businessType
    // for backwards compatibility with existing installations.
    categoryId: v.optional(v.string()),
    industry: v.optional(v.string()),
    modules: v.array(v.string()),
    currency: v.optional(v.string()),
    country: v.optional(v.string()),
    taxEnabled: v.optional(v.boolean()),
    taxRate: v.optional(v.number()),
    taxInclusive: v.optional(v.boolean()),
    taxNote: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
    openingFloat: v.optional(v.number()),
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
      categoryId: args.categoryId,
      industry: args.industry,
      modules: args.modules,
      currency: args.currency ?? "UGX",
      country: args.country ?? "Uganda",
      taxEnabled: args.taxEnabled ?? false,
      taxRate: args.taxRate ?? 0,
      taxInclusive: args.taxInclusive ?? true,
      taxNote: args.taxNote,
      businessAddress: args.businessAddress,
      businessPhone: args.businessPhone,
      openingFloat: args.openingFloat,
      plan: "trial",
      subscriptionStatus: "trial",
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
    categoryId: v.optional(v.string()),
    industry: v.optional(v.string()),
    modules: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    country: v.optional(v.string()),
    taxEnabled: v.optional(v.boolean()),
    taxRate: v.optional(v.number()),
    taxInclusive: v.optional(v.boolean()),
    taxNote: v.optional(v.string()),
    tin: v.optional(v.string()),
    allowPriceOverrides: v.optional(v.boolean()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
    openingFloat: v.optional(v.number()),
    plan: v.optional(v.string()),
    subscriptionStatus: v.optional(v.string()),
    subscriptionExpiresAt: v.optional(v.string()),
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

