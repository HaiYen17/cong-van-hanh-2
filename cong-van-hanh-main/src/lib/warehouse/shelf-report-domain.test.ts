import assert from "node:assert/strict";
import test from "node:test";
import {
  compareShelfWarehouseReports,
  type ShelfReportSession,
  type ShelfWarehouseReport,
} from "./shelf-report-domain";

const shelf = (
  shelfId: string,
  shelfCode: string,
  lines: ShelfReportSession["lines"],
  entityType: "SHELF" | "VEHICLE" = "SHELF",
  floorCount = entityType === "VEHICLE" ? 0 : 3,
): ShelfReportSession => ({
  entityType,
  excludedReadCount: 0,
  floorCount,
  lines,
  operatorName: "Quản kho",
  sessionId: `session-${shelfId}`,
  shelfCode,
  shelfId,
  shelfName: `Kệ ${shelfCode}`,
  submittedAt: "2026-09-05T01:00:00.000Z",
});

const report = (
  reportId: string,
  shelves: ShelfReportSession[],
  warehouse = "Kho A",
): ShelfWarehouseReport => ({
  createdAt: "2026-09-05T01:00:00.000Z",
  generatedAt: "2026-09-05T01:00:00.000Z",
  name: reportId,
  preparedBy: "Quản kho",
  reportId,
  shelves,
  warehouse,
});

test("so sánh giữ kệ rỗng và đánh dấu kệ chỉ có ở một phía", () => {
  const input = report("input", [shelf("empty", "A2", []), shelf("only-in", "A10", [])]);
  const output = report("output", [shelf("empty", "A2", []), shelf("only-out", "A3", [])]);
  const result = compareShelfWarehouseReports(input, output);
  assert.deepEqual(result.shelves.map((item) => item.shelfCode), ["A2", "A3", "A10"]);
  assert.equal(result.shelves[0].inputPresent, true);
  assert.equal(result.shelves[0].outputPresent, true);
  assert.equal(result.shelves[1].inputPresent, false);
  assert.equal(result.shelves[2].outputPresent, false);
  assert.deepEqual(result.shelves[0].floors.map((item) => item.floor), [3, 2, 1]);
  assert.equal(result.summary.changedShelfCount, 2);
  assert.equal(result.summary.inputShelfCount, 2);
  assert.equal(result.summary.outputShelfCount, 2);
});

test("SKU chuyển tầng tạo hai dòng đổi nhưng tổng kệ không đổi", () => {
  const input = report("input", [shelf("a", "A1", [{ floor: 3, name: "Áo", quantity: 5, sku: "SKU-A" }])]);
  const output = report("output", [shelf("a", "A1", [{ floor: 2, name: "Áo", quantity: 5, sku: "sku-a" }])]);
  const result = compareShelfWarehouseReports(input, output);
  assert.equal(result.summary.changedLineCount, 2);
  assert.equal(result.summary.changedShelfCount, 1);
  assert.equal(result.summary.differenceQuantity, 0);
  assert.equal(result.shelves[0].floors[0].lines[0].difference, -5);
  assert.equal(result.shelves[0].floors[1].lines[0].difference, 5);
});

test("kệ dùng số tầng cấu hình và xe dùng vị trí không tầng", () => {
  const input = report("input", [
    shelf("tall", "A5", [{ floor: 5, name: "Áo", quantity: 2, sku: "SKU-A" }], "SHELF", 5),
    shelf("truck", "XE1", [{ floor: 0, name: "Quần", quantity: 4, sku: "SKU-B" }], "VEHICLE"),
  ]);
  const output = report("output", [
    shelf("tall", "A5", [{ floor: 5, name: "Áo", quantity: 3, sku: "SKU-A" }], "SHELF", 5),
    shelf("truck", "XE1", [{ floor: 0, name: "Quần", quantity: 4, sku: "SKU-B" }], "VEHICLE"),
  ]);
  const result = compareShelfWarehouseReports(input, output);
  assert.deepEqual(result.shelves[0].floors.map((item) => item.floor), [5, 4, 3, 2, 1]);
  assert.deepEqual(result.shelves[1].floors.map((item) => item.floor), [0]);
  assert.equal(result.shelves[1].entityType, "VEHICLE");
  assert.equal(result.summary.changedShelfCount, 1);
});

test("đổi số tầng được tính là thay đổi cấu hình", () => {
  const input = report("input", [shelf("a", "A1", [], "SHELF", 3)]);
  const output = report("output", [shelf("a", "A1", [], "SHELF", 5)]);
  const result = compareShelfWarehouseReports(input, output);
  assert.equal(result.shelves[0].configurationChanged, true);
  assert.deepEqual(result.shelves[0].floors.map((item) => item.floor), [5, 4, 3, 2, 1]);
  assert.equal(result.summary.changedShelfCount, 1);
});

test("đầu vào, đầu ra phải khác nhau và cùng kho", () => {
  const base = report("same", [shelf("a", "A1", [])]);
  assert.throws(() => compareShelfWarehouseReports(base, base), /hai báo cáo khác nhau/);
  assert.throws(
    () => compareShelfWarehouseReports(report("input", []), report("output", [], "Kho B")),
    /cùng một kho/,
  );
});
