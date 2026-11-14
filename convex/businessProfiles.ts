import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { resolveTax } from "./verticals/tax";

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("businessProfiles").order("desc").collect();
  },
});

/**
 * Deactivate every business profile except the one we are keeping active.
 *
 * The product assumes a single active business at a time: the sidebar, the
 * dashboard widgets, the receipt template and every vertical query scope
 * themselves to `businessProfiles.getActive`. Allowing two active profiles
 * made "which business am I in?" ambiguous, so the invariant is enforced
 * here rather than trusted to callers.
 */
async function deactivateOthers(
  ctx: any,
  keepId: string
): Promise<void> {
  const profiles = await ctx.db
    .query("businessProfiles")
    .filter((q: any) => q.eq(q.field("isActive"), true))
    .collect();
  for (const p of profiles) {
    if (p._id !== keepId) await ctx.db.patch(p._id, { isActive: false });
  }
}

export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const profiles = await ctx.db
      .query("businessProfiles")
      .filter((q) => q.eq(q.field("isActive"), true))
      // Deterministic: the most recently created active profile wins.
      .order("desc")
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

    // The server owns the VAT configuration: whatever the client asked for is
    // ignored when the vertical is known, so a tampered client cannot set 0%
    // VAT on a restaurant and under-state VAT on its fiscal receipts.
    const tax = resolveTax(args.categoryId, {
      enabled: args.taxEnabled,
      rate: args.taxRate,
      inclusive: args.taxInclusive,
      note: args.taxNote,
    });

    await ctx.db.patch(args.id, {
      categoryId: args.categoryId,
      businessType: args.categoryId,
      modules: args.modules,
      taxEnabled: tax.enabled,
      taxRate: tax.rate,
      taxInclusive: tax.inclusive,
      taxNote: tax.taxNote,
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

    // Server-authoritative VAT (see verticals/tax.ts).
    const tax = resolveTax(args.categoryId ?? args.businessType, {
      enabled: args.taxEnabled,
      rate: args.taxRate,
      inclusive: args.taxInclusive,
      note: args.taxNote,
    });

    const id = await ctx.db.insert("businessProfiles", {
      businessName: args.businessName,
      businessType: args.businessType,
      categoryId: args.categoryId,
      industry: args.industry,
      modules: args.modules,
      currency: args.currency ?? "UGX",
      country: args.country ?? "Uganda",
      taxEnabled: tax.enabled,
      taxRate: tax.rate,
      taxInclusive: tax.inclusive,
      taxNote: tax.taxNote,
      businessAddress: args.businessAddress,
      businessPhone: args.businessPhone,
      openingFloat: args.openingFloat,
      plan: "trial",
      subscriptionStatus: "trial",
      isActive: true,
      createdBy: args.createdBy,
      updatedAt: now,
    });

    // Only one business is active at a time — the newly created one takes over.
    await deactivateOthers(ctx, id);

    return id;
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

    // When the vertical changes, the VAT configuration is re-derived on the
    // server so it always matches the category the business is trading in.
    const categoryChanged = rest.categoryId !== undefined && rest.categoryId !== profile.categoryId;
    const patch: Record<string, unknown> = { ...rest };

    if (categoryChanged) {
      const tax = resolveTax(rest.categoryId, {
        enabled: rest.taxEnabled,
        rate: rest.taxRate,
        inclusive: rest.taxInclusive,
        note: rest.taxNote,
      });
      patch.taxEnabled = tax.enabled;
      patch.taxRate = tax.rate;
      patch.taxInclusive = tax.inclusive;
      if (tax.taxNote !== undefined) patch.taxNote = tax.taxNote;
      else delete patch.taxNote;
    }

    await ctx.db.patch(id, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });

    // Activating a business retires whichever one was active before.
    if (rest.isActive === true) {
      await deactivateOthers(ctx, id);
    }

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

