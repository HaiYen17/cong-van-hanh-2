import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";

import {
  accountingImportExportTestUtils,
  buildConfiguredAccountingReportTemplate,
  createAccountingReportConfigTemplate,
} from "@/lib/accounting/import-export";
import type { AccountingRecord, AccountingRecordType, JsonObject } from "@/lib/accounting/types";

const {
  canonicalKey,
  deriveParentCodes,
  headerKey,
  normalizeIsoDate,
  previousIsoDate,
  resolveAccountColumns,
} = accountingImportExportTestUtils;

test("chuẩn hóa khóa và tiêu đề tiếng Việt ổn định", () => {
  assert.equal(canonicalKey("  Công ty Thuận Việt  "), "CONG_TY_THUAN_VIET");
  assert.equal(canonicalKey("TK-511.01 / HCM"), "TK-511.01_HCM");
  assert.equal(headerKey("Số tài khoản"), "sotaikhoan");
  assert.equal(headerKey("Hiệu lực từ"), "hieuluctu");
});

test("nhận diện cột tài khoản theo tên Việt/Anh", () => {
  const columns = resolveAccountColumns([
    "Mã công ty",
    "Số tài khoản",
    "Tên tài khoản",
    "Tài khoản cha",
    "Hiệu lực từ",
  ]);
  assert.ok(columns);
  assert.equal(columns.companyKey, 0);
  assert.equal(columns.accountCode, 1);
  assert.equal(columns.accountName, 2);
  assert.equal(columns.parentCode, 3);
  assert.equal(columns.validFrom, 4);
  assert.equal(resolveAccountColumns(["Mã công ty", "Tên tài khoản"]), null);
});

test("tự suy ra tài khoản cha dài nhất trong cùng công ty", () => {
  const records = [
    { accountCode: "1", companyKey: "TV", parentCode: "" },
    { accountCode: "11", companyKey: "TV", parentCode: "" },
    { accountCode: "111", companyKey: "TV", parentCode: "" },
    { accountCode: "1111", companyKey: "TV", parentCode: "" },
    { accountCode: "1111", companyKey: "NTC", parentCode: "" },
  ];
  deriveParentCodes(records as never);
  assert.deepEqual(
    records.map((record) => record.parentCode),
    ["", "1", "11", "111", ""],
  );
});

test("ngày hiệu lực phải là ngày ISO thật", () => {
  assert.equal(normalizeIsoDate("2026-07-24", "Ngày"), "2026-07-24");
  assert.equal(previousIsoDate("2026-03-01"), "2026-02-28");
  assert.throws(
    () => normalizeIsoDate("2026-02-30", "Ngày", true),
    /Ngày không hợp lệ/,
  );
  assert.throws(
    () => normalizeIsoDate("24\/07\/2026", "Ngày", true),
    /YYYY-MM-DD/,
  );
});

test("xuất tệp mẫu XLSX thật với hai sheet và vùng gộp chuẩn", async () => {
  const result = await createAccountingReportConfigTemplate(
    {},
    "ke-toan@thuanviet.example",
  );
  assert.equal(result.ok, true);
  assert.match(result.fileName, /\.xlsx$/);
  assert.equal(
    result.mimeType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.ok(result.base64.length > 1_000);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(result.base64, "base64") as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["HUONG_DAN", "KHUON_BAO_CAO"],
  );
  const example = workbook.getWorksheet("KHUON_BAO_CAO");
  assert.ok(example);
  assert.equal(example.getCell("A1").value, "[Báo cáo kết quả hoạt động kinh doanh]");
  assert.equal(example.getCell("A1").isMerged, true);
  assert.equal(example.getCell("E1").master.address, "A1");
});

function configuredRecord(
  recordId: string,
  recordType: AccountingRecordType,
  payload: JsonObject,
): AccountingRecord {
  return {
    companyKey: "",
    createdAt: "2026-08-04T00:00:00.000Z",
    createdBy: "ke-toan@thuanviet.example",
    displayCode: String(
      payload.reportKey || payload.columnKey || payload.rowCode || payload.ruleKey || payload.accountSetKey || recordId,
    ),
    displayName: String(
      payload.reportName || payload.columnLabel || payload.rowLabel || payload.ruleName || payload.accountSetName || recordId,
    ),
    entityKey: String(
      payload.reportKey || payload.columnKey || payload.rowCode || payload.ruleKey || payload.accountSetKey || recordId,
    ),
    isDeleted: false,
    parentKey: "",
    payload,
    recordId,
    recordType,
    sortOrder: Number(payload.sortOrder || 0),
    status: "Kích hoạt",
    updatedAt: "2026-08-04T00:00:00.000Z",
    updatedBy: "ke-toan@thuanviet.example",
    validFrom: "",
    validTo: "",
    versionId: "V1",
  };
}

test("xuất mẫu báo cáo đã chọn kèm sheet công thức đã thiết lập", async () => {
  const records = [
    configuredRecord("REPORT", "REPORT", {
      displayTitle: "BẢNG CÂN ĐỐI KẾ TOÁN",
      reportKey: "B01",
      reportName: "Bảng cân đối kế toán",
    }),
    configuredRecord("COL-1", "REPORT_COLUMN", {
      columnKey: "CHI_TIEU",
      columnLabel: "Chỉ tiêu",
      columnType: "LABEL",
      reportKey: "B01",
      sortOrder: 1,
      width: 46,
    }),
    configuredRecord("COL-2", "REPORT_COLUMN", {
      columnKey: "NO",
      columnLabel: "Nợ",
      columnType: "CURRENT_PERIOD",
      headerGroup: "Cuối kỳ",
      reportKey: "B01",
      sortOrder: 2,
      valueBasis: "ENDING",
    }),
    configuredRecord("COL-3", "REPORT_COLUMN", {
      columnKey: "CO",
      columnLabel: "Có",
      columnType: "CURRENT_PERIOD",
      headerGroup: "Đầu kỳ",
      reportKey: "B01",
      sortOrder: 3,
      valueBasis: "OPENING",
    }),
    configuredRecord("ROW-141", "REPORT_ROW", {
      rowCode: "141",
      rowLabel: "Hàng tồn kho",
      rowType: "DATA",
      reportKey: "B01",
      ruleKey: "INVENTORY_BALANCE",
      sortOrder: 1,
    }),
    configuredRecord("RULE-141", "RULE", {
      accountSetKey: "INVENTORY",
      metricKey: "CLOSING_DEBIT",
      operator: "BALANCE",
      ruleKey: "INVENTORY_BALANCE",
      ruleName: "Số dư Nợ cuối kỳ hàng tồn kho",
    }),
    configuredRecord("SET-INV", "ACCOUNT_SET", {
      accountSetKey: "INVENTORY",
      accountSetName: "Hàng tồn kho",
    }),
    ...["151", "152", "153", "154", "155", "156", "157", "158"].map(
      (accountCode, index) => configuredRecord(`INV-${accountCode}`, "ACCOUNT_SET_MEMBER", {
        accountSetKey: "INVENTORY",
        companyKey: "NTV",
        matchType: "PREFIX",
        matchValue: accountCode,
        role: "INCLUDE",
        sortOrder: 10 + index,
      }),
    ),
    configuredRecord("ROW-CASH-01", "REPORT_ROW", {
      rowCode: "01",
      rowLabel: "Tiền thu từ bán hàng",
      rowType: "DATA",
      reportKey: "B01",
      ruleKey: "CASH_RECEIPT",
      sortOrder: 2,
    }),
    configuredRecord("RULE-CASH-01", "RULE", {
      accountSetKey: "CASH",
      counterAccountSetKey: "REVENUE",
      operator: "CASH_MOVEMENT",
      periodBasis: "PERIOD",
      ruleKey: "CASH_RECEIPT",
      side: "DEBIT",
    }),
    configuredRecord("SET-CASH", "ACCOUNT_SET", {
      accountSetKey: "CASH",
      accountSetName: "Tiền và tương đương tiền",
    }),
    configuredRecord("SET-REVENUE", "ACCOUNT_SET", {
      accountSetKey: "REVENUE",
      accountSetName: "Doanh thu bán hàng",
    }),
    configuredRecord("CASH-111", "ACCOUNT_SET_MEMBER", {
      accountSetKey: "CASH",
      matchType: "PREFIX",
      matchValue: "111",
      role: "INCLUDE",
    }),
    configuredRecord("CASH-112", "ACCOUNT_SET_MEMBER", {
      accountSetKey: "CASH",
      matchType: "PREFIX",
      matchValue: "112",
      role: "INCLUDE",
    }),
    configuredRecord("REVENUE-511", "ACCOUNT_SET_MEMBER", {
      accountSetKey: "REVENUE",
      matchType: "PREFIX",
      matchValue: "511",
      role: "INCLUDE",
    }),
  ];
  const result = await buildConfiguredAccountingReportTemplate({
    actorEmail: "ke-toan@thuanviet.example",
    records,
    reportKey: "B01",
    versionName: "BCTC chuẩn",
  });
  assert.equal(result.ok, true);
  assert.match(result.fileName, /\.xlsx$/);
  assert.equal(result.formulaCellCount, 4);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(result.base64, "base64") as unknown as Parameters<
      typeof workbook.xlsx.load
    >[0],
  );
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Báo cáo & công thức",
    "Khuôn kỹ thuật",
    "Danh mục công thức",
  ]);
  const report = workbook.getWorksheet("Báo cáo & công thức");
  const technicalLayout = workbook.getWorksheet("Khuôn kỹ thuật");
  const formula = workbook.getWorksheet("Danh mục công thức");
  assert.ok(report);
  assert.ok(technicalLayout);
  assert.ok(formula);
  assert.equal(report.getCell("A1").value, "BẢNG CÂN ĐỐI KẾ TOÁN");
  assert.equal(report.getCell("B4").value, "Cuối kỳ");
  assert.equal(report.getCell("B5").value, "Nợ");
  assert.equal(report.getCell("B6").value, "Công thức dễ hiểu");
  assert.equal(report.getCell("C6").value, "Nhóm/tài khoản áp dụng");
  assert.equal(report.getCell("D6").value, "Công thức ngắn gọn");
  assert.match(String(report.getCell("B7").value), /số dư Nợ cuối kỳ của nhóm “Hàng tồn kho”/);
  assert.match(String(report.getCell("C7").value), /TK 151\*/);
  assert.match(String(report.getCell("C7").value), /TK 158\*/);
  assert.match(String(report.getCell("D7").value), /^DUNO\(151\*\) \+ DUNO\(152\*\)/);
  assert.equal(technicalLayout.state, "hidden");
  assert.equal(formula.state, "hidden");
  assert.match(String(formula.getCell("D5").value), /số dư Nợ cuối kỳ của nhóm “Hàng tồn kho”/);
  assert.match(String(formula.getCell("D6").value), /số dư Nợ đầu kỳ của nhóm “Hàng tồn kho”/);
  assert.equal(formula.getCell("E5").value, "Hàng tồn kho");
  assert.match(String(formula.getCell("F5").value), /TK 151\*/);
  assert.match(String(formula.getCell("F5").value), /TK 158\*/);
  assert.match(String(formula.getCell("D7").value), /phát sinh Nợ trong kỳ của nhóm “Tiền và tương đương tiền”/);
  assert.match(String(formula.getCell("D7").value), /phía đối ứng là Có của nhóm “Doanh thu bán hàng”/);
  assert.doesNotMatch(String(formula.getCell("D7").value), / · /);
  assert.equal(formula.getCell("G7").value, "Doanh thu bán hàng");
  assert.match(String(formula.getCell("H7").value), /TK 511\*/);
  assert.equal(formula.getCell("M4").value, "Công thức ngắn gọn");
  assert.match(String(formula.getCell("M5").value), /^DUNO\(151\*\) \+ DUNO\(152\*\)/);

  const evidenceResult = await buildConfiguredAccountingReportTemplate({
    actorEmail: "ke-toan@thuanviet.example",
    evidenceOutput: {
      periodFrom: "2026-01-01",
      periodTo: "2026-01-31",
      rows: [
        {
          rowCode: "141",
          cells: [
            {
              columnKey: "NO",
              evidence: {
                value: 1_500,
                components: [
                  {
                    accountName: "Hàng mua đang đi đường",
                    accountNumber: "151",
                    companyKey: "NTV",
                    dataSpaceName: "KETOAN_2026",
                    datasetType: "TRIAL_BALANCE",
                    label: "Nợ cuối kỳ TK 151 - Hàng mua đang đi đường",
                    periodFrom: "2026-01-01",
                    periodTo: "2026-01-31",
                    signedValue: 2_000,
                    sourceKey: "TB_NTV",
                  },
                  {
                    accountName: "Dự phòng giảm giá hàng tồn kho",
                    accountNumber: "2294",
                    companyKey: "NTV",
                    dataSpaceName: "KETOAN_2026",
                    datasetType: "TRIAL_BALANCE",
                    label: "Có cuối kỳ TK 2294 - Dự phòng giảm giá hàng tồn kho",
                    periodFrom: "2026-01-01",
                    periodTo: "2026-01-31",
                    signedValue: -500,
                    sourceKey: "TB_NTV",
                  },
                ],
              },
            },
          ],
        },
        {
          rowCode: "01",
          cells: [
            {
              columnKey: "NO",
              evidence: {
                value: 0,
                difference: 0,
                isComplete: true,
                components: [
                  {
                    formulaSign: 1,
                    label: "Công thức vẫn áp dụng: lấy phát sinh Nợ trong kỳ của TK 111*, TK 112*; kỳ này không phát sinh",
                    signedValue: 0,
                    sourceName: "Cấu hình công thức - kỳ này không phát sinh",
                    tracePath: "Dòng 01 - Tiền thu từ bán hàng → lấy phát sinh Nợ TK 111*, TK 112*: 0",
                  },
                  {
                    formulaSign: -1,
                    label: "Công thức vẫn áp dụng: trừ khoản đối ứng TK 511*; kỳ này không phát sinh",
                    signedValue: 0,
                    sourceName: "Cấu hình công thức - kỳ này không phát sinh",
                    tracePath: "Dòng 01 - Tiền thu từ bán hàng → trừ khoản đối ứng TK 511*: 0",
                  },
                ],
              },
            },
          ],
        },
      ],
    },
    exportMode: "EVIDENCE",
    records,
    reportKey: "B01",
    versionName: "BCTC chuẩn",
  });
  const evidenceWorkbook = new ExcelJS.Workbook();
  if (process.env.ACCOUNTING_EXPORT_QA_DIR) {
    await mkdir(process.env.ACCOUNTING_EXPORT_QA_DIR, { recursive: true });
    await writeFile(
      path.join(process.env.ACCOUNTING_EXPORT_QA_DIR, "bao-cao-cong-thuc-de-doc.xlsx"),
      Buffer.from(evidenceResult.base64, "base64"),
    );
  }
  await evidenceWorkbook.xlsx.load(
    Buffer.from(evidenceResult.base64, "base64") as unknown as Parameters<
      typeof evidenceWorkbook.xlsx.load
    >[0],
  );
  assert.deepEqual(evidenceWorkbook.worksheets.map((sheet) => sheet.name), [
    "Báo cáo & chứng minh",
    "Khuôn kỹ thuật",
    "Danh mục công thức",
    "Nguồn số liệu đã dùng",
  ]);
  const evidenceReport = evidenceWorkbook.getWorksheet("Báo cáo & chứng minh");
  const evidenceFormula = evidenceWorkbook.getWorksheet("Danh mục công thức");
  const evidenceDetail = evidenceWorkbook.getWorksheet("Nguồn số liệu đã dùng");
  assert.ok(evidenceReport);
  assert.ok(evidenceFormula);
  assert.ok(evidenceDetail);
  assert.equal(evidenceReport.getCell("B6").value, "Số báo cáo");
  assert.equal(evidenceReport.getCell("C6").value, "Công thức dễ hiểu");
  assert.equal(evidenceReport.getCell("D6").value, "Số liệu chứng minh");
  assert.equal(evidenceReport.getCell("E6").value, "Công thức ngắn gọn");
  assert.equal(evidenceReport.getCell("B7").value, 1_500);
  assert.match(String(evidenceReport.getCell("C7").value), /TK 151\*/);
  assert.match(String(evidenceReport.getCell("D7").value), /= 2\.000 − 500 = 1\.500/);
  assert.match(String(evidenceReport.getCell("D7").value), /Mỗi số là gì/);
  assert.match(String(evidenceReport.getCell("E7").value), /^DUNO\(151\*\) \+ DUNO\(152\*\)/);
  assert.equal(evidenceReport.getCell("B8").value, 0);
  assert.match(String(evidenceReport.getCell("D8").value), /kỳ này không phát sinh/i);
  assert.equal(evidenceFormula.getCell("M4").value, "Phép tính bằng số");
  assert.equal(evidenceFormula.getCell("Q4").value, "Công thức ngắn gọn");
  assert.match(String(evidenceFormula.getCell("M5").value), /= 2\.000 − 500 = 1\.500/);
  assert.match(String(evidenceFormula.getCell("N5").value), /\[Nợ cuối kỳ TK 151/);
  assert.equal(evidenceFormula.getCell("O5").value, "Đủ nguồn - đã khớp");
  assert.match(String(evidenceFormula.getCell("M7").value), /= 0 − 0 = 0/);
  assert.match(String(evidenceFormula.getCell("N7").value), /TK 111\*, TK 112\*/);
  assert.match(String(evidenceFormula.getCell("N7").value), /TK 511\*/);
  assert.equal(
    evidenceFormula.getCell("O7").value,
    "Công thức hợp lệ - kỳ này không phát sinh",
  );
  assert.equal(
    evidenceFormula.getCell("P7").value,
    "Công thức vẫn được xuất đầy đủ; kỳ đã chọn không phát sinh số liệu.",
  );
  assert.match(String(evidenceFormula.getCell("Q5").value), /^DUNO\(151\*\) \+ DUNO\(152\*\)/);
  assert.equal(evidenceDetail.getCell("G5").value, "151");
  assert.equal(evidenceDetail.getCell("F6").value, -500);
  assert.equal(evidenceDetail.getCell("N5").value, "Bảng cân đối tài khoản AMIS");
  assert.equal(evidenceDetail.getColumn(17).hidden, true);
  const detailPaths = Array.from(
    { length: evidenceDetail.rowCount },
    (_, index) => String(evidenceDetail.getCell(index + 1, 4).value || ""),
  );
  assert.equal(detailPaths.filter((value) => /TK 111\*, TK 112\*/.test(value)).length, 1);
  assert.equal(detailPaths.filter((value) => /TK 511\*/.test(value)).length, 1);
  for (let row = 1; row <= evidenceDetail.rowCount; row += 1) {
    for (let column = 1; column <= 16; column += 1) {
      assert.doesNotMatch(String(evidenceDetail.getCell(row, column).value || ""), /TB_NTV/);
    }
  }
});
