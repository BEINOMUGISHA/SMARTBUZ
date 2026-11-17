/**
 * SMARTBUZ — businesses, ownership and membership.
 *
 * The tenant lives here: registering a business, completing onboarding,
 * business settings (currency, timezone, tax), who owns it, who works in
 * it, and switching between the businesses a user belongs to.
 *
 * Every handler in this file is tenant-scoped: the caller is derived from
 * the verified identity, and the business is resolved from the caller's
 * membership — never from a business id the browser simply asked for.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import bcrypt from "bcryptjs";
import type { Id } from "./_generated/dataModel";
import {
  BUSINESS_ROLES,
  type BusinessId,
  type BusinessRole,
  actorName,
  listUserMemberships,
  logActivity,
  normalizeBusinessRole,
  requireMembership,
  requirePermission,
  requireTenant,
  requireUser,
  slugify,
} from "./tenancy";
import { resolveTax } from "./verticals/tax";
import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_DATE_FORMAT,
  DEFAULT_LOCALE,
  DEFAULT_TIMEZONE,
  DEFAULT_CATEGORIES,
  currencySymbol,
  isSupportedCurrency,
  sanitizeModules,
} from "./defaults";

const MIN_PASSWORD_LENGTH = 8;

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function assertValidEmail(email: string) {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ConvexError("Enter a valid email address.");
  }
}

function assertPassword(password: string) {
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new ConvexError(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters long.`
    );
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Queries
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * The businesses the caller belongs to, with the role they hold in each.
 * This is what the business switcher renders.
 */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const memberships = await listUserMemberships(ctx, user._id);
    const result = [];
    for (const membership of memberships) {
      const business = await ctx.db.get(membership.businessId);
      if (!business) continue;
      result.push({
        business,
        role: membership.role,
        status: membership.status ?? "active",
        isActive: user.activeBusinessId === business._id,
      });
    }
    return result;
  },
});

/**
 * The business the caller is currently working in.
 *
 * The business fields are returned flat (with `role` added) so the UI can
 * read `active.name`, `active.currency` … without unwrapping.
 */
export const getActive = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    if (!user.activeBusinessId) return null;
    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_businessId_userId", (q) =>
        q.eq("businessId", user.activeBusinessId!).eq("userId", user._id)
      )
      .unique();
    if (!membership || (membership.status ?? "active") !== "active") return null;
    const business = await ctx.db.get(user.activeBusinessId);
    if (!business) return null;
    return { ...business, role: membership.role };
  },
});

/** A single business the caller is a member of. */
export const getById = query({
  args: { id: v.id("businesses") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const membership = await requireMembership(ctx, args.id, user._id);
    const business = await ctx.db.get(args.id);
    if (!business) throw new ConvexError("This business no longer exists.");
    return { business, role: membership.role };
  },
});

/** The members of a business. */
export const listMembers = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.view");

    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
      .collect();

    const members = [];
    for (const membership of memberships) {
      const user = await ctx.db.get(membership.userId);
      if (!user) continue;
      members.push({
        _id: membership._id,
        userId: user._id,
        name: [user.first_name, user.last_name].filter(Boolean).join(" ").trim(),
        email: user.email,
        role: membership.role,
        status: membership.status ?? "active",
        jobTitle: membership.jobTitle,
        joinedAt: membership.joinedAt,
      });
    }
    return members;
  },
});

/** Outstanding invitations to join a business. */
export const listInvitations = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.manage");

    const invitations = await ctx.db
      .query("businessInvitations")
      .withIndex("by_businessId_status", (q) =>
        q.eq("businessId", tenant.businessId).eq("status", "pending")
      )
      .collect();

    return invitations.map((i) => ({
      _id: i._id,
      email: i.email,
      role: i.role,
      jobTitle: i.jobTitle,
      status: i.status,
      createdAt: i.createdAt,
      expiresAt: i.expiresAt,
    }));
  },
});

/**
 * Onboarding summary: what is set up and what is still missing.
 */
export const getSetupSummary = query({
  args: { businessId: v.optional(v.id("businesses")) },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    const businessId = tenant.businessId;

    const branches = await ctx.db
      .query("branches")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();
    const warehouses = await ctx.db
      .query("warehouses")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();
    const employees = await ctx.db
      .query("employees")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();
    const products = await ctx.db
      .query("stocks")
      .withIndex("by_businessId", (q) => q.eq("businessId", businessId))
      .collect();

    return {
      business: tenant.business,
      role: tenant.membership.role,
      counts: {
        branches: branches.length,
        warehouses: warehouses.length,
        employees: employees.length,
        products: products.length,
      },
      steps: {
        category: Boolean(tenant.business.categoryId),
        currency: Boolean(tenant.business.currency),
        timezone: Boolean(tenant.business.timezone),
        branch: branches.length > 0,
        warehouse: warehouses.length > 0,
        staff: employees.length > 1,
        products: products.length > 0,
      },
      onboardingComplete:
        branches.length > 0 &&
        warehouses.length > 0 &&
        Boolean(tenant.business.categoryId) &&
        Boolean(tenant.business.currency),
    };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Registration and onboarding
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Register a new business.
 *
 * Public on purpose — this is how a new customer arrives. It creates, in
 * one atomic step: the owner account, the business, the owner membership,
 * a default warehouse, a default branch, the default product categories
 * and the owner's employee record.
 *
 * Two people may register two completely separate businesses; nothing is
 * shared between them.
 */
export const register = mutation({
  args: {
    businessName: v.string(),
    ownerFirstName: v.string(),
    ownerLastName: v.string(),
    ownerEmail: v.string(),
    password: v.string(),
    ownerPhone: v.optional(v.string()),
    categoryId: v.optional(v.string()),
    modules: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    country: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const businessName = args.businessName.trim();
    if (businessName.length < 2) {
      throw new ConvexError("Enter the name of your business.");
    }

    const email = normaliseEmail(args.ownerEmail);
    assertValidEmail(email);
    assertPassword(args.password);

    const existing = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    if (existing) {
      throw new ConvexError(
        "An account with this email already exists. Sign in and create a new business from the business switcher."
      );
    }

    const now = new Date().toISOString();
    const currency = isSupportedCurrency(args.currency) ? args.currency! : DEFAULT_CURRENCY;
    const timezone = args.timezone?.trim() || DEFAULT_TIMEZONE;
    const country = args.country?.trim() || DEFAULT_COUNTRY;
    const categoryId = args.categoryId?.trim() || undefined;

    // Server-authoritative VAT configuration (see verticals/tax.ts).
    const tax = resolveTax(categoryId, { enabled: true, rate: 18, inclusive: true });

    const ownerId = await ctx.db.insert("users", {
      first_name: args.ownerFirstName.trim(),
      last_name: args.ownerLastName.trim(),
      email,
      password: bcrypt.hashSync(args.password, 10),
      // The legacy global role vocabulary. Inside the business the owner
      // holds the "owner" membership, which is what actually authorises
      // anything.
      roles: ["admin"],
      phone_number: args.ownerPhone,
      status: "active",
      createdAt: now,
    });

    const businessId = await ctx.db.insert("businesses", {
      name: businessName,
      slug: slugify(businessName),
      categoryId,
      businessType: categoryId,
      modules: sanitizeModules(args.modules),
      currency,
      currencySymbol: currencySymbol(currency),
      timezone,
      locale: DEFAULT_LOCALE,
      dateFormat: DEFAULT_DATE_FORMAT,
      country,
      taxEnabled: tax.enabled,
      taxRate: tax.rate,
      taxInclusive: tax.inclusive,
      taxNote: tax.taxNote,
      status: "active",
      ownerId,
      createdBy: ownerId,
      createdAt: now,
      updatedAt: now,
      businessAddress: args.businessAddress,
      businessPhone: args.businessPhone,
      onboardingComplete: false,
      onboardingStep: "category",
      plan: "trial",
      subscriptionStatus: "trial",
    });

    await ctx.db.insert("memberships", {
      userId: ownerId,
      businessId,
      role: "owner",
      status: "active",
      createdAt: now,
      joinedAt: now,
    });

    // Default storage location and sales point, so the business is usable
    // the moment it is created.
    const warehouseId = await ctx.db.insert("warehouses", {
      businessId,
      name: "Main Warehouse",
      code: "WH-MAIN",
      type: "main",
      isDefault: true,
      isActive: true,
      createdAt: now,
      createdBy: ownerId,
    });

    const branchId = await ctx.db.insert("branches", {
      businessId,
      name: "Main Branch",
      code: "BR-MAIN",
      isDefault: true,
      isActive: true,
      warehouseId,
      createdAt: now,
      createdBy: ownerId,
    });

    for (const type of DEFAULT_CATEGORIES) {
      await ctx.db.insert("categories", { type, businessId });
    }

    await ctx.db.insert("employees", {
      businessId,
      userId: ownerId,
      employeeCode: "EMP-001",
      fullName: `${args.ownerFirstName.trim()} ${args.ownerLastName.trim()}`.trim(),
      email,
      phone: args.ownerPhone,
      jobTitle: "Owner",
      branchId,
      role: "owner",
      status: "active",
      hiredAt: now,
      createdAt: now,
      createdBy: ownerId,
    });

    await ctx.db.patch(ownerId, { activeBusinessId: businessId });

    await ctx.db.insert("activityLogs", {
      businessId,
      userId: ownerId,
      action: "Business Registered",
      details: `${businessName} registered`,
      timestamp: now,
    });

    return { businessId, userId: ownerId, branchId, warehouseId };
  },
});

/**
 * Create a business for the *already signed-in* caller.
 *
 * This is the "add another business" path for somebody who already has an
 * account (and possibly other businesses). The caller becomes the owner of
 * the new business; nothing from their existing businesses is copied or
 * shared — the new business starts empty.
 */
export const createForCurrentUser = mutation({
  args: {
    businessName: v.string(),
    categoryId: v.optional(v.string()),
    modules: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    country: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
    branchName: v.optional(v.string()),
    warehouseName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const owner = await requireUser(ctx);

    const businessName = args.businessName.trim();
    if (businessName.length < 2) {
      throw new ConvexError("Enter the name of your business.");
    }

    const now = new Date().toISOString();
    const currency = isSupportedCurrency(args.currency) ? args.currency! : DEFAULT_CURRENCY;
    const timezone = args.timezone?.trim() || DEFAULT_TIMEZONE;
    const country = args.country?.trim() || DEFAULT_COUNTRY;
    const categoryId = args.categoryId?.trim() || undefined;

    const tax = resolveTax(categoryId, { enabled: true, rate: 18, inclusive: true });

    const businessId = await ctx.db.insert("businesses", {
      name: businessName,
      slug: slugify(businessName),
      categoryId,
      businessType: categoryId,
      modules: sanitizeModules(args.modules),
      currency,
      currencySymbol: currencySymbol(currency),
      timezone,
      locale: DEFAULT_LOCALE,
      dateFormat: DEFAULT_DATE_FORMAT,
      country,
      taxEnabled: tax.enabled,
      taxRate: tax.rate,
      taxInclusive: tax.inclusive,
      taxNote: tax.taxNote,
      status: "active",
      ownerId: owner._id,
      createdBy: owner._id,
      createdAt: now,
      updatedAt: now,
      businessAddress: args.businessAddress,
      businessPhone: args.businessPhone,
      onboardingComplete: false,
      onboardingStep: "category",
      plan: "trial",
      subscriptionStatus: "trial",
    });

    await ctx.db.insert("memberships", {
      userId: owner._id,
      businessId,
      role: "owner",
      status: "active",
      createdAt: now,
      joinedAt: now,
    });

    const warehouseId = await ctx.db.insert("warehouses", {
      businessId,
      name: args.warehouseName?.trim() || "Main Warehouse",
      code: "WH-MAIN",
      type: "main",
      isDefault: true,
      isActive: true,
      createdAt: now,
      createdBy: owner._id,
    });

    const branchId = await ctx.db.insert("branches", {
      businessId,
      name: args.branchName?.trim() || "Main Branch",
      code: "BR-MAIN",
      isDefault: true,
      isActive: true,
      warehouseId,
      createdAt: now,
      createdBy: owner._id,
    });

    for (const type of DEFAULT_CATEGORIES) {
      await ctx.db.insert("categories", { type, businessId });
    }

    await ctx.db.insert("employees", {
      businessId,
      userId: owner._id,
      employeeCode: "EMP-001",
      fullName: [owner.first_name, owner.last_name].filter(Boolean).join(" ").trim() || owner.email,
      email: owner.email,
      phone: owner.phone_number,
      jobTitle: "Owner",
      branchId,
      role: "owner",
      status: "active",
      hiredAt: now.slice(0, 10),
      createdAt: now,
      createdBy: owner._id,
    });

    // The new business becomes the active one.
    await ctx.db.patch(owner._id, { activeBusinessId: businessId });

    await ctx.db.insert("activityLogs", {
      businessId,
      userId: owner._id,
      action: "Business Registered",
      details: `${businessName} registered`,
      timestamp: now,
    });

    return { businessId, branchId, warehouseId };
  },
});

/**
 * Finish the onboarding steps: pick the vertical, the currency and the
 * timezone, and name the first branch and warehouse.
 */
export const completeOnboarding = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    categoryId: v.optional(v.string()),
    modules: v.optional(v.array(v.string())),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    country: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
    branchName: v.optional(v.string()),
    warehouseName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "business.settings");

    const now = new Date().toISOString();
    const business = tenant.business;
    const patch: Record<string, unknown> = { updatedAt: now };

    if (args.categoryId?.trim()) {
      const categoryId = args.categoryId.trim();
      const tax = resolveTax(categoryId, {
        enabled: business.taxEnabled,
        rate: business.taxRate,
        inclusive: business.taxInclusive,
        note: business.taxNote,
      });
      patch.categoryId = categoryId;
      patch.businessType = categoryId;
      patch.taxEnabled = tax.enabled;
      patch.taxRate = tax.rate;
      patch.taxInclusive = tax.inclusive;
      patch.taxNote = tax.taxNote;
      if (args.modules) patch.modules = sanitizeModules(args.modules);
    }

    if (args.currency) {
      if (!isSupportedCurrency(args.currency)) {
        throw new ConvexError("Choose a supported currency.");
      }
      patch.currency = args.currency;
      patch.currencySymbol = currencySymbol(args.currency);
    }
    if (args.timezone?.trim()) patch.timezone = args.timezone.trim();
    if (args.country?.trim()) patch.country = args.country.trim();
    if (args.businessAddress !== undefined) patch.businessAddress = args.businessAddress;
    if (args.businessPhone !== undefined) patch.businessPhone = args.businessPhone;

    await ctx.db.patch(tenant.businessId, patch);

    // Rename the default branch / warehouse if the operator named them.
    if (args.branchName?.trim()) {
      const branch = await ctx.db
        .query("branches")
        .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();
      if (branch) {
        await ctx.db.patch(branch._id, { name: args.branchName.trim(), updatedAt: now });
      }
    }
    if (args.warehouseName?.trim()) {
      const warehouse = await ctx.db
        .query("warehouses")
        .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
        .filter((q) => q.eq(q.field("isDefault"), true))
        .first();
      if (warehouse) {
        await ctx.db.patch(warehouse._id, {
          name: args.warehouseName.trim(),
          updatedAt: now,
        });
      }
    }

    await ctx.db.patch(tenant.businessId, {
      onboardingComplete: true,
      onboardingStep: "done",
      updatedAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Onboarding Completed",
      `${business.name} finished onboarding`
    );

    return tenant.businessId;
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Settings
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Update the business settings: currency, timezone, tax details, contact
 * information.
 */
export const updateSettings = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    name: v.optional(v.string()),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    country: v.optional(v.string()),
    locale: v.optional(v.string()),
    dateFormat: v.optional(v.string()),
    businessAddress: v.optional(v.string()),
    businessPhone: v.optional(v.string()),
    tin: v.optional(v.string()),
    allowPriceOverrides: v.optional(v.boolean()),
    openingFloat: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "business.settings");

    const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    if (args.name !== undefined) {
      const name = args.name.trim();
      if (name.length < 2) throw new ConvexError("Enter the name of your business.");
      patch.name = name;
    }
    if (args.currency !== undefined) {
      if (!isSupportedCurrency(args.currency)) {
        throw new ConvexError("Choose a supported currency.");
      }
      patch.currency = args.currency;
      patch.currencySymbol = currencySymbol(args.currency);
    }
    if (args.timezone !== undefined && args.timezone.trim()) {
      patch.timezone = args.timezone.trim();
    }
    if (args.country !== undefined && args.country.trim()) patch.country = args.country.trim();
    if (args.locale !== undefined) patch.locale = args.locale;
    if (args.dateFormat !== undefined) patch.dateFormat = args.dateFormat;
    if (args.businessAddress !== undefined) patch.businessAddress = args.businessAddress;
    if (args.businessPhone !== undefined) patch.businessPhone = args.businessPhone;
    if (args.tin !== undefined) patch.tin = args.tin;
    if (args.allowPriceOverrides !== undefined) {
      patch.allowPriceOverrides = args.allowPriceOverrides;
    }
    if (args.openingFloat !== undefined) patch.openingFloat = args.openingFloat;

    await ctx.db.patch(tenant.businessId, patch);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Update Business Settings",
      `Updated settings for ${tenant.business.name}`
    );

    return tenant.businessId;
  },
});

/**
 * Switch the business to a different vertical.
 *
 * The server re-derives the URA tax configuration from the category, so a
 * tampered client cannot post a 0% rate on a restaurant and under-state VAT
 * on fiscal receipts.
 */
export const setCategory = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    categoryId: v.string(),
    modules: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "business.settings");

    const tax = resolveTax(args.categoryId, {
      enabled: tenant.business.taxEnabled,
      rate: tenant.business.taxRate,
      inclusive: tenant.business.taxInclusive,
      note: tenant.business.taxNote,
    });

    await ctx.db.patch(tenant.businessId, {
      categoryId: args.categoryId,
      businessType: args.categoryId,
      modules: sanitizeModules(args.modules ?? tenant.business.modules),
      taxEnabled: tax.enabled,
      taxRate: tax.rate,
      taxInclusive: tax.inclusive,
      taxNote: tax.taxNote,
      updatedAt: new Date().toISOString(),
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Change Business Category",
      `Switched ${tenant.business.name} to vertical "${args.categoryId}"`
    );

    return tenant.businessId;
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Switching between businesses
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Switch the caller to another business they belong to.
 *
 * The membership check is the whole point: a caller who is not a member of
 * the requested business gets "Forbidden" and their active business does
 * not change.
 */
export const switchBusiness = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const membership = await requireMembership(ctx, args.businessId, user._id);

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("This business no longer exists.");
    if (business.status === "suspended") {
      throw new ConvexError(
        "Forbidden: this business is suspended. Contact the account owner."
      );
    }

    await ctx.db.patch(user._id, { activeBusinessId: args.businessId });

    await logActivity(
      ctx,
      args.businessId,
      user._id,
      "Switch Business",
      `${actorName(user)} switched to ${business.name}`
    );

    return { businessId: args.businessId, role: membership.role };
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Members
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Add a member to the business.
 *
 * If the email already has an account, a membership is created for it. If
 * it does not, an account is created with the supplied password. Either
 * way an employee record is created so the business owns its own staff
 * list, independently of any other business.
 */
export const addMember = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    email: v.string(),
    role: v.string(),
    jobTitle: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    password: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.manage");

    const role = args.role as BusinessRole;
    if (!BUSINESS_ROLES.includes(role)) {
      throw new ConvexError("Choose a valid role for the new member.");
    }
    if (role === "business_owner") {
      throw new ConvexError(
        "The owner role cannot be assigned. Use Transfer ownership instead."
      );
    }

    const email = normaliseEmail(args.email);
    assertValidEmail(email);

    const now = new Date().toISOString();
    let user = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();

    if (user) {
      const existing = await ctx.db
        .query("memberships")
        .withIndex("by_businessId_userId", (q) =>
          q.eq("businessId", tenant.businessId).eq("userId", user!._id)
        )
        .unique();
      if (existing) {
        throw new ConvexError("This person is already a member of the business.");
      }
    } else {
      if (!args.password) {
        throw new ConvexError(
          "This person has no SMARTBUZ account yet. Supply a password to create one, or send an invitation instead."
        );
      }
      assertPassword(args.password);
      const userId = await ctx.db.insert("users", {
        first_name: args.firstName?.trim() || email.split("@")[0],
        last_name: args.lastName?.trim() || "",
        email,
        password: bcrypt.hashSync(args.password, 10),
        // Legacy global roles — the business membership is what counts.
        roles: role === "business_admin" ? ["admin"] : ["sales"],
        status: "active",
        createdAt: now,
      });
      user = await ctx.db.get(userId);
    }

    if (!user) throw new ConvexError("Could not create that account.");

    const membershipId = await ctx.db.insert("memberships", {
      userId: user._id,
      businessId: tenant.businessId,
      role,
      status: "active",
      jobTitle: args.jobTitle,
      invitedBy: tenant.user._id,
      invitedAt: now,
      joinedAt: now,
      createdAt: now,
    });

    const employeeId = await ctx.db.insert("employees", {
      businessId: tenant.businessId,
      userId: user._id,
      fullName:
        [args.firstName, args.lastName].filter(Boolean).join(" ").trim() ||
        [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
        email,
      email,
      phone: args.phone ?? user.phone_number,
      jobTitle: args.jobTitle,
      role,
      status: "active",
      hiredAt: now,
      createdAt: now,
      createdBy: tenant.user._id,
    });

    await ctx.db.patch(membershipId, { employeeId });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Add Member",
      `Added ${email} as ${role}`
    );

    return { membershipId, userId: user._id, employeeId };
  },
});

/** Change a member's role inside the business. */
export const updateMemberRole = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    userId: v.id("users"),
    role: v.string(),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.manage");

    const role = args.role as BusinessRole;
    if (!BUSINESS_ROLES.includes(role)) {
      throw new ConvexError("Choose a valid role.");
    }
    if (role === "business_owner") {
      throw new ConvexError(
        "The owner role cannot be assigned. Use Transfer ownership instead."
      );
    }

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_businessId_userId", (q) =>
        q.eq("businessId", tenant.businessId).eq("userId", args.userId)
      )
      .unique();
    if (!membership) {
      throw new ConvexError("Forbidden: that person is not a member of this business.");
    }
    if (normalizeBusinessRole(membership.role) === "business_owner") {
      throw new ConvexError("The business owner's role cannot be changed.");
    }

    await ctx.db.patch(membership._id, {
      role,
      status: args.status ?? membership.status ?? "active",
      updatedAt: new Date().toISOString(),
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Update Member Role",
      `Changed a member's role to ${role}`
    );

    return membership._id;
  },
});

/** Remove a member from the business (the owner cannot be removed). */
export const removeMember = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.manage");

    const membership = await ctx.db
      .query("memberships")
      .withIndex("by_businessId_userId", (q) =>
        q.eq("businessId", tenant.businessId).eq("userId", args.userId)
      )
      .unique();
    if (!membership) {
      throw new ConvexError("Forbidden: that person is not a member of this business.");
    }
    if (normalizeBusinessRole(membership.role) === "business_owner") {
      throw new ConvexError(
        "The business owner cannot be removed. Transfer ownership first."
      );
    }

    await ctx.db.patch(membership._id, {
      status: "suspended",
      updatedAt: new Date().toISOString(),
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Remove Member",
      "Removed a member from the business"
    );

    return true;
  },
});

/** Hand the business over to another member. */
export const transferOwnership = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    newOwnerUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "business.transferOwnership");

    if (tenant.business.ownerId === args.newOwnerUserId) {
      throw new ConvexError("That person already owns this business.");
    }

    const target = await ctx.db
      .query("memberships")
      .withIndex("by_businessId_userId", (q) =>
        q.eq("businessId", tenant.businessId).eq("userId", args.newOwnerUserId)
      )
      .unique();
    if (!target || (target.status ?? "active") !== "active") {
      throw new ConvexError("That person must be an active member of the business.");
    }

    const now = new Date().toISOString();

    // The old owner stays on as an admin.
    const currentOwnerMembership = await ctx.db
      .query("memberships")
      .withIndex("by_businessId_userId", (q) =>
        q.eq("businessId", tenant.businessId).eq("userId", tenant.business.ownerId!)
      )
      .unique();
    if (currentOwnerMembership) {
      await ctx.db.patch(currentOwnerMembership._id, {
        role: "admin",
        updatedAt: now,
      });
    }

    await ctx.db.patch(target._id, { role: "owner", updatedAt: now });
    await ctx.db.patch(tenant.businessId, { ownerId: args.newOwnerUserId, updatedAt: now });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Transfer Ownership",
      "Transferred business ownership"
    );

    return tenant.businessId;
  },
});

/** Leave a business (the owner cannot leave without transferring first). */
export const leaveBusiness = mutation({
  args: { businessId: v.id("businesses") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const membership = await requireMembership(ctx, args.businessId, user._id);

    const business = await ctx.db.get(args.businessId);
    if (!business) throw new ConvexError("This business no longer exists.");

    if (business.ownerId === user._id) {
      throw new ConvexError(
        "The owner cannot leave the business. Transfer ownership first."
      );
    }

    await ctx.db.patch(membership._id, {
      status: "suspended",
      updatedAt: new Date().toISOString(),
    });

    if (user.activeBusinessId === args.businessId) {
      const remaining = await listUserMemberships(ctx, user._id);
      const next = remaining.find((m) => m._id !== membership._id);
      await ctx.db.patch(user._id, {
        activeBusinessId: next ? next.businessId : undefined,
      });
    }

    return true;
  },
});

/* ────────────────────────────────────────────────────────────────────────
 * Invitations
 * ──────────────────────────────────────────────────────────────────────── */

/** Invite somebody to join the business by email. */
export const inviteStaff = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    email: v.string(),
    role: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.manage");

    const email = normaliseEmail(args.email);
    assertValidEmail(email);

    const role = (args.role ?? "cashier") as BusinessRole;
    if (!BUSINESS_ROLES.includes(role)) {
      throw new ConvexError("Choose a valid role for the invite.");
    }
    if (role === "business_owner") {
      throw new ConvexError(
        "The owner role cannot be assigned. Use Transfer ownership instead."
      );
    }

    const pending = await ctx.db
      .query("businessInvitations")
      .withIndex("by_businessId_status", (q) =>
        q.eq("businessId", tenant.businessId).eq("status", "pending")
      )
      .filter((q) => q.eq(q.field("email"), email))
      .first();
    if (pending) {
      throw new ConvexError("That person has already been invited.");
    }

    const now = new Date().toISOString();
    const token = crypto.randomUUID().replace(/-/g, "");

    const invitationId = await ctx.db.insert("businessInvitations", {
      businessId: tenant.businessId,
      email,
      role,
      jobTitle: args.jobTitle,
      invitedBy: tenant.user._id,
      token,
      status: "pending",
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
      createdAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Invite Staff",
      `Invited ${email} as ${role}`
    );

    return { invitationId, token };
  },
});

/**
 * Accept an invitation.
 *
 * The signed-in user's email must match the invitation — an invitation is
 * not a transferable key.
 */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    const invitation = await ctx.db
      .query("businessInvitations")
      .withIndex("by_email", (q) => q.eq("email", user.email))
      .filter((q) => q.eq(q.field("token"), args.token))
      .unique();
    if (!invitation) {
      throw new ConvexError("That invitation is not valid.");
    }
    if (invitation.status !== "pending") {
      throw new ConvexError("That invitation has already been used.");
    }
    if (invitation.expiresAt && invitation.expiresAt < Date.now()) {
      throw new ConvexError("That invitation has expired.");
    }

    const existing = await ctx.db
      .query("memberships")
      .withIndex("by_businessId_userId", (q) =>
        q.eq("businessId", invitation.businessId).eq("userId", user._id)
      )
      .unique();
    if (existing) {
      throw new ConvexError("You are already a member of this business.");
    }

    const now = new Date().toISOString();
    await ctx.db.insert("memberships", {
      userId: user._id,
      businessId: invitation.businessId,
      role: invitation.role ?? "cashier",
      status: "active",
      jobTitle: invitation.jobTitle,
      invitedBy: invitation.invitedBy,
      invitedAt: invitation.createdAt,
      joinedAt: now,
      createdAt: now,
    });

    await ctx.db.patch(invitation._id, { status: "accepted", acceptedAt: now });
    await ctx.db.patch(user._id, { activeBusinessId: invitation.businessId });

    return { businessId: invitation.businessId };
  },
});

/** Revoke a pending invitation. */
export const revokeInvitation = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    invitationId: v.id("businessInvitations"),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "members.manage");

    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation || invitation.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that invitation belongs to another business.");
    }

    await ctx.db.patch(args.invitationId, { status: "revoked" });
    return true;
  },
});

/** Business ids the caller may act in — used by the switcher. */
export const membershipBusinessIds = query({
  args: {},
  handler: async (ctx): Promise<BusinessId[]> => {
    const user = await requireUser(ctx);
    const memberships = await listUserMemberships(ctx, user._id);
    return memberships.map((m) => m.businessId);
  },
});

/** Convenience export used by other modules. */
export const getTenantBusiness = async (
  ctx: { db: { get: (id: Id<"businesses">) => Promise<unknown> } },
  businessId: Id<"businesses">
) => ctx.db.get(businessId);
