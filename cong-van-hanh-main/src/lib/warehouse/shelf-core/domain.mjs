import { createHash } from 'node:crypto';

export const ACTIONS = Object.freeze({
  list: 'warehouseListShelves', define: 'warehouseDefineShelf',
  configure: 'warehouseConfigureShelfSkus',
  submit: 'warehouseShelfInventorySubmit', sessions: 'warehouseShelfInventoryList',
  detail: 'warehouseShelfInventoryGet'
});

export class ShelfError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function check(condition, code, message, status = 400) {
  if (!condition) throw new ShelfError(status, code, message);
}
const text = (value, field, max = 180) => {
  check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max,
    'INVALID_FIELD', `${field} không hợp lệ.`);
  return value.trim();
};
export const identifier = (value, field) => {
  const id = text(value, field);
  check(/^[A-Za-z0-9_-]+$/.test(id), 'INVALID_ID', `${field} không hợp lệ.`);
  return id;
};
const integer = (value, field, min, max) => {
  check(Number.isSafeInteger(value) && value >= min && value <= max, 'INVALID_QUANTITY', `${field} không hợp lệ.`);
  return value;
};
const timestamp = (value, field) => {
  const result = text(value, field, 40);
  check(/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(result) && Number.isFinite(Date.parse(result)),
    'INVALID_TIME', `${field} phải có ngày giờ và múi giờ.`);
  return result;
};
const entityType = value => {
  const result = value ?? 'SHELF';
  check(result === 'SHELF' || result === 'VEHICLE', 'INVALID_ENTITY_TYPE', 'Loại Kệ/Xe không hợp lệ.');
  return result;
};
export function skuFamily(value) {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase().match(/^[A-Z]+/)?.[0] ?? '';
}
export function skuConfiguration(body) {
  const shelfId = identifier(body.shelfId, 'shelfId');
  const version = integer(body.version, 'Phiên bản cấu hình SKU', 0, 2147483646);
  check(Array.isArray(body.skuGroups) && body.skuGroups.length <= 6, 'INVALID_SKU_GROUPS', 'Mỗi kệ chỉ được cấu hình tối đa 6 nhóm SKU.');
  const skuGroups = body.skuGroups.map(value => {
    const group = skuFamily(value);
    check(group && typeof value === 'string' && group === value.trim().toUpperCase(),
      'INVALID_SKU_GROUPS', 'Nhóm SKU phải là phần chữ đầu mã SKU.');
    return group;
  });
  check(new Set(skuGroups).size === skuGroups.length, 'INVALID_SKU_GROUPS', 'Nhóm SKU cấu hình bị trùng.');
  check(body.skuFloors && typeof body.skuFloors === 'object' && !Array.isArray(body.skuFloors),
    'INVALID_SKU_FLOORS', 'Vị trí tầng của nhóm SKU không hợp lệ.');
  const skuFloors = {};
  for (const group of skuGroups) skuFloors[group] = integer(body.skuFloors[group], `Tầng của ${group}`, 1, 20);
  check(Object.keys(body.skuFloors).every(group => skuGroups.includes(group)),
    'INVALID_SKU_FLOORS', 'Vị trí tầng chứa nhóm SKU không còn trong cấu hình.');
  return { shelfId, skuGroups, skuFloors, version };
}
export function definition(body) {
  const epc = typeof body.epc === 'string' ? body.epc.trim().toUpperCase() : '';
  check(!epc || (/^[0-9A-F]{8,128}$/.test(epc) && epc.length % 2 === 0), 'INVALID_EPC', 'RFID Kệ/Xe cũ không hợp lệ.');
  const result = {
    shelfId: identifier(body.shelfId, 'shelfId'), operationId: identifier(body.operationId, 'operationId'),
    code: text(body.code, 'Mã Kệ/Xe', 80), name: text(body.name, 'Tên Kệ/Xe', 160),
    warehouse: text(body.warehouse, 'Khu vực kiểm kê', 120), epc,
    version: integer(body.version, 'Phiên bản', 0, 2147483646)
  };
  if ('entityType' in body || 'floorCount' in body) {
    const type = entityType(body.entityType);
    const floorCount = integer(body.floorCount, 'Số tầng', 0, 20);
    check((type === 'SHELF' && floorCount >= 1) || (type === 'VEHICLE' && floorCount === 0),
      'INVALID_FLOOR_COUNT', type === 'SHELF' ? 'Kệ phải có từ 1 đến 20 tầng.' : 'Xe không có tầng.');
    return { ...result, entityType: type, floorCount };
  }
  return result;
}

export function submission(body) {
  check((body.schemaVersion === 1 && body.type === 'SHELF') || (body.schemaVersion === 2 && ['SHELF', 'VEHICLE'].includes(body.type)), 'INVALID_SCHEMA', 'Loại phiên kiểm kê Kệ/Xe không hợp lệ.');
  check(!('rfids' in body) && !('tags' in body) && !('reads' in body), 'RAW_RFID_NOT_ACCEPTED', 'Kết quả Kệ/Xe chỉ nhận số lượng SKU.');
  check(Array.isArray(body.scanned) && body.scanned.length <= 10000, 'INVALID_SCANNED', 'Danh sách SKU đã quét không hợp lệ.');
  check(Array.isArray(body.lines) && body.lines.length <= 30000, 'INVALID_LINES', 'Danh sách tầng không hợp lệ.');
  const readRow = row => ({ sku: text(row.sku, 'SKU', 160), name: text(row.name, 'Tên hàng', 300),
    quantity: integer(row.quantity, 'Số lượng', 1, 1000000) });
  const compareSku = (a, b) => a.sku < b.sku ? -1 : a.sku > b.sku ? 1 : 0;
  const scanned = body.scanned.map(readRow).sort(compareSku);
  const skus = new Set(scanned.map(row => row.sku));
  check(skus.size === scanned.length, 'DUPLICATE_SKU', 'SKU quét ban đầu bị trùng.');
  const reviewedSkus = body.reviewedSkus === undefined ? [] : body.reviewedSkus;
  check(Array.isArray(reviewedSkus) && reviewedSkus.length <= 10000, 'INVALID_REVIEWED_SKUS', 'Danh sách SKU đã kiểm tra không hợp lệ.');
  const reviewed = reviewedSkus.map(sku => text(sku, 'SKU đã kiểm tra', 160));
  check(new Set(reviewed).size === reviewed.length && reviewed.every(sku => skus.has(sku)),
    'INVALID_REVIEWED_SKUS', 'SKU đã kiểm tra phải thuộc kết quả quét của kệ.');
  const type = entityType(body.type);
  const floorCount = body.schemaVersion === 1 ? 3 : integer(body.floorCount, 'Số tầng', 0, 20);
  check((type === 'SHELF' && floorCount >= 1) || (type === 'VEHICLE' && floorCount === 0),
    'INVALID_FLOOR_COUNT', type === 'SHELF' ? 'Kệ phải có từ 1 đến 20 tầng.' : 'Xe không có tầng.');
  const keys = new Set();
  const lines = body.lines.map(row => {
    const item = { ...readRow(row), floor: integer(row.floor, 'Tầng', 0, 20) };
    check(type === 'VEHICLE' ? item.floor === 0 : item.floor >= 1 && item.floor <= floorCount,
      'INVALID_FLOOR', type === 'VEHICLE' ? 'Xe không có tầng.' : `Tầng phải từ 1 đến ${floorCount}.`);
    check(skus.has(item.sku), 'SKU_NOT_SCANNED', 'SKU trong tầng chưa có trong dữ liệu quét ban đầu.');
    const key = JSON.stringify([item.floor, item.sku]);
    check(!keys.has(key), 'DUPLICATE_LINE', 'Trùng SKU trong cùng một tầng.'); keys.add(key);
    return item;
  }).sort((a, b) => b.floor - a.floor || compareSku(a, b));
  check(total(lines) <= 100000000 && total(scanned) <= 100000000, 'TOTAL_TOO_LARGE', 'Tổng số lượng vượt giới hạn.');
  const result = {
    schemaVersion: body.schemaVersion, type, sessionId: identifier(body.sessionId, 'sessionId'),
    operatorId: text(body.operatorId, 'Người kiểm kê'), shelfId: identifier(body.shelfId, 'shelfId'),
    shelfName: text(body.shelfName, 'Tên Kệ/Xe', 160), shelfCode: text(body.shelfCode, 'Mã Kệ/Xe', 80),
    warehouse: text(body.warehouse, 'Khu vực kiểm kê', 120),
    createdAt: timestamp(body.createdAt, 'createdAt'), submittedAt: timestamp(body.submittedAt, 'submittedAt'),
    deviceName: text(body.deviceName, 'Thiết bị', 160), scanned, lines,
    excludedReadCount: integer(body.excludedReadCount ?? 0, 'RFID đã loại', 0, 10000000),
    excludedOutOfScopeCount: integer(body.excludedOutOfScopeCount ?? 0, 'Hàng ngoài cấu hình', 0, 10000000),
    skuConfigurationVersion: body.skuConfigurationVersion === undefined
      ? null : integer(body.skuConfigurationVersion, 'Phiên bản cấu hình SKU', 0, 2147483646),
    reviewedSkus: reviewed.sort()
  };
  return body.schemaVersion === 2 ? { ...result, floorCount } : result;
}
export const total = rows => rows.reduce((sum, row) => sum + row.quantity, 0);
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const requestHash = value => createHash('sha256').update(canonical(value)).digest('hex');

export function shelfFromRow(row) {
  const type = row.entity_type ?? 'SHELF';
  // SKU configuration belongs to fixed shelves only. A unit converted from a
  // shelf to a vehicle may still have an old configuration row while older
  // deployments are rolling forward, so never expose that stale filter to a
  // scanner.
  const groups = type === 'SHELF' && Array.isArray(row.sku_groups) ? row.sku_groups : [];
  const configuredFloors = row.sku_floors && typeof row.sku_floors === 'object' && !Array.isArray(row.sku_floors)
    ? row.sku_floors : {};
  const defaultFloor = type === 'VEHICLE' ? 0 : (row.floor_count ?? 3);
  const skuFloors = Object.fromEntries(groups.map(group => [group,
    Number.isSafeInteger(configuredFloors[group]) ? configuredFloors[group] : defaultFloor]));
  return { shelfId: row.shelf_id, code: row.code, name: row.name, warehouse: row.warehouse,
    barcode: row.barcode,
    entityType: type, floorCount: type === 'VEHICLE' ? 0 : (row.floor_count ?? 3),
    skuGroups: groups, skuFloors,
    skuConfigurationVersion: type === 'SHELF' ? (row.sku_configuration_version ?? 0) : 0,
    skuConfiguredAt: type === 'SHELF' && row.sku_configured_at ? new Date(row.sku_configured_at).toISOString() : null,
    epc: row.epc ?? '', operationId: row.operation_id, updatedAt: new Date(row.updated_at).toISOString(),
    version: row.version, synced: true };
}
