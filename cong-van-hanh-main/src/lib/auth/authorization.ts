import type { AppSession } from "@/lib/auth/session";
import { hasPermission, type PermissionKey } from "@/lib/auth/permissions";

export function can(session: AppSession, permission: PermissionKey) {
  const isSuperAdmin = session.fullAccess && session.roles.includes("super-admin");
  return isSuperAdmin || hasPermission(session.permissions, permission);
}

export function canAny(session: AppSession, permissions: PermissionKey[]) {
  return permissions.some((permission) => can(session, permission));
}
