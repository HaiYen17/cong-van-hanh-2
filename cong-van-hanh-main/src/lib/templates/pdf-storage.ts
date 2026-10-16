import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Storage } from "@google-cloud/storage";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { registerFileMetadata } from "@/lib/storage";
import type { TemplateOutputResult } from "@/lib/templates/types";

const templatePdfStorage = new Storage();

function templateFileUrl(fileId: string) {
  const route = `/api/templates/files/${encodeURIComponent(fileId)}`;
  const appUrl = String(process.env.APP_URL || "")
    .trim()
    .replace(/\/+$/, "");
  return appUrl ? `${appUrl}${route}` : route;
}

export async function storeTemplatePdf(input: {
  buffer: Buffer;
  draft: boolean;
  fileName: string;
  session: AppSession;
  templateId: string;
}): Promise<TemplateOutputResult> {
  const bucket = String(process.env.ACCOUNTING_EXPORT_BUCKET || "").trim();
  if (!bucket) {
    throw new Error("Cloud Storage cho PDF Biểu mẫu chưa được cấu hình.");
  }
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const normalizedName = input.fileName
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .slice(0, 180);
  const now = new Date();
  const objectKey = [
    "templates",
    input.draft ? "drafts" : "outputs",
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    `${randomUUID()}-${normalizedName}`,
  ].join("/");
  await templatePdfStorage.bucket(bucket).file(objectKey).save(input.buffer, {
    contentType: "application/pdf",
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      contentDisposition: `inline; filename*=UTF-8''${encodeURIComponent(normalizedName)}`,
      metadata: {
        draft: String(input.draft),
        ownerId: input.session.userId,
        sha256,
        source: "TEMPLATE_PDF",
        templateId: input.templateId,
      },
    },
    resumable: false,
    validation: "crc32c",
  });
  let file;
  try {
    file = await registerFileMetadata(getDb(), {
      metadata: {
        draft: input.draft,
        source: "TEMPLATE_PDF",
        templateId: input.templateId,
      },
      mimeType: "application/pdf",
      object: { bucket, objectKey, provider: "GCS" },
      originalName: normalizedName,
      ownerId: input.session.userId,
      sha256,
      sizeBytes: BigInt(input.buffer.length),
    });
  } catch (error) {
    await templatePdfStorage
      .bucket(bucket)
      .file(objectKey)
      .delete({ ignoreNotFound: true })
      .catch(() => undefined);
    throw error;
  }
  const url = templateFileUrl(file.id);
  return {
    generatedAt: now.toISOString(),
    outputFileId: file.id,
    outputFileName: normalizedName,
    outputUrl: url,
    previewUrl: url,
  };
}

export async function deleteStoredTemplatePdf(fileId: string) {
  const db = getDb();
  const file = await db.fileObject.findUnique({ where: { id: fileId } });
  if (
    !file ||
    file.provider !== "GCS" ||
    !file.bucket ||
    String((file.metadata as { source?: unknown } | null)?.source || "") !==
      "TEMPLATE_PDF"
  ) {
    return false;
  }
  await templatePdfStorage
    .bucket(file.bucket)
    .file(file.objectKey)
    .delete({ ignoreNotFound: true })
    .catch(() => undefined);
  await db.fileObject.delete({ where: { id: file.id } });
  return true;
}

export function getTemplatePdfStorage() {
  return templatePdfStorage;
}
