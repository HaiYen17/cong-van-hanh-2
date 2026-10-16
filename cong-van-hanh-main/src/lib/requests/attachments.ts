import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Storage } from "@google-cloud/storage";

import type { PrismaClient } from "@/generated/prisma/client";
import { registerFileMetadata } from "@/lib/storage";

const storage = new Storage();
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_FILES = 8;

function uploadBucket() {
  const bucket = (process.env.ACCOUNTING_EXPORT_BUCKET || "").trim();
  if (!bucket) {
    throw new Error("Kho tệp của Cổng vận hành chưa được cấu hình.");
  }
  return bucket;
}

function safeFileName(value: string) {
  return value
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 180) || "tep-dinh-kem";
}

export async function storeRequestAttachments(
  db: PrismaClient,
  input: {
    files: File[];
    maxFileBytes?: number;
    metadata?: Record<string, unknown>;
    requestCode: string;
    requestId: string;
    source?: string;
    userId: string;
  },
) {
  const files = input.files.filter((file) => file.size > 0).slice(0, MAX_FILES);
  if (!files.length) return [];

  const bucket = uploadBucket();
  const maxFileBytes = input.maxFileBytes || MAX_FILE_BYTES;
  const stored: { objectKey: string }[] = [];

  try {
    const results = [];
    for (const file of files) {
      if (file.size > maxFileBytes) {
        throw new Error(
          `Tệp “${file.name}” vượt giới hạn ${Math.round(maxFileBytes / 1024 / 1024)} MB.`,
        );
      }

      const content = Buffer.from(await file.arrayBuffer());
      const fileName = safeFileName(file.name);
      const sha256 = createHash("sha256").update(content).digest("hex");
      const now = new Date();
      const objectKey = [
        "requests",
        String(now.getUTCFullYear()),
        String(now.getUTCMonth() + 1).padStart(2, "0"),
        input.requestCode,
        `${randomUUID()}-${fileName}`,
      ].join("/");

      await storage.bucket(bucket).file(objectKey).save(content, {
        contentType: file.type || "application/octet-stream",
        metadata: {
          cacheControl: "private, no-store, max-age=0",
          metadata: {
            requestCode: input.requestCode,
            requestId: input.requestId,
            sha256,
            uploadedById: input.userId,
          },
        },
        resumable: false,
        validation: "crc32c",
      });
      stored.push({ objectKey });

      const fileObject = await registerFileMetadata(db, {
        metadata: {
          ...(input.metadata || {}),
          requestCode: input.requestCode,
          requestId: input.requestId,
          source: input.source || "REQUEST_ATTACHMENT",
        },
        mimeType: file.type || "application/octet-stream",
        object: { bucket, objectKey, provider: "GCS" },
        originalName: fileName,
        ownerId: input.userId,
        sha256,
        sizeBytes: BigInt(content.length),
      });

      const attachment = await db.requestAttachment.create({
        data: {
          fileName,
          fileObjectId: fileObject.id,
          fileUrl: `/api/requests/files/${encodeURIComponent(fileObject.id)}`,
          mimeType: file.type || null,
          requestId: input.requestId,
          sizeBytes: content.length,
          uploadedById: input.userId,
        },
      });
      results.push(attachment);
    }
    return results;
  } catch (error) {
    await Promise.all(
      stored.map(({ objectKey }) =>
        storage.bucket(bucket).file(objectKey).delete({ ignoreNotFound: true }),
      ),
    );
    throw error;
  }
}

export function requestAttachmentStorage() {
  return storage;
}
