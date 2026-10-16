import type ExcelJS from "exceljs";
import type { Cell, Worksheet } from "exceljs";

import { cleanText } from "@/lib/accounting/normalize";
import type { JsonObject } from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";

const MAX_DISCLOSURE_ROWS = 2_000;
const MAX_DISCLOSURE_COLUMNS = 150;
const MAX_DISCLOSURE_CELLS = 20_000;

const ROMAN_VALUES: Record<string, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
};

type PlainCellValue = {
  formula: string;
  kind: "EMPTY" | "FORMULA" | "NUMBER" | "TEXT";
  numberValue: number | null;
  textValue: string;
};

type ParsedCell = JsonObject & {
  address: string;
  column: number;
  hasBorder: boolean;
  role: string;
  row: number;
  styleKey: string;
};

type SectionMarker = {
  code: string;
  row: number;
  title: string;
};

function plainColor(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const color = value as {
    argb?: string;
    indexed?: number;
    theme?: number;
    tint?: number;
  };
  if (color.argb) return `#${color.argb.slice(-6)}`;
  if (color.theme !== undefined) return `THEME_${color.theme}`;
  if (color.indexed !== undefined) return `INDEXED_${color.indexed}`;
  return "";
}

function plainBorderSide(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const side = value as { color?: unknown; style?: string };
  if (!side.style) return null;
  return {
    color: plainColor(side.color),
    style: side.style,
  };
}

function plainCellStyle(cell: Cell) {
  const font = cell.font || {};
  const fill = cell.fill as {
    bgColor?: unknown;
    fgColor?: unknown;
    pattern?: string;
    type?: string;
  };
  const alignment = cell.alignment || {};
  const border = cell.border || {};
  return {
    alignment: {
      horizontal: alignment.horizontal || "",
      indent: Number(alignment.indent || 0),
      textRotation: Number(alignment.textRotation || 0),
      vertical: alignment.vertical || "",
      wrapText: Boolean(alignment.wrapText),
    },
    border: {
      bottom: plainBorderSide(border.bottom),
      left: plainBorderSide(border.left),
      right: plainBorderSide(border.right),
      top: plainBorderSide(border.top),
    },
    fill: {
      background: plainColor(fill?.bgColor),
      foreground: plainColor(fill?.fgColor),
      pattern: fill?.pattern || "",
      type: fill?.type || "",
    },
    font: {
      bold: Boolean(font.bold),
      color: plainColor(font.color),
      italic: Boolean(font.italic),
      name: font.name || "",
      size: Number(font.size || 0),
      strike: Boolean(font.strike),
      underline: Boolean(font.underline),
    },
    numberFormat: cell.numFmt || "",
  };
}

function hasCellBorder(cell: Cell) {
  const border = cell.border || {};
  return Boolean(
    border.top?.style ||
      border.right?.style ||
      border.bottom?.style ||
      border.left?.style,
  );
}

function cellValue(cell: Cell): PlainCellValue {
  const value = cell.value;
  if (value === null || value === undefined || value === "") {
    return { formula: "", kind: "EMPTY", numberValue: null, textValue: "" };
  }
  if (typeof value === "number") {
    return {
      formula: "",
      kind: "NUMBER",
      numberValue: value,
      textValue: cell.text || String(value),
    };
  }
  if (value instanceof Date) {
    return {
      formula: "",
      kind: "TEXT",
      numberValue: null,
      textValue: value.toISOString(),
    };
  }
  if (typeof value === "object") {
    const structured = value as {
      formula?: string;
      hyperlink?: string;
      result?: unknown;
      richText?: Array<{ text?: string }>;
      text?: string;
    };
    if (structured.formula) {
      const numericResult =
        typeof structured.result === "number" ? structured.result : null;
      return {
        formula: structured.formula,
        kind: "FORMULA",
        numberValue: numericResult,
        textValue: cell.text || cleanText(structured.result),
      };
    }
    if (Array.isArray(structured.richText)) {
      return {
        formula: "",
        kind: "TEXT",
        numberValue: null,
        textValue: structured.richText.map((item) => item.text || "").join(""),
      };
    }
    if (structured.text) {
      return {
        formula: "",
        kind: "TEXT",
        numberValue: null,
        textValue: structured.text,
      };
    }
  }
  return {
    formula: "",
    kind: "TEXT",
    numberValue: null,
    textValue: cell.text || cleanText(value),
  };
}

function normalizeSearch(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function columnNumber(address: string) {
  const letters = address.match(/^[A-Z]+/i)?.[0].toUpperCase() || "";
  let result = 0;
  for (const letter of letters) {
    result = result * 26 + letter.charCodeAt(0) - 64;
  }
  return result;
}

function rowNumber(address: string) {
  return Number(address.match(/\d+$/)?.[0] || 0);
}

function mergeMap(sheet: Worksheet) {
  const ranges = ((sheet.model as unknown as { merges?: string[] }).merges || [])
    .map(String)
    .filter(Boolean);
  const byMaster = new Map<string, { columnSpan: number; rowSpan: number }>();
  for (const range of ranges) {
    const [start, end] = range.split(":");
    if (!start || !end) continue;
    byMaster.set(start.toUpperCase(), {
      columnSpan: Math.max(1, columnNumber(end) - columnNumber(start) + 1),
      rowSpan: Math.max(1, rowNumber(end) - rowNumber(start) + 1),
    });
  }
  return { byMaster, ranges };
}

function rowTexts(sheet: Worksheet, maxRow: number, maxColumn: number) {
  const values = new Map<number, string>();
  for (let rowNumberValue = 1; rowNumberValue <= maxRow; rowNumberValue += 1) {
    const row = sheet.getRow(rowNumberValue);
    const parts: string[] = [];
    for (let column = 1; column <= maxColumn; column += 1) {
      const value = cleanText(cellValue(row.getCell(column)).textValue);
      if (value && parts.at(-1) !== value) parts.push(value);
    }
    values.set(rowNumberValue, parts.join(" "));
  }
  return values;
}

function sectionMarkers(rows: Map<number, string>) {
  const markers: SectionMarker[] = [];
  let lastOrdinal = 0;
  for (const [row, text] of rows) {
    const match = text.match(/^\s*(I|II|III|IV|V|VI|VII|VIII|IX)\.\s+(.+)/i);
    if (!match) continue;
    const code = match[1].toUpperCase();
    const ordinal = ROMAN_VALUES[code] || 0;
    if (ordinal !== lastOrdinal + 1) continue;
    markers.push({ code, row, title: cleanText(match[2]) || `Phần ${code}` });
    lastOrdinal = ordinal;
    if (ordinal === 9) break;
  }
  return markers;
}

function sectionRanges(markers: SectionMarker[], maxRow: number) {
  if (!markers.length) {
    return [
      {
        code: "NOI_DUNG",
        endRow: maxRow,
        startRow: 1,
        title: "Nội dung thuyết minh",
      },
    ];
  }
  const sections: Array<SectionMarker & { endRow: number; startRow: number }> = [];
  if (markers[0].row > 1) {
    sections.push({
      code: "MO_DAU",
      endRow: markers[0].row - 1,
      row: 1,
      startRow: 1,
      title: "Thông tin chung và tiêu đề",
    });
  }
  markers.forEach((marker, index) => {
    sections.push({
      ...marker,
      endRow: markers[index + 1]?.row
        ? markers[index + 1].row - 1
        : maxRow,
      startRow: marker.row,
    });
  });
  return sections;
}

function sectionIsNarrative(code: string) {
  return ["I", "II", "III", "IV", "VIII", "IX", "MO_DAU"].includes(code);
}

function inferTextRole(input: {
  cell: Cell;
  isSectionStart: boolean;
  rowCellCount: number;
  rowHasNumber: boolean;
  sectionCode: string;
  text: string;
}) {
  const normalized = normalizeSearch(input.text);
  if (input.isSectionStart) return "SECTION_TITLE";
  if (
    /(nguoi lap|ke toan truong|giam doc|nguoi dai dien|ky, ho ten|dong dau)/.test(
      normalized,
    )
  ) {
    return "SIGNATURE";
  }
  if (
    /(ten don vi|dia chi|ma so thue|linh vuc kinh doanh|chu ky san xuat|nam tai chinh)/.test(
      normalized,
    )
  ) {
    return "COMPANY_FIELD";
  }
  if (
    input.rowCellCount >= 2 &&
    !input.rowHasNumber &&
    (Boolean(input.cell.font?.bold) || hasCellBorder(input.cell))
  ) {
    return "TABLE_HEADER";
  }
  if (sectionIsNarrative(input.sectionCode) && input.text.length > 24) {
    return "MANUAL_TEXT";
  }
  return "FIXED_TEXT";
}

function detectBlocks(cells: ParsedCell[], startRow: number, endRow: number) {
  const byRow = new Map<number, ParsedCell[]>();
  for (const cell of cells) {
    const row = byRow.get(cell.row) || [];
    row.push(cell);
    byRow.set(cell.row, row);
  }
  const rows = [] as Array<{ kind: "CONTENT" | "TABLE"; row: number }>;
  for (let row = startRow; row <= endRow; row += 1) {
    const values = byRow.get(row) || [];
    if (!values.length) continue;
    const hasNumber = values.some((cell) => cell.role.startsWith("REFERENCE_"));
    const bordered = values.filter((cell) => cell.hasBorder).length;
    rows.push({
      kind:
        values.length >= 2 && (hasNumber || bordered >= Math.min(2, values.length))
          ? "TABLE"
          : "CONTENT",
      row,
    });
  }
  const blocks: Array<JsonObject & { endRow: number; startRow: number; type: string }> = [];
  for (const item of rows) {
    const previous = blocks.at(-1);
    if (
      previous &&
      previous.type === item.kind &&
      item.row <= previous.endRow + 1
    ) {
      previous.endRow = item.row;
      continue;
    }
    blocks.push({
      blockKey: `B${blocks.length + 1}`,
      endRow: item.row,
      startRow: item.row,
      type: item.kind,
    });
  }
  return blocks;
}

function worksheetScore(sheet: Worksheet) {
  let score = Math.min(sheet.rowCount, MAX_DISCLOSURE_ROWS) / 100;
  const probe: string[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumberValue) => {
    if (rowNumberValue > 80) return;
    row.eachCell({ includeEmpty: false }, (cell) => probe.push(cell.text));
  });
  const text = normalizeSearch(probe.join(" "));
  if (text.includes("b09-dn")) score += 1_000;
  if (text.includes("thuyet minh bao cao tai chinh")) score += 500;
  if (text.includes("thong tu 99")) score += 200;
  return score;
}

function selectedWorksheet(workbook: ExcelJS.Workbook) {
  return [...workbook.worksheets].sort(
    (left, right) => worksheetScore(right) - worksheetScore(left),
  )[0];
}

export function parseAccountingDisclosureWorkbook(
  workbook: ExcelJS.Workbook,
  fileName: string,
) {
  const sheet = selectedWorksheet(workbook);
  if (!sheet) {
    throw new AccountingRpcError("Workbook không có trang tính để tạo mẫu thuyết minh.");
  }
  const maxRow = sheet.rowCount;
  const maxColumn = sheet.columnCount;
  if (maxRow > MAX_DISCLOSURE_ROWS || maxColumn > MAX_DISCLOSURE_COLUMNS) {
    throw new AccountingRpcError(
      `Khuôn thuyết minh có ${maxRow.toLocaleString("vi-VN")} dòng và ${maxColumn.toLocaleString("vi-VN")} cột; giới hạn an toàn hiện tại là ${MAX_DISCLOSURE_ROWS.toLocaleString("vi-VN")} dòng và ${MAX_DISCLOSURE_COLUMNS} cột.`,
    );
  }

  const rows = rowTexts(sheet, maxRow, maxColumn);
  const markers = sectionMarkers(rows);
  const ranges = sectionRanges(markers, maxRow);
  const mergeData = mergeMap(sheet);
  const styleKeys = new Map<string, string>();
  const styles: Array<JsonObject & { styleKey: string }> = [];
  const cells: ParsedCell[] = [];

  const sectionForRow = (row: number) =>
    ranges.find((range) => row >= range.startRow && row <= range.endRow) ||
    ranges[0];

  for (let rowNumberValue = 1; rowNumberValue <= maxRow; rowNumberValue += 1) {
    const row = sheet.getRow(rowNumberValue);
    const rowCells: Array<{ cell: Cell; value: PlainCellValue }> = [];
    for (let column = 1; column <= maxColumn; column += 1) {
      const cell = row.getCell(column);
      if (cell.isMerged && cell.master.address !== cell.address) continue;
      const value = cellValue(cell);
      if (value.kind !== "EMPTY") rowCells.push({ cell, value });
    }
    const rowHasNumber = rowCells.some(({ value }) =>
      ["FORMULA", "NUMBER"].includes(value.kind),
    );
    for (const { cell, value } of rowCells) {
      if (cells.length >= MAX_DISCLOSURE_CELLS) {
        throw new AccountingRpcError(
          `Khuôn có hơn ${MAX_DISCLOSURE_CELLS.toLocaleString("vi-VN")} ô có nội dung; vui lòng tách thành nhiều mẫu nhỏ hơn.`,
        );
      }
      const plainStyle = plainCellStyle(cell);
      const styleFingerprint = JSON.stringify(plainStyle);
      let styleKey = styleKeys.get(styleFingerprint);
      if (!styleKey) {
        styleKey = `S${styles.length + 1}`;
        styleKeys.set(styleFingerprint, styleKey);
        styles.push({ styleKey, ...plainStyle });
      }
      const range = sectionForRow(rowNumberValue);
      const merge = mergeData.byMaster.get(cell.address.toUpperCase());
      const parsed: ParsedCell = {
        address: cell.address,
        column: columnNumber(cell.address),
        hasBorder: hasCellBorder(cell),
        role:
          value.kind === "NUMBER"
            ? "REFERENCE_VALUE"
            : value.kind === "FORMULA"
              ? "REFERENCE_FORMULA"
              : inferTextRole({
                  cell,
                  isSectionStart: rowNumberValue === range.startRow,
                  rowCellCount: rowCells.length,
                  rowHasNumber,
                  sectionCode: range.code,
                  text: value.textValue,
                }),
        row: rowNumberValue,
        styleKey,
      };
      if (value.kind === "NUMBER") {
        parsed.sampleValue = value.numberValue;
        parsed.runtimeValue = null;
      } else if (value.kind === "FORMULA") {
        parsed.sampleFormula = value.formula;
        parsed.sampleValue = value.numberValue;
        parsed.runtimeValue = null;
      } else {
        parsed.text = value.textValue;
      }
      if (merge) {
        parsed.columnSpan = merge.columnSpan;
        parsed.rowSpan = merge.rowSpan;
      }
      cells.push(parsed);
    }
  }

  const templateKey = "B09_DN_TT99";
  const columnWidths = Array.from({ length: maxColumn }, (_, index) => {
    const column = sheet.getColumn(index + 1);
    return {
      column: index + 1,
      hidden: Boolean(column.hidden),
      outlineLevel: Number(column.outlineLevel || 0),
      width: Number(column.width || 8.43),
    };
  });
  const rowHeights = Array.from({ length: maxRow }, (_, index) => {
    const row = sheet.getRow(index + 1);
    return row.height
      ? { height: Number(row.height), row: index + 1 }
      : null;
  }).filter(Boolean);
  const referenceNumberCount = cells.filter(
    (cell) => cell.role === "REFERENCE_VALUE",
  ).length;
  const referenceFormulaCount = cells.filter(
    (cell) => cell.role === "REFERENCE_FORMULA",
  ).length;

  const templatePayload: JsonObject = {
    columnWidths,
    importedAt: new Date().toISOString(),
    maxColumn,
    maxRow,
    mergeRanges: mergeData.ranges,
    pageSetup: {
      fitToHeight: sheet.pageSetup.fitToHeight || 0,
      fitToPage: Boolean(sheet.pageSetup.fitToPage),
      fitToWidth: sheet.pageSetup.fitToWidth || 0,
      horizontalCentered: Boolean(sheet.pageSetup.horizontalCentered),
      margins: sheet.pageSetup.margins || {},
      orientation: sheet.pageSetup.orientation || "portrait",
      paperSize: sheet.pageSetup.paperSize || 0,
      printArea: sheet.pageSetup.printArea || "",
      verticalCentered: Boolean(sheet.pageSetup.verticalCentered),
    },
    referenceFormulaCount,
    referenceNumberCount,
    rowHeights,
    sourceFileName: fileName,
    sourceSheet: sheet.name,
    standardCode: "TT99/2025/TT-BTC",
    status: "ACTIVE",
    styleCatalog: styles,
    templateCode: "B09-DN",
    templateKey,
    templateKind: "FINANCIAL_STATEMENT_NOTES",
    templateName: "Bản thuyết minh Báo cáo tài chính",
  };

  const sectionPayloads = ranges.map((range, index) => {
    const sectionCells = cells.filter(
      (cell) => cell.row >= range.startRow && cell.row <= range.endRow,
    );
    const sectionRowHeights = rowHeights.filter(
      (item): item is { height: number; row: number } =>
        Boolean(
          item && item.row >= range.startRow && item.row <= range.endRow,
        ),
    );
    return {
      blocks: detectBlocks(sectionCells, range.startRow, range.endRow),
      cells: sectionCells.map((cell) => {
        const storedCell = { ...cell } as Partial<ParsedCell>;
        delete storedCell.hasBorder;
        return storedCell;
      }),
      endRow: range.endRow,
      rowHeights: sectionRowHeights,
      sectionCode: range.code,
      sectionKey: range.code,
      sectionTitle: range.title,
      sortOrder: index + 1,
      startRow: range.startRow,
      status: "ACTIVE",
      templateKey,
    } satisfies JsonObject;
  });

  const tableCount = sectionPayloads.reduce(
    (total, section) =>
      total +
      (section.blocks as Array<{ type?: string }>).filter(
        (block) => block.type === "TABLE",
      ).length,
    0,
  );

  return {
    records: [
      {
        payload: templatePayload,
        recordType: "DISCLOSURE_TEMPLATE" as const,
        sourceRow: 1,
        sourceSheet: sheet.name,
      },
      ...sectionPayloads.map((payload) => ({
        payload,
        recordType: "DISCLOSURE_SECTION" as const,
        sourceRow: Number(payload.startRow || 1),
        sourceSheet: sheet.name,
      })),
    ],
    stats: {
      blockCount: sectionPayloads.reduce(
        (total, section) => total + section.blocks.length,
        0,
      ),
      cellCount: cells.length,
      columnCount: maxColumn,
      mergeCount: mergeData.ranges.length,
      referenceFormulaCount,
      referenceNumberCount,
      rowCount: maxRow,
      sectionCount: sectionPayloads.length,
      styleCount: styles.length,
      tableCount,
    },
    summaries: sectionPayloads.map((section) => ({
      blockCount: section.blocks.length,
      cellCount: section.cells.length,
      endRow: section.endRow,
      referenceNumberCount: section.cells.filter(
        (cell) => (cell as { role?: string }).role === "REFERENCE_VALUE",
      ).length,
      sectionCode: section.sectionCode,
      sectionKey: section.sectionKey,
      sectionTitle: section.sectionTitle,
      startRow: section.startRow,
      tableCount: section.blocks.filter(
        (block) => (block as { type?: string }).type === "TABLE",
      ).length,
    })),
    template: templatePayload,
    warnings: markers.length < 9
      ? [
          `Hệ thống nhận ra ${markers.length}/9 phần La Mã. Hãy kiểm tra lại tiêu đề các phần trước khi áp dụng.`,
        ]
      : [],
  };
}

export const disclosureTemplateTestUtils = {
  cellValue,
  sectionMarkers,
};
