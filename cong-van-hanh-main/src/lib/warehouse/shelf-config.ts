import "server-only";

import type { AppSession } from "@/lib/auth/session";

import { getShelfPool, getWarehouseShelfDefinitions } from "./shelves";
import {
  MAX_SHELF_SKU_GROUPS,
  normalizeShelfSkuGroups,
  normalizeShelfSkuFloors,
  shelfSkuFamily,
} from "./shelf-sku";
import type {
  ShelfSkuConfigActionResult,
  ShelfSkuConfigWorkspace,
  ShelfSkuGroupCandidate,
  ShelfSkuProductExample,
} from "./shelf-config-types";
import { rankWarehouseSkuSearch } from "./sku-search-ranking";
import { representativeSkuProductName } from "./sku-product-name";

function text(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export function assertShelfSkuConfigAccess(session: AppSession) {
  if (
    !session.fullAccess &&
    !session.modules.includes("warehouse-shelf-config") &&
    !session.moduleGroups.includes("warehouse")
  ) {
    throw new Error("Tài khoản chưa được cấp quyền mở Cấu hình kệ.");
  }
}

export async function getShelfSkuConfigWorkspace(
  session: AppSession,
): Promise<ShelfSkuConfigWorkspace> {
  assertShelfSkuConfigAccess(session);
  const shelves = await getWarehouseShelfDefinitions(session);
  const groups = [...new Set(shelves.flatMap((shelf) => shelf.skuGroups))];
  const skuGroupNames: Record<string, string> = {};
  if (groups.length) {
    const products = await getShelfPool().query<{ name: string; sku: string }>(
      `SELECT name,sku FROM "WarehouseProduct"
       WHERE upper(status) NOT IN ('INACTIVE','ARCHIVED')
         AND substring(upper(trim(sku)) from '^[A-Z]+')=ANY($1::text[])
       ORDER BY sku ASC`,
      [groups],
    );
    const namesByGroup = new Map<string, string[]>();
    for (const product of products.rows) {
      const group = shelfSkuFamily(product.sku);
      if (!group) continue;
      const names = namesByGroup.get(group) ?? [];
      names.push(product.name);
      namesByGroup.set(group, names);
    }
    for (const group of groups) {
      skuGroupNames[group] = representativeSkuProductName(
        namesByGroup.get(group) ?? [],
      );
    }
  }
  return { generatedAt: new Date().toISOString(), shelves, skuGroupNames };
}

export async function searchShelfSkuGroups(
  session: AppSession,
  rawQuery: string,
): Promise<ShelfSkuGroupCandidate[]> {
  assertShelfSkuConfigAccess(session);
  const query = text(rawQuery);
  if (!query || query.length > 100) {
    throw new Error("Nhập SKU hoặc tên hàng cần tìm.");
  }
  const pattern = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const result = await getShelfPool().query<{ name: string; sku: string }>(
    `SELECT name,sku FROM "WarehouseProduct"
     WHERE upper(status) NOT IN ('INACTIVE','ARCHIVED')
       AND (sku ILIKE $1 OR name ILIKE $1)
     ORDER BY CASE
       WHEN upper(trim(sku))=upper($2) THEN 0
       WHEN upper(trim(sku)) LIKE upper($2) || '%' THEN 1
       WHEN position(upper($2) in upper(sku)) > 0 THEN 2
       WHEN upper(trim(name)) LIKE upper($2) || '%' THEN 3
       ELSE 4
     END,
     CASE WHEN position(upper($2) in upper(sku)) > 0
       THEN position(upper($2) in upper(sku)) ELSE 2147483647 END,
     length(sku),sku ASC LIMIT 400`,
    [pattern, query],
  );
  const grouped = new Map<string, ShelfSkuProductExample[]>();
  for (const row of result.rows) {
    const group = shelfSkuFamily(row.sku);
    if (!group) continue;
    const examples = grouped.get(group) ?? [];
    examples.push({ name: row.name, sku: row.sku });
    grouped.set(group, examples);
  }
  return rankWarehouseSkuSearch(
    query,
    [...grouped.entries()].map(([group, rows]) => ({
      displayName: representativeSkuProductName(rows.map((row) => row.name)),
      examples: rows.slice(0, 4),
      group,
      name: rows[0]?.name ?? "",
      productCount: rows.length,
      sku: group,
    })),
  )
    .map(({ name: _name, sku: _sku, ...candidate }) => candidate)
    .slice(0, 40);
}

export async function updateShelfSkuConfiguration(
  session: AppSession,
  input: {
    shelfId: string;
    skuFloors: Record<string, number>;
    skuGroups: string[];
    version: number;
  },
): Promise<ShelfSkuConfigWorkspace> {
  assertShelfSkuConfigAccess(session);
  const shelfId = text(input.shelfId);
  if (!/^[A-Za-z0-9_-]{1,180}$/.test(shelfId)) {
    throw new Error("Mã nội bộ của kệ không hợp lệ.");
  }
  if (!Number.isSafeInteger(input.version) || input.version < 0) {
    throw new Error("Phiên bản cấu hình kệ không hợp lệ.");
  }
  if (!Array.isArray(input.skuGroups)) {
    throw new Error("Danh sách nhóm SKU không hợp lệ.");
  }
  const skuGroups = normalizeShelfSkuGroups(input.skuGroups);
  const pool = getShelfPool();
  if (skuGroups.length) {
    const matches = await pool.query<{ family: string }>(
      `SELECT DISTINCT substring(upper(trim(sku)) from '^[A-Z]+') AS family
       FROM "WarehouseProduct"
       WHERE upper(status) NOT IN ('INACTIVE','ARCHIVED')
         AND substring(upper(trim(sku)) from '^[A-Z]+')=ANY($1::text[])`,
      [skuGroups],
    );
    const existing = new Set(matches.rows.map((row) => row.family));
    const missing = skuGroups.filter((group) => !existing.has(group));
    if (missing.length) {
      throw new Error(
        `Không tìm thấy hàng hóa đang hoạt động thuộc nhóm ${missing.join(", ")}.`,
      );
    }
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const shelf = (
      await client.query<{
        entity_type: string;
        floor_count: number;
        name: string;
      }>(
        "SELECT entity_type,floor_count,name FROM rfid_shelves WHERE shelf_id=$1 FOR UPDATE",
        [shelfId],
      )
    ).rows[0];
    if (!shelf) throw new Error("Kệ không còn tồn tại. Hãy tải lại danh sách.");
    if (shelf.entity_type !== "SHELF") {
      throw new Error("Cấu hình nhóm SKU chỉ áp dụng cho Kệ.");
    }
    const skuFloors = normalizeShelfSkuFloors(
      skuGroups,
      input.skuFloors,
      shelf.floor_count,
    );
    const current = (
      await client.query<{
        configuration_version: number;
        sku_floors: Record<string, number>;
        sku_groups: string[];
      }>(
        "SELECT configuration_version,sku_groups,sku_floors FROM rfid_shelf_sku_configurations WHERE shelf_id=$1 FOR UPDATE",
        [shelfId],
      )
    ).rows[0];
    const currentVersion = current?.configuration_version ?? 0;
    if (currentVersion !== input.version) {
      throw new Error(
        "Cấu hình kệ vừa được người khác cập nhật. Hãy tải lại trước khi lưu.",
      );
    }
    const nextVersion = currentVersion + 1;
    await client.query(
      `INSERT INTO rfid_shelf_sku_configurations(shelf_id,sku_groups,sku_floors,configuration_version,updated_by)
       VALUES($1,$2,$3::jsonb,$4,$5)
       ON CONFLICT(shelf_id) DO UPDATE SET sku_groups=EXCLUDED.sku_groups,
         sku_floors=EXCLUDED.sku_floors,configuration_version=EXCLUDED.configuration_version,
         updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [
        shelfId,
        skuGroups,
        JSON.stringify(skuFloors),
        nextVersion,
        session.userId,
      ],
    );
    await client.query(
      `INSERT INTO rfid_shelf_sku_configuration_audit
       (shelf_id,actor_id,previous_groups,next_groups,previous_sku_floors,next_sku_floors,configuration_version)
       VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)`,
      [
        shelfId,
        session.userId,
        current?.sku_groups ?? [],
        skuGroups,
        JSON.stringify(current?.sku_floors ?? {}),
        JSON.stringify(skuFloors),
        nextVersion,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return getShelfSkuConfigWorkspace(session);
}

export { MAX_SHELF_SKU_GROUPS };
