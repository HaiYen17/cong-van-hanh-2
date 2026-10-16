import assert from "node:assert/strict";

import {
  autoMapEvaluationAutomationHeaders,
  evaluationAutomationConfigForClient,
  inspectEvaluationAutomationSpreadsheet,
  normalizeEvaluationAutomationSourceConfig,
  parseEvaluationSheetGid,
  parseEvaluationSpreadsheetId,
} from "@/lib/evaluation/source-automation";

const sampleUrl =
  "https://docs.google.com/spreadsheets/d/1vlFuJnoaY8OPMXLEMNYZGkDN_YOPtW7b0joZMcpULmM/edit?gid=1845182427#gid=1845182427";

assert.equal(
  parseEvaluationSpreadsheetId(sampleUrl),
  "1vlFuJnoaY8OPMXLEMNYZGkDN_YOPtW7b0joZMcpULmM",
);
assert.equal(parseEvaluationSheetGid(sampleUrl), "1845182427");

const scheduleConfig = normalizeEvaluationAutomationSourceConfig({
  automationSourceEnabled: true,
  automationSourceLink: sampleUrl,
  automationSheetName: "Base_Workflow_Data",
  generationMode: "quarterly",
  generationTiming: "period_end",
});
assert.equal(scheduleConfig.grouping, "quarterly");
assert.equal(scheduleConfig.enabled, true);
assert.equal(
  evaluationAutomationConfigForClient({
    ...scheduleConfig,
    automationSourceEnabled: true,
    automationSourceLink: sampleUrl,
    generationMode: "yearly",
    generationTiming: "period_end",
  }).generationTiming,
  "period_end",
);

const mappings = autoMapEvaluationAutomationHeaders([
  "Job ID",
  "Họ và tên",
  "Chức vụ",
  "Khu vực/Chuyên môn",
  "Email nhân viên",
  "Ngày cuối cùng thử việc",
  "Quản lý trực tiếp",
]);
assert.equal(mappings.stableId, "Job ID");
assert.equal(mappings.employeeName, "Họ và tên");
assert.equal(mappings.employeeEmail, "Email nhân viên");
assert.equal(mappings.jobTitle, "Chức vụ");
assert.equal(mappings.department, "Khu vực/Chuyên môn");
assert.equal(mappings.milestoneDate, "Ngày cuối cùng thử việc");
assert.equal(mappings.manager, "Quản lý trực tiếp");

async function main() {
  const liveUrl = String(process.env.LIVE_EVALUATION_SOURCE_URL || "").trim();
  if (liveUrl) {
    const live = await inspectEvaluationAutomationSpreadsheet({
      spreadsheetUrl: liveUrl,
    });
    assert.ok(live.spreadsheetTitle, "Google Sheet phải có tiêu đề.");
    assert.ok(live.selectedSheetName, "Phải tự chọn được sheet theo gid.");
    assert.ok(live.headers.length, "Sheet phải có header.");
    assert.ok(live.autoMappings.milestoneDate, "Phải nhận diện được cột mốc.");
    assert.ok(
      live.autoMappings.employeeCode ||
        live.autoMappings.employeeEmail ||
        live.autoMappings.employeeName,
      "Phải nhận diện được ít nhất một khóa nhân sự.",
    );
    console.log(
      `Live source OK: ${live.spreadsheetTitle} / ${live.selectedSheetName} / ${live.headers.length} headers.`,
    );
  }

  console.log("Evaluation automation source QA passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
