import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { rankWarehouseSkuSearch } from "./sku-search-ranking";

type UnknownRecord = Record<string, unknown>;

export type WarehouseCatalogLookupInput = {
  barcode: string;
  limit: number;
  page: number;
  query: string;
  sku: string;
  updatedAfter: Date | null;
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

function normalizeBarcode(value: unknown) {
  return text(value).replace(/\s+/g, "").toLocaleUpperCase("vi");
}

function integer(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function parseUpdatedAfter(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("updatedAfter phải là thời gian ISO 8601 hợp lệ.");
  }
  return parsed;
}

export function normalizeWarehouseCatalogLookup(
  payload: unknown,
): WarehouseCatalogLookupInput {
  const root = record(payload);
  const nested = record(root.payload);
  const source = { ...root, ...nested };
  return {
    barcode: normalizeBarcode(source.barcode),
    limit: Math.min(500, Math.max(1, integer(source.limit, 100))),
    page: Math.max(1, integer(source.page, 1)),
    query: text(source.query || source.search),
    sku: text(source.sku).toLocaleUpperCase("vi"),
    updatedAfter: parseUpdatedAfter(source.updatedAfter),
  };
}

export async function lookupWarehouseCatalog(payload: unknown) {
  const input = normalizeWarehouseCatalogLookup(payload);
  const clauses: Prisma.WarehouseProductWhereInput[] = [];
  if (input.barcode) clauses.push({ barcode: input.barcode });
  if (input.sku) clauses.push({ sku: input.sku });
  if (input.query) {
    clauses.push({
      OR: [
        { barcode: { contains: input.query, mode: "insensitive" } },
        { name: { contains: input.query, mode: "insensitive" } },
        { sku: { contains: input.query, mode: "insensitive" } },
      ],
    });
  }
  if (input.updatedAfter) {
    clauses.push({ updatedAt: { gt: input.updatedAfter } });
  }
  const where: Prisma.WarehouseProductWhereInput = clauses.length
    ? { AND: clauses }
    : {};
  const db = getDb();
  const productQuery = {
      include: { _count: { select: { rfidTags: true } } },
      orderBy: [{ updatedAt: "asc" }, { sku: "asc" }],
      where,
    } satisfies Prisma.WarehouseProductFindManyArgs;
  const requestedCount = input.page * input.limit;
  const preferredWhere: Prisma.WarehouseProductWhereInput = input.query
    ? { AND: [where, { OR: [
      { sku: { startsWith: input.query, mode: "insensitive" } },
      { barcode: { startsWith: input.query, mode: "insensitive" } },
    ] }] }
    : where;
  const [preferredRows, fallbackRows, total] = await Promise.all([
    input.query ? db.warehouseProduct.findMany({ ...productQuery, take: requestedCount, where: preferredWhere }) : Promise.resolve([]),
    db.warehouseProduct.findMany({
      ...productQuery,
      skip: input.query ? 0 : (input.page - 1) * input.limit,
      take: input.query ? requestedCount : input.limit,
    }),
    db.warehouseProduct.count({ where }),
  ]);
  const rows = input.query
    ? rankWarehouseSkuSearch(input.query, [...preferredRows, ...fallbackRows]
      .filter((row, index, all) => all.findIndex((candidate) => candidate.id === row.id) === index))
      .slice((input.page - 1) * input.limit, input.page * input.limit)
    : fallbackRows;
  const totalPages = Math.max(1, Math.ceil(total / input.limit));
  return {
    filters: {
      barcode: input.barcode,
      query: input.query,
      sku: input.sku,
      updatedAfter: input.updatedAfter?.toISOString() || "",
    },
    generatedAt: new Date().toISOString(),
    pagination: {
      hasMore: input.page < totalPages,
      limit: input.limit,
      page: input.page,
      total,
      totalPages,
    },
    products: rows.map((row) => ({
      barcode: row.barcode || "",
      color: row.color || "",
      name: row.name,
      rfidCount: row._count.rfidTags,
      size: row.size || "",
      sku: row.sku,
      status: row.status,
      unit: row.unit || "",
      updatedAt: row.updatedAt.toISOString(),
    })),
  };
}
