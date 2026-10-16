import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import type {
  WarehouseInventoryComparisonLine,
  WarehouseInventoryCompany,
  WarehouseInventoryDetail,
  WarehouseInventoryDuplicate,
  WarehouseInventoryIssue,
  WarehouseInventoryPairComparisonData,
  WarehouseInventorySessionItem,
  WarehouseInventoryStatement,
  WarehouseInventorySummary,
  WarehouseInventoryType,
  WarehouseInventoryWorkspaceData,
} from "./types";
import { ingestWarehouseRfidDefinitionPayload } from "./definition";
import { assertWarehouseDeleteCredential } from "./secure-delete";

type UnknownRecord = Record<string, unknown>;

export type NormalizedTag = {
  epc: string;
  firstReadAt: Date | null;
  lastReadAt: Date | null;
  readCount: number;
};

export type WarehouseInventoryAccumulationState = {
  requestedReadCount: number;
  tags: NormalizedTag[];
};

export type NormalizedWarehouseInventoryPayload = {
  area: string;
  companyKey: WarehouseInventoryCompany;
  date: Date;
  dateKey: string;
  deviceName: string;
  inventoryType: WarehouseInventoryType;
  operatorName: string;
  raw: UnknownRecord;
  requestedReadCount: number;
  sessionKey: string;
  shelf: string;
  source: string;
  tags: NormalizedTag[];
};

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function number(value: unknown, fallback = 0) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return record(JSON.parse(JSON.stringify(value ?? {})));
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (JSON.parse(JSON.stringify(value)) as T[]) : [];
}

function normalizedKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("vi");
}

function normalizeCompany(value: unknown): WarehouseInventoryCompany {
  const key = normalizedKey(value);
  if (!key) return "";
  if (
    key === "TVD" ||
    key.includes("DIGITAL") ||
    key.includes("THUAN VIET DIGITAL")
  ) {
    return "TVD";
  }
  if (
    key === "TVG" ||
    key.includes("GLOBAL") ||
    key.includes("THUAN VIET GLOBAL")
  ) {
    return "TVG";
  }
  // Pháp nhân chỉ còn là metadata tương thích payload cũ. Kiểm kê RFID mới
  // không phụ thuộc Eshop/pháp nhân nên giá trị lạ không được chặn lượt quét.
  return "";
}

function normalizeInventoryType(value: unknown): WarehouseInventoryType {
  const key = normalizedKey(value);
  if (!key) return "";
  if (
    ["START", "OPENING", "MORNING", "DAU NGAY", "DẦU NGÀY"].some(
      (item) => key === normalizedKey(item),
    )
  ) {
    return "START";
  }
  if (
    ["END", "CLOSING", "EVENING", "CUOI NGAY", "CUỐI NGÀY"].some(
      (item) => key === normalizedKey(item),
    )
  ) {
    return "END";
  }
  throw new Error("Loại kiểm kê phải là START hoặc END.");
}

function parseDate(value: unknown, fallback = new Date()) {
  const source = text(value);
  if (!source) return new Date(fallback);
  const vietnamese = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vietnamese) {
    const [, day, month, year] = vietnamese;
    return new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), 0, 0, 0),
    );
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? new Date(fallback) : parsed;
}

function dateOnly(value: Date) {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
  );
}

function dateKey(value: Date) {
  return dateOnly(value).toISOString().slice(0, 10);
}

function epc(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function firstValue(source: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return "";
}

function normalizeTagEntries(source: UnknownRecord) {
  const rawRfids = firstValue(source, [
    "rfids",
    "rfidList",
    "rfid",
    "codes",
    "epcs",
  ]);
  const rawTags = source.tags;
  const rfidValues = Array.isArray(rawRfids)
    ? rawRfids
    : text(rawRfids)
      ? text(rawRfids).split(/[\n,;]+/)
      : [];
  const tags = Array.isArray(rawTags) ? rawTags : [];
  const map = new Map<string, NormalizedTag>();

  for (const value of rfidValues) {
    const code = epc(
      typeof value === "object"
        ? firstValue(record(value), ["epc", "rfid", "code", "tag"])
        : value,
    );
    if (!code) continue;
    const current = map.get(code);
    map.set(code, {
      epc: code,
      firstReadAt: current?.firstReadAt ?? null,
      lastReadAt: current?.lastReadAt ?? null,
      readCount: (current?.readCount ?? 0) + 1,
    });
  }

  for (const value of tags) {
    const item = record(value);
    const code = epc(firstValue(item, ["epc", "rfid", "code", "tag"]));
    if (!code) continue;
    const timestamp = parseDate(
      firstValue(item, ["timestamp", "readAt", "scannedAt", "time"]),
      new Date(),
    );
    const current = map.get(code);
    // Máy Android thường gửi đồng thời rfids (danh sách unique) và tags (metadata
    // của đúng danh sách đó). Không cộng gấp đôi khi EPC đã có trong rfids.
    map.set(code, {
      epc: code,
      firstReadAt:
        current?.firstReadAt &&
        current.firstReadAt.getTime() < timestamp.getTime()
          ? current.firstReadAt
          : timestamp,
      lastReadAt:
        current?.lastReadAt &&
        current.lastReadAt.getTime() > timestamp.getTime()
          ? current.lastReadAt
          : timestamp,
      readCount: current?.readCount ?? 1,
    });
  }

  return [...map.values()];
}

export function extractWarehouseApiKey(payload: unknown) {
  const root = record(payload);
  const nested = record(root.payload);
  return text(
    firstValue(nested, ["apiKey", "token", "secret", "authorization"]) ||
      firstValue(root, ["apiKey", "token", "secret", "authorization"]),
  ).replace(/^Bearer\s+/i, "");
}

export function warehouseInventoryAction(payload: unknown) {
  const root = record(payload);
  const nested = record(root.payload);
  return text(
    firstValue(nested, ["action", "method"]) ||
      firstValue(root, ["action", "method"]),
  );
}

export function normalizeWarehouseInventoryPayload(
  payload: unknown,
): NormalizedWarehouseInventoryPayload {
  const root = record(payload);
  const nested = record(root.payload);
  const source = { ...root, ...nested };
  const companyKey = normalizeCompany(
    firstValue(source, ["companyKey", "company", "legalEntity"]),
  );
  const scanDate = dateOnly(
    parseDate(
      firstValue(source, ["date", "scanDate", "inventoryDate", "day"]),
      new Date(),
    ),
  );
  const suppliedSessionKey = text(
    firstValue(source, ["sessionId", "scanSession", "localScanSessionId"]),
  );
  const sessionKey =
    suppliedSessionKey ||
    `rfid-${dateKey(scanDate)}-${randomUUID().slice(0, 8)}`;
  if (sessionKey.length > 180) {
    throw new Error("sessionId dài quá giới hạn 180 ký tự.");
  }
  const tags = normalizeTagEntries(source);
  if (!tags.length) {
    throw new Error("JSON chưa có RFID trong rfids hoặc tags.");
  }
  if (tags.length > 10_000) {
    throw new Error("Một phiên chỉ nhận tối đa 10.000 RFID unique.");
  }

  return {
    area: text(firstValue(source, ["area", "zone", "location"])),
    companyKey,
    date: scanDate,
    dateKey: dateKey(scanDate),
    deviceName: text(
      firstValue(source, ["deviceName", "scannerName", "deviceId"]),
    ),
    inventoryType: normalizeInventoryType(
      firstValue(source, ["inventoryType", "scanType", "checkpoint"]),
    ),
    operatorName: text(
      firstValue(source, ["operator", "operatorName", "employeeName"]),
    ),
    raw: jsonRecord(payload),
    requestedReadCount: Math.max(
      tags.reduce((total, item) => total + item.readCount, 0),
      number(
        firstValue(source, [
          "totalReadCount",
          "requestedReadCount",
          "readCount",
        ]),
        tags.reduce((total, item) => total + item.readCount, 0),
      ),
    ),
    sessionKey,
    shelf: text(firstValue(source, ["shelf", "bin", "rack"])),
    source: text(source.source) || "Android/RFID",
    tags,
  };
}

function earlierDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() <= right.getTime() ? left : right;
}

function laterDate(left: Date | null, right: Date | null) {
  if (!left) return right;
  if (!right) return left;
  return left.getTime() >= right.getTime() ? left : right;
}

/**
 * Android gửi tuần tự tối đa 100 EPC/request nhưng giữ nguyên sessionId.
 * Ghép theo EPC và dùng max(readCount) để retry cùng batch không nhân đôi.
 */
export function mergeWarehouseInventoryBatch(
  existing: WarehouseInventoryAccumulationState,
  incoming: Pick<
    NormalizedWarehouseInventoryPayload,
    "requestedReadCount" | "tags"
  >,
): WarehouseInventoryAccumulationState {
  const existingEpcs = new Set(existing.tags.map((item) => item.epc));
  const merged = new Map<string, NormalizedTag>();

  for (const item of [...existing.tags, ...incoming.tags]) {
    const current = merged.get(item.epc);
    merged.set(item.epc, {
      epc: item.epc,
      firstReadAt: earlierDate(current?.firstReadAt ?? null, item.firstReadAt),
      lastReadAt: laterDate(current?.lastReadAt ?? null, item.lastReadAt),
      readCount: Math.max(current?.readCount ?? 0, item.readCount),
    });
  }

  const newTags = incoming.tags.filter((item) => !existingEpcs.has(item.epc));
  let requestedReadIncrement = 0;
  if (newTags.length) {
    requestedReadIncrement =
      existing.tags.length === 0 || newTags.length === incoming.tags.length
        ? incoming.requestedReadCount
        : newTags.reduce((total, item) => total + item.readCount, 0);
  }

  return {
    requestedReadCount: existing.requestedReadCount + requestedReadIncrement,
    tags: [...merged.values()].sort((left, right) =>
      left.epc.localeCompare(right.epc, "vi"),
    ),
  };
}

function buildSummary(input: {
  cancelledRfidCount: number;
  comparison: WarehouseInventoryComparisonLine[];
  duplicateRfids: WarehouseInventoryDuplicate[];
  inStockRfidCount: number;
  knownRfidCount: number;
  requestedReadCount: number;
  uniqueRfidCount: number;
  unknownRfids: WarehouseInventoryIssue[];
  wrongStatusRfids: WarehouseInventoryIssue[];
}): WarehouseInventorySummary {
  return {
    cancelledRfidCount: input.cancelledRfidCount,
    comparedSkuCount: input.comparison.length,
    duplicateRfidCount: input.duplicateRfids.length,
    expectedSkuCount: 0,
    inStockRfidCount: input.inStockRfidCount,
    knownRfidCount: input.knownRfidCount,
    matchedSkuCount: input.comparison.length,
    noEshopSkuCount: 0,
    physicalSkuCount: input.comparison.filter(
      (line) => line.physicalQuantity > 0,
    ).length,
    requestedReadCount: input.requestedReadCount,
    shortageSkuCount: 0,
    surplusSkuCount: 0,
    uniqueRfidCount: input.uniqueRfidCount,
    unknownRfidCount: input.unknownRfids.length,
    wrongCompanyRfidCount: 0,
    wrongStatusRfidCount: 0,
  };
}

function buildStatement(
  comparison: WarehouseInventoryComparisonLine[],
  summary: WarehouseInventorySummary,
  generatedAt = new Date(),
): WarehouseInventoryStatement {
  const lines = comparison.map((line) => ({
    eshopCurrentQuantity: 0,
    eshopDifference: 0,
    expectedFinalQuantity: 0,
    finalQuantity: line.physicalQuantity,
    inboundQuantity: 0,
    name: line.name,
    openingQuantity: 0,
    outboundQuantity: 0,
    rfids: line.rfids,
    sku: line.sku,
    status: "OK" as const,
  }));
  const differenceQuantity = 0;
  const reviewSkuCount = 0;
  return {
    generatedAt: generatedAt.toISOString(),
    lines,
    readyToConfirm:
      reviewSkuCount === 0 &&
      summary.unknownRfidCount === 0 &&
      lines.length > 0,
    summary: {
      differenceQuantity,
      eshopQuantity: lines.reduce(
        (total, line) => total + line.eshopCurrentQuantity,
        0,
      ),
      physicalQuantity: lines.reduce(
        (total, line) => total + line.finalQuantity,
        0,
      ),
      reviewSkuCount,
      totalSkuCount: lines.length,
    },
  };
}

type WarehouseTagLookup = {
  id: string;
  issuanceStatus: string;
  product: { name: string; sku: string } | null;
  productId: string | null;
  productName: string | null;
  productSku: string | null;
};

export function evaluateWarehouseInventory(
  tags: NormalizedTag[],
  tagMap: Map<string, WarehouseTagLookup>,
  requestedReadCount: number,
) {
  let cancelledRfidCount = 0;
  const unknownRfids: WarehouseInventoryIssue[] = [];
  const wrongStatusRfids: WarehouseInventoryIssue[] = [];
  const duplicateRfids: WarehouseInventoryDuplicate[] = tags
    .filter((item) => item.readCount > 1)
    .map((item) => ({
      count: item.readCount,
      reason:
        "RFID được đọc lặp trong cùng phiên; số lượng kiểm kê vẫn chỉ tính một.",
      rfid: item.epc,
    }));
  const physicalMap = new Map<string, { name: string; rfids: string[] }>();

  for (const item of tags) {
    const tag = tagMap.get(item.epc);
    if (!tag) {
      unknownRfids.push({
        reason: "RFID chưa được định nghĩa trong Kho KTS.",
        rfid: item.epc,
      });
      continue;
    }
    if (normalizedKey(tag.issuanceStatus) === "CANCELLED") {
      cancelledRfidCount += 1;
      continue;
    }
    const sku = tag.product?.sku || tag.productSku || "";
    if (!sku) {
      unknownRfids.push({
        reason: "RFID chưa liên kết với SKU trong PostgreSQL.",
        rfid: item.epc,
      });
      continue;
    }
    const current = physicalMap.get(sku) ?? {
      name: tag.product?.name || tag.productName || sku,
      rfids: [],
    };
    current.rfids.push(item.epc);
    physicalMap.set(sku, current);
  }

  const comparison: WarehouseInventoryComparisonLine[] = [];
  for (const sku of [...physicalMap.keys()].sort((left, right) =>
    left.localeCompare(right, "vi"),
  )) {
    const physical = physicalMap.get(sku);
    comparison.push({
      category: "da_quet",
      difference: 0,
      expectedQuantity: 0,
      name: physical?.name || sku,
      physicalQuantity: physical?.rfids.length ?? 0,
      rfids: physical?.rfids ?? [],
      sku,
    });
  }

  const summary = buildSummary({
    cancelledRfidCount,
    comparison,
    duplicateRfids,
    inStockRfidCount: [...physicalMap.values()].reduce(
      (total, item) => total + item.rfids.length,
      0,
    ),
    knownRfidCount: tags.filter((item) => tagMap.has(item.epc)).length,
    requestedReadCount,
    uniqueRfidCount: tags.length,
    unknownRfids,
    wrongStatusRfids,
  });
  const processStatus = unknownRfids.length ? "PARTIAL" : "SUCCESS";
  const message = `Đã nhận ${summary.uniqueRfidCount} RFID, nhận diện ${summary.inStockRfidCount} RFID thuộc ${summary.physicalSkuCount} SKU${cancelledRfidCount ? `; bỏ qua ${cancelledRfidCount} RFID đã Hủy` : ""}${unknownRfids.length ? `; còn ${unknownRfids.length} RFID chưa gắn SKU.` : "."}`;

  return {
    comparison,
    duplicateRfids,
    message,
    processStatus,
    statement: buildStatement(comparison, summary),
    summary,
    unknownRfids,
    wrongStatusRfids,
  };
}

function cumulativeRawPayload(
  existingRaw: unknown,
  input: NormalizedWarehouseInventoryPayload,
  accumulated: WarehouseInventoryAccumulationState,
) {
  const mergedRoot = {
    ...jsonRecord(existingRaw),
    ...input.raw,
  };
  const cumulativeFields = {
    rfids: accumulated.tags.map((item) => item.epc),
    scanSession: input.sessionKey,
    sessionId: input.sessionKey,
    tags: accumulated.tags.map((item) => ({
      epc: item.epc,
      timestamp: (item.firstReadAt ?? item.lastReadAt)?.toISOString() || "",
    })),
    totalReadCount: accumulated.requestedReadCount,
  };
  const nested = record(mergedRoot.payload);
  return {
    ...mergedRoot,
    ...cumulativeFields,
    ...(Object.keys(nested).length
      ? { payload: { ...nested, ...cumulativeFields } }
      : {}),
  };
}

function storedInventoryRawPayload(
  existingRaw: unknown,
  tags: NormalizedTag[],
  requestedReadCount: number,
) {
  const root = jsonRecord(existingRaw);
  const cumulativeFields = {
    rfids: tags.map((item) => item.epc),
    tags: tags.map((item) => ({
      epc: item.epc,
      timestamp: (item.firstReadAt ?? item.lastReadAt)?.toISOString() || "",
    })),
    totalReadCount: requestedReadCount,
  };
  const nested = record(root.payload);
  return {
    ...root,
    ...cumulativeFields,
    ...(Object.keys(nested).length
      ? { payload: { ...nested, ...cumulativeFields } }
      : {}),
  };
}

export async function ingestWarehouseInventoryPayload(payload: unknown) {
  const input = normalizeWarehouseInventoryPayload(payload);
  const db = getDb();
  const result = await db.$transaction(
    async (tx) => {
      // Sáu request của cùng một máy/session phải ghép tuần tự, kể cả khi API
      // chạy trên nhiều Cloud Run instance.
      // Prisma không hỗ trợ deserialize kiểu `void` mà hàm advisory lock trả về.
      // Ép sang text vẫn giữ nguyên việc chờ khóa nhưng trả về kiểu Prisma đọc được.
      await tx.$queryRaw<Array<{ lockResult: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${input.sessionKey}))::text AS "lockResult"
      `;

      const existing = await tx.warehouseInventorySession.findUnique({
        include: {
          items: {
            select: {
              epc: true,
              firstReadAt: true,
              lastReadAt: true,
              readCount: true,
            },
          },
        },
        where: { sessionKey: input.sessionKey },
      });
      if (existing?.confirmedAt) {
        throw new Error(
          `Phiên ${input.sessionKey} đã xác nhận, máy quét không được ghi đè.`,
        );
      }

      const accumulated = mergeWarehouseInventoryBatch(
        {
          requestedReadCount: existing?.requestedReadCount ?? 0,
          tags:
            existing?.items.map((item) => ({
              epc: item.epc,
              firstReadAt: item.firstReadAt,
              lastReadAt: item.lastReadAt,
              readCount: item.readCount,
            })) ?? [],
        },
        input,
      );
      if (accumulated.tags.length > 10_000) {
        throw new Error("Một phiên chỉ nhận tối đa 10.000 RFID unique.");
      }

      const knownTags = await tx.warehouseRfidTag.findMany({
        include: { product: true },
        where: { epc: { in: accumulated.tags.map((item) => item.epc) } },
      });
      const tagMap = new Map<string, WarehouseTagLookup>(
        knownTags.map((tag) => [tag.epc, tag]),
      );
      const batchResult = evaluateWarehouseInventory(
        input.tags,
        tagMap,
        input.requestedReadCount,
      );
      const sessionResult = evaluateWarehouseInventory(
        accumulated.tags,
        tagMap,
        accumulated.requestedReadCount,
      );
      const sessionData = {
        area: input.area || existing?.area || null,
        companyKey: input.companyKey || existing?.companyKey || "",
        comparison: json(sessionResult.comparison),
        deviceName: input.deviceName || existing?.deviceName || null,
        duplicateRfidCount: sessionResult.duplicateRfids.length,
        duplicateRfids: json(sessionResult.duplicateRfids),
        inStockRfidCount: sessionResult.summary.inStockRfidCount,
        inventoryType: input.inventoryType || existing?.inventoryType || "",
        knownRfidCount: sessionResult.summary.knownRfidCount,
        message: sessionResult.message,
        operatorName: input.operatorName || existing?.operatorName || null,
        processStatus: sessionResult.processStatus,
        rawPayload: json(
          cumulativeRawPayload(existing?.rawPayload, input, accumulated),
        ),
        requestedReadCount: accumulated.requestedReadCount,
        scanDate: existing?.scanDate || input.date,
        shelf: input.shelf || existing?.shelf || null,
        source: input.source || existing?.source || "Android/RFID",
        statement: json(sessionResult.statement),
        summary: json(sessionResult.summary),
        uniqueRfidCount: accumulated.tags.length,
        unknownRfids: json(sessionResult.unknownRfids),
        wrongCompanyRfids: json([]),
        wrongStatusRfids: json(sessionResult.wrongStatusRfids),
      };
      const saved = existing
        ? await tx.warehouseInventorySession.update({
            data: sessionData,
            where: { id: existing.id },
          })
        : await tx.warehouseInventorySession.create({
            data: { ...sessionData, sessionKey: input.sessionKey },
          });
      await tx.warehouseInventoryScanItem.deleteMany({
        where: { sessionId: saved.id },
      });
      await tx.warehouseInventoryScanItem.createMany({
        data: accumulated.tags.map((item) => {
          const tag = tagMap.get(item.epc);
          const mappedSku = tag?.product?.sku || tag?.productSku || "";
          const cancelled = tag?.issuanceStatus === "CANCELLED";
          return {
            epc: item.epc,
            firstReadAt: item.firstReadAt,
            itemStatus: cancelled
              ? "CANCELLED"
              : tag && mappedSku
                ? "MAPPED"
                : "UNKNOWN",
            lastReadAt: item.lastReadAt,
            message: cancelled
              ? "RFID đã Hủy, không tính vào biên bản kiểm kê"
              : !tag
                ? "RFID chưa có trong Kho KTS"
                : !mappedSku
                  ? "RFID chưa liên kết với SKU"
                  : null,
            productId: tag && mappedSku ? tag.productId : null,
            readCount: item.readCount,
            rfidTagId: tag?.id ?? null,
            sessionId: saved.id,
          };
        }),
      });
      const incomingCodes = new Set(input.tags.map((item) => item.epc));
      const incomingKnownTagIds = knownTags
        .filter((tag) => incomingCodes.has(tag.epc))
        .map((tag) => tag.id);
      if (incomingKnownTagIds.length) {
        await tx.warehouseRfidTag.updateMany({
          data: {
            lastInventorySessionKey: input.sessionKey,
            lastScannedAt: new Date(),
          },
          where: { id: { in: incomingKnownTagIds } },
        });
      }
      return { batchResult, sessionKey: saved.sessionKey };
    },
    { timeout: 30_000 },
  );

  return {
    comparison: result.batchResult.comparison,
    message: result.batchResult.message,
    ok: true,
    processStatus: result.batchResult.processStatus,
    sessionId: result.sessionKey,
    summary: result.batchResult.summary,
    unknownRfids: result.batchResult.unknownRfids,
    wrongStatusRfids: result.batchResult.wrongStatusRfids,
  };
}

function emptySummary(): WarehouseInventorySummary {
  return {
    cancelledRfidCount: 0,
    comparedSkuCount: 0,
    duplicateRfidCount: 0,
    expectedSkuCount: 0,
    inStockRfidCount: 0,
    knownRfidCount: 0,
    matchedSkuCount: 0,
    noEshopSkuCount: 0,
    physicalSkuCount: 0,
    requestedReadCount: 0,
    shortageSkuCount: 0,
    surplusSkuCount: 0,
    uniqueRfidCount: 0,
    unknownRfidCount: 0,
    wrongCompanyRfidCount: 0,
    wrongStatusRfidCount: 0,
  };
}

function sessionItem(row: {
  area: string | null;
  companyKey: string;
  confirmedAt: Date | null;
  confirmedByName: string | null;
  deviceName: string | null;
  inventoryType: string;
  message: string | null;
  operatorName: string | null;
  processStatus: string;
  scanDate: Date;
  sessionKey: string;
  shelf: string | null;
  source: string;
  summary: unknown;
  updatedAt: Date;
  _count?: {
    items: number;
    mergedInto: number;
    mergedSources: number;
  };
}): WarehouseInventorySessionItem {
  return {
    area: row.area || "",
    companyKey: normalizeCompany(row.companyKey),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedByName: row.confirmedByName || "",
    deviceName: row.deviceName || "",
    inventoryType: normalizeInventoryType(row.inventoryType),
    itemCount: row._count?.items ?? 0,
    linkedSessionCount:
      (row._count?.mergedInto ?? 0) + (row._count?.mergedSources ?? 0),
    message: row.message || "",
    operatorName: row.operatorName || "",
    processStatus: row.processStatus,
    scanDate: dateKey(row.scanDate),
    sessionKey: row.sessionKey,
    shelf: row.shelf || "",
    source: row.source,
    summary: {
      ...emptySummary(),
      ...jsonRecord(row.summary),
    } as WarehouseInventorySummary,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function detailBySessionKey(sessionKey: string) {
  const row = await getDb().warehouseInventorySession.findUnique({
    include: {
      _count: {
        select: { items: true, mergedInto: true, mergedSources: true },
      },
      items: {
        include: { product: true, rfidTag: true },
        orderBy: { epc: "asc" },
      },
    },
    where: { sessionKey },
  });
  if (!row) return null;
  const base = sessionItem(row);
  const comparison = jsonArray<WarehouseInventoryComparisonLine>(
    row.comparison,
  );
  const summary = base.summary;
  return {
    ...base,
    comparison,
    duplicateRfids: jsonArray<WarehouseInventoryDuplicate>(row.duplicateRfids),
    rawPayload: jsonRecord(row.rawPayload),
    scanItems: row.items.map((item) => ({
      epc: item.epc,
      issuanceStatus:
        item.rfidTag?.issuanceStatus === "CANCELLED" ? "CANCELLED" : "ACTIVE",
      itemStatus: item.itemStatus,
      message: item.message || "",
      name: item.product?.name || item.rfidTag?.productName || "",
      readCount: item.readCount,
      sku: item.product?.sku || item.rfidTag?.productSku || "",
      tagStatus: item.rfidTag?.status || "",
    })),
    statement:
      row.statement && Object.keys(jsonRecord(row.statement)).length
        ? (jsonRecord(row.statement) as WarehouseInventoryStatement)
        : buildStatement(comparison, summary, row.updatedAt),
    unknownRfids: jsonArray<WarehouseInventoryIssue>(row.unknownRfids),
    wrongCompanyRfids: jsonArray<WarehouseInventoryIssue>(
      row.wrongCompanyRfids,
    ),
    wrongStatusRfids: jsonArray<WarehouseInventoryIssue>(row.wrongStatusRfids),
  } satisfies WarehouseInventoryDetail;
}

function assertWarehouseAccess(session: AppSession) {
  if (
    !session.fullAccess &&
    !session.modules.includes("warehouse-inventory") &&
    !session.moduleGroups.includes("warehouse")
  ) {
    throw new Error("Tài khoản chưa được cấp quyền mở Kiểm kê Kho.");
  }
}

function assertWarehouseSuperAdmin(session: AppSession) {
  if (!session.fullAccess || !session.roles.includes("super-admin")) {
    throw new Error("Chỉ Super Admin được xóa hàng loạt phiên kiểm kê.");
  }
}

type WarehouseInventorySessionLinkEdge = {
  mergedSessionId: string;
  sourceSessionId: string;
};

function linkedWarehouseInventorySessionIds(
  seedIds: string[],
  links: WarehouseInventorySessionLinkEdge[],
) {
  const selected = new Set(seedIds);
  const queue = [...seedIds];
  while (queue.length) {
    const currentId = queue.shift();
    if (!currentId) continue;
    for (const link of links) {
      if (
        link.mergedSessionId !== currentId &&
        link.sourceSessionId !== currentId
      ) {
        continue;
      }
      const linkedId =
        link.mergedSessionId === currentId
          ? link.sourceSessionId
          : link.mergedSessionId;
      if (selected.has(linkedId)) continue;
      selected.add(linkedId);
      queue.push(linkedId);
    }
  }
  return [...selected];
}

async function warehouseInventoryLinkedGroupSize(sessionKey: string) {
  const db = getDb();
  const selected = await db.warehouseInventorySession.findUnique({
    select: { id: true },
    where: { sessionKey },
  });
  if (!selected) return 0;
  const links = await db.warehouseInventorySessionLink.findMany({
    select: { mergedSessionId: true, sourceSessionId: true },
  });
  return linkedWarehouseInventorySessionIds([selected.id], links).length;
}

async function deleteWarehouseInventorySessionsInternal(
  session: AppSession,
  input: {
    includeLinked: boolean;
    reason: string;
    sessionKeys: string[];
  },
) {
  const requestedKeys = [
    ...new Set(input.sessionKeys.map((item) => text(item)).filter(Boolean)),
  ];
  if (!requestedKeys.length) {
    throw new Error("Vui lòng chọn ít nhất một phiên kiểm kê cần xóa.");
  }
  if (requestedKeys.length > 180) {
    throw new Error("Mỗi lần chỉ xóa tối đa 180 phiên kiểm kê.");
  }

  const db = getDb();
  return db.$transaction(
    async (tx) => {
      const selectedSessions = await tx.warehouseInventorySession.findMany({
        select: { id: true, sessionKey: true },
        where: { sessionKey: { in: requestedKeys } },
      });
      if (!selectedSessions.length) {
        throw new Error(
          "Các phiên đã chọn không còn tồn tại trong PostgreSQL.",
        );
      }

      let targetIds = selectedSessions.map((item) => item.id);
      if (input.includeLinked) {
        const links = await tx.warehouseInventorySessionLink.findMany({
          select: { mergedSessionId: true, sourceSessionId: true },
        });
        targetIds = linkedWarehouseInventorySessionIds(targetIds, links);
      }
      const targets = await tx.warehouseInventorySession.findMany({
        include: { _count: { select: { items: true } } },
        where: { id: { in: targetIds } },
      });
      const targetKeys = targets.map((item) => item.sessionKey);
      const deletedItemCount = targets.reduce(
        (total, item) => total + item._count.items,
        0,
      );

      await tx.warehouseRfidTag.updateMany({
        data: { lastInventorySessionKey: null },
        where: { lastInventorySessionKey: { in: targetKeys } },
      });
      await tx.warehouseInventorySession.deleteMany({
        where: { id: { in: targetIds } },
      });
      await tx.auditLog.create({
        data: {
          action: "DELETE",
          actorId: session.userId,
          metadata: json({
            deletedItemCount,
            includeLinked: input.includeLinked,
            reason: input.reason,
            requestedSessionKeys: requestedKeys,
            sessionKeys: targetKeys,
          }),
          summary: `Xóa ${targets.length} phiên kiểm kê RFID và ${deletedItemCount} dòng RFID. Lý do: ${input.reason}`,
          targetId: targets.length === 1 ? targets[0].id : null,
          targetType: "WarehouseInventorySessionBatch",
        },
      });

      return {
        deletedItemCount,
        deletedSessionCount: targets.length,
        sessionKeys: targetKeys,
      };
    },
    { maxWait: 5_000, timeout: 30_000 },
  );
}

export async function deleteWarehouseInventorySessionsBulk(
  session: AppSession,
  input: { password: string; reason: string; sessionKeys: string[] },
) {
  assertWarehouseAccess(session);
  assertWarehouseSuperAdmin(session);
  const reason = await assertWarehouseDeleteCredential(session, input);
  return deleteWarehouseInventorySessionsInternal(session, {
    includeLinked: false,
    reason,
    sessionKeys: input.sessionKeys,
  });
}

export async function deleteWarehouseInventoryLinkedAfterRedefinition(
  session: AppSession,
  input: { redefinitionSessionKey: string; sessionKey: string },
) {
  assertWarehouseAccess(session);
  const sessionKey = text(input.sessionKey);
  const redefinitionSessionKey = text(input.redefinitionSessionKey);
  if (!sessionKey || !redefinitionSessionKey) {
    throw new Error("Thiếu phiên định nghĩa lại để xác nhận dọn dữ liệu.");
  }

  const cutoff = new Date(Date.now() - 1000 * 60 * 30);
  const db = getDb();
  const [definitionSession, audit] = await Promise.all([
    db.warehouseRfidDefinitionSession.findUnique({
      select: {
        mode: true,
        occurredAt: true,
        operatorName: true,
        rawPayload: true,
      },
      where: { sessionKey: redefinitionSessionKey },
    }),
    db.auditLog.findFirst({
      select: { id: true },
      where: {
        actorId: session.userId,
        createdAt: { gte: cutoff },
        metadata: {
          equals: redefinitionSessionKey,
          path: ["definitionSessionKey"],
        },
        targetType: "WarehouseRfidTag",
      },
    }),
  ]);
  const definitionRaw = jsonRecord(definitionSession?.rawPayload);
  if (
    !definitionSession ||
    definitionSession.mode !== "redefinition" ||
    definitionSession.occurredAt < cutoff ||
    definitionSession.operatorName !== session.displayName ||
    text(definitionRaw.inventorySessionKey) !== sessionKey ||
    !audit
  ) {
    throw new Error(
      "Quyền dọn nhóm phiên chỉ có hiệu lực ngay sau thao tác định nghĩa lại của chính bạn.",
    );
  }

  return deleteWarehouseInventorySessionsInternal(session, {
    includeLinked: true,
    reason: `Dọn nhóm phiên sau định nghĩa lại ${redefinitionSessionKey}`,
    sessionKeys: [sessionKey],
  });
}

export async function mergeWarehouseInventorySessions(
  session: AppSession,
  sessionKeyValues: string[],
) {
  assertWarehouseAccess(session);
  const sourceSessionKeys = [
    ...new Set(sessionKeyValues.map((item) => text(item)).filter(Boolean)),
  ];
  if (sourceSessionKeys.length < 2) {
    throw new Error("Vui lòng chọn ít nhất hai phiên kiểm kê để ghép.");
  }
  if (sourceSessionKeys.length > 50) {
    throw new Error("Mỗi lần chỉ ghép tối đa 50 phiên kiểm kê.");
  }

  const db = getDb();
  const sources = await db.warehouseInventorySession.findMany({
    include: {
      items: {
        select: {
          epc: true,
          firstReadAt: true,
          lastReadAt: true,
          readCount: true,
        },
      },
    },
    where: { sessionKey: { in: sourceSessionKeys } },
  });
  if (sources.length !== sourceSessionKeys.length) {
    throw new Error("Có phiên kiểm kê đã chọn không còn tồn tại.");
  }

  const mergedTags = new Map<string, NormalizedTag>();
  for (const source of sources) {
    for (const item of source.items) {
      const current = mergedTags.get(item.epc);
      mergedTags.set(item.epc, {
        epc: item.epc,
        firstReadAt: earlierDate(
          current?.firstReadAt ?? null,
          item.firstReadAt,
        ),
        lastReadAt: laterDate(current?.lastReadAt ?? null, item.lastReadAt),
        readCount: Math.max(current?.readCount ?? 0, item.readCount),
      });
    }
  }
  if (!mergedTags.size) {
    throw new Error("Các phiên đã chọn không có RFID để ghép.");
  }

  const latestScanDate = sources.reduce(
    (latest, item) =>
      item.scanDate.getTime() > latest.getTime() ? item.scanDate : latest,
    sources[0].scanDate,
  );
  const commonValue = (values: string[]) => {
    const unique = [...new Set(values.map((item) => text(item)))];
    return unique.length === 1 ? unique[0] : "";
  };
  const sessionKey = `inventory-merge-${dateKey(latestScanDate).replaceAll("-", "")}-${Date.now().toString().slice(-6)}-${randomUUID().slice(0, 6)}`;
  const tags = [...mergedTags.values()].sort((left, right) =>
    left.epc.localeCompare(right.epc, "vi"),
  );
  await ingestWarehouseInventoryPayload({
    action: "warehouseInventoryScan",
    area: commonValue(sources.map((item) => item.area || "")),
    companyKey: commonValue(sources.map((item) => item.companyKey)),
    date: dateKey(latestScanDate),
    deviceName: "Cổng vận hành V3 · Ghép kiểm kê",
    inventoryType: commonValue(sources.map((item) => item.inventoryType)),
    operator: session.displayName,
    rfids: tags.map((item) => item.epc),
    sessionId: sessionKey,
    shelf: commonValue(sources.map((item) => item.shelf || "")),
    source: "Web/Kiểm kê RFID · Ghép phiên",
    tags: tags.map((item) => ({
      epc: item.epc,
      timestamp: (item.firstReadAt ?? item.lastReadAt)?.toISOString() || "",
    })),
    totalReadCount: sources.reduce(
      (total, item) => total + item.requestedReadCount,
      0,
    ),
  });

  try {
    await db.$transaction(async (tx) => {
      const mergedSession = await tx.warehouseInventorySession.findUnique({
        select: { id: true, rawPayload: true },
        where: { sessionKey },
      });
      if (!mergedSession) {
        throw new Error("Không tạo được phiên kiểm kê ghép.");
      }
      await tx.warehouseInventorySessionLink.createMany({
        data: sources.map((item) => ({
          createdById: session.userId,
          createdByName: session.displayName,
          mergedSessionId: mergedSession.id,
          sourceSessionId: item.id,
        })),
        skipDuplicates: true,
      });
      await tx.warehouseInventorySession.update({
        data: {
          message: `Đã ghép ${sources.length} phiên, nhận ${tags.length} RFID unique.`,
          rawPayload: json({
            ...jsonRecord(mergedSession.rawPayload),
            merge: {
              createdByName: session.displayName,
              sourceSessionKeys,
            },
          }),
        },
        where: { id: mergedSession.id },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          actorId: session.userId,
          metadata: json({
            mergedSessionKey: sessionKey,
            sourceSessionKeys,
            uniqueRfidCount: tags.length,
          }),
          summary: `Ghép ${sources.length} phiên kiểm kê thành ${sessionKey}.`,
          targetId: mergedSession.id,
          targetType: "WarehouseInventorySession",
        },
      });
    });
  } catch (error) {
    await db.warehouseInventorySession.deleteMany({ where: { sessionKey } });
    throw error;
  }

  return {
    mergedRfidCount: tags.length,
    sourceSessionCount: sources.length,
    sessionKey,
  };
}

export async function compareWarehouseInventorySessions(
  session: AppSession,
  inputSessionKeyValue: string,
  outputSessionKeyValue: string,
): Promise<WarehouseInventoryPairComparisonData> {
  assertWarehouseAccess(session);
  const inputSessionKey = text(inputSessionKeyValue);
  const outputSessionKey = text(outputSessionKeyValue);
  if (!inputSessionKey || !outputSessionKey) {
    throw new Error("Vui lòng chọn đủ phiên số 1 và phiên số 2 để so sánh.");
  }
  if (inputSessionKey === outputSessionKey) {
    throw new Error("Phiên đầu vào và đầu ra phải là hai phiên khác nhau.");
  }

  const rows = await getDb().warehouseInventorySession.findMany({
    select: {
      comparison: true,
      operatorName: true,
      scanDate: true,
      sessionKey: true,
      updatedAt: true,
    },
    where: { sessionKey: { in: [inputSessionKey, outputSessionKey] } },
  });
  const bySessionKey = new Map(rows.map((row) => [row.sessionKey, row]));
  const inputSession = bySessionKey.get(inputSessionKey);
  const outputSession = bySessionKey.get(outputSessionKey);
  if (!inputSession || !outputSession) {
    throw new Error("Không tìm thấy đủ hai phiên kiểm kê đã chọn.");
  }

  const lineMap = new Map<
    string,
    {
      inputQuantity: number;
      name: string;
      outputQuantity: number;
      sku: string;
    }
  >();
  const addLines = (
    comparisonValue: unknown,
    quantityField: "inputQuantity" | "outputQuantity",
  ) => {
    for (const line of jsonArray<WarehouseInventoryComparisonLine>(
      comparisonValue,
    )) {
      const sku = text(line.sku);
      const key = normalizedKey(sku);
      const quantity = Math.max(0, number(line.physicalQuantity));
      if (!key || quantity <= 0) continue;
      const current = lineMap.get(key) ?? {
        inputQuantity: 0,
        name: "",
        outputQuantity: 0,
        sku,
      };
      current[quantityField] += quantity;
      if (text(line.name)) current.name = text(line.name);
      if (!current.sku) current.sku = sku;
      lineMap.set(key, current);
    }
  };
  addLines(inputSession.comparison, "inputQuantity");
  addLines(outputSession.comparison, "outputQuantity");

  const lines = [...lineMap.values()]
    .map((line) => ({
      ...line,
      difference: line.outputQuantity - line.inputQuantity,
      name: line.name || "Chưa có tên hàng hóa",
    }))
    .sort((left, right) => left.sku.localeCompare(right.sku, "vi"));
  const inputQuantity = lines.reduce(
    (total, line) => total + line.inputQuantity,
    0,
  );
  const outputQuantity = lines.reduce(
    (total, line) => total + line.outputQuantity,
    0,
  );

  return {
    inputSession: {
      operatorName: inputSession.operatorName || "",
      scanDate: dateKey(inputSession.scanDate),
      sessionKey: inputSession.sessionKey,
      updatedAt: inputSession.updatedAt.toISOString(),
    },
    lines,
    outputSession: {
      operatorName: outputSession.operatorName || "",
      scanDate: dateKey(outputSession.scanDate),
      sessionKey: outputSession.sessionKey,
      updatedAt: outputSession.updatedAt.toISOString(),
    },
    summary: {
      changedSkuCount: lines.filter((line) => line.difference !== 0).length,
      differenceQuantity: outputQuantity - inputQuantity,
      inputQuantity,
      outputQuantity,
      skuCount: lines.length,
    },
  };
}

export async function searchWarehouseInventoryProducts(
  session: AppSession,
  queryValue: string,
) {
  assertWarehouseAccess(session);
  const query = text(queryValue);
  if (query.length < 2) return [];
  const rows = await getDb().warehouseProduct.findMany({
    include: { _count: { select: { rfidTags: true } } },
    orderBy: { sku: "asc" },
    take: 20,
    where: {
      OR: [
        { barcode: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
      ],
    },
  });
  const key = normalizedKey(query);
  return rows
    .map((row) => ({
      barcode: row.barcode || "",
      name: row.name,
      rfidCount: row._count.rfidTags,
      sku: row.sku,
      status: row.status,
    }))
    .sort((left, right) => {
      const rank = (item: { barcode: string; name: string; sku: string }) => {
        if (normalizedKey(item.sku) === key) return 0;
        if (normalizedKey(item.barcode) === key) return 1;
        if (normalizedKey(item.sku).startsWith(key)) return 2;
        if (normalizedKey(item.name).startsWith(key)) return 3;
        return 4;
      };
      return (
        rank(left) - rank(right) || left.sku.localeCompare(right.sku, "vi")
      );
    });
}

export async function defineWarehouseInventoryUnknownRfids(
  session: AppSession,
  input: { epcs: string[]; sessionKey: string; sku: string },
) {
  assertWarehouseAccess(session);
  const sessionKey = text(input.sessionKey);
  const sku = text(input.sku);
  const requestedEpcs = [
    ...new Set(input.epcs.map((item) => epc(item)).filter(Boolean)),
  ];
  if (!sessionKey) throw new Error("Thiếu mã phiên kiểm kê.");
  if (!sku) throw new Error("Vui lòng chọn SKU cần gán.");
  if (!requestedEpcs.length) {
    throw new Error("Vui lòng chọn ít nhất một RFID chưa định nghĩa.");
  }
  if (requestedEpcs.length > 1_000) {
    throw new Error("Mỗi lần chỉ gán tối đa 1.000 RFID.");
  }

  const db = getDb();
  const [inventorySession, product] = await Promise.all([
    db.warehouseInventorySession.findUnique({
      select: {
        confirmedAt: true,
        items: {
          select: { epc: true },
          where: { epc: { in: requestedEpcs } },
        },
      },
      where: { sessionKey },
    }),
    db.warehouseProduct.findUnique({ where: { sku } }),
  ]);
  if (!inventorySession) throw new Error("Không tìm thấy phiên kiểm kê.");
  if (inventorySession.confirmedAt) {
    throw new Error(
      "Phiên đã xác nhận nên không thể thay đổi định nghĩa RFID.",
    );
  }
  if (!product)
    throw new Error(`Không tìm thấy SKU ${sku} trong Cấu hình Kho.`);

  const sessionEpcs = new Set(inventorySession.items.map((item) => item.epc));
  const candidates = requestedEpcs.filter((item) => sessionEpcs.has(item));
  if (!candidates.length) {
    throw new Error("RFID đã chọn không còn thuộc phiên kiểm kê này.");
  }
  const currentDefinitions = await db.warehouseRfidTag.findMany({
    select: { epc: true, productId: true, productSku: true },
    where: { epc: { in: candidates } },
  });
  const alreadyMapped = new Set(
    currentDefinitions
      .filter((item) => item.productId || item.productSku)
      .map((item) => item.epc),
  );
  const eligibleEpcs = candidates.filter((item) => !alreadyMapped.has(item));
  if (!eligibleEpcs.length) {
    throw new Error("Các RFID đã chọn đều đã được định nghĩa trước đó.");
  }

  const definition = await ingestWarehouseRfidDefinitionPayload({
    action: "warehouseDefineRfidBatch",
    barcode: product.barcode || "",
    createdAt: new Date().toISOString(),
    deviceName: "Cổng vận hành V3",
    expectedQty: eligibleEpcs.length,
    issuanceStatus: "ACTIVE",
    operator: session.displayName,
    rfids: eligibleEpcs,
    sessionId: `inventory-def-${Date.now()}-${randomUUID().slice(0, 8)}`,
    sku: product.sku,
    source: "Web/Kiểm kê RFID",
  });
  await rebuildWarehouseInventorySession(session, sessionKey);

  const ignoredCount = requestedEpcs.length - eligibleEpcs.length;
  return {
    definedCount: definition.createdCount,
    errorCount: definition.errorCount,
    ignoredCount,
    message: `Đã gán ${definition.createdCount} RFID vào ${product.sku} — ${product.name}${ignoredCount ? `; bỏ qua ${ignoredCount} mã đã được định nghĩa hoặc không còn trong phiên` : ""}${definition.errorCount ? `; ${definition.errorCount} mã cần kiểm tra` : ""}.`,
    sessionKey,
  };
}

export async function reassignWarehouseInventoryRfids(
  session: AppSession,
  input: { epcs: string[]; sessionKey: string; sku: string },
) {
  assertWarehouseAccess(session);
  const sessionKey = text(input.sessionKey);
  const sku = text(input.sku);
  const requestedEpcs = [
    ...new Set(input.epcs.map((item) => epc(item)).filter(Boolean)),
  ];
  if (!sessionKey) throw new Error("Thiếu mã phiên kiểm kê.");
  if (!sku) throw new Error("Vui lòng chọn SKU mới cần gán.");
  if (!requestedEpcs.length) {
    throw new Error("Vui lòng chọn ít nhất một RFID cần định nghĩa lại.");
  }
  if (requestedEpcs.length > 1_000) {
    throw new Error("Mỗi lần chỉ định nghĩa lại tối đa 1.000 RFID.");
  }

  const db = getDb();
  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ lockResult: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${sessionKey}))::text AS "lockResult"
      `;

      const [inventorySession, product] = await Promise.all([
        tx.warehouseInventorySession.findUnique({
          select: {
            confirmedAt: true,
            id: true,
            items: {
              select: { epc: true },
              where: { epc: { in: requestedEpcs } },
            },
          },
          where: { sessionKey },
        }),
        tx.warehouseProduct.findUnique({ where: { sku } }),
      ]);
      if (!inventorySession) throw new Error("Không tìm thấy phiên kiểm kê.");
      if (inventorySession.confirmedAt) {
        throw new Error("Phiên đã xác nhận nên không thể định nghĩa lại RFID.");
      }
      if (!product) {
        throw new Error(`Không tìm thấy SKU ${sku} trong Cấu hình Kho.`);
      }

      const sessionEpcs = new Set(
        inventorySession.items.map((item) => item.epc),
      );
      const candidateEpcs = requestedEpcs.filter((item) =>
        sessionEpcs.has(item),
      );
      if (!candidateEpcs.length) {
        throw new Error("RFID đã chọn không còn thuộc phiên kiểm kê này.");
      }

      const tags = await tx.warehouseRfidTag.findMany({
        select: {
          epc: true,
          id: true,
          issuanceStatus: true,
          productId: true,
          productName: true,
          productSku: true,
        },
        where: { epc: { in: candidateEpcs } },
      });
      const remappedTags = tags.filter((tag) => {
        const currentSku = tag.productSku || "";
        return (
          tag.issuanceStatus !== "CANCELLED" &&
          Boolean(tag.productId || currentSku) &&
          normalizedKey(currentSku) !== normalizedKey(product.sku)
        );
      });
      if (!remappedTags.length) {
        throw new Error(
          `Các RFID đã chọn chưa có định nghĩa cũ hoặc đang thuộc SKU ${product.sku}.`,
        );
      }

      const occurredAt = new Date();
      const definitionSessionKey = `inventory-remap-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const skippedCount = requestedEpcs.length - remappedTags.length;
      const definitionSession = await tx.warehouseRfidDefinitionSession.create({
        data: {
          barcode: product.barcode || null,
          createdCount: remappedTags.length,
          deviceName: "Cổng vận hành V3",
          errorCount: 0,
          expectedQty: requestedEpcs.length,
          issuanceStatus: "ACTIVE",
          message: `Đã định nghĩa lại ${remappedTags.length} RFID sang SKU ${product.sku}.`,
          mode: "redefinition",
          occurredAt,
          operatorName: session.displayName,
          processStatus: "SUCCESS",
          productName: product.name,
          rawPayload: json({
            inventorySessionKey: sessionKey,
            rfids: remappedTags.map((tag) => tag.epc),
            sku: product.sku,
          }),
          requestedCount: requestedEpcs.length,
          sessionKey: definitionSessionKey,
          skippedCount,
          sku: product.sku,
          source: "Web/Kiểm kê RFID · Định nghĩa lại",
        },
      });

      await tx.warehouseRfidTag.updateMany({
        data: {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          updatedByName: session.displayName,
        },
        where: { id: { in: remappedTags.map((tag) => tag.id) } },
      });
      await tx.warehouseRfidIssuanceEvent.createMany({
        data: remappedTags.map((tag) => ({
          barcode: product.barcode || null,
          deviceName: "Cổng vận hành V3",
          epc: tag.epc,
          eventType: "REASSIGNED",
          issuanceStatus: tag.issuanceStatus || "ACTIVE",
          message: `Định nghĩa lại từ ${tag.productSku || tag.productName || "chưa rõ SKU"} sang ${product.sku}.`,
          occurredAt,
          operatorName: session.displayName,
          productName: product.name,
          rawPayload: json({
            inventorySessionKey: sessionKey,
            previousProductName: tag.productName || "",
            previousSku: tag.productSku || "",
            targetSku: product.sku,
          }),
          rfidTagId: tag.id,
          sessionId: definitionSession.id,
          sku: product.sku,
        })),
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: json({
            definitionSessionKey,
            epcSample: remappedTags.slice(0, 50).map((tag) => tag.epc),
            inventorySessionKey: sessionKey,
            previousSkuSample: [
              ...new Set(
                remappedTags
                  .map((tag) => tag.productSku || tag.productName || "")
                  .filter(Boolean),
              ),
            ].slice(0, 30),
            remappedCount: remappedTags.length,
            requestedCount: requestedEpcs.length,
            targetSku: product.sku,
          }),
          summary: `Định nghĩa lại ${remappedTags.length} RFID sang SKU ${product.sku} từ phiên kiểm kê ${sessionKey}.`,
          targetId: remappedTags.length === 1 ? remappedTags[0].id : null,
          targetType: "WarehouseRfidTag",
        },
      });

      return {
        definitionSessionKey,
        remappedCount: remappedTags.length,
        skippedCount,
        targetName: product.name,
        targetSku: product.sku,
      };
    },
    { maxWait: 5_000, timeout: 20_000 },
  );

  await rebuildWarehouseInventorySession(session, sessionKey);
  const affectedSessionCount =
    await warehouseInventoryLinkedGroupSize(sessionKey);
  return {
    ...result,
    affectedSessionCount,
    redefinitionSessionKey: result.definitionSessionKey,
    message: `Đã chuyển ${result.remappedCount} RFID sang ${result.targetSku} — ${result.targetName}${result.skippedCount ? `; bỏ qua ${result.skippedCount} mã không còn hợp lệ hoặc đã thuộc SKU đích` : ""}.`,
    sessionKey,
  };
}

export async function cancelWarehouseInventoryRfids(
  session: AppSession,
  input: { epcs: string[]; sessionKey: string },
) {
  assertWarehouseAccess(session);
  const sessionKey = text(input.sessionKey);
  const requestedEpcs = [
    ...new Set(input.epcs.map((item) => epc(item)).filter(Boolean)),
  ];
  if (!sessionKey) throw new Error("Thiếu mã phiên kiểm kê.");
  if (!requestedEpcs.length) {
    throw new Error("Vui lòng chọn ít nhất một RFID cần Hủy.");
  }
  if (requestedEpcs.length > 1_000) {
    throw new Error("Mỗi lần chỉ Hủy tối đa 1.000 RFID.");
  }

  const db = getDb();
  const inventorySession = await db.warehouseInventorySession.findUnique({
    select: {
      confirmedAt: true,
      id: true,
      items: {
        select: { epc: true },
        where: { epc: { in: requestedEpcs } },
      },
    },
    where: { sessionKey },
  });
  if (!inventorySession) throw new Error("Không tìm thấy phiên kiểm kê.");
  if (inventorySession.confirmedAt) {
    throw new Error("Phiên đã xác nhận nên không thể Hủy RFID.");
  }

  const sessionEpcs = new Set(inventorySession.items.map((item) => item.epc));
  const candidates = requestedEpcs.filter((item) => sessionEpcs.has(item));
  if (!candidates.length) {
    throw new Error("RFID đã chọn không còn thuộc phiên kiểm kê này.");
  }

  const definitionSessionKey = `inventory-cancel-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const cancellation = await ingestWarehouseRfidDefinitionPayload({
    action: "warehouseDefineRfidBatch",
    createdAt: new Date().toISOString(),
    deviceName: "Cổng vận hành V3",
    expectedQty: candidates.length,
    issuanceStatus: "CANCELLED",
    operator: session.displayName,
    rfids: candidates,
    sessionId: definitionSessionKey,
    source: "Web/Kiểm kê RFID · Hủy mã",
  });

  await rebuildWarehouseInventorySession(session, sessionKey);
  await db.auditLog.create({
    data: {
      action: "UPDATE",
      actorId: session.userId,
      metadata: json({
        cancelledCount: cancellation.createdCount,
        definitionSessionKey,
        epcSample: candidates.slice(0, 50),
        errorCount: cancellation.errorCount,
        inventorySessionKey: sessionKey,
        requestedCount: requestedEpcs.length,
        skippedCount: cancellation.skippedCount,
      }),
      summary: `Hủy ${cancellation.createdCount} RFID từ phiên kiểm kê ${sessionKey}.`,
      targetId: inventorySession.id,
      targetType: "WarehouseInventorySession",
    },
  });

  return {
    cancelledCount: cancellation.createdCount,
    errorCount: cancellation.errorCount,
    message: `Đã chuyển ${cancellation.createdCount} RFID sang trạng thái Hủy; các lần kiểm kê sau sẽ tự bỏ qua các mã này${cancellation.skippedCount ? `; ${cancellation.skippedCount} mã đã Hủy trước đó` : ""}${cancellation.errorCount ? `; ${cancellation.errorCount} mã không thể Hủy` : ""}.`,
    sessionKey,
    skippedCount: cancellation.skippedCount,
  };
}

export async function removeWarehouseInventorySessionRfids(
  session: AppSession,
  input: { epcs: string[]; sessionKey: string },
) {
  assertWarehouseAccess(session);
  const sessionKey = text(input.sessionKey);
  const requestedEpcs = [
    ...new Set(input.epcs.map((item) => epc(item)).filter(Boolean)),
  ];
  if (!sessionKey) throw new Error("Thiếu mã phiên kiểm kê.");
  if (!requestedEpcs.length) {
    throw new Error("Vui lòng chọn ít nhất một RFID cần loại khỏi phiên.");
  }
  if (requestedEpcs.length > 1_000) {
    throw new Error("Mỗi lần chỉ loại tối đa 1.000 RFID khỏi phiên.");
  }

  const db = getDb();
  const result = await db.$transaction(
    async (tx) => {
      await tx.$queryRaw<Array<{ lockResult: string }>>`
        SELECT pg_advisory_xact_lock(hashtext(${sessionKey}))::text AS "lockResult"
      `;
      const inventorySession = await tx.warehouseInventorySession.findUnique({
        include: {
          items: {
            select: {
              epc: true,
              firstReadAt: true,
              lastReadAt: true,
              readCount: true,
            },
          },
        },
        where: { sessionKey },
      });
      if (!inventorySession) throw new Error("Không tìm thấy phiên kiểm kê.");
      if (inventorySession.confirmedAt) {
        throw new Error(
          "Phiên đã xác nhận nên không thể loại RFID khỏi kết quả kiểm kê.",
        );
      }

      const requestedSet = new Set(requestedEpcs);
      const removed = inventorySession.items.filter((item) =>
        requestedSet.has(item.epc),
      );
      if (!removed.length) {
        throw new Error("RFID đã chọn không còn thuộc phiên kiểm kê này.");
      }
      const remaining: NormalizedTag[] = inventorySession.items
        .filter((item) => !requestedSet.has(item.epc))
        .map((item) => ({
          epc: item.epc,
          firstReadAt: item.firstReadAt,
          lastReadAt: item.lastReadAt,
          readCount: item.readCount,
        }));
      const removedReadCount = removed.reduce(
        (total, item) => total + Math.max(1, item.readCount),
        0,
      );
      const requestedReadCount = Math.max(
        remaining.length,
        inventorySession.requestedReadCount - removedReadCount,
      );
      const knownTags = remaining.length
        ? await tx.warehouseRfidTag.findMany({
            include: { product: true },
            where: { epc: { in: remaining.map((item) => item.epc) } },
          })
        : [];
      const tagMap = new Map<string, WarehouseTagLookup>(
        knownTags.map((tag) => [tag.epc, tag]),
      );
      const recalculated = evaluateWarehouseInventory(
        remaining,
        tagMap,
        requestedReadCount,
      );

      await tx.warehouseInventoryScanItem.deleteMany({
        where: {
          epc: { in: removed.map((item) => item.epc) },
          sessionId: inventorySession.id,
        },
      });
      await tx.warehouseInventorySession.update({
        data: {
          comparison: json(recalculated.comparison),
          duplicateRfidCount: recalculated.duplicateRfids.length,
          duplicateRfids: json(recalculated.duplicateRfids),
          inStockRfidCount: recalculated.summary.inStockRfidCount,
          knownRfidCount: recalculated.summary.knownRfidCount,
          message: `Đã loại ${removed.length} RFID khỏi phiên; còn ${remaining.length} RFID trong kết quả kiểm kê.`,
          processStatus: recalculated.processStatus,
          rawPayload: json(
            storedInventoryRawPayload(
              inventorySession.rawPayload,
              remaining,
              requestedReadCount,
            ),
          ),
          requestedReadCount,
          statement: json(recalculated.statement),
          summary: json(recalculated.summary),
          uniqueRfidCount: remaining.length,
          unknownRfids: json(recalculated.unknownRfids),
          wrongCompanyRfids: json([]),
          wrongStatusRfids: json(recalculated.wrongStatusRfids),
        },
        where: { id: inventorySession.id },
      });
      await tx.warehouseRfidTag.updateMany({
        data: { lastInventorySessionKey: null },
        where: {
          epc: { in: removed.map((item) => item.epc) },
          lastInventorySessionKey: sessionKey,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: json({
            epcSample: removed.slice(0, 50).map((item) => item.epc),
            inventorySessionKey: sessionKey,
            remainingCount: remaining.length,
            removedCount: removed.length,
            requestedCount: requestedEpcs.length,
          }),
          summary: `Loại ${removed.length} RFID khỏi phiên kiểm kê ${sessionKey}.`,
          targetId: inventorySession.id,
          targetType: "WarehouseInventorySession",
        },
      });

      return { removedCount: removed.length, remainingCount: remaining.length };
    },
    { maxWait: 5_000, timeout: 20_000 },
  );

  return {
    ...result,
    message: `Đã loại ${result.removedCount} RFID khỏi phiên kiểm kê; còn ${result.remainingCount} RFID. Dữ liệu RFID trong Kho không bị xóa.`,
    sessionKey,
  };
}

export async function getWarehouseInventoryWorkspace(
  session: AppSession,
  selectedSessionKey = "",
): Promise<WarehouseInventoryWorkspaceData> {
  assertWarehouseAccess(session);
  const db = getDb();
  const [rows, productCount, tagCount, mappedTagCount] = await Promise.all([
    db.warehouseInventorySession.findMany({
      include: {
        _count: {
          select: { items: true, mergedInto: true, mergedSources: true },
        },
      },
      orderBy: [{ scanDate: "desc" }, { updatedAt: "desc" }],
      take: 180,
    }),
    db.warehouseProduct.count(),
    db.warehouseRfidTag.count(),
    db.warehouseRfidTag.count({
      where: {
        OR: [{ productId: { not: null } }, { productSku: { not: null } }],
      },
    }),
  ]);
  const sessions = rows.map(sessionItem);
  const target = selectedSessionKey || sessions[0]?.sessionKey || "";
  return {
    detail: target ? await detailBySessionKey(target) : null,
    generatedAt: new Date().toISOString(),
    sessions,
    sourceStats: { mappedTagCount, productCount, tagCount },
  };
}

export async function confirmWarehouseInventorySession(
  session: AppSession,
  sessionKey: string,
) {
  assertWarehouseAccess(session);
  const db = getDb();
  const row = await db.warehouseInventorySession.findUnique({
    where: { sessionKey },
  });
  if (!row) throw new Error("Không tìm thấy phiên kiểm kê.");
  const statement = jsonRecord(row.statement) as WarehouseInventoryStatement;
  if (!statement.readyToConfirm) {
    throw new Error(
      "Phiên còn RFID chưa nhận diện được SKU nên chưa thể xác nhận.",
    );
  }
  if (row.confirmedAt) {
    return { message: "Phiên này đã được xác nhận trước đó.", sessionKey };
  }
  await db.$transaction([
    db.warehouseInventorySession.update({
      data: {
        confirmedAt: new Date(),
        confirmedById: session.userId,
        confirmedByName: session.displayName,
        processStatus: "CONFIRMED",
      },
      where: { id: row.id },
    }),
    db.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: json({
          companyKey: row.companyKey,
          inventoryType: row.inventoryType,
          scanDate: dateKey(row.scanDate),
        }),
        summary: `Xác nhận biên bản kiểm kê RFID ${sessionKey}.`,
        targetId: row.id,
        targetType: "WarehouseInventorySession",
      },
    }),
  ]);
  return { message: "Đã xác nhận biên bản kiểm kê.", sessionKey };
}

export async function deleteWarehouseInventorySession(
  session: AppSession,
  input: { password: string; reason: string; sessionKey: string },
) {
  assertWarehouseAccess(session);
  const sessionKey = text(input.sessionKey);
  if (!sessionKey) throw new Error("Thiếu mã phiên kiểm kê cần xóa.");
  const reason = await assertWarehouseDeleteCredential(session, input);
  const db = getDb();
  const row = await db.warehouseInventorySession.findUnique({
    include: { _count: { select: { items: true } } },
    where: { sessionKey },
  });
  if (!row)
    throw new Error("Không tìm thấy phiên kiểm kê hoặc phiên đã được xóa.");

  await db.$transaction(async (tx) => {
    await tx.warehouseRfidTag.updateMany({
      data: { lastInventorySessionKey: null },
      where: { lastInventorySessionKey: sessionKey },
    });
    await tx.warehouseInventorySession.delete({ where: { id: row.id } });
    await tx.auditLog.create({
      data: {
        action: "DELETE",
        actorId: session.userId,
        metadata: json({
          confirmedAt: row.confirmedAt?.toISOString() || null,
          deletedItemCount: row._count.items,
          deviceName: row.deviceName || "",
          operatorName: row.operatorName || "",
          reason,
          scanDate: dateKey(row.scanDate),
          sessionKey,
        }),
        summary: `Xóa vĩnh viễn phiên kiểm kê RFID ${sessionKey}. Lý do: ${reason}`,
        targetId: row.id,
        targetType: "WarehouseInventorySession",
      },
    });
  });

  return { deletedItemCount: row._count.items, sessionKey };
}

export async function rebuildWarehouseInventorySession(
  session: AppSession,
  sessionKey: string,
) {
  assertWarehouseAccess(session);
  const row = await getDb().warehouseInventorySession.findUnique({
    select: { confirmedAt: true, rawPayload: true },
    where: { sessionKey },
  });
  if (!row) throw new Error("Không tìm thấy phiên kiểm kê.");
  if (row.confirmedAt) {
    throw new Error("Biên bản đã xác nhận nên không thể ghi lại kết quả.");
  }
  return ingestWarehouseInventoryPayload(row.rawPayload);
}
