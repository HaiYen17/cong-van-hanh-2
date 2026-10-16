import "server-only";

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

type JsonInput = Prisma.InputJsonValue;

function asJson(value: unknown, fallback: JsonInput = {}) {
  if (value === undefined) return fallback;
  return JSON.parse(JSON.stringify(value)) as JsonInput;
}

export function migrationFingerprint(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

export async function startMigrationRun(
  db: PrismaClient,
  input: {
    config?: unknown;
    kind: string;
    mode?: "PREVIEW" | "APPLY" | "SYNC" | "BACKFILL";
    name: string;
    sourceKey: string;
    triggeredById?: string;
  },
) {
  const source = await db.migrationSource.upsert({
    create: {
      config: asJson(input.config),
      createdById: input.triggeredById,
      key: input.sourceKey,
      kind: input.kind,
      name: input.name,
    },
    update: {
      archivedAt: null,
      config: asJson(input.config),
      kind: input.kind,
      name: input.name,
      status: "ACTIVE",
    },
    where: { key: input.sourceKey },
  });
  const activeRun = await db.migrationRun.findFirst({
    select: { id: true },
    where: {
      sourceId: source.id,
      startedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) },
      status: "RUNNING",
    },
  });

  if (activeRun) {
    throw new Error("Nguồn này đang được đồng bộ. Vui lòng chờ lượt hiện tại hoàn tất.");
  }

  const startedAt = new Date();
  const run = await db.migrationRun.create({
    data: {
      sourceId: source.id,
      mode: input.mode ?? "SYNC",
      sourceConfigSnapshot: asJson(input.config),
      status: "RUNNING",
      triggeredById: input.triggeredById,
    },
  });

  await db.migrationSource.update({
    data: { lastRunAt: startedAt },
    where: { id: source.id },
  });

  return { runId: run.id, sourceId: source.id };
}

export async function stageMigrationRecord(
  db: PrismaClient,
  input: {
    entityType: string;
    externalId?: string;
    fingerprint?: string;
    normalizedData?: unknown;
    rawData: unknown;
    rowNumber?: number;
    runId: string;
    status?: string;
  },
) {
  return db.migrationRecord.create({
    data: {
      entityType: input.entityType,
      externalId: input.externalId,
      fingerprint: input.fingerprint,
      normalizedData:
        input.normalizedData === undefined
          ? undefined
          : asJson(input.normalizedData),
      rawData: asJson(input.rawData),
      rowNumber: input.rowNumber,
      runId: input.runId,
      status: input.status ?? "PENDING",
    },
  });
}

export async function finishMigrationRecord(
  db: PrismaClient,
  recordId: string,
  input: {
    internalId?: string;
    issueCount?: number;
    status: "IMPORTED" | "SKIPPED" | "FAILED";
  },
) {
  await db.migrationRecord.update({
    data: {
      internalId: input.internalId,
      issueCount: input.issueCount,
      processedAt: new Date(),
      status: input.status,
    },
    where: { id: recordId },
  });
}

export async function recordMigrationIssue(
  db: PrismaClient,
  input: {
    code: string;
    externalId?: string;
    field?: string;
    message: string;
    rawData?: unknown;
    rowNumber?: number;
    runId: string;
    severity?: "INFO" | "WARNING" | "ERROR";
  },
) {
  await db.migrationIssue.create({
    data: {
      code: input.code,
      externalId: input.externalId,
      field: input.field,
      message: input.message,
      rawData:
        input.rawData === undefined ? undefined : asJson(input.rawData),
      rowNumber: input.rowNumber,
      runId: input.runId,
      severity: input.severity ?? "ERROR",
    },
  });
}

export async function mapExternalId(
  db: PrismaClient,
  input: {
    entityType: string;
    externalId: string;
    fingerprint?: string;
    internalId: string;
    metadata?: unknown;
    sourceId: string;
  },
) {
  await db.externalIdMap.upsert({
    create: {
      entityType: input.entityType,
      externalId: input.externalId,
      fingerprint: input.fingerprint,
      internalId: input.internalId,
      metadata: asJson(input.metadata),
      sourceId: input.sourceId,
    },
    update: {
      fingerprint: input.fingerprint,
      internalId: input.internalId,
      lastSeenAt: new Date(),
      metadata: asJson(input.metadata),
    },
    where: {
      sourceId_entityType_externalId: {
        entityType: input.entityType,
        externalId: input.externalId,
        sourceId: input.sourceId,
      },
    },
  });
}

export async function finishMigrationRun(
  db: PrismaClient,
  runId: string,
  input: {
    checksum?: string;
    rowsCreated?: number;
    rowsFailed?: number;
    rowsRead?: number;
    rowsSkipped?: number;
    rowsUpdated?: number;
    rowsValid?: number;
    status: "COMPLETED" | "PARTIAL" | "FAILED" | "CANCELLED";
    summary: string;
  },
) {
  await db.migrationRun.update({
    data: {
      checksum: input.checksum,
      completedAt: new Date(),
      rowsCreated: input.rowsCreated,
      rowsFailed: input.rowsFailed,
      rowsRead: input.rowsRead,
      rowsSkipped: input.rowsSkipped,
      rowsUpdated: input.rowsUpdated,
      rowsValid: input.rowsValid,
      status: input.status,
      summary: input.summary,
    },
    where: { id: runId },
  });
}
