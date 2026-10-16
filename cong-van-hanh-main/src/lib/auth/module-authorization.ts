export type PortalModuleAction = "view" | "edit" | "delete";

export type PortalAccessSubject = {
  fullAccess: boolean;
  modules: string[];
  permissions: string[];
  roles: string[];
};

function isSystemAdministrator(session: PortalAccessSubject) {
  return (
    session.fullAccess ||
    session.roles.includes("super-admin") ||
    session.roles.includes("admin")
  );
}

export function portalModulePermissionKey(
  moduleKey: string,
  action: PortalModuleAction,
) {
  return `portal.${moduleKey}.${action}`;
}

export function canUsePortalModule(
  session: PortalAccessSubject,
  moduleKey: string,
  action: PortalModuleAction,
) {
  if (isSystemAdministrator(session)) return true;
  if (!session.modules.includes(moduleKey)) return false;

  const granted = new Set(session.permissions);
  if (granted.has(portalModulePermissionKey(moduleKey, action))) return true;

  // Sửa/Xóa luôn kéo theo quyền xem trong giao diện Cấp quyền.
  if (action === "view") {
    return (
      granted.has(portalModulePermissionKey(moduleKey, "edit")) ||
      granted.has(portalModulePermissionKey(moduleKey, "delete"))
    );
  }

  return false;
}
