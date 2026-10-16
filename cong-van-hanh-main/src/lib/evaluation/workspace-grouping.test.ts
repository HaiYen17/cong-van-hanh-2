import assert from "node:assert/strict";
import test from "node:test";

import { groupEvaluationWorkspaceScores } from "@/lib/evaluation/workspace-grouping";

function score(id: string, content: Record<string, unknown>) {
  return { content, id, name: String(content.criteriaName || id) };
}

test("tách Văn hóa khỏi các nhóm công việc Chuyên môn", () => {
  const sections = groupEvaluationWorkspaceScores([
    score("work-2", {
      activitySortOrder: 20,
      activityText: "Đầu việc B",
      contentMode: "jd_dynamic",
      criteriaName: "Chất lượng",
      sectionName: "Chuyên môn",
      sectionSortOrder: 10,
      workGroupName: "Vận hành",
    }),
    score("culture", {
      contentMode: "criteria_set",
      criteriaName: "Chân thành",
      criteriaSetName: "Đánh giá văn hóa",
      sectionName: "Đánh giá văn hóa",
      sectionSortOrder: 20,
    }),
    score("work-1", {
      activitySortOrder: 10,
      activityText: "Đầu việc A",
      contentMode: "jd_dynamic",
      criteriaName: "Tốc độ",
      sectionName: "Chuyên môn",
      sectionSortOrder: 10,
      workGroupName: "Vận hành",
    }),
  ]);

  assert.deepEqual(
    sections.map((section) => section.name),
    ["Chuyên môn", "Văn hóa"],
  );
  assert.deepEqual(
    sections[0].groups[0].activities.map((activity) => activity.activity),
    ["Đầu việc A", "Đầu việc B"],
  );
});

test("dữ liệu phiếu cũ vẫn tự suy ra section Chuyên môn và Văn hóa", () => {
  const sections = groupEvaluationWorkspaceScores([
    score("legacy-work", {
      activityText: "Đầu việc",
      contentMode: "jd_dynamic",
      criteriaName: "Tốc độ",
      workGroupName: "Vận hành",
    }),
    score("legacy-culture", {
      contentMode: "criteria_set",
      criteriaName: "Cầu thị",
      criteriaSetName: "Đánh giá văn hóa",
    }),
  ]);

  assert.deepEqual(
    sections.map((section) => section.name),
    ["Chuyên môn", "Văn hóa"],
  );
});

test("khối KPI hoặc khối cấu hình mới được giữ thành tiêu đề riêng", () => {
  const sections = groupEvaluationWorkspaceScores([
    score("culture", {
      contentMode: "criteria_set",
      criteriaName: "Chân thành",
      criteriaSetName: "Bộ văn hóa",
      scoreGroupName: "Văn hóa",
      sectionCode: "CULTURE",
      sectionName: "Văn hóa",
      sectionSortOrder: 10,
    }),
    score("kpi", {
      contentMode: "criteria_set",
      criteriaName: "Doanh thu",
      criteriaSetName: "Bộ KPI tháng",
      scoreGroupName: "KPI",
      sectionCode: "KPI",
      sectionName: "KPI",
      sectionSortOrder: 20,
    }),
    score("leadership", {
      contentMode: "criteria_set",
      criteriaName: "Dẫn dắt đội ngũ",
      criteriaSetName: "Bộ năng lực lãnh đạo",
      scoreGroupName: "Năng lực lãnh đạo",
      sectionCode: "LEADERSHIP",
      sectionName: "Năng lực lãnh đạo",
      sectionSortOrder: 30,
    }),
  ]);

  assert.deepEqual(
    sections.map((section) => section.name),
    ["Văn hóa", "KPI", "Năng lực lãnh đạo"],
  );
  assert.equal(sections[1].groups[0].activities[0].rows[0].id, "kpi");
});

test("thứ tự khối trên phiếu bám đúng sortOrder do người dùng cấu hình", () => {
  const sections = groupEvaluationWorkspaceScores([
    score("culture", {
      contentMode: "criteria_set",
      criteriaName: "Chân thành",
      scoreGroupName: "Văn hóa",
      sectionName: "Văn hóa",
      sectionSortOrder: 20,
    }),
    score("technical", {
      activityText: "Lập kế hoạch",
      contentMode: "jd_dynamic",
      criteriaName: "Chất lượng",
      scoreGroupName: "Chuyên môn",
      sectionName: "Chuyên môn",
      sectionSortOrder: 10,
      workGroupName: "Quản lý nhóm",
    }),
  ]);

  assert.deepEqual(
    sections.map((section) => section.name),
    ["Chuyên môn", "Văn hóa"],
  );
});
