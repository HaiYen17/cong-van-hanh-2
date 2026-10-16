BEGIN;

CREATE SEQUENCE IF NOT EXISTS rfid_shelf_barcode_seq START WITH 10000001;

ALTER TABLE rfid_shelves
    ADD COLUMN IF NOT EXISTS barcode text;

UPDATE rfid_shelves
SET barcode = 'TVK-' || nextval('rfid_shelf_barcode_seq')::text
WHERE barcode IS NULL OR btrim(barcode) = '';

ALTER TABLE rfid_shelves
    ALTER COLUMN barcode SET NOT NULL,
    ALTER COLUMN epc DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS rfid_shelves_barcode_unique
    ON rfid_shelves (upper(barcode));

COMMIT;
