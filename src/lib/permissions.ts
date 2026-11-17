/**
 * SMARTBUZ — permission helpers for the interface.
 *
 * ────────────────────────────────────────────────────────────────────────
 * These helpers decide what to *show*. They never decide what to *allow*.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Every one of these functions is a convenience: hiding a button the user
 * cannot press. The real enforcement is on the backend, in
 * `convex/tenancy.ts`, and it happens whether or not the interface hides
 * anything. A tampered client that calls a mutation it has no permission
 * for gets a "Forbidden" error, not a result.
 *
 * The catalogue itself is imported from `convex/rbac.ts` so the interface
 * and the backend cannot drift apart — there is one list of permissions
 * and one role map, not two.
 */

import {
  ALL_PERMISSIONS,
  PERMISSION_DEFINITIONS,
  ROLES,
  type Permission,
  type RoleId,
} from "../../convex/rbac";

export type { Permission, RoleId };
export { ALL_PERMISSIONS, PERMISSION_DEFINITIONS, ROLES };

/**
 * The permissions a person holds, as reported by the backend.
 *
 * `users.me` returns the effective permission set for the active business
 * — the role's grants plus any custom grants, minus any denials.
 */
export type PermissionSet = readonly string[] | undefined;

/** True when the permission set includes the permission. */
export function can(
  permissions: PermissionSet,
  permission: Permission
): boolean {
  if (!permissions) return false;
  return permissions.includes(permission);
}

/** True when the permission set includes at least one of the permissions. */
export function canAny(
  permissions: PermissionSet,
  required: readonly Permission[]
): boolean {
  if (!permissions) return false;
  return required.some((permission) => permissions.includes(permission));
}

/** True when the permission set includes every one of the permissions. */
export function canAll(
  permissions: PermissionSet,
  required: readonly Permission[]
): boolean {
  if (!permissions) return false;
  return required.every((permission) => permissions.includes(permission));
}

/**
 * The permissions grouped by area, for the settings screens.
 */
export function permissionGroups(): {
  group: string;
  permissions: { id: Permission; label: string; description: string }[];
}[] {
  const groups = new Map<string, { id: Permission; label: string; description: string }[]>();

  for (const id of ALL_PERMISSIONS) {
    const definition = PERMISSION_DEFINITIONS[id];
    const list = groups.get(definition.group) ?? [];
    list.push({
      id,
      label: definition.label,
      description: definition.description,
    });
    groups.set(definition.group, list);
  }

  return [...groups.entries()].map(([group, permissions]) => ({
    group,
    permissions,
  }));
}

/**
 * The roles that may be assigned to a member of a business.
 *
 * The owner is deliberately absent: ownership is transferred, not handed
 * out, and there is exactly one owner per business.
 */
export function assignableRoles(): {
  id: RoleId;
  label: string;
  description: string;
}[] {
  return Object.values(ROLES)
    .filter((role) => role.scope === "business" && role.id !== "business_owner")
    .map((role) => ({
      id: role.id,
      label: role.label,
      description: role.description,
    }));
}

/** The assignable roles, as a constant for render-time use. */
export const ASSIGNABLE_ROLES: {
  id: RoleId;
  label: string;
  description: string;
}[] = Object.values(ROLES)
  .filter((role) => role.scope === "business" && role.id !== "business_owner")
  .map((role) => ({
    id: role.id,
    label: role.label,
    description: role.description,
  }));

/**
 * A human-readable label for a role id.
 */
export function roleLabel(role: string | undefined): string {
  if (!role) return "Unknown";
  return ROLES[role as RoleId]?.label ?? role;
}
