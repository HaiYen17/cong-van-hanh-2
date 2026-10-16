import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createShelfService } from '../src/lib/warehouse/shelf-core/service.mjs';

const db = new PGlite();
try {
  await db.exec(`CREATE TABLE "WarehouseRfidTag"(id text PRIMARY KEY,epc text UNIQUE,"productSku" text);
    INSERT INTO "WarehouseRfidTag" VALUES('tag-old','legacy nonhex','SKU-A');`);
  await db.exec(await readFile('prisma/migrations/20260905003000_add_shelf_inventory/migration.sql', 'utf8'));
  await db.exec(await readFile('prisma/migrations/20260905070000_add_shelf_vehicle_types/migration.sql', 'utf8'));
  assert.equal((await db.query("SELECT entity_id FROM rfid_entity_registry WHERE epc='LEGACYNONHEX'")).rows[0].entity_id, 'tag-old');
  const service = createShelfService({
    pool: { query: (...args) => db.query(...args), connect: async () => ({ query: (...args) => db.query(...args), release() {} }) },
    authorize: async () => true, allowedWarehouses: async () => null,
    assertProductEpcAvailable: async () => {}, loadProducts: async () => new Map(),
  });
  const actor = { userId: 'admin', displayName: 'QA' };
  const shelf = { action:'warehouseDefineShelf', shelfId:'shelf-1', operationId:'def-1',code:'KE-1',name:'Kệ kiểm tra',warehouse:'QA',epc:'E200ABCD',version:0 };
  await service.dispatch(shelf, actor);
  await assert.rejects(db.query('INSERT INTO "WarehouseRfidTag" VALUES($1,$2,$3)', ['tag-new','e200 abcd','SKU-B']), { code:'23505' });
  await db.query('INSERT INTO "WarehouseRfidTag" VALUES($1,$2,$3)', ['tag-new','E2001234','SKU-B']);
  await db.query('INSERT INTO "WarehouseRfidTag" VALUES($1,$2,$3) ON CONFLICT(epc) DO UPDATE SET "productSku"=EXCLUDED."productSku"', ['discarded-id','E2001234','SKU-UPSERT']);
  assert.equal((await db.query('SELECT "productSku" FROM "WarehouseRfidTag" WHERE id=$1', ['tag-new'])).rows[0].productSku,'SKU-UPSERT');
  await db.query('INSERT INTO "WarehouseRfidTag" VALUES($1,$2,$3) ON CONFLICT(epc) DO NOTHING', ['discarded-id-2','E2001234','SKU-IGNORED']);
  assert.equal((await db.query("SELECT entity_id FROM rfid_entity_registry WHERE epc='E2001234'")).rows[0].entity_id, 'tag-new');
  await assert.rejects(service.dispatch({ ...shelf, shelfId:'shelf-2', operationId:'def-2', epc:'E2001234' }, actor), { code:'EPC_IN_USE' });
  await db.query('UPDATE "WarehouseRfidTag" SET "productSku"=$1 WHERE id=$2', ['SKU-C','tag-new']);
  assert.equal((await db.query("SELECT entity_id FROM rfid_entity_registry WHERE epc='E2001234'")).rows[0].entity_id, 'tag-new');
  await assert.rejects(db.query('UPDATE "WarehouseRfidTag" SET epc=$1 WHERE id=$2', ['E200ABCD','tag-new']), { code:'23505' });
  assert.equal((await db.query("SELECT entity_id FROM rfid_entity_registry WHERE epc='E2001234'")).rows[0].entity_id, 'tag-new');
  await db.query('UPDATE "WarehouseRfidTag" SET epc=$1 WHERE id=$2', ['E2005678','tag-new']);
  assert.equal((await db.query("SELECT * FROM rfid_entity_registry WHERE epc='E2001234'")).rows.length,0);
  await db.query('DELETE FROM "WarehouseRfidTag" WHERE id=$1',['tag-new']);
  assert.equal((await db.query("SELECT * FROM rfid_entity_registry WHERE epc='E2005678'")).rows.length,0);
  assert.equal((await db.query("SELECT * FROM rfid_entity_registry WHERE entity_type='SHELF'")).rows.length,1);
  console.log('Shelf migration/registry: backfill, bidirectional collision, reassign, EPC update rollback and deletion passed.');
} finally { await db.close(); }
