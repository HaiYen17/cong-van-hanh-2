import "server-only";

import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { AppSession } from "@/lib/auth/session";
import { requireServerEnv } from "@/lib/env";
import type {
  WarehouseShelfDefinition,
  WarehouseShelfDefinitionCreate,
  WarehouseShelfDefinitionUpdate,
} from "./types";
import { ACTIONS, ShelfError } from "./shelf-core/domain.mjs";
import { createShelfService } from "./shelf-core/service.mjs";

export { ACTIONS as SHELF_ACTIONS, ShelfError };
export const isShelfAction = (action: string) => Object.values(ACTIONS).some(value => value === action);

const globalShelf = globalThis as unknown as { warehouseShelfPool?: Pool };
export function getShelfPool() {
  return globalShelf.warehouseShelfPool ??= new Pool({
    connectionString: requireServerEnv("DATABASE_URL"),
    max: 3, connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
    allowExitOnIdle: true, keepAlive: true,
  });
}

type Actor = Pick<AppSession, "userId" | "displayName" | "fullAccess" | "modules" | "moduleGroups">;
export function canUseShelf(actor: Actor, capability: string) {
  if (actor.fullAccess || actor.moduleGroups.includes("warehouse")) return true;
  if (capability === "shelves:write") {
    return actor.modules.some(key => ["warehouse-config", "warehouse-info", "warehouse-shelf-config"].includes(key));
  }
  if (capability === "shelves:read") {
    return actor.modules.some(key => ["warehouse-config", "warehouse-info", "warehouse-inventory", "warehouse-shelf-config"].includes(key));
  }
  return actor.modules.includes("warehouse-inventory");
}

export async function dispatchShelf(payload: unknown, actor: Actor) {
  const service = createShelfService({
    pool: getShelfPool(),
    authorize: async (who: Actor, capability: string) => canUseShelf(who, capability),
    // Existing warehouse permissions grant a module, with no warehouse-level ACL.
    allowedWarehouses: async () => null,
    assertProductEpcAvailable: async (client: PoolClient, epc: string) => {
      const result = await client.query(
        "SELECT 1 FROM rfid_entity_registry WHERE epc=$1 AND entity_type='PRODUCT'", [epc],
      );
      if (result.rowCount) throw new ShelfError(409, "EPC_IN_USE", "RFID đã được định nghĩa cho hàng hóa.");
    },
    loadProducts: async (client: PoolClient, skus: string[]) => {
      const result = await client.query<{ sku: string; name: string }>(
        'SELECT sku,name FROM "WarehouseProduct" WHERE sku=ANY($1::text[])', [skus],
      );
      return new Map(result.rows.map(row => [row.sku, { name: row.name }]));
    },
  });
  return service.dispatch(payload, actor);
}

export async function getWarehouseShelfDefinitions(actor: Actor) {
  const result = await dispatchShelf({ action: ACTIONS.list }, actor) as {
    shelves?: WarehouseShelfDefinition[];
  };
  return result.shelves ?? [];
}

export async function updateWarehouseShelfDefinition(
  actor: Actor,
  input: WarehouseShelfDefinitionUpdate,
) {
  const operationId = `warehouse-info-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const result = await dispatchShelf(
    {
      action: ACTIONS.define,
      ...input,
      operationId,
    },
    actor,
  ) as { shelf?: WarehouseShelfDefinition };
  if (!result.shelf) {
    throw new Error("Không nhận được dữ liệu Xe/Kệ sau khi cập nhật.");
  }
  return result.shelf;
}

export async function createWarehouseShelfDefinition(
  actor: Actor,
  input: WarehouseShelfDefinitionCreate,
) {
  const shelfId = `unit-${randomUUID()}`;
  const operationId = `warehouse-shelf-config-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const result = await dispatchShelf({
    action: ACTIONS.define,
    ...input,
    operationId,
    shelfId,
    version: 0,
  }, actor) as { shelf?: WarehouseShelfDefinition };
  if (!result.shelf) throw new Error("Không nhận được dữ liệu Kệ/Xe sau khi tạo.");
  return result.shelf;
}
