"use server";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { issueDocumentNumber } from "@/lib/document-issue";
import { getDb } from "@/lib/db";

const PATH = "/thuc-thi/so-van-ban";

export type IssueActionState = { error?: string; number?: string; success?: string };

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

export async function issueDocumentNumberAction(
  _state: IssueActionState,
  formData: FormData,
): Promise<IssueActionState> {
  const session = await requireCurrentSession();
  if (!can(session, "documents.manage")) {
    return { error: "Ông chưa có quyền cấp số văn bản." };
  }

  const companyId = text(formData, "companyId");
  const documentTypeId = text(formData, "documentTypeId");
  const signDateRaw = text(formData, "signDate");
  if (!companyId) return { error: "Chọn công ty (pháp nhân ký)." };
  if (!documentTypeId) return { error: "Chọn loại văn bản." };
  const signDate = signDateRaw ? new Date(signDateRaw) : null;
  if (!signDate || Number.isNaN(signDate.getTime())) return { error: "Chọn ngày ký hợp lệ." };

  const qtyRaw = Number.parseInt(text(formData, "quantity"), 10);
  const result = await issueDocumentNumber(getDb(), {
    companyId,
    createdById: session.userId,
    createdByName: session.displayName,
    documentTypeId,
    note: text(formData, "note") || null,
    partnerAbbr: text(formData, "partnerAbbr") || null,
    partnerName: text(formData, "partnerName") || null,
    quantity: Number.isFinite(qtyRaw) ? qtyRaw : 1,
    sealTypes: formData.getAll("sealTypes").map((v) => String(v)).filter(Boolean),
    signDate,
  });

  if (!result.ok) return { error: result.error };
  revalidatePath(PATH);
  return { number: result.documentNumber, success: `Đã cấp số: ${result.documentNumber}` };
}

export async function cancelDocumentAction(id: string): Promise<void> {
  const session = await requireCurrentSession();
  if (!can(session, "documents.manage")) return;
  // Hủy nhưng GIỮ số (STT vẫn reserved) — bám hành vi "Hủy sau cấp số" bản cũ.
  await getDb().documentRegistry.update({ data: { status: "CANCELLED" }, where: { id } });
  revalidatePath(PATH);
}
