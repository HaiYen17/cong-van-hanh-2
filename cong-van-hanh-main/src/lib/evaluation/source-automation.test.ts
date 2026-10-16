import assert from "node:assert/strict";
import test from "node:test";

import {
  autoMapEvaluationAutomationHeaders,
  normalizeEvaluationAutomationSourceConfig,
} from "@/lib/evaluation/source-automation";

test("tự nhận đúng cột M1, M2 và M3 của sheet Data quản lý", () => {
  const mappings = autoMapEvaluationAutomationHeaders([
    "Mã nhân sự",
    "Nhân sự",
    "Quản lý (M1)",
    "Quản lý (M2)",
    "Quản lý (M3)",
  ]);
  assert.equal(mappings.employeeCode, "Mã nhân sự");
  assert.equal(mappings.employeeName, "Nhân sự");
  assert.equal(mappings.manager, "Quản lý (M1)");
  assert.equal(mappings.indirectManager, "Quản lý (M2)");
  assert.equal(mappings.indirectManager2, "Quản lý (M3)");
  assert.equal(mappings.bod, undefined);
});

test("sheet phân cấp mặc định là Data quản lý", () => {
  const config = normalizeEvaluationAutomationSourceConfig({
    automationSourceLink:
      "https://docs.google.com/spreadsheets/d/12345678901234567890/edit",
    automationSheetName: "Base_Workflow_Data_Tai ky lan 2",
  });
  assert.equal(config.hierarchySheetName, "Data quản lý");
});
