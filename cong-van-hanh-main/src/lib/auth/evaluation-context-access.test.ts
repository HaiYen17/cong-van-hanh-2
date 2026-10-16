import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATION_CONTEXT_MODULE_KEY,
  EVALUATION_CONTEXT_PERMISSION,
  evaluationContentAssignsEmployee,
  grantEvaluationContext,
} from "./evaluation-context-access";

test("phân công đánh giá tự mở Module Đánh giá nhân sự", () => {
  const access = grantEvaluationContext({
    fullAccess: false,
    moduleGroups: ["nguoi-thuan-viet"],
    modules: ["my-orders"],
    permissions: [],
    roleKeys: ["employee"],
  });

  assert.deepEqual(access.modules, ["evaluation", "my-orders"]);
  assert.equal(access.modules.includes(EVALUATION_CONTEXT_MODULE_KEY), true);
  assert.equal(
    access.permissions.includes(EVALUATION_CONTEXT_PERMISSION),
    true,
  );
});

test("người đại diện công ty được nhận diện đúng từ trường Ban giám đốc", () => {
  assert.equal(
    evaluationContentAssignsEmployee(
      { bodEmployeeCode: "1810001", employeeCode: "2403247" },
      "1810001",
    ),
    true,
  );
  assert.equal(
    evaluationContentAssignsEmployee(
      { bodEmployeeCode: "1810001", employeeCode: "2403247" },
      "2509348",
    ),
    false,
  );
});

test("cấp quyền ngữ cảnh lặp lại không tạo dữ liệu trùng", () => {
  const once = grantEvaluationContext({
    fullAccess: false,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roleKeys: [],
  });
  assert.deepEqual(grantEvaluationContext(once), once);
});

test("QLGT được phân công có quyền ngữ cảnh nhưng không mở cho người khác", () => {
  const content = { indirectManagerEmployeeCode: " M2-123 ", employeeCode: "NV-001" };
  assert.equal(evaluationContentAssignsEmployee(content, "m2-123"), true);
  assert.equal(evaluationContentAssignsEmployee(content, " M2-123 "), true);
  assert.equal(evaluationContentAssignsEmployee(content, "M2-999"), false);
  assert.equal(evaluationContentAssignsEmployee(content, ""), false);
});
