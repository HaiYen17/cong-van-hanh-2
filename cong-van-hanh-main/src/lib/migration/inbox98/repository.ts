import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import {
  buildDriveExternalId,
  buildInboxDossierExternalId,
  buildInboxExternalId,
  buildInboxItemExternalId,
  buildLegacyGcsObjectKey,
  decideIdempotentWrite,
  normalizeLegacyKey,
} from "./mapping";
import type { LegacyGoogleSource } from "./google-source";
import type {
  InboxMigrationIssue,
  InboxMigrationPhase,
  LegacyDriveFile,
  LegacyLegalDossier,
  NormalizedLegacyInboxRecord,
} from "./types";
import { LEGACY_INBOX_SOURCE_KEY } from "./types";

type TransactionClient = Prisma.TransactionClient;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function date(value: string, fallback?: Date) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime())
    ? parsed
    : fallback ?? new Date(0);
}

async function mapExternalId(
  tx: TransactionClient,
  input: {
    entityType: string;
    externalId: string;
    fingerprint?: string;
    internalId: string;
    metadata?: unknown;
    sourceId: string;
  },
) {
  return tx.externalIdMap.upsert({
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

async function resolveCreator(
  db: PrismaClient,
  employeeCode: string,
) {
  const employee = await db.employee.findUnique({
    select: {
      employeeCode: true,
      user: { select: { id: true, status: true } },
    },
    where: { employeeCode },
  });
  return employee?.user?.id ? employee : null;
}

async function resolveCompany(
  tx: TransactionClient,
  names: (string | null | undefined)[],
) {
  const values = [...new Set(names.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!values.length) return null;
  return tx.company.findFirst({
    orderBy: { createdAt: "asc" },
    where: {
      archivedAt: null,
      OR: values.flatMap((value) => [
        { code: { equals: value, mode: "insensitive" as const } },
        { legalName: { equals: value, mode: "insensitive" as const } },
        { shortName: { equals: value, mode: "insensitive" as const } },
      ]),
    },
  });
}

async function resolveDocumentType(
  tx: TransactionClient,
  dossier: LegacyLegalDossier,
) {
  if (dossier.documentTypeRow) {
    const byRow = await tx.documentType.findUnique({
      where: { legacySheetRow: dossier.documentTypeRow },
    });
    if (byRow) return byRow;
  }
  if (!dossier.documentTypeName) return null;
  return tx.documentType.findFirst({
    where: {
      name: {
        equals: dossier.documentTypeName,
        mode: "insensitive",
      },
    },
  });
}

function finalEvent(
  status: NormalizedLegacyInboxRecord["status"],
) {
  switch (status) {
    case "IN_PROGRESS":
      return { type: "PROCESSING" as const, toStatus: "IN_PROGRESS" as const };
    case "NEEDS_INFO":
      return { type: "NEEDS_INFO" as const, toStatus: "NEEDS_INFO" as const };
    case "APPROVED":
      return { type: "APPROVED" as const, toStatus: "APPROVED" as const };
    case "REJECTED":
      return { type: "REJECTED" as const, toStatus: "REJECTED" as const };
    case "COMPLETED":
      return { type: "COMPLETED" as const, toStatus: "COMPLETED" as const };
    case "CANCELLED":
      return { type: "CANCELLED" as const, toStatus: "CANCELLED" as const };
    default:
      return null;
  }
}

async function ensureRequestEvents(
  tx: TransactionClient,
  requestId: string,
  creatorId: string,
  record: NormalizedLegacyInboxRecord,
) {
  const submitted = await tx.requestEvent.findFirst({
    select: { id: true },
    where: {
      requestId,
      toStatus: "SUBMITTED",
      type: "SUBMITTED",
    },
  });
  if (!submitted) {
    await tx.requestEvent.create({
      data: {
        actorId: creatorId,
        createdAt: date(record.createdAt),
        note: record.note || null,
        requestId,
        toStatus: "SUBMITTED",
        type: "SUBMITTED",
      },
    });
  }

  const final = finalEvent(record.status);
  if (!final) return;
  const existing = await tx.requestEvent.findFirst({
    select: { id: true },
    where: {
      requestId,
      toStatus: final.toStatus,
      type: final.type,
    },
  });
  if (existing) return;
  await tx.requestEvent.create({
    data: {
      // Nguồn 98_Inbox không lưu MNV admin xử lý; tuyệt đối không gán nhầm
      // người tạo hoặc người đang chạy importer cho sự kiện quản trị.
      actorId: null,
      createdAt: date(record.updatedAt, date(record.createdAt)),
      fromStatus: "SUBMITTED",
      note: record.note || null,
      requestId,
      toStatus: final.toStatus,
      type: final.type,
    },
  });
}

async function upsertDocumentRegistry(
  tx: TransactionClient,
  input: {
    company: Awaited<ReturnType<typeof resolveCompany>>;
    creatorId: string;
    creatorName: string;
    dossier: LegacyLegalDossier;
    documentType: Awaited<ReturnType<typeof resolveDocumentType>>;
    record: NormalizedLegacyInboxRecord;
    sourceId: string;
  },
) {
  if (!input.dossier.documentNumber) return null;
  const externalId = `${buildInboxExternalId(
    input.record.requestCode,
  )}:registry:${input.dossier.legacyRegistryId}`;
  const mapped = await tx.externalIdMap.findUnique({
    where: {
      sourceId_entityType_externalId: {
        entityType: "DocumentRegistry",
        externalId,
        sourceId: input.sourceId,
      },
    },
  });
  const signDate = date(
    input.dossier.signDate || input.dossier.storageIssuedDate,
    date(input.record.createdAt),
  );
  const serial = input.dossier.serial || 1;
  // Nếu payload cũ không còn poolKey/cycleKey thì dùng pool riêng theo registry.
  // Cách này giữ số đã cấp nguyên trạng và không va unique(poolKey, serial).
  const poolKey = `LEGACY:${input.dossier.legacyRegistryId}`;
  const registryData = {
    companyId: input.company?.id,
    companyShort:
      input.company?.shortName ||
      input.dossier.companyShortName ||
      input.dossier.companyName ||
      "LEGACY",
    condition: input.dossier.condition || null,
    createdAt: date(input.record.createdAt),
    createdById: input.creatorId,
    createdByName: input.creatorName || null,
    cycleKey: String(signDate.getUTCFullYear()),
    documentNumber: input.dossier.documentNumber,
    documentTypeId: input.documentType?.id,
    documentTypeName:
      input.documentType?.name ||
      input.dossier.documentTypeName ||
      "Loại văn bản cũ",
    note: input.record.note || input.dossier.storageSummary || null,
    partnerAbbr: null,
    partnerName:
      input.dossier.partnerName ||
      input.dossier.storageCounterparty ||
      null,
    poolKey,
    quantity: 1,
    sealTypes: asJson([]),
    serial,
    signDate,
    status: input.record.status === "CANCELLED" ? "CANCELLED" : "ISSUED",
    updatedAt: date(input.record.updatedAt, date(input.record.createdAt)),
  };
  let registry;
  if (mapped) {
    registry = await tx.documentRegistry.update({
      data: registryData,
      where: { id: mapped.internalId },
    });
  } else {
    registry = await tx.documentRegistry.create({ data: registryData });
  }
  await mapExternalId(tx, {
    entityType: "DocumentRegistry",
    externalId,
    fingerprint: input.record.fingerprint,
    internalId: registry.id,
    metadata: {
      legacyRegistryId: input.dossier.legacyRegistryId,
      sourceRow: input.record.sourceRow,
    },
    sourceId: input.sourceId,
  });
  return registry;
}

async function upsertDossier(
  tx: TransactionClient,
  input: {
    creatorId: string;
    requestItemId: string;
    dossier: LegacyLegalDossier;
    record: NormalizedLegacyInboxRecord;
    sourceId: string;
  },
) {
  const company = await resolveCompany(tx, [
    input.dossier.companyName,
    input.dossier.companyShortName,
  ]);
  const documentType = await resolveDocumentType(tx, input.dossier);
  const registry = await upsertDocumentRegistry(tx, {
    company,
    creatorId: input.creatorId,
    creatorName: input.record.creatorName,
    dossier: input.dossier,
    documentType,
    record: input.record,
    sourceId: input.sourceId,
  });
  const takesNumber =
    input.dossier.takesNumber ?? documentType?.takesNumber ?? false;
  const numberStatus = input.dossier.documentNumber
    ? "ISSUED"
    : input.record.status === "CANCELLED"
      ? "CANCELLED_BEFORE_ISSUE"
      : takesNumber
        ? "PENDING"
        : "NONE";
  const existing = await tx.legalDossier.findUnique({
    where: { requestItemId: input.requestItemId },
  });
  const dossierData = {
    companyId: company?.id,
    companyNameSnapshot:
      company?.legalName || input.dossier.companyName || null,
    companyShortSnapshot:
      company?.shortName || input.dossier.companyShortName || null,
    conditionSnapshot:
      documentType?.condition || input.dossier.condition || null,
    documentRegistryId: registry?.id,
    documentTypeId: documentType?.id,
    documentTypeSnapshot:
      documentType?.name || input.dossier.documentTypeName || null,
    fileStatus: input.dossier.fileStatus,
    generatedStorageName: input.dossier.generatedStorageName || null,
    legacyRegistryId: input.dossier.legacyRegistryId,
    numberStatus,
    orderStatus: input.dossier.orderStatus,
    storageCounterparty: input.dossier.storageCounterparty || null,
    storageIssuedDate: input.dossier.storageIssuedDate
      ? date(input.dossier.storageIssuedDate)
      : null,
    storageRevision: input.dossier.revision,
    storageSummary: input.dossier.storageSummary || null,
    submissionOfficeKey: input.dossier.submissionOfficeKey || null,
    submissionOfficeLabel: input.dossier.submissionOfficeLabel || null,
    takesNumber,
    updatedAt: date(input.record.updatedAt, date(input.record.createdAt)),
  };
  const dossier = existing
    ? await tx.legalDossier.update({
        data: dossierData,
        where: { id: existing.id },
      })
    : await tx.legalDossier.create({
        data: {
          ...dossierData,
          createdAt: date(input.record.createdAt),
          requestItemId: input.requestItemId,
        },
      });
  const migratedEvent = await tx.legalDossierEvent.findFirst({
    select: { id: true },
    where: { dossierId: dossier.id, type: "MIGRATED_LEGACY" },
  });
  if (!migratedEvent) {
    await tx.legalDossierEvent.create({
      data: {
        actorId: null,
        createdAt: date(input.record.createdAt),
        dossierId: dossier.id,
        metadata: asJson({
          legacyRegistryId: input.dossier.legacyRegistryId,
          source: "98_Inbox",
          sourceRow: input.record.sourceRow,
        }),
        note: "Khôi phục từ lịch sử 98_Inbox.",
        toStatus: input.dossier.fileStatus,
        type: "MIGRATED_LEGACY",
      },
    });
  }
  await mapExternalId(tx, {
    entityType: "LegalDossier",
    externalId: buildInboxDossierExternalId(
      input.record.requestCode,
      input.dossier.itemIndex,
    ),
    fingerprint: input.record.fingerprint,
    internalId: dossier.id,
    metadata: {
      legacyRegistryId: input.dossier.legacyRegistryId,
      sourceRow: input.record.sourceRow,
    },
    sourceId: input.sourceId,
  });
  return dossier;
}

async function upsertItemsAndDossiers(
  tx: TransactionClient,
  input: {
    creatorId: string;
    record: NormalizedLegacyInboxRecord;
    requestId: string;
    sourceId: string;
  },
) {
  const dossierByIndex = new Map(
    input.record.legalDossiers.map((dossier) => [
      dossier.itemIndex,
      dossier,
    ]),
  );
  const preparedItems = [];
  for (const item of input.record.requestItems) {
    const row = await tx.requestItem.upsert({
      create: {
        createdAt: date(input.record.createdAt),
        itemIndex: item.itemIndex,
        legacySourceRow: input.record.sourceRow,
        payload: asJson(item.payload),
        requestId: input.requestId,
        serviceCode: input.record.serviceCode,
        status: item.status,
        title: item.title || null,
        updatedAt: date(input.record.updatedAt, date(input.record.createdAt)),
      },
      update: {
        legacySourceRow: input.record.sourceRow,
        payload: asJson(item.payload),
        serviceCode: input.record.serviceCode,
        status: item.status,
        title: item.title || null,
        updatedAt: date(input.record.updatedAt, date(input.record.createdAt)),
      },
      where: {
        requestId_itemIndex: {
          itemIndex: item.itemIndex,
          requestId: input.requestId,
        },
      },
    });
    await mapExternalId(tx, {
      entityType: "RequestItem",
      externalId: buildInboxItemExternalId(
        input.record.requestCode,
        item.itemIndex,
      ),
      fingerprint: input.record.fingerprint,
      internalId: row.id,
      metadata: { sourceRow: input.record.sourceRow },
      sourceId: input.sourceId,
    });
    const dossierInput = dossierByIndex.get(item.itemIndex);
    if (dossierInput) preparedItems.push({ dossierInput, row });
  }

  // Các bản import cũ từng đánh legacyRegistryId theo thứ tự R01/R02 trước khi
  // rule chuẩn hóa trùng mã được bổ sung. Khi V2 đổi thứ tự/mã của nhiều mục
  // trong cùng một Request, cập nhật tuần tự có thể tạm thời đụng unique key
  // của mục kế tiếp (ví dụ item 1 cần R02 trong khi item 2 vẫn đang giữ R02).
  // Chỉ giải phóng các key thực sự được tái phân bổ trong chính Request này;
  // transaction sẽ gán lại toàn bộ key chuẩn ngay bên dưới.
  if (preparedItems.length > 1) {
    const desiredByItemId = new Map(
      preparedItems.map(({ dossierInput, row }) => [
        row.id,
        dossierInput.legacyRegistryId,
      ]),
    );
    const desiredIds = new Set(desiredByItemId.values());
    const existingDossiers = await tx.legalDossier.findMany({
      select: { id: true, legacyRegistryId: true, requestItemId: true },
      where: { requestItemId: { in: [...desiredByItemId.keys()] } },
    });
    const reassignedIds = existingDossiers
      .filter(
        (existing) =>
          existing.legacyRegistryId &&
          desiredIds.has(existing.legacyRegistryId) &&
          desiredByItemId.get(existing.requestItemId) !==
            existing.legacyRegistryId,
      )
      .map((existing) => existing.id);
    if (reassignedIds.length) {
      await tx.legalDossier.updateMany({
        data: { legacyRegistryId: null },
        where: { id: { in: reassignedIds } },
      });
    }
  }

  const dossiers = [];
  for (const { dossierInput, row } of preparedItems) {
    dossiers.push(
      await upsertDossier(tx, {
        creatorId: input.creatorId,
        dossier: dossierInput,
        record: input.record,
        requestItemId: row.id,
        sourceId: input.sourceId,
      }),
    );
  }
  return dossiers;
}

async function upsertFollowUp(
  tx: TransactionClient,
  input: {
    creatorId: string;
    dossierId?: string;
    record: NormalizedLegacyInboxRecord;
    requestId: string;
  },
) {
  const followUp = input.record.followUp;
  if (!followUp) return;
  const type = normalizeLegacyKey(followUp.type).includes("SIGNEDCOPY")
    ? "SIGNED_COPY"
    : followUp.type;
  const existing = await tx.followUpRequirement.findFirst({
    where: {
      requestId: input.requestId,
      targetUserId: input.creatorId,
      type,
    },
  });
  const data = {
    blocksModules: asJson(followUp.blocksModules),
    completedAt:
      followUp.status === "COMPLETED" && followUp.completedAt
        ? date(followUp.completedAt)
        : null,
    dossierId: input.dossierId,
    metadata: asJson({
      legacyType: followUp.type,
      source: "98_Inbox",
      sourceRow: input.record.sourceRow,
    }),
    reason: followUp.reason,
    requestedAt: followUp.requestedAt
      ? date(followUp.requestedAt)
      : date(input.record.createdAt),
    status: followUp.status,
    targetUserId: input.creatorId,
    type,
    updatedAt: date(input.record.updatedAt, date(input.record.createdAt)),
  };
  if (existing) {
    await tx.followUpRequirement.update({
      data,
      where: { id: existing.id },
    });
  } else {
    await tx.followUpRequirement.create({
      data: {
        ...data,
        createdAt: date(input.record.createdAt),
        requestId: input.requestId,
      },
    });
  }
}

export type RequestImportOutcome = {
  action: "CREATED" | "SKIPPED" | "UPDATED";
  creatorId: string;
  internalId: string;
  issues: InboxMigrationIssue[];
};

export async function importRequestRecord(
  db: PrismaClient,
  input: {
    record: NormalizedLegacyInboxRecord;
    sourceId: string;
  },
): Promise<RequestImportOutcome> {
  const creator = await resolveCreator(
    db,
    input.record.creatorEmployeeCode,
  );
  if (!creator?.user?.id) {
    throw new Error(
      `Không tìm thấy User gắn MNV ${input.record.creatorEmployeeCode}; importer không dùng tài khoản người đang chạy để thay thế.`,
    );
  }
  const externalId = buildInboxExternalId(input.record.requestCode);
  const mapped = await db.externalIdMap.findUnique({
    where: {
      sourceId_entityType_externalId: {
        entityType: "Request",
        externalId,
        sourceId: input.sourceId,
      },
    },
  });
  const mappedRequest = mapped
    ? await db.request.findUnique({ where: { id: mapped.internalId } })
    : null;
  const requestByCode = mappedRequest
    ? null
    : await db.request.findUnique({
        where: { code: input.record.requestCode },
      });
  const existing = mappedRequest || requestByCode;
  const decision = decideIdempotentWrite({
    entityExists: Boolean(existing),
    existingFingerprint: mapped?.fingerprint,
    hasExternalMap: Boolean(mapped),
    nextFingerprint: input.record.fingerprint,
  });
  const issues: InboxMigrationIssue[] = [];
  const sourceUpdatedAt = date(
    input.record.updatedAt,
    date(input.record.createdAt),
  );
  const targetIsNewer =
    Boolean(existing && mapped && mapped.fingerprint !== input.record.fingerprint) &&
    existing!.updatedAt.getTime() > sourceUpdatedAt.getTime() + 1000;
  if (targetIsNewer) {
    issues.push({
      code: "TARGET_NEWER_THAN_LEGACY_SOURCE",
      field: "updatedAt",
      message:
        "Bản V3 đã được sửa sau thời điểm cập nhật cuối của 98_Inbox; importer giữ bản V3 và chỉ tiếp tục liên kết file.",
      severity: "WARNING",
    });
  }

  const result = await db.$transaction(
    async (tx) => {
      const companyNames = input.record.legalDossiers.flatMap((dossier) => [
        dossier.companyName,
        dossier.companyShortName,
      ]);
      const company = await resolveCompany(tx, companyNames);
      let request = existing;
      const requestData = {
        companyId: company?.id,
        completedAt: input.record.completedAt
          ? date(input.record.completedAt)
          : null,
        createdById: creator.user!.id,
        note: input.record.note || null,
        payload: asJson(input.record.payload),
        priority: input.record.priority,
        serviceCode: input.record.serviceCode,
        status: input.record.status,
        title: input.record.title,
        updatedAt: sourceUpdatedAt,
      };
      if (!request) {
        request = await tx.request.create({
          data: {
            ...requestData,
            code: input.record.requestCode,
            createdAt: date(input.record.createdAt),
          },
        });
      } else if (decision !== "SKIP" && !targetIsNewer) {
        request = await tx.request.update({
          data: requestData,
          where: { id: request.id },
        });
      }

      if (!targetIsNewer) {
        await ensureRequestEvents(
          tx,
          request.id,
          creator.user!.id,
          input.record,
        );
        const dossiers = await upsertItemsAndDossiers(tx, {
          creatorId: creator.user!.id,
          record: input.record,
          requestId: request.id,
          sourceId: input.sourceId,
        });
        await upsertFollowUp(tx, {
          creatorId: creator.user!.id,
          dossierId: dossiers[0]?.id,
          record: input.record,
          requestId: request.id,
        });
      }
      await mapExternalId(tx, {
        entityType: "Request",
        externalId,
        fingerprint: input.record.fingerprint,
        internalId: request.id,
        metadata: {
          importedAt: new Date().toISOString(),
          legacyUpdatedAt: input.record.updatedAt,
          sourceRow: input.record.sourceRow,
          targetNewerWasPreserved: targetIsNewer,
        },
        sourceId: input.sourceId,
      });
      return request;
    },
    { maxWait: 10_000, timeout: 60_000 },
  );

  return {
    action:
      decision === "CREATE"
        ? "CREATED"
        : decision === "SKIP" || targetIsNewer
          ? "SKIPPED"
          : "UPDATED",
    creatorId: creator.user.id,
    internalId: result.id,
    issues,
  };
}

function fileSizeForRequestAttachment(value: number | undefined | null) {
  if (!value || value <= 0 || value > 2_147_483_647) return null;
  return Math.trunc(value);
}

async function upsertLinkedDriveFile(
  db: PrismaClient,
  input: {
    descriptor: LegacyDriveFile;
    googleSource: LegacyGoogleSource;
    ownerId: string;
    record: NormalizedLegacyInboxRecord;
    requestId: string;
    sourceId: string;
  },
) {
  let metadata = null;
  let metadataIssue: InboxMigrationIssue | null = null;
  try {
    metadata = await input.googleSource.getDriveFileMetadata({
      driveFileId: input.descriptor.driveFileId,
      legacyUrl: input.descriptor.legacyUrl,
    });
    if (metadata.trashed) {
      metadataIssue = {
        code: "DRIVE_FILE_TRASHED",
        field: input.descriptor.payloadPath,
        message: `File Drive ${input.descriptor.driveFileId} đang nằm trong thùng rác; vẫn giữ liên kết để đối soát.`,
        severity: "WARNING",
      };
    }
  } catch (error) {
    metadataIssue = {
      code: "DRIVE_METADATA_UNAVAILABLE",
      field: input.descriptor.payloadPath,
      message:
        error instanceof Error
          ? `Không đọc được metadata file ${input.descriptor.driveFileId}: ${error.message}`
          : `Không đọc được metadata file ${input.descriptor.driveFileId}.`,
      severity: "WARNING",
    };
  }

  const originalName =
    metadata?.name || input.descriptor.name || `Google Drive ${input.descriptor.driveFileId}`;
  const mimeType = metadata?.mimeType || input.descriptor.mimeType || null;
  const sizeBytes = metadata?.sizeBytes ?? input.descriptor.sizeBytes ?? null;
  const legacyUrl =
    metadata?.webViewLink ||
    metadata?.legacyUrl ||
    input.descriptor.legacyUrl ||
    `https://drive.google.com/open?id=${encodeURIComponent(input.descriptor.driveFileId)}`;
  const gcsTargetObjectKey = buildLegacyGcsObjectKey(
    LEGACY_INBOX_SOURCE_KEY,
    input.descriptor.driveFileId,
    originalName,
  );

  const outcome = await db.$transaction(async (tx) => {
    let fileObject = await tx.fileObject.findUnique({
      where: { sourceDriveId: input.descriptor.driveFileId },
    });
    let created = false;
    const linkedMetadata = asJson({
      copyPlan: {
        deleteSourceAfterCopy: false,
        objectKey: gcsTargetObjectKey,
        version: 1,
      },
      drive: {
        createdTime: metadata?.createdTime,
        md5Checksum: metadata?.md5Checksum,
        modifiedTime: metadata?.modifiedTime,
        parents: metadata?.parents || [],
        trashed: metadata?.trashed || false,
        webContentLink: metadata?.webContentLink,
        webViewLink: metadata?.webViewLink,
      },
      legacyUrl,
      payloadPath: input.descriptor.payloadPath,
      requestCode: input.record.requestCode,
      source: "98_Inbox",
      sourceRow: input.record.sourceRow,
    });
    if (!fileObject) {
      created = true;
      fileObject = await tx.fileObject.create({
        data: {
          currentVersion: 1,
          metadata: linkedMetadata,
          migrationState: "LINKED_DRIVE",
          mimeType,
          objectKey: input.descriptor.driveFileId,
          originalName,
          ownerId: input.ownerId,
          provider: "GOOGLE_DRIVE",
          sha256: metadata?.sha256Checksum || null,
          sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
          sourceDriveId: input.descriptor.driveFileId,
          status: "ACTIVE",
          versions: {
            create: {
              metadata: linkedMetadata,
              mimeType,
              objectKey: input.descriptor.driveFileId,
              provider: "GOOGLE_DRIVE",
              sha256: metadata?.sha256Checksum || null,
              sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
              sourceDriveId: input.descriptor.driveFileId,
              status: "AVAILABLE",
              uploadedById: input.ownerId,
              versionNumber: 1,
            },
          },
        },
      });
    } else if (fileObject.migrationState !== "MIGRATED") {
      fileObject = await tx.fileObject.update({
        data: {
          metadata: linkedMetadata,
          mimeType,
          originalName,
          ownerId: fileObject.ownerId || input.ownerId,
          sha256: metadata?.sha256Checksum || fileObject.sha256,
          sizeBytes: sizeBytes ? BigInt(sizeBytes) : fileObject.sizeBytes,
          status: "ACTIVE",
        },
        where: { id: fileObject.id },
      });
      await tx.fileVersion.upsert({
        create: {
          metadata: linkedMetadata,
          mimeType,
          objectKey: input.descriptor.driveFileId,
          provider: "GOOGLE_DRIVE",
          sha256: metadata?.sha256Checksum || null,
          sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
          sourceDriveId: input.descriptor.driveFileId,
          status: "AVAILABLE",
          uploadedById: input.ownerId,
          versionNumber: 1,
          fileObjectId: fileObject.id,
        },
        update: {
          metadata: linkedMetadata,
          mimeType,
          sha256: metadata?.sha256Checksum || null,
          sizeBytes: sizeBytes ? BigInt(sizeBytes) : null,
          sourceDriveId: input.descriptor.driveFileId,
          status: "AVAILABLE",
        },
        where: {
          fileObjectId_versionNumber: {
            fileObjectId: fileObject.id,
            versionNumber: 1,
          },
        },
      });
    }

    await tx.fileLink.upsert({
      create: {
        entityId: input.requestId,
        entityType: "Request",
        fileObjectId: fileObject.id,
        metadata: asJson({
          legacyUrl,
          payloadPath: input.descriptor.payloadPath,
          source: "98_Inbox",
        }),
        purpose: "LEGACY_ATTACHMENT",
      },
      update: {
        metadata: asJson({
          legacyUrl,
          payloadPath: input.descriptor.payloadPath,
          source: "98_Inbox",
        }),
      },
      where: {
        fileObjectId_entityType_entityId_purpose: {
          entityId: input.requestId,
          entityType: "Request",
          fileObjectId: fileObject.id,
          purpose: "LEGACY_ATTACHMENT",
        },
      },
    });
    const attachment = await tx.requestAttachment.findFirst({
      where: {
        fileObjectId: fileObject.id,
        requestId: input.requestId,
      },
    });
    if (!attachment) {
      await tx.requestAttachment.create({
        data: {
          createdAt: date(input.record.createdAt),
          fileName: originalName,
          fileObjectId: fileObject.id,
          fileUrl: legacyUrl,
          mimeType,
          requestId: input.requestId,
          sizeBytes: fileSizeForRequestAttachment(sizeBytes),
          uploadedById: input.ownerId,
        },
      });
    }
    await mapExternalId(tx, {
      entityType: "FileObject",
      externalId: buildDriveExternalId(input.descriptor.driveFileId),
      fingerprint: metadata?.sha256Checksum || metadata?.md5Checksum,
      internalId: fileObject.id,
      metadata: {
        gcsTargetObjectKey,
        legacyUrl,
        sourceRow: input.record.sourceRow,
      },
      sourceId: input.sourceId,
    });
    return { created, fileObjectId: fileObject.id };
  });
  return { ...outcome, issue: metadataIssue };
}

export type FileImportOutcome = {
  created: number;
  issues: InboxMigrationIssue[];
  linked: number;
};

export async function importRecordFiles(
  db: PrismaClient,
  input: {
    creatorId: string;
    googleSource: LegacyGoogleSource;
    record: NormalizedLegacyInboxRecord;
    requestId: string;
    sourceId: string;
  },
): Promise<FileImportOutcome> {
  const issues: InboxMigrationIssue[] = [];
  let created = 0;
  let linked = 0;
  for (const descriptor of input.record.files) {
    if (!descriptor.driveFileId) {
      issues.push({
        code: "DRIVE_ID_MISSING",
        field: descriptor.payloadPath,
        message: `Liên kết “${descriptor.legacyUrl}” không tách được Drive ID; giữ trong raw payload để hiệu đính thủ công.`,
        severity: "WARNING",
      });
      continue;
    }
    const outcome = await upsertLinkedDriveFile(db, {
      descriptor,
      googleSource: input.googleSource,
      ownerId: input.creatorId,
      record: input.record,
      requestId: input.requestId,
      sourceId: input.sourceId,
    });
    if (outcome.created) created += 1;
    linked += 1;
    if (outcome.issue) issues.push(outcome.issue);
  }
  return { created, issues, linked };
}

export async function validateCreators(
  db: PrismaClient,
  records: NormalizedLegacyInboxRecord[],
) {
  const employeeCodes = [
    ...new Set(
      records
        .map((record) => record.creatorEmployeeCode)
        .filter(Boolean),
    ),
  ];
  const employees = await db.employee.findMany({
    select: {
      employeeCode: true,
      user: { select: { id: true } },
    },
    where: { employeeCode: { in: employeeCodes } },
  });
  const resolvable = new Set(
    employees
      .filter((employee) => employee.user?.id)
      .map((employee) => employee.employeeCode),
  );
  return records.map((record) => {
    if (
      !record.creatorEmployeeCode ||
      resolvable.has(record.creatorEmployeeCode)
    ) {
      return record;
    }
    return {
      ...record,
      issues: [
        ...record.issues,
        {
          code: "CREATOR_USER_NOT_RESOLVED",
          field: "MNV Người tạo",
          message: `MNV ${record.creatorEmployeeCode} chưa có User liên kết trong V3. Dòng này sẽ không được gán cho tài khoản người chạy.`,
          severity: "ERROR" as const,
        },
      ],
    };
  });
}

export async function applyNormalizedRecord(
  db: PrismaClient,
  input: {
    googleSource: LegacyGoogleSource;
    phase: InboxMigrationPhase;
    record: NormalizedLegacyInboxRecord;
    sourceId: string;
  },
) {
  let requestOutcome: RequestImportOutcome | null = null;
  if (input.phase === "ALL" || input.phase === "REQUESTS") {
    requestOutcome = await importRequestRecord(db, {
      record: input.record,
      sourceId: input.sourceId,
    });
  }
  if (!requestOutcome) {
    const mapping = await db.externalIdMap.findUnique({
      where: {
        sourceId_entityType_externalId: {
          entityType: "Request",
          externalId: buildInboxExternalId(input.record.requestCode),
          sourceId: input.sourceId,
        },
      },
    });
    if (!mapping) {
      throw new Error(
        `Chưa có Request cho ${input.record.requestCode}; hãy chạy phase REQUESTS trước FILES.`,
      );
    }
    const request = await db.request.findUnique({
      where: { id: mapping.internalId },
    });
    if (!request) {
      throw new Error(
        `ExternalIdMap của ${input.record.requestCode} trỏ tới Request không còn tồn tại.`,
      );
    }
    const creator = await resolveCreator(
      db,
      input.record.creatorEmployeeCode,
    );
    if (!creator?.user?.id) {
      throw new Error(
        `Không tìm thấy User gắn MNV ${input.record.creatorEmployeeCode}.`,
      );
    }
    requestOutcome = {
      action: "SKIPPED",
      creatorId: creator.user.id,
      internalId: request.id,
      issues: [],
    };
  }

  const fileOutcome =
    input.phase === "ALL" || input.phase === "FILES"
      ? await importRecordFiles(db, {
          creatorId: requestOutcome.creatorId,
          googleSource: input.googleSource,
          record: input.record,
          requestId: requestOutcome.internalId,
          sourceId: input.sourceId,
        })
      : { created: 0, issues: [], linked: 0 };
  return {
    action: requestOutcome.action,
    fileOutcome,
    internalId: requestOutcome.internalId,
    issues: [...requestOutcome.issues, ...fileOutcome.issues],
  };
}
