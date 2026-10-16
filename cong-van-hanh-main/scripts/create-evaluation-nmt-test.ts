import "server-only";

import assert from "node:assert/strict";

import { getDb } from "@/lib/db";
import { resolveSharedJdsForPositions } from "@/lib/evaluation/jd-resolution";
import { dispatchEvaluationRpc } from "@/lib/evaluation/runtime";
import { asRecord, text } from "@/lib/operations/json";

const TEST_CYCLE_CODE = "TEST_NMT_DYNAMIC_SECTIONS_20260812";

async function main() {
  const db = getDb();
  const [admin, employee, sourceCycle] = await Promise.all([
    db.user.findFirst({
      orderBy: { createdAt: "asc" },
      where: { status: "ACTIVE" },
    }),
    db.employee.findFirst({
      where: {
        OR: [
          { employeeCode: "2411301" },
          { fullName: { contains: "Nguyễn Minh Thông", mode: "insensitive" } },
        ],
      },
    }),
    db.evaluationRecord.findFirst({
      orderBy: { updatedAt: "desc" },
      where: {
        code: "CYCLE_MSIL11ML_QD4UD",
        recordType: "evaluation-cycle",
        status: "active",
      },
    }),
  ]);
  assert(admin, "Cần tài khoản admin để tạo phiếu test.");
  assert(employee, "Không tìm thấy Nguyễn Minh Thông (2411301).");
  assert(sourceCycle, "Không tìm thấy kỳ thử việc 08/2026 đang hoạt động.");

  const session = {
    displayName: "Codex - tạo phiếu test Nguyễn Minh Thông",
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: ["admin"],
    userId: admin.id,
  };
  const [resolvedJd] = await resolveSharedJdsForPositions([employee.title || ""]);
  assert(resolvedJd?.document, "Không tìm thấy JD hiện hành của Nguyễn Minh Thông.");
  const jdContent = asRecord(resolvedJd.document.content);
  const currentMappings = Array.isArray(jdContent.criteriaMappings)
    ? jdContent.criteriaMappings
    : [];
  if (!currentMappings.length) {
    const [executionGroup, executionSet] = await Promise.all([
      db.evaluationRecord.findFirst({
        where: {
          OR: [{ code: "WG_EXECUTION" }, { name: "Thực thi" }],
          recordType: "evaluation-work-group-definition",
          status: "active",
        },
      }),
      db.evaluationRecord.findFirst({
        where: {
          code: "SET_DANH_GIA_CONG_VIEC",
          recordType: "evaluation-criteria-set",
        },
      }),
    ]);
    assert(executionGroup, "Chưa có Nhóm công việc Thực thi.");
    assert(executionSet, "Chưa có Bộ tiêu chí Đánh giá công việc.");
    await dispatchEvaluationRpc(session, "enqueueEvaluationJdClassificationJob", {
      activityTypes: resolvedJd.activities.map((activity) => ({
        activityType: "execution",
        code: activity.code || "",
        evaluationWorkGroupCode: executionGroup.code || "WG_EXECUTION",
        evaluationWorkGroupId: executionGroup.id,
        evaluationWorkGroupName: executionGroup.name || "Thực thi",
        frequency: text(asRecord(activity.content).frequency) || "monthly",
        id: activity.id,
        weightPercent: Number(asRecord(activity.content).weightPercent || 0),
      })),
      criteriaMappings: [
        {
          criteriaSetCode: executionSet.code || "SET_DANH_GIA_CONG_VIEC",
          criteriaSetId: executionSet.id,
          criteriaSetName: executionSet.name || "Đánh giá công việc",
          evaluationWorkGroupCode: executionGroup.code || "WG_EXECUTION",
          evaluationWorkGroupId: executionGroup.id,
          evaluationWorkGroupName: executionGroup.name || "Thực thi",
        },
      ],
      documentId: resolvedJd.document.id,
      executionCriteriaSetId: executionSet.id,
      mappedJobTitleCode: text(jdContent.mappedJobTitleCode),
      mappedJobTitleName: employee.title || resolvedJd.title,
      workGroups: resolvedJd.workGroups.map((group) => ({
        code: group.code || "",
        id: group.id,
        weightPercent: Number(asRecord(group.content).weightPercent || 0),
        workGroupCode: text(asRecord(group.content).workGroupCode || group.code),
      })),
    });
  }
  let cycle = await db.evaluationRecord.findFirst({
    where: { code: TEST_CYCLE_CODE, recordType: "evaluation-cycle" },
  });
  if (!cycle) {
    const source = asRecord(sourceCycle.content);
    const response = asRecord(
      await dispatchEvaluationRpc(session, "saveEvaluationCycle", {
        record: {
          code: TEST_CYCLE_CODE,
          cycleCode: TEST_CYCLE_CODE,
          cycleName: "[TEST] Nguyễn Minh Thông · Phân khối đánh giá",
          cycleTypeCode: text(source.cycleTypeCode),
          cycleTypeName: text(source.cycleTypeName) || "Đánh giá thử việc",
          cycleTypeTemplateId: text(source.cycleTypeTemplateId),
          endDate: "2026-12-31",
          name: "[TEST] Nguyễn Minh Thông · Phân khối đánh giá",
          note: "Phiếu test cô lập cho Nguyễn Minh Thông kiểm tra Chuyên môn, Văn hóa, thứ tự khối và mô tả mức điểm.",
          startDate: "2026-08-12",
          status: "active",
        },
      }),
    );
    const saved = asRecord(response.cycle);
    cycle = await db.evaluationRecord.findUnique({
      where: { id: text(saved.databaseId || saved.id) },
    });
  }
  assert(cycle, "Không tạo được kỳ test.");

  await dispatchEvaluationRpc(session, "saveEvaluationCycleMembers", {
    cycleId: cycle.id,
    members: [
      {
        employeeCode: employee.employeeCode,
        managerEmployeeCode: employee.employeeCode,
        managerName: employee.fullName,
        status: "assigned",
      },
    ],
  });
  const readiness = asRecord(
    await dispatchEvaluationRpc(session, "checkEvaluationCycleReadiness", {
      cycleId: cycle.id,
    }),
  );
  if (readiness.ok !== true) {
    throw new Error(
      `Phiếu test chưa đủ dữ liệu: ${JSON.stringify({ cycleIssues: readiness.cycleIssues, members: readiness.members })}`,
    );
  }
  const scoreGroups = await db.evaluationRecord.findMany({
    orderBy: { createdAt: "asc" },
    where: { recordType: "evaluation-score-group", status: "active" },
  });
  const normalizedName = (value: unknown) =>
    text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
  const professional = scoreGroups.find((group) => {
    const name = normalizedName(asRecord(group.content).scoreGroupName || group.name);
    return name.includes("chuyen mon") || name.includes("ket qua cong viec");
  });
  const culture = scoreGroups.find((group) =>
    normalizedName(asRecord(group.content).scoreGroupName || group.name).includes("van hoa"),
  );
  const remaining = scoreGroups.filter(
    (group) => group.id !== professional?.id && group.id !== culture?.id,
  );
  const orderedGroupIds = [professional, culture, ...remaining]
    .filter((group): group is NonNullable<typeof group> => Boolean(group))
    .map((group) => group.id);
  if (orderedGroupIds.length) {
    await dispatchEvaluationRpc(session, "reorderEvaluationScoreGroups", {
      scoreGroupIds: orderedGroupIds,
    });
  }
  const generated = asRecord(
    await dispatchEvaluationRpc(session, "enqueueEvaluationGenerationJob", {
      cycleId: cycle.id,
      employeeCodes: [employee.employeeCode],
      suppressMail: true,
      suppressJob: true,
    }),
  );
  const instances = await db.evaluationRecord.findMany({
    orderBy: { updatedAt: "desc" },
    where: { recordType: "evaluation-instance", status: "in_progress" },
  });
  const instance = instances.find((row) => {
    const content = asRecord(row.content);
    const cycleReferences = [
      cycle?.id,
      cycle?.code,
      asRecord(cycle?.content).id,
      asRecord(cycle?.content).cycleId,
    ].map(text).filter(Boolean);
    return (
      text(content.employeeCode) === employee.employeeCode &&
      [row.parentId, content.cycleId, content.evaluationCycleId]
        .map(text)
        .some((value) => cycleReferences.includes(value))
    );
  });
  console.log(
    JSON.stringify(
      {
        cycleId: cycle.id,
        cycleName: cycle.name,
        employeeCode: employee.employeeCode,
        employeeName: employee.fullName,
        generation: generated,
        instanceId: instance?.id || "",
        status: instance ? "READY" : "QUEUED",
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
