import "server-only";

import assert from "node:assert/strict";

import { getDb } from "@/lib/db";
import { dispatchEvaluationRpc } from "@/lib/evaluation/runtime";
import { asRecord, text } from "@/lib/operations/json";

async function main() {
  const db = getDb();
  const admin = await db.user.findFirst({
    orderBy: { createdAt: "asc" },
    where: { status: "ACTIVE" },
  });
  assert(admin, "Cần một tài khoản active để chạy QA ghi dữ liệu.");
  const qaEmployee = await db.employee.findFirst({
    orderBy: { employeeCode: "asc" },
    where: { archivedAt: null, status: "ACTIVE", title: { not: null } },
  });
  assert(qaEmployee, "Cần một nhân sự active có chức danh để chạy QA phân bổ.");
  const session = {
    displayName: admin.displayName,
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: ["admin"],
    userId: admin.id,
  };
  const suffix = Date.now().toString(36).toUpperCase();
  const createdIds = new Set<string>();
  const remember = (value: unknown) => {
    const record = asRecord(value);
    const id = text(record.databaseId || record.id);
    if (id) createdIds.add(id);
    return record;
  };
  try {
    const workflowResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "workflowTemplate",
        record: {
          code: `QA_WF_${suffix}`,
          name: `QA workflow ${suffix}`,
          status: "active",
        },
      }),
    );
    const workflow = remember(workflowResponse.record);
    assert(text(workflow.databaseId), "Workflow QA phải trả databaseId.");

    const batchResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntities", {
        entityType: "workflowStep",
        records: [
          {
            entityType: "workflowStep",
            record: {
              evaluatorRole: "self",
              mode: "sequential",
              role: "self",
              sortOrder: 10,
              workflowTemplateId: workflow.id,
            },
          },
          {
            entityType: "workflowStep",
            record: {
              evaluatorRole: "manager",
              mode: "parallel",
              role: "manager",
              sortOrder: 20,
              workflowTemplateId: workflow.id,
            },
          },
        ],
      }),
    );
    const savedSteps = Array.isArray(batchResponse.records)
      ? batchResponse.records.map(remember)
      : [];
    assert.equal(savedSteps.length, 2, "Batch phải lưu đủ hai bước workflow.");
    const storedSteps = await db.evaluationRecord.findMany({
      where: { id: { in: savedSteps.map((step) => text(step.databaseId)) } },
    });
    assert.equal(storedSteps.length, 2);
    storedSteps.forEach((step) => {
      const content = asRecord(step.content);
      assert.equal(
        Object.keys(asRecord(content.record)).length,
        0,
        "Không được lưu lớp bọc content.record.",
      );
      assert.equal(text(content.workflowTemplateId), text(workflow.id));
    });

    const typeResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "cycleTypeTemplate",
        record: {
          category: "probation",
          code: `QA_TYPE_${suffix}`,
          defaultDeadlineDays: 7,
          defaultWorkflowTemplateId: workflow.databaseId,
          name: `QA loại đánh giá ${suffix}`,
          status: "published",
        },
      }),
    );
    const reviewType = remember(typeResponse.record);
    assert(text(reviewType.databaseId).startsWith("c"), "Loại QA phải dùng CUID PostgreSQL.");

    const secondTypeResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "cycleTypeTemplate",
        record: {
          category: "probation",
          code: `QA_TYPE_2_${suffix}`,
          defaultDeadlineDays: 7,
          defaultWorkflowTemplateId: workflow.databaseId,
          name: `QA loại đánh giá thứ hai ${suffix}`,
          status: "published",
        },
      }),
    );
    const secondReviewType = remember(secondTypeResponse.record);
    const sharedFieldCode = `QA_FIELD_${suffix}`;
    const firstFieldResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "decisionField",
        record: {
          code: sharedFieldCode,
          cycleTypeTemplateId: reviewType.id,
          fieldCode: sharedFieldCode,
          fieldType: "text",
          label: `Câu hỏi dùng chung ${suffix}`,
          role: "self",
          sortOrder: 10,
        },
      }),
    );
    const firstField = remember(firstFieldResponse.record);
    const secondFieldResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "decisionField",
        record: {
          code: sharedFieldCode,
          cycleTypeTemplateId: secondReviewType.id,
          fieldCode: sharedFieldCode,
          fieldType: "text",
          label: `Câu hỏi dùng chung ${suffix}`,
          role: "self",
          sortOrder: 10,
        },
      }),
    );
    const secondField = remember(secondFieldResponse.record);
    assert.notEqual(
      firstField.databaseId,
      secondField.databaseId,
      "Cùng mã câu hỏi ở hai Loại đánh giá phải là hai bản ghi riêng.",
    );
    const sharedFields = await db.evaluationRecord.findMany({
      orderBy: { parentId: "asc" },
      where: {
        code: sharedFieldCode,
        id: { in: [text(firstField.databaseId), text(secondField.databaseId)] },
        recordType: "evaluation-decision-field",
      },
    });
    assert.equal(
      sharedFields.length,
      2,
      "Lưu câu hỏi trùng mã khác Loại đánh giá không được ghi đè.",
    );
    assert.deepEqual(
      new Set(sharedFields.map((field) => text(field.parentId))),
      new Set([text(reviewType.id), text(secondReviewType.id)]),
      "Mỗi câu hỏi phải giữ đúng Loại đánh giá cha.",
    );
    const updatedSecondFieldResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "decisionField",
        record: {
          ...secondField,
          code: sharedFieldCode,
          cycleTypeTemplateId: secondReviewType.id,
          fieldCode: sharedFieldCode,
          label: `Câu hỏi đã cập nhật ${suffix}`,
        },
      }),
    );
    const updatedSecondField = remember(updatedSecondFieldResponse.record);
    assert.equal(updatedSecondField.databaseId, secondField.databaseId);

    const cycleResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationCycle", {
        record: {
          cycleTypeTemplateId: reviewType.databaseId,
          endDate: "2099-01-31",
          name: `QA kỳ ${suffix}`,
          startDate: "2099-01-01",
          status: "draft",
        },
      }),
    );
    const cycle = remember(cycleResponse.cycle);
    assert.equal(
      text(asRecord(cycle.content).cycleTypeTemplateId || cycle.cycleTypeTemplateId),
      text(reviewType.databaseId),
      "Kỳ thủ công phải giữ nguyên CUID loại đánh giá.",
    );

    const memberResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationCycleMembers", {
        cycleId: cycle.id,
        members: [
          {
            employeeCode: qaEmployee.employeeCode,
            managerEmployeeCode: qaEmployee.employeeCode,
          },
        ],
      }),
    );
    const member = remember(
      Array.isArray(memberResponse.records) ? memberResponse.records[0] : null,
    );
    const storedMember = await db.evaluationRecord.findUnique({
      where: { id: text(member.databaseId) },
    });
    const storedMemberContent = asRecord(storedMember?.content);
    assert.equal(storedMemberContent.employeeName, qaEmployee.fullName);
    assert.equal(storedMemberContent.jobTitleName, qaEmployee.title);
    assert.equal(storedMemberContent.departmentName, qaEmployee.department || "");

    const readiness = asRecord(
      await dispatchEvaluationRpc(session, "checkEvaluationCycleReadiness", {
        cycleId: cycle.id,
      }),
    );
    const readinessSummary = asRecord(readiness.summary);
    const readinessMembers = Array.isArray(readiness.members)
      ? readiness.members.map(asRecord)
      : [];
    assert.equal(readinessSummary.totalCount, 1);
    assert.equal(readinessMembers.length, 1);
    assert.equal(readinessMembers[0].employeeName, qaEmployee.fullName);
    assert.equal(readinessMembers[0].jobTitleName, qaEmployee.title);
    assert.equal(readiness.invalid, readinessSummary.blockedCount);
    assert(Array.isArray(readiness.rows), "Readiness phải giữ contract rows cũ.");
    const instanceResponse = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationConfigEntity", {
        entityType: "instance",
        record: {
          cycleId: cycle.id,
          employeeCode: qaEmployee.employeeCode,
          employeeName: qaEmployee.fullName,
          status: "in_progress",
        },
      }),
    );
    const instance = remember(instanceResponse.record);
    await dispatchEvaluationRpc(session, "deleteEvaluationConfigEntity", {
      databaseId: cycle.databaseId,
      entityType: "cycle",
    });
    const cascaded = await db.evaluationRecord.findMany({
      where: {
        id: {
          in: [cycle.databaseId, member.databaseId, instance.databaseId].map(text),
        },
      },
    });
    assert.equal(cascaded.length, 3);
    cascaded.forEach((record) =>
      assert.equal(record.status, "inactive", "Xóa kỳ phải cascade dữ liệu con."),
    );

    const scheduleRecord = {
      automationExpiryDays: 0,
      automationHeaderRow: 1,
      automationLeadDays: 7,
      automationReviewerRole: "manager",
      automationRuleKey: `QA mốc ${suffix}`,
      automationSheetName: "QA",
      automationSourceEnabled: true,
      automationSourceLink:
        "https://docs.google.com/spreadsheets/d/1Kma_1Nytng-3U5QXDJIbZW-kfPFvfAXOceIA9TUzV8I/edit",
      automationSourceMappings: {
        employeeCode: "Mã nhân viên",
        milestoneDate: "Ngày cuối cùng thử việc",
      },
      cycleTypeTemplateId: reviewType.databaseId,
      generationMode: "monthly",
      generationTiming: "period_start",
      status: "draft",
    };
    const scheduleResponse = asRecord(
      await dispatchEvaluationRpc(
        session,
        "saveEvaluationAutomationSchedule",
        { record: scheduleRecord },
      ),
    );
    const schedule = remember(scheduleResponse.schedule);
    await dispatchEvaluationRpc(session, "deleteEvaluationConfigEntity", {
      databaseId: schedule.databaseId,
      entityType: "cycleSchedule",
    });
    const revivedResponse = asRecord(
      await dispatchEvaluationRpc(
        session,
        "saveEvaluationAutomationSchedule",
        { record: scheduleRecord },
      ),
    );
    const revived = remember(revivedResponse.schedule);
    assert.equal(
      revived.databaseId,
      schedule.databaseId,
      "Tạo lại lịch đã xóa phải revive cùng bản ghi.",
    );
    const storedSchedule = await db.evaluationRecord.findUnique({
      where: { id: text(schedule.databaseId) },
    });
    assert.equal(storedSchedule?.status, "draft");

    console.log(
      JSON.stringify(
        {
          batchEnvelope: "ok",
          childCodeScope: "ok",
          cuidReferences: "ok",
          cycleCascade: "ok",
          memberDirectorySnapshot: "ok",
          ok: true,
          readinessContract: "ok",
          scheduleRevival: "ok",
        },
        null,
        2,
      ),
    );
  } finally {
    if (createdIds.size) {
      await db.evaluationRecord.deleteMany({
        where: { id: { in: Array.from(createdIds) } },
      });
      await db.auditLog.deleteMany({
        where: { targetId: { in: Array.from(createdIds) } },
      });
    }
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
