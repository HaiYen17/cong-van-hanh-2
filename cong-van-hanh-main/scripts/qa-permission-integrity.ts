import "dotenv/config";

import { resolveSessionAccess } from "../src/lib/auth/session-access";
import { getDb } from "../src/lib/db";

type Issue = {
  detail: string;
  scope: string;
};

async function main() {
  const db = getDb();
  const [roles, users, defaultEmployeeGroups] = await Promise.all([
    db.role.findMany({
      include: {
        _count: { select: { userRoles: true } },
        roleModuleGroups: {
          include: {
            moduleGroup: {
              include: {
                modules: { where: { isActive: true } },
              },
            },
          },
        },
        roleModules: { include: { appModule: true } },
        rolePermissions: { include: { permission: true } },
      },
      orderBy: [{ rank: "asc" }, { name: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.user.findMany({
      include: {
        userRoles: {
          include: {
            role: {
              include: {
                roleModuleGroups: {
                  include: {
                    moduleGroup: {
                      include: {
                        modules: { where: { isActive: true } },
                      },
                    },
                  },
                },
                roleModules: { include: { appModule: true } },
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
      },
      where: { status: "ACTIVE", userRoles: { some: {} } },
    }),
    db.moduleGroup.findMany({
      select: { key: true },
      where: {
        collectionKey: "nguoi-thuan-viet",
        isActive: true,
        modules: { some: { isActive: true } },
      },
    }),
  ]);

  const issues: Issue[] = [];
  const roleSummary = roles.map((role) => {
    const access = resolveSessionAccess([role]);
    const inheritedModules = new Set(
      role.roleModuleGroups.flatMap(({ moduleGroup }) =>
        moduleGroup.isActive
          ? moduleGroup.modules
              .filter(({ isActive }) => isActive)
              .map(({ key }) => key)
          : [],
      ),
    );
    const missingModules = [...inheritedModules].filter(
      (moduleKey) => !access.modules.includes(moduleKey),
    );

    for (const moduleKey of missingModules) {
      issues.push({
        detail: `Nhóm đã cấp có module ${moduleKey}, nhưng session không nhận module này.`,
        scope: `role:${role.key}`,
      });
    }

    if (role.includeDefaultEmployeeAccess) {
      const grantedGroups = new Set(access.moduleGroups);
      for (const { key } of defaultEmployeeGroups) {
        if (!grantedGroups.has(key)) {
          issues.push({
            detail: `Vai trò mặc định nhân viên còn thiếu nhóm ${key}.`,
            scope: `role:${role.key}`,
          });
        }
      }
    }

    return {
      explicitModules: role.roleModules.length,
      grantedGroups: access.moduleGroups.length,
      resolvedModules: access.modules.length,
      roleKey: role.key,
      users: role._count.userRoles,
    };
  });

  for (const user of users) {
    const activeRoles = user.userRoles
      .map(({ role }) => role)
      .filter(({ status }) => status === "ACTIVE");
    const access = resolveSessionAccess(activeRoles);
    const inheritedModules = new Set(
      activeRoles.flatMap((role) =>
        role.roleModuleGroups.flatMap(({ moduleGroup }) =>
          moduleGroup.isActive
            ? moduleGroup.modules
                .filter(({ isActive }) => isActive)
                .map(({ key }) => key)
            : [],
        ),
      ),
    );
    const missingModules = [...inheritedModules].filter(
      (moduleKey) => !access.modules.includes(moduleKey),
    );
    if (missingModules.length) {
      issues.push({
        detail: `Thiếu module từ nhóm trong session: ${missingModules.join(", ")}.`,
        scope: `user:${user.username}`,
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        activeRoles: roles.length,
        activeUsersWithRoles: users.length,
        issues,
        ok: issues.length === 0,
        roleSummary,
      },
      null,
      2,
    ),
  );

  if (issues.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
