import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";

import pdfmake from "pdfmake";
import robotoFonts from "pdfmake/fonts/Roboto";

import { cleanText, isJsonObject } from "@/lib/accounting/normalize";
import { AccountingRpcError, type JsonObject } from "@/lib/accounting/types";

pdfmake.setFonts(robotoFonts);
pdfmake.setUrlAccessPolicy(() => false);
pdfmake.setLocalAccessPolicy((candidate) => {
  const normalized = path.resolve(candidate).toLowerCase();
  const fontRoot = path
    .resolve(process.cwd(), "node_modules", "pdfmake", "fonts", "Roboto")
    .toLowerCase();
  return normalized.startsWith(`${fontRoot}${path.sep}`) || normalized === fontRoot;
});

function color(value: unknown, fallback?: string) {
  const text = cleanText(value);
  return /^#[0-9a-f]{6}$/i.test(text) ? text : fallback;
}

function numberText(value: unknown, format: unknown) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) {
    return cleanText(value);
  }
  const formatText = cleanText(format);
  if (numeric === 0 && formatText.split(";").length >= 3) {
    return "-";
  }
  const decimals = formatText.includes(".00") ? 2 : 0;
  const absolute = new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: decimals,
  }).format(Math.abs(numeric));
  if (numeric < 0) {
    return formatText.includes("(") ? `(${absolute})` : `-${absolute}`;
  }
  return absolute;
}

function pdfCell(
  value: unknown,
  rowType: string,
  fallbackNumberFormat: unknown,
) {
  const source = isJsonObject(value) ? value : {};
  const style = isJsonObject(source.style) ? source.style : {};
  const hasNumber = source.value !== null && source.value !== undefined;
  const content = hasNumber
    ? numberText(source.value, style.numberFormat || fallbackNumberFormat)
    : cleanText(source.text);
  const boldByType = ["TITLE", "SECTION", "SUBTOTAL", "TOTAL"].includes(
    rowType,
  );
  return {
    text: content || " ",
    bold: Boolean(style.bold) || boldByType,
    italics: Boolean(style.italic),
    alignment: cleanText(style.align || (hasNumber ? "RIGHT" : "LEFT"))
      .toLowerCase()
      .replace("center", "center"),
    fontSize: Math.max(7, Math.min(18, Number(style.fontSize || 8))),
    color: color(style.textColor, "#17352f"),
    fillColor: color(style.fillColor),
    colSpan: Math.max(1, Math.min(20, Number(source.mergeColumnSpan || 1))),
    rowSpan: Math.max(1, Math.min(100, Number(source.mergeRowSpan || 1))),
    margin: [3, 3, 3, 3],
    noWrap: false,
  };
}

function headerRows(output: JsonObject, columnCount: number) {
  const sourceRows = Array.isArray(output.headerRows) ? output.headerRows : [];
  const occupied = new Set<string>();
  return sourceRows.map((rawRow, rowIndex) => {
    const row = isJsonObject(rawRow) ? rawRow : {};
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const result: unknown[] = [];
    let columnIndex = 0;
    for (const rawCell of cells) {
      while (
        columnIndex < columnCount &&
        occupied.has(`${rowIndex}:${columnIndex}`)
      ) {
        result.push({});
        columnIndex += 1;
      }
      if (columnIndex >= columnCount) {
        break;
      }
      const cell = isJsonObject(rawCell) ? rawCell : {};
      const colSpan = Math.max(
        1,
        Math.min(columnCount - columnIndex, Number(cell.columnSpan || 1)),
      );
      const rowSpan = Math.max(1, Number(cell.rowSpan || 1));
      result.push({
        text: cleanText(cell.label) || " ",
        bold: true,
        alignment: "center",
        fillColor: "#eaf3f0",
        color: "#114c41",
        colSpan,
        rowSpan,
        margin: [3, 4, 3, 4],
      });
      for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
        for (let rowOffset = 1; rowOffset < rowSpan; rowOffset += 1) {
          occupied.add(
            `${rowIndex + rowOffset}:${columnIndex + columnOffset}`,
          );
        }
      }
      for (let index = 1; index < colSpan; index += 1) {
        result.push({});
      }
      columnIndex += colSpan;
    }
    while (result.length < columnCount) {
      result.push({});
    }
    return result.slice(0, columnCount);
  });
}

function reportBody(output: JsonObject) {
  const columns = Array.isArray(output.columns) ? output.columns : [];
  const sourceRows = Array.isArray(output.rows)
    ? output.rows.filter((row) => !isJsonObject(row) || row.hideOnPrint !== true)
    : [];
  if (!columns.length) {
    throw new AccountingRpcError("Báo cáo không có cột để xuất PDF.", 422);
  }
  if (sourceRows.length > 5_000) {
    throw new AccountingRpcError(
      "Bản PDF giới hạn 5.000 dòng; hãy dùng file Excel cho báo cáo lớn hơn.",
      413,
    );
  }
  const body = headerRows(output, columns.length);
  const occupied = new Set<string>();
  for (let rowIndex = 0; rowIndex < sourceRows.length; rowIndex += 1) {
    const rawRow = sourceRows[rowIndex];
    const row = isJsonObject(rawRow) ? rawRow : {};
    const cells = Array.isArray(row.cells) ? row.cells : [];
    const rowType = cleanText(row.rowType).toUpperCase();
    const rendered: unknown[] = [];
    let columnIndex = 0;
    while (columnIndex < columns.length) {
      if (occupied.has(`${rowIndex}:${columnIndex}`)) {
        rendered.push({});
        columnIndex += 1;
        continue;
      }
      const column = isJsonObject(columns[columnIndex])
        ? columns[columnIndex]
        : {};
      const cell = pdfCell(
        cells[columnIndex],
        rowType,
        column.numberFormat,
      );
      const colSpan = Math.max(
        1,
        Math.min(
          columns.length - columnIndex,
          Number(cell.colSpan || 1),
        ),
      );
      const rowSpan = Math.max(
        1,
        Math.min(sourceRows.length - rowIndex, Number(cell.rowSpan || 1)),
      );
      cell.colSpan = colSpan;
      cell.rowSpan = rowSpan;
      rendered.push(cell);
      for (let columnOffset = 0; columnOffset < colSpan; columnOffset += 1) {
        for (let rowOffset = 1; rowOffset < rowSpan; rowOffset += 1) {
          occupied.add(
            `${rowIndex + rowOffset}:${columnIndex + columnOffset}`,
          );
        }
      }
      for (let columnOffset = 1; columnOffset < colSpan; columnOffset += 1) {
        rendered.push({});
      }
      columnIndex += colSpan;
    }
    body.push(rendered);
  }
  return { body, columns, headerCount: Math.max(1, body.length - sourceRows.length) };
}

export async function renderAccountingReportPdf(output: JsonObject) {
  const { body, columns, headerCount } = reportBody(output);
  const report = isJsonObject(output.report) ? output.report : {};
  const reportName =
    cleanText(report.displayTitle || report.reportName) || "Báo cáo kế toán";
  const periodFrom = cleanText(output.periodFrom);
  const periodTo = cleanText(output.periodTo);
  const widths = columns.map((rawColumn) => {
    const column = isJsonObject(rawColumn) ? rawColumn : {};
    const width = Number(column.width || 0);
    return Number.isFinite(width) && width > 0 ? width : "*";
  });
  const notes = isJsonObject(output.notes) ? output.notes : {};
  const noteRows = Array.isArray(notes.rows) ? notes.rows : [];
  const noteContent = noteRows.length
    ? [
        {
          text: cleanText(notes.title) || "THUYẾT MINH BÁO CÁO TÀI CHÍNH",
          bold: true,
          color: "#114c41",
          fontSize: 14,
          alignment: "center",
          pageBreak: "before",
          margin: [0, 0, 0, 10],
        },
        {
          table: {
            headerRows: 1,
            widths: [46, "*", 72, 72, 72],
            body: [
              [
                { text: "Mã", bold: true, alignment: "center" },
                {
                  text: "Nội dung thuyết minh",
                  bold: true,
                  alignment: "center",
                },
                { text: "Đầu kỳ", bold: true, alignment: "center" },
                { text: "Phát sinh", bold: true, alignment: "center" },
                { text: "Cuối kỳ", bold: true, alignment: "center" },
              ],
              ...noteRows.map((rawRow) => {
                const row = isJsonObject(rawRow) ? rawRow : {};
                const numberCell = (value: unknown) => ({
                  text:
                    value === null || value === undefined
                      ? " "
                      : numberText(value, "#,##0;(#,##0);-"),
                  alignment: "right",
                  bold: Boolean(row.required),
                });
                return [
                  {
                    text: cleanText(row.itemCode) || " ",
                    bold: Boolean(row.isBold || row.required),
                    italics: Boolean(row.isItalic),
                  },
                  {
                    text: cleanText(row.itemName) || " ",
                    bold: Boolean(row.isBold || row.required),
                    italics: Boolean(row.isItalic),
                  },
                  numberCell(row.openingValue),
                  numberCell(row.movementValue),
                  numberCell(row.closingValue),
                ];
              }),
            ],
          },
          layout: {
            hLineColor: () => "#b7c8c3",
            vLineColor: () => "#d5e0dd",
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
          },
        },
      ]
    : [];
  const definition = {
    pageOrientation: columns.length > 5 ? "landscape" : "portrait",
    pageSize: "A4",
    pageMargins: [24, 30, 24, 30],
    defaultStyle: { font: "Roboto", fontSize: 8, color: "#17352f" },
    info: {
      title: reportName,
      subject: `Kỳ ${periodFrom} đến ${periodTo}`,
      author: "Thuận Việt · Cổng vận hành",
    },
    content: [
      {
        text: reportName,
        bold: true,
        color: "#114c41",
        fontSize: 15,
        alignment: "center",
        margin: [0, 0, 0, 5],
      },
      {
        text: `Kỳ ${periodFrom} đến ${periodTo}`,
        color: "#5d6f6a",
        alignment: "center",
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          headerRows: headerCount,
          widths,
          body,
          dontBreakRows: true,
        },
        layout: {
          hLineColor: () => "#b7c8c3",
          vLineColor: () => "#d5e0dd",
          hLineWidth: () => 0.5,
          vLineWidth: () => 0.5,
          paddingLeft: () => 2,
          paddingRight: () => 2,
          paddingTop: () => 2,
          paddingBottom: () => 2,
        },
      },
      ...noteContent,
    ],
    footer: (currentPage: number, pageCount: number) => ({
      text: `Trang ${currentPage}/${pageCount}`,
      alignment: "right",
      color: "#6f7f7a",
      fontSize: 7,
      margin: [24, 0, 24, 0],
    }),
  };

  const content = await pdfmake.createPdf(definition).getBuffer();
  const fileName = `${reportName} - ${periodTo || "bao-cao"}.pdf`
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
    .slice(0, 180);
  return {
    base64: content.toString("base64"),
    byteSize: content.length,
    fileName,
    mimeType: "application/pdf",
    rowCount: Array.isArray(output.rows) ? output.rows.length : 0,
    sha256: createHash("sha256").update(content).digest("hex"),
    warningCount: Array.isArray(output.warnings) ? output.warnings.length : 0,
  } satisfies JsonObject;
}

export async function renderAccountingDisclosurePdf(output: JsonObject) {
  const report = isJsonObject(output.report) ? output.report : {};
  const rawItems = Array.isArray(output.items) ? output.items : [];
  const itemByKey = new Map(
    rawItems
      .filter(isJsonObject)
      .map((item) => [cleanText(item.itemKey), item] as const),
  );
  const rows: JsonObject[] = [];
  for (const rawSection of Array.isArray(output.sections) ? output.sections : []) {
    const section = isJsonObject(rawSection) ? rawSection : {};
    rows.push({
      rowType: "SECTION",
      cells: [
        {
          text: [cleanText(section.sectionCode), cleanText(section.sectionTitle)]
            .filter(Boolean)
            .join(" · "),
          mergeColumnSpan: 5,
          style: { bold: true, fillColor: "#e8f3ee", textColor: "#114c41" },
        },
        {},
        {},
        {},
        {},
      ],
    });
    for (const itemKey of Array.isArray(section.itemKeys)
      ? section.itemKeys
      : []) {
      const item = itemByKey.get(cleanText(itemKey));
      if (!item) continue;
      const totals = Array.isArray(item.totals)
        ? item.totals.filter(isJsonObject)
        : [];
      const status = cleanText(item.status);
      const statusLabel =
        status === "READY"
          ? "Sẵn sàng"
          : status === "MANUAL_INPUT"
            ? "Kế toán nhập"
            : "Cần rà soát";
      if (!totals.length) {
        rows.push({
          rowType: "DETAIL",
          cells: [
            { text: cleanText(item.noteCode) },
            { text: cleanText(item.noteTitle) },
            { text: "Chưa có số tự động" },
            { text: " " },
            { text: statusLabel },
          ],
        });
        continue;
      }
      totals.forEach((total, index) => {
        rows.push({
          rowType: "DETAIL",
          cells: [
            { text: index === 0 ? cleanText(item.noteCode) : "" },
            { text: index === 0 ? cleanText(item.noteTitle) : "" },
            { text: cleanText(total.columnLabel) || "Giá trị" },
            {
              value: Number(total.value || 0),
              style: { align: "RIGHT", numberFormat: "#,##0;(#,##0);-" },
            },
            { text: index === 0 ? statusLabel : "" },
          ],
        });
      });
    }
  }
  const converted: JsonObject = {
    report: {
      reportKey: "B09_DN_TT99",
      reportName:
        cleanText(report.reportName) ||
        "B09-DN · Bản thuyết minh Báo cáo tài chính",
      displayTitle:
        cleanText(report.displayTitle) ||
        "BẢN THUYẾT MINH BÁO CÁO TÀI CHÍNH",
    },
    periodFrom: output.periodFrom,
    periodTo: output.periodTo,
    columns: [
      { columnLabel: "Mã", width: 44 },
      { columnLabel: "Khoản mục thuyết minh", width: "*" },
      { columnLabel: "Chỉ tiêu", width: 92 },
      { columnLabel: "Số liệu", width: 76, numberFormat: "#,##0;(#,##0);-" },
      { columnLabel: "Trạng thái", width: 72 },
    ],
    rows,
    warnings: output.warnings,
  };
  return renderAccountingReportPdf(converted);
}
