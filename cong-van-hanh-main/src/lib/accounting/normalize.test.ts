import assert from "node:assert/strict";
import test from "node:test";

import {
  COLUMN_TYPES,
  MATCH_TYPES,
  OPERATORS,
  ROW_TYPES,
} from "@/lib/accounting/constants";
import {
  assertNoSecrets,
  normalizeRecordPayload,
  normalizeReportCells,
} from "@/lib/accounting/normalize";

test("khôi phục đủ enum báo cáo từ bản GAS", () => {
  assert.equal(OPERATORS.includes("DELTA_BALANCE"), true);
  assert.equal(OPERATORS.includes("MOVEMENT_DETAIL"), true);
  assert.equal(OPERATORS.includes("PROFIT_LOSS_ACTIVITY"), true);
  assert.equal(OPERATORS.includes("LINE_REFERENCE"), true);
  assert.equal(ROW_TYPES.includes("CROSS_REPORT"), true);
  assert.equal(ROW_TYPES.includes("MANUAL_ADJUSTMENT"), true);
  assert.equal(COLUMN_TYPES.includes("BUDGET"), true);
  assert.equal(COLUMN_TYPES.includes("VARIANCE"), true);
  assert.equal(COLUMN_TYPES.includes("COMPANY"), true);
  assert.equal(COLUMN_TYPES.includes("CONSOLIDATED"), true);
  assert.equal(MATCH_TYPES.includes("MIXED"), true);
});

test("cho phép một nhóm tài khoản dùng danh sách hỗn hợp", () => {
  const payload = normalizeRecordPayload("ACCOUNT_SET_MEMBER", {
    accountSetKey: "HANG_TON_KHO",
    companyKey: "NTV",
    matchType: "mixed",
    matchValue: "151*, 152*, 1531, 1541, 1542, 1543, 155*, 156*, 157*, 158*",
  });
  assert.equal(payload.matchType, "MIXED");
  assert.equal(payload.matchValue, "151*, 152*, 1531, 1541, 1542, 1543, 155*, 156*, 157*, 158*");
});

test("cho phép tham chiếu secret nhưng chặn credential thật", () => {
  assert.doesNotThrow(() =>
    assertNoSecrets({
      secretRef: "projects/demo/secrets/accounting-worker",
      nested: { bearer: "" },
    }),
  );
  assert.throws(
    () => assertNoSecrets({ nested: { bearer: "sensitive-value" } }),
    /Không được lưu mã truy cập/,
  );
  assert.throws(
    () => assertNoSecrets({ access_token: "sensitive-value" }),
    /Không được lưu mã truy cập/,
  );
});

test("chuẩn hóa cell, term, span và style theo giới hạn cũ", () => {
  const cells = normalizeReportCells({
    " current period ": {
      align: "diagonal",
      borderPreset: "unknown",
      borderWidth: 99,
      contentKind: "unknown",
      fontSize: 99,
      mergeColumnSpan: 100,
      mergeRowSpan: 500,
      operator: "not-supported",
      periodBasis: "wrong",
      side: "wrong",
      terms: Array.from({ length: 60 }, (_, index) => ({
        operator: index === 0 ? "MOVEMENT" : "bad",
        periodBasis: "bad",
        side: "bad",
        sign: index === 0 ? -1 : 1,
      })),
    },
  });
  const cell = cells.CURRENT_PERIOD as Record<string, unknown>;
  assert.equal(cell.contentKind, "TEXT");
  assert.equal(cell.align, "LEFT");
  assert.equal(cell.borderPreset, "DEFAULT");
  assert.equal(cell.borderWidth, 4);
  assert.equal(cell.fontSize, 32);
  assert.equal(cell.mergeColumnSpan, 20);
  assert.equal(cell.mergeRowSpan, 100);
  assert.equal(cell.operator, "");
  assert.equal(cell.side, "NET");
  assert.equal(cell.periodBasis, "ENDING");
  const terms = cell.terms as Array<Record<string, unknown>>;
  assert.equal(terms.length, 50);
  assert.deepEqual(
    {
      operator: terms[0].operator,
      periodBasis: terms[0].periodBasis,
      side: terms[0].side,
      sign: terms[0].sign,
    },
    {
      operator: "MOVEMENT",
      periodBasis: "PERIOD",
      side: "NET",
      sign: -1,
    },
  );
});

test("REPORT_ROW chặn loại dòng không thuộc hợp đồng", () => {
  assert.throws(
    () =>
      normalizeRecordPayload("REPORT_ROW", {
        reportKey: "B01",
        rowCode: "100",
        rowLabel: "Dòng thử",
        rowType: "UNKNOWN",
      }),
    /Loại dòng chưa được hỗ trợ/,
  );
});

test("chuẩn hóa khoản mục và đường đối chiếu thuyết minh", () => {
  const item = normalizeRecordPayload("DISCLOSURE_ITEM", {
    automationLevel: "automatic",
    dimensions: ["account", "warehouse"],
    endRow: 20,
    formulaPrinciple: "Kế thừa dòng báo cáo và cộng ngược để đối chiếu.",
    itemKey: "b09_dn_tt99:v.7",
    noteCode: "v.7",
    noteTitle: "Hàng tồn kho",
    periodBasis: ["opening", "ending"],
    sectionKey: "v",
    sourceDatasets: ["trial_balance", "general_ledger"],
    startRow: 10,
    templateKey: "b09_dn_tt99",
  });
  assert.equal(item.itemKey, "B09_DN_TT99:V.7");
  assert.equal(item.noteCode, "V.7");
  assert.deepEqual(item.sourceDatasets, ["TRIAL_BALANCE", "GENERAL_LEDGER"]);

  const link = normalizeRecordPayload("DISCLOSURE_LINK", {
    disclosureItemKey: item.itemKey,
    linkRole: "primary_note_reference",
    noteCode: "v.7",
    reportKey: "bao_cao_tinh_hinh_tai_chinh",
    reportRowCode: "140",
    templateKey: "b09_dn_tt99",
  });
  assert.equal(link.linkRole, "PRIMARY_NOTE_REFERENCE");
  assert.equal(link.reportKey, "BAO_CAO_TINH_HINH_TAI_CHINH");
  assert.match(String(link.linkKey), /B09_DN_TT99:V.7:BAO_CAO_TINH_HINH_TAI_CHINH:140/);
});

test("REPORT_ROW giữ khóa thuyết minh và trạng thái bắt buộc", () => {
  const payload = normalizeRecordPayload("REPORT_ROW", {
    reportKey: "B01",
    rowCode: "100",
    rowLabel: "Tiền",
    rowType: "DATA",
    noteItemId: " 95647954-F9C7-48F4-8189-A66E06F8E19F ",
    noteRequired: "true",
    hideOnPrint: "true",
  });
  assert.equal(
    payload.noteItemId,
    "95647954-f9c7-48f4-8189-a66e06f8e19f",
  );
  assert.equal(payload.noteRequired, true);
  assert.equal(payload.hideOnPrint, true);
});

test("cell giữ đủ nguồn, đối ứng và bộ lọc của công thức kế toán", () => {
  const cells = normalizeReportCells({
    current: {
      contentKind: "ACCOUNT_SET",
      operator: "CASH_MOVEMENT",
      sourceKey: " amis-so-chi-tiet ",
      accountSetKey: " tien ",
      counterAccountSetKey: " khach-hang ",
      targetReportKey: " bao-cao-kqkd ",
      targetRowCode: "50",
      periodSelector: "same-range-prior-year",
      intercompanyMode: "exclude",
      excludeClosingEntries: true,
      filters: { branch_id: ["HN", "HCM"] },
      terms: [
        {
          operator: "MOVEMENT",
          sourceKey: " amis-so-chi-tiet ",
          accountSetKey: " gia-von ",
          counterAccountSetKey: " hang-ton-kho ",
          side: "DEBIT",
          useColumnBasis: false,
          excludeClosingEntries: true,
          filters: { department_id: "SALE" },
        },
      ],
    },
  });
  const cell = cells.CURRENT as Record<string, unknown>;
  assert.equal(cell.sourceKey, "AMIS-SO-CHI-TIET");
  assert.equal(cell.counterAccountSetKey, "KHACH-HANG");
  assert.equal(cell.targetReportKey, "BAO-CAO-KQKD");
  assert.equal(cell.targetRowCode, "50");
  assert.equal(cell.periodSelector, "SAME-RANGE-PRIOR-YEAR");
  assert.deepEqual(cell.filters, { branch_id: ["HN", "HCM"] });
  const term = (cell.terms as Array<Record<string, unknown>>)[0];
  assert.equal(term.sourceKey, "AMIS-SO-CHI-TIET");
  assert.equal(term.counterAccountSetKey, "HANG-TON-KHO");
  assert.equal(term.excludeClosingEntries, true);
  assert.equal(term.useColumnBasis, false);
  assert.deepEqual(term.filters, { department_id: "SALE" });
});
