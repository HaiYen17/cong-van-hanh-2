import { cleanText, normalizeKey } from "@/lib/accounting/normalize";
import type {
  AccountingRecord,
  AccountingRecordType,
  JsonObject,
} from "@/lib/accounting/types";

export const DISCLOSURE_REPORT_KEY = "B09_DN_TT99";

export type DisclosureReportRecord = {
  payload: JsonObject;
  recordType: AccountingRecordType;
  sourceRow: number;
  sourceSheet: string;
};

type DisclosureSourceRecord = {
  entityKey?: string;
  payload: JsonObject;
  recordType: AccountingRecordType;
  sortOrder?: number;
  sourceRow?: number;
  sourceSheet?: string;
};

function payloadOf(value: { payload?: JsonObject }) {
  return value.payload || {};
}

function recordKey(value: { entityKey?: string; payload?: JsonObject }) {
  const payload = payloadOf(value);
  return normalizeKey(payload.rowCode || value.entityKey);
}

function isNumericDisclosureItem(payload: JsonObject) {
  const periods = Array.isArray(payload.periodBasis)
    ? payload.periodBasis.map(normalizeKey)
    : [];
  const sources = Array.isArray(payload.sourceDatasets)
    ? payload.sourceDatasets.map(normalizeKey)
    : [];
  return (
    periods.some((value) => value !== "REPORTING_PERIOD") ||
    sources.some((value) =>
      [
        "TRIAL_BALANCE",
        "GENERAL_LEDGER",
        "GENERAL_JOURNAL",
        "TAX_SCHEDULE",
      ].includes(value),
    )
  );
}

function defaultCrossReportTerms(
  links: Array<{ payload?: JsonObject }>,
  itemKey: string,
) {
  const seen = new Set<string>();
  return links
    .map(payloadOf)
    .filter(
      (payload) =>
        normalizeKey(payload.disclosureItemKey) === itemKey &&
        normalizeKey(payload.aggregationRole || "REFERENCE_ONLY") === "ADDITIVE" &&
        normalizeKey(payload.resolutionStatus || "MISSING_REPORT_ROW") === "RESOLVED",
    )
    .map<JsonObject | null>((payload) => {
      const targetReportKey = normalizeKey(payload.reportKey);
      const targetRowCode = cleanText(payload.reportRowCode);
      const key = `${targetReportKey}:${targetRowCode}`;
      if (!targetReportKey || !targetRowCode || seen.has(key)) return null;
      seen.add(key);
      return {
        operator: "CROSS_REPORT",
        sign: 1,
        targetReportKey,
        targetRowCode,
      } satisfies JsonObject;
    })
    .filter((value): value is JsonObject => value !== null);
}

function configuredCell(
  existingCell: unknown,
  defaultTerms: JsonObject[],
  numeric: boolean,
) {
  const current =
    existingCell && typeof existingCell === "object" && !Array.isArray(existingCell)
      ? ({ ...(existingCell as JsonObject) } satisfies JsonObject)
      : {};
  const hasUserFormula =
    normalizeKey(current.formulaOrigin) === "USER_DEFINED" ||
    (normalizeKey(current.formulaOrigin) !== "DISCLOSURE_LINK_DEFAULT" &&
      (Boolean(cleanText(current.accountSetKey)) ||
        Boolean(cleanText(current.expression)) ||
        (Array.isArray(current.terms) && current.terms.length > 0)));
  if (hasUserFormula) {
    const contentKind = normalizeKey(current.contentKind);
    return {
      ...current,
      contentKind:
        !contentKind || contentKind === "TEXT"
          ? cleanText(current.expression)
            ? "FORMULA"
            : "ACCOUNT_SET"
          : current.contentKind,
      defaultTerms,
      formulaRequired: current.formulaRequired === true,
    } satisfies JsonObject;
  }
  if (!numeric) {
    return {
      ...current,
      contentKind: "TEXT",
      formulaRequired: false,
      text: cleanText(current.text),
    } satisfies JsonObject;
  }
  return {
    ...current,
    contentKind: "ACCOUNT_SET",
    defaultTerms,
    formulaOrigin: "DISCLOSURE_LINK_DEFAULT",
    formulaRequired: defaultTerms.length === 0,
    terms: defaultTerms,
  } satisfies JsonObject;
}

export function buildAccountingDisclosureReportRecords(
  disclosureRecords: DisclosureSourceRecord[],
  currentRecords: AccountingRecord[] = [],
) {
  const templateRecord = disclosureRecords.find(
    (record) =>
      record.recordType === "DISCLOSURE_TEMPLATE" &&
      normalizeKey(payloadOf(record).templateKey || record.entityKey) ===
        DISCLOSURE_REPORT_KEY,
  );
  const template = templateRecord ? payloadOf(templateRecord) : {};
  const items = disclosureRecords
    .filter(
      (record) =>
        record.recordType === "DISCLOSURE_ITEM" &&
        normalizeKey(payloadOf(record).templateKey) === DISCLOSURE_REPORT_KEY,
    )
    .sort(
      (left, right) =>
        Number(payloadOf(left).startRow || left.sortOrder || 0) -
        Number(payloadOf(right).startRow || right.sortOrder || 0),
    );
  const links = disclosureRecords.filter(
    (record) => record.recordType === "DISCLOSURE_LINK",
  );
  const existingRows = new Map(
    currentRecords
      .filter(
        (record) =>
          record.recordType === "REPORT_ROW" &&
          normalizeKey(record.payload.reportKey) === DISCLOSURE_REPORT_KEY,
      )
      .map((record) => [recordKey(record), record]),
  );
  const sourceSheet = cleanText(template.sourceSheet || "B09-DN");
  const reportName = cleanText(
    template.templateName || "B09-DN · Bản thuyết minh Báo cáo tài chính",
  );

  const records: DisclosureReportRecord[] = [
    {
      payload: {
        displayTitle: cleanText(
          template.displayTitle || "BẢN THUYẾT MINH BÁO CÁO TÀI CHÍNH",
        ),
        hideColumnHeader: false,
        layoutMode: "DISCLOSURE_TEMPLATE",
        managedByDisclosureTemplate: true,
        reportKey: DISCLOSURE_REPORT_KEY,
        reportName,
        reportType: "DISCLOSURE",
        status: "ACTIVE",
      },
      recordType: "REPORT",
      sourceRow: 1,
      sourceSheet,
    },
    {
      payload: {
        align: "LEFT",
        columnKey: "CHI_TIEU",
        columnLabel: "Khoản mục thuyết minh",
        columnType: "LABEL",
        reportKey: DISCLOSURE_REPORT_KEY,
        sortOrder: 10,
        status: "ACTIVE",
        width: 58,
      },
      recordType: "REPORT_COLUMN",
      sourceRow: 1,
      sourceSheet,
    },
    {
      payload: {
        align: "CENTER",
        columnKey: "MA_SO",
        columnLabel: "Mã",
        columnType: "ROW_CODE",
        reportKey: DISCLOSURE_REPORT_KEY,
        sortOrder: 20,
        status: "ACTIVE",
        width: 14,
      },
      recordType: "REPORT_COLUMN",
      sourceRow: 1,
      sourceSheet,
    },
    {
      payload: {
        align: "RIGHT",
        columnKey: "NAM_NAY",
        columnLabel: "Năm nay",
        columnType: "CURRENT_PERIOD",
        periodOffset: 0,
        reportKey: DISCLOSURE_REPORT_KEY,
        sortOrder: 30,
        status: "ACTIVE",
        valueBasis: "ENDING",
        width: 18,
      },
      recordType: "REPORT_COLUMN",
      sourceRow: 1,
      sourceSheet,
    },
    {
      payload: {
        align: "RIGHT",
        columnKey: "NAM_TRUOC",
        columnLabel: "Năm trước",
        columnType: "PREVIOUS_PERIOD",
        periodOffset: -1,
        reportKey: DISCLOSURE_REPORT_KEY,
        sortOrder: 40,
        status: "ACTIVE",
        valueBasis: "ENDING",
        width: 18,
      },
      recordType: "REPORT_COLUMN",
      sourceRow: 1,
      sourceSheet,
    },
  ];

  for (const [index, itemRecord] of items.entries()) {
    const item = payloadOf(itemRecord);
    const itemKey = normalizeKey(item.itemKey || itemRecord.entityKey);
    const noteCode = cleanText(item.noteCode || `TM_${index + 1}`);
    const existing =
      existingRows.get(normalizeKey(noteCode)) || existingRows.get(itemKey);
    const existingPayload = existing?.payload || {};
    const existingCells =
      existingPayload.cells &&
      typeof existingPayload.cells === "object" &&
      !Array.isArray(existingPayload.cells)
        ? (existingPayload.cells as JsonObject)
        : {};
    const numeric = isNumericDisclosureItem(item);
    const defaultTerms = defaultCrossReportTerms(links, itemKey);
    const cells = {
      ...existingCells,
      CHI_TIEU: {
        ...((existingCells.CHI_TIEU as JsonObject) || {}),
        contentKind: "TEXT",
        text: cleanText(item.noteTitle),
      },
      MA_SO: {
        ...((existingCells.MA_SO as JsonObject) || {}),
        contentKind: "TEXT",
        text: noteCode,
      },
      NAM_NAY: configuredCell(existingCells.NAM_NAY, defaultTerms, numeric),
      NAM_TRUOC: configuredCell(existingCells.NAM_TRUOC, defaultTerms, numeric),
    } satisfies JsonObject;
    records.push({
      payload: {
        ...existingPayload,
        cells,
        disclosureItemKey: itemKey,
        disclosureSectionKey: normalizeKey(item.sectionKey),
        displayCode: noteCode,
        managedByDisclosureTemplate: true,
        reportKey: DISCLOSURE_REPORT_KEY,
        rowCode: noteCode,
        rowLabel: cleanText(item.noteTitle),
        rowType: numeric ? "DATA" : "NOTE",
        sortOrder: Number(item.startRow || itemRecord.sortOrder || index + 1),
        status: "ACTIVE",
      },
      recordType: "REPORT_ROW",
      sourceRow: Number(item.startRow || itemRecord.sourceRow || index + 1),
      sourceSheet,
    });
  }

  return {
    records,
    stats: {
      columnCount: 4,
      formulaRowCount: items.filter((record) =>
        isNumericDisclosureItem(payloadOf(record)),
      ).length,
      reportRowCount: items.length,
    },
  };
}
