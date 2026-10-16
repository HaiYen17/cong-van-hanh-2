import { evaluationReviewAssignments } from "@/lib/evaluation/workflow";

export type EvaluationBadgeContent = {
  activeReviewAssignmentIds?: unknown;
  activeStepRoles?: unknown;
  bodEmployeeCode?: unknown;
  bodReviewStatus?: unknown;
  currentStepRole?: unknown;
  employeeCode?: unknown;
  employeeReviewStatus?: unknown;
  hrEmployeeCode?: unknown;
  hrReviewStatus?: unknown;
  indirectManagerEmployeeCode?: unknown;
  indirectManagerReviewStatus?: unknown;
  managerEmployeeCode?: unknown;
  managerReviewStatus?: unknown;
  peerEmployeeCode?: unknown;
  peerReviewStatus?: unknown;
  reviewAssignments?: unknown;
  workflowCompleted?: unknown;
};

function text(value: unknown) {
  return String(value ?? "").trim();
}

const COMPLETED_REVIEW_STATUSES = new Set([
  "approved",
  "complete",
  "completed",
  "skipped",
  "submitted",
]);

const ROLE_FIELDS = {
  bod: ["bodEmployeeCode", "bodReviewStatus"],
  hr: ["hrEmployeeCode", "hrReviewStatus"],
  indirect_manager: [
    "indirectManagerEmployeeCode",
    "indirectManagerReviewStatus",
  ],
  manager: ["managerEmployeeCode", "managerReviewStatus"],
  peer: ["peerEmployeeCode", "peerReviewStatus"],
  self: ["employeeCode", "employeeReviewStatus"],
} as const;

export function isPendingEvaluationFor(
  content: EvaluationBadgeContent,
  employeeCode: string,
) {
  const viewerCode = text(employeeCode);
  if (!viewerCode || content.workflowCompleted === true) return false;
  const assignments = evaluationReviewAssignments(
    content as Record<string, unknown>,
  );
  if (assignments.length) {
    const activeIds = new Set(
      Array.isArray(content.activeReviewAssignmentIds)
        ? content.activeReviewAssignmentIds.map(text).filter(Boolean)
        : [],
    );
    return assignments.some(
      (assignment) =>
        assignment.employeeCode === viewerCode &&
        activeIds.has(assignment.id) &&
        !COMPLETED_REVIEW_STATUSES.has(assignment.status),
    );
  }
  const roles = Array.isArray(content.activeStepRoles)
    ? content.activeStepRoles.map(text).filter(Boolean)
    : [text(content.currentStepRole)].filter(Boolean);
  return roles.some((role) => {
    const fields = ROLE_FIELDS[role as keyof typeof ROLE_FIELDS];
    if (!fields) return false;
    const [employeeCodeField, reviewStatusField] = fields;
    if (text(content[employeeCodeField]) !== viewerCode) return false;
    return !COMPLETED_REVIEW_STATUSES.has(
      text(content[reviewStatusField]).toLowerCase(),
    );
  });
}
