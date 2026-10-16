BEGIN;

ALTER TABLE rfid_entity_registry
    DROP CONSTRAINT IF EXISTS rfid_entity_registry_entity_type_check;
ALTER TABLE rfid_entity_registry
    ADD CONSTRAINT rfid_entity_registry_entity_type_check
    CHECK (entity_type IN ('PRODUCT', 'SHELF', 'VEHICLE'));

ALTER TABLE rfid_shelves
    ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'SHELF',
    ADD COLUMN IF NOT EXISTS floor_count smallint NOT NULL DEFAULT 3;
ALTER TABLE rfid_shelves
    ADD CONSTRAINT rfid_shelves_entity_type_check
    CHECK (entity_type IN ('SHELF', 'VEHICLE')),
    ADD CONSTRAINT rfid_shelves_floor_count_check
    CHECK ((entity_type='SHELF' AND floor_count BETWEEN 1 AND 20)
        OR (entity_type='VEHICLE' AND floor_count=0));

ALTER TABLE rfid_shelf_inventory_sessions
    ADD COLUMN IF NOT EXISTS entity_type text NOT NULL DEFAULT 'SHELF',
    ADD COLUMN IF NOT EXISTS floor_count smallint NOT NULL DEFAULT 3;
ALTER TABLE rfid_shelf_inventory_sessions
    ADD CONSTRAINT rfid_shelf_inventory_sessions_entity_type_check
    CHECK (entity_type IN ('SHELF', 'VEHICLE')),
    ADD CONSTRAINT rfid_shelf_inventory_sessions_floor_count_check
    CHECK ((entity_type='SHELF' AND floor_count BETWEEN 1 AND 20)
        OR (entity_type='VEHICLE' AND floor_count=0));

ALTER TABLE rfid_shelf_inventory_lines
    DROP CONSTRAINT IF EXISTS rfid_shelf_inventory_lines_floor_check;
ALTER TABLE rfid_shelf_inventory_lines
    ADD CONSTRAINT rfid_shelf_inventory_lines_floor_check
    CHECK (floor BETWEEN 0 AND 20);

COMMIT;
