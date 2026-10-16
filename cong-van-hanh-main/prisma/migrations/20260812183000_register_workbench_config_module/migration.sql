-- Register the Admin card and its action permissions as part of deployment.
INSERT INTO "AppModule" (
    "id", "key", "label", "description", "icon", "groupId",
    "sortOrder", "isActive", "createdAt", "updatedAt"
)
SELECT
    'workbench-config-module-v1',
    'workbench-config',
    'Cấu hình Bàn làm việc',
    'Quản lý registry widget, bố cục gợi ý và nguồn công việc.',
    'layout-grid',
    "id",
    90,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ModuleGroup"
WHERE "key" = 'admin-config'
ON CONFLICT ("key") DO UPDATE SET
    "label" = EXCLUDED."label",
    "description" = EXCLUDED."description",
    "icon" = EXCLUDED."icon",
    "groupId" = EXCLUDED."groupId",
    "isActive" = true,
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Permission" (
    "id", "key", "module", "action", "description", "appModuleId", "createdAt"
)
SELECT
    'workbench-config-read-v1',
    'workbench_config.read',
    'workbench_config',
    'read',
    'Xem registry widget, bố cục gợi ý và nguồn công việc.',
    "id",
    CURRENT_TIMESTAMP
FROM "AppModule"
WHERE "key" = 'workbench-config'
ON CONFLICT ("key") DO UPDATE SET
    "description" = EXCLUDED."description",
    "appModuleId" = EXCLUDED."appModuleId";

INSERT INTO "Permission" (
    "id", "key", "module", "action", "description", "appModuleId", "createdAt"
)
SELECT
    'workbench-config-manage-v1',
    'workbench_config.manage',
    'workbench_config',
    'manage',
    'Quản lý registry widget, bố cục gợi ý và nguồn công việc.',
    "id",
    CURRENT_TIMESTAMP
FROM "AppModule"
WHERE "key" = 'workbench-config'
ON CONFLICT ("key") DO UPDATE SET
    "description" = EXCLUDED."description",
    "appModuleId" = EXCLUDED."appModuleId";

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" role
CROSS JOIN "Permission" permission
WHERE role."key" IN ('admin', 'super-admin')
  AND permission."key" IN ('workbench_config.read', 'workbench_config.manage')
ON CONFLICT DO NOTHING;
