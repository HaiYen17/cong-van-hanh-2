import "server-only";

import { createHash } from "node:crypto";

import { GoogleAuth } from "google-auth-library";
import {
  createJdDriveReader,
  JD_SYNC_ENGINE,
  jdDriveErrorMessage,
  jdSourceHash,
  jdStructureCode,
  mergeJdActivityContent,
  parseJdDriveLocation,
  parseJdSourceText,
} from "@/lib/evaluation/jd-source";
import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  evaluationDecisionAnswerIsPresent,
  evaluationDecisionFieldIsVisible,
} from "@/lib/evaluation/decision-fields";
import { applyEvaluationDecisionCalculations } from "@/lib/evaluation/decision-calculations";
import { resolveSharedJdsForMembers } from "@/lib/evaluation/jd-resolution";
import {
  canonicalEvaluationJdTitle,
  deriveEvaluationJdTitle,
  getEvaluationJdTitle,
  matchEvaluationJdDirectoryTitle,
  normalizePositionKey,
} from "@/lib/evaluation/jd-policy";
import {
  evaluationMailHtmlToText,
  sanitizeEvaluationMailHtml,
} from "@/lib/evaluation/mail-template";
import {
  evaluationAvailableFromValue,
  evaluationDeadlineValue,
  normalizeEvaluationMailCustomVariable,
  planEvaluationMailRetries,
  previewEvaluationFinalizationTemplates,
  processEvaluationMailOutbox,
  queueEvaluationMailForCycle,
  queueEvaluationMailForInstance,
} from "@/lib/evaluation/mail-delivery";
import {
  evaluationMailRoleTemplates,
  evaluationNewlyActivatedRoles,
  evaluationMailTemplateCycleTypeKeys,
  hasEvaluationMailRoleTemplates,
} from "@/lib/evaluation/mail-flow";
import { buildEvaluationScorePlan } from "@/lib/evaluation/score-planning";
import {
  EVALUATION_REVIEW_ROLES,
  buildEvaluationReviewAssignments,
  evaluationAssignmentRoles,
  evaluationAssignmentWorkflowState,
  evaluationInitialActiveRoles,
  evaluationNextActiveRoles,
  evaluationRequiredReviewerStepIssues,
  evaluationReviewAssignments,
  evaluationRolePrefix,
  evaluationRoleReviewStatus,
  evaluationWorkflowStatusPatch,
  normalizeEvaluationRole,
  type EvaluationReviewAssignment,
  type EvaluationRole,
  type EvaluationWorkflowStep,
} from "@/lib/evaluation/workflow";
import {
  EVALUATION_AUTOMATION_SERVICE_ACCOUNT,
  autoMapEvaluationAutomationHeaders,
  evaluationAutomationConfigForClient,
  inspectEvaluationAutomationSpreadsheet,
  loadEvaluationAutomationHierarchySource,
  loadEvaluationAutomationSource,
  mappedEvaluationAutomationValue,
  normalizeEvaluationAutomationSourceConfig,
  type EvaluationAutomationSheetRow,
  type EvaluationAutomationSourceConfig,
} from "@/lib/evaluation/source-automation";
import {
  buildEvaluationLegacyIdMap,
  evaluationRecordIdentifiers,
  evaluationRecordLegacyId,
  findEvaluationRecordByIdentifier,
  mapEvaluationLegacyReferences,
} from "@/lib/evaluation/record-identity";
import {
  asRecord,
  booleanValue,
  numberValue,
  stringList,
  text,
  uniqueCode,
  type JsonRecord,
} from "@/lib/operations/json";
import {
  resolveOperationActor,
  type OperationActor,
} from "@/lib/operations/actor";
import {
  listModuleMailRoutes,
  resolveModuleMailRoute,
} from "@/lib/mail/module-mail-router";

export class EvaluationRuntimeError extends Error {
  status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "EvaluationRuntimeError";
    this.status = status;
  }
}

const EVALUATION_INACTIVE_STATUSES = new Set([
  "archived",
  "deleted",
  "inactive",
]);

type EvaluationDirectoryEmployee = {
  archivedAt: Date | null;
  department: string | null;
  email: string | null;
  employeeCode: string;
  fullName: string;
  status: string;
  terminationDate: string | null;
  title: string | null;
};

type EvaluationEmploymentState = {
  code: "active" | "archived" | "inactive" | "not_found" | "terminated";
  eligible: boolean;
  reason: string;
};

function evaluationDateKey(value: unknown) {
  const raw = text(value);
  if (!raw) return "";
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    return `${match[1]}${match[2].padStart(2, "0")}${match[3].padStart(2, "0")}`;
  }
  match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (match) {
    return `${match[3]}${match[2].padStart(2, "0")}${match[1].padStart(2, "0")}`;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getUTCFullYear()}${String(parsed.getUTCMonth() + 1).padStart(2, "0")}${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function evaluationBangkokDateKey(now: Date) {
  const bangkok = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return `${bangkok.getUTCFullYear()}${String(bangkok.getUTCMonth() + 1).padStart(2, "0")}${String(bangkok.getUTCDate()).padStart(2, "0")}`;
}

export function evaluationEmployeeEmploymentState(
  employee:
    | {
        archivedAt?: Date | string | null;
        status?: string | null;
        terminationDate?: string | null;
      }
    | null
    | undefined,
  now = new Date(),
): EvaluationEmploymentState {
  if (!employee) {
    return {
      code: "not_found",
      eligible: false,
      reason: "Không còn trong danh mục nhân sự",
    };
  }
  if (employee.archivedAt) {
    return {
      code: "archived",
      eligible: false,
      reason: "Nhân sự đã được lưu trữ",
    };
  }
  if (text(employee.status).toUpperCase() !== "ACTIVE") {
    return {
      code: "inactive",
      eligible: false,
      reason: "Nhân sự đã nghỉ việc hoặc ngưng hoạt động",
    };
  }
  const terminationDateKey = evaluationDateKey(employee.terminationDate);
  if (
    terminationDateKey &&
    terminationDateKey <= evaluationBangkokDateKey(now)
  ) {
    return {
      code: "terminated",
      eligible: false,
      reason: `Đã đến ngày nghỉ việc ${text(employee.terminationDate)}`,
    };
  }
  return { code: "active", eligible: true, reason: "Đang làm việc" };
}

function isActiveEvaluationRecord(record: {
  content: unknown;
  status?: string | null;
}) {
  const content = asRecord(record.content);
  const status = text(record.status || content.status).toLowerCase();
  return (
    content.isActive !== false && !EVALUATION_INACTIVE_STATUSES.has(status)
  );
}

function evaluationMemberEmployeeCodes(content: JsonRecord) {
  return Array.from(
    new Set(
      [
        content.employeeCode || content.employeeId,
        ...stringList(content.managerEmployeeCodes),
        content.managerEmployeeCode || content.managerEmployeeId,
        ...stringList(content.indirectManagerEmployeeCodes),
        content.indirectManagerEmployeeCode || content.indirectManagerEmployeeId,
        ...stringList(content.peerEmployeeCodes),
        content.peerEmployeeCode || content.peerEmployeeId,
        ...stringList(content.hrEmployeeCodes),
        content.hrEmployeeCode || content.hrEmployeeId,
        ...stringList(content.bodEmployeeCodes),
        content.bodEmployeeCode || content.bodEmployeeId,
      ]
        .map(text)
        .filter(Boolean),
    ),
  );
}

async function loadEvaluationEmployeeDirectory(contents: JsonRecord[]) {
  const employeeCodes = Array.from(
    new Set(contents.flatMap(evaluationMemberEmployeeCodes)),
  );
  if (!employeeCodes.length) {
    return new Map<string, EvaluationDirectoryEmployee>();
  }
  const employees = await getDb().employee.findMany({
    select: {
      archivedAt: true,
      department: true,
      email: true,
      employeeCode: true,
      fullName: true,
      status: true,
      terminationDate: true,
      title: true,
    },
    where: {
      employeeCode: { in: employeeCodes },
    },
  });
  return new Map(
    employees.map((employee) => [
      employee.employeeCode.toLowerCase(),
      employee,
    ]),
  );
}

export function enrichEvaluationMemberContent(
  source: JsonRecord,
  directory: Map<string, EvaluationDirectoryEmployee>,
) {
  const employeeCode = text(source.employeeCode || source.employeeId);
  const employee = directory.get(employeeCode.toLowerCase());
  const employment = evaluationEmployeeEmploymentState(employee);
  const roleSnapshot = (
    role: "manager" | "indirect_manager" | "peer" | "hr" | "bod",
  ) => {
    const prefix = evaluationRolePrefix(role);
    const codes = Array.from(
      new Set(
        [
          ...stringList(source[`${prefix}EmployeeCodes`]),
          text(source[`${prefix}EmployeeCode`] || source[`${prefix}EmployeeId`]),
        ].filter(Boolean),
      ),
    );
    const code = codes[0] || "";
    const roleEmployee = directory.get(code.toLowerCase());
    return {
      [`${prefix}Email`]:
        roleEmployee?.email || text(source[`${prefix}Email`]) || "",
      [`${prefix}EmployeeCode`]: code,
      [`${prefix}EmployeeCodes`]: codes,
      [`${prefix}EmployeeId`]: text(source[`${prefix}EmployeeId`]) || code,
      [`${prefix}Name`]:
        roleEmployee?.fullName || text(source[`${prefix}Name`]) || code,
    };
  };
  return {
    ...source,
    departmentName: text(source.departmentName) || employee?.department || "",
    employeeCode,
    employeeCurrentlyWorking: employment.eligible,
    employeeDirectoryFound: Boolean(employee),
    employeeEmail: text(source.employeeEmail) || employee?.email || "",
    employeeEmploymentReason: employment.reason,
    employeeEmploymentStatus: employee?.status || "NOT_FOUND",
    employeeId: text(source.employeeId) || employeeCode,
    employeeName:
      text(source.employeeName) || employee?.fullName || employeeCode,
    employeeTerminationDate: employee?.terminationDate || "",
    directoryJobTitleName: employee?.title || "",
    jobTitleName: employee?.title || text(source.jobTitleName) || "",
    ...roleSnapshot("manager"),
    ...roleSnapshot("indirect_manager"),
    ...roleSnapshot("peer"),
    ...roleSnapshot("hr"),
    ...roleSnapshot("bod"),
  } satisfies JsonRecord;
}

async function enrichEvaluationMemberRecords<T extends { content: unknown }>(
  members: T[],
) {
  const contents = members.map((member) => asRecord(member.content));
  const directory = await loadEvaluationEmployeeDirectory(contents);
  return members.map((member) => ({
    ...member,
    content: enrichEvaluationMemberContent(asRecord(member.content), directory),
  }));
}

export const EVALUATION_TAB_TYPES: Record<string, string[]> = {
  levels: ["evaluation-position-level"],
  sources: [
    "evaluation-source",
    "evaluation-source-item",
    "evaluation-jd-folder",
    "evaluation-jd-document",
    "evaluation-jd-version",
    "evaluation-jd-work-group",
    "evaluation-jd-activity",
    "evaluation-jd-classification-job",
  ],
  criteria: [
    "evaluation-score-group",
    "evaluation-work-group-definition",
    "evaluation-criteria",
    "evaluation-criteria-set",
    "evaluation-criteria-set-item",
    "evaluation-jd-activity-rule",
  ],
  workflow: ["evaluation-workflow-template", "evaluation-workflow-step"],
  types: [
    "evaluation-cycle-type-template",
    "evaluation-cycle-type-score-group",
    "evaluation-decision-template",
    "evaluation-decision-option",
    "evaluation-decision-field",
    "evaluation-decision-value",
  ],
  cycles: [
    "evaluation-cycle-schedule",
    "evaluation-cycle",
    "evaluation-cycle-member",
    "evaluation-generation-job",
  ],
  monitoring: [
    "evaluation-instance",
    "evaluation-final-result",
    "evaluation-jd-classification-job",
  ],
  email: ["evaluation-mail-template"],
};

const EVALUATION_TAB_REFERENCE_TYPES: Record<string, string[]> = {
  cycles: ["evaluation-cycle-type-template", "evaluation-workflow-template"],
  types: ["evaluation-workflow-template"],
};

const REVIEW_ROLES = EVALUATION_REVIEW_ROLES;
const APPROVAL_REVIEW_ROLES = new Set<EvaluationRole>([
  "indirect_manager",
  "bod",
]);

function isApprovalReviewRole(role: EvaluationRole) {
  return APPROVAL_REVIEW_ROLES.has(role);
}
export type { EvaluationRole } from "@/lib/evaluation/workflow";

const EVALUATION_SCORE_PLANNING_TYPES = [
  "evaluation-cycle-type-score-group",
  "evaluation-score-group",
  "evaluation-work-group-definition",
  "evaluation-criteria",
  "evaluation-criteria-set",
  "evaluation-criteria-set-item",
  "evaluation-jd-activity-rule",
  "evaluation-criteria-score",
] as const;

const EVALUATION_REVIEW_CATEGORIES = [
  "probation",
  "periodic",
  "contract_renewal",
  "appointment",
  "dismissal",
  "transfer",
  "income_adjustment",
  "promotion",
  "other",
] as const;

function isRole(value: unknown): value is EvaluationRole {
  return REVIEW_ROLES.includes(text(value) as EvaluationRole);
}

function rolePrefix(role: EvaluationRole) {
  return evaluationRolePrefix(role);
}

function roleReviewStatus(content: JsonRecord, role: EvaluationRole) {
  return evaluationRoleReviewStatus(content, role);
}

function hasMeaningfulEvaluationValue(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value === "string") return Boolean(value.trim());
  if (Array.isArray(value)) {
    return value.some((item) => hasMeaningfulEvaluationValue(item));
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) =>
      hasMeaningfulEvaluationValue(item),
    );
  }
  return true;
}

export function evaluationInstanceIsUnstarted(
  instance: { content: unknown; status?: string | null },
  scoreRows: Array<{ content: unknown }>,
) {
  const content = asRecord(instance.content);
  const status = text(instance.status || content.status).toLowerCase();
  if (
    EVALUATION_INACTIVE_STATUSES.has(status) ||
    ["completed", "done", "finalized"].includes(status) ||
    booleanValue(content.workflowCompleted) ||
    hasMeaningfulEvaluationValue(
      content.completedAt || content.finalizedAt || content.finalResultId,
    )
  ) {
    return false;
  }
  if (hasMeaningfulEvaluationValue(content.decisionAnswers)) return false;

  const startedStatuses = new Set([
    "completed",
    "draft",
    "finalized",
    "in_progress",
    "submitted",
  ]);
  if (startedStatuses.has(text(content.reviewStatus).toLowerCase())) {
    return false;
  }
  for (const role of REVIEW_ROLES) {
    const prefixes = new Set([role, rolePrefix(role)]);
    if (startedStatuses.has(roleReviewStatus(content, role))) return false;
    for (const prefix of prefixes) {
      if (
        hasMeaningfulEvaluationValue(
          content[`${prefix}ReviewStartedAt`] ||
            content[`${prefix}ReviewedAt`] ||
            content[`${prefix}SubmittedAt`],
        )
      ) {
        return false;
      }
    }
  }

  return !scoreRows.some((row) => {
    const score = asRecord(row.content);
    return REVIEW_ROLES.some((role) => {
      const prefixes = new Set([role, rolePrefix(role)]);
      return Array.from(prefixes).some(
        (prefix) =>
          hasMeaningfulEvaluationValue(score[`${prefix}Score`]) ||
          hasMeaningfulEvaluationValue(score[`${prefix}Comment`]) ||
          hasMeaningfulEvaluationValue(score[`${prefix}Note`]),
      );
    });
  });
}

function roleIsVisibleNow(content: JsonRecord, role: EvaluationRole) {
  if (role === "self") return true;
  const status = roleReviewStatus(content, role);
  return (
    stringList(content.activeStepRoles).some((item) => item === role) ||
    status === "draft" ||
    status === "submitted"
  );
}

function activeReviewAssignmentIds(content: JsonRecord) {
  return stringList(content.activeReviewAssignmentIds);
}

function actorReviewAssignments(
  content: JsonRecord,
  actor: OperationActor,
  includeInactive = true,
) {
  const assignments = evaluationReviewAssignments(content);
  if (!assignments.length) return [];
  const activeIds = new Set(activeReviewAssignmentIds(content));
  const actorCode = text(actor.employeeCode).toLowerCase();
  return assignments.filter((assignment) => {
    const identityMatches = actorCode
      ? assignment.employeeCode.toLowerCase() === actorCode
      : assignment.role === "bod" && actor.isBod;
    if (!identityMatches) return false;
    return (
      includeInactive ||
      activeIds.has(assignment.id) ||
      assignment.status === "draft"
    );
  });
}

function actorReviewAssignmentForInstance(
  content: JsonRecord,
  actor: OperationActor,
  requestedAssignmentId?: unknown,
  requestedRole?: unknown,
) {
  const assignments = actorReviewAssignments(content, actor);
  if (!assignments.length) return null;
  const requestedId = text(requestedAssignmentId);
  const role = normalizeEvaluationRole(requestedRole);
  const activeIds = new Set(activeReviewAssignmentIds(content));
  return (
    assignments.find((assignment) => assignment.id === requestedId) ||
    assignments.find(
      (assignment) =>
        activeIds.has(assignment.id) && (!role || assignment.role === role),
    ) ||
    assignments.find(
      (assignment) => assignment.status === "draft" && (!role || assignment.role === role),
    ) ||
    assignments.find((assignment) => !role || assignment.role === role) ||
    assignments[0]
  );
}

function actorCandidateRoles(
  content: JsonRecord,
  actor: OperationActor,
): EvaluationRole[] {
  const assignments = actorReviewAssignments(content, actor);
  if (assignments.length) {
    return Array.from(new Set(assignments.map((assignment) => assignment.role)));
  }
  const candidates: EvaluationRole[] = [];
  const employeeCode = actor.employeeCode;
  if (
    employeeCode &&
    employeeCode === text(content.employeeCode || content.employeeId)
  ) {
    candidates.push("self");
  }
  if (employeeCode && employeeCode === text(content.managerEmployeeCode)) {
    candidates.push("manager");
  }
  if (
    employeeCode &&
    employeeCode === text(content.indirectManagerEmployeeCode)
  ) {
    candidates.push("indirect_manager");
  }
  if (employeeCode && employeeCode === text(content.peerEmployeeCode)) {
    candidates.push("peer");
  }
  const bodEmployeeCode = text(content.bodEmployeeCode);
  const hasBodStep =
    Boolean(bodEmployeeCode || content.bodReviewStatus) ||
    stringList(content.activeStepRoles).includes("bod") ||
    stringList(content.workflowRoles).includes("bod");
  if (
    hasBodStep &&
    ((employeeCode && employeeCode === bodEmployeeCode) ||
      (!bodEmployeeCode && actor.isBod))
  ) {
    candidates.push("bod");
  }
  return Array.from(new Set(candidates));
}

function actorVisibleRolesForInstance(
  content: JsonRecord,
  actor: OperationActor,
) {
  const assignments = actorReviewAssignments(content, actor);
  if (assignments.length) {
    const activeIds = new Set(activeReviewAssignmentIds(content));
    return Array.from(
      new Set(
        assignments
          .filter(
            (assignment) =>
              activeIds.has(assignment.id) ||
              assignment.status === "draft" ||
              assignment.status === "submitted",
          )
          .map((assignment) => assignment.role),
      ),
    );
  }
  return actorCandidateRoles(content, actor).filter((role) =>
    roleIsVisibleNow(content, role),
  );
}

function actorRoleForInstance(
  content: JsonRecord,
  actor: OperationActor,
  requested?: unknown,
  requestedAssignmentId?: unknown,
) {
  const assignment = actorReviewAssignmentForInstance(
    content,
    actor,
    requestedAssignmentId,
    requested,
  );
  if (assignment) return assignment.role;
  const requestedRole = isRole(requested) ? requested : null;
  const candidates = actorVisibleRolesForInstance(content, actor);
  if (requestedRole && candidates.includes(requestedRole)) {
    return requestedRole;
  }
  const active = stringList(content.activeStepRoles).find(
    (role): role is EvaluationRole => isRole(role) && candidates.includes(role),
  );
  return active || candidates[0] || null;
}

function recordForClient(record: {
  id: string;
  parentId: string | null;
  code: string | null;
  name: string | null;
  status: string;
  content: unknown;
  text: string | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    code: record.code || "",
    content: asRecord(record.content),
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    name: record.name || "",
    note: record.note || "",
    parentId: record.parentId || "",
    status: record.status,
    text: record.text || "",
    updatedAt: record.updatedAt.toISOString(),
  };
}

function projectInstanceForReviewAssignment(
  content: JsonRecord,
  assignment: EvaluationReviewAssignment | null,
) {
  if (!assignment) return content;
  const prefix = rolePrefix(assignment.role);
  const assignmentAnswers = asRecord(
    asRecord(content.assignmentDecisionAnswers)[assignment.id],
  );
  return {
    ...content,
    assignmentDecisionAnswers: content.assignmentDecisionAnswers,
    decisionAnswers: {
      ...asRecord(content.decisionAnswers),
      [assignment.role]: assignmentAnswers,
    },
    reviewAssignmentId: assignment.id,
    reviewAssignmentLabel: assignment.stepLabel,
    reviewerEmployeeCode: assignment.employeeCode,
    reviewerName: assignment.employeeName,
    [`${prefix}OverallComment`]: assignment.overallComment || "",
    [`${prefix}ReviewStatus`]: assignment.status,
  } satisfies JsonRecord;
}

function projectScoreForReviewAssignment(
  content: JsonRecord,
  assignment: EvaluationReviewAssignment | null,
) {
  if (!assignment) return content;
  const review = asRecord(asRecord(content.assignmentReviews)[assignment.id]);
  const prefix = rolePrefix(assignment.role);
  return {
    ...content,
    [`${prefix}Comment`]: text(review.comment),
    [`${prefix}Score`]:
      review.score == null || review.score === "" ? "" : review.score,
  } satisfies JsonRecord;
}

type EvaluationScopeRecord = {
  code: string | null;
  content: unknown;
  id: string;
  legacyId?: string | null;
  parentId: string | null;
  recordType: string;
  status: string;
};

function evaluationScopeReferences(
  record: EvaluationScopeRecord | null | undefined,
  extra: unknown[] = [],
) {
  return new Set([
    ...(record ? evaluationRecordIdentifiers(record) : []),
    ...extra.map(text).filter(Boolean),
  ]);
}

function evaluationCycleForInstance(
  cycles: EvaluationScopeRecord[],
  instance: EvaluationScopeRecord | null | undefined,
) {
  if (!instance) return null;
  const content = asRecord(instance.content);
  const requested = [
    instance.parentId,
    content.cycleId,
    content.evaluationCycleId,
  ]
    .map(text)
    .filter(Boolean);
  return (
    cycles.find((cycle) => {
      const identifiers = evaluationScopeReferences(cycle);
      return requested.some((value) => identifiers.has(value));
    }) || null
  );
}

function evaluationCycleTypeForScope(
  cycleTypes: EvaluationScopeRecord[],
  instance: EvaluationScopeRecord | null | undefined,
  cycle: EvaluationScopeRecord | null | undefined,
) {
  const instanceContent = asRecord(instance?.content);
  const cycleContent = asRecord(cycle?.content);
  const requested = [
    instanceContent.cycleTypeTemplateId,
    instanceContent.cycleTypeId,
    instanceContent.cycleTypeCode,
    cycleContent.cycleTypeTemplateId,
    cycleContent.cycleTypeId,
    cycleContent.cycleTypeCode,
  ]
    .map(text)
    .filter(Boolean);
  return (
    cycleTypes.find((cycleType) => {
      const identifiers = evaluationScopeReferences(cycleType);
      return requested.some((value) => identifiers.has(value));
    }) || null
  );
}

export function decisionFieldMatchesEvaluationScope(
  field: EvaluationScopeRecord,
  scope: {
    cycle?: EvaluationScopeRecord | null;
    cycleType?: EvaluationScopeRecord | null;
    instance?: EvaluationScopeRecord | null;
  },
) {
  if (!isActiveEvaluationRecord(field)) return false;
  const fieldContent = asRecord(field.content);
  const instanceContent = asRecord(scope.instance?.content);
  const cycleContent = asRecord(scope.cycle?.content);
  const cycleTypeContent = asRecord(scope.cycleType?.content);
  const cycleTypeReferences = evaluationScopeReferences(scope.cycleType, [
    instanceContent.cycleTypeTemplateId,
    instanceContent.cycleTypeId,
    instanceContent.cycleTypeCode,
    cycleContent.cycleTypeTemplateId,
    cycleContent.cycleTypeId,
    cycleContent.cycleTypeCode,
  ]);
  const fieldCycleTypeReferences = [
    field.parentId,
    fieldContent.cycleTypeTemplateId,
    fieldContent.cycleTypeId,
    fieldContent.cycleTypeCode,
  ]
    .map(text)
    .filter(Boolean);
  if (
    fieldCycleTypeReferences.length &&
    !fieldCycleTypeReferences.some((value) => cycleTypeReferences.has(value))
  ) {
    return false;
  }

  const decisionReferences = new Set(
    [
      ...evaluationScopeReferences(scope.cycleType),
      instanceContent.decisionTemplateId,
      cycleContent.decisionTemplateId,
      cycleContent.defaultDecisionTemplateId,
      cycleTypeContent.decisionTemplateId,
      cycleTypeContent.defaultDecisionTemplateId,
    ]
      .map(text)
      .filter(Boolean),
  );
  const fieldDecisionReference = text(fieldContent.decisionTemplateId);
  return (
    !fieldDecisionReference ||
    (decisionReferences.size > 0 &&
      decisionReferences.has(fieldDecisionReference))
  );
}

function decisionFieldConditionMatches(
  fieldContent: JsonRecord,
  answers: JsonRecord,
) {
  return evaluationDecisionFieldIsVisible(fieldContent, answers);
}

function decisionAnswerIsPresent(value: unknown, fieldType: string) {
  return evaluationDecisionAnswerIsPresent(value, fieldType);
}

function assertAdmin(actor: OperationActor) {
  if (!actor.isAdmin && !actor.canManageEvaluation) {
    throw new EvaluationRuntimeError(
      "Bạn không có quyền thay đổi cấu hình đánh giá.",
      403,
    );
  }
}

async function queueEvaluationMailSafely(
  eventCode: Parameters<typeof queueEvaluationMailForInstance>[0],
  instanceId: string,
  options: Parameters<typeof queueEvaluationMailForInstance>[2] = {},
) {
  try {
    return await queueEvaluationMailForInstance(eventCode, instanceId, options);
  } catch (error) {
    try {
      await getDb().auditLog.create({
        data: {
          action: "UPDATE",
          metadata: {
            error: error instanceof Error ? error.message : String(error),
            eventCode,
          },
          summary: `Không xếp hàng được email ${eventCode}; nghiệp vụ đánh giá vẫn được giữ nguyên.`,
          targetId: instanceId,
          targetType: "EvaluationMail",
        },
      });
    } catch {
      // Mail và nhật ký mail không được phép làm rollback nghiệp vụ đánh giá.
    }
    return { failed: 1, queued: 0, sent: 0, skipped: 0 };
  }
}

export async function getEvaluationConfigTab(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const tab = text(payload.tab) || "overview";
  const db = getDb();
  const allTypes = Array.from(
    new Set(Object.values(EVALUATION_TAB_TYPES).flat()),
  );
  const types =
    tab === "overview"
      ? allTypes
      : EVALUATION_TAB_TYPES[tab] || EVALUATION_TAB_TYPES.levels;
  const listTypes =
    tab === "sources"
      ? types.filter((item) => item !== "evaluation-jd-document")
      : tab === "overview"
        ? types.filter(
            (item) =>
              ![
                "evaluation-jd-document",
                "evaluation-instance",
                "evaluation-final-result",
              ].includes(item),
          )
        : types;
  const referenceTypes = EVALUATION_TAB_REFERENCE_TYPES[tab] || [];
  const [records, references, counts, employees, jdDocuments] =
    await Promise.all([
      db.evaluationRecord.findMany({
        orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
        take: tab === "overview" ? 18 : 500,
        where: { recordType: { in: listTypes } },
      }),
      referenceTypes.length
        ? db.evaluationRecord.findMany({
            orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
            take: 300,
            where: { recordType: { in: referenceTypes } },
          })
        : Promise.resolve([]),
      db.evaluationRecord.groupBy({
        _count: { _all: true },
        by: ["recordType"],
        where: { recordType: { in: allTypes } },
      }),
      ["cycles", "monitoring"].includes(tab)
        ? db.employee.findMany({
            orderBy: { fullName: "asc" },
            select: {
              department: true,
              employeeCode: true,
              fullName: true,
              title: true,
            },
            take: 1000,
            where: { status: "ACTIVE" },
          })
        : Promise.resolve([]),
      tab === "sources"
        ? db.evaluationRecord.findMany({
            orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
            take: 300,
            where: { recordType: "evaluation-jd-document" },
          })
        : Promise.resolve([]),
    ]);

  return {
    counts: Object.fromEntries(
      counts.map((item) => [item.recordType, item._count._all]),
    ),
    employees,
    jdDocuments: jdDocuments.map(recordForClient),
    references: references.map(recordForClient),
    records: records.map(recordForClient),
    tab,
  };
}

function normalizeConfigInput(payload: JsonRecord, actor: OperationActor) {
  const recordType = text(payload.recordType);
  const code = text(payload.code).toUpperCase();
  const name = text(payload.name);
  const content: JsonRecord = {
    ...asRecord(payload.content),
    code,
    isActive: !["inactive", "archived"].includes(
      text(payload.status).toLowerCase(),
    ),
    name,
    recordType,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.displayName,
  };
  if (!recordType || !code || !name) {
    throw new EvaluationRuntimeError(
      "Vui lòng nhập đủ loại dữ liệu, mã và tên.",
    );
  }
  if (!recordType.startsWith("evaluation-")) {
    throw new EvaluationRuntimeError("Loại dữ liệu đánh giá không hợp lệ.");
  }

  return {
    code,
    content,
    name,
    note: text(payload.note) || null,
    parentId: text(payload.parentId) || null,
    recordType,
    status: text(payload.status).toLowerCase() || "active",
  };
}

async function validateConfigRecord(
  input: ReturnType<typeof normalizeConfigInput>,
) {
  const content = input.content;
  if (input.recordType === "evaluation-criteria-set") {
    const total = numberValue(content.totalWeightPercent, 100);
    if (Math.abs(total - 100) > 0.01) {
      throw new EvaluationRuntimeError(
        `Tổng trọng số của bộ tiêu chí phải bằng 100%. Hiện tại: ${total}%.`,
      );
    }
  }
  if (input.recordType === "evaluation-decision-field") {
    const labelHtml = sanitizeEvaluationMailHtml(
      content.labelHtml || content.fieldLabelHtml,
    );
    if (labelHtml) {
      content.labelHtml = labelHtml;
      content.fieldLabelHtml = labelHtml;
      const plainLabel = evaluationMailHtmlToText(labelHtml);
      if (plainLabel) {
        content.label = plainLabel;
        content.fieldLabel = plainLabel;
      }
    } else {
      delete content.labelHtml;
      delete content.fieldLabelHtml;
    }
    const fieldType = text(content.fieldType || content.type).toLowerCase();
    if (["single_choice", "multi_choice"].includes(fieldType)) {
      const options = stringList(
        content.options || content.optionValues || content.choices,
      )
        .map(text)
        .filter(Boolean);
      if (!options.length) {
        throw new EvaluationRuntimeError(
          "Câu hỏi lựa chọn cần có ít nhất một đáp án.",
        );
      }
      content.options = options;
      content.optionValues = options;
    }
  }
  if (input.recordType === "evaluation-cycle-type-template") {
    if (text(content.category) === "ad_hoc") content.category = "other";
    if (
      !EVALUATION_REVIEW_CATEGORIES.includes(
        text(
          content.category || "other",
        ) as (typeof EVALUATION_REVIEW_CATEGORIES)[number],
      )
    ) {
      throw new EvaluationRuntimeError("Nhóm loại đánh giá không hợp lệ.");
    }
    const weights = asRecord(content.roleScoreWeights);
    if (text(content.scoreAggregationMode) === "custom") {
      const total = Object.values(weights).reduce<number>(
        (sum, value) => sum + numberValue(value),
        0,
      );
      if (Math.abs(total - 100) > 0.01) {
        throw new EvaluationRuntimeError(
          `Tổng trọng số người chấm phải bằng 100%. Hiện tại: ${total}%.`,
        );
      }
    }
  }
  if (input.recordType === "evaluation-mail-sender-profile") {
    const route = resolveModuleMailRoute(
      text(content.moduleKey) || "evaluation-config",
      { allowDefault: false },
    );
    const senderName = text(content.senderName || input.name)
      .replace(/[\r\n]+/g, " ")
      .replace(/\s+/g, " ")
      .slice(0, 120)
      .trim();
    if (!senderName) {
      throw new EvaluationRuntimeError(
        "Tên hiển thị người gửi không được để trống.",
      );
    }
    if (route.senderEmail !== "ns.cnb@nemthuanviet.vn") {
      throw new EvaluationRuntimeError(
        "Cấu hình Đánh giá chỉ được sửa tên hiển thị của mail Nhân sự CnB.",
      );
    }
    content.moduleKey = route.moduleKey;
    content.provider = route.provider;
    content.senderEmail = route.senderEmail;
    content.senderName = senderName;
    input.name = senderName;
  }
  if (input.recordType === "evaluation-mail-template") {
    const eventCode = text(content.eventCode || content.code);
    const cycleTypeKeys = evaluationMailTemplateCycleTypeKeys(content);
    const roleTemplates = evaluationMailRoleTemplates(content, {
      activeOnly: false,
    });
    const hasRoleTemplates = hasEvaluationMailRoleTemplates(content);
    const normalizedRoleTemplates = roleTemplates.map((roleTemplate) => {
      const role = text(roleTemplate.role);
      const enabled =
        !["inactive", "archived", "deleted", "draft"].includes(
          text(roleTemplate.status).toLowerCase(),
        ) && booleanValue(roleTemplate.enabled ?? roleTemplate.isActive, true);
      const bodyHtmlTemplate = sanitizeEvaluationMailHtml(
        roleTemplate.bodyHtmlTemplate,
      );
      const bodyTemplate = bodyHtmlTemplate
        ? evaluationMailHtmlToText(bodyHtmlTemplate)
        : text(roleTemplate.bodyTemplate);
      const subjectTemplate = text(roleTemplate.subjectTemplate);
      const rawCustomVariables = Array.isArray(roleTemplate.customVariables)
        ? roleTemplate.customVariables
        : [];
      const customVariables = rawCustomVariables.map((variable) => {
        const normalized = normalizeEvaluationMailCustomVariable(variable);
        if (!normalized) {
          throw new EvaluationRuntimeError(
            "Biến email tùy chỉnh cần có mã riêng và liên kết hợp lệ tới dữ liệu CnB/CEO.",
          );
        }
        return normalized;
      });
      if (
        new Set(customVariables.map((variable) => variable.key)).size !==
        customVariables.length
      ) {
        throw new EvaluationRuntimeError(
          "Các biến email tùy chỉnh trong cùng một nội dung không được trùng mã.",
        );
      }
      if (!role || !REVIEW_ROLES.includes(role as EvaluationRole)) {
        throw new EvaluationRuntimeError(
          "Vai trò nhận mail trong cấu hình đánh giá không hợp lệ.",
        );
      }
      if (enabled && (!subjectTemplate || !bodyTemplate)) {
        throw new EvaluationRuntimeError(
          `Mail cho vai trò ${role} cần có tiêu đề và nội dung.`,
        );
      }
      return {
        ...roleTemplate,
        bodyHtmlTemplate,
        bodyTemplate,
        customVariables,
        enabled,
        isActive: enabled,
        role,
        status: enabled ? "active" : "inactive",
        subjectTemplate,
      };
    });
    const activeRoleTemplates = normalizedRoleTemplates.filter((template) =>
      booleanValue(template.enabled),
    );
    if (!eventCode) {
      throw new EvaluationRuntimeError("Cấu hình email cần có sự kiện gửi.");
    }
    if (!cycleTypeKeys.length) {
      throw new EvaluationRuntimeError(
        "Chọn Loại đánh giá áp dụng cho cấu hình email.",
      );
    }
    if (hasRoleTemplates && !activeRoleTemplates.length) {
      throw new EvaluationRuntimeError(
        "Bật ít nhất một vai trò nhận mail trong workflow.",
      );
    }
    const legacyBodyHtmlTemplate = sanitizeEvaluationMailHtml(
      content.bodyHtmlTemplate,
    );
    const legacyBodyTemplate = legacyBodyHtmlTemplate
      ? evaluationMailHtmlToText(legacyBodyHtmlTemplate)
      : text(content.bodyTemplate);
    const legacySubjectTemplate = text(content.subjectTemplate);
    if (!hasRoleTemplates && (!legacySubjectTemplate || !legacyBodyTemplate)) {
      throw new EvaluationRuntimeError(
        "Cấu hình email cần có tiêu đề và nội dung.",
      );
    }
    const route = resolveModuleMailRoute(
      text(content.senderModuleKey) || "evaluation-config",
      { allowDefault: false },
    );
    if (route.senderEmail !== "ns.cnb@nemthuanviet.vn") {
      throw new EvaluationRuntimeError(
        "Cấu hình Đánh giá chỉ được gửi bằng mail Nhân sự CnB.",
      );
    }
    content.senderModuleKey = route.moduleKey;
    content.senderEmail = route.senderEmail;
    content.senderName = route.senderName;
    content.senderProvider = route.provider;
    if (hasRoleTemplates) {
      const fallbackTemplate = activeRoleTemplates[0];
      content.roleTemplates = normalizedRoleTemplates;
      content.recipientRoles = activeRoleTemplates.map((template) =>
        text(template.role),
      );
      content.subjectTemplate = text(fallbackTemplate.subjectTemplate);
      content.bodyHtmlTemplate = text(fallbackTemplate.bodyHtmlTemplate);
      content.bodyTemplate = text(fallbackTemplate.bodyTemplate);
    } else {
      content.bodyHtmlTemplate = legacyBodyHtmlTemplate;
      content.bodyTemplate = legacyBodyTemplate;
    }
    delete content.positionLevelCodes;
    delete content.levelCodes;
    delete content.mailLevelCodes;
    delete content.generationLevelOrder;
  }
}

type EvaluationWriteClient = Pick<
  ReturnType<typeof getDb>,
  "auditLog" | "evaluationRecord"
>;

async function saveEvaluationConfigRecordWithActor(
  db: EvaluationWriteClient,
  actor: OperationActor,
  payload: JsonRecord,
) {
  const input = normalizeConfigInput(payload, actor);
  await validateConfigRecord(input);
  const id = text(payload.id);
  const duplicateScope = {
    code: input.code,
    parentId: input.parentId,
    recordType: input.recordType,
    ...(id ? { id: { not: id } } : {}),
  };
  const duplicates = await db.evaluationRecord.findMany({
    orderBy: { updatedAt: "desc" },
    select: { id: true, status: true },
    where: {
      ...duplicateScope,
    },
  });
  const inactiveStatuses = new Set(["inactive", "archived", "deleted"]);
  const activeDuplicate = duplicates.find(
    (duplicate) => !inactiveStatuses.has(duplicate.status.toLowerCase()),
  );
  if (activeDuplicate) {
    throw new EvaluationRuntimeError(
      `Mã ${input.code} đã tồn tại trong nhóm dữ liệu này.`,
      409,
    );
  }

  const reviveDuplicate = !id
    ? duplicates.find((duplicate) =>
        inactiveStatuses.has(duplicate.status.toLowerCase()),
      )
    : undefined;
  const targetId = id || reviveDuplicate?.id || "";
  const saved = targetId
    ? await db.evaluationRecord.update({
        data: {
          ...input,
          content: input.content as Prisma.InputJsonValue,
          updatedByName: actor.displayName,
        },
        where: { id: targetId },
      })
    : await db.evaluationRecord.create({
        data: {
          ...input,
          content: input.content as Prisma.InputJsonValue,
          createdByName: actor.displayName,
          updatedByName: actor.displayName,
        },
      });
  const deactivatedMailTemplateIds: string[] = [];
  if (
    input.recordType === "evaluation-mail-template" &&
    !["inactive", "archived", "deleted", "draft"].includes(
      input.status.toLowerCase(),
    ) &&
    booleanValue(asRecord(input.content).isActive, true)
  ) {
    const eventCode = text(
      asRecord(input.content).eventCode || input.code,
    ).toLowerCase();
    const mailTypeKeys = new Set(
      evaluationMailTemplateCycleTypeKeys(input.content),
    );
    const siblingTemplates = await db.evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: {
        id: { not: saved.id },
        recordType: "evaluation-mail-template",
      },
    });
    for (const sibling of siblingTemplates) {
      const siblingContent = asRecord(sibling.content);
      const siblingEventCode = text(
        siblingContent.eventCode || sibling.code,
      ).toLowerCase();
      const siblingTypeKeys =
        evaluationMailTemplateCycleTypeKeys(siblingContent);
      const sameEvaluationType = siblingTypeKeys.some((key) =>
        mailTypeKeys.has(key),
      );
      const siblingIsActive =
        !["inactive", "archived", "deleted", "draft"].includes(
          sibling.status.toLowerCase(),
        ) && booleanValue(siblingContent.isActive, true);
      if (
        !eventCode ||
        siblingEventCode !== eventCode ||
        !sameEvaluationType ||
        !siblingIsActive
      )
        continue;
      await db.evaluationRecord.update({
        data: {
          content: {
            ...siblingContent,
            deactivatedByMailTemplateId: saved.id,
            isActive: false,
            status: "inactive",
          } as Prisma.InputJsonValue,
          status: "inactive",
          updatedByName: actor.displayName,
        },
        where: { id: sibling.id },
      });
      deactivatedMailTemplateIds.push(sibling.id);
    }
  }
  await db.auditLog.create({
    data: {
      action: targetId ? "UPDATE" : "CREATE",
      actorId: actor.userId,
      metadata: {
        code: saved.code,
        deactivatedMailTemplateIds,
        recordType: saved.recordType,
      },
      summary: `${targetId ? "Cập nhật" : "Tạo"} ${saved.name || saved.code}.`,
      targetId: saved.id,
      targetType: "EvaluationRecord",
    },
  });
  return {
    message: reviveDuplicate
      ? "Đã khôi phục và cập nhật cấu hình đánh giá."
      : "Đã lưu cấu hình đánh giá.",
    record: recordForClient(saved),
    revived: Boolean(reviveDuplicate),
  };
}

export async function saveEvaluationConfigRecord(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  return saveEvaluationConfigRecordWithActor(getDb(), actor, payload);
}

export async function setEvaluationConfigStatus(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const id = text(payload.id);
  const status = text(payload.status).toLowerCase();
  if (!id || !["active", "inactive", "draft", "published"].includes(status)) {
    throw new EvaluationRuntimeError("Trạng thái cấu hình không hợp lệ.");
  }
  const db = getDb();
  const current = await db.evaluationRecord.findUnique({ where: { id } });
  if (!current) throw new EvaluationRuntimeError("Không tìm thấy cấu hình.");
  const content = {
    ...asRecord(current.content),
    isActive: !["inactive"].includes(status),
    status,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.displayName,
  };
  const updated = await db.evaluationRecord.update({
    data: {
      content: content as Prisma.InputJsonValue,
      note: text(payload.note) || current.note,
      status,
      updatedByName: actor.displayName,
    },
    where: { id: current.id },
  });
  await db.auditLog.create({
    data: {
      action: status === "inactive" ? "ARCHIVE" : "UPDATE",
      actorId: actor.userId,
      metadata: { status },
      summary: `Chuyển ${updated.name || updated.code} sang ${status}.`,
      targetId: updated.id,
      targetType: "EvaluationRecord",
    },
  });
  return {
    message:
      status === "published"
        ? "Đã phát hành cấu hình."
        : status === "inactive"
          ? "Đã ngưng sử dụng cấu hình."
          : "Đã cập nhật trạng thái.",
  };
}

function instanceMatchesActor(content: JsonRecord, actor: OperationActor) {
  return actorVisibleRolesForInstance(content, actor).length > 0;
}

function instanceLegacyId(content: JsonRecord) {
  return text(content.id || content.instanceId || content.evaluationInstanceId);
}

function scoreBelongsToInstance(
  score: JsonRecord,
  instance: JsonRecord,
  databaseId?: string,
) {
  const ids = new Set(
    [
      databaseId,
      instance.id,
      instance.instanceId,
      instance.evaluationInstanceId,
      instance.code,
      instance.instanceCode,
    ]
      .map(text)
      .filter(Boolean),
  );
  return [score.instanceId, score.evaluationInstanceId]
    .map(text)
    .some((value) => ids.has(value));
}

function roleScore(score: JsonRecord, role: EvaluationRole) {
  const prefix = rolePrefix(role);
  const value = score[`${prefix}Score`];
  return value == null || value === "" ? null : numberValue(value);
}

function maximumForMethod(value: unknown) {
  const method = text(value).toLowerCase();
  if (method === "scale_5") return 5;
  if (method === "percent") return 100;
  return 10;
}

function normalizeToTen(value: number, method: unknown) {
  return (value / maximumForMethod(method)) * 10;
}

function computeFinalScore(scores: JsonRecord[], instance: JsonRecord) {
  const roleWeights = asRecord(instance.roleScoreWeights);
  const mode = text(instance.scoreAggregationMode) || "equal";
  const roleAverages = REVIEW_ROLES.map((role) => {
    let total = 0;
    let weight = 0;
    for (const score of scores) {
      const value = roleScore(score, role);
      if (value == null) continue;
      const itemWeight = Math.max(numberValue(score.weightPercent, 1), 0.0001);
      total += normalizeToTen(value, score.scoringMethod) * itemWeight;
      weight += itemWeight;
    }
    return { average: weight ? total / weight : null, role };
  }).filter((item) => item.average != null);
  if (!roleAverages.length) return null;
  if (mode === "custom") {
    let weighted = 0;
    let total = 0;
    for (const item of roleAverages) {
      const weight = numberValue(roleWeights[item.role]);
      weighted += (item.average || 0) * weight;
      total += weight;
    }
    return total ? Math.round((weighted / total) * 100) / 100 : null;
  }
  return (
    Math.round(
      (roleAverages.reduce((sum, item) => sum + (item.average || 0), 0) /
        roleAverages.length) *
        100,
    ) / 100
  );
}

async function loadInstanceBundle(instanceId?: string) {
  const db = getDb();
  const instances = await db.evaluationRecord.findMany({
    orderBy: { updatedAt: "desc" },
    where: { recordType: "evaluation-instance" },
  });
  const selected =
    instances.find(
      (item) =>
        item.id === instanceId ||
        item.code === instanceId ||
        instanceLegacyId(asRecord(item.content)) === instanceId,
    ) || instances[0];
  if (!selected) return { instances, selected: null, scores: [], extras: [] };
  const selectedContent = asRecord(selected.content);
  const [scores, extras] = await Promise.all([
    db.evaluationRecord.findMany({
      orderBy: [{ name: "asc" }],
      where: { recordType: "evaluation-criteria-score" },
    }),
    db.evaluationRecord.findMany({
      orderBy: [{ updatedAt: "desc" }],
      where: {
        recordType: {
          in: [
            "evaluation-decision-field",
            "evaluation-decision-value",
            "evaluation-final-result",
          ],
        },
      },
    }),
  ]);
  return {
    extras,
    instances,
    scores: scores.filter((item) =>
      scoreBelongsToInstance(
        asRecord(item.content),
        selectedContent,
        selected.id,
      ),
    ),
    selected,
  };
}

export async function getEvaluationWorkspace(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  const db = getDb();
  const bundle = await loadInstanceBundle(text(payload.instanceId));
  const visible = bundle.instances.filter(
    (instance) =>
      isActiveEvaluationRecord(instance) &&
      instanceMatchesActor(asRecord(instance.content), actor),
  );
  const selected: (typeof bundle.instances)[number] | undefined =
    visible.find(
      (item) =>
        item.id === text(payload.instanceId) ||
        item.code === text(payload.instanceId) ||
        instanceLegacyId(asRecord(item.content)) === text(payload.instanceId),
    ) || visible[0];
  const selectedContent = selected ? asRecord(selected.content) : {};
  const scores = selected
    ? (
        await db.evaluationRecord.findMany({
          orderBy: [{ name: "asc" }],
          where: { recordType: "evaluation-criteria-score" },
        })
      ).filter(
        (item) =>
          isActiveEvaluationRecord(item) &&
          scoreBelongsToInstance(
            asRecord(item.content),
            selectedContent,
            selected.id,
          ),
      )
    : [];
  const cycleIds = new Set(
    visible
      .map((item) => {
        const content = asRecord(item.content);
        return text(content.cycleId || content.evaluationCycleId);
      })
      .filter(Boolean),
  );
  const [
    cycles,
    cycleTypes,
    workflowSteps,
    decisionFields,
    decisionValues,
    results,
    scoreGroups,
  ] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle-type-template" },
    }),
    db.evaluationRecord.findMany({
      orderBy: { name: "asc" },
      where: { recordType: "evaluation-workflow-step" },
    }),
    db.evaluationRecord.findMany({
      orderBy: { name: "asc" },
      where: { recordType: "evaluation-decision-field" },
    }),
    db.evaluationRecord.findMany({
      orderBy: { name: "asc" },
      where: { recordType: "evaluation-decision-value" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-final-result" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-score-group" },
    }),
  ]);
  const selectedCycle = evaluationCycleForInstance(cycles, selected || null);
  const selectedCycleType = evaluationCycleTypeForScope(
    cycleTypes,
    selected || null,
    selectedCycle,
  );
  const selectedAssignment = selected
    ? actorReviewAssignmentForInstance(
        selectedContent,
        actor,
        payload.assignmentId,
        payload.role,
      )
    : null;
  const selectedRole = selected
    ? actorRoleForInstance(
        selectedContent,
        actor,
        payload.role,
        payload.assignmentId,
      )
    : null;

  return {
    actor: {
      displayName: actor.displayName,
      employeeCode: actor.employeeCode,
      isAdmin: actor.isAdmin,
      isBod: actor.isBod,
    },
    cycles: cycles
      .filter((cycle) => {
        const identifiers = evaluationScopeReferences(cycle);
        return Array.from(cycleIds).some((value) => identifiers.has(value));
      })
      .map(recordForClient),
    decisionFields: selected
      ? decisionFields
          .filter((field) =>
            decisionFieldMatchesEvaluationScope(field, {
              cycle: selectedCycle,
              cycleType: selectedCycleType,
              instance: selected,
            }),
          )
          .map(recordForClient)
      : [],
    decisionValues: decisionValues
      .filter((value) => {
        if (!selected || !isActiveEvaluationRecord(value)) return false;
        const content = asRecord(value.content);
        const instanceReferences = evaluationScopeReferences(selected);
        return [
          value.parentId,
          content.instanceId,
          content.evaluationInstanceId,
        ]
          .map(text)
          .some((reference) => instanceReferences.has(reference));
      })
      .map(recordForClient),
    instances: visible.map((instance) => {
      const content = asRecord(instance.content);
      const assignment = actorReviewAssignmentForInstance(
        content,
        actor,
        instance.id === selected?.id ? payload.assignmentId : "",
        instance.id === selected?.id ? payload.role : "",
      );
      const client = recordForClient(instance);
      return {
        ...client,
        content: projectInstanceForReviewAssignment(content, assignment),
        availableRoles: actorVisibleRolesForInstance(content, actor),
      };
    }),
    results: results
      .filter((result) => {
        if (!selected) return false;
        const content = asRecord(result.content);
        return [
          content.instanceId,
          content.evaluationInstanceId,
          result.parentId,
        ]
          .map(text)
          .includes(instanceLegacyId(selectedContent));
      })
      .map(recordForClient),
    scores: scores.map((score) => {
      const client = recordForClient(score);
      const content = projectScoreForReviewAssignment(
        asRecord(score.content),
        selectedAssignment,
      );
      const scoreGroup = scoreGroups.find((group) => {
        const groupContent = asRecord(group.content);
        const groupKeys = [
          group.id,
          group.code,
          group.name,
          groupContent.id,
          groupContent.code,
          groupContent.scoreGroupCode,
          groupContent.name,
          groupContent.scoreGroupName,
        ]
          .map((value) => text(value).toLowerCase())
          .filter(Boolean);
        const scoreKeys = [
          content.scoreGroupId,
          content.scoreGroupCode,
          content.scoreGroupName,
          content.sectionName,
        ]
          .map((value) => text(value).toLowerCase())
          .filter(Boolean);
        return scoreKeys.some((key) => groupKeys.includes(key));
      });
      const scoreGroupContent = asRecord(scoreGroup?.content);
      const configuredSortOrder = Number(scoreGroupContent.sortOrder);
      return Number.isFinite(configuredSortOrder)
        ? {
            ...client,
            content: {
              ...content,
              sectionSortOrder: configuredSortOrder,
            },
          }
        : { ...client, content };
    }),
    selectedId: selected?.id || "",
    selectedAssignmentId: selectedAssignment?.id || "",
    selectedRole,
    workflowSteps: workflowSteps
      .filter(isActiveEvaluationRecord)
      .map(recordForClient),
  };
}

function assertCanReview(
  content: JsonRecord,
  actor: OperationActor,
  role: EvaluationRole,
  requestedAssignmentId?: unknown,
) {
  const assignments = evaluationReviewAssignments(content);
  if (assignments.length) {
    const assignment = actorReviewAssignmentForInstance(
      content,
      actor,
      requestedAssignmentId,
      role,
    );
    if (!assignment || assignment.role !== role) {
      throw new EvaluationRuntimeError(
        "Bạn không phải người được phân công đánh giá lượt này.",
        403,
      );
    }
    if (["finalized", "completed"].includes(text(content.status).toLowerCase())) {
      throw new EvaluationRuntimeError(
        "Phiếu đã hoàn tất hoặc đã chốt kết quả nên không thể sửa thêm.",
      );
    }
    if (
      !activeReviewAssignmentIds(content).includes(assignment.id) &&
      assignment.status !== "draft"
    ) {
      throw new EvaluationRuntimeError(
        assignment.status === "submitted"
          ? "Lượt đánh giá này đã được gửi."
          : "Chưa tới lượt đánh giá của bạn. Vui lòng chờ cấp trước hoàn tất.",
        409,
      );
    }
    return assignment;
  }
  if (actorRoleForInstance(content, actor, role) !== role) {
    throw new EvaluationRuntimeError(
      "Bạn không phải người được phân công đánh giá phiếu này.",
      403,
    );
  }
  if (["finalized", "completed"].includes(text(content.status).toLowerCase())) {
    throw new EvaluationRuntimeError(
      "Phiếu đã hoàn tất hoặc đã chốt kết quả nên không thể sửa thêm.",
    );
  }
  const active = stringList(content.activeStepRoles);
  if (
    active.length &&
    !active.includes(role) &&
    text(content[`${rolePrefix(role)}ReviewStatus`]) !== "draft"
  ) {
    throw new EvaluationRuntimeError(
      "Chưa tới lượt đánh giá của bạn. Vui lòng chờ bước trước hoàn tất.",
      409,
    );
  }
  return null;
}

async function workflowRoles(instance: JsonRecord) {
  const templateId = text(instance.workflowTemplateId);
  const rows = await getDb().evaluationRecord.findMany({
    where: { recordType: "evaluation-workflow-step" },
  });
  return (
    rows
      .filter(isActiveEvaluationRecord)
      .map((row): JsonRecord => ({
        ...asRecord(row.content),
        databaseId: row.id,
        recordCode: row.code,
        recordName: row.name,
      }))
      .filter((step) => {
        const parent = text(step.workflowTemplateId || rowParent(step));
        return !templateId || parent === templateId;
      })
      .sort((a, b) => numberValue(a.sortOrder) - numberValue(b.sortOrder))
      .map((step) => ({
        approvalPolicy: step.approvalPolicy || step.completionPolicy,
        id: step.id || step.databaseId,
        label: step.label || step.stepLabel || step.recordName,
        minimumApprovals: step.minimumApprovals || step.minimumReviewerCount,
        mode: text(step.mode || step.runMode) || "sequential",
        reviewerEmployeeCodes:
          step.reviewerEmployeeCodes || step.reviewerCodes,
        role:
          normalizeEvaluationRole(step.role || step.evaluatorRole) || "self",
        sortOrder: step.sortOrder,
        stepKey: step.stepKey || step.id || step.databaseId || step.recordCode,
      }))
      // CnB/HR chốt kết quả ở màn Theo dõi, không phải một lượt chấm điểm.
      // Bỏ qua bước HR cũ để các phiếu đã sinh không còn bị kẹt ở tiến độ 0/0.
      .filter((step) => step.role !== "hr")
  );
}

function rowParent(step: JsonRecord) {
  return step.parentId;
}

async function nextActiveRoles(
  instance: JsonRecord,
  submittedRole: EvaluationRole,
) {
  const steps = await workflowRoles(instance);
  return steps.length
    ? evaluationNextActiveRoles(steps, instance, submittedRole)
    : [];
}

function aggregateAssignmentReviewForRole(
  scoreContent: JsonRecord,
  assignments: EvaluationReviewAssignment[],
  role: EvaluationRole,
  assignmentId: string,
  review: JsonRecord,
) {
  const assignmentReviews = {
    ...asRecord(scoreContent.assignmentReviews),
    [assignmentId]: review,
  };
  const values = assignments
    .filter((assignment) => assignment.role === role)
    .map((assignment) => asRecord(assignmentReviews[assignment.id]))
    .filter((item) => item.score != null && item.score !== "");
  const numericScores = values
    .map((item) => Number(item.score))
    .filter(Number.isFinite);
  const comments = values.map((item) => text(item.comment)).filter(Boolean);
  const prefix = rolePrefix(role);
  return {
    ...scoreContent,
    assignmentReviews,
    [`${prefix}Comment`]: comments.join("\n—\n"),
    [`${prefix}Score`]: numericScores.length
      ? Math.round(
          (numericScores.reduce((total, value) => total + value, 0) /
            numericScores.length) *
            100,
        ) / 100
      : "",
  } satisfies JsonRecord;
}

function assignmentRoleStatusPatch(
  assignments: EvaluationReviewAssignment[],
) {
  return Object.fromEntries(
    EVALUATION_REVIEW_ROLES.map((role) => {
      const roleAssignments = assignments.filter(
        (assignment) => assignment.role === role,
      );
      if (!roleAssignments.length) return [`${rolePrefix(role)}ReviewStatus`, ""];
      const pending = roleAssignments.filter(
        (assignment) =>
          !["skipped", "submitted"].includes(assignment.status),
      );
      return [
        `${rolePrefix(role)}ReviewStatus`,
        pending.length
          ? pending.some((assignment) => assignment.status === "draft")
            ? "draft"
            : "assigned"
          : roleAssignments.some((assignment) => assignment.status === "submitted")
            ? "submitted"
            : "skipped",
      ];
    }),
  );
}

export async function saveEvaluationReview(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  const instanceId = text(payload.instanceId);
  const role = isRole(payload.role) ? payload.role : null;
  if (!instanceId || !role) {
    throw new EvaluationRuntimeError("Thiếu phiếu hoặc vai trò đánh giá.");
  }
  const db = getDb();
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    instanceId,
  );
  if (!instance)
    throw new EvaluationRuntimeError("Không tìm thấy phiếu đánh giá.");
  const instanceContent = asRecord(instance.content);
  const reviewAssignment = assertCanReview(
    instanceContent,
    actor,
    role,
    payload.assignmentId || payload.reviewAssignmentId,
  );
  const assignmentId = reviewAssignment?.id || "";
  const reviewAssignments = evaluationReviewAssignments(instanceContent);
  const prefix = rolePrefix(role);
  const mode = text(payload.submissionMode) === "submit" ? "submit" : "draft";
  const incomingAnswers = asRecord(payload.answers);
  const incomingScores = Array.isArray(payload.scores)
    ? payload.scores.map(asRecord)
    : [];
  let scopedDecisionFields: Array<{
    code: string;
    content: JsonRecord;
    id: string;
    name: string;
  }> = [];
  const storedScores = await db.evaluationRecord.findMany({
    where: { recordType: "evaluation-criteria-score" },
  });
  const scoreRows = storedScores.filter((score) =>
    scoreBelongsToInstance(
      asRecord(score.content),
      instanceContent,
      instance.id,
    ),
  );
  const scoreById = new Map<string, (typeof scoreRows)[number]>();
  for (const score of scoreRows) {
    for (const identifier of evaluationRecordIdentifiers(score)) {
      scoreById.set(identifier, score);
    }
  }

  for (const incoming of isApprovalReviewRole(role) ? [] : incomingScores) {
    const stored = scoreById.get(text(incoming.id));
    if (!stored) continue;
    const content = asRecord(stored.content);
    const value =
      incoming.score == null || incoming.score === ""
        ? null
        : numberValue(incoming.score, Number.NaN);
    const max = maximumForMethod(content.scoringMethod);
    if (
      value != null &&
      (!Number.isFinite(value) || value < 0 || value > max)
    ) {
      throw new EvaluationRuntimeError(
        `Điểm "${text(content.criteriaName || stored.name)}" phải từ 0 đến ${max}.`,
      );
    }
    if (mode === "submit" && value == null) {
      throw new EvaluationRuntimeError(
        `Vui lòng chấm đủ điểm trước khi gửi: ${text(
          content.criteriaName || stored.name,
        )}.`,
      );
    }
  }
  if (mode === "submit") {
    if (isApprovalReviewRole(role)) {
      const decisionCode =
        role === "bod" ? "BOD_DECISION" : "INDIRECT_MANAGER_DECISION";
      const feedbackCode =
        role === "bod" ? "BOD_FEEDBACK" : "INDIRECT_MANAGER_FEEDBACK";
      const approvalDecision = text(
        incomingAnswers[decisionCode],
      ).toLowerCase();
      const approvalFeedback = text(incomingAnswers[feedbackCode]);
      const reviewerLabel =
        role === "bod" ? "Ban giám đốc" : "Quản lý gián tiếp";
      if (!["accepted", "adjustment", "rejected"].includes(approvalDecision)) {
        throw new EvaluationRuntimeError(
          `Vui lòng chọn xác nhận của ${reviewerLabel}.`,
        );
      }
      if (
        ["adjustment", "rejected"].includes(approvalDecision) &&
        !approvalFeedback
      ) {
        throw new EvaluationRuntimeError(
          approvalDecision === "adjustment"
            ? "Vui lòng nhập nội dung cần điều chỉnh."
            : "Vui lòng nhập lý do từ chối.",
        );
      }
    }
    const [fields, cycles, cycleTypes] = await Promise.all([
      db.evaluationRecord.findMany({
        where: { recordType: "evaluation-decision-field" },
      }),
      db.evaluationRecord.findMany({
        where: { recordType: "evaluation-cycle" },
      }),
      db.evaluationRecord.findMany({
        where: { recordType: "evaluation-cycle-type-template" },
      }),
    ]);
    const selectedCycle = evaluationCycleForInstance(cycles, instance);
    const selectedCycleType = evaluationCycleTypeForScope(
      cycleTypes,
      instance,
      selectedCycle,
    );
    const scopedFields = fields.filter((field) =>
      decisionFieldMatchesEvaluationScope(field, {
        cycle: selectedCycle,
        cycleType: selectedCycleType,
        instance,
      }),
    );
    scopedDecisionFields = scopedFields.map((field) => ({
      code: text(field.code || field.id),
      content: asRecord(field.content),
      id: field.id,
      name: text(field.name || field.code),
    }));
    applyEvaluationDecisionCalculations(
      scopedFields.filter((field) => {
        const content = asRecord(field.content);
        const fieldRole = text(content.role || content.evaluatorRole);
        return !fieldRole || fieldRole === role;
      }),
      incomingAnswers,
    );
    const missing = scopedFields
      .filter((field) => {
        const content = asRecord(field.content);
        const fieldRole = text(content.role || content.evaluatorRole);
        return (
          booleanValue(content.isRequired) &&
          (!fieldRole || fieldRole === role) &&
          decisionFieldConditionMatches(content, incomingAnswers) &&
          !decisionAnswerIsPresent(
            incomingAnswers[field.code || field.id],
            text(content.fieldType || content.type).toLowerCase(),
          )
        );
      })
      .map((field) => field.name || field.code || "Câu hỏi");
    if (missing.length) {
      throw new EvaluationRuntimeError(
        `Vui lòng trả lời câu hỏi bắt buộc: ${missing.join(", ")}.`,
      );
    }
  }

  const now = new Date().toISOString();
  let followUpMailEvent:
    | "cnb_finalization_required"
    | "evaluation_completed"
    | "review_assigned"
    | "" = "";
  let followUpMailRoles: EvaluationRole[] = [];
  let followUpMailAssignmentIds: string[] = [];
  const bodWorkflowNotice: "adjustment" | "rejected" | "" =
    mode === "submit" &&
    role === "bod" &&
    ["adjustment", "rejected"].includes(
      text(incomingAnswers.BOD_DECISION).toLowerCase(),
    )
      ? (text(incomingAnswers.BOD_DECISION).toLowerCase() as
          "adjustment" | "rejected")
      : "";
  await db.$transaction(async (tx) => {
    for (const incoming of isApprovalReviewRole(role) ? [] : incomingScores) {
      const stored = scoreById.get(text(incoming.id));
      if (!stored) continue;
      const originalContent = asRecord(stored.content);
      const review = {
        comment: text(incoming.comment),
        reviewerEmployeeCode: reviewAssignment?.employeeCode || actor.employeeCode,
        reviewerName: reviewAssignment?.employeeName || actor.displayName,
        role,
        score:
          incoming.score == null || incoming.score === ""
            ? ""
            : numberValue(incoming.score),
        status: mode === "submit" ? "submitted" : "draft",
        updatedAt: now,
      };
      const content = assignmentId
        ? aggregateAssignmentReviewForRole(
            originalContent,
            reviewAssignments,
            role,
            assignmentId,
            review,
          )
        : {
            ...originalContent,
            [`${prefix}Comment`]: review.comment,
            [`${prefix}Score`]: review.score,
          };
      content.updatedAt = now;
      content.updatedBy = actor.displayName;
      await tx.evaluationRecord.update({
        data: {
          content: content as Prisma.InputJsonValue,
          updatedByName: actor.displayName,
        },
        where: { id: stored.id },
      });
    }
    const existingDecisionValues = await tx.evaluationRecord.findMany({
      where: { recordType: "evaluation-decision-value" },
    });
    for (const [fieldCode, rawValue] of Object.entries(incomingAnswers)) {
      const field = scopedDecisionFields.find(
        (item) => item.code === fieldCode || item.id === fieldCode,
      );
      const existing = existingDecisionValues.find((row) => {
        if (!isActiveEvaluationRecord(row)) return false;
        const content = asRecord(row.content);
        const belongs = [
          row.parentId,
          content.instanceId,
          content.evaluationInstanceId,
        ]
          .map(text)
          .some((value) => evaluationScopeReferences(instance).has(value));
        return (
          belongs &&
          text(content.role || content.evaluatorRole) === role &&
          (assignmentId
            ? text(content.reviewAssignmentId) === assignmentId
            : !text(content.reviewAssignmentId)) &&
          [
            content.fieldCode,
            content.code,
            content.fieldId,
            content.decisionFieldId,
          ]
            .map(text)
            .includes(fieldCode)
        );
      });
      const valueContent = {
        ...(existing ? asRecord(existing.content) : {}),
        decisionFieldId: field?.id || "",
        evaluationInstanceId: instanceLegacyId(instanceContent),
        fieldCode,
        fieldId: field?.id || "",
        fieldType: text(field?.content.fieldType || field?.content.type),
        instanceId: instanceLegacyId(instanceContent),
        isActive: true,
        role,
        reviewAssignmentId: assignmentId,
        status: "active",
        updatedAt: now,
        updatedBy: actor.displayName,
        value: rawValue,
      };
      if (existing) {
        await tx.evaluationRecord.update({
          data: {
            content: valueContent as Prisma.InputJsonValue,
            status: "active",
            updatedByName: actor.displayName,
          },
          where: { id: existing.id },
        });
      } else {
        await tx.evaluationRecord.create({
          data: {
            code: uniqueCode("DVALUE"),
            content: valueContent as Prisma.InputJsonValue,
            createdByName: actor.displayName,
            name: field?.name || fieldCode,
            parentId: instanceLegacyId(instanceContent) || instance.id,
            recordType: "evaluation-decision-value",
            status: "active",
            updatedByName: actor.displayName,
          },
        });
      }
    }
    const updatedScores = scoreRows.map((stored) => {
      const identifiers = new Set(evaluationRecordIdentifiers(stored));
      const incoming = isApprovalReviewRole(role)
        ? undefined
        : incomingScores.find((item) => identifiers.has(text(item.id)));
      const originalContent = asRecord(stored.content);
      if (!incoming) return originalContent;
      const review = {
        comment: text(incoming.comment),
        reviewerEmployeeCode: reviewAssignment?.employeeCode || actor.employeeCode,
        reviewerName: reviewAssignment?.employeeName || actor.displayName,
        role,
        score:
          incoming.score == null || incoming.score === ""
            ? ""
            : numberValue(incoming.score),
        status: mode === "submit" ? "submitted" : "draft",
        updatedAt: now,
      };
      return assignmentId
        ? aggregateAssignmentReviewForRole(
            originalContent,
            reviewAssignments,
            role,
            assignmentId,
            review,
          )
        : {
            ...originalContent,
            [`${prefix}Comment`]: review.comment,
            [`${prefix}Score`]: review.score,
          };
    });
    const assignmentDrafts = reviewAssignments.map((assignment) =>
      assignment.id === assignmentId
        ? {
            ...assignment,
            overallComment: text(payload.overallComment),
            status: mode === "submit" ? ("submitted" as const) : ("draft" as const),
            ...(mode === "submit"
              ? { submittedAt: now, submittedBy: actor.displayName }
              : {}),
          }
        : assignment,
    );
    const assignmentState = assignmentId
      ? mode === "submit"
        ? evaluationAssignmentWorkflowState(assignmentDrafts, assignmentId)
        : {
            activeAssignmentIds: activeReviewAssignmentIds(instanceContent),
            assignments: assignmentDrafts,
            completed: false,
          }
      : null;
    const nextRoles = assignmentState
      ? evaluationAssignmentRoles(
          assignmentState.assignments,
          assignmentState.activeAssignmentIds,
        )
      : mode === "submit"
        ? await nextActiveRoles(instanceContent, role)
        : stringList(instanceContent.activeStepRoles);
    const newlyActivatedAssignmentIds = assignmentState
      ? assignmentState.activeAssignmentIds.filter(
          (id) => !activeReviewAssignmentIds(instanceContent).includes(id),
        )
      : [];
    const newlyActivatedRoles = assignmentState
      ? evaluationAssignmentRoles(
          assignmentState.assignments,
          newlyActivatedAssignmentIds,
        )
      : evaluationNewlyActivatedRoles(
          stringList(instanceContent.activeStepRoles),
          nextRoles,
        ).filter(isRole);
    const workflowCompleted =
      mode === "submit" &&
      (assignmentState ? assignmentState.completed : nextRoles.length === 0);
    const completionMode = text(
      instanceContent.completionMode || instanceContent.finalizationMode,
    );
    const autoComplete =
      workflowCompleted && completionMode === "auto_complete";
    const awaitingFinalization = workflowCompleted && !autoComplete;
    if (mode === "submit") {
      followUpMailRoles = newlyActivatedRoles;
      followUpMailAssignmentIds = newlyActivatedAssignmentIds;
      followUpMailEvent = autoComplete
        ? "evaluation_completed"
        : newlyActivatedRoles.length
          ? "review_assigned"
          : awaitingFinalization
            ? "cnb_finalization_required"
            : "";
    }
    const finalScore = computeFinalScore(updatedScores, instanceContent);
    const updatedContent = {
      ...instanceContent,
      ...(assignmentState
        ? {
            activeReviewAssignmentIds: assignmentState.activeAssignmentIds,
            currentReviewAssignmentId:
              assignmentState.activeAssignmentIds[0] || "",
            reviewAssignments: assignmentState.assignments,
            ...assignmentRoleStatusPatch(assignmentState.assignments),
          }
        : {}),
      activeStepRoles: nextRoles,
      currentStepRole: nextRoles[0] || "",
      decisionAnswers: {
        ...asRecord(instanceContent.decisionAnswers),
        [role]: {
          ...asRecord(asRecord(instanceContent.decisionAnswers)[role]),
          ...incomingAnswers,
        },
      },
      ...(assignmentId
        ? {
            assignmentDecisionAnswers: {
              ...asRecord(instanceContent.assignmentDecisionAnswers),
              [assignmentId]: {
                ...asRecord(
                  asRecord(instanceContent.assignmentDecisionAnswers)[
                    assignmentId
                  ],
                ),
                ...incomingAnswers,
              },
            },
          }
        : {}),
      ...(role === "bod"
        ? {
            bodDecision: text(incomingAnswers.BOD_DECISION),
            bodFeedback: text(incomingAnswers.BOD_FEEDBACK),
            bodReviewedAt: now,
            bodReviewedBy: actor.displayName,
          }
        : {}),
      ...(role === "indirect_manager"
        ? {
            indirectManagerDecision: text(
              incomingAnswers.INDIRECT_MANAGER_DECISION,
            ),
            indirectManagerFeedback: text(
              incomingAnswers.INDIRECT_MANAGER_FEEDBACK,
            ),
            indirectManagerReviewedAt: now,
            indirectManagerReviewedBy: actor.displayName,
          }
        : {}),
      finalScore: finalScore ?? instanceContent.finalScore ?? "",
      [`${prefix}OverallComment`]: text(payload.overallComment),
      [`${prefix}${mode === "submit" ? "Submitted" : "DraftSaved"}At`]: now,
      [`${prefix}${mode === "submit" ? "Submitted" : "DraftSaved"}By`]:
        actor.displayName,
      ...(!assignmentState
        ? {
            [`${prefix}ReviewStatus`]:
              mode === "submit" ? "submitted" : "draft",
          }
        : {}),
      status: autoComplete
        ? "finalized"
        : awaitingFinalization
          ? "awaiting_finalization"
          : "in_progress",
      updatedAt: now,
      updatedBy: actor.displayName,
      workflowCompleted,
      ...(autoComplete
        ? { autoCompleted: true, requiresFinalization: false }
        : {}),
    };
    await tx.evaluationRecord.update({
      data: {
        content: updatedContent as Prisma.InputJsonValue,
        status: autoComplete
          ? "finalized"
          : awaitingFinalization
            ? "awaiting_finalization"
            : "in_progress",
        updatedByName: actor.displayName,
      },
      where: { id: instance.id },
    });
    if (autoComplete) {
      await tx.evaluationRecord.create({
        data: {
          code: uniqueCode("RESULT"),
          content: {
            autoCompleted: true,
            completionMode: "auto_complete",
            employeeCode: text(instanceContent.employeeCode),
            employeeName: text(instanceContent.employeeName),
            evaluationInstanceId: instanceLegacyId(instanceContent),
            finalScore,
            finalizedAt: now,
            finalizedBy: actor.displayName,
            instanceId: instanceLegacyId(instanceContent),
            isActive: true,
            status: "active",
          } as Prisma.InputJsonValue,
          createdByName: actor.displayName,
          name: `Kết quả ${text(instanceContent.employeeName || instance.name)}`,
          parentId: instanceLegacyId(instanceContent) || instance.id,
          recordType: "evaluation-final-result",
          status: "active",
          updatedByName: actor.displayName,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: actor.userId,
        metadata: { assignmentId, mode, role },
        summary:
          mode === "submit"
            ? `Gửi đánh giá ${instance.name || instance.code}.`
            : `Lưu nháp đánh giá ${instance.name || instance.code}.`,
        targetId: instance.id,
        targetType: "EvaluationRecord",
      },
    });
  });
  if (followUpMailEvent) {
    await queueEvaluationMailSafely(followUpMailEvent, instance.id, {
      actorName: actor.displayName,
      eventToken: `${followUpMailEvent}:${role}:${now}`,
      ...(followUpMailEvent === "review_assigned"
        ? {
            assignmentIds: followUpMailAssignmentIds,
            roles: followUpMailRoles,
          }
        : {}),
      sendNow: true,
    });
  }
  if (bodWorkflowNotice) {
    const eventCode =
      bodWorkflowNotice === "adjustment"
        ? "bod_adjustment_requested"
        : "bod_rejected";
    await queueEvaluationMailSafely(eventCode, instance.id, {
      actorName: actor.displayName,
      eventToken: `bod:${bodWorkflowNotice}:${now}`,
      sendNow: true,
    });
  }
  return {
    message:
      mode === "submit" ? "Đã gửi đánh giá." : "Đã lưu bản nháp đánh giá.",
  };
}

export async function returnEvaluationReview(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const instanceId = text(payload.instanceId);
  const role = isRole(payload.role) ? payload.role : null;
  if (!instanceId || !role) {
    throw new EvaluationRuntimeError("Thiếu phiếu hoặc vai trò cần trả lại.");
  }
  const db = getDb();
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    instanceId,
  );
  if (!instance)
    throw new EvaluationRuntimeError("Không tìm thấy phiếu đánh giá.");
  const content = asRecord(instance.content);
  const reviewAssignments = evaluationReviewAssignments(content);
  const requestedAssignmentId = text(
    payload.assignmentId || payload.reviewAssignmentId,
  );
  const returnedAssignments = reviewAssignments
    .filter(
      (assignment) =>
        assignment.role === role &&
        assignment.status === "submitted" &&
        (!requestedAssignmentId || assignment.id === requestedAssignmentId),
    )
    .map((assignment) => ({
      ...assignment,
      status: "draft" as const,
    }));
  if (
    text(content.completionMode || content.finalizationMode).toLowerCase() ===
    "auto_complete"
  ) {
    throw new EvaluationRuntimeError(
      "Loại đánh giá này tự hoàn tất sau lượt cuối và không có bước kết luận CnB.",
      409,
    );
  }
  const prefix = rolePrefix(role);
  if (
    !returnedAssignments.length &&
    text(content[`${prefix}ReviewStatus`]) !== "submitted"
  ) {
    throw new EvaluationRuntimeError(
      "Chỉ có thể trả lại lượt đánh giá đã gửi.",
    );
  }
  const now = new Date().toISOString();
  const returnedAssignmentIds = returnedAssignments.map(
    (assignment) => assignment.id,
  );
  const nextAssignments = reviewAssignments.map(
    (assignment) =>
      returnedAssignments.find((returned) => returned.id === assignment.id) ||
      assignment,
  );
  await db.$transaction(async (tx) => {
    await tx.evaluationRecord.update({
      data: {
        content: {
          ...content,
          ...(returnedAssignmentIds.length
            ? {
                activeReviewAssignmentIds: returnedAssignmentIds,
                currentReviewAssignmentId: returnedAssignmentIds[0],
                reviewAssignments: nextAssignments,
                ...assignmentRoleStatusPatch(nextAssignments),
              }
            : {}),
          activeStepRoles: [role],
          currentStepRole: role,
          [`${prefix}ReturnNote`]: text(payload.note),
          [`${prefix}ReturnedAt`]: now,
          [`${prefix}ReturnedBy`]: actor.displayName,
          ...(!returnedAssignmentIds.length
            ? { [`${prefix}ReviewStatus`]: "draft" }
            : {}),
          status: "in_progress",
          updatedAt: now,
          updatedBy: actor.displayName,
          workflowCompleted: false,
        } as Prisma.InputJsonValue,
        status: "in_progress",
        updatedByName: actor.displayName,
      },
      where: { id: instance.id },
    });
    await tx.evaluationRecord.updateMany({
      data: { status: "inactive", updatedByName: actor.displayName },
      where: {
        parentId: {
          in: [instance.id, instanceLegacyId(content)].filter(Boolean),
        },
        recordType: "evaluation-final-result",
      },
    });
  });
  await queueEvaluationMailSafely("review_returned", instance.id, {
    actorName: actor.displayName,
    eventToken: `returned:${role}:${now}`,
    assignmentIds: returnedAssignmentIds,
    role,
    sendNow: true,
  });
  return { message: "Đã trả lại lượt đánh giá để chỉnh sửa." };
}

export async function finalizeEvaluationInstance(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const instanceId = text(payload.instanceId);
  const db = getDb();
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    instanceId,
  );
  if (!instance)
    throw new EvaluationRuntimeError("Không tìm thấy phiếu đánh giá.");
  const content = asRecord(instance.content);
  const configuredRoles = (await workflowRoles(content)).map(
    (step) => step.role,
  );
  const completedBySubmittedRoles =
    configuredRoles.length > 0 &&
    configuredRoles.every(
      (role) => roleReviewStatus(content, role) === "submitted",
    );
  const readyByStatus =
    text(content.status).toLowerCase() === "awaiting_finalization";
  if (
    !booleanValue(content.workflowCompleted) &&
    !completedBySubmittedRoles &&
    !readyByStatus
  ) {
    throw new EvaluationRuntimeError(
      "Phiếu chưa hoàn tất các lượt đánh giá nên chưa thể chốt kết quả.",
    );
  }
  const decision = text(payload.decision);
  if (!decision) {
    throw new EvaluationRuntimeError("Vui lòng chọn kết luận cuối cùng.");
  }
  const scores = (
    await db.evaluationRecord.findMany({
      where: { recordType: "evaluation-criteria-score" },
    })
  )
    .map((item) => asRecord(item.content))
    .filter((item) => scoreBelongsToInstance(item, content, instance.id));
  const finalScore = computeFinalScore(scores, content);
  const templateMergeOverrides = normalizeEvaluationTemplateMergeOverrides(
    payload.templateMergeOverrides,
  );
  const cnbConclusionAnswers = asRecord(payload.cnbConclusionAnswers);
  const decisionOptionId = text(payload.decisionOptionId);
  const decisionOptionCode = text(payload.decisionOptionCode);
  const [decisionFields, cycles, cycleTypes] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-decision-field" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle-type-template" },
    }),
  ]);
  const selectedCycle = evaluationCycleForInstance(cycles, instance);
  const selectedCycleType = evaluationCycleTypeForScope(
    cycleTypes,
    instance,
    selectedCycle,
  );
  const optionReferences = new Set(
    [decisionOptionId, decisionOptionCode].map(text).filter(Boolean),
  );
  const cnbFields = decisionFields.filter((field) => {
    if (
      !decisionFieldMatchesEvaluationScope(field, {
        cycle: selectedCycle,
        cycleType: selectedCycleType,
        instance,
      })
    ) {
      return false;
    }
    const fieldContent = asRecord(field.content);
    if (text(fieldContent.role || fieldContent.answerRole) !== "hr") {
      return false;
    }
    const conclusionReferences = [
      fieldContent.decisionOptionId,
      fieldContent.decisionOptionCode,
      fieldContent.conclusionId,
      fieldContent.conclusionCode,
    ]
      .map(text)
      .filter(Boolean);
    return (
      conclusionReferences.length === 0 ||
      conclusionReferences.some((value) => optionReferences.has(value))
    );
  });
  applyEvaluationDecisionCalculations(cnbFields, cnbConclusionAnswers);
  const missingCnbFields = cnbFields
    .filter((field) => {
      const fieldContent = asRecord(field.content);
      const code = text(field.code || field.id);
      const fieldType = text(
        fieldContent.fieldType || fieldContent.type,
      ).toLowerCase();
      return (
        booleanValue(fieldContent.isRequired) &&
        decisionFieldConditionMatches(fieldContent, cnbConclusionAnswers) &&
        !decisionAnswerIsPresent(cnbConclusionAnswers[code], fieldType)
      );
    })
    .map((field) => field.name || field.code || "Thông tin CnB");
  if (missingCnbFields.length) {
    throw new EvaluationRuntimeError(
      `Vui lòng nhập thông tin CnB bắt buộc: ${missingCnbFields.join(", ")}.`,
    );
  }
  const now = new Date().toISOString();
  await db.$transaction(async (tx) => {
    await tx.evaluationRecord.update({
      data: {
        content: {
          ...content,
          decisionOptionCode,
          decisionOptionId,
          decisionOptionLabel: decision,
          cnbConclusionAnswers,
          finalScore,
          finalizedAt: now,
          finalizedBy: actor.displayName,
          hrComment: text(payload.hrComment),
          templateMergeOverrides,
          status: "finalized",
          updatedAt: now,
          updatedBy: actor.displayName,
          workflowCompleted: true,
        } as Prisma.InputJsonValue,
        status: "finalized",
        updatedByName: actor.displayName,
      },
      where: { id: instance.id },
    });
    await tx.evaluationRecord.create({
      data: {
        code: uniqueCode("RESULT"),
        content: {
          decisionOptionCode,
          decisionOptionId,
          decisionOptionLabel: decision,
          cnbConclusionAnswers,
          employeeCode: text(content.employeeCode),
          employeeName: text(content.employeeName),
          evaluationInstanceId: instanceLegacyId(content),
          finalScore,
          finalizedAt: now,
          finalizedBy: actor.displayName,
          hrComment: text(payload.hrComment),
          templateMergeOverrides,
          instanceId: instanceLegacyId(content),
          isActive: true,
          status: "active",
        } as Prisma.InputJsonValue,
        createdByName: actor.displayName,
        name: `Kết quả ${text(content.employeeName || instance.name)}`,
        parentId: instanceLegacyId(content) || instance.id,
        recordType: "evaluation-final-result",
        status: "active",
        updatedByName: actor.displayName,
      },
    });
  });
  await queueEvaluationMailSafely("cnb_result_finalized", instance.id, {
    actorName: actor.displayName,
    eventToken: `cnb-finalized:${now}`,
    sendNow: true,
  });
  return { finalScore, message: "Đã chốt kết quả đánh giá." };
}

function normalizeEvaluationTemplateMergeOverrides(value: unknown) {
  const source = asRecord(value);
  return Object.fromEntries(
    Object.entries(source)
      .slice(0, 20)
      .map(([templateId, rawFields]) => [
        text(templateId).slice(0, 200),
        Object.fromEntries(
          Object.entries(asRecord(rawFields))
            .slice(0, 120)
            .map(([fieldId, rawValue]) => [
              text(fieldId).slice(0, 200),
              text(rawValue).slice(0, 12000),
            ])
            .filter(([fieldId]) => Boolean(fieldId)),
        ),
      ])
      .filter(([templateId]) => Boolean(templateId)),
  );
}

async function previewEvaluationFinalization(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    payload.instanceId,
  );
  if (!instance) {
    throw new EvaluationRuntimeError("Không tìm thấy phiếu đánh giá.");
  }
  const content = asRecord(instance.content);
  const scores = (
    await getDb().evaluationRecord.findMany({
      where: { recordType: "evaluation-criteria-score" },
    })
  )
    .map((item) => asRecord(item.content))
    .filter((item) => scoreBelongsToInstance(item, content, instance.id));
  const finalScore = computeFinalScore(scores, content);
  const previewedAt = new Date().toISOString();
  const preview = await previewEvaluationFinalizationTemplates(instance.id, {
    cnbConclusionAnswers: asRecord(payload.cnbConclusionAnswers),
    decisionOptionCode: text(payload.decisionOptionCode),
    decisionOptionId: text(payload.decisionOptionId),
    decisionOptionLabel: text(payload.decision),
    finalScore,
    finalizedAt: previewedAt,
    finalizedBy: actor.displayName,
    hrComment: text(payload.hrComment),
    templateMergeOverrides: normalizeEvaluationTemplateMergeOverrides(
      payload.templateMergeOverrides,
    ),
  });
  return {
    ...preview,
    finalScore,
    message: preview.templates.length
      ? `Đã dựng trước ${preview.templates.length} biểu mẫu PDF.`
      : "Không có biểu mẫu PDF đính kèm cần xem trước.",
  };
}

export async function checkEvaluationCycleReadiness(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const cycleId = text(payload.cycleId);
  const db = getDb();
  const cycle = await findEvaluationRecordByIdentifier(
    "evaluation-cycle",
    cycleId,
  );
  if (!cycle) {
    throw new EvaluationRuntimeError("Không tìm thấy kỳ đánh giá.");
  }
  const cycleContent = asRecord(cycle.content);
  const cycleTypeIdentifier = text(
    cycleContent.cycleTypeTemplateId ||
      cycleContent.cycleTypeId ||
      cycleContent.cycleTypeCode,
  );
  const cycleType = cycleTypeIdentifier
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle-type-template",
        cycleTypeIdentifier,
      )
    : null;
  const workflowTemplateId = text(
    cycleContent.workflowTemplateId ||
      asRecord(cycleType?.content).defaultWorkflowTemplateId,
  );
  const configuredWorkflow: EvaluationWorkflowStep[] = workflowTemplateId
    ? await workflowRoles({ workflowTemplateId })
    : [{ mode: "sequential", role: "self" as EvaluationRole }];
  const [members, planningRecords, existingInstances] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle-member" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: { in: [...EVALUATION_SCORE_PLANNING_TYPES] } },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-instance" },
    }),
  ]);
  const cycleReferences = new Set(evaluationRecordIdentifiers(cycle));
  const selected = await enrichEvaluationMemberRecords(
    members.filter((member) => {
      const content = asRecord(member.content);
      return (
        isActiveEvaluationRecord(member) &&
        [content.cycleId, content.evaluationCycleId, member.parentId]
          .map(text)
          .some((value) => cycleReferences.has(value))
      );
    }),
  );
  const employmentEligibleMembers = selected.filter((member) =>
    booleanValue(asRecord(member.content).employeeCurrentlyWorking),
  );
  const jds = await resolveSharedJdsForMembers(
    employmentEligibleMembers.map((member) => {
      const content = asRecord(member.content);
      return {
        documentId: text(content.manualJdDocumentId || content.jdDocumentId),
        position: text(content.jobTitleName),
        requestKey: member.id,
      };
    }),
  );
  const jdByMemberId = new Map(jds.map((jd) => [jd.requestKey, jd]));
  const activeCycleInstances = existingInstances.filter((instance) => {
    if (!isActiveEvaluationRecord(instance)) return false;
    const content = asRecord(instance.content);
    return [content.cycleId, content.evaluationCycleId, instance.parentId]
      .map(text)
      .some((value) => cycleReferences.has(value));
  });
  const memberReadiness = selected.map((member) => {
    const content = asRecord(member.content);
    const position = text(content.jobTitleName);
    const jd = jdByMemberId.get(member.id);
    const employeeCode = text(content.employeeCode);
    const issues: string[] = [];
    const warnings: string[] = [];
    const existingInstance = activeCycleInstances.find(
      (instance) =>
        text(asRecord(instance.content).employeeCode).toLowerCase() ===
        employeeCode.toLowerCase(),
    );
    const employeeCurrentlyWorking = booleanValue(
      content.employeeCurrentlyWorking,
    );
    if (!employeeCurrentlyWorking) {
      const employmentReason =
        text(content.employeeEmploymentReason) || "Nhân sự không còn làm việc";
      const warnings = [
        `${employmentReason}; hệ thống tự loại khỏi danh sách sinh phiếu.`,
      ];
      if (existingInstance) {
        warnings.push(
          "Nhân sự này đã có phiếu. Nếu cần gỡ phiếu đã sinh, dùng Xóa phiếu tại tab Theo dõi.",
        );
      }
      return {
        canExclude: false,
        departmentName: text(content.departmentName),
        employeeCode,
        employeeCurrentlyWorking: false,
        employeeName: text(content.employeeName || member.name),
        employmentReason,
        existingInstanceId: existingInstance?.id || "",
        existingInstanceStatus: existingInstance?.status || "",
        issues: [],
        jdDocumentDatabaseId: "",
        jdDocumentId: text(content.manualJdDocumentId || content.jdDocumentId),
        jdMatchMode: "automatic",
        jdSource: "none",
        jdSourceLabel: "Không kiểm tra JD vì nhân sự đã được tự loại",
        jdTitle: "",
        jobTitleName: position,
        managerEmployeeCode: text(content.managerEmployeeCode),
        managerName: text(content.managerName),
        memberDatabaseId: member.id,
        memberId: evaluationRecordLegacyId(member),
        status: existingInstance ? "locked" : "excluded",
        warnings,
      };
    }
    if (!employeeCode) issues.push("Thiếu mã nhân sự");
    if (!text(content.managerEmployeeCode)) issues.push("Thiếu quản lý");
    evaluationRequiredReviewerStepIssues(configuredWorkflow, content).forEach(
      (label) => issues.push(`Thiếu người duyệt cho bước ${label}`),
    );
    if (!position) issues.push("Thiếu chức danh");
    if (jd?.manualOverrideInvalid) {
      issues.push("JD đã chọn không còn khả dụng");
    } else if (!jd || jd.source === "none") issues.push("Chưa có JD");
    else if (!jd.activityCount) issues.push("JD chưa có hoạt động để chấm");
    if (!issues.length) {
      try {
        buildEvaluationScorePlan({
          cycle,
          instance: {
            code: "READINESS",
            content: { id: "READINESS" },
            id: "READINESS",
            name: "READINESS",
            parentId: null,
            recordType: "evaluation-instance",
            status: "draft",
          },
          jd: jd || null,
          member,
          records: planningRecords,
        });
      } catch (error) {
        issues.push(
          error instanceof Error
            ? error.message
            : "Không dựng được nội dung đánh giá theo JD.",
        );
      }
    }
    if (existingInstance) {
      warnings.push(
        "Đã có phiếu đang chạy hoặc đã chốt, hệ thống sẽ không sinh đè phiếu này.",
      );
    }
    const status = issues.length
      ? "blocked"
      : existingInstance
        ? "locked"
        : warnings.length
          ? "warning"
          : "ready";
    return {
      canExclude: !existingInstance,
      departmentName: text(content.departmentName),
      employeeCode,
      employeeCurrentlyWorking: true,
      employeeName: text(content.employeeName || member.name),
      employmentReason: text(content.employeeEmploymentReason),
      existingInstanceId: existingInstance?.id || "",
      existingInstanceStatus: existingInstance?.status || "",
      issues,
      jdDocumentDatabaseId: jd?.document?.id || "",
      jdDocumentId: jd?.document
        ? text(
            asRecord(jd.document.content).id ||
              jd.document.legacyId ||
              jd.document.code ||
              jd.document.id,
          )
        : text(content.manualJdDocumentId || content.jdDocumentId),
      jdMatchMode: jd?.manualOverride ? "manual" : "automatic",
      jdSource: jd?.source || "none",
      jdSourceLabel: jd?.sourceLabel || "Chưa tìm thấy JD",
      jdTitle: jd?.title || "",
      jobTitleName: position,
      managerEmployeeCode: text(content.managerEmployeeCode),
      managerName: text(content.managerName),
      memberDatabaseId: member.id,
      memberId: evaluationRecordLegacyId(member),
      status,
      warnings,
    };
  });
  const cycleIssues: string[] = [];
  const cycleWarnings: string[] = [];
  if (!isActiveEvaluationRecord(cycle)) {
    cycleIssues.push("Kỳ đánh giá đã ngưng sử dụng.");
  }
  if (!memberReadiness.length) {
    cycleIssues.push("Kỳ này chưa có nhân sự đang hoạt động để sinh phiếu.");
  } else if (!employmentEligibleMembers.length) {
    cycleIssues.push("Kỳ này không còn nhân sự đang làm việc để sinh phiếu.");
  }
  const summary = {
    blockedCount: memberReadiness.filter((item) => item.status === "blocked")
      .length,
    cycleIssueCount: cycleIssues.length,
    cycleWarningCount: cycleWarnings.length,
    eligibleCount: employmentEligibleMembers.length,
    excludedCount: memberReadiness.filter((item) => item.status === "excluded")
      .length,
    lockedCount: memberReadiness.filter((item) => item.status === "locked")
      .length,
    readyCount: memberReadiness.filter((item) => item.status === "ready")
      .length,
    totalCount: memberReadiness.length,
    warningCount: memberReadiness.filter((item) => item.status === "warning")
      .length,
  };
  const rows = memberReadiness.map((member) => ({
    employeeCode: member.employeeCode,
    employeeName: member.employeeName,
    errors: member.issues.length ? member.issues : member.warnings,
    ok: member.status !== "blocked",
    position: member.jobTitleName,
  }));
  return {
    checkedAt: new Date().toISOString(),
    cycle: recordForClient(cycle),
    cycleIssues,
    cycleWarnings,
    invalid: summary.blockedCount,
    members: memberReadiness,
    ok: summary.blockedCount === 0 && summary.cycleIssueCount === 0,
    ready: summary.readyCount,
    rows,
    source: "postgresql",
    summary,
    total: summary.totalCount,
  };
}

const evaluationDriveAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

function deriveJdTitle(fileName: string) {
  return deriveEvaluationJdTitle(fileName);
}

export async function syncEvaluationSourceFolder(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const sourceId = text(payload.sourceId || payload.evaluationSourceId);
  const db = getDb();
  const source = await findEvaluationRecordByIdentifier(
    "evaluation-source",
    sourceId,
  );
  if (!source || source.recordType !== "evaluation-source") {
    throw new EvaluationRuntimeError(
      "Hãy lưu nguồn dữ liệu trước khi đồng bộ Folder.",
    );
  }
  const sourceContent = asRecord(source.content);
  const folderValue = text(
    payload.folderId ||
      sourceContent.folderId ||
      sourceContent.driveFolderId ||
      sourceContent.jdFolderId,
  );
  if (!folderValue) {
    throw new EvaluationRuntimeError("Nguồn chưa có ID Folder Drive.");
  }
  const limit = Math.min(
    Math.max(
      numberValue(
        payload.limit ??
          sourceContent.fileLimit ??
          sourceContent.syncLimit ??
          sourceContent.limit,
        80,
      ),
      1,
    ),
    250,
  );
  const location = parseJdDriveLocation(folderValue);
  const sameSource =
    sourceContent.syncEngineVersion === JD_SYNC_ENGINE &&
    text(sourceContent.syncFolderId) === location.id;
  let scan: Awaited<ReturnType<ReturnType<typeof createJdDriveReader>["scan"]>>;
  let reader: ReturnType<typeof createJdDriveReader>;
  try {
    const client = await evaluationDriveAuth.getClient();
    reader = createJdDriveReader(
      async <T>(options: Parameters<typeof client.request>[0]) => {
        const response = await client.request<T>(options);
        return { data: response.data };
      },
    );
    scan = await reader.scan(
      folderValue,
      limit,
      payload.offset ?? (sameSource ? sourceContent.syncCursorOffset : 0),
      sameSource ? text(sourceContent.syncManifestHash) : "",
    );
  } catch (error) {
    throw new EvaluationRuntimeError(jdDriveErrorMessage(error));
  }
  let created = 0;
  let updated = 0;
  let parsedDocumentCount = 0;
  let workGroupCount = 0;
  let activityCount = 0;
  let failedDocumentCount = 0;
  const warnings = [...scan.warnings];
  const now = new Date().toISOString();
  const processingStartedAt = Date.now();
  let processedCandidateCount = 0;
  for (const file of scan.files) {
    // Keep each request bounded. Remaining candidates are resumed explicitly on
    // the next click, never handed to a non-existent GAS/background trigger.
    if (processedCandidateCount && Date.now() - processingStartedAt >= 45000)
      break;
    processedCandidateCount++;
    const providerFileId = text(file.id);
    if (!providerFileId) continue;
    const fileName = text(file.name);
    try {
      const rawText = await reader.readDocument(file);
      const parsed = parseJdSourceText(rawText, fileName);
      if (!parsed.workGroups.length)
        throw new Error(
          "Không nhận diện được bảng NỘI DUNG CÔNG VIỆC CHÍNH; giữ nguyên dữ liệu cũ, kiểm tra file theo mẫu JD Thuần Việt.",
        );
      const counts = await db.$transaction(
        async (tx) => {
          // The database has no unique constraint on sourceFingerprint. Serialize imports of
          // one Drive target across sources/users so simultaneous retries cannot duplicate it.
          await tx.$queryRaw(
            Prisma.sql`SELECT pg_advisory_xact_lock(hashtext('evaluation-jd-sync'), hashtext(${providerFileId}))`,
          );
          const current = await tx.evaluationRecord.findFirst({
            where: {
              recordType: "evaluation-jd-document",
              OR: [
                { code: providerFileId },
                { sourceFingerprint: providerFileId },
                {
                  content: { path: ["providerFileId"], equals: providerFileId },
                },
                { content: { path: ["fileId"], equals: providerFileId } },
              ],
            },
          });
          const currentContent = asRecord(current?.content);
          const displayTitle =
            text(
              currentContent.mappedJobTitleName ||
                currentContent.personnelJobTitleName,
            ) ||
            parsed.jobTitleName ||
            deriveJdTitle(fileName);
          const metadata = {
            availabilityStatus: file.isArchivedJd ? "archived" : "current",
            availabilityLabel: file.isArchivedJd ? "Bản cũ" : "Khả dụng",
            isArchivedJd: file.isArchivedJd,
            isArchived: file.isArchivedJd,
            displayTitle,
            jobTitleName: displayTitle,
            fileName,
            fileMimeType: text(file.mimeType),
            departmentName:
              parsed.departmentName || text(currentContent.departmentName),
            teamName: parsed.teamName || text(currentContent.teamName),
            jobTitleCode:
              parsed.jobTitleCode || text(currentContent.jobTitleCode),
            fileUrl:
              text(file.webViewLink) ||
              `https://drive.google.com/open?id=${encodeURIComponent(providerFileId)}`,
            folderPath: file.folderPath,
            sourceEntryFileId: file.sourceEntryFileId,
            sourceShortcutId: file.sourceShortcutId,
            providerFileId,
            evaluationSourceId: source.id,
            sourceId: source.id,
            sourceName: source.name || "",
            updatedAt: now,
            updatedBy: actor.displayName,
          };
          const snapshotHash = jdSourceHash(rawText);
          const content = {
            ...currentContent,
            ...metadata,
            jobTitleName: displayTitle,
            departmentName:
              parsed.departmentName || text(currentContent.departmentName),
            teamName: parsed.teamName || text(currentContent.teamName),
            jobTitleCode:
              parsed.jobTitleCode || text(currentContent.jobTitleCode),
            positionLevelCode:
              parsed.positionLevelCode ||
              text(currentContent.positionLevelCode),
            driveModifiedAt: text(file.modifiedTime),
            snapshotHash,
            rawTextLength: rawText.length,
            rawTextPreview: rawText.slice(0, 2000),
            parsedJson: parsed,
            parseNote: "",
            parseStatus: "parsed",
            workGroupCount: parsed.workGroups.length,
            activityCount: parsed.workGroups.reduce(
              (sum, group) => sum + group.activities.length,
              0,
            ),
            isActive: true,
            status: "active",
          };
          const documentData = {
            content: content as Prisma.InputJsonValue,
            name: file.isArchivedJd ? `[BC] - ${displayTitle}` : displayTitle,
            status: "active",
            updatedByName: actor.displayName,
          };
          const document = current
            ? await tx.evaluationRecord.update({
                where: { id: current.id },
                data: documentData,
              })
            : await tx.evaluationRecord.create({
                data: {
                  ...documentData,
                  code: providerFileId,
                  recordType: "evaluation-jd-document",
                  sourceFingerprint: providerFileId,
                  createdByName: actor.displayName,
                },
              });
          let version = await tx.evaluationRecord.findFirst({
            where: {
              recordType: "evaluation-jd-version",
              parentId: document.id,
              sourceFingerprint: snapshotHash,
            },
          });
          if (!version)
            version = await tx.evaluationRecord.create({
              data: {
                recordType: "evaluation-jd-version",
                parentId: document.id,
                code: `JDVER_${jdSourceHash(`${providerFileId}:${snapshotHash}`).slice(0, 24)}`,
                sourceFingerprint: snapshotHash,
                name: fileName,
                createdByName: actor.displayName,
                updatedByName: actor.displayName,
                content: {
                  ...metadata,
                  jdDocumentId: document.id,
                  snapshotHash,
                  parsedJson: parsed,
                  rawTextLength: rawText.length,
                } as Prisma.InputJsonValue,
              },
            });
          const documentKeys = evaluationRecordIdentifiers(document);
          const children = await tx.evaluationRecord.findMany({
            where: {
              recordType: {
                in: ["evaluation-jd-work-group", "evaluation-jd-activity"],
              },
              OR: [
                { parentId: { in: documentKeys } },
                {
                  content: { path: ["providerFileId"], equals: providerFileId },
                },
                ...documentKeys.map((id) => ({
                  content: { path: ["jdDocumentId"], equals: id },
                })),
              ],
            },
          });
          const keep = new Set<string>();
          let unclassifiedCount = 0;
          for (const [groupIndex, group] of parsed.workGroups.entries()) {
            const code = jdStructureCode(
              "JDGRP",
              providerFileId,
              group.groupName,
            );
            const existing = children.find(
              (row) =>
                !keep.has(row.id) &&
                row.recordType === "evaluation-jd-work-group" &&
                (row.code === code ||
                  jdStructureCode(
                    "JDGRP",
                    providerFileId,
                    text(
                      asRecord(row.content).groupName ||
                        asRecord(row.content).workGroupName ||
                        row.name,
                    ),
                  ) === code),
            );
            const groupContent = {
              ...asRecord(existing?.content),
              ...metadata,
              jdDocumentId: document.id,
              jdVersionId: version.id,
              groupName: group.groupName,
              workGroupName: group.groupName,
              workGroupCode: existing?.code || code,
              sortOrder: (groupIndex + 1) * 10,
              sourceSyncManaged: true,
              isActive: true,
              status: "active",
            };
            const groupData = {
              content: groupContent as Prisma.InputJsonValue,
              name: group.groupName,
              parentId: document.id,
              status: "active",
              updatedByName: actor.displayName,
            };
            const savedGroup = existing
              ? await tx.evaluationRecord.update({
                  where: { id: existing.id },
                  data: groupData,
                })
              : await tx.evaluationRecord.create({
                  data: {
                    ...groupData,
                    code,
                    recordType: "evaluation-jd-work-group",
                    createdByName: actor.displayName,
                  },
                });
            keep.add(savedGroup.id);
            for (const [
              activityIndex,
              activity,
            ] of group.activities.entries()) {
              const activityCode = jdStructureCode(
                "JDACT",
                providerFileId,
                group.groupName,
                activity.activityText,
              );
              const groupKeys = evaluationRecordIdentifiers(savedGroup);
              const previous = children.find((row) => {
                const value = asRecord(row.content);
                return (
                  !keep.has(row.id) &&
                  row.recordType === "evaluation-jd-activity" &&
                  (row.code === activityCode ||
                    ((!text(value.jdWorkGroupId) ||
                      groupKeys.includes(text(value.jdWorkGroupId))) &&
                      jdStructureCode(
                        "JDACT",
                        providerFileId,
                        text(value.activityText || row.name),
                      ) ===
                        jdStructureCode(
                          "JDACT",
                          providerFileId,
                          activity.activityText,
                        )))
                );
              });
              const activityContent = mergeJdActivityContent(
                asRecord(previous?.content),
                {
                  ...metadata,
                  ...activity,
                  jdDocumentId: document.id,
                  jdVersionId: version.id,
                  jdWorkGroupId: savedGroup.id,
                  workGroupCode: savedGroup.code,
                  workGroupName: group.groupName,
                  activityCode: previous?.code || activityCode,
                  sortOrder: (groupIndex + 1) * 1000 + (activityIndex + 1) * 10,
                  sourceSyncManaged: true,
                  isActive: true,
                  status: "active",
                },
              );
              if (activityContent.activityType === "unclassified")
                unclassifiedCount++;
              const data = {
                content: activityContent as Prisma.InputJsonValue,
                parentId: document.id,
                name: activity.activityText,
                status: "active",
                updatedByName: actor.displayName,
              };
              const saved = previous
                ? await tx.evaluationRecord.update({
                    where: { id: previous.id },
                    data,
                  })
                : await tx.evaluationRecord.create({
                    data: {
                      ...data,
                      code: activityCode,
                      recordType: "evaluation-jd-activity",
                      createdByName: actor.displayName,
                    },
                  });
              keep.add(saved.id);
            }
          }
          // Never remove manual/legacy content based on a parser guess. Only retire rows
          // managed by this sync engine after a successfully parsed replacement document.
          for (const child of children) {
            const value = asRecord(child.content);
            if (
              keep.has(child.id) ||
              value.sourceSyncManaged !== true ||
              child.status === "inactive"
            )
              continue;
            await tx.evaluationRecord.update({
              where: { id: child.id },
              data: {
                status: "inactive",
                updatedByName: actor.displayName,
                content: {
                  ...value,
                  isActive: false,
                  status: "inactive",
                  updatedAt: now,
                } as Prisma.InputJsonValue,
              },
            });
          }
          await tx.evaluationRecord.update({
            where: { id: document.id },
            data: {
              content: {
                ...content,
                unclassifiedActivityCount: unclassifiedCount,
                structureStatus: unclassifiedCount
                  ? "needs_classification"
                  : "ready",
              } as Prisma.InputJsonValue,
            },
          });
          return {
            created: !current,
            groups: parsed.workGroups.length,
            activities: content.activityCount,
          };
        },
        { timeout: 30000 },
      );
      if (counts.created) created++;
      else updated++;
      parsedDocumentCount++;
      workGroupCount += counts.groups;
      activityCount += counts.activities;
    } catch (error) {
      failedDocumentCount++;
      if (warnings.length < 20)
        warnings.push(`${fileName}: ${jdDriveErrorMessage(error)}`);
    }
  }
  scan.nextOffset = scan.offset + processedCandidateCount;
  scan.hasMore = scan.nextOffset < scan.eligibleScannedCount;
  const message = `Đã quét ${scan.scannedFolderCount} thư mục, ${scan.scannedFileCount} mục; bóc ${parsedDocumentCount} JD (${created} mới, ${updated} cập nhật), ${workGroupCount} nhóm và ${activityCount} hoạt động vào PostgreSQL. Bỏ qua ${scan.skippedPdfCount} PDF và ${scan.skippedUnsupportedCount} mục chưa hỗ trợ.${failedDocumentCount ? ` ${failedDocumentCount} JD lỗi; dữ liệu cũ được giữ nguyên.` : ""}${scan.hasMore ? " Còn tài liệu: bấm Đồng bộ Folder lần nữa để xử lý tiếp." : ""}`;
  const syncStatus =
    failedDocumentCount || warnings.length
      ? "warning"
      : scan.hasMore
        ? "paused"
        : "success";
  const latestSource = await db.evaluationRecord.findUnique({
    where: { id: source.id },
  });
  await db.evaluationRecord.update({
    data: {
      content: {
        ...asRecord(latestSource?.content || sourceContent),
        folderId: folderValue,
        fileLimit: limit,
        syncFolderId: location.id,
        syncEngineVersion: JD_SYNC_ENGINE,
        syncManifestHash: scan.manifestHash,
        syncCursorOffset: scan.hasMore ? scan.nextOffset : 0,
        syncTotalDocuments: scan.eligibleScannedCount,
        syncPending: false,
        syncStatus,
        lastSyncStatus: syncStatus,
        lastSyncAt: now,
        lastSyncCount: parsedDocumentCount,
        lastSyncMessage: message,
        lastSyncWarnings: warnings,
      } as Prisma.InputJsonValue,
      updatedByName: actor.displayName,
    },
    where: { id: source.id },
  });
  return {
    ...scan,
    files: undefined,
    created,
    updated,
    importedCount: parsedDocumentCount,
    parsedDocumentCount,
    workGroupCount,
    activityCount,
    failedDocumentCount,
    warnings,
    message,
    syncStatus,
    backend: "postgresql",
    backgroundQueued: false,
  };
}

async function generateEvaluationInstancesForActor(
  actor: OperationActor,
  payload: JsonRecord,
) {
  const cycleId = text(payload.cycleId);
  const requestedEmployeeCodes = new Set(
    stringList(payload.employeeCodes).map((value) => value.toLowerCase()),
  );
  const db = getDb();
  const [cycle, members, existingInstances, planningRecords] =
    await Promise.all([
      findEvaluationRecordByIdentifier("evaluation-cycle", cycleId),
      db.evaluationRecord.findMany({
        where: { recordType: "evaluation-cycle-member" },
      }),
      db.evaluationRecord.findMany({
        where: { recordType: "evaluation-instance" },
      }),
      db.evaluationRecord.findMany({
        where: { recordType: { in: [...EVALUATION_SCORE_PLANNING_TYPES] } },
      }),
    ]);
  if (!cycle) throw new EvaluationRuntimeError("Không tìm thấy kỳ đánh giá.");
  const cycleContent = asRecord(cycle.content);
  const cycleTypeIdentifier = text(
    cycleContent.cycleTypeTemplateId ||
      cycleContent.cycleTypeId ||
      cycleContent.cycleTypeCode,
  );
  const cycleType = cycleTypeIdentifier
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle-type-template",
        cycleTypeIdentifier,
      )
    : null;
  const cycleTypeContent = asRecord(cycleType?.content);
  const legacyCycleId =
    text(cycleContent.id || cycleContent.cycleId || cycle.parentId) || cycle.id;
  const cycleReferences = new Set(evaluationRecordIdentifiers(cycle));
  const workflowTemplateId = text(
    cycleContent.workflowTemplateId ||
      cycleTypeContent.defaultWorkflowTemplateId,
  );
  const configuredWorkflow: EvaluationWorkflowStep[] = workflowTemplateId
    ? await workflowRoles({ workflowTemplateId })
    : [{ mode: "sequential", role: "self" as EvaluationRole }];
  const workflowReviewRoles = Array.from(
    new Set(configuredWorkflow.map((step) => step.role)),
  );
  const requestedMembers = await enrichEvaluationMemberRecords(
    members
      .filter((member) => {
        const content = asRecord(member.content);
        return (
          isActiveEvaluationRecord(member) &&
          [content.cycleId, content.evaluationCycleId, member.parentId]
            .map(text)
            .some((value) => cycleReferences.has(value))
        );
      })
      .filter((member) => {
        if (!requestedEmployeeCodes.size) return true;
        return requestedEmployeeCodes.has(
          text(asRecord(member.content).employeeCode).toLowerCase(),
        );
      }),
  );
  const workingMembers = requestedMembers.filter((member) =>
    booleanValue(asRecord(member.content).employeeCurrentlyWorking),
  );
  const fixedReviewerCodes = Array.from(
    new Set(
      configuredWorkflow.flatMap((step) =>
        stringList(step.reviewerEmployeeCodes),
      ),
    ),
  );
  const assignmentDirectory = await loadEvaluationEmployeeDirectory([
    ...workingMembers.map((member) => asRecord(member.content)),
    ...fixedReviewerCodes.map((employeeCode) => ({ employeeCode })),
  ]);
  const skippedInactive = requestedMembers.length - workingMembers.length;
  const jds = await resolveSharedJdsForMembers(
    workingMembers.map((member) => {
      const content = asRecord(member.content);
      return {
        documentId: text(content.manualJdDocumentId || content.jdDocumentId),
        position: text(content.jobTitleName),
        requestKey: member.id,
      };
    }),
  );
  const jdByMemberId = new Map(jds.map((jd) => [jd.requestKey, jd]));
  const levelCodeForMember = (member: (typeof workingMembers)[number]) => {
    const content = asRecord(member.content);
    const jdContent = asRecord(jdByMemberId.get(member.id)?.document?.content);
    return text(
      content.positionLevelCode ||
        content.levelCode ||
        content.employeeLevelCode ||
        jdContent.positionLevelCode ||
        jdContent.levelCode,
    ).toUpperCase();
  };
  const selectedMembers = workingMembers.slice().sort((left, right) => {
    const leftContent = asRecord(left.content);
    const rightContent = asRecord(right.content);
    return (
      numberValue(leftContent.sortOrder) -
        numberValue(rightContent.sortOrder) ||
      text(leftContent.employeeCode).localeCompare(
        text(rightContent.employeeCode),
        "vi",
      ) ||
      left.id.localeCompare(right.id)
    );
  });
  let created = 0;
  let skipped = 0;
  const now = new Date().toISOString();

  for (const [generationIndex, member] of selectedMembers.entries()) {
    const memberContent = asRecord(member.content);
    const employeeCode = text(memberContent.employeeCode);
    const roleIdentityContent = {
      ...memberContent,
      bodEmployeeCode: text(memberContent.bodEmployeeCode),
      bodEmployeeCodes: stringList(memberContent.bodEmployeeCodes).length
        ? stringList(memberContent.bodEmployeeCodes)
        : [text(memberContent.bodEmployeeCode)].filter(Boolean),
    };
    const reviewAssignments = buildEvaluationReviewAssignments(
      configuredWorkflow,
      roleIdentityContent,
      (reviewerEmployeeCode) => {
        const employee = assignmentDirectory.get(
          reviewerEmployeeCode.toLowerCase(),
        );
        return employee
          ? {
              email: employee.email,
              employeeCode: employee.employeeCode,
              employeeName: employee.fullName,
            }
          : null;
      },
    );
    const missingReviewerSteps = evaluationRequiredReviewerStepIssues(
      configuredWorkflow,
      roleIdentityContent,
    );
    if (missingReviewerSteps.length) {
      throw new EvaluationRuntimeError(
        `Chưa phân bổ người duyệt cho: ${missingReviewerSteps.join(", ")}.`,
      );
    }
    const assignmentState = evaluationAssignmentWorkflowState(reviewAssignments);
    const initialRoles = reviewAssignments.length
      ? evaluationAssignmentRoles(
          assignmentState.assignments,
          assignmentState.activeAssignmentIds,
        )
      : evaluationInitialActiveRoles(configuredWorkflow, roleIdentityContent);
    const reviewStatusPatch = evaluationWorkflowStatusPatch(
      workflowReviewRoles,
      roleIdentityContent,
    );
    const exists = existingInstances.some((instance) => {
      if (!isActiveEvaluationRecord(instance)) return false;
      const content = asRecord(instance.content);
      return (
        text(content.employeeCode) === employeeCode &&
        [content.cycleId, content.evaluationCycleId, instance.parentId]
          .map(text)
          .some((value) => cycleReferences.has(value))
      );
    });
    if (exists) {
      skipped += 1;
      continue;
    }
    const jd = jdByMemberId.get(member.id);
    const positionLevelCode = levelCodeForMember(member);
    const instanceLegacy = uniqueCode("INST");
    const virtualInstance = {
      code: `${cycle.code || "CYCLE"}_${employeeCode}`,
      content: { id: instanceLegacy },
      id: instanceLegacy,
      name: text(memberContent.employeeName || member.name),
      parentId: legacyCycleId || cycle.id,
      recordType: "evaluation-instance",
      status: "in_progress",
    };
    const plan = buildEvaluationScorePlan({
      cycle,
      instance: virtualInstance,
      jd: jd || null,
      member,
      records: planningRecords,
    });
    const completionMode =
      text(cycleContent.completionMode || cycleTypeContent.completionMode) ||
      "manual_finalization";
    const instanceContent = {
      activeReviewAssignmentIds: assignmentState.activeAssignmentIds,
      activeStepRoles: initialRoles,
      completionMode,
      currentStepRole: initialRoles[0],
      currentReviewAssignmentId: assignmentState.activeAssignmentIds[0] || "",
      cycleId: legacyCycleId,
      cycleName: cycle.name,
      cycleTypeCode: text(
        cycleContent.cycleTypeCode ||
          cycleTypeContent.cycleTypeCode ||
          cycleType?.code,
      ),
      cycleTypeName: text(
        cycleContent.cycleTypeName ||
          cycleTypeContent.cycleTypeName ||
          cycleType?.name,
      ),
      cycleTypeTemplateId: text(
        cycleContent.cycleTypeTemplateId ||
          cycleContent.cycleTypeId ||
          cycleTypeContent.id ||
          cycleType?.legacyId ||
          cycleType?.id,
      ),
      decisionTemplateId: text(
        cycleContent.decisionTemplateId ||
          cycleTypeContent.defaultDecisionTemplateId ||
          cycleTypeContent.id ||
          cycleType?.legacyId ||
          cycleType?.id,
      ),
      employeeCode,
      employeeName: text(memberContent.employeeName || member.name),
      availableFrom: evaluationAvailableFromValue(
        memberContent,
        cycleContent,
        now,
      ),
      deadline: evaluationDeadlineValue(memberContent, cycleContent, now),
      generatedAt: now,
      milestoneDate: text(memberContent.milestoneDate),
      automationSourceRow: numberValue(memberContent.automationSourceRow),
      automationSourceKey: text(memberContent.automationSourceKey),
      evaluationCycleId: legacyCycleId,
      id: instanceLegacy,
      instanceCode: instanceLegacy,
      jdJobTitleName: text(memberContent.jobTitleName),
      positionLevelCode,
      generationSequence: generationIndex + 1,
      mailGenerationSequence: generationIndex + 1,
      managerEmployeeCode: text(memberContent.managerEmployeeCode),
      managerName: text(memberContent.managerName),
      departmentHeadEmployeeCode: text(
        memberContent.departmentHeadEmployeeCode,
      ),
      indirectManagerEmployeeCode: text(
        memberContent.indirectManagerEmployeeCode,
      ),
      indirectManagerEmployeeCodes: stringList(
        memberContent.indirectManagerEmployeeCodes,
      ),
      indirectManagerEmail: text(memberContent.indirectManagerEmail),
      indirectManagerName: text(memberContent.indirectManagerName),
      peerEmployeeCode: text(memberContent.peerEmployeeCode),
      peerName: text(memberContent.peerName),
      hrEmployeeCode: text(memberContent.hrEmployeeCode),
      hrName: text(memberContent.hrName),
      bodEmployeeCode: text(memberContent.bodEmployeeCode),
      bodEmployeeCodes: stringList(roleIdentityContent.bodEmployeeCodes),
      bodEmail: text(memberContent.bodEmail),
      bodName: text(memberContent.bodName),
      departmentName: text(memberContent.departmentName),
      requiresFinalization: completionMode !== "auto_complete",
      roleScoreWeights: asRecord(
        cycleContent.roleScoreWeights || cycleTypeContent.roleScoreWeights,
      ),
      scoreAggregationMode:
        text(
          cycleContent.scoreAggregationMode ||
            cycleTypeContent.scoreAggregationMode,
        ) || "equal",
      status: "in_progress",
      updatedAt: now,
      updatedBy: actor.displayName,
      workflowCompleted: false,
      reviewAssignments: assignmentState.assignments,
      reviewerEmployeeCodesByStep: asRecord(
        memberContent.reviewerEmployeeCodesByStep,
      ),
      workflowRoles: workflowReviewRoles,
      workflowTemplateId,
      ...reviewStatusPatch,
      ...(reviewAssignments.length
        ? assignmentRoleStatusPatch(assignmentState.assignments)
        : {}),
      ...plan.instancePatch,
    };
    const createdInstance = await db.$transaction(async (tx) => {
      const instance = await tx.evaluationRecord.create({
        data: {
          code: virtualInstance.code,
          content: instanceContent as Prisma.InputJsonValue,
          createdByName: actor.displayName,
          name: virtualInstance.name,
          parentId: virtualInstance.parentId,
          recordType: "evaluation-instance",
          status: "in_progress",
          updatedByName: actor.displayName,
        },
      });
      if (plan.rows.length) {
        await tx.evaluationRecord.createMany({
          data: plan.rows.map((row) => ({
            code: row.code,
            content: row.content as Prisma.InputJsonValue,
            createdByName: actor.displayName,
            name: row.name,
            parentId: instance.id,
            recordType: "evaluation-criteria-score",
            status: "active",
            updatedByName: actor.displayName,
          })),
        });
      }
      return instance;
    });
    if (payload.suppressMail !== true) {
      await queueEvaluationMailSafely("review_assigned", createdInstance.id, {
        actorName: actor.displayName,
        eventToken: `created:${createdInstance.id}`,
        sendNow: true,
      });
    }
    created += 1;
  }
  if (payload.suppressJob !== true) {
    await db.evaluationRecord.create({
      data: {
        code: uniqueCode("GENJOB"),
        content: {
          actor: actor.displayName,
          created,
          cycleId: legacyCycleId,
          finishedAt: now,
          skipped,
          skippedInactive,
          status: "done",
        } as Prisma.InputJsonValue,
        createdByName: actor.displayName,
        name: `Sinh phiếu: ${cycle.name || cycle.code}`,
        parentId: legacyCycleId || cycle.id,
        recordType: "evaluation-generation-job",
        status: "done",
        updatedByName: actor.displayName,
      },
    });
  }
  return {
    created,
    message: `Đã sinh ${created} phiếu; bỏ qua ${skipped} phiếu đã tồn tại${skippedInactive ? ` và tự loại ${skippedInactive} nhân sự không còn làm việc` : ""}.`,
    skipped,
    skippedInactive,
  };
}

export async function generateEvaluationInstances(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const cycleId = text(payload.cycleId);
  const readiness = await checkEvaluationCycleReadiness(session, { cycleId });
  if (!readiness.ok) {
    const blockedMember = readiness.members.find(
      (member) => member.status === "blocked",
    );
    const reason =
      readiness.cycleIssues[0] ||
      blockedMember?.issues[0] ||
      "Kỳ đánh giá chưa đủ dữ liệu.";
    throw new EvaluationRuntimeError(`Chưa thể sinh phiếu: ${reason}`);
  }
  return generateEvaluationInstancesForActor(actor, payload);
}

export async function syncUnstartedEvaluationInstances(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const cycleId = text(payload.cycleId);
  if (!cycleId) {
    throw new EvaluationRuntimeError("Chọn kỳ đánh giá cần cập nhật phiếu.");
  }

  const db = getDb();
  const cycle = await findEvaluationRecordByIdentifier(
    "evaluation-cycle",
    cycleId,
  );
  if (!cycle || !isActiveEvaluationRecord(cycle)) {
    throw new EvaluationRuntimeError(
      "Không tìm thấy kỳ đánh giá đang hoạt động.",
    );
  }
  const cycleContent = asRecord(cycle.content);
  const cycleReferences = new Set(evaluationRecordIdentifiers(cycle));
  const legacyCycleId =
    text(cycleContent.id || cycleContent.cycleId || cycle.parentId) || cycle.id;
  const cycleTypeIdentifier = text(
    cycleContent.cycleTypeTemplateId ||
      cycleContent.cycleTypeId ||
      cycleContent.cycleTypeCode,
  );
  const cycleType = cycleTypeIdentifier
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle-type-template",
        cycleTypeIdentifier,
      )
    : null;
  const cycleTypeContent = asRecord(cycleType?.content);
  const workflowTemplateId = text(
    cycleContent.workflowTemplateId ||
      cycleTypeContent.defaultWorkflowTemplateId,
  );
  const configuredWorkflow: EvaluationWorkflowStep[] = workflowTemplateId
    ? await workflowRoles({ workflowTemplateId })
    : [{ mode: "sequential", role: "self" as EvaluationRole }];
  const workflowReviewRoles = Array.from(
    new Set(configuredWorkflow.map((step) => step.role)),
  );

  const [
    memberRows,
    instanceRows,
    storedScores,
    planningRecords,
    mailDeliveries,
  ] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle-member" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-instance" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-criteria-score" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: { in: [...EVALUATION_SCORE_PLANNING_TYPES] } },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-mail-delivery" },
    }),
  ]);
  const members = await enrichEvaluationMemberRecords(
    memberRows.filter((member) => {
      if (!isActiveEvaluationRecord(member)) return false;
      const content = asRecord(member.content);
      return [content.cycleId, content.evaluationCycleId, member.parentId]
        .map(text)
        .some((value) => cycleReferences.has(value));
    }),
  );
  const fixedReviewerCodes = Array.from(
    new Set(
      configuredWorkflow.flatMap((step) =>
        stringList(step.reviewerEmployeeCodes),
      ),
    ),
  );
  const assignmentDirectory = await loadEvaluationEmployeeDirectory([
    ...members.map((member) => asRecord(member.content)),
    ...fixedReviewerCodes.map((employeeCode) => ({ employeeCode })),
  ]);
  const memberByEmployeeCode = new Map(
    members.map((member) => [
      text(asRecord(member.content).employeeCode).toLowerCase(),
      member,
    ]),
  );
  const instances = instanceRows.filter((instance) => {
    if (!isActiveEvaluationRecord(instance)) return false;
    const content = asRecord(instance.content);
    return [content.cycleId, content.evaluationCycleId, instance.parentId]
      .map(text)
      .some((value) => cycleReferences.has(value));
  });
  const jds = await resolveSharedJdsForMembers(
    members.map((member) => {
      const content = asRecord(member.content);
      return {
        documentId: text(content.manualJdDocumentId || content.jdDocumentId),
        position: text(content.jobTitleName),
        requestKey: member.id,
      };
    }),
  );
  const jdByMemberId = new Map(jds.map((jd) => [jd.requestKey, jd]));
  const now = new Date().toISOString();
  let updated = 0;
  let skippedStarted = 0;
  let skippedMissingMember = 0;
  let managerMailFailed = 0;
  let managerMailQueued = 0;
  let managerMailSent = 0;
  let managerMailSkipped = 0;
  const errors: string[] = [];

  const backfillMissingManagerMail = async (
    instance: (typeof instances)[number],
    content: JsonRecord,
  ) => {
    const managerIsActive = stringList(content.activeStepRoles).includes(
      "manager",
    );
    const managerStatus = text(content.managerReviewStatus).toLowerCase();
    const managerCode = text(content.managerEmployeeCode);
    if (
      !managerIsActive ||
      !managerCode ||
      ["completed", "finalized", "submitted"].includes(managerStatus)
    ) {
      managerMailSkipped += 1;
      return;
    }
    const instanceReferences = new Set(evaluationRecordIdentifiers(instance));
    const alreadyDelivered = mailDeliveries.some((delivery) => {
      const mail = asRecord(delivery.content);
      const belongs = [
        delivery.parentId,
        mail.instanceId,
        mail.evaluationInstanceId,
      ]
        .map(text)
        .some((value) => instanceReferences.has(value));
      const deliveryStatus = text(delivery.status || mail.status).toLowerCase();
      return (
        belongs &&
        text(mail.eventCode || mail.event).toLowerCase() ===
          "review_assigned" &&
        text(mail.recipientRole).toLowerCase() === "manager" &&
        ["queued", "sent"].includes(deliveryStatus)
      );
    });
    if (alreadyDelivered) {
      managerMailSkipped += 1;
      return;
    }
    try {
      const mailResult = await queueEvaluationMailForInstance(
        "review_assigned",
        instance.id,
        {
          actorName: actor.displayName,
          eventToken: `manager-backfill-v2:${instance.id}`,
          role: "manager",
          sendNow: true,
        },
      );
      managerMailFailed += mailResult.failed || 0;
      managerMailQueued += mailResult.queued || 0;
      managerMailSent += mailResult.sent || 0;
      managerMailSkipped += mailResult.skipped || 0;
    } catch (error) {
      managerMailFailed += 1;
      errors.push(
        `${text(content.employeeCode || instance.name)}: không gửi bù được mail quản lý (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  };

  for (const instance of instances) {
    const instanceContent = asRecord(instance.content);
    const instanceScores = storedScores.filter((score) =>
      scoreBelongsToInstance(
        asRecord(score.content),
        instanceContent,
        instance.id,
      ),
    );
    const activeInstanceScores = instanceScores.filter(
      isActiveEvaluationRecord,
    );
    if (!evaluationInstanceIsUnstarted(instance, activeInstanceScores)) {
      skippedStarted += 1;
      await backfillMissingManagerMail(instance, instanceContent);
      continue;
    }

    const employeeCode = text(instanceContent.employeeCode);
    const member = memberByEmployeeCode.get(employeeCode.toLowerCase());
    if (!member) {
      skippedMissingMember += 1;
      errors.push(
        `${employeeCode || instance.name}: không còn trong phân bổ kỳ.`,
      );
      await backfillMissingManagerMail(instance, instanceContent);
      continue;
    }
    const memberContent = asRecord(member.content);
    const jd = jdByMemberId.get(member.id);
    const roleIdentityContent = {
      ...memberContent,
      bodEmployeeCode: text(memberContent.bodEmployeeCode),
      bodEmployeeCodes: stringList(memberContent.bodEmployeeCodes).length
        ? stringList(memberContent.bodEmployeeCodes)
        : [text(memberContent.bodEmployeeCode)].filter(Boolean),
    };
    const reviewAssignments = buildEvaluationReviewAssignments(
      configuredWorkflow,
      roleIdentityContent,
      (reviewerEmployeeCode) => {
        const employee = assignmentDirectory.get(
          reviewerEmployeeCode.toLowerCase(),
        );
        return employee
          ? {
              email: employee.email,
              employeeCode: employee.employeeCode,
              employeeName: employee.fullName,
            }
          : null;
      },
    );
    const assignmentState = evaluationAssignmentWorkflowState(reviewAssignments);
    const initialRoles = reviewAssignments.length
      ? evaluationAssignmentRoles(
          assignmentState.assignments,
          assignmentState.activeAssignmentIds,
        )
      : evaluationInitialActiveRoles(configuredWorkflow, roleIdentityContent);
    const reviewStatusPatch = evaluationWorkflowStatusPatch(
      workflowReviewRoles,
      roleIdentityContent,
    );

    try {
      const plan = buildEvaluationScorePlan({
        cycle,
        instance,
        jd: jd || null,
        member,
        records: planningRecords,
      });
      const completionMode =
        text(cycleContent.completionMode || cycleTypeContent.completionMode) ||
        "manual_finalization";
      const refreshedContent = {
        ...instanceContent,
        activeReviewAssignmentIds: assignmentState.activeAssignmentIds,
        activeStepRoles: initialRoles,
        availableFrom: evaluationAvailableFromValue(
          memberContent,
          cycleContent,
          text(instanceContent.generatedAt) || instance.createdAt.toISOString(),
        ),
        bodEmail: text(memberContent.bodEmail),
        bodEmployeeCode: text(memberContent.bodEmployeeCode),
        bodName: text(memberContent.bodName),
        completionMode,
        configurationSyncedAt: now,
        configurationSyncedBy: actor.displayName,
        currentStepRole: initialRoles[0],
        currentReviewAssignmentId: assignmentState.activeAssignmentIds[0] || "",
        cycleId: legacyCycleId,
        cycleName: cycle.name,
        cycleTypeCode: text(
          cycleContent.cycleTypeCode ||
            cycleTypeContent.cycleTypeCode ||
            cycleType?.code,
        ),
        cycleTypeName: text(
          cycleContent.cycleTypeName ||
            cycleTypeContent.cycleTypeName ||
            cycleType?.name,
        ),
        cycleTypeTemplateId: text(
          cycleContent.cycleTypeTemplateId ||
            cycleContent.cycleTypeId ||
            cycleTypeContent.id ||
            cycleType?.legacyId ||
            cycleType?.id,
        ),
        deadline: evaluationDeadlineValue(
          memberContent,
          cycleContent,
          text(instanceContent.generatedAt) || instance.createdAt.toISOString(),
        ),
        decisionTemplateId: text(
          cycleContent.decisionTemplateId ||
            cycleTypeContent.defaultDecisionTemplateId ||
            cycleTypeContent.id ||
            cycleType?.legacyId ||
            cycleType?.id,
        ),
        departmentName: text(memberContent.departmentName),
        employeeCode: text(memberContent.employeeCode),
        employeeEmail: text(memberContent.employeeEmail),
        employeeName: text(memberContent.employeeName || member.name),
        evaluationCycleId: legacyCycleId,
        hrEmail: text(memberContent.hrEmail),
        hrEmployeeCode: text(memberContent.hrEmployeeCode),
        hrName: text(memberContent.hrName),
        jdDocumentId: "",
        jdFileName: "",
        jdJobTitleCode: "",
        jdJobTitleName: text(memberContent.jobTitleName),
        jdSource: "",
        jdSourceLabel: "",
        jdVersionId: "",
        managerEmail: text(memberContent.managerEmail),
        managerEmployeeCode: text(memberContent.managerEmployeeCode),
        managerName: text(memberContent.managerName),
        departmentHeadEmployeeCode: text(
          memberContent.departmentHeadEmployeeCode,
        ),
        indirectManagerEmail: text(memberContent.indirectManagerEmail),
        indirectManagerEmployeeCode: text(
          memberContent.indirectManagerEmployeeCode,
        ),
        indirectManagerEmployeeCodes: stringList(
          memberContent.indirectManagerEmployeeCodes,
        ),
        indirectManagerName: text(memberContent.indirectManagerName),
        milestoneDate: text(memberContent.milestoneDate),
        peerEmail: text(memberContent.peerEmail),
        peerEmployeeCode: text(memberContent.peerEmployeeCode),
        peerName: text(memberContent.peerName),
        bodEmployeeCodes: stringList(roleIdentityContent.bodEmployeeCodes),
        professionalActivityCount: 0,
        requiresFinalization: completionMode !== "auto_complete",
        roleScoreWeights: asRecord(
          cycleContent.roleScoreWeights || cycleTypeContent.roleScoreWeights,
        ),
        scoreAggregationMode:
          text(
            cycleContent.scoreAggregationMode ||
              cycleTypeContent.scoreAggregationMode,
          ) || "equal",
        updatedAt: now,
        updatedBy: actor.displayName,
        workflowCompleted: false,
        reviewAssignments: assignmentState.assignments,
        reviewerEmployeeCodesByStep: asRecord(
          memberContent.reviewerEmployeeCodesByStep,
        ),
        workflowRoles: workflowReviewRoles,
        workflowTemplateId,
        ...reviewStatusPatch,
        ...(reviewAssignments.length
          ? assignmentRoleStatusPatch(assignmentState.assignments)
          : {}),
        ...plan.instancePatch,
      };
      await db.$transaction(async (tx) => {
        if (instanceScores.length) {
          await tx.evaluationRecord.deleteMany({
            where: { id: { in: instanceScores.map((score) => score.id) } },
          });
        }
        if (plan.rows.length) {
          await tx.evaluationRecord.createMany({
            data: plan.rows.map((row) => ({
              code: row.code,
              content: row.content as Prisma.InputJsonValue,
              createdByName: actor.displayName,
              name: row.name,
              parentId: instance.id,
              recordType: "evaluation-criteria-score",
              status: "active",
              updatedByName: actor.displayName,
            })),
          });
        }
        await tx.evaluationRecord.update({
          data: {
            content: refreshedContent as Prisma.InputJsonValue,
            updatedByName: actor.displayName,
          },
          where: { id: instance.id },
        });
      });
      updated += 1;
      await backfillMissingManagerMail(instance, refreshedContent);
    } catch (error) {
      errors.push(
        `${employeeCode || instance.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await db.evaluationRecord.create({
    data: {
      code: uniqueCode("SYNCJOB"),
      content: {
        action: "sync_unstarted_instances",
        actor: actor.displayName,
        cycleId: legacyCycleId,
        errors,
        finishedAt: now,
        skippedMissingMember,
        skippedStarted,
        managerMailFailed,
        managerMailQueued,
        managerMailSent,
        managerMailSkipped,
        status: errors.length ? "completed_with_errors" : "done",
        updated,
      } as Prisma.InputJsonValue,
      createdByName: actor.displayName,
      name: `Cập nhật phiếu chưa làm: ${cycle.name || cycle.code}`,
      parentId: legacyCycleId,
      recordType: "evaluation-generation-job",
      status: errors.length ? "completed_with_errors" : "done",
      updatedByName: actor.displayName,
    },
  });

  return {
    errors,
    message: errors.length
      ? `Đã cập nhật ${updated} phiếu; bỏ qua ${skippedStarted} phiếu đã bắt đầu, gửi bù ${managerMailSent} mail quản lý và có ${errors.length} phiếu cần kiểm tra.`
      : `Đã cập nhật ${updated} phiếu chưa làm theo cấu hình mới; bỏ qua ${skippedStarted} phiếu đã bắt đầu và gửi bù ${managerMailSent} mail quản lý còn thiếu.`,
    managerMailFailed,
    managerMailQueued,
    managerMailSent,
    managerMailSkipped,
    skippedMissingMember,
    skippedStarted,
    updated,
  };
}

export async function resendFailedEvaluationMails(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const cycleId = text(payload.cycleId);
  if (!cycleId) {
    throw new EvaluationRuntimeError("Chọn kỳ đánh giá cần gửi lại mail lỗi.");
  }
  const cycle = await findEvaluationRecordByIdentifier(
    "evaluation-cycle",
    cycleId,
  );
  if (!cycle || !isActiveEvaluationRecord(cycle)) {
    throw new EvaluationRuntimeError(
      "Không tìm thấy kỳ đánh giá đang hoạt động.",
    );
  }

  const db = getDb();
  const cycleReferences = new Set(evaluationRecordIdentifiers(cycle));
  const instances = (
    await db.evaluationRecord.findMany({
      where: { recordType: "evaluation-instance" },
    })
  ).filter((instance) => {
    if (!isActiveEvaluationRecord(instance)) return false;
    const content = asRecord(instance.content);
    return [content.cycleId, content.evaluationCycleId, instance.parentId]
      .map(text)
      .some((value) => cycleReferences.has(value));
  });
  const instanceIds = instances.map((instance) => instance.id);
  const deliveries = instanceIds.length
    ? await db.evaluationRecord.findMany({
        orderBy: { createdAt: "asc" },
        where: {
          parentId: { in: instanceIds },
          recordType: "evaluation-mail-delivery",
          status: { in: ["failed", "sent"] },
        },
      })
    : [];
  const retryPlan = planEvaluationMailRetries(deliveries);
  const deliveryById = new Map(
    deliveries.map((delivery) => [delivery.id, delivery]),
  );
  const now = new Date().toISOString();

  for (const id of retryPlan.supersededIds) {
    const delivery = deliveryById.get(id);
    if (!delivery) continue;
    const content = asRecord(delivery.content);
    await db.evaluationRecord.updateMany({
      data: {
        content: {
          ...content,
          status: "superseded",
          supersededAt: now,
          supersededReason: "newer_equivalent_delivery_sent",
        } as Prisma.InputJsonValue,
        status: "superseded",
        updatedByName: actor.displayName,
      },
      where: { id, status: "failed" },
    });
  }

  const claimedIds: string[] = [];
  for (const id of retryPlan.retryIds) {
    const claimed = await db.evaluationRecord.updateMany({
      data: { status: "queued", updatedByName: actor.displayName },
      where: { id, status: "failed" },
    });
    if (claimed.count) claimedIds.push(id);
  }
  const result = claimedIds.length
    ? await processEvaluationMailOutbox({ ids: claimedIds })
    : { cancelled: 0, failed: 0, processed: 0, sent: 0 };
  const targeted = deliveries.filter(
    (delivery) => text(delivery.status).toLowerCase() === "failed",
  ).length;

  await db.auditLog.create({
    data: {
      action: "UPDATE",
      actorId: actor.userId,
      metadata: {
        cycleId,
        exhausted: retryPlan.exhaustedIds.length,
        failed: result.failed,
        retried: claimedIds.length,
        sent: result.sent,
        skippedAlreadySent: retryPlan.supersededIds.length,
        source: "evaluation-failed-mail-retry",
      },
      summary: `Gửi lại mail lỗi: Gmail tiếp nhận ${result.sent}, còn lỗi ${result.failed}, đã có bản thành công ${retryPlan.supersededIds.length}.`,
      targetId: cycle.id,
      targetType: "EvaluationCycle",
    },
  });

  return {
    cancelled: result.cancelled,
    exhausted: retryPlan.exhaustedIds.length,
    failed: result.failed,
    message: result.sent
      ? `Gmail đã tiếp nhận ${result.sent} mail trước đó gửi lỗi. Mail đã gửi thành công từ trước được tự động bỏ qua để không gửi trùng.`
      : targeted
        ? `Không còn mail lỗi nào cần gửi lại: ${retryPlan.supersededIds.length} mail đã có bản gửi thành công tương ứng, ${retryPlan.exhaustedIds.length} mail đã hết số lần thử.`
        : "Kỳ này không có mail gửi lỗi cần thử lại.",
    retried: claimedIds.length,
    sent: result.sent,
    skippedAlreadySent: retryPlan.supersededIds.length,
    targeted,
  };
}

export async function resendEvaluationManagerAssignmentMails(
  session: AppSession,
  payload: JsonRecord,
) {
  return resendFailedEvaluationMails(session, payload);
}

type EvaluationAutomationEmployee = {
  archivedAt: Date | null;
  department: string | null;
  email: string | null;
  employeeCode: string;
  fullName: string;
  id: string;
  status: string;
  terminationDate: string | null;
  title: string | null;
};

type EvaluationAutomationCandidate = {
  availableFrom: string;
  bod: EvaluationAutomationEmployee | null;
  deadline: string;
  departmentName: string;
  employee: EvaluationAutomationEmployee | null;
  employeeLabel: string;
  hr: EvaluationAutomationEmployee | null;
  issue: string;
  jobTitleName: string;
  indirectManager: EvaluationAutomationEmployee | null;
  indirectManager2: EvaluationAutomationEmployee | null;
  manager: EvaluationAutomationEmployee | null;
  milestoneDate: string;
  peer: EvaluationAutomationEmployee | null;
  periodKey: string;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  rowNumber: number;
  sourceKey: string;
  status:
    "expired" | "future" | "invalid" | "ready" | "unresolved" | "waiting_cycle";
};

function evaluationAutomationHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function evaluationAutomationIdentity(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9@._+-]+/g, " ")
    .trim();
}

function evaluationAutomationIsoDate(date: Date) {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function evaluationAutomationDate(value: unknown) {
  const raw = text(value).replace(/^'+/, "").trim();
  if (!raw) return null;
  let year = 0;
  let month = 0;
  let day = 0;
  let match = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (match) {
    year = Number(match[1]);
    month = Number(match[2]);
    day = Number(match[3]);
  } else {
    match = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
    if (match) {
      day = Number(match[1]);
      month = Number(match[2]);
      year = Number(match[3]);
    }
  }
  if (!match && /^\d+(?:\.\d+)?$/.test(raw)) {
    const serial = Number(raw);
    if (serial > 20_000 && serial < 100_000) {
      const date = new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function evaluationAutomationAddDays(date: Date, days: number) {
  return new Date(date.getTime() + Math.trunc(days) * 86_400_000);
}

function evaluationAutomationToday() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).formatToParts(new Date());
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function evaluationAutomationGenerationTiming(value: unknown) {
  return text(value) === "period_end" ? "period_end" : "period_start";
}

function evaluationAutomationCycleReady(
  candidate: Pick<EvaluationAutomationCandidate, "periodStart" | "periodEnd">,
  generationTiming: "period_start" | "period_end",
  today: string,
) {
  const triggerDate =
    generationTiming === "period_end"
      ? candidate.periodEnd
      : candidate.periodStart;
  return Boolean(triggerDate && today >= triggerDate);
}

function evaluationAutomationPeriod(
  date: Date,
  grouping: EvaluationAutomationSourceConfig["grouping"],
) {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (grouping === "yearly") {
    return {
      end: `${year}-12-31`,
      key: String(year),
      label: String(year),
      start: `${year}-01-01`,
    };
  }
  if (grouping === "quarterly") {
    const quarter = Math.floor((month - 1) / 3) + 1;
    const startMonth = (quarter - 1) * 3;
    const end = new Date(Date.UTC(year, startMonth + 3, 0));
    return {
      end: evaluationAutomationIsoDate(end),
      key: `${year}-Q${quarter}`,
      label: `Q${["I", "II", "III", "IV"][quarter - 1]}/${year}`,
      start: evaluationAutomationIsoDate(
        new Date(Date.UTC(year, startMonth, 1)),
      ),
    };
  }
  const end = new Date(Date.UTC(year, month, 0));
  return {
    end: evaluationAutomationIsoDate(end),
    key: `${year}-${String(month).padStart(2, "0")}`,
    label: `T${String(month).padStart(2, "0")}/${year}`,
    start: `${year}-${String(month).padStart(2, "0")}-01`,
  };
}

function evaluationAutomationDirectory(
  employees: EvaluationAutomationEmployee[],
) {
  const add = (
    map: Map<string, EvaluationAutomationEmployee[]>,
    key: unknown,
    employee: EvaluationAutomationEmployee,
  ) => {
    const normalized = evaluationAutomationIdentity(key);
    if (!normalized) return;
    const current = map.get(normalized) || [];
    current.push(employee);
    map.set(normalized, current);
  };
  const byCode = new Map<string, EvaluationAutomationEmployee[]>();
  const byEmail = new Map<string, EvaluationAutomationEmployee[]>();
  const byName = new Map<string, EvaluationAutomationEmployee[]>();
  const byTitle = new Map<string, EvaluationAutomationEmployee[]>();
  employees.forEach((employee) => {
    add(byCode, employee.employeeCode, employee);
    add(byEmail, employee.email, employee);
    add(byName, employee.fullName, employee);
    add(byTitle, employee.title, employee);
  });
  return { byCode, byEmail, byName, byTitle };
}

function evaluationAutomationSingleMatch(
  value: unknown,
  directory: ReturnType<typeof evaluationAutomationDirectory>,
) {
  const candidates = text(value)
    .split(/[;,|\n]+/)
    .map((item) => evaluationAutomationIdentity(item))
    .filter(Boolean);
  for (const candidate of candidates) {
    for (const map of [
      directory.byCode,
      directory.byEmail,
      directory.byName,
      directory.byTitle,
    ]) {
      const matches = map.get(candidate) || [];
      if (matches.length === 1) return { employee: matches[0], issue: "" };
      if (matches.length > 1) {
        return {
          employee: null,
          issue: `Có nhiều nhân sự trùng "${text(value)}".`,
        };
      }
    }
  }
  return {
    employee: null,
    issue: text(value) ? `Không đối chiếu được "${text(value)}".` : "",
  };
}

function evaluationAutomationEmployeeMatch(
  row: EvaluationAutomationSheetRow,
  config: EvaluationAutomationSourceConfig,
  directory: ReturnType<typeof evaluationAutomationDirectory>,
) {
  const values = [
    mappedEvaluationAutomationValue(row, config, "employeeCode"),
    mappedEvaluationAutomationValue(row, config, "employeeEmail"),
    mappedEvaluationAutomationValue(row, config, "employeeName"),
  ].filter(Boolean);
  for (const value of values) {
    const result = evaluationAutomationSingleMatch(value, directory);
    if (result.employee) return result;
  }
  return {
    employee: null,
    issue: values.length
      ? `Không tìm thấy nhân sự ${values.join(" · ")} trong danh mục đang hoạt động.`
      : "Dòng dữ liệu không có mã, email hoặc họ tên nhân sự.",
  };
}

function evaluationAutomationConfigError(
  config: EvaluationAutomationSourceConfig,
) {
  if (!config.spreadsheetId) return "Link Google Sheet không hợp lệ.";
  if (!config.sheetName) return "Chưa chọn sheet lấy dữ liệu.";
  if (!config.mappings.milestoneDate)
    return "Chưa chọn header Mốc thời gian xác định.";
  if (
    !config.mappings.employeeCode &&
    !config.mappings.employeeEmail &&
    !config.mappings.employeeName
  ) {
    return "Cần map ít nhất MNV, email hoặc họ tên nhân sự.";
  }
  return "";
}

async function evaluationAutomationRequiredRoles(templateContent: JsonRecord) {
  const workflowTemplateId = text(templateContent.defaultWorkflowTemplateId);
  if (!workflowTemplateId) return ["self"] as EvaluationRole[];
  const steps = await workflowRoles({ workflowTemplateId });
  return Array.from(new Set(steps.map((step) => step.role)));
}

function buildEvaluationAutomationCandidates(input: {
  config: EvaluationAutomationSourceConfig;
  directory: ReturnType<typeof evaluationAutomationDirectory>;
  hierarchySource?: Awaited<
    ReturnType<typeof loadEvaluationAutomationHierarchySource>
  >;
  requiredRoles: EvaluationRole[];
  rows: EvaluationAutomationSheetRow[];
  today: string;
}) {
  const { config, directory, hierarchySource, requiredRoles, rows, today } =
    input;
  const hierarchyByEmployeeCode = new Map<
    string,
    {
      bod: string;
      indirect_manager: string;
      indirect_manager_2: string;
      manager: string;
    }
  >();
  if (hierarchySource) {
    const hierarchyMappings = autoMapEvaluationAutomationHeaders(
      hierarchySource.headers,
    );
    for (const hierarchyRow of hierarchySource.rows) {
      const valueFor = (key: keyof typeof hierarchyMappings) => {
        const header = text(hierarchyMappings[key]);
        return header ? text(hierarchyRow.values[header]) : "";
      };
      const employeeMatch = evaluationAutomationSingleMatch(
        valueFor("employeeCode") ||
          valueFor("employeeEmail") ||
          valueFor("employeeName"),
        directory,
      );
      if (!employeeMatch.employee) continue;
      hierarchyByEmployeeCode.set(
        employeeMatch.employee.employeeCode.toLowerCase(),
        {
          bod: valueFor("bod"),
          indirect_manager: valueFor("indirectManager"),
          indirect_manager_2: valueFor("indirectManager2"),
          manager: valueFor("manager"),
        },
      );
    }
  }
  return rows.map((row): EvaluationAutomationCandidate => {
    const rawMilestone = mappedEvaluationAutomationValue(
      row,
      config,
      "milestoneDate",
    );
    const milestone = evaluationAutomationDate(rawMilestone);
    const employeeMatch = evaluationAutomationEmployeeMatch(
      row,
      config,
      directory,
    );
    const genericReviewer = mappedEvaluationAutomationValue(
      row,
      config,
      "reviewer",
    );
    const hierarchyValues = employeeMatch.employee
      ? hierarchyByEmployeeCode.get(
          employeeMatch.employee.employeeCode.toLowerCase(),
        )
      : undefined;
    const roleValue = (role: Exclude<EvaluationRole, "self">) => {
      const mappingKey = role === "indirect_manager" ? "indirectManager" : role;
      const sourceValue = mappedEvaluationAutomationValue(
        row,
        config,
        mappingKey,
      );
      if (
        hierarchyValues &&
        ["manager", "indirect_manager", "bod"].includes(role)
      ) {
        const hierarchyValue =
          hierarchyValues[role as keyof typeof hierarchyValues];
        if (role === "indirect_manager") return hierarchyValue;
        return (
          hierarchyValue ||
          sourceValue ||
          (config.reviewerRole === role ? genericReviewer : "")
        );
      }
      return (
        sourceValue || (config.reviewerRole === role ? genericReviewer : "")
      );
    };
    const managerMatch = evaluationAutomationSingleMatch(
      roleValue("manager"),
      directory,
    );
    const indirectManagerValue = roleValue("indirect_manager");
    const indirectManagerMatch = evaluationAutomationSingleMatch(
      indirectManagerValue,
      directory,
    );
    const indirectManager2Value =
      hierarchyValues?.indirect_manager_2 ||
      mappedEvaluationAutomationValue(row, config, "indirectManager2");
    const indirectManager2Match = evaluationAutomationSingleMatch(
      indirectManager2Value,
      directory,
    );
    const peerMatch = evaluationAutomationSingleMatch(
      roleValue("peer"),
      directory,
    );
    const hrMatch = evaluationAutomationSingleMatch(roleValue("hr"), directory);
    const bodMatch = evaluationAutomationSingleMatch(
      roleValue("bod"),
      directory,
    );
    const employeeLabel =
      mappedEvaluationAutomationValue(row, config, "employeeName") ||
      mappedEvaluationAutomationValue(row, config, "employeeEmail") ||
      mappedEvaluationAutomationValue(row, config, "employeeCode") ||
      `Dòng ${row.rowNumber}`;
    const jobTitleName =
      mappedEvaluationAutomationValue(row, config, "jobTitle") ||
      employeeMatch.employee?.title ||
      "";
    const departmentName =
      mappedEvaluationAutomationValue(row, config, "department") ||
      employeeMatch.employee?.department ||
      "";
    const roleMatches = {
      bod: bodMatch,
      hr: hrMatch,
      indirect_manager: indirectManagerMatch,
      manager: managerMatch,
      peer: peerMatch,
    };
    const issues = [employeeMatch.issue];
    if (!milestone)
      issues.push(`Mốc thời gian "${rawMilestone || "trống"}" không hợp lệ.`);
    if (!jobTitleName) issues.push("Chưa xác định được chức danh để lấy JD.");
    requiredRoles.forEach((role) => {
      if (role === "self") return;
      if (role === "indirect_manager" && !indirectManagerValue) return;
      const result = roleMatches[role];
      if (!result.employee) {
        issues.push(
          result.issue ||
            `Chưa xác định được ${role === "manager" ? "quản lý trực tiếp" : role === "indirect_manager" ? "quản lý gián tiếp" : role === "peer" ? "đồng nghiệp" : "HR"}.`,
        );
      }
    });
    const issue = issues.filter(Boolean).join(" ");
    if (!milestone) {
      return {
        availableFrom: "",
        bod: bodMatch.employee,
        deadline: "",
        departmentName,
        employee: employeeMatch.employee,
        employeeLabel,
        hr: hrMatch.employee,
        indirectManager: indirectManagerMatch.employee,
        indirectManager2: indirectManager2Match.employee,
        issue,
        jobTitleName,
        manager: managerMatch.employee,
        milestoneDate: "",
        peer: peerMatch.employee,
        periodEnd: "",
        periodKey: "",
        periodLabel: "",
        periodStart: "",
        rowNumber: row.rowNumber,
        sourceKey: `ROW_${row.rowNumber}`,
        status: "invalid",
      };
    }
    const milestoneDate = evaluationAutomationIsoDate(milestone);
    const availableFrom = evaluationAutomationIsoDate(
      evaluationAutomationAddDays(milestone, -config.leadDays),
    );
    const deadline = evaluationAutomationIsoDate(
      evaluationAutomationAddDays(milestone, config.expiryDays),
    );
    const period = evaluationAutomationPeriod(milestone, config.grouping);
    const stableId = mappedEvaluationAutomationValue(row, config, "stableId");
    const sourceKey =
      stableId ||
      [
        employeeMatch.employee?.employeeCode || employeeLabel,
        milestoneDate,
      ].join("|");
    return {
      availableFrom,
      bod: bodMatch.employee,
      deadline,
      departmentName,
      employee: employeeMatch.employee,
      employeeLabel,
      hr: hrMatch.employee,
      indirectManager: indirectManagerMatch.employee,
      indirectManager2: indirectManager2Match.employee,
      issue,
      jobTitleName,
      manager: managerMatch.employee,
      milestoneDate,
      peer: peerMatch.employee,
      periodEnd: period.end,
      periodKey: period.key,
      periodLabel: period.label,
      periodStart: period.start,
      rowNumber: row.rowNumber,
      sourceKey,
      status: issue
        ? "unresolved"
        : today < availableFrom
          ? "future"
          : today > deadline
            ? "expired"
            : "ready",
    };
  });
}

async function evaluationAutomationEmployees() {
  const employees = await getDb().employee.findMany({
    orderBy: { fullName: "asc" },
    select: {
      archivedAt: true,
      department: true,
      email: true,
      employeeCode: true,
      fullName: true,
      id: true,
      status: true,
      terminationDate: true,
      title: true,
    },
    where: { archivedAt: null, status: "ACTIVE" },
  });
  return employees.filter(
    (employee) => evaluationEmployeeEmploymentState(employee).eligible,
  );
}

async function evaluationAutomationContext(payload: JsonRecord) {
  const requested = asRecord(payload.record);
  const scheduleIdentifier = text(
    payload.scheduleId ||
      requested.databaseId ||
      requested.id ||
      requested.cycleScheduleId ||
      requested.code,
  );
  const schedule = scheduleIdentifier
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle-schedule",
        scheduleIdentifier,
      )
    : null;
  const scheduleContent = {
    ...(schedule ? asRecord(schedule.content) : {}),
    ...requested,
  } as JsonRecord;
  const templateIdentifier = text(
    payload.templateId ||
      scheduleContent.cycleTypeTemplateId ||
      scheduleContent.cycleTypeCode,
  );
  const template = templateIdentifier
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle-type-template",
        templateIdentifier,
      )
    : null;
  if (!template) {
    throw new EvaluationRuntimeError(
      "Không tìm thấy Loại đánh giá áp dụng cho lịch sinh kỳ.",
      404,
    );
  }
  return { schedule, scheduleContent, template };
}

export async function saveEvaluationAutomationSchedule(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const record = asRecord(payload.record || payload);
  const generationMode = text(record.generationMode).toLowerCase();
  if (!["monthly", "quarterly", "yearly"].includes(generationMode)) {
    throw new EvaluationRuntimeError(
      "Lịch tự động phải chọn Theo tháng, Theo Quý hoặc Theo Năm.",
    );
  }
  const template = await findEvaluationRecordByIdentifier(
    "evaluation-cycle-type-template",
    record.cycleTypeTemplateId || record.cycleTypeCode,
  );
  if (!template) {
    throw new EvaluationRuntimeError(
      "Không tìm thấy Loại đánh giá áp dụng.",
      404,
    );
  }
  const templateReference = evaluationRecordLegacyId({
    ...template,
    recordType: "evaluation-cycle-type-template",
  });
  const automationRuleKey =
    text(record.automationRuleKey || record.ruleKey) || "default";
  const normalizedRecord = {
    ...record,
    automationRuleKey,
    automationCycleGrouping: generationMode,
    automationSourceEnabled: true,
    cycleTypeCode: text(
      template.code || asRecord(template.content).cycleTypeCode,
    ),
    cycleTypeName: text(
      template.name || asRecord(template.content).cycleTypeName,
    ),
    cycleTypeTemplateId: templateReference,
    generationMode,
    generationTiming: evaluationAutomationGenerationTiming(
      record.generationTiming,
    ),
    status: text(record.status) === "active" ? "active" : "draft",
  } as JsonRecord;
  const config = normalizeEvaluationAutomationSourceConfig(normalizedRecord);
  const configError = evaluationAutomationConfigError(config);
  if (configError) throw new EvaluationRuntimeError(configError);

  const requestedId = text(
    record.databaseId || record.id || record.cycleScheduleId,
  );
  let current = requestedId
    ? await findEvaluationRecordByIdentifier(
        "evaluation-cycle-schedule",
        requestedId,
      )
    : null;
  if (!current) {
    const schedules = await getDb().evaluationRecord.findMany({
      where: {
        recordType: "evaluation-cycle-schedule",
      },
    });
    current =
      schedules.find((schedule) => {
        const content = asRecord(schedule.content);
        const sameTemplate = evaluationRecordIdentifiers(template).some(
          (identifier) =>
            identifier === text(content.cycleTypeTemplateId) ||
            identifier === text(content.cycleTypeCode),
        );
        const storedRuleKey =
          text(content.automationRuleKey || content.ruleKey) || "default";
        return sameTemplate && storedRuleKey === automationRuleKey;
      }) || null;
  }
  const scheduleLegacyId = current
    ? evaluationRecordLegacyId({
        ...current,
        recordType: "evaluation-cycle-schedule",
      })
    : `EVAL_SCHEDULE_${evaluationAutomationHash(templateReference)}`;
  const ruleCode =
    automationRuleKey === "default"
      ? ""
      : `_${automationRuleKey
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[đĐ]/g, "d")
          .toUpperCase()
          .replace(/[^A-Z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .slice(0, 32)}`;
  const code = `SCHEDULE_${text(template.code || templateReference)}${ruleCode}`
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .slice(0, 80);
  const name = `Lịch sinh kỳ - ${template.name || template.code || "Đánh giá"}${automationRuleKey === "default" ? "" : ` - ${automationRuleKey}`}`;
  const saved = await saveEvaluationConfigRecord(session, {
    code,
    content: {
      ...normalizedRecord,
      code,
      cycleScheduleId: scheduleLegacyId,
      id: scheduleLegacyId,
      name,
      recordType: "evaluation-cycle-schedule",
      scheduleCode: code,
      scheduleName: name,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.displayName,
    },
    id: current?.id || "",
    name,
    note: text(record.note),
    recordType: "evaluation-cycle-schedule",
    status: normalizedRecord.status,
  });
  const content = asRecord(saved.record.content);
  return {
    message: "Đã lưu lịch sinh kỳ tự động.",
    schedule: {
      ...saved.record,
      ...content,
      databaseId: saved.record.id,
      id: text(content.id) || saved.record.id,
    },
  };
}

export async function inspectEvaluationAutomationSource(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const source = asRecord(payload.record || payload);
  const config = normalizeEvaluationAutomationSourceConfig(source);
  return inspectEvaluationAutomationSpreadsheet({
    headerRow: config.headerRow,
    sheetName: config.sheetName,
    spreadsheetUrl: config.spreadsheetUrl,
  });
}

export async function previewEvaluationAutomationSource(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const context = await evaluationAutomationContext(payload);
  const templateContent = asRecord(context.template.content);
  const config = normalizeEvaluationAutomationSourceConfig(
    context.scheduleContent,
  );
  const configError = evaluationAutomationConfigError(config);
  if (configError) throw new EvaluationRuntimeError(configError);
  const [source, hierarchySource, employees, requiredRoles] = await Promise.all(
    [
      loadEvaluationAutomationSource(config),
      loadEvaluationAutomationHierarchySource(config),
      evaluationAutomationEmployees(),
      evaluationAutomationRequiredRoles(templateContent),
    ],
  );
  const today = text(payload.today) || evaluationAutomationToday();
  const generationTiming = evaluationAutomationGenerationTiming(
    context.scheduleContent.generationTiming,
  );
  const rows = buildEvaluationAutomationCandidates({
    config,
    directory: evaluationAutomationDirectory(employees),
    hierarchySource,
    requiredRoles,
    rows: source.rows,
    today,
  }).map((row) =>
    row.status === "ready" &&
    !evaluationAutomationCycleReady(row, generationTiming, today)
      ? { ...row, status: "waiting_cycle" as const }
      : row,
  );
  const summary = {
    expired: rows.filter((row) => row.status === "expired").length,
    future: rows.filter((row) => row.status === "future").length,
    invalid: rows.filter((row) => row.status === "invalid").length,
    ready: rows.filter((row) => row.status === "ready").length,
    total: rows.length,
    unresolved: rows.filter((row) => row.status === "unresolved").length,
    waitingCycle: rows.filter((row) => row.status === "waiting_cycle").length,
  };
  return {
    config: evaluationAutomationConfigForClient(context.scheduleContent),
    requiredRoles,
    rows: rows.slice(0, 250).map((row) => ({
      availableFrom: row.availableFrom,
      deadline: row.deadline,
      employeeCode: row.employee?.employeeCode || "",
      employeeName: row.employee?.fullName || row.employeeLabel,
      bodName: row.bod?.fullName || "",
      issue: row.issue,
      indirectManagerName: row.indirectManager?.fullName || "",
      indirectManager2Name: row.indirectManager2?.fullName || "",
      managerName: row.manager?.fullName || "",
      milestoneDate: row.milestoneDate,
      periodLabel: row.periodLabel,
      rowNumber: row.rowNumber,
      status: row.status,
    })),
    serviceAccount: EVALUATION_AUTOMATION_SERVICE_ACCOUNT,
    sheetName: source.sheetName,
    spreadsheetTitle: source.spreadsheetTitle,
    summary,
    today,
  };
}

async function runEvaluationAutomationTemplate(input: {
  actor: OperationActor;
  force: boolean;
  schedule: {
    code: string | null;
    content: unknown;
    id: string;
    legacyId: string | null;
    name: string | null;
    status: string;
  };
  template: {
    code: string | null;
    content: unknown;
    id: string;
    legacyId: string | null;
    name: string | null;
    status: string;
  };
  today: string;
}) {
  const { actor, force, schedule, template, today } = input;
  const db = getDb();
  const scheduleContent = asRecord(schedule.content);
  const templateContent = asRecord(template.content);
  const config = normalizeEvaluationAutomationSourceConfig(scheduleContent);
  const configError = evaluationAutomationConfigError(config);
  if (configError) throw new EvaluationRuntimeError(configError);
  const [source, hierarchySource, employees, requiredRoles] = await Promise.all(
    [
      loadEvaluationAutomationSource(config),
      loadEvaluationAutomationHierarchySource(config),
      evaluationAutomationEmployees(),
      evaluationAutomationRequiredRoles(templateContent),
    ],
  );
  const candidates = buildEvaluationAutomationCandidates({
    config,
    directory: evaluationAutomationDirectory(employees),
    hierarchySource,
    requiredRoles,
    rows: source.rows,
    today,
  });
  const templateReference = evaluationRecordLegacyId({
    ...template,
    recordType: "evaluation-cycle-type-template",
  });
  const scheduleReference = evaluationRecordLegacyId({
    ...schedule,
    recordType: "evaluation-cycle-schedule",
  });
  const generationTiming = evaluationAutomationGenerationTiming(
    scheduleContent.generationTiming,
  );
  const cycleCache = new Map<string, { id: string; legacyId: string }>();
  const issues: Array<{ message: string; rowNumber: number }> = [];
  let created = 0;
  let skipped = 0;
  let updated = 0;

  for (const candidate of candidates) {
    if (
      candidate.status !== "ready" ||
      !candidate.employee ||
      (!force &&
        !evaluationAutomationCycleReady(candidate, generationTiming, today))
    ) {
      continue;
    }
    try {
      const cycleLegacyId = `AUTO_CYCLE_${evaluationAutomationHash(
        `${scheduleReference}|${templateReference}|${candidate.periodKey}`,
      )}`;
      let cycle = cycleCache.get(cycleLegacyId);
      if (!cycle) {
        const cycleName = `${candidate.periodLabel} - ${template.name || template.code || "Đánh giá"}`;
        const storedCycle = await db.evaluationRecord.upsert({
          create: {
            code: `AUTO_${text(template.code || "TYPE")}_${candidate.periodKey}`.toUpperCase(),
            content: {
              allowedJdFrequencies: templateContent.allowedJdFrequencies,
              automationManaged: true,
              automationScheduleId: scheduleReference,
              automationSourceLink: config.spreadsheetUrl,
              automationSourceSheet: config.sheetName,
              completionMode:
                text(templateContent.completionMode) || "manual_finalization",
              cycleCode:
                `AUTO_${text(template.code || "TYPE")}_${candidate.periodKey}`.toUpperCase(),
              cycleId: cycleLegacyId,
              cycleName,
              cycleTypeCode: text(
                template.code || templateContent.cycleTypeCode,
              ),
              cycleTypeTemplateId: templateReference,
              endDate: candidate.periodEnd,
              id: cycleLegacyId,
              jdAllowedFrequencies: templateContent.jdAllowedFrequencies,
              periodKey: candidate.periodKey,
              roleScoreWeights: asRecord(templateContent.roleScoreWeights),
              scoreAggregationMode:
                text(templateContent.scoreAggregationMode) || "equal",
              startDate: candidate.periodStart,
              status: "active",
              workflowTemplateId: text(
                templateContent.defaultWorkflowTemplateId,
              ),
            } as Prisma.InputJsonValue,
            createdByName: actor.displayName,
            legacyId: cycleLegacyId,
            name: cycleName,
            recordType: "evaluation-cycle",
            sourceFingerprint: cycleLegacyId,
            status: "active",
            updatedByName: actor.displayName,
          },
          update: {
            content: {
              allowedJdFrequencies: templateContent.allowedJdFrequencies,
              automationManaged: true,
              automationScheduleId: scheduleReference,
              automationSourceLink: config.spreadsheetUrl,
              automationSourceSheet: config.sheetName,
              completionMode:
                text(templateContent.completionMode) || "manual_finalization",
              cycleCode:
                `AUTO_${text(template.code || "TYPE")}_${candidate.periodKey}`.toUpperCase(),
              cycleId: cycleLegacyId,
              cycleName,
              cycleTypeCode: text(
                template.code || templateContent.cycleTypeCode,
              ),
              cycleTypeTemplateId: templateReference,
              endDate: candidate.periodEnd,
              id: cycleLegacyId,
              jdAllowedFrequencies: templateContent.jdAllowedFrequencies,
              periodKey: candidate.periodKey,
              roleScoreWeights: asRecord(templateContent.roleScoreWeights),
              scoreAggregationMode:
                text(templateContent.scoreAggregationMode) || "equal",
              startDate: candidate.periodStart,
              status: "active",
              workflowTemplateId: text(
                templateContent.defaultWorkflowTemplateId,
              ),
            } as Prisma.InputJsonValue,
            name: cycleName,
            status: "active",
            updatedByName: actor.displayName,
          },
          where: { legacyId: cycleLegacyId },
        });
        cycle = { id: storedCycle.id, legacyId: cycleLegacyId };
        cycleCache.set(cycleLegacyId, cycle);
      }
      const memberLegacyId = `AUTO_MEMBER_${evaluationAutomationHash(
        [
          templateReference,
          config.spreadsheetId,
          config.sheetName,
          candidate.sourceKey,
          candidate.milestoneDate,
        ].join("|"),
      )}`;
      const memberContent = {
        automationManaged: true,
        automationScheduleId: scheduleReference,
        automationSourceKey: candidate.sourceKey,
        automationSourceLink: config.spreadsheetUrl,
        automationSourceRow: candidate.rowNumber,
        automationSourceSheet: config.sheetName,
        availableFrom: candidate.availableFrom,
        bodEmployeeCode: candidate.bod?.employeeCode || "",
        bodEmployeeCodes: [candidate.bod?.employeeCode || ""].filter(Boolean),
        bodName: candidate.bod?.fullName || "",
        cycleId: cycle.legacyId,
        deadline: candidate.deadline,
        departmentName: candidate.departmentName,
        employeeCode: candidate.employee.employeeCode,
        employeeId: candidate.employee.id,
        employeeName: candidate.employee.fullName,
        evaluationCycleId: cycle.legacyId,
        hrEmployeeCode: candidate.hr?.employeeCode || "",
        hrName: candidate.hr?.fullName || "",
        id: memberLegacyId,
        indirectManagerEmployeeCode:
          candidate.indirectManager?.employeeCode || "",
        indirectManagerEmployeeCodes: [
          candidate.indirectManager?.employeeCode || "",
          candidate.indirectManager2?.employeeCode || "",
        ].filter(Boolean),
        indirectManagerEmail: candidate.indirectManager?.email || "",
        indirectManagerName: candidate.indirectManager?.fullName || "",
        jobTitleName: candidate.jobTitleName,
        managerEmployeeCode: candidate.manager?.employeeCode || "",
        managerName: candidate.manager?.fullName || "",
        milestoneDate: candidate.milestoneDate,
        peerEmployeeCode: candidate.peer?.employeeCode || "",
        peerName: candidate.peer?.fullName || "",
        isActive: true,
        status: "active",
      };
      const existingMember = await db.evaluationRecord.findUnique({
        where: { legacyId: memberLegacyId },
      });
      const existingMemberContent = asRecord(existingMember?.content);
      const manuallyExcluded = booleanValue(
        existingMemberContent.manualGenerationExcluded,
      );
      const preservedManualAllocation = {
        bodEmployeeCode:
          text(existingMemberContent.bodEmployeeCode) ||
          text(memberContent.bodEmployeeCode),
        bodEmployeeCodes: stringList(existingMemberContent.bodEmployeeCodes)
          .length
          ? stringList(existingMemberContent.bodEmployeeCodes)
          : stringList(memberContent.bodEmployeeCodes),
        departmentHeadEmployeeCode: text(
          existingMemberContent.departmentHeadEmployeeCode,
        ),
        reviewerEmployeeCodesByStep: asRecord(
          existingMemberContent.reviewerEmployeeCodesByStep,
        ),
      };
      const persistedMemberContent = manuallyExcluded
        ? {
            ...memberContent,
            ...preservedManualAllocation,
            excludedFromGenerationAt: text(
              existingMemberContent.excludedFromGenerationAt,
            ),
            excludedFromGenerationBy: text(
              existingMemberContent.excludedFromGenerationBy,
            ),
            excludedFromGenerationReason: text(
              existingMemberContent.excludedFromGenerationReason,
            ),
            isActive: false,
            manualGenerationExcluded: true,
            status: "inactive",
          }
        : { ...memberContent, ...preservedManualAllocation };
      await db.evaluationRecord.upsert({
        create: {
          code: `AUTO_${candidate.employee.employeeCode}_${evaluationAutomationHash(memberLegacyId).slice(0, 8)}`,
          content: persistedMemberContent as Prisma.InputJsonValue,
          createdByName: actor.displayName,
          legacyId: memberLegacyId,
          name: candidate.employee.fullName,
          parentId: cycle.legacyId,
          recordType: "evaluation-cycle-member",
          sourceFingerprint: memberLegacyId,
          status: manuallyExcluded ? "inactive" : "active",
          updatedByName: actor.displayName,
        },
        update: {
          content: persistedMemberContent as Prisma.InputJsonValue,
          name: candidate.employee.fullName,
          parentId: cycle.legacyId,
          status: manuallyExcluded ? "inactive" : "active",
          updatedByName: actor.displayName,
        },
        where: { legacyId: memberLegacyId },
      });
      if (manuallyExcluded) {
        skipped += 1;
        continue;
      }
      const generation = await generateEvaluationInstancesForActor(actor, {
        cycleId: cycle.legacyId,
        employeeCodes: [candidate.employee.employeeCode],
        suppressJob: true,
      });
      created += generation.created;
      skipped += generation.skipped;
      if (generation.skipped) updated += 1;
    } catch (error) {
      issues.push({
        message: error instanceof Error ? error.message : String(error),
        rowNumber: candidate.rowNumber,
      });
    }
  }

  candidates
    .filter((candidate) => candidate.issue)
    .forEach((candidate) => {
      issues.push({ message: candidate.issue, rowNumber: candidate.rowNumber });
    });
  const summary = {
    created,
    expired: candidates.filter((candidate) => candidate.status === "expired")
      .length,
    future: candidates.filter((candidate) => candidate.status === "future")
      .length,
    issueCount: issues.length,
    ready: candidates.filter((candidate) => candidate.status === "ready")
      .length,
    skipped,
    total: candidates.length,
    updated,
    waitingCycle: force
      ? 0
      : candidates.filter(
          (candidate) =>
            candidate.status === "ready" &&
            !evaluationAutomationCycleReady(candidate, generationTiming, today),
        ).length,
  };
  const now = new Date().toISOString();
  await db.evaluationRecord.create({
    data: {
      code: uniqueCode("AUTOJOB"),
      content: {
        automationManaged: true,
        finishedAt: now,
        issues: issues.slice(0, 100),
        sourceSheet: config.sheetName,
        sourceSpreadsheetId: config.spreadsheetId,
        scheduleId: scheduleReference,
        status: issues.length ? "partial" : "done",
        summary,
        templateId: templateReference,
      } as Prisma.InputJsonValue,
      createdByName: actor.displayName,
      name: `Sinh phiếu tự động - ${template.name || template.code}`,
      parentId: scheduleReference,
      recordType: "evaluation-generation-job",
      status: issues.length ? "partial" : "done",
      updatedByName: actor.displayName,
    },
  });
  await db.auditLog.create({
    data: {
      action: "UPDATE",
      actorId: actor.userId || null,
      metadata: {
        serviceAccount: EVALUATION_AUTOMATION_SERVICE_ACCOUNT,
        sourceSheet: config.sheetName,
        scheduleId: scheduleReference,
        summary,
        templateId: templateReference,
      },
      summary: `Sinh phiếu đánh giá tự động: tạo ${created}, giữ nguyên ${skipped}, lỗi ${issues.length}.`,
      targetId: schedule.id,
      targetType: "EvaluationAutomation",
    },
  });
  return {
    issues: issues.slice(0, 100),
    message: `Đã quét ${summary.total} dòng: tạo ${created} phiếu, giữ nguyên ${skipped}, ${summary.waitingCycle} chờ mốc sinh kỳ, ${summary.future} chưa tới ngày, ${summary.expired} quá hạn, ${issues.length} cần xử lý.`,
    scheduleId: scheduleReference,
    summary,
    templateId: templateReference,
    templateName: template.name || template.code || "",
  };
}

export async function runEvaluationAutomation(options?: {
  actor?: OperationActor;
  force?: boolean;
  scheduleId?: string;
  templateId?: string;
  today?: string;
}) {
  const db = getDb();
  const actor: OperationActor = options?.actor || {
    displayName: "Tự động C&B",
    employeeCode: "",
    employeeId: "",
    fullAccess: true,
    isAdmin: true,
    isBod: false,
    modules: [],
    permissions: [],
    roles: ["system-automation"],
    userId: "",
  };
  let schedules = options?.scheduleId
    ? [
        await findEvaluationRecordByIdentifier(
          "evaluation-cycle-schedule",
          options.scheduleId,
        ),
      ].filter(Boolean)
    : await db.evaluationRecord.findMany({
        where: {
          recordType: "evaluation-cycle-schedule",
          status: "active",
        },
      });
  if (options?.scheduleId && !schedules.length) {
    throw new EvaluationRuntimeError(
      "Không tìm thấy lịch sinh kỳ cần chạy.",
      404,
    );
  }
  if (options?.templateId) {
    const requestedTemplate = await findEvaluationRecordByIdentifier(
      "evaluation-cycle-type-template",
      options.templateId,
    );
    if (!requestedTemplate) {
      throw new EvaluationRuntimeError(
        "Không tìm thấy Loại đánh giá cần chạy.",
        404,
      );
    }
    const identifiers = new Set(evaluationRecordIdentifiers(requestedTemplate));
    schedules = schedules.filter((schedule) => {
      const content = asRecord(schedule?.content);
      return (
        identifiers.has(text(content.cycleTypeTemplateId)) ||
        identifiers.has(text(content.cycleTypeCode))
      );
    });
  }
  const enabled = schedules.filter((schedule) => {
    if (!schedule || schedule.status !== "active") return false;
    const content = asRecord(schedule.content);
    return (
      ["monthly", "quarterly", "yearly"].includes(
        text(content.generationMode),
      ) && normalizeEvaluationAutomationSourceConfig(content).enabled
    );
  });
  if ((options?.scheduleId || options?.templateId) && !enabled.length) {
    throw new EvaluationRuntimeError(
      "Lịch sinh kỳ phải đang hoạt động và có nguồn tự động hợp lệ.",
    );
  }
  const today = options?.today || evaluationAutomationToday();
  const results = [];
  for (const schedule of enabled) {
    if (!schedule) continue;
    const scheduleContent = asRecord(schedule.content);
    const template = await findEvaluationRecordByIdentifier(
      "evaluation-cycle-type-template",
      scheduleContent.cycleTypeTemplateId || scheduleContent.cycleTypeCode,
    );
    try {
      if (!template || template.status !== "published") {
        throw new EvaluationRuntimeError(
          "Loại đánh giá của lịch phải được publish trước khi chạy.",
        );
      }
      results.push(
        await runEvaluationAutomationTemplate({
          actor,
          force: Boolean(options?.force),
          schedule,
          template,
          today,
        }),
      );
    } catch (error) {
      results.push({
        issues: [
          {
            message: error instanceof Error ? error.message : String(error),
            rowNumber: 0,
          },
        ],
        message: error instanceof Error ? error.message : String(error),
        summary: { created: 0, issueCount: 1, skipped: 0, total: 0 },
        scheduleId: evaluationRecordLegacyId({
          ...schedule,
          recordType: "evaluation-cycle-schedule",
        }),
        templateId: template
          ? evaluationRecordLegacyId({
              ...template,
              recordType: "evaluation-cycle-type-template",
            })
          : text(scheduleContent.cycleTypeTemplateId),
        templateName:
          template?.name ||
          template?.code ||
          text(scheduleContent.cycleTypeName),
      });
    }
  }
  return {
    message: results.length
      ? results.map((result) => result.message).join("\n")
      : "Không có lịch sinh kỳ tự động nào đến lịch chạy.",
    results,
    scheduleCount: enabled.length,
    today,
  };
}

export async function runEvaluationAutomationNow(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  return runEvaluationAutomation({
    actor,
    force: true,
    scheduleId: text(payload.scheduleId),
    templateId: text(payload.templateId),
    today: text(payload.today) || undefined,
  });
}

export async function deleteEvaluationInstance(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const id = text(payload.instanceId);
  const db = getDb();
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    id,
  );
  if (!instance) throw new EvaluationRuntimeError("Không tìm thấy phiếu.");
  const content = asRecord(instance.content);
  const now = new Date().toISOString();
  const relatedParentIds = Array.from(
    new Set([instance.id, instanceLegacyId(content)].filter(Boolean)),
  );
  const relatedRecords = await db.evaluationRecord.findMany({
    where: {
      parentId: { in: relatedParentIds },
      recordType: {
        in: [
          "evaluation-criteria-score",
          "evaluation-decision-value",
          "evaluation-final-result",
          "evaluation-mail-delivery",
        ],
      },
    },
  });
  await db.$transaction(async (tx) => {
    await tx.evaluationRecord.update({
      data: {
        content: {
          ...content,
          deleteReason: text(payload.reason) || "Admin loại khỏi kỳ",
          deletedAt: now,
          deletedBy: actor.displayName,
          isActive: false,
          status: "inactive",
        } as Prisma.InputJsonValue,
        note: text(payload.reason) || "Admin loại khỏi kỳ",
        status: "inactive",
        updatedByName: actor.displayName,
      },
      where: { id: instance.id },
    });
    for (const related of relatedRecords) {
      await tx.evaluationRecord.update({
        data: {
          content: {
            ...asRecord(related.content),
            deletedAt: now,
            deletedBy: actor.displayName,
            isActive: false,
            status: "inactive",
          } as Prisma.InputJsonValue,
          status: "inactive",
          updatedByName: actor.displayName,
        },
        where: { id: related.id },
      });
    }
  });
  return { message: "Đã loại phiếu khỏi kỳ đánh giá." };
}

const LEGACY_EVALUATION_COLLECTIONS: Record<string, string> = {
  "evaluation-position-level": "levels",
  "evaluation-source": "evaluationSources",
  "evaluation-source-item": "evaluationSourceItems",
  "evaluation-score-group": "scoreGroups",
  "evaluation-work-group-definition": "workGroupDefinitions",
  "evaluation-criteria": "criteria",
  "evaluation-criteria-set": "criteriaSets",
  "evaluation-criteria-set-item": "criteriaSetItems",
  "evaluation-workflow-template": "workflowTemplates",
  "evaluation-workflow-step": "workflowSteps",
  "evaluation-decision-template": "decisionTemplates",
  "evaluation-decision-option": "decisionOptions",
  "evaluation-decision-field": "decisionFields",
  "evaluation-cycle-type-template": "cycleTypeTemplates",
  "evaluation-cycle-schedule": "cycleSchedules",
  "evaluation-cycle-type-score-group": "cycleTypeScoreGroups",
  "evaluation-jd-folder": "jdFolders",
  "evaluation-jd-document": "jdDocuments",
  "evaluation-jd-version": "jdVersions",
  "evaluation-jd-work-group": "jdWorkGroups",
  "evaluation-jd-activity": "jdActivities",
  "evaluation-jd-activity-rule": "jdActivityRules",
  "evaluation-jd-classification-job": "jdClassificationJobs",
  "evaluation-cycle": "cycles",
  "evaluation-cycle-member": "members",
  "evaluation-instance": "instances",
  "evaluation-criteria-score": "criteriaScores",
  "evaluation-decision-value": "decisionValues",
  "evaluation-generation-job": "generationJobs",
  "evaluation-final-result": "finalResults",
  "evaluation-mail-sender-profile": "mailSenderProfileRecords",
  "evaluation-mail-template": "mailTemplates",
};

const LEGACY_EVALUATION_ENTITY_TYPES: Record<
  string,
  {
    code: string[];
    name: string[];
    parent?: string[];
    recordType: string;
  }
> = {
  positionLevel: {
    code: ["levelCode", "code"],
    name: ["levelName", "name"],
    recordType: "evaluation-position-level",
  },
  evaluationSource: {
    code: ["code", "sourceCode"],
    name: ["name", "sourceName"],
    recordType: "evaluation-source",
  },
  evaluationSourceItem: {
    code: ["code", "sourceItemCode"],
    name: ["name", "sourceItemName"],
    parent: ["evaluationSourceId", "sourceId"],
    recordType: "evaluation-source-item",
  },
  scoreGroup: {
    code: ["code", "scoreGroupCode"],
    name: ["name", "scoreGroupName"],
    recordType: "evaluation-score-group",
  },
  workGroupDefinition: {
    code: ["code", "workGroupCode"],
    name: ["name", "workGroupName"],
    recordType: "evaluation-work-group-definition",
  },
  criteria: {
    code: ["code", "criteriaCode"],
    name: ["name", "criteriaName"],
    recordType: "evaluation-criteria",
  },
  criteriaSet: {
    code: ["code", "criteriaSetCode"],
    name: ["name", "criteriaSetName"],
    recordType: "evaluation-criteria-set",
  },
  criteriaSetItem: {
    code: ["code", "criteriaCode"],
    name: ["name", "criteriaName"],
    parent: ["criteriaSetId"],
    recordType: "evaluation-criteria-set-item",
  },
  workflowTemplate: {
    code: ["code", "workflowCode"],
    name: ["name", "workflowName"],
    recordType: "evaluation-workflow-template",
  },
  workflowStep: {
    code: ["code", "stepCode"],
    name: ["name", "role"],
    parent: ["workflowTemplateId"],
    recordType: "evaluation-workflow-step",
  },
  decisionTemplate: {
    code: ["code", "decisionCode"],
    name: ["name", "decisionName"],
    recordType: "evaluation-decision-template",
  },
  decisionOption: {
    code: ["code", "optionCode"],
    name: ["label", "name"],
    parent: ["decisionTemplateId"],
    recordType: "evaluation-decision-option",
  },
  decisionField: {
    code: ["code", "fieldCode"],
    name: ["label", "fieldLabel", "name"],
    parent: ["cycleTypeTemplateId"],
    recordType: "evaluation-decision-field",
  },
  cycleTypeTemplate: {
    code: ["code", "cycleTypeCode"],
    name: ["name", "cycleTypeName"],
    recordType: "evaluation-cycle-type-template",
  },
  cycleSchedule: {
    code: ["code", "scheduleCode"],
    name: ["name", "scheduleName", "cycleTypeName"],
    recordType: "evaluation-cycle-schedule",
  },
  cycleTypeScoreGroup: {
    code: ["code", "criteriaSetCode"],
    name: ["name", "criteriaSetName"],
    parent: ["cycleTypeTemplateId"],
    recordType: "evaluation-cycle-type-score-group",
  },
  jdFolder: {
    code: ["code", "folderId"],
    name: ["name", "folderName"],
    recordType: "evaluation-jd-folder",
  },
  jdDocument: {
    code: ["code", "providerFileId", "fileId"],
    name: ["fileName", "name", "docTitle"],
    recordType: "evaluation-jd-document",
  },
  jdVersion: {
    code: ["code", "snapshotHash"],
    name: ["fileName", "name"],
    parent: ["documentId", "jdDocumentId"],
    recordType: "evaluation-jd-version",
  },
  jdWorkGroup: {
    code: ["code", "workGroupCode"],
    name: ["name", "groupName", "workGroupName"],
    parent: ["documentId", "jdDocumentId"],
    recordType: "evaluation-jd-work-group",
  },
  jdActivity: {
    code: ["code", "activityCode"],
    name: ["name", "activityText"],
    parent: ["workGroupId"],
    recordType: "evaluation-jd-activity",
  },
  jdActivityRule: {
    code: ["code", "ruleCode"],
    name: ["name", "activityTypeName"],
    parent: ["documentId", "jdDocumentId"],
    recordType: "evaluation-jd-activity-rule",
  },
  jdClassificationJob: {
    code: ["code", "jobCode"],
    name: ["name", "jobName", "documentTitle"],
    parent: ["documentId", "jdDocumentId"],
    recordType: "evaluation-jd-classification-job",
  },
  cycle: {
    code: ["code", "cycleCode"],
    name: ["name", "cycleName"],
    recordType: "evaluation-cycle",
  },
  member: {
    code: ["code", "memberCode", "employeeCode"],
    name: ["employeeName", "name"],
    parent: ["cycleId", "evaluationCycleId"],
    recordType: "evaluation-cycle-member",
  },
  instance: {
    code: ["code", "instanceCode", "employeeCode"],
    name: ["employeeName", "name"],
    parent: ["cycleId", "evaluationCycleId"],
    recordType: "evaluation-instance",
  },
  criteriaScore: {
    code: ["code", "scoreCode", "criteriaCode"],
    name: ["criteriaName", "name"],
    parent: ["instanceId", "evaluationInstanceId"],
    recordType: "evaluation-criteria-score",
  },
  decisionValue: {
    code: ["code", "valueCode", "fieldCode"],
    name: ["fieldLabel", "label", "name"],
    parent: ["instanceId", "evaluationInstanceId"],
    recordType: "evaluation-decision-value",
  },
  generationJob: {
    code: ["code", "jobCode"],
    name: ["name", "jobName"],
    parent: ["cycleId"],
    recordType: "evaluation-generation-job",
  },
  finalResult: {
    code: ["code", "resultCode", "instanceId"],
    name: ["name", "employeeName"],
    parent: ["instanceId", "evaluationInstanceId"],
    recordType: "evaluation-final-result",
  },
  evaluationMailTemplate: {
    code: ["code", "templateCode", "eventCode"],
    name: ["name", "templateName", "eventName"],
    recordType: "evaluation-mail-template",
  },
  evaluationMailSenderProfile: {
    code: ["moduleKey", "code"],
    name: ["senderName", "name"],
    recordType: "evaluation-mail-sender-profile",
  },
};

function firstRecordText(record: JsonRecord, keys: string[]) {
  for (const key of keys) {
    const value = text(record[key]);
    if (value) return value;
  }
  return "";
}

function legacyEvaluationRecord(
  record: {
    id: string;
    parentId: string | null;
    code: string | null;
    name: string | null;
    status: string;
    content: unknown;
    text: string | null;
    note: string | null;
    recordType: string;
    createdAt: Date;
    updatedAt: Date;
  },
  legacyIdByDatabaseId: Map<string, string>,
) {
  const content = mapEvaluationLegacyReferences(
    asRecord(record.content),
    legacyIdByDatabaseId,
  ) as JsonRecord;
  return {
    ...content,
    code: record.code || text(content.code),
    createdAt: record.createdAt.toISOString(),
    databaseId: record.id,
    id: evaluationRecordLegacyId(record),
    name: record.name || text(content.name),
    note: record.note || "",
    parentId:
      legacyIdByDatabaseId.get(text(record.parentId)) || record.parentId || "",
    recordType: record.recordType,
    status: record.status,
    text: record.text || "",
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function getLegacyEvaluationData(session: AppSession) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const db = getDb();
  const [records, employeeRows, formTemplates] = await Promise.all([
    db.evaluationRecord.findMany({
      orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
      take: 15_000,
      where: { recordType: { startsWith: "evaluation-" } },
    }),
    db.employee.findMany({
      orderBy: { fullName: "asc" },
      select: {
        archivedAt: true,
        department: true,
        email: true,
        employeeCode: true,
        fullName: true,
        id: true,
        status: true,
        terminationDate: true,
        title: true,
      },
      take: 2_000,
      where: { archivedAt: null, status: "ACTIVE" },
    }),
    db.configurationRecord.findMany({
      orderBy: [{ sourceRow: "asc" }, { name: "asc" }],
      take: 500,
      where: {
        OR: [{ status: null }, { status: { notIn: ["inactive", "archived"] } }],
        recordType: "template",
      },
    }),
  ]);
  const employees = employeeRows.filter(
    (employee) => evaluationEmployeeEmploymentState(employee).eligible,
  );
  const data: Record<string, unknown[]> = {};
  const legacyIdByDatabaseId = buildEvaluationLegacyIdMap(records);
  const employeeDirectory = new Map(
    employeeRows.map((employee) => [
      employee.employeeCode.toLowerCase(),
      employee,
    ]),
  );
  const directoryTitles = employees
    .map((employee) => employee.title)
    .filter(Boolean);
  for (const collection of new Set(
    Object.values(LEGACY_EVALUATION_COLLECTIONS),
  )) {
    data[collection] = [];
  }
  for (const record of records) {
    const collection = LEGACY_EVALUATION_COLLECTIONS[record.recordType];
    if (!collection) continue;
    let resolvedRecord = record;
    if (record.recordType === "evaluation-cycle-member") {
      resolvedRecord = {
        ...record,
        content: enrichEvaluationMemberContent(
          asRecord(record.content),
          employeeDirectory,
        ),
      };
    } else if (record.recordType === "evaluation-jd-document") {
      const content = asRecord(record.content);
      const storedTitles = [
        content.mappedJobTitleName,
        content.personnelJobTitleName,
        content.jobTitleName,
        content.displayTitle,
        record.name,
      ];
      const canonicalTitle = canonicalEvaluationJdTitle(
        {
          fileName: content.fileName,
          recordName: record.name,
          storedTitles,
        },
        directoryTitles,
      );
      const directoryTitle = matchEvaluationJdDirectoryTitle(
        { fileName: content.fileName, storedTitles },
        directoryTitles,
      );
      resolvedRecord = {
        ...record,
        content: {
          ...content,
          displayTitle: canonicalTitle,
          jobTitleName: canonicalTitle,
          mappedJobTitleName: text(
            content.mappedJobTitleName ||
              content.personnelJobTitleName ||
              directoryTitle,
          )
            ? canonicalTitle
            : "",
          personnelJobTitleName:
            directoryTitle || text(content.personnelJobTitleName),
        },
      };
    }
    data[collection].push(
      legacyEvaluationRecord(resolvedRecord, legacyIdByDatabaseId),
    );
  }
  data.employees = employees.map((employee) => ({
    department: employee.department || "",
    employeeCode: employee.employeeCode,
    employeeId: employee.id,
    fullName: employee.fullName,
    name: employee.fullName,
    title: employee.title || "",
  }));
  data.formTemplates = formTemplates.map((template) => {
    const content = asRecord(template.content);
    return {
      code: template.code || "",
      id: template.id,
      name:
        template.name ||
        text(content.templateName || content.name || content["Tên biểu mẫu"]),
      sourceFileName: text(
        content.sourceFileName ||
          content.fileName ||
          content["Tên file làm việc"] ||
          content["Tên file nguồn"],
      ),
      sourceUrl: text(
        content.sourceUrl ||
          content.sourceFileUrl ||
          content["File làm việc URL"] ||
          content["File gốc URL"] ||
          content["Link biểu mẫu"],
      ),
      status: template.status || "active",
    };
  });
  const senderProfileRecords = records.filter(
    (record) =>
      record.recordType === "evaluation-mail-sender-profile" &&
      !["archived", "deleted", "inactive"].includes(
        record.status.toLowerCase(),
      ),
  );
  data.mailSenderProfiles = listModuleMailRoutes(["evaluation-config"]).map(
    (route) => {
      const configured = senderProfileRecords.find((record) => {
        const content = asRecord(record.content);
        return (
          text(content.moduleKey).toLowerCase() === route.moduleKey ||
          text(content.senderEmail).toLowerCase() === route.senderEmail
        );
      });
      const configuredContent = asRecord(configured?.content);
      return {
        databaseId: configured?.id || "",
        id: route.moduleKey,
        isDefault: !configured,
        moduleKey: route.moduleKey,
        provider: route.provider,
        senderEmail: route.senderEmail,
        senderName: text(configuredContent.senderName) || route.senderName,
        status: "active",
      };
    },
  );
  return {
    data,
    readOnly: false,
    source: "postgresql",
    stats: {
      evaluationInstances: data.instances.length,
      jdDocuments: data.jdDocuments.length,
      publishedCriteriaSets: data.criteriaSets.filter(
        (item) => text(asRecord(item).status) === "published",
      ).length,
      publishedCycleTemplates: data.cycleTypeTemplates.filter(
        (item) => text(asRecord(item).status) === "published",
      ).length,
    },
  };
}

async function saveLegacyEvaluationEntityWithActor(
  db: EvaluationWriteClient,
  actor: OperationActor,
  payload: JsonRecord,
) {
  const entityType = text(payload.entityType);
  const meta = LEGACY_EVALUATION_ENTITY_TYPES[entityType];
  if (!meta) {
    throw new EvaluationRuntimeError(
      `Loại cấu hình đánh giá "${entityType}" chưa được hỗ trợ.`,
    );
  }
  const record = asRecord(payload.record);
  const code =
    firstRecordText(record, meta.code) ||
    uniqueCode(meta.recordType.replace("evaluation-", "").slice(0, 8));
  const name =
    firstRecordText(record, meta.name) ||
    firstRecordText(record, meta.code) ||
    entityType;
  const explicitIdentifier = text(record.databaseId || record.id);
  const current = explicitIdentifier
    ? await findEvaluationRecordByIdentifier(
        meta.recordType,
        explicitIdentifier,
        db,
      )
    : null;
  const legacyContent = { ...record };
  delete legacyContent.databaseId;
  const saved = await saveEvaluationConfigRecordWithActor(db, actor, {
    code,
    content: { ...legacyContent, code, name, recordType: meta.recordType },
    id: current?.id || "",
    name,
    note: text(record.note || record.description),
    parentId: meta.parent ? firstRecordText(record, meta.parent) : "",
    recordType: meta.recordType,
    status:
      text(record.status).toLowerCase() ||
      (record.isActive === false ? "inactive" : "active"),
  });
  return {
    message: `Đã lưu ${name}.`,
    record: {
      ...saved.record,
      ...asRecord(saved.record.content),
      databaseId: saved.record.id,
      id:
        text(asRecord(saved.record.content).id) ||
        evaluationRecordLegacyId({
          ...saved.record,
          recordType: meta.recordType,
        }),
    },
  };
}

async function saveLegacyEvaluationEntity(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  return saveLegacyEvaluationEntityWithActor(getDb(), actor, payload);
}

async function saveLegacyEvaluationEntities(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const entries = Array.isArray(payload.records)
    ? payload.records.map(asRecord)
    : [];
  const saved = await getDb().$transaction(async (tx) => {
    const records = [];
    for (const entry of entries) {
      const nestedRecord = asRecord(entry.record);
      const record = Object.keys(nestedRecord).length ? nestedRecord : entry;
      const entityType = text(entry.entityType) || text(payload.entityType);
      records.push(
        (
          await saveLegacyEvaluationEntityWithActor(tx, actor, {
            entityType,
            record,
          })
        ).record,
      );
    }
    return records;
  });
  return { message: `Đã lưu ${saved.length} bản ghi.`, records: saved };
}

async function reorderEvaluationScoreGroups(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const requestedIds = stringList(payload.scoreGroupIds);
  if (!requestedIds.length) {
    throw new EvaluationRuntimeError(
      "Danh sách thứ tự nhóm đánh giá đang trống.",
    );
  }
  const db = getDb();
  const [groups, sections, scores] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-score-group" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-cycle-type-score-group" },
    }),
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-criteria-score" },
    }),
  ]);
  const activeGroups = groups.filter(isActiveEvaluationRecord);
  const orderedGroups = requestedIds
    .map((id) =>
      activeGroups.find((group) =>
        evaluationRecordIdentifiers(group).includes(id),
      ),
    )
    .filter((group): group is (typeof activeGroups)[number] => Boolean(group));
  if (orderedGroups.length !== activeGroups.length) {
    throw new EvaluationRuntimeError(
      "Danh sách nhóm đánh giá đã thay đổi. Vui lòng tải lại rồi sắp xếp lần nữa.",
      409,
    );
  }
  const normalizeGroupName = (value: unknown) =>
    text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase();
  const groupReferences = (group: (typeof orderedGroups)[number]) => {
    const content = asRecord(group.content);
    return [
      group.id,
      group.code,
      group.name,
      content.id,
      content.code,
      content.scoreGroupCode,
      content.name,
      content.scoreGroupName,
    ]
      .map((value) => text(value).toLowerCase())
      .filter(Boolean);
  };
  const groupSectionName = (group: (typeof orderedGroups)[number]) => {
    const content = asRecord(group.content);
    const name = text(content.scoreGroupName || group.name);
    const normalized = normalizeGroupName(name);
    if (
      normalized.includes("chuyen mon") ||
      normalized.includes("ket qua cong viec") ||
      (normalized.includes("cong viec") && !normalized.includes("van hoa"))
    ) {
      return "Chuyên môn";
    }
    if (normalized.includes("van hoa")) return "Văn hóa";
    return name.replace(/^Đánh giá\s+/iu, "") || "Nội dung đánh giá";
  };
  const linkedGroup = (content: JsonRecord) => {
    const references = [
      content.scoreGroupId,
      content.scoreGroupCode,
      content.scoreGroupName,
      content.sectionName,
    ]
      .map((value) => text(value).toLowerCase())
      .filter(Boolean);
    return orderedGroups.find((group) =>
      references.some((reference) =>
        groupReferences(group).includes(reference),
      ),
    );
  };
  const professionalGroup =
    orderedGroups.find((group) => {
      const normalized = normalizeGroupName(
        asRecord(group.content).scoreGroupName || group.name,
      );
      return (
        normalized.includes("chuyen mon") ||
        normalized.includes("ket qua cong viec") ||
        (normalized.includes("cong viec") && !normalized.includes("van hoa"))
      );
    }) || orderedGroups[0];
  const orderedIndex = new Map(
    orderedGroups.map((group, index) => [group.id, (index + 1) * 10]),
  );
  const now = new Date().toISOString();
  await db.$transaction(
    async (tx) => {
      for (const group of orderedGroups) {
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...asRecord(group.content),
              sortOrder: orderedIndex.get(group.id),
              updatedAt: now,
              updatedBy: actor.displayName,
            } as Prisma.InputJsonValue,
            updatedByName: actor.displayName,
          },
          where: { id: group.id },
        });
      }
      for (const section of sections.filter(isActiveEvaluationRecord)) {
        const content = asRecord(section.content);
        const group =
          linkedGroup(content) ||
          (text(content.contentMode).toLowerCase() === "jd_dynamic"
            ? professionalGroup
            : undefined);
        if (!group) continue;
        const groupContent = asRecord(group.content);
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...content,
              scoreGroupCode: text(groupContent.scoreGroupCode || group.code),
              scoreGroupId: group.id,
              scoreGroupName: text(groupContent.scoreGroupName || group.name),
              sectionName: groupSectionName(group),
              sortOrder: orderedIndex.get(group.id),
              updatedAt: now,
              updatedBy: actor.displayName,
            } as Prisma.InputJsonValue,
            updatedByName: actor.displayName,
          },
          where: { id: section.id },
        });
      }
      for (const score of scores.filter(isActiveEvaluationRecord)) {
        const content = asRecord(score.content);
        const group =
          linkedGroup(content) ||
          (text(content.contentMode).toLowerCase() === "jd_dynamic"
            ? professionalGroup
            : undefined);
        if (!group) continue;
        const groupContent = asRecord(group.content);
        await tx.evaluationRecord.update({
          data: {
            content: {
              ...content,
              scoreGroupCode: text(groupContent.scoreGroupCode || group.code),
              scoreGroupId: group.id,
              scoreGroupName: text(groupContent.scoreGroupName || group.name),
              sectionName: groupSectionName(group),
              sectionSortOrder: orderedIndex.get(group.id),
            } as Prisma.InputJsonValue,
            updatedByName: actor.displayName,
          },
          where: { id: score.id },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: actor.userId,
          metadata: { scoreGroupIds: orderedGroups.map((group) => group.id) },
          summary: "Sắp xếp lại thứ tự khối đánh giá C&B.",
          targetId: orderedGroups[0]?.id || null,
          targetType: "EvaluationScoreGroupOrder",
        },
      });
    },
    { maxWait: 10_000, timeout: 60_000 },
  );
  return {
    message: "Đã cập nhật thứ tự nhóm và đồng bộ các phiếu đánh giá.",
    order: orderedGroups.map((group) => ({
      id: group.id,
      name: group.name,
      sortOrder: orderedIndex.get(group.id),
    })),
  };
}

const EVALUATION_CASCADE_CHILDREN: Record<string, string[]> = {
  "evaluation-criteria-set": ["evaluation-criteria-set-item"],
  "evaluation-cycle": [
    "evaluation-cycle-member",
    "evaluation-generation-job",
    "evaluation-instance",
  ],
  "evaluation-cycle-type-template": [
    "evaluation-cycle-schedule",
    "evaluation-cycle-type-score-group",
    "evaluation-decision-field",
  ],
  "evaluation-decision-template": ["evaluation-decision-option"],
  "evaluation-instance": [
    "evaluation-criteria-score",
    "evaluation-decision-value",
    "evaluation-final-result",
    "evaluation-mail-delivery",
  ],
  "evaluation-jd-document": [
    "evaluation-jd-activity-rule",
    "evaluation-jd-classification-job",
    "evaluation-jd-version",
    "evaluation-jd-work-group",
  ],
  "evaluation-jd-work-group": ["evaluation-jd-activity"],
  "evaluation-workflow-template": ["evaluation-workflow-step"],
};

const EVALUATION_PARENT_REFERENCE_KEYS: Record<string, string[]> = {
  "evaluation-criteria-set-item": ["criteriaSetId"],
  "evaluation-cycle-member": ["cycleId", "evaluationCycleId"],
  "evaluation-cycle-schedule": ["cycleTypeTemplateId", "cycleTypeCode"],
  "evaluation-cycle-type-score-group": ["cycleTypeTemplateId"],
  "evaluation-criteria-score": ["instanceId", "evaluationInstanceId"],
  "evaluation-decision-field": ["cycleTypeTemplateId"],
  "evaluation-decision-option": ["decisionTemplateId"],
  "evaluation-decision-value": ["instanceId", "evaluationInstanceId"],
  "evaluation-final-result": ["instanceId", "evaluationInstanceId"],
  "evaluation-mail-delivery": ["instanceId"],
  "evaluation-generation-job": ["cycleId", "scheduleId"],
  "evaluation-instance": ["cycleId", "evaluationCycleId"],
  "evaluation-jd-activity": ["workGroupId", "jdWorkGroupId"],
  "evaluation-jd-activity-rule": ["documentId", "jdDocumentId"],
  "evaluation-jd-classification-job": ["documentId", "jdDocumentId"],
  "evaluation-jd-version": ["documentId", "jdDocumentId"],
  "evaluation-jd-work-group": ["documentId", "jdDocumentId"],
  "evaluation-workflow-step": ["workflowTemplateId"],
};

function evaluationChildBelongsToParent(
  child: {
    content: unknown;
    parentId: string | null;
    recordType: string;
  },
  parentIdentifiers: Set<string>,
) {
  if (parentIdentifiers.has(text(child.parentId))) return true;
  const content = asRecord(child.content);
  return (EVALUATION_PARENT_REFERENCE_KEYS[child.recordType] || []).some(
    (key) => parentIdentifiers.has(text(content[key])),
  );
}

async function evaluationCascadeRecords(
  db: Pick<ReturnType<typeof getDb>, "evaluationRecord">,
  root: NonNullable<
    Awaited<ReturnType<typeof findEvaluationRecordByIdentifier>>
  >,
) {
  const all = await db.evaluationRecord.findMany({
    where: { recordType: { startsWith: "evaluation-" } },
  });
  const selected = new Map([[root.id, root]]);
  const queue = [root];
  while (queue.length) {
    const parent = queue.shift()!;
    const childTypes = EVALUATION_CASCADE_CHILDREN[parent.recordType] || [];
    if (!childTypes.length) continue;
    const identifiers = new Set(evaluationRecordIdentifiers(parent));
    for (const child of all) {
      if (
        selected.has(child.id) ||
        !childTypes.includes(child.recordType) ||
        !evaluationChildBelongsToParent(child, identifiers)
      ) {
        continue;
      }
      selected.set(child.id, child);
      queue.push(child);
    }
  }
  return Array.from(selected.values());
}

async function remapEvaluationWorkGroupBeforeDelete(
  db: ReturnType<typeof getDb>,
  current: NonNullable<
    Awaited<ReturnType<typeof findEvaluationRecordByIdentifier>>
  >,
  payload: JsonRecord,
  actor: OperationActor,
) {
  if (current.recordType !== "evaluation-work-group-definition") return 0;
  const definitions = await db.evaluationRecord.findMany({
    where: {
      recordType: "evaluation-work-group-definition",
      status: { not: "inactive" },
    },
  });
  const requestedReplacement = text(payload.replacementId);
  if (
    booleanValue(asRecord(current.content).isDefault) &&
    !requestedReplacement
  ) {
    throw new EvaluationRuntimeError(
      "Không thể xóa Nhóm công việc mặc định. Hãy chọn một nhóm thay thế trước.",
      409,
    );
  }
  const replacement = requestedReplacement
    ? await findEvaluationRecordByIdentifier(
        "evaluation-work-group-definition",
        requestedReplacement,
      )
    : definitions.find((definition) => {
        const content = asRecord(definition.content);
        return (
          definition.id !== current.id &&
          (booleanValue(content.isDefault) ||
            definition.code === "WG_EXECUTION")
        );
      });
  const currentIdentifiers = new Set(evaluationRecordIdentifiers(current));
  const activities = (
    await db.evaluationRecord.findMany({
      where: {
        recordType: "evaluation-jd-activity",
        status: { not: "inactive" },
      },
    })
  ).filter((activity) => {
    const content = asRecord(activity.content);
    return [
      content.evaluationWorkGroupId,
      content.evaluationWorkGroupCode,
      content.workGroupDefinitionId,
    ]
      .map(text)
      .some((identifier) => currentIdentifiers.has(identifier));
  });
  if (!activities.length) return 0;
  if (!replacement || replacement.id === current.id) {
    throw new EvaluationRuntimeError(
      "Nhóm công việc đang được sử dụng. Hãy chọn nhóm thay thế trước khi xóa.",
      409,
    );
  }
  const replacementContent = asRecord(replacement.content);
  const replacementId = evaluationRecordLegacyId(replacement);
  await db.$transaction(
    activities.map((activity) =>
      db.evaluationRecord.update({
        data: {
          content: {
            ...asRecord(activity.content),
            evaluationWorkGroupCode:
              replacement.code || text(replacementContent.workGroupCode),
            evaluationWorkGroupId: replacementId,
            evaluationWorkGroupName:
              replacement.name || text(replacementContent.workGroupName),
            remappedAt: new Date().toISOString(),
            remappedBy: actor.displayName,
          } as Prisma.InputJsonValue,
          updatedByName: actor.displayName,
        },
        where: { id: activity.id },
      }),
    ),
  );
  return activities.length;
}

async function deleteLegacyEvaluationEntity(
  session: AppSession,
  payload: JsonRecord,
) {
  const entityType = text(payload.entityType);
  if (entityType === "instance") {
    return deleteEvaluationInstance(session, {
      instanceId: payload.databaseId || payload.id || payload.entityId,
      reason: payload.reason,
    });
  }
  const meta = LEGACY_EVALUATION_ENTITY_TYPES[entityType];
  if (!meta) {
    throw new EvaluationRuntimeError(
      `Loại cấu hình đánh giá "${entityType}" chưa được hỗ trợ.`,
    );
  }
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const id = text(payload.databaseId || payload.id || payload.entityId);
  const current = await findEvaluationRecordByIdentifier(meta.recordType, id);
  if (!current)
    throw new EvaluationRuntimeError("Không tìm thấy cấu hình.", 404);
  const db = getDb();
  if (current.recordType === "evaluation-mail-template") {
    const roleTemplates = evaluationMailRoleTemplates(current.content, {
      activeOnly: false,
    });
    await db.$transaction(async (tx) => {
      await tx.evaluationRecord.delete({ where: { id: current.id } });
      await tx.auditLog.create({
        data: {
          action: "DELETE",
          actorId: actor.userId,
          metadata: {
            code: current.code,
            eventCode: text(asRecord(current.content).eventCode),
            hardDeleted: true,
            recordType: current.recordType,
            roleTemplateCount: roleTemplates.length,
          },
          summary: `Xóa vĩnh viễn mẫu mail ${current.name || current.code || current.id} khỏi PostgreSQL.`,
          targetId: current.id,
          targetType: "EvaluationRecord",
        },
      });
    });
    return {
      deletedId: current.id,
      hardDeleted: true,
      message: `Đã xóa vĩnh viễn mẫu mail ${current.name || current.code || "đánh giá"} khỏi PostgreSQL.`,
      roleTemplateCount: roleTemplates.length,
    };
  }
  const remapped = await remapEvaluationWorkGroupBeforeDelete(
    db,
    current,
    payload,
    actor,
  );
  const cascade = await evaluationCascadeRecords(db, current);
  const now = new Date().toISOString();
  await db.$transaction(async (tx) => {
    for (const record of cascade) {
      await tx.evaluationRecord.update({
        data: {
          content: {
            ...asRecord(record.content),
            deletedAt: now,
            deletedBy: actor.displayName,
            isActive: false,
            status: "inactive",
          } as Prisma.InputJsonValue,
          status: "inactive",
          updatedByName: actor.displayName,
        },
        where: { id: record.id },
      });
    }
    await tx.auditLog.create({
      data: {
        action: "ARCHIVE",
        actorId: actor.userId,
        metadata: {
          cascadeCount: Math.max(0, cascade.length - 1),
          recordType: current.recordType,
          remapped,
        },
        summary: `Ngừng dùng ${current.name || current.code} và ${Math.max(0, cascade.length - 1)} bản ghi liên quan.`,
        targetId: current.id,
        targetType: "EvaluationRecord",
      },
    });
  });
  return {
    cascadeCount: Math.max(0, cascade.length - 1),
    message: `Đã ngưng dùng ${current.name || current.code}${cascade.length > 1 ? ` cùng ${cascade.length - 1} bản ghi liên quan` : ""}${remapped ? `; đã chuyển ${remapped} đầu việc sang nhóm mặc định` : ""}.`,
    remapped,
  };
}

async function saveLegacyCycleMembers(
  session: AppSession,
  payload: JsonRecord,
) {
  const members = Array.isArray(payload.members)
    ? payload.members.map(asRecord)
    : [];
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const db = getDb();
  const requestedCycleId =
    text(payload.cycleId) ||
    text(members[0]?.cycleId || members[0]?.evaluationCycleId);
  const cycle = await findEvaluationRecordByIdentifier(
    "evaluation-cycle",
    requestedCycleId,
    db,
  );
  if (!cycle) {
    throw new EvaluationRuntimeError("Không tìm thấy kỳ đánh giá để phân bổ.");
  }
  const cycleId = evaluationRecordLegacyId(cycle);
  const cycleReferences = new Set(evaluationRecordIdentifiers(cycle));
  const [directory, existingMembers, jdDocuments] = await Promise.all([
    loadEvaluationEmployeeDirectory(members),
    db.evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: { recordType: "evaluation-cycle-member" },
    }),
    db.evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: { recordType: "evaluation-jd-document" },
    }),
  ]);
  const saved = [];
  for (const member of members) {
    const employeeCode = text(member.employeeCode || member.employeeId);
    if (!employeeCode) {
      throw new EvaluationRuntimeError("Vui lòng chọn nhân sự cần đánh giá.");
    }
    const employment = evaluationEmployeeEmploymentState(
      directory.get(employeeCode.toLowerCase()),
    );
    if (!employment.eligible && member.isActive !== false) {
      throw new EvaluationRuntimeError(
        `Không thể thêm ${employeeCode} vào kỳ: ${employment.reason}.`,
        409,
      );
    }
    const explicitIdentifier = text(member.databaseId || member.id);
    const current = explicitIdentifier
      ? await findEvaluationRecordByIdentifier(
          "evaluation-cycle-member",
          explicitIdentifier,
          db,
        )
      : existingMembers.find((candidate) => {
          const content = asRecord(candidate.content);
          return (
            text(content.employeeCode || content.employeeId).toLowerCase() ===
              employeeCode.toLowerCase() &&
            [candidate.parentId, content.cycleId, content.evaluationCycleId]
              .map(text)
              .some((value) => cycleReferences.has(value))
          );
        });
    const currentContent = asRecord(current?.content);
    const indirectManagerCodes = stringList(
      member.indirectManagerEmployeeCodes,
    ).length
      ? stringList(member.indirectManagerEmployeeCodes)
      : [text(member.indirectManagerEmployeeCode)].filter(Boolean);
    const departmentHeadEmployeeCode = text(
      member.departmentHeadEmployeeCode,
    );
    if (
      departmentHeadEmployeeCode &&
      !indirectManagerCodes.some(
        (code) =>
          code.toLowerCase() === departmentHeadEmployeeCode.toLowerCase(),
      )
    ) {
      throw new EvaluationRuntimeError(
        "Trưởng BP/PB phải nằm trong danh sách Quản lý gián tiếp.",
      );
    }
    const hasManualJdUpdate = [
      "jdDocumentId",
      "jdSelectionMode",
      "manualJdDocumentId",
    ].some((key) => Object.prototype.hasOwnProperty.call(member, key));
    const requestedManualJdId = text(
      member.manualJdDocumentId || member.jdDocumentId,
    );
    let manualJdPatch: JsonRecord = {};
    if (hasManualJdUpdate) {
      if (
        text(member.jdSelectionMode).toLowerCase() === "auto" ||
        !requestedManualJdId
      ) {
        manualJdPatch = {
          jdDocumentId: "",
          jdSelectionMode: "automatic",
          manualJdDocumentDatabaseId: "",
          manualJdDocumentId: "",
          manualJdSelectedAt: new Date().toISOString(),
          manualJdSelectedBy: actor.displayName,
          manualJdTitle: "",
        };
      } else {
        const selectedDocument = jdDocuments.find((document) => {
          const content = asRecord(document.content);
          return (
            isActiveEvaluationRecord(document) &&
            !text(content.duplicateOfDocumentId) &&
            evaluationRecordIdentifiers(document).includes(requestedManualJdId)
          );
        });
        if (!selectedDocument) {
          throw new EvaluationRuntimeError(
            "JD đã chọn không còn khả dụng. Vui lòng tải lại danh sách JD.",
            409,
          );
        }
        const selectedDocumentId = evaluationRecordLegacyId(selectedDocument);
        manualJdPatch = {
          jdDocumentId: selectedDocumentId,
          jdSelectionMode: "manual",
          manualJdDocumentDatabaseId: selectedDocument.id,
          manualJdDocumentId: selectedDocumentId,
          manualJdSelectedAt: new Date().toISOString(),
          manualJdSelectedBy: actor.displayName,
          manualJdTitle: getEvaluationJdTitle(selectedDocument),
        };
      }
    }
    const enriched = enrichEvaluationMemberContent(
      {
        ...currentContent,
        ...member,
        ...manualJdPatch,
        cycleId,
        employeeCode,
        employeeId: employeeCode,
        evaluationCycleId: cycleId,
        allocationManuallyUpdatedAt: new Date().toISOString(),
        allocationManuallyUpdatedBy: actor.displayName,
        excludedFromGenerationAt: "",
        excludedFromGenerationBy: "",
        excludedFromGenerationReason: "",
        isActive: member.isActive !== false,
        manualGenerationExcluded: false,
        status: text(member.status) || "assigned",
      },
      directory,
    );
    saved.push(
      (
        await saveLegacyEvaluationEntityWithActor(db, actor, {
          entityType: "member",
          record: {
            ...enriched,
            code: text(member.code || current?.code) || employeeCode,
            databaseId: current?.id || explicitIdentifier,
            name: text(enriched.employeeName) || employeeCode,
          },
        })
      ).record,
    );
  }
  return {
    memberCount: saved.length,
    message: `Đã lưu ${saved.length} nhân sự vào kỳ đánh giá.`,
    records: saved,
  };
}

async function excludeEvaluationCycleMember(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const db = getDb();
  const cycleId = text(payload.cycleId);
  const memberId = text(
    payload.memberDatabaseId || payload.memberId || payload.id,
  );
  const employeeCode = text(payload.employeeCode);
  const cycle = await findEvaluationRecordByIdentifier(
    "evaluation-cycle",
    cycleId,
    db,
  );
  if (!cycle) {
    throw new EvaluationRuntimeError("Không tìm thấy kỳ đánh giá.");
  }
  const cycleReferences = new Set(evaluationRecordIdentifiers(cycle));
  const members = await db.evaluationRecord.findMany({
    where: { recordType: "evaluation-cycle-member" },
  });
  const member = members.find((candidate) => {
    const content = asRecord(candidate.content);
    const belongsToCycle = [
      candidate.parentId,
      content.cycleId,
      content.evaluationCycleId,
    ]
      .map(text)
      .some((value) => cycleReferences.has(value));
    if (!belongsToCycle) return false;
    if (memberId && evaluationRecordIdentifiers(candidate).includes(memberId)) {
      return true;
    }
    return (
      Boolean(employeeCode) &&
      text(content.employeeCode || content.employeeId).toLowerCase() ===
        employeeCode.toLowerCase()
    );
  });
  if (!member) {
    throw new EvaluationRuntimeError(
      "Không còn tìm thấy nhân sự trong danh sách phân bổ của kỳ.",
      404,
    );
  }
  const memberContent = asRecord(member.content);
  const resolvedEmployeeCode = text(
    memberContent.employeeCode || memberContent.employeeId,
  );
  const instances = await db.evaluationRecord.findMany({
    where: { recordType: "evaluation-instance" },
  });
  const existingInstance = instances.find((instance) => {
    if (!isActiveEvaluationRecord(instance)) return false;
    const content = asRecord(instance.content);
    return (
      text(content.employeeCode).toLowerCase() ===
        resolvedEmployeeCode.toLowerCase() &&
      [instance.parentId, content.cycleId, content.evaluationCycleId]
        .map(text)
        .some((value) => cycleReferences.has(value))
    );
  });
  if (existingInstance) {
    throw new EvaluationRuntimeError(
      "Nhân sự này đã có phiếu. Hãy dùng Xóa phiếu tại tab Theo dõi trước khi loại khỏi kỳ.",
      409,
    );
  }
  const now = new Date().toISOString();
  await db.$transaction(async (tx) => {
    await tx.evaluationRecord.update({
      data: {
        content: {
          ...memberContent,
          excludedFromGenerationAt: now,
          excludedFromGenerationBy: actor.displayName,
          excludedFromGenerationReason:
            text(payload.reason) || "cnb_period_exclusion",
          isActive: false,
          manualGenerationExcluded: true,
          status: "inactive",
          updatedAt: now,
          updatedBy: actor.displayName,
        } as Prisma.InputJsonValue,
        status: "inactive",
        updatedByName: actor.displayName,
      },
      where: { id: member.id },
    });
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: actor.userId,
        metadata: {
          cycleId: evaluationRecordLegacyId(cycle),
          employeeCode: resolvedEmployeeCode,
          reason: text(payload.reason) || "cnb_period_exclusion",
          source: "evaluation-cycle-readiness",
        },
        summary: `Loại ${member.name || resolvedEmployeeCode} khỏi danh sách sinh phiếu của kỳ ${cycle.name || cycle.code}.`,
        targetId: member.id,
        targetType: "EvaluationCycleMember",
      },
    });
  });
  return {
    excluded: true,
    employeeCode: resolvedEmployeeCode,
    memberId: member.id,
    message: `Đã loại ${member.name || resolvedEmployeeCode} khỏi danh sách sinh phiếu của kỳ này.`,
  };
}

function legacyWorkspaceData(
  workspace: Awaited<ReturnType<typeof getEvaluationWorkspace>>,
) {
  type ClientRecord = (typeof workspace.scores)[number];
  const groups: Array<{
    items: ClientRecord[];
    key: string;
    recordType: string;
  }> = [
    {
      items: workspace.scores,
      key: "criteriaScores",
      recordType: "evaluation-criteria-score",
    },
    {
      items: workspace.cycles,
      key: "cycles",
      recordType: "evaluation-cycle",
    },
    {
      items: workspace.decisionFields,
      key: "decisionFields",
      recordType: "evaluation-decision-field",
    },
    {
      items: workspace.decisionValues,
      key: "decisionValues",
      recordType: "evaluation-decision-value",
    },
    {
      items: workspace.results,
      key: "finalResults",
      recordType: "evaluation-final-result",
    },
    {
      items: workspace.instances,
      key: "instances",
      recordType: "evaluation-instance",
    },
    {
      items: workspace.workflowSteps,
      key: "workflowSteps",
      recordType: "evaluation-workflow-step",
    },
  ];
  const identityRows = groups.flatMap((group) =>
    group.items.map((item) => ({
      ...item,
      recordType: group.recordType,
    })),
  );
  const legacyIdByDatabaseId = buildEvaluationLegacyIdMap(identityRows);
  const flatten = (items: ClientRecord[], recordType: string) =>
    items.map((item) => {
      const identity = { ...item, recordType };
      const content = mapEvaluationLegacyReferences(
        item.content,
        legacyIdByDatabaseId,
      ) as JsonRecord;
      return {
        ...content,
        ...item,
        content: undefined,
        databaseId: item.id,
        id: evaluationRecordLegacyId(identity),
        parentId:
          legacyIdByDatabaseId.get(text(item.parentId)) || item.parentId || "",
        recordType,
      };
    });
  const legacyData = Object.fromEntries(
    groups.map((group) => [group.key, flatten(group.items, group.recordType)]),
  );
  return {
    ...legacyData,
    members: [],
  };
}

async function getLegacyAssignedInstances(
  session: AppSession,
  payload: JsonRecord,
) {
  const workspace = await getEvaluationWorkspace(session, payload);
  return {
    data: legacyWorkspaceData(workspace),
    readOnly: false,
    viewer: workspace.actor,
  };
}

async function getLegacyEvaluationInstanceDetail(
  session: AppSession,
  payload: JsonRecord,
) {
  return getLegacyAssignedInstances(session, payload);
}

async function normalizeEvaluationJdDocuments(actor: OperationActor) {
  const db = getDb();
  const [documents, employees] = await Promise.all([
    db.evaluationRecord.findMany({
      where: { recordType: "evaluation-jd-document" },
    }),
    db.employee.findMany({
      select: { title: true },
      where: { archivedAt: null, status: "ACTIVE", title: { not: null } },
    }),
  ]);
  const normalizeTitle = (value: unknown) =>
    text(value)
      .replace(/^\s*\[BC\]\s*(?:[-–—:]\s*)?/i, "")
      .replace(/\.(?:docx?|pdf)$/i, "")
      .replace(/\s*(?:\(\d+\)|copy\s*\d*|bản sao\s*\d*)\s*$/i, "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[đĐ]/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const directoryTitleScore = (value: string) => {
    const decomposed = value.normalize("NFD");
    const diacritics = (decomposed.match(/[\u0300-\u036f]/g) || []).length;
    const vietnameseD = (value.match(/[đĐ]/g) || []).length;
    const wordBreaks = (value.match(/[\s&/-]/g) || []).length;
    const camelPenalty = (value.match(/[a-zà-ỹ][A-ZĐ]/g) || []).length;
    return (
      diacritics * 100 + vietnameseD * 100 + wordBreaks * 2 - camelPenalty * 5
    );
  };
  const restoreVietnameseJobTitle = (value: string) => {
    const words = value
      .replace(/([A-Z]{2,})([A-ZĐ][a-zà-ỹ])/g, "$1 $2")
      .replace(/([a-zà-ỹ])([A-ZĐ])/g, "$1 $2")
      .replace(/[_/]+/g, " ")
      .replace(/&/g, " & ")
      .split(/\s+/)
      .filter(Boolean);
    const dictionary: Record<string, string> = {
      bao: "bảo",
      bo: "bộ",
      canh: "cảnh",
      cap: "cấp",
      cb: "C&B",
      cham: "chăm",
      chi: "chi",
      chinh: "chính",
      chuyen: "chuyên",
      chu: "chủ",
      chuc: "chức",
      cong: "công",
      co: "cơ",
      cua: "cửa",
      cuahang: "cửa hàng",
      dao: "đào",
      dich: "dịch",
      dieu: "điều",
      dien: "điện",
      doc: "đốc",
      dot: "đốt",
      dong: "đóng",
      dung: "dựng",
      duong: "dưỡng",
      giam: "giám",
      gia: "giá",
      giao: "giao",
      goi: "gói",
      hang: "hàng",
      hanh: "hành",
      he: "hệ",
      hnag: "hàng",
      hoa: "hóa",
      hoach: "hoạch",
      hop: "hợp",
      hut: "hút",
      khai: "khai",
      ke: "kế",
      kien: "kiến",
      kiem: "kiểm",
      khi: "khí",
      kho: "kho",
      khoi: "khối",
      ky: "kỹ",
      lam: "làm",
      luc: "lực",
      ly: "lý",
      lo: "lò",
      mua: "mua",
      nem: "nệm",
      nguon: "nguồn",
      nhan: "nhân",
      nhanh: "nhánh",
      nhiem: "nhiệm",
      nhom: "nhóm",
      no: "nợ",
      noi: "nội",
      phat: "phát",
      phi: "phí",
      phong: "phòng",
      pho: "phó",
      phu: "phụ",
      quan: "quản",
      san: "sản",
      soat: "soát",
      so: "số",
      soc: "sóc",
      sinh: "sinh",
      su: "sự",
      tai: "tài",
      tao: "tạo",
      thanh: "thành",
      tmdt: "TMĐT",
      to: "tổ",
      toan: "toán",
      tong: "tổng",
      trach: "trách",
      trien: "triển",
      trinh: "trình",
      tri: "trì",
      truong: "trưởng",
      thuat: "thuật",
      thuc: "thực",
      thue: "thuế",
      thong: "thống",
      tho: "thợ",
      tap: "tập",
      tuan: "tuân",
      van: "vận",
      va: "và",
      ve: "vệ",
      vien: "viên",
      vu: "vụ",
      xay: "xây",
      xe: "xế",
      xuat: "xuất",
    };
    const restored = words.map((word, index) => {
      const key = normalizeTitle(word).replace(/\s+/g, "");
      if (key === "ban") {
        const next = normalizeTitle(words[index + 1]).replace(/\s+/g, "");
        const afterNext = normalizeTitle(words[index + 2]).replace(/\s+/g, "");
        return next === "giam" && afterNext === "doc" ? "ban" : "bán";
      }
      if (key === "quan") {
        const previous = normalizeTitle(words[index - 1]).replace(/\s+/g, "");
        return previous === "canh" ? "quan" : "quản";
      }
      if (key === "gia") {
        const previous = normalizeTitle(words[index - 1]).replace(/\s+/g, "");
        return previous === "chuyen" ? "gia" : "giá";
      }
      if (key === "su") {
        const previous = normalizeTitle(words[index - 1]).replace(/\s+/g, "");
        return previous === "cao" ? "su" : "sự";
      }
      if (key === "thu") {
        const next = normalizeTitle(words[index + 1]).replace(/\s+/g, "");
        return next === "quy" || next === "kho" ? "thủ" : "thu";
      }
      if (key === "quy") return "quỹ";
      if (key === "thanh") {
        const next = normalizeTitle(words[index + 1]).replace(/\s+/g, "");
        if (next === "toan") return "thanh";
      }
      if (dictionary[key]) return dictionary[key];
      if (/^[A-Z0-9]{2,}$/.test(word)) return word;
      return word.toLowerCase();
    });
    if (!restored.length) return "";
    restored[0] = restored[0].charAt(0).toUpperCase() + restored[0].slice(1);
    return restored.join(" ").replace(/\s+&\s+/g, " & ");
  };
  const directoryTitleByKey = new Map<string, string>();
  employees.forEach((employee) => {
    const title = text(employee.title);
    const key = normalizeTitle(title).replace(/\s+/g, "");
    if (!key || !title) return;
    const current = directoryTitleByKey.get(key);
    if (!current || directoryTitleScore(title) > directoryTitleScore(current)) {
      directoryTitleByKey.set(key, title);
    }
  });
  const rows = documents.map((document) => {
    const content = asRecord(document.content);
    const fileName = text(content.fileName);
    const fileTitle = deriveJdTitle(fileName);
    const directoryTitle = directoryTitleByKey.get(
      normalizeTitle(fileTitle).replace(/\s+/g, ""),
    );
    const restoredTitle = restoreVietnameseJobTitle(fileTitle);
    const storedMappedTitle = text(
      content.mappedJobTitleName || content.personnelJobTitleName,
    );
    const mappedTitle =
      directoryTitle ||
      (storedMappedTitle &&
      normalizePositionKey(storedMappedTitle) !==
        normalizePositionKey(restoredTitle)
        ? storedMappedTitle
        : restoredTitle || storedMappedTitle);
    const rawTitle = text(
      mappedTitle ||
        content.jobTitleName ||
        content.displayTitle ||
        document.name ||
        deriveJdTitle(fileName),
    );
    const isLegacy = [document.name, fileName, rawTitle].some((value) =>
      /^\s*\[BC\]/i.test(text(value)),
    );
    const modifiedAt = Date.parse(
      text(content.driveModifiedAt || content.updatedAt || document.updatedAt),
    );
    const extension = fileName.split(".").pop()?.toLowerCase() || "";
    return {
      content,
      document,
      isLegacy,
      key: normalizeTitle(fileTitle || rawTitle || document.id),
      mappedTitle,
      modifiedAt: Number.isFinite(modifiedAt) ? modifiedAt : 0,
      preferredFormat: extension === "doc" || extension === "docx" ? 1 : 0,
      title: rawTitle.replace(/^\s*\[BC\]\s*(?:[-–—:]\s*)?/i, "").trim(),
    };
  });
  const groups = new Map<string, typeof rows>();
  rows.forEach((row) => {
    const key = row.key || row.document.id;
    const bucket = groups.get(key) || [];
    bucket.push(row);
    groups.set(key, bucket);
  });

  let archived = 0;
  let deduplicated = 0;
  let renamed = 0;
  const normalizedAt = new Date().toISOString();
  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        Number(left.isLegacy) - Number(right.isLegacy) ||
        Number(Boolean(right.mappedTitle)) -
          Number(Boolean(left.mappedTitle)) ||
        right.preferredFormat - left.preferredFormat ||
        right.modifiedAt - left.modifiedAt ||
        left.document.id.localeCompare(right.document.id),
    );
    const canonical = group[0];
    const canonicalTitle =
      canonical.mappedTitle || canonical.title || "JD chưa đặt tên";
    const canonicalName = canonical.isLegacy
      ? `[BC] - ${canonicalTitle}`
      : canonicalTitle;
    const canonicalNeedsRename =
      text(canonical.document.name) !== canonicalName ||
      text(canonical.content.displayTitle) !== canonicalTitle ||
      text(canonical.content.jobTitleName) !== canonicalTitle ||
      text(canonical.content.mappedJobTitleName) !== canonicalTitle ||
      text(canonical.content.personnelJobTitleName) !== canonicalTitle;
    if (canonicalNeedsRename || canonical.content.isArchived === true) {
      await db.evaluationRecord.update({
        data: {
          content: {
            ...canonical.content,
            availabilityStatus: "current",
            displayTitle: canonicalTitle,
            duplicateOfDocumentId: "",
            isArchived: false,
            jobTitleName: canonicalTitle,
            mappedJobTitleName: canonicalTitle,
            personnelJobTitleName:
              canonical.mappedTitle ||
              canonical.content.personnelJobTitleName ||
              "",
            normalizedAt,
          } as Prisma.InputJsonValue,
          name: canonicalName,
          status: "active",
          updatedByName: actor.displayName,
        },
        where: { id: canonical.document.id },
      });
      if (canonicalNeedsRename) renamed += 1;
    }
    for (const duplicate of group.slice(1)) {
      archived += 1;
      deduplicated += 1;
      const expectedLegacyBlocked = duplicate.isLegacy && !canonical.isLegacy;
      const alreadyArchived =
        text(duplicate.content.availabilityStatus).toLowerCase() ===
          "archived" &&
        duplicate.content.isArchived === true &&
        text(duplicate.content.duplicateOfDocumentId) ===
          canonical.document.id &&
        Boolean(duplicate.content.legacyFallbackBlockedByCurrent) ===
          expectedLegacyBlocked;
      if (alreadyArchived) continue;
      await db.evaluationRecord.update({
        data: {
          content: {
            ...duplicate.content,
            availabilityStatus: "archived",
            duplicateOfDocumentId: canonical.document.id,
            isArchived: true,
            legacyFallbackBlockedByCurrent: expectedLegacyBlocked,
            normalizedAt,
          } as Prisma.InputJsonValue,
          updatedByName: actor.displayName,
        },
        where: { id: duplicate.document.id },
      });
    }
  }
  return { archived, deduplicated, renamed, total: documents.length };
}

async function normalizeLegacyArchivedJds(session: AppSession) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const normalizeResult = await normalizeEvaluationJdDocuments(actor);
  return {
    backendSheets: { source: "postgresql" },
    message: `Đã chuẩn hóa JD: gộp ${normalizeResult.deduplicated} bản trùng, đổi ${normalizeResult.renamed} tên theo chức danh tiếng Việt và hạ ưu tiên ${normalizeResult.archived} bản cũ.`,
    normalizeResult,
  };
}

async function enqueueLegacyJdClassification(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const documentId = text(payload.documentId || payload.jdDocumentId);
  const db = getDb();
  const document = await findEvaluationRecordByIdentifier(
    "evaluation-jd-document",
    documentId,
  );
  if (!document) {
    throw new EvaluationRuntimeError("Không tìm thấy tài liệu JD.", 404);
  }
  const now = new Date().toISOString();
  const mappedJobTitleName = text(payload.mappedJobTitleName);
  const activityUpdates: Array<{ id: string; content: JsonRecord }> = [];
  for (const rawActivity of Array.isArray(payload.activityTypes)
    ? payload.activityTypes
    : []) {
    const activity = asRecord(rawActivity);
    const identifier = text(
      activity.databaseId ||
        activity.id ||
        activity.code ||
        activity.activityCode,
    );
    if (!identifier) continue;
    const current = await findEvaluationRecordByIdentifier(
      "evaluation-jd-activity",
      identifier,
    );
    if (!current) continue;
    const currentContent = asRecord(current.content);
    activityUpdates.push({
      id: current.id,
      content: {
        ...currentContent,
        activityType: text(
          activity.activityType || currentContent.activityType,
        ),
        evaluationWorkGroupCode: text(activity.evaluationWorkGroupCode),
        evaluationWorkGroupId: text(activity.evaluationWorkGroupId),
        evaluationWorkGroupName: text(activity.evaluationWorkGroupName),
        frequency: text(activity.frequency || currentContent.frequency),
        frequencyName: text(
          activity.frequencyName || currentContent.frequencyName,
        ),
        updatedAt: now,
        updatedBy: actor.displayName,
        weightPercent: numberValue(
          activity.weightPercent,
          numberValue(currentContent.weightPercent, 0),
        ),
      },
    });
  }
  const workGroupUpdates: Array<{ id: string; content: JsonRecord }> = [];
  for (const rawGroup of Array.isArray(payload.workGroups)
    ? payload.workGroups
    : []) {
    const group = asRecord(rawGroup);
    const identifier = text(
      group.databaseId || group.id || group.code || group.workGroupCode,
    );
    if (!identifier) continue;
    const current = await findEvaluationRecordByIdentifier(
      "evaluation-jd-work-group",
      identifier,
    );
    if (!current) continue;
    const currentContent = asRecord(current.content);
    workGroupUpdates.push({
      id: current.id,
      content: {
        ...currentContent,
        updatedAt: now,
        updatedBy: actor.displayName,
        weightPercent: numberValue(
          group.weightPercent,
          numberValue(currentContent.weightPercent, 0),
        ),
      },
    });
  }
  await db.$transaction(async (tx) => {
    await tx.evaluationRecord.update({
      data: {
        content: {
          ...asRecord(document.content),
          criteriaMappings: Array.isArray(payload.criteriaMappings)
            ? payload.criteriaMappings
            : [],
          executionCriteriaSetId: text(payload.executionCriteriaSetId),
          displayTitle:
            mappedJobTitleName || text(asRecord(document.content).displayTitle),
          jobTitleName:
            mappedJobTitleName || text(asRecord(document.content).jobTitleName),
          managementCriteriaSetId: text(payload.managementCriteriaSetId),
          mappedJobTitleCode: text(payload.mappedJobTitleCode),
          mappedJobTitleName,
          ruleOverrides: Array.isArray(payload.ruleOverrides)
            ? payload.ruleOverrides
            : [],
          updatedAt: now,
          updatedBy: actor.displayName,
          workGroups: Array.isArray(payload.workGroups)
            ? payload.workGroups
            : [],
        } as Prisma.InputJsonValue,
        name: mappedJobTitleName || document.name,
        updatedByName: actor.displayName,
      },
      where: { id: document.id },
    });
    for (const update of activityUpdates) {
      await tx.evaluationRecord.update({
        data: {
          content: update.content as Prisma.InputJsonValue,
          updatedByName: actor.displayName,
        },
        where: { id: update.id },
      });
    }
    for (const update of workGroupUpdates) {
      await tx.evaluationRecord.update({
        data: {
          content: update.content as Prisma.InputJsonValue,
          updatedByName: actor.displayName,
        },
        where: { id: update.id },
      });
    }
  });
  const job = await db.evaluationRecord.create({
    data: {
      code: uniqueCode("JDJOB"),
      content: {
        documentId: document.id,
        finishedAt: now,
        progress: 100,
        status: "done",
      } as Prisma.InputJsonValue,
      createdByName: actor.displayName,
      name: `Phân loại JD - ${document.name || document.code}`,
      parentId: document.id,
      recordType: "evaluation-jd-classification-job",
      status: "done",
      updatedByName: actor.displayName,
    },
  });
  const normalizeResult = await normalizeEvaluationJdDocuments(actor);
  const legacyIdByDatabaseId = buildEvaluationLegacyIdMap([document, job]);
  return {
    job: legacyEvaluationRecord(job, legacyIdByDatabaseId),
    message: `Đã lưu phân loại JD, ${activityUpdates.length} đầu việc và ${workGroupUpdates.length} tỷ trọng nhóm; đồng thời gộp ${normalizeResult.deduplicated} bản JD trùng.`,
    normalizeResult,
  };
}

async function enqueueLegacyGeneration(
  session: AppSession,
  payload: JsonRecord,
) {
  const result = await generateEvaluationInstances(session, payload);
  return {
    ...result,
    job: {
      created: result.created,
      skipped: result.skipped,
      status: "done",
    },
  };
}

async function saveLegacyReview(session: AppSession, payload: JsonRecord) {
  const decisionValues = Array.isArray(payload.decisionValues)
    ? Object.fromEntries(
        payload.decisionValues
          .map(asRecord)
          .map((item) => [text(item.fieldCode || item.fieldId), item.value])
          .filter(([key]) => Boolean(key)),
      )
    : asRecord(payload.decisionValues || payload.values);
  return saveEvaluationReview(session, {
    ...payload,
    answers: decisionValues,
    overallComment: payload.comment,
  });
}

async function finalizeLegacyInstance(
  session: AppSession,
  payload: JsonRecord,
) {
  let decision = text(payload.decision || payload.decisionOptionId);
  let decisionOptionId = text(payload.decisionOptionId);
  let decisionOptionCode = text(payload.decisionOptionCode);
  if (decision) {
    const option = await findEvaluationRecordByIdentifier(
      "evaluation-decision-option",
      decision,
    );
    if (option) {
      const optionContent = asRecord(option.content);
      decisionOptionId = option.id;
      decisionOptionCode = text(
        optionContent.code || optionContent.optionCode || option.code,
      );
      decision = text(optionContent.label || option.name || option.code);
    }
  }
  return finalizeEvaluationInstance(session, {
    ...payload,
    decision,
    decisionOptionCode,
    decisionOptionId,
  });
}

async function recordLegacyReminders(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const cycleId = text(payload.cycleId);
  if (!cycleId || cycleId === "all") {
    throw new EvaluationRuntimeError(
      "Chọn một kỳ đánh giá cụ thể trước khi gửi nhắc.",
    );
  }
  const result = await queueEvaluationMailForCycle(cycleId, {
    actorName: actor.displayName,
    eventToken: `manual:${new Date().toISOString().slice(0, 10)}:${cycleId}`,
    sendNow: true,
  });
  if (result.reason === "cycle_not_active") {
    throw new EvaluationRuntimeError(
      "Kỳ đánh giá này đã bị xóa hoặc không còn hoạt động, nên hệ thống không gửi mail.",
    );
  }
  await getDb().auditLog.create({
    data: {
      action: "UPDATE",
      actorId: actor.userId,
      metadata: {
        cycleId,
        ...result,
        source: "evaluation-monitoring",
      },
      summary: `Gửi nhắc đánh giá: ${result.sent} thành công, ${result.queued} xếp hàng, ${result.failed} lỗi.`,
      targetId: cycleId || "all",
      targetType: "EvaluationCycle",
    },
  });
  return {
    ...result,
    message: result.sent
      ? `Đã gửi ${result.sent} email nhắc đánh giá qua mail CnB${result.failed ? `; ${result.failed} email lỗi đã được giữ lại để thử lại` : ""}.`
      : result.queued
        ? `Đã xếp hàng ${result.queued} email nhắc đánh giá.`
        : "Chưa có email được gửi. Hãy kiểm tra mẫu Nhắc trước hạn đang ở trạng thái Đang dùng và email nhân sự.",
    recipientCount: result.sent + result.queued,
    reminderCount: result.sent + result.queued,
  };
}

export async function dispatchEvaluationRpc(
  session: AppSession,
  method: string,
  payload: JsonRecord,
) {
  switch (method) {
    case "getEvaluationConfigData":
      return { ok: true, ...(await getLegacyEvaluationData(session)) };
    case "getEvaluationAdminWorkspaceData":
      return { ok: true, ...(await getLegacyEvaluationData(session)) };
    case "inspectEvaluationAutomationSource":
      return inspectEvaluationAutomationSource(session, payload);
    case "previewEvaluationAutomationSource":
      return previewEvaluationAutomationSource(session, payload);
    case "saveEvaluationAutomationSchedule":
      return saveEvaluationAutomationSchedule(session, payload);
    case "runEvaluationAutomationNow":
      return runEvaluationAutomationNow(session, payload);
    case "getEvaluationAssignedInstances":
      return getLegacyAssignedInstances(session, payload);
    case "getEvaluationInstanceDetail":
      return getLegacyEvaluationInstanceDetail(session, payload);
    case "saveEvaluationConfigEntity":
      return saveLegacyEvaluationEntity(session, payload);
    case "saveEvaluationConfigEntities":
      return saveLegacyEvaluationEntities(session, payload);
    case "reorderEvaluationScoreGroups":
      return reorderEvaluationScoreGroups(session, payload);
    case "publishEvaluationConfigEntity": {
      const meta = LEGACY_EVALUATION_ENTITY_TYPES[text(payload.entityType)];
      if (!meta) {
        throw new EvaluationRuntimeError(
          `Loại cấu hình đánh giá "${text(payload.entityType)}" chưa được hỗ trợ.`,
        );
      }
      const current = await findEvaluationRecordByIdentifier(
        meta.recordType,
        payload.databaseId || payload.id,
      );
      if (!current) {
        throw new EvaluationRuntimeError(
          "Không tìm thấy cấu hình cần publish.",
        );
      }
      return setEvaluationConfigStatus(session, {
        id: current.id,
        note: payload.note,
        status: "published",
      });
    }
    case "deleteEvaluationConfigEntity":
      return deleteLegacyEvaluationEntity(session, payload);
    case "saveEvaluationCycle": {
      const saved = await saveLegacyEvaluationEntity(session, {
        entityType: "cycle",
        record: payload.record,
      });
      return {
        ...saved,
        cycle: saved.record,
      };
    }
    case "saveEvaluationCycleMembers":
      return saveLegacyCycleMembers(session, payload);
    case "excludeEvaluationCycleMember":
      return excludeEvaluationCycleMember(session, payload);
    case "checkEvaluationCycleReadiness":
      return checkEvaluationCycleReadiness(session, payload);
    case "enqueueEvaluationGenerationJob":
      return enqueueLegacyGeneration(session, payload);
    case "syncUnstartedEvaluationInstances":
      return syncUnstartedEvaluationInstances(session, payload);
    case "resendFailedEvaluationMails":
      return resendFailedEvaluationMails(session, payload);
    case "resendEvaluationManagerAssignmentMails":
      return resendEvaluationManagerAssignmentMails(session, payload);
    case "syncEvaluationJdFolder":
      return syncEvaluationSourceFolder(session, {
        ...payload,
        sourceId: payload.sourceId || payload.evaluationSourceId,
      });
    case "normalizeEvaluationArchivedJdData":
      return normalizeLegacyArchivedJds(session);
    case "enqueueEvaluationJdClassificationJob":
      return enqueueLegacyJdClassification(session, payload);
    case "saveEvaluationInstanceReview":
      return saveLegacyReview(session, payload);
    case "returnEvaluationInstanceReview":
      return returnEvaluationReview(session, payload);
    case "finalizeEvaluationInstance":
      return finalizeLegacyInstance(session, payload);
    case "previewEvaluationFinalization":
      return previewEvaluationFinalization(session, payload);
    case "sendEvaluationPendingReviewReminders":
      return recordLegacyReminders(session, payload);
    case "generateEvaluationResultPdf":
      const pdfUrl = `/api/evaluation/result-pdf?instanceId=${encodeURIComponent(
        text(payload.instanceId),
      )}`;
      return {
        file: {
          fileUrl: pdfUrl,
          url: pdfUrl,
        },
        message: "Đã chuẩn bị PDF kết quả đánh giá.",
        pdfUrl,
      };
    case "getConfigTab":
      return getEvaluationConfigTab(session, payload);
    case "saveConfigRecord":
      return saveEvaluationConfigRecord(session, payload);
    case "setConfigStatus":
      return setEvaluationConfigStatus(session, payload);
    case "getWorkspace":
      return getEvaluationWorkspace(session, payload);
    case "saveReview":
      return saveEvaluationReview(session, payload);
    case "returnReview":
      return returnEvaluationReview(session, payload);
    case "finalizeInstance":
      return finalizeEvaluationInstance(session, payload);
    case "checkCycleReadiness":
      return checkEvaluationCycleReadiness(session, payload);
    case "generateInstances":
      return generateEvaluationInstances(session, payload);
    case "syncUnstartedInstances":
      return syncUnstartedEvaluationInstances(session, payload);
    case "resendFailedMails":
      return resendFailedEvaluationMails(session, payload);
    case "resendManagerAssignmentMails":
      return resendEvaluationManagerAssignmentMails(session, payload);
    case "syncSourceFolder":
      return syncEvaluationSourceFolder(session, payload);
    case "deleteInstance":
      return deleteEvaluationInstance(session, payload);
    default:
      throw new EvaluationRuntimeError(
        `Phương thức đánh giá "${method}" không được hỗ trợ.`,
        404,
      );
  }
}
