"use server";

import { extname } from "node:path";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import {
  assertAdminToolsAccess,
  dossierFileLinkConstants,
  getLegalDossierQueue,
  type LegalDossierQueueData,
} from "@/lib/admin-tools/legal-dossier";
import {
  buildLegalDossierStorageName,
  isContractLikeDocumentType,
  safeStoredFileBaseName,
} from "@/lib/admin-tools/storage-name";
import { followUpBlocksAnyModule } from "@/lib/admin-tools/follow-up-lock";
import { verifyPassword } from "@/lib/auth/password";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { issueDocumentNumber } from "@/lib/document-issue";
import { storeRequestAttachments } from "@/lib/requests/attachments";
import { dispatchInboxRpc } from "@/lib/requests/inbox-runtime";
import { linkFileToEntity } from "@/lib/storage";

const PATH = "/thuc-thi/hieu-dinh";
const MAX_REASON_LENGTH = 1200;
const MAX_FILES_PER_BATCH = 8;

export type CorrectionActionResult<T = undefined> =
  | { data?: T; message: string; ok: true }
  | { message: string; ok: false };

function field(formData: FormData, name: string) {
  return String(formData.get(name) ?? "").replace(/\s+/g, " ").trim();
}

function integerField(formData: FormData, name: string) {
  const parsed = Number.parseInt(field(formData, name), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function dateField(formData: FormData, name: string) {
  const value = field(formData, name);
  if (!value) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function failure(error: unknown, fallback: string): CorrectionActionResult {
  return {
    message: error instanceof Error ? error.message : fallback,
    ok: false,
  };
}

function objectOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

export async function refreshCorrectionQueueAction(): Promise<
  CorrectionActionResult<LegalDossierQueueData>
> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "view");
    return {
      data: await getLegalDossierQueue(),
      message: "Đã làm mới hàng đợi Hiệu đính.",
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không tải lại được hàng đợi Hiệu đính.");
  }
}

export async function updateCorrectionSourceItemAction(input: {
  companyName: string;
  dossierId: string;
  documentName: string;
  documentTypeName: string;
  partner: string;
  shortName: string;
  signedDate: string;
  stampTypes: string[];
}): Promise<CorrectionActionResult> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "edit");
    const documentName = input.documentName.replace(/\s+/g, " ").trim();
    if (!documentName) throw new Error("Vui lòng nhập Tên hồ sơ hệ thống.");

    const db = getDb();
    const dossier = await db.legalDossier.findUnique({
      include: { requestItem: { include: { request: true } } },
      where: { id: input.dossierId },
    });
    if (!dossier || dossier.cancelledAt) {
      throw new Error("Không tìm thấy hồ sơ cần sửa hoặc hồ sơ đã bị hủy Hiệu đính.");
    }
    const request = dossier.requestItem.request;
    const itemIndex = dossier.requestItem.itemIndex + 1;
    const isSeal = dossier.requestItem.serviceCode === "document-seal";
    const isStorage = dossier.requestItem.serviceCode === "document-archive";
    if (!isSeal && !isStorage) {
      throw new Error("Loại hồ sơ này không hỗ trợ chỉnh sửa tại Hiệu đính.");
    }

    let signedDate: Date | null = null;
    if (isSeal) {
      const signedDateText = input.signedDate.trim();
      signedDate = /^\d{4}-\d{2}-\d{2}$/.test(signedDateText)
        ? new Date(`${signedDateText}T00:00:00.000Z`)
        : new Date(signedDateText);
      if (Number.isNaN(signedDate.getTime())) {
        throw new Error("Vui lòng chọn Ngày ký hợp lệ.");
      }
      await dispatchInboxRpc(session, "updateInboxSealRequestItem", [
        {
          companyName: input.companyName,
          customNumberingText: input.shortName,
          date: input.signedDate,
          documentName,
          documentTypeName: input.documentTypeName,
          itemIndex,
          partner: input.partner,
          requestId: request.id,
          stamps: input.stampTypes,
        },
      ]);
    } else {
      await dispatchInboxRpc(session, "updateInboxPayloadItemDocumentName", [
        { documentName, itemIndex, requestId: request.id },
      ]);
    }

    await db.$transaction(async (tx) => {
      await tx.legalDossier.update({
        data: isSeal
          ? {
              storageCounterparty: input.partner.replace(/\s+/g, " ").trim(),
              storageIssuedDate: signedDate,
            }
          : { generatedStorageName: documentName },
        where: { id: dossier.id },
      });
      await tx.legalDossierEvent.create({
        data: {
          actorId: session.userId,
          dossierId: dossier.id,
          metadata: asJson({ documentName, itemIndex, requestCode: request.code }),
          note: isSeal
            ? "Đã sửa thông tin hồ sơ gốc từ màn hình Hiệu đính."
            : `Đã đổi tên hồ sơ gốc thành “${documentName}”.`,
          type: "SOURCE_ITEM_UPDATED",
        },
      });
    });

    revalidatePath(PATH);
    revalidatePath("/thuc-thi/quan-ly-don");
    return {
      message: isSeal
        ? "Đã lưu chỉnh sửa hồ sơ gốc và đồng bộ lại Hiệu đính."
        : "Đã lưu tên hồ sơ gốc và đồng bộ lại Hiệu đính.",
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không lưu được chỉnh sửa hồ sơ gốc.");
  }
}

async function prepareDossierForUpload(
  formData: FormData,
  actorId: string,
) {
  const db = getDb();
  const dossierId = field(formData, "dossierId");
  if (!dossierId) throw new Error("Thiếu mã hồ sơ cần lưu.");
  const dossier = await db.legalDossier.findUnique({
    include: {
      company: true,
      documentType: true,
      requestItem: { include: { request: true } },
    },
    where: { id: dossierId },
  });
  if (!dossier || dossier.cancelledAt) {
    throw new Error("Không tìm thấy hồ sơ hoặc hồ sơ đã bị hủy Hiệu đính.");
  }
  if (dossier.requestItem.request.status === "CANCELLED") {
    throw new Error("Đơn gốc đã bị hủy, không thể nạp thêm tệp.");
  }
  if (dossier.fileStatus === "CORRECTION_CANCELLED") {
    throw new Error("Hồ sơ đã bị hủy khỏi hàng đợi Hiệu đính.");
  }
  if (dossier.fileStatus === "STORED") {
    throw new Error("Hồ sơ đã hoàn tất lưu trữ.");
  }

  const isSeal = dossier.requestItem.serviceCode === "document-seal";
  let summary = dossier.storageSummary || "";
  let counterparty = dossier.storageCounterparty || "";
  let revision = dossier.storageRevision;
  let issuedDate = dossier.storageIssuedDate;

  if (isSeal) {
    summary = field(formData, "storageSummary");
    counterparty = field(formData, "storageCounterparty");
    revision = integerField(formData, "storageRevision");
    issuedDate = dateField(formData, "storageIssuedDate");
    if (!summary) throw new Error("Vui lòng nhập Nội dung hồ sơ.");
    if (!issuedDate) throw new Error("Vui lòng chọn Ngày ký/ban hành.");
    const documentTypeName =
      dossier.documentTypeSnapshot || dossier.documentType?.name || "";
    if (
      isContractLikeDocumentType(documentTypeName) &&
      !counterparty
    ) {
      throw new Error(
        "Loại hồ sơ này bắt buộc nhập Đối tượng ký kết.",
      );
    }
  }

  const builtName = buildLegalDossierStorageName({
    companyName:
      dossier.companyNameSnapshot || dossier.company?.legalName || "",
    companyShortName:
      dossier.companyShortSnapshot ||
      dossier.company?.shortName ||
      dossier.company?.code ||
      "",
    counterparty,
    documentTypeName:
      dossier.documentTypeSnapshot || dossier.documentType?.name || "",
    issuedDate,
    revision,
    summary,
  });
  const generatedName = isSeal
    ? builtName
    : dossier.generatedStorageName || builtName;
  if (!generatedName) {
    throw new Error(
      "Không xác định được Tên hồ sơ lưu. Kiểm tra lại Công ty, Loại hồ sơ và Nội dung.",
    );
  }

  await db.legalDossier.update({
    data: {
      generatedStorageName: generatedName,
      storageCounterparty: counterparty || null,
      storageIssuedDate: issuedDate,
      storageRevision: revision,
      storageSummary: summary || null,
    },
    where: { id: dossier.id },
  });
  await db.legalDossierEvent.create({
    data: {
      actorId,
      dossierId: dossier.id,
      metadata: { generatedName },
      note: "Cập nhật thông tin dùng để đặt tên hồ sơ lưu trữ.",
      type: "STORAGE_METADATA_UPDATED",
    },
  });

  return { ...dossier, generatedStorageName: generatedName };
}

export async function uploadDossierFileAction(
  formData: FormData,
): Promise<
  CorrectionActionResult<{
    fileName: string;
    fileUrl: string;
    generatedName: string;
  }>
> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "edit");
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      throw new Error("Vui lòng chọn tệp cần nạp.");
    }
    const batchSize = Math.min(
      MAX_FILES_PER_BATCH,
      Math.max(1, integerField(formData, "batchSize") || 1),
    );
    const dossier = await prepareDossierForUpload(formData, session.userId);
    const db = getDb();
    const { entityType, purpose } = dossierFileLinkConstants();
    const existingCount = await db.fileLink.count({
      where: { entityId: dossier.id, entityType, purpose },
    });
    const extension = extname(file.name).slice(0, 20);
    const needsOrdinal = batchSize > 1 || existingCount > 0;
    const fileName = `${safeStoredFileBaseName(dossier.generatedStorageName)}${
      needsOrdinal ? ` - ${existingCount + 1}` : ""
    }${extension}`;
    const renamed = new File([await file.arrayBuffer()], fileName, {
      type: file.type || "application/octet-stream",
    });
    const [attachment] = await storeRequestAttachments(db, {
      files: [renamed],
      requestCode: dossier.requestItem.request.code,
      requestId: dossier.requestItem.request.id,
      userId: session.userId,
    });
    if (!attachment?.fileObjectId) {
      throw new Error("Không ghi được metadata của tệp.");
    }

    await linkFileToEntity(db, {
      entityId: dossier.id,
      entityType,
      fileObjectId: attachment.fileObjectId,
      metadata: {
        fileName: attachment.fileName,
        requestCode: dossier.requestItem.request.code,
        source: "LEGAL_DOSSIER_CORRECTION",
      },
      purpose,
      sortOrder: existingCount,
    });
    await db.$transaction(async (tx) => {
      await tx.legalDossierEvent.create({
        data: {
          actorId: session.userId,
          dossierId: dossier.id,
          metadata: {
            fileName: attachment.fileName,
            fileObjectId: attachment.fileObjectId,
          },
          note: `Đã nạp tệp “${attachment.fileName}”.`,
          type: "FILE_UPLOADED",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            fileObjectId: attachment.fileObjectId,
            requestId: dossier.requestItem.request.id,
          },
          summary: `Nạp tệp Hiệu đính ${attachment.fileName}.`,
          targetId: dossier.id,
          targetType: "LegalDossier",
        },
      });
    });

    return {
      data: {
        fileName: attachment.fileName,
        fileUrl: attachment.fileUrl || "",
        generatedName: dossier.generatedStorageName || "",
      },
      message: `Đã nạp “${attachment.fileName}”.`,
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không nạp được tệp vào hồ sơ.");
  }
}

async function createManualRegistry(
  dossierId: string,
  manualNumber: string,
  actor: { displayName: string; userId: string },
) {
  const db = getDb();
  const dossier = await db.legalDossier.findUnique({
    include: {
      company: true,
      documentRegistry: true,
      documentType: true,
    },
    where: { id: dossierId },
  });
  if (!dossier) throw new Error("Không tìm thấy hồ sơ cần cấp số.");
  if (dossier.documentRegistry) return dossier.documentRegistry;
  if (!dossier.company || !dossier.documentType || !dossier.storageIssuedDate) {
    throw new Error(
      "Chưa đủ Công ty, Loại văn bản hoặc Ngày ký để ghi số văn bản.",
    );
  }
  const conflict = await db.documentRegistry.findFirst({
    where: {
      documentNumber: { equals: manualNumber, mode: "insensitive" },
    },
  });
  if (conflict) {
    throw new Error(`Số văn bản “${manualNumber}” đã tồn tại.`);
  }

  const companyShort =
    dossier.company.shortName ||
    dossier.company.code ||
    dossier.company.legalName;
  const year = dossier.storageIssuedDate.getUTCFullYear();
  const cycleKey = `${year}-manual`;
  const poolKey = [
    "manual",
    dossier.documentType.id,
    dossier.company.id,
    cycleKey,
  ].join("||");

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const aggregate = await db.documentRegistry.aggregate({
      _max: { serial: true },
      where: { poolKey },
    });
    try {
      return await db.documentRegistry.create({
        data: {
          companyId: dossier.company.id,
          companyShort,
          condition: dossier.conditionSnapshot,
          createdById: actor.userId,
          createdByName: actor.displayName,
          cycleKey,
          documentNumber: manualNumber,
          documentTypeId: dossier.documentType.id,
          documentTypeName: dossier.documentType.name,
          note: dossier.storageSummary,
          partnerName: dossier.storageCounterparty,
          poolKey,
          quantity: 1,
          sealTypes: [],
          serial: (aggregate._max.serial || 0) + 1,
          signDate: dossier.storageIssuedDate,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("Không ghi được số văn bản thủ công, vui lòng thử lại.");
}

async function ensureStorageDocumentNumber(
  dossierId: string,
  manualNumber: string,
  actor: { displayName: string; userId: string },
) {
  const db = getDb();
  const dossier = await db.legalDossier.findUnique({
    include: { documentRegistry: true },
    where: { id: dossierId },
  });
  if (!dossier) throw new Error("Không tìm thấy hồ sơ cần hoàn tất.");
  if (!dossier.takesNumber) return null;
  if (dossier.documentRegistry) return dossier.documentRegistry;
  if (!dossier.companyId || !dossier.documentTypeId || !dossier.storageIssuedDate) {
    throw new Error(
      "Hồ sơ cần lấy số nhưng chưa đủ Công ty, Loại văn bản hoặc Ngày ký.",
    );
  }

  if (manualNumber) {
    return createManualRegistry(dossierId, manualNumber, actor);
  }
  const issued = await issueDocumentNumber(db, {
    companyId: dossier.companyId,
    createdById: actor.userId,
    createdByName: actor.displayName,
    documentTypeId: dossier.documentTypeId,
    note: dossier.storageSummary,
    partnerName: dossier.storageCounterparty,
    quantity: 1,
    signDate: dossier.storageIssuedDate,
  });
  if (!issued.ok) throw new Error(issued.error);
  return db.documentRegistry.findUnique({ where: { id: issued.id } });
}

export async function finalizeDossierUploadAction(
  formData: FormData,
): Promise<
  CorrectionActionResult<{ documentNumber: string; fileCount: number }>
> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "edit");
    const dossier = await prepareDossierForUpload(formData, session.userId);
    const db = getDb();
    const { entityType, purpose } = dossierFileLinkConstants();
    const fileCount = await db.fileLink.count({
      where: { entityId: dossier.id, entityType, purpose },
    });
    if (!fileCount) {
      throw new Error("Vui lòng nạp ít nhất 1 tệp trước khi hoàn tất.");
    }
    const registry =
      dossier.requestItem.serviceCode === "document-archive"
        ? await ensureStorageDocumentNumber(
            dossier.id,
            field(formData, "documentNumber"),
            session,
          )
        : dossier.documentRegistryId
          ? await db.documentRegistry.findUnique({
              where: { id: dossier.documentRegistryId },
            })
          : null;
    const fromStatus = dossier.fileStatus;

    await db.$transaction(async (tx) => {
      await tx.legalDossier.update({
        data: {
          documentRegistryId: registry?.id,
          fileStatus: "STORED",
          numberStatus: registry
            ? "ISSUED"
            : dossier.takesNumber
              ? dossier.numberStatus
              : "NONE",
        },
        where: { id: dossier.id },
      });
      await tx.followUpRequirement.updateMany({
        data: {
          completedAt: new Date(),
          completedById: session.userId,
          metadata: {
            completionReason: "Đã nạp bản ký vào hồ sơ Hiệu đính.",
            source: "LEGAL_DOSSIER_CORRECTION",
          },
          status: "COMPLETED",
        },
        where: { dossierId: dossier.id, status: "PENDING" },
      });
      await tx.legalDossierEvent.create({
        data: {
          actorId: session.userId,
          dossierId: dossier.id,
          fromStatus,
          metadata: {
            documentNumber: registry?.documentNumber || null,
            fileCount,
          },
          note: `Hoàn tất lưu ${fileCount} tệp${
            registry?.documentNumber
              ? `; số văn bản ${registry.documentNumber}`
              : ""
          }.`,
          toStatus: "STORED",
          type: "FILES_FINALIZED",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            documentNumber: registry?.documentNumber || null,
            fileCount,
            requestId: dossier.requestItem.request.id,
          },
          summary: `Hoàn tất Hiệu đính hồ sơ ${dossier.requestItem.request.code}.`,
          targetId: dossier.id,
          targetType: "LegalDossier",
        },
      });
    });

    revalidatePath(PATH);
    return {
      data: {
        documentNumber: registry?.documentNumber || "",
        fileCount,
      },
      message: `Đã lưu ${fileCount} tệp vào hồ sơ “${dossier.generatedStorageName}”.`,
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không hoàn tất được hồ sơ.");
  }
}

export async function requestDossierFollowUpAction(input: {
  dossierId: string;
  reason: string;
}): Promise<CorrectionActionResult> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "edit");
    const reason = input.reason.replace(/\s+/g, " ").trim();
    if (!reason) throw new Error("Vui lòng nhập nội dung cần người tạo bổ sung.");
    if (reason.length > MAX_REASON_LENGTH) {
      throw new Error("Nội dung hậu kiểm không được dài quá 1.200 ký tự.");
    }
    const db = getDb();
    const dossier = await db.legalDossier.findUnique({
      include: {
        followUps: { where: { status: "PENDING" } },
        requestItem: { include: { request: true } },
      },
      where: { id: input.dossierId },
    });
    if (!dossier || dossier.cancelledAt) {
      throw new Error("Không tìm thấy hồ sơ cần gửi hậu kiểm.");
    }
    if (dossier.requestItem.serviceCode !== "document-seal") {
      throw new Error("Chỉ hồ sơ Đóng dấu mới dùng được nhắc nộp lại bản ký.");
    }
    const existing = dossier.followUps[0];
    await db.$transaction(async (tx) => {
      if (existing) {
        await tx.followUpRequirement.update({
          data: {
            blocksModules: ["*"],
            reason,
            requestedAt: new Date(),
            requestedById: session.userId,
          },
          where: { id: existing.id },
        });
      } else {
        await tx.followUpRequirement.create({
          data: {
            blocksModules: ["*"],
            dossierId: dossier.id,
            metadata: { source: "LEGAL_DOSSIER_CORRECTION" },
            reason,
            requestId: dossier.requestItem.request.id,
            requestedById: session.userId,
            targetUserId: dossier.requestItem.request.createdById,
            type: "SIGNED_COPY",
          },
        });
      }
      await tx.legalDossierEvent.create({
        data: {
          actorId: session.userId,
          dossierId: dossier.id,
          metadata: {
            blocksModules: true,
            targetUserId: dossier.requestItem.request.createdById,
          },
          note: reason,
          type: "FOLLOW_UP_REQUESTED",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            targetUserId: dossier.requestItem.request.createdById,
          },
          summary: `Yêu cầu hậu kiểm đơn ${dossier.requestItem.request.code}.`,
          targetId: dossier.id,
          targetType: "LegalDossier",
        },
      });
    });
    revalidatePath(PATH);
    return {
      message:
        "Đã gửi yêu cầu nộp lại bản ký và ghi nhận trạng thái hậu kiểm.",
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không gửi được yêu cầu hậu kiểm.");
  }
}

export async function unlockCorrectionEmployeeAction(input: {
  reason: string;
  targetUserId: string;
}): Promise<CorrectionActionResult<{ unlockedCount: number }>> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "edit");
    const targetUserId = input.targetUserId.trim();
    const reason = input.reason.replace(/\s+/g, " ").trim();
    if (!targetUserId) {
      throw new Error("Vui lòng chọn nhân viên cần mở khóa.");
    }
    if (!reason) {
      throw new Error("Vui lòng nhập lý do mở khóa.");
    }
    if (reason.length > MAX_REASON_LENGTH) {
      throw new Error("Lý do mở khóa không được dài quá 1.200 ký tự.");
    }

    const db = getDb();
    const targetUser = await db.user.findUnique({
      select: {
        displayName: true,
        employee: { select: { employeeCode: true, fullName: true } },
        followUpsTargeted: {
          orderBy: { requestedAt: "desc" },
          select: {
            blocksModules: true,
            dossierId: true,
            id: true,
            metadata: true,
          },
          where: { status: "PENDING" },
        },
      },
      where: { id: targetUserId },
    });
    if (!targetUser) {
      throw new Error("Không tìm thấy tài khoản nhân viên đã chọn.");
    }
    const blockingFollowUps = targetUser.followUpsTargeted.filter((followUp) =>
      followUpBlocksAnyModule(followUp.blocksModules),
    );
    if (!blockingFollowUps.length) {
      throw new Error(
        "Nhân viên này hiện không còn yêu cầu hậu kiểm nào đang chặn chức năng.",
      );
    }

    const now = new Date();
    const targetName =
      targetUser.employee?.fullName || targetUser.displayName;
    const dossierIds = [
      ...new Set(
        blockingFollowUps
          .map((followUp) => followUp.dossierId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];

    await db.$transaction(async (tx) => {
      for (const followUp of blockingFollowUps) {
        const metadata = objectOf(followUp.metadata);
        await tx.followUpRequirement.updateMany({
          data: {
            blocksModules: [],
            metadata: asJson({
              ...metadata,
              manualUnlock: {
                actorId: session.userId,
                at: now.toISOString(),
                previousBlocksModules: followUp.blocksModules,
                reason,
              },
            }),
          },
          where: { id: followUp.id, status: "PENDING" },
        });
      }
      if (dossierIds.length) {
        await tx.legalDossierEvent.createMany({
          data: dossierIds.map((dossierId) => ({
            actorId: session.userId,
            dossierId,
            metadata: asJson({ targetUserId }),
            note: reason,
            type: "FOLLOW_UP_UNLOCKED",
          })),
        });
      }
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: asJson({
            employeeCode: targetUser.employee?.employeeCode || "",
            followUpIds: blockingFollowUps.map((followUp) => followUp.id),
            reason,
          }),
          summary: `Mở khóa chức năng bị chặn bởi Hiệu đính cho ${targetName}.`,
          targetId: targetUserId,
          targetType: "User",
        },
      });
    });

    revalidatePath(PATH);
    revalidatePath("/thuc-thi/dong-dau");
    revalidatePath("/thuc-thi/cap-giay");
    return {
      data: { unlockedCount: blockingFollowUps.length },
      message: `Đã mở khóa đăng ký đóng dấu cho ${targetName}. ${blockingFollowUps.length} yêu cầu hậu kiểm vẫn được giữ để tiếp tục theo dõi.`,
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không mở khóa được cho nhân viên đã chọn.");
  }
}

export async function cancelDossierCorrectionAction(input: {
  dossierId: string;
  password: string;
  reason: string;
}): Promise<CorrectionActionResult> {
  try {
    const session = await requireCurrentSession();
    assertAdminToolsAccess(session, "delete");
    const reason = input.reason.replace(/\s+/g, " ").trim();
    if (!reason) throw new Error("Vui lòng nhập lý do hủy Hiệu đính.");
    if (reason.length > MAX_REASON_LENGTH) {
      throw new Error("Lý do hủy không được dài quá 1.200 ký tự.");
    }
    if (!input.password) {
      throw new Error("Vui lòng nhập mật khẩu của tài khoản đang đăng nhập.");
    }

    const db = getDb();
    const [user, dossier] = await Promise.all([
      db.user.findUnique({
        select: { passwordHash: true, requiresPassword: true },
        where: { id: session.userId },
      }),
      db.legalDossier.findUnique({
        include: { requestItem: { include: { request: true } } },
        where: { id: input.dossierId },
      }),
    ]);
    if (!user?.requiresPassword) {
      throw new Error(
        "Tài khoản admin chưa bật xác thực bằng mật khẩu; chưa thể hủy Hiệu đính.",
      );
    }
    if (!(await verifyPassword(input.password, user.passwordHash))) {
      throw new Error("Mật khẩu xác nhận chưa đúng.");
    }
    if (!dossier || dossier.cancelledAt) {
      throw new Error("Không tìm thấy hồ sơ hoặc hồ sơ đã được hủy trước đó.");
    }
    const { entityType, purpose } = dossierFileLinkConstants();
    const fileCount = await db.fileLink.count({
      where: { entityId: dossier.id, entityType, purpose },
    });
    if (fileCount || dossier.fileStatus === "STORED") {
      throw new Error(
        "Hồ sơ đã có tệp lưu, không thể hủy khỏi danh sách Hiệu đính.",
      );
    }
    const now = new Date();

    await db.$transaction(async (tx) => {
      await tx.legalDossier.update({
        data: {
          cancelledAt: now,
          cancelledById: session.userId,
          cancelledReason: reason,
          fileStatus: "CORRECTION_CANCELLED",
        },
        where: { id: dossier.id },
      });
      await tx.followUpRequirement.updateMany({
        data: {
          completedAt: now,
          completedById: session.userId,
          metadata: {
            completionReason: `Đã hủy Hiệu đính: ${reason}`,
            source: "LEGAL_DOSSIER_CORRECTION",
          },
          status: "COMPLETED",
        },
        where: { dossierId: dossier.id, status: "PENDING" },
      });
      await tx.legalDossierEvent.create({
        data: {
          actorId: session.userId,
          dossierId: dossier.id,
          fromStatus: dossier.fileStatus,
          metadata: { requestCode: dossier.requestItem.request.code },
          note: reason,
          toStatus: "CORRECTION_CANCELLED",
          type: "CORRECTION_CANCELLED",
        },
      });
      await tx.auditLog.create({
        data: {
          action: "VOID",
          actorId: session.userId,
          metadata: {
            documentRegistryId: dossier.documentRegistryId,
            preserveDocumentNumber: true,
            requestId: dossier.requestItem.request.id,
          },
          summary: `Hủy Hiệu đính đơn ${dossier.requestItem.request.code}: ${reason}`,
          targetId: dossier.id,
          targetType: "LegalDossier",
        },
      });
    });
    revalidatePath(PATH);
    return {
      message: `Đã hủy Hiệu đính hồ sơ. ${
        dossier.documentRegistryId
          ? "Số văn bản đã cấp vẫn được giữ nguyên."
          : "Đơn gốc vẫn được giữ nguyên."
      }`,
      ok: true,
    };
  } catch (error) {
    return failure(error, "Không hủy được hồ sơ khỏi hàng đợi Hiệu đính.");
  }
}
