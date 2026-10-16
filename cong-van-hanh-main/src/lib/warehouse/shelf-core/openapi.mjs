import { ACTIONS } from './domain.mjs';

const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const id = { ...string(180), pattern: '^[A-Za-z0-9_-]+$' };
const quantity = { type: 'integer', minimum: 1, maximum: 1000000 };
const timestamp = { type: 'string', format: 'date-time' };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required });
const action = value => ({ type: 'string', const: value });
const row = object({ sku: string(160), name: string(300), quantity });
const floorRow = object({ ...row.properties, floor: { type: 'integer', minimum: 0, maximum: 20 } });
const entityType = { type: 'string', enum: ['SHELF', 'VEHICLE'] };
const skuGroups = { type: 'array', maxItems: 6, uniqueItems: true, items: { type: 'string', pattern: '^[A-Z]+$', maxLength: 40 } };
const skuFloors = { type: 'object', additionalProperties: { type: 'integer', minimum: 1, maximum: 20 } };
const shelfProperties = {
  shelfId: id, operationId: id, code: string(80), name: string(160), warehouse: string(120),
  barcode: string(80),
  entityType, floorCount: { type: 'integer', minimum: 0, maximum: 20 },
  epc: { type: 'string', pattern: '^(?:(?:[0-9A-F]{2}){4,64})?$' },
  version: { type: 'integer', minimum: 0, maximum: 2147483646 }, updatedAt: timestamp,
  skuGroups, skuFloors, skuConfigurationVersion: { type: 'integer', minimum: 0, maximum: 2147483646 },
  skuConfiguredAt: { anyOf: [timestamp, { type: 'null' }] }
};
export const shelfSchemas = {
  ShelfDefinitionRequest: object({ action: action(ACTIONS.define), ...shelfProperties },
    ['action', 'shelfId', 'operationId', 'code', 'name', 'warehouse', 'entityType', 'floorCount', 'version']),
  ShelfDefinition: object({ ...shelfProperties, synced: { type: 'boolean' } }),
  ShelfListRequest: object({ action: action(ACTIONS.list) }),
  ShelfSkuConfigurationRequest: object({ action: action(ACTIONS.configure), shelfId: id,
    version: { type: 'integer', minimum: 0, maximum: 2147483646 }, skuGroups, skuFloors }),
  ShelfInventorySubmitRequest: object({
    action: action(ACTIONS.submit), schemaVersion: { type: 'integer', const: 2 }, type: entityType,
    sessionId: id, operatorId: string(180), operatorName: string(300), shelfId: id,
    shelfName: string(160), shelfCode: string(80), warehouse: string(120), floorCount: { type: 'integer', minimum: 0, maximum: 20 },
    createdAt: timestamp, submittedAt: timestamp, deviceName: string(160), source: string(80),
    scanned: { type: 'array', maxItems: 10000, items: row },
    lines: { type: 'array', maxItems: 30000, items: floorRow },
    excludedReadCount: { type: 'integer', minimum: 0, maximum: 10000000 },
    excludedOutOfScopeCount: { type: 'integer', minimum: 0, maximum: 10000000 },
    skuConfigurationVersion: { type: 'integer', minimum: 0, maximum: 2147483646 },
    reviewedSkus: { type: 'array', maxItems: 10000, uniqueItems: true, items: string(160) }
  }, ['action', 'schemaVersion', 'type', 'sessionId', 'operatorId', 'shelfId', 'shelfName', 'shelfCode',
    'warehouse', 'floorCount', 'createdAt', 'submittedAt', 'deviceName', 'scanned', 'lines']),
  ShelfInventoryListRequest: object({ action: action(ACTIONS.sessions),
    limit: { type: 'integer', minimum: 1, maximum: 100 }, offset: { type: 'integer', minimum: 0, maximum: 1000000 }
  }, ['action']),
  ShelfInventoryGetRequest: object({ action: action(ACTIONS.detail), sessionId: id }),
  ShelfInventorySubmitResponse: object({ ok: { type: 'boolean', const: true }, sessionId: id,
    status: action('SUBMITTED'), duplicate: { type: 'boolean' } })
};

/** Extend the LIVE OpenAPI document only after handlers and migrations are installed. */
export function extendShelfOpenApi(document) {
  const next = structuredClone(document);
  next.components ??= {};
  next.components.schemas ??= {};
  Object.assign(next.components.schemas, shelfSchemas);
  next.paths ??= {};
  const route = next.paths['/api/warehouse/rfid'] ??= {};
  const post = route.post ??= { responses: { 200: { description: 'Kết quả tác vụ kho' } } };
  post.requestBody ??= { required: true, content: {} };
  post.requestBody.content ??= {};
  const content = post.requestBody.content['application/json'] ??= {};
  const original = content.schema;
  const refs = Object.keys(shelfSchemas).filter(name => name.endsWith('Request')).map(name => ({ $ref: '#/components/schemas/' + name }));
  const choices = original?.oneOf ? [...original.oneOf] : original ? [original] : [];
  for (const ref of refs) if (!choices.some(item => item.$ref === ref.$ref)) choices.push(ref);
  content.schema = { oneOf: choices };
  return next;
}
