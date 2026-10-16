import { randomUUID } from "node:crypto";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import {
  ensureUniqueLegacyRegistryIds,
  inboxMigrationFingerprint,
  normalizeLegacyInboxRow,
} from "./mapping";
import { LegacyGoogleSource } from "./google-source";
import {
  applyNormalizedRecord,
  validateCreators,
} from "./repository";
import type {
  InboxMigrationCounters,
  InboxMigrationIssue,
  InboxMigrationPhase,
  LegacyInboxSourceRow,
  NormalizedLegacyInboxRecord,
} from "./types";
import {
  LEGACY_INBOX_SHEET_NAME,
  LEGACY_INBOX_SOURCE_KEY,
  LEGACY_INBOX_SPREADSHEET_ID,
} from "./types";

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function hasErrors(record: NormalizedLegacyInboxRecord) {
  return record.issues.some((issue) => issue.severity === "ERROR");
}

function normalizedFromJson(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Normalized migration record không hợp lệ.");
  }
  const record = value as NormalizedLegacyInboxRecord;
  if (!record.externalId || !record.fingerprint || !record.sourceRow) {
    throw new Error("Normalized migration record thiếu khóa nguồn.");
  }
  const uniqueDossiers = ensureUniqueLegacyRegistryIds({
    issues: record.issues,
    legalDossiers: record.legalDossiers,
    requestCode: record.requestCode,
  });
  const fingerprintSource: Record<string, unknown> = { ...record };
  delete fingerprintSource.fingerprint;
  delete fingerprintSource.issues;
  const sanitized = {
    ...record,
    issues: uniqueDossiers.issues,
    legalDossiers: uniqueDossiers.legalDossiers,
  };
  return {
    ...sanitized,
    fingerprint: inboxMigrationFingerprint({
      ...fingerprintSource,
      legalDossiers: uniqueDossiers.legalDossiers,
    }),
  };
}

function rawSourceSnapshot(record: NormalizedLegacyInboxRecord) {
  const legacy = record.payload._legacy98Inbox;
  return legacy && typeof legacy === "object" && !Array.isArray(legacy)
    ? legacy
    : {
        requestId: record.requestCode,
        source: "98_Inbox",
        sourceRow: record.sourceRow,
      };
}

function emptyCounters(): InboxMigrationCounters {
  return {
    filesCreated: 0,
    filesLinked: 0,
    rowsCreated: 0,
    rowsFailed: 0,
    rowsRead: 0,
    rowsSkipped: 0,
    rowsUpdated: 0,
    rowsValid: 0,
  };
}

async function ensureSource(
  db: PrismaClient,
  input: {
    sheetName: string;
    spreadsheetId: string;
    triggeredById?: string;
  },
) {
  return db.migrationSource.upsert({
    create: {
      config: asJson({
        sheetName: input.sheetName,
        spreadsheetId: input.spreadsheetId,
      }),
      createdById: input.triggeredById,
      key: LEGACY_INBOX_SOURCE_KEY,
      kind: "GOOGLE_SHEET",
      name: "Google Sheet - 98_Inbox",
    },
    update: {
      archivedAt: null,
      config: asJson({
        sheetName: input.sheetName,
        spreadsheetId: input.spreadsheetId,
      }),
      kind: "GOOGLE_SHEET",
      name: "Google Sheet - 98_Inbox",
      status: "ACTIVE",
    },
    where: { key: LEGACY_INBOX_SOURCE_KEY },
  });
}

async function assertNoConcurrentApply(
  db: PrismaClient,
  sourceId: string,
) {
  const active = await db.migrationRun.findFirst({
    select: { id: true, startedAt: true },
    where: {
      mode: { in: ["APPLY", "SYNC", "BACKFILL"] },
      sourceId,
      status: "RUNNING",
    },
  });
  if (active) {
    throw new Error(
      `Nguồn 98_Inbox đang có lượt chạy ${active.id}. Hãy resume lượt đó thay vì tạo lượt apply song song.`,
    );
  }
}

async function startRun(
  db: PrismaClient,
  input: {
    checksum: string;
    mode: "APPLY" | "PREVIEW";
    phase: string;
    previewToken?: string;
    sourceId: string;
    sourceSnapshot: unknown;
    triggeredById?: string;
  },
) {
  if (input.mode === "APPLY") {
    await assertNoConcurrentApply(db, input.sourceId);
  }
  const run = await db.migrationRun.create({
    data: {
      checksum: input.checksum,
      metadata: asJson({
        copyPolicy: {
          deleteLegacyDriveFiles: false,
          gcsPath:
            "legacy/{sourceKey}/{driveFileId}/v1/{originalName}",
        },
      }),
      mode: input.mode,
      phase: input.phase,
      previewExpiresAt: input.previewToken
        ? new Date(Date.now() + 24 * 60 * 60 * 1000)
        : undefined,
      previewToken: input.previewToken,
      sourceConfigSnapshot: asJson(input.sourceSnapshot),
      sourceId: input.sourceId,
      status: "RUNNING",
      triggeredById: input.triggeredById,
    },
  });
  await db.migrationSource.update({
    data: { lastRunAt: run.startedAt },
    where: { id: input.sourceId },
  });
  return run;
}

async function issueOnce(
  db: PrismaClient,
  input: {
    externalId?: string;
    issue: InboxMigrationIssue;
    rawData?: unknown;
    rowNumber?: number;
    runId: string;
  },
) {
  const existing = await db.migrationIssue.findFirst({
    select: { id: true },
    where: {
      code: input.issue.code,
      externalId: input.externalId,
      field: input.issue.field,
      message: input.issue.message,
      rowNumber: input.rowNumber,
      runId: input.runId,
    },
  });
  if (existing) return existing;
  return db.migrationIssue.create({
    data: {
      code: input.issue.code,
      externalId: input.externalId,
      field: input.issue.field,
      message: input.issue.message,
      rawData:
        input.rawData === undefined ? undefined : asJson(input.rawData),
      rowNumber: input.rowNumber,
      runId: input.runId,
      severity: input.issue.severity,
    },
  });
}

async function stageRecords(
  db: PrismaClient,
  input: {
    forApply: boolean;
    records: NormalizedLegacyInboxRecord[];
    runId: string;
  },
) {
  for (const record of input.records) {
    const invalid = hasErrors(record);
    await db.migrationRecord.create({
      data: {
        entityType: "Request",
        externalId: record.externalId,
        fingerprint: record.fingerprint,
        issueCount: record.issues.length,
        normalizedData: asJson(record),
        rawData: asJson(rawSourceSnapshot(record)),
        rowNumber: record.sourceRow,
        runId: input.runId,
        status: invalid
          ? "FAILED"
          : input.forApply
            ? "PENDING"
            : "VALID",
      },
    });
    for (const issue of record.issues) {
      await issueOnce(db, {
        externalId: record.externalId,
        issue,
        rawData: rawSourceSnapshot(record),
        rowNumber: record.sourceRow,
        runId: input.runId,
      });
    }
  }
}

function markDuplicateExternalIds(records: NormalizedLegacyInboxRecord[]) {
  const seen = new Set<string>();
  return records.map((record) => {
    if (!seen.has(record.externalId)) {
      seen.add(record.externalId);
      return record;
    }
    return {
      ...record,
      issues: [
        ...record.issues,
        {
          code: "DUPLICATE_REQUEST_ID",
          field: "Mã đơn DV",
          message: `Mã đơn ${record.requestCode} xuất hiện nhiều lần trong nguồn.`,
          severity: "ERROR" as const,
        },
      ],
    };
  });
}

async function prepareSourceRecords(
  db: PrismaClient,
  sourceRows: LegacyInboxSourceRow[],
) {
  const normalized = markDuplicateExternalIds(
    sourceRows.map(normalizeLegacyInboxRow),
  );
  return validateCreators(db, normalized);
}

async function fetchRows(
  source: LegacyGoogleSource,
  input: {
    batchSize: number;
    maxRows?: number;
    sheetName: string;
    sourceRows?: LegacyInboxSourceRow[];
    spreadsheetId: string;
    startRow?: number;
  },
) {
  if (input.sourceRows) return input.sourceRows;
  return source.fetchInboxRows({
    batchSize: input.batchSize,
    maxRows: input.maxRows,
    sheetName: input.sheetName,
    spreadsheetId: input.spreadsheetId,
    startRow: input.startRow,
  });
}

function configSnapshot(input: {
  batchSize: number;
  maxRows?: number;
  phase?: InboxMigrationPhase;
  sheetName: string;
  spreadsheetId: string;
  startRow?: number;
}) {
  return {
    batchSize: input.batchSize,
    maxRows: input.maxRows,
    phase: input.phase,
    sheetName: input.sheetName,
    spreadsheetId: input.spreadsheetId,
    startRow: input.startRow,
  };
}

export type PreviewInboxMigrationOptions = {
  batchSize?: number;
  googleSource?: LegacyGoogleSource;
  maxRows?: number;
  sheetName?: string;
  sourceRows?: LegacyInboxSourceRow[];
  spreadsheetId?: string;
  startRow?: number;
  triggeredById?: string;
};

export async function previewLegacyInboxMigration(
  db: PrismaClient,
  options: PreviewInboxMigrationOptions = {},
) {
  const batchSize = Math.min(
    100,
    Math.max(50, Math.trunc(options.batchSize || 100)),
  );
  const spreadsheetId =
    options.spreadsheetId || LEGACY_INBOX_SPREADSHEET_ID;
  const sheetName = options.sheetName || LEGACY_INBOX_SHEET_NAME;
  const googleSource = options.googleSource || new LegacyGoogleSource();
  const sourceRows = await fetchRows(googleSource, {
    batchSize,
    maxRows: options.maxRows,
    sheetName,
    sourceRows: options.sourceRows,
    spreadsheetId,
    startRow: options.startRow,
  });
  const records = await prepareSourceRecords(db, sourceRows);
  const checksum = inboxMigrationFingerprint(
    records.map((record) => ({
      externalId: record.externalId,
      fingerprint: record.fingerprint,
      sourceRow: record.sourceRow,
    })),
  );
  const source = await ensureSource(db, {
    sheetName,
    spreadsheetId,
    triggeredById: options.triggeredById,
  });
  const previewToken = randomUUID();
  const run = await startRun(db, {
    checksum,
    mode: "PREVIEW",
    phase: "PREVIEW_STAGING",
    previewToken,
    sourceId: source.id,
    sourceSnapshot: configSnapshot({
      batchSize,
      maxRows: options.maxRows,
      sheetName,
      spreadsheetId,
      startRow: options.startRow,
    }),
    triggeredById: options.triggeredById,
  });
  await stageRecords(db, {
    forApply: false,
    records,
    runId: run.id,
  });
  const rowsFailed = records.filter(hasErrors).length;
  const rowsValid = records.length - rowsFailed;
  const status = rowsFailed ? "PARTIAL" : "COMPLETED";
  const summary = `Đã xem trước ${records.length} dòng 98_Inbox: ${rowsValid} hợp lệ, ${rowsFailed} cần hiệu đính; chưa ghi dữ liệu nghiệp vụ.`;
  await db.migrationRun.update({
    data: {
      completedAt: new Date(),
      cursor: asJson({
        lastRowNumber: records.at(-1)?.sourceRow || 1,
        nextAction: "APPLY_WITH_PREVIEW_TOKEN",
      }),
      phase: "PREVIEW_COMPLETED",
      rowsFailed,
      rowsRead: records.length,
      rowsValid,
      status,
      summary,
    },
    where: { id: run.id },
  });
  return {
    checksum,
    previewExpiresAt: run.previewExpiresAt,
    previewToken,
    rowsFailed,
    rowsRead: records.length,
    rowsValid,
    runId: run.id,
    status,
    summary,
  };
}

async function recordsFromPreview(
  db: PrismaClient,
  previewToken: string,
) {
  const preview = await db.migrationRun.findUnique({
    include: {
      records: { orderBy: { rowNumber: "asc" } },
      source: true,
    },
    where: { previewToken },
  });
  if (!preview || preview.mode !== "PREVIEW") {
    throw new Error("Preview token không tồn tại.");
  }
  if (
    !preview.previewExpiresAt ||
    preview.previewExpiresAt.getTime() < Date.now()
  ) {
    throw new Error("Preview token đã hết hạn; hãy chạy preview lại.");
  }
  const records = preview.records.map((record) => {
    const normalized = normalizedFromJson(record.normalizedData);
    return {
      ...normalized,
      issues: normalized.issues.filter(
        (issue) => issue.code !== "CREATOR_USER_NOT_RESOLVED",
      ),
    };
  });
  return {
    preview,
    records: await validateCreators(db, records),
  };
}

export type ApplyInboxMigrationOptions = PreviewInboxMigrationOptions & {
  phase?: InboxMigrationPhase;
  previewToken?: string;
};

export async function applyLegacyInboxMigration(
  db: PrismaClient,
  options: ApplyInboxMigrationOptions = {},
) {
  const batchSize = Math.min(
    100,
    Math.max(50, Math.trunc(options.batchSize || 100)),
  );
  const phase = options.phase || "ALL";
  const googleSource = options.googleSource || new LegacyGoogleSource();
  let records: NormalizedLegacyInboxRecord[];
  let spreadsheetId =
    options.spreadsheetId || LEGACY_INBOX_SPREADSHEET_ID;
  let sheetName = options.sheetName || LEGACY_INBOX_SHEET_NAME;
  let source;
  let previewRunId: string | undefined;

  if (options.previewToken) {
    const previewResult = await recordsFromPreview(
      db,
      options.previewToken,
    );
    records = previewResult.records;
    source = previewResult.preview.source;
    previewRunId = previewResult.preview.id;
    const snapshot =
      previewResult.preview.sourceConfigSnapshot as Record<string, unknown>;
    spreadsheetId =
      String(snapshot.spreadsheetId || spreadsheetId);
    sheetName = String(snapshot.sheetName || sheetName);
  } else {
    const sourceRows = await fetchRows(googleSource, {
      batchSize,
      maxRows: options.maxRows,
      sheetName,
      sourceRows: options.sourceRows,
      spreadsheetId,
      startRow: options.startRow,
    });
    records = await prepareSourceRecords(db, sourceRows);
    source = await ensureSource(db, {
      sheetName,
      spreadsheetId,
      triggeredById: options.triggeredById,
    });
  }
  const checksum = inboxMigrationFingerprint(
    records.map((record) => ({
      externalId: record.externalId,
      fingerprint: record.fingerprint,
      sourceRow: record.sourceRow,
    })),
  );
  const run = await startRun(db, {
    checksum,
    mode: "APPLY",
    phase: "APPLY_STAGING",
    sourceId: source.id,
    sourceSnapshot: {
      ...configSnapshot({
        batchSize,
        maxRows: options.maxRows,
        phase,
        sheetName,
        spreadsheetId,
        startRow: options.startRow,
      }),
      previewRunId,
    },
    triggeredById: options.triggeredById,
  });
  await stageRecords(db, {
    forApply: true,
    records,
    runId: run.id,
  });
  const invalidRows = records.filter(hasErrors).length;
  await db.migrationRun.update({
    data: {
      cursor: asJson({
        batchSize,
        lastRowNumber: 1,
        phase,
      }),
      phase: "APPLYING",
      rowsFailed: invalidRows,
      rowsRead: records.length,
      rowsValid: records.length - invalidRows,
    },
    where: { id: run.id },
  });
  return resumeLegacyInboxMigration(db, {
    googleSource,
    phase,
    runId: run.id,
  });
}

export type ResumeInboxMigrationOptions = {
  googleSource?: LegacyGoogleSource;
  phase?: InboxMigrationPhase;
  retryFailed?: boolean;
  runId: string;
};

export async function resumeLegacyInboxMigration(
  db: PrismaClient,
  options: ResumeInboxMigrationOptions,
) {
  const run = await db.migrationRun.findUnique({
    include: { source: true },
    where: { id: options.runId },
  });
  if (!run || run.mode !== "APPLY") {
    throw new Error("Không tìm thấy lượt APPLY cần tiếp tục.");
  }
  if (run.status === "COMPLETED") {
    return {
      filesCreated: Number(
        (run.metadata as Record<string, unknown>)?.filesCreated || 0,
      ),
      filesLinked: Number(
        (run.metadata as Record<string, unknown>)?.filesLinked || 0,
      ),
      rowsCreated: run.rowsCreated,
      rowsFailed: run.rowsFailed,
      rowsRead: run.rowsRead,
      rowsSkipped: run.rowsSkipped,
      rowsUpdated: run.rowsUpdated,
      rowsValid: run.rowsValid,
      runId: run.id,
      status: run.status,
      summary: run.summary,
    };
  }
  const snapshot =
    run.sourceConfigSnapshot as Record<string, unknown>;
  const phase =
    options.phase ||
    (String(snapshot.phase || "ALL") as InboxMigrationPhase);
  if (!["ALL", "FILES", "REQUESTS"].includes(phase)) {
    throw new Error(`Phase ${phase} không hợp lệ.`);
  }
  const batchSize = Math.min(
    100,
    Math.max(50, Number(snapshot.batchSize || 100)),
  );
  const googleSource = options.googleSource || new LegacyGoogleSource();
  await db.migrationRun.update({
    data: { phase: "APPLYING", status: "RUNNING" },
    where: { id: run.id },
  });
  const statuses = options.retryFailed
    ? ["PENDING", "FAILED"]
    : ["PENDING"];
  const records = await db.migrationRecord.findMany({
    orderBy: { rowNumber: "asc" },
    where: {
      runId: run.id,
      status: { in: statuses },
    },
  });
  const metadata =
    run.metadata && typeof run.metadata === "object"
      ? (run.metadata as Record<string, unknown>)
      : {};
  const counters: InboxMigrationCounters = {
    ...emptyCounters(),
    filesCreated: Number(metadata.filesCreated || 0),
    filesLinked: Number(metadata.filesLinked || 0),
    rowsCreated: run.rowsCreated,
    rowsFailed: run.rowsFailed,
    rowsRead: run.rowsRead,
    rowsSkipped: run.rowsSkipped,
    rowsUpdated: run.rowsUpdated,
    rowsValid: run.rowsValid,
  };

  try {
    for (let offset = 0; offset < records.length; offset += batchSize) {
      const batch = records.slice(offset, offset + batchSize);
      for (const staged of batch) {
        let normalized: NormalizedLegacyInboxRecord;
        try {
          normalized = normalizedFromJson(staged.normalizedData);
        } catch (error) {
          const issue: InboxMigrationIssue = {
            code: "NORMALIZED_RECORD_INVALID",
            message:
              error instanceof Error
                ? error.message
                : "Normalized record không hợp lệ.",
            severity: "ERROR",
          };
          await issueOnce(db, {
            externalId: staged.externalId || undefined,
            issue,
            rawData: staged.rawData,
            rowNumber: staged.rowNumber || undefined,
            runId: run.id,
          });
          if (staged.status !== "FAILED") counters.rowsFailed += 1;
          await db.migrationRecord.update({
            data: {
              issueCount: staged.issueCount + 1,
              processedAt: new Date(),
              status: "FAILED",
            },
            where: { id: staged.id },
          });
          continue;
        }
        if (hasErrors(normalized)) {
          if (staged.status !== "FAILED") counters.rowsFailed += 1;
          await db.migrationRecord.update({
            data: {
              issueCount: normalized.issues.length,
              processedAt: new Date(),
              status: "FAILED",
            },
            where: { id: staged.id },
          });
          continue;
        }
        try {
          const outcome = await applyNormalizedRecord(db, {
            googleSource,
            phase,
            record: normalized,
            sourceId: run.sourceId,
          });
          if (staged.status === "FAILED" && counters.rowsFailed > 0) {
            counters.rowsFailed -= 1;
          }
          if (outcome.action === "CREATED") counters.rowsCreated += 1;
          else if (outcome.action === "UPDATED") counters.rowsUpdated += 1;
          else counters.rowsSkipped += 1;
          counters.filesCreated += outcome.fileOutcome.created;
          counters.filesLinked += outcome.fileOutcome.linked;
          for (const issue of outcome.issues) {
            await issueOnce(db, {
              externalId: normalized.externalId,
              issue,
              rawData: staged.rawData,
              rowNumber: normalized.sourceRow,
              runId: run.id,
            });
          }
          await db.migrationRecord.update({
            data: {
              internalId: outcome.internalId,
              issueCount: normalized.issues.length + outcome.issues.length,
              processedAt: new Date(),
              status:
                outcome.action === "SKIPPED" &&
                outcome.fileOutcome.linked === 0
                  ? "SKIPPED"
                  : "IMPORTED",
            },
            where: { id: staged.id },
          });
        } catch (error) {
          const issue: InboxMigrationIssue = {
            code: "ROW_IMPORT_FAILED",
            message:
              error instanceof Error
                ? error.message
                : "Không nhập được dòng nguồn.",
            severity: "ERROR",
          };
          await issueOnce(db, {
            externalId: normalized.externalId,
            issue,
            rawData: staged.rawData,
            rowNumber: normalized.sourceRow,
            runId: run.id,
          });
          if (staged.status !== "FAILED") counters.rowsFailed += 1;
          await db.migrationRecord.update({
            data: {
              issueCount: staged.issueCount + 1,
              processedAt: new Date(),
              status: "FAILED",
            },
            where: { id: staged.id },
          });
        }
      }
      const lastRowNumber =
        batch.at(-1)?.rowNumber ||
        Number(
          (run.cursor as Record<string, unknown> | null)?.lastRowNumber ||
            1,
        );
      await db.migrationRun.update({
        data: {
          cursor: asJson({
            batchSize,
            lastRowNumber,
            phase,
          }),
          metadata: asJson({
            ...metadata,
            copyPolicy: {
              deleteLegacyDriveFiles: false,
              gcsPath:
                "legacy/{sourceKey}/{driveFileId}/v1/{originalName}",
            },
            filesCreated: counters.filesCreated,
            filesLinked: counters.filesLinked,
          }),
          rowsCreated: counters.rowsCreated,
          rowsFailed: counters.rowsFailed,
          rowsSkipped: counters.rowsSkipped,
          rowsUpdated: counters.rowsUpdated,
        },
        where: { id: run.id },
      });
    }
  } catch (error) {
    await db.migrationRun.update({
      data: {
        metadata: asJson({
          ...metadata,
          fatalError:
            error instanceof Error ? error.message : String(error),
          filesCreated: counters.filesCreated,
          filesLinked: counters.filesLinked,
        }),
        phase: "INTERRUPTED",
        status: "PARTIAL",
        summary:
          "Lượt nhập bị gián đoạn; dùng --resume với runId này để tiếp tục từ MigrationRecord chưa xử lý.",
      },
      where: { id: run.id },
    });
    throw error;
  }

  const remaining = await db.migrationRecord.count({
    where: { runId: run.id, status: "PENDING" },
  });
  const failed = await db.migrationRecord.count({
    where: { runId: run.id, status: "FAILED" },
  });
  const status = remaining || failed ? "PARTIAL" : "COMPLETED";
  const summary =
    `98_Inbox: ${counters.rowsCreated} tạo, ${counters.rowsUpdated} cập nhật, ` +
    `${counters.rowsSkipped} bỏ qua không đổi, ${failed} lỗi; ` +
    `${counters.filesLinked} liên kết file Drive (${counters.filesCreated} metadata mới).`;
  await db.migrationRun.update({
    data: {
      completedAt: new Date(),
      metadata: asJson({
        ...metadata,
        copyPolicy: {
          deleteLegacyDriveFiles: false,
          gcsPath:
            "legacy/{sourceKey}/{driveFileId}/v1/{originalName}",
        },
        filesCreated: counters.filesCreated,
        filesLinked: counters.filesLinked,
      }),
      phase: "APPLY_COMPLETED",
      rowsCreated: counters.rowsCreated,
      rowsFailed: failed,
      rowsSkipped: counters.rowsSkipped,
      rowsUpdated: counters.rowsUpdated,
      status,
      summary,
    },
    where: { id: run.id },
  });
  await db.auditLog.create({
    data: {
      action: "SYNC",
      actorId: run.triggeredById,
      metadata: asJson({
        checksum: run.checksum,
        filesCreated: counters.filesCreated,
        filesLinked: counters.filesLinked,
        phase,
        rowsCreated: counters.rowsCreated,
        rowsFailed: failed,
        rowsSkipped: counters.rowsSkipped,
        rowsUpdated: counters.rowsUpdated,
        sourceKey: LEGACY_INBOX_SOURCE_KEY,
      }),
      summary,
      targetId: run.id,
      targetType: "MigrationRun",
    },
  });
  return {
    ...counters,
    rowsFailed: failed,
    runId: run.id,
    status,
    summary,
  };
}

export async function getLegacyInboxMigrationRun(
  db: PrismaClient,
  runId: string,
) {
  const run = await db.migrationRun.findUnique({
    include: {
      issues: {
        orderBy: [{ severity: "desc" }, { rowNumber: "asc" }],
        take: 200,
      },
      source: true,
    },
    where: { id: runId },
  });
  if (!run || run.source.key !== LEGACY_INBOX_SOURCE_KEY) return null;
  return {
    checksum: run.checksum,
    completedAt: run.completedAt?.toISOString() || null,
    cursor: run.cursor,
    issues: run.issues,
    mode: run.mode,
    phase: run.phase,
    rowsCreated: run.rowsCreated,
    rowsFailed: run.rowsFailed,
    rowsRead: run.rowsRead,
    rowsSkipped: run.rowsSkipped,
    rowsUpdated: run.rowsUpdated,
    rowsValid: run.rowsValid,
    runId: run.id,
    startedAt: run.startedAt.toISOString(),
    status: run.status,
    summary: run.summary,
  };
}
