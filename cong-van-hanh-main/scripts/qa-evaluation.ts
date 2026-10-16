import "server-only";

import assert from "node:assert/strict";

import { getDb } from "@/lib/db";
import { resolveSharedJdsForPositions } from "@/lib/evaluation/jd-resolution";
import { dispatchEvaluationRpc } from "@/lib/evaluation/runtime";
import { asRecord, booleanValue, text } from "@/lib/operations/json";

const TRACKED_TYPES = [
  "evaluation-cycle",
  "evaluation-cycle-member",
  "evaluation-instance",
  "evaluation-criteria-score",
  "evaluation-workflow-step",
  "evaluation-work-group-definition",
  "evaluation-decision-field",
  "evaluation-decision-value",
  "evaluation-final-result",
];

async function main() {
  const db = getDb();
  const counts = await db.evaluationRecord.groupBy({
    _count: { _all: true },
    by: ["recordType", "status"],
    where: { recordType: { in: TRACKED_TYPES } },
  });

  const admin = await db.user.findFirst({
    include: {
      employee: true,
      userRoles: { include: { role: true } },
    },
    orderBy: { createdAt: "asc" },
    where: { status: "ACTIVE" },
  });
  assert(admin, "Cần ít nhất một tài khoản đang hoạt động để chạy QA.");

  const session = {
    displayName: admin.displayName,
    fullAccess: true,
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: ["admin"],
    userId: admin.id,
  };
  const adminResponse = asRecord(
    await dispatchEvaluationRpc(
      session,
      "getEvaluationAdminWorkspaceData",
      {},
    ),
  );
  const data = asRecord(adminResponse.data);
  const cycles = Array.isArray(data.cycles) ? data.cycles.map(asRecord) : [];
  const instances = Array.isArray(data.instances)
    ? data.instances.map(asRecord)
    : [];
  const scores = Array.isArray(data.criteriaScores)
    ? data.criteriaScores.map(asRecord)
    : [];
  const workGroupDefinitions = Array.isArray(data.workGroupDefinitions)
    ? data.workGroupDefinitions.map(asRecord)
    : [];
  const activeWorkGroupDefinitions = workGroupDefinitions.filter(
    (item) => item.status !== "inactive" && item.isActive !== false,
  );

  assert(cycles.length > 0, "API C&B phải trả danh sách kỳ đánh giá.");
  assert(instances.length > 0, "API C&B phải trả các phiếu đã nhập.");
  assert(scores.length > 0, "API C&B phải trả các dòng điểm đã nhập.");
  assert(
    activeWorkGroupDefinitions.length >= 1,
    "API C&B phải trả ít nhất một Nhóm công việc active để phân loại JD.",
  );
  assert(
    activeWorkGroupDefinitions.filter((item) => booleanValue(item.isDefault))
      .length === 1 &&
      activeWorkGroupDefinitions.some(
        (item) => item.code === "WG_EXECUTION" && booleanValue(item.isDefault),
      ),
    "Danh mục Nhóm công việc phải có đúng một nhóm Thực thi mặc định.",
  );

  const jdScores = scores.filter(
    (score) => text(score.contentMode).toLowerCase() === "jd_dynamic",
  );
  assert(
    jdScores.length > 0,
    "Phiếu đánh giá phải có các dòng đầu việc được phân bổ từ JD.",
  );
  const rankedActivityIds = new Set(
    jdScores
      .map((score) => text(score.activityId || score.activityCode))
      .filter(Boolean),
  );
  assert(
    rankedActivityIds.size > 1,
    "Dữ liệu biểu đồ xếp hạng phải có nhiều đầu công việc JD độc lập.",
  );
  const [cbJd] = await resolveSharedJdsForPositions(["Nhân viên C&B"]);
  assert(cbJd, "Phải phân giải được JD cho chức danh Nhân viên C&B.");
  assert.equal(
    cbJd.source,
    "evaluation-new",
    "Đánh giá nhân sự phải ưu tiên JD mới trước nguồn [BC].",
  );
  assert(
    !/^\[BC\]/iu.test(cbJd.fileName),
    "JD được chọn cho C&B không được là bản [BC] khi đã có bản mới.",
  );

  const selectedCycle = cycles.find((cycle) =>
    instances.some(
      (instance) =>
        text(instance.cycleId || instance.evaluationCycleId) === text(cycle.id),
    ),
  );
  assert(selectedCycle, "ID kỳ và ID trên phiếu phải nối được với nhau.");
  const cycleInstances = instances.filter(
    (instance) =>
      text(instance.cycleId || instance.evaluationCycleId) ===
      text(selectedCycle.id),
  );
  assert(
    cycleInstances.length > 0,
    "Màn Theo dõi phải lọc ra phiếu của kỳ đang chọn.",
  );

  const users = await db.user.findMany({
    include: {
      employee: true,
      userRoles: { include: { role: true } },
    },
    where: { status: "ACTIVE", employeeId: { not: null } },
  });
  const userByEmployeeCode = new Map(
    users
      .filter((user) => text(user.employee?.employeeCode))
      .map((user) => [text(user.employee?.employeeCode), user]),
  );
  const selectedInstance =
    cycleInstances.find((instance) =>
      userByEmployeeCode.has(text(instance.employeeCode)),
    ) || cycleInstances[0];
  const instanceScores = scores.filter(
    (score) =>
      text(score.instanceId || score.evaluationInstanceId) ===
      text(selectedInstance.id),
  );
  assert(
    instanceScores.length > 0,
    "Phiếu phải nối được các dòng điểm để dựng biểu đồ và chi tiết.",
  );

  const reviewer = userByEmployeeCode.get(text(selectedInstance.employeeCode));
  assert(reviewer, "Cần tài khoản gắn với nhân sự để kiểm tra quyền xem phiếu cá nhân.");
  const reviewerRoles = reviewer.userRoles
    .filter((assignment) => assignment.role.status === "ACTIVE")
    .map((assignment) => assignment.role.key);
  const reviewerSession = {
    displayName: reviewer.displayName,
    fullAccess: reviewerRoles.includes("super-admin"),
    moduleGroups: [],
    modules: [],
    permissions: [],
    roles: reviewerRoles,
    userId: reviewer.id,
  };
  const detailResponse = asRecord(
    await dispatchEvaluationRpc(reviewerSession, "getEvaluationInstanceDetail", {
      instanceId: selectedInstance.id,
    }),
  );
  const detailData = asRecord(detailResponse.data);
  const detailScores = Array.isArray(detailData.criteriaScores)
    ? detailData.criteriaScores.map(asRecord)
    : [];
  assert(
    detailScores.some(
      (score) =>
        text(score.instanceId || score.evaluationInstanceId) ===
        text(selectedInstance.id),
    ),
    "Chi tiết phiếu phải trả đúng dữ liệu điểm theo ID lịch sử.",
  );

  const normalAdminResponse = asRecord(
    await dispatchEvaluationRpc(session, "getEvaluationAssignedInstances", {}),
  );
  const normalAdminData = asRecord(normalAdminResponse.data);
  const normalAdminInstances = Array.isArray(normalAdminData.instances)
    ? normalAdminData.instances.map(asRecord)
    : [];
  const adminEmployeeCode = text(admin.employee?.employeeCode);
  assert(
    normalAdminInstances.every((instance) => {
      const activeRoles = Array.isArray(instance.activeStepRoles)
        ? instance.activeStepRoles.map(text)
        : [];
      const own =
        Boolean(adminEmployeeCode) &&
        text(instance.employeeCode || instance.employeeId) === adminEmployeeCode;
      const assigned = ["manager", "peer", "hr"].some((role) => {
        const code = text(instance[`${role}EmployeeCode`]);
        const status = text(instance[`${role}ReviewStatus`]).toLowerCase();
        return (
          Boolean(adminEmployeeCode) &&
          code === adminEmployeeCode &&
          (activeRoles.includes(role) || status === "draft" || status === "submitted")
        );
      });
      return own || assigned;
    }),
    "Admin ở màn Đánh giá nhân sự không được thấy phiếu ngoài phạm vi cá nhân/phân công.",
  );

  console.log(
    JSON.stringify(
      {
        cycleId: selectedCycle.id,
        cycleInstances: cycleInstances.length,
        databaseCounts: Object.fromEntries(
          counts.map((row) => [
            `${row.recordType}:${row.status}`,
            row._count._all,
          ]),
        ),
        instanceId: selectedInstance.id,
        instanceScores: instanceScores.length,
        jdActivityCount: rankedActivityIds.size,
        selectedCbJd: cbJd.fileName,
        selectedCbJdSource: cbJd.source,
        workGroupDefinitions: activeWorkGroupDefinitions.length,
        status: "PASS",
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
