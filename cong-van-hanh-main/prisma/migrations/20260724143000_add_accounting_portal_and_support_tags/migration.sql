BEGIN;

CREATE SCHEMA IF NOT EXISTS accounting_portal;

CREATE TABLE IF NOT EXISTS accounting_portal.config_versions (
  version_id text PRIMARY KEY,
  version_name text NOT NULL,
  status_code text NOT NULL CHECK (status_code IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
  source_version_id text REFERENCES accounting_portal.config_versions(version_id),
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL
);

CREATE TABLE IF NOT EXISTS accounting_portal.config_records (
  record_id text PRIMARY KEY,
  version_id text NOT NULL REFERENCES accounting_portal.config_versions(version_id) ON DELETE RESTRICT,
  record_type text NOT NULL,
  entity_key text NOT NULL,
  parent_key text NOT NULL DEFAULT '',
  company_key text NOT NULL DEFAULT '',
  display_code text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  status_label text NOT NULL DEFAULT '',
  valid_from text NOT NULL DEFAULT '',
  valid_to text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text NOT NULL DEFAULT '',
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS config_records_active_identity_uq
  ON accounting_portal.config_records(version_id, record_type, entity_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS config_records_version_type_sort_idx
  ON accounting_portal.config_records(version_id, record_type, sort_order, entity_key)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS config_records_payload_gin_idx
  ON accounting_portal.config_records USING gin(payload);

CREATE TABLE IF NOT EXISTS accounting_portal.audit_events (
  audit_id text PRIMARY KEY,
  action text NOT NULL,
  version_id text NOT NULL DEFAULT '',
  record_id text NOT NULL DEFAULT '',
  record_type text NOT NULL DEFAULT '',
  display_name text NOT NULL DEFAULT '',
  before_data jsonb,
  after_data jsonb,
  actor_email text NOT NULL,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounting_audit_events_created_idx
  ON accounting_portal.audit_events(created_at DESC);

CREATE INDEX IF NOT EXISTS accounting_audit_events_record_idx
  ON accounting_portal.audit_events(record_id, created_at DESC);

CREATE TABLE "SupportToolTag" (
  id text NOT NULL,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  "createdByName" text,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL,
  "archivedAt" timestamp(3),
  CONSTRAINT "SupportToolTag_pkey" PRIMARY KEY (id)
);

CREATE UNIQUE INDEX "SupportToolTag_name_key" ON "SupportToolTag"(name);
CREATE INDEX "SupportToolTag_status_name_idx" ON "SupportToolTag"(status, name);

INSERT INTO "ModuleGroup" (
  id, key, title, "collectionKey", "collectionTitle", description,
  "sortOrder", "isActive", "createdAt", "updatedAt"
) VALUES (
  'grp_accounting_admin',
  'accounting-admin',
  'Kế toán',
  'accounting',
  'Kế toán',
  'Cấu hình, dữ liệu và báo cáo kế toán.',
  60,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO UPDATE SET
  title = EXCLUDED.title,
  "collectionKey" = EXCLUDED."collectionKey",
  "collectionTitle" = EXCLUDED."collectionTitle",
  description = EXCLUDED.description,
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "AppModule" (
  id, key, label, description, icon, "groupId", "sortOrder",
  "isActive", "createdAt", "updatedAt"
) VALUES (
  'mod_accounting_config',
  'accounting-config',
  'Cấu hình Báo cáo Kế toán',
  'Phiên bản, hệ thống tài khoản, mẫu báo cáo, nguồn dữ liệu và hợp nhất.',
  'bar-chart-3',
  (SELECT id FROM "ModuleGroup" WHERE key = 'accounting-admin'),
  10,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  "groupId" = EXCLUDED."groupId",
  "sortOrder" = EXCLUDED."sortOrder",
  "isActive" = true,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Permission" (id, key, module, action, description, "appModuleId", "createdAt")
VALUES
  (
    'perm_accounting_config_read',
    'accounting.config.read',
    'accounting.config',
    'read',
    'Xem cấu hình và dữ liệu Báo cáo Kế toán.',
    (SELECT id FROM "AppModule" WHERE key = 'accounting-config'),
    CURRENT_TIMESTAMP
  ),
  (
    'perm_accounting_config_edit',
    'accounting.config.edit',
    'accounting.config',
    'edit',
    'Tạo phiên bản và chỉnh sửa cấu hình Báo cáo Kế toán.',
    (SELECT id FROM "AppModule" WHERE key = 'accounting-config'),
    CURRENT_TIMESTAMP
  ),
  (
    'perm_accounting_config_approve',
    'accounting.config.approve',
    'accounting.config',
    'approve',
    'Duyệt và phát hành cấu hình Báo cáo Kế toán.',
    (SELECT id FROM "AppModule" WHERE key = 'accounting-config'),
    CURRENT_TIMESTAMP
  ),
  (
    'perm_accounting_runtime_manage',
    'accounting.runtime.manage',
    'accounting.runtime',
    'manage',
    'Quản lý kết nối và tiến trình dữ liệu kế toán.',
    (SELECT id FROM "AppModule" WHERE key = 'accounting-config'),
    CURRENT_TIMESTAMP
  )
ON CONFLICT (key) DO UPDATE SET
  module = EXCLUDED.module,
  action = EXCLUDED.action,
  description = EXCLUDED.description,
  "appModuleId" = EXCLUDED."appModuleId";

INSERT INTO "Role" (
  id, key, name, description, rank, status, "isSystem", "isCore",
  "includeDefaultEmployeeAccess", "createdAt", "updatedAt"
) VALUES
  (
    'role_admin_ke_toan_editor',
    'admin-ke-toan-editor',
    'Admin Kế toán Editor',
    'Chỉnh sửa cấu hình và vận hành nguồn dữ liệu kế toán.',
    25,
    'ACTIVE',
    true,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  ),
  (
    'role_admin_ke_toan_approver',
    'admin-ke-toan-approver',
    'Admin Kế toán Approver',
    'Rà soát, phê duyệt và phát hành cấu hình kế toán.',
    24,
    'ACTIVE',
    true,
    false,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  rank = EXCLUDED.rank,
  status = 'ACTIVE',
  "isSystem" = true,
  "includeDefaultEmployeeAccess" = true,
  "updatedAt" = CURRENT_TIMESTAMP,
  "archivedAt" = NULL;

INSERT INTO "RoleModuleGroup" ("roleId", "moduleGroupId")
SELECT r.id, g.id
FROM "Role" r
CROSS JOIN "ModuleGroup" g
WHERE r.key IN ('admin-ke-toan-editor', 'admin-ke-toan-approver')
  AND g.key = 'accounting-admin'
ON CONFLICT DO NOTHING;

INSERT INTO "RoleAppModule" ("roleId", "appModuleId")
SELECT r.id, m.id
FROM "Role" r
CROSS JOIN "AppModule" m
WHERE r.key IN ('admin-ke-toan-editor', 'admin-ke-toan-approver')
  AND m.key = 'accounting-config'
ON CONFLICT DO NOTHING;

INSERT INTO "RolePermission" ("roleId", "permissionId")
SELECT r.id, p.id
FROM "Role" r
JOIN "Permission" p ON (
  (r.key = 'admin-ke-toan-editor' AND p.key IN (
    'accounting.config.read',
    'accounting.config.edit',
    'accounting.runtime.manage'
  ))
  OR
  (r.key = 'admin-ke-toan-approver' AND p.key IN (
    'accounting.config.read',
    'accounting.config.edit',
    'accounting.config.approve',
    'accounting.runtime.manage'
  ))
)
ON CONFLICT DO NOTHING;

COMMIT;
