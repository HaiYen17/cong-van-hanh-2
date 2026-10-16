-- Admin CnB là quyền quản trị riêng cho Cấu hình đánh giá. Quyền này vẫn có
-- lối vào Đánh giá nhân sự như một nhân viên bình thường; OperationActor giữ
-- isAdmin=false để không làm lộ phiếu của người khác trên màn Đánh giá nhân sự.
INSERT INTO "Role" (
  "id",
  "key",
  "name",
  "description",
  "rank",
  "status",
  "isSystem",
  "isCore",
  "includeDefaultEmployeeAccess",
  "createdAt",
  "updatedAt"
)
VALUES (
  'role_admin_cnb',
  'admin-cnb',
  'Admin CnB',
  'Quản trị cấu hình, phân bổ và theo dõi đánh giá nhân sự.',
  30,
  'ACTIVE',
  false,
  false,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "Permission" (
  "id",
  "key",
  "module",
  "action",
  "description",
  "appModuleId",
  "createdAt"
)
SELECT
  'perm_portal_evaluation_config_' || action_name,
  'portal.evaluation-config.' || action_name,
  'portal.evaluation-config',
  action_name,
  action_name || ' module Cấu hình đánh giá.',
  module."id",
  CURRENT_TIMESTAMP
FROM "AppModule" AS module
CROSS JOIN (VALUES ('view'), ('edit'), ('delete')) AS actions(action_name)
WHERE module."key" = 'evaluation-config'
ON CONFLICT DO NOTHING;

INSERT INTO "RoleModuleGroup" ("roleId", "moduleGroupId")
SELECT role."id", module_group."id"
FROM "Role" AS role
JOIN "ModuleGroup" AS module_group
  ON module_group."collectionKey" = 'nguoi-thuan-viet'
WHERE role."key" = 'admin-cnb'
ON CONFLICT DO NOTHING;

INSERT INTO "RoleAppModule" ("roleId", "appModuleId")
SELECT role."id", module."id"
FROM "Role" AS role
JOIN "AppModule" AS module ON module."key" = 'evaluation-config'
WHERE role."key" = 'admin-cnb'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT role."id", permission."id"
FROM "Role" AS role
JOIN "Permission" AS permission
  ON permission."key" IN (
    'evaluation_config.read',
    'portal.evaluation-config.view',
    'portal.evaluation-config.edit',
    'portal.evaluation-config.delete'
  )
WHERE role."key" = 'admin-cnb'
ON CONFLICT DO NOTHING;
