import assert from "node:assert/strict";
import test from "node:test";

import { evaluationInstanceIsUnstarted } from "@/lib/evaluation/runtime";

test("chỉ đồng bộ phiếu chưa có dữ liệu đánh giá", () => {
  const assigned = {
    content: {
      activeStepRoles: ["self", "manager"],
      employeeReviewStatus: "assigned",
      managerReviewStatus: "assigned",
      status: "in_progress",
    },
    status: "in_progress",
  };

  assert.equal(
    evaluationInstanceIsUnstarted(assigned, [
      { content: { employeeScore: "", managerScore: "" } },
    ]),
    true,
  );
  assert.equal(
    evaluationInstanceIsUnstarted(assigned, [
      { content: { employeeScore: 0, managerScore: "" } },
    ]),
    false,
    "0 điểm vẫn là dữ liệu người dùng đã nhập",
  );
  assert.equal(
    evaluationInstanceIsUnstarted(
      {
        ...assigned,
        content: { ...assigned.content, decisionAnswers: { self: { note: "Đã làm" } } },
      },
      [],
    ),
    false,
  );
  assert.equal(
    evaluationInstanceIsUnstarted(
      {
        ...assigned,
        content: { ...assigned.content, employeeReviewStatus: "draft" },
      },
      [],
    ),
    false,
  );
});
