CREATE TABLE IF NOT EXISTS rfid_shelf_sku_configurations (
    shelf_id text PRIMARY KEY REFERENCES rfid_shelves(shelf_id) ON DELETE CASCADE,
    sku_groups text[] NOT NULL DEFAULT '{}',
    configuration_version integer NOT NULL DEFAULT 1 CHECK (configuration_version BETWEEN 1 AND 2147483647),
    updated_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT rfid_shelf_sku_groups_count CHECK (cardinality(sku_groups) BETWEEN 0 AND 6),
    CONSTRAINT rfid_shelf_sku_groups_format CHECK (
        cardinality(sku_groups) = 0 OR array_to_string(sku_groups, ',') ~ '^[A-Z]+(,[A-Z]+){0,5}$'
    )
);

CREATE TABLE IF NOT EXISTS rfid_shelf_sku_configuration_audit (
    audit_id bigserial PRIMARY KEY,
    shelf_id text NOT NULL REFERENCES rfid_shelves(shelf_id) ON DELETE RESTRICT,
    actor_id text NOT NULL,
    previous_groups text[] NOT NULL DEFAULT '{}',
    next_groups text[] NOT NULL DEFAULT '{}',
    configuration_version integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rfid_shelf_sku_configuration_audit_shelf
    ON rfid_shelf_sku_configuration_audit(shelf_id, created_at DESC);

ALTER TABLE rfid_shelf_inventory_sessions
    ADD COLUMN IF NOT EXISTS configuration_version integer NOT NULL DEFAULT 0;

INSERT INTO "AppModule" (
    "id", "key", "label", "description", "icon", "groupId",
    "sortOrder", "isActive", "createdAt", "updatedAt"
)
SELECT
    'warehouse-shelf-config-module-v1',
    'warehouse-shelf-config',
    'Cấu hình kệ',
    'Khai báo tối đa 6 nhóm SKU được phép lưu trên từng kệ.',
    'tags',
    "id",
    22,
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "ModuleGroup"
WHERE "key" = 'warehouse'
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
    'warehouse-shelf-config-read-v1',
    'warehouse_shelf_config.read',
    'warehouse_shelf_config',
    'read',
    'Xem cấu hình nhóm SKU của kệ.',
    "id",
    CURRENT_TIMESTAMP
FROM "AppModule"
WHERE "key" = 'warehouse-shelf-config'
ON CONFLICT ("key") DO UPDATE SET
    "description" = EXCLUDED."description",
    "appModuleId" = EXCLUDED."appModuleId";

INSERT INTO "Permission" (
    "id", "key", "module", "action", "description", "appModuleId", "createdAt"
)
SELECT
    'warehouse-shelf-config-manage-v1',
    'warehouse_shelf_config.manage',
    'warehouse_shelf_config',
    'manage',
    'Cập nhật các nhóm SKU được phép lưu trên từng kệ.',
    "id",
    CURRENT_TIMESTAMP
FROM "AppModule"
WHERE "key" = 'warehouse-shelf-config'
ON CONFLICT ("key") DO UPDATE SET
    "description" = EXCLUDED."description",
    "appModuleId" = EXCLUDED."appModuleId";

