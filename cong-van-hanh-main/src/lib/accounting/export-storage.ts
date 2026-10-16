import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Storage } from "@google-cloud/storage";

import { getDb } from "@/lib/db";
import { AccountingRpcError, type JsonObject } from "@/lib/accounting/types";
import { registerFileMetadata } from "@/lib/storage";

const MAX_EXPORT_BYTES = 30_000_000;
const storage = new Storage();

function exportBucket() {
  const bucket = (process.env.ACCOUNTING_EXPORT_BUCKET || "").trim();
  if (!bucket) {
    throw new AccountingRpcError(
      "Cloud Storage cho file xuất Kế toán chưa được cấu hình.",
      503,
    );
  }
  return bucket;
}

function safeFileName(value: unknown, fallback: string) {
  const normalized = String(value || fallback)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
  return (normalized || fallback).slice(0, 180);
}

function decodeWorkerFile(result: JsonObject) {
  const encoded = typeof result.base64 === "string" ? result.base64 : "";
  if (!encoded) {
    throw new AccountingRpcError(
      "Worker không trả nội dung file xuất.",
      502,
    );
  }
  const content = Buffer.from(encoded, "base64");
  if (!content.length || content.length > MAX_EXPORT_BYTES) {
    throw new AccountingRpcError(
      "File xuất Kế toán rỗng hoặc vượt giới hạn 30 MB.",
      413,
    );
  }
  const actualSha256 = createHash("sha256").update(content).digest("hex");
  const expectedSha256 =
    typeof result.sha256 === "string" ? result.sha256.trim().toLowerCase() : "";
  if (expectedSha256 && expectedSha256 !== actualSha256) {
    throw new AccountingRpcError(
      "Mã kiểm tra file từ worker không khớp; hệ thống đã dừng tải file.",
      502,
    );
  }
  return { actualSha256, content };
}

function downloadUrl(fileId: string) {
  // Luôn trả đường dẫn cùng origin với trang người dùng đang mở.
  // Người dùng có thể đăng nhập bằng custom domain hoặc URL Cloud Run; ghép APP_URL
  // ở đây sẽ làm cookie phiên thuộc hostname còn lại không được gửi khi tải file.
  return `/api/accounting/files/${encodeURIComponent(fileId)}`;
}

export async function storeAccountingExport(
  result: JsonObject,
  input: {
    actorEmail: string;
    fallbackName: string;
    purpose:
      | "CHANGE_HISTORY"
      | "REPORT_FORMULA_EVIDENCE"
      | "REPORT_OUTPUT"
      | "REPORT_TEMPLATE";
  },
) {
  const { actualSha256, content } = decodeWorkerFile(result);
  const bucket = exportBucket();
  const fileName = safeFileName(result.fileName, input.fallbackName);
  const mimeType =
    typeof result.mimeType === "string" && result.mimeType.trim()
      ? result.mimeType.trim()
      : "application/octet-stream";
  const now = new Date();
  const objectKey = [
    "accounting",
    "exports",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}-${fileName}`,
  ].join("/");

  await storage.bucket(bucket).file(objectKey).save(content, {
    contentType: mimeType,
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      contentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      metadata: {
        actorEmail: input.actorEmail,
        purpose: input.purpose,
        sha256: actualSha256,
      },
    },
    resumable: false,
    validation: "crc32c",
  });

  let file;
  try {
    file = await registerFileMetadata(getDb(), {
      metadata: {
        actorEmail: input.actorEmail,
        purpose: input.purpose,
        source: "ACCOUNTING_WORKER",
      },
      mimeType,
      object: { bucket, objectKey, provider: "GCS" },
      originalName: fileName,
      sha256: actualSha256,
      sizeBytes: BigInt(content.length),
    });
  } catch (error) {
    await storage
      .bucket(bucket)
      .file(objectKey)
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
    throw error;
  }

  return {
    fileId: file.id,
    fileName,
    mimeType,
    sha256: actualSha256,
    sizeBytes: content.length,
    url: downloadUrl(file.id),
  };
}

export async function storeAccountingTemplateSource(
  content: Buffer,
  input: {
    actorEmail: string;
    fileName: string;
  },
) {
  if (!content.length || content.length > MAX_EXPORT_BYTES) {
    throw new AccountingRpcError(
      "File khuôn B09 rỗng hoặc vượt giới hạn 30 MB.",
      413,
    );
  }
  const bucket = exportBucket();
  const fileName = safeFileName(
    input.fileName,
    "B09-DN - Khuôn Bản thuyết minh Báo cáo tài chính.xlsx",
  );
  const sha256 = createHash("sha256").update(content).digest("hex");
  const now = new Date();
  const objectKey = [
    "accounting",
    "templates",
    "disclosure",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}-${fileName}`,
  ].join("/");

  await storage.bucket(bucket).file(objectKey).save(content, {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      metadata: {
        actorEmail: input.actorEmail,
        purpose: "DISCLOSURE_TEMPLATE_SOURCE",
        sha256,
      },
    },
    resumable: false,
    validation: "crc32c",
  });

  let file;
  try {
    file = await registerFileMetadata(getDb(), {
      metadata: {
        actorEmail: input.actorEmail,
        purpose: "DISCLOSURE_TEMPLATE_SOURCE",
        source: "ACCOUNTING_TEMPLATE_IMPORT",
      },
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      object: { bucket, objectKey, provider: "GCS" },
      originalName: fileName,
      sha256,
      sizeBytes: BigInt(content.length),
    });
  } catch (error) {
    await storage
      .bucket(bucket)
      .file(objectKey)
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
    throw error;
  }

  return {
    fileId: file.id,
    fileName,
    sha256,
    sizeBytes: content.length,
  };
}

export async function loadAccountingTemplateSource(fileId: string) {
  const file = await getDb().fileObject.findUnique({ where: { id: fileId } });
  if (
    !file ||
    file.status !== "ACTIVE" ||
    file.provider !== "GCS" ||
    !file.bucket
  ) {
    throw new AccountingRpcError(
      "Khuôn Excel gốc của B09 chưa được lưu hoặc không còn tồn tại.",
      409,
    );
  }
  const [content] = await storage
    .bucket(file.bucket)
    .file(file.objectKey)
    .download();
  if (!content.length || content.length > MAX_EXPORT_BYTES) {
    throw new AccountingRpcError(
      "Khuôn Excel gốc của B09 rỗng hoặc vượt giới hạn 30 MB.",
      409,
    );
  }
  const sha256 = createHash("sha256").update(content).digest("hex");
  if (file.sha256 && file.sha256.toLowerCase() !== sha256) {
    throw new AccountingRpcError(
      "Khuôn Excel gốc của B09 không vượt qua kiểm tra toàn vẹn.",
      409,
    );
  }
  return {
    content,
    fileName: file.originalName,
    sha256,
  };
}

export function accountingStorage() {
  return storage;
}
