/**
 * SMARTBUZ — branches (sales points).
 *
 * A branch is a physical sales point of a business: the main shop, a
 * counter in a market, an outlet in another town. Every branch belongs to
 * exactly one business and is only ever visible to the members of that
 * business.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  allowedBranchIds,
  logActivity,
  requireBranchAccess,
  requirePermission,
  requireTenant,
} from "./tenancy";

export const list = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "branches.view");

    const branches = await ctx.db
      .query("branches")
      .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
      .collect();

    // A branch manager only sees the branches they are responsible for.
    const allowed = await allowedBranchIds(ctx, tenant.membership);

    return branches
      .filter((b) => (!allowed || allowed.includes(b._id)) &&
        (args.includeInactive || b.isActive !== false))
      .map((b) => ({
        _id: b._id,
        name: b.name,
        code: b.code,
        address: b.address,
        phone: b.phone,
        email: b.email,
        managerId: b.managerId,
        warehouseId: b.warehouseId,
        isDefault: b.isDefault ?? false,
        isActive: b.isActive ?? true,
      }));
  },
});

export const getById = query({
  args: {
    id: v.id("branches"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "branches.view");

    const branch = await ctx.db.get(args.id);
    if (!branch || branch.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that branch belongs to another business.");
    }
    await requireBranchAccess(ctx, tenant.membership, branch._id);
    return branch;
  },
});

export const create = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    warehouseId: v.optional(v.id("warehouses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "branches.manage");

    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Enter a branch name.");

    if (args.warehouseId) {
      const warehouse = await ctx.db.get(args.warehouseId);
      if (!warehouse || warehouse.businessId !== tenant.businessId) {
        throw new ConvexError("That warehouse belongs to another business.");
      }
    }

    const now = new Date().toISOString();
    const id = await ctx.db.insert("branches", {
      businessId: tenant.businessId,
      name,
      code: args.code?.trim(),
      address: args.address,
      phone: args.phone,
      email: args.email,
      managerId: args.managerId,
      warehouseId: args.warehouseId,
      isDefault: false,
      isActive: true,
      createdAt: now,
      createdBy: tenant.user._id,
      updatedAt: now,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Add Branch",
      `Added branch ${name}`
    );

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("branches"),
    businessId: v.optional(v.id("businesses")),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    warehouseId: v.optional(v.id("warehouses")),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "branches.manage");

    const branch = await ctx.db.get(args.id);
    if (!branch || branch.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that branch belongs to another business.");
    }
    await requireBranchAccess(ctx, tenant.membership, branch._id);

    if (args.warehouseId) {
      const warehouse = await ctx.db.get(args.warehouseId);
      if (!warehouse || warehouse.businessId !== tenant.businessId) {
        throw new ConvexError("That warehouse belongs to another business.");
      }
    }

    const { id, businessId, ...rest } = args;
    await ctx.db.patch(id, { ...rest, updatedAt: new Date().toISOString() });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Update Branch",
      `Updated branch ${branch.name}`
    );

    return id;
  },
});

export const remove = mutation({
  args: {
    id: v.id("branches"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "branches.manage");

    const branch = await ctx.db.get(args.id);
    if (!branch || branch.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that branch belongs to another business.");
    }
    await requireBranchAccess(ctx, tenant.membership, branch._id);
    if (branch.isDefault) {
      throw new ConvexError(
        "The default branch cannot be deleted. Make another branch the default first."
      );
    }

    await ctx.db.delete(args.id);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Delete Branch",
      `Deleted branch ${branch.name}`
    );

    return true;
  },
});

/** Make this branch the business default (and unset the previous one). */
export const setDefault = mutation({
  args: {
    id: v.id("branches"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "branches.manage");

    const branch = await ctx.db.get(args.id);
    if (!branch || branch.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that branch belongs to another business.");
    }
    await requireBranchAccess(ctx, tenant.membership, branch._id);

    const siblings = await ctx.db
      .query("branches")
      .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
      .collect();
    const now = new Date().toISOString();
    for (const sibling of siblings) {
      const shouldBeDefault = sibling._id === args.id;
      if ((sibling.isDefault ?? false) !== shouldBeDefault) {
        await ctx.db.patch(sibling._id, { isDefault: shouldBeDefault, updatedAt: now });
      }
    }

    return true;
  },
});
