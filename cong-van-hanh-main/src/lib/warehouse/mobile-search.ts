import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { rankWarehouseSkuSearch } from "./sku-search-ranking";

type UnknownRecord = Record<string, unknown>;

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

function positiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : fallback;
}

export function normalizeWarehouseRfidSearch(payload: unknown) {
  const root = record(payload);
  const nested = record(root.payload);
  const source = { ...root, ...nested };
  const query = text(source.query || source.search || source.sku || source.barcode || source.epc);
  if (!query) throw new Error("Cần query, SKU, Barcode hoặc EPC để tìm RFID.");
  return {
    limit: Math.min(500, positiveInteger(source.limit, 100)),
    query,
  };
}

export async function searchWarehouseRfids(payload: unknown) {
  const input = normalizeWarehouseRfidSearch(payload);
  const query = input.query;
  const where: Prisma.WarehouseRfidTagWhereInput = {
    issuanceStatus: "ACTIVE",
    OR: [
      { epc: { contains: query, mode: "insensitive" } },
      { productSku: { contains: query, mode: "insensitive" } },
      { productName: { contains: query, mode: "insensitive" } },
      {
        product: {
          is: {
            OR: [
              { barcode: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
              { sku: { contains: query, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
  const db = getDb();
  const preferredWhere: Prisma.WarehouseRfidTagWhereInput = {
    AND: [where, { OR: [
      { productSku: { startsWith: query, mode: "insensitive" } },
      { product: { is: { sku: { startsWith: query, mode: "insensitive" } } } },
    ] }],
  };
  const [preferredRows, fallbackRows, total] = await Promise.all([
    db.warehouseRfidTag.findMany({
      include: { product: true },
      orderBy: [{ productSku: "asc" }, { epc: "asc" }],
      take: input.limit,
      where: preferredWhere,
    }),
    db.warehouseRfidTag.findMany({
      include: { product: true },
      orderBy: [{ productSku: "asc" }, { epc: "asc" }],
      take: input.limit,
      where,
    }),
    db.warehouseRfidTag.count({ where }),
  ]);
  const rows = rankWarehouseSkuSearch(query, [...preferredRows, ...fallbackRows]
    .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index)
    .map((row) => ({
      ...row,
      barcode: row.product?.barcode || "",
      name: row.product?.name || row.productName || "",
      sku: row.product?.sku || row.productSku || "",
    })))
    .slice(0, input.limit);
  return {
    generatedAt: new Date().toISOString(),
    limit: input.limit,
    options: rows.map((row) => ({
      barcode: row.product?.barcode || "",
      entryDate: row.entryDate?.toISOString() || "",
      epc: row.epc,
      issuanceStatus: row.issuanceStatus,
      issuedAt: row.issuedAt?.toISOString() || "",
      name: row.product?.name || row.productName || "",
      rfid: row.epc,
      sku: row.product?.sku || row.productSku || "",
      status: row.status,
    })),
    query: input.query,
    status: "ACTIVE",
    total,
    truncated: total > rows.length,
  };
}
