import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvaluationScorePlan,
  type EvaluationPlanningRecord,
} from "@/lib/evaluation/score-planning";

function record(
  recordType: string,
  id: string,
  content: Record<string, unknown>,
): EvaluationPlanningRecord {
  return {
    code: String(content.code || id),
    content: { isActive: true, ...content },
    id,
    name: String(content.name || id),
    parentId: null,
    recordType,
    status: "active",
  };
}

test("bộ tiêu chí riêng chỉ thay phần JD và vẫn giữ phần Văn hóa", () => {
  const cycle = record("evaluation-cycle", "cycle-db", {
    cycleTypeTemplateId: "TYPE_PROBATION",
    id: "CYCLE_001",
  });
  const member = record("evaluation-cycle-member", "member-db", {
    criteriaSetId: "SET_WORK_OVERRIDE",
    employeeCode: "NV001",
  });
  const instance = record("evaluation-instance", "instance-db", {
    id: "INST_001",
  });
  const records = [
    record("evaluation-cycle-type-score-group", "section-work", {
      contentMode: "jd_dynamic",
      cycleTypeTemplateId: "TYPE_PROBATION",
      evaluatorRoles: "self, manager",
      isEnabled: true,
      sortOrder: 10,
      weightPercent: 70,
    }),
    record("evaluation-cycle-type-score-group", "section-culture", {
      contentMode: "criteria_set",
      criteriaSetId: "SET_CULTURE",
      cycleTypeTemplateId: "TYPE_PROBATION",
      evaluatorRoles: "self, manager",
      isEnabled: true,
      scoreGroupId: "GROUP_CULTURE",
      sortOrder: 20,
      weightPercent: 30,
    }),
    record("evaluation-score-group", "GROUP_WORK", {
      code: "PROFESSIONAL",
      name: "Chuyên môn",
    }),
    record("evaluation-score-group", "GROUP_CULTURE", {
      code: "CULTURE",
      name: "Đánh giá văn hóa",
    }),
    record("evaluation-criteria-set", "SET_WORK_OVERRIDE", {
      code: "SET_WORK_OVERRIDE",
      name: "Đánh giá công việc",
      scoreGroupId: "GROUP_WORK",
    }),
    record("evaluation-criteria-set", "SET_CULTURE", {
      code: "SET_CULTURE",
      name: "Đánh giá văn hóa",
    }),
    record("evaluation-criteria-set-item", "work-item", {
      criteriaId: "CRITERION_WORK",
      criteriaSetId: "SET_WORK_OVERRIDE",
      weightPercent: 100,
    }),
    record("evaluation-criteria-set-item", "culture-item", {
      criteriaId: "CRITERION_CULTURE",
      criteriaSetId: "SET_CULTURE",
      weightPercent: 100,
    }),
    record("evaluation-criteria", "CRITERION_WORK", {
      code: "WORK",
      name: "Kết quả công việc",
      scoringMethod: "scale_10",
    }),
    record("evaluation-criteria", "CRITERION_CULTURE", {
      code: "CULTURE",
      name: "Tinh thần làm chủ",
      scoreLevelDescriptions: {
        0: "Chưa thể hiện",
        5: "Thể hiện xuất sắc",
      },
      scoreLevelDescriptionsEnabled: true,
      scoringMethod: "scale_5",
    }),
  ];

  const plan = buildEvaluationScorePlan({
    cycle,
    instance,
    jd: null,
    member,
    records,
  });

  assert.deepEqual(
    plan.rows.map((row) => row.content.criteriaSetName),
    ["Đánh giá công việc", "Đánh giá văn hóa"],
  );
  assert.deepEqual(
    plan.rows.map((row) => row.content.weightPercent),
    [70, 30],
  );
  assert.deepEqual(
    plan.rows.map((row) => row.content.sectionName),
    ["Chuyên môn", "Văn hóa"],
  );
  assert.equal(plan.rows[1].content.scoreLevelDescriptionsEnabled, true);
  assert.deepEqual(plan.rows[1].content.scoreLevelDescriptions, {
    0: "Chưa thể hiện",
    5: "Thể hiện xuất sắc",
  });
});

test("Nhóm công việc mới quyết định bộ tiêu chí khi phân loại cũ chưa cập nhật", () => {
  const cycle = record("evaluation-cycle", "cycle-db", {
    cycleTypeTemplateId: "TYPE_PROBATION",
    id: "CYCLE_002",
  });
  const member = record("evaluation-cycle-member", "member-db", {
    employeeCode: "NV002",
  });
  const instance = record("evaluation-instance", "instance-db", {
    id: "INST_002",
  });
  const records = [
    record("evaluation-cycle-type-score-group", "section-work", {
      contentMode: "jd_dynamic",
      cycleTypeTemplateId: "TYPE_PROBATION",
      isEnabled: true,
      sortOrder: 10,
      weightPercent: 100,
    }),
    record("evaluation-work-group-definition", "WG_EXECUTION", {
      code: "WG_EXECUTION",
      legacyActivityType: "execution",
      name: "Thực thi",
    }),
    record("evaluation-jd-activity-rule", "RULE_EXECUTION", {
      activityType: "execution",
      criteriaSetCode: "SET_WORK",
    }),
    record("evaluation-criteria-set", "SET_WORK", {
      code: "SET_WORK",
      name: "Đánh giá công việc",
    }),
    record("evaluation-criteria-set-item", "work-item", {
      criteriaId: "CRITERION_WORK",
      criteriaSetId: "SET_WORK",
      weightPercent: 100,
    }),
    record("evaluation-criteria", "CRITERION_WORK", {
      code: "WORK",
      name: "Chất lượng đầu ra",
      scoringMethod: "scale_10",
    }),
  ];
  const jd = {
    activities: [
      record("evaluation-jd-activity", "ACTIVITY_1", {
        activityText: "Hoàn thành đầu việc",
        activityType: "unclassified",
        evaluationWorkGroupCode: "WG_EXECUTION",
        frequency: "monthly",
        jdWorkGroupId: "JD_GROUP_1",
      }),
    ],
    activityCount: 1,
    document: record("evaluation-jd-document", "JD_DOC", {
      sourceCode: "JD_LIBRARY",
    }),
    fileName: "JD.docx",
    fileUrl: "",
    isLegacy: false,
    legacyOutputs: [],
    position: "Nhân viên thử nghiệm",
    source: "evaluation-new" as const,
    sourceLabel: "Bản mới",
    title: "Nhân viên thử nghiệm",
    version: null,
    workGroupCount: 1,
    workGroups: [
      record("evaluation-jd-work-group", "JD_GROUP_1", {
        name: "Công việc chính",
      }),
    ],
  };

  const plan = buildEvaluationScorePlan({ cycle, instance, jd, member, records });

  assert.equal(plan.rows.length, 1);
  assert.equal(plan.rows[0].content.activityType, "execution");
  assert.equal(plan.rows[0].content.criteriaName, "Chất lượng đầu ra");
});
