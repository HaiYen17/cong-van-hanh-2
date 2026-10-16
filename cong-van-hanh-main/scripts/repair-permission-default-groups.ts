import "dotenv/config";

import { getDb } from "../src/lib/db";

const apply = process.argv.includes("--apply");

async function main() {
  const db = getDb();
  const [roles, defaultGroups] = await Promise.all([
    db.role.findMany({
      include: { roleModuleGroups: true },
      orderBy: [{ rank: "asc" }, { key: "asc" }],
      where: {
        includeDefaultEmployeeAccess: true,
        status: "ACTIVE",
      },
    }),
    db.moduleGroup.findMany({
      select: { id: true, key: true },
      where: {
        collectionKey: "nguoi-thuan-viet",
        isActive: true,
        modules: { some: { isActive: true } },
      },
    }),
  ]);

  const repairs = roles.flatMap((role) => {
    const existingGroupIds = new Set(
      role.roleModuleGroups.map(({ moduleGroupId }) => moduleGroupId),
    );
    const missingGroups = defaultGroups.filter(
      ({ id }) => !existingGroupIds.has(id),
    );
    return missingGroups.length
      ? [{ missingGroups, roleId: role.id, roleKey: role.key, roleName: role.name }]
      : [];
  });

  console.log(
    JSON.stringify(
      {
        apply,
        defaultEmployeeGroups: defaultGroups.map(({ key }) => key),
        repairs: repairs.map(({ missingGroups, roleKey, roleName }) => ({
          missingGroups: missingGroups.map(({ key }) => key),
          roleKey,
          roleName,
        })),
      },
      null,
      2,
    ),
  );

  if (!apply || !repairs.length) return;

  await db.$transaction(async (tx) => {
    for (const repair of repairs) {
      await tx.roleModuleGroup.createMany({
        data: repair.missingGroups.map(({ id: moduleGroupId }) => ({
          moduleGroupId,
          roleId: repair.roleId,
        })),
        skipDuplicates: true,
      });
      await tx.auditLog.create({
        data: {
          action: "PERMISSION_CHANGE",
          metadata: {
            groupKeys: repair.missingGroups.map(({ key }) => key),
            reason: "repair-include-default-employee-access",
          },
          summary: `Khôi phục nhóm Người Thuần Việt còn thiếu cho quyền ${repair.roleName}.`,
          targetId: repair.roleId,
          targetType: "Role",
        },
      });
    }
  });

  console.log(`Đã khôi phục ${repairs.length} vai trò.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
