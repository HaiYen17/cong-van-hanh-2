"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  deleteWarehouseRfidTags,
  getWarehouseInfoWorkspace,
  reassignWarehouseInfoRfids,
  searchWarehouseInfoProducts,
} from "@/lib/warehouse/definition";
import {
  getWarehouseShelfDefinitions,
  updateWarehouseShelfDefinition,
} from "@/lib/warehouse/shelves";
import type {
  WarehouseInfoActionResult,
  WarehouseInventoryProductSearchActionResult,
  WarehouseRfidIssuanceStatus,
  WarehouseShelfDefinitionActionResult,
  WarehouseShelfDefinitionUpdate,
} from "@/lib/warehouse/types";

export async function refreshWarehouseShelfDefinitionsAction(): Promise<WarehouseShelfDefinitionActionResult> {
  try {
    const session = await requireCurrentSession();
    const shelves = await getWarehouseShelfDefinitions(session);
    return {
      message: `Đã tải ${shelves.length} định nghĩa Xe/Kệ.`,
      ok: true,
      shelves,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không tải được danh mục Xe/Kệ.",
      ok: false,
    };
  }
}

export async function updateWarehouseShelfDefinitionAction(
  input: WarehouseShelfDefinitionUpdate,
): Promise<WarehouseShelfDefinitionActionResult> {
  try {
    const session = await requireCurrentSession();
    const shelf = await updateWarehouseShelfDefinition(session, input);
    const shelves = await getWarehouseShelfDefinitions(session);
    revalidatePath("/kho-van/thong-tin");
    revalidatePath("/kho-van/kiem-ke");
    return {
      message: `Đã cập nhật ${shelf.entityType === "VEHICLE" ? "Xe" : "Kệ"} ${shelf.code} — ${shelf.name}.`,
      ok: true,
      shelf,
      shelves,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không định nghĩa lại được Xe/Kệ.",
      ok: false,
    };
  }
}

export async function searchWarehouseInfoProductsAction(
  query: string,
): Promise<WarehouseInventoryProductSearchActionResult> {
  try {
    const session = await requireCurrentSession();
    const products = await searchWarehouseInfoProducts(session, query);
    return {
      message: products.length
        ? `Tìm thấy ${products.length} sản phẩm phù hợp.`
        : "Không tìm thấy sản phẩm phù hợp.",
      ok: true,
      products,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không tìm được danh mục sản phẩm.",
      ok: false,
      products: [],
    };
  }
}

export async function reassignWarehouseInfoRfidsAction(input: {
  epcs: string[];
  query?: string;
  sku: string;
  status?: "ALL" | WarehouseRfidIssuanceStatus;
}): Promise<WarehouseInfoActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await reassignWarehouseInfoRfids(session, input);
    revalidatePath("/kho-van/thong-tin");
    revalidatePath("/kho-van/kiem-ke");
    return {
      data: await getWarehouseInfoWorkspace(session, {
        query: input.query,
        status: input.status,
      }),
      message: `Đã chuyển ${result.remappedCount} RFID sang ${result.targetSku} — ${result.targetName}${result.skippedCount ? `; bỏ qua ${result.skippedCount} mã không đổi hoặc không còn tồn tại` : ""}.`,
      ok: true,
      sessionKey: result.sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không định nghĩa lại được RFID đã chọn.",
      ok: false,
    };
  }
}

export async function refreshWarehouseInfoAction(input: {
  query?: string;
  sessionKey?: string;
  status?: "ALL" | WarehouseRfidIssuanceStatus;
}): Promise<WarehouseInfoActionResult> {
  try {
    const session = await requireCurrentSession();
    return {
      data: await getWarehouseInfoWorkspace(session, input),
      message: input.sessionKey
        ? "Đã tải chi tiết phiên Định nghĩa RFID."
        : "Đã tải lại sổ đăng ký RFID.",
      ok: true,
      sessionKey: input.sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không tải được Thông tin kho.",
      ok: false,
    };
  }
}

export async function deleteWarehouseRfidTagsAction(input: {
  epcs: string[];
  password: string;
  query?: string;
  reason: string;
  status?: "ALL" | WarehouseRfidIssuanceStatus;
}): Promise<WarehouseInfoActionResult> {
  try {
    const session = await requireCurrentSession();
    const deleted = await deleteWarehouseRfidTags(session, input);
    revalidatePath("/kho-van/thong-tin");
    return {
      data: await getWarehouseInfoWorkspace(session, {
        query: input.query,
        status: input.status,
      }),
      message: `Đã xóa vĩnh viễn ${deleted.deletedCount} RFID khỏi PostgreSQL.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không xóa được RFID đã chọn.",
      ok: false,
    };
  }
}
