import assert from "node:assert/strict";
import test from "node:test";

import { buildShelfWarehouseReportDocument } from "../../app/kho-van/kiem-ke/shelf-report";
import type { ShelfWarehouseReport } from "./shelf-report-domain";

const report: ShelfWarehouseReport = {
  generatedAt: "2026-09-11T02:00:00.000Z",
  preparedBy: "Nguyễn Minh Thông",
  warehouse: "Kho tổng",
  shelves: [
    {
      entityType: "SHELF",
      excludedReadCount: 0,
      floorCount: 3,
      lines: [
        { floor: 3, name: "Nệm Latex Premium", quantity: 5, sku: "LTPR10-6" },
      ],
      operatorName: "Nguyễn Minh Thông",
      sessionId: "shelf-test-1",
      shelfCode: "A-01",
      shelfId: "shelf-1",
      shelfName: "Kệ A-01",
      submittedAt: "2026-09-11T01:55:00.000Z",
    },
  ],
};

test("phiếu Kệ/Xe dùng tên xuất chuyển kho và có cột ghi chú", () => {
  const html = buildShelfWarehouseReportDocument(report);

  assert.match(html, /<title>Phiếu xuất chuyển kho<\/title>/);
  assert.match(html, /<h1 class="report-title">Phiếu xuất chuyển kho<\/h1>/);
  assert.match(html, /<th>Ghi chú<\/th>/);
  assert.match(html, /<td class="remarks"><\/td>/);
  assert.match(html, /colspan="5"/);
  assert.doesNotMatch(html, /đầu kỳ|cuối kỳ/i);
});
