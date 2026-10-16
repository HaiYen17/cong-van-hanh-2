import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { transformEvaluationWorkflowDecision } from "./evaluation-workflow-decision-transform.mjs";

const root = path.resolve(import.meta.dirname, "..");
const config = fs.readFileSync(
  path.join(root, "scripts/v3-parity/evaluation-config.html"),
  "utf8",
);
const generatedEvaluation = fs.readFileSync(
  path.join(root, "public/legacy/evaluation.html"),
  "utf8",
);
const evaluationPage = fs.readFileSync(
  path.join(root, "src/app/danh-gia/page.tsx"),
  "utf8",
);
const evaluationConfigPage = fs.readFileSync(
  path.join(root, "src/app/cau-hinh/danh-gia/page.tsx"),
  "utf8",
);
const legacy = fs
  .readFileSync(path.join(root, "../Hành chính/EvaluationModal.html"), "utf8")
  .replace(/\r\n/g, "\n");
const evaluation = transformEvaluationWorkflowDecision(legacy);
const plain = (value) => (value == null ? "" : String(value));
const trim = (value) => plain(value).trim();
const normalizeKey = (value) =>
  trim(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const escapeHtml = (value) =>
  plain(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const roles = ["self", "manager", "indirect_manager", "peer", "hr", "bod"];

function functions(source, names, overrides = {}) {
  const context = vm.createContext({
    text: plain,
    trim,
    normalizeKey,
    normalize: (value) => trim(value).toLowerCase(),
    escapeHtml,
    ...overrides,
  });
  for (const name of names) {
    const expression = new RegExp(
      `^([ \\t]*)function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\1\\}`,
      "m",
    );
    const match = source.match(expression);
    assert.ok(match, `Missing function ${name}`);
    vm.runInContext(match[0], context);
  }
  return context;
}

test("monitor review renders labeled sections in configured order, including legacy scores", () => {
  const culture = { sectionName: 'Văn hóa', criteriaName: 'Văn hóa test' };
  const technical = { sectionName: 'Chuyên môn', contentMode: 'jd_dynamic', criteriaName: 'Chuyên môn test' };
  let scores = [culture, technical];
  const ctx = functions(config, ['renderMonitorRoleScoreFormHtml'], {
    monitorScoresForRole: () => scores,
    monitorRoleScoreRowHtml: score => `<span>${score.criteriaName}</span>`,
    renderMonitorRoleJdScoresHtml: items => items.map(score => `<span>${score.criteriaName}</span>`).join(''),
  });
  const legacyHtml = ctx.renderMonitorRoleScoreFormHtml({}, 'manager', 'reviewer');
  assert.ok(legacyHtml.indexOf('I. Đánh giá Chuyên môn') < legacyHtml.indexOf('II. Đánh giá Văn hóa'));
  assert.ok(legacyHtml.indexOf('Chuyên môn test') < legacyHtml.indexOf('Văn hóa test'));
  scores = [{ ...technical, sectionSortOrder: 2 }, { ...culture, sectionSortOrder: 0 }];
  const configuredHtml = ctx.renderMonitorRoleScoreFormHtml({}, 'manager', 'reviewer');
  assert.ok(configuredHtml.includes('I. Đánh giá Văn hóa'));
  assert.ok(configuredHtml.includes('II. Đánh giá Chuyên môn'));
});

function sharedConfig(data = {}, overrides = {}) {
  return functions(
    config,
    [
      "normalizeEvaluationRole",
      "monitorRolePrefix",
      "monitorReviewAssignments",
      "splitTextList",
      "monitorRoleAllows",
      "monitorDecisionAnswerValues",
      "cycleTypeByValue",
      "reviewTypeKeys",
      "monitorDecisionComparable",
      "monitorDecisionFieldVisible",
      "monitorDecisionValueForField",
      "monitorDecisionFieldSort",
      "monitorDecisionFieldsForRole",
      "monitorDecisionAnswerFields",
      "monitorDecisionValueLabel",
      "formatMonitorConclusionDate",
      "formatMonitorConclusionNumber",
      "monitorRoleDecisionRowsHtml",
      "stableReviewTypeFieldSort",
      "monitorCnbFieldsForConclusion",
    ],
    {
      adminList: (key) => data[key] || [],
      list: (key) => data[key] || [],
      isActiveLine: (item) =>
        item && item.isActive !== false && item.status !== "inactive",
      byId: (items, id, keys = ["id"]) =>
        items.find((item) =>
          keys.some((key) => plain(item[key]) === plain(id)),
        ),
      monitorDecisionQuestionHtml: (field) =>
        escapeHtml(field.label || field.code),
      monitorRoleTagHtml: (role) => `<span>${role}</span>`,
      ...overrides,
    },
  );
}

test("both changed UIs remain parseable and keep all approval choices", () => {
  for (const source of [config, evaluation]) {
    for (const [, script] of source.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    ))
      new vm.Script(script);
  }
  const roleDeclaration = config.match(
    /var REVIEW_TYPE_ROLES\s*=\s*\[([\s\S]*?)\]/,
  );
  assert.ok(roleDeclaration);
  for (const role of roles) assert.ok(roleDeclaration[1].includes(role));
  for (const value of ["accepted", "adjustment", "rejected"]) {
    assert.ok(evaluation.includes(`value: '${value}'`));
  }
  for (const label of [
    "Đồng ý với đề xuất của QLTT",
    "Có điều chỉnh đề xuất của QLTT",
    "Từ chối đề xuất của QLTT",
  ]) {
    assert.ok(evaluation.includes(`label: '${label}'`));
  }
  assert.match(evaluation, /node.innerHTML = bodReadOnlyHtml \|\|/);
  assert.match(
    config,
    /roleProgressHtml \+\s+answersHtml \+\s+cnbWorkspaceHtml/,
  );
  assert.match(config, /id="evaluationConfigCycleLifetimeDays"/);
  assert.doesNotMatch(config, /id="evaluationConfigCycleLeadDays"/);
  assert.doesNotMatch(config, /id="evaluationConfigCycleExpiryDays"/);
  assert.match(config, /manualDeadlineMode:\s*'from_generation'/);
  assert.match(config, /id="evaluationConfigMemberBodCode"/);
  assert.match(config, /id="evaluationBulkBodCode"/);
  assert.match(config, /previewEvaluationFinalization/);
  assert.match(config, /data-finalization-template-field/);
  assert.match(config, /value="cnb_finalization_required"/);
  assert.match(config, /data-mail-form-template-condition/);
});

test("Thông tin thêm khóa font hệ thống và màn chấm luôn phân khối rõ ràng", () => {
  assert.match(
    evaluation,
    /\.evaluation-extra-list input[^\n]+font-family:"Be Vietnam Pro",Arial,sans-serif!important/,
  );
  assert.match(
    evaluation,
    /\.evaluation-decision-question \*\{[^}]*font-family:"Be Vietnam Pro",Arial,sans-serif!important;[^}]*font-size:inherit!important/,
  );
  assert.match(
    config,
    /\.evaluation-monitor-review-extra-row \.evaluation-config-label \*\{[^}]*font-family:"Be Vietnam Pro",Arial,sans-serif!important;[^}]*font-size:inherit!important/,
  );
  assert.match(generatedEvaluation, /title: 'Đánh giá ' \+ section\.name/);
  assert.match(generatedEvaluation, /scoreSections\.join\(''\)/);
  assert.match(evaluationPage, /version="20260929-section-font-order-v1"/);
  assert.match(evaluationConfigPage, /version="20260930-monitor-sections-v2"/);

  const context = functions(
    generatedEvaluation,
    [
      "evaluationSectionKey",
      "evaluationSectionName",
      "evaluationConfiguredSections",
    ],
    { normalize: normalizeKey },
  );
  const sections = context.evaluationConfiguredSections([
    {
      contentMode: "criteria_set",
      criteriaSetName: "Đánh giá văn hóa",
      criteriaName: "Cầu thị học hỏi",
    },
    {
      contentMode: "jd_dynamic",
      workGroupName: "Vận hành",
      activityText: "Tiếp nhận yêu cầu",
      criteriaName: "Tốc độ xử lý",
    },
  ]);
  assert.deepEqual(
    Array.from(sections, (section) => section.name),
    ["Chuyên môn", "Văn hóa"],
  );
});

test("workflow supports repeated roles, named levels and per-reviewer completion policy", () => {
  assert.match(config, /id="evaluationWorkflowStepReviewers"/);
  assert.match(config, /id="evaluationWorkflowStepPolicy"/);
  assert.match(config, /value="all">Tất cả người duyệt/);
  assert.match(config, /value="any">Một người bất kỳ/);
  assert.match(config, /value="min_count">Tối thiểu N người/);
  assert.match(config, /reviewerEmployeeCodes:/);
  assert.match(config, /approvalPolicy:/);
  assert.doesNotMatch(config, /Vai trò này đã có trong workflow/);
  assert.match(evaluation, /assignmentId: instance\.reviewAssignmentId/);
  assert.match(evaluation, /state\.selectedAssignmentId/);
  assert.match(evaluation, /instance\.activeReviewAssignmentIds/);
  assert.match(
    evaluation,
    /if \(assignmentId && activeAssignmentIds\.indexOf\(assignmentId\) === -1\) return false/,
  );
});

test("six weight inputs round-trip independently; approval-only roles do not require a weight", () => {
  const context = functions(
    config,
    [
      "reviewTypeWeightInputId",
      "normalizeReviewTypeRoleWeights",
      "validateReviewTypeScoreSettings",
    ],
    {
      REVIEW_TYPE_ROLES: roles,
      numValue: Number,
      state: {
        reviewTypeSectionDraftItems: [
          { evaluatorRoles: "self,manager,indirect_manager,bod,hr" },
        ],
      },
      reviewTypeSectionRoles: (section) => section.evaluatorRoles.split(","),
      readReviewTypeScoreMode: () => "custom",
      readReviewTypeRoleWeightsFromForm: () => ({
        self: 40,
        manager: 60,
        indirect_manager: 0,
        peer: 0,
        hr: 0,
        bod: 0,
      }),
      roleLabel: plain,
      formatWeight: plain,
    },
  );
  const ids = roles.map((role) => context.reviewTypeWeightInputId(role));
  assert.equal(new Set(ids).size, 6);
  for (const id of ids) assert.equal(config.split(`id="${id}"`).length - 1, 1);
  assert.equal(context.reviewTypeWeightInputId("unknown"), "");
  const weights = context.normalizeReviewTypeRoleWeights({
    self: 10,
    manager: 20,
    indirectManager: 5,
    peer: 15,
    hr: 30,
    bod: 20,
  });
  assert.equal(weights.hr, 30);
  assert.equal(weights.bod, 20);
  assert.equal(weights.indirect_manager, 5);
  assert.equal(context.validateReviewTypeScoreSettings(false), true);
});

test("workflow blocks resolve DB ID, legacy ID and code consistently, including CnB", () => {
  const data = {
    cycleTypeTemplates: [
      {
        id: "TV",
        defaultWorkflowTemplateId: "legacy-flow",
        completionMode: "manual_finalization",
      },
    ],
    workflowTemplates: [
      { id: "db-flow", legacyId: "legacy-flow", code: "WF_TV" },
    ],
    workflowSteps: [
      { workflowTemplateId: "legacy-flow", role: "self" },
      { workflowCode: "WF_TV", role: "indirect_manager" },
      { workflowId: "db-flow", role: "hr" },
    ],
  };
  const context = sharedConfig(data, {
    REVIEW_TYPE_ROLES: roles,
    state: {
      reviewTypeSectionDraftItems: [{ evaluatorRoles: "self" }],
      reviewTypeFieldDraftItems: [{ role: "indirect_manager" }, { role: "hr" }],
    },
    cycleTypeByValue: () => ({
      defaultWorkflowTemplateId: "legacy-flow",
      completionMode: "manual_finalization",
    }),
    normalizeMailRecipientRole: plain,
    dedupeTexts: (values) => [...new Set(values)],
    reviewTypeCompletionMode: (value) => value,
  });
  for (const name of [
    "workflowKeys",
    "workflowStepLines",
    "workflowStepsForValue",
    "validateReviewTypeWorkflowRoles",
    "monitorWorkflowSteps",
    "mailWorkflowStepsForCycleType",
    "mailWorkflowRoleCodes",
    "mailAudienceRoles",
    "mailRoleReceivesEvent",
  ]) {
    const match = config.match(
      new RegExp(
        `^([ \\t]*)function ${name}\\([^)]*\\) \\{[\\s\\S]*?^\\1\\}`,
        "m",
      ),
    );
    assert.ok(match, `Missing function ${name}`);
    vm.runInContext(match[0], context);
  }
  assert.equal(context.validateReviewTypeWorkflowRoles("db-flow").length, 0);
  assert.equal(context.validateReviewTypeWorkflowRoles("WF_TV").length, 0);
  assert.equal(
    context.monitorWorkflowSteps({ workflowTemplateId: "legacy-flow" }).length,
    3,
  );
  assert.deepEqual(
    Array.from(context.mailAudienceRoles("review_assigned", "TV")),
    ["self", "indirect_manager", "hr"],
  );
  assert.equal(context.mailAudienceRoles("review_assigned", "").length, 6);
  assert.equal(context.mailRoleReceivesEvent("hr", "review_assigned"), false);
  assert.equal(context.mailRoleReceivesEvent("hr", "review_reminder"), false);
  assert.equal(context.mailRoleReceivesEvent("hr", "review_completed"), true);
  assert.equal(
    context.mailRoleReceivesEvent("hr", "cnb_finalization_required"),
    true,
  );
  assert.equal(
    context.mailRoleReceivesEvent("manager", "cnb_finalization_required"),
    false,
  );
});

test("CnB reads nested answers, conditional fields, zero and multiline comments inline", () => {
  const data = {
    decisionFields: [
      {
        code: "WANTS",
        role: "manager",
        label: "Có điều chỉnh?",
        fieldType: "yes_no",
      },
      {
        code: "DETAIL",
        role: "manager",
        label: "Nội dung",
        dependsOnFieldCode: "WANTS",
        dependsOnValue: "yes",
      },
      { code: "ZERO", role: "manager", label: "Số", fieldType: "number" },
      {
        code: "MULTI",
        role: "manager",
        label: "Lựa chọn",
        fieldType: "multi_choice",
        options: [
          { value: "a", label: "Phương án A" },
          { value: "b", label: "Phương án B" },
        ],
      },
    ],
  };
  const context = sharedConfig(data);
  const instance = {
    id: "instance",
    managerOverallComment: "Dòng 1\nDòng 2 <script>",
    decisionAnswers: {
      manager: {
        WANTS: "no",
        DETAIL: "hidden stale",
        ZERO: 0,
        MULTI: ["a", "b"],
      },
    },
  };
  const html = context.monitorRoleDecisionRowsHtml(instance, "manager");
  assert.ok(!html.includes("hidden stale"));
  assert.match(html, /Không/);
  assert.match(html, /<strong>0<\/strong>/);
  assert.match(html, /Phương án A, Phương án B/);
  assert.match(html, /Dòng 1\nDòng 2 &lt;script&gt;/);
  assert.ok(!html.includes("<input"));
  assert.equal((html.match(/<span>manager<\/span>/g) || []).length, 0);
  assert.equal(
    context.monitorDecisionFieldVisible(
      {
        visibilityCondition: {
          sourceFieldCode: "CHOICE",
          includeValues: ["a", "b"],
          matchMode: "all",
          excludeValues: ["c"],
        },
      },
      { CHOICE: '["a","b"]' },
    ),
    true,
  );
  assert.equal(
    context.monitorDecisionFieldVisible(
      {
        visibilityCondition: {
          sourceFieldCode: "CHOICE",
          includeValues: ["a"],
          excludeValues: ["c"],
        },
      },
      { CHOICE: ["a", "c"] },
    ),
    false,
  );
});

test("legacy answer matching never treats two missing IDs as equal; system approval is readable", () => {
  const context = sharedConfig({
    decisionValues: [
      {
        evaluationInstanceId: "i",
        role: "manager",
        fieldCode: "ONE",
        value: "first",
      },
      {
        evaluationInstanceId: "i",
        role: "manager",
        fieldCode: "TWO",
        value: 0,
      },
    ],
  });
  assert.equal(
    context.monitorDecisionValueForField(
      { id: "i" },
      { code: "TWO" },
      "manager",
    ).value,
    0,
  );
  const html = context.monitorRoleDecisionRowsHtml(
    {
      id: "i",
      decisionAnswers: {
        indirect_manager: {
          INDIRECT_MANAGER_DECISION: "accepted",
          INDIRECT_MANAGER_FEEDBACK: "stale rejected reason",
        },
      },
    },
    "indirect_manager",
  );
  assert.match(html, /Đồng ý với đề xuất của QLTT/);
  assert.ok(!html.includes("stale rejected reason"));
  assert.equal(
    context.monitorDecisionValueLabel(
      '{"amount":12,"unit":"month"}',
      "duration",
    ),
    "12 tháng",
  );
});

test("trường CnB mới chưa có thứ tự nằm sau các trường đã sắp xếp", () => {
  const context = sharedConfig({
    cycles: [{ id: "cycle-1", cycleTypeTemplateId: "type-1" }],
    decisionFields: [
      { code: "NEW", role: "hr", cycleTypeTemplateId: "type-1" },
      {
        code: "SECOND",
        role: "hr",
        cycleTypeTemplateId: "type-1",
        sortOrder: 20,
      },
      {
        code: "FIRST",
        role: "hr",
        cycleTypeTemplateId: "type-1",
        sortOrder: 10,
      },
    ],
  });
  const fields = context.monitorCnbFieldsForConclusion(
    { cycleId: "cycle-1", cycleTypeTemplateId: "type-1" },
    { id: "result-1" },
  );
  assert.deepEqual(
    Array.from(fields, (field) => field.code),
    ["FIRST", "SECOND", "NEW"],
  );
});

test("trường CnB dùng chung đứng trước trường riêng và mỗi nhóm giữ đúng thứ tự setting", () => {
  const context = sharedConfig({
    cycles: [{ id: "cycle-1", cycleTypeTemplateId: "type-1" }],
    decisionFields: [
      { code: "SHARED_2", role: "hr", cycleTypeTemplateId: "type-1", sortOrder: 20 },
      { code: "SPECIFIC_1", role: "hr", cycleTypeTemplateId: "type-1", decisionOptionId: "pass", sortOrder: 10 },
      { code: "SHARED_1", role: "hr", cycleTypeTemplateId: "type-1", sortOrder: 10 },
      { code: "SPECIFIC_2", role: "hr", cycleTypeTemplateId: "type-1", decisionOptionId: "pass", sortOrder: 20 },
    ],
  });
  const fields = context.monitorCnbFieldsForConclusion(
    { cycleId: "cycle-1", cycleTypeTemplateId: "type-1" },
    { id: "pass" },
  );
  assert.deepEqual(
    Array.from(fields, (field) => field.code),
    ["SHARED_1", "SHARED_2", "SPECIFIC_1", "SPECIFIC_2"],
  );
});

test("inline answers retain type aliases and role scope; rich question labels use the existing sanitizer", () => {
  const context = sharedConfig({
    cycleTypeTemplates: [
      { id: "type-db", legacyId: "type-old", code: "TYPE_CODE" },
    ],
    decisionFields: [
      {
        code: "MATCH",
        cycleTypeTemplateId: "type-old",
        role: "manager",
        label: "Đúng loại",
      },
      {
        code: "OTHER_ROLE",
        cycleTypeCode: "TYPE_CODE",
        role: "self",
        label: "Chỉ NV",
      },
      {
        code: "OTHER_TYPE",
        cycleTypeTemplateId: "another-type",
        role: "manager",
        label: "Loại khác",
      },
    ],
  });
  const selected = context.monitorDecisionAnswerFields(
    { id: "i", cycleTypeTemplateId: "type-db" },
    "manager",
  );
  assert.deepEqual(
    Array.from(selected, (field) => field.code),
    ["MATCH"],
  );
  const calls = [];
  const question = functions(config, ["monitorDecisionQuestionHtml"], {
    sanitizeMailHtml: (html) => {
      calls.push(html);
      return "<p>sanitized</p>";
    },
  });
  assert.equal(
    question.monitorDecisionQuestionHtml({
      labelHtml: '<p onclick="bad()">Câu hỏi</p>',
    }),
    "<p>sanitized</p>",
  );
  assert.equal(
    question.monitorDecisionQuestionHtml({ label: "<p>Nhãn cũ</p>" }),
    "<p>sanitized</p>",
  );
  assert.equal(calls.length, 2);
  assert.equal(
    question.monitorDecisionQuestionHtml({ label: "Lương < 10 triệu" }),
    "Lương &lt; 10 triệu",
  );
});

test("monitor stacks each answer below its question and overrides pasted fonts with Be Vietnam Pro", () => {
  assert.match(
    config,
    /\.evaluation-monitor-answer\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\);[\s\S]*?gap:\s*8px/,
  );
  assert.match(
    config,
    /\.evaluation-monitor-answer-main\s*\{[\s\S]*?display:\s*grid;[\s\S]*?grid-template-columns:\s*auto minmax\(0,\s*1fr\)/,
  );
  assert.match(
    config,
    /\.evaluation-monitor-answer-question \*\s*\{[\s\S]*?color:\s*inherit\s*!important;[\s\S]*?font-family:\s*"Be Vietnam Pro",\s*Arial,\s*sans-serif\s*!important;[\s\S]*?font-size:\s*inherit\s*!important/,
  );
  assert.match(
    config,
    /\.evaluation-monitor-answer\s*>\s*strong\s*\{[^}]*display:\s*block;[^}]*font-family:\s*"Be Vietnam Pro",\s*Arial,\s*sans-serif;[^}]*font-weight:\s*600/,
  );
});

test("QLGT readonly view includes employee scores, answers and overall comments; QLTT answers are separate", () => {
  assert.match(
    evaluation,
    /\.evaluation-prior-review-list\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
  );
  const nested = {
    self: { QUESTION: "Trả lời NV", WANTS: "no", HIDDEN: "stale" },
    manager: { QUESTION: "Trả lời QLTT" },
  };
  const context = functions(
    evaluation,
    [
      "evaluationDecisionAnswerValues",
      "evaluationDecisionConfiguredValues",
      "evaluationDecisionComparable",
      "evaluationDecisionDuration",
      "evaluationDecisionFieldSort",
      "evaluationReadonlyFieldVisible",
      "evaluationReadonlyAnswerLabel",
      "evaluationReadonlyScoreRow",
      "evaluationReadonlyScoreSummaryValue",
      "evaluationReadonlyScoreSummary",
      "evaluationReadonlyJdScores",
      "evaluationReadonlyScoreSections",
      "evaluationReadonlyPriorReview",
    ],
    {
      roleScorePrefix: (role) => (role === "self" ? "employee" : role),
      normalizeRole: plain,
      scoresForSelected: () => [
        {
          criteriaName: "Tiêu chí chỉ NV chấm",
          employeeScore: 8,
          employeeComment: "Ghi chú NV <b>",
          managerScore: 9,
          managerComment: "Ghi chú QLTT",
          contentMode: "jd_dynamic",
          workGroupCode: "GROUP_A",
          workGroupName: "Nhóm A",
          activityCode: "ACTIVITY_A",
          activityText: "Hoạt động A",
          expectedOutputText: "Đầu ra A",
          criteriaSetName: "Bộ tiêu chí A",
        },
      ],
      evaluationConfiguredSections: (scores) => [
        { bodyMode: "jd", name: "Section A", scores },
      ],
      evaluationScoreSectionMarkup: (section) =>
        `<section><h3>${section.title}</h3>${section.body}</section>`,
      evaluationSectionRoman: () => "I",
      evaluationSectionTone: () => "jd",
      activityTypeLabel: () => "Thực thi",
      pillHtml: (values) => `<span>${values.join(" · ")}</span>`,
      formatScoreValueForUi: plain,
      scoreInputMeta: () => ({ max: 10 }),
      decisionFieldsForInstance: () => [
        { code: "QUESTION", label: "Câu hỏi" },
        { code: "WANTS", label: "Có?" },
        { code: "HIDDEN", dependsOnFieldCode: "WANTS", dependsOnValue: "yes" },
      ],
      decisionValueForField: (_, field, role) => nested[role][field.code] || "",
      evaluationSanitizeQuestionHtml: () => "",
      list: () => [],
      isActiveLine: () => true,
    },
  );
  const instance = {
    id: "i",
    decisionAnswers: nested,
    employeeOverallComment: "Tổng kết NV",
    managerOverallComment: "Tổng kết QLTT",
  };
  const self = context.evaluationReadonlyPriorReview(instance, "self", true);
  const manager = context.evaluationReadonlyPriorReview(
    instance,
    "manager",
    true,
  );
  assert.match(self, /Section A/);
  assert.match(self, /evaluation-prior-summary/);
  assert.match(self, /<details class="evaluation-prior-review-details">/);
  assert.match(self, /Nhóm A/);
  assert.match(self, /Hoạt động A/);
  assert.match(self, /8\/10/);
  assert.match(self, /Tiêu chí chỉ NV chấm/);
  assert.match(self, /Ghi chú NV &lt;b&gt;/);
  assert.match(self, /Trả lời NV/);
  assert.match(self, /Tổng kết NV/);
  assert.ok(!self.includes("stale"));
  assert.match(manager, /9\/10/);
  assert.match(manager, /Ghi chú QLTT/);
  assert.match(manager, /Trả lời QLTT/);
  assert.match(manager, /Tổng kết QLTT/);
  assert.ok(!self.includes("data-score-id") && !self.includes("<input"));
});

test("QLTT tự mở ghi chú nhân viên và QLGT sau thấy kết quả cấp trước", () => {
  assert.match(
    evaluation,
    /aria-expanded="' \+ \(comment \? 'true' : 'false'\)/,
  );
  assert.match(evaluation, /is-reflection-open has-employee-note/);
  const context = functions(
    evaluation,
    [
      "evaluationDecisionAnswerValues",
      "evaluationDecisionDuration",
      "evaluationReadonlyAnswerLabel",
      "evaluationReadonlyAssignmentAnswer",
      "evaluationPriorReviewAssignments",
      "evaluationReadonlyPriorAssignments",
    ],
    {
      normalizeRole: plain,
      roleLabel: (role) => role,
      state: { selectedAssignmentId: "m3" },
    },
  );
  const html = context.evaluationReadonlyPriorAssignments({
    assignmentDecisionAnswers: {
      m2: {
        INDIRECT_MANAGER_DECISION: "accepted",
        INDIRECT_MANAGER_FEEDBACK: "Đã rà soát cấp M2",
      },
    },
    reviewAssignments: [
      {
        id: "m2",
        employeeCode: "M201",
        employeeName: "Quản lý M2",
        role: "indirect_manager",
        stageIndex: 1,
        status: "submitted",
        stepIndex: 1,
        stepLabel: "QLGT cấp 1",
      },
      {
        id: "m3",
        employeeCode: "M301",
        employeeName: "Quản lý M3",
        role: "indirect_manager",
        stageIndex: 2,
        status: "assigned",
        stepIndex: 2,
        stepLabel: "QLGT cấp 2",
      },
    ],
  });
  assert.match(html, /QLGT cấp 1/);
  assert.match(html, /Quản lý M2/);
  assert.match(html, /Đồng ý/);
  assert.match(html, /Đã rà soát cấp M2/);
  assert.ok(!html.includes("Quản lý M3"));
});

test("monitor opens the exact reviewer assignment instead of aggregating people with the same role", () => {
  const score = {
    id: "score-1",
    evaluationInstanceId: "instance-1",
    evaluatorRoles: "indirect_manager",
    assignmentReviews: {
      "assignment-a": { score: 3, comment: "Nhận xét A" },
      "assignment-yen": { score: 4.5, comment: "Nhận xét của Yến" },
    },
  };
  const context = functions(
    config,
    [
      "normalizeEvaluationRole",
      "monitorRolePrefix",
      "splitTextList",
      "monitorRoleAllows",
      "monitorReviewAssignments",
      "monitorReviewerLabel",
      "monitorScoresForRole",
      "monitorDecisionValueForField",
    ],
    {
      adminList: (key) =>
        key === "criteriaScores"
          ? [score]
          : key === "decisionValues"
            ? [
                {
                  evaluationInstanceId: "instance-1",
                  fieldCode: "CONFIRM",
                  reviewAssignmentId: "assignment-yen",
                  role: "indirect_manager",
                  status: "active",
                  value: "accepted",
                },
              ]
            : [],
      isActiveLine: (item) => item && item.status !== "inactive",
      roleLabel: plain,
    },
  );
  const instance = {
    id: "instance-1",
    reviewAssignments: [
      {
        id: "assignment-a",
        employeeCode: "A001",
        employeeName: "Người A",
        role: "indirect_manager",
      },
      {
        id: "assignment-yen",
        employeeCode: "Y001",
        employeeName: "Yến",
        role: "indirect_manager",
      },
    ],
    assignmentDecisionAnswers: {
      "assignment-a": {
        CONFIRM: "rejected",
        INDIRECT_MANAGER_DECISION: "rejected",
      },
      "assignment-yen": {
        CONFIRM: "accepted",
        INDIRECT_MANAGER_DECISION: "accepted",
      },
    },
  };
  assert.equal(
    context.monitorReviewerLabel(
      instance,
      "indirect_manager",
      "assignment-yen",
    ),
    "Yến",
  );
  const [yenScore] = context.monitorScoresForRole(
    instance,
    "indirect_manager",
    "assignment-yen",
  );
  assert.equal(yenScore.indirectManagerScore, 4.5);
  assert.equal(yenScore.indirectManagerComment, "Nhận xét của Yến");
  assert.equal(
    context.monitorDecisionValueForField(
      instance,
      { code: "CONFIRM" },
      "indirect_manager",
      "assignment-yen",
    ).value,
    "accepted",
  );
  const answerContext = sharedConfig({
    decisionFields: [
      {
        code: "INDIRECT_MANAGER_DECISION",
        fieldType: "single_choice",
        label: "Xác nhận",
        role: "indirect_manager",
      },
    ],
  });
  const yenAnswers = answerContext.monitorRoleDecisionRowsHtml(
    instance,
    "indirect_manager",
    "assignment-yen",
  );
  assert.match(yenAnswers, /Đồng ý với đề xuất của QLTT/);
  assert.ok(!yenAnswers.includes("Từ chối đề xuất của QLTT"));
  assert.match(
    config,
    /data-action="view-monitor-role-detail"[^>]*data-assignment-id=/,
  );
  assert.match(
    config,
    /openMonitorReviewDialog\(id, button\.getAttribute\('data-role'\), button\.getAttribute\('data-assignment-id'\)\)/,
  );
});
