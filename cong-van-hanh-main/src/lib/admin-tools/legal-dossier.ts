import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { isElectronicSignatureItem } from "@/lib/requests/electronic-signature-payload";

import { followUpBlocksAnyModule } from "./follow-up-lock";
import {
  buildLegalDossierStorageName,
  isContractLikeDocumentType,
  normalizeVietnamese,
} from "./storage-name";

const SEAL_SERVICE = "document-seal";
const STORAGE_SERVICE = "document-archive";
const DOSSIER_ENTITY = "LEGAL_DOSSIER";
const STORED_FILE_PURPOSE = "STORED_COPY";

type JsonObject = Record<string, unknown>;

export type LegalDossierEventDto = {
  actorName: string;
  createdAt: string;
  note: string;
  type: string;
};

export type LegalDossierQueueItem = {
  companyName: string;
  companyShortName: string;
  condition: string;
  createdAt: string;
  creatorName: string;
  detail: string;
  documentNumber: string;
  documentTypeName: string;
  events: LegalDossierEventDto[];
  fileCount: number;
  fileStatus: string;
  followUpPending: boolean;
  generatedStorageName: string;
  id: string;
  itemIndex: number;
  kind: "seal" | "storage";
  needsCounterparty: boolean;
  numberStatus: string;
  officeKey: string;
  officeLabel: string;
  orderStatus: string;
  partner: string;
  requestCode: string;
  requestId: string;
  requestTitle: string;
  sourceDocumentName: string;
  sourceShortName: string;
  sourceStampTypes: string[];
  storageCounterparty: string;
  storageIssuedDate: string;
  storageRevision: string;
  storageSummary: string;
  takesNumber: boolean;
};

export type LegalDossierCompanyOption = {
  label: string;
  shortName: string;
};

export type LockedCorrectionUser = {
  employeeCode: string;
  fullName: string;
  pendingCount: number;
  reasons: string[];
  userId: string;
};

export type LegalDossierQueueData = {
  companyOptions: LegalDossierCompanyOption[];
  counts: { seal: number; storage: number };
  documentTypeOptions: string[];
  lockedUsers: LockedCorrectionUser[];
  sealItems: LegalDossierQueueItem[];
  storageItems: LegalDossierQueueItem[];
};

export function hasAdminToolsAccess(
  session: AppSession,
  capability: "delete" | "edit" | "view" = "view",
) {
  return (
    session.fullAccess ||
    session.modules.includes("admin-tools") ||
    session.moduleGroups.includes("admin-hanh-chinh") ||
    session.permissions.includes(`admin-tools.${capability}`)
  );
}

export function assertAdminToolsAccess(
  session: AppSession,
  capability: "delete" | "edit" | "view" = "view",
) {
  if (!hasAdminToolsAccess(session, capability)) {
    throw new Error("Tài khoản chưa được cấp quyền sử dụng Hiệu đính hồ sơ.");
  }
}

export function dossierFileLinkConstants() {
  return {
    entityType: DOSSIER_ENTITY,
    purpose: STORED_FILE_PURPOSE,
  };
}

function objectOf(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

function text(source: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const value = String(source[key] ?? "").replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return "";
}

function asJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function parseDate(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? new Date(`${raw}T00:00:00.000Z`)
    : new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateInput(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : "";
}

function isStorageRow(row: JsonObject) {
  return normalizeVietnamese(text(row, "mode", "module")).includes("luu tru");
}

function conditionRequiresScan(value: unknown) {
  const normalized = normalizeVietnamese(value);
  if (normalized.includes("khong yeu cau luu")) return false;
  return normalized.includes("scan") || normalized.includes("hc giu");
}

function resolveOffice(...sources: JsonObject[]) {
  const aliases: Record<string, { key: string; label: string }> = {
    "q12": { key: "q12", label: "Văn phòng Q12" },
    "quan 12": { key: "q12", label: "Văn phòng Q12" },
    "van phong q12": { key: "q12", label: "Văn phòng Q12" },
    "vp q12": { key: "q12", label: "Văn phòng Q12" },
    "thanh cong": {
      key: "thanh-cong",
      label: "Văn phòng Thành Công",
    },
    "thanh cong tay ninh": {
      key: "thanh-cong",
      label: "Văn phòng Thành Công",
    },
    "tay ninh": {
      key: "thanh-cong",
      label: "Văn phòng Thành Công",
    },
    "van phong thanh cong": {
      key: "thanh-cong",
      label: "Văn phòng Thành Công",
    },
    "van phong thanh cong tay ninh": {
      key: "thanh-cong",
      label: "Văn phòng Thành Công",
    },
  };

  for (const source of sources) {
    const raw = text(
      source,
      "submissionOfficeKey",
      "officeKey",
      "submissionOffice",
      "officeName",
      "office",
      "khuVucNop",
      "khu_vuc_nop",
    );
    if (!raw) continue;
    const resolved = aliases[normalizeVietnamese(raw)];
    if (resolved) return resolved;
  }
  return { key: "", label: "" };
}

async function resolveCompany(
  db: ReturnType<typeof getDb>,
  requestCompanyId: string | null,
  row: JsonObject,
) {
  const directId = text(row, "companyId") || requestCompanyId || "";
  if (directId) {
    const company = await db.company.findUnique({ where: { id: directId } });
    if (company) return company;
  }
  const label = text(
    row,
    "companyName",
    "companyShort",
    "companyShortName",
    "phapNhan",
  );
  if (!label) return null;
  return db.company.findFirst({
    where: {
      OR: [
        { code: { equals: label, mode: "insensitive" } },
        { legalName: { equals: label, mode: "insensitive" } },
        { shortName: { equals: label, mode: "insensitive" } },
      ],
    },
  });
}

async function resolveDocumentType(
  db: ReturnType<typeof getDb>,
  row: JsonObject,
) {
  const id = text(row, "documentTypeId");
  if (id) {
    const documentType = await db.documentType.findUnique({ where: { id } });
    if (documentType) return documentType;
  }
  const name = text(
    row,
    "documentType",
    "documentTypeName",
    "typeLabel",
    "loai",
  );
  if (!name) return null;
  return db.documentType.findFirst({
    where: { name: { equals: name, mode: "insensitive" } },
  });
}

async function resolveIssuedRegistry(
  db: ReturnType<typeof getDb>,
  issuedNumber: string,
) {
  if (!issuedNumber) return null;
  const registry = await db.documentRegistry.findFirst({
    include: { legalDossier: { select: { id: true } } },
    where: {
      documentNumber: { equals: issuedNumber, mode: "insensitive" },
    },
  });
  return registry?.legalDossier ? null : registry;
}

/**
 * Request V3 đời đầu chỉ lưu từng dòng nghiệp vụ trong JSON. Hàm này tách các
 * dòng Đóng dấu/Lưu trữ thành RequestItem + LegalDossier một lần, rồi chỉ đồng
 * bộ snapshot ở các lần sau. Nhờ vậy mở Hiệu đính không tạo trùng hồ sơ.
 */
export async function materializeLegalDossiers() {
  const db = getDb();
  const [requestWithoutItems, itemWithoutDossier] = await Promise.all([
    db.request.findFirst({
      select: { id: true },
      where: {
        archivedAt: null,
        items: { none: {} },
        serviceCode: { in: [SEAL_SERVICE, STORAGE_SERVICE] },
        status: { not: "CANCELLED" },
      },
    }),
    db.requestItem.findFirst({
      select: { id: true },
      where: {
        legalDossier: { is: null },
        request: {
          archivedAt: null,
          status: { not: "CANCELLED" },
        },
        serviceCode: { in: [SEAL_SERVICE, STORAGE_SERVICE] },
      },
    }),
  ]);

  // Hàng đợi đã chuẩn hóa thì chỉ đọc dữ liệu. Không quét lại toàn bộ JSON
  // 98_Inbox ở mỗi lần admin mở màn hình Hiệu đính.
  if (!requestWithoutItems && !itemWithoutDossier) return;

  const requests = await db.request.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      code: true,
      companyId: true,
      createdAt: true,
      createdById: true,
      id: true,
      items: {
        select: {
          itemIndex: true,
          legalDossier: { select: { id: true } },
        },
      },
      payload: true,
      serviceCode: true,
      status: true,
      title: true,
    },
    where: {
      archivedAt: null,
      serviceCode: { in: [SEAL_SERVICE, STORAGE_SERVICE] },
      status: { not: "CANCELLED" },
    },
  });

  for (const request of requests) {
    const requestPayload = objectOf(request.payload);
    const rawItems = Array.isArray(requestPayload.items)
      ? requestPayload.items
      : [requestPayload];
    const materializedItemIndexes = new Set(
      request.items
        .filter((item) => item.legalDossier)
        .map((item) => item.itemIndex),
    );

    for (let itemIndex = 0; itemIndex < rawItems.length; itemIndex += 1) {
      // Các lần mở sau chỉ đọc hàng đợi đã chuẩn hóa. Tránh lặp lại hàng
      // nghìn truy vấn/transaction cho các hồ sơ đã được import hoặc tách.
      if (materializedItemIndexes.has(itemIndex)) continue;

      const row = objectOf(rawItems[itemIndex]);
      if (
        request.serviceCode === STORAGE_SERVICE &&
        !isStorageRow(row)
      ) {
        continue;
      }

      const [company, documentType] = await Promise.all([
        resolveCompany(db, request.companyId, row),
        resolveDocumentType(db, row),
      ]);
      const issuedNumber =
        text(row, "issuedNumber", "documentNumber") ||
        text(requestPayload, "issuedNumber", "documentNumber");
      const registry = await resolveIssuedRegistry(db, issuedNumber);
      const meta = objectOf(requestPayload.meta);
      const office = resolveOffice(row, requestPayload, meta);
      const documentTypeName =
        documentType?.name ||
        text(row, "documentType", "documentTypeName", "typeLabel", "loai");
      const companyName =
        company?.legalName ||
        text(row, "companyName", "phapNhan", "companyShort");
      const companyShortName =
        company?.shortName ||
        company?.code ||
        text(row, "companyShort", "companyShortName");
      const condition =
        documentType?.condition ||
        text(row, "condition", "documentCondition");
      const isSeal = request.serviceCode === SEAL_SERVICE;
      const issuedDate = parseDate(
        text(row, "storageIssuedDate", "signDate", "date"),
      );
      const summary = text(row, "storageSummary", "content", "detail");
      const counterparty = text(
        row,
        "storageCounterparty",
        "partner",
        "partnerName",
      );
      const revisionText = text(row, "storageRevision", "revision");
      const revision = revisionText
        ? Number.parseInt(revisionText, 10) || null
        : null;
      const generatedName =
        text(row, "storageGeneratedName", "recordName", "hoso", "name") ||
        buildLegalDossierStorageName({
          companyName,
          companyShortName,
          counterparty,
          documentTypeName,
          issuedDate,
          revision,
          summary,
        });
      const takesNumber = Boolean(documentType?.takesNumber);
      const initialFileStatus = isSeal
        ? conditionRequiresScan(condition) || isElectronicSignatureItem(row)
          ? "PENDING_SCAN"
          : "NO_SCAN"
        : "PENDING_UPLOAD";

      await db.$transaction(async (tx) => {
        const requestItem = await tx.requestItem.upsert({
          create: {
            itemIndex,
            payload: asJson(row),
            requestId: request.id,
            serviceCode: request.serviceCode,
            status: request.status,
            title:
              text(row, "recordName", "typeLabel", "documentTypeName") ||
              request.title,
          },
          update: {
            payload: asJson(row),
            status: request.status,
            title:
              text(row, "recordName", "typeLabel", "documentTypeName") ||
              request.title,
          },
          where: {
            requestId_itemIndex: { itemIndex, requestId: request.id },
          },
        });
        const existing = await tx.legalDossier.findUnique({
          where: { requestItemId: requestItem.id },
        });
        const dossier = await tx.legalDossier.upsert({
          create: {
            companyId: company?.id,
            companyNameSnapshot: companyName || null,
            companyShortSnapshot: companyShortName || null,
            conditionSnapshot: condition || null,
            documentRegistryId: registry?.id,
            documentTypeId: documentType?.id,
            documentTypeSnapshot: documentTypeName || null,
            fileStatus: initialFileStatus,
            generatedStorageName: generatedName || null,
            numberStatus: issuedNumber
              ? "ISSUED"
              : !documentType
                ? "UNDECIDED"
                : takesNumber
                  ? "PENDING"
                  : "NONE",
            orderStatus: request.status,
            requestItemId: requestItem.id,
            storageCounterparty: counterparty || null,
            storageIssuedDate: issuedDate,
            storageRevision: revision,
            storageSummary: summary || null,
            submissionOfficeKey: office.key || null,
            submissionOfficeLabel: office.label || null,
            takesNumber,
          },
          update: {
            companyId: company?.id,
            companyNameSnapshot: companyName || undefined,
            companyShortSnapshot: companyShortName || undefined,
            conditionSnapshot: condition || undefined,
            documentRegistryId: registry?.id,
            documentTypeId: documentType?.id,
            documentTypeSnapshot: documentTypeName || undefined,
            orderStatus: request.status,
            submissionOfficeKey: office.key || undefined,
            submissionOfficeLabel: office.label || undefined,
            takesNumber: documentType ? takesNumber : undefined,
          },
          where: { requestItemId: requestItem.id },
        });

        if (!existing) {
          await tx.legalDossierEvent.create({
            data: {
              dossierId: dossier.id,
              metadata: {
                requestCode: request.code,
                source: "REQUEST_JSON_MATERIALIZER",
              },
              note: "Tách hồ sơ từ đơn gốc để đưa vào hàng đợi Hiệu đính.",
              toStatus: initialFileStatus,
              type: "MATERIALIZED",
            },
          });
          await tx.auditLog.create({
            data: {
              action: "CREATE",
              metadata: {
                itemIndex,
                requestCode: request.code,
                source: "REQUEST_JSON_MATERIALIZER",
              },
              summary: `Tạo hồ sơ Hiệu đính từ đơn ${request.code}.`,
              targetId: dossier.id,
              targetType: "LegalDossier",
            },
          });
        }
      });
    }
  }
}

function payloadDetail(payload: JsonObject) {
  return text(
    payload,
    "detail",
    "content",
    "reason",
    "note",
    "recordName",
  );
}

function payloadPartner(payload: JsonObject) {
  return text(
    payload,
    "partner",
    "partnerName",
    "storageCounterparty",
  );
}

function payloadDocumentName(payload: JsonObject) {
  return text(
    payload,
    "storageGeneratedName",
    "generatedName",
    "documentName",
    "tenHoSoGoiY",
    "tenHoSo",
    "recordName",
    "name",
  );
}

function payloadTextList(payload: JsonObject, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    const rows = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(/[,;\n]+/)
        : [];
    const normalized = rows
      .map((item) => String(item ?? "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (normalized.length) return [...new Set(normalized)];
  }
  return [];
}

export async function getLegalDossierQueue(): Promise<LegalDossierQueueData> {
  await materializeLegalDossiers();
  const db = getDb();
  const candidates = await db.legalDossier.findMany({
    select: {
      conditionSnapshot: true,
      documentType: { select: { condition: true } },
      id: true,
      requestItem: {
        select: { payload: true, serviceCode: true },
      },
    },
    where: {
      cancelledAt: null,
      fileStatus: { in: ["PENDING_SCAN", "PENDING_UPLOAD"] },
      requestItem: {
        request: { archivedAt: null, status: { not: "CANCELLED" } },
        serviceCode: { in: [SEAL_SERVICE, STORAGE_SERVICE] },
      },
    },
  });
  const queueIds = candidates
    .filter((dossier) => {
      if (dossier.requestItem.serviceCode === STORAGE_SERVICE) return true;
      return (
        isElectronicSignatureItem(objectOf(dossier.requestItem.payload)) ||
        conditionRequiresScan(
          dossier.conditionSnapshot || dossier.documentType?.condition,
        )
      );
    })
    .map((dossier) => dossier.id);

  const [dossiers, pendingFollowUps, companies, documentTypes] = await Promise.all([
    queueIds.length
      ? db.legalDossier.findMany({
          include: {
            company: true,
            documentRegistry: true,
            documentType: true,
            events: {
              include: { actor: { select: { displayName: true } } },
              orderBy: { createdAt: "desc" },
              take: 8,
            },
            followUps: {
              select: { id: true },
              where: { status: "PENDING" },
            },
            requestItem: {
              include: {
                request: {
                  include: {
                    createdBy: { select: { displayName: true } },
                  },
                },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          where: { id: { in: queueIds } },
        })
      : Promise.resolve([]),
    db.followUpRequirement.findMany({
      orderBy: { requestedAt: "desc" },
      select: {
        blocksModules: true,
        reason: true,
        targetUserId: true,
        targetUser: {
          select: {
            displayName: true,
            employee: {
              select: { employeeCode: true, fullName: true },
            },
          },
        },
      },
      where: { status: "PENDING" },
    }),
    db.company.findMany({
      orderBy: [{ shortName: "asc" }, { legalName: "asc" }],
      select: { code: true, legalName: true, shortName: true },
      where: { archivedAt: null, status: "ACTIVE" },
    }),
    db.documentType.findMany({
      orderBy: { name: "asc" },
      select: { name: true },
      where: { status: "ACTIVE" },
    }),
  ]);
  const dossierIds = dossiers.map((dossier) => dossier.id);
  const links = dossierIds.length
    ? await db.fileLink.findMany({
        select: { entityId: true },
        where: {
          entityId: { in: dossierIds },
          entityType: DOSSIER_ENTITY,
          purpose: STORED_FILE_PURPOSE,
        },
      })
    : [];
  const fileCounts = new Map<string, number>();
  for (const link of links) {
    fileCounts.set(link.entityId, (fileCounts.get(link.entityId) || 0) + 1);
  }

  const items = dossiers.map((dossier): LegalDossierQueueItem => {
      const payload = objectOf(dossier.requestItem.payload);
      const request = dossier.requestItem.request;
      const documentTypeName =
        dossier.documentTypeSnapshot || dossier.documentType?.name || "";
      return {
        companyName:
          dossier.companyNameSnapshot || dossier.company?.legalName || "",
        companyShortName:
          dossier.companyShortSnapshot ||
          dossier.company?.shortName ||
          dossier.company?.code ||
          "",
        condition:
          dossier.conditionSnapshot || dossier.documentType?.condition || "",
        createdAt: request.createdAt.toISOString(),
        creatorName: request.createdBy.displayName,
        detail: payloadDetail(payload),
        documentNumber: dossier.documentRegistry?.documentNumber || "",
        documentTypeName,
        events: dossier.events.map((event) => ({
          actorName: event.actor?.displayName || "Hệ thống",
          createdAt: event.createdAt.toISOString(),
          note: event.note || "",
          type: event.type,
        })),
        fileCount: fileCounts.get(dossier.id) || 0,
        fileStatus: dossier.fileStatus,
        followUpPending: dossier.followUps.length > 0,
        generatedStorageName: dossier.generatedStorageName || "",
        id: dossier.id,
        itemIndex: dossier.requestItem.itemIndex + 1,
        kind:
          dossier.requestItem.serviceCode === SEAL_SERVICE
            ? "seal"
            : "storage",
        needsCounterparty: isContractLikeDocumentType(documentTypeName),
        numberStatus: dossier.numberStatus,
        officeKey: dossier.submissionOfficeKey || "",
        officeLabel: dossier.submissionOfficeLabel || "",
        orderStatus: dossier.orderStatus,
        partner: payloadPartner(payload),
        requestCode: request.code,
        requestId: request.id,
        requestTitle: request.title,
        sourceDocumentName:
          payloadDocumentName(payload) || dossier.generatedStorageName || "",
        sourceShortName: text(
          payload,
          "customNumberingText",
          "counterpartyShortName",
          "shortPartnerName",
        ),
        sourceStampTypes: payloadTextList(payload, "stamps", "dau", "sealTypes"),
        storageCounterparty: dossier.storageCounterparty || "",
        storageIssuedDate: dateInput(dossier.storageIssuedDate),
        storageRevision: dossier.storageRevision
          ? String(dossier.storageRevision)
          : "",
        storageSummary: dossier.storageSummary || "",
        takesNumber: dossier.takesNumber,
      };
    });

  const sealItems = items.filter((item) => item.kind === "seal");
  const storageItems = items.filter((item) => item.kind === "storage");
  const lockedUserMap = new Map<string, LockedCorrectionUser>();
  for (const followUp of pendingFollowUps) {
    if (!followUpBlocksAnyModule(followUp.blocksModules)) continue;
    const current = lockedUserMap.get(followUp.targetUserId);
    if (current) {
      current.pendingCount += 1;
      if (followUp.reason && !current.reasons.includes(followUp.reason)) {
        current.reasons.push(followUp.reason);
      }
      continue;
    }
    lockedUserMap.set(followUp.targetUserId, {
      employeeCode: followUp.targetUser.employee?.employeeCode || "",
      fullName:
        followUp.targetUser.employee?.fullName ||
        followUp.targetUser.displayName,
      pendingCount: 1,
      reasons: followUp.reason ? [followUp.reason] : [],
      userId: followUp.targetUserId,
    });
  }
  const lockedUsers = [...lockedUserMap.values()].sort((left, right) =>
    left.fullName.localeCompare(right.fullName, "vi", { sensitivity: "base" }),
  );
  return {
    companyOptions: companies.map((company) => ({
      label: company.legalName,
      shortName: company.shortName || company.code,
    })),
    counts: { seal: sealItems.length, storage: storageItems.length },
    documentTypeOptions: documentTypes.map((documentType) => documentType.name),
    lockedUsers,
    sealItems,
    storageItems,
  };
}
