import "server-only";

import { randomUUID } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import {
  canUsePortalModule,
  type PortalModuleAction,
} from "@/lib/auth/module-authorization";
import { getDb } from "@/lib/db";
import { resolveSharedJdsForPositions } from "@/lib/evaluation/jd-resolution";
import {
  asRecord,
  booleanValue,
  numberValue,
  text,
  type JsonRecord,
} from "@/lib/operations/json";
import {
  resolveOperationActor,
  type OperationActor,
} from "@/lib/operations/actor";
import {
  buildLegacyAssessmentVersions,
  calculateRecruitmentScore,
  normalizeHexacoPersonality,
  normalizeLookup,
  normalizeRecruitmentCultureValues,
  type RecruitmentCultureValue,
} from "@/lib/recruitment/assessment-parity";
import { canViewRecruitmentAssessmentHistory } from "@/lib/recruitment/assessment-history-access";
import { isRecruitmentAdministrator } from "@/lib/recruitment/access-policy";
import { RecruitmentRuntimeError } from "@/lib/recruitment/errors";
import {
  dispatchRecruitmentManagementRpc,
  getRecruitmentManagementWorkspace,
  readRecruitmentSourceHeadersFromUpload,
} from "@/lib/recruitment/management-runtime";

export { RecruitmentRuntimeError } from "@/lib/recruitment/errors";

const SCORING_CONFIG_TYPES = [
  "recruitment-score-group",
  "recruitment-score-criterion",
  "recruitment-score-set",
  "recruitment-score-round-mapping",
  "recruitment-score-scope-mapping",
];
const CONFIG_SOURCE = "__POSTGRES_SCORING_CONFIG__";
const COMPAT_CONFIG_SOURCE = "__POSTGRES_RECRUITMENT_COMPAT__";

function assertAdmin(
  actor: OperationActor,
  moduleKey = "candidate-assessment",
  action: PortalModuleAction = "edit",
) {
  if (!canUsePortalModule(actor, moduleKey, action)) {
    throw new RecruitmentRuntimeError(
      "Bạn không có quyền thay đổi cấu hình chấm tuyển dụng.",
      403,
    );
  }
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function configForClient(record: {
  id: string;
  recordType: string;
  code: string | null;
  name: string | null;
  status: string | null;
  sourceSheet: string;
  sourceRow: number;
  content: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    code: record.code || "",
    content: asRecord(record.content),
    createdAt: record.createdAt.toISOString(),
    id: record.id,
    name: record.name || "",
    recordType: record.recordType,
    sourceRow: record.sourceRow,
    sourceSheet: record.sourceSheet,
    status: record.status || "draft",
    updatedAt: record.updatedAt.toISOString(),
  };
}

function normalizeRound(value: unknown) {
  const normalized = text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
  if (
    normalized.includes("so_van") ||
    normalized.includes("screen") ||
    normalized.includes("prelim")
  ) {
    return "preliminary";
  }
  if (
    normalized === "round2" ||
    normalized === "vong2" ||
    normalized.includes("vong_2") ||
    normalized.includes("round_2") ||
    normalized.endsWith("_2")
  ) {
    return "round2";
  }
  return "round1";
}

function roundLabel(round: string) {
  if (round === "preliminary") return "Sơ vấn";
  if (round === "round2") return "Phỏng vấn vòng 2";
  return "Phỏng vấn vòng 1";
}

type AssessmentScope = "technical" | "culture";

export function assessmentScopesForRole(roleValue: unknown): AssessmentScope[] {
  const role = text(roleValue).toLowerCase();
  if (role === "culture") return ["culture"];
  if (role === "technical") return ["technical"];
  return ["technical", "culture"];
}

function itemAssessmentScope(itemValue: unknown): AssessmentScope {
  return text(asRecord(itemValue).sectionKey) === "culture"
    ? "culture"
    : "technical";
}

function filterItemsForRole<T>(items: T[], roleValue: unknown) {
  const allowed = new Set(assessmentScopesForRole(roleValue));
  return items.filter((item) => allowed.has(itemAssessmentScope(item)));
}

function actorMatchesReviewer(
  reviewerEmployeeId: string | null | undefined,
  actor: OperationActor,
) {
  const reviewer = text(reviewerEmployeeId);
  return Boolean(
    reviewer &&
      [actor.employeeId, actor.employeeCode, actor.userId].includes(reviewer),
  );
}

function canAccessRound(
  round: string,
  actor: OperationActor,
  reviewerEmployeeId?: string | null,
) {
  if (round === "preliminary") return isRecruitmentAdministrator(actor);
  return (
    isRecruitmentAdministrator(actor) ||
    actorMatchesReviewer(reviewerEmployeeId, actor)
  );
}

function candidateAge(birthDate: string | null) {
  if (!birthDate) return null;
  const parsed = new Date(birthDate);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - parsed.getFullYear();
  const month = now.getMonth() - parsed.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < parsed.getDate())) age -= 1;
  return age >= 0 && age <= 120 ? age : null;
}

function decimal(value: unknown) {
  if (value == null) return null;
  const parsed = Number(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function scoreItemForClient(item: {
  id: string;
  sectionKey: string | null;
  groupKey: string | null;
  groupName: string | null;
  itemKey: string | null;
  itemName: string | null;
  criterionId: string | null;
  criterionName: string | null;
  weight: Prisma.Decimal | null;
  score: Prisma.Decimal | null;
  note: string | null;
  evidence: string | null;
  level: number | null;
  bonusTechnical: boolean;
  bonusLearning: boolean;
  meta: unknown;
}) {
  return {
    bonusLearning: item.bonusLearning,
    bonusTechnical: item.bonusTechnical,
    criterionId: item.criterionId || "",
    criterionName: item.criterionName || "",
    evidence: item.evidence || "",
    groupKey: item.groupKey || "",
    groupName: item.groupName || "",
    id: item.id,
    itemKey: item.itemKey || "",
    itemName: item.itemName || "",
    level: item.level,
    meta: asRecord(item.meta),
    note: item.note || "",
    score: decimal(item.score),
    sectionKey: item.sectionKey || "",
    weight: decimal(item.weight),
  };
}

function scorecardForClient(scorecard: {
  id: string;
  assignmentId: string | null;
  applicationId: string;
  roundKey: string;
  roundLabel: string;
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  roleKey: string | null;
  roleLabel: string | null;
  scoringMode: string | null;
  status: string;
  finalScore: Prisma.Decimal | null;
  decision: string | null;
  overallComment: string | null;
  criteriaSetId: string | null;
  criteriaSetName: string | null;
  jdPosition: string | null;
  version: number;
  editRevision: number;
  submittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<Parameters<typeof scoreItemForClient>[0]>;
}) {
  return {
    assignmentId: scorecard.assignmentId || "",
    applicationId: scorecard.applicationId,
    criteriaSetId: scorecard.criteriaSetId || "",
    criteriaSetName: scorecard.criteriaSetName || "",
    decision: scorecard.decision || "",
    editRevision: scorecard.editRevision,
    finalScore: decimal(scorecard.finalScore),
    id: scorecard.id,
    items: (scorecard.items || []).map(scoreItemForClient),
    jdPosition: scorecard.jdPosition || "",
    overallComment: scorecard.overallComment || "",
    reviewerEmployeeId: scorecard.reviewerEmployeeId || "",
    reviewerName: scorecard.reviewerName || "",
    roleKey: scorecard.roleKey || "",
    roleLabel: scorecard.roleLabel || "",
    roundKey: normalizeRound(scorecard.roundKey),
    roundLabel: scorecard.roundLabel,
    scoringMode: scorecard.scoringMode || "",
    status: scorecard.status,
    sectionScores: {
      culture: resultSectionScore(scorecard, "culture"),
      technical: resultSectionScore(scorecard, "technical"),
    },
    submittedAt: scorecard.submittedAt?.toISOString() || "",
    updatedAt: scorecard.updatedAt.toISOString(),
    version: scorecard.version,
  };
}

export async function getRecruitmentScoringConfig(session: AppSession) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-assessment", "view");
  const db = getDb();
  const [records, sharedCriteria, requisitions, campaigns] = await Promise.all([
    db.recruitmentConfigRecord.findMany({
      orderBy: [{ recordType: "asc" }, { sourceRow: "asc" }],
      take: 800,
      where: { recordType: { in: SCORING_CONFIG_TYPES } },
    }),
    db.evaluationRecord.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
      where: {
        recordType: {
          in: [
            "evaluation-score-group",
            "evaluation-criteria",
            "evaluation-criteria-set",
            "evaluation-criteria-set-item",
          ],
        },
      },
    }),
    db.recruitmentRequisition.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        department: true,
        position: true,
        requisitionCode: true,
      },
      take: 500,
    }),
    db.recruitmentCampaign.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        code: true,
        department: true,
        position: true,
        team: true,
      },
      take: 500,
    }),
  ]);

  const shared = sharedCriteria.map((record) => ({
    code: record.code || "",
    content: asRecord(record.content),
    id: record.id,
    name: record.name || "",
    recordType: record.recordType,
    status: record.status,
  }));
  const configRecords = records.map(configForClient);
  const flattenShared = (recordType: string) =>
    shared
      .filter((record) => record.recordType === recordType)
      .map((record) => ({
        ...record.content,
        code: record.code || text(record.content.code),
        id: record.id,
        name: record.name || text(record.content.name),
        status: record.status,
      }));
  const roundMappings = configRecords.filter(
    (record) => record.recordType === "recruitment-score-round-mapping",
  );
  const mappings = Object.fromEntries(
    roundMappings.map((record) => [
      normalizeRound(record.content.roundKey),
      text(record.content.criteriaSetId),
    ]),
  );

  return {
    campaigns,
    criteria: flattenShared("evaluation-criteria"),
    criteriaSetItems: flattenShared("evaluation-criteria-set-item"),
    criteriaSets: flattenShared("evaluation-criteria-set"),
    mappings,
    records: configRecords,
    rounds: [
      { key: "preliminary", label: "Sơ vấn" },
      { key: "round_1", label: "Vòng 1" },
      { key: "round_2", label: "Vòng 2" },
    ],
    requisitions,
    scopeMappings: configRecords
      .filter(
        (record) => record.recordType === "recruitment-score-scope-mapping",
      )
      .map((record) => ({ ...record.content, id: record.id })),
    scopeOptions: {
      departments: Array.from(
        new Set(
          [...campaigns, ...requisitions]
            .map((item) => text(item.department))
            .filter(Boolean),
        ),
      ),
      positions: Array.from(
        new Set(
          [...campaigns, ...requisitions]
            .map((item) => text(item.position))
            .filter(Boolean),
        ),
      ),
      requisitions: requisitions.map((item) => item.requisitionCode),
      teams: Array.from(
        new Set(campaigns.map((item) => text(item.team)).filter(Boolean)),
      ),
    },
    scoreGroups: flattenShared("evaluation-score-group"),
    sharedCriteria: shared,
  };
}

function validateScoringConfig(recordType: string, content: JsonRecord) {
  if (recordType !== "recruitment-score-set") return;
  const items = Array.isArray(content.items)
    ? content.items.map(asRecord)
    : [];
  const total = items.reduce(
    (sum, item) => sum + numberValue(item.weight),
    0,
  );
  if (!items.length || Math.abs(total - 100) > 0.01) {
    throw new RecruitmentRuntimeError(
      `Tổng trọng số của bộ tiêu chí phải bằng 100%. Hiện tại: ${total}%.`,
    );
  }
}

export async function saveRecruitmentScoringConfig(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const db = getDb();
  const id = text(payload.id);
  const recordType = text(payload.recordType);
  const code = text(payload.code).toUpperCase();
  const name = text(payload.name);
  const status = text(payload.status).toLowerCase() || "draft";
  if (!SCORING_CONFIG_TYPES.includes(recordType) || !code || !name) {
    throw new RecruitmentRuntimeError(
      "Vui lòng nhập đủ loại dữ liệu, mã và tên cấu hình.",
    );
  }
  const content: JsonRecord = {
    ...asRecord(payload.content),
    code,
    name,
    recordType,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.displayName,
  };
  validateScoringConfig(recordType, content);
  const duplicate = await db.recruitmentConfigRecord.findFirst({
    where: {
      code,
      id: id ? { not: id } : undefined,
      recordType,
    },
  });
  if (duplicate) {
    throw new RecruitmentRuntimeError(
      `Mã ${code} đã tồn tại trong nhóm cấu hình này.`,
    );
  }

  const record = id
    ? await db.recruitmentConfigRecord.update({
        data: { code, content: json(content), name, status },
        where: { id },
      })
    : await db.$transaction(async (tx) => {
        const last = await tx.recruitmentConfigRecord.findFirst({
          orderBy: { sourceRow: "desc" },
          where: { sourceSheet: CONFIG_SOURCE },
        });
        return tx.recruitmentConfigRecord.create({
          data: {
            code,
            content: json(content),
            name,
            recordType,
            sourceRow: (last?.sourceRow || 0) + 1,
            sourceSheet: CONFIG_SOURCE,
            status,
          },
        });
      });
  return configForClient(record);
}

export async function setRecruitmentScoringStatus(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const id = text(payload.id);
  const status = text(payload.status).toLowerCase();
  if (!id || !["draft", "published", "active", "inactive"].includes(status)) {
    throw new RecruitmentRuntimeError("Trạng thái cấu hình không hợp lệ.");
  }
  const db = getDb();
  const existing = await db.recruitmentConfigRecord.findUnique({
    where: { id },
  });
  if (!existing || !SCORING_CONFIG_TYPES.includes(existing.recordType)) {
    throw new RecruitmentRuntimeError("Không tìm thấy cấu hình.", 404);
  }
  if (status === "published") {
    validateScoringConfig(existing.recordType, asRecord(existing.content));
  }
  return configForClient(
    await db.recruitmentConfigRecord.update({
      data: {
        content: json({
          ...asRecord(existing.content),
          publishedAt:
            status === "published" ? new Date().toISOString() : undefined,
          publishedBy: status === "published" ? actor.displayName : undefined,
          status,
        }),
        status,
      },
      where: { id },
    }),
  );
}

type AssessmentEntry = {
  application: {
    id: string;
    applicationCode: string;
    candidateCode: string | null;
    position: string | null;
    department: string | null;
    cvUrl: string | null;
    receivedAt: Date | null;
    candidate: {
      fullName: string;
      phone: string | null;
      email: string | null;
      birthDate: string | null;
    };
  };
  assignmentId: string;
  cardId: string;
  reviewerEmployeeId: string | null;
  reviewerName: string | null;
  roleKey: string | null;
  roleLabel: string | null;
  roundKey: string;
  roundLabel: string;
  status: string;
  version: number;
  updatedAt: Date;
  finalScore: number | null;
  decision: string | null;
};

const queueApplicationSelect = {
  applicationCode: true,
  candidate: {
    select: {
      birthDate: true,
      email: true,
      fullName: true,
      phone: true,
    },
  },
  candidateCode: true,
  cvUrl: true,
  department: true,
  id: true,
  position: true,
  receivedAt: true,
  updatedAt: true,
} satisfies Prisma.RecruitmentApplicationSelect;

function entryForClient(entry: AssessmentEntry) {
  const age = candidateAge(entry.application.candidate.birthDate);
  return {
    age,
    applicationCode: entry.application.applicationCode,
    applicationId: entry.application.id,
    assignmentId: entry.assignmentId,
    candidateCode: entry.application.candidateCode || "",
    candidateName: entry.application.candidate.fullName,
    cardId: entry.cardId,
    cvUrl: entry.application.cvUrl || "",
    decision: entry.decision || "",
    department: entry.application.department || "",
    email: entry.application.candidate.email || "",
    finalScore: entry.finalScore,
    id: entry.cardId || `assignment:${entry.assignmentId}`,
    phone: entry.application.candidate.phone || "",
    position: entry.application.position || "",
    receivedAt: entry.application.receivedAt?.toISOString() || "",
    reviewerEmployeeId: entry.reviewerEmployeeId || "",
    reviewerName: entry.reviewerName || "",
    roleKey: entry.roleKey || "",
    roleLabel: entry.roleLabel || "",
    assessmentScopes: assessmentScopesForRole(entry.roleKey),
    roundKey: entry.roundKey,
    roundLabel: entry.roundLabel,
    status: entry.status,
    updatedAt: entry.updatedAt.toISOString(),
    version: entry.version,
  };
}

async function loadAssessmentEntries(
  actor: OperationActor,
  requestedRound?: string,
) {
  const db = getDb();
  const recruitmentAdmin = isRecruitmentAdministrator(actor);
  const [cards, assignments, applications, legacySnapshots] = await Promise.all([
    db.recruitmentScorecard.findMany({
      select: {
        application: { select: queueApplicationSelect },
        assignment: {
          select: {
            interview: { select: { status: true } },
            status: true,
          },
        },
        assignmentId: true,
        decision: true,
        finalScore: true,
        id: true,
        reviewerEmployeeId: true,
        reviewerName: true,
        roleKey: true,
        roleLabel: true,
        roundKey: true,
        roundLabel: true,
        status: true,
        updatedAt: true,
        version: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
    }),
    db.recruitmentAssignment.findMany({
      select: {
        application: { select: queueApplicationSelect },
        applicationId: true,
        id: true,
        interview: { select: { roundLabel: true } },
        reviewerEmployeeId: true,
        reviewerName: true,
        roleKey: true,
        roleLabel: true,
        roundKey: true,
        updatedAt: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 1000,
      where: {
        interview: { status: { not: "cancelled" } },
        status: { notIn: ["cancelled", "legacy_grouped"] },
      },
    }),
    recruitmentAdmin && (!requestedRound || requestedRound === "preliminary")
      ? db.recruitmentApplication.findMany({
          select: queueApplicationSelect,
          orderBy: { updatedAt: "desc" },
          take: 1000,
          where: {
            OR: [
              { status: null },
              {
                status: {
                  notIn: ["ARCHIVED", "archived", "DELETED", "deleted"],
                },
              },
            ],
          },
        })
      : Promise.resolve([]),
    recruitmentAdmin && requestedRound !== "preliminary"
      ? db.recruitmentLegacySnapshot.findMany({
          select: {
            application: { select: queueApplicationSelect },
            applicationId: true,
            createdAt: true,
            id: true,
            kind: true,
            payload: true,
            sourceUpdatedAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1000,
          where: { kind: { in: ["hexaco", "so-van"] } },
        })
      : Promise.resolve([]),
  ]);
  const entries: AssessmentEntry[] = cards
    .filter(
      (card) =>
        card.assignment?.status !== "legacy_grouped" &&
        (recruitmentAdmin ||
          !card.assignment ||
          (card.assignment.status !== "cancelled" &&
            card.assignment.interview.status !== "cancelled")),
    )
    .map((card) => ({
      application: card.application,
      assignmentId: card.assignmentId || "",
      cardId: card.id,
      decision: card.decision,
      finalScore: decimal(card.finalScore),
      reviewerEmployeeId: card.reviewerEmployeeId,
      reviewerName: card.reviewerName,
      roleKey: card.roleKey,
      roleLabel: card.roleLabel,
      roundKey: normalizeRound(card.roundKey),
      roundLabel: card.roundLabel || roundLabel(normalizeRound(card.roundKey)),
      status: card.status,
      updatedAt: card.updatedAt,
      version: card.version,
    }))
    .filter((entry) =>
      canAccessRound(entry.roundKey, actor, entry.reviewerEmployeeId),
    );
  const cardAssignmentIds = new Set(
    cards.map((card) => card.assignmentId).filter(Boolean),
  );
  for (const assignment of assignments) {
    if (cardAssignmentIds.has(assignment.id)) continue;
    const round = normalizeRound(assignment.roundKey);
    if (!canAccessRound(round, actor, assignment.reviewerEmployeeId)) continue;
    entries.push({
      application: assignment.application,
      assignmentId: assignment.id,
      cardId: "",
      decision: null,
      finalScore: null,
      reviewerEmployeeId: assignment.reviewerEmployeeId,
      reviewerName: assignment.reviewerName,
      roleKey: assignment.roleKey,
      roleLabel: assignment.roleLabel,
      roundKey: round,
      roundLabel: assignment.interview.roundLabel || roundLabel(round),
      status: "not-started",
      updatedAt: assignment.updatedAt,
      version: 1,
    });
  }
  const applicationsWithPreliminary = new Set(
    entries
      .filter((entry) => entry.roundKey === "preliminary")
      .map((entry) => entry.application.id),
  );
  for (const application of applications) {
    if (applicationsWithPreliminary.has(application.id)) continue;
    entries.push({
      application,
      assignmentId: `preliminary:${application.id}`,
      cardId: "",
      decision: null,
      finalScore: null,
      reviewerEmployeeId: actor.employeeId || actor.employeeCode || null,
      reviewerName: actor.displayName,
      roleKey: "hr_preliminary",
      roleLabel: "HR sơ vấn",
      roundKey: "preliminary",
      roundLabel: "Sơ vấn",
      status: "not-started",
      updatedAt: application.updatedAt,
      version: 1,
    });
  }
  const applicationsWithRound = new Set(
    entries.map((entry) => `${entry.application.id}|${entry.roundKey}`),
  );
  const snapshotsByApplication = new Map<
    string,
    typeof legacySnapshots
  >();
  for (const snapshot of legacySnapshots) {
    snapshotsByApplication.set(snapshot.applicationId, [
      ...(snapshotsByApplication.get(snapshot.applicationId) || []),
      snapshot,
    ]);
  }
  for (const snapshots of snapshotsByApplication.values()) {
    const application = snapshots[0]?.application;
    if (!application) continue;
    const versions = buildLegacyAssessmentVersions(
      snapshots,
      application.id,
      application.candidateCode || "",
    );
    for (const round of ["round_1", "round_2"] as const) {
      const roundVersions = versions.filter((version) => version.roundKey === round);
      const latest = roundVersions[roundVersions.length - 1];
      const normalizedRound = normalizeRound(round);
      if (!latest || applicationsWithRound.has(`${application.id}|${normalizedRound}`)) {
        continue;
      }
      entries.push({
        application,
        assignmentId: `legacy-round:${application.id}:${normalizedRound}`,
        cardId: "",
        decision: null,
        finalScore:
          latest.finalScore === "" ? null : numberValue(latest.finalScore),
        reviewerEmployeeId: null,
        reviewerName: latest.reviewerName,
        roleKey: "legacy",
        roleLabel: "Người chấm trước đây",
        roundKey: normalizedRound,
        roundLabel: roundLabel(normalizedRound),
        status: "submitted",
        updatedAt: new Date(latest.updatedAt || application.updatedAt),
        version: latest.version,
      });
      applicationsWithRound.add(`${application.id}|${normalizedRound}`);
    }
  }
  return entries.sort(
    (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
  );
}

export async function getCandidateAssessmentQueue(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  const requestedRound = text(payload.round);
  const round =
    requestedRound && requestedRound !== "all"
      ? normalizeRound(requestedRound)
      : requestedRound;
  const all = await loadAssessmentEntries(actor, round);
  let entries = [...all];
  const position = text(payload.position);
  const query = text(payload.query).toLocaleLowerCase("vi");
  const minAge = numberValue(payload.minAge, 16);
  const maxAge = numberValue(payload.maxAge, 80);
  if (round && round !== "all") {
    entries = entries.filter((entry) => entry.roundKey === round);
  }
  if (position) {
    entries = entries.filter(
      (entry) => text(entry.application.position) === position,
    );
  }
  entries = entries.filter((entry) => {
    const age = candidateAge(entry.application.candidate.birthDate);
    if (age != null && (age < minAge || age > maxAge)) return false;
    if (!query) return true;
    return [
      entry.application.candidate.fullName,
      entry.application.candidate.phone,
      entry.application.candidate.email,
      entry.application.candidateCode,
      entry.application.applicationCode,
      entry.application.position,
    ]
      .map(text)
      .join(" ")
      .toLocaleLowerCase("vi")
      .includes(query);
  });
  const statsScope = [...entries];
  const matchedCount = entries.length;
  const limit = Math.max(1, Math.min(100, Math.round(numberValue(payload.limit, 80))));
  entries = entries.slice(0, limit);
  return {
    actor: {
      displayName: actor.displayName,
      employeeCode: actor.employeeCode,
      isAdmin: isRecruitmentAdministrator(actor),
    },
    entries: entries.map(entryForClient),
    positions: Array.from(
      new Set(all.map((entry) => text(entry.application.position)).filter(Boolean)),
    ).sort((left, right) => left.localeCompare(right, "vi")),
    stats: {
      draft: statsScope.filter((entry) => entry.status === "draft").length,
      notStarted: statsScope.filter((entry) => entry.status === "not-started").length,
      shown: matchedCount,
      submitted: statsScope.filter((entry) =>
        ["submitted", "completed", "published"].includes(entry.status),
      ).length,
      total: statsScope.length,
    },
  };
}

async function ensureScorecard(
  actor: OperationActor,
  payload: JsonRecord,
) {
  const db = getDb();
  const recruitmentAdmin = isRecruitmentAdministrator(actor);
  const scorecardId = text(payload.scorecardId || payload.entryId);
  if (scorecardId && !scorecardId.startsWith("assignment:")) {
    const existing = await db.recruitmentScorecard.findUnique({
      include: {
        application: { include: { candidate: true } },
        assignment: { include: { interview: true } },
        items: true,
      },
      where: { id: scorecardId },
    });
    if (!existing) {
      throw new RecruitmentRuntimeError("Không tìm thấy phiếu chấm.", 404);
    }
    const round = normalizeRound(existing.roundKey);
    if (
      !recruitmentAdmin &&
      existing.assignment &&
      (["cancelled", "legacy_grouped"].includes(existing.assignment.status) ||
        existing.assignment.interview.status === "cancelled")
    ) {
      throw new RecruitmentRuntimeError("Phân công phỏng vấn này đã được thu hồi.", 403);
    }
    if (!canAccessRound(round, actor, existing.reviewerEmployeeId)) {
      throw new RecruitmentRuntimeError("Bạn không được phân công phiếu này.", 403);
    }
    return existing;
  }
  const assignmentId =
    text(payload.assignmentId) ||
    scorecardId.replace(/^assignment:/, "");
  if (assignmentId.startsWith("preliminary:")) {
    if (!recruitmentAdmin) {
      throw new RecruitmentRuntimeError(
        "Chỉ HR Admin được mở sơ vấn không cần phân công.",
        403,
      );
    }
    const applicationId = assignmentId.replace(/^preliminary:/, "");
    const application = await db.recruitmentApplication.findUnique({
      include: { candidate: true },
      where: { id: applicationId },
    });
    if (!application) {
      throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
    }
    const existing = await db.recruitmentScorecard.findFirst({
      include: { application: { include: { candidate: true } }, items: true },
      orderBy: { version: "desc" },
      where: {
        applicationId,
        roundKey: { in: ["preliminary", "so_van", "so-khao", "sơ vấn"] },
      },
    });
    if (existing) return existing;
    return db.recruitmentScorecard.create({
      data: {
        applicationId,
        jdPosition: application.position,
        reviewerEmployeeId: actor.employeeId || actor.employeeCode || null,
        reviewerName: actor.displayName,
        roleKey: "hr_preliminary",
        roleLabel: "HR sơ vấn",
        roundKey: "preliminary",
        roundLabel: "Sơ vấn",
        scoringMode: "preliminary",
        status: "draft",
      },
      include: { application: { include: { candidate: true } }, items: true },
    });
  }
  const legacyRoundMatch = assignmentId.match(
    /^legacy-round:(.+):(round1|round2)$/,
  );
  if (legacyRoundMatch) {
    if (!recruitmentAdmin) {
      throw new RecruitmentRuntimeError(
        "Phiếu lịch sử chưa được phân công cho bạn.",
        403,
      );
    }
    const applicationId = legacyRoundMatch[1];
    const round = legacyRoundMatch[2];
    const application = await db.recruitmentApplication.findUnique({
      include: { candidate: true },
      where: { id: applicationId },
    });
    if (!application) {
      throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
    }
    const cards = await db.recruitmentScorecard.findMany({
      include: { application: { include: { candidate: true } }, items: true },
      orderBy: { version: "desc" },
      where: { applicationId },
    });
    const existing = cards.find(
      (card) => normalizeRound(card.roundKey) === round,
    );
    if (existing) return existing;
    return db.recruitmentScorecard.create({
      data: {
        applicationId,
        jdPosition: application.position,
        reviewerEmployeeId: actor.employeeId || actor.employeeCode || null,
        reviewerName: actor.displayName,
        roleKey: "legacy_admin_review",
        roleLabel: "HR Admin",
        roundKey: round,
        roundLabel: roundLabel(round),
        scoringMode: "shared-jd",
        status: "draft",
      },
      include: { application: { include: { candidate: true } }, items: true },
    });
  }
  const assignment = await db.recruitmentAssignment.findUnique({
    include: {
      application: { include: { candidate: true } },
      interview: true,
      scorecards: { include: { items: true } },
    },
    where: { id: assignmentId },
  });
  if (!assignment) {
    throw new RecruitmentRuntimeError("Không tìm thấy phân công đánh giá.", 404);
  }
  const round = normalizeRound(assignment.roundKey);
  if (
    !recruitmentAdmin &&
    (["cancelled", "legacy_grouped"].includes(assignment.status) ||
      assignment.interview.status === "cancelled")
  ) {
    throw new RecruitmentRuntimeError("Phân công phỏng vấn này đã được thu hồi.", 403);
  }
  if (!canAccessRound(round, actor, assignment.reviewerEmployeeId)) {
    throw new RecruitmentRuntimeError("Bạn không được phân công vòng này.", 403);
  }
  if (assignment.scorecards[0]) {
    return db.recruitmentScorecard.findUniqueOrThrow({
      include: { application: { include: { candidate: true } }, items: true },
      where: { id: assignment.scorecards[0].id },
    });
  }
  return db.recruitmentScorecard.create({
    data: {
      applicationId: assignment.applicationId,
      assignmentId: assignment.id,
      interviewId: assignment.interviewId,
      jdPosition: assignment.application.position,
      reviewerEmployeeId: assignment.reviewerEmployeeId,
      reviewerName: assignment.reviewerName,
      roleKey: assignment.roleKey,
      roleLabel: assignment.roleLabel,
      roundKey: round,
      roundLabel: assignment.interview.roundLabel || roundLabel(round),
      scoringMode: round === "preliminary" ? "preliminary" : "shared-jd",
      status: "draft",
    },
    include: { application: { include: { candidate: true } }, items: true },
  });
}

async function loadRecruitmentCultureValues() {
  const records = await getDb().recruitmentConfigRecord.findMany({
    orderBy: { sourceRow: "asc" },
    where: {
      recordType: "recruitment-culture-value",
      status: { in: ["ACTIVE", "active", "published"] },
    },
  });
  return normalizeRecruitmentCultureValues(records);
}

async function loadTemporaryJdForApplication(applicationId: string) {
  const db = getDb();
  const assignment = await db.recruitmentConfigRecord.findFirst({
    orderBy: { updatedAt: "desc" },
    where: {
      code: applicationId,
      recordType: "recruitment-temp-jd-assignment",
      status: { in: ["ACTIVE", "active"] },
    },
  });
  const jdId = text(asRecord(assignment?.content).jdId);
  if (!jdId) return null;
  const record = await db.recruitmentConfigRecord.findFirst({
    where: {
      id: jdId,
      recordType: "recruitment-temp-jd",
      status: { not: "archived" },
    },
  });
  if (!record) return null;
  const content = asRecord(record.content);
  const groups = Array.isArray(content.groups)
    ? content.groups.map((groupValue, groupIndex) => {
        const group = asRecord(groupValue);
        return {
          code: text(group.code) || `temp-group-${groupIndex + 1}`,
          items: Array.isArray(group.items)
            ? group.items.map((itemValue, itemIndex) => {
                const item = asRecord(itemValue);
                return {
                  code: text(item.code) || `temp-item-${groupIndex + 1}-${itemIndex + 1}`,
                  description: text(item.description),
                  name: text(item.name || item.title),
                  weight: Math.max(0, numberValue(item.weight, 1)),
                };
              }).filter((item) => item.name)
            : [],
          name: text(group.name) || `Nhóm công việc ${groupIndex + 1}`,
        };
      }).filter((group) => group.items.length)
    : [];
  return {
    groups,
    id: record.id,
    position: text(content.position),
    source: "temporary-jd",
    sourceLabel: "JD tạm do HR tạo",
    title: record.name || text(content.title) || "JD tạm",
    updatedAt: record.updatedAt.toISOString(),
    version: Math.max(1, numberValue(content.version, 1)),
  };
}

function generatedTemporaryJdItems(
  round: string,
  jd: NonNullable<Awaited<ReturnType<typeof loadTemporaryJdForApplication>>>,
  cultureValues: RecruitmentCultureValue[],
) {
  const cultureItems = generatedItems(round, null, cultureValues).filter(
    (item) => item.sectionKey === "culture",
  );
  if (round === "preliminary") {
    return [
      ...jd.groups.map((group) => ({
        bonusLearning: false,
        bonusTechnical: false,
        criterionId: "",
        criterionName: "",
        evidence: "",
        groupKey: group.code,
        groupName: group.name,
        id: "",
        itemKey: `${group.code}-summary`,
        itemName: group.name,
        level: 0,
        meta: {
          generated: true,
          source: "temporary-jd",
          tempJdId: jd.id,
          tempJdVersion: jd.version,
        },
        note: "",
        score: 0,
        sectionKey: "preliminary",
        weight: 1,
      })),
      ...cultureItems,
    ];
  }
  return [
    ...jd.groups.flatMap((group) =>
      group.items.map((item) => ({
        bonusLearning: false,
        bonusTechnical: false,
        criterionId: item.code,
        criterionName: item.name,
        evidence: "",
        groupKey: group.code,
        groupName: group.name,
        id: "",
        itemKey: item.code,
        itemName: item.name,
        level: null,
        meta: {
          description: item.description,
          generated: true,
          jdSource: "temporary-jd",
          tempJdId: jd.id,
          tempJdVersion: jd.version,
        },
        note: "",
        score: 0,
        sectionKey: "jd",
        weight: item.weight,
      })),
    ),
    ...cultureItems,
  ];
}

function generatedItems(
  round: string,
  jd: Awaited<ReturnType<typeof resolveSharedJdsForPositions>>[number] | null,
  cultureValues: RecruitmentCultureValue[],
) {
  const cultureItems = cultureValues.map((value) => ({
    bonusLearning: false,
    bonusTechnical: false,
    criterionId: "",
    criterionName: "",
    evidence: "",
    groupKey: "culture",
    groupName: "Giá trị văn hóa",
    id: "",
    itemKey: value.gtKey,
    itemName: value.gtName,
    level: null,
    meta: {
      chips: value.chips.map((chip) => ({ ...chip, state: 0 })),
      generated: true,
      scaleMax: 10,
    },
    note: "",
    score: 0,
    sectionKey: "culture",
    weight: 1,
  }));
  if (round === "preliminary") {
    const groups = jd?.workGroups.length
      ? jd.workGroups
      : [
          { code: "experience", name: "Kinh nghiệm phù hợp", content: {} },
          { code: "knowledge", name: "Kiến thức chuyên môn", content: {} },
          { code: "capability", name: "Năng lực thực hiện", content: {} },
          { code: "fit", name: "Mức độ phù hợp", content: {} },
        ];
    const preliminaryItems = groups.map((group, index) => ({
      bonusLearning: false,
      bonusTechnical: false,
      criterionId: "",
      criterionName: "",
      evidence: "",
      groupKey: text(group.code) || `preliminary-${index + 1}`,
      groupName: text(group.name) || `Nhóm ${index + 1}`,
      id: "",
      itemKey: text(group.code) || `preliminary-${index + 1}`,
      itemName: text(group.name) || `Nhóm ${index + 1}`,
      level: 0,
      meta: { generated: true, source: jd?.source || "default" },
      note: "",
      score: 0,
      sectionKey: "preliminary",
      weight: 1,
    }));
    return [...preliminaryItems, ...cultureItems];
  }
  const sourceItems = jd?.activities.length
    ? jd.activities
    : jd?.legacyOutputs || [];
  const jdItems = sourceItems.map((activity, index) => {
    const content = asRecord(activity.content);
    return {
      bonusLearning: false,
      bonusTechnical: false,
      criterionId: text(activity.id || activity.code),
      criterionName: text(activity.name),
      evidence: "",
      groupKey: text(
        content.workGroupId ||
          content.groupKey ||
          activity.parentId ||
          `jd-group-${index + 1}`,
      ),
      groupName: text(
        content.workGroupName || content.groupName || "Nội dung JD",
      ),
      id: "",
      itemKey: text(activity.code || activity.id) || `jd-item-${index + 1}`,
      itemName:
        text(
          activity.name ||
            content.activityName ||
            content.OutputName ||
            content.Output,
        ) || `Đầu ra ${index + 1}`,
      level: null,
      meta: {
        generated: true,
        jdDocumentId: jd?.document?.id || "",
        jdSource: jd?.source || "none",
      },
      note: "",
      score: 0,
      sectionKey: "jd",
      weight: numberValue(content.weight, 1),
    };
  });
  return [...jdItems, ...cultureItems];
}

async function resolveRecruitmentCriteriaSet(
  application: {
    campaignId: string | null;
    department: string | null;
    position: string | null;
    requisitionCode: string | null;
  },
  round: string,
  jd: Awaited<ReturnType<typeof resolveSharedJdsForPositions>>[number] | null,
) {
  const db = getDb();
  const [records, campaign, sharedRecords, scoreDefinitionRows] =
    await Promise.all([
    db.recruitmentConfigRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: {
        recordType: { in: SCORING_CONFIG_TYPES },
        status: { in: ["published", "active"] },
      },
    }),
    application.campaignId
      ? db.recruitmentCampaign.findUnique({
          select: { team: true },
          where: { id: application.campaignId },
        })
      : Promise.resolve(null),
    db.evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: {
        recordType: {
          in: [
            "evaluation-criteria",
            "evaluation-criteria-set",
            "evaluation-criteria-set-item",
          ],
        },
      },
    }),
    db.evaluationRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: {
        recordType: "evaluation-criteria-score",
        status: { in: ["active", "published"] },
      },
    }),
  ]);
  const sets = records.filter(
    (record) => record.recordType === "recruitment-score-set",
  );
  const scopes = records.filter(
    (record) => record.recordType === "recruitment-score-scope-mapping",
  );
  const roundMappings = records.filter(
    (record) => record.recordType === "recruitment-score-round-mapping",
  );
  const jdKeys = new Set(
    [
      jd?.document?.id,
      jd?.document?.code,
      jd?.title,
      jd?.fileName,
      application.position,
    ]
      .map(text)
      .filter(Boolean),
  );
  const scopePriority: Record<string, number> = {
    department: 2,
    global: 1,
    jd: 4,
    position: 4,
    requisition: 5,
    team: 3,
  };
  const matchingScopes = scopes
    .filter((record) => {
      const content = asRecord(record.content);
      const mappingRound = text(content.roundKey);
      if (mappingRound && normalizeRound(mappingRound) !== round) return false;
      const type = text(content.scopeType).toLowerCase() || "global";
      const value = text(content.scopeValue);
      if (type === "global") return true;
      if (type === "requisition") {
        return value === text(application.requisitionCode);
      }
      if (type === "jd" || type === "position") return jdKeys.has(value);
      if (type === "team") return value === text(campaign?.team);
      if (type === "department") {
        return value === text(application.department);
      }
      return false;
    })
    .sort(
      (left, right) =>
        (scopePriority[text(asRecord(right.content).scopeType)] || 0) -
          (scopePriority[text(asRecord(left.content).scopeType)] || 0) ||
        right.updatedAt.getTime() - left.updatedAt.getTime(),
    );
  const mappedSetId =
    text(asRecord(matchingScopes[0]?.content).criteriaSetId) ||
    text(
      asRecord(
        roundMappings.find(
          (record) =>
            normalizeRound(asRecord(record.content).roundKey) === round,
        )?.content,
      ).criteriaSetId,
    );
  const sharedSets = sharedRecords.filter(
    (record) =>
      record.recordType === "evaluation-criteria-set" &&
      ["active", "published"].includes(text(record.status).toLowerCase()),
  );
  const sharedSetItems = sharedRecords.filter(
    (record) =>
      record.recordType === "evaluation-criteria-set-item" &&
      ["active", "published"].includes(text(record.status).toLowerCase()),
  );
  const sharedCriteria = sharedRecords.filter(
    (record) =>
      record.recordType === "evaluation-criteria" &&
      ["active", "published"].includes(text(record.status).toLowerCase()),
  );
  const recordMatches = (
    record: { id: string; code: string | null; content: unknown },
    reference: string,
  ) => {
    const content = asRecord(record.content);
    return [
      record.id,
      record.code,
      content.id,
      content.code,
      content.criteriaSetId,
      content.criteriaSetCode,
      content.criteriaId,
      content.criteriaCode,
    ]
      .map(text)
      .filter(Boolean)
      .includes(reference);
  };
  const ownSelected =
    sets.find((record) => recordMatches(record, mappedSetId)) || null;
  const sharedSelected =
    sharedSets.find((record) => recordMatches(record, mappedSetId)) || null;
  let selectedSet: {
    code: string;
    content: JsonRecord;
    id: string;
    name: string;
    source: "recruitment" | "shared" | "applied-evaluation";
  } | null = ownSelected
    ? {
        code: ownSelected.code || "",
        content: asRecord(ownSelected.content),
        id: ownSelected.id,
        name: ownSelected.name || "",
        source: "recruitment",
      }
    : sharedSelected
      ? {
          code: sharedSelected.code || "",
          content: asRecord(sharedSelected.content),
          id: sharedSelected.id,
          name: sharedSelected.name || "",
          source: "shared",
        }
      : null;
  let lines: JsonRecord[] = selectedSet
    ? selectedSet.source === "recruitment"
      ? Array.isArray(selectedSet.content.items)
        ? selectedSet.content.items.map(asRecord)
        : []
      : sharedSetItems
          .filter((record) => {
            const content = asRecord(record.content);
            return [
              record.parentId,
              content.criteriaSetId,
              content.criteriaSetCode,
            ]
              .map(text)
              .filter(Boolean)
              .some((reference) =>
                [selectedSet?.id, selectedSet?.code, selectedSet?.content.id]
                  .map(text)
                  .includes(reference),
              );
          })
          .sort(
            (left, right) =>
              numberValue(asRecord(left.content).sortOrder) -
              numberValue(asRecord(right.content).sortOrder),
          )
          .map((record) => ({
            ...asRecord(record.content),
            criterionId: text(
              asRecord(record.content).criteriaId ||
                asRecord(record.content).criteriaCode,
            ),
            name: record.name || text(asRecord(record.content).criteriaName),
          }))
    : [];

  if (!selectedSet || !lines.length) {
    const jdReferences = new Set(
      [
        jd?.document?.id,
        jd?.document?.code,
        jd?.document?.legacyId,
        asRecord(jd?.document?.content).id,
        asRecord(jd?.document?.content).jdDocumentId,
        jd?.fileName,
        jd?.title,
        application.position,
      ]
        .map((value) => normalizeLookup(text(value)))
        .filter(Boolean),
    );
    const grouped = new Map<string, typeof scoreDefinitionRows>();
    for (const record of scoreDefinitionRows) {
      const content = asRecord(record.content);
      const setKey = text(content.criteriaSetCode || content.criteriaSetId);
      if (!setKey) continue;
      grouped.set(setKey, [...(grouped.get(setKey) || []), record]);
    }
    const managerialPosition = /(quản lý|trưởng|phó|giám đốc|manager|leader)/i.test(
      application.position || "",
    );
    const applied = Array.from(grouped.entries())
      .map(([setKey, rows]) => {
        const directMatches = rows.filter((record) => {
          const content = asRecord(record.content);
          return [
            content.jdDocumentId,
            content.jdFileName,
            content.jdJobTitleCode,
            content.jdJobTitleName,
          ]
            .map((value) => normalizeLookup(text(value)))
            .filter(Boolean)
            .some((reference) => jdReferences.has(reference));
        }).length;
        const normalizedSet = normalizeLookup(setKey);
        const roleFit = managerialPosition
          ? normalizedSet.includes("quan ly")
          : normalizedSet.includes("staff") || normalizedSet.includes("nhan vien");
        return { directMatches, roleFit: Number(roleFit), rows, setKey };
      })
      .sort(
        (left, right) =>
          right.directMatches - left.directMatches ||
          right.roleFit - left.roleFit ||
          right.rows.length - left.rows.length,
      )[0];
    if (applied) {
      const firstContent = asRecord(applied.rows[0]?.content);
      selectedSet = {
        code: applied.setKey,
        content: firstContent,
        id: `applied-evaluation:${applied.setKey}`,
        name:
          text(firstContent.criteriaSetName) ||
          "Bộ tiêu chí đánh giá dùng chung",
        source: "applied-evaluation",
      };
      const criterionGroups = new Map<string, typeof applied.rows>();
      for (const record of applied.rows) {
        const content = asRecord(record.content);
        const criterionKey = text(content.criteriaCode || content.criteriaId);
        if (!criterionKey) continue;
        criterionGroups.set(criterionKey, [
          ...(criterionGroups.get(criterionKey) || []),
          record,
        ]);
      }
      const weightedCriteria = Array.from(criterionGroups.entries()).map(
        ([criterionId, rows]) => {
          const content = asRecord(rows[0]?.content);
          const configuredSetItem = sharedSetItems.find((record) => {
            const item = asRecord(record.content);
            return (
              [item.criteriaSetCode, item.criteriaSetId]
                .map(text)
                .includes(applied.setKey) &&
              [item.criteriaCode, item.criteriaId]
                .map(text)
                .includes(criterionId)
            );
          });
          return {
            criterionId,
            description: text(content.description),
            groupName:
              text(content.scoreGroupName) ||
              text(firstContent.scoreGroupName) ||
              "Chuyên môn",
            name: text(content.criteriaName) || rows[0]?.name || criterionId,
            sortOrder: numberValue(
              asRecord(configuredSetItem?.content).sortOrder ||
                content.criteriaId,
              999,
            ),
            weight: rows.reduce(
              (total, row) =>
                total + numberValue(asRecord(row.content).weightPercent, 1),
              0,
            ),
          };
        },
      ).sort(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name, "vi"),
      );
      const totalWeight = weightedCriteria.reduce(
        (total, criterion) => total + criterion.weight,
        0,
      );
      lines = weightedCriteria.map((criterion) => ({
        ...criterion,
        weight: totalWeight > 0 ? (criterion.weight / totalWeight) * 100 : 1,
      }));
    }
  }
  if (!selectedSet || !lines.length) return null;

  const criterionIds = lines
    .flatMap((line) => [line.criterionId, line.criteriaId, line.criteriaCode])
    .map(text)
    .filter(Boolean);
  const ownCriteria = await db.recruitmentConfigRecord.findMany({
    where: {
      OR: [{ id: { in: criterionIds } }, { code: { in: criterionIds } }],
      recordType: "recruitment-score-criterion",
    },
  });
  const criteria = [...ownCriteria, ...sharedCriteria];
  const items = lines.map((line, index) => {
    const criterionId = text(
      line.criterionId || line.criteriaId || line.criteriaCode,
    );
    const criterion = criteria.find((record) =>
      recordMatches(record, criterionId),
    );
    const criterionContent = asRecord(criterion?.content);
    return {
      bonusLearning: false,
      bonusTechnical: false,
      criterionId,
      criterionName:
        criterion?.name || text(line.name || line.criteriaName) || criterionId,
      description: text(line.description || criterionContent.description),
      evidence: "",
      groupKey: text(criterionContent.groupId || line.groupId) || "criteria",
      groupName:
        text(criterionContent.groupName || line.groupName) || "Bộ tiêu chí",
      id: "",
      itemKey: criterion?.code || criterionId || `criterion-${index + 1}`,
      itemName:
        criterion?.name ||
        text(line.name || line.criteriaName) ||
        `Tiêu chí ${index + 1}`,
      level: null,
      meta: {
        criteriaSetId: selectedSet.id,
        criteriaSetName: selectedSet.name,
        generated: true,
        scaleMax: numberValue(
          criterionContent.scaleMax || line.scaleMax,
          10,
        ),
      },
      note: "",
      score: 0,
      sectionKey: "criteria",
      weight: numberValue(line.weight || line.weightPercent, 1),
    };
  });
  return {
    code: selectedSet.code,
    id: selectedSet.id,
    items,
    name: selectedSet.name,
    scopeType:
      text(asRecord(matchingScopes[0]?.content).scopeType) ||
      (selectedSet.source === "applied-evaluation"
        ? "shared-evaluation"
        : "round"),
  };
}

export async function openCandidateAssessment(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  const db = getDb();
  const card = await ensureScorecard(actor, payload);
  const round = normalizeRound(card.roundKey);
  const position = card.application.position || card.jdPosition || "";
  const jd = (await resolveSharedJdsForPositions([position]))[0] || null;
  const [
    previousCards,
    snapshots,
    publication,
    criteriaSet,
    cultureValues,
    personalityConfigs,
    interview,
    temporaryJd,
  ] = await Promise.all([
    db.recruitmentScorecard.findMany({
      include: { items: true },
      orderBy: [{ roundKey: "asc" }, { version: "desc" }],
      where: { applicationId: card.applicationId, id: { not: card.id } },
    }),
    db.recruitmentLegacySnapshot.findMany({
      orderBy: { createdAt: "desc" },
      where: { applicationId: card.applicationId },
    }),
    db.recruitmentPublication.findUnique({
      where: { applicationId: card.applicationId },
    }),
    resolveRecruitmentCriteriaSet(card.application, round, jd),
    loadRecruitmentCultureValues(),
    db.recruitmentConfigRecord.findMany({
      orderBy: { sourceRow: "asc" },
      where: {
        recordType: {
          in: ["scoring-personality-base", "scoring-personality-profile"],
        },
        status: { in: ["ACTIVE", "active", "published"] },
      },
    }),
    card.interviewId
      ? db.recruitmentInterview.findUnique({
          select: {
            id: true,
            location: true,
            meetingLink: true,
            note: true,
            startAt: true,
            status: true,
          },
          where: { id: card.interviewId },
        })
      : db.recruitmentInterview.findFirst({
          orderBy: [{ startAt: "desc" }, { updatedAt: "desc" }],
          select: {
            id: true,
            location: true,
            meetingLink: true,
            note: true,
            startAt: true,
            status: true,
          },
          where: {
            applicationId: card.applicationId,
            roundKey: { in: Array.from(new Set([round, legacyRoundKey(round)])) },
          },
        }),
    loadTemporaryJdForApplication(card.applicationId),
  ]);
  const jdItems = temporaryJd
    ? generatedTemporaryJdItems(round, temporaryJd, cultureValues)
    : generatedItems(round, jd, cultureValues);
  const unscopedInitialItems =
    card.items.length
      ? card.items.map(scoreItemForClient)
      : card.scoringMode === "criteria" && criteriaSet
        ? criteriaSet.items
        : jdItems;
  const initialItems = filterItemsForRole(unscopedInitialItems, card.roleKey);
  return {
    application: {
      applicationCode: card.application.applicationCode,
      applicationId: card.application.id,
      candidateCode: card.application.candidateCode || "",
      candidateName: card.application.candidate.fullName,
      cvUrl: card.application.cvUrl || "",
      department: card.application.department || "",
      email: card.application.candidate.email || "",
      phone: card.application.candidate.phone || "",
      position,
      source: card.application.source || "",
    },
    card: {
      ...scorecardForClient(card),
      items: initialItems,
    },
    assessmentScopes: assessmentScopesForRole(card.roleKey),
    criteriaSet,
    cultureValues,
    jd: temporaryJd
      ? {
          activityCount: temporaryJd.groups.reduce(
            (sum, group) => sum + group.items.length,
            0,
          ),
          fileName: "",
          fileUrl: "",
          source: temporaryJd.source,
          sourceLabel: temporaryJd.sourceLabel,
          title: temporaryJd.title,
          workGroupCount: temporaryJd.groups.length,
        }
      : jd
      ? {
          activityCount: jd.activityCount,
          fileName: jd.fileName,
          fileUrl: jd.fileUrl,
          source: jd.source,
          sourceLabel: jd.sourceLabel,
          title: jd.title,
          workGroupCount: jd.workGroupCount,
        }
      : null,
    personality: snapshots
      .filter((snapshot) =>
        ["hexaco", "candidate-result", "so-van"].includes(snapshot.kind),
      )
      .map((snapshot) => ({
        createdAt: snapshot.createdAt.toISOString(),
        id: snapshot.id,
        kind: snapshot.kind,
        payload: asRecord(snapshot.payload),
        sourceUpdatedAt: snapshot.sourceUpdatedAt?.toISOString() || "",
      })),
    normalizedPersonality: normalizeHexacoPersonality(
      snapshots.find((snapshot) => snapshot.kind === "hexaco")?.payload,
      personalityConfigs.filter(
        (record) => record.recordType === "scoring-personality-base",
      ),
      personalityConfigs.filter(
        (record) => record.recordType === "scoring-personality-profile",
      ),
    ),
    previousCards: previousCards
      .filter((previousCard) =>
        canViewRecruitmentAssessmentHistory(actor, previousCard, round),
      )
      .map(scorecardForClient),
    publication: publication
      ? {
          expiresAt: publication.expiresAt?.toISOString() || "",
          publicStatus: publication.publicStatus || "",
          status: publication.status,
        }
      : null,
    scoringOptions: {
      criteriaItems: criteriaSet?.items || [],
      jdItems,
    },
    session: interview
      ? {
          id: interview.id,
          location: interview.location || "",
          meetingLink: interview.meetingLink || "",
          note: interview.note || "",
          startAt: interview.startAt?.toISOString() || "",
          status: interview.status,
        }
      : { startAt: "" },
  };
}

type IncomingScoreItem = ReturnType<typeof scoreItemForClient>;

function normalizeIncomingItems(value: unknown) {
  if (!Array.isArray(value)) {
    throw new RecruitmentRuntimeError("Phiếu chấm chưa có nội dung.");
  }
  return value.map((raw, index): IncomingScoreItem => {
    const item = asRecord(raw);
    const itemMeta = asRecord(item.meta);
    const cultureChips = Array.isArray(itemMeta.chips) ? itemMeta.chips : [];
    const sectionKey = text(item.sectionKey);
    const level =
      item.level == null || text(item.level) === ""
        ? null
        : Math.round(numberValue(item.level));
    const score = numberValue(item.score);
    if (sectionKey === "preliminary" && (level == null || level < 0 || level > 5)) {
      throw new RecruitmentRuntimeError(
        `Mức đánh giá ở dòng ${index + 1} phải từ 0 đến 5.`,
      );
    }
    if (sectionKey === "culture" && (score < 0 || score > 10)) {
      throw new RecruitmentRuntimeError(
        `Điểm văn hóa ở dòng ${index + 1} phải từ 0 đến 10.`,
      );
    }
    if (
      !["preliminary", "culture"].includes(sectionKey) &&
      (score < 0 || score > 10)
    ) {
      throw new RecruitmentRuntimeError(
        `Điểm ở dòng ${index + 1} phải từ 0 đến 10.`,
      );
    }
    return {
      bonusLearning: booleanValue(item.bonusLearning),
      bonusTechnical: booleanValue(item.bonusTechnical),
      criterionId: text(item.criterionId),
      criterionName: text(item.criterionName),
      evidence: text(item.evidence),
      groupKey: text(item.groupKey),
      groupName: text(item.groupName),
      id: text(item.id),
      itemKey: text(item.itemKey) || `item-${index + 1}`,
      itemName: text(item.itemName) || `Tiêu chí ${index + 1}`,
      level,
      meta:
        sectionKey === "culture"
          ? {
              ...itemMeta,
              chips: cultureChips.map((rawChip: unknown) => {
                const chip = asRecord(rawChip);
                return {
                  code: text(chip.code),
                  label: text(chip.label),
                  state: Math.max(
                    0,
                    Math.min(3, Math.round(numberValue(chip.state))),
                  ),
                };
              }),
            }
          : itemMeta,
      note: text(item.note),
      score,
      sectionKey,
      weight: Math.max(numberValue(item.weight, 1), 0),
    };
  });
}

function calculateFinalScore(items: IncomingScoreItem[]) {
  return calculateRecruitmentScore(items);
}

export async function saveCandidateAssessment(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  const db = getDb();
  const card = await ensureScorecard(actor, {
    scorecardId: payload.scorecardId,
  });
  if (["submitted", "completed", "published"].includes(card.status)) {
    throw new RecruitmentRuntimeError(
      "Phiếu đã nộp và đang khóa. Hãy tạo phiên bản chấm lại.",
      409,
    );
  }
  const submit = booleanValue(payload.submit);
  const decision = text(payload.decision).toLowerCase();
  if (submit && !["pass", "consider", "fail"].includes(decision)) {
    throw new RecruitmentRuntimeError(
      "Vui lòng chọn kết luận Đạt, Cân nhắc hoặc Không đạt trước khi nộp.",
    );
  }
  const items = filterItemsForRole(
    normalizeIncomingItems(payload.items),
    card.roleKey,
  );
  if (!items.length) {
    throw new RecruitmentRuntimeError(
      "Phiếu chưa có nội dung thuộc phần đánh giá được phân công.",
    );
  }
  const finalScore = calculateFinalScore(items);
  const status = submit ? "submitted" : "draft";
  const result = await db.$transaction(async (tx) => {
    await tx.recruitmentScoreItem.deleteMany({
      where: { scorecardId: card.id },
    });
    await tx.recruitmentScoreItem.createMany({
      data: items.map((item) => ({
        bonusLearning: item.bonusLearning,
        bonusTechnical: item.bonusTechnical,
        criterionId: item.criterionId || null,
        criterionName: item.criterionName || null,
        evidence: item.evidence || null,
        groupKey: item.groupKey || null,
        groupName: item.groupName || null,
        itemKey: item.itemKey || null,
        itemName: item.itemName || null,
        level: item.level,
        meta: json(item.meta),
        note: item.note || null,
        score: item.score,
        scorecardId: card.id,
        sectionKey: item.sectionKey || null,
        weight: item.weight,
      })),
    });
    const updated = await tx.recruitmentScorecard.update({
      data: {
        criteriaSetId: text(payload.criteriaSetId) || null,
        criteriaSetName: text(payload.criteriaSetName) || null,
        decision: decision || null,
        finalScore,
        overallComment: text(payload.overallComment) || null,
        scoringMode: text(payload.scoringMode) || card.scoringMode,
        status,
        submittedAt: submit ? new Date() : null,
      },
      include: { items: true },
      where: { id: card.id },
    });
    if (card.assignmentId) {
      await tx.recruitmentAssignment.update({
        data: { status },
        where: { id: card.assignmentId },
      });
    }
    await tx.recruitmentTimeline.create({
      data: {
        actorEmployeeId: actor.employeeId || actor.employeeCode || null,
        actorName: actor.displayName,
        applicationId: card.applicationId,
        detail: `${card.roundLabel} · ${finalScore}/10`,
        eventType: submit ? "assessment-submitted" : "assessment-draft-saved",
        title: submit ? "Đã nộp phiếu đánh giá" : "Đã lưu nháp phiếu đánh giá",
        toValue: status,
      },
    });
    return updated;
  });
  return scorecardForClient(result);
}

export async function createCandidateAssessmentRevision(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  const db = getDb();
  const source = await db.recruitmentScorecard.findUnique({
    include: { items: true },
    where: { id: text(payload.scorecardId) },
  });
  if (!source) {
    throw new RecruitmentRuntimeError("Không tìm thấy phiếu gốc.", 404);
  }
  const round = normalizeRound(source.roundKey);
  if (!canAccessRound(round, actor, source.reviewerEmployeeId)) {
    throw new RecruitmentRuntimeError("Bạn không được chấm lại phiếu này.", 403);
  }
  const latest = await db.recruitmentScorecard.findFirst({
    orderBy: { version: "desc" },
    where: {
      applicationId: source.applicationId,
      reviewerEmployeeId: source.reviewerEmployeeId,
      roundKey: source.roundKey,
    },
  });
  const revision = await db.recruitmentScorecard.create({
    data: {
      applicationId: source.applicationId,
      assignmentId: source.assignmentId,
      criteriaSetId: source.criteriaSetId,
      criteriaSetName: source.criteriaSetName,
      editRevision: source.editRevision + 1,
      interviewId: source.interviewId,
      items: {
        create: source.items.map((item) => ({
          bonusLearning: item.bonusLearning,
          bonusTechnical: item.bonusTechnical,
          criterionId: item.criterionId,
          criterionName: item.criterionName,
          evidence: item.evidence,
          groupKey: item.groupKey,
          groupName: item.groupName,
          itemKey: item.itemKey,
          itemName: item.itemName,
          level: item.level,
          meta: json(asRecord(item.meta)),
          note: item.note,
          score: item.score,
          sectionKey: item.sectionKey,
          weight: item.weight,
        })),
      },
      jdPosition: source.jdPosition,
      reviewerEmployeeId: source.reviewerEmployeeId,
      reviewerName: source.reviewerName,
      roleKey: source.roleKey,
      roleLabel: source.roleLabel,
      roundKey: source.roundKey,
      roundLabel: source.roundLabel,
      scoringMode: source.scoringMode,
      status: "draft",
      version: (latest?.version || source.version) + 1,
    },
    include: { items: true },
  });
  await db.recruitmentTimeline.create({
    data: {
      actorEmployeeId: actor.employeeId || actor.employeeCode || null,
      actorName: actor.displayName,
      applicationId: source.applicationId,
      detail: `Phiếu ${source.roundLabel} · phiên bản ${revision.version}`,
      eventType: "assessment-revision-created",
      title: "Đã tạo phiên bản chấm lại",
      toValue: String(revision.version),
    },
  });
  return scorecardForClient(revision);
}

function publicationForClient(publication: {
  accessToken: string;
  status: string;
  publicStatus: string | null;
  summary: string | null;
  strengths: string | null;
  development: string | null;
  publishedScore: Prisma.Decimal | null;
  roundVersions: unknown;
  publishedAt: Date | null;
  publishedByName: string | null;
  expiresAt: Date | null;
}) {
  return {
    accessToken: publication.accessToken,
    development: publication.development || "",
    expiresAt: publication.expiresAt?.toISOString() || "",
    publicStatus: publication.publicStatus || "",
    publishedAt: publication.publishedAt?.toISOString() || "",
    publishedByName: publication.publishedByName || "",
    publishedScore: decimal(publication.publishedScore),
    roundVersions: asRecord(publication.roundVersions),
    status: publication.status,
    strengths: publication.strengths || "",
    summary: publication.summary || "",
  };
}

export async function getCandidateResultsCenter(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-results", "view");
  const query = text(payload.query).toLocaleLowerCase("vi");
  const db = getDb();
  const applications = await db.recruitmentApplication.findMany({
    include: {
      candidate: true,
      publication: true,
      scorecards: {
        include: { items: true },
        orderBy: [{ roundKey: "asc" }, { version: "desc" }],
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 800,
    where: { scorecards: { some: {} } },
  });
  const filtered = applications.filter((application) => {
    if (!query) return true;
    return [
      application.applicationCode,
      application.candidateCode,
      application.candidate.fullName,
      application.position,
      application.candidate.phone,
    ]
      .map(text)
      .join(" ")
      .toLocaleLowerCase("vi")
      .includes(query);
  });
  return {
    applications: filtered.map((application) => {
      const latestByRound = new Map<string, (typeof application.scorecards)[number]>();
      for (const card of application.scorecards) {
        const round = normalizeRound(card.roundKey);
        if (!latestByRound.has(round)) latestByRound.set(round, card);
      }
      const scores = Array.from(latestByRound.values())
        .map((card) => decimal(card.finalScore))
        .filter((value): value is number => value != null);
      return {
        applicationCode: application.applicationCode,
        applicationId: application.id,
        candidateCode: application.candidateCode || "",
        candidateName: application.candidate.fullName,
        overallScore: scores.length
          ? Math.round(
              (scores.reduce((sum, value) => sum + value, 0) / scores.length) *
                100,
            ) / 100
          : null,
        position: application.position || "",
        publicationStatus: application.publication?.status || "",
        rounds: Array.from(latestByRound.values()).map(scorecardForClient),
        updatedAt: application.updatedAt.toISOString(),
      };
    }),
    stats: {
      candidates: applications.length,
      decisions: applications.filter((application) =>
        application.scorecards.some((card) => card.decision),
      ).length,
      published: applications.filter(
        (application) => application.publication?.status === "published",
      ).length,
      submittedCards: applications.reduce(
        (total, application) =>
          total +
          application.scorecards.filter((card) =>
            ["submitted", "completed", "published"].includes(card.status),
          ).length,
        0,
      ),
    },
  };
}

export async function getCandidateResultReport(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-results", "view");
  const db = getDb();
  const application = await db.recruitmentApplication.findUnique({
    include: {
      candidate: true,
      publication: true,
      scorecards: {
        include: { items: true },
        orderBy: [{ roundKey: "asc" }, { version: "desc" }],
      },
      legacySnapshots: { orderBy: { createdAt: "desc" } },
      timeline: { orderBy: { createdAt: "desc" } },
    },
    where: { id: text(payload.applicationId) },
  });
  if (!application) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  return {
    application: {
      applicationCode: application.applicationCode,
      applicationId: application.id,
      candidateCode: application.candidateCode || "",
      candidateName: application.candidate.fullName,
      department: application.department || "",
      email: application.candidate.email || "",
      phone: application.candidate.phone || "",
      position: application.position || "",
    },
    personality: application.legacySnapshots
      .filter((snapshot) =>
        ["hexaco", "candidate-result", "so-van"].includes(snapshot.kind),
      )
      .map((snapshot) => ({
        id: snapshot.id,
        kind: snapshot.kind,
        payload: asRecord(snapshot.payload),
      })),
    publication: application.publication
      ? publicationForClient(application.publication)
      : null,
    scorecards: application.scorecards.map(scorecardForClient),
    timeline: application.timeline.map((event) => ({
      actorName: event.actorName || "",
      createdAt: event.createdAt.toISOString(),
      detail: event.detail || "",
      eventType: event.eventType,
      id: event.id,
      title: event.title,
    })),
  };
}

export async function publishCandidateResult(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-results", "edit");
  const applicationId = text(payload.applicationId);
  const db = getDb();
  const application = await db.recruitmentApplication.findUnique({
    include: {
      legacySnapshots: {
        orderBy: { createdAt: "desc" },
        where: { kind: { in: ["hexaco", "so-van"] } },
      },
      scorecards: {
        include: { items: true },
        orderBy: [{ version: "desc" }],
      },
    },
    where: { id: applicationId },
  });
  if (!application) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  const legacyVersions = buildLegacyAssessmentVersions(
    application.legacySnapshots,
    application.id,
    application.candidateCode || "",
  );
  const rounds = resultRoundBundle(
    application.scorecards.map(scorecardForClient),
    legacyVersions,
    payload.roundVersions,
  );
  const scoredRounds = rounds.filter(
    (round) => recruitmentResultScore(round.score) != null,
  );
  if (!scoredRounds.length) {
    throw new RecruitmentRuntimeError(
      "Cần ít nhất một phiếu đã hoàn tất trước khi công bố.",
    );
  }
  const scores = scoredRounds
    .map((round) => recruitmentResultScore(round.score))
    .filter((score): score is number => score != null);
  const selectedRoundVersions = Object.fromEntries(
    rounds.map((round) => [round.key, round.selectedSources]),
  );
  const showScore = booleanValue(payload.showScore);
  const publishedScore =
    showScore && scores.length
      ? Math.round(
          (scores.reduce((sum, value) => sum + value, 0) / scores.length) *
            100,
        ) / 100
      : null;
  const expiresAtText = text(payload.expiresAt);
  const expiresAt = expiresAtText ? new Date(expiresAtText) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    throw new RecruitmentRuntimeError("Ngày hết hạn không hợp lệ.");
  }
  const publication = await db.recruitmentPublication.upsert({
    create: {
      accessToken: randomUUID().replaceAll("-", ""),
      applicationId,
      development: text(payload.development) || null,
      expiresAt,
      publicStatus: text(payload.publicStatus) || null,
      publishedAt: new Date(),
      publishedByName: actor.displayName,
      publishedScore,
      roundVersions: json(selectedRoundVersions),
      status: "published",
      strengths: text(payload.strengths) || null,
      summary: text(payload.summary) || null,
    },
    update: {
      development: text(payload.development) || null,
      expiresAt,
      publicStatus: text(payload.publicStatus) || null,
      publishedAt: new Date(),
      publishedByName: actor.displayName,
      publishedScore,
      roundVersions: json(selectedRoundVersions),
      status: "published",
      strengths: text(payload.strengths) || null,
      summary: text(payload.summary) || null,
    },
    where: { applicationId },
  });
  await db.recruitmentTimeline.create({
    data: {
      actorEmployeeId: actor.employeeId || actor.employeeCode || null,
      actorName: actor.displayName,
      applicationId,
      eventType: "result-published",
      title: "Đã công bố kết quả đánh giá",
      toValue: "published",
    },
  });
  return publicationForClient(publication);
}

export async function revokeCandidateResult(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-results", "delete");
  const applicationId = text(payload.applicationId);
  const db = getDb();
  const publication = await db.recruitmentPublication.findUnique({
    where: { applicationId },
  });
  if (!publication) {
    throw new RecruitmentRuntimeError("Ứng viên chưa có bản công bố.", 404);
  }
  const updated = await db.recruitmentPublication.update({
    data: { status: "revoked" },
    where: { applicationId },
  });
  await db.recruitmentTimeline.create({
    data: {
      actorEmployeeId: actor.employeeId || actor.employeeCode || null,
      actorName: actor.displayName,
      applicationId,
      eventType: "result-revoked",
      title: "Đã thu hồi kết quả công khai",
      toValue: "revoked",
    },
  });
  return publicationForClient(updated);
}

export async function getPublicCandidateResult(token: string) {
  const db = getDb();
  const publication = await db.recruitmentPublication.findUnique({
    include: {
      application: {
        include: {
          candidate: true,
          legacySnapshots: {
            orderBy: { createdAt: "desc" },
            where: { kind: { in: ["hexaco", "so-van"] } },
          },
          scorecards: {
            include: { items: true },
            orderBy: [{ roundKey: "asc" }, { version: "desc" }],
          },
        },
      },
    },
    where: { accessToken: token },
  });
  if (
    !publication ||
    publication.status !== "published" ||
    (publication.expiresAt && publication.expiresAt.getTime() < Date.now())
  ) {
    return null;
  }
  const roundVersions = asRecord(publication.roundVersions);
  const legacyVersions = buildLegacyAssessmentVersions(
    publication.application.legacySnapshots,
    publication.application.id,
    publication.application.candidateCode || "",
  );
  const rounds = resultRoundBundle(
    publication.application.scorecards.map(scorecardForClient),
    legacyVersions,
    roundVersions,
  );
  const cards = rounds.flatMap((round) =>
    round.scorecards.filter((card) => booleanValue(card.isSelectedVersion)),
  );
  return {
    application: {
      candidateCode: publication.application.candidateCode || "",
      candidateName: publication.application.candidate.fullName,
      position: publication.application.position || "",
    },
    publication: publicationForClient(publication),
    rounds,
    scorecards: cards,
  };
}

function legacyRoundKey(value: unknown) {
  const round = normalizeRound(value);
  return round === "round1" ? "round_1" : round === "round2" ? "round_2" : round;
}

function legacyScorecard(cardValue: unknown) {
  const card = asRecord(cardValue);
  return {
    ...card,
    editRevision: numberValue(card.editRevision, 1),
    roundKey: legacyRoundKey(card.roundKey),
    scorecardId: text(card.id || card.scorecardId),
  };
}

function legacyManagementWorkspace(
  workspace: Awaited<ReturnType<typeof getRecruitmentManagementWorkspace>>,
) {
  const progressLabels = new Map(
    workspace.progressOptions.map((item) => [item.key, item.label]),
  );
  const candidates = workspace.candidates.map((candidate) => ({
    ...candidate,
    progressLabel:
      progressLabels.get(candidate.progressKey as never) || candidate.progressKey,
  }));
  const duplicatePhoneGroups = workspace.dataQuality.duplicateGroups
    .filter((group) => group.field === "phone")
    .map((group) => ({
      key: group.value,
      normalizedValue: group.value,
      rows: group.items,
    }));
  const missingScores = workspace.missingScorecards.map((item) => ({
    ...item,
    missing: [item.reviewerName].filter(Boolean),
  }));

  return {
    ...workspace,
    campaigns: workspace.campaigns.map((campaign) => ({
      ...campaign,
      isOpen: campaign.status === "OPEN",
    })),
    candidates,
    dashboard: { ...workspace.dashboard, offers: 0 },
    dataQuality: {
      ...workspace.dataQuality,
      duplicatePhoneGroupCount: duplicatePhoneGroups.length,
      duplicatePhoneGroups,
    },
    intake: {
      rows: workspace.intake.map((item) => ({
        ...item,
        name: item.fullName,
        rowNumber: item.id,
      })),
      total: workspace.intake.length,
    },
    loadedView: "bundle",
    loadedViews: [
      "today",
      "pipeline",
      "campaigns",
      "schedule",
      "intake",
      "quality",
      "tools",
    ],
    positions: workspace.dropdowns.positions,
    taskQueues: {
      interviews: workspace.interviews,
      missingScores,
      priority: workspace.priority,
    },
  };
}

async function runManagementAlias(
  session: AppSession,
  method: string,
  payload: JsonRecord,
) {
  const response = await dispatchRecruitmentManagementRpc(
    session,
    method,
    payload,
  );
  if (!response.handled) {
    throw new RecruitmentRuntimeError(
      `Phương thức quản lý ứng viên ${method} chưa được hỗ trợ.`,
    );
  }
  return response.result;
}

async function getLegacyRecruitmentWorkspace(
  session: AppSession,
  payload: JsonRecord,
) {
  const [workspace, departmentRecords] = await Promise.all([
    getRecruitmentManagementWorkspace(session, {
      ...payload,
      limit: Math.min(500, Math.max(120, numberValue(payload.limit, 260))),
    }),
    getDb().recruitmentConfigRecord.findMany({
      orderBy: { name: "asc" },
      where: { recordType: "recruitment-department", status: "active" },
    }),
  ]);
  const legacy = legacyManagementWorkspace(workspace);
  legacy.dropdowns.departments = Array.from(
    new Set([
      ...legacy.dropdowns.departments,
      ...departmentRecords.map((record) => record.name || record.code || ""),
    ]),
  )
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, "vi"));
  return legacy;
}

async function getLegacyCandidateJourney(
  session: AppSession,
  payload: JsonRecord,
) {
  const workspace = legacyManagementWorkspace(
    await getRecruitmentManagementWorkspace(session, { limit: 500 }),
  );
  const candidate = workspace.candidates.find(
    (item) =>
      item.applicationId === text(payload.applicationId) ||
      item.candidateCode === text(payload.candidateCode),
  );
  if (!candidate) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  return {
    candidate,
    reviewerOptions: workspace.reviewerOptions,
    scoreSummary: candidate.scoreSummary,
    sessions: candidate.interviews,
    timeline: candidate.timeline,
  };
}

async function transferLegacyCandidate(
  session: AppSession,
  payload: JsonRecord,
) {
  const workspace = await getRecruitmentManagementWorkspace(session, {
    limit: 500,
  });
  const request = text(
    payload.requisitionCode || payload.campaignCode || payload.requestCode,
  );
  const campaign = workspace.campaigns.find(
    (item) => item.id === request || item.code === request,
  );
  return runManagementAlias(session, "transferCandidate", {
    ...payload,
    campaignId: campaign?.id || text(payload.campaignId),
  });
}

async function getLegacyDuplicateRows(
  session: AppSession,
  payload: JsonRecord,
) {
  const workspace = await getLegacyRecruitmentWorkspace(session, {
    limit: 500,
  });
  const groups = workspace.dataQuality.duplicatePhoneGroups || [];
  const offset = Math.max(0, numberValue(payload.groupOffset));
  const limit = Math.max(1, Math.min(100, numberValue(payload.groupLimit, 30)));
  const page = groups.slice(offset, offset + limit).map((group) => ({
    candidates: (group.rows || []).map((candidate) => ({
      ...candidate,
      rowNumber: candidate.applicationId,
    })),
    count: (group.rows || []).length,
    key: group.key,
    normalizedValue: group.normalizedValue,
  }));
  return {
    groupCount: groups.length,
    groups: page,
    hasMore: offset + limit < groups.length,
    nextOffset: offset + limit,
    totalGroups: groups.length,
  };
}

async function previewLegacyCodeRepair(session: AppSession) {
  const response = await dispatchRecruitmentManagementRpc(
    session,
    "repairCandidateCodes",
    { apply: false },
  );
  const result = asRecord(response.result);
  const rawPreview = Array.isArray(result.preview)
    ? result.preview.map(asRecord)
    : [];
  const applicationIds = rawPreview.map((item) => text(item.applicationId)).filter(Boolean);
  const applications = applicationIds.length
    ? await getDb().recruitmentApplication.findMany({
        include: { candidate: true },
        where: { id: { in: applicationIds } },
      })
    : [];
  const nameById = new Map(
    applications.map((item) => [item.id, item.candidate.fullName]),
  );
  const preview = rawPreview.map((item) => ({
    applicationId: text(item.applicationId),
    candidateName: nameById.get(text(item.applicationId)) || "Ứng viên",
    newCode: text(item.to),
    oldCode: text(item.from),
    reason: "Dồn số trống trước vòng phỏng vấn",
  }));
  return {
    changeCount: preview.length,
    changes: preview.map((item) => ({
      ...item,
      name: item.candidateName,
      rowNumber: item.applicationId,
    })),
    count: preview.length,
    message: text(result.message) || (preview.length
      ? `Có ${preview.length} mã ứng viên chưa phỏng vấn có thể dồn lại.`
      : "Số thứ tự ứng viên đã đúng theo quy tắc V2."),
    preview,
  };
}

function csvCell(value: unknown) {
  const normalized = text(value).replaceAll('"', '""');
  return `"${normalized}"`;
}

async function exportLegacyCandidates(session: AppSession) {
  const workspace = await getRecruitmentManagementWorkspace(session, {
    limit: 500,
  });
  const lines = [
    [
      "Mã ứng viên",
      "Họ tên",
      "Số điện thoại",
      "Email",
      "Vị trí",
      "Bước hiện tại",
      "Việc tiếp theo",
      "Người phụ trách",
    ].map(csvCell),
    ...workspace.candidates.map((candidate) =>
      [
        candidate.candidateCode,
        candidate.name,
        candidate.phone,
        candidate.email,
        candidate.position,
        candidate.stageLabel,
        candidate.nextAction,
        candidate.ownerName,
      ].map(csvCell),
    ),
  ];
  return {
    base64: Buffer.from(lines.map((line) => line.join(",")).join("\r\n"), "utf8").toString(
      "base64",
    ),
    fileName: `danh-sach-ung-vien-${new Date().toISOString().slice(0, 10)}.csv`,
    mimeType: "text/csv;charset=utf-8",
  };
}

async function saveLegacyCriteriaEntity(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const entityType = text(payload.entityType);
  const typeMap: Record<string, string> = {
    criteria: "evaluation-criteria",
    criteriaSet: "evaluation-criteria-set",
    criteriaSetItem: "evaluation-criteria-set-item",
    scoreGroup: "evaluation-score-group",
  };
  const recordType = typeMap[entityType];
  if (!recordType) {
    throw new RecruitmentRuntimeError(
      "Loại cấu hình chấm chưa được hỗ trợ trong Tuyển dụng.",
    );
  }
  const record = asRecord(payload.record);
  const id = text(record.id);
  const code = text(
    record.code ||
      record.criteriaCode ||
      record.criteriaSetCode ||
      record.scoreGroupCode,
  ).toUpperCase();
  const name = text(
    record.name ||
      record.criteriaName ||
      record.criteriaSetName ||
      record.scoreGroupName,
  );
  if (!code || !name) {
    throw new RecruitmentRuntimeError("Vui lòng nhập đủ mã và tên cấu hình.");
  }
  const data = {
    code,
    content: json({
      ...record,
      code,
      isActive: record.isActive !== false,
      name,
      recordType,
      updatedAt: new Date().toISOString(),
      updatedBy: actor.displayName,
    }),
    name,
    note: text(record.description) || null,
    parentId: text(record.parentId || record.criteriaSetId) || null,
    recordType,
    status: text(record.status).toLowerCase() || "active",
    updatedByName: actor.displayName,
  };
  const saved = id
    ? await getDb().evaluationRecord.update({ data, where: { id } })
    : await getDb().evaluationRecord.create({
        data: { ...data, createdByName: actor.displayName },
      });
  return {
    message: `Đã lưu ${name}.`,
    record: {
      ...asRecord(saved.content),
      code: saved.code || "",
      id: saved.id,
      name: saved.name || "",
      status: saved.status,
    },
  };
}

async function publishLegacyCriteriaSet(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const id = text(payload.id || payload.criteriaSetId);
  const record = await getDb().evaluationRecord.findUnique({ where: { id } });
  if (!record || record.recordType !== "evaluation-criteria-set") {
    throw new RecruitmentRuntimeError("Không tìm thấy bộ tiêu chí.", 404);
  }
  await getDb().evaluationRecord.update({
    data: {
      content: json({
        ...asRecord(record.content),
        publishedAt: new Date().toISOString(),
        publishedBy: actor.displayName,
        status: "published",
      }),
      status: "published",
      updatedByName: actor.displayName,
    },
    where: { id },
  });
  return { message: `Đã phát hành ${record.name || record.code}.` };
}

async function saveLegacyRoundMapping(
  session: AppSession,
  payload: JsonRecord,
) {
  const round = legacyRoundKey(payload.roundKey);
  const code = `ROUND_${round.toUpperCase()}`;
  const config = await getRecruitmentScoringConfig(session);
  const existing = config.records.find(
    (record) =>
      record.recordType === "recruitment-score-round-mapping" &&
      legacyRoundKey(record.content.roundKey) === round,
  );
  const saved = await saveRecruitmentScoringConfig(session, {
    code,
    content: {
      criteriaSetId: text(payload.criteriaSetId),
      roundKey: round,
    },
    id: existing?.id || "",
    name: `Ánh xạ ${round}`,
    recordType: "recruitment-score-round-mapping",
    status: "active",
  });
  return { mapping: saved, message: "Đã lưu bộ tiêu chí áp dụng cho vòng." };
}

async function getLegacyAssessmentQueue(
  session: AppSession,
  payload: JsonRecord,
) {
  const queue = await getCandidateAssessmentQueue(session, {
    ...payload,
    maxAge: payload.ageTo,
    minAge: payload.ageFrom,
    round: legacyRoundKey(payload.roundKey),
  });
  const candidateRows = queue.entries.map((entry) => ({
    ...entry,
    assessment: entry.cardId
      ? {
          finalScore: entry.finalScore ?? "",
          scorecardId: entry.cardId,
          status: entry.status,
          version: entry.version,
        }
      : null,
    canStart: true,
    name: entry.candidateName,
  }));
  const candidatesByApplication = new Map<
    string,
    (typeof candidateRows)[number]
  >();
  for (const candidate of candidateRows) {
    const current = candidatesByApplication.get(candidate.applicationId);
    if (!current || (!current.cardId && candidate.cardId)) {
      candidatesByApplication.set(candidate.applicationId, candidate);
    }
  }
  const candidates = Array.from(candidatesByApplication.values());
  const countStatus = (status: string) =>
    candidates.filter((candidate) => candidate.assessment?.status === status)
      .length;
  return {
    candidates,
    filterOptions: { positions: queue.positions },
    positions: queue.positions,
    rounds: [
      { key: "preliminary", label: "Sơ vấn" },
      { key: "round_1", label: "Vòng 1" },
      { key: "round_2", label: "Vòng 2" },
    ],
    selectedRound: {
      key: legacyRoundKey(payload.roundKey),
      label:
        legacyRoundKey(payload.roundKey) === "preliminary"
          ? "Sơ vấn"
          : legacyRoundKey(payload.roundKey) === "round_2"
            ? "Vòng 2"
            : "Vòng 1",
    },
    summary: {
      draft: countStatus("draft"),
      submitted: candidates.filter((candidate) =>
        ["submitted", "completed", "published"].includes(
          candidate.assessment?.status || "",
        ),
      ).length,
      total: candidates.length,
      unstarted: candidates.filter((candidate) => !candidate.assessment).length,
    },
    viewer: queue.actor,
  };
}

async function getLegacyAssessmentBundle(session: AppSession, payload: JsonRecord) {
  const entries = await Promise.all(
    ["preliminary", "round_1", "round_2"].map(async (roundKey) => [
      roundKey,
      await getLegacyAssessmentQueue(session, { ...payload, roundKey }),
    ]),
  );
  return { generatedAt: new Date().toISOString(), queues: Object.fromEntries(entries) };
}

function assessmentGroups(items: JsonRecord[]) {
  const groups = new Map<string, string[]>();
  for (const item of items.filter((row) => row.sectionKey !== "culture")) {
    const group = text(item.groupName) || "Mức độ phù hợp công việc";
    groups.set(group, [
      ...(groups.get(group) || []),
      text(item.itemName) || text(item.criterionName),
    ].filter(Boolean));
  }
  return Array.from(groups.entries()).map(([groupName, outputs]) => ({
    groupName,
    outputs: Array.from(new Set(outputs)),
  }));
}

function savedItemsForLegacyAssessmentUi(
  items: JsonRecord[],
  groups: Array<{ groupName: string; outputs: string[] }>,
  round: string,
) {
  return items.flatMap((item) => {
    if (item.sectionKey === "culture") return [item];
    if (
      /^group-\d+-/.test(text(item.groupKey)) &&
      (/^output-\d+-/.test(text(item.itemKey)) ||
        text(item.itemKey) === "group-summary")
    ) {
      return [item];
    }
    if (item.sectionKey === "criteria") return [];
    const groupIndex = groups.findIndex(
      (group) => normalizeLookup(group.groupName) === normalizeLookup(item.groupName),
    );
    if (groupIndex < 0) return [];
    const group = groups[groupIndex];
    const groupKey = `group-${groupIndex}-${normalizeLookup(group.groupName).replace(/ /g, "-")}`;
    if (round === "preliminary") {
      return [
        {
          ...item,
          groupKey,
          itemKey: "group-summary",
          sectionKey: "jd",
        },
      ];
    }
    const outputIndex = group.outputs.findIndex(
      (output) => normalizeLookup(output) === normalizeLookup(item.itemName),
    );
    if (outputIndex < 0) return [];
    return [
      {
        ...item,
        groupKey,
        itemKey: `output-${outputIndex}-${normalizeLookup(group.outputs[outputIndex]).replace(/ /g, "-")}`,
        sectionKey: "jd",
      },
    ];
  });
}

async function openLegacyAssessment(
  session: AppSession,
  payload: JsonRecord,
) {
  const queue = await getCandidateAssessmentQueue(session, {
    round: legacyRoundKey(payload.roundKey),
  });
  const requestedScorecardId = text(payload.scorecardId);
  const requestedApplicationId = text(payload.applicationId);
  const entry = queue.entries.find(
    (item) =>
      item.applicationId === requestedApplicationId ||
      (Boolean(requestedScorecardId) && item.cardId === requestedScorecardId),
  );
  if (!entry) {
    throw new RecruitmentRuntimeError("Không tìm thấy phiếu được phân công.", 404);
  }
  const requestedLegacyVersion = requestedScorecardId.startsWith("legacy-log:");
  const opened = await openCandidateAssessment(session, {
    assignmentId: entry.assignmentId,
    scorecardId:
      (requestedLegacyVersion ? "" : requestedScorecardId) ||
      entry.cardId ||
      entry.id,
  });
  const currentCard = legacyScorecard(opened.card);
  const baseItems = Array.isArray(opened.card.items)
    ? opened.card.items.map(asRecord)
    : [];
  const legacyVersions = buildLegacyAssessmentVersions(
    opened.personality,
    opened.application.applicationId,
    opened.application.candidateCode,
  );
  const selectedLegacy = requestedLegacyVersion
    ? legacyVersions.find(
        (version) => version.scorecardId === requestedScorecardId,
      ) || null
    : null;
  const card = selectedLegacy || currentCard;
  const criteriaItems = Array.isArray(opened.criteriaSet?.items)
    ? opened.criteriaSet.items.map(asRecord)
    : [];
  const roundKey = legacyRoundKey(card.roundKey);
  const jdSourceItems = Array.isArray(opened.scoringOptions.jdItems)
    ? opened.scoringOptions.jdItems.map(asRecord)
    : baseItems;
  const selectedLegacyTech = selectedLegacy?.legacyScoring.tech || [];
  const legacyJdGroups = selectedLegacyTech
    .map((item) => {
      const detail = asRecord(item.detailPayload);
      const groupName = text(item.groupName || detail.groupName);
      const output = text(item.itemName || detail.output || groupName);
      return { groupName, outputs: [output] };
    })
    .filter((group) => group.groupName && group.outputs[0])
    .filter(
      (group, index, values) =>
        values.findIndex(
          (candidate) =>
            normalizeLookup(candidate.groupName) ===
            normalizeLookup(group.groupName),
        ) === index,
    );
  const jdGroups = legacyJdGroups.length
    ? legacyJdGroups
    : assessmentGroups(jdSourceItems);
  const savedItems = selectedLegacy
    ? []
    : savedItemsForLegacyAssessmentUi(baseItems, jdGroups, roundKey);
  const realVersions: JsonRecord[] = [...opened.previousCards, opened.card]
    .map((version) => asRecord(legacyScorecard(version)))
    .filter((version) => legacyRoundKey(version.roundKey) === roundKey);
  const legacyVersionRecords = legacyVersions.map((version) => asRecord(version));
  const availableVersions: JsonRecord[] = [
    ...realVersions,
    ...legacyVersionRecords,
  ]
    .filter((version) => legacyRoundKey(version.roundKey) === roundKey)
    .filter(
      (version, index, values) =>
        values.findIndex(
          (candidate) =>
            text(candidate.scorecardId) === text(version.scorecardId),
        ) === index,
    )
    .sort((left, right) => {
      const timeDifference =
        Date.parse(text(left.updatedAt) || "") -
        Date.parse(text(right.updatedAt) || "");
      return timeDifference || numberValue(left.version) - numberValue(right.version);
    });
  const roundOrder: Record<string, number> = {
    preliminary: 0,
    round_1: 1,
    round_2: 2,
  };
  const previousScorecards = [
    ...opened.previousCards.map((version) => asRecord(legacyScorecard(version))),
    ...legacyVersionRecords,
  ]
    .filter(
      (version) =>
        (roundOrder[legacyRoundKey(version.roundKey)] ?? 9) <
        (roundOrder[roundKey] ?? 9),
    )
    .sort(
      (left, right) =>
        (roundOrder[legacyRoundKey(left.roundKey)] ?? 9) -
          (roundOrder[legacyRoundKey(right.roundKey)] ?? 9) ||
        numberValue(left.version) - numberValue(right.version),
    );
  return {
    assignment: {
      assignmentId: text(opened.card.assignmentId),
      roleKey: text(opened.card.roleKey),
      roleLabel: text(opened.card.roleLabel) || "Người phỏng vấn",
    },
    assessmentScopes: opened.assessmentScopes,
    availableVersions,
    candidate: {
      ...opened.application,
      age: entry.age,
      name: opened.application.candidateName,
      source: opened.application.source,
    },
    criteriaSet: {
      ...asRecord(opened.criteriaSet),
      criteria: criteriaItems.map((item) => ({
        ...item,
        id: text(item.criterionId || item.id),
        name: text(item.criterionName || item.name),
        weight: numberValue(item.weight, 1),
      })),
    },
    cultureValues: opened.cultureValues,
    jdGroups,
    jdResolvedPosition: opened.jd?.title || opened.application.position,
    legacySaved: selectedLegacy?.legacyScoring || {},
    personality: opened.normalizedPersonality,
    previousScorecards,
    round: {
      key: roundKey,
      label:
        roundKey === "preliminary"
          ? "Sơ vấn"
          : roundKey === "round_2"
            ? "Vòng 2"
            : "Vòng 1",
    },
    savedItems,
    scorecard: card,
    session: opened.session || { startAt: "" },
  };
}

async function saveLegacyAssessment(
  session: AppSession,
  payload: JsonRecord,
) {
  const saved = await saveCandidateAssessment(session, {
    ...payload,
    submit: text(payload.submissionMode) === "submit",
  });
  return {
    message:
      text(payload.submissionMode) === "submit"
        ? "Đã hoàn tất phiếu đánh giá."
        : "Đã lưu bản nháp.",
    scorecard: legacyScorecard(saved),
  };
}

async function reviseLegacyAssessment(
  session: AppSession,
  payload: JsonRecord,
) {
  if (text(payload.scorecardId).startsWith("legacy-log:")) {
    const actor = await resolveOperationActor(session);
    const opened = await openLegacyAssessment(session, payload);
    const db = getDb();
    const application = asRecord(opened.candidate);
    const selected = asRecord(opened.scorecard);
    const legacySaved = asRecord(opened.legacySaved);
    const tech = Array.isArray(legacySaved.tech)
      ? legacySaved.tech.map(asRecord)
      : [];
    const culture = Array.isArray(legacySaved.culture)
      ? legacySaved.culture.map(asRecord)
      : [];
    const techByGroup = new Map(
      tech.map((item) => [
        normalizeLookup(item.groupName),
        item,
      ]),
    );
    const round = normalizeRound(selected.roundKey);
    const rawItems: JsonRecord[] = [];
    (Array.isArray(opened.jdGroups) ? opened.jdGroups : []).forEach(
      (rawGroup, groupIndex) => {
        const group = asRecord(rawGroup);
        const groupName = text(group.groupName);
        const groupKey = `group-${groupIndex}-${normalizeLookup(groupName).replace(/ /g, "-")}`;
        const legacyItem =
          techByGroup.get(normalizeLookup(groupName)) || {};
        const outputs = Array.isArray(group.outputs)
          ? group.outputs.map(text).filter(Boolean)
          : [];
        const score = numberValue(legacyItem.score);
        const base = {
          bonusLearning: booleanValue(legacyItem.bonusLearn),
          bonusTechnical: booleanValue(legacyItem.bonusTech),
          groupKey,
          groupName,
          level: numberValue(legacyItem.level),
          note: text(legacyItem.note),
          score,
          sectionKey: "jd",
          weight: 1,
        };
        if (round === "preliminary") {
          rawItems.push({
            ...base,
            itemKey: "group-summary",
            itemName: groupName,
          });
        } else {
          (outputs.length ? outputs : [groupName]).forEach((output, outputIndex) => {
            rawItems.push({
              ...base,
              itemKey: `output-${outputIndex}-${normalizeLookup(output).replace(/ /g, "-")}`,
              itemName: output,
            });
          });
        }
      },
    );
    for (const value of opened.cultureValues) {
      const savedCulture =
        culture.find((item) => text(item.gtKey) === value.gtKey) || {};
      rawItems.push({
        groupKey: "culture",
        groupName: "Giá trị văn hóa",
        itemKey: value.gtKey,
        itemName: value.gtName,
        meta: {
          chips: Array.isArray(savedCulture.chips)
            ? savedCulture.chips
            : value.chips.map((chip) => ({ ...chip, state: 0 })),
        },
        note: text(savedCulture.note),
        score: numberValue(savedCulture.score),
        sectionKey: "culture",
        weight: 1,
      });
    }
    const items = normalizeIncomingItems(rawItems);
    const cards = await db.recruitmentScorecard.findMany({
      include: { items: true },
      orderBy: { version: "desc" },
      where: { applicationId: text(application.applicationId) },
    });
    const sameRoundCards = cards.filter(
      (card) => normalizeRound(card.roundKey) === round,
    );
    const emptyDraft = sameRoundCards.find(
      (card) => card.status === "draft" && card.items.length === 0,
    );
    const latest = sameRoundCards[0];
    const target = emptyDraft
      ? emptyDraft
      : await db.recruitmentScorecard.create({
          data: {
            applicationId: text(application.applicationId),
            assignmentId: latest?.assignmentId || null,
            editRevision: (latest?.editRevision || 0) + 1,
            interviewId: latest?.interviewId || null,
            jdPosition: text(application.position) || latest?.jdPosition || null,
            reviewerEmployeeId:
              latest?.reviewerEmployeeId || actor.employeeId || actor.employeeCode || null,
            reviewerName: actor.displayName,
            roleKey: latest?.roleKey || "legacy_revision",
            roleLabel: latest?.roleLabel || "Người phỏng vấn",
            roundKey: round,
            roundLabel: roundLabel(round),
            scoringMode: "shared-jd",
            status: "draft",
            version: (latest?.version || 0) + 1,
          },
          include: { items: true },
        });
    const saved = await db.$transaction(async (tx) => {
      await tx.recruitmentScoreItem.deleteMany({
        where: { scorecardId: target.id },
      });
      await tx.recruitmentScoreItem.createMany({
        data: items.map((item) => ({
          bonusLearning: item.bonusLearning,
          bonusTechnical: item.bonusTechnical,
          criterionId: item.criterionId || null,
          criterionName: item.criterionName || null,
          evidence: item.evidence || null,
          groupKey: item.groupKey || null,
          groupName: item.groupName || null,
          itemKey: item.itemKey || null,
          itemName: item.itemName || null,
          level: item.level,
          meta: json(item.meta),
          note: item.note || null,
          score: item.score,
          scorecardId: target.id,
          sectionKey: item.sectionKey || null,
          weight: item.weight,
        })),
      });
      await tx.recruitmentTimeline.create({
        data: {
          actorEmployeeId: actor.employeeId || actor.employeeCode || null,
          actorName: actor.displayName,
          applicationId: text(application.applicationId),
          detail: `${roundLabel(round)} · kế thừa phiếu cũ`,
          eventType: "assessment-legacy-revision-created",
          title: "Đã tạo bản chấm lại từ lịch sử",
          toValue: String(target.version),
        },
      });
      return tx.recruitmentScorecard.findUniqueOrThrow({
        include: { items: true },
        where: { id: target.id },
      });
    });
    return {
      message: "Đã tạo bản chấm lại từ phiếu cũ và giữ nguyên lịch sử.",
      scorecard: legacyScorecard(scorecardForClient(saved)),
    };
  }
  const saved = await createCandidateAssessmentRevision(session, payload);
  return {
    message: "Đã tạo phiên bản chấm lại và giữ nguyên phiếu trước.",
    scorecard: legacyScorecard(saved),
  };
}

function legacyResultCandidate(applicationValue: unknown) {
  const application = asRecord(applicationValue);
  return {
    ...application,
    name: text(application.candidateName),
  };
}

function recruitmentResultScore(value: unknown) {
  if (value == null || text(value) === "") return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}

function legacyVersionForResult(versionValue: unknown) {
  const version = asRecord(versionValue);
  const scoring = asRecord(version.legacyScoring);
  const tech = Array.isArray(scoring.tech) ? scoring.tech.map(asRecord) : [];
  const culture = Array.isArray(scoring.culture)
    ? scoring.culture.map(asRecord)
    : [];
  const items: JsonRecord[] = [
    ...tech.map((item, index) => ({
      bonusLearning: booleanValue(item.bonusLearn),
      bonusTechnical: booleanValue(item.bonusTech),
      criterionId: "",
      criterionName: "",
      evidence: "",
      groupKey: `legacy-${index}`,
      groupName: text(item.groupName) || "Nhóm công việc",
      itemKey: `legacy-${index}`,
      itemName: text(item.groupName) || "Đánh giá theo JD",
      level: text(item.level) === "" ? null : numberValue(item.level),
      meta: { legacy: true },
      note: text(item.note),
      score: recruitmentResultScore(item.score),
      sectionKey: "jd",
      weight: 1,
    })),
    ...culture.map((item, index) => ({
      bonusLearning: false,
      bonusTechnical: false,
      criterionId: "",
      criterionName: "",
      evidence: "",
      groupKey: "culture",
      groupName: "Giá trị văn hóa",
      itemKey: text(item.gtKey) || `culture-${index}`,
      itemName: text(item.gtName || item.gtKey) || "Giá trị văn hóa",
      level: null,
      meta: {
        chips: Array.isArray(item.chips) ? item.chips.map(asRecord) : [],
        legacy: true,
      },
      note: text(item.note),
      score: recruitmentResultScore(item.score),
      sectionKey: "culture",
      weight: 1,
    })),
  ];
  return {
    ...legacyScorecard(version),
    finalScore:
      recruitmentResultScore(version.finalScore) == null
        ? ""
        : recruitmentResultScore(version.finalScore),
    isHistoricLog: true,
    isLegacy: true,
    items,
    roleKey: "legacy",
    roleLabel: "Phiếu đã lưu trước đây",
  };
}

function resultVersionLabel(cardValue: unknown) {
  const card = asRecord(cardValue);
  const reviewer = text(card.reviewerName) || "Chưa rõ người chấm";
  const date = text(card.updatedAt || card.submittedAt);
  const dateLabel = date
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(new Date(date))
    : "";
  return card.isLegacy
    ? `Phiếu cũ lần ${numberValue(card.version, 1)} · ${reviewer}${dateLabel ? ` · ${dateLabel}` : ""}`
    : `Phiên bản ${numberValue(card.version, 1)}`;
}

type ResultSectionKey = "technical" | "culture";

const RESULT_SECTIONS: Array<{ key: ResultSectionKey; label: string }> = [
  { key: "technical", label: "Chuyên môn" },
  { key: "culture", label: "Văn hóa" },
];

function resultCardId(cardValue: unknown) {
  const card = asRecord(cardValue);
  return text(card.scorecardId || card.id);
}

function resultSectionItems(cardValue: unknown, section: ResultSectionKey) {
  const card = asRecord(cardValue);
  const items = Array.isArray(card.items) ? card.items.map(asRecord) : [];
  if (
    !booleanValue(card.isLegacy) &&
    text(card.roleKey) &&
    !assessmentScopesForRole(card.roleKey).includes(section)
  ) {
    return [];
  }
  return items.filter((item) => itemAssessmentScope(item) === section);
}

function resultSectionScore(cardValue: unknown, section: ResultSectionKey) {
  const card = asRecord(cardValue);
  const items = resultSectionItems(card, section).filter(
    (item) => recruitmentResultScore(item.score) != null,
  );
  if (!items.length) {
    const roleScopes = assessmentScopesForRole(card.roleKey);
    if (!booleanValue(card.isLegacy) && roleScopes.length === 1 && roleScopes[0] === section) {
      return recruitmentResultScore(card.finalScore);
    }
    return null;
  }
  let total = 0;
  let totalWeight = 0;
  for (const item of items) {
    const weight = Math.max(numberValue(item.weight, 1), 0);
    const score = recruitmentResultScore(item.score);
    if (score == null || weight <= 0) continue;
    total += score * weight;
    totalWeight += weight;
  }
  return totalWeight
    ? Math.round((total / totalWeight) * 100) / 100
    : null;
}

function resultSectionMeta(cardValue: unknown, section: ResultSectionKey) {
  const card = asRecord(cardValue);
  const legacyMeta = asRecord(asRecord(card.legacySectionMeta)[section]);
  return {
    reviewerName: text(legacyMeta.reviewerName || card.reviewerName),
    updatedAt: text(legacyMeta.updatedAt || card.updatedAt || card.submittedAt),
    version: numberValue(legacyMeta.version || card.version, 1),
  };
}

function resultSourceLabel(cardValue: unknown, section: ResultSectionKey) {
  const card = asRecord(cardValue);
  const meta = resultSectionMeta(card, section);
  const reviewer = meta.reviewerName || "Chưa rõ người chấm";
  const role = text(card.roleLabel) ||
    (section === "technical" ? "Chuyên môn" : "Văn hóa");
  const date = meta.updatedAt ? new Date(meta.updatedAt) : null;
  const dateLabel = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(date)
    : "";
  return `${reviewer} · ${role} · ${booleanValue(card.isLegacy) ? "Bản cũ" : "Phiên bản"} ${meta.version}${dateLabel ? ` · ${dateLabel}` : ""}`;
}

function resultOptionMatchesLegacyRequest(
  optionValue: unknown,
  requestedValue: unknown,
) {
  const option = asRecord(optionValue);
  const card = asRecord(option.card);
  const requested = text(requestedValue);
  if (!requested) return false;
  if (text(option.key) === requested) return true;
  const requestedVersion = requested.startsWith("v3:")
    ? numberValue(requested.slice(3), -1)
    : /^\d+$/.test(requested)
      ? numberValue(requested, -1)
      : requested.startsWith("legacy-log:")
        ? numberValue(requested.split(":").pop(), -1)
        : -1;
  if (requestedVersion < 0) return false;
  return (
    numberValue(card.version, -2) === requestedVersion &&
    (requested.startsWith("legacy-log:")
      ? booleanValue(card.isLegacy)
      : !booleanValue(card.isLegacy))
  );
}

export function resultRoundBundle(
  currentCardsValue: unknown[],
  legacyVersionsValue: unknown[],
  requestedVersionsValue: unknown,
) {
  const currentCards = currentCardsValue.map((card) => asRecord(card));
  const legacyCards = legacyVersionsValue.map(legacyVersionForResult).map(asRecord);
  const requestedVersions = asRecord(requestedVersionsValue);
  const definitions = [
    { key: "preliminary", label: "Sơ vấn" },
    { key: "round_1", label: "Vòng 1" },
    { key: "round_2", label: "Vòng 2" },
  ];
  return definitions.map((definition) => {
    const roundCurrent = currentCards.filter(
      (card) => legacyRoundKey(card.roundKey) === definition.key,
    );
    const roundLegacy = legacyCards.filter(
      (card) => legacyRoundKey(card.roundKey) === definition.key,
    );
    const roundCards = [...roundCurrent, ...roundLegacy];
    const roundRequestValue = requestedVersions[definition.key];
    const roundRequest = asRecord(roundRequestValue);
    const scalarRequest = text(roundRequestValue);
    const sections = RESULT_SECTIONS.map((section) => {
      const completedCards = roundCards.filter(
        (card) =>
          ["submitted", "completed", "published"].includes(text(card.status)) &&
          resultSectionScore(card, section.key) != null,
      );
      const sourceCards = completedCards.length
        ? completedCards
        : roundCards.filter(
            (card) => resultSectionScore(card, section.key) != null,
          );
      const options = sourceCards
        .map((card) => {
          const meta = resultSectionMeta(card, section.key);
          return {
            card,
            key: resultCardId(card),
            label: resultSourceLabel(card, section.key),
            reviewerName: meta.reviewerName,
            score: resultSectionScore(card, section.key) ?? "",
            updatedAt: meta.updatedAt,
            version: meta.version,
          };
        })
        .filter(
          (option, index, values) =>
            option.key &&
            values.findIndex((candidate) => candidate.key === option.key) === index,
        )
        .sort(
          (left, right) =>
            Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""),
        );
      const requested = text(
        roundRequest[section.key] ||
          (section.key === "technical" ? roundRequest.tech || roundRequest.jd : ""),
      );
      const selected =
        options.find((option) => option.key === requested) ||
        options.find((option) =>
          resultOptionMatchesLegacyRequest(option, requested || scalarRequest),
        ) ||
        options[0];
      return {
        key: section.key,
        label: section.label,
        reviewerName: selected?.reviewerName || "",
        score: selected?.score ?? "",
        sourceLabel: selected?.label || "",
        selectedSource: selected?.key || "",
        sourceOptions: options.map((option) => ({
          key: option.key,
          label: option.label,
          reviewerName: option.reviewerName,
          score: option.score,
          version: option.version,
        })),
      };
    });
    const selectedSources = Object.fromEntries(
      sections.map((section) => [section.key, section.selectedSource]),
    );
    const selectedScores = sections
      .map((section) => recruitmentResultScore(section.score))
      .filter((score): score is number => score != null);
    const scorecards = [...roundCurrent, ...roundLegacy].map((cardValue) => {
      const card = asRecord(cardValue);
      const cardId = resultCardId(card);
      const selectedSections = sections
        .filter((section) => section.selectedSource === cardId)
        .map((section) => section.key);
      return {
        ...card,
        isSelectedVersion: selectedSections.length > 0,
        selectedItems: (Array.isArray(card.items) ? card.items.map(asRecord) : []).filter(
          (item) => selectedSections.includes(itemAssessmentScope(item)),
        ),
        selectedSections,
      };
    });
    return {
      completed: selectedScores.length,
      isComplete: selectedScores.length === RESULT_SECTIONS.length,
      key: definition.key,
      label: definition.label,
      score: selectedScores.length
        ? Math.round(
            (selectedScores.reduce((sum, score) => sum + score, 0) /
              selectedScores.length) *
              100,
          ) / 100
        : "",
      scorecards,
      sections,
      selectedSources,
      selectedVersion:
        selectedSources.technical &&
        selectedSources.technical === selectedSources.culture
          ? selectedSources.technical
          : "",
      total: RESULT_SECTIONS.length,
      versionOptions: [],
    };
  });
}

function resultScoreSummary(roundsValue: unknown[]) {
  const rounds = roundsValue.map(asRecord);
  const scored = rounds
    .map((round) => recruitmentResultScore(round.score))
    .filter((score): score is number => score != null);
  return {
    completedRounds: rounds.filter((round) => booleanValue(round.isComplete)).length,
    finalScore: scored.length
      ? Math.round(
          (scored.reduce((sum, score) => sum + score, 0) / scored.length) * 100,
        ) / 100
      : "",
    rounds,
  };
}

async function getLegacyResultsCenter(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-results", "view");
  const query = normalizeLookup(payload.query);
  const limit = Math.max(1, Math.min(240, Math.round(numberValue(payload.limit, 120))));
  const applications = await getDb().recruitmentApplication.findMany({
    include: {
      candidate: true,
      legacySnapshots: {
        orderBy: { createdAt: "desc" },
        where: { kind: { in: ["hexaco", "so-van"] } },
      },
      publication: true,
      scorecards: {
        include: { items: true },
        orderBy: [{ roundKey: "asc" }, { version: "desc" }],
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 1200,
    where: {
      OR: [
        { scorecards: { some: {} } },
        {
          legacySnapshots: {
            some: { kind: { in: ["hexaco", "so-van"] } },
          },
        },
      ],
    },
  });
  const candidates = applications
    .map((application) => {
      const legacyVersions = buildLegacyAssessmentVersions(
        application.legacySnapshots,
        application.id,
        application.candidateCode || "",
      );
      const rounds = resultRoundBundle(
        application.scorecards.map(scorecardForClient),
        legacyVersions,
        {},
      );
      return {
        applicationId: application.id,
        candidateCode: application.candidateCode || "",
        name: application.candidate.fullName,
        position: application.position || "",
        publication:
          application.publication?.status === "published"
            ? publicationForClient(application.publication)
            : null,
        requisitionCode: application.requisitionCode || "",
        scoreSummary: resultScoreSummary(rounds),
        stageLabel: application.status || "Đã có kết quả đánh giá",
        status: application.status || "",
        updatedAt: application.updatedAt.toISOString(),
      };
    })
    .filter((candidate) => {
      if (!query) return true;
      return normalizeLookup(
        [
          candidate.name,
          candidate.candidateCode,
          candidate.position,
          candidate.requisitionCode,
        ].join(" "),
      ).includes(query);
    });
  const visible = candidates.slice(0, limit);
  return {
    candidates: visible,
    ok: true,
    summary: {
      complete: candidates.filter(
        (candidate) => candidate.scoreSummary.completedRounds >= 3,
      ).length,
      published: candidates.filter((candidate) => candidate.publication).length,
      total: candidates.length,
      waiting: candidates.filter(
        (candidate) => candidate.scoreSummary.completedRounds < 3,
      ).length,
    },
    viewer: {
      displayName: actor.displayName,
      employeeCode: actor.employeeCode,
      isAdmin: isRecruitmentAdministrator(actor),
    },
  };
}

async function getLegacyResultReport(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-results", "view");
  const [application, cultureValues, personalityConfigs] = await Promise.all([
    getDb().recruitmentApplication.findUnique({
      include: {
        candidate: true,
        legacySnapshots: { orderBy: { createdAt: "desc" } },
        publication: true,
        scorecards: {
          include: { items: true },
          orderBy: [{ roundKey: "asc" }, { version: "desc" }],
        },
        timeline: { orderBy: { createdAt: "desc" }, take: 80 },
      },
      where: { id: text(payload.applicationId) },
    }),
    loadRecruitmentCultureValues(),
    getDb().recruitmentConfigRecord.findMany({
      orderBy: { sourceRow: "asc" },
      where: {
        recordType: {
          in: ["scoring-personality-base", "scoring-personality-profile"],
        },
        status: { in: ["ACTIVE", "active", "published"] },
      },
    }),
  ]);
  if (!application) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  const legacyVersions = buildLegacyAssessmentVersions(
    application.legacySnapshots,
    application.id,
    application.candidateCode || "",
  );
  const requestedVersions = Object.keys(asRecord(payload.roundVersions)).length
    ? asRecord(payload.roundVersions)
    : asRecord(application.publication?.roundVersions);
  const rounds = resultRoundBundle(
    application.scorecards.map(scorecardForClient),
    legacyVersions,
    requestedVersions,
  );
  const cultureByKey = new Map(
    cultureValues.map((value) => [text(value.gtKey), value]),
  );
  for (const round of rounds) {
    for (const cardValue of round.scorecards) {
      const card = asRecord(cardValue);
      const enrichCultureItem = (itemValue: unknown) => {
        const item = asRecord(itemValue);
        if (text(item.sectionKey) !== "culture") return item;
        const configured = cultureByKey.get(text(item.itemKey));
        if (!configured) return item;
        const meta = asRecord(item.meta);
        const savedChips = new Map(
          (Array.isArray(meta.chips) ? meta.chips : []).map((chipValue) => {
            const chip = asRecord(chipValue);
            return [text(chip.code), chip];
          }),
        );
        return {
          ...item,
          itemName: configured.gtName,
          meta: {
            ...meta,
            chips: configured.chips.map((chip) => ({
              ...chip,
              state: numberValue(savedChips.get(chip.code)?.state),
            })),
          },
        };
      };
      if (Array.isArray(card.items)) {
        card.items = card.items.map(enrichCultureItem);
      }
      if (Array.isArray(card.selectedItems)) {
        card.selectedItems = card.selectedItems.map(enrichCultureItem);
      }
    }
  }
  const summary = resultScoreSummary(rounds);
  const latestHexaco = application.legacySnapshots
    .filter((snapshot) => snapshot.kind === "hexaco")
    .sort(
      (left, right) =>
        (right.sourceUpdatedAt || right.createdAt).getTime() -
        (left.sourceUpdatedAt || left.createdAt).getTime(),
    )[0];
  const publication = application.publication
    ? publicationForClient(application.publication)
    : null;
  return {
    candidate: legacyResultCandidate({
      applicationCode: application.applicationCode,
      applicationId: application.id,
      candidateCode: application.candidateCode || "",
      candidateName: application.candidate.fullName,
      department: application.department || "",
      email: application.candidate.email || "",
      phone: application.candidate.phone || "",
      position: application.position || "",
    }),
    cultureValues,
    finalScore: summary.finalScore,
    isComplete: summary.completedRounds === 3,
    ok: true,
    personality: normalizeHexacoPersonality(
      latestHexaco?.payload,
      personalityConfigs.filter(
        (record) => record.recordType === "scoring-personality-base",
      ),
      personalityConfigs.filter(
        (record) => record.recordType === "scoring-personality-profile",
      ),
    ),
    publication: publication
      ? {
          ...publication,
          score: publication.publishedScore ?? "",
        }
      : null,
    publicUrl: publication?.accessToken
      ? `/ket-qua-ung-vien/${publication.accessToken}`
      : "",
    rounds,
    sessions: [],
    timeline: application.timeline.map((event) => ({
      actorName: event.actorName || "",
      createdAt: event.createdAt.toISOString(),
      detail: event.detail || "",
      eventId: event.id,
      title: event.title,
      type: event.eventType,
    })),
    viewer: {
      displayName: actor.displayName,
      employeeCode: actor.employeeCode,
      isAdmin: isRecruitmentAdministrator(actor),
    },
  };
}

async function saveLegacyDepartment(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-management", "edit");
  const code = text(payload.departmentCode).toUpperCase();
  const name = text(payload.departmentName);
  if (!code || !name) {
    throw new RecruitmentRuntimeError(
      "Vui lòng nhập đủ mã và tên phòng ban.",
    );
  }
  const db = getDb();
  const existing = await db.recruitmentConfigRecord.findFirst({
    where: { code, recordType: "recruitment-department" },
  });
  const oldName = existing?.name || "";
  const record = existing
    ? await db.recruitmentConfigRecord.update({
        data: {
          content: json({
            ...asRecord(existing.content),
            code,
            name,
            updatedAt: new Date().toISOString(),
            updatedBy: actor.displayName,
          }),
          name,
          status: "active",
        },
        where: { id: existing.id },
      })
    : await db.$transaction(async (tx) => {
        const last = await tx.recruitmentConfigRecord.findFirst({
          orderBy: { sourceRow: "desc" },
          where: { sourceSheet: COMPAT_CONFIG_SOURCE },
        });
        return tx.recruitmentConfigRecord.create({
          data: {
            code,
            content: json({
              code,
              name,
              updatedAt: new Date().toISOString(),
              updatedBy: actor.displayName,
            }),
            name,
            recordType: "recruitment-department",
            sourceRow: (last?.sourceRow || 0) + 1,
            sourceSheet: COMPAT_CONFIG_SOURCE,
            status: "active",
          },
        });
      });

  let updatedReferences = 0;
  if (oldName && oldName !== name) {
    const [applications, campaigns, requisitions] = await db.$transaction([
      db.recruitmentApplication.updateMany({
        data: { department: name },
        where: { department: oldName },
      }),
      db.recruitmentCampaign.updateMany({
        data: { department: name },
        where: { department: oldName },
      }),
      db.recruitmentRequisition.updateMany({
        data: { department: name },
        where: { department: oldName },
      }),
    ]);
    updatedReferences =
      applications.count + campaigns.count + requisitions.count;
  }
  return {
    department: configForClient(record),
    message: `${existing ? "Đã cập nhật" : "Đã thêm"} phòng ban ${code} · ${name}${
      updatedReferences
        ? ` và đổi tên tại ${updatedReferences} hồ sơ liên quan.`
        : "."
    }`,
    ok: true,
    updatedBy: actor.displayName,
    updatedReferences,
  };
}

function availableOrderText(used: Set<number>) {
  const parts: string[] = [];
  let start = 0;
  let previous = 0;
  for (let value = 1; value <= 999; value += 1) {
    if (used.has(value)) continue;
    if (!start) {
      start = value;
      previous = value;
    } else if (value === previous + 1) {
      previous = value;
    } else {
      parts.push(start === previous ? `[${start}]` : `[${start},${previous}]`);
      start = value;
      previous = value;
    }
  }
  if (start) {
    parts.push(start === previous ? `[${start}]` : `[${start},${previous}]`);
  }
  return parts.join("");
}

async function syncLegacyAvailableOrdersOld(
  session: AppSession,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "candidate-management", "edit");
  const db = getDb();
  const [applications, campaigns] = await Promise.all([
    db.recruitmentApplication.findMany({
      select: { candidateCode: true, requisitionCode: true },
    }),
    db.recruitmentCampaign.findMany({
      select: { availableOrder: true, code: true, id: true },
    }),
  ]);
  const usedByCode = new Map<string, Set<number>>();
  applications.forEach((application) => {
    const code = text(application.candidateCode);
    const match = code.match(/^(.*?)-(\d{1,3})$/);
    const requestCode = text(application.requisitionCode || match?.[1]).toUpperCase();
    const sequence = Number(match?.[2] || 0);
    if (!requestCode || !sequence) return;
    const used = usedByCode.get(requestCode) || new Set<number>();
    used.add(sequence);
    usedByCode.set(requestCode, used);
  });
  await db.$transaction(
    campaigns.map((campaign) =>
      db.recruitmentCampaign.update({
        data: {
          availableOrder: availableOrderText(
            usedByCode.get(campaign.code.toUpperCase()) || new Set<number>(),
          ),
        },
        where: { id: campaign.id },
      }),
    ),
  );
  return {
    message: `Đã đồng bộ số thứ tự khả dụng cho ${campaigns.length} dòng nhu cầu tuyển.`,
    ok: true,
    updated: campaigns.length,
  };
}

async function syncLegacyAvailableOrders(session: AppSession) {
  const response = await dispatchRecruitmentManagementRpc(
    session,
    "repairCandidateCodes",
    { apply: true },
  );
  const result = asRecord(response.result);
  return {
    ...result,
    message:
      text(result.message) ||
      "Đã dồn số cho hồ sơ chưa phỏng vấn và giữ nguyên mã của hồ sơ đã phỏng vấn.",
    ok: true,
  };
}

async function saveLegacyScopeMapping(
  session: AppSession,
  payload: JsonRecord,
) {
  const allowedScopes = ["global", "jd", "department", "team", "requisition"];
  const scopeType = text(payload.scopeType) || "global";
  const scopeValue = scopeType === "global" ? "*" : text(payload.scopeValue);
  const roundKey = legacyRoundKey(payload.roundKey);
  const criteriaSetId = text(payload.criteriaSetId);
  if (!allowedScopes.includes(scopeType)) {
    throw new RecruitmentRuntimeError("Phạm vi áp dụng không hợp lệ.");
  }
  if (!scopeValue) {
    throw new RecruitmentRuntimeError("Vui lòng chọn đối tượng áp dụng.");
  }
  if (!criteriaSetId) {
    throw new RecruitmentRuntimeError(
      "Vui lòng chọn bộ tiêu chí đã phát hành.",
    );
  }
  const current = await getRecruitmentScoringConfig(session);
  const criteriaSet = current.criteriaSets.find(
    (item) => text(item.id || item.code) === criteriaSetId,
  );
  if (!criteriaSet || text(criteriaSet.status).toLowerCase() !== "published") {
    throw new RecruitmentRuntimeError(
      "Chỉ có thể áp dụng bộ tiêu chí đã phát hành.",
    );
  }
  const existing = current.scopeMappings.map(asRecord).find(
    (item) =>
      text(item.id) === text(payload.mappingId) ||
      (text(item.scopeType) === scopeType &&
        text(item.scopeValue) === scopeValue &&
        legacyRoundKey(item.roundKey) === roundKey),
  );
  const saved = await saveRecruitmentScoringConfig(session, {
    code: `SCOPE_${scopeType}_${scopeValue}_${roundKey}`
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .slice(0, 120)
      .toUpperCase(),
    content: {
      criteriaSetId,
      isActive: payload.isActive !== false,
      priority: numberValue(payload.priority, 100),
      roundKey,
      scopeType,
      scopeValue,
    },
    id: text(existing?.id),
    name: `${scopeType === "global" ? "Toàn bộ tuyển dụng" : scopeValue} · ${roundLabel(normalizeRound(roundKey))}`,
    recordType: "recruitment-score-scope-mapping",
    status: "active",
  });
  const refreshed = await getRecruitmentScoringConfig(session);
  return {
    mapping: { ...saved.content, id: saved.id },
    message: `Đã gán bộ tiêu chí cho ${
      scopeType === "global" ? "toàn bộ tuyển dụng" : scopeValue
    } · ${roundLabel(normalizeRound(roundKey))}.`,
    ok: true,
    scopeMappings: refreshed.scopeMappings,
  };
}

async function deleteLegacyScopeMapping(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const id = text(payload.mappingId || payload.id);
  const current = await getDb().recruitmentConfigRecord.findUnique({
    where: { id },
  });
  if (
    !current ||
    current.recordType !== "recruitment-score-scope-mapping"
  ) {
    throw new RecruitmentRuntimeError(
      "Không tìm thấy phạm vi áp dụng bộ tiêu chí.",
      404,
    );
  }
  await getDb().recruitmentConfigRecord.delete({ where: { id } });
  const refreshed = await getRecruitmentScoringConfig(session);
  return {
    message: "Đã xóa phạm vi áp dụng bộ tiêu chí.",
    ok: true,
    scopeMappings: refreshed.scopeMappings,
  };
}

export async function dispatchRecruitmentRpc(
  session: AppSession,
  method: string,
  payload: JsonRecord,
) {
  if (
    [
      "getRecruitmentOfferCenter",
      "createRecruitmentOfferDocuments",
    ].includes(method)
  ) {
    throw new RecruitmentRuntimeError(
      "Luồng Offer và nhận việc đang tạm khóa theo yêu cầu.",
      423,
    );
  }
  if (
    method === "getRecruitmentHrWorkspace" ||
    method === "getRecruitmentHrWorkspaceBundle"
  ) {
    return getLegacyRecruitmentWorkspace(session, payload);
  }
  if (method === "getRecruitmentCandidateJourney") {
    return getLegacyCandidateJourney(session, payload);
  }
  if (method === "saveRecruitmentCandidateProgress") {
    return runManagementAlias(session, "saveJourney", payload);
  }
  if (method === "transferRecruitmentCandidate") {
    return transferLegacyCandidate(session, payload);
  }
  if (method === "saveRecruitmentInterviewPlan") {
    return runManagementAlias(session, "saveInterview", payload);
  }
  if (method === "createCandidateManagementCampaign") {
    return runManagementAlias(session, "saveCampaign", payload);
  }
  if (method === "importCandidateManagementManual") {
    return runManagementAlias(session, "saveManualIntake", payload);
  }
  if (method === "importCandidateSourceFileToWorkflow") {
    return runManagementAlias(session, "importIntakeFile", payload);
  }
  if (method === "promoteCandidateWorkflowRows") {
    return runManagementAlias(session, "promoteIntake", {
      ...payload,
      ids: payload.rowIds || payload.rowNumbers || payload.ids,
    });
  }
  if (method === "removeCandidateWorkflowRows") {
    return runManagementAlias(session, "archiveIntake", {
      ...payload,
      ids: payload.rowIds || payload.rowNumbers || payload.ids,
    });
  }
  if (method === "removeCandidateDuplicateRows") {
    return runManagementAlias(session, "archiveDuplicateApplications", {
      ...payload,
      ids:
        payload.applicationIds ||
        payload.rowIds ||
        payload.rowNumbers ||
        payload.ids,
    });
  }
  if (method === "getCandidateDuplicateRows") {
    return getLegacyDuplicateRows(session, payload);
  }
  if (method === "previewRecruitmentCandidateCodeRepair") {
    return previewLegacyCodeRepair(session);
  }
  if (method === "applyRecruitmentCandidateCodeRepair") {
    return runManagementAlias(session, "repairCandidateCodes", payload);
  }
  if (method === "saveRecruitmentSourceDefinition") {
    return runManagementAlias(session, "saveSourceDefinition", payload);
  }
  if (method === "readRecruitmentSourceHeaders") {
    const actor = await resolveOperationActor(session);
    assertAdmin(actor, "candidate-management", "edit");
    return readRecruitmentSourceHeadersFromUpload(payload);
  }
  if (method === "saveRecruitmentDepartment") {
    return saveLegacyDepartment(session, payload);
  }
  if (method === "syncRecruitmentAvailableOrders") {
    return syncLegacyAvailableOrders(session);
  }
  if (method === "exportCandidateManagementCsv") {
    return exportLegacyCandidates(session);
  }
  if (method === "exportCandidateWorkflowXlsx") {
    return exportLegacyCandidates(session);
  }
  if (method === "getRecruitmentScoringConfig") {
    return getRecruitmentScoringConfig(session);
  }
  if (method === "saveRecruitmentCriteriaEntity") {
    return saveLegacyCriteriaEntity(session, payload);
  }
  if (method === "publishRecruitmentCriteriaSet") {
    return publishLegacyCriteriaSet(session, payload);
  }
  if (method === "saveRecruitmentRoundCriteriaMapping") {
    return saveLegacyRoundMapping(session, payload);
  }
  if (method === "saveRecruitmentCriteriaScopeMapping") {
    return saveLegacyScopeMapping(session, payload);
  }
  if (method === "deleteRecruitmentCriteriaScopeMapping") {
    return deleteLegacyScopeMapping(session, payload);
  }
  if (method === "getRecruitmentAssessmentQueue") {
    return getLegacyAssessmentQueue(session, payload);
  }
  if (method === "getRecruitmentAssessmentQueuesBundle") {
    return getLegacyAssessmentBundle(session, payload);
  }
  if (method === "openRecruitmentAssessment") {
    return openLegacyAssessment(session, payload);
  }
  if (method === "saveRecruitmentAssessment") {
    return saveLegacyAssessment(session, payload);
  }
  if (method === "createRecruitmentAssessmentRevision") {
    return reviseLegacyAssessment(session, payload);
  }
  if (method === "getRecruitmentResultsCenter") {
    return getLegacyResultsCenter(session, payload);
  }
  if (method === "getRecruitmentResultReport") {
    return getLegacyResultReport(session, payload);
  }
  if (method === "publishRecruitmentResult") {
    const publication = await publishCandidateResult(session, payload);
    return {
      message: "Đã công bố kết quả và tạo đường dẫn riêng cho ứng viên.",
      publicUrl: `/ket-qua-ung-vien/${publication.accessToken}`,
      publication,
    };
  }
  if (method === "unpublishRecruitmentResult") {
    const publication = await revokeCandidateResult(session, payload);
    return { message: "Đã thu hồi đường dẫn kết quả.", publication };
  }
  const managementResult = await dispatchRecruitmentManagementRpc(
    session,
    method,
    payload,
  );
  if (managementResult.handled) {
    return managementResult.result;
  }
  if (method === "getScoringConfig") {
    return getRecruitmentScoringConfig(session);
  }
  if (method === "saveScoringConfig") {
    return saveRecruitmentScoringConfig(session, payload);
  }
  if (method === "setScoringStatus") {
    return setRecruitmentScoringStatus(session, payload);
  }
  if (method === "getAssessmentQueue") {
    return getCandidateAssessmentQueue(session, payload);
  }
  if (method === "openAssessment") {
    return openCandidateAssessment(session, payload);
  }
  if (method === "saveAssessment") {
    return saveCandidateAssessment(session, payload);
  }
  if (method === "createAssessmentRevision") {
    return createCandidateAssessmentRevision(session, payload);
  }
  if (method === "getResultsCenter") {
    return getCandidateResultsCenter(session, payload);
  }
  if (method === "getResultReport") {
    return getCandidateResultReport(session, payload);
  }
  if (method === "publishResult") {
    return publishCandidateResult(session, payload);
  }
  if (method === "revokeResult") {
    return revokeCandidateResult(session, payload);
  }
  throw new RecruitmentRuntimeError(`Phương thức ${method} chưa được hỗ trợ.`);
}
