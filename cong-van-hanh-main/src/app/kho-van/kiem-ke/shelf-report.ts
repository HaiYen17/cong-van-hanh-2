import type {
  ShelfReportComparison,
  ShelfWarehouseReport,
} from "@/lib/warehouse/shelf-report-domain";
import {
  shelfEntityType,
  shelfPositions,
} from "@/lib/warehouse/shelf-report-domain";

export type {
  ShelfReportComparison,
  ShelfReportLine,
  ShelfReportSession,
  ShelfSavedReportSummary,
  ShelfWarehouseReport,
} from "@/lib/warehouse/shelf-report-domain";

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

function dateTimeLabel(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).format(date);
}

const unitLabel = (entityType: "SHELF" | "VEHICLE") => entityType === "VEHICLE" ? "XE" : "KỆ";
const positionLabel = (floor: number) => floor === 0 ? "Hàng hóa trên xe" : `Tầng ${floor}`;
const emptyPositionLabel = (floor: number) => floor === 0 ? "Xe trống" : "Tầng trống";

export function buildShelfWarehouseReportDocument(
  report: ShelfWarehouseReport,
) {
  const totalQuantity = report.shelves.reduce(
    (sum, shelf) =>
      sum + shelf.lines.reduce((lineSum, line) => lineSum + line.quantity, 0),
    0,
  );
  const uniqueSkus = new Set(
    report.shelves.flatMap((shelf) => shelf.lines.map((line) => line.sku)),
  ).size;
  const shelfSections = report.shelves
    .map((shelf, shelfIndex) => {
      const entityType = shelfEntityType(shelf);
      const shelfTotal = shelf.lines.reduce(
        (sum, line) => sum + line.quantity,
        0,
      );
      const floors = shelfPositions(shelf)
        .map((floor) => {
          const lines = shelf.lines.filter((line) => line.floor === floor);
          const floorTotal = lines.reduce(
            (sum, line) => sum + line.quantity,
            0,
          );
          const rows = lines.length
            ? lines
                .map(
                  (line, index) => `<tr>
                    <td class="index">${index + 1}</td>
                    <td class="sku">${escapeHtml(line.sku)}</td>
                    <td>${escapeHtml(line.name || "Chưa có tên SKU")}</td>
                    <td class="quantity">${escapeHtml(numberLabel(line.quantity))}</td>
                    <td class="remarks"></td>
                  </tr>`,
                )
                .join("")
            : `<tr><td class="empty" colspan="5">${emptyPositionLabel(floor)}</td></tr>`;
          return `<section class="floor">
            <h3>${positionLabel(floor)}<span>${escapeHtml(numberLabel(floorTotal))} sản phẩm</span></h3>
            <table><thead><tr><th>STT</th><th>SKU</th><th>Hàng hóa</th><th>Số lượng</th><th>Ghi chú</th></tr></thead><tbody>${rows}</tbody></table>
          </section>`;
        })
        .join("");
      return `<article class="shelf${shelfIndex ? " page-break" : ""}">
        <header class="shelf-title">
          <div><small>${unitLabel(entityType)} ${shelfIndex + 1}/${report.shelves.length}</small><h2>${escapeHtml(shelf.shelfName)}</h2><p>${escapeHtml(shelf.shelfCode)}</p></div>
          <div class="shelf-total"><span>Tổng tại ${entityType === "VEHICLE" ? "xe" : "kệ"}</span><strong>${escapeHtml(numberLabel(shelfTotal))}</strong><small>sản phẩm</small></div>
        </header>
        <p class="session-meta">Người kiểm kê: <b>${escapeHtml(shelf.operatorName)}</b> · Nộp lúc ${escapeHtml(dateTimeLabel(shelf.submittedAt))} · Mã phiên: ${escapeHtml(shelf.sessionId)}</p>
        ${floors}
      </article>`;
    })
    .join("");
  const title = "Phiếu xuất chuyển kho";

  return `<!doctype html>
<html lang="vi" class="notranslate" translate="no" data-print-module="warehouse-shelf-inventory">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="google" content="notranslate"><title>${escapeHtml(title)}</title>
<style>
@font-face{font-family:"Be Vietnam Pro";font-style:normal;font-weight:400;font-display:block;src:url("/_next/static/media/53e45098eac42afb-s.p.1uklb5el4zgvl.woff2") format("woff2")}
@font-face{font-family:"Be Vietnam Pro";font-style:normal;font-weight:700;font-display:block;src:url("/_next/static/media/8ffc259da9d23054-s.p.10uaeld2xxvpt.woff2") format("woff2")}
@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#16332d;font-family:"Be Vietnam Pro",Arial,sans-serif;font-size:9.5pt;print-color-adjust:exact;-webkit-print-color-adjust:exact}.report{max-width:186mm;margin:auto}.report-title{text-align:center;text-transform:uppercase;margin:0 0 5mm;font-size:17pt}.report-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2.5mm 10mm;padding:4mm;border:0.3mm solid #bfd1cb;background:#f4f9f7;margin-bottom:7mm}.report-meta span{display:block;color:#5b746e;font-size:7.5pt;text-transform:uppercase}.report-meta strong{display:block;margin-top:1mm}.shelf{break-inside:auto}.page-break{break-before:page}.shelf-title{display:flex;align-items:center;justify-content:space-between;gap:8mm;padding:4mm 5mm;background:#115e59;color:#fff}.shelf-title small{font-size:7.5pt;letter-spacing:.08em;color:#a7f3d0}.shelf-title h2{font-size:18pt;margin:1mm 0}.shelf-title p{margin:0}.shelf-total{text-align:center;min-width:30mm}.shelf-total span,.shelf-total small{display:block;color:#ccfbf1}.shelf-total strong{display:block;font-size:19pt}.session-meta{margin:2.5mm 0 4mm;color:#526761;font-size:8pt}.floor{margin:0 0 4mm;break-inside:auto}.floor h3{display:flex;justify-content:space-between;margin:0;padding:2.4mm 3mm;background:#dfeae7;border:0.25mm solid #718b84;border-bottom:0;font-size:10pt}.floor h3 span{font-weight:400;color:#4b655e}table{width:100%;border-collapse:collapse;break-inside:auto;table-layout:fixed}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:0.25mm solid #718b84;padding:2.2mm 2.6mm;text-align:left;overflow-wrap:anywhere}th{background:#edf4f2;font-size:8pt}.index{width:11mm;text-align:center}.sku{width:30mm;font-weight:700}.quantity{width:22mm;text-align:center;font-weight:700}.remarks{width:30mm}.empty{text-align:center;color:#768982;padding:5mm}.signatures{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:30mm;margin-top:12mm;text-align:center;break-inside:avoid}.signatures small{display:block;margin-top:1mm;color:#657871}.signature-space{height:24mm}.note{margin-top:8mm;padding-top:3mm;border-top:0.2mm solid #d3ddda;color:#71817c;font-size:7.5pt}@media screen{html{background:#e7eae9}body{width:210mm;min-height:297mm;margin:8mm auto;padding:12mm;box-shadow:0 3mm 12mm #0003}}@media print{body{width:auto;padding:0}.report{max-width:none}}
</style></head><body><main class="report">
<h1 class="report-title">${escapeHtml(title)}</h1>
<section class="report-meta"><div><span>Khu vực kiểm kê</span><strong>${escapeHtml(report.warehouse)}</strong></div><div><span>Thời điểm lập</span><strong>${escapeHtml(dateTimeLabel(report.generatedAt))}</strong></div><div><span>Phạm vi</span><strong>${report.shelves.length} Kệ/Xe · ${uniqueSkus} SKU</strong></div><div><span>Tổng hàng hóa</span><strong>${escapeHtml(numberLabel(totalQuantity))} sản phẩm</strong></div></section>
${shelfSections}
<section class="signatures"><div><strong>Người lập báo cáo</strong><small>(Ký và ghi rõ họ tên)</small><div class="signature-space"></div><b>${escapeHtml(report.preparedBy)}</b></div><div><strong>Người xác nhận</strong><small>(Ký và ghi rõ họ tên)</small><div class="signature-space"></div><b>................................</b></div></section>
<p class="note">Báo cáo được tổng hợp từ ${report.shelves.length} phiên kiểm kê Kệ/Xe đã chọn. Kệ hiển thị các tầng từ cao xuống thấp theo cấu hình; Xe hiển thị hàng hóa trực tiếp, không chia tầng. Số lượng là kết quả sau điều chỉnh và nộp từ ứng dụng RFID.</p>
</main></body></html>`;
}

export function openShelfWarehouseReportPrint(
  report: ShelfWarehouseReport,
) {
  const documentUrl = URL.createObjectURL(new Blob(
    [buildShelfWarehouseReportDocument(report)],
    { type: "text/html;charset=utf-8" },
  ));
  const popup = window.open(documentUrl, "_blank", "width=980,height=760");
  if (!popup) { URL.revokeObjectURL(documentUrl); return false; }
  popup.opener = null;
  popup.addEventListener("load", () => {
    const printAfterFonts = async () => {
      try {
        await Promise.race([
          popup.document.fonts.ready.then(() => undefined),
          new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
        ]);
      } finally {
        window.setTimeout(() => {
          if (!popup.closed) popup.print();
          window.setTimeout(() => URL.revokeObjectURL(documentUrl), 1500);
        }, 120);
      }
    };
    void printAfterFonts();
  }, { once: true });
  return true;
}

export function buildShelfReportComparisonDocument(comparison: ShelfReportComparison) {
  const shelfSections = comparison.shelves.map((shelf, index) => {
    const floors = shelf.floors.map((floor) => {
      const rows = floor.lines.length
        ? floor.lines.map((line) => `<tr>
          <td class="sku">${escapeHtml(line.sku)}</td><td>${escapeHtml(line.name)}</td>
          <td class="quantity">${numberLabel(line.inputQuantity)}</td>
          <td class="quantity">${numberLabel(line.outputQuantity)}</td>
          <td class="quantity ${line.difference < 0 ? "negative" : line.difference > 0 ? "positive" : ""}">${line.difference > 0 ? "+" : ""}${numberLabel(line.difference)}</td>
        </tr>`).join("")
        : `<tr><td class="empty" colspan="5">${floor.floor === 0 ? "Xe trống" : "Tầng trống"} ở cả hai báo cáo</td></tr>`;
      return `<section class="floor"><h3>${positionLabel(floor.floor)}<span>${numberLabel(floor.inputQuantity)} → ${numberLabel(floor.outputQuantity)} (${floor.difference > 0 ? "+" : ""}${numberLabel(floor.difference)})</span></h3>
        <table><thead><tr><th>SKU</th><th>Hàng hóa</th><th>Đầu vào</th><th>Đầu ra</th><th>Chênh lệch</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    }).join("");
    const coverage = shelf.inputPresent && shelf.outputPresent ? "Có ở cả hai lần" : shelf.inputPresent ? "Chỉ có ở đầu vào" : "Chỉ có ở đầu ra";
    return `<article class="shelf${index ? " page-break" : ""}"><header class="shelf-title"><div><small>${unitLabel(shelf.entityType)} ${index + 1}/${comparison.shelves.length} · ${coverage}${shelf.configurationChanged ? " · Đã đổi cấu hình" : ""}</small><h2>${escapeHtml(shelf.shelfName)}</h2><p>${escapeHtml(shelf.shelfCode)}</p></div><div class="shelf-total"><span>Đầu vào → Đầu ra</span><strong>${numberLabel(shelf.inputQuantity)} → ${numberLabel(shelf.outputQuantity)}</strong><small>${shelf.difference > 0 ? "+" : ""}${numberLabel(shelf.difference)} sản phẩm</small></div></header>${floors}</article>`;
  }).join("");
  return `<!doctype html><html lang="vi" class="notranslate" translate="no" data-print-module="warehouse-shelf-comparison"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="google" content="notranslate"><title>So sánh kiểm kê toàn kho theo Kệ/Xe</title><style>
@font-face{font-family:"Be Vietnam Pro";font-style:normal;font-weight:400;font-display:block;src:url("/_next/static/media/53e45098eac42afb-s.p.1uklb5el4zgvl.woff2") format("woff2")}@font-face{font-family:"Be Vietnam Pro";font-style:normal;font-weight:700;font-display:block;src:url("/_next/static/media/8ffc259da9d23054-s.p.10uaeld2xxvpt.woff2") format("woff2")}@page{size:A4 portrait;margin:12mm}*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#16332d;font-family:"Be Vietnam Pro",Arial,sans-serif;font-size:9pt;print-color-adjust:exact;-webkit-print-color-adjust:exact}.report{max-width:186mm;margin:auto}.report-title{text-align:center;text-transform:uppercase;margin:0 0 5mm;font-size:17pt}.report-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3mm 8mm;padding:4mm;border:.3mm solid #bfd1cb;background:#f4f9f7;margin-bottom:7mm}.report-meta span{display:block;color:#5b746e;font-size:7.5pt;text-transform:uppercase}.report-meta strong{display:block;margin-top:1mm}.shelf{break-inside:auto}.page-break{break-before:page}.shelf-title{display:flex;align-items:center;justify-content:space-between;gap:8mm;padding:4mm 5mm;background:#115e59;color:#fff;margin-bottom:4mm}.shelf-title small{font-size:7.5pt;color:#a7f3d0}.shelf-title h2{font-size:17pt;margin:1mm 0}.shelf-title p{margin:0}.shelf-total{text-align:right}.shelf-total span,.shelf-total small{display:block;color:#ccfbf1}.shelf-total strong{display:block;font-size:13pt;margin:1mm 0}.floor{margin-bottom:4mm}.floor h3{display:flex;justify-content:space-between;margin:0;padding:2.4mm 3mm;background:#dfeae7;border:.25mm solid #718b84;border-bottom:0;font-size:10pt}.floor h3 span{font-weight:400;color:#4b655e}table{width:100%;border-collapse:collapse}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:.25mm solid #718b84;padding:2.1mm;text-align:left}th{background:#edf4f2;font-size:7.5pt}.sku{width:27mm;font-weight:700}.quantity{width:20mm;text-align:center}.positive{color:#047857;font-weight:700}.negative{color:#be123c;font-weight:700}.empty{text-align:center;color:#768982;padding:5mm}.note{margin-top:8mm;padding-top:3mm;border-top:.2mm solid #d3ddda;color:#71817c;font-size:7.5pt}@media screen{html{background:#e7eae9}body{width:210mm;min-height:297mm;margin:8mm auto;padding:12mm;box-shadow:0 3mm 12mm #0003}}@media print{body{width:auto;padding:0}.report{max-width:none}}</style></head><body><main class="report"><h1 class="report-title">So sánh kiểm kê toàn kho theo Kệ/Xe</h1><section class="report-meta"><div><span>Khu vực kiểm kê</span><strong>${escapeHtml(comparison.warehouse)}</strong></div><div><span>Phạm vi</span><strong>${comparison.summary.inputShelfCount} → ${comparison.summary.outputShelfCount} Kệ/Xe · ${comparison.summary.changedShelfCount} đơn vị thay đổi</strong></div><div><span>1 · Đầu vào</span><strong>${escapeHtml(comparison.inputReport.name)}</strong></div><div><span>2 · Đầu ra</span><strong>${escapeHtml(comparison.outputReport.name)}</strong></div><div><span>Tổng đầu vào</span><strong>${numberLabel(comparison.summary.inputQuantity)}</strong></div><div><span>Tổng đầu ra / chênh lệch</span><strong>${numberLabel(comparison.summary.outputQuantity)} / ${comparison.summary.differenceQuantity > 0 ? "+" : ""}${numberLabel(comparison.summary.differenceQuantity)}</strong></div></section>${shelfSections}<p class="note">Chênh lệch = Đầu ra − Đầu vào. Các Kệ/Xe, vị trí hoặc SKU chỉ có ở một báo cáo vẫn được hiển thị với số lượng 0 ở phía còn lại. Nếu phạm vi kiểm kê khác nhau, hãy kiểm tra trước khi kết luận hàng hóa tăng hoặc giảm.</p></main></body></html>`;
}

export function openShelfReportComparisonPrint(comparison: ShelfReportComparison) {
  const documentUrl = URL.createObjectURL(new Blob(
    [buildShelfReportComparisonDocument(comparison)],
    { type: "text/html;charset=utf-8" },
  ));
  const popup = window.open(documentUrl, "_blank", "width=980,height=760");
  if (!popup) { URL.revokeObjectURL(documentUrl); return false; }
  popup.opener = null;
  popup.addEventListener("load", () => {
    void Promise.race([
      popup.document.fonts.ready.then(() => undefined),
      new Promise<void>((resolve) => window.setTimeout(resolve, 3000)),
    ]).finally(() => window.setTimeout(() => {
      if (!popup.closed) popup.print();
      window.setTimeout(() => URL.revokeObjectURL(documentUrl), 1500);
    }, 120));
  }, { once: true });
  return true;
}
