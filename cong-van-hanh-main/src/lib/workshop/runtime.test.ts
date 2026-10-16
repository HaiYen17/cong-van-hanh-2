import assert from "node:assert/strict";
import test from "node:test";

import { workshopRuntimeTest } from "./runtime";

test("dựng tuần kế hoạch đúng từ thứ Hai đến Chủ nhật", () => {
  const week = workshopRuntimeTest.buildWeek(new Date("2026-08-05T00:00:00.000Z"));
  assert.equal(week.startDate, "2026-08-03");
  assert.equal(week.endDate, "2026-08-09");
  assert.equal(week.dayLabels.length, 7);
  assert.deepEqual(
    week.dayLabels.map((item) => item.key),
    ["T2", "T3", "T4", "T5", "T6", "T7", "CN"],
  );
});

test("dựng tuần vận hành đơn đặt gồm T7 tuần trước đến CN tuần hiện tại", () => {
  const week = workshopRuntimeTest.operationalWeek(
    workshopRuntimeTest.buildWeek(new Date("2026-08-05T00:00:00.000Z")),
  );
  assert.equal(week.operationalStartDate, "2026-08-01");
  assert.equal(week.operationalEndDate, "2026-08-09");
  assert.equal(week.operationalDayLabels.length, 9);
});

test("dựng lịch Tổ May từ T7 tuần trước đến T6", () => {
  const week = workshopRuntimeTest.sewingWeek(
    workshopRuntimeTest.buildWeek(new Date("2026-08-05T00:00:00.000Z")),
  );
  assert.equal(week.displayStartDate, "2026-08-01");
  assert.equal(week.displayEndDate, "2026-08-07");
  assert.deepEqual(
    week.dayLabels.map((item) => item.key),
    ["T7", "CN", "T2", "T3", "T4", "T5", "T6"],
  );
});

test("chuẩn hóa khóa tiếng Việt và tách mô tả SKU", () => {
  assert.equal(workshopRuntimeTest.normalizedKey("Tổ Cao su"), "to-cao-su");
  const parsed = workshopRuntimeTest.parseSkuDescriptor(
    "Nệm Thuần Việt 10cm / 160x200cm",
  );
  assert.equal(parsed.productName, "Nệm Thuần Việt");
  assert.equal(parsed.thickness, "10cm");
  assert.equal(parsed.size, "160x200cm");
});
