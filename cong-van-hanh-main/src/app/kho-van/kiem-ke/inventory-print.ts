import type {
  WarehouseInventoryDetail,
  WarehouseInventoryPairComparisonData,
} from "@/lib/warehouse/types";

export type WarehouseInventoryPrintKind = "START" | "END";

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function numberLabel(value: number) {
  return new Intl.NumberFormat("vi-VN").format(value);
}

function signedNumberLabel(value: number) {
  if (value > 0) return `+${numberLabel(value)}`;
  return numberLabel(value);
}

function scanDateLabel(value: string) {
  const [year, month, day] = value.split("-");
  return day && month && year ? `${day}/${month}/${year}` : value;
}

function printedAtLabel(date: Date) {
  const datePart = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
  const timePart = new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
  }).format(date);
  return `${datePart} - ${timePart}`;
}

export function buildWarehouseInventoryPrintDocument(
  detail: WarehouseInventoryDetail,
  kind: WarehouseInventoryPrintKind,
  operatorName: string,
) {
  const title = `Biên bản kiểm kê ${kind === "START" ? "đầu kỳ" : "cuối kỳ"}`;
  const safeOperator =
    operatorName.trim() || "................................";
  const rows = detail.comparison
    .filter((line) => line.physicalQuantity > 0)
    .map(
      (line, index) => `
        <tr>
          <td class="inventory-cell inventory-cell--index">${index + 1}</td>
          <td class="inventory-cell inventory-cell--sku">${escapeHtml(line.sku)}</td>
          <td class="inventory-cell">${escapeHtml(line.name || "Chưa có tên SKU")}</td>
          <td class="inventory-cell inventory-cell--quantity">${escapeHtml(numberLabel(line.physicalQuantity))}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="vi" class="notranslate" translate="no" data-print-module="warehouse-inventory-statement">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="google" content="notranslate">
  <title>${escapeHtml(title)}</title>
  <style>
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("/_next/static/media/53e45098eac42afb-s.p.1uklb5el4zgvl.woff2") format("woff2");
      unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("/_next/static/media/85ea1b3aadcead52-s.05i4gb4p0piv4.woff2") format("woff2");
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("/_next/static/media/3c285486269019b7-s.p.2g-0we2o5_ngd.woff2") format("woff2");
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url("/_next/static/media/8ffc259da9d23054-s.p.10uaeld2xxvpt.woff2") format("woff2");
      unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url("/_next/static/media/9e486ba39c38fb8a-s.2bbpeapf-lbjw.woff2") format("woff2");
      unicode-range: U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url("/_next/static/media/6f42e0a3b0519c4d-s.p.13y-iz2lazqtb.woff2") format("woff2");
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @page inventory-statement-page {
      size: A4 portrait;
      margin: 0;
    }
    @page {
      size: A4 portrait;
      margin: 0;
    }
    :root {
      color-scheme: light;
      background: #fff;
      font-family: "Be Vietnam Pro", Arial, sans-serif;
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; margin: 0; padding: 0; background: #fff; }
    body {
      page: inventory-statement-page;
      color: #172f2a;
      font-family: "Be Vietnam Pro", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.42;
      font-synthesis: none;
      text-rendering: geometricPrecision;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .inventory-report { width: 100%; margin: 0 auto; }
    .inventory-title {
      margin: 0 0 9mm;
      color: #102f29;
      font-size: 17pt;
      font-weight: 700;
      letter-spacing: .02em;
      line-height: 1.2;
      text-align: center;
      text-transform: uppercase;
    }
    .inventory-meta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 3.2mm 12mm;
      margin-bottom: 7mm;
      padding: 4.5mm 5mm;
      border: 0.3mm solid #c6d2ce;
      background: #f7faf9;
    }
    .inventory-meta__item { min-width: 0; }
    .inventory-meta__label {
      display: block;
      margin-bottom: 1mm;
      color: #547069;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: .035em;
      text-transform: uppercase;
    }
    .inventory-meta__value {
      display: block;
      color: #173f37;
      font-size: 10pt;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .inventory-table {
      width: 100%;
      border-collapse: collapse;
      border: 0.35mm solid #647a74;
      page-break-inside: auto;
    }
    .inventory-table thead { display: table-header-group; }
    .inventory-table tr { break-inside: avoid; page-break-inside: avoid; }
    .inventory-table th,
    .inventory-cell {
      border: 0.25mm solid #738680;
      padding: 2.7mm 3mm;
      line-height: 1.35;
      vertical-align: middle;
    }
    .inventory-table th {
      color: #153f37;
      background: #e9f1ef;
      font-size: 9pt;
      font-weight: 700;
      text-align: left;
    }
    .inventory-cell { color: #263f39; font-size: 9.5pt; }
    .inventory-cell--index { width: 12mm; text-align: center; }
    .inventory-cell--sku { width: 38mm; font-weight: 700; }
    .inventory-cell--quantity { width: 35mm; font-weight: 700; text-align: center; }
    .inventory-empty { padding: 10mm 4mm; color: #64766f; text-align: center; }
    .inventory-total {
      margin: 3.5mm 0 0;
      color: #153f37;
      font-size: 10pt;
      font-weight: 700;
      text-align: right;
    }
    .inventory-signatures {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 28mm;
      margin-top: 16mm;
      break-inside: avoid;
      page-break-inside: avoid;
      text-align: center;
    }
    .inventory-signatures strong { display: block; font-size: 10.5pt; }
    .inventory-signatures em {
      display: block;
      margin-top: 1mm;
      color: #526761;
      font-size: 8.5pt;
      font-weight: 400;
    }
    .inventory-signatures__space { height: 27mm; }
    .inventory-signatures__name { min-height: 6mm; font-size: 10pt; font-weight: 700; }
    .inventory-note {
      margin: 9mm 0 0;
      padding-top: 3mm;
      border-top: 0.25mm solid #d6dfdc;
      color: #667a74;
      font-size: 8pt;
      line-height: 1.45;
    }
    @media screen {
      html { background: #e7eae9; }
      body {
        width: 210mm;
        min-height: 297mm;
        margin: 8mm auto;
        padding: 15mm 14mm 14mm;
        box-shadow: 0 3mm 12mm rgb(0 0 0 / 18%);
      }
    }
    @media print {
      html, body { width: 210mm; min-height: 297mm; background: #fff; }
      body {
        margin: 0;
        padding: 15mm 14mm 14mm;
        box-shadow: none;
      }
    }
  </style>
</head>
<body class="notranslate" translate="no">
  <main class="inventory-report">
    <h1 class="inventory-title">${escapeHtml(title)}</h1>
    <section class="inventory-meta" aria-label="Thông tin biên bản">
      <div class="inventory-meta__item"><span class="inventory-meta__label">Tên biên bản</span><span class="inventory-meta__value">${escapeHtml(title)}</span></div>
      <div class="inventory-meta__item"><span class="inventory-meta__label">Ngày in bảng</span><span class="inventory-meta__value">${escapeHtml(printedAtLabel(new Date()))}</span></div>
      <div class="inventory-meta__item"><span class="inventory-meta__label">Người kiểm kê</span><span class="inventory-meta__value">${escapeHtml(safeOperator)}</span></div>
      <div class="inventory-meta__item"><span class="inventory-meta__label">Mã phiên</span><span class="inventory-meta__value">${escapeHtml(detail.sessionKey)}</span></div>
    </section>
    <table class="inventory-table">
      <thead><tr><th class="inventory-cell--index">STT</th><th class="inventory-cell--sku">Mã SKU</th><th>Tên SKU</th><th class="inventory-cell--quantity">Số lượng kiểm kê</th></tr></thead>
      <tbody>${rows || '<tr><td class="inventory-empty" colspan="4">Không có SKU đã quét</td></tr>'}</tbody>
    </table>
    <p class="inventory-total">Tổng cộng: ${escapeHtml(numberLabel(detail.summary.inStockRfidCount))} sản phẩm / ${escapeHtml(numberLabel(detail.summary.physicalSkuCount))} SKU</p>
    <section class="inventory-signatures" aria-label="Ký xác nhận">
      <div><strong>Người kiểm kê</strong><em>(Ký, ghi rõ họ tên)</em><div class="inventory-signatures__space"></div><div class="inventory-signatures__name">${escapeHtml(safeOperator)}</div></div>
      <div><strong>Xác nhận kế toán</strong><em>(Ký, ghi rõ họ tên)</em><div class="inventory-signatures__space"></div><div class="inventory-signatures__name">................................</div></div>
    </section>
    <p class="inventory-note">Biên bản được lập từ dữ liệu RFID đã nhận diện trong Cổng vận hành Thuần Việt.</p>
  </main>
</body>
</html>`;
}

export function buildWarehouseInventoryComparisonPrintDocument(
  comparison: WarehouseInventoryPairComparisonData,
  operatorName: string,
) {
  const title = "Biên bản so sánh kiểm kê";
  const safeOperator =
    operatorName.trim() || "................................";
  const rows = comparison.lines
    .map(
      (line) => `
        <tr>
          <td class="inventory-cell inventory-cell--sku">${escapeHtml(line.sku)}</td>
          <td class="inventory-cell">${escapeHtml(line.name)}</td>
          <td class="inventory-cell inventory-cell--quantity">${escapeHtml(numberLabel(line.inputQuantity))}</td>
          <td class="inventory-cell inventory-cell--quantity">${escapeHtml(numberLabel(line.outputQuantity))}</td>
          <td class="inventory-cell inventory-cell--quantity ${line.difference > 0 ? "inventory-cell--increase" : line.difference < 0 ? "inventory-cell--decrease" : ""}">${escapeHtml(signedNumberLabel(line.difference))}</td>
        </tr>`,
    )
    .join("");

  return `<!doctype html>
<html lang="vi" class="notranslate" translate="no" data-print-module="warehouse-inventory-comparison">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="google" content="notranslate">
  <title>${escapeHtml(title)}</title>
  <style>
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("/_next/static/media/53e45098eac42afb-s.p.1uklb5el4zgvl.woff2") format("woff2");
      unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 400;
      font-display: block;
      src: url("/_next/static/media/3c285486269019b7-s.p.2g-0we2o5_ngd.woff2") format("woff2");
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url("/_next/static/media/8ffc259da9d23054-s.p.10uaeld2xxvpt.woff2") format("woff2");
      unicode-range: U+0102-0103, U+0110-0111, U+0128-0129, U+0168-0169, U+01A0-01A1, U+01AF-01B0, U+0300-0301, U+0303-0304, U+0308-0309, U+0323, U+0329, U+1EA0-1EF9, U+20AB;
    }
    @font-face {
      font-family: "Be Vietnam Pro";
      font-style: normal;
      font-weight: 700;
      font-display: block;
      src: url("/_next/static/media/6f42e0a3b0519c4d-s.p.13y-iz2lazqtb.woff2") format("woff2");
      unicode-range: U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD;
    }
    @page { size: A4 portrait; margin: 0; }
    :root { color-scheme: light; background: #fff; font-family: "Be Vietnam Pro", Arial, sans-serif; }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { width: 100%; margin: 0; padding: 0; background: #fff; }
    body {
      color: #172f2a;
      font-family: "Be Vietnam Pro", Arial, sans-serif;
      font-size: 10.5pt;
      line-height: 1.42;
      font-synthesis: none;
      text-rendering: geometricPrecision;
      print-color-adjust: exact;
      -webkit-print-color-adjust: exact;
    }
    .inventory-report { width: 100%; margin: 0 auto; }
    .inventory-title {
      margin: 0 0 9mm;
      color: #102f29;
      font-size: 17pt;
      font-weight: 700;
      letter-spacing: .02em;
      line-height: 1.2;
      text-align: center;
      text-transform: uppercase;
    }
    .inventory-meta {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 3.2mm 12mm;
      margin-bottom: 7mm;
      padding: 4.5mm 5mm;
      border: 0.3mm solid #c6d2ce;
      background: #f7faf9;
    }
    .inventory-meta__item { min-width: 0; }
    .inventory-meta__label {
      display: block;
      margin-bottom: 1mm;
      color: #547069;
      font-size: 8pt;
      font-weight: 700;
      letter-spacing: .035em;
      text-transform: uppercase;
    }
    .inventory-meta__value {
      display: block;
      color: #173f37;
      font-size: 9.5pt;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .inventory-table { width: 100%; border-collapse: collapse; border: 0.35mm solid #647a74; }
    .inventory-table thead { display: table-header-group; }
    .inventory-table tr { break-inside: avoid; page-break-inside: avoid; }
    .inventory-table th, .inventory-cell {
      border: 0.25mm solid #738680;
      padding: 2.7mm 2.6mm;
      line-height: 1.35;
      vertical-align: middle;
    }
    .inventory-table th {
      color: #153f37;
      background: #e9f1ef;
      font-size: 8.6pt;
      font-weight: 700;
      text-align: left;
    }
    .inventory-cell { color: #263f39; font-size: 9pt; }
    .inventory-cell--sku { width: 33mm; font-weight: 700; }
    .inventory-cell--quantity { width: 24mm; font-weight: 700; text-align: center; }
    .inventory-cell--increase { color: #176b50; }
    .inventory-cell--decrease { color: #a13f35; }
    .inventory-empty { padding: 10mm 4mm; color: #64766f; text-align: center; }
    .inventory-total {
      margin: 3.5mm 0 0;
      color: #153f37;
      font-size: 9.5pt;
      font-weight: 700;
      text-align: right;
    }
    .inventory-signatures {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 28mm;
      margin-top: 16mm;
      break-inside: avoid;
      page-break-inside: avoid;
      text-align: center;
    }
    .inventory-signatures strong { display: block; font-size: 10.5pt; }
    .inventory-signatures em { display: block; margin-top: 1mm; color: #526761; font-size: 8.5pt; font-weight: 400; }
    .inventory-signatures__space { height: 27mm; }
    .inventory-signatures__name { min-height: 6mm; font-size: 10pt; font-weight: 700; }
    .inventory-note {
      margin: 9mm 0 0;
      padding-top: 3mm;
      border-top: 0.25mm solid #d6dfdc;
      color: #667a74;
      font-size: 8pt;
      line-height: 1.45;
    }
    @media screen {
      html { background: #e7eae9; }
      body { width: 210mm; min-height: 297mm; margin: 8mm auto; padding: 15mm 14mm 14mm; box-shadow: 0 3mm 12mm rgb(0 0 0 / 18%); }
    }
    @media print {
      html, body { width: 210mm; min-height: 297mm; background: #fff; }
      body { margin: 0; padding: 15mm 14mm 14mm; box-shadow: none; }
    }
  </style>
</head>
<body class="notranslate" translate="no">
  <main class="inventory-report">
    <h1 class="inventory-title">${escapeHtml(title)}</h1>
    <section class="inventory-meta" aria-label="Thông tin so sánh">
      <div class="inventory-meta__item"><span class="inventory-meta__label">1 · Đầu vào</span><span class="inventory-meta__value">${escapeHtml(comparison.inputSession.sessionKey)} · ${escapeHtml(scanDateLabel(comparison.inputSession.scanDate))}</span></div>
      <div class="inventory-meta__item"><span class="inventory-meta__label">2 · Đầu ra</span><span class="inventory-meta__value">${escapeHtml(comparison.outputSession.sessionKey)} · ${escapeHtml(scanDateLabel(comparison.outputSession.scanDate))}</span></div>
      <div class="inventory-meta__item"><span class="inventory-meta__label">Ngày in bảng</span><span class="inventory-meta__value">${escapeHtml(printedAtLabel(new Date()))}</span></div>
      <div class="inventory-meta__item"><span class="inventory-meta__label">Người kiểm kê</span><span class="inventory-meta__value">${escapeHtml(safeOperator)}</span></div>
    </section>
    <table class="inventory-table">
      <thead><tr><th class="inventory-cell--sku">Mã SKU</th><th>Tên hàng hóa</th><th class="inventory-cell--quantity">Đầu vào</th><th class="inventory-cell--quantity">Đầu ra</th><th class="inventory-cell--quantity">Chênh lệch</th></tr></thead>
      <tbody>${rows || '<tr><td class="inventory-empty" colspan="5">Không có SKU để so sánh</td></tr>'}</tbody>
    </table>
    <p class="inventory-total">Tổng đầu vào: ${escapeHtml(numberLabel(comparison.summary.inputQuantity))} · Tổng đầu ra: ${escapeHtml(numberLabel(comparison.summary.outputQuantity))} · Chênh lệch: ${escapeHtml(signedNumberLabel(comparison.summary.differenceQuantity))}</p>
    <section class="inventory-signatures" aria-label="Ký xác nhận">
      <div><strong>Người kiểm kê</strong><em>(Ký, ghi rõ họ tên)</em><div class="inventory-signatures__space"></div><div class="inventory-signatures__name">${escapeHtml(safeOperator)}</div></div>
      <div><strong>Xác nhận kế toán</strong><em>(Ký, ghi rõ họ tên)</em><div class="inventory-signatures__space"></div><div class="inventory-signatures__name">................................</div></div>
    </section>
    <p class="inventory-note">Chênh lệch được tính bằng số lượng đầu ra trừ số lượng đầu vào, dựa trên RFID đã nhận diện theo SKU.</p>
  </main>
</body>
</html>`;
}

function openWarehousePrintDocument(documentHtml: string) {
  const documentUrl = URL.createObjectURL(
    new Blob([documentHtml], { type: "text/html;charset=utf-8" }),
  );
  const printWindow = window.open(
    documentUrl,
    "_blank",
    "width=980,height=760",
  );
  if (!printWindow) {
    URL.revokeObjectURL(documentUrl);
    return false;
  }
  printWindow.opener = null;
  printWindow.addEventListener(
    "load",
    () => {
      const printAfterFontReady = async () => {
        try {
          await Promise.race([
            printWindow.document.fonts.ready.then(() => undefined),
            new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
          ]);
        } finally {
          window.setTimeout(() => {
            if (!printWindow.closed) printWindow.print();
            window.setTimeout(() => URL.revokeObjectURL(documentUrl), 1500);
          }, 120);
        }
      };
      void printAfterFontReady();
    },
    { once: true },
  );
  return true;
}

export function openWarehouseInventoryStatementPrint(
  detail: WarehouseInventoryDetail,
  kind: WarehouseInventoryPrintKind,
  operatorName: string,
) {
  return openWarehousePrintDocument(
    buildWarehouseInventoryPrintDocument(detail, kind, operatorName),
  );
}

export function openWarehouseInventoryComparisonPrint(
  comparison: WarehouseInventoryPairComparisonData,
  operatorName: string,
) {
  return openWarehousePrintDocument(
    buildWarehouseInventoryComparisonPrintDocument(comparison, operatorName),
  );
}
