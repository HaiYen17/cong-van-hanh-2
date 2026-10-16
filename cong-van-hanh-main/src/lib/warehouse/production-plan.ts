import "server-only";

import * as XLSX from "xlsx";

import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import { assertWarehouseCatalogAccess } from "./catalog";
import type {
  WarehouseCatalogProduct,
  WarehouseProductionPlanData,
} from "./catalog-types";
import { parseWarehouseProductionPlanRows } from "./production-plan-parser";

const PRODUCTION_PLAN_SHEET_URL =
  process.env.WAREHOUSE_PRODUCTION_PLAN_SHEET_URL ||
  "https://docs.google.com/spreadsheets/d/1qNC55iN4KKF9hJRrfc4egnHIqnC_-GKEKC2jwXDFxMQ/edit?gid=1960770014";
const PRODUCTION_PLAN_SHEET_NAME =
  process.env.WAREHOUSE_PRODUCTION_PLAN_SHEET_NAME || "KeHoach_Xuong";
const PRODUCTION_PLAN_SHEET_GID =
  process.env.WAREHOUSE_PRODUCTION_PLAN_SHEET_GID || "1960770014";
const PRODUCTION_PLAN_HEADER_ROW = 2;

const PRODUCT_SELECT = {
  _count: { select: { rfidTags: true } },
  barcode: true,
  color: true,
  id: true,
  name: true,
  purchasePrice: true,
  salePrice: true,
  size: true,
  sku: true,
  source: true,
  status: true,
  stockTvd: true,
  stockTvg: true,
  taxRate: true,
  unit: true,
  updatedAt: true,
} as const;

function compactText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedSku(value: unknown) {
  return compactText(value).toLocaleUpperCase("vi");
}

function decimalNumber(value: { toString(): string } | null) {
  return value == null ? null : Number(value.toString());
}

function productForUi(row: {
  _count: { rfidTags: number };
  barcode: string | null;
  color: string | null;
  id: string;
  name: string;
  purchasePrice: { toString(): string } | null;
  salePrice: { toString(): string } | null;
  size: string | null;
  sku: string;
  source: string | null;
  status: string;
  stockTvd: number;
  stockTvg: number;
  taxRate: { toString(): string } | null;
  unit: string | null;
  updatedAt: Date;
}): WarehouseCatalogProduct {
  return {
    barcode: row.barcode || "",
    color: row.color || "",
    id: row.id,
    name: row.name,
    purchasePrice: decimalNumber(row.purchasePrice),
    rfidCount: row._count.rfidTags,
    salePrice: decimalNumber(row.salePrice),
    size: row.size || "",
    sku: row.sku,
    source: row.source || "",
    status: row.status,
    stockTvd: row.stockTvd,
    stockTvg: row.stockTvg,
    taxRate: decimalNumber(row.taxRate),
    unit: row.unit || "",
    updatedAt: row.updatedAt.toISOString(),
  };
}

function todayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function defaultDateKey(dateKeys: string[], today: string) {
  if (dateKeys.includes(today)) return today;
  return dateKeys.find((dateKey) => dateKey > today) || dateKeys.at(-1) || "";
}

async function readProductionPlanSheet() {
  const spreadsheetId = PRODUCTION_PLAN_SHEET_URL.match(
    /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/,
  )?.[1];
  if (!spreadsheetId) {
    throw new Error("Link Google Sheet kế hoạch sản xuất không hợp lệ.");
  }
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}` +
    `/export?format=csv&gid=${encodeURIComponent(PRODUCTION_PLAN_SHEET_GID)}`;
  let response: Response;
  try {
    response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(
      "Google Sheet kế hoạch đang phản hồi chậm. Vui lòng thử lại sau ít phút.",
    );
  }
  if (!response.ok) {
    throw new Error(
      `Không đọc được Sheet KeHoach_Xuong (HTTP ${response.status}).`,
    );
  }
  const csv = (await response.text()).replace(/^\uFEFF/, "");
  if (!csv.trim() || /^\s*<!doctype html/i.test(csv)) {
    throw new Error(
      "Sheet KeHoach_Xuong chưa cho phép máy chủ đọc dữ liệu bằng liên kết.",
    );
  }
  const workbook = XLSX.read(csv, { raw: false, type: "string" });
  const worksheet = workbook.Sheets[workbook.SheetNames[0] || ""];
  if (!worksheet) throw new Error("Sheet KeHoach_Xuong đang rỗng.");
  const values = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    defval: "",
    header: 1,
    raw: false,
  });
  if (values.length < PRODUCTION_PLAN_HEADER_ROW) {
    throw new Error("Sheet KeHoach_Xuong không có dòng tiêu đề số 2.");
  }
  return {
    headers: values[PRODUCTION_PLAN_HEADER_ROW - 1] || [],
    rows: values.slice(PRODUCTION_PLAN_HEADER_ROW),
  };
}

export async function getWarehouseProductionPlan(
  session: AppSession,
): Promise<WarehouseProductionPlanData> {
  assertWarehouseCatalogAccess(session);
  const sheet = await readProductionPlanSheet();
  const parsedDates = parseWarehouseProductionPlanRows(
    sheet.headers,
    sheet.rows,
    PRODUCTION_PLAN_HEADER_ROW,
  );
  if (!parsedDates.length) {
    throw new Error("Sheet KeHoach_Xuong chưa có kế hoạch in tem hợp lệ.");
  }

  const skus = [
    ...new Set(
      parsedDates.flatMap((date) => date.items.map((item) => item.sku)),
    ),
  ];
  const productRows = await getDb().warehouseProduct.findMany({
    select: PRODUCT_SELECT,
    where: { sku: { in: skus, mode: "insensitive" } },
  });
  const productBySku = new Map(
    productRows.map((row) => [normalizedSku(row.sku), productForUi(row)]),
  );
  const today = todayKey();

  return {
    dates: parsedDates.map((date) => ({
      ...date,
      items: date.items.map((item) => ({
        ...item,
        name: productBySku.get(item.sku)?.name || item.name || item.sku,
        product: productBySku.get(item.sku) || null,
      })),
    })),
    defaultDateKey: defaultDateKey(
      parsedDates.map((date) => date.dateKey),
      today,
    ),
    generatedAt: new Date().toISOString(),
    sheetName: PRODUCTION_PLAN_SHEET_NAME,
    todayKey: today,
  };
}

export async function searchWarehousePrintProducts(
  session: AppSession,
  queryValue: string,
): Promise<WarehouseCatalogProduct[]> {
  assertWarehouseCatalogAccess(session);
  const query = compactText(queryValue).slice(0, 120);
  if (!query) return [];
  const rows = await getDb().warehouseProduct.findMany({
    orderBy: [{ name: "asc" }, { sku: "asc" }],
    select: PRODUCT_SELECT,
    take: 24,
    where: {
      OR: [
        { barcode: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
      ],
    },
  });
  return rows.map(productForUi);
}
