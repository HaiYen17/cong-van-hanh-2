import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import {
  assertConfiguredObject,
} from "@/lib/storage/unconfigured";
import type { StoredObjectRef } from "@/lib/storage/contracts";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

export async function registerFileMetadata(
  db: PrismaClient,
  input: {
    metadata?: unknown;
    mimeType?: string;
    object: StoredObjectRef;
    originalName: string;
    ownerId?: string;
    sha256?: string;
    sizeBytes?: bigint;
    sourceDriveId?: string;
  },
) {
  assertConfiguredObject(input.object);

  return db.fileObject.create({
    data: {
      bucket: input.object.bucket,
      metadata: asJson(input.metadata),
      mimeType: input.mimeType,
      migrationState:
        input.object.provider === "GOOGLE_DRIVE" ? "LINKED_DRIVE" : "NATIVE",
      objectKey: input.object.objectKey,
      originalName: input.originalName,
      ownerId: input.ownerId,
      provider: input.object.provider,
      sha256: input.sha256,
      sizeBytes: input.sizeBytes,
      sourceDriveId: input.sourceDriveId,
      versions: {
        create: {
          bucket: input.object.bucket,
          metadata: asJson(input.metadata),
          mimeType: input.mimeType,
          objectKey: input.object.objectKey,
          provider: input.object.provider,
          sha256: input.sha256,
          sizeBytes: input.sizeBytes,
          sourceDriveId: input.sourceDriveId,
          uploadedById: input.ownerId,
          versionNumber: 1,
        },
      },
    },
    include: { versions: true },
  });
}

export async function linkFileToEntity(
  db: PrismaClient,
  input: {
    entityId: string;
    entityType: string;
    fileObjectId: string;
    metadata?: unknown;
    purpose?: string;
    sortOrder?: number;
  },
) {
  const purpose = input.purpose ?? "ATTACHMENT";

  return db.fileLink.upsert({
    create: {
      entityId: input.entityId,
      entityType: input.entityType,
      fileObjectId: input.fileObjectId,
      metadata: asJson(input.metadata),
      purpose,
      sortOrder: input.sortOrder ?? 0,
    },
    update: {
      metadata: asJson(input.metadata),
      sortOrder: input.sortOrder ?? 0,
    },
    where: {
      fileObjectId_entityType_entityId_purpose: {
        entityId: input.entityId,
        entityType: input.entityType,
        fileObjectId: input.fileObjectId,
        purpose,
      },
    },
  });
}

export function fileMetadataDto(file: {
  bucket: string | null;
  currentVersion: number;
  id: string;
  mimeType: string | null;
  objectKey: string;
  originalName: string;
  provider: string;
  sha256: string | null;
  sizeBytes: bigint | null;
  status: string;
}) {
  return {
    ...file,
    sizeBytes: file.sizeBytes?.toString() ?? null,
  };
}
