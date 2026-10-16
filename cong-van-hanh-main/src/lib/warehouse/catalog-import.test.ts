import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import {
  createWarehouseBarcodeAllocator,
  parseWarehouseCatalogWorkbook,
  readWarehouseCatalogCsvText,
  shouldGenerateWarehouseBarcode,
} from "./catalog";

test("nhận file hàng hóa có cột Mã và Tên, không cần Barcode", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["DANH SÁCH HÀNG HÓA, DỊCH VỤ"],
      [],
      [
        "STT",
        "Mã",
        "Tên",
        "Đơn giá bán cố định",
        "Là đơn giá sau thuế",
        "Thuế suất GTGT",
      ],
      [1, "PhiCIC", "Phí mất cân bằng cont", 125000, 8, 8],
      [2, "SKU-NEW", "Sản phẩm mới", 99000, 8, 10],
    ]),
    "DANH SÁCH HÀNG HÓA, DỊCH VỤ",
  );

  const result = parseWarehouseCatalogWorkbook(workbook);

  assert.equal(result.autoGenerateBarcode, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.rows[1]?.fields, {
    barcode: "",
    name: "Sản phẩm mới",
    salePrice: "99000",
    sku: "SKU-NEW",
    taxRate: "10",
  });
});

test("Barcode tự sinh nối tiếp dải hàng hóa và không chạy vào dải RFID test", () => {
  const nextBarcode = createWarehouseBarcodeAllocator([
    { barcode: "100001", sku: "SKU-001" },
    { barcode: "103463", sku: "SKU-OLD" },
    { barcode: "515008", sku: "RFIDTEST-RUOT-GOI" },
  ]);

  assert.equal(nextBarcode(), "103464");
  assert.equal(nextBarcode(), "103465");
});

test("file CSV mẫu tải từ web có thể nạp ngược và tự sinh Barcode", () => {
  const content = [
    "sep=,",
    '"Mã SKU","Mã vạch","Tên hàng hóa","ĐVT","Màu","Kích thước","Giá mua","Giá bán","Thuế suất (%)"',
    '"SKU-NEW","","Sản phẩm mới","Cái","Trắng","100x200","50000","90000","10"',
  ].join("\r\n");

  const result = parseWarehouseCatalogWorkbook(
    readWarehouseCatalogCsvText(`\uFEFF${content}`),
  );

  assert.equal(result.autoGenerateBarcode, false);
  assert.deepEqual(result.rows[0]?.fields, {
    barcode: "",
    color: "Trắng",
    name: "Sản phẩm mới",
    purchasePrice: "50000",
    salePrice: "90000",
    size: "100x200",
    sku: "SKU-NEW",
    taxRate: "10",
    unit: "Cái",
  });
});

test("nhận file CSV Excel lưu lại bằng dấu chấm phẩy", () => {
  const content = [
    '"Mã SKU";"Tên hàng hóa";"ĐVT";"Giá bán"',
    '"SKU-SEMI";"Hàng lưu bằng Excel";"Cái";"120000"',
  ].join("\r\n");

  const result = parseWarehouseCatalogWorkbook(
    readWarehouseCatalogCsvText(content),
  );

  assert.equal(result.autoGenerateBarcode, true);
  assert.equal(result.rows[0]?.fields.sku, "SKU-SEMI");
  assert.equal(result.rows[0]?.fields.name, "Hàng lưu bằng Excel");
});

test("SKU mới để trống cột Mã vạch trong file mẫu vẫn được tự sinh Barcode", () => {
  assert.equal(shouldGenerateWarehouseBarcode(null, ""), true);
  assert.equal(shouldGenerateWarehouseBarcode(null, "123456"), false);
  assert.equal(
    shouldGenerateWarehouseBarcode({ id: "existing-product" }, ""),
    false,
  );
});
