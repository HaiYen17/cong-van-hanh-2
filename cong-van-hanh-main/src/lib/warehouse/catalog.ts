import "server-only";

import * as XLSX from "xlsx";

import type { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";

import type {
  WarehouseBarcodeMapping,
  WarehouseCatalogImportResult,
  WarehouseCatalogManualRow,
  WarehouseCatalogProduct,
  WarehouseCatalogViewInput,
  WarehouseCatalogWorkspaceData,
  WarehouseStockPrintAnalysis,
} from "./catalog-types";
import {
  isWarehouseLabelStartSlotValid,
  warehouseLabelSlotsPerPage,
} from "./label-print-layout";

const MAX_IMPORT_BYTES = 14 * 1024 * 1024;
const IMPORT_TRANSACTION_MAX_WAIT_MS = 15_000;
const IMPORT_TRANSACTION_TIMEOUT_MS = 120_000;
const PRINT_AUDIT_TARGET = "WarehouseBarcodeLabelPrint";
const AUTO_BARCODE_MIN = 100_001;
const AUTO_BARCODE_MAX = 499_999;
const AUTO_BARCODE_WIDTH = 6;
const CATALOG_PAGE_SIZE = 350;

const STOCK_PRINT_SKU_ALIASES = [
  "Mã hàng",
  "Mahang",
  "Mã hàng hóa",
  "Mã SKU",
  "Mã sản phẩm",
  "SKU",
  "SKU Code",
] as const;
const STOCK_PRINT_NAME_ALIASES = [
  "Tên hàng",
  "Tên hàng hóa",
  "Tên sản phẩm",
  "Sản phẩm",
] as const;
const STOCK_PRINT_QUANTITY_ALIASES = [
  "Số lượng thực tế",
  "Soluong thuc te",
  "Soluongthucte",
  "Số lượng",
  "Soluong",
  "Cuối kỳ Số lượng",
  "Số lượng Cuối kỳ",
  "Cuối kỳ",
  "Số lượng tồn",
  "Tồn cuối",
  "Tồn kho",
  "SL tồn",
] as const;

const FIELD_ALIASES = {
  barcode: ["Mã vạch", "Barcode", "Bar code"],
  color: ["Màu", "Color"],
  name: [
    "Tên hàng hóa (*)",
    "Tên hàng hóa",
    "Tên",
    "Tên hàng",
    "InventoryItemName",
    "Inventory Item Name",
  ],
  purchasePrice: ["Giá mua", "CostPrice", "Cost Price"],
  salePrice: [
    "Giá bán",
    "Đơn giá bán cố định",
    "UnitPrice",
    "Unit Price",
    "Giá bán lẻ",
  ],
  size: ["Size", "Kích thước", "Kích cỡ", "Quy cách"],
  sku: [
    "Mã SKU",
    "SKU",
    "SKUCode",
    "SKU Code",
    "Mã hàng",
    "Ma Hang",
    "MaHang",
    "Mã hàng hóa",
    "Mã",
  ],
  status: ["Trạng thái", "Status"],
  taxRate: [
    "Thuế suất (%)",
    "Thuế suất",
    "Thuế suất GTGT",
    "TaxRate",
    "Tax Rate",
  ],
  unit: ["ĐVT", "Đơn vị tính", "UnitName", "Unit Name"],
} as const;

type ImportField = keyof typeof FIELD_ALIASES;

type ParsedImportRow = {
  fields: Partial<Record<ImportField, string>>;
  raw: Record<string, string>;
  rowNumber: number;
};

export type ParsedWarehouseStockPrintRow = {
  name: string;
  quantity: number;
  rowNumbers: number[];
  sku: string;
};

function text(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedSku(value: unknown) {
  return text(value).toLocaleUpperCase("vi");
}

export function normalizeWarehouseBarcode(value: unknown) {
  return text(value).replace(/\s+/g, "").toLocaleUpperCase("vi");
}

export function shouldGenerateWarehouseBarcode(
  existingProduct: unknown,
  requestedBarcode: unknown,
) {
  return !existingProduct && !normalizeWarehouseBarcode(requestedBarcode);
}

function numberValue(value: unknown) {
  const source = text(value);
  if (!source) return null;
  let sanitized = source.replace(/[^\d,.-]/g, "");
  if (sanitized.includes(",") && sanitized.includes(".")) {
    sanitized =
      sanitized.lastIndexOf(",") > sanitized.lastIndexOf(".")
        ? sanitized.replace(/\./g, "").replace(",", ".")
        : sanitized.replace(/,/g, "");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(sanitized)) {
    sanitized = sanitized.replace(/\./g, "");
  } else if (/^\d{1,3}(,\d{3})+$/.test(sanitized)) {
    sanitized = sanitized.replace(/,/g, "");
  } else {
    sanitized = sanitized.replace(",", ".");
  }
  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : null;
}

function isActiveStatus(value: unknown) {
  const key = normalized(value);
  return !["inactive", "archived", "ngung dung", "ngung hoat dong"].some(
    (item) => key.includes(item),
  );
}

export function assertWarehouseCatalogAccess(session: AppSession) {
  if (
    !session.fullAccess &&
    !session.modules.includes("warehouse-config") &&
    !session.moduleGroups.includes("warehouse")
  ) {
    throw new Error("Tài khoản chưa được cấp quyền mở Cấu hình Kho.");
  }
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

function auditMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function getWarehouseCatalogWorkspace(
  session: AppSession,
  options: WarehouseCatalogViewInput = {},
): Promise<WarehouseCatalogWorkspaceData> {
  assertWarehouseCatalogAccess(session);
  const db = getDb();
  const query = text(options.query);
  const barcodeFilter = options.barcodeFilter || "ALL";
  const statusFilter = options.statusFilter || "ACTIVE";
  const [summaryRows, printRows] = await Promise.all([
    db.warehouseProduct.findMany({
      select: { barcode: true, status: true },
    }),
    db.auditLog.findMany({
      include: { actor: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 100,
      where: { targetType: PRINT_AUDIT_TARGET },
    }),
  ]);
  const barcodeCounts = new Map<string, number>();
  const barcodeValuesByKey = new Map<string, Set<string>>();
  for (const row of summaryRows) {
    const barcode = normalizeWarehouseBarcode(row.barcode);
    if (barcode) {
      barcodeCounts.set(barcode, (barcodeCounts.get(barcode) ?? 0) + 1);
      const values = barcodeValuesByKey.get(barcode) ?? new Set<string>();
      if (row.barcode) values.add(row.barcode);
      barcodeValuesByKey.set(barcode, values);
    }
  }
  const duplicateBarcodeValues = [...barcodeCounts.entries()]
    .filter(([, count]) => count > 1)
    .flatMap(([key]) => [...(barcodeValuesByKey.get(key) ?? [])]);
  const inactiveStatusWhere: Prisma.WarehouseProductWhereInput = {
    OR: [
      { status: { contains: "inactive", mode: "insensitive" } },
      { status: { contains: "archived", mode: "insensitive" } },
      { status: { contains: "ngưng dùng", mode: "insensitive" } },
      { status: { contains: "ngưng hoạt động", mode: "insensitive" } },
    ],
  };
  const filters: Prisma.WarehouseProductWhereInput[] = [];
  if (query) {
    filters.push({
      OR: [
        { barcode: { contains: query, mode: "insensitive" } },
        { color: { contains: query, mode: "insensitive" } },
        { name: { contains: query, mode: "insensitive" } },
        { size: { contains: query, mode: "insensitive" } },
        { sku: { contains: query, mode: "insensitive" } },
      ],
    });
  }
  if (barcodeFilter === "MAPPED") {
    filters.push({ barcode: { not: null } }, { NOT: { barcode: "" } });
  } else if (barcodeFilter === "MISSING") {
    filters.push({ OR: [{ barcode: null }, { barcode: "" }] });
  } else if (barcodeFilter === "DUPLICATE") {
    filters.push({ barcode: { in: duplicateBarcodeValues } });
  }
  if (statusFilter === "ACTIVE") {
    filters.push({ NOT: inactiveStatusWhere });
  } else if (statusFilter === "INACTIVE") {
    filters.push(inactiveStatusWhere);
  }
  const where: Prisma.WarehouseProductWhereInput = filters.length
    ? { AND: filters }
    : {};
  const [rows, resultCount] = await Promise.all([
    db.warehouseProduct.findMany({
      orderBy: [{ name: "asc" }, { sku: "asc" }],
      select: {
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
      },
      take: CATALOG_PAGE_SIZE,
      where,
    }),
    db.warehouseProduct.count({ where }),
  ]);
  const mappedBarcodes = summaryRows.filter((row) =>
    Boolean(normalizeWarehouseBarcode(row.barcode)),
  ).length;
  return {
    barcodeFilter,
    generatedAt: new Date().toISOString(),
    hasMoreProducts: resultCount > rows.length,
    printHistory: printRows.map((row) => {
      const metadata = auditMetadata(row.metadata);
      const format = text(metadata.format) || "A4_3_COL";
      return {
        actorName: row.actor?.displayName || "Hệ thống",
        createdAt: row.createdAt.toISOString(),
        format,
        id: row.id,
        labelCount: Number(metadata.labelCount || 0),
        productCount: Number(metadata.productCount || 0),
        startSlot: isWarehouseLabelStartSlotValid(format, metadata.startSlot)
          ? Number(metadata.startSlot)
          : 1,
      };
    }),
    products: rows.map(productForUi),
    query,
    resultCount,
    statusFilter,
    summary: {
      activeProducts: summaryRows.filter((row) => isActiveStatus(row.status))
        .length,
      duplicateBarcodes: [...barcodeCounts.values()].filter(
        (count) => count > 1,
      ).length,
      mappedBarcodes,
      missingBarcodes: summaryRows.length - mappedBarcodes,
      totalProducts: summaryRows.length,
    },
  };
}

export async function getWarehouseCatalogTemplateRows(session: AppSession) {
  assertWarehouseCatalogAccess(session);
  return getDb().warehouseProduct.findMany({
    orderBy: [{ name: "asc" }, { sku: "asc" }],
    select: { barcode: true, name: true, sku: true },
  });
}

async function ensureBarcodeAvailable(barcode: string, exceptProductId = "") {
  if (!barcode) return;
  const rows = await getDb().warehouseProduct.findMany({
    select: { barcode: true, id: true, sku: true },
    where: { barcode: { not: null } },
  });
  const conflict = rows.find(
    (row) =>
      row.id !== exceptProductId &&
      normalizeWarehouseBarcode(row.barcode) === barcode,
  );
  if (conflict) {
    throw new Error(`Mã vạch ${barcode} đã được gán cho SKU ${conflict.sku}.`);
  }
}

export async function saveWarehouseProductBarcode(
  session: AppSession,
  productId: string,
  barcodeValue: string,
) {
  assertWarehouseCatalogAccess(session);
  const barcode = normalizeWarehouseBarcode(barcodeValue);
  const db = getDb();
  const product = await db.warehouseProduct.findUnique({
    where: { id: productId },
  });
  if (!product) throw new Error("Không tìm thấy SKU cần cập nhật.");
  await ensureBarcodeAvailable(barcode, product.id);
  if (normalizeWarehouseBarcode(product.barcode) === barcode) {
    return { message: `SKU ${product.sku} đang dùng đúng mã vạch này.` };
  }
  await db.$transaction([
    db.warehouseProduct.update({
      data: {
        barcode: barcode || null,
        note: barcode
          ? `Cập nhật mã vạch trên Cấu hình Kho bởi ${session.displayName}.`
          : `Gỡ mã vạch trên Cấu hình Kho bởi ${session.displayName}.`,
        source: "Cấu hình Kho · PostgreSQL",
      },
      where: { id: product.id },
    }),
    db.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: {
          barcode,
          previousBarcode: product.barcode || "",
          sku: product.sku,
        },
        summary: barcode
          ? `Gán mã vạch ${barcode} cho SKU ${product.sku}.`
          : `Gỡ mã vạch của SKU ${product.sku}.`,
        targetId: product.id,
        targetType: "WarehouseProduct",
      },
    }),
  ]);
  return {
    message: barcode
      ? `Đã gán mã vạch ${barcode} cho SKU ${product.sku}.`
      : `Đã gỡ mã vạch của SKU ${product.sku}.`,
  };
}

export async function regenerateWarehouseProductBarcode(
  session: AppSession,
  productId: string,
) {
  assertWarehouseCatalogAccess(session);
  const db = getDb();
  return db.$transaction(async (tx) => {
    // Mọi lần cấp mã tự động phải chạy tuần tự để hai người bấm cùng lúc
    // không thể cùng nhận một Barcode. Ép `void` sang text để Prisma đọc được.
    await tx.$queryRaw<Array<{ lockResult: string }>>`
      SELECT pg_advisory_xact_lock(hashtext(${"warehouse-auto-barcode-allocation"}))::text AS "lockResult"
    `;

    const [product, products] = await Promise.all([
      tx.warehouseProduct.findUnique({ where: { id: productId } }),
      tx.warehouseProduct.findMany({
        select: { barcode: true, sku: true },
      }),
    ]);
    if (!product) throw new Error("Không tìm thấy SKU cần cấp lại mã vạch.");

    const barcode = createWarehouseBarcodeAllocator(products)();
    await tx.warehouseProduct.update({
      data: {
        barcode,
        note: `Tự cấp lại mã vạch trên Cấu hình Kho bởi ${session.displayName}.`,
        source: "Cấu hình Kho · PostgreSQL",
      },
      where: { id: product.id },
    });
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: {
          autoGenerated: true,
          barcode,
          previousBarcode: product.barcode || "",
          sku: product.sku,
        },
        summary: `Tự cấp lại mã vạch ${barcode} cho SKU ${product.sku}.`,
        targetId: product.id,
        targetType: "WarehouseProduct",
      },
    });

    return {
      barcode,
      message: `Đã tự tìm và lưu Barcode ${barcode} không trùng cho SKU ${product.sku}.`,
    };
  });
}

export async function applyWarehouseBarcodeMappings(
  session: AppSession,
  mappings: WarehouseBarcodeMapping[],
) {
  assertWarehouseCatalogAccess(session);
  const cleanMappings = mappings
    .map((item) => ({
      barcode: normalizeWarehouseBarcode(item.barcode),
      sku: normalizedSku(item.sku),
    }))
    .filter((item) => item.sku && item.barcode);
  if (!cleanMappings.length) {
    throw new Error("Chưa có dòng SKU – Barcode hợp lệ để cập nhật.");
  }
  if (cleanMappings.length > 3000) {
    throw new Error("Mỗi lần chỉ cập nhật tối đa 3.000 dòng.");
  }
  const db = getDb();
  const products = await db.warehouseProduct.findMany({
    select: { barcode: true, id: true, sku: true },
  });
  const productBySku = new Map(
    products.map((product) => [normalizedSku(product.sku), product]),
  );
  const ownerByBarcode = new Map(
    products
      .filter((product) => normalizeWarehouseBarcode(product.barcode))
      .map((product) => [normalizeWarehouseBarcode(product.barcode), product]),
  );
  const seenSku = new Set<string>();
  const seenBarcode = new Map<string, string>();
  const errors: Array<{ message: string; rowNumber: number }> = [];
  const updates: Array<{ barcode: string; id: string; sku: string }> = [];

  cleanMappings.forEach((mapping, index) => {
    const rowNumber = index + 1;
    if (seenSku.has(mapping.sku)) {
      errors.push({
        message: `SKU ${mapping.sku} bị lặp trong danh sách.`,
        rowNumber,
      });
      return;
    }
    seenSku.add(mapping.sku);
    const product = productBySku.get(mapping.sku);
    if (!product) {
      errors.push({ message: `Không tìm thấy SKU ${mapping.sku}.`, rowNumber });
      return;
    }
    const otherSku = seenBarcode.get(mapping.barcode);
    if (otherSku && otherSku !== mapping.sku) {
      errors.push({
        message: `Mã vạch ${mapping.barcode} bị lặp với SKU ${otherSku}.`,
        rowNumber,
      });
      return;
    }
    const owner = ownerByBarcode.get(mapping.barcode);
    if (owner && owner.id !== product.id) {
      errors.push({
        message: `Mã vạch ${mapping.barcode} đang thuộc SKU ${owner.sku}.`,
        rowNumber,
      });
      return;
    }
    seenBarcode.set(mapping.barcode, mapping.sku);
    if (normalizeWarehouseBarcode(product.barcode) !== mapping.barcode) {
      updates.push({
        barcode: mapping.barcode,
        id: product.id,
        sku: product.sku,
      });
    }
  });

  if (updates.length) {
    await db.$transaction([
      ...updates.map((item) =>
        db.warehouseProduct.update({
          data: {
            barcode: item.barcode,
            note: `Cập nhật mã vạch hàng loạt bởi ${session.displayName}.`,
            source: "Cấu hình Kho · Nạp nhanh SKU–Barcode",
          },
          where: { id: item.id },
        }),
      ),
      db.auditLog.create({
        data: {
          action: "SYNC",
          actorId: session.userId,
          metadata: {
            errorCount: errors.length,
            updatedCount: updates.length,
          },
          summary: `Nạp nhanh ${updates.length} mã vạch theo SKU.`,
          targetType: "WarehouseProduct",
        },
      }),
    ]);
  }
  return {
    errors,
    message: `Đã cập nhật ${updates.length} SKU${errors.length ? `; ${errors.length} dòng cần kiểm tra` : ""}.`,
    updatedCount: updates.length,
  };
}

function findColumnIndex(headers: string[], aliases: readonly string[]) {
  const normalizedHeaders = headers.map(normalized);
  return (
    aliases
      .map(normalized)
      .map((alias) => normalizedHeaders.indexOf(alias))
      .find((index) => index >= 0) ?? -1
  );
}

export function parseWarehouseCatalogWorkbook(workbook: XLSX.WorkBook) {
  let best:
    | {
        columnMap: Record<ImportField, number>;
        headerIndex: number;
        matrix: unknown[][];
        score: number;
        sheetName: string;
      }
    | undefined;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });
    for (let headerIndex = 0; headerIndex < matrix.length; headerIndex += 1) {
      const headers = (matrix[headerIndex] ?? []).map(text);
      const columnMap = Object.fromEntries(
        Object.entries(FIELD_ALIASES).map(([field, aliases]) => [
          field,
          findColumnIndex(headers, aliases),
        ]),
      ) as Record<ImportField, number>;
      if (columnMap.sku < 0 || (columnMap.barcode < 0 && columnMap.name < 0))
        continue;
      const score = Object.values(columnMap).filter(
        (index) => index >= 0,
      ).length;
      if (!best || score > best.score) {
        best = { columnMap, headerIndex, matrix, score, sheetName };
      }
    }
  }
  if (!best) {
    throw new Error(
      "Không tìm thấy bảng có cột Mã SKU và Mã vạch/Tên hàng hóa trong file.",
    );
  }
  const headers = (best.matrix[best.headerIndex] ?? []).map(text);
  const rows: ParsedImportRow[] = [];
  for (
    let index = best.headerIndex + 1;
    index < best.matrix.length;
    index += 1
  ) {
    const row = best.matrix[index] ?? [];
    if (!row.some((value) => text(value))) continue;
    const fields: Partial<Record<ImportField, string>> = {};
    for (const field of Object.keys(FIELD_ALIASES) as ImportField[]) {
      const columnIndex = best.columnMap[field];
      if (columnIndex >= 0) fields[field] = text(row[columnIndex]);
    }
    const sku = normalizedSku(fields.sku);
    if (!sku || normalized(sku) === "ma sku") continue;
    fields.sku = sku;
    fields.barcode = normalizeWarehouseBarcode(fields.barcode);
    rows.push({
      fields,
      raw: Object.fromEntries(
        headers.map((header, column) => [header, text(row[column])]),
      ),
      rowNumber: index + 1,
    });
  }
  return {
    autoGenerateBarcode: best.columnMap.barcode < 0,
    columnMap: best.columnMap,
    rows,
    sheetName: best.sheetName,
  };
}

function delimitedCellCount(line: string, separator: string) {
  let inQuotes = false;
  let count = 0;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (inQuotes && line[index + 1] === '"') index += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && character === separator) {
      count += 1;
    }
  }
  return count;
}

export function readWarehouseCatalogCsvText(source: string) {
  const content = source.replace(/^\uFEFF/, "");
  const sampleLines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 30);
  const separator = [",", ";", "\t"]
    .map((candidate) => ({
      candidate,
      score: sampleLines.reduce(
        (best, line) => Math.max(best, delimitedCellCount(line, candidate)),
        0,
      ),
    }))
    .sort((left, right) => right.score - left.score)[0];

  return XLSX.read(content, {
    cellDates: true,
    ...(separator?.score ? { FS: separator.candidate } : {}),
    type: "string",
  });
}

export function createWarehouseBarcodeAllocator(
  products: Array<{ barcode: string | null; sku: string }>,
) {
  const used = new Set(
    products
      .map((product) => normalizeWarehouseBarcode(product.barcode))
      .filter(Boolean),
  );
  const productionNumbers = products
    .filter((product) => !normalizedSku(product.sku).startsWith("RFIDTEST-"))
    .map((product) => normalizeWarehouseBarcode(product.barcode))
    .filter((barcode) => /^\d{6}$/.test(barcode))
    .map(Number)
    .filter(
      (barcode) => barcode >= AUTO_BARCODE_MIN && barcode <= AUTO_BARCODE_MAX,
    );
  let cursor = Math.max(AUTO_BARCODE_MIN - 1, ...productionNumbers);

  return () => {
    do {
      cursor += 1;
      if (cursor > AUTO_BARCODE_MAX) {
        throw new Error(
          "Dải Barcode tự sinh đã hết. Vui lòng cấu hình thêm dải mã mới.",
        );
      }
    } while (used.has(String(cursor).padStart(AUTO_BARCODE_WIDTH, "0")));
    const barcode = String(cursor).padStart(AUTO_BARCODE_WIDTH, "0");
    used.add(barcode);
    return barcode;
  };
}

function stockHeaderBand(matrix: unknown[][], start: number, height: number) {
  const columnCount = Math.max(
    0,
    ...matrix
      .slice(start, start + height)
      .map((row) => (Array.isArray(row) ? row.length : 0)),
  );
  return Array.from({ length: columnCount }, (_, column) =>
    matrix
      .slice(start, start + height)
      .map((row) => text(row?.[column]))
      .filter(Boolean)
      .join(" "),
  );
}

export function parseWarehouseStockPrintWorkbook(workbook: XLSX.WorkBook) {
  let best:
    | {
        headerHeight: number;
        headerIndex: number;
        matrix: unknown[][];
        nameColumn: number;
        quantityColumn: number;
        score: number;
        sheetName: string;
        skuColumn: number;
      }
    | undefined;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      blankrows: false,
      defval: "",
      header: 1,
      raw: false,
    });
    for (let headerIndex = 0; headerIndex < matrix.length; headerIndex += 1) {
      for (const headerHeight of [1, 2]) {
        if (headerIndex + headerHeight > matrix.length) continue;
        const headers = stockHeaderBand(matrix, headerIndex, headerHeight);
        const skuColumn = findColumnIndex(headers, STOCK_PRINT_SKU_ALIASES);
        const quantityColumn = findColumnIndex(
          headers,
          STOCK_PRINT_QUANTITY_ALIASES,
        );
        if (skuColumn < 0 || quantityColumn < 0) continue;
        const nameColumn = findColumnIndex(headers, STOCK_PRINT_NAME_ALIASES);
        const quantityHeader = normalized(headers[quantityColumn]);
        const score =
          10 +
          (nameColumn >= 0 ? 2 : 0) +
          (quantityHeader.includes("so luong") ? 2 : 0) +
          (quantityHeader.includes("cuoi ky") ? 2 : 0);
        if (!best || score > best.score) {
          best = {
            headerHeight,
            headerIndex,
            matrix,
            nameColumn,
            quantityColumn,
            score,
            sheetName,
            skuColumn,
          };
        }
      }
    }
  }

  if (!best) {
    throw new Error(
      "Không tìm thấy dòng tiêu đề có cột Mã hàng/Mã SKU và Số lượng/Số lượng thực tế trong file.",
    );
  }

  const grouped = new Map<string, ParsedWarehouseStockPrintRow>();
  let ignoredRowCount = 0;
  for (
    let index = best.headerIndex + best.headerHeight;
    index < best.matrix.length;
    index += 1
  ) {
    const row = best.matrix[index] ?? [];
    const sku = normalizedSku(row[best.skuColumn]);
    if (!sku) continue;
    const rawQuantity = numberValue(row[best.quantityColumn]);
    const quantity = rawQuantity == null ? 0 : Math.trunc(rawQuantity);
    if (quantity <= 0) {
      ignoredRowCount += 1;
      continue;
    }
    const name = best.nameColumn >= 0 ? text(row[best.nameColumn]) : "";
    const current = grouped.get(sku);
    if (current) {
      current.quantity += quantity;
      current.rowNumbers.push(index + 1);
      if (!current.name && name) current.name = name;
      continue;
    }
    grouped.set(sku, {
      name,
      quantity,
      rowNumbers: [index + 1],
      sku,
    });
  }

  if (!grouped.size) {
    throw new Error("File không có mã nào có số lượng lớn hơn 0.");
  }

  return {
    ignoredRowCount,
    rows: [...grouped.values()],
    sheetName: best.sheetName,
  };
}

export async function analyzeWarehouseStockPrintFile(
  session: AppSession,
  file: File,
): Promise<WarehouseStockPrintAnalysis> {
  assertWarehouseCatalogAccess(session);
  const fileName = text(file.name);
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) {
    throw new Error("Chỉ hỗ trợ file CSV, XLS hoặc XLSX.");
  }
  if (!file.size) throw new Error("File đã chọn đang rỗng.");
  if (file.size > MAX_IMPORT_BYTES)
    throw new Error("File vượt giới hạn 14 MB.");

  let workbook: XLSX.WorkBook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = fileName.toLocaleLowerCase("vi").endsWith(".csv")
      ? XLSX.read(buffer.toString("utf8").replace(/^\uFEFF/, ""), {
          cellDates: true,
          type: "string",
        })
      : XLSX.read(buffer, { cellDates: true, type: "buffer" });
  } catch {
    throw new Error(
      "Không đọc được file. Kiểm tra lại định dạng hoặc mật khẩu bảo vệ.",
    );
  }

  const parsed = parseWarehouseStockPrintWorkbook(workbook);
  const products = await getDb().warehouseProduct.findMany({
    select: {
      barcode: true,
      id: true,
      name: true,
      sku: true,
    },
  });
  const productBySku = new Map(
    products.map((product) => [normalizedSku(product.sku), product]),
  );
  const printableItems: WarehouseStockPrintAnalysis["printableItems"] = [];
  const issueItems: WarehouseStockPrintAnalysis["issueItems"] = [];

  for (const row of parsed.rows) {
    const product = productBySku.get(row.sku);
    if (!product) {
      issueItems.push({
        name: row.name,
        quantity: row.quantity,
        reason: "MISSING_PRODUCT",
        rowNumbers: row.rowNumbers,
        sku: row.sku,
      });
      continue;
    }
    const barcode = normalizeWarehouseBarcode(product.barcode);
    if (!barcode) {
      issueItems.push({
        name: product.name || row.name,
        quantity: row.quantity,
        reason: "MISSING_BARCODE",
        rowNumbers: row.rowNumbers,
        sku: product.sku,
      });
      continue;
    }
    printableItems.push({
      barcode,
      name: product.name || row.name,
      productId: product.id,
      quantity: row.quantity,
      rowNumbers: row.rowNumbers,
      sku: product.sku,
    });
  }

  const totalLabelCount = parsed.rows.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const printableLabelCount = printableItems.reduce(
    (total, row) => total + row.quantity,
    0,
  );
  const issueLabelCount = issueItems.reduce(
    (total, row) => total + row.quantity,
    0,
  );

  return {
    fileName,
    ignoredRowCount: parsed.ignoredRowCount,
    issueItems,
    issueLabelCount,
    positiveSkuCount: parsed.rows.length,
    printableItems,
    printableLabelCount,
    sheetName: parsed.sheetName,
    totalLabelCount,
  };
}

function comparable(value: unknown) {
  return text(value).toLocaleLowerCase("vi");
}

export async function importWarehouseCatalogFile(
  session: AppSession,
  file: File,
  options: {
    createNote?: string;
    sourceLabel?: string;
    updateNote?: string;
  } = {},
): Promise<WarehouseCatalogImportResult> {
  assertWarehouseCatalogAccess(session);
  const fileName = text(file.name);
  if (!/\.(xlsx|xls|csv)$/i.test(fileName)) {
    throw new Error("Chỉ hỗ trợ file CSV, XLS hoặc XLSX.");
  }
  if (!file.size) throw new Error("File đã chọn đang rỗng.");
  if (file.size > MAX_IMPORT_BYTES)
    throw new Error("File nạp vượt giới hạn 14 MB.");
  let workbook: XLSX.WorkBook;
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    workbook = fileName.toLocaleLowerCase("vi").endsWith(".csv")
      ? readWarehouseCatalogCsvText(buffer.toString("utf8"))
      : XLSX.read(buffer, {
          cellDates: true,
          type: "buffer",
        });
  } catch {
    throw new Error(
      "Không đọc được file. Kiểm tra lại định dạng hoặc mật khẩu bảo vệ.",
    );
  }
  const parsed = parseWarehouseCatalogWorkbook(workbook);
  if (!parsed.rows.length)
    throw new Error("File chưa có dòng hàng hóa hợp lệ để nạp.");
  const db = getDb();
  const products = await db.warehouseProduct.findMany();
  const productBySku = new Map(
    products.map((product) => [normalizedSku(product.sku), product]),
  );
  const nextBarcode = createWarehouseBarcodeAllocator(products);
  const barcodeOwner = new Map(
    products
      .filter((product) => normalizeWarehouseBarcode(product.barcode))
      .map((product) => [normalizeWarehouseBarcode(product.barcode), product]),
  );
  const fileSku = new Set<string>();
  const fileBarcode = new Map<string, string>();
  const errors: Array<{ message: string; rowNumber: number }> = [];
  const createRows: Prisma.WarehouseProductCreateManyInput[] = [];
  const updateOperations: Prisma.PrismaPromise<unknown>[] = [];
  let createdCount = 0;
  let generatedBarcodeCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const row of parsed.rows) {
    const sku = normalizedSku(row.fields.sku);
    if (fileSku.has(sku)) {
      errors.push({
        message: `SKU ${sku} bị lặp; hệ thống giữ dòng đầu tiên.`,
        rowNumber: row.rowNumber,
      });
      continue;
    }
    fileSku.add(sku);
    const existing = productBySku.get(sku);
    if (existing && parsed.autoGenerateBarcode) {
      skippedCount += 1;
      continue;
    }
    if (!existing && !text(row.fields.name)) {
      errors.push({
        message: `SKU ${sku} chưa tồn tại và thiếu Tên hàng hóa.`,
        rowNumber: row.rowNumber,
      });
      continue;
    }
    const requestedBarcode = normalizeWarehouseBarcode(row.fields.barcode);
    const shouldGenerateBarcode = shouldGenerateWarehouseBarcode(
      existing,
      requestedBarcode,
    );
    const barcode = shouldGenerateBarcode ? nextBarcode() : requestedBarcode;
    if (shouldGenerateBarcode) generatedBarcodeCount += 1;
    if (barcode) {
      const duplicateSku = fileBarcode.get(barcode);
      if (duplicateSku && duplicateSku !== sku) {
        errors.push({
          message: `Mã vạch ${barcode} bị lặp với SKU ${duplicateSku}.`,
          rowNumber: row.rowNumber,
        });
        continue;
      }
      fileBarcode.set(barcode, sku);
    }
    const owner = barcode ? barcodeOwner.get(barcode) : undefined;
    if (owner && owner.id !== existing?.id) {
      errors.push({
        message: `Mã vạch ${barcode} đang thuộc SKU ${owner.sku}.`,
        rowNumber: row.rowNumber,
      });
      continue;
    }
    const source = `${text(options.sourceLabel) || "Excel"} · ${fileName} · ${parsed.sheetName}`;
    if (!existing) {
      const name = text(row.fields.name);
      if (!name) {
        errors.push({
          message: `SKU ${sku} chưa tồn tại và thiếu Tên hàng hóa.`,
          rowNumber: row.rowNumber,
        });
        continue;
      }
      createRows.push({
        barcode: barcode || null,
        color: text(row.fields.color) || null,
        name,
        note:
          text(options.createNote) ||
          "Thêm mới từ Excel trong Cấu hình Kho.",
        purchasePrice: numberValue(row.fields.purchasePrice),
        rawSource: row.raw,
        salePrice: numberValue(row.fields.salePrice),
        size: text(row.fields.size) || null,
        sku,
        source,
        status: text(row.fields.status) || "ACTIVE",
        taxRate: numberValue(row.fields.taxRate),
        unit: text(row.fields.unit) || null,
      });
      createdCount += 1;
      continue;
    }
    const data: Prisma.WarehouseProductUpdateInput = {};
    const assignText = (
      field: "barcode" | "color" | "name" | "size" | "status" | "unit",
      nextValue: string | undefined,
      currentValue: string | null,
    ) => {
      if (nextValue === undefined || !text(nextValue)) return;
      const clean =
        field === "barcode"
          ? normalizeWarehouseBarcode(nextValue)
          : text(nextValue);
      if (comparable(clean) === comparable(currentValue)) return;
      if (field === "barcode") data.barcode = clean || null;
      if (field === "color") data.color = clean || null;
      if (field === "name") data.name = clean;
      if (field === "size") data.size = clean || null;
      if (field === "status") data.status = clean;
      if (field === "unit") data.unit = clean || null;
    };
    assignText("barcode", row.fields.barcode, existing.barcode);
    assignText("color", row.fields.color, existing.color);
    assignText("name", row.fields.name, existing.name);
    assignText("size", row.fields.size, existing.size);
    assignText("status", row.fields.status, existing.status);
    assignText("unit", row.fields.unit, existing.unit);
    const numberFields = ["purchasePrice", "salePrice", "taxRate"] as const;
    for (const field of numberFields) {
      if (row.fields[field] === undefined || !text(row.fields[field])) continue;
      const next = numberValue(row.fields[field]);
      if (next !== decimalNumber(existing[field])) data[field] = next;
    }
    if (!Object.keys(data).length) {
      skippedCount += 1;
      continue;
    }
    data.note =
      text(options.updateNote) || "Cập nhật từ Excel trong Cấu hình Kho.";
    data.rawSource = row.raw;
    data.source = source;
    updateOperations.push(
      db.warehouseProduct.update({ data, where: { id: existing.id } }),
    );
    updatedCount += 1;
  }

  const createOperations: Prisma.PrismaPromise<unknown>[] = [];
  for (let start = 0; start < createRows.length; start += 500) {
    createOperations.push(
      db.warehouseProduct.createMany({
        data: createRows.slice(start, start + 500),
      }),
    );
  }
  const operations = [...createOperations, ...updateOperations];
  if (operations.length) {
    await db.$transaction(
      [
        ...operations,
        db.auditLog.create({
          data: {
            action: "SYNC",
            actorId: session.userId,
            metadata: {
              createdCount,
              errorCount: errors.length,
              fileName,
              generatedBarcodeCount,
              sheetName: parsed.sheetName,
              skippedCount,
              updatedCount,
            },
            summary: `Nạp danh mục Kho từ ${fileName}: ${createdCount} mới, ${updatedCount} cập nhật.`,
            targetType: "WarehouseProduct",
          },
        }),
      ],
      {
        maxWait: IMPORT_TRANSACTION_MAX_WAIT_MS,
        timeout: IMPORT_TRANSACTION_TIMEOUT_MS,
      },
    );
  }
  return {
    createdCount,
    errorCount: errors.length,
    errors: errors.slice(0, 40),
    fileName,
    generatedBarcodeCount,
    importedCount: createdCount + updatedCount,
    sheetName: parsed.sheetName,
    skippedCount,
    updatedCount,
  };
}

function csvValue(value: unknown) {
  return `"${text(value).replace(/"/g, '""')}"`;
}

export async function importWarehouseCatalogManualRows(
  session: AppSession,
  rows: WarehouseCatalogManualRow[],
) {
  assertWarehouseCatalogAccess(session);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error("Hãy thêm ít nhất một dòng hàng hóa.");
  }
  if (rows.length > 50) {
    throw new Error("Mỗi lần nạp lẻ tối đa 50 SKU.");
  }
  const populatedRows = rows.filter((row) =>
    Object.values(row || {}).some((value) => text(value)),
  );
  if (!populatedRows.length) {
    throw new Error("Các dòng hàng hóa đang để trống.");
  }
  const headers = [
    "Mã SKU",
    "Tên hàng hóa",
    "ĐVT",
    "Màu",
    "Kích thước",
    "Giá mua",
    "Giá bán",
    "Thuế suất (%)",
  ];
  const content = [
    headers,
    ...populatedRows.map((row) => [
      row.sku,
      row.name,
      row.unit,
      row.color,
      row.size,
      row.purchasePrice,
      row.salePrice,
      row.taxRate,
    ]),
  ]
    .map((row) => row.map(csvValue).join(","))
    .join("\r\n");
  const file = new File([`\uFEFF${content}`], "nap-le-hang-hoa.csv", {
    type: "text/csv;charset=utf-8",
  });
  return importWarehouseCatalogFile(session, file, {
    createNote: "Thêm mới bằng chức năng nạp lẻ trong Cấu hình Kho.",
    sourceLabel: "Nạp lẻ",
    updateNote: "Cập nhật bằng chức năng nạp lẻ trong Cấu hình Kho.",
  });
}

export async function recordWarehouseLabelPrint(
  session: AppSession,
  input: {
    alignSkuRows: boolean;
    format: string;
    labelCount: number;
    pageCount: number;
    productCount: number;
    productIds: string[];
    startSlot: number;
  },
) {
  assertWarehouseCatalogAccess(session);
  const labelCount = Math.max(1, Math.min(Math.trunc(input.labelCount), 5000));
  const productCount = Math.max(
    1,
    Math.min(Math.trunc(input.productCount), 1000),
  );
  if (!isWarehouseLabelStartSlotValid(input.format, input.startSlot)) {
    throw new Error(
      `Ô bắt đầu phải là số nguyên từ 1 đến ${warehouseLabelSlotsPerPage(input.format)} đối với mẫu decal đã chọn.`,
    );
  }
  const startSlot = Math.trunc(input.startSlot);
  const minimumPageCount = Math.ceil(
    (startSlot - 1 + labelCount) / warehouseLabelSlotsPerPage(input.format),
  );
  const pageCount = Math.max(
    minimumPageCount,
    Math.min(Math.trunc(input.pageCount || minimumPageCount), 1000),
  );
  await getDb().auditLog.create({
    data: {
      action: "CREATE",
      actorId: session.userId,
      metadata: {
        format: text(input.format) || "A4_3_COL",
        alignSkuRows: Boolean(input.alignSkuRows),
        labelCount,
        productCount,
        productIds: input.productIds.slice(0, 1000),
        startSlot,
        pageCount,
      },
      summary: `In ${labelCount} tem mã vạch cho ${productCount} SKU, bắt đầu từ ô ${startSlot}${input.alignSkuRows ? ", sắp xếp theo hàng" : ""}.`,
      targetType: PRINT_AUDIT_TARGET,
    },
  });
  return {
    message: `Đã ghi nhận lệnh in ${labelCount} tem mã vạch từ ô ${startSlot}, tổng ${pageCount} trang A4.`,
  };
}

export async function deleteWarehouseLabelPrintHistory(
  session: AppSession,
  historyId: string,
) {
  assertWarehouseCatalogAccess(session);
  const id = text(historyId);
  if (!id) throw new Error("Thiếu lịch sử in cần xóa.");
  const db = getDb();
  const row = await db.auditLog.findFirst({
    select: { id: true },
    where: { id, targetType: PRINT_AUDIT_TARGET },
  });
  if (!row) {
    throw new Error("Không tìm thấy lịch sử in hoặc lịch sử đã được xóa.");
  }
  await db.auditLog.delete({ where: { id: row.id } });
  return { message: "Đã xóa lịch sử in khỏi PostgreSQL." };
}

export async function deleteWarehouseLabelPrintHistories(
  session: AppSession,
  historyIds: string[],
) {
  assertWarehouseCatalogAccess(session);
  const ids = [...new Set(historyIds.map(text).filter(Boolean))];
  if (!ids.length) throw new Error("Vui lòng chọn lịch sử in cần xóa.");
  if (ids.length > 500) {
    throw new Error("Mỗi lần chỉ xóa tối đa 500 lịch sử in.");
  }
  const db = getDb();
  const rows = await db.auditLog.findMany({
    select: { id: true },
    where: { id: { in: ids }, targetType: PRINT_AUDIT_TARGET },
  });
  if (!rows.length) {
    throw new Error("Các lịch sử in đã chọn không còn tồn tại.");
  }
  await db.$transaction([
    db.auditLog.deleteMany({
      where: {
        id: { in: rows.map((row) => row.id) },
        targetType: PRINT_AUDIT_TARGET,
      },
    }),
    db.auditLog.create({
      data: {
        action: "DELETE",
        actorId: session.userId,
        metadata: { deletedCount: rows.length },
        summary: `Xóa hàng loạt ${rows.length} lịch sử in tem Barcode.`,
        targetType: "WarehouseBarcodeLabelPrintCleanup",
      },
    }),
  ]);
  return {
    deletedCount: rows.length,
    message: `Đã xóa ${rows.length} lịch sử in khỏi PostgreSQL.`,
  };
}
