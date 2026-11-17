/**
 * SMARTBUZ — warehouses (storage locations).
 *
 * Where a business keeps its stock: the head-office store, a branch store,
 * a transit container in transit. Each warehouse belongs to exactly one
 * business and holds that business's products only.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { logActivity, requirePermission, requireTenant } from "./tenancy";

export const list = query({
  args: {
    businessId: v.optional(v.id("businesses")),
    includeInactive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "inventory.view");

    const warehouses = await ctx.db
      .query("warehouses")
      .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
      .collect();

    return warehouses
      .filter((w) => args.includeInactive || w.isActive !== false)
      .map((w) => ({
        _id: w._id,
        name: w.name,
        code: w.code,
        address: w.address,
        type: w.type ?? "main",
        location: w.location,
        managerId: w.managerId,
        isDefault: w.isDefault ?? false,
        isActive: w.isActive ?? true,
      }));
  },
});

export const getById = query({
  args: {
    id: v.id("warehouses"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "inventory.view");

    const warehouse = await ctx.db.get(args.id);
    if (!warehouse || warehouse.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that warehouse belongs to another business.");
    }
    return warehouse;
  },
});

export const create = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    name: v.string(),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
    type: v.optional(v.string()),
    location: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "inventory.transfer");

    const name = args.name.trim();
    if (name.length < 2) throw new ConvexError("Enter a warehouse name.");

    const now = new Date().toISOString();
    const id = await ctx.db.insert("warehouses", {
      businessId: tenant.businessId,
      name,
      code: args.code?.trim(),
      address: args.address,
      type: args.type ?? "main",
      location: args.location,
      managerId: args.managerId,
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
      "Add Warehouse",
      `Added warehouse ${name}`
    );

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("warehouses"),
    businessId: v.optional(v.id("businesses")),
    name: v.optional(v.string()),
    code: v.optional(v.string()),
    address: v.optional(v.string()),
    type: v.optional(v.string()),
    location: v.optional(v.string()),
    managerId: v.optional(v.id("users")),
    isActive: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "inventory.transfer");

    const warehouse = await ctx.db.get(args.id);
    if (!warehouse || warehouse.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that warehouse belongs to another business.");
    }

    const { id, businessId, ...rest } = args;
    await ctx.db.patch(id, { ...rest, updatedAt: new Date().toISOString() });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Update Warehouse",
      `Updated warehouse ${warehouse.name}`
    );

    return id;
  },
});

export const remove = mutation({
  args: {
    id: v.id("warehouses"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "inventory.transfer");

    const warehouse = await ctx.db.get(args.id);
    if (!warehouse || warehouse.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that warehouse belongs to another business.");
    }
    if (warehouse.isDefault) {
      throw new ConvexError(
        "The default warehouse cannot be deleted. Make another warehouse the default first."
      );
    }

    const stock = await ctx.db
      .query("stocks")
      .withIndex("by_businessId_warehouse", (q) =>
        q.eq("businessId", tenant.businessId).eq("warehouseId", args.id)
      )
      .first();
    if (stock) {
      throw new ConvexError(
        "This warehouse still holds products. Move or delete them first."
      );
    }

    await ctx.db.delete(args.id);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Delete Warehouse",
      `Deleted warehouse ${warehouse.name}`
    );

    return true;
  },
});

/** Make this warehouse the business default (and unset the previous one). */
export const setDefault = mutation({
  args: {
    id: v.id("warehouses"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "inventory.transfer");

    const warehouse = await ctx.db.get(args.id);
    if (!warehouse || warehouse.businessId !== tenant.businessId) {
      throw new ConvexError("Forbidden: that warehouse belongs to another business.");
    }

    const siblings = await ctx.db
      .query("warehouses")
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
