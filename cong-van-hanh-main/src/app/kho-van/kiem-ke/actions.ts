"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  cancelWarehouseInventoryRfids,
  compareWarehouseInventorySessions,
  confirmWarehouseInventorySession,
  defineWarehouseInventoryUnknownRfids,
  deleteWarehouseInventoryLinkedAfterRedefinition,
  deleteWarehouseInventorySession,
  deleteWarehouseInventorySessionsBulk,
  getWarehouseInventoryWorkspace,
  ingestWarehouseInventoryPayload,
  mergeWarehouseInventorySessions,
  rebuildWarehouseInventorySession,
  reassignWarehouseInventoryRfids,
  removeWarehouseInventorySessionRfids,
  searchWarehouseInventoryProducts,
} from "@/lib/warehouse/inventory";
import { importAllWarehouseLegacyData } from "@/lib/warehouse/legacy-sync";
import type {
  WarehouseInventoryActionResult,
  WarehouseInventoryPairComparisonActionResult,
  WarehouseInventoryProductSearchActionResult,
} from "@/lib/warehouse/types";

const PATH = "/kho-van/kiem-ke";

export async function refreshWarehouseInventoryAction(
  sessionKey = "",
): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    return {
      data: await getWarehouseInventoryWorkspace(session, sessionKey),
      message: "Đã tải lại dữ liệu kiểm kê.",
      ok: true,
      sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không tải được kiểm kê Kho.",
      ok: false,
    };
  }
}

export async function compareWarehouseInventorySessionsAction(input: {
  inputSessionKey: string;
  outputSessionKey: string;
}): Promise<WarehouseInventoryPairComparisonActionResult> {
  try {
    const session = await requireCurrentSession();
    const data = await compareWarehouseInventorySessions(
      session,
      input.inputSessionKey,
      input.outputSessionKey,
    );
    return {
      data,
      message: `Đã so sánh ${data.summary.skuCount} SKU giữa hai phiên kiểm kê.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không so sánh được hai phiên kiểm kê.",
      ok: false,
    };
  }
}

export async function deleteWarehouseInventorySessionAction(input: {
  password: string;
  reason: string;
  sessionKey: string;
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const deleted = await deleteWarehouseInventorySession(session, input);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session),
      deletedSessionKeys: [deleted.sessionKey],
      message: `Đã xóa phiên ${deleted.sessionKey} và ${deleted.deletedItemCount} dòng RFID khỏi PostgreSQL.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không xóa được phiên kiểm kê.",
      ok: false,
    };
  }
}

export async function deleteWarehouseInventorySessionsBulkAction(input: {
  password: string;
  reason: string;
  sessionKeys: string[];
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const deleted = await deleteWarehouseInventorySessionsBulk(session, input);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session),
      deletedSessionKeys: deleted.sessionKeys,
      message: `Đã xóa ${deleted.deletedSessionCount} phiên và ${deleted.deletedItemCount} dòng RFID khỏi PostgreSQL.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không xóa hàng loạt được các phiên kiểm kê.",
      ok: false,
    };
  }
}

export async function mergeWarehouseInventorySessionsAction(
  sessionKeys: string[],
): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const merged = await mergeWarehouseInventorySessions(session, sessionKeys);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, merged.sessionKey),
      message: `Đã ghép ${merged.sourceSessionCount} phiên thành ${merged.sessionKey}, gồm ${merged.mergedRfidCount} RFID unique.`,
      ok: true,
      sessionKey: merged.sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không ghép được các phiên kiểm kê đã chọn.",
      ok: false,
    };
  }
}

export async function deleteWarehouseInventoryLinkedAfterRedefinitionAction(input: {
  redefinitionSessionKey: string;
  sessionKey: string;
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const deleted = await deleteWarehouseInventoryLinkedAfterRedefinition(
      session,
      input,
    );
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session),
      deletedSessionKeys: deleted.sessionKeys,
      message: `Đã xóa ${deleted.deletedSessionCount} phiên liên kết và ${deleted.deletedItemCount} dòng RFID khỏi PostgreSQL.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không dọn được nhóm phiên kiểm kê liên kết.",
      ok: false,
    };
  }
}

export async function syncWarehouseMasterAction(
  sessionKey = "",
): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    await getWarehouseInventoryWorkspace(session, sessionKey);
    const synced = await importAllWarehouseLegacyData();
    if (sessionKey) {
      try {
        await rebuildWarehouseInventorySession(session, sessionKey);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !/đã xác nhận|Biên bản đã xác nhận/i.test(error.message)
        ) {
          throw error;
        }
      }
    }
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, sessionKey),
      message: `Đã đồng bộ ${synced.productCount} SKU, ${synced.tagCount} RFID và ${synced.history.imported} bản ghi lịch sử Kho cũ.`,
      ok: true,
      sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không đồng bộ được dữ liệu Kho.",
      ok: false,
    };
  }
}

export async function rebuildWarehouseInventoryAction(
  sessionKey: string,
): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    await rebuildWarehouseInventorySession(session, sessionKey);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, sessionKey),
      message: "Đã nhận diện lại RFID và thống kê số lượng theo SKU.",
      ok: true,
      sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không nhận diện lại được RFID.",
      ok: false,
    };
  }
}

export async function searchWarehouseInventoryProductsAction(
  query: string,
): Promise<WarehouseInventoryProductSearchActionResult> {
  try {
    const session = await requireCurrentSession();
    const products = await searchWarehouseInventoryProducts(session, query);
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

export async function defineWarehouseInventoryRfidsAction(input: {
  epcs: string[];
  sessionKey: string;
  sku: string;
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await defineWarehouseInventoryUnknownRfids(session, input);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, result.sessionKey),
      message: result.message,
      ok: true,
      sessionKey: result.sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không định nghĩa được RFID đã chọn.",
      ok: false,
    };
  }
}

export async function reassignWarehouseInventoryRfidsAction(input: {
  epcs: string[];
  sessionKey: string;
  sku: string;
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await reassignWarehouseInventoryRfids(session, input);
    revalidatePath(PATH);
    return {
      affectedSessionCount: result.affectedSessionCount,
      data: await getWarehouseInventoryWorkspace(session, result.sessionKey),
      message: result.message,
      ok: true,
      redefinitionSessionKey: result.redefinitionSessionKey,
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

export async function cancelWarehouseInventoryRfidsAction(input: {
  epcs: string[];
  sessionKey: string;
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await cancelWarehouseInventoryRfids(session, input);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, result.sessionKey),
      message: result.message,
      ok: true,
      sessionKey: result.sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không Hủy được RFID đã chọn.",
      ok: false,
    };
  }
}

export async function removeWarehouseInventorySessionRfidsAction(input: {
  epcs: string[];
  sessionKey: string;
}): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await removeWarehouseInventorySessionRfids(session, input);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, result.sessionKey),
      message: result.message,
      ok: true,
      sessionKey: result.sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không loại được RFID khỏi phiên kiểm kê.",
      ok: false,
    };
  }
}

export async function confirmWarehouseInventoryAction(
  sessionKey: string,
): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await confirmWarehouseInventorySession(session, sessionKey);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, sessionKey),
      message: result.message,
      ok: true,
      sessionKey,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không xác nhận được biên bản kiểm kê.",
      ok: false,
    };
  }
}

export async function submitWarehouseJsonAction(
  rawJson: string,
): Promise<WarehouseInventoryActionResult> {
  try {
    const session = await requireCurrentSession();
    await getWarehouseInventoryWorkspace(session);
    let payload: unknown;
    try {
      payload = JSON.parse(rawJson);
    } catch {
      throw new Error("JSON thử không hợp lệ.");
    }
    const result = await ingestWarehouseInventoryPayload(payload);
    revalidatePath(PATH);
    return {
      data: await getWarehouseInventoryWorkspace(session, result.sessionId),
      message: result.message,
      ok: true,
      sessionKey: result.sessionId,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không nhận được JSON thử.",
      ok: false,
    };
  }
}
