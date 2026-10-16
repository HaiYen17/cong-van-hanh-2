import assert from "node:assert/strict";
import test from "node:test";

import ExcelJS from "exceljs";

import { renderAccountingDisclosureWorkbook } from "@/lib/accounting/disclosure-workbook";
import type { AccountingRecord, JsonObject } from "@/lib/accounting/types";

function record(
  recordType: AccountingRecord["recordType"],
  entityKey: string,
  payload: JsonObject,
): AccountingRecord {
  return {
    companyKey: "",
    createdAt: "",
    createdBy: "",
    displayCode: entityKey,
    displayName: entityKey,
    entityKey,
    isDeleted: false,
    parentKey: "",
    payload,
    recordId: entityKey,
    recordType,
    sortOrder: 0,
    status: "ACTIVE",
    updatedAt: "",
    updatedBy: "",
    validFrom: "",
    validTo: "",
    versionId: "V1",
  };
}

test("B09 export keeps the original sheet and fills only mapped total cells", async () => {
  const template = new ExcelJS.Workbook();
  const sheet = template.addWorksheet("B09-DN");
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = "BẢN THUYẾT MINH BÁO CÁO TÀI CHÍNH";
  sheet.mergeCells("A2:H2");
  sheet.getCell("A2").value = "Năm 2025";
  sheet.getCell("A5").value = "V. Thông tin bổ sung";
  sheet.getCell("A6").value = "1. Tiền và các khoản tương đương tiền";
  sheet.getCell("A7").value = "Chỉ tiêu";
  sheet.getCell("D7").value = "Cuối năm";
  sheet.getCell("G7").value = "Đầu năm";
  sheet.getCell("A8").value = "Tiền";
  sheet.getCell("D8").value = 111;
  sheet.getCell("G8").value = 222;
  sheet.getCell("A9").value = "Cộng";
  sheet.getCell("D9").value = { formula: "SUM(D8:D8)", result: 111 };
  sheet.getCell("G9").value = { formula: "SUM(G8:G8)", result: 222 };
  sheet.getCell("D9").numFmt = "#,##0;[Red](#,##0);-";
  sheet.getCell("D9").font = { name: "Arial", bold: true };
  const source = Buffer.from(await template.xlsx.writeBuffer());

  const records: AccountingRecord[] = [
    record("DISCLOSURE_TEMPLATE", "B09_DN_TT99", {
      sourceSheet: "B09-DN",
      templateKey: "B09_DN_TT99",
    }),
    record("DISCLOSURE_SECTION", "B09_DN_TT99:V", {
      sectionKey: "V",
      cells: [
        { address: "A5", column: 1, row: 5, role: "SECTION_TITLE", text: "V. Thông tin bổ sung" },
        { address: "A6", column: 1, row: 6, role: "FIXED_TEXT", text: "1. Tiền và các khoản tương đương tiền" },
        { address: "A7", column: 1, row: 7, role: "TABLE_HEADER", text: "Chỉ tiêu" },
        { address: "D7", column: 4, row: 7, role: "TABLE_HEADER", text: "Cuối năm" },
        { address: "G7", column: 7, row: 7, role: "TABLE_HEADER", text: "Đầu năm" },
        { address: "A8", column: 1, row: 8, role: "FIXED_TEXT", text: "Tiền" },
        { address: "D8", column: 4, row: 8, role: "REFERENCE_VALUE" },
        { address: "G8", column: 7, row: 8, role: "REFERENCE_VALUE" },
        { address: "A9", column: 1, row: 9, role: "FIXED_TEXT", text: "Cộng" },
        { address: "D9", column: 4, row: 9, role: "REFERENCE_FORMULA" },
        { address: "G9", column: 7, row: 9, role: "REFERENCE_FORMULA" },
      ],
    }),
    record("DISCLOSURE_ITEM", "B09_DN_TT99:V_1", {
      endRow: 9,
      itemKey: "B09_DN_TT99:V_1",
      startRow: 6,
      templateKey: "B09_DN_TT99",
    }),
  ];
  const output: JsonObject = {
    controlStatus: "READY",
    periodFrom: "2026-01-01",
    periodTo: "2026-12-31",
    items: [
      {
        itemKey: "B09_DN_TT99:V_1",
        noteCode: "V.1",
        noteTitle: "Tiền và các khoản tương đương tiền",
        status: "READY",
        totals: [
          {
            columnKey: "CURRENT_YEAR",
            columnLabel: "Năm nay",
            columnType: "CURRENT_PERIOD",
            sourceRows: ["BCTC:110"],
            value: 500,
          },
          {
            columnKey: "PRIOR_YEAR",
            columnLabel: "Năm trước",
            columnType: "PRIOR_PERIOD",
            sourceRows: ["BCTC:110"],
            value: 400,
          },
        ],
      },
    ],
    warnings: [],
  };

  const result = await renderAccountingDisclosureWorkbook({
    output,
    records,
    source,
    sourceFileName: "B09-DN.xlsx",
  });
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(
    Buffer.from(String(result.base64), "base64") as unknown as Parameters<
      typeof exported.xlsx.load
    >[0],
  );
  assert.equal(exported.worksheets.length, 2);
  const report = exported.getWorksheet("B09-DN");
  assert.ok(report);
  assert.equal(report.getCell("A2").value, "Năm 2026");
  assert.equal(report.getCell("D8").value, null);
  assert.equal(report.getCell("G8").value, null);
  assert.equal(report.getCell("D9").value, 500);
  assert.equal(report.getCell("G9").value, 400);
  assert.equal(report.getCell("D9").font.bold, true);
  assert.equal(report.getCell("D9").numFmt, "#,##0;[Red](#,##0);-");
  assert.ok(exported.getWorksheet("Đối chiếu số liệu"));
  assert.equal(result.placedCellCount, 2);
  assert.equal(result.clearedReferenceCount, 4);
});

test("B09 export places split report rows into matching disclosure labels", async () => {
  const template = new ExcelJS.Workbook();
  const sheet = template.addWorksheet("B09-DN");
  sheet.getCell("A1").value = "BẢN THUYẾT MINH BÁO CÁO TÀI CHÍNH";
  sheet.getCell("A6").value = "9. Chi phí bán hàng và chi phí quản lý doanh nghiệp";
  sheet.getCell("D7").value = "Năm nay";
  sheet.getCell("G7").value = "Năm trước";
  sheet.getCell("A8").value = "Các khoản chi phí quản lý doanh nghiệp phát sinh trong kỳ";
  sheet.getCell("D8").value = 1;
  sheet.getCell("G8").value = 2;
  sheet.getCell("A9").value = "Các khoản chi phí bán hàng phát sinh trong kỳ";
  sheet.getCell("D9").value = 3;
  sheet.getCell("G9").value = 4;
  const source = Buffer.from(await template.xlsx.writeBuffer());
  const records: AccountingRecord[] = [
    record("DISCLOSURE_TEMPLATE", "B09_DN_TT99", {
      sourceSheet: "B09-DN",
      templateKey: "B09_DN_TT99",
    }),
    record("DISCLOSURE_SECTION", "B09_DN_TT99:VI", {
      sectionKey: "VI",
      cells: [
        { address: "A6", column: 1, row: 6, role: "FIXED_TEXT", text: "9. Chi phí bán hàng và chi phí quản lý doanh nghiệp" },
        { address: "D7", column: 4, row: 7, role: "TABLE_HEADER", text: "Năm nay" },
        { address: "G7", column: 7, row: 7, role: "TABLE_HEADER", text: "Năm trước" },
        { address: "A8", column: 1, row: 8, role: "FIXED_TEXT", text: "Các khoản chi phí quản lý doanh nghiệp phát sinh trong kỳ" },
        { address: "D8", column: 4, row: 8, role: "REFERENCE_VALUE" },
        { address: "G8", column: 7, row: 8, role: "REFERENCE_VALUE" },
        { address: "A9", column: 1, row: 9, role: "FIXED_TEXT", text: "Các khoản chi phí bán hàng phát sinh trong kỳ" },
        { address: "D9", column: 4, row: 9, role: "REFERENCE_VALUE" },
        { address: "G9", column: 7, row: 9, role: "REFERENCE_VALUE" },
      ],
    }),
    record("DISCLOSURE_ITEM", "B09_DN_TT99:VI_9", {
      endRow: 9,
      itemKey: "B09_DN_TT99:VI_9",
      startRow: 6,
      templateKey: "B09_DN_TT99",
    }),
  ];
  const output: JsonObject = {
    controlStatus: "READY",
    periodFrom: "2026-01-01",
    periodTo: "2026-12-31",
    warnings: [],
    items: [
      {
        itemKey: "B09_DN_TT99:VI_9",
        noteCode: "VI.9",
        noteTitle: "Chi phí bán hàng và chi phí quản lý doanh nghiệp",
        status: "READY",
        totals: [
          { columnType: "CURRENT_PERIOD", value: 300 },
          { columnType: "PRIOR_PERIOD", value: 280 },
        ],
        links: [
          {
            reportKey: "BAO_CAO_KET_QUA_KINH_DOANH",
            reportName: "Báo cáo kết quả hoạt động kinh doanh",
            rowCode: "26",
            rowLabel: "Chi phí quản lý doanh nghiệp",
            values: [
              { columnType: "CURRENT_PERIOD", value: 200 },
              { columnType: "PRIOR_PERIOD", value: 180 },
            ],
          },
          {
            reportKey: "BAO_CAO_KET_QUA_KINH_DOANH",
            reportName: "Báo cáo kết quả hoạt động kinh doanh",
            rowCode: "25",
            rowLabel: "Chi phí bán hàng",
            values: [
              { columnType: "CURRENT_PERIOD", value: 100 },
              { columnType: "PRIOR_PERIOD", value: 100 },
            ],
          },
        ],
      },
    ],
  };
  const result = await renderAccountingDisclosureWorkbook({
    output,
    records,
    source,
    sourceFileName: "B09-DN.xlsx",
  });
  assert.equal(result.placedCellCount, 4, JSON.stringify(result.unplacedItemCodes));
  const exported = new ExcelJS.Workbook();
  await exported.xlsx.load(
    Buffer.from(String(result.base64), "base64") as unknown as Parameters<
      typeof exported.xlsx.load
    >[0],
  );
  const report = exported.getWorksheet("B09-DN");
  assert.ok(report);
  assert.equal(report.getCell("D8").value, 200);
  assert.equal(report.getCell("G8").value, 180);
  assert.equal(report.getCell("D9").value, 100);
  assert.equal(report.getCell("G9").value, 100);
});
