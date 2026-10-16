import { createHash } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { Storage } from "@google-cloud/storage";
import { GoogleAuth } from "google-auth-library";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { buildLegacyGcsObjectKey } from "./mapping";
import { LEGACY_INBOX_SOURCE_KEY } from "./types";

const driveAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});
const DRIVE_REQUEST_TIMEOUT_MS = 120_000;
const FILE_COPY_TIMEOUT_MS = 300_000;

const NATIVE_EXPORTS: Record<
  string,
  { extension: string; mimeType: string }
> = {
  "application/vnd.google-apps.document": {
    extension: ".docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  "application/vnd.google-apps.drawing": {
    extension: ".pdf",
    mimeType: "application/pdf",
  },
  "application/vnd.google-apps.presentation": {
    extension: ".pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
  "application/vnd.google-apps.spreadsheet": {
    extension: ".xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
};

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function withExtension(name: string, extension: string) {
  return name.toLowerCase().endsWith(extension)
    ? name
    : `${name}${extension}`;
}

function configuredBucket(input?: string) {
  const bucket =
    input?.trim() ||
    process.env.LEGACY_MIGRATION_BUCKET?.trim() ||
    process.env.ACCOUNTING_EXPORT_BUCKET?.trim();
  if (!bucket) {
    throw new Error(
      "Thiếu LEGACY_MIGRATION_BUCKET (hoặc ACCOUNTING_EXPORT_BUCKET) cho phase copy file cũ.",
    );
  }
  return bucket;
}

async function driveDownload(input: {
  driveFileId: string;
  mimeType: string | null;
  originalName: string;
}) {
  const client = await driveAuth.getClient();
  const native = input.mimeType
    ? NATIVE_EXPORTS[input.mimeType]
    : undefined;
  if (native) {
    return {
      mimeType: native.mimeType,
      name: withExtension(input.originalName, native.extension),
      stream: (
        await client.request({
          params: { mimeType: native.mimeType },
          responseType: "stream",
          timeout: DRIVE_REQUEST_TIMEOUT_MS,
          url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
            input.driveFileId,
          )}/export`,
        })
      ).data as NodeJS.ReadableStream,
    };
  }
  return {
    mimeType: input.mimeType || "application/octet-stream",
    name: input.originalName,
    stream: (
      await client.request({
        params: { alt: "media", supportsAllDrives: true },
        responseType: "stream",
        timeout: DRIVE_REQUEST_TIMEOUT_MS,
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          input.driveFileId,
        )}`,
      })
    ).data as NodeJS.ReadableStream,
  };
}

/**
 * Copy một FileObject LINKED_DRIVE sang GCS. Hàm này không gọi Drive delete,
 * trash hoặc permission update; sourceDriveId luôn được giữ lại để rollback/đối soát.
 */
export async function copyLinkedDriveFileToGcs(
  db: PrismaClient,
  input: {
    bucket?: string;
    fileObjectId: string;
    storage?: Storage;
  },
) {
  const bucket = configuredBucket(input.bucket);
  const storage = input.storage || new Storage();
  const fileObject = await db.fileObject.findUnique({
    where: { id: input.fileObjectId },
  });
  if (!fileObject || !fileObject.sourceDriveId) {
    throw new Error("FileObject không có sourceDriveId để copy.");
  }
  if (fileObject.migrationState === "MIGRATED" && fileObject.provider === "GCS") {
    return {
      fileObjectId: fileObject.id,
      objectKey: fileObject.objectKey,
      sha256: fileObject.sha256,
      skipped: true,
    };
  }
  const download = await driveDownload({
    driveFileId: fileObject.sourceDriveId,
    mimeType: fileObject.mimeType,
    originalName: fileObject.originalName,
  });
  const objectKey = buildLegacyGcsObjectKey(
    LEGACY_INBOX_SOURCE_KEY,
    fileObject.sourceDriveId,
    download.name,
    1,
  );
  const target = storage.bucket(bucket).file(objectKey);
  const [exists] = await target.exists();
  if (exists) {
    const [metadata] = await target.getMetadata();
    const sourceDriveId = String(metadata.metadata?.sourceDriveId || "");
    if (sourceDriveId !== fileObject.sourceDriveId) {
      throw new Error(
        `Object GCS ${objectKey} đã tồn tại nhưng không thuộc Drive ID ${fileObject.sourceDriveId}.`,
      );
    }
    const sha256 = String(metadata.metadata?.sha256 || "");
    if (!sha256) {
      throw new Error(
        `Object GCS ${objectKey} đã tồn tại nhưng thiếu SHA256; cần hiệu đính trước khi nhận vào DB.`,
      );
    }
    await finalizeGcsMetadata(db, {
      bucket,
      fileObjectId: fileObject.id,
      mimeType: download.mimeType,
      objectKey,
      originalName: download.name,
      sha256,
      sizeBytes: Number(metadata.size || 0),
      sourceDriveId: fileObject.sourceDriveId,
    });
    return {
      fileObjectId: fileObject.id,
      objectKey,
      sha256,
      skipped: true,
    };
  }

  await db.fileObject.update({
    data: { migrationState: "COPYING", status: "PROCESSING" },
    where: { id: fileObject.id },
  });
  const hash = createHash("sha256");
  let sizeBytes = 0;
  const hashingStream = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      hash.update(chunk);
      sizeBytes += chunk.length;
      callback(null, chunk);
    },
  });
  const upload = target.createWriteStream({
    contentType: download.mimeType,
    metadata: {
      cacheControl: "private, no-store, max-age=0",
      metadata: {
        deleteLegacyDriveFile: "false",
        sourceDriveId: fileObject.sourceDriveId,
        sourceKey: LEGACY_INBOX_SOURCE_KEY,
      },
    },
    preconditionOpts: { ifGenerationMatch: 0 },
    resumable: true,
    validation: "crc32c",
  });
  const copyTimeout = setTimeout(() => {
    upload.destroy(
      new Error(
        `Quá ${Math.trunc(FILE_COPY_TIMEOUT_MS / 1000)} giây khi copy file Drive ${fileObject.sourceDriveId}.`,
      ),
    );
  }, FILE_COPY_TIMEOUT_MS);
  try {
    await pipeline(download.stream, hashingStream, upload);
    const sha256 = hash.digest("hex");
    await target.setMetadata({
      metadata: {
        deleteLegacyDriveFile: "false",
        sha256,
        sourceDriveId: fileObject.sourceDriveId,
        sourceKey: LEGACY_INBOX_SOURCE_KEY,
      },
    });
    await finalizeGcsMetadata(db, {
      bucket,
      fileObjectId: fileObject.id,
      mimeType: download.mimeType,
      objectKey,
      originalName: download.name,
      sha256,
      sizeBytes,
      sourceDriveId: fileObject.sourceDriveId,
    });
    return {
      fileObjectId: fileObject.id,
      objectKey,
      sha256,
      skipped: false,
    };
  } catch (error) {
    await db.fileObject.update({
      data: {
        metadata: asJson({
          ...(fileObject.metadata as Record<string, unknown>),
          copyError:
            error instanceof Error ? error.message : String(error),
          copyFailedAt: new Date().toISOString(),
          deleteLegacyDriveFile: false,
          plannedObjectKey: objectKey,
        }),
        migrationState: "FAILED",
        status: "FAILED",
      },
      where: { id: fileObject.id },
    });
    throw error;
  } finally {
    clearTimeout(copyTimeout);
  }
}

async function finalizeGcsMetadata(
  db: PrismaClient,
  input: {
    bucket: string;
    fileObjectId: string;
    mimeType: string;
    objectKey: string;
    originalName: string;
    sha256: string;
    sizeBytes: number;
    sourceDriveId: string;
  },
) {
  await db.$transaction(async (tx) => {
    const current = await tx.fileObject.findUniqueOrThrow({
      where: { id: input.fileObjectId },
    });
    const nextMetadata = {
      ...(current.metadata as Record<string, unknown>),
      copiedAt: new Date().toISOString(),
      deleteLegacyDriveFile: false,
      gcs: {
        bucket: input.bucket,
        objectKey: input.objectKey,
        sha256: input.sha256,
      },
      sourceDriveId: input.sourceDriveId,
    };
    await tx.fileVersion.upsert({
      create: {
        bucket: input.bucket,
        fileObjectId: current.id,
        metadata: asJson(nextMetadata),
        mimeType: input.mimeType,
        objectKey: input.objectKey,
        provider: "GCS",
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
        sourceDriveId: input.sourceDriveId,
        status: "AVAILABLE",
        uploadedById: current.ownerId,
        versionNumber: 2,
      },
      update: {
        metadata: asJson(nextMetadata),
        mimeType: input.mimeType,
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
        status: "AVAILABLE",
      },
      where: {
        fileObjectId_versionNumber: {
          fileObjectId: current.id,
          versionNumber: 2,
        },
      },
    });
    await tx.fileObject.update({
      data: {
        bucket: input.bucket,
        currentVersion: 2,
        metadata: asJson(nextMetadata),
        migrationState: "MIGRATED",
        mimeType: input.mimeType,
        objectKey: input.objectKey,
        originalName: input.originalName,
        provider: "GCS",
        sha256: input.sha256,
        sizeBytes: BigInt(input.sizeBytes),
        status: "ACTIVE",
      },
      where: { id: current.id },
    });
    await tx.requestAttachment.updateMany({
      data: {
        fileUrl: `/api/requests/files/${encodeURIComponent(current.id)}`,
      },
      where: { fileObjectId: current.id },
    });
  });
}

export async function copyLinkedDriveFilesToGcs(
  db: PrismaClient,
  input: {
    batchSize?: number;
    bucket?: string;
    concurrency?: number;
    limit?: number;
    storage?: Storage;
  } = {},
) {
  const take = Math.min(
    100,
    Math.max(1, Math.trunc(input.limit || input.batchSize || 50)),
  );
  const files = await db.fileObject.findMany({
    orderBy: { createdAt: "asc" },
    take,
    where: {
      migrationState: { in: ["LINKED_DRIVE", "FAILED"] },
      provider: "GOOGLE_DRIVE",
      sourceDriveId: { not: null },
    },
  });
  const concurrency = Math.min(
    8,
    Math.max(1, Math.trunc(input.concurrency || 1)),
  );
  const results: Array<
    | (Awaited<ReturnType<typeof copyLinkedDriveFileToGcs>> & {
        ok: true;
      })
    | { error: string; fileObjectId: string; ok: false }
  > = new Array(files.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      try {
        results[index] = {
          ...(await copyLinkedDriveFileToGcs(db, {
            bucket: input.bucket,
            fileObjectId: file.id,
            storage: input.storage,
          })),
          ok: true as const,
        };
      } catch (error) {
        results[index] = {
          error: error instanceof Error ? error.message : String(error),
          fileObjectId: file.id,
          ok: false as const,
        };
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, files.length) },
      () => worker(),
    ),
  );
  return {
    copied: results.filter((result) => result.ok && !result.skipped).length,
    failed: results.filter((result) => !result.ok).length,
    results,
    skipped: results.filter((result) => result.ok && result.skipped).length,
  };
}
