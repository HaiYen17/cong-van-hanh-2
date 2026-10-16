import assert from "node:assert/strict";
import test from "node:test";
import {
  buildShelfReportComparisonDocument,
  buildShelfWarehouseReportDocument,
  type ShelfReportComparison,
  type ShelfWarehouseReport,
} from "./shelf-report";

const report: ShelfWarehouseReport = {
  generatedAt: "2026-09-05T08:00:00+07:00",
  preparedBy: "Quản kho",
  warehouse: "Kho chính",
  shelves: [
    { entityType: "SHELF", floorCount: 5, excludedReadCount: 0, operatorName: "An", sessionId: "session-a", shelfCode: "A1", shelfId: "a", shelfName: "Kệ A1", submittedAt: "2026-09-05T07:30:00+07:00", lines: [
      { floor: 1, sku: "SKU-1", name: "Áo <script>", quantity: 2 },
      { floor: 5, sku: "SKU-2", name: "Quần", quantity: 3 },
    ] },
    { entityType: "VEHICLE", floorCount: 0, excludedReadCount: 1, operatorName: "Bình", sessionId: "session-b", shelfCode: "XE2", shelfId: "b", shelfName: "Xe 02", submittedAt: "2026-09-05T07:40:00+07:00", lines: [{ floor: 0, sku: "SKU-3", name: "Nệm", quantity: 1 }] },
  ],
};

test("báo cáo Kệ/Xe dùng số tầng cấu hình, giữ chữ ký và thoát HTML", () => {
  const html = buildShelfWarehouseReportDocument(report, "END");
  assert(html.includes("Báo cáo kiểm kê cuối kỳ theo Kệ/Xe"));
  assert(html.indexOf("Kệ A1") < html.indexOf("Xe 02"));
  assert(html.indexOf("Tầng 5") < html.indexOf("Tầng 2"));
  assert(html.indexOf("Tầng 2") < html.indexOf("Tầng 1"));
  assert(html.includes("Hàng hóa trên xe"));
  assert(!html.includes("Tầng 0"));
  assert(html.includes("Người lập báo cáo"));
  assert(html.includes("Người xác nhận"));
  assert(html.includes("6 sản phẩm"));
  assert(html.includes("Áo &lt;script&gt;"));
  assert(!html.includes("Áo <script>"));
});

test("bản in so sánh giữ thứ tự tầng, phạm vi và thoát HTML", () => {
  const comparison: ShelfReportComparison = {
    inputReport: { createdAt: report.generatedAt, name: "Đầu <vào>", preparedBy: "An", reportId: "in", shelfCount: 1, skuCount: 1, totalQuantity: 2, warehouse: report.warehouse },
    outputReport: { createdAt: report.generatedAt, name: "Đầu ra", preparedBy: "Bình", reportId: "out", shelfCount: 2, skuCount: 1, totalQuantity: 3, warehouse: report.warehouse },
    shelves: [{ configurationChanged: false, entityType: "SHELF", floorCount: 3, difference: 1, inputPresent: true, inputQuantity: 2, outputPresent: true, outputQuantity: 3, shelfCode: "A1", shelfId: "a", shelfName: "Kệ A1", floors: [3, 2, 1].map((floor) => ({ difference: floor === 3 ? 1 : 0, floor, inputQuantity: floor === 3 ? 2 : 0, outputQuantity: floor === 3 ? 3 : 0, lines: floor === 3 ? [{ difference: 1, floor, inputQuantity: 2, name: "Áo <script>", outputQuantity: 3, quantity: 3, sku: "SKU-1" }] : [] })) }],
    summary: { changedLineCount: 1, changedShelfCount: 1, differenceQuantity: 1, inputQuantity: 2, inputShelfCount: 1, outputQuantity: 3, outputShelfCount: 2, shelfCount: 1 },
    warehouse: report.warehouse,
  };
  const html = buildShelfReportComparisonDocument(comparison);
  assert(html.includes("1 → 2 Kệ/Xe"));
  assert(html.indexOf("Tầng 3") < html.indexOf("Tầng 2"));
  assert(html.includes("Đầu &lt;vào&gt;"));
  assert(html.includes("Áo &lt;script&gt;"));
  assert(!html.includes("Áo <script>"));
});
