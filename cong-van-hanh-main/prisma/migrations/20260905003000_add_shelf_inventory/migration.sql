BEGIN;

CREATE TABLE IF NOT EXISTS rfid_entity_registry (
    epc text PRIMARY KEY,
    entity_type text NOT NULL CHECK (entity_type IN ('PRODUCT', 'SHELF')),
    entity_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS rfid_shelves (
    shelf_id text PRIMARY KEY,
    code text NOT NULL CHECK (length(code) BETWEEN 1 AND 80),
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
    warehouse text NOT NULL CHECK (length(warehouse) BETWEEN 1 AND 120),
    epc text NOT NULL UNIQUE REFERENCES rfid_entity_registry(epc)
        CHECK (epc ~ '^[0-9A-F]{8,128}$' AND length(epc) % 2 = 0),
    version integer NOT NULL CHECK (version > 0),
    operation_id text NOT NULL,
    created_by text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS rfid_shelves_warehouse_code ON rfid_shelves(lower(warehouse), lower(code));

CREATE TABLE IF NOT EXISTS rfid_shelf_operations (
    operation_id text PRIMARY KEY,
    actor_id text NOT NULL,
    request_hash text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rfid_shelf_inventory_sessions (
    session_id text PRIMARY KEY,
    shelf_id text NOT NULL REFERENCES rfid_shelves(shelf_id),
    warehouse text NOT NULL,
    actor_id text NOT NULL,
    operator_name text NOT NULL,
    request_hash text NOT NULL,
    payload jsonb NOT NULL,
    scanned_quantity integer NOT NULL CHECK (scanned_quantity >= 0),
    final_quantity integer NOT NULL CHECK (final_quantity >= 0),
    sku_count integer NOT NULL CHECK (sku_count >= 0),
    created_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfid_shelf_inventory_recent ON rfid_shelf_inventory_sessions(received_at DESC, session_id DESC);
CREATE INDEX IF NOT EXISTS rfid_shelf_inventory_by_shelf ON rfid_shelf_inventory_sessions(shelf_id, received_at DESC);

CREATE TABLE IF NOT EXISTS rfid_shelf_inventory_lines (
    session_id text NOT NULL REFERENCES rfid_shelf_inventory_sessions(session_id),
    floor smallint NOT NULL CHECK (floor BETWEEN 1 AND 3),
    sku text NOT NULL,
    name text NOT NULL,
    quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 1000000),
    PRIMARY KEY (session_id, floor, sku)
);

-- Keep old product EPC formats intact. Normalize only their shared ownership key.
-- Lock writers while backfilling and installing triggers so no claim is missed.
LOCK TABLE "WarehouseRfidTag" IN SHARE ROW EXCLUSIVE MODE;
INSERT INTO rfid_entity_registry(epc, entity_type, entity_id)
SELECT upper(regexp_replace(epc, '\s', '', 'g')), 'PRODUCT', id FROM "WarehouseRfidTag";

CREATE FUNCTION warehouse_product_epc_registry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE claim_epc text;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    DELETE FROM rfid_entity_registry
      WHERE epc=upper(regexp_replace(OLD.epc, '\s', '', 'g'))
        AND entity_type='PRODUCT' AND entity_id=OLD.id;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    claim_epc := upper(regexp_replace(NEW.epc, '\s', '', 'g'));
    PERFORM pg_advisory_xact_lock(hashtextextended('rfid-epc:' || claim_epc, 0));
    INSERT INTO rfid_entity_registry(epc,entity_type,entity_id)
      VALUES(claim_epc,'PRODUCT',NEW.id)
      ON CONFLICT(epc) DO UPDATE SET entity_id=rfid_entity_registry.entity_id
      WHERE rfid_entity_registry.entity_type='PRODUCT' AND rfid_entity_registry.entity_id=NEW.id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'RFID đã thuộc kệ hoặc hàng hóa khác.' USING ERRCODE='23505';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER warehouse_product_epc_claim
  AFTER INSERT OR UPDATE OF epc, id ON "WarehouseRfidTag"
  FOR EACH ROW EXECUTE FUNCTION warehouse_product_epc_registry();
CREATE TRIGGER warehouse_product_epc_release
  AFTER DELETE ON "WarehouseRfidTag"
  FOR EACH ROW EXECUTE FUNCTION warehouse_product_epc_registry();

COMMIT;
