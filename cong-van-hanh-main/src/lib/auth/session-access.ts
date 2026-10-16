export type SessionAccessRole = {
  key: string;
  roleModuleGroups: Array<{
    moduleGroup: {
      isActive: boolean;
      key: string;
      modules: Array<{ isActive: boolean; key: string }>;
    };
  }>;
  roleModules: Array<{
    appModule: { isActive: boolean; key: string };
  }>;
  rolePermissions: Array<{
    permission: { key: string };
  }>;
};

export type SessionAccess = {
  fullAccess: boolean;
  moduleGroups: string[];
  modules: string[];
  permissions: string[];
  roleKeys: string[];
};

// Quyền phát sinh theo ngữ cảnh (phỏng vấn, đánh giá...) chỉ được phép cộng
// thêm vào quyền nền. Hàm hợp nhất chung này tránh việc một nhánh ngữ cảnh vô
// tình thay toàn bộ session bằng đúng một module chuyên biệt.
export function mergeSessionAccess(
  ...accessList: SessionAccess[]
): SessionAccess {
  return {
    fullAccess: accessList.some((access) => access.fullAccess),
    moduleGroups: [
      ...new Set(accessList.flatMap((access) => access.moduleGroups)),
    ].sort(),
    modules: [
      ...new Set(accessList.flatMap((access) => access.modules)),
    ].sort(),
    permissions: [
      ...new Set(accessList.flatMap((access) => access.permissions)),
    ].sort(),
    roleKeys: [
      ...new Set(accessList.flatMap((access) => access.roleKeys)),
    ].sort(),
  };
}

// Quyền theo nhóm phải được bung thành từng module con ngay khi dựng session.
// Services vốn cho phép nhìn card theo nhóm; nếu session chỉ giữ groupKey thì
// các page/action kiểm tra moduleKey sẽ chặn nhầm người dùng sau khi bấm card.
export function resolveSessionAccess(roles: SessionAccessRole[]): SessionAccess {
  const permissions = new Set<string>();
  const moduleGroups = new Set<string>();
  const modules = new Set<string>();
  const roleKeys = roles.map((role) => role.key).sort();

  for (const role of roles) {
    for (const rolePermission of role.rolePermissions) {
      permissions.add(rolePermission.permission.key);
    }

    for (const roleModuleGroup of role.roleModuleGroups) {
      const group = roleModuleGroup.moduleGroup;
      if (!group.isActive) continue;

      moduleGroups.add(group.key);
      for (const appModule of group.modules) {
        if (appModule.isActive) modules.add(appModule.key);
      }
    }

    for (const roleModule of role.roleModules) {
      if (roleModule.appModule.isActive) {
        modules.add(roleModule.appModule.key);
      }
    }
  }

  return {
    fullAccess: roleKeys.includes("super-admin"),
    moduleGroups: [...moduleGroups].sort(),
    modules: [...modules].sort(),
    permissions: [...permissions].sort(),
    roleKeys,
  };
}
