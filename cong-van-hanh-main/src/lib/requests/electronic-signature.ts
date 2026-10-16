import "server-only";

import path from "node:path";

import { Prisma } from "@/generated/prisma/client";
import { can, canAny } from "@/lib/auth/authorization";
import type { AppSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { materializeLegalDossiers } from "@/lib/admin-tools/legal-dossier";
import { safeStoredFileBaseName } from "@/lib/admin-tools/storage-name";
import { getDb } from "@/lib/db";
import { linkFileToEntity } from "@/lib/storage";

import {
  ELECTRONIC_SIGNATURE_INPUT_PURPOSE,
  ELECTRONIC_SIGNATURE_MAX_FILE_BYTES,
  ELECTRONIC_SIGNATURE_OUTPUT_PURPOSE,
  LEGAL_DOSSIER_FILE_ENTITY,
  electronicSignatureMissingOutputIndexes,
  isElectronicSignatureItem,
  payloadItems,
  replacePayloadItems,
  signatureFiles,
  type ElectronicSignatureFileDescriptor,
  type ElectronicSignaturePayloadItem,
} from "./electronic-signature-payload";
import {
  requestAttachmentStorage,
  storeRequestAttachments,
} from "./attachments";

function inputJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function extensionOf(fileName: string) {
  const extension = path.extname(fileName || "").replace(
    /[^.\p{L}\p{N}]+/gu,
    "",
  );
  return extension.slice(0, 20);
}

function descriptorOf(file: {
  fileName: string;
  fileObjectId: string | null;
  fileUrl: string;
  mimeType: string | null;
  sizeBytes: number | null;
}) {
  const fileId = file.fileObjectId || "";
  return {
    fileId,
    mimeType: file.mimeType || "",
    name: file.fileName,
    size: file.sizeBytes || 0,
    url: fileId
      ? `/api/requests/files/${encodeURIComponent(fileId)}`
      : file.fileUrl,
  } satisfies ElectronicSignatureFileDescriptor;
}

function renamedFile(file: File, name: string) {
  return new File([file], name, {
    lastModified: file.lastModified,
    type: file.type || "application/octet-stream",
  });
}

async function requestWithElectronicItems(requestId: string) {
  await materializeLegalDossiers();
  return getDb().request.findFirst({
    include: {
      attachments: true,
      items: {
        include: { legalDossier: true },
        orderBy: { itemIndex: "asc" },
      },
    },
    where: {
      OR: [{ id: requestId }, { code: requestId }],
      archivedAt: null,
    },
  });
}

async function removeFileObject(fileObjectId: string) {
  const db = getDb();
  const fileObject = await db.fileObject.findUnique({
    where: { id: fileObjectId },
  });
  if (!fileObject) return "";

  let warning = "";
  try {
    if (fileObject.provider === "GCS" && fileObject.bucket) {
      await requestAttachmentStorage()
        .bucket(fileObject.bucket)
        .file(fileObject.objectKey)
        .delete({ ignoreNotFound: true });
    }
  } catch (error) {
    warning =
      error instanceof Error
        ? `Không xóa được object GCS cũ: ${error.message}`
        : "Không xóa được object GCS cũ.";
  }

  await db.$transaction(async (tx) => {
    await tx.requestAttachment.deleteMany({ where: { fileObjectId } });
    await tx.fileLink.deleteMany({ where: { fileObjectId } });
    if (warning) {
      await tx.fileObject.update({
        data: {
          archivedAt: new Date(),
          metadata: inputJson({
            ...(fileObject.metadata &&
            typeof fileObject.metadata === "object" &&
            !Array.isArray(fileObject.metadata)
              ? fileObject.metadata
              : {}),
            archiveReason: "REPLACED_BY_ELECTRONIC_SIGNATURE_OUTPUT",
            cleanupWarning: warning,
          }),
          status: "ARCHIVED",
        },
        where: { id: fileObjectId },
      });
    } else {
      await tx.fileObject.delete({ where: { id: fileObjectId } });
    }
  });
  return warning;
}

export async function updateElectronicSignatureItemPayload(
  requestId: string,
  itemIndex: number,
  patch: ElectronicSignaturePayloadItem,
) {
  const db = getDb();
  const request = await db.request.findUnique({
    include: { items: { orderBy: { itemIndex: "asc" } } },
    where: { id: requestId },
  });
  if (!request) throw new Error("Không tìm thấy đơn hàng.");
  const requestPayload = (request.payload || {}) as ElectronicSignaturePayloadItem;
  const rows = payloadItems(requestPayload).map((item) => ({ ...item }));
  if (!rows[itemIndex]) throw new Error("Không tìm thấy hồ sơ ký điện tử.");
  rows[itemIndex] = { ...rows[itemIndex], ...patch };
  const nextPayload = replacePayloadItems(requestPayload, rows);
  nextPayload.updatedAt = new Date().toISOString();

  await db.$transaction(async (tx) => {
    await tx.request.update({
      data: { payload: inputJson(nextPayload) },
      where: { id: request.id },
    });
    const requestItem = request.items.find(
      (item) => item.itemIndex === itemIndex,
    );
    if (requestItem) {
      await tx.requestItem.update({
        data: { payload: inputJson(rows[itemIndex]) },
        where: { id: requestItem.id },
      });
    }
  });
  return nextPayload;
}

function assertFile(file: File) {
  if (!(file instanceof File) || !file.size) {
    throw new Error("Vui lòng chọn file ký điện tử.");
  }
  if (file.size > ELECTRONIC_SIGNATURE_MAX_FILE_BYTES) {
    throw new Error("File ký số không được vượt quá 20 MB.");
  }
  if (
    file.type !== "application/pdf" &&
    !file.name.toLocaleLowerCase("vi-VN").endsWith(".pdf")
  ) {
    throw new Error("Ký số chỉ nhận 01 file PDF cho mỗi hồ sơ.");
  }
}

export function assertElectronicSignatureCompletionReady(
  payload: ElectronicSignaturePayloadItem,
) {
  const missing = electronicSignatureMissingOutputIndexes(payload);
  if (missing.length) {
    throw new Error(
      `Vui lòng đính file Hành chính đã ký cho hồ sơ dòng ${missing
        .map((index) => index + 1)
        .join(", ")} trước khi hoàn thành.`,
    );
  }
}

export async function saveElectronicSignatureInput(
  session: AppSession,
  input: { file: File; itemIndex: number; requestId: string },
) {
  assertFile(input.file);
  const request = await requestWithElectronicItems(input.requestId);
  if (!request) throw new Error("Không tìm thấy đơn hàng.");
  if (!sessionOwnsUserId(session, request.createdById)) {
    throw new Error("Bạn không có quyền nạp file cho đơn hàng này.");
  }
  if (!["SUBMITTED", "NEEDS_INFO"].includes(request.status)) {
    throw new Error("Đơn hàng đã được Hành chính tiếp nhận, không thể đổi file nộp.");
  }

  const rows = payloadItems(
    (request.payload || {}) as ElectronicSignaturePayloadItem,
  );
  const row = rows[input.itemIndex];
  const requestItem = request.items.find(
    (item) => item.itemIndex === input.itemIndex,
  );
  if (!row || !requestItem?.legalDossier || !isElectronicSignatureItem(row)) {
    throw new Error("Hồ sơ được chọn không phải hồ sơ ký điện tử.");
  }

  const oldIds = signatureFiles(row, "input")
    .map((file) => file.fileId)
    .filter(Boolean);
  const [attachment] = await storeRequestAttachments(getDb(), {
    files: [input.file],
    maxFileBytes: ELECTRONIC_SIGNATURE_MAX_FILE_BYTES,
    metadata: {
      itemIndex: input.itemIndex,
      purpose: ELECTRONIC_SIGNATURE_INPUT_PURPOSE,
    },
    requestCode: request.code,
    requestId: request.id,
    source: ELECTRONIC_SIGNATURE_INPUT_PURPOSE,
    userId: session.userId,
  });
  if (!attachment?.fileObjectId) {
    throw new Error("Không lưu được file ký điện tử.");
  }

  await linkFileToEntity(getDb(), {
    entityId: requestItem.legalDossier.id,
    entityType: LEGAL_DOSSIER_FILE_ENTITY,
    fileObjectId: attachment.fileObjectId,
    metadata: { itemIndex: input.itemIndex, requestCode: request.code },
    purpose: ELECTRONIC_SIGNATURE_INPUT_PURPOSE,
  });
  const descriptor = descriptorOf(attachment);
  const nextPayload = await updateElectronicSignatureItemPayload(request.id, input.itemIndex, {
    aiSummaryStatus: "queued",
    digitalSignature: true,
    electronicSignature: true,
    signatureInputFiles: [descriptor],
    signatureInputFileName: descriptor.name,
    signatureStatus: "waiting_ai_summary",
  });
  await getDb().legalDossier.update({
    data: { fileStatus: "PENDING_SCAN" },
    where: { id: requestItem.legalDossier.id },
  });
  await Promise.all(
    oldIds
      .filter((fileObjectId) => fileObjectId !== attachment.fileObjectId)
      .map(removeFileObject),
  );
  await getDb().auditLog.create({
    data: {
      action: "CREATE",
      actorId: session.userId,
      metadata: inputJson({
        fileObjectId: attachment.fileObjectId,
        itemIndex: input.itemIndex,
        purpose: ELECTRONIC_SIGNATURE_INPUT_PURPOSE,
      }),
      summary: `Nạp file ký điện tử cho ${request.code}, dòng ${input.itemIndex + 1}.`,
      targetId: request.id,
      targetType: "Request",
    },
  });
  return {
    file: descriptor,
    requestCode: request.code,
    requestId: request.id,
    ticketPayload: nextPayload,
  };
}

export async function saveElectronicSignatureOutput(
  session: AppSession,
  input: { file: File; itemIndex: number; requestId: string },
) {
  assertFile(input.file);
  if (
    !canAny(session, ["admin_requests.process", "admin_requests.approve"]) &&
    !session.fullAccess
  ) {
    throw new Error("Tài khoản chưa có quyền xử lý hồ sơ ký điện tử.");
  }
  const request = await requestWithElectronicItems(input.requestId);
  if (!request) throw new Error("Không tìm thấy đơn hàng.");
  const rows = payloadItems(
    (request.payload || {}) as ElectronicSignaturePayloadItem,
  );
  const row = rows[input.itemIndex];
  const requestItem = request.items.find(
    (item) => item.itemIndex === input.itemIndex,
  );
  const dossier = requestItem?.legalDossier;
  if (!row || !dossier || !isElectronicSignatureItem(row)) {
    throw new Error("Hồ sơ được chọn không phải hồ sơ ký điện tử.");
  }
  if (!signatureFiles(row, "input").length && !signatureFiles(row, "output").length) {
    throw new Error("Hồ sơ chưa có file người dùng nộp.");
  }

  const desiredBaseName = safeStoredFileBaseName(
    dossier.generatedStorageName ||
      row.signatureDossierName ||
      row.documentName ||
      row.typeLabel ||
      `Ho-so-${input.itemIndex + 1}`,
  );
  const storedFile = renamedFile(
    input.file,
    `${desiredBaseName}${extensionOf(input.file.name)}`,
  );
  const oldInputIds = signatureFiles(row, "input")
    .map((file) => file.fileId)
    .filter(Boolean);
  const oldOutputIds = signatureFiles(row, "output")
    .map((file) => file.fileId)
    .filter(Boolean);
  const [attachment] = await storeRequestAttachments(getDb(), {
    files: [storedFile],
    maxFileBytes: ELECTRONIC_SIGNATURE_MAX_FILE_BYTES,
    metadata: {
      itemIndex: input.itemIndex,
      purpose: ELECTRONIC_SIGNATURE_OUTPUT_PURPOSE,
    },
    requestCode: request.code,
    requestId: request.id,
    source: ELECTRONIC_SIGNATURE_OUTPUT_PURPOSE,
    userId: session.userId,
  });
  if (!attachment?.fileObjectId) {
    throw new Error("Không lưu được file Hành chính đã ký.");
  }
  await linkFileToEntity(getDb(), {
    entityId: dossier.id,
    entityType: LEGAL_DOSSIER_FILE_ENTITY,
    fileObjectId: attachment.fileObjectId,
    metadata: { itemIndex: input.itemIndex, requestCode: request.code },
    purpose: ELECTRONIC_SIGNATURE_OUTPUT_PURPOSE,
  });

  const descriptor = descriptorOf(attachment);
  const nextPayload = await updateElectronicSignatureItemPayload(request.id, input.itemIndex, {
    digitalSignature: true,
    electronicSignature: true,
    resultFiles: [descriptor],
    signatureInputFiles: [],
    signatureOutputFiles: [descriptor],
    signatureOutputFileName: descriptor.name,
    signatureStatus: "admin_signed",
    signedByAdministrationAt: new Date().toISOString(),
  });
  const cleanupWarnings = (
    await Promise.all(
      [...oldInputIds, ...oldOutputIds]
        .filter((fileObjectId) => fileObjectId !== attachment.fileObjectId)
        .map(removeFileObject),
    )
  ).filter(Boolean);
  await getDb().legalDossier.update({
    data: { fileStatus: "PENDING_SCAN" },
    where: { id: dossier.id },
  });
  await getDb().auditLog.create({
    data: {
      action: "UPDATE",
      actorId: session.userId,
      metadata: inputJson({
        cleanupWarnings,
        fileObjectId: attachment.fileObjectId,
        itemIndex: input.itemIndex,
        purpose: ELECTRONIC_SIGNATURE_OUTPUT_PURPOSE,
        replacedInputIds: oldInputIds,
      }),
      summary: `Hành chính đính file đã ký cho ${request.code}, dòng ${input.itemIndex + 1}; file người dùng đã được thay thế.`,
      targetId: request.id,
      targetType: "Request",
    },
  });
  return {
    cleanupWarnings,
    file: descriptor,
    requestCode: request.code,
    ticketPayload: nextPayload,
  };
}

export async function renameElectronicSignatureInputsForProcessing(
  session: AppSession,
  requestId: string,
) {
  if (!can(session, "admin_requests.process") && !session.fullAccess) return;
  const request = await requestWithElectronicItems(requestId);
  if (!request) return;
  const requestPayload =
    (request.payload || {}) as ElectronicSignaturePayloadItem;
  const rows = payloadItems(requestPayload).map((row) => ({ ...row }));
  let changed = false;

  for (const requestItem of request.items) {
    const row = rows[requestItem.itemIndex];
    const dossier = requestItem.legalDossier;
    if (!row || !dossier || !isElectronicSignatureItem(row)) continue;
    const inputFiles = signatureFiles(row, "input");
    if (!inputFiles.length) {
      throw new Error(
        `Hồ sơ dòng ${requestItem.itemIndex + 1} chưa có file ký điện tử của người dùng.`,
      );
    }
    const descriptor = inputFiles[0];
    const nextName = `${safeStoredFileBaseName(
      dossier.generatedStorageName ||
        row.documentName ||
        row.typeLabel ||
        `Ho-so-${requestItem.itemIndex + 1}`,
    )}${extensionOf(descriptor.name)}`;
    if (descriptor.name === nextName && row.signatureStatus === "processing") {
      continue;
    }
    await getDb().$transaction([
      getDb().requestAttachment.updateMany({
        data: { fileName: nextName },
        where: { fileObjectId: descriptor.fileId, requestId: request.id },
      }),
      getDb().fileObject.updateMany({
        data: { originalName: nextName },
        where: { id: descriptor.fileId },
      }),
    ]);
    rows[requestItem.itemIndex] = {
      ...row,
      signatureDossierName: dossier.generatedStorageName || nextName,
      signatureInputFileName: nextName,
      signatureInputFiles: [{ ...descriptor, name: nextName }],
      signatureStatus: "processing",
    };
    changed = true;
  }

  if (!changed) return requestPayload;
  const nextPayload = replacePayloadItems(requestPayload, rows);
  nextPayload.updatedAt = new Date().toISOString();
  await getDb().$transaction(async (tx) => {
    await tx.request.update({
      data: { payload: inputJson(nextPayload) },
      where: { id: request.id },
    });
    for (const requestItem of request.items) {
      if (!rows[requestItem.itemIndex]) continue;
      await tx.requestItem.update({
        data: { payload: inputJson(rows[requestItem.itemIndex]) },
        where: { id: requestItem.id },
      });
    }
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        note: "Đã tự động đổi tên file ký điện tử theo tên hồ sơ.",
        requestId: request.id,
        type: "COMMENT",
      },
    });
  });
  return nextPayload;
}
