import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalTodoOutputStatus,
  isTodoOutputOverdueForWeek,
  todoAssigneeEmployeeIds,
  todoAssigneeUserIds,
} from "./output";

test("không lấy trạng thái đơn mẹ đè lên đầu việc con còn chờ duyệt", () => {
  assert.equal(
    canonicalTodoOutputStatus("SUBMITTED", "COMPLETED"),
    "WAITING_REVIEW",
  );
  assert.equal(canonicalTodoOutputStatus("OPEN", "CANCELLED"), "OPEN");
});

test("việc tuần trước chưa xong luôn vào cột quá hạn", () => {
  assert.equal(
    isTodoOutputOverdueForWeek({
      dueAt: "2026-08-10",
      status: "OPEN",
      weekStart: "2026-08-17",
    }),
    true,
  );
  assert.equal(
    isTodoOutputOverdueForWeek({
      dueAt: "2026-08-10",
      status: "APPROVED",
      weekStart: "2026-08-17",
    }),
    false,
  );
});

test("đọc được cả người phụ trách cũ và danh sách nhiều người mới", () => {
  assert.deepEqual(
    todoAssigneeEmployeeIds({
      assigneeEmployeeId: "employee-1",
      assigneeEmployeeIds: ["employee-1", "employee-2"],
    }),
    ["employee-1", "employee-2"],
  );
  assert.deepEqual(
    todoAssigneeUserIds({ assigneeUserIds: ["user-1", "user-2"] }),
    ["user-1", "user-2"],
  );
});
