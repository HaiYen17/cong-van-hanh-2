import assert from "node:assert/strict";
import test from "node:test";

import { decisionFieldMatchesEvaluationScope } from "@/lib/evaluation/runtime";

function scopedRecord(
  recordType: string,
  id: string,
  content: Record<string, unknown>,
  status = "active",
) {
  return {
    code: id,
    content,
    id,
    legacyId: null,
    parentId: null,
    recordType,
    status,
  };
}

test("phiếu chỉ nhận câu hỏi active thuộc đúng Loại đánh giá", () => {
  const cycleType = scopedRecord(
    "evaluation-cycle-type-template",
    "TYPE_CURRENT",
    { code: "TYPE_CURRENT", id: "TYPE_CURRENT" },
  );
  const cycle = scopedRecord("evaluation-cycle", "CYCLE_CURRENT", {
    cycleTypeTemplateId: "TYPE_CURRENT",
  });
  const instance = scopedRecord("evaluation-instance", "INSTANCE_CURRENT", {
    cycleId: "CYCLE_CURRENT",
  });
  const scope = { cycle, cycleType, instance };

  assert.equal(
    decisionFieldMatchesEvaluationScope(
      scopedRecord("evaluation-decision-field", "FIELD_CURRENT", {
        cycleTypeTemplateId: "TYPE_CURRENT",
        isActive: true,
      }),
      scope,
    ),
    true,
  );
  assert.equal(
    decisionFieldMatchesEvaluationScope(
      scopedRecord("evaluation-decision-field", "FIELD_OTHER", {
        cycleTypeTemplateId: "TYPE_OLD",
        isActive: true,
      }),
      scope,
    ),
    false,
  );
  assert.equal(
    decisionFieldMatchesEvaluationScope(
      scopedRecord(
        "evaluation-decision-field",
        "FIELD_DELETED",
        { cycleTypeTemplateId: "TYPE_CURRENT", isActive: false },
        "inactive",
      ),
      scope,
    ),
    false,
  );
});
