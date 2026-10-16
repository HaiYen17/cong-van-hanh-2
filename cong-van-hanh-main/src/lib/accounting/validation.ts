import { cleanText, normalizeKey } from "@/lib/accounting/normalize";
import { readVersionRecords } from "@/lib/accounting/repository";
import type {
  AccountingRecord,
  JsonObject,
  ValidationIssue,
} from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";

function list(value: unknown) {
  if (Array.isArray(value)) {
    return value.map(cleanText).filter(Boolean);
  }
  return cleanText(value)
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

type AccountMatchCondition = {
  matchType: "EXACT" | "PREFIX";
  value: string;
};

function accountMatchConditions(
  matchType: string,
  matchValue: string,
): AccountMatchCondition[] {
  if (matchType !== "MIXED") {
    return matchValue
      ? [{ matchType: matchType === "PREFIX" ? "PREFIX" : "EXACT", value: matchValue }]
      : [];
  }
  const seen = new Set<string>();
  return list(matchValue).flatMap((item) => {
    const compact = cleanText(item).replace(/\s+/g, "").replace(/^TK/i, "");
    if (!compact) return [];
    const condition: AccountMatchCondition = compact.endsWith("*")
      ? { matchType: "PREFIX", value: compact.slice(0, -1) }
      : { matchType: "EXACT", value: compact };
    if (!condition.value || seen.has(`${condition.matchType}:${condition.value}`)) {
      return [];
    }
    seen.add(`${condition.matchType}:${condition.value}`);
    return [condition];
  });
}

function detectCycles(graph: Map<string, string[]>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycles: string[][] = [];

  function visit(node: string, path: string[]) {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      cycles.push((start >= 0 ? path.slice(start) : path).concat(node));
      return;
    }
    if (visited.has(node)) {
      return;
    }
    visiting.add(node);
    const nextPath = path.concat(node);
    for (const target of graph.get(node) || []) {
      if (graph.has(target)) {
        visit(target, nextPath);
      }
    }
    visiting.delete(node);
    visited.add(node);
  }

  for (const node of graph.keys()) {
    visit(node, []);
  }
  return cycles;
}

function payload(record: AccountingRecord): JsonObject {
  return record.payload || {};
}

function intervalValue(value: string, fallback: string) {
  return value || fallback;
}

export function validateAccountingRecords(records: AccountingRecord[]) {
  const issues: ValidationIssue[] = [];
  const unique = new Map<string, AccountingRecord>();
  const companies = new Map<string, AccountingRecord>();
  const accountsByCompany = new Map<string, Map<string, AccountingRecord>>();
  const accountSets = new Map<string, AccountingRecord>();
  const sources = new Map<string, AccountingRecord>();
  const reports = new Map<string, AccountingRecord>();
  const rows = new Map<string, AccountingRecord>();
  const rules = new Map<string, AccountingRecord>();
  const styles = new Map<string, AccountingRecord>();
  const disclosureTemplates = new Map<string, AccountingRecord>();
  const disclosureSections = new Map<string, AccountingRecord>();
  const disclosureItems = new Map<string, AccountingRecord>();
  const parentGraph = new Map<string, string[]>();
  const dependencyGraph = new Map<string, string[]>();
  const intervalGroups = new Map<string, AccountingRecord[]>();

  const add = (
    severity: ValidationIssue["severity"],
    record: AccountingRecord | undefined,
    message: string,
    field = "",
  ) => {
    issues.push({
      entityKey: record?.entityKey || "",
      field,
      message,
      recordId: record?.recordId || "",
      recordType: record?.recordType || "",
      severity,
    });
  };

  for (const record of records) {
    const uniqueKey = [
      record.recordType,
      record.companyKey,
      record.entityKey,
      record.validFrom,
    ].join("|");
    const duplicate = unique.get(uniqueKey);
    if (duplicate) {
      add(
        "ERROR",
        record,
        `Trùng khóa cấu hình với ${duplicate.entityKey}.`,
      );
    } else {
      unique.set(uniqueKey, record);
    }
    if (!record.displayName) {
      add(
        "ERROR",
        record,
        `${record.recordType} chưa có tên hiển thị.`,
        "displayName",
      );
    }
    if (
      record.validFrom &&
      record.validTo &&
      record.validFrom > record.validTo
    ) {
      add("ERROR", record, "Khoảng hiệu lực không hợp lệ.", "validTo");
    }

    if (record.recordType === "COMPANY") {
      companies.set(record.entityKey, record);
    }
    if (record.recordType === "ACCOUNT") {
      const accounts =
        accountsByCompany.get(record.companyKey) ||
        new Map<string, AccountingRecord>();
      accounts.set(record.displayCode, record);
      accountsByCompany.set(record.companyKey, accounts);
    }
    if (record.recordType === "ACCOUNT_SET") {
      accountSets.set(record.entityKey, record);
    }
    if (record.recordType === "DATA_SOURCE") {
      sources.set(record.entityKey, record);
    }
    if (record.recordType === "REPORT") {
      reports.set(record.entityKey, record);
    }
    if (record.recordType === "REPORT_ROW") {
      rows.set(record.entityKey, record);
    }
    if (record.recordType === "RULE") {
      rules.set(record.entityKey, record);
    }
    if (record.recordType === "STYLE") {
      styles.set(record.entityKey, record);
    }
    if (record.recordType === "DISCLOSURE_TEMPLATE") {
      disclosureTemplates.set(record.entityKey, record);
    }
    if (record.recordType === "DISCLOSURE_SECTION") {
      disclosureSections.set(record.entityKey, record);
    }
    if (record.recordType === "DISCLOSURE_ITEM") {
      disclosureItems.set(record.entityKey, record);
    }

    const data = payload(record);
    let intervalKey = "";
    if (record.recordType === "ACCOUNT") {
      intervalKey = ["ACCOUNT", record.companyKey, record.displayCode].join(
        "|",
      );
    } else if (record.recordType === "ACCOUNT_SET_MEMBER") {
      intervalKey = [
        "ACCOUNT_SET_MEMBER",
        record.companyKey,
        data.accountSetKey,
        data.role,
        data.matchType,
        data.matchValue,
      ].join("|");
    } else if (record.recordType === "OWNERSHIP") {
      intervalKey = [
        "OWNERSHIP",
        data.parentCompanyKey,
        data.childCompanyKey,
      ].join("|");
    }
    if (intervalKey) {
      const intervals = intervalGroups.get(intervalKey) || [];
      intervals.push(record);
      intervalGroups.set(intervalKey, intervals);
    }
  }

  for (const intervals of intervalGroups.values()) {
    intervals.sort((left, right) =>
      intervalValue(left.validFrom, "0000-01-01").localeCompare(
        intervalValue(right.validFrom, "0000-01-01"),
      ),
    );
    let previous: AccountingRecord | undefined;
    for (const record of intervals) {
      if (
        previous &&
        intervalValue(record.validFrom, "0000-01-01") <=
          intervalValue(previous.validTo, "9999-12-31")
      ) {
        add(
          "ERROR",
          record,
          `Khoảng hiệu lực chồng lấn với bản ghi ${previous.entityKey}.`,
        );
      }
      if (
        !previous ||
        intervalValue(record.validTo, "9999-12-31") >
          intervalValue(previous.validTo, "9999-12-31")
      ) {
        previous = record;
      }
    }
  }

  for (const record of records) {
    const data = payload(record);
    if (record.recordType === "SOURCE_FIELD_MAPPING") {
      const sourceKey = normalizeKey(data.sourceKey);
      const companyKey = normalizeKey(data.companyKey);
      if (!sources.has(sourceKey)) {
        add(
          "ERROR",
          record,
          `Ghép cột tham chiếu Mã nguồn không tồn tại: ${sourceKey}.`,
          "sourceKey",
        );
      }
      if (companyKey && companies.size && !companies.has(companyKey)) {
        add(
          "WARNING",
          record,
          `Không tìm thấy công ty trong Module Cấu hình: ${companyKey}.`,
          "companyKey",
        );
      }
    }

    if (record.recordType === "REPORT_COLUMN") {
      const reportKey = normalizeKey(data.reportKey);
      const sourceKey = normalizeKey(data.sourceKey);
      if (!reports.has(reportKey)) {
        add(
          "ERROR",
          record,
          `Cột tham chiếu Mã báo cáo không tồn tại: ${reportKey}.`,
          "reportKey",
        );
      }
      if (sourceKey && !sources.has(sourceKey)) {
        add(
          "ERROR",
          record,
          `Cột tham chiếu Mã nguồn không tồn tại: ${sourceKey}.`,
          "sourceKey",
        );
      }
    }

    if (record.recordType === "ACCOUNT") {
      if (companies.size && !companies.has(record.companyKey)) {
        add(
          "WARNING",
          record,
          `Không tìm thấy công ty ${record.companyKey} trong Module Cấu hình.`,
          "companyKey",
        );
      }
      const parentCode = cleanText(data.parentCode);
      if (
        parentCode &&
        !accountsByCompany.get(record.companyKey)?.has(parentCode)
      ) {
        add(
          "WARNING",
          record,
          `Không tìm thấy tài khoản cha ${parentCode} trong cùng công ty.`,
          "parentCode",
        );
      }
      if (!cleanText(data.logicalAccountKey)) {
        add(
          "WARNING",
          record,
          "Chưa khai báo khóa tài khoản logic; khi đổi mã sẽ cần rà soát kỹ hơn.",
          "logicalAccountKey",
        );
      }
    }

    if (record.recordType === "ACCOUNT_SET_MEMBER") {
      const accountSetKey = normalizeKey(data.accountSetKey);
      const companyKey = normalizeKey(data.companyKey);
      const matchType = normalizeKey(data.matchType);
      const matchValue = cleanText(data.matchValue);
      if (!accountSets.has(accountSetKey)) {
        add(
          "ERROR",
          record,
          `Mã nhóm tài khoản không tồn tại: ${accountSetKey}.`,
          "accountSetKey",
        );
      }
      if (companies.size && !companies.has(companyKey)) {
        add(
          "WARNING",
          record,
          "Công ty đã chọn không còn trong Module Cấu hình.",
          "companyKey",
        );
      }
      const accountCodes = [
        ...(accountsByCompany.get(companyKey)?.keys() || []),
      ];
      const conditions = accountMatchConditions(matchType, matchValue);
      const hasMatch = accountCodes.some((accountCode) =>
        conditions.some((condition) =>
          condition.matchType === "PREFIX"
            ? accountCode.startsWith(condition.value)
            : accountCode === condition.value,
        ),
      );
      if (!hasMatch) {
        add(
          "WARNING",
          record,
          "Ánh xạ chưa khớp tài khoản nào trong danh mục hiện tại.",
          "matchValue",
        );
      }
      if (matchType === "MIXED" && !conditions.length) {
        add(
          "WARNING",
          record,
          "Danh sách hỗn hợp chưa có mã tài khoản hợp lệ.",
          "matchValue",
        );
      }
    }

    if (record.recordType === "REPORT_ROW") {
      const node = record.entityKey;
      const reportKey = normalizeKey(data.reportKey);
      const parentCode = cleanText(data.parentCode);
      const ruleKey = normalizeKey(data.ruleKey);
      parentGraph.set(node, parentGraph.get(node) || []);
      dependencyGraph.set(node, dependencyGraph.get(node) || []);
      if (!reports.has(reportKey)) {
        add(
          "ERROR",
          record,
          `Mã báo cáo không tồn tại: ${reportKey}.`,
          "reportKey",
        );
      }
      if (parentCode) {
        const parentNode = `${reportKey}:${parentCode}`;
        parentGraph.get(node)?.push(parentNode);
        if (!rows.has(parentNode)) {
          add(
            "ERROR",
            record,
            `Không tìm thấy dòng cha ${parentCode}.`,
            "parentCode",
          );
        }
      }
      if (ruleKey && !rules.has(ruleKey)) {
        add(
          "ERROR",
          record,
          `Mã cách tính không tồn tại: ${ruleKey}.`,
          "ruleKey",
        );
      }
      const linkedRule = ruleKey ? rules.get(ruleKey) : undefined;
      if (linkedRule) {
        const linked = payload(linkedRule);
        for (const lineRef of list(linked.lineRefs)) {
          dependencyGraph
            .get(node)
            ?.push(
              lineRef.includes(":") ? lineRef : `${reportKey}:${lineRef}`,
            );
        }
        if (
          normalizeKey(linked.operator) === "CROSS_REPORT" &&
          cleanText(linked.targetReportKey) &&
          cleanText(linked.targetRowCode)
        ) {
          dependencyGraph
            .get(node)
            ?.push(
              `${normalizeKey(linked.targetReportKey)}:${cleanText(linked.targetRowCode)}`,
            );
        }
      }
      const styleKey = normalizeKey(data.styleKey);
      if (styleKey && !styles.has(styleKey)) {
        add(
          "WARNING",
          record,
          `Mã trình bày chưa tồn tại: ${styleKey}.`,
          "styleKey",
        );
      }
    }

    if (record.recordType === "RULE") {
      for (const field of ["accountSetKey", "counterAccountSetKey"] as const) {
        const setKey = normalizeKey(data[field]);
        if (setKey && !accountSets.has(setKey)) {
          add(
            "ERROR",
            record,
            `Cách tính tham chiếu Mã nhóm tài khoản không tồn tại: ${setKey}.`,
            field,
          );
        }
      }
      const sourceKey = normalizeKey(data.sourceKey);
      if (sourceKey && !sources.has(sourceKey)) {
        add(
          "ERROR",
          record,
          `Cách tính tham chiếu Mã nguồn không tồn tại: ${sourceKey}.`,
          "sourceKey",
        );
      }
      const reportKey = normalizeKey(data.reportKey);
      for (const lineRef of list(data.lineRefs)) {
        if (!reportKey && !lineRef.includes(":")) {
          add(
            "WARNING",
            record,
            `Cách tính dùng chung có dòng tham chiếu chưa kèm Mã báo cáo: ${lineRef}.`,
            "lineRefs",
          );
        }
        const node =
          reportKey && !lineRef.includes(":")
            ? `${reportKey}:${lineRef}`
            : lineRef;
        if (node && !rows.has(node)) {
          add(
            "ERROR",
            record,
            `Dòng tham chiếu không tồn tại: ${lineRef}.`,
            "lineRefs",
          );
        }
      }
      if (
        normalizeKey(data.operator) === "CROSS_REPORT" &&
        cleanText(data.targetReportKey) &&
        cleanText(data.targetRowCode)
      ) {
        const targetNode = `${normalizeKey(data.targetReportKey)}:${cleanText(data.targetRowCode)}`;
        if (!rows.has(targetNode)) {
          add(
            "ERROR",
            record,
            `Dòng báo cáo chéo không tồn tại: ${targetNode}.`,
            "targetRowCode",
          );
        }
      }
    }

    if (record.recordType === "DISCLOSURE_SECTION") {
      const templateKey = normalizeKey(data.templateKey);
      if (!disclosureTemplates.has(templateKey)) {
        add(
          "ERROR",
          record,
          `Mẫu thuyết minh cha không tồn tại: ${templateKey}.`,
          "templateKey",
        );
      }
    }

    if (record.recordType === "DISCLOSURE_ITEM") {
      const templateKey = normalizeKey(data.templateKey);
      const sectionKey = `${templateKey}:${normalizeKey(data.sectionKey)}`;
      if (!disclosureTemplates.has(templateKey)) {
        add(
          "ERROR",
          record,
          `Mẫu thuyết minh cha không tồn tại: ${templateKey}.`,
          "templateKey",
        );
      }
      if (!disclosureSections.has(sectionKey)) {
        add(
          "ERROR",
          record,
          `Phần thuyết minh cha không tồn tại: ${sectionKey}.`,
          "sectionKey",
        );
      }
      if (!cleanText(data.formulaPrinciple)) {
        add(
          "WARNING",
          record,
          "Khoản mục chưa giải thích nguyên tắc lấy số và đối chiếu.",
          "formulaPrinciple",
        );
      }
    }

    if (record.recordType === "DISCLOSURE_LINK") {
      const disclosureItemKey = normalizeKey(data.disclosureItemKey);
      const reportKey = normalizeKey(data.reportKey);
      const reportRowCode = cleanText(data.reportRowCode);
      const reportNode = `${reportKey}:${reportRowCode}`;
      if (!disclosureItems.has(disclosureItemKey)) {
        add(
          "ERROR",
          record,
          `Khoản mục thuyết minh nguồn không tồn tại: ${disclosureItemKey}.`,
          "disclosureItemKey",
        );
      }
      const reportRow = rows.get(reportNode);
      if (!reportRow) {
        add(
          "WARNING",
          record,
          `Chưa tìm thấy dòng báo cáo để đối chiếu: ${reportNode}.`,
          "reportRowCode",
        );
      } else if (normalizeKey(data.linkRole) === "PRIMARY_NOTE_REFERENCE") {
        const currentReference = cleanText(reportRow.payload.noteReference).toUpperCase();
        const expectedReference = cleanText(data.noteCode).toUpperCase();
        if (
          currentReference &&
          currentReference !== expectedReference &&
          !currentReference.startsWith(`${expectedReference}.`)
        ) {
          add(
            "WARNING",
            record,
            `Dòng ${reportNode} đang gắn thuyết minh ${currentReference}, khác bản đồ chuẩn ${expectedReference}.`,
            "noteCode",
          );
        }
      }
    }

    if (
      record.recordType === "OWNERSHIP" &&
      companies.size &&
      (!companies.has(normalizeKey(data.parentCompanyKey)) ||
        !companies.has(normalizeKey(data.childCompanyKey)))
    ) {
      add(
        "ERROR",
        record,
        "Không tìm thấy công ty mẹ hoặc công ty con trong Module Cấu hình.",
      );
    }

    if (record.recordType === "REPORT") {
      for (const sourceKeyValue of list(data.sourceKeys)) {
        const sourceKey = normalizeKey(sourceKeyValue);
        if (!sources.has(sourceKey)) {
          add(
            "ERROR",
            record,
            `Báo cáo tham chiếu Mã nguồn không tồn tại: ${sourceKey}.`,
            "sourceKeys",
          );
        }
      }
    }

    if (record.recordType === "ELIMINATION_RULE") {
      for (const field of [
        "debitAccountSetKey",
        "creditAccountSetKey",
      ] as const) {
        const accountSetKey = normalizeKey(data[field]);
        if (accountSetKey && !accountSets.has(accountSetKey)) {
          add(
            "ERROR",
            record,
            `Quy tắc loại trừ tham chiếu Mã nhóm tài khoản không tồn tại: ${accountSetKey}.`,
            field,
          );
        }
      }
    }
  }

  for (const cycle of detectCycles(parentGraph)) {
    add(
      "ERROR",
      rows.get(cycle[0]),
      `Phát hiện vòng lặp trong cây dòng: ${cycle.join(" → ")}.`,
    );
  }
  for (const cycle of detectCycles(dependencyGraph)) {
    add(
      "ERROR",
      rows.get(cycle[0]),
      `Phát hiện vòng lặp trong công thức: ${cycle.join(" → ")}.`,
    );
  }

  const summary = {
    errorCount: issues.filter((issue) => issue.severity === "ERROR").length,
    warningCount: issues.filter((issue) => issue.severity === "WARNING").length,
    infoCount: issues.filter((issue) => issue.severity === "INFO").length,
  };
  return {
    ok: summary.errorCount === 0,
    summary,
    issues,
  };
}

export async function validateAccountingConfigVersion(
  payload: JsonObject,
  actorEmail: string,
) {
  void actorEmail;
  const versionId = cleanText(payload.versionId);
  if (!versionId) {
    throw new AccountingRpcError("Vui lòng chọn phiên bản cần kiểm tra.");
  }
  const records = await readVersionRecords(versionId);
  return {
    ...validateAccountingRecords(records),
    versionId,
    checkedAt: new Date().toISOString(),
  };
}
