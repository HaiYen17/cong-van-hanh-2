import {
  COLUMN_TYPES,
  MAPPING_ROLES,
  MATCH_TYPES,
  OPERATORS,
  RECORD_GROUPS,
  ROW_TYPES,
} from "@/lib/accounting/constants";
import type {
  AccountingRecordType,
  JsonObject,
  RecordInput,
} from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";

const FORBIDDEN_SECRET_FIELDS = new Set([
  "bearer",
  "token",
  "accesstoken",
  "refreshtoken",
  "cookie",
  "password",
  "authorization",
  "apisecret",
  "secretvalue",
]);

const REPORT_CELL_KINDS = new Set([
  "TEXT",
  "TITLE",
  "ACCOUNT_SET",
  "FORMULA",
  "TOTAL",
  "SPACER",
]);
const REPORT_CELL_SIDES = new Set([
  "DEBIT",
  "CREDIT",
  "DEBIT_BALANCE",
  "CREDIT_BALANCE",
  "NET",
]);
const REPORT_CELL_PERIODS = new Set([
  "OPENING",
  "PERIOD",
  "ENDING",
  "YTD",
  "DELTA",
]);
const REPORT_CELL_ALIGNS = new Set(["LEFT", "CENTER", "RIGHT"]);
const REPORT_CELL_BORDERS = new Set([
  "DEFAULT",
  "TOP",
  "BOTTOM",
  "TOP_BOTTOM",
  "OUTLINE",
]);

const NUMBER_FIELDS = [
  "sortOrder",
  "indent",
  "periodOffset",
  "sign",
  "width",
  "fontSize",
  "titleFontSize",
  "mergeColumnSpan",
  "mergeRowSpan",
  "borderWidth",
  "rowHeight",
] as const;

const BOOLEAN_FIELDS = [
  "bold",
  "italic",
  "uppercase",
  "required",
  "noteRequired",
  "hideColumnHeader",
  "hideOnPrint",
] as const;

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function cleanText(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

export function normalizeKey(value: unknown) {
  return cleanText(value).toUpperCase().replaceAll(" ", "_");
}

function normalizeBoolean(value: unknown) {
  if (typeof value === "boolean") {
    return value;
  }
  return ["TRUE", "1", "YES", "Y", "CÓ"].includes(normalizeKey(value));
}

function normalizeTextList(value: unknown, limit = 100) {
  const source = Array.isArray(value)
    ? value
    : cleanText(value)
        .split(/[\n,;]+/)
        .map((item) => item.trim());
  return [...new Set(source.map(cleanText).filter(Boolean))].slice(0, limit);
}

function normalizeIsoDate(value: unknown, label: string) {
  const text = cleanText(value);
  if (!text) {
    return "";
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new AccountingRpcError(`${label} phải có định dạng YYYY-MM-DD.`);
  }
  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== text) {
    throw new AccountingRpcError(`${label} không phải ngày hợp lệ.`);
  }
  return text;
}

export function assertNoSecrets(value: unknown, path = "payload"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecrets(item, `${path}[${index}]`));
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  for (const [field, item] of Object.entries(value)) {
    const normalized = field
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_SECRET_FIELDS.has(normalized) && cleanText(item)) {
      throw new AccountingRpcError(
        `Không được lưu mã truy cập, mật khẩu hoặc cookie trong ${path}.${field}. Chỉ lưu mã tham chiếu bảo mật.`,
      );
    }
    assertNoSecrets(item, `${path}.${field}`);
  }
}

function clampedNumber(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = Number(value);
  return Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(parsed) ? parsed : fallback),
  );
}

export function normalizeReportCells(rawCells: unknown): JsonObject {
  if (!isJsonObject(rawCells)) {
    return {};
  }

  const normalized: JsonObject = {};
  for (const rawColumnKey of Object.keys(rawCells).slice(0, 200)) {
    const columnKey = normalizeKey(rawColumnKey);
    const rawCell = rawCells[rawColumnKey];
    if (!columnKey || !isJsonObject(rawCell)) {
      continue;
    }

    const operator = normalizeKey(rawCell.operator);
    const side = normalizeKey(rawCell.side);
    const periodBasis = normalizeKey(rawCell.periodBasis);
    const contentKind = normalizeKey(rawCell.contentKind || "TEXT");
    const normalizeTerm = (rawTerm: unknown) => {
      const source = isJsonObject(rawTerm) ? rawTerm : {};
      const termOperator = normalizeKey(source.operator);
      const termSide = normalizeKey(source.side);
      const termPeriod = normalizeKey(source.periodBasis);
      return {
        sign: Number(source.sign) < 0 ? -1 : 1,
        metricKey: normalizeKey(source.metricKey),
        operator:
          termOperator &&
          OPERATORS.includes(termOperator as (typeof OPERATORS)[number])
            ? termOperator
            : "",
        side: REPORT_CELL_SIDES.has(termSide) ? termSide : "NET",
        periodBasis: REPORT_CELL_PERIODS.has(termPeriod)
          ? termPeriod
          : ["MOVEMENT", "MOVEMENT_DETAIL", "CASH_MOVEMENT", "PROFIT_LOSS_ACTIVITY"].includes(termOperator)
            ? "PERIOD"
            : "ENDING",
        accountSetKey: normalizeKey(source.accountSetKey),
        counterAccountSetKey: normalizeKey(source.counterAccountSetKey),
        sourceKey: normalizeKey(source.sourceKey),
        datasetType: normalizeKey(source.datasetType),
        conditionKey: normalizeKey(source.conditionKey),
        targetReportKey: normalizeKey(source.targetReportKey),
        targetRowCode: cleanText(source.targetRowCode),
        targetColumnKey: normalizeKey(source.targetColumnKey),
        periodSelector: normalizeKey(source.periodSelector),
        intercompanyMode: normalizeKey(source.intercompanyMode),
        maturityClass: normalizeKey(source.maturityClass),
        excludeClosingEntries:
          source.excludeClosingEntries === undefined
            ? true
            : normalizeBoolean(source.excludeClosingEntries),
        excludeReversals: normalizeBoolean(source.excludeReversals),
        useColumnBasis:
          source.useColumnBasis === undefined
            ? true
            : normalizeBoolean(source.useColumnBasis),
        filters: isJsonObject(source.filters)
          ? structuredClone(source.filters)
          : {},
      } satisfies JsonObject;
    };
    const cell: JsonObject = {
      contentKind: REPORT_CELL_KINDS.has(contentKind) ? contentKind : "TEXT",
      text: cleanText(rawCell.text),
      accountSetKey: normalizeKey(rawCell.accountSetKey),
      counterAccountSetKey: normalizeKey(rawCell.counterAccountSetKey),
      sourceKey: normalizeKey(rawCell.sourceKey),
      datasetType: normalizeKey(rawCell.datasetType),
      metricKey: normalizeKey(rawCell.metricKey),
      operator:
        operator &&
        OPERATORS.includes(operator as (typeof OPERATORS)[number])
          ? operator
          : "",
      side:
        side && !REPORT_CELL_SIDES.has(side)
          ? "NET"
          : side,
      periodBasis:
        periodBasis && !REPORT_CELL_PERIODS.has(periodBasis)
          ? ["MOVEMENT", "MOVEMENT_DETAIL", "CASH_MOVEMENT", "PROFIT_LOSS_ACTIVITY"].includes(operator)
            ? "PERIOD"
            : "ENDING"
          : periodBasis,
      expression: cleanText(rawCell.expression),
      conditionKey: normalizeKey(rawCell.conditionKey),
      targetReportKey: normalizeKey(rawCell.targetReportKey),
      targetRowCode: cleanText(rawCell.targetRowCode),
      targetColumnKey: normalizeKey(rawCell.targetColumnKey),
      periodSelector: normalizeKey(rawCell.periodSelector),
      intercompanyMode: normalizeKey(rawCell.intercompanyMode),
      maturityClass: normalizeKey(rawCell.maturityClass),
      useColumnBasis:
        rawCell.useColumnBasis === undefined
          ? true
          : normalizeBoolean(rawCell.useColumnBasis),
      filters: isJsonObject(rawCell.filters)
        ? structuredClone(rawCell.filters)
        : {},
      mergeColumnSpan: clampedNumber(rawCell.mergeColumnSpan || 1, 1, 1, 20),
      mergeRowSpan: clampedNumber(rawCell.mergeRowSpan || 1, 1, 1, 100),
      terms: (Array.isArray(rawCell.terms) ? rawCell.terms : [])
        .slice(0, 50)
        .map(normalizeTerm),
    };

    const formulaOrigin = normalizeKey(rawCell.formulaOrigin);
    if (["USER_DEFINED", "DISCLOSURE_LINK_DEFAULT"].includes(formulaOrigin)) {
      cell.formulaOrigin = formulaOrigin;
    }
    if (Array.isArray(rawCell.defaultTerms)) {
      cell.defaultTerms = rawCell.defaultTerms.slice(0, 50).map(normalizeTerm);
    }

    for (const key of ["bold", "italic", "uppercase"] as const) {
      if (Object.hasOwn(rawCell, key)) {
        cell[key] = normalizeBoolean(rawCell[key]);
      }
    }
    if (Object.hasOwn(rawCell, "align")) {
      const align = normalizeKey(rawCell.align || "LEFT");
      cell.align = REPORT_CELL_ALIGNS.has(align) ? align : "LEFT";
    }
    if (Object.hasOwn(rawCell, "fontSize")) {
      cell.fontSize = clampedNumber(rawCell.fontSize || 12, 12, 8, 32);
    }
    for (const key of ["textColor", "fillColor", "numberFormat"] as const) {
      if (Object.hasOwn(rawCell, key)) {
        cell[key] = cleanText(rawCell[key]);
      }
    }
    for (
      const key of [
        "formulaRequired",
        "sourceFormulaRemoved",
        "excludeClosingEntries",
        "excludeReversals",
      ] as const
    ) {
      if (Object.hasOwn(rawCell, key)) {
        cell[key] = normalizeBoolean(rawCell[key]);
      }
    }
    for (
      const key of ["sourceCell", "sourceNote", "suggestedMetricKey"] as const
    ) {
      if (Object.hasOwn(rawCell, key)) {
        cell[key] = cleanText(rawCell[key]);
      }
    }
    if (Object.hasOwn(rawCell, "borderPreset")) {
      const borderPreset = normalizeKey(rawCell.borderPreset || "DEFAULT");
      cell.borderPreset = REPORT_CELL_BORDERS.has(borderPreset)
        ? borderPreset
        : "DEFAULT";
    }
    if (Object.hasOwn(rawCell, "borderWidth")) {
      cell.borderWidth = clampedNumber(rawCell.borderWidth || 3, 3, 2, 4);
    }

    normalized[columnKey] = cell;
  }
  return normalized;
}

function required(value: unknown, message: string) {
  if (!cleanText(value)) {
    throw new AccountingRpcError(message);
  }
}

function normalizeNumber(payload: JsonObject, field: string) {
  const value = payload[field];
  if (value === "" || value === null || value === undefined) {
    return;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new AccountingRpcError(`${field} phải là số hợp lệ.`);
  }
  payload[field] = parsed;
}

export function normalizeRecordPayload(
  recordType: AccountingRecordType,
  rawPayload: JsonObject,
) {
  const payload = structuredClone(rawPayload);
  assertNoSecrets(payload);

  for (const field of NUMBER_FIELDS) {
    normalizeNumber(payload, field);
  }
  for (const field of BOOLEAN_FIELDS) {
    if (payload[field] !== null && payload[field] !== undefined) {
      payload[field] = normalizeBoolean(payload[field]);
    }
  }

  if (payload.borderPreset) {
    const preset = normalizeKey(payload.borderPreset);
    payload.borderPreset = [
      "DEFAULT",
      "TOP",
      "BOTTOM",
      "TOP_BOTTOM",
      "OUTLINE",
    ].includes(preset)
      ? preset
      : "DEFAULT";
  }
  if (payload.borderWidth !== "" && payload.borderWidth != null) {
    payload.borderWidth = Math.max(
      2,
      Math.min(4, Number(payload.borderWidth || 3)),
    );
  }

  payload.validFrom = normalizeIsoDate(payload.validFrom, "Hiệu lực từ");
  payload.validTo = normalizeIsoDate(payload.validTo, "Hiệu lực đến");
  if (
    cleanText(payload.validFrom) &&
    cleanText(payload.validTo) &&
    cleanText(payload.validFrom) > cleanText(payload.validTo)
  ) {
    throw new AccountingRpcError(
      "Hiệu lực đến phải bằng hoặc sau Hiệu lực từ.",
    );
  }

  switch (recordType) {
    case "COMPANY":
      payload.companyKey = normalizeKey(payload.companyKey);
      required(
        payload.companyKey,
        "Công ty phải có Mã công ty và Tên công ty.",
      );
      required(
        payload.companyName,
        "Công ty phải có Mã công ty và Tên công ty.",
      );
      break;
    case "ACCOUNT":
      payload.companyKey = normalizeKey(payload.companyKey);
      payload.accountCode = cleanText(payload.accountCode);
      required(
        payload.companyKey,
        "Tài khoản phải có Công ty, Mã tài khoản và Tên tài khoản.",
      );
      required(
        payload.accountCode,
        "Tài khoản phải có Công ty, Mã tài khoản và Tên tài khoản.",
      );
      required(
        payload.accountName,
        "Tài khoản phải có Công ty, Mã tài khoản và Tên tài khoản.",
      );
      payload.logicalAccountKey = normalizeKey(
        payload.logicalAccountKey ||
          `ACCOUNT_${payload.companyKey}_${payload.accountCode}`,
      );
      break;
    case "ACCOUNT_SET":
      payload.accountSetKey = normalizeKey(
        payload.accountSetKey || payload.setKey || payload.accountSetName,
      );
      required(
        payload.accountSetKey,
        "Nhóm tài khoản phải có Mã nhóm và Tên nhóm.",
      );
      required(
        payload.accountSetName,
        "Nhóm tài khoản phải có Mã nhóm và Tên nhóm.",
      );
      break;
    case "ACCOUNT_SET_MEMBER":
      payload.accountSetKey = normalizeKey(
        payload.accountSetKey || payload.setKey,
      );
      payload.companyKey = normalizeKey(payload.companyKey);
      payload.matchType = normalizeKey(payload.matchType || "EXACT");
      payload.role = normalizeKey(payload.role || "INCLUDE");
      payload.matchValue = cleanText(
        payload.matchValue || payload.accountCode,
      );
      if (
        !cleanText(payload.accountSetKey) ||
        !cleanText(payload.companyKey) ||
        !cleanText(payload.matchValue)
      ) {
        throw new AccountingRpcError(
          "Ánh xạ nhóm phải có Nhóm logic, Công ty và Mã/tiền tố tài khoản.",
        );
      }
      if (
        !MATCH_TYPES.includes(
          payload.matchType as (typeof MATCH_TYPES)[number],
        )
      ) {
        throw new AccountingRpcError(
          "Cách chọn chỉ hỗ trợ “Đúng mã”, “Theo đầu mã” hoặc “Danh sách hỗn hợp”.",
        );
      }
      if (
        !MAPPING_ROLES.includes(
          payload.role as (typeof MAPPING_ROLES)[number],
        )
      ) {
        throw new AccountingRpcError(
          "Vai trò gán tài khoản chỉ hỗ trợ Bao gồm, Loại trừ hoặc Tài khoản đối ứng.",
        );
      }
      break;
    case "DATA_SOURCE":
      payload.sourceKey = normalizeKey(
        payload.sourceKey || payload.sourceName,
      );
      payload.sourceType = normalizeKey(payload.sourceType);
      if (
        !cleanText(payload.sourceKey) ||
        !cleanText(payload.sourceName) ||
        !cleanText(payload.sourceType)
      ) {
        throw new AccountingRpcError(
          "Nguồn dữ liệu phải có Mã nguồn, Tên nguồn và Loại nguồn.",
        );
      }
      break;
    case "SOURCE_FIELD_MAPPING":
      payload.sourceKey = normalizeKey(payload.sourceKey);
      payload.companyKey = normalizeKey(payload.companyKey);
      payload.canonicalField = cleanText(payload.canonicalField).toLowerCase();
      payload.dataType = normalizeKey(payload.dataType || "STRING");
      payload.required = normalizeBoolean(payload.required);
      if (
        !cleanText(payload.sourceKey) ||
        !cleanText(payload.canonicalField) ||
        !cleanText(payload.sourceField)
      ) {
        throw new AccountingRpcError(
          "Ghép cột dữ liệu phải có Mã nguồn, Trường chuẩn và Cột hoặc đường dẫn ở nguồn.",
        );
      }
      break;
    case "REPORT":
      payload.reportKey = normalizeKey(
        payload.reportKey || payload.reportName,
      );
      payload.reportType = normalizeKey(payload.reportType || "MANAGEMENT");
      payload.displayTitle = cleanText(
        payload.displayTitle || payload.reportName,
      );
      payload.hideColumnHeader = normalizeBoolean(payload.hideColumnHeader);
      if (!cleanText(payload.reportKey) || !cleanText(payload.reportName)) {
        throw new AccountingRpcError(
          "Báo cáo phải có Mã báo cáo và Tên báo cáo.",
        );
      }
      break;
    case "REPORT_COLUMN":
      payload.reportKey = normalizeKey(payload.reportKey);
      payload.columnKey = normalizeKey(
        payload.columnKey || payload.columnLabel,
      );
      payload.columnType = normalizeKey(
        payload.columnType || "CURRENT_PERIOD",
      );
      payload.headerGroup = cleanText(payload.headerGroup);
      if (
        !cleanText(payload.reportKey) ||
        !cleanText(payload.columnKey) ||
        !cleanText(payload.columnLabel)
      ) {
        throw new AccountingRpcError(
          "Cột báo cáo phải có Mã báo cáo, Mã cột và Tên cột.",
        );
      }
      if (
        !COLUMN_TYPES.includes(
          payload.columnType as (typeof COLUMN_TYPES)[number],
        )
      ) {
        throw new AccountingRpcError(
          `Loại cột chưa được hỗ trợ: ${payload.columnType}.`,
        );
      }
      break;
    case "REPORT_ROW":
      payload.reportKey = normalizeKey(payload.reportKey);
      payload.rowCode = cleanText(payload.rowCode);
      payload.parentCode = cleanText(payload.parentCode);
      payload.rowType = normalizeKey(payload.rowType || "DATA");
      payload.displayCode = cleanText(
        payload.displayCode || payload.rowCode,
      );
      payload.noteReference = cleanText(payload.noteReference);
      payload.noteItemId = cleanText(payload.noteItemId).toLowerCase();
      payload.noteRequired =
        Boolean(payload.noteItemId) && normalizeBoolean(payload.noteRequired);
      payload.cells = normalizeReportCells(payload.cells);
      if (
        !cleanText(payload.reportKey) ||
        !cleanText(payload.rowCode) ||
        !cleanText(payload.rowLabel)
      ) {
        throw new AccountingRpcError(
          "Dòng báo cáo phải có Mã báo cáo, Mã dòng và Nội dung dòng.",
        );
      }
      if (
        !ROW_TYPES.includes(payload.rowType as (typeof ROW_TYPES)[number])
      ) {
        throw new AccountingRpcError(
          `Loại dòng chưa được hỗ trợ: ${payload.rowType}.`,
        );
      }
      break;
    case "RULE":
      payload.ruleKey = normalizeKey(payload.ruleKey || payload.ruleName);
      payload.operator = normalizeKey(payload.operator);
      if (
        !cleanText(payload.ruleKey) ||
        !cleanText(payload.ruleName) ||
        !cleanText(payload.operator)
      ) {
        throw new AccountingRpcError(
          "Cách tính phải có Tên và Phép tính.",
        );
      }
      if (
        !OPERATORS.includes(payload.operator as (typeof OPERATORS)[number])
      ) {
        throw new AccountingRpcError(
          `Phép tính chưa được hỗ trợ: ${payload.operator}.`,
        );
      }
      break;
    case "STYLE":
      payload.styleKey = normalizeKey(payload.styleKey || payload.styleName);
      if (!cleanText(payload.styleKey) || !cleanText(payload.styleName)) {
        throw new AccountingRpcError(
          "Kiểu trình bày phải có Mã trình bày và Tên trình bày.",
        );
      }
      break;
    case "DISCLOSURE_TEMPLATE":
      payload.templateKey = normalizeKey(
        payload.templateKey || payload.templateCode || payload.templateName,
      );
      payload.templateCode = cleanText(payload.templateCode || "B09-DN");
      payload.templateKind = normalizeKey(
        payload.templateKind || "FINANCIAL_STATEMENT_NOTES",
      );
      payload.standardCode = cleanText(payload.standardCode);
      payload.sourceSheet = cleanText(payload.sourceSheet);
      if (!cleanText(payload.templateKey) || !cleanText(payload.templateName)) {
        throw new AccountingRpcError(
          "Mẫu thuyết minh phải có mã mẫu và tên mẫu.",
        );
      }
      break;
    case "DISCLOSURE_SECTION":
      payload.templateKey = normalizeKey(payload.templateKey);
      payload.sectionKey = normalizeKey(
        payload.sectionKey || payload.sectionCode || payload.sectionTitle,
      );
      payload.sectionCode = cleanText(payload.sectionCode);
      payload.sectionTitle = cleanText(payload.sectionTitle);
      if (
        !cleanText(payload.templateKey) ||
        !cleanText(payload.sectionKey) ||
        !cleanText(payload.sectionTitle)
      ) {
        throw new AccountingRpcError(
          "Phần thuyết minh phải có mẫu cha, mã phần và tên phần.",
        );
      }
      if (!Array.isArray(payload.cells)) payload.cells = [];
      if (!Array.isArray(payload.blocks)) payload.blocks = [];
      if (!Array.isArray(payload.rowHeights)) payload.rowHeights = [];
      break;
    case "DISCLOSURE_ITEM":
      payload.templateKey = normalizeKey(payload.templateKey);
      payload.sectionKey = normalizeKey(payload.sectionKey);
      payload.itemKey = normalizeKey(
        payload.itemKey || `${payload.templateKey}:${payload.noteCode}`,
      );
      payload.noteCode = cleanText(payload.noteCode).toUpperCase();
      payload.noteTitle = cleanText(payload.noteTitle);
      payload.detectedTitle = cleanText(payload.detectedTitle);
      payload.automationLevel = normalizeKey(payload.automationLevel || "MANUAL");
      payload.sourceStrategy = normalizeKey(payload.sourceStrategy);
      payload.reconciliationMode = normalizeKey(payload.reconciliationMode);
      payload.confidence = normalizeKey(payload.confidence || "REVIEW");
      payload.noteOrdinal = Number(payload.noteOrdinal || 0);
      payload.startRow = Number(payload.startRow || 0);
      payload.endRow = Number(payload.endRow || payload.startRow || 0);
      payload.sampleNumberCount = Number(payload.sampleNumberCount || 0);
      payload.reportLinkCount = Number(payload.reportLinkCount || 0);
      payload.sourceDatasets = normalizeTextList(payload.sourceDatasets).map(
        normalizeKey,
      );
      payload.periodBasis = normalizeTextList(payload.periodBasis).map(
        normalizeKey,
      );
      payload.dimensions = normalizeTextList(payload.dimensions).map(normalizeKey);
      payload.requiredCanonicalFields = normalizeTextList(
        payload.requiredCanonicalFields,
      ).map((item) => item.toLowerCase());
      payload.reviewRequirements = normalizeTextList(payload.reviewRequirements);
      payload.formulaPrinciple = cleanText(payload.formulaPrinciple);
      payload.sourceRef = cleanText(payload.sourceRef);
      if (
        !cleanText(payload.templateKey) ||
        !cleanText(payload.itemKey) ||
        !cleanText(payload.noteCode) ||
        !cleanText(payload.noteTitle)
      ) {
        throw new AccountingRpcError(
          "Khoản mục thuyết minh phải có mẫu cha, mã khoản mục và tên khoản mục.",
        );
      }
      if (!["AUTOMATIC", "ASSISTED", "MANUAL"].includes(cleanText(payload.automationLevel))) {
        throw new AccountingRpcError(
          `Mức tự động hóa thuyết minh chưa được hỗ trợ: ${payload.automationLevel}.`,
        );
      }
      if (Number(payload.startRow) <= 0 || Number(payload.endRow) < Number(payload.startRow)) {
        throw new AccountingRpcError("Khoảng dòng của khoản mục thuyết minh không hợp lệ.");
      }
      break;
    case "DISCLOSURE_LINK":
      payload.templateKey = normalizeKey(payload.templateKey);
      payload.disclosureItemKey = normalizeKey(payload.disclosureItemKey);
      payload.linkKey = normalizeKey(
        payload.linkKey ||
          [
            payload.templateKey,
            payload.noteCode,
            payload.reportKey,
            payload.reportRowCode,
          ]
            .map(normalizeKey)
            .join(":"),
      );
      payload.noteCode = cleanText(payload.noteCode).toUpperCase();
      payload.reportKey = normalizeKey(payload.reportKey);
      payload.reportRowCode = cleanText(payload.reportRowCode);
      payload.reportRowLabel = cleanText(payload.reportRowLabel);
      payload.reportRowRecordId = cleanText(payload.reportRowRecordId);
      payload.linkRole = normalizeKey(payload.linkRole || "RECONCILIATION_ONLY");
      payload.aggregationRole = normalizeKey(
        payload.aggregationRole ||
          (payload.linkRole === "PRIMARY_NOTE_REFERENCE"
            ? "ADDITIVE"
            : "REFERENCE_ONLY"),
      );
      payload.reconciliationMode = normalizeKey(payload.reconciliationMode);
      payload.resolutionStatus = normalizeKey(payload.resolutionStatus || "MISSING_REPORT_ROW");
      payload.confidence = normalizeKey(payload.confidence || "REVIEW");
      if (
        !cleanText(payload.templateKey) ||
        !cleanText(payload.disclosureItemKey) ||
        !cleanText(payload.linkKey) ||
        !cleanText(payload.reportKey) ||
        !cleanText(payload.reportRowCode)
      ) {
        throw new AccountingRpcError(
          "Liên kết thuyết minh phải có khoản mục nguồn và dòng báo cáo đích.",
        );
      }
      if (
        !["ADDITIVE", "SUBSET_DETAIL", "REFERENCE_ONLY"].includes(
          cleanText(payload.aggregationRole),
        )
      ) {
        throw new AccountingRpcError(
          `Cách cộng dòng thuyết minh chưa được hỗ trợ: ${payload.aggregationRole}.`,
        );
      }
      break;
    case "OWNERSHIP":
      payload.parentCompanyKey = normalizeKey(payload.parentCompanyKey);
      payload.childCompanyKey = normalizeKey(payload.childCompanyKey);
      payload.ownershipPercent = Number(payload.ownershipPercent || 0);
      payload.controlPercent = Number(payload.controlPercent || 0);
      if (
        !cleanText(payload.parentCompanyKey) ||
        !cleanText(payload.childCompanyKey) ||
        payload.parentCompanyKey === payload.childCompanyKey
      ) {
        throw new AccountingRpcError(
          "Quan hệ sở hữu phải có công ty mẹ và công ty con khác nhau.",
        );
      }
      if (
        Number(payload.ownershipPercent) < 0 ||
        Number(payload.ownershipPercent) > 100 ||
        Number(payload.controlPercent) < 0 ||
        Number(payload.controlPercent) > 100
      ) {
        throw new AccountingRpcError(
          "Tỷ lệ sở hữu và quyền kiểm soát phải nằm trong khoảng 0-100%.",
        );
      }
      break;
    case "ELIMINATION_RULE":
      payload.ruleKey = normalizeKey(payload.ruleKey || payload.ruleName);
      payload.eliminationType = normalizeKey(payload.eliminationType);
      if (
        !cleanText(payload.ruleKey) ||
        !cleanText(payload.ruleName) ||
        !cleanText(payload.eliminationType)
      ) {
        throw new AccountingRpcError(
          "Quy tắc loại trừ phải có Mã quy tắc, Tên quy tắc và Loại loại trừ.",
        );
      }
      break;
  }

  payload.status = normalizeKey(payload.status || "ACTIVE");
  return payload;
}

export function parseRecordInput(value: unknown): RecordInput {
  if (!isJsonObject(value)) {
    throw new AccountingRpcError("Bản ghi cấu hình không hợp lệ.");
  }
  const recordType = normalizeKey(value.recordType) as AccountingRecordType;
  if (!(recordType in RECORD_GROUPS)) {
    throw new AccountingRpcError(
      `Loại cấu hình chưa được hỗ trợ: ${recordType || "(trống)"}.`,
    );
  }
  if (!isJsonObject(value.payload)) {
    throw new AccountingRpcError("Payload bản ghi cấu hình không hợp lệ.");
  }
  return {
    payload: value.payload,
    recordId: cleanText(value.recordId),
    recordType,
  };
}

export function recordMeta(
  recordType: AccountingRecordType,
  payload: JsonObject,
) {
  const validFrom = cleanText(payload.validFrom);
  const openFrom = validFrom || "OPEN";
  const base = {
    companyKey: normalizeKey(payload.companyKey),
    displayCode: "",
    displayName: "",
    entityKey: "",
    parentKey: "",
    sortOrder: Number(payload.sortOrder || 0),
    status: normalizeKey(payload.status) === "INACTIVE" ? "Vô hiệu" : "Kích hoạt",
    validFrom,
    validTo: cleanText(payload.validTo),
  };

  switch (recordType) {
    case "COMPANY":
      return {
        ...base,
        companyKey: normalizeKey(payload.companyKey),
        displayCode: normalizeKey(payload.companyKey),
        displayName: cleanText(payload.companyName),
        entityKey: normalizeKey(payload.companyKey),
      };
    case "ACCOUNT":
      return {
        ...base,
        displayCode: cleanText(payload.accountCode),
        displayName: cleanText(payload.accountName),
        entityKey: `${normalizeKey(payload.companyKey)}:${cleanText(payload.accountCode)}:${openFrom}`,
        parentKey: cleanText(payload.parentCode),
      };
    case "ACCOUNT_SET":
      return {
        ...base,
        companyKey: "",
        displayCode: normalizeKey(payload.accountSetKey),
        displayName: cleanText(payload.accountSetName),
        entityKey: normalizeKey(payload.accountSetKey),
      };
    case "ACCOUNT_SET_MEMBER":
      return {
        ...base,
        displayCode: cleanText(payload.matchValue),
        displayName: `${normalizeKey(payload.accountSetKey)} · ${normalizeKey(payload.role)} · ${normalizeKey(payload.matchType)}`,
        entityKey: [
          payload.accountSetKey,
          payload.companyKey,
          payload.role,
          payload.matchType,
          payload.matchValue,
          openFrom,
        ]
          .map(normalizeKey)
          .join(":"),
        parentKey: normalizeKey(payload.accountSetKey),
      };
    case "DATA_SOURCE":
      return {
        ...base,
        companyKey: "",
        displayCode: normalizeKey(payload.sourceKey),
        displayName: cleanText(payload.sourceName),
        entityKey: normalizeKey(payload.sourceKey),
      };
    case "SOURCE_FIELD_MAPPING":
      return {
        ...base,
        companyKey: normalizeKey(payload.companyKey),
        displayCode: cleanText(payload.canonicalField),
        displayName: cleanText(payload.sourceField),
        entityKey: [
          normalizeKey(payload.sourceKey),
          normalizeKey(payload.companyKey) || "ALL",
          cleanText(payload.canonicalField).toLowerCase(),
        ].join(":"),
        parentKey: normalizeKey(payload.sourceKey),
      };
    case "REPORT":
      return {
        ...base,
        companyKey: "",
        displayCode: normalizeKey(payload.reportKey),
        displayName: cleanText(payload.reportName),
        entityKey: normalizeKey(payload.reportKey),
      };
    case "REPORT_COLUMN":
      return {
        ...base,
        displayCode: normalizeKey(payload.columnKey),
        displayName: cleanText(payload.columnLabel),
        entityKey: `${normalizeKey(payload.reportKey)}:${normalizeKey(payload.columnKey)}`,
        parentKey: normalizeKey(payload.reportKey),
      };
    case "REPORT_ROW":
      return {
        ...base,
        companyKey: "",
        displayCode: cleanText(payload.displayCode || payload.rowCode),
        displayName: cleanText(payload.rowLabel),
        entityKey: `${normalizeKey(payload.reportKey)}:${cleanText(payload.rowCode)}`,
        parentKey: cleanText(payload.parentCode)
          ? `${normalizeKey(payload.reportKey)}:${cleanText(payload.parentCode)}`
          : normalizeKey(payload.reportKey),
      };
    case "RULE":
      return {
        ...base,
        companyKey: "",
        displayCode: normalizeKey(payload.ruleKey),
        displayName: cleanText(payload.ruleName || payload.operator),
        entityKey: normalizeKey(payload.ruleKey),
      };
    case "STYLE":
      return {
        ...base,
        companyKey: "",
        displayCode: normalizeKey(payload.styleKey),
        displayName: cleanText(payload.styleName),
        entityKey: normalizeKey(payload.styleKey),
      };
    case "DISCLOSURE_TEMPLATE":
      return {
        ...base,
        companyKey: "",
        displayCode: cleanText(payload.templateCode || payload.templateKey),
        displayName: cleanText(payload.templateName),
        entityKey: normalizeKey(payload.templateKey),
      };
    case "DISCLOSURE_SECTION":
      return {
        ...base,
        companyKey: "",
        displayCode: cleanText(payload.sectionCode || payload.sectionKey),
        displayName: cleanText(payload.sectionTitle),
        entityKey: `${normalizeKey(payload.templateKey)}:${normalizeKey(payload.sectionKey)}`,
        parentKey: normalizeKey(payload.templateKey),
      };
    case "DISCLOSURE_ITEM":
      return {
        ...base,
        companyKey: "",
        displayCode: cleanText(payload.noteCode),
        displayName: cleanText(payload.noteTitle),
        entityKey: normalizeKey(payload.itemKey),
        parentKey: `${normalizeKey(payload.templateKey)}:${normalizeKey(payload.sectionKey)}`,
      };
    case "DISCLOSURE_LINK":
      return {
        ...base,
        companyKey: "",
        displayCode: `${cleanText(payload.noteCode)} → ${cleanText(payload.reportRowCode)}`,
        displayName:
          cleanText(payload.reportRowLabel) ||
          `${normalizeKey(payload.reportKey)} · ${cleanText(payload.reportRowCode)}`,
        entityKey: normalizeKey(payload.linkKey),
        parentKey: normalizeKey(payload.disclosureItemKey),
      };
    case "OWNERSHIP":
      return {
        ...base,
        companyKey: normalizeKey(payload.childCompanyKey),
        displayCode: `${normalizeKey(payload.parentCompanyKey)} → ${normalizeKey(payload.childCompanyKey)}`,
        displayName: `Sở hữu ${Number(payload.ownershipPercent || 0)}%`,
        entityKey: `${normalizeKey(payload.parentCompanyKey)}:${normalizeKey(payload.childCompanyKey)}:${openFrom}`,
        parentKey: normalizeKey(payload.parentCompanyKey),
      };
    case "ELIMINATION_RULE":
      return {
        ...base,
        companyKey: "",
        displayCode: normalizeKey(payload.ruleKey),
        displayName: cleanText(payload.ruleName),
        entityKey: normalizeKey(payload.ruleKey),
      };
  }
}
