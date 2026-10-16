"use server";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  getShelfSkuConfigWorkspace,
  searchShelfSkuGroups,
  updateShelfSkuConfiguration,
} from "@/lib/warehouse/shelf-config";
import type { ShelfSkuConfigActionResult } from "@/lib/warehouse/shelf-config-types";
import type { WarehouseShelfDefinitionActionResult, WarehouseShelfEntityType } from "@/lib/warehouse/types";
import { createWarehouseShelfDefinition, getWarehouseShelfDefinitions, updateWarehouseShelfDefinition } from "@/lib/warehouse/shelves";

function message(error: unknown) {
  return error instanceof Error ? error.message : "Không xử lý được cấu hình kệ.";
}

export async function refreshShelfSkuConfigAction(): Promise<ShelfSkuConfigActionResult> {
  try {
    const data = await getShelfSkuConfigWorkspace(await requireCurrentSession());
    return { data, message: `Đã tải ${data.shelves.length} kệ.`, ok: true };
  } catch (error) {
    return { message: message(error), ok: false };
  }
}

export async function searchShelfSkuGroupsAction(
  query: string,
): Promise<ShelfSkuConfigActionResult> {
  try {
    const candidates = await searchShelfSkuGroups(
      await requireCurrentSession(),
      query,
    );
    return {
      candidates,
      message: candidates.length
        ? `Tìm thấy ${candidates.length} nhóm SKU.`
        : "Không tìm thấy nhóm SKU phù hợp.",
      ok: true,
    };
  } catch (error) {
    return { message: message(error), ok: false };
  }
}

export async function updateShelfSkuConfigAction(input: {
  shelfId: string;
  skuFloors: Record<string, number>;
  skuGroups: string[];
  version: number;
}): Promise<ShelfSkuConfigActionResult> {
  try {
    const data = await updateShelfSkuConfiguration(
      await requireCurrentSession(),
      input,
    );
    return { data, message: "Đã lưu cấu hình nhóm SKU của kệ.", ok: true };
  } catch (error) {
    return { message: message(error), ok: false };
  }
}

export async function saveWarehouseStorageUnitAction(input: {
  code: string;
  entityType: WarehouseShelfEntityType;
  floorCount: number;
  name: string;
  shelfId?: string;
  version?: number;
  warehouse: string;
}): Promise<WarehouseShelfDefinitionActionResult> {
  try {
    const session = await requireCurrentSession();
    const payload = {
      code: input.code,
      entityType: input.entityType,
      floorCount: input.entityType === "VEHICLE" ? 0 : input.floorCount,
      name: input.name,
      warehouse: input.warehouse,
    };
    const existing = input.shelfId
      ? (await getWarehouseShelfDefinitions(session)).find((item) => item.shelfId === input.shelfId)
      : undefined;
    if (input.shelfId && !existing) throw new Error("Kệ/Xe không còn tồn tại. Hãy tải lại danh mục.");
    if (existing?.entityType === "SHELF" && input.entityType === "SHELF") {
      const highestConfiguredFloor = Math.max(0, ...Object.values(existing.skuFloors));
      if (input.floorCount < highestConfiguredFloor) {
        throw new Error(`Hãy chuyển các nhóm SKU khỏi tầng ${highestConfiguredFloor} trước khi giảm số tầng của Kệ.`);
      }
    }
    const shelf = input.shelfId && existing
      ? await updateWarehouseShelfDefinition(session, {
          ...payload,
          epc: existing.epc,
          shelfId: input.shelfId,
          version: input.version ?? 0,
        })
      : await createWarehouseShelfDefinition(session, payload);
    return {
      message: input.shelfId
        ? `Đã cập nhật ${shelf.entityType === "VEHICLE" ? "Xe" : "Kệ"} ${shelf.name}.`
        : `Đã tạo ${shelf.entityType === "VEHICLE" ? "Xe" : "Kệ"} ${shelf.name} và sinh Barcode ${shelf.barcode}.`,
      ok: true,
      shelf,
      shelves: await getWarehouseShelfDefinitions(session),
    };
  } catch (error) {
    return { message: message(error), ok: false };
  }
}
