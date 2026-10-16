BEGIN;

CREATE TABLE IF NOT EXISTS rfid_shelf_inventory_reports (
    report_id text PRIMARY KEY,
    name text NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
    warehouse text NOT NULL CHECK (length(warehouse) BETWEEN 1 AND 120),
    actor_id text NOT NULL,
    prepared_by text NOT NULL,
    snapshot jsonb NOT NULL,
    shelf_count integer NOT NULL CHECK (shelf_count BETWEEN 2 AND 100),
    sku_count integer NOT NULL CHECK (sku_count >= 0),
    total_quantity integer NOT NULL CHECK (total_quantity >= 0),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rfid_shelf_inventory_reports_recent
    ON rfid_shelf_inventory_reports(created_at DESC, report_id DESC);
CREATE INDEX IF NOT EXISTS rfid_shelf_inventory_reports_warehouse
    ON rfid_shelf_inventory_reports(warehouse, created_at DESC);

CREATE TABLE IF NOT EXISTS rfid_shelf_inventory_report_sessions (
    report_id text NOT NULL REFERENCES rfid_shelf_inventory_reports(report_id) ON DELETE CASCADE,
    session_id text NOT NULL REFERENCES rfid_shelf_inventory_sessions(session_id) ON DELETE RESTRICT,
    shelf_id text NOT NULL REFERENCES rfid_shelves(shelf_id) ON DELETE RESTRICT,
    position smallint NOT NULL CHECK (position BETWEEN 1 AND 100),
    PRIMARY KEY (report_id, session_id),
    UNIQUE (report_id, shelf_id),
    UNIQUE (report_id, position)
);
CREATE INDEX IF NOT EXISTS rfid_shelf_inventory_report_sessions_source
    ON rfid_shelf_inventory_report_sessions(session_id);

COMMIT;
