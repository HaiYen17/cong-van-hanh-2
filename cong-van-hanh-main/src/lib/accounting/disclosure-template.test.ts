import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import { parseAccountingDisclosureWorkbook } from "@/lib/accounting/disclosure-template";

test("đọc đầy đủ mẫu B09 nhiều phần mà không cắt ở 600 dòng hoặc 20 cột", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("B09-DN");
  sheet.mergeCells("A1:BW2");
  sheet.getCell("A1").value = "BẢN THUYẾT MINH BÁO CÁO TÀI CHÍNH";
  sheet.getCell("A1").font = { bold: true, size: 16 };
  sheet.getCell("A3").value = "Mẫu số: B09-DN";
  sheet.getCell("A4").value = "Theo Thông tư 99/2025/TT-BTC";

  const markers = [
    [11, "I. Đặc điểm hoạt động của doanh nghiệp"],
    [20, "II. Kỳ kế toán và đơn vị tiền tệ"],
    [30, "III. Chuẩn mực và chế độ kế toán áp dụng"],
    [40, "IV. Các chính sách kế toán áp dụng"],
    [100, "V. Thông tin bổ sung cho các khoản mục trình bày trong Bảng cân đối kế toán"],
    [500, "VI. Thông tin bổ sung cho các khoản mục trình bày trong Báo cáo kết quả kinh doanh"],
    [600, "VII. Thông tin bổ sung cho Báo cáo lưu chuyển tiền tệ"],
    [650, "VIII. Những thông tin khác"],
    [700, "IX. Cam kết của doanh nghiệp"],
  ] as const;
  markers.forEach(([row, title]) => {
    sheet.getCell(`A${row}`).value = title;
    sheet.getCell(`A${row}`).font = { bold: true };
  });

  sheet.getCell("A105").value = "Tiền và các khoản tương đương tiền";
  sheet.getCell("B105").value = "Số cuối năm";
  sheet.getCell("C105").value = "Số đầu năm";
  sheet.getCell("B106").value = 1_250_000;
  sheet.getCell("C106").value = -350_000;
  for (const address of ["A105", "B105", "C105", "A106", "B106", "C106"]) {
    sheet.getCell(address).border = {
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
      top: { style: "thin" },
    };
  }
  sheet.getCell("BX720").value = "Dấu mốc cuối khuôn";

  const parsed = parseAccountingDisclosureWorkbook(workbook, "B09 mau.xlsx");
  assert.equal(parsed.stats.rowCount, 720);
  assert.equal(parsed.stats.columnCount, 76);
  assert.equal(parsed.stats.sectionCount, 10);
  assert.equal(parsed.warnings.length, 0);
  assert.equal(parsed.records.length, 11);
  assert.equal(parsed.summaries.at(-1)?.sectionCode, "IX");
  assert.equal(parsed.summaries.at(-1)?.endRow, 720);
  assert.ok(parsed.stats.referenceNumberCount >= 2);
  assert.ok(parsed.stats.mergeCount >= 1);

  const sectionV = parsed.records.find(
    (record) =>
      record.recordType === "DISCLOSURE_SECTION" &&
      record.payload.sectionCode === "V",
  );
  assert.ok(sectionV);
  const referenceCells = (sectionV.payload.cells as Array<Record<string, unknown>>)
    .filter((cell) => cell.role === "REFERENCE_VALUE");
  assert.equal(referenceCells.length, 2);
  assert.equal(referenceCells[0].runtimeValue, null);
  assert.equal(referenceCells[0].text, undefined);
  assert.equal(referenceCells[1].sampleValue, -350_000);
});
