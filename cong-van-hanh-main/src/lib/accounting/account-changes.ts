import {
  cleanText,
  normalizeKey,
} from "@/lib/accounting/normalize";
import {
  assertDraftAccountingVersion,
  getAccountingConfigData,
  readAccountingVersionRecordsForUpdate,
  readVersionRecords,
  saveAccountingRecordInTransaction,
  touchAccountingVersion,
} from "@/lib/accounting/repository";
import type {
  AccountingRecord,
  JsonObject,
} from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";
import { withAccountingTransaction } from "@/lib/accounting/database";

const ACCOUNT_CHANGE_MODES = new Set([
  "RENAME",
  "RECODE",
  "REMAP_LOGICAL",
]);

function isoDate(value: unknown, label: string) {
  const text = cleanText(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AccountingRpcError(`${label} phải có định dạng YYYY-MM-DD.`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== text
  ) {
    throw new AccountingRpcError(`${label} không phải ngày hợp lệ.`);
  }
  return text;
}

function previousDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function accountCode(value: unknown) {
  return cleanText(value).replace(/\s+/g, "");
}

function isMixedExactCode(matchValue: unknown, accountCodeValue: string) {
  return cleanText(matchValue)
    .split(/[\n,;]+/)
    .map((item) => accountCode(item).replace(/^TK/i, ""))
    .some((item) => item === accountCodeValue);
}

function replaceMixedExactCode(
  matchValue: unknown,
  oldCode: string,
  newCode: string,
) {
  return String(matchValue || "")
    .split(/([\n,;]+)/)
    .map((part) => {
      if (/^[\n,;]+$/.test(part)) return part;
      const compact = accountCode(part).replace(/^TK/i, "");
      return compact === oldCode ? newCode : part;
    })
    .join("");
}

function recodedMappingValue(
  mapping: AccountingRecord,
  oldCode: string,
  newCode: string,
) {
  return normalizeKey(mapping.payload.matchType) === "MIXED"
    ? replaceMixedExactCode(mapping.payload.matchValue, oldCode, newCode)
    : newCode;
}

export function buildAccountingAccountChangePreview(
  records: AccountingRecord[],
  payload: JsonObject,
) {
  const versionId = cleanText(payload.versionId);
  const recordId = cleanText(payload.recordId);
  const mode = normalizeKey(payload.mode);
  let newValue = cleanText(payload.newValue);
  if (
    !versionId ||
    !recordId ||
    !ACCOUNT_CHANGE_MODES.has(mode) ||
    !newValue
  ) {
    throw new AccountingRpcError(
      "Thiếu tài khoản, loại thay đổi hoặc giá trị mới.",
    );
  }

  const target = records.find(
    (record) =>
      record.versionId === versionId &&
      record.recordId === recordId &&
      record.recordType === "ACCOUNT" &&
      !record.isDeleted,
  );
  if (!target) {
    throw new AccountingRpcError(
      "Không tìm thấy tài khoản cần thay đổi.",
      404,
    );
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  let effectiveDate = "";
  let impactedMappings: AccountingRecord[] = [];

  if (mode === "RECODE") {
    newValue = accountCode(newValue);
    effectiveDate = isoDate(payload.effectiveDate, "Ngày đổi mã");
    if (newValue === target.displayCode) {
      errors.push("Mã tài khoản mới phải khác mã hiện tại.");
    }
    if (target.validFrom && effectiveDate <= target.validFrom) {
      errors.push(
        `Ngày đổi mã phải sau ngày bắt đầu hiệu lực của mã hiện tại (${target.validFrom}).`,
      );
    }
    if (target.validTo && effectiveDate > target.validTo) {
      errors.push(
        `Ngày đổi mã nằm sau ngày kết thúc hiệu lực của mã hiện tại (${target.validTo}).`,
      );
    }
    impactedMappings = records.filter((record) => {
      const item = record.payload;
      return (
        record.versionId === versionId &&
        record.recordType === "ACCOUNT_SET_MEMBER" &&
        !record.isDeleted &&
        record.companyKey === target.companyKey &&
        (
          (normalizeKey(item.matchType) === "EXACT" &&
            accountCode(item.matchValue) === target.displayCode) ||
          (normalizeKey(item.matchType) === "MIXED" &&
            isMixedExactCode(item.matchValue, target.displayCode))
        ) &&
        (!record.validTo || record.validTo >= effectiveDate)
      );
    });
    const duplicate = records.find(
      (record) =>
        record.versionId === versionId &&
        record.recordType === "ACCOUNT" &&
        !record.isDeleted &&
        record.companyKey === target.companyKey &&
        record.displayCode === newValue &&
        (!record.validTo || record.validTo >= effectiveDate),
    );
    if (duplicate) {
      errors.push(
        `Mã mới ${newValue} đã tồn tại trong công ty và khoảng hiệu lực này.`,
      );
    }
    if (!cleanText(target.payload.logicalAccountKey)) {
      warnings.push(
        "Tài khoản cũ chưa có khóa tài khoản logic. Nên bổ sung khóa này trước khi đổi mã.",
      );
    }
  } else if (mode === "REMAP_LOGICAL") {
    newValue = normalizeKey(newValue);
  }

  return {
    ok: errors.length === 0,
    versionId,
    target,
    mode,
    newValue,
    effectiveDate,
    impactedMappings,
    impact: {
      accountCount: 1,
      mappingCount: impactedMappings.length,
      formulaCount: 0,
      historicalRowsChanged: 0,
    },
    errors,
    warnings,
  };
}

export async function previewAccountingAccountChange(payload: JsonObject) {
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError("Vui lòng chọn phiên bản nháp.");
  }
  const records = await readVersionRecords(versionId);
  return buildAccountingAccountChangePreview(records, payload);
}

export async function applyAccountingAccountChange(
  payload: JsonObject,
  actorEmail: string,
) {
  const versionId = cleanText(payload.versionId);
  const result = await withAccountingTransaction(async (client) => {
    await assertDraftAccountingVersion(client, versionId);
    const records = await readAccountingVersionRecordsForUpdate(
      client,
      versionId,
    );
    const preview = buildAccountingAccountChangePreview(records, payload);
    if (!preview.ok) {
      throw new AccountingRpcError(preview.errors.join("\n"), 409);
    }

    const target = preview.target;
    if (preview.mode === "RENAME") {
      await saveAccountingRecordInTransaction(client, {
        actorEmail,
        auditAction: "RENAME_ACCOUNT",
        note: "Đổi tên không thay đổi công thức.",
        record: {
          recordId: target.recordId,
          recordType: "ACCOUNT",
          payload: {
            ...target.payload,
            accountName: preview.newValue,
          },
        },
        versionId,
      });
    } else if (preview.mode === "REMAP_LOGICAL") {
      await saveAccountingRecordInTransaction(client, {
        actorEmail,
        auditAction: "REMAP_LOGICAL_ACCOUNT",
        note: "Thay khóa tài khoản logic.",
        record: {
          recordId: target.recordId,
          recordType: "ACCOUNT",
          payload: {
            ...target.payload,
            logicalAccountKey: preview.newValue,
          },
        },
        versionId,
      });
    } else {
      const closedAt = previousDate(preview.effectiveDate);
      await saveAccountingRecordInTransaction(client, {
        actorEmail,
        auditAction: "RECODE_ACCOUNT_CLOSE",
        note: "Đóng mã cũ trước ngày hiệu lực.",
        record: {
          recordId: target.recordId,
          recordType: "ACCOUNT",
          payload: {
            ...target.payload,
            validTo: closedAt,
          },
        },
        versionId,
      });
      await saveAccountingRecordInTransaction(client, {
        actorEmail,
        auditAction: "RECODE_ACCOUNT_OPEN",
        note: "Mở mã mới, giữ khóa tài khoản logic.",
        record: {
          recordType: "ACCOUNT",
          payload: {
            ...target.payload,
            accountCode: preview.newValue,
            validFrom: preview.effectiveDate,
            validTo: target.validTo || "",
            status: "ACTIVE",
          },
        },
        versionId,
      });

      for (const mapping of preview.impactedMappings) {
        const nextMatchValue = recodedMappingValue(
          mapping,
          target.displayCode,
          preview.newValue,
        );
        if (mapping.validFrom && mapping.validFrom >= preview.effectiveDate) {
          await saveAccountingRecordInTransaction(client, {
            actorEmail,
            auditAction: "RECODE_MAPPING_UPDATE",
            note: "Cập nhật ánh xạ bắt đầu từ hoặc sau ngày đổi mã.",
            record: {
              recordId: mapping.recordId,
              recordType: "ACCOUNT_SET_MEMBER",
              payload: {
                ...mapping.payload,
                matchValue: nextMatchValue,
              },
            },
            versionId,
          });
          continue;
        }

        await saveAccountingRecordInTransaction(client, {
          actorEmail,
          auditAction: "RECODE_MAPPING_CLOSE",
          note: "Đóng ánh xạ mã cũ trước ngày hiệu lực.",
          record: {
            recordId: mapping.recordId,
            recordType: "ACCOUNT_SET_MEMBER",
            payload: {
              ...mapping.payload,
              validTo: closedAt,
            },
          },
          versionId,
        });
        await saveAccountingRecordInTransaction(client, {
          actorEmail,
          auditAction: "RECODE_MAPPING",
          note: "Tách ánh xạ nhóm theo ngày đổi mã.",
          record: {
            recordType: "ACCOUNT_SET_MEMBER",
            payload: {
              ...mapping.payload,
              matchValue: nextMatchValue,
              validFrom: preview.effectiveDate,
              validTo: mapping.validTo || "",
              status: "ACTIVE",
            },
          },
          versionId,
        });
      }
    }

    await touchAccountingVersion(client, versionId, actorEmail);
    return preview;
  });

  return {
    ok: true,
    impact: result.impact,
    data: await getAccountingConfigData({ versionId }, actorEmail),
    message:
      result.mode === "RENAME"
        ? "Đã đổi tên tài khoản; công thức không thay đổi."
        : result.mode === "REMAP_LOGICAL"
          ? "Đã thay khóa logic của tài khoản."
          : "Đã tách mã cũ/mới theo ngày hiệu lực và cập nhật ánh xạ liên quan.",
  };
}
