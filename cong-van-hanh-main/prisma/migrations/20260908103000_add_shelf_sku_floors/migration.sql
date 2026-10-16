ALTER TABLE rfid_shelf_sku_configurations
    ADD COLUMN IF NOT EXISTS sku_floors jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE rfid_shelf_sku_configurations config
SET sku_floors = COALESCE((
    SELECT jsonb_object_agg(sku_group, shelf.floor_count)
    FROM unnest(config.sku_groups) AS sku_group
), '{}'::jsonb)
FROM rfid_shelves shelf
WHERE shelf.shelf_id = config.shelf_id
  AND config.sku_floors = '{}'::jsonb;

ALTER TABLE rfid_shelf_sku_configurations
    DROP CONSTRAINT IF EXISTS rfid_shelf_sku_floors_object;
ALTER TABLE rfid_shelf_sku_configurations
    ADD CONSTRAINT rfid_shelf_sku_floors_object CHECK (jsonb_typeof(sku_floors) = 'object');

ALTER TABLE rfid_shelf_sku_configuration_audit
    ADD COLUMN IF NOT EXISTS previous_sku_floors jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS next_sku_floors jsonb NOT NULL DEFAULT '{}'::jsonb;
