import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('migration báo cáo kệ giữ liên kết nguồn và chặn trùng kệ', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE TABLE "WarehouseRfidTag"(id text PRIMARY KEY,epc text UNIQUE);');
    await db.exec(await readFile(new URL('../prisma/migrations/20260905003000_add_shelf_inventory/migration.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../prisma/migrations/20260905033000_add_shelf_inventory_reports/migration.sql', import.meta.url), 'utf8'));
    for (const key of ['a', 'b']) {
      await db.query("INSERT INTO rfid_entity_registry VALUES($1,'SHELF',$2)", [`E200000${key === 'a' ? '1' : '2'}`, `shelf-${key}`]);
      await db.query("INSERT INTO rfid_shelves(shelf_id,code,name,warehouse,epc,version,operation_id,created_by) VALUES($1,$2,$3,'Kho A',$4,1,$5,'user-1')", [`shelf-${key}`, `A${key === 'a' ? '1' : '2'}`, `Kệ ${key}`, `E200000${key === 'a' ? '1' : '2'}`, `op-${key}`]);
      await db.query("INSERT INTO rfid_shelf_inventory_sessions(session_id,shelf_id,warehouse,actor_id,operator_name,request_hash,payload,scanned_quantity,final_quantity,sku_count,created_at) VALUES($1,$2,'Kho A','user-1','Quản kho','hash',$3,0,0,0,now())", [`session-${key}`, `shelf-${key}`, JSON.stringify({ sessionId: `session-${key}`, lines: [] })]);
    }
    await db.query("INSERT INTO rfid_shelf_inventory_reports(report_id,name,warehouse,actor_id,prepared_by,snapshot,shelf_count,sku_count,total_quantity) VALUES('report-1','Báo cáo','Kho A','user-1','Quản kho','{}',2,0,0)");
    await db.query("INSERT INTO rfid_shelf_inventory_report_sessions VALUES('report-1','session-a','shelf-a',1),('report-1','session-b','shelf-b',2)");
    await assert.rejects(db.query("INSERT INTO rfid_shelf_inventory_report_sessions VALUES('report-1','session-b','shelf-a',3)"));
    await assert.rejects(db.query("DELETE FROM rfid_shelf_inventory_sessions WHERE session_id='session-a'"));
    const links = await db.query('SELECT count(*)::int AS count FROM rfid_shelf_inventory_report_sessions');
    assert.equal(links.rows[0].count, 2);
  } finally {
    await db.close();
  }
});
