import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createShelfService, claimProductEpcs } from '../src/lib/warehouse/shelf-core/service.mjs';
import { submission, ShelfError } from '../src/lib/warehouse/shelf-core/domain.mjs';
import { extendShelfOpenApi } from '../src/lib/warehouse/shelf-core/openapi.mjs';


let db, service;
const actor = { userId: 'operator-1', displayName: 'Quản kho' };
const definition = { action: 'warehouseDefineShelf', shelfId: 'shelf-a', operationId: 'def-a',
  code: 'KE-01', name: 'Kệ mùa hè', warehouse: 'Kho A', epc: 'E2000001', version: 0 };
const result = () => ({ action: 'warehouseShelfInventorySubmit', schemaVersion: 1, type: 'SHELF',
  sessionId: 'session-1', operatorId: actor.userId, shelfId: definition.shelfId,
  shelfName: definition.name, shelfCode: definition.code, warehouse: definition.warehouse,
  createdAt: '2026-09-04T12:00:00+07:00', submittedAt: '2026-09-04T12:30:00+07:00', deviceName: 'CHAINWAY_C72_01',
  scanned: [{ sku: 'SKU-A', name: 'Áo thun', quantity: 12 }],
  lines: [{ floor: 3, sku: 'SKU-A', name: 'Áo thun', quantity: 7 }, { floor: 2, sku: 'SKU-A', name: 'Áo thun', quantity: 5 }],
  excludedReadCount: 2 });

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "WarehouseRfidTag"(id text PRIMARY KEY,epc text UNIQUE);');
  await db.exec(await readFile(new URL('../prisma/migrations/20260905003000_add_shelf_inventory/migration.sql', import.meta.url), 'utf8'));
  await db.exec(await readFile(new URL('../prisma/migrations/20260905070000_add_shelf_vehicle_types/migration.sql', import.meta.url), 'utf8'));
  // PGlite has one connection; serialize transactions to model pool checkout semantics.
  let tail = Promise.resolve();
  const pool = { query: (...args) => db.query(...args), async connect() {
    const previous = tail; let release;
    tail = new Promise(resolve => { release = resolve; });
    await previous;
    return { query: (...args) => db.query(...args), release };
  } };
  service = createShelfService({ pool,
    authorize: async (who, capability, warehouse) => who?.userId === actor.userId && (!warehouse || warehouse === 'Kho A'),
    allowedWarehouses: async () => ['Kho A'],
    assertProductEpcAvailable: async (client, epc) => {
      if (epc === 'AAAABBBB') throw new ShelfError(409, 'PRODUCT_EPC', 'Đã thuộc hàng hóa');
    },
    loadProducts: async (client, skus) => new Map(skus.filter(sku => sku === 'SKU-A').map(sku => [sku, { name: 'Áo thun chuẩn' }]))
  });
});
after(async () => db.close());
beforeEach(async () => db.exec('TRUNCATE rfid_shelf_inventory_lines,rfid_shelf_inventory_sessions,rfid_shelf_operations,rfid_shelves,rfid_entity_registry CASCADE'));

test('definition retry returns the original version, duplicate EPC/code cannot create another shelf', async () => {
  const first = await service.dispatch(definition, actor);
  const retry = await service.dispatch(definition, actor);
  assert.deepEqual(first, retry); assert.equal(first.shelf.version, 1);
  await assert.rejects(service.dispatch({ ...definition, operationId: 'def-b', shelfId: 'shelf-b', code: 'KE-02' }, actor), { code: 'EPC_IN_USE' });
  await assert.rejects(service.dispatch({ ...definition, operationId: 'def-c', shelfId: 'shelf-c', epc: 'E2000002', code: 'ke-01' }, actor), { code: 'SHELF_CONFLICT' });
  const registry = await db.query('SELECT * FROM rfid_entity_registry');
  assert.equal(registry.rows.length, 1, 'failed definition rolls back the EPC claim');
});

test('renaming keeps shelf identity; stale version and idempotency payload changes are rejected', async () => {
  await service.dispatch(definition, actor);
  const rename = { ...definition, name: 'Kệ mới', version: 1, operationId: 'rename-1' };
  const renamed = await service.dispatch(rename, actor);
  assert.equal(renamed.shelf.shelfId, definition.shelfId); assert.equal(renamed.shelf.version, 2);
  await assert.rejects(service.dispatch({ ...rename, name: 'Tên khác' }, actor), { code: 'IDEMPOTENCY_CONFLICT' });
  await assert.rejects(service.dispatch({ ...rename, operationId: 'rename-2' }, actor), { code: 'VERSION_CONFLICT' });
});

test('product and shelf EPC claims exclude each other in both directions', async () => {
  await assert.rejects(service.dispatch({ ...definition, epc: 'AAAABBBB' }, actor), { code: 'PRODUCT_EPC' });
  await service.dispatch(definition, actor);
  await assert.rejects(claimProductEpcs(db, [definition.epc], 'SKU-A'), { code: 'EPC_IN_USE' });
  await claimProductEpcs(db, ['FFFF0001'], 'SKU-A');
  await assert.rejects(service.dispatch({ ...definition, shelfId: 'shelf-b', operationId: 'def-b', epc: 'FFFF0001' }, actor), { code: 'EPC_IN_USE' });
});

test('submission writes floor rows once, retains the baseline and shelf name snapshot', async () => {
  await service.dispatch(definition, actor);
  const body = result(); body.lines[0].quantity = 4;
  const first = await service.dispatch(body, actor);
  assert.equal(first.status, 'SUBMITTED'); assert.equal(first.duplicate, false);
  const retry = await service.dispatch(body, actor); assert.equal(retry.duplicate, true);
  const rows = await db.query('SELECT * FROM rfid_shelf_inventory_lines ORDER BY floor DESC');
  assert.equal(rows.rows.length, 2); assert.equal(rows.rows[0].quantity, 4);
  const stored = (await db.query('SELECT * FROM rfid_shelf_inventory_sessions')).rows[0];
  assert.equal(stored.scanned_quantity, 12); assert.equal(stored.final_quantity, 9);
  assert.equal(stored.payload.lines[0].name, 'Áo thun chuẩn');
  assert.equal(stored.payload.operatorName, actor.displayName);
  assert.equal('rfids' in stored.payload, false);
  await service.dispatch({ ...definition, name: 'Tên sau kiểm kê', operationId: 'rename', version: 1 }, actor);
  const detail = await service.dispatch({ action: 'warehouseShelfInventoryGet', sessionId: body.sessionId }, actor);
  assert.equal(detail.session.shelfName, 'Kệ mùa hè');
  await assert.rejects(service.dispatch({ ...body, lines: [] }, actor), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('shelf has configurable floors and vehicle stores quantities without floors', async () => {
  const tallShelf = { ...definition, entityType: 'SHELF', floorCount: 5 };
  const defined = await service.dispatch(tallShelf, actor);
  assert.equal(defined.shelf.floorCount, 5);
  const tallResult = { ...result(), schemaVersion: 2, floorCount: 5,
    lines: [{ floor: 5, sku: 'SKU-A', name: 'Áo', quantity: 12 }] };
  const submitted = await service.dispatch(tallResult, actor);
  assert.equal(submitted.status, 'SUBMITTED');
  await assert.rejects(service.dispatch({ ...tallResult, sessionId: 'bad-floor', lines: [{ ...tallResult.lines[0], floor: 6 }] }, actor), { code: 'INVALID_FLOOR' });

  const vehicle = { ...definition, shelfId: 'vehicle-a', operationId: 'vehicle-def', code: 'XE-01',
    name: 'Xe tải 01', epc: 'E2000002', entityType: 'VEHICLE', floorCount: 0 };
  const vehicleDefined = await service.dispatch(vehicle, actor);
  assert.equal(vehicleDefined.shelf.entityType, 'VEHICLE');
  const { entityType: ignoredType, floorCount: ignoredFloors, ...legacyVehicle } = vehicle;
  const legacyUpdated = await service.dispatch({ ...legacyVehicle, name: 'Xe tải 01 đổi tên', operationId: 'vehicle-legacy-update', version: 1 }, actor);
  assert.equal(legacyUpdated.shelf.entityType, 'VEHICLE', `legacy update unexpectedly used ${ignoredType}/${ignoredFloors}`);
  assert.equal(legacyUpdated.shelf.floorCount, 0);
  const vehicleResult = { ...result(), schemaVersion: 2, type: 'VEHICLE', floorCount: 0,
    sessionId: 'vehicle-session', shelfId: vehicle.shelfId, shelfName: vehicle.name, shelfCode: vehicle.code,
    lines: [{ floor: 0, sku: 'SKU-A', name: 'Áo', quantity: 12 }] };
  await service.dispatch(vehicleResult, actor);
  const detail = await service.dispatch({ action: 'warehouseShelfInventoryGet', sessionId: vehicleResult.sessionId }, actor);
  assert.equal(detail.session.entityType, 'VEHICLE');
  assert.equal(detail.session.floorCount, 0);
  assert.equal(detail.session.lines[0].floor, 0);
});

test('concurrent retry produces one session and one set of lines', async () => {
  await service.dispatch(definition, actor);
  const results = await Promise.all([service.dispatch(result(), actor), service.dispatch(result(), actor)]);
  assert.equal(results.filter(item => item.duplicate).length, 1);
  assert.equal((await db.query('SELECT * FROM rfid_shelf_inventory_sessions')).rows.length, 1);
  assert.equal((await db.query('SELECT * FROM rfid_shelf_inventory_lines')).rows.length, 2);
});

test('invalid floors, duplicate rows, unknown SKUs, missing shelf and another operator fail', async () => {
  await service.dispatch(definition, actor);
  const body = result();
  await assert.rejects(service.dispatch({ ...body, lines: [{ ...body.lines[0], floor: 4 }] }, actor), { code: 'INVALID_FLOOR' });
  await assert.rejects(service.dispatch({ ...body, lines: [body.lines[0], body.lines[0]] }, actor), { code: 'DUPLICATE_LINE' });
  await assert.rejects(service.dispatch({ ...body, operatorId: 'other-user' }, actor), { code: 'WRONG_OPERATOR' });
  await assert.rejects(service.dispatch({ ...body, shelfId: 'missing' }, actor), { code: 'SHELF_NOT_FOUND' });
  await assert.rejects(service.dispatch({ ...body, lines: [], scanned: [{ sku: 'UNKNOWN', name: 'X', quantity: 1 }] }, actor), { code: 'UNKNOWN_SKU' });
  assert.equal((await db.query('SELECT * FROM rfid_shelf_inventory_sessions')).rows.length, 0);
  assert.throws(() => submission({ ...body, rfids: ['E2000001'] }), { code: 'RAW_RFID_NOT_ACCEPTED' });
});

test('empty shelf submits and appears in operations listing', async () => {
  await service.dispatch(definition, actor);
  await service.dispatch({ ...result(), lines: [], scanned: [] }, actor);
  const page = await service.dispatch({ action: 'warehouseShelfInventoryList', limit: 1 }, actor);
  assert.equal(page.sessions[0].final_quantity, 0); assert.equal(page.hasMore, false);
});

test('all actions require authenticated user and warehouse authorization', async () => {
  await assert.rejects(service.dispatch({ action: 'warehouseListShelves' }, null), { status: 401 });
  await assert.rejects(service.dispatch({ action: 'warehouseListShelves' }, { userId: 'other' }), { status: 403 });
  await assert.rejects(service.dispatch({ ...definition, warehouse: 'Kho B' }, actor), { status: 403 });
});

test('OpenAPI extension preserves old actions and advertises the new contract once', () => {
  const original = { paths: { '/api/warehouse/rfid': { post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Original' } } } } } } } };
  const once = extendShelfOpenApi(original); const twice = extendShelfOpenApi(once);
  const choices = twice.paths['/api/warehouse/rfid'].post.requestBody.content['application/json'].schema.oneOf;
  assert.equal(choices.length, 7); assert.equal(choices[0].$ref, '#/components/schemas/Original');
  assert.equal(once.components.schemas.ShelfInventorySubmitRequest.properties.action.const, 'warehouseShelfInventorySubmit');
  assert.deepEqual(once.components.schemas.ShelfDefinitionRequest.properties.entityType.enum, ['SHELF', 'VEHICLE']);
  assert.equal(once.components.schemas.ShelfDefinitionRequest.properties.floorCount.maximum, 20);
  assert.equal(once.components.schemas.ShelfDefinition.properties.skuFloors.type, 'object');
  assert.equal(once.components.schemas.ShelfSkuConfigurationRequest.properties.action.const, 'warehouseConfigureShelfSkus');
  assert.equal(once.components.schemas.ShelfInventorySubmitRequest.properties.schemaVersion.const, 2);
  assert(once.components.schemas.ShelfInventorySubmitRequest.required.includes('floorCount'));
  assert.equal(original.components, undefined);
});
