import "server-only";

import { GoogleAuth } from "google-auth-library";

import { getDb } from "@/lib/db";

import { ingestWarehouseInventoryPayload } from "./inventory";

const LEGACY_SPREADSHEET_ID =
  process.env.WAREHOUSE_LEGACY_SPREADSHEET_ID ||
  "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg";

const sheetsAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

type ValuesResponse = {
  values?: unknown[][];
};

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function integer(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
}

function decimal(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsedDate(value: unknown) {
  const source = text(value);
  if (!source) return null;
  const match = source.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (match) {
    const [, day, month, year, hour = "0", minute = "0", second = "0"] =
      match;
    return new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );
  }
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function rowObject(headers: unknown[], row: unknown[]) {
  return Object.fromEntries(
    headers.map((header, index) => [text(header), row[index] ?? ""]),
  );
}

function value(
  row: Record<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    if (row[key] !== undefined) return row[key];
  }
  return "";
}

async function fetchValues(sheetName: string, range: string) {
  const client = await sheetsAuth.getClient();
  const a1 = `'${sheetName.replace(/'/g, "''")}'!${range}`;
  const response = await client.request<ValuesResponse>({
    params: {
      dateTimeRenderOption: "FORMATTED_STRING",
      majorDimension: "ROWS",
      valueRenderOption: "FORMATTED_VALUE",
    },
    url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      LEGACY_SPREADSHEET_ID,
    )}/values/${encodeURIComponent(a1)}`,
  });
  return response.data.values ?? [];
}

export async function syncWarehouseLegacyMaster() {
  const [productValues, tagValues] = await Promise.all([
    fetchValues("14_Cấu hình kho", "A1:V"),
    fetchValues("16_Kho KTS", "A1:U"),
  ]);
  const db = getDb();
  const productHeaders = productValues[0] ?? [];
  const tagHeaders = tagValues[0] ?? [];
  let productCount = 0;
  let tagCount = 0;

  for (let index = 1; index < productValues.length; index += 1) {
    const row = rowObject(productHeaders, productValues[index] ?? []);
    const sku = text(value(row, "Mã SKU"));
    if (!sku) continue;
    const name = text(value(row, "Tên hàng hóa")) || sku;
    await db.warehouseProduct.upsert({
      create: {
        barcode: text(value(row, "Mã vạch")) || null,
        color: text(value(row, "Màu")) || null,
        inboundTodayTvd: integer(
          value(row, "Nhập hàng trong ngày TVD"),
        ),
        inboundTodayTvg: integer(
          value(row, "Nhập hàng trong ngày TVG"),
        ),
        legacySheetRow: index + 1,
        name,
        note: text(value(row, "Ghi chú")) || null,
        purchasePrice: decimal(value(row, "Giá mua")),
        rawSource: row,
        reorderAlert:
          text(value(row, "Cảnh báo đặt hàng"))
            ? integer(value(row, "Cảnh báo đặt hàng"))
            : null,
        reservedTvd: integer(
          value(row, "Đã giữ TVD", "Đã giữ Thuần Việt Digital"),
        ),
        reservedTvg: integer(
          value(row, "Đã giữ TVG", "Đã giữ Thuần Việt Global"),
        ),
        salePrice: decimal(value(row, "Giá bán")),
        size: text(value(row, "Kích thước")) || null,
        sku,
        source: text(value(row, "Nguồn nạp")) || "Google Sheet cũ",
        status: text(value(row, "Trạng thái")) || "ACTIVE",
        stockTvd: integer(
          value(row, "Tồn TVD", "Tồn Thuần Việt Digital"),
        ),
        stockTvg: integer(
          value(row, "Tồn TVG", "Tồn Thuần Việt Global"),
        ),
        taxRate: decimal(value(row, "Thuế suất")),
        unit: text(value(row, "ĐVT")) || null,
      },
      update: {
        barcode: text(value(row, "Mã vạch")) || null,
        color: text(value(row, "Màu")) || null,
        inboundTodayTvd: integer(
          value(row, "Nhập hàng trong ngày TVD"),
        ),
        inboundTodayTvg: integer(
          value(row, "Nhập hàng trong ngày TVG"),
        ),
        legacySheetRow: index + 1,
        name,
        note: text(value(row, "Ghi chú")) || null,
        purchasePrice: decimal(value(row, "Giá mua")),
        rawSource: row,
        reorderAlert:
          text(value(row, "Cảnh báo đặt hàng"))
            ? integer(value(row, "Cảnh báo đặt hàng"))
            : null,
        reservedTvd: integer(
          value(row, "Đã giữ TVD", "Đã giữ Thuần Việt Digital"),
        ),
        reservedTvg: integer(
          value(row, "Đã giữ TVG", "Đã giữ Thuần Việt Global"),
        ),
        salePrice: decimal(value(row, "Giá bán")),
        size: text(value(row, "Kích thước")) || null,
        source: text(value(row, "Nguồn nạp")) || "Google Sheet cũ",
        status: text(value(row, "Trạng thái")) || "ACTIVE",
        stockTvd: integer(
          value(row, "Tồn TVD", "Tồn Thuần Việt Digital"),
        ),
        stockTvg: integer(
          value(row, "Tồn TVG", "Tồn Thuần Việt Global"),
        ),
        taxRate: decimal(value(row, "Thuế suất")),
        unit: text(value(row, "ĐVT")) || null,
      },
      where: { sku },
    });
    productCount += 1;
  }

  const products = await db.warehouseProduct.findMany({
    select: { id: true, name: true, sku: true },
  });
  const productMap = new Map(products.map((product) => [product.sku, product]));

  for (let index = 1; index < tagValues.length; index += 1) {
    const row = rowObject(tagHeaders, tagValues[index] ?? []);
    const epc = text(value(row, "RFID")).replace(/\s+/g, "").toUpperCase();
    if (!epc) continue;
    const sku = text(value(row, "Mã SKU"));
    const product = productMap.get(sku);
    await db.warehouseRfidTag.upsert({
      create: {
        createdByName: text(value(row, "Tạo bởi")) || null,
        entryDate: parsedDate(value(row, "Ngày nhập kho")),
        epc,
        eshopOrderCode: text(value(row, "Mã đơn Eshop")) || null,
        exitDate: parsedDate(value(row, "Ngày xuất kho")),
        inboundSessionKey: text(value(row, "Phiên nhập ID")) || null,
        lastInventorySessionKey:
          text(value(row, "Phiên kiểm kê gần nhất")) || null,
        lastScannedAt: parsedDate(value(row, "Lần quét gần nhất")),
        legacySheetRow: index + 1,
        note: text(value(row, "Ghi chú")) || null,
        outboundCompany: text(value(row, "Pháp nhân xuất")) || null,
        outboundSessionKey: text(value(row, "Phiên xuất ID")) || null,
        productId: product?.id ?? null,
        productName:
          product?.name || text(value(row, "Tên hàng hóa")) || null,
        productSku: sku || null,
        rawSource: row,
        recordKey: text(value(row, "Record ID")) || null,
        sourceCompany: text(value(row, "Pháp nhân nguồn")) || null,
        status: text(value(row, "Trạng thái")) || "Tồn kho",
        trackingCode: text(value(row, "Mã vận đơn")) || null,
        updatedByName: text(value(row, "Cập nhật bởi")) || null,
      },
      update: {
        entryDate: parsedDate(value(row, "Ngày nhập kho")),
        eshopOrderCode: text(value(row, "Mã đơn Eshop")) || null,
        exitDate: parsedDate(value(row, "Ngày xuất kho")),
        inboundSessionKey: text(value(row, "Phiên nhập ID")) || null,
        lastInventorySessionKey:
          text(value(row, "Phiên kiểm kê gần nhất")) || null,
        lastScannedAt: parsedDate(value(row, "Lần quét gần nhất")),
        legacySheetRow: index + 1,
        note: text(value(row, "Ghi chú")) || null,
        outboundCompany: text(value(row, "Pháp nhân xuất")) || null,
        outboundSessionKey: text(value(row, "Phiên xuất ID")) || null,
        productId: product?.id ?? null,
        productName:
          product?.name || text(value(row, "Tên hàng hóa")) || null,
        productSku: sku || null,
        rawSource: row,
        recordKey: text(value(row, "Record ID")) || null,
        sourceCompany: text(value(row, "Pháp nhân nguồn")) || null,
        status: text(value(row, "Trạng thái")) || "Tồn kho",
        trackingCode: text(value(row, "Mã vận đơn")) || null,
        updatedByName: text(value(row, "Cập nhật bởi")) || null,
      },
      where: { epc },
    });
    tagCount += 1;
  }

  return { productCount, tagCount };
}

export async function importWarehouseLegacyHistory() {
  const values = await fetchValues("17_Lịch chạy dữ liệu", "A1:T");
  const headers = values[0] ?? [];
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (let index = 1; index < values.length; index += 1) {
    const row = rowObject(headers, values[index] ?? []);
    if (text(value(row, "Job Key")) !== "rfid-inventory-scan") continue;
    try {
      const rawPayload = JSON.parse(text(value(row, "Payload JSON")));
      const business = rawPayload?.businessContext ?? {};
      const process = rawPayload?.processResult ?? {};
      const sessionKey = text(
        rawPayload?.sessionId || process?.sessionId || value(row, "Record ID"),
      );
      if (!sessionKey || !Array.isArray(rawPayload?.rfids)) {
        skipped += 1;
        continue;
      }
      const result = await ingestWarehouseInventoryPayload({
        action: "warehouseInventoryScan",
        area: business.area || process.area,
        companyKey: business.companyKey || process.companyKey,
        date:
          process.scanDate ||
          rawPayload.date ||
          value(row, "Lần chạy gần nhất"),
        deviceName: business.deviceName || process.deviceName,
        inventoryType: business.inventoryType || process.inventoryType || "",
        operator: business.operator || process.operator,
        rfids: rawPayload.rfids,
        sessionId: sessionKey,
        shelf: business.shelf || process.shelf,
        source: "Android/RFID · dữ liệu khôi phục",
        totalReadCount:
          process?.summary?.requestedReadCount ||
          rawPayload.requestedCount ||
          rawPayload.rfids.length,
      });
      await getDb().warehouseInventorySession.update({
        data: {
          legacyRecordId: text(value(row, "Record ID")) || sessionKey,
          legacySheetRow: index + 1,
        },
        where: { sessionKey: result.sessionId },
      });
      imported += 1;
    } catch (error) {
      failed += 1;
      console.error(
        `Không nhập được lịch sử Kho dòng ${index + 1}:`,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return { failed, imported, skipped };
}

export async function importAllWarehouseLegacyData() {
  const master = await syncWarehouseLegacyMaster();
  const history = await importWarehouseLegacyHistory();
  return { ...master, history };
}

