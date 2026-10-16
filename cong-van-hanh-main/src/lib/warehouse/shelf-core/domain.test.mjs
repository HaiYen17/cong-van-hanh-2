import assert from 'node:assert/strict';
import test from 'node:test';

import { shelfFromRow } from './domain.mjs';

const baseRow = {
  shelf_id: 'unit-1',
  code: 'XE-01',
  name: 'Xe 01',
  warehouse: 'Kho A',
  barcode: 'TVK-10001',
  epc: null,
  operation_id: 'operation-1',
  updated_at: '2026-09-15T01:00:00.000Z',
  version: 2,
};

test('vehicle never exposes a stale shelf SKU configuration', () => {
  const vehicle = shelfFromRow({
    ...baseRow,
    entity_type: 'VEHICLE',
    floor_count: 0,
    sku_groups: ['CSTN', 'LTA'],
    sku_floors: { CSTN: 3, LTA: 2 },
    sku_configuration_version: 8,
    sku_configured_at: '2026-09-14T01:00:00.000Z',
  });

  assert.equal(vehicle.entityType, 'VEHICLE');
  assert.equal(vehicle.floorCount, 0);
  assert.deepEqual(vehicle.skuGroups, []);
  assert.deepEqual(vehicle.skuFloors, {});
  assert.equal(vehicle.skuConfigurationVersion, 0);
  assert.equal(vehicle.skuConfiguredAt, null);
});

test('shelf keeps its configured SKU groups and floors', () => {
  const shelf = shelfFromRow({
    ...baseRow,
    entity_type: 'SHELF',
    floor_count: 3,
    sku_groups: ['CSTN'],
    sku_floors: { CSTN: 2 },
    sku_configuration_version: 4,
    sku_configured_at: '2026-09-14T01:00:00.000Z',
  });

  assert.deepEqual(shelf.skuGroups, ['CSTN']);
  assert.deepEqual(shelf.skuFloors, { CSTN: 2 });
  assert.equal(shelf.skuConfigurationVersion, 4);
});
