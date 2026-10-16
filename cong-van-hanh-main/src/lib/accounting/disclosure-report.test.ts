import assert from "node:assert/strict";
import test from "node:test";

import { buildAccountingDisclosureReportRecords } from "@/lib/accounting/disclosure-report";
import { normalizeRecordPayload } from "@/lib/accounting/normalize";
import type { AccountingRecord, JsonObject } from "@/lib/accounting/types";

function currentRow(payload: JsonObject): AccountingRecord {
  return {
    companyKey: "",
    createdAt: "",
    createdBy: "",
    displayCode: String(payload.rowCode || ""),
    displayName: String(payload.rowLabel || ""),
    entityKey: `B09_DN_TT99:${payload.rowCode}`,
    isDeleted: false,
    parentKey: "B09_DN_TT99",
    payload,
    recordId: "ROW_V_1",
    recordType: "REPORT_ROW",
    sortOrder: 1,
    status: "ACTIVE",
    updatedAt: "",
    updatedBy: "",
    validFrom: "",
    validTo: "",
    versionId: "TEST",
  };
}

const disclosure = [
  {
    payload: {
      sourceSheet: "B09-DN",
      templateKey: "B09_DN_TT99",
      templateName: "Bản thuyết minh Báo cáo tài chính",
    },
    recordType: "DISCLOSURE_TEMPLATE" as const,
    sourceRow: 1,
    sourceSheet: "B09-DN",
  },
  {
    payload: {
      itemKey: "B09_DN_TT99:V.1",
      noteCode: "V.1",
      noteTitle: "Tiền và các khoản tương đương tiền",
      periodBasis: ["OPENING", "ENDING"],
      sectionKey: "V",
      sourceDatasets: ["TRIAL_BALANCE"],
      startRow: 10,
      templateKey: "B09_DN_TT99",
    },
    recordType: "DISCLOSURE_ITEM" as const,
    sourceRow: 10,
    sourceSheet: "B09-DN",
  },
  {
    payload: {
      aggregationRole: "ADDITIVE",
      disclosureItemKey: "B09_DN_TT99:V.1",
      reportKey: "BAO_CAO_TINH_HINH_TAI_CHINH",
      reportRowCode: "110",
      resolutionStatus: "RESOLVED",
    },
    recordType: "DISCLOSURE_LINK" as const,
    sourceRow: 10,
    sourceSheet: "B09-DN",
  },
];

test("B09 dùng đúng cấu trúc REPORT/ROW/COLUMN của trình dựng công thức chung", () => {
  const result = buildAccountingDisclosureReportRecords(disclosure);
  assert.equal(result.records.filter((item) => item.recordType === "REPORT").length, 1);
  assert.equal(result.records.filter((item) => item.recordType === "REPORT_COLUMN").length, 4);
  const row = result.records.find((item) => item.recordType === "REPORT_ROW");
  assert.ok(row);
  assert.equal(row.payload.rowCode, "V.1");
  const cells = row.payload.cells as JsonObject;
  const current = cells.NAM_NAY as JsonObject;
  assert.equal(current.formulaRequired, false);
  assert.deepEqual(current.terms, [
    {
      operator: "CROSS_REPORT",
      sign: 1,
      targetReportKey: "BAO_CAO_TINH_HINH_TAI_CHINH",
      targetRowCode: "110",
    },
  ]);
});

test("nạp lại khuôn B09 không ghi đè công thức kế toán đã chỉnh", () => {
  const existing = currentRow({
    cells: {
      NAM_NAY: {
        accountSetKey: "TIEN",
        formulaOrigin: "USER_DEFINED",
        terms: [{ accountSetKey: "TIEN", operator: "BALANCE", sign: 1 }],
      },
    },
    reportKey: "B09_DN_TT99",
    rowCode: "V.1",
    rowLabel: "Tên cũ",
  });
  const result = buildAccountingDisclosureReportRecords(disclosure, [existing]);
  const row = result.records.find((item) => item.recordType === "REPORT_ROW");
  const cells = row?.payload.cells as JsonObject;
  const current = cells.NAM_NAY as JsonObject;
  assert.equal(current.formulaOrigin, "USER_DEFINED");
  assert.equal(current.accountSetKey, "TIEN");
  assert.deepEqual(current.defaultTerms, [
    {
      operator: "CROSS_REPORT",
      sign: 1,
      targetReportKey: "BAO_CAO_TINH_HINH_TAI_CHINH",
      targetRowCode: "110",
    },
  ]);
});

test("chuẩn hóa dòng B09 giữ nguồn gốc công thức và công thức mặc định", () => {
  const result = buildAccountingDisclosureReportRecords(disclosure);
  const row = result.records.find((item) => item.recordType === "REPORT_ROW");
  assert.ok(row);
  const normalized = normalizeRecordPayload("REPORT_ROW", row.payload);
  const cells = normalized.cells as JsonObject;
  const current = cells.NAM_NAY as JsonObject;
  assert.equal(current.formulaOrigin, "DISCLOSURE_LINK_DEFAULT");
  assert.deepEqual(current.defaultTerms, current.terms);
});

test("dòng trình bày B09 giữ công thức kế toán gán trực tiếp", () => {
  const presentationDisclosure = disclosure.map((record) =>
    record.recordType === "DISCLOSURE_ITEM"
      ? {
          ...record,
          payload: {
            ...record.payload,
            periodBasis: ["REPORTING_PERIOD"],
            sourceDatasets: [],
          },
        }
      : record,
  );
  const existing = currentRow({
    cells: {
      NAM_NAY: {
        contentKind: "TEXT",
        formulaOrigin: "USER_DEFINED",
        terms: [{ accountSetKey: "TIEN", operator: "BALANCE", sign: 1 }],
      },
    },
    reportKey: "B09_DN_TT99",
    rowCode: "V.1",
    rowLabel: "Dòng trình bày được gán công thức",
    rowType: "NOTE",
  });

  const result = buildAccountingDisclosureReportRecords(
    presentationDisclosure,
    [existing],
  );
  const row = result.records.find((item) => item.recordType === "REPORT_ROW");
  const cells = row?.payload.cells as JsonObject;
  const current = cells.NAM_NAY as JsonObject;

  assert.equal(row?.payload.rowType, "NOTE");
  assert.equal(current.formulaOrigin, "USER_DEFINED");
  assert.equal(current.contentKind, "ACCOUNT_SET");
  assert.deepEqual(current.terms, [
    { accountSetKey: "TIEN", operator: "BALANCE", sign: 1 },
  ]);
});
