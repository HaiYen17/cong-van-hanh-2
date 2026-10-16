import { createHash } from "node:crypto";

import ExcelJS from "exceljs";
import JSZip from "jszip";

import { cleanText, normalizeKey } from "@/lib/accounting/normalize";
import type { AccountingRecord, JsonObject } from "@/lib/accounting/types";
import { AccountingRpcError } from "@/lib/accounting/types";

type LayoutCell = JsonObject & {
  address?: string;
  column?: number;
  columnSpan?: number;
  role?: string;
  row?: number;
  text?: string;
};

type PeriodSide = "CURRENT" | "PRIOR" | "UNKNOWN";

let defaultThemeXmlPromise: Promise<string> | undefined;

function defaultThemeXml() {
  if (!defaultThemeXmlPromise) {
    defaultThemeXmlPromise = (async () => {
      const workbook = new ExcelJS.Workbook();
      workbook.addWorksheet("Theme");
      const buffer = await workbook.xlsx.writeBuffer();
      const archive = await JSZip.loadAsync(buffer);
      const theme = archive.file("xl/theme/theme1.xml");
      if (!theme) {
        throw new AccountingRpcError("Không tạo được bộ màu chuẩn cho file B09.");
      }
      return theme.async("string");
    })();
  }
  return defaultThemeXmlPromise;
}

async function ensureWorkbookTheme(buffer: Buffer) {
  const archive = await JSZip.loadAsync(buffer);
  const relationships = await archive
    .file("xl/_rels/workbook.xml.rels")
    ?.async("string");
  const expectsTheme = Boolean(
    relationships?.includes(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme",
    ),
  );
  if (!expectsTheme || archive.file("xl/theme/theme1.xml")) return buffer;
  archive.file("xl/theme/theme1.xml", await defaultThemeXml());
  return Buffer.from(
    await archive.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    }),
  );
}

function normalizedText(value: unknown) {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function periodSide(value: unknown): PeriodSide {
  const text = normalizedText(value);
  if (
    /(^|_)(NAM_TRUOC|KY_TRUOC|DAU_NAM|DAU_KY|PRIOR|PREVIOUS|OPENING|BEGINNING)(_|$)/.test(
      text,
    )
  ) {
    return "PRIOR";
  }
  if (
    /(^|_)(NAM_NAY|KY_NAY|CUOI_NAM|CUOI_KY|CURRENT|THIS|CLOSING|ENDING)(_|$)/.test(
      text,
    )
  ) {
    return "CURRENT";
  }
  return "UNKNOWN";
}

function totalPeriodSide(total: JsonObject): PeriodSide {
  for (const value of [
    total.columnType,
    total.columnKey,
    total.columnLabel,
  ]) {
    const side = periodSide(value);
    if (side !== "UNKNOWN") return side;
  }
  return "UNKNOWN";
}

function recordPayload(record: AccountingRecord | undefined) {
  return (record?.payload || {}) as JsonObject;
}

function layoutCells(records: AccountingRecord[]) {
  return records
    .filter((record) => record.recordType === "DISCLOSURE_SECTION")
    .flatMap((record) => {
      const cells = recordPayload(record).cells;
      return Array.isArray(cells)
        ? cells.filter((cell): cell is LayoutCell => Boolean(cell && typeof cell === "object"))
        : [];
    });
}

function targetPeriodSide(
  target: LayoutCell,
  cells: LayoutCell[],
  startRow: number,
) {
  const row = Number(target.row || 0);
  const column = Number(target.column || 0);
  const headers = cells
    .filter((cell) => {
      const headerRow = Number(cell.row || 0);
      const headerColumn = Number(cell.column || 0);
      const span = Math.max(1, Number(cell.columnSpan || 1));
      return (
        cleanText(cell.text) &&
        headerRow >= Math.max(1, startRow - 6) &&
        headerRow <= row &&
        column >= headerColumn &&
        column <= headerColumn + span - 1
      );
    })
    .sort((left, right) => Number(right.row || 0) - Number(left.row || 0));
  for (const header of headers) {
    const side = periodSide(header.text);
    if (side !== "UNKNOWN") return side;
  }
  return "UNKNOWN";
}

function itemTargetCells(
  item: JsonObject,
  cells: LayoutCell[],
  totalCount: number,
) {
  const startRow = Number(item.startRow || 0);
  const endRow = Number(item.endRow || startRow);
  const itemCells = cells.filter((cell) => {
    const row = Number(cell.row || 0);
    return row >= startRow && row <= endRow;
  });
  const references = itemCells
    .filter((cell) =>
      ["REFERENCE_VALUE", "REFERENCE_FORMULA"].includes(cleanText(cell.role)),
    )
    .sort(
      (left, right) =>
        Number(left.row || 0) - Number(right.row || 0) ||
        Number(left.column || 0) - Number(right.column || 0),
    );
  if (!references.length) return [];

  const totalRows = itemCells
    .filter((cell) => {
      const label = normalizedText(cell.text);
      return label === "CONG" || label === "TONG_CONG" || label.startsWith("CONG_");
    })
    .map((cell) => Number(cell.row || 0));
  if (totalRows.length) {
    const selectedRow = Math.max(...totalRows);
    const selected = references.filter(
      (cell) => Number(cell.row || 0) === selectedRow,
    );
    if (selected.length) return selected;
  }

  const formulaRows = references
    .filter((cell) => cleanText(cell.role) === "REFERENCE_FORMULA")
    .map((cell) => Number(cell.row || 0));
  if (formulaRows.length) {
    const selectedRow = Math.max(...formulaRows);
    const selected = references.filter(
      (cell) => Number(cell.row || 0) === selectedRow,
    );
    if (selected.length >= Math.min(1, totalCount)) return selected;
  }

  if (references.length <= Math.max(1, totalCount)) return references;
  return [];
}

function significantWords(value: unknown) {
  return normalizedText(value)
    .split("_")
    .filter((word) => word.length >= 4 && !["TRONG", "PHAT", "SINH", "KHOAN"].includes(word));
}

function linkTargetCells(
  link: JsonObject,
  item: JsonObject,
  cells: LayoutCell[],
) {
  const words = significantWords(link.rowLabel);
  if (!words.length) return [];
  const startRow = Number(item.startRow || 0);
  const endRow = Number(item.endRow || startRow);
  const referenceRows = new Set(
    cells
      .filter((cell) =>
        ["REFERENCE_VALUE", "REFERENCE_FORMULA"].includes(cleanText(cell.role)),
      )
      .map((cell) => Number(cell.row || 0)),
  );
  const candidates = cells
    .filter((cell) => {
      const row = Number(cell.row || 0);
      return (
        cleanText(cell.text) &&
        row >= startRow &&
        row <= endRow &&
        referenceRows.has(row)
      );
    })
    .map((cell) => {
      const actual = new Set(significantWords(cell.text));
      const score = words.filter((word) => actual.has(word)).length;
      return { row: Number(cell.row || 0), score };
    })
    .filter((candidate) => candidate.score >= Math.min(2, words.length))
    .sort((left, right) => right.score - left.score || left.row - right.row);
  const row = candidates[0]?.row;
  if (!row) return [];
  return cells
    .filter(
      (cell) =>
        Number(cell.row || 0) === row &&
        ["REFERENCE_VALUE", "REFERENCE_FORMULA"].includes(cleanText(cell.role)),
    )
    .sort((left, right) => Number(left.column || 0) - Number(right.column || 0));
}

function auditSourceRows(item: JsonObject, total: JsonObject | undefined) {
  const values = Array.isArray(total?.sourceRows)
    ? total?.sourceRows
    : [];
  const result = values.map(cleanText).filter(Boolean);
  if (result.length) return [...new Set(result)].join(" · ");
  const links = Array.isArray(item.links) ? item.links : [];
  return links
    .filter((link): link is JsonObject => Boolean(link && typeof link === "object"))
    .map((link) => {
      const report = cleanText(link.reportName || link.reportKey);
      const row = cleanText(link.rowCode);
      return [report, row ? `dòng ${row}` : ""].filter(Boolean).join(" · ");
    })
    .filter(Boolean)
    .join("; ");
}

function clearReferenceSamples(
  worksheet: ExcelJS.Worksheet,
  cells: LayoutCell[],
) {
  let cleared = 0;
  for (const item of cells) {
    if (
      !item.address ||
      !["REFERENCE_VALUE", "REFERENCE_FORMULA"].includes(cleanText(item.role))
    ) {
      continue;
    }
    worksheet.getCell(item.address).value = null;
    cleared += 1;
  }
  return cleared;
}

function updateReportYear(worksheet: ExcelJS.Worksheet, year: number) {
  let updated = false;
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    if (updated) return;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (updated) return;
      if (/^Năm\s+\d{4}$/i.test(cleanText(cell.text))) {
        cell.value = `Năm ${year}`;
        updated = true;
      }
    });
  });
}

function addAuditSheet(workbook: ExcelJS.Workbook, output: JsonObject) {
  const existing = workbook.getWorksheet("Đối chiếu số liệu");
  if (existing) workbook.removeWorksheet(existing.id);
  const sheet = workbook.addWorksheet("Đối chiếu số liệu", {
    views: [{ state: "frozen", ySplit: 5, showGridLines: false }],
  });
  const title = "ĐỐI CHIẾU SỐ LIỆU B09-DN";
  sheet.mergeCells("A1:H1");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = {
    name: "Arial",
    size: 15,
    bold: true,
    color: { argb: "FF114C41" },
  };
  sheet.getCell("A1").alignment = { horizontal: "center" };
  sheet.mergeCells("A2:H2");
  sheet.getCell("A2").value = `Kỳ ${cleanText(output.periodFrom)} đến ${cleanText(output.periodTo)} · Trạng thái ${cleanText(output.controlStatus)}`;
  sheet.getCell("A2").font = {
    name: "Arial",
    size: 10,
    italic: true,
    color: { argb: "FF5D6F6A" },
  };
  sheet.getCell("A2").alignment = { horizontal: "center" };
  sheet.mergeCells("A3:H3");
  sheet.getCell("A3").value =
    "Sheet này chỉ giải thích nguồn và kiểm tra số; báo cáo chính nằm ở sheet B09 gốc.";
  sheet.getCell("A3").font = {
    name: "Arial",
    size: 9,
    color: { argb: "FFB45A24" },
  };
  sheet.getCell("A3").alignment = { horizontal: "center" };

  const headers = [
    "Mã",
    "Khoản mục thuyết minh",
    "Chỉ tiêu",
    "Giá trị",
    "Trạng thái",
    "Nguồn đối chiếu",
    "Kết quả kiểm tra",
    "Nguyên tắc lấy số",
  ];
  const headerRow = sheet.getRow(5);
  headerRow.values = headers;
  headerRow.height = 32;
  headerRow.eachCell((cell) => {
    cell.font = {
      name: "Arial",
      size: 10,
      bold: true,
      color: { argb: "FF114C41" },
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8F3EE" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      bottom: { style: "thin", color: { argb: "FFC9D7D3" } },
    };
  });

  const items = Array.isArray(output.items) ? output.items : [];
  let rowIndex = 6;
  for (const value of items) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as JsonObject;
    const totals = Array.isArray(item.totals)
      ? item.totals.filter(
          (total): total is JsonObject => Boolean(total && typeof total === "object"),
        )
      : [];
    const rows = totals.length ? totals : [undefined];
    const controls = Array.isArray(item.controlChecks)
      ? item.controlChecks
          .filter(
            (control): control is JsonObject =>
              Boolean(control && typeof control === "object"),
          )
          .map((control) =>
            `${normalizeKey(control.status) === "PASS" ? "Đạt" : "Chưa khớp"}: ${cleanText(control.label)}`,
          )
          .join(" · ")
      : "";
    rows.forEach((total, totalIndex) => {
      const row = sheet.getRow(rowIndex);
      row.values = [
        totalIndex === 0 ? cleanText(item.noteCode) : "",
        totalIndex === 0 ? cleanText(item.noteTitle) : "",
        total ? cleanText(total.columnLabel) : "Chưa có số tự động",
        total && Number.isFinite(Number(total.value)) ? Number(total.value) : null,
        totalIndex === 0 ? cleanText(item.status) : "",
        auditSourceRows(item, total),
        totalIndex === 0 ? controls : "",
        totalIndex === 0 ? cleanText(item.formulaPrinciple) : "",
      ];
      row.height = 34;
      row.eachCell((cell, column) => {
        cell.font = { name: "Arial", size: 9 };
        cell.alignment = {
          horizontal: column === 4 ? "right" : "left",
          vertical: "top",
          wrapText: true,
        };
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFD8E1DE" } },
        };
      });
      row.getCell(4).numFmt = "#,##0;[Red](#,##0);-";
      rowIndex += 1;
    });
  }
  [10, 34, 22, 18, 16, 42, 42, 48].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  sheet.autoFilter = `A5:H${Math.max(5, rowIndex - 1)}`;
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
  };
}

function safeFileName(value: unknown) {
  const cleaned = cleanText(value)
    .normalize("NFC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .replace(/\.xlsx$/i, "")
    .slice(0, 120);
  return `${cleaned || "B09-DN - Bản thuyết minh Báo cáo tài chính"}.xlsx`;
}

export async function renderAccountingDisclosureWorkbook(input: {
  output: JsonObject;
  records: AccountingRecord[];
  source: Buffer;
  sourceFileName?: string;
}) {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(
      input.source as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
  } catch {
    throw new AccountingRpcError(
      "Không đọc được file Excel gốc của khuôn B09.",
      409,
    );
  }
  const templateRecord = input.records.find(
    (record) => record.recordType === "DISCLOSURE_TEMPLATE",
  );
  const template = recordPayload(templateRecord);
  const sourceSheetName = cleanText(template.sourceSheet);
  const worksheet =
    (sourceSheetName ? workbook.getWorksheet(sourceSheetName) : undefined) ||
    workbook.worksheets[0];
  if (!worksheet) {
    throw new AccountingRpcError("Khuôn Excel B09 không có sheet báo cáo.", 409);
  }

  const cells = layoutCells(input.records);
  const clearedReferenceCount = clearReferenceSamples(worksheet, cells);
  updateReportYear(worksheet, new Date(cleanText(input.output.periodTo)).getUTCFullYear());

  const itemRecords = new Map(
    input.records
      .filter((record) => record.recordType === "DISCLOSURE_ITEM")
      .map((record) => [normalizeKey(recordPayload(record).itemKey || record.entityKey), record]),
  );
  const outputItems = Array.isArray(input.output.items) ? input.output.items : [];
  const placed: Array<{ address: string; itemKey: string }> = [];
  const unplaced: string[] = [];

  for (const value of outputItems) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const item = value as JsonObject;
    const itemKey = normalizeKey(item.itemKey);
    const itemRecord = itemRecords.get(itemKey);
    if (!itemRecord) continue;
    const itemPayload = recordPayload(itemRecord);
    const totals = Array.isArray(item.totals)
      ? item.totals.filter(
          (total): total is JsonObject => Boolean(total && typeof total === "object"),
        )
      : [];
    if (!totals.length) continue;
    const targets = itemTargetCells(itemPayload, cells, totals.length);
    if (!targets.length) {
      let linkPlaced = 0;
      const links = Array.isArray(item.links)
        ? item.links.filter(
            (link): link is JsonObject => Boolean(link && typeof link === "object"),
          )
        : [];
      for (const link of links) {
        const linkTargets = linkTargetCells(link, itemPayload, cells);
        const values = Array.isArray(link.values)
          ? link.values.filter(
              (entry): entry is JsonObject => Boolean(entry && typeof entry === "object"),
            )
          : [];
        const availableLinkTargets = linkTargets.map((target) => ({
          target,
          side: targetPeriodSide(
            target,
            cells,
            Number(itemPayload.startRow || 1),
          ),
          used: false,
        }));
        for (const linkValue of values) {
          const side = totalPeriodSide(linkValue);
          const target =
            availableLinkTargets.find(
              (candidate) =>
                !candidate.used && side !== "UNKNOWN" && candidate.side === side,
            ) ||
            availableLinkTargets.find(
              (candidate) => !candidate.used && candidate.side === "UNKNOWN",
            ) ||
            availableLinkTargets.find((candidate) => !candidate.used);
          if (!target?.target.address) continue;
          const number = Number(linkValue.value);
          if (!Number.isFinite(number)) continue;
          const cell = worksheet.getCell(target.target.address);
          cell.value = number;
          target.used = true;
          linkPlaced += 1;
          placed.push({ address: target.target.address, itemKey });
        }
      }
      if (!linkPlaced) unplaced.push(cleanText(item.noteCode || itemKey));
      continue;
    }
    const available = targets.map((target) => ({
      target,
      side: targetPeriodSide(target, cells, Number(itemPayload.startRow || 1)),
      used: false,
    }));
    for (const total of totals) {
      const side = totalPeriodSide(total);
      const target =
        available.find((candidate) => !candidate.used && side !== "UNKNOWN" && candidate.side === side) ||
        available.find((candidate) => !candidate.used && candidate.side === "UNKNOWN") ||
        available.find((candidate) => !candidate.used);
      if (!target?.target.address) continue;
      const number = Number(total.value);
      if (!Number.isFinite(number)) continue;
      const cell = worksheet.getCell(target.target.address);
      cell.value = number;
      target.used = true;
      placed.push({ address: target.target.address, itemKey });
    }
    if (!available.some((candidate) => candidate.used)) {
      unplaced.push(cleanText(item.noteCode || itemKey));
    }
  }

  addAuditSheet(workbook, input.output);
  workbook.calcProperties.fullCalcOnLoad = true;
  const buffer = await ensureWorkbookTheme(
    Buffer.from(await workbook.xlsx.writeBuffer()),
  );
  const periodTo = cleanText(input.output.periodTo);
  const sourceBase = cleanText(input.sourceFileName).replace(/\.xlsx$/i, "");
  const fileName = safeFileName(
    `${sourceBase || "B09-DN - Bản thuyết minh Báo cáo tài chính"}${periodTo ? ` - ${periodTo}` : ""}`,
  );
  return {
    ok: true,
    fileName,
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    base64: buffer.toString("base64"),
    byteSize: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    rowCount: outputItems.length,
    warningCount:
      (Array.isArray(input.output.warnings) ? input.output.warnings.length : 0) +
      unplaced.length,
    clearedReferenceCount,
    placedCellCount: placed.length,
    unplacedItemCodes: unplaced,
  } satisfies JsonObject;
}

export const disclosureWorkbookTestUtils = {
  itemTargetCells,
  linkTargetCells,
  normalizedText,
  periodSide,
  targetPeriodSide,
  totalPeriodSide,
};
