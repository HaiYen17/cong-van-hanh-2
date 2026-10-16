import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration giữ kệ cũ ở 3 tầng và cho phép xe không tầng', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "WarehouseRfidTag"(id text PRIMARY KEY,epc text UNIQUE);');
    await db.exec(await readFile(new URL('../prisma/migrations/20260905003000_add_shelf_inventory/migration.sql', import.meta.url), 'utf8'));
    await db.query("INSERT INTO rfid_entity_registry VALUES('E2000001','SHELF','shelf-old')");
    await db.query("INSERT INTO rfid_shelves(shelf_id,code,name,warehouse,epc,version,operation_id,created_by) VALUES('shelf-old','A1','Kệ cũ','Kho tổng','E2000001',1,'op-old','user')");
    await db.exec(await readFile(new URL('../prisma/migrations/20260905070000_add_shelf_vehicle_types/migration.sql', import.meta.url), 'utf8'));
    const old = (await db.query("SELECT entity_type,floor_count FROM rfid_shelves WHERE shelf_id='shelf-old'")).rows[0];
    assert.deepEqual(old, { entity_type: 'SHELF', floor_count: 3 });
    await db.query("INSERT INTO rfid_entity_registry VALUES('E2000002','VEHICLE','vehicle-a')");
    await db.query("INSERT INTO rfid_shelves(shelf_id,code,name,warehouse,epc,version,operation_id,created_by,entity_type,floor_count) VALUES('vehicle-a','XE-01','Xe 01','Kho tổng','E2000002',1,'op-vehicle','user','VEHICLE',0)");
    await assert.rejects(db.query("UPDATE rfid_shelves SET floor_count=1 WHERE shelf_id='vehicle-a'"));
    await assert.rejects(db.query("UPDATE rfid_shelves SET floor_count=0 WHERE shelf_id='shelf-old'"));
  } finally { await db.close(); }
});
