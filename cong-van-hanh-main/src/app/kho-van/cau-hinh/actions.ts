"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  analyzeWarehouseStockPrintFile,
  applyWarehouseBarcodeMappings,
  deleteWarehouseLabelPrintHistories,
  deleteWarehouseLabelPrintHistory,
  getWarehouseCatalogWorkspace,
  getWarehouseCatalogTemplateRows,
  importWarehouseCatalogFile,
  importWarehouseCatalogManualRows,
  recordWarehouseLabelPrint,
  regenerateWarehouseProductBarcode,
  saveWarehouseProductBarcode,
} from "@/lib/warehouse/catalog";
import type {
  WarehouseBarcodeMapping,
  WarehouseCatalogActionResult,
  WarehouseCatalogManualRow,
  WarehouseCatalogViewInput,
  WarehousePrintProductSearchResult,
  WarehouseProductionPlanActionResult,
  WarehouseStockPrintActionResult,
} from "@/lib/warehouse/catalog-types";
import { syncWarehouseLegacyMaster } from "@/lib/warehouse/legacy-sync";
import {
  getWarehouseProductionPlan,
  searchWarehousePrintProducts,
} from "@/lib/warehouse/production-plan";

const PATH = "/kho-van/cau-hinh";

function errorResult(
  error: unknown,
  fallback: string,
): WarehouseCatalogActionResult {
  return {
    message: error instanceof Error ? error.message : fallback,
    ok: false,
  };
}

async function freshResult(
  message: string,
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  const session = await requireCurrentSession();
  revalidatePath(PATH);
  revalidatePath("/kho-van/kiem-ke");
  return {
    data: await getWarehouseCatalogWorkspace(session, view),
    message,
    ok: true,
  };
}

export async function refreshWarehouseCatalogAction(
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    return await freshResult("Đã tải lại danh mục Kho từ PostgreSQL.", view);
  } catch (error) {
    return errorResult(error, "Không tải lại được danh mục Kho.");
  }
}

export async function getWarehouseProductionPlanAction(): Promise<WarehouseProductionPlanActionResult> {
  try {
    const session = await requireCurrentSession();
    const data = await getWarehouseProductionPlan(session);
    return {
      data,
      message: `Đã lấy ${data.dates.length} ngày kế hoạch từ ${data.sheetName}.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error
          ? error.message
          : "Không đọc được kế hoạch sản xuất.",
      ok: false,
    };
  }
}

export async function searchWarehousePrintProductsAction(
  query: string,
): Promise<WarehousePrintProductSearchResult> {
  try {
    const session = await requireCurrentSession();
    const products = await searchWarehousePrintProducts(session, query);
    return {
      message: products.length
        ? `Tìm thấy ${products.length} SKU.`
        : "Không tìm thấy SKU phù hợp.",
      ok: true,
      products,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không tìm được SKU cần thêm.",
      ok: false,
      products: [],
    };
  }
}

export async function syncWarehouseCatalogLegacyAction(
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    await getWarehouseCatalogWorkspace(session);
    const synced = await syncWarehouseLegacyMaster();
    return await freshResult(
      `Đã đồng bộ ${synced.productCount} SKU và ${synced.tagCount} RFID từ dữ liệu Kho cũ.`,
      view,
    );
  } catch (error) {
    return errorResult(error, "Không đồng bộ được dữ liệu Kho cũ.");
  }
}

export async function saveWarehouseBarcodeAction(
  productId: string,
  barcode: string,
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await saveWarehouseProductBarcode(
      session,
      productId,
      barcode,
    );
    return await freshResult(result.message, view);
  } catch (error) {
    return errorResult(error, "Không lưu được mã vạch.");
  }
}

export async function regenerateWarehouseBarcodeAction(
  productId: string,
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await regenerateWarehouseProductBarcode(session, productId);
    return await freshResult(result.message, view);
  } catch (error) {
    return errorResult(error, "Không tự cấp lại được mã vạch.");
  }
}

export async function applyWarehouseBarcodeMappingsAction(
  mappings: WarehouseBarcodeMapping[],
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await applyWarehouseBarcodeMappings(session, mappings);
    const fresh = await freshResult(result.message, view);
    return {
      ...fresh,
      importResult: {
        createdCount: 0,
        errorCount: result.errors.length,
        errors: result.errors,
        fileName: "Nạp nhanh SKU–Barcode",
        generatedBarcodeCount: 0,
        importedCount: result.updatedCount,
        sheetName: "Nội dung dán",
        skippedCount: 0,
        updatedCount: result.updatedCount,
      },
    };
  } catch (error) {
    return errorResult(error, "Không nạp được danh sách SKU–Barcode.");
  }
}

export async function importWarehouseCatalogAction(
  formData: FormData,
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Vui lòng chọn file cần nạp.");
    const importResult = await importWarehouseCatalogFile(session, file);
    const fresh = await freshResult(
      `Đã xử lý ${importResult.fileName}: ${importResult.createdCount} thêm mới${
        importResult.generatedBarcodeCount
          ? `, ${importResult.generatedBarcodeCount} Barcode tự sinh`
          : ""
      }, ${importResult.skippedCount} SKU đã có${
        importResult.errorCount
          ? `; ${importResult.errorCount} dòng cần kiểm tra.`
          : "."
      }`,
      view,
    );
    return { ...fresh, importResult };
  } catch (error) {
    return errorResult(error, "Không nạp được file danh mục Kho.");
  }
}

export async function importWarehouseCatalogManualAction(
  rows: WarehouseCatalogManualRow[],
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const importResult = await importWarehouseCatalogManualRows(session, rows);
    const fresh = await freshResult(
      `Đã xử lý ${rows.length} dòng nạp lẻ: ${importResult.createdCount} SKU mới, ${importResult.generatedBarcodeCount} Barcode tự sinh, ${importResult.skippedCount} SKU đã có${
        importResult.errorCount
          ? `; ${importResult.errorCount} dòng cần kiểm tra.`
          : "."
      }`,
      view,
    );
    return { ...fresh, importResult };
  } catch (error) {
    return errorResult(error, "Không nạp được hàng hóa lẻ.");
  }
}

export async function analyzeWarehouseStockPrintAction(
  formData: FormData,
): Promise<WarehouseStockPrintActionResult> {
  try {
    const session = await requireCurrentSession();
    const file = formData.get("file");
    if (!(file instanceof File)) throw new Error("Vui lòng chọn file Excel.");
    const analysis = await analyzeWarehouseStockPrintFile(session, file);
    return {
      analysis,
      message: analysis.issueItems.length
        ? `Có ${analysis.issueItems.length} mã chưa in được. Bạn có thể kiểm tra hoặc bỏ các mã này khỏi lô in.`
        : `Đã khớp đủ ${analysis.printableItems.length} mã với dữ liệu Kho.`,
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không đọc được file Excel.",
      ok: false,
    };
  }
}

export async function downloadWarehouseCatalogTemplateAction(): Promise<{
  message: string;
  ok: boolean;
  rows: Array<{ barcode: string | null; name: string; sku: string }>;
}> {
  try {
    const session = await requireCurrentSession();
    const rows = await getWarehouseCatalogTemplateRows(session);
    return {
      message: `Đã chuẩn bị ${rows.length} SKU cho file mẫu.`,
      ok: true,
      rows,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không tải được file mẫu.",
      ok: false,
      rows: [],
    };
  }
}

export async function recordWarehouseLabelPrintAction(
  input: {
    alignSkuRows: boolean;
    format: string;
    labelCount: number;
    pageCount: number;
    productCount: number;
    productIds: string[];
    startSlot: number;
  },
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await recordWarehouseLabelPrint(session, input);
    return await freshResult(result.message, view);
  } catch (error) {
    return errorResult(error, "Không ghi nhận được lệnh in tem.");
  }
}

export async function deleteWarehouseLabelPrintHistoryAction(
  historyId: string,
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await deleteWarehouseLabelPrintHistory(session, historyId);
    return await freshResult(result.message, view);
  } catch (error) {
    return errorResult(error, "Không xóa được lịch sử in.");
  }
}

export async function deleteWarehouseLabelPrintHistoriesAction(
  historyIds: string[],
  view: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogActionResult> {
  try {
    const session = await requireCurrentSession();
    const result = await deleteWarehouseLabelPrintHistories(
      session,
      historyIds,
    );
    return await freshResult(result.message, view);
  } catch (error) {
    return errorResult(error, "Không xóa hàng loạt được lịch sử in.");
  }
}
