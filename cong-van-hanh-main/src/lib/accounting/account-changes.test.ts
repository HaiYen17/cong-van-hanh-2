import assert from "node:assert/strict";
import test from "node:test";

import { buildAccountingAccountChangePreview } from "@/lib/accounting/account-changes";
import type {
  AccountingRecord,
  AccountingRecordType,
  JsonObject,
} from "@/lib/accounting/types";

function record(
  recordId: string,
  recordType: AccountingRecordType,
  payload: JsonObject,
): AccountingRecord {
  const accountCode = String(payload.accountCode || payload.matchValue || "");
  return {
    companyKey: String(payload.companyKey || ""),
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "admin@example.com",
    displayCode: accountCode,
    displayName: String(payload.accountName || accountCode),
    entityKey: recordId,
    isDeleted: false,
    parentKey: "",
    payload,
    recordId,
    recordType,
    sortOrder: 0,
    status: "Kích hoạt",
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "admin@example.com",
    validFrom: String(payload.validFrom || ""),
    validTo: String(payload.validTo || ""),
    versionId: "V1",
  };
}

test("đổi mã tài khoản giữ lịch sử và nhận đúng ánh xạ bị ảnh hưởng", () => {
  const target = record("A1", "ACCOUNT", {
    accountCode: "111",
    accountName: "Tiền mặt",
    companyKey: "TVG",
    logicalAccountKey: "CASH",
    validFrom: "2024-01-01",
  });
  const mapping = record("M1", "ACCOUNT_SET_MEMBER", {
    accountSetKey: "CASH",
    companyKey: "TVG",
    matchType: "EXACT",
    matchValue: "111",
  });
  const preview = buildAccountingAccountChangePreview([target, mapping], {
    effectiveDate: "2026-01-01",
    mode: "RECODE",
    newValue: " 1111 ",
    recordId: "A1",
    versionId: "V1",
  });

  assert.equal(preview.ok, true);
  assert.equal(preview.newValue, "1111");
  assert.equal(preview.impact.mappingCount, 1);
  assert.equal(preview.impactedMappings[0]?.recordId, "M1");
  assert.equal(preview.impact.historicalRowsChanged, 0);
});

test("đổi mã chỉ cập nhật đúng mã nằm trong danh sách hỗn hợp", () => {
  const target = record("A1", "ACCOUNT", {
    accountCode: "1531",
    accountName: "Công cụ dụng cụ",
    companyKey: "TVG",
    logicalAccountKey: "TOOLS",
    validFrom: "2024-01-01",
  });
  const mixed = record("MIXED-1", "ACCOUNT_SET_MEMBER", {
    accountSetKey: "INVENTORY",
    companyKey: "TVG",
    matchType: "MIXED",
    matchValue: "151*, 152*, 1531, 1541",
  });
  const prefixOnly = record("PREFIX-1", "ACCOUNT_SET_MEMBER", {
    accountSetKey: "INVENTORY",
    companyKey: "TVG",
    matchType: "MIXED",
    matchValue: "153*",
  });
  const preview = buildAccountingAccountChangePreview(
    [target, mixed, prefixOnly],
    {
      effectiveDate: "2026-01-01",
      mode: "RECODE",
      newValue: "1539",
      recordId: "A1",
      versionId: "V1",
    },
  );

  assert.equal(preview.ok, true);
  assert.equal(preview.impact.mappingCount, 1);
  assert.equal(preview.impactedMappings[0]?.recordId, "MIXED-1");
});

test("đổi mã chặn mã trùng trong cùng công ty và khoảng hiệu lực", () => {
  const target = record("A1", "ACCOUNT", {
    accountCode: "111",
    accountName: "Tiền mặt",
    companyKey: "TVG",
    validFrom: "2024-01-01",
  });
  const duplicate = record("A2", "ACCOUNT", {
    accountCode: "1111",
    accountName: "Tiền đang chuyển",
    companyKey: "TVG",
    validFrom: "2025-01-01",
  });
  const preview = buildAccountingAccountChangePreview([target, duplicate], {
    effectiveDate: "2026-01-01",
    mode: "RECODE",
    newValue: "1111",
    recordId: "A1",
    versionId: "V1",
  });

  assert.equal(preview.ok, false);
  assert.match(preview.errors.join("\n"), /đã tồn tại/);
});
