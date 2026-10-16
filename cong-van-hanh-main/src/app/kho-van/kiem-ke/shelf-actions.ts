"use server";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  compareShelfInventoryReports,
  createShelfInventoryReport,
  deleteShelfInventoryReport,
  deleteShelfInventorySession,
  getShelfInventoryReport,
  listShelfInventoryReports,
} from "@/lib/warehouse/shelf-reports";
import { dispatchShelf, SHELF_ACTIONS } from "@/lib/warehouse/shelves";

export async function readShelfResults(offset = 0, sessionId?: string) {
  const actor = await requireCurrentSession();
  try {
    const result = await dispatchShelf(
      sessionId
        ? { action: SHELF_ACTIONS.detail, sessionId }
        : { action: SHELF_ACTIONS.sessions, offset, limit: 30 },
      actor,
    );
    // Dates from pg must be serialized before crossing the server action boundary.
    return { ok: true as const, data: JSON.parse(JSON.stringify(result)) };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không tải được kết quả Kệ/Xe.",
    };
  }
}

export async function readShelfSavedReports(offset = 0, reportId?: string) {
  const actor = await requireCurrentSession();
  try {
    const data = reportId
      ? await getShelfInventoryReport(actor, reportId)
      : await listShelfInventoryReports(actor, offset);
    return { ok: true as const, data: JSON.parse(JSON.stringify(data)) };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không tải được báo cáo Kệ/Xe đã ghép.",
    };
  }
}

export async function mergeShelfInventorySessions(sessionIds: string[]) {
  const actor = await requireCurrentSession();
  try {
    const data = await createShelfInventoryReport(actor, sessionIds);
    return {
      ok: true as const,
      data: JSON.parse(JSON.stringify(data)),
      message: `Đã ghép ${data.shelves.length} phiên Kệ/Xe thành một báo cáo khu vực.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không ghép được các phiên Kệ/Xe.",
    };
  }
}

export async function deleteShelfInventorySessionAction(input: {
  password: string;
  reason: string;
  sessionId: string;
}) {
  const actor = await requireCurrentSession();
  try {
    const deleted = await deleteShelfInventorySession(actor, input);
    return {
      ok: true as const,
      ...deleted,
      message: `Đã xóa phiên Kệ/Xe và ${deleted.deletedLineCount} dòng hàng hóa.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không xóa được phiên kiểm kê Kệ/Xe.",
    };
  }
}

export async function deleteShelfInventoryReportAction(input: {
  password: string;
  reason: string;
  reportId: string;
}) {
  const actor = await requireCurrentSession();
  try {
    const deleted = await deleteShelfInventoryReport(actor, input);
    return {
      ok: true as const,
      ...deleted,
      message: `Đã xóa báo cáo ghép gồm ${deleted.shelfCount} Kệ/Xe.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không xóa được báo cáo kiểm kê Kệ/Xe.",
    };
  }
}

export async function compareShelfInventoryReportsAction(input: {
  inputReportId: string;
  outputReportId: string;
}) {
  const actor = await requireCurrentSession();
  try {
    const data = await compareShelfInventoryReports(
      actor,
      input.inputReportId,
      input.outputReportId,
    );
    return {
      ok: true as const,
      data: JSON.parse(JSON.stringify(data)),
      message: `Đã so sánh ${data.summary.shelfCount} Kệ/Xe giữa hai báo cáo.`,
    };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không so sánh được hai báo cáo Kệ/Xe.",
    };
  }
}

export async function readShelfWarehouseReport(sessionIds: string[]) {
  const actor = await requireCurrentSession();
  try {
    if (
      !Array.isArray(sessionIds) ||
      sessionIds.length < 1 ||
      sessionIds.length > 100
    ) {
      throw new Error("Chọn từ 1 đến 100 phiên Kệ/Xe để tạo báo cáo.");
    }
    const uniqueIds = [...new Set(sessionIds)];
    if (
      uniqueIds.length !== sessionIds.length ||
      uniqueIds.some((id) => !/^[A-Za-z0-9_-]{1,180}$/.test(id))
    ) {
      throw new Error("Danh sách phiên Kệ/Xe không hợp lệ.");
    }
    const details = await Promise.all(
      uniqueIds.map(async (sessionId) => {
        const result = await dispatchShelf(
          { action: SHELF_ACTIONS.detail, sessionId },
          actor,
        );
        return JSON.parse(JSON.stringify(result.session));
      }),
    );
    const warehouses = new Set(details.map((detail) => detail.warehouse));
    if (warehouses.size !== 1) {
      throw new Error(
        "Các phiên được chọn phải thuộc cùng một khu vực kiểm kê.",
      );
    }
    const shelfIds = new Set(details.map((detail) => detail.shelfId));
    if (shelfIds.size !== details.length) {
      throw new Error("Mỗi Kệ/Xe chỉ được chọn một phiên trong cùng báo cáo.");
    }
    details.sort((left, right) =>
      String(left.shelfCode).localeCompare(String(right.shelfCode), "vi", {
        numeric: true,
        sensitivity: "base",
      }),
    );
    return {
      ok: true as const,
      data: {
        generatedAt: new Date().toISOString(),
        preparedBy: actor.displayName,
        warehouse: details[0].warehouse,
        shelves: details,
      },
    };
  } catch (error) {
    return {
      ok: false as const,
      message:
        error instanceof Error
          ? error.message
          : "Không tạo được báo cáo kiểm kê khu vực.",
    };
  }
}
