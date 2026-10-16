import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { Prisma } from "@/generated/prisma/client";
import type { DigitalSignatureWorkflow } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/authorization";
import type { AppSession } from "@/lib/auth/session";
import { sessionOwnsUserId, sessionUserIds } from "@/lib/auth/session-identity";
import { readCompanySignatureRouting } from "@/lib/config/company-signature-config";
import { getDb } from "@/lib/db";
import { storeRequestAttachments, requestAttachmentStorage } from "./attachments";
import {
  digitalSignaturePlacements, payloadItems, replacePayloadItems,
  type ElectronicSignatureFileDescriptor,
} from "./electronic-signature-payload";
import { objectValue, signatureStateLabels, validatePlacementsAgainstPages } from "./digital-signature-policy";

export const jsonValue = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const stageByState: Record<string, string> = {
  AWAITING_UPLOAD: "awaiting_upload", AI_QUEUED: "waiting_ai_summary", AI_RUNNING: "ai_summarizing",
  AI_FAILED: "ai_summary_failed", BOD_PENDING: "waiting_bod_approval", ADMIN_PENDING: "waiting_admin_signature",
  SIGN_QUEUED: "signing", SIGN_PENDING: "waiting_signature_confirmation", SIGN_FAILED: "signature_failed",
  SIGN_UNKNOWN: "signature_unknown", SIGNED: "admin_signed", REJECTED: "rejected", CANCELLED: "cancelled",
};

export function approvalSnapshot(w: Pick<DigitalSignatureWorkflow, "companyId" | "originalFileId" | "originalSha256" | "placements">) {
  return createHash("sha256").update(JSON.stringify({
    companyId: w.companyId, fileId: w.originalFileId, sha256: w.originalSha256, placements: w.placements,
  })).digest("hex");
}

export async function mayApproveCompany(session: AppSession, companyId: string) {
  if (session.fullAccess) return true;
  if (!can(session, "approvals.approve")) return false;
  const routing = await readCompanySignatureRouting();
  return Boolean(routing[companyId]?.bodUserIds.some((id) => sessionUserIds(session).includes(id)));
}

export async function mayReadCompany(session: AppSession, companyId: string) {
  if (session.fullAccess || can(session, "admin_requests.process")) return true;
  if (!canAny(session, ["approvals.read", "approvals.approve"])) return false;
  const routing = await readCompanySignatureRouting();
  return Boolean(routing[companyId]?.bodUserIds.some((id) => sessionUserIds(session).includes(id)));
}

export async function workflowForRequest(requestId: string) {
  return getDb().digitalSignatureWorkflow.findFirst({
    include: { request: { include: { company: true, createdBy: { select: { displayName: true } } } } },
    where: { request: { OR: [{ id: requestId }, { code: requestId }], archivedAt: null } },
  });
}

/** Update the durable state and legacy read projection in one transaction. */
export async function changeWorkflow(
  workflow: Pick<DigitalSignatureWorkflow, "id" | "version" | "requestId">,
  data: Prisma.DigitalSignatureWorkflowUpdateManyMutationInput,
  opts: { actorId?: string | null; event?: string; note?: string; patch?: Record<string, unknown> } = {},
) {
  return getDb().$transaction(async (tx) => {
    const changed = await tx.digitalSignatureWorkflow.updateMany({
      where: { id: workflow.id, version: workflow.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new Error("Hồ sơ đang được cập nhật. Vui lòng tải lại.");
    const next = await tx.digitalSignatureWorkflow.findUniqueOrThrow({ where: { id: workflow.id } });
    const req = await tx.request.findUniqueOrThrow({ where: { id: workflow.requestId } });
    const root = objectValue(req.payload);
    const rows = payloadItems(root);
    rows[0] = {
      ...rows[0], ...opts.patch, digitalSignature: true, electronicSignature: true,
      signatureStatus: stageByState[next.state] || next.state,
      signatureStatusLabel: signatureStateLabels[next.state] || next.state,
      signatureError: next.error || "", aiSummary: next.summary || undefined,
      bodApprovedAt: next.bodApprovedAt?.toISOString(),
    };
    const payload = replacePayloadItems(root, rows);
    const status = next.state === "SIGNED" ? "COMPLETED" : next.state === "REJECTED" ? "REJECTED" :
      next.state === "CANCELLED" ? "CANCELLED" : next.bodApprovedAt ? "APPROVED" : "SUBMITTED";
    payload.stage = next.state === "SIGNED" ? "Hoàn thành" : next.bodApprovedAt ? "Xử lý" : "Chờ duyệt";
    await tx.request.update({ where: { id: req.id }, data: {
      payload: jsonValue(payload), status,
      ...(next.state === "SIGNED" ? { completedAt: next.signedAt || new Date() } : {}),
    } });
    await tx.requestItem.updateMany({ where: { requestId: req.id, itemIndex: 0 }, data: {
      payload: jsonValue(rows[0]), status: next.state === "SIGNED" ? "COMPLETED" : next.state,
    } });
    if (opts.note) await tx.requestEvent.create({ data: {
      requestId: req.id, actorId: opts.actorId ?? null,
      note: opts.note, fromStatus: req.status, toStatus: status,
      type: opts.event === "APPROVED" ? "APPROVED" : opts.event === "REJECTED" ? "REJECTED" :
        next.state === "SIGNED" ? "COMPLETED" : "COMMENT",
    } });
    return next;
  });
}

export async function uploadDigitalSignaturePdf(session: AppSession, input: { file: File; requestId: string; placements?: unknown }) {
  const w = await workflowForRequest(input.requestId);
  if (!w) throw new Error("Không tìm thấy luồng ký số.");
  if (!sessionOwnsUserId(session, w.request.createdById)) throw new Error("Bạn không phải người nộp hồ sơ này.");
  const bytes = Buffer.from(await input.file.arrayBuffer());
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.subarray(0, 5).toString() !== "%PDF-") {
    throw new Error("Ký số chỉ nhận file PDF hợp lệ tối đa 20 MB.");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (w.originalFileId && w.originalSha256 === sha256) {
    return { requestId: w.requestId, requestCode: w.request.code, message: "PDF đã được ghi nhận trong hàng chờ." };
  }
  if (w.state !== "AWAITING_UPLOAD" || w.originalFileId) {
    throw new Error("PDF đã nộp được khóa để duyệt. Muốn đổi PDF, hãy hủy và tạo hồ sơ mới.");
  }
  const placements = digitalSignaturePlacements({ signaturePlacements: w.placements });
  let pdf: PDFDocument;
  try { pdf = await PDFDocument.load(bytes, { updateMetadata: false }); }
  catch { throw new Error("PDF không đọc được hoặc đang được bảo vệ bằng mật khẩu."); }
  const pages = pdf.getPages().map((page) => {
    const crop = page.getCropBox();
    if (crop.x !== 0 || crop.y !== 0) throw new Error("PDF có vùng cắt lệch gốc. Hãy xuất lại PDF trước khi chọn vùng ký.");
    return { width: crop.width, height: crop.height, rotation: page.getRotation().angle };
  });
  validatePlacementsAgainstPages(placements, pages);
  const claimed = await changeWorkflow(w, { state: "UPLOADING", leaseExpiresAt: new Date(Date.now() + 180_000) });
  try {
    const existingFile = await findDigitalSignatureAttachment(
      w.requestId,
      w.id,
      "ELECTRONIC_SIGNATURE_INPUT",
      sha256,
    );
    const storedFile = existingFile
      ? null
      : (await storeRequestAttachments(getDb(), {
          files: [new File([bytes], input.file.name, { type: "application/pdf" })],
          maxFileBytes: 20 * 1024 * 1024, requestId: w.requestId, requestCode: w.request.code,
          userId: session.userId, source: "DIGITAL_SIGNATURE_ORIGINAL",
          metadata: { purpose: "ELECTRONIC_SIGNATURE_INPUT", workflowId: w.id, immutable: true },
        }))[0];
    const file = existingFile ?? storedFile;
    if (!file?.fileObjectId) throw new Error("Không lưu được PDF.");
    const descriptor: ElectronicSignatureFileDescriptor = {
      fileId: file.fileObjectId, name: file.fileName, size: file.sizeBytes || 0,
      mimeType: "application/pdf", url: `/api/requests/files/${file.fileObjectId}`,
    };
    await changeWorkflow(claimed, {
      state: "AI_QUEUED", originalFileId: file.fileObjectId, originalSha256: sha256,
      nextAttemptAt: new Date(), leaseExpiresAt: null, error: null,
    }, { actorId: session.userId, note: "Đã khóa PDF gốc và đưa vào hàng chờ Gemini.", patch: {
      signatureInputFiles: [descriptor], signatureInputFileName: descriptor.name,
    } });
    return { requestId: w.requestId, requestCode: w.request.code, file: descriptor, message: "Đã nộp PDF vào hàng chờ tóm tắt." };
  } catch (error) {
    await getDb().digitalSignatureWorkflow.updateMany({
      where: { id: claimed.id, version: claimed.version },
      data: { state: "AWAITING_UPLOAD", leaseExpiresAt: null, version: { increment: 1 } },
    });
    throw error;
  }
}

export async function readSignatureFile(fileId: string) {
  const file = await getDb().fileObject.findUniqueOrThrow({ where: { id: fileId } });
  if (file.provider !== "GCS" || !file.bucket || file.archivedAt) throw new Error("Không tìm thấy PDF trong kho lưu trữ.");
  const [bytes] = await requestAttachmentStorage().bucket(file.bucket).file(file.objectKey).download();
  return { bytes, file };
}

export async function findDigitalSignatureAttachment(
  requestId: string,
  workflowId: string,
  purpose: "ELECTRONIC_SIGNATURE_INPUT" | "ELECTRONIC_SIGNATURE_OUTPUT",
  sha256?: string,
) {
  const attachments = await getDb().requestAttachment.findMany({
    include: { fileObject: true },
    orderBy: { createdAt: "desc" },
    take: 20,
    where: {
      fileObjectId: { not: null },
      requestId,
      fileObject: {
        is: {
          archivedAt: null,
          ...(sha256 ? { sha256 } : {}),
        },
      },
    },
  });
  return attachments.find((attachment) => {
    const metadata = objectValue(attachment.fileObject?.metadata);
    return metadata.workflowId === workflowId && metadata.purpose === purpose;
  }) ?? null;
}

export async function listDigitalSignatures(session: AppSession, mode: string) {
  const admin = mode === "admin";
  if (admin ? !can(session, "admin_requests.process") :
      !canAny(session, ["approvals.read", "approvals.approve"])) {
    throw new Error("Bạn chưa được cấp quyền mở hàng chờ ký số.");
  }
  const [workflows, routing] = await Promise.all([
    getDb().digitalSignatureWorkflow.findMany({
    include: { request: { include: { company: true, createdBy: { select: { displayName: true } } } } },
    where: { request: { archivedAt: null }, ...(admin ? {} : { state: { in: ["BOD_PENDING", "ADMIN_PENDING", "SIGNED", "REJECTED"] } }) },
    orderBy: [{ createdAt: "desc" }], take: 300,
    }),
    readCompanySignatureRouting(),
  ]);
  const userIds = sessionUserIds(session);
  const adminCanRead =
    session.fullAccess ||
    (admin && can(session, "admin_requests.process"));
  const bodCanRead = canAny(session, ["approvals.read", "approvals.approve"]);
  const items = [];
  for (const w of workflows) {
    const assigned = Boolean(
      routing[w.companyId]?.bodUserIds.some((id) => userIds.includes(id)),
    );
    if (!adminCanRead && !(bodCanRead && assigned)) continue;
    const canApprove =
      w.state === "BOD_PENDING" &&
      (session.fullAccess || (can(session, "approvals.approve") && assigned));
    const canProcess = session.fullAccess || can(session, "admin_requests.process");
    const fileId = w.outputFileId || w.originalFileId;
    items.push({
      requestId: w.requestId, code: w.request.code, title: w.request.title,
      companyName: w.request.company?.legalName || "", createdByName: w.request.createdBy.displayName,
      createdAt: w.createdAt.toISOString(), status: w.state, statusLabel: signatureStateLabels[w.state] || w.state,
      error: w.error || "", summary: w.summary,
      pdfUrl: fileId ? `/api/requests/files/${encodeURIComponent(fileId)}?inline=1` : "",
      signatureCount: digitalSignaturePlacements({ signaturePlacements: w.placements }).length,
      canApprove, canSign: canProcess && ["ADMIN_PENDING", "SIGN_FAILED"].includes(w.state),
      canRetrySummary: canProcess && w.state === "AI_FAILED",
    });
  }
  return items;
}

export async function decideDigitalSignatures(session: AppSession, requestIds: string[], approve: boolean, note: string) {
  if (!requestIds.length || requestIds.length > 300) throw new Error("Chọn từ 01 đến 300 hồ sơ cần duyệt.");
  if (!approve && !note.trim()) throw new Error("Nhập lý do từ chối hồ sơ.");
  const [candidates, routing] = await Promise.all([
    Promise.all([...new Set(requestIds)].map(workflowForRequest)),
    readCompanySignatureRouting(),
  ]);
  const userIds = sessionUserIds(session);
  for (const w of candidates) {
    if (!w || w.state !== "BOD_PENDING" || !w.summary || !w.originalFileId || !w.originalSha256) {
      throw new Error("Có hồ sơ chưa sẵn sàng để BOD duyệt. Vui lòng tải lại danh sách.");
    }
    const assigned = Boolean(
      routing[w.companyId]?.bodUserIds.some((id) => userIds.includes(id)),
    );
    if (!session.fullAccess && !(can(session, "approvals.approve") && assigned)) {
      throw new Error("Bạn không phải BOD được phân công cho pháp nhân này.");
    }
  }
  // Prevalidate all, then each decision uses a version check to prevent stale/double approval.
  let done = 0;
  for (const w of candidates) {
    if (!w) continue;
    await changeWorkflow(w, {
      state: approve ? "ADMIN_PENDING" : "REJECTED", error: approve ? null : note.trim().slice(0, 2000),
      ...(approve ? { bodApprovedAt: new Date(), bodApprovedById: session.userId, approvedSnapshotHash: approvalSnapshot(w) } : {}),
    }, { actorId: session.userId, note: approve ? "BOD duyệt PDF và vùng ký; chuyển Admin duyệt ký." : `BOD từ chối: ${note.trim()}`,
      event: approve ? "APPROVED" : "REJECTED" });
    done++;
  }
  return `Đã ${approve ? "duyệt" : "từ chối"} ${done} hồ sơ.`;
}

export async function enqueueDigitalSignature(session: AppSession, requestId: string, action: "sign" | "retry-summary") {
  if (!session.fullAccess && !can(session, "admin_requests.process")) throw new Error("Chỉ Admin được thực hiện thao tác này.");
  const w = await workflowForRequest(requestId);
  if (!w) throw new Error("Không tìm thấy hồ sơ.");
  if (action === "retry-summary") {
    if (w.state !== "AI_FAILED") throw new Error("Hồ sơ không ở trạng thái cần tóm tắt lại.");
    return changeWorkflow(w, { state: "AI_QUEUED", attempts: 0, nextAttemptAt: new Date(), error: null });
  }
  if (["SIGN_QUEUED", "SIGN_PENDING", "SIGNED"].includes(w.state)) return w;
  if (!["ADMIN_PENDING", "SIGN_FAILED"].includes(w.state) || !w.bodApprovedAt ||
      !w.approvedSnapshotHash || approvalSnapshot(w) !== w.approvedSnapshotHash) {
    throw new Error("PDF và vùng ký phải khớp bản BOD đã duyệt.");
  }
  return changeWorkflow(w, { state: "SIGN_QUEUED", adminSignedById: session.userId, nextAttemptAt: new Date(), error: null },
    { actorId: session.userId, note: "Admin duyệt ký; gửi vào hàng chờ MISA eSign." });
}

export async function prepareDigitalSignaturePoll(session: AppSession, requestId: string) {
  if (!session.fullAccess && !can(session, "admin_requests.process")) {
    throw new Error("Chỉ Admin được cập nhật kết quả ký số.");
  }
  const w = await workflowForRequest(requestId);
  if (!w) throw new Error("Không tìm thấy hồ sơ.");
  if (!["SIGN_QUEUED", "SIGN_PENDING", "SIGN_UNKNOWN"].includes(w.state)) {
    throw new Error("Hồ sơ không có giao dịch ký đang chờ cập nhật.");
  }
  const runtime = objectValue(w.runtime);
  if (w.state === "SIGN_UNKNOWN" && !runtime.transactionId) {
    throw new Error(
      "Giao dịch chưa lưu được transactionId. Cần đối chiếu trên MISA eSign; hệ thống sẽ không tự gửi ký lại.",
    );
  }
  return changeWorkflow(w, {
    error: null,
    nextAttemptAt: new Date(),
    state: w.state === "SIGN_UNKNOWN" ? "SIGN_PENDING" : w.state,
  });
}

export async function claimWorkflow(id: string) {
  const token = randomUUID();
  const now = new Date();
  const result = await getDb().digitalSignatureWorkflow.updateMany({ where: {
    id, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
    state: { in: ["AI_QUEUED", "AI_RUNNING", "SIGN_QUEUED", "SIGN_PENDING"] }, nextAttemptAt: { lte: now },
  }, data: { leaseToken: token, leaseExpiresAt: new Date(Date.now() + 180_000), version: { increment: 1 } } });
  if (!result.count) return null;
  return getDb().digitalSignatureWorkflow.findUniqueOrThrow({ where: { id } });
}
