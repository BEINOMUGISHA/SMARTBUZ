/**
 * SMARTBUZ — employees.
 *
 * The staff list of a business. An employee is a person who works for the
 * business; it may or may not have a linked SMARTBUZ login.
 *
 * Each business keeps its own list: the same person may be an employee of
 * two businesses with two different job titles, and neither business can
 * see or edit the other's records.
 */

import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { BUSINESS_ROLES, type BusinessRole } from "./tenancy";
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
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "employees.view");

    const employees = await ctx.db
      .query("employees")
      .withIndex("by_businessId", (q) => q.eq("businessId", tenant.businessId))
      .collect();

    // A branch manager only sees the staff of the branches they run.
    const allowed = await allowedBranchIds(ctx, tenant.membership);

    return employees
      .filter((e) => (!allowed || !e.branchId || allowed.includes(e.branchId)) &&
        (!args.status || (e.status ?? "active") === args.status))
      .map((e) => ({
        _id: e._id,
        userId: e.userId,
        employeeCode: e.employeeCode,
        fullName: e.fullName,
        email: e.email,
        phone: e.phone,
        jobTitle: e.jobTitle,
        department: e.department,
        branchId: e.branchId,
        warehouseId: e.warehouseId,
        role: e.role,
        status: e.status ?? "active",
        hiredAt: e.hiredAt,
        salary: e.salary,
      }));
  },
});

export const getById = query({
  args: {
    id: v.id("employees"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "employees.view");

    const employee = await ctx.db.get(args.id);
    if (!employee || employee.businessId !== tenant.businessId) {
      throw new ConvexError(
        "Forbidden: that employee belongs to another business."
      );
    }
    await requireBranchAccess(ctx, tenant.membership, employee.branchId);
    return employee;
  },
});

/** The next employee code for the business, e.g. EMP-004. */
async function nextEmployeeCode(
  ctx: { db: { query: (t: "employees") => any } },
  businessId: any
): Promise<string> {
  const employees = await ctx.db
    .query("employees")
    .withIndex("by_businessId", (q: any) => q.eq("businessId", businessId))
    .collect();
  const numbers = employees
    .map((e: any) => {
      const match = /EMP-(\d+)/.exec(e.employeeCode ?? "");
      return match ? Number(match[1]) : 0;
    })
    .filter((n: number) => Number.isFinite(n));
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;
  return `EMP-${String(next).padStart(3, "0")}`;
}

export const create = mutation({
  args: {
    businessId: v.optional(v.id("businesses")),
    fullName: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    department: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    role: v.optional(v.string()),
    salary: v.optional(v.number()),
    hiredAt: v.optional(v.string()),
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "employees.manage");

    const fullName = args.fullName.trim();
    if (fullName.length < 2) throw new ConvexError("Enter the employee's name.");

    if (args.role) {
      const role = args.role as BusinessRole;
      if (!BUSINESS_ROLES.includes(role)) {
        throw new ConvexError("Choose a valid role for the employee.");
      }
      if (role === "business_owner") {
        throw new ConvexError(
          "The owner role cannot be assigned. Use Transfer ownership instead."
        );
      }
    }

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
    }
    if (args.warehouseId) {
      const warehouse = await ctx.db.get(args.warehouseId);
      if (!warehouse || warehouse.businessId !== tenant.businessId) {
        throw new ConvexError("That warehouse belongs to another business.");
      }
    }
    if (args.userId) {
      const membership = await ctx.db
        .query("memberships")
        .withIndex("by_businessId_userId", (q) =>
          q.eq("businessId", tenant.businessId).eq("userId", args.userId!)
        )
        .unique();
      if (!membership) {
        throw new ConvexError(
          "That person is not a member of this business. Add them as a member first."
        );
      }
    }

    const now = new Date().toISOString();
    const id = await ctx.db.insert("employees", {
      businessId: tenant.businessId,
      userId: args.userId,
      employeeCode: await nextEmployeeCode(ctx, tenant.businessId),
      fullName,
      email: args.email?.trim().toLowerCase(),
      phone: args.phone,
      jobTitle: args.jobTitle,
      department: args.department,
      branchId: args.branchId,
      warehouseId: args.warehouseId,
      role: args.role,
      status: "active",
      hiredAt: args.hiredAt ?? now.slice(0, 10),
      salary: args.salary,
      createdAt: now,
      createdBy: tenant.user._id,
    });

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Add Employee",
      `Added employee ${fullName}`
    );

    return id;
  },
});

export const update = mutation({
  args: {
    id: v.id("employees"),
    businessId: v.optional(v.id("businesses")),
    fullName: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    jobTitle: v.optional(v.string()),
    department: v.optional(v.string()),
    branchId: v.optional(v.id("branches")),
    warehouseId: v.optional(v.id("warehouses")),
    role: v.optional(v.string()),
    status: v.optional(v.string()),
    salary: v.optional(v.number()),
    hiredAt: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "employees.manage");

    const employee = await ctx.db.get(args.id);
    if (!employee || employee.businessId !== tenant.businessId) {
      throw new ConvexError(
        "Forbidden: that employee belongs to another business."
      );
    }
    await requireBranchAccess(ctx, tenant.membership, employee.branchId);

    if (args.branchId) {
      const branch = await ctx.db.get(args.branchId);
      if (!branch || branch.businessId !== tenant.businessId) {
        throw new ConvexError("That branch belongs to another business.");
      }
    }
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
      "Update Employee",
      `Updated employee ${employee.fullName}`
    );

    return id;
  },
});

/**
 * Remove an employee.
 *
 * The employee record is deleted, but the person's *membership* is left
 * alone: removing a staff record must not silently revoke their access,
 * and revoking access is an explicit membership action.
 */
export const remove = mutation({
  args: {
    id: v.id("employees"),
    businessId: v.optional(v.id("businesses")),
  },
  handler: async (ctx, args) => {
    const tenant = await requireTenant(ctx, args.businessId);
    await requirePermission(ctx, tenant.businessId, "employees.manage");

    const employee = await ctx.db.get(args.id);
    if (!employee || employee.businessId !== tenant.businessId) {
      throw new ConvexError(
        "Forbidden: that employee belongs to another business."
      );
    }
    await requireBranchAccess(ctx, tenant.membership, employee.branchId);

    await ctx.db.delete(args.id);

    await logActivity(
      ctx,
      tenant.businessId,
      tenant.user._id,
      "Delete Employee",
      `Deleted employee ${employee.fullName}`
    );

    return true;
  },
});
