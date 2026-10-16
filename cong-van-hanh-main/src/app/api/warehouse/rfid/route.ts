import { NextResponse } from "next/server";

import {
  getMobileProfileFromRequest,
  MobileAuthError,
} from "@/lib/auth/mobile-auth";
import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";
import { ingestWarehouseRfidDefinitionPayload } from "@/lib/warehouse/definition";
import {
  ingestWarehouseInventoryPayload,
  warehouseInventoryAction,
} from "@/lib/warehouse/inventory";
import { lookupWarehouseCatalog } from "@/lib/warehouse/mobile-catalog";
import { searchWarehouseRfids } from "@/lib/warehouse/mobile-search";
import { dispatchShelf, isShelfAction, SHELF_ACTIONS, ShelfError } from "@/lib/warehouse/shelves";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const INVENTORY_ACTIONS = new Set([
  "",
  "warehouseInventoryScan",
  "warehouse-inventory-scan",
]);
const DEFINITION_ACTIONS = new Set([
  "warehouseDefineRfidBatch",
  "warehouse-define-rfid-batch",
]);
const CATALOG_ACTIONS = new Set([
  "warehouseCatalogLookup",
  "warehouse-catalog-lookup",
]);
const SEARCH_ACTIONS = new Set([
  "warehouseRfidSearch",
  "warehouse-rfid-search",
]);

function jsonError(message: string, status: number) {
  return NextResponse.json(
    { error: message, message, ok: false },
    { status },
  );
}

export async function GET() {
  return NextResponse.json({
    actions: [
      "warehouseCatalogLookup",
      "warehouseDefineRfidBatch",
      "warehouseInventoryScan",
      "warehouseRfidSearch",
      ...Object.values(SHELF_ACTIONS),
    ],
    catalogUrl:
      "https://thuanvietgroup.biz.vn/api/warehouse/catalog",
    contractVersion: "2026-09-05",
    documentationUrl:
      "https://thuanvietgroup.biz.vn/api/warehouse/openapi",
    maxBodyBytes: MAX_BODY_BYTES,
    message: "Đầu nhận RFID Kho vận đã sẵn sàng.",
    ok: true,
    service: "Thuan Viet Warehouse RFID",
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    headers: {
      "Access-Control-Allow-Headers":
        "Content-Type, Authorization, X-API-Key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Origin": "*",
    },
    status: 204,
  });
}

export async function POST(request: Request) {
  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return jsonError("JSON vượt quá giới hạn 2 MB.", 413);
    }
    const rawBody = await request.text();
    if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
      return jsonError("JSON vượt quá giới hạn 2 MB.", 413);
    }
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return jsonError("Nội dung gửi lên không phải JSON hợp lệ.", 400);
    }

    await assertWarehouseApiRequest(request, payload);

    // Shelf actions always require a live user session, including legacy-key callers.
    // Identity and module grants come exclusively from the authenticated profile.
    if (isShelfAction(warehouseInventoryAction(payload))) {
      const profile = await getMobileProfileFromRequest(request);
      return NextResponse.json(await dispatchShelf(payload, profile));
    }

    // App mới gửi X-API-Key + access token. Khi đó danh tính người thao tác
    // luôn lấy từ phiên đăng nhập, không tin chuỗi operator do client tự đặt.
    if (request.headers.get("x-api-key")) {
      const profile = await getMobileProfileFromRequest(request);
      payload = {
        ...(payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload
          : {}),
        authenticatedUserId: profile.userId,
        operator: profile.displayName,
        operatorCode: profile.employeeCode,
      };
    }

    const action = warehouseInventoryAction(payload);
    if (CATALOG_ACTIONS.has(action)) {
      const data = await lookupWarehouseCatalog(payload);
      return NextResponse.json({
        action: "warehouseCatalogLookup",
        data,
        ok: true,
        ...data,
      });
    }
    if (SEARCH_ACTIONS.has(action)) {
      const data = await searchWarehouseRfids(payload);
      return NextResponse.json({
        action: "warehouseRfidSearch",
        data,
        ok: true,
        ...data,
      });
    }
    if (DEFINITION_ACTIONS.has(action)) {
      const result = await ingestWarehouseRfidDefinitionPayload(payload);
      const definitionResult = {
        createdCount: result.createdCount,
        errorCount: result.errorCount,
        errors: result.errors,
        sessionId: result.sessionId,
        skippedCount: result.skippedCount,
      };
      return NextResponse.json({
        ...result,
        accepted: result.ok,
        action: "warehouseDefineRfidBatch",
        data: { definitionResult },
        definitionResult,
      });
    }
    if (!INVENTORY_ACTIONS.has(action)) {
      return jsonError(`Action "${action}" chưa được hỗ trợ.`, 400);
    }

    const result = await ingestWarehouseInventoryPayload(payload);
    return NextResponse.json({
      ...result,
      accepted: true,
      action: "warehouseInventoryScan",
      scanSession: result.sessionId,
    });
  } catch (error) {
    if (error instanceof ShelfError) {
      return NextResponse.json({ ok: false, code: error.code, error: error.message, message: error.message }, { status: error.status });
    }
    const message =
      error instanceof Error ? error.message : "Không xử lý được phiên RFID.";
    const status =
      error instanceof WarehouseApiAuthError || error instanceof MobileAuthError
        ? error.status
        : /đã xác nhận/i.test(message)
          ? 409
          : 400;
    return jsonError(message, status);
  }
}
