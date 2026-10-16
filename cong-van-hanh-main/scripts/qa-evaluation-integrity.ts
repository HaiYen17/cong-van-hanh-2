import "server-only";

import assert from "node:assert/strict";

import { getDb } from "@/lib/db";
import { evaluationRecordIdentifiers } from "@/lib/evaluation/record-identity";
import { EVALUATION_MAIL_EVENT_CODES } from "@/lib/evaluation/mail-delivery";
import { asRecord, booleanValue, text } from "@/lib/operations/json";

const REVIEW_CATEGORIES = new Set([
  "appointment",
  "contract_renewal",
  "dismissal",
  "income_adjustment",
  "other",
  "periodic",
  "probation",
  "promotion",
  "transfer",
]);

async function main() {
  const db = getDb();
  const records = await db.evaluationRecord.findMany({
    where: { recordType: { startsWith: "evaluation-" } },
  });
  const active = records.filter(
    (record) =>
      record.status !== "inactive" &&
      asRecord(record.content).isActive !== false,
  );
  const malformedActive = active.filter(
    (record) => Object.keys(asRecord(asRecord(record.content).record)).length,
  );
  assert.equal(
    malformedActive.length,
    0,
    `Còn ${malformedActive.length} bản ghi active bị bọc trong content.record.`,
  );

  const inactiveCycles = records.filter(
    (record) =>
      record.recordType === "evaluation-cycle" && record.status === "inactive",
  );
  const inactiveCycleIds = new Set(
    inactiveCycles.flatMap((record) => evaluationRecordIdentifiers(record)),
  );
  const activeCycleChildren = active.filter((record) => {
    if (
      ![
        "evaluation-cycle-member",
        "evaluation-generation-job",
        "evaluation-instance",
      ].includes(record.recordType)
    ) {
      return false;
    }
    const content = asRecord(record.content);
    return [record.parentId, content.cycleId, content.evaluationCycleId]
      .map(text)
      .some((identifier) => inactiveCycleIds.has(identifier));
  });
  assert.equal(
    activeCycleChildren.length,
    0,
    `Còn ${activeCycleChildren.length} bản ghi con active dưới kỳ inactive.`,
  );

  const inactiveInstances = records.filter(
    (record) =>
      record.recordType === "evaluation-instance" &&
      record.status === "inactive",
  );
  const inactiveInstanceIds = new Set(
    inactiveInstances.flatMap((record) => evaluationRecordIdentifiers(record)),
  );
  const activeInstanceChildren = active.filter((record) => {
    if (
      ![
        "evaluation-criteria-score",
        "evaluation-decision-value",
        "evaluation-final-result",
      ].includes(record.recordType)
    ) {
      return false;
    }
    const content = asRecord(record.content);
    return [record.parentId, content.instanceId, content.evaluationInstanceId]
      .map(text)
      .some((identifier) => inactiveInstanceIds.has(identifier));
  });
  assert.equal(
    activeInstanceChildren.length,
    0,
    `Còn ${activeInstanceChildren.length} điểm/kết quả active dưới phiếu inactive.`,
  );

  const activeWorkflowIds = new Set(
    active
      .filter((record) => record.recordType === "evaluation-workflow-template")
      .flatMap((record) => evaluationRecordIdentifiers(record)),
  );
  const orphanWorkflowSteps = active.filter((record) => {
    if (record.recordType !== "evaluation-workflow-step") return false;
    const content = asRecord(record.content);
    return ![record.parentId, content.workflowTemplateId]
      .map(text)
      .some((identifier) => activeWorkflowIds.has(identifier));
  });
  assert.equal(
    orphanWorkflowSteps.length,
    0,
    `Còn ${orphanWorkflowSteps.length} bước workflow không có workflow cha active.`,
  );

  const activeDefinitions = active.filter(
    (record) => record.recordType === "evaluation-work-group-definition",
  );
  const defaults = activeDefinitions.filter((record) =>
    booleanValue(asRecord(record.content).isDefault),
  );
  assert.equal(defaults.length, 1, "Phải có đúng một Nhóm công việc mặc định.");
  assert.equal(
    defaults[0]?.code,
    "WG_EXECUTION",
    "Nhóm mặc định phải là Thực thi.",
  );

  const unassignedActivities = active.filter((record) => {
    if (record.recordType !== "evaluation-jd-activity") return false;
    const content = asRecord(record.content);
    return (
      text(content.activityType).toLowerCase() !== "excluded" &&
      !text(content.evaluationWorkGroupId) &&
      !text(content.evaluationWorkGroupCode)
    );
  });
  assert.equal(
    unassignedActivities.length,
    0,
    `Còn ${unassignedActivities.length} đầu việc JD chưa có Nhóm công việc.`,
  );

  const mailEvents = new Set(
    records
      .filter((record) => record.recordType === "evaluation-mail-template")
      .map((record) => text(asRecord(record.content).eventCode)),
  );
  EVALUATION_MAIL_EVENT_CODES.forEach((eventCode) =>
    assert(mailEvents.has(eventCode), `Thiếu mẫu mail ${eventCode}.`),
  );

  const schedulesWithoutRule = records.filter(
    (record) =>
      record.recordType === "evaluation-cycle-schedule" &&
      !text(asRecord(record.content).automationRuleKey),
  );
  assert.equal(
    schedulesWithoutRule.length,
    0,
    `Còn ${schedulesWithoutRule.length} lịch chưa có khóa mốc/quy tắc.`,
  );

  const invalidCategories = active.filter((record) => {
    if (record.recordType !== "evaluation-cycle-type-template") return false;
    const category = text(asRecord(record.content).category) || "other";
    return !REVIEW_CATEGORIES.has(category);
  });
  assert.equal(
    invalidCategories.length,
    0,
    `Còn ${invalidCategories.length} Loại đánh giá dùng nhóm loại không hợp lệ.`,
  );

  const typoTitles = active.filter((record) => {
    if (record.recordType !== "evaluation-jd-document") return false;
    const content = asRecord(record.content);
    const title = text(
      content.mappedJobTitleName || content.jobTitleName || record.name,
    );
    return /Chuyên giá|nệm cao s[ựư]|kế toán thành toán|kinh doanh\s+so\s*2/iu.test(
      title,
    );
  });
  assert.equal(
    typoTitles.length,
    0,
    `Còn ${typoTitles.length} chức danh sai rõ ràng.`,
  );

  console.log(
    JSON.stringify(
      {
        activeRecords: active.length,
        defaultWorkGroup: defaults[0]?.name,
        inactiveCyclesChecked: inactiveCycles.length,
        mailTemplates: mailEvents.size,
        ok: true,
        schedulesChecked: records.filter(
          (record) => record.recordType === "evaluation-cycle-schedule",
        ).length,
        workflowStepsChecked: active.filter(
          (record) => record.recordType === "evaluation-workflow-step",
        ).length,
      },
      null,
      2,
    ),
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
