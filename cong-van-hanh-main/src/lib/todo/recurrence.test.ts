import assert from "node:assert/strict";
import test from "node:test";

import {
  formatTodoRepeatSchedule,
  isTodoRepeatDueOnDate,
  normalizeTodoRepeatSchedule,
  solarToVietnameseLunar,
  todoRecurringOccurrenceTitle,
} from "./recurrence";

test("đổi đúng các mốc Tết dương sang âm lịch Việt Nam", () => {
  assert.deepEqual(solarToVietnameseLunar("2024-02-10"), {
    day: 1,
    leap: false,
    month: 1,
    year: 2024,
  });
  assert.deepEqual(solarToVietnameseLunar("2026-02-17"), {
    day: 1,
    leap: false,
    month: 1,
    year: 2026,
  });
});

test("lịch tuần chỉ chạy đúng thứ đã chọn", () => {
  const schedule = normalizeTodoRepeatSchedule(
    { mode: "weekly", times: ["08:00"], weekdays: [1, 5] },
    "2026-08-14",
  );
  assert.ok(schedule);
  assert.equal(isTodoRepeatDueOnDate(schedule, "2026-08-14"), true);
  assert.equal(isTodoRepeatDueOnDate(schedule, "2026-08-15"), false);
  assert.equal(todoRecurringOccurrenceTitle("Kiểm tra kho", schedule, "2026-08-14"), "Tuần 33: Kiểm tra kho");
});

test("lịch tháng âm chạy theo ngày âm thay vì ngày dương", () => {
  const schedule = normalizeTodoRepeatSchedule(
    { calendar: "lunar", mode: "monthly", monthDays: [1], times: ["09:00"] },
    "2026-02-17",
  );
  assert.ok(schedule);
  assert.equal(isTodoRepeatDueOnDate(schedule, "2026-02-17"), true);
  assert.equal(isTodoRepeatDueOnDate(schedule, "2026-02-18"), false);
  assert.match(formatTodoRepeatSchedule(schedule), /Âm lịch/);
});
