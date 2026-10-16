import "server-only";

import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  buildReconciliationPeriod,
  normalizeName,
  parseFlexibleDate,
  runReconciliationEngine,
  safeText,
} from "@/lib/reconciliation/engine";
import { parseReconciliationFiles } from "@/lib/reconciliation/excel";
import {
  cancelReconciliationGoogleOutputs,
  createPrimaryOutput,
  createSecondaryOutput,
  getPrimaryGoogleRegistry,
  getSecondaryGoogleRegistry,
  loadReconciliationAccountMappings,
  rollbackCreatedReconciliationGoogleOutputs,
  type GoogleOutput,
  type ReconciliationGoogleRegistryItem,
  type ReconciliationGoogleConfig,
} from "@/lib/reconciliation/google-output";
import {
  isReconciliationStorageConfigured,
  storeReconciliationSource,
} from "@/lib/reconciliation/storage";
import {
  RECONCILIATION_COMPANIES,
  RECONCILIATION_COMPANY_META,
  type HrEntry,
  type ReconciliationCompany,
  type ReconciliationCancelResult,
  type ReconciliationConfigStatus,
  type ReconciliationEngineResult,
  type ReconciliationHistoryItem,
  type ReconciliationPeriod,
  type ReconciliationRunResult,
  type ReconciliationWorkspaceData,
} from "@/lib/reconciliation/types";

const CONFIG_KEYS = [
  "reconcile.accountTitleSpreadsheetId",
  "reconcile.accountTitleSheetName",
  "reconcile.primaryTemplateSpreadsheetId",
  "reconcile.primaryTemplateSheetName",
  "reconcile.secondaryTemplateSpreadsheetId",
  "reconcile.secondaryTemplateSheetName",
  "reconcile.secondaryOutputFolderId",
] as const;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

export function canUseReconciliation(session: AppSession) {
  return (
    session.fullAccess ||
    session.roles.includes("admin") ||
    session.modules.includes("reconciliation") ||
    session.moduleGroups.includes("admin-execution")
  );
}

export function canRunReconciliation(session: AppSession) {
  if (session.fullAccess && session.roles.includes("super-admin")) return true;
  const actionPermissions = session.permissions.filter((permission) =>
    permission.startsWith("portal.reconciliation."),
  );
  if (actionPermissions.length) {
    return (
      actionPermissions.includes("portal.reconciliation.edit") ||
      actionPermissions.includes("portal.reconciliation.delete")
    );
  }
  return (
    session.roles.includes("admin") ||
    session.modules.includes("reconciliation") ||
    session.moduleGroups.includes("admin-execution")
  );
}

export function canCancelReconciliation(session: AppSession) {
  if (session.fullAccess && session.roles.includes("super-admin")) return true;
  const actionPermissions = session.permissions.filter((permission) =>
    permission.startsWith("portal.reconciliation."),
  );
  if (actionPermissions.length) {
    return actionPermissions.includes("portal.reconciliation.delete");
  }
  return (
    session.roles.includes("admin") ||
    session.moduleGroups.includes("admin-execution")
  );
}

export function assertReconciliationAccess(session: AppSession) {
  if (!canUseReconciliation(session)) {
    throw new Error("Tài khoản chưa có quyền dùng module Đối soát.");
  }
}

async function loadGoogleConfig(db: PrismaClient) {
  const rows = await db.systemSetting.findMany({
    select: { key: true, value: true },
    where: { key: { in: [...CONFIG_KEYS] } },
  });
  const map = new Map(rows.map((row) => [row.key, safeText(row.value)]));
  const config: ReconciliationGoogleConfig = {
    accountTitleSheetName:
      map.get("reconcile.accountTitleSheetName") || "Account chức danh",
    accountTitleSpreadsheetId:
      map.get("reconcile.accountTitleSpreadsheetId") ||
      "1knzrSE1fL9TCOfm0PjoyVLQMVRb10sw2qskPdFq3Zco",
    primarySpreadsheetId:
      map.get("reconcile.primaryTemplateSpreadsheetId") ||
      "1NyB7WpdXsmjSbf1BX2jXpZD21Tr9LhCkLzRQjhzX0Tw",
    primaryTemplateSheetName:
      map.get("reconcile.primaryTemplateSheetName") || "T02.2026",
    secondaryOutputFolderId:
      map.get("reconcile.secondaryOutputFolderId") ||
      "1f_E4b1V26fgdvqwuwjrAnvFwU6N2Vi-z",
    secondaryTemplateSheetName:
      map.get("reconcile.secondaryTemplateSheetName") ||
      "BR T02.26 - GLOBAL",
    secondaryTemplateSpreadsheetId:
      map.get("reconcile.secondaryTemplateSpreadsheetId") ||
      "1PhGyE4asJu6Y75JVafvw8a3cEeBbVn8WlBa_iIqIDxY",
  };
  return config;
}

function configStatus(
  config: ReconciliationGoogleConfig,
): ReconciliationConfigStatus {
  const missing: string[] = [];
  if (!config.primarySpreadsheetId) {
    missing.push("Spreadsheet mẫu tổng hợp");
  }
  if (!config.secondaryTemplateSpreadsheetId) {
    missing.push("Spreadsheet mẫu BaseReward");
  }
  if (!config.secondaryOutputFolderId) {
    missing.push("Folder output BaseReward");
  }
  const storageConfigured = Boolean(
    (process.env.ACCOUNTING_EXPORT_BUCKET || "").trim(),
  );
  if (!storageConfigured) {
    missing.push("Cloud Storage file nguồn");
  }
  return {
    missing,
    primaryConfigured: Boolean(config.primarySpreadsheetId),
    secondaryConfigured: Boolean(
      config.secondaryTemplateSpreadsheetId &&
        config.secondaryOutputFolderId,
    ),
    storageConfigured,
  };
}

function formatUpdatedAt(date: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function outputHistoryItem(output: {
  kind: string;
  periodKey: string;
  sheetName: string | null;
  spreadsheetUrl: string | null;
  status: string;
  updatedAt: Date;
}): ReconciliationHistoryItem {
  return {
    kind: output.kind === "PRIMARY" ? "PRIMARY" : "SECONDARY",
    link: output.spreadsheetUrl ?? "",
    name:
      output.kind === "PRIMARY"
        ? output.sheetName || output.periodKey
        : `[${output.periodKey.replace(".", "/")}] BaseReward`,
    periodCode: output.periodKey,
    status: output.status,
    updatedLabel: formatUpdatedAt(output.updatedAt),
  };
}

function googleRegistryHistoryItem(
  item: ReconciliationGoogleRegistryItem,
  kind: "PRIMARY" | "SECONDARY",
): ReconciliationHistoryItem {
  return {
    kind,
    link: item.link,
    name: item.name,
    periodCode: item.periodCode,
    status: "LIVE",
    updatedLabel: item.updatedLabel,
  };
}

function registryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/Drive|Google|credential|auth/i.test(message)) {
    return "Chưa tải được lịch sử từ Google Drive. Bấm tải lại sau vài giây nha.";
  }
  return message || "Chưa tải được lịch sử đối soát.";
}

export async function getReconciliationWorkspace(
  session: AppSession,
): Promise<ReconciliationWorkspaceData> {
  assertReconciliationAccess(session);
  const db = getDb();
  const config = await loadGoogleConfig(db);
  const [primaryRows, secondaryRows, primaryLive, secondaryLive] =
    await Promise.all([
    db.reconciliationOutput.findMany({
      orderBy: { updatedAt: "desc" },
      take: 20,
      where: {
        kind: "PRIMARY",
        spreadsheetUrl: { not: null },
        status: { in: ["COMPLETED", "EXISTING"] },
      },
    }),
    db.reconciliationOutput.findMany({
      orderBy: { updatedAt: "desc" },
      take: 12,
      where: {
        kind: "SECONDARY",
        spreadsheetUrl: { not: null },
        status: { in: ["COMPLETED", "EXISTING"] },
      },
    }),
    getPrimaryGoogleRegistry(config)
      .then((value) => ({ error: "", value }))
      .catch((error) => ({
        error: registryError(error),
        value: null,
      })),
    getSecondaryGoogleRegistry(config)
      .then((value) => ({ error: "", value }))
      .catch((error) => ({
        error: registryError(error),
        value: [] as ReconciliationGoogleRegistryItem[],
      })),
  ]);
  const status = configStatus(config);
  const primary = primaryLive.value
    ? googleRegistryHistoryItem(primaryLive.value, "PRIMARY")
    : primaryRows[0]
      ? outputHistoryItem(primaryRows[0])
      : null;
  const secondaryFromGoogle = secondaryLive.value.map((item) =>
    googleRegistryHistoryItem(item, "SECONDARY"),
  );
  const secondary = [
    ...secondaryFromGoogle,
    ...secondaryRows
      .map(outputHistoryItem)
      .filter(
        (item) =>
          !secondaryFromGoogle.some(
            (liveItem) => liveItem.periodCode === item.periodCode,
          ),
      ),
  ].slice(0, 12);
  return {
    canCancel: canCancelReconciliation(session),
    config: status,
    primary,
    primaryError: primaryLive.error
      ? primaryLive.error
      : primary || !status.primaryConfigured
        ? status.primaryConfigured
          ? ""
          : "Chưa cấu hình Spreadsheet mẫu tổng hợp."
        : "Chưa tìm thấy kỳ nào trong bảng tổng hợp.",
    secondary,
    secondaryError: secondaryLive.error
      ? secondaryLive.error
      : secondary.length || !status.secondaryConfigured
        ? status.secondaryConfigured
          ? ""
          : "Chưa cấu hình mẫu hoặc folder đầu ra BaseReward."
        : "Chưa thấy file bảng kê nào trong folder theo dõi.",
  };
}

export async function cancelReconciliationPeriod(input: {
  month: number;
  session: AppSession;
  year: number;
}): Promise<ReconciliationCancelResult> {
  assertReconciliationAccess(input.session);
  if (!canCancelReconciliation(input.session)) {
    throw new Error("Tài khoản chưa có quyền hủy bảng kê Đối soát.");
  }

  const period = buildReconciliationPeriod(input.month, input.year);
  const db = getDb();
  const processingRun = await db.reconciliationRun.findFirst({
    select: { id: true },
    where: { periodKey: period.periodKey, status: "PROCESSING" },
  });
  if (processingRun) {
    throw new Error(
      `Kỳ ${period.periodKey} đang được tạo. Hãy chờ hoàn tất rồi mới hủy.`,
    );
  }

  const [config, outputRows] = await Promise.all([
    loadGoogleConfig(db),
    db.reconciliationOutput.findMany({
      select: { id: true, status: true },
      where: { periodKey: period.periodKey },
    }),
  ]);
  if (outputRows.length) {
    await db.reconciliationOutput.updateMany({
      data: { status: "CANCELLING" },
      where: { id: { in: outputRows.map((output) => output.id) } },
    });
  }

  let googleResult;
  try {
    googleResult = await cancelReconciliationGoogleOutputs({ config, period });
  } catch (error) {
    if (outputRows.length) {
      await db
        .$transaction(
          outputRows.map((output) =>
            db.reconciliationOutput.update({
              data: { status: output.status },
              where: { id: output.id },
            }),
          ),
        )
        .catch(() => undefined);
    }
    throw error;
  }

  const now = new Date();
  const secondaryDriveIds = googleResult.secondaryDeleted.map(
    (file) => file.id,
  );
  await db.$transaction(async (tx) => {
    await tx.reconciliationOutput.updateMany({
      data: { status: "CANCELLED" },
      where: { periodKey: period.periodKey },
    });
    await tx.reconciliationRun.updateMany({
      data: {
        completedAt: now,
        status: "CANCELLED",
      },
      where: {
        periodKey: period.periodKey,
        status: { not: "PROCESSING" },
      },
    });
    if (secondaryDriveIds.length) {
      await tx.fileObject.updateMany({
        data: {
          archivedAt: now,
          status: "ARCHIVED",
        },
        where: { sourceDriveId: { in: secondaryDriveIds } },
      });
    }
    await tx.auditLog.create({
      data: {
        action: "VOID",
        actorId: input.session.userId,
        metadata: asJson({
          primaryDeleted: googleResult.primaryDeleted,
          secondaryDeleted: googleResult.secondaryDeleted,
        }),
        summary: `Hủy bảng kê Đối soát kỳ ${period.periodKey}.`,
        targetId: period.periodKey,
        targetType: "ReconciliationPeriod",
      },
    });
  });

  const removedParts = [
    googleResult.primaryDeleted ? "tab tổng hợp" : "",
    googleResult.secondaryDeleted.length
      ? `${googleResult.secondaryDeleted.length} file chi tiết`
      : "",
  ].filter(Boolean);
  const message = removedParts.length
    ? `Đã hủy kỳ ${period.periodKey}: ${removedParts.join(" và ")}. Ông có thể tạo lại kỳ này ngay.`
    : `Kỳ ${period.periodKey} không còn đầu ra Google; trạng thái cũ đã được dọn để có thể tạo lại.`;

  return {
    message,
    ok: true,
    periodCode: period.periodKey,
    primaryDeleted: googleResult.primaryDeleted,
    secondaryDeleted: googleResult.secondaryDeleted.length,
    workspace: await getReconciliationWorkspace(input.session),
  };
}

function canonicalCompany(
  legalName: string | null | undefined,
  shortName: string | null | undefined,
): ReconciliationCompany {
  const candidates = [legalName, shortName].map(normalizeName).filter(Boolean);
  for (const company of RECONCILIATION_COMPANIES) {
    const variants =
      company === "Thuần Việt Global"
        ? [company, "Global", "TVG"]
        : company === "Thuần Việt Digital"
          ? [company, "Digital", "TVD"]
          : [company, "Thành Công", "Nem Thanh Cong", "NTC"];
    if (
      variants.some((variant) => candidates.includes(normalizeName(variant)))
    ) {
      return company;
    }
  }
  return "Nệm Thành Công";
}

async function loadHrEntries(
  db: PrismaClient,
  period: ReconciliationPeriod,
): Promise<HrEntry[]> {
  const rows = await db.employee.findMany({
    include: {
      company: { select: { legalName: true, shortName: true } },
      personnelIdentityMemberships: {
        include: {
          link: {
            include: {
              primaryEmployee: {
                include: {
                  company: {
                    select: { legalName: true, shortName: true },
                  },
                  user: {
                    select: {
                      displayName: true,
                      status: true,
                      username: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      user: {
        select: { displayName: true, status: true, username: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    where: { archivedAt: null, status: "ACTIVE" },
  });
  const result: HrEntry[] = [];
  for (const row of rows) {
    if (row.terminationDate) {
      const termination = parseFlexibleDate(row.terminationDate);
      if (!termination || termination.getTime() < period.from.getTime()) {
        continue;
      }
    }
    const identityLink = row.personnelIdentityMemberships.find(
      (membership) => membership.link.status === "ACTIVE",
    )?.link;
    const primary = identityLink?.primaryEmployee ?? row;
    const nameKey = normalizeName(primary.fullName);
    if (!nameKey) continue;
    const accountNames = [
      row.title,
      row.user?.displayName &&
      normalizeName(row.user.displayName) !== normalizeName(row.fullName)
        ? row.user.displayName
        : "",
      primary.title,
      primary.user?.displayName &&
      normalizeName(primary.user.displayName) !== nameKey
        ? primary.user.displayName
        : "",
    ]
      .map(safeText)
      .filter(Boolean);
    const usernames = [
      primary.user?.status === "ACTIVE" ? primary.user.username : "",
      row.user?.status === "ACTIVE" ? row.user.username : "",
    ]
      .map(safeText)
      .filter(Boolean);
    result.push({
      accountNames: [...new Set(accountNames)],
      aliases: [...new Set([row.fullName, primary.fullName].map(safeText))],
      company: canonicalCompany(
        primary.company?.legalName,
        primary.company?.shortName,
      ),
      department: safeText(primary.department || row.department),
      employeeCode: primary.employeeCode,
      employeeName: primary.fullName,
      username: usernames[0] ?? "",
      usernames: [...new Set(usernames)],
    });
  }
  return result;
}

async function createRun(
  db: PrismaClient,
  period: ReconciliationPeriod,
  userId: string,
) {
  const aggregate = await db.reconciliationRun.aggregate({
    _max: { attempt: true },
    where: { periodKey: period.periodKey },
  });
  return db.reconciliationRun.create({
    data: {
      attempt: (aggregate._max.attempt ?? 0) + 1,
      createdById: userId,
      fromDate: period.from,
      month: period.month,
      periodKey: period.periodKey,
      status: "PROCESSING",
      toDate: period.to,
      year: period.year,
    },
  });
}

async function persistEngine(
  db: PrismaClient,
  runId: string,
  engine: ReconciliationEngineResult,
) {
  if (engine.details.length) {
    await db.reconciliationDetail.createMany({
      data: engine.details.map((row) => ({
        accountMatched: row.accountMatched,
        brand: row.brand || null,
        category: row.category || null,
        company: row.company,
        customerCode: row.customerCode || null,
        department: row.department || null,
        employeeCode: row.employeeCode || null,
        employeeName: row.employeeName || null,
        exchangeTime: row.exchangeTime,
        giftName: row.giftName || null,
        hrMatched: row.hrMatched,
        occurrence: row.occurrence,
        orderCode: row.orderCode || null,
        program: row.program || null,
        quantity: Math.round(row.quantity || 1),
        rawBaseReward: asJson(row.rawBaseReward),
        rawEmployeeName: row.rawEmployeeName || null,
        rawUrbox: asJson(row.rawUrbox),
        runId,
        sourceRow: row.sourceRow,
        transactionCode: row.transactionCode || null,
        username: row.username || null,
        value: row.value,
      })),
    });
  }
  if (engine.issues.length) {
    await db.reconciliationIssue.createMany({
      data: engine.issues.map((issue) => ({
        code: issue.code,
        message: issue.message,
        metadata: asJson(issue.metadata),
        runId,
        severity: issue.severity || "WARNING",
        sourceRow: issue.sourceRow,
        transactionCode: issue.transactionCode,
      })),
    });
  }
}

async function ensureDriveFileObject(
  db: PrismaClient,
  output: GoogleOutput,
  userId: string,
) {
  return db.fileObject.upsert({
    create: {
      metadata: asJson({ source: "RECONCILIATION_OUTPUT" }),
      migrationState: "LINKED_DRIVE",
      mimeType: "application/vnd.google-apps.spreadsheet",
      objectKey: output.driveFileId,
      originalName: output.name,
      ownerId: userId,
      provider: "GOOGLE_DRIVE",
      sourceDriveId: output.driveFileId,
      versions: {
        create: {
          metadata: asJson({ source: "RECONCILIATION_OUTPUT" }),
          mimeType: "application/vnd.google-apps.spreadsheet",
          objectKey: output.driveFileId,
          provider: "GOOGLE_DRIVE",
          sourceDriveId: output.driveFileId,
          uploadedById: userId,
          versionNumber: 1,
        },
      },
    },
    update: {
      archivedAt: null,
      originalName: output.name,
      status: "ACTIVE",
    },
    where: { sourceDriveId: output.driveFileId },
  });
}

async function saveOutput(
  db: PrismaClient,
  input: {
    kind: "PRIMARY" | "SECONDARY";
    output: GoogleOutput;
    period: ReconciliationPeriod;
    runId: string;
    userId: string;
  },
) {
  const fileObject = await ensureDriveFileObject(
    db,
    input.output,
    input.userId,
  );
  return db.reconciliationOutput.upsert({
    create: {
      driveFileId: input.output.driveFileId,
      fileObjectId: fileObject.id,
      kind: input.kind,
      metadata: asJson({ existed: input.output.existed }),
      periodKey: input.period.periodKey,
      runId: input.runId,
      sheetName: input.output.sheetName,
      spreadsheetUrl: input.output.url,
      status: input.output.existed ? "EXISTING" : "COMPLETED",
    },
    update: {
      driveFileId: input.output.driveFileId,
      fileObjectId: fileObject.id,
      metadata: asJson({ existed: input.output.existed }),
      runId: input.runId,
      sheetName: input.output.sheetName,
      spreadsheetUrl: input.output.url,
      status: input.output.existed ? "EXISTING" : "COMPLETED",
    },
    where: {
      periodKey_kind: {
        kind: input.kind,
        periodKey: input.period.periodKey,
      },
    },
  });
}

async function saveOutputStatus(
  db: PrismaClient,
  input: {
    error?: string;
    kind: "PRIMARY" | "SECONDARY";
    period: ReconciliationPeriod;
    runId: string;
    status: "MISSING_CONFIG" | "FAILED";
  },
) {
  return db.reconciliationOutput.upsert({
    create: {
      kind: input.kind,
      metadata: asJson({ error: input.error || "" }),
      periodKey: input.period.periodKey,
      runId: input.runId,
      status: input.status,
    },
    update: {
      driveFileId: null,
      fileObjectId: null,
      metadata: asJson({ error: input.error || "" }),
      runId: input.runId,
      sheetName: null,
      spreadsheetUrl: null,
      status: input.status,
    },
    where: {
      periodKey_kind: {
        kind: input.kind,
        periodKey: input.period.periodKey,
      },
    },
  });
}

function buildMessage(input: {
  missing: string[];
  primary?: GoogleOutput;
  secondary?: GoogleOutput;
}) {
  if (input.missing.length) {
    return (
      "Đã lưu kết quả đối soát vào PostgreSQL. " +
      `Còn cảnh báo cần kiểm tra: ${input.missing.join(", ")}.`
    );
  }
  if (input.primary?.existed && input.secondary?.existed) {
    return "Kỳ này đã có đủ bảng tổng hợp và bảng chi tiết, hệ thống không tạo trùng.";
  }
  if (input.primary?.existed && !input.secondary?.existed) {
    return "Bảng tổng hợp đã có sẵn; hệ thống chỉ tạo bảng chi tiết còn thiếu.";
  }
  if (!input.primary?.existed && input.secondary?.existed) {
    return "Bảng chi tiết đã có sẵn; hệ thống chỉ tạo bảng tổng hợp còn thiếu.";
  }
  return "Đã tạo xong bảng tổng hợp và bảng kê BaseReward.";
}

export async function runReconciliation(input: {
  files: File[];
  month: number;
  session: AppSession;
  year: number;
}): Promise<ReconciliationRunResult> {
  assertReconciliationAccess(input.session);
  if (!canRunReconciliation(input.session)) {
    throw new Error("Tài khoản chỉ có quyền xem, chưa được phép tạo đối soát.");
  }
  const period = buildReconciliationPeriod(input.month, input.year);
  const parsed = await parseReconciliationFiles(input.files);
  const db = getDb();
  const run = await createRun(db, period, input.session.userId);

  try {
    const sourceWarnings: string[] = [];
    if (isReconciliationStorageConfigured()) {
      const sourceInputs = [
        { item: parsed.urbox, kind: "URBOX" as const },
        { item: parsed.baseReward, kind: "BASE_REWARD" as const },
      ];
      for (const source of sourceInputs) {
        try {
          const fileObject = await storeReconciliationSource(db, {
            buffer: source.item.buffer,
            fileName: source.item.parsed.fileName,
            kind: source.kind,
            mimeType:
              input.files.find(
                (file) => file.name === source.item.parsed.fileName,
              )?.type || "application/octet-stream",
            periodKey: period.periodKey,
            runId: run.id,
            sheetName: source.item.parsed.sheetName,
            userId: input.session.userId,
          });
          await db.reconciliationSourceFile.create({
            data: {
              checksum: fileObject.sha256,
              fileObjectId: fileObject.id,
              kind: source.kind,
              originalSheetName: source.item.parsed.sheetName,
              rowCount: source.item.parsed.rows.length,
              runId: run.id,
            },
          });
        } catch (error) {
          sourceWarnings.push(
            `Lưu file nguồn ${source.kind === "URBOX" ? "Urbox" : "BaseReward"}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      }
    }

    const config = await loadGoogleConfig(db);
    const [hrEntries, accountMappingResult, previousOutputs] = await Promise.all([
      loadHrEntries(db, period),
      loadReconciliationAccountMappings(config)
        .then((value) => ({ error: "", value }))
        .catch((error) => ({
          error: error instanceof Error ? error.message : String(error),
          value: [],
        })),
      db.reconciliationOutput.findMany({
        select: { kind: true, status: true },
        where: { periodKey: period.periodKey },
      }),
    ]);
    if (accountMappingResult.error) {
      sourceWarnings.push(
        `Mapping Account chức danh: ${accountMappingResult.error}`,
      );
    }
    const engine = runReconciliationEngine({
      accountMappings: accountMappingResult.value,
      baseRewardRows: parsed.baseReward.parsed.rows,
      hrEntries,
      period,
      urboxRows: parsed.urbox.parsed.rows,
    });
    await persistEngine(db, run.id, engine);

    const status = configStatus(config);
    const missing = [...new Set([...status.missing, ...sourceWarnings])];
    let primary: GoogleOutput | undefined;
    let secondary: GoogleOutput | undefined;
    const outputErrors: string[] = [];
    const createdOutputs: {
      kind: "PRIMARY" | "SECONDARY";
      output: GoogleOutput;
    }[] = [];

    if (status.primaryConfigured) {
      try {
        primary = await createPrimaryOutput({
          config,
          engine,
          period,
          replaceExisting: previousOutputs.some(
            (output) =>
              output.kind === "PRIMARY" && output.status === "FAILED",
          ),
        });
        await saveOutput(db, {
          kind: "PRIMARY",
          output: primary,
          period,
          runId: run.id,
          userId: input.session.userId,
        });
        if (!primary.existed) {
          createdOutputs.push({ kind: "PRIMARY", output: primary });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        outputErrors.push(`Bảng tổng hợp: ${message}`);
        await saveOutputStatus(db, {
          error: message,
          kind: "PRIMARY",
          period,
          runId: run.id,
          status: "FAILED",
        });
      }
    } else {
      outputErrors.push(
        "Bảng tổng hợp: thiếu Spreadsheet mẫu tổng hợp.",
      );
      await saveOutputStatus(db, {
        error: "Thiếu Spreadsheet mẫu tổng hợp.",
        kind: "PRIMARY",
        period,
        runId: run.id,
        status: "MISSING_CONFIG",
      });
    }

    if (status.secondaryConfigured) {
      try {
        secondary = await createSecondaryOutput({ config, engine, period });
        await saveOutput(db, {
          kind: "SECONDARY",
          output: secondary,
          period,
          runId: run.id,
          userId: input.session.userId,
        });
        if (!secondary.existed) {
          createdOutputs.push({ kind: "SECONDARY", output: secondary });
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        outputErrors.push(`Bảng chi tiết: ${message}`);
        await saveOutputStatus(db, {
          error: message,
          kind: "SECONDARY",
          period,
          runId: run.id,
          status: "FAILED",
        });
      }
    } else {
      outputErrors.push(
        "Bảng chi tiết: thiếu Spreadsheet mẫu hoặc folder output BaseReward.",
      );
      await saveOutputStatus(db, {
        error: "Thiếu Spreadsheet mẫu hoặc folder output BaseReward.",
        kind: "SECONDARY",
        period,
        runId: run.id,
        status: "MISSING_CONFIG",
      });
    }

    if (outputErrors.length && createdOutputs.length) {
      let rollbackError = "";
      try {
        await rollbackCreatedReconciliationGoogleOutputs({
          config,
          outputs: createdOutputs,
        });
      } catch (error) {
        rollbackError =
          error instanceof Error ? error.message : String(error);
        outputErrors.push(`Hoàn tác đầu ra: ${rollbackError}`);
      }
      for (const created of createdOutputs) {
        await saveOutputStatus(db, {
          error: rollbackError
            ? `Đầu ra còn lại bị lỗi; hoàn tác chưa trọn vẹn: ${rollbackError}`
            : "Đã hoàn tác vì đầu ra còn lại không tạo thành công.",
          kind: created.kind,
          period,
          runId: run.id,
          status: "FAILED",
        });
      }
      primary =
        primary && primary.existed ? primary : undefined;
      secondary =
        secondary && secondary.existed ? secondary : undefined;
    }

    const warnings = [...missing, ...outputErrors];
    const summary = {
      accountResolvedCount: engine.accountResolvedCount,
      baseRewardRows: parsed.baseReward.parsed.rows.length,
      fallbackCompanyCount: engine.fallbackCompanyCount,
      matchedTransactions: engine.matchedTransactions,
      missingConfig: warnings,
      rowsInPeriod: engine.rowsInPeriod,
      totalAmount: engine.totalAmount,
      urboxRows: parsed.urbox.parsed.rows.length,
      voucherRowCounts: Object.fromEntries(
        RECONCILIATION_COMPANIES.map((company) => [
          RECONCILIATION_COMPANY_META[company].shortLabel,
          engine.voucherRowsByCompany[company].length,
        ]),
      ),
    };
    if (outputErrors.length) {
      const message =
        `Không thể hoàn tất kỳ ${period.periodKey}. ` +
        outputErrors.join(" ");
      await db.reconciliationRun.update({
        data: {
          completedAt: new Date(),
          error: message,
          metadata: asJson({
            baseRewardSheet: parsed.baseReward.parsed.sheetName,
            urboxSheet: parsed.urbox.parsed.sheetName,
          }),
          status: "FAILED",
          summary: JSON.stringify(summary),
        },
        where: { id: run.id },
      });
      throw new Error(message);
    }
    await db.reconciliationRun.update({
      data: {
        accountResolved: engine.accountResolvedCount,
        completedAt: new Date(),
        fallbackCompany: engine.fallbackCompanyCount,
        matchedTransactions: engine.matchedTransactions,
        metadata: asJson({
          baseRewardSheet: parsed.baseReward.parsed.sheetName,
          formulaPolicy: {
            companyStats: "value * source quantity",
            userStats: "value per detail, intentionally not quantity",
            voucherQuantity: "matched detail row count",
          },
          urboxSheet: parsed.urbox.parsed.sheetName,
        }),
        rowsBaseReward: parsed.baseReward.parsed.rows.length,
        rowsInPeriod: engine.rowsInPeriod,
        rowsUrbox: parsed.urbox.parsed.rows.length,
        status: warnings.length ? "COMPLETED_WITH_WARNINGS" : "COMPLETED",
        summary: JSON.stringify(summary),
        totalAmount: engine.totalAmount,
      },
      where: { id: run.id },
    });
    const workspace = await getReconciliationWorkspace(input.session);
    return {
      message: buildMessage({ missing: warnings, primary, secondary }),
      ok: true,
      primaryCreated: primary ? !primary.existed : false,
      primaryLink: primary?.url,
      runId: run.id,
      secondaryCreated: secondary ? !secondary.existed : false,
      secondaryLink: secondary?.url,
      summary,
      workspace,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.reconciliationRun
      .update({
        data: { completedAt: new Date(), error: message, status: "FAILED" },
        where: { id: run.id },
      })
      .catch(() => undefined);
    throw error;
  }
}
