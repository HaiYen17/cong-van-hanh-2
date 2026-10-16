import assert from "node:assert/strict";
import test from "node:test";

import * as XLSX from "xlsx";

import { parseReconciliationFile } from "@/lib/reconciliation/excel";

function workbookFile(
  rows: unknown[][],
  fileName: string,
  sheetName: string,
) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(rows),
    sheetName,
  );
  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  });
  return new File([buffer], fileName, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

test("từ chối workbook Urbox chỉ có header nhưng không có dữ liệu", async () => {
  const file = workbookFile(
    [
      [],
      [
        "Thời gian đổi quà",
        "Chương trình",
        "Mã đơn hàng",
        "Mã giao dịch",
        "Mã KH",
        "Thương hiệu",
        "Tên quà",
        "Danh mục",
        "Số lượng",
        "Giá trị",
      ],
    ],
    "urbox-empty.xlsx",
    "eVoucher",
  );

  await assert.rejects(
    () => parseReconciliationFile(file),
    /không có dòng dữ liệu/,
  );
});

test("từ chối workbook BaseReward chỉ có header nhưng không có dữ liệu", async () => {
  const file = workbookFile(
    [["Tên", "Username", "Provider", "Mã giao dịch", "Mã chương trình"]],
    "base-reward-empty.xlsx",
    "Exported File",
  );

  await assert.rejects(
    () => parseReconciliationFile(file),
    /không có dòng dữ liệu/,
  );
});
