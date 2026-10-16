import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import type {
  WarehouseInfoWorkspaceData,
  WarehouseInventoryProductOption,
  WarehouseRfidDefinitionDetail,
  WarehouseRfidDefinitionResult,
  WarehouseRfidDefinitionSessionItem,
  WarehouseRfidIssuanceStatus,
  WarehouseRfidRegistryRow,
} from "./types";
import { assertWarehouseDeleteCredential } from "./secure-delete";

type UnknownRecord = Record<string, unknown>;

export type NormalizedWarehouseRfidDefinitionPayload = {
  barcode: string;
  deviceName: string;
  expectedQty: number;
  issuanceStatus: WarehouseRfidIssuanceStatus;
  occurredAt: Date;
  operatorName: string;
  raw: UnknownRecord;
  rfids: string[];
  scanPower: number | null;
  scanRangeHint: string;
  sessionKey: string;
  sku: string;
  source: string;
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

function normalizedKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
}

function firstValue(source: UnknownRecord, keys: string[]) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && text(value)) return value;
  }
  return "";
}

function integer(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? {})) as Prisma.InputJsonValue;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return record(JSON.parse(JSON.stringify(value ?? {})));
}

function normalizeEpc(value: unknown) {
  return text(value).replace(/\s+/g, "").toUpperCase();
}

function redactDeletedEpcs(
  value: unknown,
  deletedEpcs: ReadonlySet<string>,
): unknown {
  if (typeof value === "string") {
    return deletedEpcs.has(normalizeEpc(value)) ? undefined : value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => redactDeletedEpcs(item, deletedEpcs))
      .filter((item) => item !== undefined);
  }
  if (!value || typeof value !== "object") return value;

  const source = value as UnknownRecord;
  if (
    ["epc", "rfid", "code"].some((key) =>
      deletedEpcs.has(normalizeEpc(source[key])),
    )
  ) {
    return undefined;
  }
  return Object.fromEntries(
    Object.entries(source)
      .map(
        ([key, item]) => [key, redactDeletedEpcs(item, deletedEpcs)] as const,
      )
      .filter(([, item]) => item !== undefined),
  );
}

function parseDate(value: unknown) {
  const raw = text(value);
  const parsed = raw ? new Date(raw) : new Date();
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function normalizeWarehouseRfidIssuanceStatus(
  value: unknown,
): WarehouseRfidIssuanceStatus {
  const key = normalizedKey(value);
  if (
    ["CANCELLED", "CANCELED", "CANCEL", "HUY", "INACTIVE", "DISABLED"].includes(
      key,
    )
  ) {
    return "CANCELLED";
  }
  return "ACTIVE";
}

export function normalizeWarehouseRfidDefinitionPayload(
  payload: unknown,
): NormalizedWarehouseRfidDefinitionPayload {
  const root = record(payload);
  const nested = record(root.payload);
  const source = { ...root, ...nested };
  const rawRfids = firstValue(source, ["rfids", "rfidList", "epcs", "tags"]);
  const candidates = Array.isArray(rawRfids)
    ? rawRfids
    : text(rawRfids)
      ? text(rawRfids).split(/[\n,;]+/)
      : [];
  const rfids = [
    ...new Set(
      candidates
        .map((value) =>
          normalizeEpc(
            typeof value === "object"
              ? firstValue(record(value), ["epc", "rfid", "code", "tag"])
              : value,
          ),
        )
        .filter(Boolean),
    ),
  ];
  if (!rfids.length) {
    throw new Error("JSON Định nghĩa RFID chưa có mã trong rfids hoặc tags.");
  }
  if (rfids.length > 10_000) {
    throw new Error("Một phiên chỉ nhận tối đa 10.000 RFID unique.");
  }
  const sessionKey =
    text(
      firstValue(source, ["sessionId", "scanSession", "localScanSessionId"]),
    ) || `android-def-${Date.now()}-${randomUUID().slice(0, 8)}`;
  if (sessionKey.length > 180) {
    throw new Error("sessionId dài quá giới hạn 180 ký tự.");
  }
  const issuanceStatus = normalizeWarehouseRfidIssuanceStatus(
    firstValue(source, [
      "issuanceStatus",
      "activationStatus",
      "usageStatus",
      "rfidStatus",
      "status",
    ]),
  );
  const sku = text(firstValue(source, ["sku", "productSku", "itemCode"]));
  const barcode = text(firstValue(source, ["barcode", "barCode"]));
  if (issuanceStatus === "ACTIVE" && !sku && !barcode) {
    throw new Error("Định nghĩa RFID Kích hoạt cần có SKU hoặc Barcode.");
  }
  const expectedQty = Math.max(integer(source.expectedQty), rfids.length);
  const scanPower = integer(source.scanPower);
  return {
    barcode,
    deviceName: text(
      firstValue(source, ["deviceName", "scannerName", "deviceId"]),
    ),
    expectedQty,
    issuanceStatus,
    occurredAt: parseDate(
      firstValue(source, [
        "createdAt",
        "issuedAt",
        "activatedAt",
        "cancelledAt",
        "occurredAt",
        "scannedAt",
      ]),
    ),
    operatorName: text(
      firstValue(source, [
        "operator",
        "operatorName",
        "employeeName",
        "issuedBy",
        "cancelledBy",
      ]),
    ),
    raw: jsonRecord(payload),
    rfids,
    scanPower: scanPower > 0 ? scanPower : null,
    scanRangeHint: text(source.scanRangeHint),
    sessionKey,
    sku,
    source: text(source.source) || "Android/RFID",
  };
}

function definitionMessage(input: {
  createdCount: number;
  errorCount: number;
  issuanceStatus: WarehouseRfidIssuanceStatus;
  skippedCount: number;
}) {
  const action = input.issuanceStatus === "CANCELLED" ? "hủy" : "phát hành";
  const parts = [`Đã ${action} ${input.createdCount} RFID`];
  if (input.skippedCount)
    parts.push(`${input.skippedCount} mã đã đúng trạng thái`);
  if (input.errorCount) parts.push(`${input.errorCount} mã cần kiểm tra`);
  return `${parts.join(", ")}.`;
}

function definitionResultFromRow(row: {
  createdCount: number;
  errorCount: number;
  message: string | null;
  sessionKey: string;
  skippedCount: number;
}): WarehouseRfidDefinitionResult {
  return {
    createdCount: row.createdCount,
    errorCount: row.errorCount,
    errors: [],
    message: row.message || "Phiên Định nghĩa RFID đã được tiếp nhận.",
    ok: row.errorCount === 0,
    sessionId: row.sessionKey,
    skippedCount: row.skippedCount,
  };
}

export async function ingestWarehouseRfidDefinitionPayload(
  payload: unknown,
): Promise<WarehouseRfidDefinitionResult> {
  const input = normalizeWarehouseRfidDefinitionPayload(payload);
  const db = getDb();
  const previous = await db.warehouseRfidDefinitionSession.findUnique({
    where: { sessionKey: input.sessionKey },
  });
  if (previous) return definitionResultFromRow(previous);

  const product =
    input.sku || input.barcode
      ? await db.warehouseProduct.findFirst({
          where: {
            OR: [
              ...(input.sku ? [{ sku: input.sku }] : []),
              ...(input.barcode ? [{ barcode: input.barcode }] : []),
            ],
          },
        })
      : null;
  if (input.issuanceStatus === "ACTIVE" && !product) {
    throw new Error(
      `Không tìm thấy SKU/Barcode "${input.sku || input.barcode}" trong Cấu hình Kho.`,
    );
  }

  return db.$transaction(async (tx) => {
    const session = await tx.warehouseRfidDefinitionSession.create({
      data: {
        barcode: product?.barcode || input.barcode || null,
        deviceName: input.deviceName || null,
        expectedQty: input.expectedQty,
        issuanceStatus: input.issuanceStatus,
        mode: "definition",
        occurredAt: input.occurredAt,
        operatorName: input.operatorName || null,
        processStatus: "PENDING",
        productName: product?.name || null,
        rawPayload: json(input.raw),
        requestedCount: input.rfids.length,
        scanPower: input.scanPower,
        scanRangeHint: input.scanRangeHint || null,
        sessionKey: input.sessionKey,
        sku: product?.sku || input.sku || null,
        source: input.source,
      },
    });
    // Same EPC lock as shelf definitions and the product registry trigger.
    // Lock in stable order so a mixed batch can report shelf conflicts per EPC.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('rfid-epc:' || epc, 0))::text
      FROM unnest(ARRAY[${Prisma.join(input.rfids)}]::text[]) AS epc ORDER BY epc`;
    const shelfClaims = await tx.$queryRaw<Array<{ epc: string }>>`
      SELECT epc FROM rfid_entity_registry
      WHERE entity_type='SHELF' AND epc IN (${Prisma.join(input.rfids)})`;
    const shelfEpcs = new Set(shelfClaims.map(row => row.epc));
    const existingTags = await tx.warehouseRfidTag.findMany({
      include: { product: true },
      where: { epc: { in: input.rfids } },
    });
    const tagMap = new Map(existingTags.map((tag) => [tag.epc, tag]));
    let createdCount = 0;
    let skippedCount = 0;
    const errors: Array<{ epc: string; message: string }> = [];

    for (const epc of input.rfids) {
      const existing = tagMap.get(epc);
      let eventType = "ISSUED";
      let message = "RFID đã được phát hành và gán SKU.";
      let tagId: string | null = existing?.id ?? null;
      let eventSku = product?.sku || input.sku || existing?.productSku || null;
      let eventName = product?.name || existing?.productName || null;
      const eventBarcode = product?.barcode || input.barcode || null;

      if (shelfEpcs.has(epc)) {
        message = "RFID đã được định nghĩa cho kệ, không thể gán hoặc hủy như hàng hóa.";
        eventType = "ERROR";
        errors.push({ epc, message });
      } else if (input.issuanceStatus === "CANCELLED") {
        if (!existing) {
          message = "RFID chưa từng được phát hành nên không thể hủy.";
          eventType = "ERROR";
          errors.push({ epc, message });
        } else if (existing.issuanceStatus === "CANCELLED") {
          message = "RFID đã ở trạng thái Hủy.";
          eventType = "SKIPPED";
          skippedCount += 1;
        } else {
          const updated = await tx.warehouseRfidTag.update({
            data: {
              cancelledAt: input.occurredAt,
              cancelledByName: input.operatorName || null,
              issuanceSessionKey: input.sessionKey,
              issuanceStatus: "CANCELLED",
              issuedDeviceName: input.deviceName || existing.issuedDeviceName,
              updatedByName: input.operatorName || null,
            },
            where: { id: existing.id },
          });
          tagId = updated.id;
          eventType = "CANCELLED";
          message = "RFID đã được chuyển sang trạng thái Hủy.";
          createdCount += 1;
        }
      } else if (!existing) {
        const created = await tx.warehouseRfidTag.create({
          data: {
            createdByName: input.operatorName || null,
            entryDate: input.occurredAt,
            epc,
            inboundSessionKey: input.sessionKey,
            issuanceSessionKey: input.sessionKey,
            issuanceStatus: "ACTIVE",
            issuedAt: input.occurredAt,
            issuedByName: input.operatorName || null,
            issuedDeviceName: input.deviceName || null,
            lastScannedAt: input.occurredAt,
            productId: product?.id || null,
            productName: product?.name || null,
            productSku: product?.sku || input.sku || null,
            rawSource: json({
              source: input.source,
              sessionId: input.sessionKey,
            }),
            status: "Tồn kho",
          },
        });
        tagId = created.id;
        createdCount += 1;
      } else {
        const currentSku = existing.product?.sku || existing.productSku || "";
        const targetSku = product?.sku || input.sku;
        if (
          currentSku &&
          targetSku &&
          normalizedKey(currentSku) !== normalizedKey(targetSku)
        ) {
          message = `RFID đang gán với SKU ${currentSku}, không tự động đổi sang ${targetSku}.`;
          eventType = "ERROR";
          errors.push({ epc, message });
          eventSku = currentSku;
          eventName = existing.product?.name || existing.productName;
        } else if (existing.issuanceStatus === "ACTIVE" && currentSku) {
          message = "RFID đã được phát hành và đang Kích hoạt.";
          eventType = "SKIPPED";
          skippedCount += 1;
        } else {
          const updated = await tx.warehouseRfidTag.update({
            data: {
              cancelledAt: null,
              cancelledByName: null,
              issuanceSessionKey: input.sessionKey,
              issuanceStatus: "ACTIVE",
              issuedAt: input.occurredAt,
              issuedByName: input.operatorName || null,
              issuedDeviceName: input.deviceName || null,
              productId: product?.id || existing.productId,
              productName: product?.name || existing.productName,
              productSku: product?.sku || input.sku || existing.productSku,
              updatedByName: input.operatorName || null,
            },
            where: { id: existing.id },
          });
          tagId = updated.id;
          eventType =
            existing.issuanceStatus === "CANCELLED" ? "REACTIVATED" : "ISSUED";
          message =
            eventType === "REACTIVATED"
              ? "RFID đã được tái kích hoạt."
              : "RFID đã được phát hành và gán SKU.";
          createdCount += 1;
        }
      }

      await tx.warehouseRfidIssuanceEvent.create({
        data: {
          barcode: eventBarcode,
          deviceName: input.deviceName || null,
          epc,
          eventType,
          issuanceStatus: input.issuanceStatus,
          message,
          occurredAt: input.occurredAt,
          operatorName: input.operatorName || null,
          productName: eventName,
          rawPayload: json({ source: input.source }),
          rfidTagId: tagId,
          sessionId: session.id,
          sku: eventSku,
        },
      });
    }

    const errorCount = errors.length;
    const processStatus =
      errorCount === 0
        ? "SUCCESS"
        : createdCount || skippedCount
          ? "PARTIAL"
          : "FAILED";
    const message = definitionMessage({
      createdCount,
      errorCount,
      issuanceStatus: input.issuanceStatus,
      skippedCount,
    });
    await tx.warehouseRfidDefinitionSession.update({
      data: { createdCount, errorCount, message, processStatus, skippedCount },
      where: { id: session.id },
    });
    return {
      createdCount,
      errorCount,
      errors,
      message,
      ok: errorCount === 0,
      sessionId: input.sessionKey,
      skippedCount,
    };
  });
}

function assertWarehouseInfoAccess(session: AppSession) {
  if (
    !session.fullAccess &&
    !session.modules.includes("warehouse-info") &&
    !session.moduleGroups.includes("warehouse")
  ) {
    throw new Error("Tài khoản chưa được cấp quyền mở Thông tin kho.");
  }
}

function sessionItem(row: {
  barcode: string | null;
  createdCount: number;
  deviceName: string | null;
  errorCount: number;
  expectedQty: number;
  issuanceStatus: string;
  occurredAt: Date;
  operatorName: string | null;
  processStatus: string;
  productName: string | null;
  requestedCount: number;
  sessionKey: string;
  skippedCount: number;
  sku: string | null;
  source: string;
}): WarehouseRfidDefinitionSessionItem {
  return {
    barcode: row.barcode || "",
    createdCount: row.createdCount,
    deviceName: row.deviceName || "",
    errorCount: row.errorCount,
    expectedQty: row.expectedQty,
    issuanceStatus: normalizeWarehouseRfidIssuanceStatus(row.issuanceStatus),
    occurredAt: row.occurredAt.toISOString(),
    operatorName: row.operatorName || "",
    processStatus: row.processStatus,
    productName: row.productName || "",
    requestedCount: row.requestedCount,
    sessionKey: row.sessionKey,
    skippedCount: row.skippedCount,
    sku: row.sku || "",
    source: row.source,
  };
}

function registryRow(row: {
  cancelledAt: Date | null;
  cancelledByName: string | null;
  epc: string;
  issuanceSessionKey: string | null;
  issuanceStatus: string;
  issuedAt: Date | null;
  issuedByName: string | null;
  issuedDeviceName: string | null;
  product: { name: string; sku: string } | null;
  productName: string | null;
  productSku: string | null;
  status: string;
  updatedAt: Date;
}): WarehouseRfidRegistryRow {
  return {
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByName: row.cancelledByName || "",
    epc: row.epc,
    issuanceSessionKey: row.issuanceSessionKey || "",
    issuanceStatus: normalizeWarehouseRfidIssuanceStatus(row.issuanceStatus),
    issuedAt: (row.issuedAt || row.updatedAt).toISOString(),
    issuedByName: row.issuedByName || "",
    issuedDeviceName: row.issuedDeviceName || "",
    productName: row.product?.name || row.productName || "",
    sku: row.product?.sku || row.productSku || "",
    stockStatus: row.status,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function definitionDetail(sessionKey: string) {
  const row = await getDb().warehouseRfidDefinitionSession.findUnique({
    include: { events: { orderBy: [{ epc: "asc" }] } },
    where: { sessionKey },
  });
  if (!row) return null;
  return {
    ...sessionItem(row),
    events: row.events.map((event) => ({
      barcode: event.barcode || "",
      deviceName: event.deviceName || "",
      epc: event.epc,
      eventType: event.eventType,
      issuanceStatus: normalizeWarehouseRfidIssuanceStatus(
        event.issuanceStatus,
      ),
      message: event.message || "",
      occurredAt: event.occurredAt.toISOString(),
      operatorName: event.operatorName || "",
      productName: event.productName || "",
      sku: event.sku || "",
    })),
    rawPayload: jsonRecord(row.rawPayload),
  } satisfies WarehouseRfidDefinitionDetail;
}

export async function getWarehouseInfoWorkspace(
  session: AppSession,
  options: {
    query?: string;
    sessionKey?: string;
    status?: "ALL" | WarehouseRfidIssuanceStatus;
  } = {},
): Promise<WarehouseInfoWorkspaceData> {
  assertWarehouseInfoAccess(session);
  const db = getDb();
  const query = text(options.query);
  const status = options.status || "ALL";
  const where: Prisma.WarehouseRfidTagWhereInput = {
    ...(status === "ALL" ? {} : { issuanceStatus: status }),
    ...(query
      ? {
          OR: [
            { epc: { contains: query, mode: "insensitive" } },
            { productSku: { contains: query, mode: "insensitive" } },
            { productName: { contains: query, mode: "insensitive" } },
            { issuedByName: { contains: query, mode: "insensitive" } },
            { issuanceSessionKey: { contains: query, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const [tags, sessions, totalCount, activeCount, cancelledCount, skuGroups] =
    await Promise.all([
      db.warehouseRfidTag.findMany({
        include: { product: true },
        orderBy: [{ issuedAt: "desc" }, { updatedAt: "desc" }],
        take: 1_000,
        where,
      }),
      db.warehouseRfidDefinitionSession.findMany({
        orderBy: [{ occurredAt: "desc" }, { updatedAt: "desc" }],
        take: 180,
      }),
      db.warehouseRfidTag.count(),
      db.warehouseRfidTag.count({ where: { issuanceStatus: "ACTIVE" } }),
      db.warehouseRfidTag.count({ where: { issuanceStatus: "CANCELLED" } }),
      db.warehouseRfidTag.groupBy({
        by: ["productSku"],
        where: { productSku: { not: null } },
      }),
    ]);
  return {
    generatedAt: new Date().toISOString(),
    query,
    registry: tags.map(registryRow),
    selectedSession: options.sessionKey
      ? await definitionDetail(options.sessionKey)
      : null,
    sessions: sessions.map(sessionItem),
    stats: {
      activeCount,
      cancelledCount,
      issuedSkuCount: skuGroups.length,
      totalCount,
    },
    status,
  };
}

export async function searchWarehouseInfoProducts(
  session: AppSession,
  queryValue: string,
): Promise<WarehouseInventoryProductOption[]> {
  assertWarehouseInfoAccess(session);
  const query = text(queryValue);
  if (query.length < 2) return [];
  const rows = await getDb().warehouseProduct.findMany({
    include: { _count: { select: { rfidTags: true } } },
    orderBy: { sku: "asc" },
    take: 24,
    where: {
      OR: [
        { barcode: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
      ],
    },
  });
  return rows.map((row) => ({
    barcode: row.barcode || "",
    name: row.name,
    rfidCount: row._count.rfidTags,
    sku: row.sku,
    status: row.status,
  }));
}

export async function reassignWarehouseInfoRfids(
  session: AppSession,
  input: { epcs: string[]; sku: string },
) {
  assertWarehouseInfoAccess(session);
  const sku = text(input.sku);
  const epcs = [
    ...new Set(input.epcs.map((value) => normalizeEpc(value)).filter(Boolean)),
  ];
  if (!sku) throw new Error("Vui lòng chọn SKU mới cần gán.");
  if (!epcs.length)
    throw new Error("Vui lòng chọn ít nhất một RFID cần định nghĩa lại.");
  if (epcs.length > 1_000) {
    throw new Error("Mỗi lần chỉ định nghĩa lại tối đa 1.000 RFID.");
  }

  const db = getDb();
  return db.$transaction(
    async (tx) => {
      const [product, tags] = await Promise.all([
        tx.warehouseProduct.findUnique({ where: { sku } }),
        tx.warehouseRfidTag.findMany({
          select: {
            epc: true,
            id: true,
            issuanceStatus: true,
            productName: true,
            productSku: true,
          },
          where: { epc: { in: epcs } },
        }),
      ]);
      if (!product)
        throw new Error(`Không tìm thấy SKU ${sku} trong Cấu hình Kho.`);
      const remapped = tags.filter(
        (tag) => normalizedKey(tag.productSku) !== normalizedKey(product.sku),
      );
      if (!remapped.length) {
        throw new Error(
          `Các RFID đã chọn đang thuộc SKU ${product.sku} hoặc không còn tồn tại.`,
        );
      }

      const occurredAt = new Date();
      const sessionKey = `warehouse-info-remap-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const definitionSession = await tx.warehouseRfidDefinitionSession.create({
        data: {
          barcode: product.barcode || null,
          createdCount: remapped.length,
          deviceName: "Cổng vận hành V3",
          errorCount: 0,
          expectedQty: epcs.length,
          issuanceStatus: "ACTIVE",
          message: `Đã định nghĩa lại ${remapped.length} RFID sang SKU ${product.sku}.`,
          mode: "redefinition",
          occurredAt,
          operatorName: session.displayName,
          processStatus: "SUCCESS",
          productName: product.name,
          rawPayload: json({
            rfids: remapped.map((tag) => tag.epc),
            sku: product.sku,
            source: "warehouse-info",
          }),
          requestedCount: epcs.length,
          sessionKey,
          skippedCount: epcs.length - remapped.length,
          sku: product.sku,
          source: "Web/Thông tin Kho · Định nghĩa lại",
        },
      });

      await tx.warehouseRfidTag.updateMany({
        data: {
          productId: product.id,
          productName: product.name,
          productSku: product.sku,
          updatedByName: session.displayName,
        },
        where: { id: { in: remapped.map((tag) => tag.id) } },
      });
      await tx.warehouseRfidIssuanceEvent.createMany({
        data: remapped.map((tag) => ({
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
            previousProductName: tag.productName || "",
            previousSku: tag.productSku || "",
            source: "warehouse-info",
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
            definitionSessionKey: sessionKey,
            epcSample: remapped.slice(0, 50).map((tag) => tag.epc),
            remappedCount: remapped.length,
            requestedCount: epcs.length,
            source: "warehouse-info",
            targetSku: product.sku,
          }),
          summary: `Định nghĩa lại ${remapped.length} RFID sang SKU ${product.sku} từ Thông tin Kho.`,
          targetId: remapped.length === 1 ? remapped[0].id : null,
          targetType: "WarehouseRfidTag",
        },
      });

      return {
        remappedCount: remapped.length,
        sessionKey,
        skippedCount: epcs.length - remapped.length,
        targetName: product.name,
        targetSku: product.sku,
      };
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
}

export async function deleteWarehouseRfidTags(
  session: AppSession,
  input: { epcs: string[]; password: string; reason: string },
) {
  assertWarehouseInfoAccess(session);
  const epcs = [
    ...new Set(
      input.epcs
        .map((value) => normalizeEpc(value))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  if (!epcs.length) throw new Error("Vui lòng chọn ít nhất một RFID cần xóa.");
  if (epcs.length > 1_000) {
    throw new Error("Mỗi lần chỉ được xóa tối đa 1.000 RFID.");
  }
  const reason = await assertWarehouseDeleteCredential(session, input);
  const db = getDb();
  const tags = await db.warehouseRfidTag.findMany({
    select: {
      epc: true,
      id: true,
      productName: true,
      productSku: true,
    },
    where: { epc: { in: epcs } },
  });
  if (!tags.length) {
    throw new Error("Các RFID đã chọn không còn tồn tại hoặc đã được xóa.");
  }

  const foundEpcs = tags.map((tag) => tag.epc);
  const deletedEpcSet = new Set(foundEpcs);
  const tagIds = tags.map((tag) => tag.id);
  const relatedEvents = await db.warehouseRfidIssuanceEvent.findMany({
    distinct: ["sessionId"],
    select: { sessionId: true },
    where: { epc: { in: foundEpcs } },
  });
  const affectedSessionIds = relatedEvents.map((event) => event.sessionId);

  await db.$transaction(
    async (tx) => {
      await tx.warehouseRfidIssuanceEvent.deleteMany({
        where: { epc: { in: foundEpcs } },
      });
      await tx.warehouseRfidTag.deleteMany({
        where: { id: { in: tagIds } },
      });

      for (const sessionId of affectedSessionIds) {
        const remaining = await tx.warehouseRfidIssuanceEvent.findMany({
          select: { eventType: true },
          where: { sessionId },
        });
        if (!remaining.length) {
          await tx.warehouseRfidDefinitionSession.delete({
            where: { id: sessionId },
          });
          continue;
        }
        const definitionSession =
          await tx.warehouseRfidDefinitionSession.findUnique({
            select: { rawPayload: true },
            where: { id: sessionId },
          });
        const createdCount = remaining.filter((event) =>
          ["ISSUED", "CANCELLED", "REACTIVATED"].includes(event.eventType),
        ).length;
        const skippedCount = remaining.filter(
          (event) => event.eventType === "SKIPPED",
        ).length;
        const errorCount = remaining.filter(
          (event) => event.eventType === "ERROR",
        ).length;
        const processStatus =
          errorCount === 0
            ? "SUCCESS"
            : createdCount || skippedCount
              ? "PARTIAL"
              : "FAILED";
        await tx.warehouseRfidDefinitionSession.update({
          data: {
            createdCount,
            errorCount,
            message: `Phiên còn ${remaining.length} RFID sau thao tác xóa có kiểm soát.`,
            processStatus,
            rawPayload: json(
              redactDeletedEpcs(
                definitionSession?.rawPayload || {},
                deletedEpcSet,
              ) || {},
            ),
            requestedCount: remaining.length,
            skippedCount,
          },
          where: { id: sessionId },
        });
      }

      await tx.auditLog.create({
        data: {
          action: "DELETE",
          actorId: session.userId,
          metadata: json({
            deletedCount: tags.length,
            epcSample: foundEpcs.slice(0, 50),
            reason,
            requestedCount: epcs.length,
            skuSample: [
              ...new Set(
                tags
                  .map((tag) => tag.productSku || tag.productName || "")
                  .filter(Boolean),
              ),
            ].slice(0, 30),
          }),
          summary: `Xóa vĩnh viễn ${tags.length} RFID khỏi Thông tin kho. Lý do: ${reason}`,
          targetId: tags.length === 1 ? tags[0].id : null,
          targetType: "WarehouseRfidTag",
        },
      });
    },
    { maxWait: 5_000, timeout: 20_000 },
  );

  return { deletedCount: tags.length };
}
