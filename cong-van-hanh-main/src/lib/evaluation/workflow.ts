import {
  asRecord,
  stringList,
  text,
  type JsonRecord,
} from "@/lib/operations/json";

export const EVALUATION_REVIEW_ROLES = [
  "self",
  "manager",
  "indirect_manager",
  "peer",
  "hr",
  "bod",
] as const;

export type EvaluationRole = (typeof EVALUATION_REVIEW_ROLES)[number];

export type EvaluationWorkflowStep = {
  approvalPolicy?: unknown;
  id?: unknown;
  label?: unknown;
  minimumApprovals?: unknown;
  mode: string;
  reviewerEmployeeCodes?: unknown;
  role: EvaluationRole;
  stepKey?: unknown;
  sortOrder?: unknown;
};

export type EvaluationApprovalPolicy = "all" | "any" | "min_count";

export type EvaluationReviewAssignment = {
  approvalPolicy: EvaluationApprovalPolicy;
  email: string;
  employeeCode: string;
  employeeName: string;
  id: string;
  minimumApprovals: number;
  mode: string;
  overallComment?: string;
  role: EvaluationRole;
  stageIndex: number;
  status: "assigned" | "draft" | "skipped" | "submitted";
  stepIndex: number;
  stepKey: string;
  stepLabel: string;
  submittedAt?: string;
  submittedBy?: string;
};

export type EvaluationReviewerIdentity = {
  email?: unknown;
  employeeCode: unknown;
  employeeName?: unknown;
};

export function normalizeEvaluationRole(value: unknown): EvaluationRole | "" {
  const role = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["employee", "nhan_su", "nhan_vien", "staff"].includes(role)) {
    return "self";
  }
  if (["leader", "manager_1", "m1", "quan_ly", "quan_ly_truc_tiep", "supervisor"].includes(role)) {
    return "manager";
  }
  if (["indirect_manager", "manager_2", "m2", "quan_ly_gian_tiep"].includes(role)) {
    return "indirect_manager";
  }
  if (["colleague", "coworker", "dong_nghiep"].includes(role)) {
    return "peer";
  }
  if (["ban_giam_doc", "board", "board_of_directors", "ceo", "m3", "manager_3"].includes(role)) {
    return "bod";
  }
  if (["cnb", "human_resources"].includes(role)) return "hr";
  return EVALUATION_REVIEW_ROLES.includes(role as EvaluationRole)
    ? (role as EvaluationRole)
    : "";
}

export function evaluationRolePrefix(role: EvaluationRole) {
  if (role === "self") return "employee";
  if (role === "indirect_manager") return "indirectManager";
  return role;
}

export function evaluationRoleReviewStatus(
  content: JsonRecord,
  role: EvaluationRole,
) {
  return text(content[`${evaluationRolePrefix(role)}ReviewStatus`]).toLowerCase();
}

export function evaluationRoleEmployeeCode(
  content: JsonRecord,
  role: EvaluationRole,
) {
  return text(content[`${evaluationRolePrefix(role)}EmployeeCode`]);
}

export function evaluationRoleEmployeeCodes(
  content: JsonRecord,
  role: EvaluationRole,
) {
  const prefix = evaluationRolePrefix(role);
  const configured = stringList(content[`${prefix}EmployeeCodes`]);
  const fallback =
    role === "self"
      ? text(content.employeeCode || content.employeeId)
      : evaluationRoleEmployeeCode(content, role);
  return Array.from(
    new Set([...configured, fallback].map((value) => text(value)).filter(Boolean)),
  );
}

export function evaluationWorkflowRoleSkipReason(
  content: JsonRecord,
  role: EvaluationRole,
) {
  if (role !== "indirect_manager") return "";
  const identity = (value: unknown) => text(value).trim().toLowerCase();
  const indirectManagerCodes = evaluationRoleEmployeeCodes(content, role).map(identity);
  if (!indirectManagerCodes.length) return "missing_indirect_manager";
  const directManagerCodes = new Set(
    evaluationRoleEmployeeCodes(content, "manager").map(identity),
  );
  const bodCodes = new Set(evaluationRoleEmployeeCodes(content, "bod").map(identity));
  const employeeCodes = new Set(evaluationRoleEmployeeCodes(content, "self").map(identity));
  if (indirectManagerCodes.some((code) =>
    !directManagerCodes.has(code) && !bodCodes.has(code) && !employeeCodes.has(code)
  )) {
    return "";
  }
  if (indirectManagerCodes.every((code) => directManagerCodes.has(code))) {
    return "same_as_direct_manager";
  }
  if (indirectManagerCodes.every((code) => bodCodes.has(code))) {
    return "same_as_bod";
  }
  if (indirectManagerCodes.every((code) => employeeCodes.has(code))) {
    return "same_as_employee";
  }
  return "duplicate_reviewer";
}

export function evaluationEffectiveWorkflowSteps(
  steps: EvaluationWorkflowStep[],
  content: JsonRecord,
) {
  return steps.filter(
    (step) => !evaluationWorkflowRoleSkipReason(content, step.role),
  );
}

function evaluationWorkflowGroups(steps: EvaluationWorkflowStep[]) {
  const groups: EvaluationWorkflowStep[][] = [];
  for (const step of steps) {
    if (!groups.length || step.mode !== "parallel") {
      groups.push([step]);
    } else {
      groups[groups.length - 1].push(step);
    }
  }
  return groups;
}

export function evaluationInitialActiveRoles(
  steps: EvaluationWorkflowStep[],
  content: JsonRecord,
): EvaluationRole[] {
  return Array.from(
    new Set(
      evaluationWorkflowGroups(evaluationEffectiveWorkflowSteps(steps, content))[0]
        ?.map((step) => step.role) || ["self"],
    ),
  ) as EvaluationRole[];
}

export function evaluationNextActiveRoles(
  steps: EvaluationWorkflowStep[],
  content: JsonRecord,
  submittedRole: EvaluationRole,
): EvaluationRole[] {
  const roleSubmitted = (role: EvaluationRole) =>
    role === submittedRole ||
    evaluationRoleReviewStatus(content, role) === "submitted";
  for (const group of evaluationWorkflowGroups(
    evaluationEffectiveWorkflowSteps(steps, content),
  )) {
    const pending = group
      .map((step) => step.role)
      .filter((role) => !roleSubmitted(role));
    if (pending.length) return Array.from(new Set(pending));
  }
  return [];
}

export function evaluationWorkflowStatusPatch(
  configuredRoles: EvaluationRole[],
  content: JsonRecord,
) {
  return Object.fromEntries(
    EVALUATION_REVIEW_ROLES.map((role) => {
      const skipReason = evaluationWorkflowRoleSkipReason(content, role);
      return [
        `${evaluationRolePrefix(role)}ReviewStatus`,
        configuredRoles.includes(role)
          ? skipReason
            ? "skipped"
            : "assigned"
          : "",
      ];
    }),
  );
}

export function evaluationActiveRoles(content: JsonRecord) {
  return stringList(content.activeStepRoles)
    .map(normalizeEvaluationRole)
    .filter((role): role is EvaluationRole => Boolean(role));
}

function normalizedAssignmentStatus(value: unknown) {
  const status = text(value).toLowerCase();
  return ["draft", "skipped", "submitted"].includes(status)
    ? (status as EvaluationReviewAssignment["status"])
    : "assigned";
}

export function normalizeEvaluationApprovalPolicy(
  value: unknown,
): EvaluationApprovalPolicy {
  const policy = text(value).toLowerCase().replace(/[\s-]+/g, "_");
  if (["any", "one", "one_of", "mot_nguoi"].includes(policy)) return "any";
  if (["min", "minimum", "min_count", "minimum_count"].includes(policy)) {
    return "min_count";
  }
  return "all";
}

export function evaluationWorkflowStepKey(
  step: EvaluationWorkflowStep,
  index: number,
) {
  return (
    text(step.stepKey || step.id) ||
    `step-${index + 1}-${normalizeEvaluationRole(step.role) || "self"}`
  );
}

function assignmentIdPart(value: unknown) {
  return (
    text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "unknown"
  );
}

function reviewerCodesForStep(
  step: EvaluationWorkflowStep,
  content: JsonRecord,
  options: {
    roleStepCount: number;
    roleStepIndex: number;
    stepKey: string;
  },
) {
  const reviewerCodesByStep = asRecord(content.reviewerEmployeeCodesByStep);
  const hasStepReviewers = Object.prototype.hasOwnProperty.call(
    reviewerCodesByStep,
    options.stepKey,
  );
  const stepReviewers = stringList(reviewerCodesByStep[options.stepKey]);
  const memberConfigured = evaluationRoleEmployeeCodes(content, step.role);
  const pluralKey = `${evaluationRolePrefix(step.role)}EmployeeCodes`;
  const memberRoleCodes = stringList(content[pluralKey]);
  const workflowReviewers = stringList(step.reviewerEmployeeCodes);
  let selected: string[];
  if (hasStepReviewers) {
    selected = stepReviewers;
  } else if (memberRoleCodes.length && options.roleStepCount > 1) {
    selected = memberRoleCodes[options.roleStepIndex]
      ? [memberRoleCodes[options.roleStepIndex]]
      : [];
  } else if (memberRoleCodes.length) {
    selected = memberConfigured;
  } else if (workflowReviewers.length) {
    selected = workflowReviewers;
  } else {
    selected = memberConfigured;
  }
  if (step.role !== "indirect_manager") return selected;
  const excluded = new Set(
    (["self", "manager", "bod"] as EvaluationRole[])
      .flatMap((role) => evaluationRoleEmployeeCodes(content, role))
      .map((code) => text(code).toLowerCase()),
  );
  return selected.filter((code) => !excluded.has(text(code).toLowerCase()));
}

function roleIdentityFromContent(
  content: JsonRecord,
  role: EvaluationRole,
): EvaluationReviewerIdentity {
  const prefix = evaluationRolePrefix(role);
  return {
    email: role === "self" ? content.employeeEmail : content[`${prefix}Email`],
    employeeCode:
      role === "self"
        ? content.employeeCode || content.employeeId
        : evaluationRoleEmployeeCode(content, role),
    employeeName:
      role === "self" ? content.employeeName : content[`${prefix}Name`],
  };
}

export function buildEvaluationReviewAssignments(
  steps: EvaluationWorkflowStep[],
  content: JsonRecord,
  resolveReviewer?: (
    employeeCode: string,
    role: EvaluationRole,
  ) => EvaluationReviewerIdentity | null | undefined,
) {
  const assignments: EvaluationReviewAssignment[] = [];
  const roleStepCounts = new Map<EvaluationRole, number>();
  const roleStepIndexes = new Map<EvaluationRole, number>();
  steps.forEach((step) => {
    const role = normalizeEvaluationRole(step.role) || "self";
    roleStepCounts.set(role, (roleStepCounts.get(role) || 0) + 1);
  });
  let stageIndex = -1;
  steps.forEach((step, stepIndex) => {
    const role = normalizeEvaluationRole(step.role) || "self";
    const mode = text(step.mode) === "parallel" ? "parallel" : "sequential";
    if (stageIndex < 0 || mode !== "parallel") stageIndex += 1;
    const stepKey = evaluationWorkflowStepKey(step, stepIndex);
    const roleStepIndex = roleStepIndexes.get(role) || 0;
    roleStepIndexes.set(role, roleStepIndex + 1);
    const approvalPolicy = normalizeEvaluationApprovalPolicy(
      step.approvalPolicy,
    );
    const reviewerCodes = Array.from(
      new Set(
        reviewerCodesForStep({ ...step, role }, content, {
          roleStepCount: roleStepCounts.get(role) || 1,
          roleStepIndex,
          stepKey,
        }).map((code) => text(code)),
      ),
    ).filter(Boolean);
    const minimumApprovals = Math.max(
      1,
      Math.min(
        reviewerCodes.length || 1,
        Number(step.minimumApprovals) || 1,
      ),
    );
    reviewerCodes.forEach((employeeCode) => {
      const roleIdentity = roleIdentityFromContent(content, role);
      const resolved = resolveReviewer
        ? resolveReviewer(employeeCode, role) ||
          (text(roleIdentity.employeeCode).toLowerCase() ===
          employeeCode.toLowerCase()
            ? roleIdentity
            : { employeeCode })
        : roleIdentity;
      assignments.push({
        approvalPolicy,
        email: text(resolved.email),
        employeeCode,
        employeeName: text(resolved.employeeName) || employeeCode,
        id: `review-${assignmentIdPart(stepKey)}-${assignmentIdPart(employeeCode)}`,
        minimumApprovals,
        mode,
        role,
        stageIndex,
        status: "assigned",
        stepIndex,
        stepKey,
        stepLabel: text(step.label) || `Cấp ${stepIndex + 1}`,
      });
    });
  });
  return assignments;
}

export function evaluationRequiredReviewerStepIssues(
  steps: EvaluationWorkflowStep[],
  content: JsonRecord,
) {
  const assignments = buildEvaluationReviewAssignments(steps, content);
  const assignedStepKeys = new Set(
    assignments.map((assignment) => assignment.stepKey),
  );
  const indirectStepCount = steps.filter(
    (step) => normalizeEvaluationRole(step.role) === "indirect_manager",
  ).length;
  return steps.flatMap((step, index) => {
    const role = normalizeEvaluationRole(step.role) || "self";
    const required =
      role === "bod" || (role === "indirect_manager" && indirectStepCount > 1);
    const stepKey = evaluationWorkflowStepKey(step, index);
    if (!required || assignedStepKeys.has(stepKey)) return [];
    return [
      text(step.label) ||
        (role === "bod"
          ? "Giám đốc / CEO"
          : `Quản lý gián tiếp cấp ${index + 1}`),
    ];
  });
}

export function evaluationReviewAssignments(
  content: JsonRecord,
): EvaluationReviewAssignment[] {
  if (!Array.isArray(content.reviewAssignments)) return [];
  return content.reviewAssignments.flatMap((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const assignment = raw as Record<string, unknown>;
    const role = normalizeEvaluationRole(assignment.role);
    const employeeCode = text(assignment.employeeCode);
    const stepKey = text(assignment.stepKey) || `step-${index + 1}`;
    if (!role || !employeeCode) return [];
    return [
      {
        approvalPolicy: normalizeEvaluationApprovalPolicy(
          assignment.approvalPolicy,
        ),
        email: text(assignment.email),
        employeeCode,
        employeeName: text(assignment.employeeName) || employeeCode,
        id:
          text(assignment.id) ||
          `review-${assignmentIdPart(stepKey)}-${assignmentIdPart(employeeCode)}`,
        minimumApprovals: Math.max(
          1,
          Number(assignment.minimumApprovals) || 1,
        ),
        mode: text(assignment.mode) === "parallel" ? "parallel" : "sequential",
        overallComment: text(assignment.overallComment),
        role,
        stageIndex: Math.max(0, Number(assignment.stageIndex) || 0),
        status: normalizedAssignmentStatus(assignment.status),
        stepIndex: Math.max(0, Number(assignment.stepIndex) || index),
        stepKey,
        stepLabel: text(assignment.stepLabel) || `Cấp ${index + 1}`,
        submittedAt: text(assignment.submittedAt),
        submittedBy: text(assignment.submittedBy),
      },
    ];
  });
}

function assignmentStepSatisfied(assignments: EvaluationReviewAssignment[]) {
  if (!assignments.length) return true;
  const submitted = assignments.filter(
    (assignment) => assignment.status === "submitted",
  ).length;
  const policy = assignments[0].approvalPolicy;
  if (policy === "any") return submitted >= 1;
  if (policy === "min_count") {
    return submitted >= assignments[0].minimumApprovals;
  }
  return assignments.every((assignment) =>
    ["skipped", "submitted"].includes(assignment.status),
  );
}

export function evaluationAssignmentWorkflowState(
  source: EvaluationReviewAssignment[],
  submittedAssignmentId = "",
) {
  let assignments = source.map((assignment) => ({
    ...assignment,
    status:
      assignment.id === submittedAssignmentId
        ? ("submitted" as const)
        : assignment.status,
  }));
  const stages = Array.from(
    new Set(assignments.map((assignment) => assignment.stageIndex)),
  ).sort((left, right) => left - right);
  for (const stageIndex of stages) {
    const stageAssignments = assignments.filter(
      (assignment) => assignment.stageIndex === stageIndex,
    );
    const stepKeys = Array.from(
      new Set(stageAssignments.map((assignment) => assignment.stepKey)),
    );
    const satisfiedSteps = new Set(
      stepKeys.filter((stepKey) =>
        assignmentStepSatisfied(
          stageAssignments.filter(
            (assignment) => assignment.stepKey === stepKey,
          ),
        ),
      ),
    );
    assignments = assignments.map((assignment) =>
      assignment.stageIndex === stageIndex &&
      satisfiedSteps.has(assignment.stepKey) &&
      assignment.status !== "submitted"
        ? { ...assignment, status: "skipped" as const }
        : assignment,
    );
    if (satisfiedSteps.size !== stepKeys.length) {
      return {
        activeAssignmentIds: assignments
          .filter(
            (assignment) =>
              assignment.stageIndex === stageIndex &&
              !satisfiedSteps.has(assignment.stepKey) &&
              !["skipped", "submitted"].includes(assignment.status),
          )
          .map((assignment) => assignment.id),
        assignments,
        completed: false,
      };
    }
  }
  return { activeAssignmentIds: [], assignments, completed: true };
}

export function evaluationAssignmentRoles(
  assignments: EvaluationReviewAssignment[],
  activeAssignmentIds: string[],
) {
  const active = new Set(activeAssignmentIds);
  return Array.from(
    new Set(
      assignments
        .filter((assignment) => active.has(assignment.id))
        .map((assignment) => assignment.role),
    ),
  );
}
