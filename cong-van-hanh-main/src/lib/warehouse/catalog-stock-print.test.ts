import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { parseWarehouseStockPrintWorkbook } from "./catalog";

test("đọc file tồn kho hai dòng tiêu đề và chỉ lấy số lượng lớn hơn 0", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["TỔNG HỢP TỒN KHO"],
    ["Kho: KHO TỔNG BÁN HÀNG, Năm 2026"],
    ["Tên kho", "Mã hàng", "Tên hàng", "Cuối kỳ"],
    ["", "", "", "Số lượng"],
    ["KHO TỔNG", "SKU-000", "Không còn tồn", 0],
    ["KHO TỔNG", "SKU-001", "Nệm mẫu 1", 2],
    ["KHO TỔNG", "SKU-002", "Nệm mẫu 2", -1],
    ["KHO TỔNG", "SKU-001", "Nệm mẫu 1", 3],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "TỔNG HỢP TỒN KHO");

  const result = parseWarehouseStockPrintWorkbook(workbook);

  assert.equal(result.sheetName, "TỔNG HỢP TỒN KHO");
  assert.equal(result.ignoredRowCount, 2);
  assert.deepEqual(result.rows, [
    {
      name: "Nệm mẫu 1",
      quantity: 5,
      rowNumbers: [6, 8],
      sku: "SKU-001",
    },
  ]);
});

test("đọc được file tồn kho có một dòng tiêu đề", () => {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["SKU", "Tên sản phẩm", "Số lượng tồn"],
    ["abc-01", "Sản phẩm A", "7"],
    ["abc-02", "Sản phẩm B", "0"],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Tồn hiện tại");

  const result = parseWarehouseStockPrintWorkbook(workbook);

  assert.equal(result.sheetName, "Tồn hiện tại");
  assert.equal(result.ignoredRowCount, 1);
  assert.deepEqual(result.rows, [
    {
      name: "Sản phẩm A",
      quantity: 7,
      rowNumbers: [2],
      sku: "ABC-01",
    },
  ]);
});

test("tự tìm header ở bất kỳ dòng nào và nhận alias viết liền", () => {
  const workbook = XLSX.utils.book_new();
  const rows: unknown[][] = Array.from({ length: 37 }, (_, index) => [
    index === 0 ? "PHIẾU ĐÓNG GÓI" : `Dòng ghi chú ${index + 1}`,
  ]);
  rows.push(["STT", "MaHang", "Tên hàng", "so luong thuc te"]);
  rows.push(["1", "sku-101", "Sản phẩm A", 2]);
  rows.push(["2", "SKU-101", "Sản phẩm A", 3]);
  rows.push(["3", "SKU-102", "Sản phẩm B", 1]);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(workbook, sheet, "Phiếu đóng gói");

  const result = parseWarehouseStockPrintWorkbook(workbook);

  assert.deepEqual(result.rows, [
    {
      name: "Sản phẩm A",
      quantity: 5,
      rowNumbers: [39, 40],
      sku: "SKU-101",
    },
    {
      name: "Sản phẩm B",
      quantity: 1,
      rowNumbers: [41],
      sku: "SKU-102",
    },
  ]);
});
