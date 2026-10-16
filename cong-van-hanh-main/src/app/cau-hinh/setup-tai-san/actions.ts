"use server";

import { revalidatePath } from "next/cache";

import { requireCurrentSession } from "@/lib/auth/session";
import {
  analyzeAssetInvoice,
  archiveAssetRecord,
  assertAssetSetupAccess,
  assetSetupPath,
  getAssetSetupSnapshot,
  retryAssetBackgroundJob,
  runAssetBackgroundQueue,
  saveAssetCatalogItem,
  saveAssetOption,
  saveStationeryItem,
  saveUniformItem,
} from "@/lib/assets/setup-runtime";
import type {
  AssetDraftInput,
  AssetOptionKind,
  AssetSetupActionResult,
  AssetSetupSnapshot,
  StationeryDraftInput,
  UniformDraftInput,
} from "@/lib/assets/setup-types";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function fileFromForm(formData: FormData, key: string) {
  const value = formData.get(key);
  if (!(value instanceof File) || value.size <= 0) {
    throw new Error("Vui lòng đính kèm hình ảnh.");
  }
  return value;
}

function payloadFromForm<T>(formData: FormData): T {
  const raw = String(formData.get("payload") || "").trim();
  if (!raw) throw new Error("Thiếu dữ liệu cần lưu.");
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Dữ liệu biểu mẫu chưa đúng định dạng.");
  }
}

function backgroundFlag(formData: FormData) {
  return String(formData.get("removeBackground") || "") === "true";
}

export async function refreshAssetSetupAction(): Promise<
  AssetSetupActionResult<AssetSetupSnapshot>
> {
  try {
    const session = await requireCurrentSession();
    assertAssetSetupAccess(session);
    return {
      data: await getAssetSetupSnapshot(),
      message: "Đã tải lại Setup tài sản từ PostgreSQL.",
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không tải lại được Setup tài sản."),
      ok: false,
    };
  }
}

export async function saveAssetOptionAction(input: {
  colorHex?: string;
  kind: AssetOptionKind;
  name: string;
}): Promise<AssetSetupActionResult<AssetSetupSnapshot>> {
  try {
    const session = await requireCurrentSession();
    await saveAssetOption(session, input);
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: `Đã thêm "${input.name.trim()}".`,
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không lưu được tùy chọn."),
      ok: false,
    };
  }
}

export async function archiveAssetRecordAction(input: {
  id: string;
  recordType: "asset-catalog" | "asset-setup" | "stationery" | "uniform";
}): Promise<AssetSetupActionResult<AssetSetupSnapshot>> {
  try {
    const session = await requireCurrentSession();
    await archiveAssetRecord(session, input);
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: "Đã đánh dấu Đã xóa và ẩn khỏi danh mục đang dùng.",
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không xóa được bản ghi."),
      ok: false,
    };
  }
}

export async function saveAssetCatalogAction(
  formData: FormData,
): Promise<AssetSetupActionResult<AssetSetupSnapshot>> {
  try {
    const session = await requireCurrentSession();
    const result = await saveAssetCatalogItem(
      session,
      payloadFromForm<AssetDraftInput>(formData),
      fileFromForm(formData, "image"),
      backgroundFlag(formData),
    );
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: result.queued
        ? "Đã đưa CCDC/tài sản vào hàng đợi xử lý nền."
        : "Đã lưu CCDC/tài sản vào PostgreSQL.",
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không lưu được CCDC/tài sản."),
      ok: false,
    };
  }
}

export async function saveStationeryAction(
  formData: FormData,
): Promise<AssetSetupActionResult<AssetSetupSnapshot>> {
  try {
    const session = await requireCurrentSession();
    const result = await saveStationeryItem(
      session,
      payloadFromForm<StationeryDraftInput>(formData),
      fileFromForm(formData, "image"),
      backgroundFlag(formData),
    );
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: result.queued
        ? "Đã đưa văn phòng phẩm vào hàng đợi xử lý nền."
        : "Đã lưu văn phòng phẩm vào PostgreSQL.",
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không lưu được văn phòng phẩm."),
      ok: false,
    };
  }
}

export async function saveUniformAction(
  formData: FormData,
): Promise<AssetSetupActionResult<AssetSetupSnapshot>> {
  try {
    const session = await requireCurrentSession();
    const result = await saveUniformItem(
      session,
      payloadFromForm<UniformDraftInput>(formData),
      fileFromForm(formData, "image"),
      backgroundFlag(formData),
    );
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: result.queued
        ? "Đã đưa đồng phục vào hàng đợi xử lý nền."
        : "Đã lưu đồng phục vào PostgreSQL.",
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không lưu được đồng phục."),
      ok: false,
    };
  }
}

export async function analyzeAssetInvoiceAction(
  formData: FormData,
): Promise<
  AssetSetupActionResult<
    Awaited<ReturnType<typeof analyzeAssetInvoice>>
  >
> {
  try {
    const session = await requireCurrentSession();
    const value = formData.get("invoice");
    if (!(value instanceof File) || value.size <= 0) {
      throw new Error("Vui lòng nạp hóa đơn đầu vào.");
    }
    const result = await analyzeAssetInvoice(session, value);
    return {
      data: result,
      message: `Gemini đã nhận diện ${result.suggestions.length} mặt hàng.`,
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không phân tích được hóa đơn."),
      ok: false,
    };
  }
}

export async function runAssetBackgroundQueueAction(): Promise<
  AssetSetupActionResult<AssetSetupSnapshot>
> {
  try {
    const session = await requireCurrentSession();
    const result = await runAssetBackgroundQueue(session);
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: result.processed
        ? "Đã xử lý xong một tác vụ trong hàng đợi."
        : "Hàng đợi không có tác vụ mới.",
      ok: true,
    };
  } catch (error) {
    return {
      data: await getAssetSetupSnapshot().catch(() => undefined),
      message: errorMessage(error, "Không chạy được hàng đợi xử lý nền."),
      ok: false,
    };
  }
}

export async function retryAssetBackgroundJobAction(
  jobId: string,
): Promise<AssetSetupActionResult<AssetSetupSnapshot>> {
  try {
    const session = await requireCurrentSession();
    await retryAssetBackgroundJob(session, jobId);
    revalidatePath(assetSetupPath);
    return {
      data: await getAssetSetupSnapshot(),
      message: "Đã đưa tác vụ trở lại hàng đợi.",
      ok: true,
    };
  } catch (error) {
    return {
      message: errorMessage(error, "Không chạy lại được tác vụ."),
      ok: false,
    };
  }
}
