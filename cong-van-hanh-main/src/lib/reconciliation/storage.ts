import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Storage } from "@google-cloud/storage";

import type { PrismaClient } from "@/generated/prisma/client";
import { registerFileMetadata } from "@/lib/storage";

const storage = new Storage();

function uploadBucket() {
  const bucket = (process.env.ACCOUNTING_EXPORT_BUCKET || "").trim();
  if (!bucket) {
    throw new Error(
      "Cloud Storage cho file Đối soát chưa được cấu hình (ACCOUNTING_EXPORT_BUCKET).",
    );
  }
  return bucket;
}

function safeFileName(value: string) {
  return (
    value
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/[. ]+$/g, "")
      .slice(0, 180) || "doi-soat.xlsx"
  );
}

export function isReconciliationStorageConfigured() {
  return Boolean((process.env.ACCOUNTING_EXPORT_BUCKET || "").trim());
}

export async function storeReconciliationSource(
  db: PrismaClient,
  input: {
    buffer: Buffer;
    fileName: string;
    kind: "URBOX" | "BASE_REWARD";
    mimeType: string;
    periodKey: string;
    runId: string;
    sheetName: string;
    userId: string;
  },
) {
  const bucket = uploadBucket();
  const fileName = safeFileName(input.fileName);
  const sha256 = createHash("sha256").update(input.buffer).digest("hex");
  const objectKey = [
    "reconciliation",
    input.periodKey.replace(/[^A-Za-z0-9._-]/g, "_"),
    input.runId,
    "inputs",
    `${input.kind.toLocaleLowerCase()}-${randomUUID()}-${fileName}`,
  ].join("/");

  await storage.bucket(bucket).file(objectKey).save(input.buffer, {
    contentType:
      input.mimeType ||
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      metadata: {
        kind: input.kind,
        periodKey: input.periodKey,
        runId: input.runId,
        sha256,
        uploadedById: input.userId,
      },
    },
    resumable: input.buffer.length > 5 * 1024 * 1024,
    validation: "crc32c",
  });

  try {
    return await registerFileMetadata(db, {
      metadata: {
        kind: input.kind,
        periodKey: input.periodKey,
        runId: input.runId,
        sheetName: input.sheetName,
        source: "RECONCILIATION_INPUT",
      },
      mimeType: input.mimeType || "application/octet-stream",
      object: { bucket, objectKey, provider: "GCS" },
      originalName: fileName,
      ownerId: input.userId,
      sha256,
      sizeBytes: BigInt(input.buffer.length),
    });
  } catch (error) {
    await storage
      .bucket(bucket)
      .file(objectKey)
      .delete({ ignoreNotFound: true });
    throw error;
  }
}
