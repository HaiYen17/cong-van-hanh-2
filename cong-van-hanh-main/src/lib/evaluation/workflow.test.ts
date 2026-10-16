import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvaluationReviewAssignments,
  evaluationAssignmentWorkflowState,
  evaluationInitialActiveRoles,
  evaluationNextActiveRoles,
  evaluationRequiredReviewerStepIssues,
  evaluationWorkflowRoleSkipReason,
  evaluationWorkflowStatusPatch,
  type EvaluationWorkflowStep,
} from "@/lib/evaluation/workflow";

const steps: EvaluationWorkflowStep[] = [
  { mode: "sequential", role: "manager" },
  { mode: "sequential", role: "indirect_manager" },
  { mode: "sequential", role: "bod" },
];

test("M1 -> M2 -> CEO when all reviewers are distinct", () => {
  const content = {
    bodEmployeeCode: "CEO01",
    indirectManagerEmployeeCode: "M2001",
    managerEmployeeCode: "M1001",
  };
  assert.deepEqual(evaluationInitialActiveRoles(steps, content), ["manager"]);
  assert.deepEqual(
    evaluationNextActiveRoles(steps, content, "manager"),
    ["indirect_manager"],
  );
  assert.deepEqual(
    evaluationNextActiveRoles(
      steps,
      { ...content, managerReviewStatus: "submitted" },
      "indirect_manager",
    ),
    ["bod"],
  );
});

test("skip M2 when M1 and M2 are the same person", () => {
  const content = {
    bodEmployeeCode: "CEO01",
    indirectManagerEmployeeCode: "M1001",
    managerEmployeeCode: "M1001",
  };
  assert.equal(
    evaluationWorkflowRoleSkipReason(content, "indirect_manager"),
    "same_as_direct_manager",
  );
  assert.deepEqual(
    evaluationNextActiveRoles(steps, content, "manager"),
    ["bod"],
  );
  assert.equal(
    evaluationWorkflowStatusPatch(
      ["manager", "indirect_manager", "bod"],
      content,
    ).indirectManagerReviewStatus,
    "skipped",
  );
});

test("skip M2 when M2 and CEO are the same person", () => {
  const content = {
    bodEmployeeCode: "CEO01",
    indirectManagerEmployeeCode: "CEO01",
    managerEmployeeCode: "M1001",
  };
  assert.equal(
    evaluationWorkflowRoleSkipReason(content, "indirect_manager"),
    "same_as_bod",
  );
  assert.deepEqual(
    evaluationNextActiveRoles(steps, content, "manager"),
    ["bod"],
  );
});

test("skip an empty M2 without blocking CEO", () => {
  const content = {
    bodEmployeeCode: "CEO01",
    indirectManagerEmployeeCode: "",
    managerEmployeeCode: "M1001",
  };
  assert.equal(
    evaluationWorkflowRoleSkipReason(content, "indirect_manager"),
    "missing_indirect_manager",
  );
  assert.deepEqual(
    evaluationNextActiveRoles(steps, content, "manager"),
    ["bod"],
  );
});

test("multiple reviewers in one level all have independent assignments", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        approvalPolicy: "all",
        label: "QLGT cấp 1",
        mode: "sequential",
        reviewerEmployeeCodes: ["M201", "M202"],
        role: "indirect_manager",
        stepKey: "m2-level-1",
      },
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["CEO01"],
        role: "bod",
        stepKey: "ceo",
      },
    ],
    {},
  );
  const initial = evaluationAssignmentWorkflowState(assignments);
  assert.equal(initial.activeAssignmentIds.length, 2);
  const afterFirst = evaluationAssignmentWorkflowState(
    initial.assignments,
    initial.activeAssignmentIds[0],
  );
  assert.equal(afterFirst.activeAssignmentIds.length, 1);
  assert.equal(
    afterFirst.assignments.find(
      (assignment) => assignment.id === initial.activeAssignmentIds[0],
    )?.status,
    "submitted",
  );
  const afterSecond = evaluationAssignmentWorkflowState(
    afterFirst.assignments,
    afterFirst.activeAssignmentIds[0],
  );
  assert.deepEqual(
    afterSecond.assignments
      .filter((assignment) =>
        afterSecond.activeAssignmentIds.includes(assignment.id),
      )
      .map((assignment) => assignment.employeeCode),
    ["CEO01"],
  );
});

test("manual member reviewer lists override the workflow default for that member", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        approvalPolicy: "all",
        mode: "sequential",
        reviewerEmployeeCodes: ["DEFAULT-M2"],
        role: "indirect_manager",
        stepKey: "m2",
      },
      {
        approvalPolicy: "any",
        mode: "sequential",
        reviewerEmployeeCodes: ["DEFAULT-BOD"],
        role: "bod",
        stepKey: "bod",
      },
    ],
    {
      bodEmployeeCodes: ["BOD01", "BOD02"],
      indirectManagerEmployeeCodes: ["M201", "M202"],
    },
  );
  assert.deepEqual(
    assignments
      .filter((assignment) => assignment.role === "indirect_manager")
      .map((assignment) => assignment.employeeCode),
    ["M201", "M202"],
  );
  assert.deepEqual(
    assignments
      .filter((assignment) => assignment.role === "bod")
      .map((assignment) => assignment.employeeCode),
    ["BOD01", "BOD02"],
  );
});

test("duplicate indirect managers are removed without dropping distinct reviewers", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        approvalPolicy: "all",
        mode: "sequential",
        role: "indirect_manager",
        stepKey: "m2",
      },
    ],
    {
      bodEmployeeCodes: ["CEO01"],
      employeeCode: "NV01",
      indirectManagerEmployeeCodes: ["M101", "M201", "CEO01", "NV01"],
      managerEmployeeCodes: ["M101"],
    },
  );
  assert.deepEqual(
    assignments.map((assignment) => assignment.employeeCode),
    ["M201"],
  );
});

test("any policy advances after one reviewer and skips unused siblings", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        approvalPolicy: "any",
        mode: "sequential",
        reviewerEmployeeCodes: ["M201", "M202", "M203"],
        role: "indirect_manager",
        stepKey: "m2-any",
      },
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["CEO01"],
        role: "bod",
        stepKey: "ceo",
      },
    ],
    {},
  );
  const initial = evaluationAssignmentWorkflowState(assignments);
  const next = evaluationAssignmentWorkflowState(
    initial.assignments,
    initial.activeAssignmentIds[1],
  );
  assert.equal(
    next.assignments.filter((assignment) => assignment.status === "skipped")
      .length,
    2,
  );
  assert.deepEqual(
    next.assignments
      .filter((assignment) => next.activeAssignmentIds.includes(assignment.id))
      .map((assignment) => assignment.employeeCode),
    ["CEO01"],
  );
});

test("minimum policy waits for N distinct assignments", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        approvalPolicy: "min_count",
        minimumApprovals: 2,
        mode: "sequential",
        reviewerEmployeeCodes: ["M201", "M202", "M203"],
        role: "manager",
        stepKey: "committee",
      },
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["CEO01"],
        role: "bod",
        stepKey: "ceo",
      },
    ],
    {},
  );
  const initial = evaluationAssignmentWorkflowState(assignments);
  const afterFirst = evaluationAssignmentWorkflowState(
    initial.assignments,
    initial.activeAssignmentIds[0],
  );
  assert.equal(afterFirst.activeAssignmentIds.length, 2);
  const afterSecond = evaluationAssignmentWorkflowState(
    afterFirst.assignments,
    afterFirst.activeAssignmentIds[0],
  );
  assert.deepEqual(
    afterSecond.assignments
      .filter((assignment) =>
        afterSecond.activeAssignmentIds.includes(assignment.id),
      )
      .map((assignment) => assignment.employeeCode),
    ["CEO01"],
  );
  assert.equal(
    afterSecond.assignments.filter((assignment) => assignment.status === "skipped")
      .length,
    1,
  );
});

test("the same role can appear in sequential levels without id collisions", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["M201"],
        role: "indirect_manager",
        stepKey: "m2-level-1",
      },
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["M301"],
        role: "indirect_manager",
        stepKey: "m2-level-2",
      },
    ],
    {},
  );
  assert.equal(new Set(assignments.map((assignment) => assignment.id)).size, 2);
  const initial = evaluationAssignmentWorkflowState(assignments);
  const next = evaluationAssignmentWorkflowState(
    initial.assignments,
    initial.activeAssignmentIds[0],
  );
  assert.deepEqual(
    next.assignments
      .filter((assignment) => next.activeAssignmentIds.includes(assignment.id))
      .map((assignment) => assignment.employeeCode),
    ["M301"],
  );
});

test("member reviewers can be assigned to each repeated workflow step", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["DEFAULT-M2"],
        role: "indirect_manager",
        stepKey: "m2",
      },
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["DEFAULT-M3"],
        role: "indirect_manager",
        stepKey: "m3",
      },
      {
        mode: "sequential",
        reviewerEmployeeCodes: ["DEFAULT-CEO"],
        role: "bod",
        stepKey: "ceo",
      },
    ],
    {
      bodEmployeeCodes: ["CEO02"],
      indirectManagerEmployeeCodes: ["M201", "M301"],
      reviewerEmployeeCodesByStep: {
        ceo: ["CEO02"],
        m2: ["M201"],
        m3: ["M301"],
      },
    },
  );

  assert.deepEqual(
    assignments.map((assignment) => [
      assignment.stepKey,
      assignment.employeeCode,
    ]),
    [
      ["m2", "M201"],
      ["m3", "M301"],
      ["ceo", "CEO02"],
    ],
  );
});

test("legacy ordered QLGT list is distributed across repeated levels", () => {
  const assignments = buildEvaluationReviewAssignments(
    [
      { mode: "sequential", role: "indirect_manager", stepKey: "m2" },
      { mode: "sequential", role: "indirect_manager", stepKey: "m3" },
    ],
    { indirectManagerEmployeeCodes: ["M201", "M301"] },
  );

  assert.deepEqual(
    assignments.map((assignment) => [
      assignment.stepKey,
      assignment.employeeCode,
    ]),
    [
      ["m2", "M201"],
      ["m3", "M301"],
    ],
  );
});

test("required repeated QLGT and CEO steps report missing reviewers", () => {
  const requiredSteps: EvaluationWorkflowStep[] = [
    { label: "M2", mode: "sequential", role: "indirect_manager", stepKey: "m2" },
    { label: "M3", mode: "sequential", role: "indirect_manager", stepKey: "m3" },
    { label: "CEO", mode: "sequential", role: "bod", stepKey: "ceo" },
  ];
  assert.deepEqual(
    evaluationRequiredReviewerStepIssues(requiredSteps, {
      indirectManagerEmployeeCodes: ["M201"],
    }),
    ["M3", "CEO"],
  );
  assert.deepEqual(
    evaluationRequiredReviewerStepIssues(requiredSteps, {
      bodEmployeeCodes: ["CEO01"],
      indirectManagerEmployeeCodes: ["M201", "M301"],
    }),
    [],
  );
});
