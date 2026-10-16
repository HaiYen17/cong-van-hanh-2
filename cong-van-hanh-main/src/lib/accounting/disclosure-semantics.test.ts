import assert from "node:assert/strict";
import test from "node:test";

import {
  buildAccountingDisclosureSemanticRecords,
  STANDARD_DISCLOSURE_BLUEPRINTS,
} from "@/lib/accounting/disclosure-semantics";
import type {
  AccountingRecord,
  AccountingRecordType,
  JsonObject,
} from "@/lib/accounting/types";

function reportRow(reportKey: string, rowCode: string, rowLabel: string) {
  return {
    companyKey: "",
    createdAt: "",
    createdBy: "",
    displayCode: rowCode,
    displayName: rowLabel,
    entityKey: `${reportKey}:${rowCode}`,
    isDeleted: false,
    parentKey: reportKey,
    payload: { reportKey, rowCode, rowLabel },
    recordId: `${reportKey}:${rowCode}`,
    recordType: "REPORT_ROW",
    sortOrder: Number(rowCode || 0),
    status: "ACTIVE",
    updatedAt: "",
    updatedBy: "",
    validFrom: "",
    validTo: "",
    versionId: "TEST",
  } satisfies AccountingRecord;
}

function semanticLayout() {
  const records: Array<{
    payload: JsonObject;
    recordType: AccountingRecordType;
    sourceRow: number;
    sourceSheet: string;
  }> = [
    {
      payload: { templateKey: "B09_DN_TT99", templateName: "B09-DN" },
      recordType: "DISCLOSURE_TEMPLATE",
      sourceRow: 1,
      sourceSheet: "B09-DN",
    },
  ];
  let startRow = 10;
  for (const sectionCode of ["MO_DAU", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"]) {
    const blueprints = STANDARD_DISCLOSURE_BLUEPRINTS.filter(
      (item) => item.sectionCode === sectionCode,
    );
    const cells = blueprints
      .filter((item) => item.ordinal)
      .flatMap((item, index) => {
        const row = startRow + index * 3;
        const output: JsonObject[] = [
          { column: 1, row, text: `${item.ordinal}. ${item.title}` },
        ];
        if (item.code === "V.7") {
          output.push({
            column: 2,
            role: "REFERENCE_VALUE",
            row: row + 1,
            runtimeValue: null,
            sampleValue: 123_456,
          });
        }
        return output;
      });
    const endRow = startRow + Math.max(2, blueprints.length * 3 - 1);
    records.push({
      payload: {
        cells,
        endRow,
        sectionCode,
        sectionKey: sectionCode,
        sectionTitle: `Phần ${sectionCode}`,
        startRow,
        templateKey: "B09_DN_TT99",
      },
      recordType: "DISCLOSURE_SECTION",
      sourceRow: startRow,
      sourceSheet: "B09-DN",
    });
    startRow = endRow + 1;
  }
  return records;
}

test("lập đủ 55 khoản mục B09 và không biến số mẫu thành công thức", () => {
  const result = buildAccountingDisclosureSemanticRecords(semanticLayout());
  assert.equal(STANDARD_DISCLOSURE_BLUEPRINTS.length, 55);
  assert.equal(result.stats.itemCount, 55);
  assert.equal(result.warnings.length, 0);

  const inventory = result.records.find(
    (record) =>
      record.recordType === "DISCLOSURE_ITEM" &&
      record.payload.noteCode === "V.7",
  );
  assert.ok(inventory);
  assert.equal(inventory.payload.sampleNumberCount, 1);
  assert.equal(inventory.payload.sourceStrategy, "REPORT_LINE_DETAIL");
  assert.deepEqual(inventory.payload.periodBasis, ["OPENING", "ENDING"]);
  assert.match(String(inventory.payload.formulaPrinciple), /báo cáo liên kết/i);
  assert.equal("sampleValue" in inventory.payload, false);
  assert.equal("formula" in inventory.payload, false);
});

test("tạo đường đối chiếu hai chiều với ba báo cáo chính", () => {
  const current = [
    reportRow("BAO_CAO_TINH_HINH_TAI_CHINH", "140", "Hàng tồn kho"),
    reportRow("BAO_CAO_KET_QUA_KINH_DOANH", "01", "Doanh thu bán hàng"),
    reportRow("LUU_CHUYEN_TIEN_TE_TRUC_TIEP", "33", "Tiền thu từ đi vay"),
    reportRow("LUU_CHUYEN_TIEN_TE_GIAN_TIEP", "33", "Tiền thu từ đi vay"),
    reportRow("LUU_CHUYEN_TIEN_TE_TRUC_TIEP", "34", "Tiền trả nợ gốc vay"),
    reportRow("LUU_CHUYEN_TIEN_TE_GIAN_TIEP", "34", "Tiền trả nợ gốc vay"),
  ];
  const result = buildAccountingDisclosureSemanticRecords(
    semanticLayout(),
    current,
  );
  assert.equal(result.records.filter((record) => record.recordType === "DISCLOSURE_LINK").length, 62);
  assert.equal(result.stats.linkedReportRowCount, 6);

  const borrowingLinks = result.records.filter(
    (record) =>
      record.recordType === "DISCLOSURE_LINK" &&
      record.payload.noteCode === "VII.3",
  );
  assert.equal(borrowingLinks.length, 2);
  assert.ok(
    borrowingLinks.every(
      (record) =>
        record.payload.linkRole === "RECONCILIATION_ONLY" &&
        record.payload.resolutionStatus === "RESOLVED",
    ),
  );

  const financeCostLinks = result.records.filter(
    (record) =>
      record.recordType === "DISCLOSURE_LINK" &&
      record.payload.noteCode === "VI.6",
  );
  assert.deepEqual(
    financeCostLinks.map((record) => record.payload.aggregationRole),
    ["ADDITIVE", "SUBSET_DETAIL"],
  );
});
