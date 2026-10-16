import { ACTIONS, ShelfError, check, definition, identifier, skuConfiguration, submission, total, requestHash, shelfFromRow, skuFamily } from './domain.mjs';

/** Mount behind the portal's existing authenticated session middleware. No authentication fallback. */
export function createShelfService({ pool, authorize, allowedWarehouses, assertProductEpcAvailable, loadProducts }) {
  for (const [name, dependency] of Object.entries({ authorize, allowedWarehouses, assertProductEpcAvailable, loadProducts })) {
    if (typeof dependency !== 'function') throw new Error(`Missing required portal integration: ${name}`);
  }
  if (typeof pool?.connect !== 'function') throw new Error('A PostgreSQL pool is required.');

  async function permit(actor, capability, warehouse) {
    check(typeof actor?.userId === 'string' && actor.userId.length > 0, 'UNAUTHENTICATED', 'Cần đăng nhập.', 401);
    check(await authorize(actor, capability, warehouse) === true, 'FORBIDDEN', 'Không có quyền thao tác kho này.', 403);
  }
  async function scope(actor, capability) {
    await permit(actor, capability, null);
    const warehouses = await allowedWarehouses(actor, capability);
    check(warehouses === null || (Array.isArray(warehouses) && warehouses.every(x => typeof x === 'string')),
      'INVALID_SCOPE', 'Chưa cấu hình phạm vi kho.', 403);
    return warehouses;
  }
  async function transaction(work) {
    const client = await pool.connect();
    try { await client.query('BEGIN'); const result = await work(client); await client.query('COMMIT'); return result; }
    catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') throw new ShelfError(409, 'SHELF_CONFLICT', 'Barcode hoặc mã Kệ/Xe đã được sử dụng.');
      throw error;
    } finally { client.release(); }
  }
  const lock = (client, key) => client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);

  async function define(body, actor) {
    const value = definition(body);
    await permit(actor, 'shelves:write', value.warehouse);
    const hash = requestHash(value);
    return transaction(async client => {
      await lock(client, `shelf-operation:${value.operationId}`);
      const prior = (await client.query('SELECT * FROM rfid_shelf_operations WHERE operation_id=$1', [value.operationId])).rows[0];
      if (prior) {
        check(prior.actor_id === actor.userId && prior.request_hash === hash, 'IDEMPOTENCY_CONFLICT', 'Mã thao tác đã dùng cho dữ liệu khác.', 409);
        const current = (await client.query(`SELECT shelf.*,config.sku_groups,config.sku_floors,
          COALESCE(config.configuration_version,0) AS sku_configuration_version,
          config.updated_at AS sku_configured_at
          FROM rfid_shelves shelf LEFT JOIN rfid_shelf_sku_configurations config ON config.shelf_id=shelf.shelf_id
          WHERE shelf.shelf_id=$1`, [value.shelfId])).rows[0];
        return current ? { ...prior.result, shelf: shelfFromRow(current) } : prior.result;
      }
      await lock(client, `shelf:${value.shelfId}`);
      const existing = (await client.query('SELECT * FROM rfid_shelves WHERE shelf_id=$1 FOR UPDATE', [value.shelfId])).rows[0];
      if (existing) await permit(actor, 'shelves:write', existing.warehouse);
      check((existing?.version ?? 0) === value.version, 'VERSION_CONFLICT', 'Kệ đã được cập nhật. Tải lại trước khi sửa.', 409);
      const epc = value.epc || existing?.epc || null;
      if (epc) {
        await lock(client, `rfid-epc:${epc}`);
        await assertProductEpcAvailable(client, epc);
      }
      // A legacy client omits these fields. Preserve an existing unit's configuration;
      // only brand-new legacy definitions receive the historical SHELF/3 defaults.
      const entityType = value.entityType ?? existing?.entity_type ?? 'SHELF';
      const floorCount = value.floorCount ?? existing?.floor_count ?? 3;
      if (epc) {
        const claim = await client.query(`INSERT INTO rfid_entity_registry(epc,entity_type,entity_id) VALUES($1,$2,$3)
          ON CONFLICT(epc) DO UPDATE SET entity_type=EXCLUDED.entity_type,entity_id=EXCLUDED.entity_id
          WHERE rfid_entity_registry.entity_type IN ('SHELF','VEHICLE') AND rfid_entity_registry.entity_id=EXCLUDED.entity_id RETURNING epc`, [epc, entityType, value.shelfId]);
        check(claim.rows.length === 1, 'EPC_IN_USE', 'RFID đã thuộc hàng hóa hoặc Kệ/Xe khác.', 409);
      }
      const barcode = existing?.barcode ?? (await client.query(
        "SELECT 'TVK-' || nextval('rfid_shelf_barcode_seq')::text AS barcode"
      )).rows[0].barcode;
      const row = (await client.query(`INSERT INTO rfid_shelves(shelf_id,code,name,warehouse,epc,barcode,version,operation_id,created_by,entity_type,floor_count)
        VALUES($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10) ON CONFLICT(shelf_id) DO UPDATE SET
        code=EXCLUDED.code,name=EXCLUDED.name,warehouse=EXCLUDED.warehouse,epc=EXCLUDED.epc,
        entity_type=EXCLUDED.entity_type,floor_count=EXCLUDED.floor_count,
        version=rfid_shelves.version+1,operation_id=EXCLUDED.operation_id,updated_at=now() RETURNING *`,
      [value.shelfId, value.code, value.name, value.warehouse, epc, barcode, value.operationId, actor.userId, entityType, floorCount])).rows[0];
      if (existing?.epc && existing.epc !== epc) await client.query(
        "DELETE FROM rfid_entity_registry WHERE epc=$1 AND entity_type IN ('SHELF','VEHICLE') AND entity_id=$2", [existing.epc, value.shelfId]);
      // Vehicle contents change from day to day. Remove any shelf-only SKU
      // filter left behind when a unit is converted from SHELF to VEHICLE.
      if (entityType === 'VEHICLE') await client.query(
        'DELETE FROM rfid_shelf_sku_configurations WHERE shelf_id=$1', [value.shelfId]);
      const enriched = (await client.query(`SELECT shelf.*,config.sku_groups,config.sku_floors,
        COALESCE(config.configuration_version,0) AS sku_configuration_version,
        config.updated_at AS sku_configured_at
        FROM rfid_shelves shelf LEFT JOIN rfid_shelf_sku_configurations config ON config.shelf_id=shelf.shelf_id
        WHERE shelf.shelf_id=$1`, [value.shelfId])).rows[0] ?? row;
      const result = { ok: true, action: ACTIONS.define, shelf: shelfFromRow(enriched) };
      await client.query('INSERT INTO rfid_shelf_operations(operation_id,actor_id,request_hash,result) VALUES($1,$2,$3,$4)',
        [value.operationId, actor.userId, hash, JSON.stringify(result)]);
      return result;
    });
  }

  async function configure(body, actor) {
    const value = skuConfiguration(body);
    return transaction(async client => {
      await lock(client, `shelf:${value.shelfId}`);
      const shelf = (await client.query(
        'SELECT shelf_id,name,warehouse,entity_type,floor_count FROM rfid_shelves WHERE shelf_id=$1 FOR UPDATE',
        [value.shelfId]
      )).rows[0];
      check(shelf, 'SHELF_NOT_FOUND', 'Kệ không còn tồn tại.', 404);
      await permit(actor, 'shelf-inventory:submit', shelf.warehouse);
      check(shelf.entity_type === 'SHELF', 'SKU_CONFIG_NOT_APPLICABLE', 'Xe không có cấu hình tầng SKU.', 409);
      check(Object.values(value.skuFloors).every(floor => floor <= shelf.floor_count),
        'INVALID_SKU_FLOORS', `Tầng cấu hình phải từ 1 đến ${shelf.floor_count}.`);
      if (value.skuGroups.length) {
        const rows = (await client.query(`SELECT DISTINCT substring(upper(trim(sku)) from '^[A-Z]+') AS family
          FROM "WarehouseProduct" WHERE upper(status) NOT IN ('INACTIVE','ARCHIVED')
          AND substring(upper(trim(sku)) from '^[A-Z]+')=ANY($1::text[])`, [value.skuGroups])).rows;
        const existingGroups = new Set(rows.map(row => row.family));
        check(value.skuGroups.every(group => existingGroups.has(group)), 'UNKNOWN_SKU_GROUP',
          'Có nhóm SKU không tồn tại trong danh mục hàng hóa.', 409);
      }
      const current = (await client.query(
        'SELECT sku_groups,sku_floors,configuration_version FROM rfid_shelf_sku_configurations WHERE shelf_id=$1 FOR UPDATE',
        [value.shelfId]
      )).rows[0];
      const currentVersion = current?.configuration_version ?? 0;
      check(currentVersion === value.version, 'SHELF_SKU_CONFIG_CHANGED',
        'Cấu hình SKU của kệ vừa thay đổi. Hãy đồng bộ lại trước khi lưu.', 409);
      const nextVersion = currentVersion + 1;
      await client.query(`INSERT INTO rfid_shelf_sku_configurations
        (shelf_id,sku_groups,sku_floors,configuration_version,updated_by)
        VALUES($1,$2,$3::jsonb,$4,$5)
        ON CONFLICT(shelf_id) DO UPDATE SET sku_groups=EXCLUDED.sku_groups,sku_floors=EXCLUDED.sku_floors,
          configuration_version=EXCLUDED.configuration_version,updated_by=EXCLUDED.updated_by,updated_at=now()`,
        [value.shelfId, value.skuGroups, JSON.stringify(value.skuFloors), nextVersion, actor.userId]);
      await client.query(`INSERT INTO rfid_shelf_sku_configuration_audit
        (shelf_id,actor_id,previous_groups,next_groups,previous_sku_floors,next_sku_floors,configuration_version)
        VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`, [value.shelfId, actor.userId,
        current?.sku_groups ?? [], value.skuGroups, JSON.stringify(current?.sku_floors ?? {}),
        JSON.stringify(value.skuFloors), nextVersion]);
      const updated = (await client.query(`SELECT shelf.*,config.sku_groups,config.sku_floors,
        config.configuration_version AS sku_configuration_version,config.updated_at AS sku_configured_at
        FROM rfid_shelves shelf JOIN rfid_shelf_sku_configurations config ON config.shelf_id=shelf.shelf_id
        WHERE shelf.shelf_id=$1`, [value.shelfId])).rows[0];
      return { ok: true, action: ACTIONS.configure, shelf: shelfFromRow(updated) };
    });
  }

  async function submit(body, actor) {
    const value = submission(body);
    await permit(actor, 'shelf-inventory:submit', value.warehouse);
    check(actor.userId === value.operatorId, 'WRONG_OPERATOR', 'Hãy đăng nhập bằng người đã tạo phiên kiểm kê.', 403);
    const hash = requestHash(value);
    return transaction(async client => {
      await lock(client, `shelf-inventory:${value.sessionId}`);
      const existing = (await client.query('SELECT actor_id,request_hash FROM rfid_shelf_inventory_sessions WHERE session_id=$1', [value.sessionId])).rows[0];
      if (existing) {
        check(existing.actor_id === actor.userId && existing.request_hash === hash, 'IDEMPOTENCY_CONFLICT', 'Mã phiên đã dùng cho kết quả khác.', 409);
        return { ok: true, sessionId: value.sessionId, status: 'SUBMITTED', duplicate: true };
      }
      const shelf = (await client.query('SELECT * FROM rfid_shelves WHERE shelf_id=$1 FOR SHARE', [value.shelfId])).rows[0];
      check(shelf, 'SHELF_NOT_FOUND', 'Kệ chưa được định nghĩa.', 404);
      await permit(actor, 'shelf-inventory:submit', shelf.warehouse);
      check(shelf.warehouse === value.warehouse, 'WAREHOUSE_MISMATCH', 'Kệ không thuộc kho của phiên kiểm kê.', 409);
      const skus = value.scanned.map(row => row.sku);
      const products = await loadProducts(client, skus);
      check(products instanceof Map && skus.every(sku => products.has(sku)), 'UNKNOWN_SKU', 'Có SKU không tồn tại trong danh mục.', 409);
      const entityType = shelf.entity_type ?? 'SHELF';
      const floorCount = shelf.floor_count ?? 3;
      check(value.type === entityType && (value.floorCount ?? 3) === floorCount,
        'UNIT_VERSION_MISMATCH', 'Loại hoặc số tầng Kệ/Xe đã thay đổi. Đồng bộ danh mục và tạo phiên mới.', 409);
      const skuConfiguration = entityType === 'SHELF' ? (await client.query(
        'SELECT sku_groups,sku_floors,configuration_version FROM rfid_shelf_sku_configurations WHERE shelf_id=$1 FOR SHARE',
        [value.shelfId]
      )).rows[0] : null;
      if (entityType === 'SHELF') {
        check(skuConfiguration && Array.isArray(skuConfiguration.sku_groups) && skuConfiguration.sku_groups.length > 0,
          'SHELF_SKU_CONFIG_REQUIRED', 'Kệ chưa được cấu hình nhóm SKU trên Cổng vận hành.', 409);
        if (value.skuConfigurationVersion !== null) check(
          value.skuConfigurationVersion === skuConfiguration.configuration_version,
          'SHELF_SKU_CONFIG_CHANGED', 'Cấu hình SKU của kệ đã thay đổi. Đồng bộ danh mục và tạo phiên mới.', 409);
        const allowed = new Set(skuConfiguration.sku_groups);
        check(value.scanned.every(row => allowed.has(skuFamily(row.sku))),
          'SKU_OUT_OF_SHELF_CONFIG', 'Kết quả còn SKU không thuộc cấu hình của kệ.', 409);
      }
      const configurationVersion = skuConfiguration?.configuration_version ?? 0;
      const payload = { ...value, entityType, floorCount, configurationVersion,
        skuGroups: skuConfiguration?.sku_groups ?? [], skuFloors: skuConfiguration?.sku_floors ?? {},
        operatorName: actor.displayName || actor.userId, shelfName: shelf.name,
        shelfCode: shelf.code, lines: value.lines.map(row => ({ ...row, name: products.get(row.sku).name || row.name })) };
      await client.query(`INSERT INTO rfid_shelf_inventory_sessions
        (session_id,shelf_id,warehouse,actor_id,operator_name,request_hash,payload,scanned_quantity,final_quantity,sku_count,created_at,entity_type,floor_count,configuration_version)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [value.sessionId, value.shelfId, shelf.warehouse, actor.userId, payload.operatorName, hash, JSON.stringify(payload),
        total(value.scanned), total(value.lines), new Set(value.lines.map(row => row.sku)).size, value.createdAt, entityType, floorCount, configurationVersion]);
      if (payload.lines.length) await client.query(`INSERT INTO rfid_shelf_inventory_lines(session_id,floor,sku,name,quantity)
        SELECT $1,x.floor,x.sku,x.name,x.quantity FROM jsonb_to_recordset($2::jsonb)
        AS x(floor smallint,sku text,name text,quantity integer)`, [value.sessionId, JSON.stringify(payload.lines)]);
      return { ok: true, action: ACTIONS.submit, sessionId: value.sessionId, status: 'SUBMITTED', duplicate: false };
    });
  }

  async function dispatch(body, actor) {
    switch (body?.action) {
      case ACTIONS.define: return define(body, actor);
      case ACTIONS.configure: return configure(body, actor);
      case ACTIONS.submit: return submit(body, actor);
      case ACTIONS.list: {
        const warehouses = await scope(actor, 'shelves:read');
        const rows = (await pool.query(`SELECT shelf.*,config.sku_groups,config.sku_floors,
          COALESCE(config.configuration_version,0) AS sku_configuration_version,
          config.updated_at AS sku_configured_at
          FROM rfid_shelves shelf LEFT JOIN rfid_shelf_sku_configurations config ON config.shelf_id=shelf.shelf_id
          WHERE ($1::text[] IS NULL OR shelf.warehouse=ANY($1::text[])) ORDER BY shelf.warehouse,shelf.code`, [warehouses])).rows;
        return { ok: true, action: ACTIONS.list, shelves: rows.map(shelfFromRow) };
      }
      case ACTIONS.sessions: {
        const warehouses = await scope(actor, 'shelf-inventory:read');
        const limit = Number.isInteger(body.limit) ? Math.max(1, Math.min(body.limit, 100)) : 30;
        const offset = Number.isInteger(body.offset) ? Math.max(0, Math.min(body.offset, 1000000)) : 0;
        const rows = (await pool.query(`SELECT session_id,shelf_id,warehouse,operator_name,received_at,
          scanned_quantity,final_quantity,sku_count,entity_type,floor_count,payload->>'shelfName' AS shelf_name,payload->>'shelfCode' AS shelf_code
          FROM rfid_shelf_inventory_sessions WHERE ($1::text[] IS NULL OR warehouse=ANY($1::text[]))
          ORDER BY received_at DESC,session_id DESC LIMIT $2 OFFSET $3`, [warehouses, limit + 1, offset])).rows;
        return { ok: true, action: ACTIONS.sessions, sessions: rows.slice(0, limit), hasMore: rows.length > limit, nextOffset: offset + limit };
      }
      case ACTIONS.detail: {
        await permit(actor, 'shelf-inventory:read', null);
        const id = identifier(body.sessionId, 'sessionId');
        const row = (await pool.query('SELECT payload,warehouse,received_at,entity_type,floor_count FROM rfid_shelf_inventory_sessions WHERE session_id=$1', [id])).rows[0];
        check(row, 'SESSION_NOT_FOUND', 'Không tìm thấy phiên kệ.', 404);
        await permit(actor, 'shelf-inventory:read', row.warehouse);
        return { ok: true, session: { ...row.payload, entityType: row.entity_type, floorCount: row.floor_count }, receivedAt: row.received_at, status: 'SUBMITTED' };
      }
      default: throw new ShelfError(400, 'UNKNOWN_ACTION', 'Tác vụ kệ không hợp lệ.');
    }
  }
  return { dispatch };
}

/** Call INSIDE the existing product-definition transaction; also use for the legacy EPC backfill. */
export async function claimProductEpcs(client, epcs, sku) {
  const normalized = [...new Set(epcs.map(epc => epc.trim().toUpperCase()))].sort();
  if (!normalized.length) return;
  const result = await client.query(`INSERT INTO rfid_entity_registry(epc,entity_type,entity_id)
    SELECT epc,'PRODUCT',$2 FROM unnest($1::text[]) AS epc
    ON CONFLICT(epc) DO UPDATE SET entity_id=rfid_entity_registry.entity_id
    WHERE rfid_entity_registry.entity_type='PRODUCT' AND rfid_entity_registry.entity_id=EXCLUDED.entity_id RETURNING epc`, [normalized, sku]);
  check(result.rows.length === normalized.length, 'EPC_IN_USE', 'RFID đã thuộc kệ hoặc SKU khác.', 409);
}
