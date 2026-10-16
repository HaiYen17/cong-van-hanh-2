import assert from "node:assert/strict";
import test from "node:test";

import { isPendingEvaluationFor } from "./dashboard-badge";

test("badge chỉ đếm đúng lượt đang chờ của nhân sự", () => {
  assert.equal(
    isPendingEvaluationFor(
      {
        activeStepRoles: ["self"],
        employeeCode: "NV001",
        employeeReviewStatus: "pending",
      },
      "NV001",
    ),
    true,
  );
  assert.equal(
    isPendingEvaluationFor(
      {
        activeStepRoles: ["self"],
        employeeCode: "NV001",
        employeeReviewStatus: "submitted",
      },
      "NV001",
    ),
    false,
  );
  assert.equal(
    isPendingEvaluationFor(
      {
        activeStepRoles: ["manager"],
        employeeCode: "NV001",
        managerEmployeeCode: "QL001",
      },
      "NV001",
    ),
    false,
  );
});

test("badge nhận diện đúng quản lý gián tiếp và bỏ phiếu đã hoàn tất", () => {
  assert.equal(
    isPendingEvaluationFor(
      {
        activeStepRoles: ["indirect_manager"],
        indirectManagerEmployeeCode: "M2001",
        indirectManagerReviewStatus: "active",
      },
      "M2001",
    ),
    true,
  );
  assert.equal(
    isPendingEvaluationFor(
      {
        activeStepRoles: ["indirect_manager"],
        indirectManagerEmployeeCode: "M2001",
        workflowCompleted: true,
      },
      "M2001",
    ),
    false,
  );
});

test("badge dùng assignment id để không báo nhầm người cùng vai trò", () => {
  const content = {
    activeReviewAssignmentIds: ["review-a"],
    reviewAssignments: [
      {
        employeeCode: "M2001",
        id: "review-a",
        role: "indirect_manager",
        stageIndex: 0,
        status: "assigned",
        stepIndex: 0,
        stepKey: "m2",
      },
      {
        employeeCode: "M2002",
        id: "review-b",
        role: "indirect_manager",
        stageIndex: 1,
        status: "assigned",
        stepIndex: 1,
        stepKey: "m3",
      },
    ],
  };
  assert.equal(isPendingEvaluationFor(content, "M2001"), true);
  assert.equal(isPendingEvaluationFor(content, "M2002"), false);
});
