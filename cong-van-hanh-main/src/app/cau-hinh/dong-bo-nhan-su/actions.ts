"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import type { PersonnelMappings } from "@/lib/personnel";
import { readSheet } from "@/lib/personnel-sheet";
import { runPersonnelSync } from "@/lib/personnel-sync";

const PATH = "/cau-hinh/dong-bo-nhan-su";

export type SourceActionState = { error?: string; success?: string };
export type ReadHeadersResult = { error?: string; headerRowIndex?: number; headers?: string[] };
export type SyncActionState = {
  message?: string;
  tone?: "error" | "success" | "warning";
};

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

// Đọc header sheet nguồn (nút "Đọc link"). Gọi trực tiếp từ client.
export async function readHeadersAction(
  apiLink: string,
  sheetName: string,
  headerRow: number,
): Promise<ReadHeadersResult> {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) {
    return { error: "Ông chưa có quyền cấu hình." };
  }
  try {
    const read = await readSheet(apiLink, sheetName, headerRow);
    return { headerRowIndex: read.headerRowIndex, headers: read.headers.filter(Boolean) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Không đọc được link nguồn." };
  }
}

export async function savePersonnelSourceAction(
  _state: SourceActionState,
  formData: FormData,
): Promise<SourceActionState> {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) {
    return { error: "Ông chưa có quyền cấu hình." };
  }

  const companyId = text(formData, "companyId");
  const apiLink = text(formData, "apiLink");
  const sheetName = text(formData, "sheetName");
  const headerRow = Number.parseInt(text(formData, "headerRow"), 10) || 1;
  const syncMode = text(formData, "syncMode") === "snapshot" ? "snapshot" : "interval";
  if (!companyId) return { error: "Chọn công ty set." };
  if (!apiLink) return { error: "Nhập link API nguồn." };
  if (!sheetName) return { error: "Nhập tên sheet lấy danh sách." };

  let mappings: PersonnelMappings = {};
  try {
    const parsed = JSON.parse(text(formData, "mappings") || "{}");
    if (parsed && typeof parsed === "object") mappings = parsed as PersonnelMappings;
  } catch {
    mappings = {};
  }

  const db = getDb();
  try {
    await db.personnelSource.upsert({
      create: { apiLink, companyId, headerRow, mappings, sheetName, syncMode, createdById: session.userId },
      update: { apiLink, headerRow, mappings, sheetName, syncMode },
      where: { companyId },
    });
  } catch {
    return { error: "Không lưu được cấu hình nguồn." };
  }

  revalidatePath(PATH);
  return { success: "Đã lưu cấu hình nguồn nhân sự." };
}

export async function syncPersonnelSourceAction(
  sourceId: string,
  _state: SyncActionState,
  _formData: FormData,
): Promise<SyncActionState> {
  void _state;
  void _formData;
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) {
    return { message: "Ông chưa có quyền đồng bộ nhân sự.", tone: "error" };
  }
  const db = getDb();
  const source = await db.personnelSource.findUnique({ where: { id: sourceId } });
  if (!source) {
    return { message: "Không tìm thấy cấu hình nguồn nhân sự.", tone: "error" };
  }

  const { count, failed, message, skipped } = await runPersonnelSync(db, source, {
    triggeredById: session.userId,
  });
  await db.personnelSource.update({
    data: { lastSyncCount: count, lastSyncMessage: message, lastSyncedAt: new Date() },
    where: { id: sourceId },
  });
  revalidatePath(PATH);
  revalidatePath("/cau-hinh");
  return {
    message,
    tone: failed > 0 || skipped > 0 ? "warning" : "success",
  };
}

export async function setPersonnelSourceStatusAction(sourceId: string, status: string): Promise<void> {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) return;
  await getDb().personnelSource.update({ data: { status }, where: { id: sourceId } });
  revalidatePath(PATH);
}

export async function deletePersonnelSourceAction(sourceId: string): Promise<void> {
  const session = await requireCurrentSession();
  if (!can(session, "system.settings.manage")) return;
  await getDb().personnelSource.delete({ where: { id: sourceId } });
  revalidatePath(PATH);
}
