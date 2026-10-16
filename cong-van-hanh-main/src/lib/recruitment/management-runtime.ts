import "server-only";

import { createHash, randomUUID } from "node:crypto";

import ExcelJS from "exceljs";
import * as XLSX from "xlsx";
import { Prisma } from "@/generated/prisma/client";
import type { AppSession } from "@/lib/auth/session";
import {
  canUsePortalModule,
  type PortalModuleAction,
} from "@/lib/auth/module-authorization";
import { getDb } from "@/lib/db";
import {
  asRecord,
  numberValue,
  text,
  type JsonRecord,
} from "@/lib/operations/json";
import {
  resolveOperationActor,
  type OperationActor,
} from "@/lib/operations/actor";
import { RecruitmentRuntimeError } from "@/lib/recruitment/errors";
import { isRecruitmentAdministrator } from "@/lib/recruitment/access-policy";
import { requestAttachmentStorage } from "@/lib/requests/attachments";
import { registerFileMetadata } from "@/lib/storage";
import {
  candidateAvailableOrder,
  candidateSequence,
  compactCandidateNumbers,
} from "@/lib/recruitment/candidate-numbering";
import {
  getRecruitmentFormSyncStatus,
  getRecruitmentTrackingSyncStatus,
  runRecruitmentFormSync,
  runRecruitmentTrackingSync,
} from "@/lib/recruitment/form-sync";

const STAGES = [
  { key: "cv_screening", label: "Lọc hồ sơ", order: 1 },
  { key: "preliminary", label: "Sơ vấn", order: 2 },
  { key: "test", label: "Bài đánh giá", order: 3 },
  { key: "round1", label: "Phỏng vấn vòng 1", order: 4 },
  { key: "round2", label: "Phỏng vấn vòng 2", order: 5 },
  { key: "offer", label: "Offer", locked: true, order: 6 },
  { key: "onboarding", label: "Nhận việc", locked: true, order: 7 },
  { key: "closed", label: "Đã đóng", order: 8 },
] as const;
const PROGRESS = [
  { key: "pending", label: "Chờ xử lý" },
  { key: "waiting", label: "Đang chờ" },
  { key: "in_progress", label: "Đang thực hiện" },
  { key: "scheduled", label: "Đã xếp lịch" },
  { key: "completed", label: "Hoàn tất" },
] as const;
const OUTCOMES = [
  { key: "", label: "Chưa kết luận" },
  { key: "pass", label: "Đạt" },
  { key: "consider", label: "Cân nhắc" },
  { key: "no_contact", label: "Chưa liên hệ được" },
  { key: "talent_pool", label: "Lưu hồ sơ" },
  { key: "rejected", label: "Không phù hợp" },
  { key: "hired", label: "Đã nhận việc" },
] as const;
const ROLE_LABELS: Record<string, string> = {
  balance: "Đánh giá cân bằng",
  combined: "Chuyên môn & Văn hóa",
  culture: "Đánh giá văn hóa",
  decision: "Quyết định",
  interviewer: "Người phỏng vấn",
  technical: "Đánh giá chuyên môn",
};
const TEMP_JD_SOURCE = "__POSTGRES_RECRUITMENT_TEMP_JD__";

type AssessmentScope = "technical" | "culture";

function reviewerScopes(value: JsonRecord): AssessmentScope[] {
  const requested = Array.isArray(value.scopeKeys)
    ? value.scopeKeys.map(text)
    : [];
  const scopes = new Set<AssessmentScope>();
  for (const scope of requested) {
    if (scope === "technical" || scope === "culture") scopes.add(scope);
  }
  if (!scopes.size) {
    const roleKey = text(value.roleKey);
    if (roleKey === "technical") scopes.add("technical");
    else if (roleKey === "culture") scopes.add("culture");
    else {
      scopes.add("technical");
      scopes.add("culture");
    }
  }
  return ["technical", "culture"].filter((scope) =>
    scopes.has(scope as AssessmentScope),
  ) as AssessmentScope[];
}

function roleForScopes(scopes: AssessmentScope[]) {
  if (scopes.length === 1) return scopes[0];
  return "combined";
}

function json(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function dateValue(value: unknown) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function unique(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map(text).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "vi"),
  );
}

function assertAdmin(
  actor: OperationActor,
  action: PortalModuleAction = "edit",
) {
  if (!canUsePortalModule(actor, "candidate-management", action)) {
    throw new RecruitmentRuntimeError(
      "Bạn không có quyền thay đổi dữ liệu Quản lý Ứng viên.",
      403,
    );
  }
}

function inferredStage(status: string | null | undefined) {
  const value = normalize(status);
  if (value.includes("nhan viec")) return "onboarding";
  if (value.includes("offer")) return "offer";
  if (value.includes("vong 2")) return "round2";
  if (value.includes("vong 1") || value.includes("phong van")) return "round1";
  if (value.includes("test") || value.includes("danh gia")) return "test";
  if (value.includes("lien he") || value.includes("so van")) return "preliminary";
  if (
    value.includes("loai") ||
    value.includes("khong phu hop") ||
    value.includes("luu tru")
  ) {
    return "closed";
  }
  return "cv_screening";
}

function stageLabel(key: string) {
  return STAGES.find((stage) => stage.key === key)?.label || key;
}

function roundKey(value: unknown) {
  const normalized = normalize(value).replace(/\s+/g, "_");
  if (normalized.includes("2")) return "round2";
  if (normalized.includes("pre") || normalized.includes("so_van")) {
    return "preliminary";
  }
  return "round1";
}

function roundLabel(key: string) {
  if (key === "preliminary") return "Sơ vấn";
  return key === "round2" ? "Phỏng vấn vòng 2" : "Phỏng vấn vòng 1";
}

function applicationCode() {
  return `APP-${Date.now().toString(36).toUpperCase()}-${randomUUID()
    .slice(0, 6)
    .toUpperCase()}`;
}

function candidateCode(sequence: number) {
  return `UV-${new Date().getFullYear()}-${String(sequence).padStart(5, "0")}`;
}

function safeRecord(value: unknown) {
  return asRecord(value);
}

export async function getRecruitmentManagementWorkspace(
  session: AppSession,
  payload: JsonRecord = {},
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "view");
  const db = getDb();
  const limit = Math.min(500, Math.max(40, numberValue(payload.limit, 260)));
  const query = text(payload.query);
  const position = text(payload.position);
  const requestedStage = text(payload.stage);
  const applicationWhere: Prisma.RecruitmentApplicationWhereInput = {
    status: { notIn: ["IMPORTED", "ARCHIVED_DUPLICATE"] },
    ...(position ? { position } : {}),
    ...(requestedStage
      ? { journey: { is: { stageKey: requestedStage } } }
      : {}),
    ...(query
      ? {
          OR: [
            { applicationCode: { contains: query, mode: "insensitive" } },
            { candidateCode: { contains: query, mode: "insensitive" } },
            { position: { contains: query, mode: "insensitive" } },
            {
              candidate: {
                is: { fullName: { contains: query, mode: "insensitive" } },
              },
            },
            {
              candidate: {
                is: { phone: { contains: query, mode: "insensitive" } },
              },
            },
            {
              candidate: {
                is: { email: { contains: query, mode: "insensitive" } },
              },
            },
          ],
        }
      : {}),
  };
  const [
    applications,
    campaigns,
    requisitions,
    intake,
    sources,
    reviewers,
    companies,
    snapshotGroups,
    formSync,
    trackingSync,
  ] = await Promise.all([
    db.recruitmentApplication.findMany({
      include: {
        assignments: true,
        campaign: true,
        candidate: true,
        interviews: {
          include: {
            assignments: true,
            scorecards: true,
          },
          orderBy: { startAt: "desc" },
        },
        journey: true,
        legacySnapshots: {
          orderBy: [{ sourceUpdatedAt: "desc" }, { createdAt: "desc" }],
          select: {
            createdAt: true,
            id: true,
            sourceUpdatedAt: true,
          },
          where: { kind: "hexaco" },
        },
        scorecards: true,
        timeline: { orderBy: { createdAt: "desc" }, take: 80 },
      },
      orderBy: [{ receivedAt: "desc" }, { updatedAt: "desc" }],
      take: limit,
      where: applicationWhere,
    }),
    db.recruitmentCampaign.findMany({
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 400,
    }),
    db.recruitmentRequisition.findMany({
      orderBy: [{ recruitmentStatus: "asc" }, { updatedAt: "desc" }],
      take: 400,
    }),
    db.recruitmentIntake.findMany({
      orderBy: { updatedAt: "desc" },
      take: 400,
      where: { status: { not: "ARCHIVED" } },
    }),
    db.recruitmentSourceDefinition.findMany({
      orderBy: { name: "asc" },
      take: 300,
    }),
    db.employee.findMany({
      orderBy: { fullName: "asc" },
      select: {
        department: true,
        employeeCode: true,
        fullName: true,
        id: true,
        title: true,
      },
      take: 1000,
      where: { archivedAt: null, status: "ACTIVE" },
    }),
    db.company.findMany({
      orderBy: [{ legalName: "asc" }],
      select: { code: true, legalName: true, shortName: true },
      where: { archivedAt: null, status: "ACTIVE" },
    }),
    db.recruitmentLegacySnapshot.groupBy({
      _count: { _all: true },
      by: ["kind"],
    }),
    getRecruitmentFormSyncStatus(),
    getRecruitmentTrackingSyncStatus(),
  ]);

  const now = Date.now();
  const canonicalCompany = (value: unknown) => {
    const raw = text(value);
    if (!raw) return "";
    const key = normalize(raw);
    const matched = companies.find((company) =>
      [company.code, company.shortName, company.legalName]
        .map(normalize)
        .includes(key),
    );
    return matched?.legalName || raw;
  };
  const candidates = applications.map((application) => {
    const stageKey =
      application.journey?.stageKey || inferredStage(application.status);
    const stage = STAGES.find((item) => item.key === stageKey) || STAGES[0];
    const submitted = application.scorecards.filter(
      (card) => card.status.toLowerCase() === "submitted",
    );
    const score =
      submitted.length > 0
        ? submitted.reduce(
            (sum, card) => sum + Number(card.finalScore || 0),
            0,
          ) / submitted.length
        : null;
    const dueAt = application.journey?.dueAt;
    return {
      age: (() => {
        const birthDate = dateValue(application.candidate.birthDate);
        return birthDate
          ? Math.max(
              0,
              new Date().getFullYear() - birthDate.getFullYear(),
            )
          : null;
      })(),
      applicationCode: application.applicationCode,
      applicationId: application.id,
      candidateCode: application.candidateCode || "",
      department: application.department || "",
      dueAt: dueAt?.toISOString() || "",
      email: application.candidate.email || "",
      isOverdue: Boolean(
        dueAt &&
          dueAt.getTime() < now &&
          application.journey?.progressKey !== "completed",
      ),
      level: application.level || "",
      name: application.candidate.fullName,
      nextAction: application.journey?.nextAction || "",
      outcomeKey: application.journey?.outcomeKey || "",
      ownerEmployeeId: application.journey?.ownerEmployeeId || "",
      ownerName: application.journey?.ownerName || application.recruiter || "",
      phone: application.candidate.phone || "",
      position: application.position || "",
      progressKey: application.journey?.progressKey || "pending",
      receivedAt: application.receivedAt?.toISOString() || "",
      requisitionCode: application.requisitionCode || "",
      scoreSummary: {
        completed: submitted.length,
        finalScore: score == null ? "" : Math.round(score * 100) / 100,
        total: application.scorecards.length,
      },
      source: application.source || "",
      stageKey,
      stageLabel: stage.label,
      status: application.status || "",
      testCompletedAt:
        application.legacySnapshots[0]?.sourceUpdatedAt?.toISOString() ||
        application.legacySnapshots[0]?.createdAt.toISOString() ||
        "",
      testResultCount: application.legacySnapshots.length,
      testStatus:
        application.journey?.testStatus ||
        (application.legacySnapshots.length ? "completed" : "pending"),
      cvUrl: application.cvUrl || "",
      campaignId: application.campaignId || "",
      interviews: application.interviews.map((interview) => ({
        assignments: interview.assignments.map((assignment) => ({
          id: assignment.id,
          reviewerEmployeeId: assignment.reviewerEmployeeId || "",
          reviewerName: assignment.reviewerName,
          roleKey: assignment.roleKey,
          roleLabel: assignment.roleLabel,
          scopeKeys: reviewerScopes({ roleKey: assignment.roleKey }),
          scorecardStatus:
            interview.scorecards.find(
              (scorecard) => scorecard.assignmentId === assignment.id,
            )?.status || "",
          status: assignment.status,
        })),
        id: interview.id,
        location: interview.location || "",
        meetingLink: interview.meetingLink || "",
        note: interview.note || "",
        roundKey: roundKey(interview.roundKey),
        roundLabel: interview.roundLabel,
        startAt: interview.startAt?.toISOString() || "",
        status: interview.status,
      })),
      timeline: application.timeline.map((item) => ({
        actorName: item.actorName || "",
        createdAt: item.createdAt.toISOString(),
        detail: item.detail || "",
        eventType: item.eventType,
        title: item.title,
      })),
    };
  });

  const interviews = candidates
    .flatMap((candidate) =>
      candidate.interviews.map((interview) => ({
        ...interview,
        applicationId: candidate.applicationId,
        candidateCode: candidate.candidateCode,
        candidateName: candidate.name,
        position: candidate.position,
      })),
    )
    .sort((left, right) =>
      String(left.startAt).localeCompare(String(right.startAt)),
    );
  const missingScorecards = applications.flatMap((application) =>
    application.interviews.flatMap((interview) =>
      interview.assignments
        .filter(
          (assignment) =>
            assignment.status !== "cancelled" &&
            !application.scorecards.some(
              (card) =>
                card.assignmentId === assignment.id &&
                card.status.toLowerCase() === "submitted",
            ),
        )
        .map((assignment) => ({
          applicationId: application.id,
          candidateName: application.candidate.fullName,
          interviewId: interview.id,
          reviewerName: assignment.reviewerName,
          roundLabel: interview.roundLabel,
          startAt: interview.startAt?.toISOString() || "",
        })),
    ),
  );
  const activeCandidates = candidates.filter(
    (candidate) => candidate.stageKey !== "closed",
  );
  const priority = activeCandidates
    .filter(
      (candidate) =>
        candidate.isOverdue ||
        ["cv_screening", "preliminary"].includes(candidate.stageKey),
    )
    .slice(0, 30);
  const duplicateGroups = (
    ["phone", "email"] as const
  ).flatMap((field) => {
    const groups = new Map<string, typeof candidates>();
    for (const item of candidates) {
      const value = normalize(item[field]);
      if (!value) continue;
      groups.set(value, [...(groups.get(value) || []), item]);
    }
    return Array.from(groups.entries())
      .filter(([, items]) => items.length > 1)
      .map(([value, items]) => ({
        field,
        items: items.map((item) => ({
          applicationId: item.applicationId,
          candidateCode: item.candidateCode,
          name: item.name,
          position: item.position,
          receivedAt: item.receivedAt,
          status: item.status,
        })),
        value,
      }));
  });

  const sourceCampaignRows = campaigns.map((item) => ({
      availableOrder: item.availableOrder || "",
      block: item.block || "",
      campaignName: item.campaignName || "",
      code: item.code,
      company: canonicalCompany(item.company),
      cvType: item.cvType || "",
      department: item.department || "",
      division: item.division || "",
      endDate: item.endDate?.toISOString().slice(0, 10) || "",
      groupName: item.groupName || "",
      id: item.id,
      location: item.location || "",
      position: item.position,
      source: item.source,
      startDate: item.startDate?.toISOString().slice(0, 10) || "",
      status: item.status,
      team: item.team || "",
    }));
  const campaignRows = Array.from(
    sourceCampaignRows.reduce((map, item) => {
      const existing = map.get(item.code);
      const sourceConfig = {
        campaignName: item.campaignName,
        cvType: item.cvType,
        id: item.id,
        source: item.source,
      };
      if (existing) {
        existing.sources.push(item.source);
        existing.sourceConfigs.push(sourceConfig);
      } else {
        map.set(item.code, {
          ...item,
          sourceConfigs: [sourceConfig],
          sources: [item.source],
        });
      }
      return map;
    }, new Map<string, (typeof sourceCampaignRows)[number] & {
      sourceConfigs: Array<{ campaignName: string; cvType: string; id: string; source: string }>;
      sources: string[];
    }>()),
  ).map(([, item]) => item);
  const organizationPaths = Array.from(
    new Map(
      campaignRows.map((item) => {
        const path = {
          block: item.block,
          company: item.company,
          department: item.department,
          division: item.division,
          groupName: item.groupName,
          location: item.location,
          team: item.team,
        };
        return [JSON.stringify(path), path] as const;
      }),
    ).values(),
  );

  return {
    campaigns: campaignRows,
    candidates,
    dashboard: {
      activeCampaigns: campaignRows.filter((item) => item.status === "OPEN").length,
      activeCandidates: activeCandidates.length,
      intakePending: intake.filter((item) => item.status === "PENDING").length,
      missingScorecards: missingScorecards.length,
      needAttention: priority.length,
      upcomingInterviews: interviews.filter(
        (item) =>
          item.status !== "cancelled" &&
          item.startAt &&
          new Date(item.startAt).getTime() >= now,
      ).length,
    },
    dataQuality: {
      duplicateGroups,
      missingCode: candidates.filter((item) => !item.candidateCode).length,
      missingCv: candidates.filter((item) => !item.cvUrl).length,
      missingPhone: candidates.filter((item) => !item.phone).length,
      missingPosition: candidates.filter((item) => !item.position).length,
    },
    dropdowns: {
      companies: unique([
        ...companies.map((item) => item.legalName),
        ...campaigns.map((item) => canonicalCompany(item.company)),
        ...requisitions.map((item) => canonicalCompany(item.company)),
      ]),
      companyOptions: companies.map((item) => ({
        aliases: unique([item.code, item.shortName, item.legalName]),
        code: item.code,
        label: item.legalName,
        value: item.legalName,
      })),
      blocks: unique(campaigns.map((item) => item.block)),
      cvTypes: unique(campaigns.map((item) => item.cvType)),
      departments: unique([
        ...campaigns.map((item) => item.department),
        ...requisitions.map((item) => item.department),
      ]),
      divisions: unique(campaigns.map((item) => item.division)),
      groups: unique(campaigns.map((item) => item.groupName)),
      locations: unique(campaigns.map((item) => item.location)),
      positions: unique([
        ...applications.map((item) => item.position),
        ...campaigns.map((item) => item.position),
        ...requisitions.map((item) => item.position),
      ]),
      teams: unique(campaigns.map((item) => item.team)),
    },
    generatedAt: new Date().toISOString(),
    formSync,
    trackingSync,
    intake: intake.map((item) => ({
      cvUrl: item.cvUrl || "",
      email: item.email || "",
      fullName: item.fullName || "",
      id: item.id,
      phone: item.phone || "",
      position: item.position || "",
      raw: safeRecord(item.raw),
      requisitionCode: item.requisitionCode || "",
      source: item.source || "",
      status: item.status,
      updatedAt: item.updatedAt.toISOString(),
    })),
    interviews,
    missingScorecards,
    pipeline: STAGES.map((stage) => ({
      ...stage,
      count: candidates.filter((item) => item.stageKey === stage.key).length,
      overdue: candidates.filter(
        (item) => item.stageKey === stage.key && item.isOverdue,
      ).length,
    })),
    priority,
    progressOptions: PROGRESS,
    outcomeOptions: OUTCOMES,
    organizationPaths,
    requisitions: requisitions.map((item) => ({
      cancellationStage: item.cancellationStage || "",
      company: item.company || "",
      department: item.department || "",
      id: item.id,
      intakeStatus: item.intakeStatus || "",
      jobCode: item.jobCode || "",
      level: item.level || "",
      note: item.note || "",
      onboardDueAt: item.onboardDueAt?.toISOString().slice(0, 10) || "",
      position: item.position,
      quarter: item.quarter || "",
      reason: item.reason || "",
      receivedAt: item.receivedAt?.toISOString().slice(0, 10) || "",
      recruiter: item.recruiter || "",
      recruitmentStatus: item.recruitmentStatus || "",
      requestedQuantity: item.requestedQuantity,
      requisitionCode: item.requisitionCode,
      year: item.year,
    })),
    reviewerOptions: reviewers.map((item) => ({
      department: item.department || "",
      employeeCode: item.employeeCode,
      employeeId: item.id,
      label: `${item.fullName} · ${item.employeeCode}${
        item.department ? ` · ${item.department}` : ""
      }`,
      name: item.fullName,
      title: item.title || "",
    })),
    snapshotGroups: snapshotGroups.map((item) => ({
      count: item._count._all,
      kind: item.kind,
    })),
    sources: sources.map((item) => ({
      configured: Object.values(safeRecord(item.mapping)).some((value) => text(value)),
      id: item.id,
      mapping: safeRecord(item.mapping),
      name: item.name,
      status: item.status,
    })),
    stages: STAGES,
    viewer: {
      employeeId: actor.employeeId,
      isAdmin: isRecruitmentAdministrator(actor),
      name: actor.displayName,
    },
  };
}

async function appendTimeline(
  applicationId: string,
  actor: OperationActor,
  event: {
    detail?: string;
    eventType: string;
    fromValue?: string;
    title: string;
    toValue?: string;
  },
) {
  await getDb().recruitmentTimeline.create({
    data: {
      actorEmployeeId: actor.employeeId || null,
      actorName: actor.displayName,
      applicationId,
      detail: event.detail || null,
      eventType: event.eventType,
      fromValue: event.fromValue || null,
      title: event.title,
      toValue: event.toValue || null,
    },
  });
}

async function saveJourney(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const applicationId = text(payload.applicationId);
  const stageKey = text(payload.stageKey);
  const progressKey = text(payload.progressKey) || "pending";
  const outcomeKey = text(payload.outcomeKey);
  if (!applicationId || !STAGES.some((item) => item.key === stageKey)) {
    throw new RecruitmentRuntimeError("Bước tuyển dụng chưa hợp lệ.");
  }
  if (["offer", "onboarding"].includes(stageKey)) {
    throw new RecruitmentRuntimeError(
      "Luồng Offer và nhận việc đang tạm khóa theo yêu cầu.",
    );
  }
  if (!PROGRESS.some((item) => item.key === progressKey)) {
    throw new RecruitmentRuntimeError("Tiến độ xử lý chưa hợp lệ.");
  }
  if (!OUTCOMES.some((item) => item.key === outcomeKey)) {
    throw new RecruitmentRuntimeError("Kết quả xử lý chưa hợp lệ.");
  }
  const db = getDb();
  const application = await db.recruitmentApplication.findUnique({
    include: { journey: true },
    where: { id: applicationId },
  });
  if (!application) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  const before = application.journey?.stageKey || inferredStage(application.status);
  const dueAt = dateValue(payload.dueAt);
  await db.$transaction([
    db.recruitmentJourney.upsert({
      create: {
        applicationId,
        dueAt,
        nextAction: text(payload.nextAction) || null,
        outcomeKey: outcomeKey || null,
        ownerEmployeeId: text(payload.ownerEmployeeId) || actor.employeeId || null,
        ownerName: text(payload.ownerName) || actor.displayName,
        progressKey,
        stageKey,
        updatedByName: actor.displayName,
      },
      update: {
        dueAt,
        nextAction: text(payload.nextAction) || null,
        outcomeKey: outcomeKey || null,
        ownerEmployeeId: text(payload.ownerEmployeeId) || actor.employeeId || null,
        ownerName: text(payload.ownerName) || actor.displayName,
        progressKey,
        stageKey,
        updatedByName: actor.displayName,
      },
      where: { applicationId },
    }),
    db.recruitmentApplication.update({
      data: {
        note: text(payload.note) || application.note,
        status: stageLabel(stageKey),
      },
      where: { id: applicationId },
    }),
    db.recruitmentTimeline.create({
      data: {
        actorEmployeeId: actor.employeeId || null,
        actorName: actor.displayName,
        applicationId,
        detail: text(payload.note) || text(payload.nextAction) || null,
        eventType: "journey",
        fromValue: before,
        title: `Chuyển sang ${stageLabel(stageKey)}`,
        toValue: stageKey,
      },
    }),
  ]);
  return { message: `Đã cập nhật hành trình sang ${stageLabel(stageKey)}.` };
}

async function transferCandidate(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const applicationId = text(payload.applicationId);
  const campaignId = text(payload.campaignId);
  const db = getDb();
  const campaign = await db.recruitmentCampaign.findUnique({
    where: { id: campaignId },
  });
  if (!applicationId || !campaign) {
    throw new RecruitmentRuntimeError("Nhu cầu tuyển dụng mới không hợp lệ.");
  }
  const current = await db.recruitmentApplication.findUnique({
    where: { id: applicationId },
  });
  if (!current) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  await db.recruitmentApplication.update({
    data: {
      campaignId,
      company: campaign.company,
      department: campaign.department,
      position: text(payload.position) || campaign.position,
      requisitionCode: campaign.code,
      source: campaign.source,
    },
    where: { id: applicationId },
  });
  await appendTimeline(applicationId, actor, {
    detail: `${current.requisitionCode || "—"} → ${campaign.code}`,
    eventType: "transfer",
    fromValue: current.requisitionCode || "",
    title: "Điều chuyển hồ sơ",
    toValue: campaign.code,
  });
  return { message: `Đã điều chuyển hồ sơ sang ${campaign.code}.` };
}

async function saveInterview(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const applicationId = text(payload.applicationId);
  const normalizedRound = roundKey(payload.roundKey);
  const startAt = dateValue(payload.startAt);
  const reviewerRows = Array.isArray(payload.reviewers)
    ? payload.reviewers.map(asRecord).filter((item) => text(item.employeeId))
    : [];
  const reviewerMap = new Map<
    string,
    { employeeId: string; scopes: Set<AssessmentScope> }
  >();
  for (const reviewer of reviewerRows) {
    const employeeId = text(reviewer.employeeId);
    const current = reviewerMap.get(employeeId) || {
      employeeId,
      scopes: new Set<AssessmentScope>(),
    };
    for (const scope of reviewerScopes(reviewer)) current.scopes.add(scope);
    reviewerMap.set(employeeId, current);
  }
  const reviewers = Array.from(reviewerMap.values()).map((reviewer) => ({
    employeeId: reviewer.employeeId,
    roleKey: roleForScopes(Array.from(reviewer.scopes)),
  }));
  if (!applicationId || !startAt) {
    throw new RecruitmentRuntimeError(
      "Vui lòng chọn ứng viên, ngày và giờ phỏng vấn.",
    );
  }
  if (!reviewers.length) {
    throw new RecruitmentRuntimeError(
      "Vui lòng phân công ít nhất một người phỏng vấn.",
    );
  }
  const db = getDb();
  const [application, employees] = await Promise.all([
    db.recruitmentApplication.findUnique({ where: { id: applicationId } }),
    db.employee.findMany({
      where: { id: { in: reviewers.map((item) => text(item.employeeId)) } },
    }),
  ]);
  if (!application) {
    throw new RecruitmentRuntimeError("Không tìm thấy hồ sơ ứng viên.", 404);
  }
  if (employees.length !== new Set(reviewers.map((item) => text(item.employeeId))).size) {
    throw new RecruitmentRuntimeError(
      "Có người phỏng vấn không còn trong danh sách nhân sự.",
    );
  }
  const employeeMap = new Map(employees.map((item) => [item.id, item]));
  const interview = await db.$transaction(async (tx) => {
    const current = text(payload.interviewId)
      ? await tx.recruitmentInterview.findUnique({
          where: { id: text(payload.interviewId) },
        })
      : await tx.recruitmentInterview.findFirst({
          where: {
            applicationId,
            roundKey: normalizedRound,
            status: { not: "cancelled" },
          },
        });
    const saved = current
      ? await tx.recruitmentInterview.update({
          data: {
            location: text(payload.location) || null,
            meetingLink: text(payload.meetingLink) || null,
            note: text(payload.note) || null,
            roundKey: normalizedRound,
            roundLabel: roundLabel(normalizedRound),
            startAt,
            status: "scheduled",
            updatedByName: actor.displayName,
          },
          where: { id: current.id },
        })
      : await tx.recruitmentInterview.create({
          data: {
            applicationId,
            createdByName: actor.displayName,
            location: text(payload.location) || null,
            meetingLink: text(payload.meetingLink) || null,
            note: text(payload.note) || null,
            roundKey: normalizedRound,
            roundLabel: roundLabel(normalizedRound),
            startAt,
            status: "scheduled",
            updatedByName: actor.displayName,
          },
        });
    await tx.recruitmentAssignment.updateMany({
      data: { status: "cancelled" },
      where: { interviewId: saved.id, status: { not: "cancelled" } },
    });
    for (const reviewer of reviewers) {
      const employee = employeeMap.get(text(reviewer.employeeId));
      if (!employee) continue;
      const roleKey = text(reviewer.roleKey) || "interviewer";
      await tx.recruitmentAssignment.create({
        data: {
          applicationId,
          interviewId: saved.id,
          reviewerEmployeeId: employee.id,
          reviewerName: employee.fullName,
          roleKey,
          roleLabel: ROLE_LABELS[roleKey] || "Người phỏng vấn",
          roundKey: normalizedRound,
          status: "assigned",
        },
      });
    }
    await tx.recruitmentJourney.upsert({
      create: {
        applicationId,
        dueAt: startAt,
        nextAction: `Theo dõi buổi ${roundLabel(normalizedRound)}`,
        ownerEmployeeId: actor.employeeId || null,
        ownerName: actor.displayName,
        progressKey: "scheduled",
        stageKey: normalizedRound,
        updatedByName: actor.displayName,
      },
      update: {
        dueAt: startAt,
        nextAction: `Theo dõi buổi ${roundLabel(normalizedRound)}`,
        progressKey: "scheduled",
        stageKey: normalizedRound,
        updatedByName: actor.displayName,
      },
      where: { applicationId },
    });
    await tx.recruitmentTimeline.create({
      data: {
        actorEmployeeId: actor.employeeId || null,
        actorName: actor.displayName,
        applicationId,
        detail: `${startAt.toLocaleString("vi-VN")} · ${reviewers.length} người phỏng vấn`,
        eventType: "schedule",
        title: `Đã xếp lịch ${roundLabel(normalizedRound)}`,
        toValue: normalizedRound,
      },
    });
    return saved;
  });
  return {
    id: interview.id,
    message: `Đã xếp lịch ${roundLabel(normalizedRound)} và phân công ${reviewers.length} người.`,
  };
}

async function saveCampaign(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const db = getDb();
  const mode = text(payload.mode) || "create";
  const requestedCode = text(payload.code || payload.existingCode).toUpperCase();
  const existingRows = requestedCode
    ? await db.recruitmentCampaign.findMany({ where: { code: requestedCode } })
    : [];
  const existing = existingRows[0];
  const position = text(payload.position) || existing?.position || "";
  const sourceRows = Array.isArray(payload.sources)
    ? payload.sources.map(asRecord)
    : [];
  const fallbackSource = text(payload.source);
  const sources = sourceRows.length
    ? sourceRows
    : [{ source: fallbackSource, campaignName: payload.campaignName, cvType: payload.cvType }];
  if (!position || (mode !== "update" && !sources.some((item) => text(item.source)))) {
    throw new RecruitmentRuntimeError(
      "Vui lòng nhập vị trí và chọn ít nhất một nguồn hồ sơ.",
    );
  }
  const code =
    requestedCode ||
    `TD-${new Date().getFullYear()}-${String(
      (await db.recruitmentCampaign.count()) + 1,
    ).padStart(4, "0")}`;
  const common = {
    availableOrder: text(payload.availableOrder) || null,
    block: text(payload.block) || existing?.block || null,
    company: text(payload.company) || existing?.company || null,
    department: text(payload.department) || existing?.department || null,
    division: text(payload.division) || existing?.division || null,
    endDate: dateValue(payload.endDate) || existing?.endDate || null,
    groupName: text(payload.groupName || payload.group) || existing?.groupName || null,
    location: text(payload.location) || existing?.location || null,
    orgPath:
      [
        text(payload.department) || existing?.department || "",
        text(payload.division) || existing?.division || "",
        text(payload.team) || existing?.team || "",
        text(payload.groupName || payload.group) || existing?.groupName || "",
      ]
        .filter(Boolean)
        .join(" › ") || null,
    position,
    startDate: dateValue(payload.startDate) || existing?.startDate || null,
    status: text(payload.status) || existing?.status || "OPEN",
    team: text(payload.team) || existing?.team || null,
  };
  if (text(payload.id)) {
    const source = sources.find((item) => text(item.source)) || sources[0];
    await db.recruitmentCampaign.update({
      data: {
        ...common,
        campaignName: text(source.campaignName) || text(payload.campaignName) || null,
        cvType: text(source.cvType) || text(payload.cvType) || null,
        source: text(source.source),
      },
      where: { id: text(payload.id) },
    });
    return { code, message: `Đã cập nhật nhu cầu ${code}.` };
  }
  if (mode === "update" && requestedCode) {
    const result = await db.recruitmentCampaign.updateMany({
      data: {
        ...common,
        ...(text(payload.campaignName)
          ? { campaignName: text(payload.campaignName) }
          : {}),
      },
      where: { code: requestedCode },
    });
    if (!result.count) {
      throw new RecruitmentRuntimeError(`Không tìm thấy nhu cầu ${requestedCode}.`, 404);
    }
    return {
      code: requestedCode,
      message: `Đã cập nhật ${result.count} nguồn của nhu cầu ${requestedCode}.`,
    };
  }
  await db.$transaction(
    sources
      .filter((item) => text(item.source))
      .map((source) =>
        db.recruitmentCampaign.upsert({
          create: {
            ...common,
            campaignName:
              text(source.campaignName) || text(payload.campaignName) || null,
            code,
            cvType: text(source.cvType) || null,
            raw: json({ createdBy: actor.displayName }),
            source: text(source.source),
          },
          update: {
            ...common,
            campaignName:
              text(source.campaignName) || text(payload.campaignName) || null,
            cvType: text(source.cvType) || null,
          },
          where: { code_source: { code, source: text(source.source) } },
        }),
      ),
  );
  return { code, message: `Đã lưu nhu cầu ${code} với ${sources.length} nguồn.` };
}

async function saveManualIntake(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const rows = Array.isArray(payload.rows)
    ? payload.rows.map(asRecord)
    : [payload];
  const valid = rows.filter(
    (item) =>
      text(item.fullName) &&
      (text(item.phone) || text(item.email)),
  );
  if (!valid.length) {
    throw new RecruitmentRuntimeError(
      "Mỗi hồ sơ cần có họ tên và ít nhất số điện thoại hoặc email.",
    );
  }
  await getDb().recruitmentIntake.createMany({
    data: valid.map((item) => ({
      cvUrl: text(item.cvUrl) || null,
      email: text(item.email) || null,
      fullName: text(item.fullName),
      phone: text(item.phone) || null,
      position: text(item.position) || null,
      raw: json({ enteredBy: actor.displayName, mode: "manual" }),
      requisitionCode: text(item.requisitionCode) || null,
      source: text(item.source) || null,
      status: "PENDING",
    })),
  });
  return { imported: valid.length, message: `Đã đưa ${valid.length} hồ sơ vào danh sách rà soát.` };
}

function csvRows(content: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (char === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && content[index + 1] === "\n") index += 1;
      row.push(cell);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

export async function readRecruitmentSourceHeadersFromUpload(
  payload: JsonRecord,
) {
  const fileName = text(payload.fileName) || "Nguon_ung_vien.xlsx";
  const base64 = text(payload.base64).replace(/^data:[^;]+;base64,/, "");
  if (!base64) {
    throw new RecruitmentRuntimeError(
      "Vui lòng chọn file Excel hoặc CSV mẫu.",
    );
  }
  const buffer = Buffer.from(base64, "base64");
  if (buffer.byteLength > 12 * 1024 * 1024) {
    throw new RecruitmentRuntimeError("File mẫu tối đa 12 MB.");
  }

  let rows: string[][] = [];
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".csv")) {
    rows = csvRows(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } else if (lowerName.endsWith(".xls")) {
    const workbook = XLSX.read(buffer, { cellDates: true, type: "buffer" });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = firstSheet
      ? (XLSX.utils.sheet_to_json(firstSheet, {
          blankrows: false,
          defval: "",
          header: 1,
          raw: false,
        }) as unknown[][]).map((row) => row.map(text))
      : [];
  } else if (lowerName.endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
    const sheet = workbook.worksheets[0];
    if (sheet) {
      sheet.eachRow({ includeEmpty: true }, (excelRow) => {
        const values = Array.isArray(excelRow.values)
          ? excelRow.values.slice(1)
          : Object.values(excelRow.values || {});
        rows.push(
          values.map((value: unknown) =>
            value && typeof value === "object" && "text" in value
              ? text((value as { text?: unknown }).text)
              : text(value),
          ),
        );
      });
    }
  } else {
    throw new RecruitmentRuntimeError(
      "Chỉ hỗ trợ file CSV, XLS hoặc XLSX.",
    );
  }

  const scanned = rows.slice(0, 50);
  if (!scanned.length) {
    throw new RecruitmentRuntimeError("File mẫu không có dữ liệu.");
  }
  let headerIndex = 0;
  let populatedCount = -1;
  scanned.forEach((row, index) => {
    const count = row.filter((value) => text(value)).length;
    if (count > populatedCount) {
      headerIndex = index;
      populatedCount = count;
    }
  });
  const headers = (scanned[headerIndex] || []).map(text).filter(Boolean);
  const verticalLabels: string[] = [];
  scanned.slice(0, headerIndex).forEach((row) => {
    const label = text(row[0]);
    const hasValue = row.slice(1, 6).some((value) => text(value));
    if (label && hasValue && !verticalLabels.includes(label)) {
      verticalLabels.push(label);
    }
  });
  return {
    fileName,
    headerRow: headerIndex + 1,
    headers,
    message: `Đã nhận diện ${headers.length} cột ngang và ${verticalLabels.length} nhãn dọc.`,
    ok: true,
    options: [
      ...headers.map((header) => ({
        label: `Cột ngang · ${header}`,
        type: "horizontal",
        value: `H:${header}`,
      })),
      ...verticalLabels.map((label) => ({
        label: `Nhãn dọc · ${label}`,
        type: "vertical",
        value: `V:${label}`,
      })),
    ],
    sheetName: "Sheet1",
    verticalLabels,
  };
}

function mappedValue(
  row: string[],
  headerMap: Map<string, number>,
  mapping: JsonRecord,
  field: string,
  aliases: string[],
  verticalMap: Map<string, string> = new Map(),
) {
  const configured = text(
    mapping[field] || (field === "fullName" ? mapping.name : ""),
  );
  const configuredTokens = configured
    .split("|")
    .map((value) => value.trim())
    .filter(Boolean);
  const values: string[] = [];
  for (const token of configuredTokens) {
    const prefix = token.slice(0, 2).toUpperCase();
    const label = ["H:", "V:"].includes(prefix) ? token.slice(2) : token;
    if (prefix === "V:") {
      const value = verticalMap.get(normalize(label));
      if (value) values.push(value);
      continue;
    }
    const index = headerMap.get(normalize(label));
    if (index != null && text(row[index])) values.push(text(row[index]));
  }
  if (values.length) return unique(values).join(" ");
  for (const alias of aliases) {
    const index = headerMap.get(normalize(alias));
    if (index != null && text(row[index])) return text(row[index]);
  }
  return "";
}

async function importIntakeFile(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const fileName = text(payload.fileName);
  const base64 = text(payload.base64).replace(/^data:[^;]+;base64,/, "");
  if (!fileName || !base64) {
    throw new RecruitmentRuntimeError("Vui lòng chọn file CSV/XLSX cần nạp.");
  }
  const buffer = Buffer.from(base64, "base64");
  let rows: string[][] = [];
  if (fileName.toLowerCase().endsWith(".csv")) {
    rows = csvRows(buffer.toString("utf8").replace(/^\uFEFF/, ""));
  } else if (fileName.toLowerCase().endsWith(".xls")) {
    const workbook = XLSX.read(buffer, {
      cellDates: true,
      type: "buffer",
    });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    rows = firstSheet
      ? (XLSX.utils.sheet_to_json(firstSheet, {
          blankrows: false,
          defval: "",
          header: 1,
          raw: false,
        }) as unknown[][]).map((row) => row.map(text))
      : [];
  } else if (fileName.toLowerCase().endsWith(".xlsx")) {
    const workbook = new ExcelJS.Workbook();
    const workbookBuffer = Uint8Array.from(buffer).buffer;
    await workbook.xlsx.load(workbookBuffer);
    const sheet = workbook.worksheets[0];
    if (sheet) {
      sheet.eachRow({ includeEmpty: false }, (excelRow) => {
        const values = Array.isArray(excelRow.values)
          ? excelRow.values.slice(1)
          : Object.values(excelRow.values || {});
        rows.push(
          values.map((value: unknown) =>
              value && typeof value === "object" && "text" in value
                ? text((value as { text?: unknown }).text)
                : text(value),
            ),
        );
      });
    }
  } else {
    throw new RecruitmentRuntimeError("Chỉ hỗ trợ file CSV, XLS hoặc XLSX.");
  }
  if (rows.length < 2) {
    throw new RecruitmentRuntimeError("File không có dòng dữ liệu để nạp.");
  }
  const db = getDb();
  const sourceName = text(payload.source || payload.sourceName);
  const source = sourceName
    ? await db.recruitmentSourceDefinition.findUnique({
        where: { name: sourceName },
      })
    : null;
  const mapping = source ? safeRecord(source.mapping) : {};
  let headerIndex = 0;
  let populatedCount = -1;
  rows.slice(0, 50).forEach((row, index) => {
    const count = row.filter((value) => text(value)).length;
    if (count > populatedCount) {
      headerIndex = index;
      populatedCount = count;
    }
  });
  const headerMap = new Map(
    rows[headerIndex].map((header, index) => [normalize(header), index]),
  );
  const verticalMap = new Map<string, string>();
  rows.slice(0, headerIndex).forEach((row) => {
    const label = text(row[0]);
    const value = row.slice(1).map(text).find(Boolean);
    if (label && value) verticalMap.set(normalize(label), value);
  });
  const parsed = rows.slice(headerIndex + 1).map((row) => ({
    cvUrl: mappedValue(row, headerMap, mapping, "cvUrl", ["link cv", "cv url"], verticalMap),
    email: mappedValue(row, headerMap, mapping, "email", ["email", "e mail"], verticalMap),
    fullName: mappedValue(row, headerMap, mapping, "fullName", [
      "ho va ten",
      "ho ten",
      "ten ung vien",
      "name",
    ], verticalMap),
    phone: mappedValue(row, headerMap, mapping, "phone", [
      "dien thoai",
      "so dien thoai",
      "sdt",
      "phone",
    ], verticalMap),
    position: mappedValue(row, headerMap, mapping, "position", [
      "vi tri",
      "vi tri ung tuyen",
      "position",
    ], verticalMap),
    requisitionCode: mappedValue(
      row,
      headerMap,
      mapping,
      "requisitionCode",
      ["ma tuyen dung", "ma nhu cau", "requisition code"],
      verticalMap,
    ),
    source:
      sourceName ||
      mappedValue(row, headerMap, mapping, "source", [
        "nguon",
        "nguon ho so",
        "source",
      ], verticalMap),
  }));
  const valid = parsed.filter(
    (item) => item.fullName && (item.phone || item.email),
  );
  if (!valid.length) {
    throw new RecruitmentRuntimeError(
      "Không nhận diện được hồ sơ hợp lệ. Kiểm tra lại header hoặc mapping nguồn.",
    );
  }
  await db.recruitmentIntake.createMany({
    data: valid.map((item) => ({
      ...item,
      cvUrl: item.cvUrl || null,
      email: item.email || null,
      phone: item.phone || null,
      position: item.position || null,
      raw: json({ fileName, importedBy: actor.displayName }),
      requisitionCode: item.requisitionCode || null,
      source: item.source || null,
      status: "PENDING",
    })),
  });
  return {
    ignored: parsed.length - valid.length,
    imported: valid.length,
    message: `Đã nạp ${valid.length} hồ sơ từ ${fileName} vào Work Flow.`,
  };
}

async function importPdfIntake(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const source = text(payload.source);
  const position = text(payload.position);
  const files = Array.isArray(payload.files)
    ? payload.files.map(asRecord).filter((item) => text(item.base64) && text(item.fileName))
    : [];
  if (!source || !position || !files.length) {
    throw new RecruitmentRuntimeError("Vui lòng chọn nguồn, vị trí và ít nhất một CV PDF.");
  }
  if (files.length > 12) {
    throw new RecruitmentRuntimeError("Mỗi lần chỉ nạp tối đa 12 CV PDF.");
  }
  const bucket = text(process.env.ACCOUNTING_EXPORT_BUCKET);
  if (!bucket) {
    throw new RecruitmentRuntimeError("Kho file riêng tư của Cổng vận hành chưa được cấu hình.");
  }
  const db = getDb();
  let imported = 0;
  for (const file of files) {
    const fileName = text(file.fileName)
      .normalize("NFC")
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_")
      .slice(0, 180);
    if (!fileName.toLowerCase().endsWith(".pdf")) continue;
    const content = Buffer.from(
      text(file.base64).replace(/^data:[^;]+;base64,/, ""),
      "base64",
    );
    if (!content.length || content.byteLength > 8 * 1024 * 1024) {
      throw new RecruitmentRuntimeError(`CV “${fileName}” phải nhỏ hơn 8 MB.`);
    }
    const now = new Date();
    const objectKey = [
      "recruitment",
      "cv",
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      normalize(source).replace(/\s+/g, "-") || "khac",
      `${randomUUID()}-${fileName}`,
    ].join("/");
    await requestAttachmentStorage().bucket(bucket).file(objectKey).save(content, {
      contentType: "application/pdf",
      metadata: { cacheControl: "private, no-store, max-age=0" },
      resumable: false,
      validation: "crc32c",
    });
    const fileObject = await registerFileMetadata(db, {
      metadata: { position, source, sourceType: "RECRUITMENT_CV" },
      mimeType: "application/pdf",
      object: { bucket, objectKey, provider: "GCS" },
      originalName: fileName,
      ownerId: actor.userId,
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: BigInt(content.length),
    });
    await db.recruitmentIntake.create({
      data: {
        cvUrl: `/api/requests/files/${encodeURIComponent(fileObject.id)}`,
        fullName: fileName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim(),
        position,
        raw: json({
          fileName,
          fileObjectId: fileObject.id,
          importedBy: actor.displayName,
          needsReview: true,
          sourceType: "PDF_CV",
        }),
        source,
        status: "PENDING",
      },
    });
    imported += 1;
  }
  return {
    imported,
    message: `Đã lưu ${imported} CV PDF vào danh sách chờ rà soát.`,
    ok: true,
  };
}

async function promoteIntake(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const ids = Array.isArray(payload.ids) ? payload.ids.map(text).filter(Boolean) : [];
  if (!ids.length) {
    throw new RecruitmentRuntimeError("Vui lòng chọn ít nhất một hồ sơ.");
  }
  const db = getDb();
  const rows = await db.recruitmentIntake.findMany({
    where: { id: { in: ids }, status: "PENDING" },
  });
  let sequence = (await db.recruitmentApplication.count()) + 1;
  const existingApplications = await db.recruitmentApplication.findMany({
    select: { candidateCode: true, requisitionCode: true },
    where: { status: { notIn: ["ARCHIVED_DUPLICATE", "IMPORTED"] } },
  });
  const usedByRequest = new Map<string, Set<number>>();
  for (const application of existingApplications) {
    const requestCode = text(application.requisitionCode);
    if (!requestCode) continue;
    const candidateNumber = candidateSequence(application.candidateCode, requestCode);
    if (candidateNumber == null) continue;
    const used = usedByRequest.get(requestCode) || new Set<number>();
    used.add(candidateNumber);
    usedByRequest.set(requestCode, used);
  }
  let promoted = 0;
  for (const row of rows) {
    const existingCandidate = await db.recruitmentCandidate.findFirst({
      where: {
        OR: [
          ...(row.phone ? [{ phone: row.phone }] : []),
          ...(row.email ? [{ email: row.email }] : []),
        ],
      },
    });
    const candidate =
      existingCandidate ||
      (await db.recruitmentCandidate.create({
        data: {
          email: row.email,
          fullName: row.fullName || "Chưa rõ tên",
          phone: row.phone,
        },
      }));
    const campaign = row.requisitionCode
      ? await db.recruitmentCampaign.findFirst({
          where: { code: row.requisitionCode, status: "OPEN" },
        })
      : null;
    const requestCode = text(row.requisitionCode);
    let code = candidateCode(sequence);
    if (requestCode) {
      const used = usedByRequest.get(requestCode) || new Set<number>();
      let candidateNumber = 1;
      while (candidateNumber <= 999 && used.has(candidateNumber)) candidateNumber += 1;
      if (candidateNumber > 999) {
        throw new RecruitmentRuntimeError(
          `Nhu cầu ${requestCode} đã dùng hết 999 số ứng viên.`,
        );
      }
      used.add(candidateNumber);
      usedByRequest.set(requestCode, used);
      code = `${requestCode}-${String(candidateNumber).padStart(3, "0")}`;
    } else {
      sequence += 1;
    }
    await db.$transaction(async (tx) => {
      const application = await tx.recruitmentApplication.create({
        data: {
          applicationCode: applicationCode(),
          campaignId: campaign?.id || null,
          candidateCode: code,
          candidateId: candidate.id,
          company: campaign?.company || null,
          department: campaign?.department || null,
          position: row.position || campaign?.position || null,
          raw: json(row.raw),
          receivedAt: row.createdAt,
          recruiter: actor.displayName,
          requisitionCode: row.requisitionCode,
          source: row.source,
          status: "Mới nạp",
          cvUrl: row.cvUrl,
        },
      });
      await tx.recruitmentJourney.create({
        data: {
          applicationId: application.id,
          nextAction: "Rà soát CV và liên hệ ứng viên",
          ownerEmployeeId: actor.employeeId || null,
          ownerName: actor.displayName,
          progressKey: "pending",
          stageKey: "cv_screening",
          updatedByName: actor.displayName,
        },
      });
      await tx.recruitmentTimeline.create({
        data: {
          actorEmployeeId: actor.employeeId || null,
          actorName: actor.displayName,
          applicationId: application.id,
          detail: `Nguồn: ${row.source || "Chưa rõ"}`,
          eventType: "intake",
          title: "Đưa hồ sơ vào danh sách tuyển dụng",
        },
      });
      await tx.recruitmentIntake.update({
        data: { status: "PROMOTED" },
        where: { id: row.id },
      });
    });
    promoted += 1;
  }
  const orderUpdates = Array.from(usedByRequest, ([requestCode, used]) =>
      db.recruitmentCampaign.updateMany({
        data: { availableOrder: candidateAvailableOrder(used) },
        where: { code: requestCode },
      }),
    );
  if (orderUpdates.length) await db.$transaction(orderUpdates);
  return { message: `Đã cập nhật ${promoted} hồ sơ vào danh sách tuyển dụng chính.`, promoted };
}

async function archiveIntake(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "delete");
  const ids = Array.isArray(payload.ids) ? payload.ids.map(text).filter(Boolean) : [];
  if (!ids.length) {
    throw new RecruitmentRuntimeError("Vui lòng chọn hồ sơ cần lưu trữ.");
  }
  const result = await getDb().recruitmentIntake.updateMany({
    data: { status: "ARCHIVED" },
    where: { id: { in: ids }, status: { not: "PROMOTED" } },
  });
  return { message: `Đã lưu trữ ${result.count} hồ sơ khỏi Work Flow.` };
}

async function archiveDuplicateApplications(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "delete");
  const ids = Array.isArray(payload.ids) ? payload.ids.map(text).filter(Boolean) : [];
  if (!ids.length) {
    throw new RecruitmentRuntimeError("Vui lòng chọn bản ghi trùng cần lưu trữ.");
  }
  const db = getDb();
  const applications = await db.recruitmentApplication.findMany({
    select: { id: true, requisitionCode: true },
    where: { id: { in: ids }, status: { not: "ARCHIVED_DUPLICATE" } },
  });
  const affectedRequestCodes = unique(
    applications.map((application) => application.requisitionCode),
  );
  const sync = await db.$transaction(async (tx) => {
    for (const application of applications) {
      await tx.recruitmentApplication.update({
        data: { status: "ARCHIVED_DUPLICATE" },
        where: { id: application.id },
      });
      await tx.recruitmentJourney.upsert({
        create: {
          applicationId: application.id,
          nextAction: "Không còn việc cần làm",
          outcomeKey: "rejected",
          ownerEmployeeId: actor.employeeId || null,
          ownerName: actor.displayName,
          progressKey: "completed",
          stageKey: "closed",
          updatedByName: actor.displayName,
        },
        update: {
          nextAction: "Không còn việc cần làm",
          outcomeKey: "rejected",
          progressKey: "completed",
          stageKey: "closed",
          updatedByName: actor.displayName,
        },
        where: { applicationId: application.id },
      });
      await tx.recruitmentTimeline.create({
        data: {
          actorEmployeeId: actor.employeeId || null,
          actorName: actor.displayName,
          applicationId: application.id,
          detail: text(payload.note) || "Được HR xác nhận là hồ sơ trùng.",
          eventType: "archive_duplicate",
          title: "Lưu trữ hồ sơ trùng",
        },
      });
    }

    let renumberedRows = 0;
    for (const requestCode of affectedRequestCodes) {
      const remaining = await tx.recruitmentApplication.findMany({
        include: { scorecards: { select: { id: true } } },
        orderBy: [
          { receivedAt: "asc" },
          { legacyRowNumber: "asc" },
          { createdAt: "asc" },
        ],
        where: {
          requisitionCode: requestCode,
          status: { notIn: ["ARCHIVED_DUPLICATE", "IMPORTED"] },
        },
      });
      const plan = compactCandidateNumbers(
        remaining.map((application, index) => ({
          candidateCode: application.candidateCode,
          hasEvaluation: application.scorecards.length > 0,
          id: application.id,
          order: application.legacyRowNumber || index + 1,
          requisitionCode: requestCode,
          status: application.status,
        })),
      );
      for (const update of plan.updates) {
        await tx.recruitmentApplication.update({
          data: { candidateCode: update.to },
          where: { id: update.id },
        });
        await tx.recruitmentTimeline.create({
          data: {
            actorEmployeeId: actor.employeeId || null,
            actorName: actor.displayName,
            applicationId: update.id,
            detail: `${update.from || "Trống"} → ${update.to}`,
            eventType: "candidate_code_compaction",
            fromValue: update.from || null,
            title: "Dồn số thứ tự sau khi xóa hồ sơ trùng",
            toValue: update.to,
          },
        });
      }
      await tx.recruitmentCampaign.updateMany({
        data: { availableOrder: plan.availableOrder },
        where: { code: requestCode },
      });
      renumberedRows += plan.updates.length;
    }
    return {
      forbiddenChangedRows: 0,
      renumberedRows,
      scannedGroups: affectedRequestCodes.length,
    };
  });
  return {
    deleted: applications.length,
    message: `Đã lưu trữ ${applications.length} hồ sơ trùng và dồn lại ${sync.renumberedRows} mã ứng viên chưa phỏng vấn.`,
    sync,
  };
}

async function repairCandidateCodes(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const db = getDb();
  const applications = await db.recruitmentApplication.findMany({
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }],
    include: { scorecards: { select: { id: true } } },
    where: { status: { notIn: ["ARCHIVED_DUPLICATE", "IMPORTED"] } },
  });
  const groups = new Map<string, typeof applications>();
  for (const application of applications) {
    const requestCode = text(application.requisitionCode);
    if (!requestCode) continue;
    const rows = groups.get(requestCode) || [];
    rows.push(application);
    groups.set(requestCode, rows);
  }
  const plans = Array.from(groups, ([requestCode, rows]) => ({
    plan: compactCandidateNumbers(
      rows.map((application, index) => ({
        candidateCode: application.candidateCode,
        hasEvaluation: application.scorecards.length > 0,
        id: application.id,
        order: application.legacyRowNumber || index + 1,
        requisitionCode: requestCode,
        status: application.status,
      })),
    ),
    requestCode,
  }));
  const preview = plans.flatMap(({ requestCode, plan }) =>
    plan.updates.map((item) => ({
      applicationId: item.id,
      from: item.from,
      requestCode,
      to: item.to,
    })),
  );
  if (payload.apply === true) {
    await db.$transaction(async (tx) => {
      for (const item of preview) {
        await tx.recruitmentApplication.update({
          data: { candidateCode: item.to },
          where: { id: item.applicationId },
        });
        await tx.recruitmentTimeline.create({
          data: {
            actorEmployeeId: actor.employeeId || null,
            actorName: actor.displayName,
            applicationId: item.applicationId,
            detail: `${item.from || "Trống"} → ${item.to}`,
            eventType: "candidate_code_repair",
            fromValue: item.from || null,
            title: "Đồng bộ số thứ tự ứng viên theo V2",
            toValue: item.to,
          },
        });
      }
      for (const { requestCode, plan } of plans) {
        await tx.recruitmentCampaign.updateMany({
          data: { availableOrder: plan.availableOrder },
          where: { code: requestCode },
        });
      }
    });
  }
  return {
    applied: payload.apply === true ? preview.length : 0,
    message:
      payload.apply === true
        ? `Đã dồn ${preview.length} mã ứng viên còn ở bước sớm; mã của người đã phỏng vấn được giữ nguyên.`
        : preview.length
          ? `Có ${preview.length} mã của hồ sơ chưa phỏng vấn có thể dồn lại.`
          : "Số thứ tự ứng viên đã đúng theo quy tắc V2.",
    preview,
  };
}

async function saveSourceDefinition(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const name = text(payload.name || payload.sourceName);
  if (!name) {
    throw new RecruitmentRuntimeError("Vui lòng nhập tên nguồn hồ sơ.");
  }
  const rawMapping = safeRecord(payload.mapping);
  const mapping = {
    ...rawMapping,
    fullName: text(rawMapping.fullName || rawMapping.name),
    name: text(rawMapping.name || rawMapping.fullName),
  };
  const data = {
    mapping: json(mapping),
    name,
    status: text(payload.status) || "ACTIVE",
  };
  const db = getDb();
  const record = text(payload.id)
    ? await db.recruitmentSourceDefinition.update({
        data,
        where: { id: text(payload.id) },
      })
    : await db.recruitmentSourceDefinition.upsert({
        create: data,
        update: data,
        where: { name },
      });
  return { id: record.id, message: `Đã lưu định nghĩa nguồn ${name}.` };
}

async function saveRequisition(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const requisitionCode = text(payload.requisitionCode).toUpperCase();
  const position = text(payload.position);
  if (!requisitionCode || !position) {
    throw new RecruitmentRuntimeError("Vui lòng nhập mã yêu cầu và vị trí.");
  }
  const data = {
    cancellationStage: text(payload.cancellationStage) || null,
    company: text(payload.company) || null,
    department: text(payload.department) || null,
    intakeStatus: text(payload.intakeStatus) || "Đã tiếp nhận",
    jobCode: text(payload.jobCode) || null,
    level: text(payload.level) || null,
    note: text(payload.note) || null,
    onboardDueAt: dateValue(payload.onboardDueAt),
    position,
    quarter: text(payload.quarter) || null,
    reason: text(payload.reason) || null,
    receivedAt: dateValue(payload.receivedAt) || new Date(),
    recruiter: text(payload.recruiter) || actor.displayName,
    recruitmentStatus: text(payload.recruitmentStatus) || "Đang tuyển",
    requestedQuantity: Math.max(1, numberValue(payload.requestedQuantity, 1)),
    year: numberValue(payload.year, new Date().getFullYear()),
  };
  await getDb().recruitmentRequisition.upsert({
    create: { ...data, requisitionCode, raw: json({ createdBy: actor.displayName }) },
    update: data,
    where: { requisitionCode },
  });
  return { message: `Đã lưu yêu cầu tuyển dụng ${requisitionCode}.` };
}

async function syncRecruitmentFormResults(
  session: AppSession,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  return runRecruitmentFormSync({ triggeredById: actor.userId });
}

async function syncRecruitmentTrackingInput(
  session: AppSession,
  payload: JsonRecord,
) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  return runRecruitmentTrackingSync({
    force: Boolean(payload.force),
    triggeredById: actor.userId,
  });
}

async function nextConfigSourceRow(sourceSheet: string) {
  const last = await getDb().recruitmentConfigRecord.findFirst({
    orderBy: { sourceRow: "desc" },
    select: { sourceRow: true },
    where: { sourceSheet },
  });
  return (last?.sourceRow || 0) + 1;
}

function temporaryJdForClient(record: {
  content: unknown;
  createdAt: Date;
  id: string;
  name: string | null;
  status: string | null;
  updatedAt: Date;
}) {
  const content = safeRecord(record.content);
  const groups = Array.isArray(content.groups)
    ? content.groups.map((groupValue, groupIndex) => {
        const group = safeRecord(groupValue);
        return {
          code: text(group.code) || `group-${groupIndex + 1}`,
          items: Array.isArray(group.items)
            ? group.items.map((itemValue, itemIndex) => {
                const item = safeRecord(itemValue);
                return {
                  code: text(item.code) || `item-${groupIndex + 1}-${itemIndex + 1}`,
                  description: text(item.description),
                  name: text(item.name || item.title),
                  weight: Math.max(0, numberValue(item.weight, 1)),
                };
              }).filter((item) => item.name)
            : [],
          name: text(group.name) || `Nhóm công việc ${groupIndex + 1}`,
        };
      }).filter((group) => group.name)
    : [];
  return {
    createdAt: record.createdAt.toISOString(),
    createdBy: text(content.createdBy),
    groups,
    id: record.id,
    name: record.name || text(content.title) || "JD tạm",
    note: text(content.note),
    position: text(content.position),
    status: record.status || "active",
    updatedAt: record.updatedAt.toISOString(),
    version: Math.max(1, numberValue(content.version, 1)),
  };
}

async function getTemporaryJdCenter(session: AppSession) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "view");
  const db = getDb();
  const [records, assignments, applications] = await Promise.all([
    db.recruitmentConfigRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: { recordType: "recruitment-temp-jd" },
    }),
    db.recruitmentConfigRecord.findMany({
      orderBy: { updatedAt: "desc" },
      where: {
        recordType: "recruitment-temp-jd-assignment",
        status: { in: ["ACTIVE", "active"] },
      },
    }),
    db.recruitmentApplication.findMany({
      orderBy: { updatedAt: "desc" },
      select: {
        candidate: { select: { fullName: true } },
        candidateCode: true,
        id: true,
        position: true,
      },
      take: 500,
      where: { status: { notIn: ["ARCHIVED_DUPLICATE"] } },
    }),
  ]);
  return {
    assignments: assignments.map((record) => {
      const content = safeRecord(record.content);
      return {
        applicationId: text(content.applicationId || record.code),
        assignedAt: record.updatedAt.toISOString(),
        assignedBy: text(content.assignedBy),
        id: record.id,
        jdId: text(content.jdId),
      };
    }),
    candidates: applications.map((application) => ({
      applicationId: application.id,
      candidateCode: application.candidateCode || "",
      name: application.candidate.fullName,
      position: application.position || "",
    })),
    jds: records.map(temporaryJdForClient),
    ok: true,
  };
}

async function saveTemporaryJd(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const title = text(payload.name || payload.title);
  const position = text(payload.position);
  const groups = Array.isArray(payload.groups)
    ? payload.groups.map((groupValue, groupIndex) => {
        const group = safeRecord(groupValue);
        const items = Array.isArray(group.items)
          ? group.items.map((itemValue, itemIndex) => {
              const item = safeRecord(itemValue);
              return {
                code: text(item.code) || `ITEM_${groupIndex + 1}_${itemIndex + 1}`,
                description: text(item.description),
                name: text(item.name || item.title),
                weight: Math.max(0, numberValue(item.weight, 1)),
              };
            }).filter((item) => item.name)
          : [];
        return {
          code: text(group.code) || `GROUP_${groupIndex + 1}`,
          items,
          name: text(group.name),
        };
      }).filter((group) => group.name && group.items.length)
    : [];
  if (!title || !position || !groups.length) {
    throw new RecruitmentRuntimeError(
      "Vui lòng nhập tên JD, vị trí và ít nhất một nhóm có đầu công việc.",
    );
  }
  const db = getDb();
  const id = text(payload.id);
  const existing = id
    ? await db.recruitmentConfigRecord.findFirst({
        where: { id, recordType: "recruitment-temp-jd" },
      })
    : null;
  const previous = safeRecord(existing?.content);
  const data = {
    code: text(payload.code) || existing?.code || `TEMP_JD_${Date.now()}`,
    content: json({
      createdBy: text(previous.createdBy) || actor.displayName,
      groups,
      note: text(payload.note),
      position,
      title,
      updatedBy: actor.displayName,
      version: numberValue(previous.version, 0) + 1,
    }),
    name: title,
    status: text(payload.status) || "active",
  };
  const record = existing
    ? await db.recruitmentConfigRecord.update({ data, where: { id: existing.id } })
    : await db.recruitmentConfigRecord.create({
        data: {
          ...data,
          recordType: "recruitment-temp-jd",
          sourceRow: await nextConfigSourceRow(TEMP_JD_SOURCE),
          sourceSheet: TEMP_JD_SOURCE,
        },
      });
  return {
    jd: temporaryJdForClient(record),
    message: existing ? "Đã lưu phiên bản mới của JD tạm." : "Đã tạo JD tạm và lưu vào lịch sử.",
    ok: true,
  };
}

async function assignTemporaryJd(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor);
  const applicationId = text(payload.applicationId);
  const jdId = text(payload.jdId);
  const db = getDb();
  const [application, jd] = await Promise.all([
    db.recruitmentApplication.findUnique({ where: { id: applicationId } }),
    db.recruitmentConfigRecord.findFirst({
      where: { id: jdId, recordType: "recruitment-temp-jd", status: { not: "archived" } },
    }),
  ]);
  if (!application || !jd) {
    throw new RecruitmentRuntimeError("Không tìm thấy ứng viên hoặc JD tạm cần gán.", 404);
  }
  const current = await db.recruitmentConfigRecord.findFirst({
    where: { code: applicationId, recordType: "recruitment-temp-jd-assignment" },
  });
  const data = {
    code: applicationId,
    content: json({ applicationId, assignedBy: actor.displayName, jdId }),
    name: `Gán JD tạm · ${application.candidateCode || application.applicationCode}`,
    status: "active",
  };
  const assignment = current
    ? await db.recruitmentConfigRecord.update({ data, where: { id: current.id } })
    : await db.recruitmentConfigRecord.create({
        data: {
          ...data,
          recordType: "recruitment-temp-jd-assignment",
          sourceRow: await nextConfigSourceRow(TEMP_JD_SOURCE),
          sourceSheet: TEMP_JD_SOURCE,
        },
      });
  await appendTimeline(applicationId, actor, {
    detail: `${jd.name || "JD tạm"} · dùng cho các phiếu chấm mới`,
    eventType: "temporary_jd_assigned",
    title: "Đã gán JD tạm",
  });
  return { assignmentId: assignment.id, message: "Đã gán JD tạm cho ứng viên.", ok: true };
}

function reportPeriod(payload: JsonRecord) {
  const now = new Date();
  const year = Math.max(2000, numberValue(payload.year, now.getFullYear()));
  const type = text(payload.periodType) || "month";
  let from: Date;
  let to: Date;
  if (type === "custom" && dateValue(payload.dateFrom) && dateValue(payload.dateTo)) {
    from = dateValue(payload.dateFrom)!;
    to = dateValue(payload.dateTo)!;
    to.setDate(to.getDate() + 1);
    to.setHours(0, 0, 0, 0);
  } else if (type === "year") {
    from = new Date(year, 0, 1);
    to = new Date(year + 1, 0, 1);
  } else if (type === "quarter") {
    const quarter = Math.min(4, Math.max(1, numberValue(payload.quarter, Math.floor(now.getMonth() / 3) + 1)));
    from = new Date(year, (quarter - 1) * 3, 1);
    to = new Date(year, quarter * 3, 1);
  } else {
    const month = Math.min(12, Math.max(1, numberValue(payload.month, now.getMonth() + 1)));
    from = new Date(year, month - 1, 1);
    to = new Date(year, month, 1);
  }
  return { from, to, type, year };
}

function reportScope(payload: JsonRecord) {
  const type = text(payload.periodType) || "all";
  if (type === "all" || type === "active") {
    return {
      dateBasis: "received",
      from: null as Date | null,
      label: type === "active" ? "Toàn bộ hồ sơ đang mở" : "Toàn bộ dữ liệu",
      to: null as Date | null,
      type,
      year: null as number | null,
    };
  }
  if (type === "custom") {
    const from = dateValue(payload.dateFrom);
    const to = dateValue(payload.dateTo);
    if (!from || !to) {
      throw new RecruitmentRuntimeError("Vui lòng chọn đủ Từ ngày và Đến ngày.");
    }
    if (from.getTime() > to.getTime()) {
      throw new RecruitmentRuntimeError("Từ ngày không được sau Đến ngày.");
    }
  }
  const period = reportPeriod(payload);
  const dateBasis = ["received", "contact", "interview", "offer", "hired"].includes(text(payload.dateBasis))
    ? text(payload.dateBasis)
    : "received";
  const basisLabels: Record<string, string> = {
    contact: "ngày liên hệ đầu tiên",
    hired: "ngày nhận việc",
    interview: "ngày phỏng vấn đầu tiên",
    offer: "ngày tạo Offer",
    received: "ngày nhận CV",
  };
  return {
    ...period,
    dateBasis,
    label: `Theo ${basisLabels[dateBasis] || basisLabels.received}`,
  };
}

async function getRecruitmentExecutiveReportLegacy(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "view");
  const db = getDb();
  const period = reportPeriod(payload);
  const applications = await db.recruitmentApplication.findMany({
    include: {
      candidate: true,
      interviews: { include: { assignments: true } },
      journey: true,
      scorecards: true,
      timeline: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { receivedAt: "asc" },
    where: {
      receivedAt: { gte: period.from, lt: period.to },
      status: { not: "ARCHIVED_DUPLICATE" },
    },
  });
  const filtered = applications.filter((application) => {
    if (text(payload.company) && text(application.company) !== text(payload.company)) return false;
    if (text(payload.department) && text(application.department) !== text(payload.department)) return false;
    if (text(payload.position) && text(application.position) !== text(payload.position)) return false;
    if (text(payload.source) && text(application.source) !== text(payload.source)) return false;
    if (text(payload.recruiter) && text(application.recruiter) !== text(payload.recruiter)) return false;
    return true;
  });
  const stageRank: Record<string, number> = {
    closed: 0,
    cv_screening: 1,
    preliminary: 2,
    test: 3,
    round1: 4,
    round2: 5,
    offer: 6,
    onboarding: 7,
  };
  const stageOf = (application: (typeof filtered)[number]) =>
    application.journey?.stageKey || inferredStage(application.status);
  const isHired = (application: (typeof filtered)[number]) =>
    stageOf(application) === "onboarding" || application.journey?.outcomeKey === "hired";
  const isRejected = (application: (typeof filtered)[number]) =>
    stageOf(application) === "closed" && ["rejected", "no_contact"].includes(application.journey?.outcomeKey || "");
  const avgDays = (values: number[]) =>
    values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10 : 0;
  const firstContactDays = filtered.flatMap((application) => {
    const received = application.receivedAt || application.createdAt;
    const contact = application.timeline.find((item) =>
      ["contact", "journey_update", "schedule"].includes(item.eventType),
    );
    return contact ? [(contact.createdAt.getTime() - received.getTime()) / 86_400_000] : [];
  });
  const firstInterviewDays = filtered.flatMap((application) => {
    const received = application.receivedAt || application.createdAt;
    const interview = application.interviews
      .filter((item) => item.startAt)
      .sort((left, right) => left.startAt!.getTime() - right.startAt!.getTime())[0];
    return interview?.startAt ? [(interview.startAt.getTime() - received.getTime()) / 86_400_000] : [];
  });
  const sourceMap = new Map<string, { applications: number; hired: number; interviews: number }>();
  const positionMap = new Map<string, { applications: number; hired: number; active: number }>();
  const reviewerMap = new Map<string, { assigned: number; completed: number }>();
  const trendMap = new Map<string, number>();
  const now = Date.now();
  const aging = { over30: 0, under7: 0, under14: 0, under30: 0 };
  for (const application of filtered) {
    const source = application.source || "Chưa xác định";
    const sourceRow = sourceMap.get(source) || { applications: 0, hired: 0, interviews: 0 };
    sourceRow.applications += 1;
    sourceRow.interviews += application.interviews.length ? 1 : 0;
    sourceRow.hired += isHired(application) ? 1 : 0;
    sourceMap.set(source, sourceRow);
    const position = application.position || "Chưa gắn vị trí";
    const positionRow = positionMap.get(position) || { applications: 0, hired: 0, active: 0 };
    positionRow.applications += 1;
    positionRow.hired += isHired(application) ? 1 : 0;
    positionRow.active += ["closed", "onboarding"].includes(stageOf(application)) ? 0 : 1;
    positionMap.set(position, positionRow);
    const received = application.receivedAt || application.createdAt;
    const trendKey = received.toISOString().slice(0, 10);
    trendMap.set(trendKey, (trendMap.get(trendKey) || 0) + 1);
    if (!["closed", "onboarding"].includes(stageOf(application))) {
      const days = Math.max(0, Math.floor((now - received.getTime()) / 86_400_000));
      if (days <= 7) aging.under7 += 1;
      else if (days <= 14) aging.under14 += 1;
      else if (days <= 30) aging.under30 += 1;
      else aging.over30 += 1;
    }
    for (const interview of application.interviews) {
      for (const assignment of interview.assignments.filter((item) => item.status !== "cancelled")) {
        const row = reviewerMap.get(assignment.reviewerName) || { assigned: 0, completed: 0 };
        row.assigned += 1;
        row.completed += application.scorecards.some((card) => card.assignmentId === assignment.id && card.status === "submitted") ? 1 : 0;
        reviewerMap.set(assignment.reviewerName, row);
      }
    }
  }
  const stageAtLeast = (rank: number) => filtered.filter((item) => (stageRank[stageOf(item)] || 0) >= rank || isHired(item)).length;
  const total = filtered.length;
  return {
    aging,
    filters: {
      companies: unique(applications.map((item) => item.company)),
      departments: unique(applications.map((item) => item.department)),
      positions: unique(applications.map((item) => item.position)),
      recruiters: unique(applications.map((item) => item.recruiter)),
      sources: unique(applications.map((item) => item.source)),
    },
    funnel: [
      { key: "received", label: "Hồ sơ nhận", value: total },
      { key: "preliminary", label: "Qua sơ tuyển", value: stageAtLeast(2) },
      { key: "round1", label: "Vòng 1", value: filtered.filter((item) => item.interviews.some((row) => roundKey(row.roundKey) === "round1")).length },
      { key: "round2", label: "Vòng 2", value: filtered.filter((item) => item.interviews.some((row) => roundKey(row.roundKey) === "round2")).length },
      { key: "offer", label: "Offer", value: stageAtLeast(6) },
      { key: "hired", label: "Nhận việc", value: filtered.filter(isHired).length },
    ],
    generatedAt: new Date().toISOString(),
    kpis: {
      active: filtered.filter((item) => !["closed", "onboarding"].includes(stageOf(item))).length,
      averageDaysToContact: avgDays(firstContactDays),
      averageDaysToInterview: avgDays(firstInterviewDays),
      hired: filtered.filter(isHired).length,
      interviewRate: total ? Math.round(filtered.filter((item) => item.interviews.length).length / total * 1000) / 10 : 0,
      offer: stageAtLeast(6),
      rejected: filtered.filter(isRejected).length,
      total,
    },
    ok: true,
    period: {
      from: period.from.toISOString(),
      to: new Date(period.to.getTime() - 1).toISOString(),
      type: period.type,
      year: period.year,
    },
    positions: Array.from(positionMap, ([name, value]) => ({ name, ...value })).sort((a, b) => b.applications - a.applications),
    reviewers: Array.from(reviewerMap, ([name, value]) => ({ name, ...value, completionRate: value.assigned ? Math.round(value.completed / value.assigned * 100) : 0 })).sort((a, b) => b.assigned - a.assigned),
    sources: Array.from(sourceMap, ([name, value]) => ({ name, ...value, hireRate: value.applications ? Math.round(value.hired / value.applications * 1000) / 10 : 0 })).sort((a, b) => b.applications - a.applications),
    trend: Array.from(trendMap, ([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
  };
}

function reportAge(birthDate: string | null | undefined) {
  const raw = text(birthDate);
  if (!raw) return null;
  const local = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  const parsed = local
    ? new Date(Number(local[3]), Number(local[2]) - 1, Number(local[1]))
    : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - parsed.getFullYear();
  const month = now.getMonth() - parsed.getMonth();
  if (month < 0 || (month === 0 && now.getDate() < parsed.getDate())) age -= 1;
  return age >= 15 && age <= 90 ? age : null;
}

function rate(value: number, base: number) {
  return base ? Math.round((value / base) * 1000) / 10 : 0;
}

function average(values: number[]) {
  return values.length
    ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10
    : 0;
}

function reportAgeBand(age: number | null) {
  if (age == null) return "Chưa rõ";
  if (age < 20) return "Dưới 20";
  if (age <= 24) return "20–24";
  if (age <= 29) return "25–29";
  if (age <= 34) return "30–34";
  if (age <= 39) return "35–39";
  return "Từ 40";
}

async function getRecruitmentExecutiveReport(session: AppSession, payload: JsonRecord) {
  const actor = await resolveOperationActor(session);
  assertAdmin(actor, "view");
  const db = getDb();
  const period = reportScope(payload);
  const applicationWhere = {
    ...(period.from && period.to && period.dateBasis === "received"
      ? { receivedAt: { gte: period.from, lt: period.to } }
      : {}),
    status: { notIn: ["ARCHIVED_DUPLICATE", "IMPORTED"] },
  };
  const campaignWhere = period.from && period.to
    ? {
        AND: [
          { OR: [{ startDate: null }, { startDate: { lt: period.to } }] },
          { OR: [{ endDate: null }, { endDate: { gte: period.from } }] },
        ],
      }
    : {};
  const [applications, requisitions, campaigns] = await Promise.all([
    db.recruitmentApplication.findMany({
      include: {
        campaign: true,
        candidate: true,
        interviews: { include: { assignments: true } },
        journey: true,
        offers: true,
        scorecards: true,
        timeline: { orderBy: { createdAt: "asc" } },
      },
      orderBy: { receivedAt: "asc" },
      where: applicationWhere,
    }),
    db.recruitmentRequisition.findMany(),
    db.recruitmentCampaign.findMany({ where: campaignWhere }),
  ]);
  const requisitionByCode = new Map(
    requisitions.map((item) => [text(item.requisitionCode).toUpperCase(), item]),
  );
  const campaignByKey = new Map(
    campaigns.map((item) => [`${text(item.code).toUpperCase()}::${normalize(item.source)}`, item]),
  );
  const stageRank: Record<string, number> = {
    closed: 0,
    cv_screening: 1,
    preliminary: 2,
    test: 3,
    round1: 4,
    round2: 5,
    offer: 6,
    onboarding: 7,
  };
  const rejectionReason = (statusValue: string, evidenceValue: string) => {
    const value = normalize(`${statusValue} ${evidenceValue}`);
    if (/khong lien he|fail call|thue bao|khong nghe may/.test(value)) return "Không liên hệ được";
    if (/tu choi.*offer|khong nhan viec|khong dong y luong/.test(value)) return "Từ chối Offer/nhận việc";
    if (/tu choi.*pv|khong den|vang phong van/.test(value)) return "Từ chối/không đến phỏng vấn";
    if (/fail v2|loai.*v2|rot.*v2/.test(value)) return "Không đạt Vòng 2";
    if (/fail v1|loai.*v1|rot.*v1/.test(value)) return "Không đạt Vòng 1";
    if (/fail.*so van|loai.*so van/.test(value)) return "Không đạt Sơ vấn";
    if (/loai cv|khong phu hop|sai vi tri|thieu kinh nghiem/.test(value)) return "Không qua lọc CV";
    if (/loai|fail|tu choi|khong phu hop/.test(value)) return "Lý do khác";
    return "Chưa có kết luận loại";
  };
  const facts = applications.map((application) => {
    const status = normalize(application.status);
    const currentStage = application.journey?.stageKey || inferredStage(application.status);
    const currentRank = stageRank[currentStage] || 0;
    const timelineText = application.timeline
      .map((item) => `${item.title || ""} ${item.detail || ""} ${item.fromValue || ""} ${item.toValue || ""}`)
      .join(" ");
    const evidence = normalize(`${application.status || ""} ${timelineText}`);
    const interviewRounds = new Set(
      application.interviews.map((item) => roundKey(item.roundKey)),
    );
    const scoreRounds = new Set(
      application.scorecards.map((item) => roundKey(item.roundKey)),
    );
    const laterThanScreen = currentRank >= 2 && currentStage !== "closed";
    const cvPassed =
      laterThanScreen ||
      /duyet cv|lien he uv|fail call|so van|phong van|pv v1|pv v2|vong 1|vong 2|offer|nhan viec|turnover|nghi viec/.test(evidence);
    const preliminary =
      interviewRounds.has("preliminary") ||
      scoreRounds.has("preliminary") ||
      (currentRank >= 2 && currentStage !== "closed") ||
      /so van|pv v1|pv v2|vong 1|vong 2|offer|nhan viec|turnover|nghi viec/.test(evidence);
    const round1Reached =
      interviewRounds.has("round1") ||
      scoreRounds.has("round1") ||
      (currentRank >= 4 && currentStage !== "closed") ||
      /pv v1|vong 1|fail v1|tu choi pv v1|pv v2|vong 2|offer|nhan viec|turnover|nghi viec/.test(evidence);
    const round2Reached =
      interviewRounds.has("round2") ||
      scoreRounds.has("round2") ||
      (currentRank >= 5 && currentStage !== "closed") ||
      /pv v2|vong 2|fail v2|tu choi pv v2|offer|nhan viec|turnover|nghi viec/.test(evidence);
    const offered =
      (currentRank >= 6 && currentStage !== "closed") ||
      /offer|nhan viec|turnover|nghi viec/.test(evidence);
    const hired =
      application.journey?.outcomeKey === "hired" ||
      /nhan viec|turnover|nghi viec/.test(status);
    const rejected =
      /loai|fail|tu choi|khong phu hop/.test(status) ||
      ["rejected", "no_contact"].includes(application.journey?.outcomeKey || "");
    const received = application.receivedAt || application.createdAt;
    const firstContact = application.timeline.find((item) =>
      ["contact", "journey", "journey_update", "schedule"].includes(item.eventType),
    );
    const firstInterview = application.interviews
      .filter((item) => item.startAt)
      .sort((left, right) => left.startAt!.getTime() - right.startAt!.getTime())[0];
    const timelineDate = (pattern: RegExp) => application.timeline.find((item) =>
      pattern.test(normalize(`${item.eventType} ${item.title} ${item.detail} ${item.toValue}`)),
    )?.createdAt || null;
    const firstOffer = application.offers
      .slice()
      .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime())[0];
    const offerDate = firstOffer?.createdAt || timelineDate(/offer/);
    const hireDate = application.offers
      .flatMap((item) => item.onboardAt ? [item.onboardAt] : [])
      .sort((left, right) => left.getTime() - right.getTime())[0] ||
      timelineDate(/nhan viec|onboard/) ||
      (hired ? application.updatedAt : null);
    const requisitionCode = text(application.requisitionCode || application.campaign?.code);
    const campaign =
      application.campaign ||
      campaignByKey.get(`${requisitionCode.toUpperCase()}::${normalize(application.source)}`) ||
      null;
    const age = reportAge(application.candidate.birthDate);
    const submittedCards = application.scorecards.filter(
      (card) => card.status === "submitted" && card.finalScore != null,
    );
    const cardScores = submittedCards.map((card) => Number(card.finalScore));
    const cultureScores = submittedCards
      .filter((card) => /van hoa|culture/.test(normalize(`${card.roleKey} ${card.roleLabel}`)))
      .map((card) => Number(card.finalScore));
    const technicalScores = submittedCards
      .filter((card) => !/van hoa|culture/.test(normalize(`${card.roleKey} ${card.roleLabel}`)))
      .map((card) => Number(card.finalScore));
    const basisDates: Record<string, Date | null | undefined> = {
      contact: firstContact?.createdAt,
      hired: hireDate,
      interview: firstInterview?.startAt,
      offer: offerDate,
      received,
    };
    return {
      active: !["closed", "onboarding"].includes(currentStage),
      age,
      ageBand: reportAgeBand(age),
      application,
      averageCultureScore: cultureScores.length ? average(cultureScores) : null,
      averageScore: cardScores.length ? average(cardScores) : null,
      averageTechnicalScore: technicalScores.length ? average(technicalScores) : null,
      basisDate: basisDates[period.dateBasis] || received,
      campaignName: campaign?.campaignName || "Chưa đặt campaign",
      contactDays: firstContact
        ? Math.max(0, (firstContact.createdAt.getTime() - received.getTime()) / 86_400_000)
        : null,
      cvPassed,
      hired,
      interviewDays: firstInterview?.startAt
        ? Math.max(0, (firstInterview.startAt.getTime() - received.getTime()) / 86_400_000)
        : null,
      offerDays: offerDate
        ? Math.max(0, (offerDate.getTime() - received.getTime()) / 86_400_000)
        : null,
      hireDays: hireDate
        ? Math.max(0, (hireDate.getTime() - received.getTime()) / 86_400_000)
        : null,
      offered,
      preliminary,
      received,
      rejected,
      rejectionReason: rejected ? rejectionReason(application.status || "", timelineText) : "Chưa có kết luận loại",
      requisitionCode: requisitionCode || "Chưa gắn nhu cầu",
      round1: round1Reached,
      round2: round2Reached,
      scorecardCount: submittedCards.length,
      source: application.source || "Chưa xác định",
    };
  });
  const ageFrom = numberValue(payload.ageFrom, 0);
  const ageTo = numberValue(payload.ageTo, 0);
  const selectedAgeBand = text(payload.ageBand);
  const filtered = facts.filter((fact) => {
    const application = fact.application;
    if (period.type === "active" && !fact.active) return false;
    if (period.from && period.to) {
      if (!fact.basisDate || fact.basisDate < period.from || fact.basisDate >= period.to) return false;
    }
    if (text(payload.company) && text(application.company) !== text(payload.company)) return false;
    if (text(payload.department) && text(application.department) !== text(payload.department)) return false;
    if (text(payload.position) && text(application.position) !== text(payload.position)) return false;
    if (text(payload.source) && fact.source !== text(payload.source)) return false;
    if (text(payload.campaign) && fact.campaignName !== text(payload.campaign)) return false;
    if (text(payload.recruiter) && text(application.recruiter) !== text(payload.recruiter)) return false;
    if (text(payload.requisitionCode) && fact.requisitionCode !== text(payload.requisitionCode)) return false;
    if (selectedAgeBand && fact.ageBand !== selectedAgeBand) return false;
    if (ageFrom && (fact.age == null || fact.age < ageFrom)) return false;
    if (ageTo && (fact.age == null || fact.age > ageTo)) return false;
    return true;
  });
  type Fact = (typeof filtered)[number];
  const count = (rows: Fact[], key: keyof Fact) => rows.filter((item) => Boolean(item[key])).length;
  const summarize = (rows: Fact[]) => {
    const total = rows.length;
    const cvPassed = count(rows, "cvPassed");
    const preliminary = count(rows, "preliminary");
    const round1Count = count(rows, "round1");
    const round2Count = count(rows, "round2");
    const offered = count(rows, "offered");
    const hired = count(rows, "hired");
    return {
      active: count(rows, "active"),
      applications: total,
      averageCultureScore: average(rows.flatMap((item) => item.averageCultureScore == null ? [] : [item.averageCultureScore])),
      averageDaysToContact: average(rows.flatMap((item) => item.contactDays == null ? [] : [item.contactDays])),
      averageDaysToHire: average(rows.flatMap((item) => item.hireDays == null ? [] : [item.hireDays])),
      averageDaysToInterview: average(rows.flatMap((item) => item.interviewDays == null ? [] : [item.interviewDays])),
      averageDaysToOffer: average(rows.flatMap((item) => item.offerDays == null ? [] : [item.offerDays])),
      averageScore: average(rows.flatMap((item) => item.averageScore == null ? [] : [item.averageScore])),
      averageTechnicalScore: average(rows.flatMap((item) => item.averageTechnicalScore == null ? [] : [item.averageTechnicalScore])),
      cvPassRate: rate(cvPassed, total),
      cvPassed,
      hireRate: rate(hired, total),
      hired,
      interviewRate: rate(round1Count, total),
      offerAcceptanceRate: rate(hired, offered),
      offered,
      preliminary,
      preliminaryPassRate: rate(round1Count, preliminary),
      rejected: count(rows, "rejected"),
      round1: round1Count,
      round1PassRate: rate(round2Count, round1Count),
      round2: round2Count,
      round2PassRate: rate(offered, round2Count),
      scorecardCount: rows.reduce((sum, item) => sum + item.scorecardCount, 0),
    };
  };
  const group = (keyOf: (fact: Fact) => string) => {
    const map = new Map<string, Fact[]>();
    for (const fact of filtered) {
      const key = keyOf(fact) || "Chưa xác định";
      const rows = map.get(key) || [];
      rows.push(fact);
      map.set(key, rows);
    }
    return map;
  };
  const dimension = (map: Map<string, Fact[]>) =>
    Array.from(map, ([name, rows]) => ({ name, ...summarize(rows) }))
      .sort((left, right) => right.applications - left.applications);
  const totalSummary = summarize(filtered);
  // Dữ liệu lịch sử V2 có thể thiếu bản ghi ở một bước trung gian (ví dụ đã có
  // phiếu Vòng 1 nhưng chưa lưu mốc Sơ vấn). Chỉ chuẩn hóa phần phễu thành số
  // người "đã đi tới ít nhất bước này" để tỷ lệ chuyển đổi luôn có nghĩa;
  // các KPI và bảng phân tích chi tiết bên dưới vẫn giữ số quan sát thực tế.
  const funnelStageCounts = {
    hired: totalSummary.hired,
    offered: Math.max(totalSummary.offered, totalSummary.hired),
    round2: Math.max(totalSummary.round2, totalSummary.offered, totalSummary.hired),
    round1: Math.max(totalSummary.round1, totalSummary.round2, totalSummary.offered, totalSummary.hired),
    preliminary: Math.max(
      totalSummary.preliminary,
      totalSummary.round1,
      totalSummary.round2,
      totalSummary.offered,
      totalSummary.hired,
    ),
    cvPassed: Math.max(
      totalSummary.cvPassed,
      totalSummary.preliminary,
      totalSummary.round1,
      totalSummary.round2,
      totalSummary.offered,
      totalSummary.hired,
    ),
  };
  const funnelCounts = [
    ["received", "Hồ sơ nhận", filtered.length],
    ["cv_pass", "Qua lọc CV", funnelStageCounts.cvPassed],
    ["preliminary", "Đã sơ vấn", funnelStageCounts.preliminary],
    ["round1", "Đến Vòng 1", funnelStageCounts.round1],
    ["round2", "Đến Vòng 2", funnelStageCounts.round2],
    ["offer", "Được Offer", funnelStageCounts.offered],
    ["hired", "Nhận việc", funnelStageCounts.hired],
  ] as const;
  const funnel = funnelCounts.map((item, index) => ({
    conversionFromPrevious: index ? rate(item[2], funnelCounts[index - 1][2]) : 100,
    dropOff: index ? Math.max(0, funnelCounts[index - 1][2] - item[2]) : 0,
    key: item[0],
    label: item[1],
    overallConversion: rate(item[2], filtered.length),
    value: item[2],
  }));
  const sourcePerformance = dimension(group((fact) => fact.source)).map((item) => {
    const speedScore = item.averageDaysToInterview
      ? Math.max(0, 100 - Math.min(30, item.averageDaysToInterview) / 30 * 100)
      : 0;
    return {
      ...item,
      effectivenessScore: Math.round(
        item.cvPassRate * 0.3 +
        item.round1PassRate * 0.25 +
        item.hireRate * 0.25 +
        speedScore * 0.2,
      ),
    };
  });
  const requisitionGroups = group((fact) => fact.requisitionCode);
  const requisitionPerformance = Array.from(requisitionGroups, ([name, rows]) => {
    const requisition = requisitionByCode.get(name.toUpperCase());
    const metrics = summarize(rows);
    const requested = requisition?.requestedQuantity || 0;
    return {
      ...metrics,
      department: requisition?.department || rows[0]?.application.department || "",
      fillRate: requested ? rate(metrics.hired, requested) : 0,
      name,
      position: requisition?.position || rows[0]?.application.position || "Chưa gắn vị trí",
      remaining: requested ? Math.max(0, requested - metrics.hired) : null,
      requested,
      sources: unique(rows.map((item) => item.source)),
      cvPerHire: metrics.hired ? Math.round(metrics.applications / metrics.hired * 10) / 10 : null,
      projectedCvNeeded: requested && metrics.hired
        ? Math.ceil(Math.max(0, requested - metrics.hired) * metrics.applications / metrics.hired)
        : null,
      daysOpen: requisition?.receivedAt
        ? Math.max(0, Math.floor((Date.now() - requisition.receivedAt.getTime()) / 86_400_000))
        : null,
      risk: requested && metrics.hired < requested
        ? metrics.hired === 0 && metrics.applications >= 10
          ? "Rủi ro cao"
          : metrics.averageDaysToInterview > 7
            ? "Xử lý chậm"
            : "Cần theo dõi"
        : "Đúng tiến độ",
    };
  }).sort((left, right) => right.applications - left.applications);
  const sourceDemand = dimension(
    group((fact) => `${fact.requisitionCode}|||${fact.source}`),
  ).map((row) => {
    const [requisitionCode, source] = row.name.split("|||");
    return { ...row, name: source, requisitionCode, source };
  });
  const campaignPerformance = dimension(
    group((fact) => `${fact.source}|||${fact.campaignName}`),
  ).map((row) => {
    const [source, campaignName] = row.name.split("|||");
    return { ...row, campaignName, name: campaignName, source };
  });
  const reviewerMap = new Map<string, { assigned: number; completed: number; pass: number; scores: number[] }>();
  for (const fact of filtered) {
    for (const interview of fact.application.interviews) {
      for (const assignment of interview.assignments.filter((item) => item.status !== "cancelled")) {
        const row = reviewerMap.get(assignment.reviewerName) || { assigned: 0, completed: 0, pass: 0, scores: [] };
        const submitted = fact.application.scorecards.filter(
          (card) => card.assignmentId === assignment.id && card.status === "submitted",
        );
        row.assigned += 1;
        row.completed += submitted.length ? 1 : 0;
        row.pass += submitted.some((card) => /pass|đạt|dat/.test(normalize(card.decision))) ? 1 : 0;
        row.scores.push(...submitted.flatMap((card) => card.finalScore == null ? [] : [Number(card.finalScore)]));
        reviewerMap.set(assignment.reviewerName, row);
      }
    }
  }
  const roundQualityMap = new Map<string, { cards: number; culture: number[]; scores: number[]; technical: number[] }>();
  for (const fact of filtered) {
    for (const card of fact.application.scorecards.filter((item) => item.status === "submitted" && item.finalScore != null)) {
      const key = roundKey(card.roundKey);
      const row = roundQualityMap.get(key) || { cards: 0, culture: [], scores: [], technical: [] };
      const score = Number(card.finalScore);
      const isCulture = /van hoa|culture/.test(normalize(`${card.roleKey} ${card.roleLabel}`));
      row.cards += 1;
      row.scores.push(score);
      (isCulture ? row.culture : row.technical).push(score);
      roundQualityMap.set(key, row);
    }
  }
  const aging = { over30: 0, under7: 0, under14: 0, under30: 0 };
  const now = Date.now();
  for (const fact of filtered.filter((item) => item.active)) {
    const days = Math.max(0, Math.floor((now - fact.received.getTime()) / 86_400_000));
    if (days <= 7) aging.under7 += 1;
    else if (days <= 14) aging.under14 += 1;
    else if (days <= 30) aging.under30 += 1;
    else aging.over30 += 1;
  }
  const trendMap = new Map<string, Fact[]>();
  for (const fact of filtered) {
    const date = fact.basisDate || fact.received;
    const key = ["month", "custom"].includes(period.type)
      ? date.toISOString().slice(0, 10)
      : date.toISOString().slice(0, 7);
    const rows = trendMap.get(key) || [];
    rows.push(fact);
    trendMap.set(key, rows);
  }
  const statusMap = new Map<string, number>();
  for (const fact of filtered) {
    const key = fact.application.status || "Chưa xác định";
    statusMap.set(key, (statusMap.get(key) || 0) + 1);
  }
  const allowedDimensions = new Set(["source", "campaign", "requisition", "position", "department", "company", "recruiter", "ageBand"]);
  const primaryDimension = allowedDimensions.has(text(payload.primaryDimension)) ? text(payload.primaryDimension) : "source";
  const secondaryDimension = text(payload.secondaryDimension) === "none"
    ? "none"
    : allowedDimensions.has(text(payload.secondaryDimension))
      ? text(payload.secondaryDimension)
      : "none";
  const dimensionValue = (fact: Fact, key: string) => {
    if (key === "source") return fact.source;
    if (key === "campaign") return fact.campaignName;
    if (key === "requisition") return fact.requisitionCode;
    if (key === "position") return fact.application.position || "Chưa gắn vị trí";
    if (key === "department") return fact.application.department || "Chưa gắn phòng ban";
    if (key === "company") return fact.application.company || "Chưa gắn công ty";
    if (key === "recruiter") return fact.application.recruiter || "Chưa gắn HR";
    if (key === "none") return "Tổng";
    return fact.ageBand;
  };
  const analysisMatrix = dimension(
    group((fact) => `${dimensionValue(fact, primaryDimension)}|||${dimensionValue(fact, secondaryDimension)}`),
  ).map((row) => {
    const [primary, secondary] = row.name.split("|||");
    return { ...row, name: primary, primary, secondary };
  });
  const rejectionReasons = dimension(group((fact) => fact.rejectionReason))
    .filter((item) => item.name !== "Chưa có kết luận loại");
  return {
    aging,
    ageBands: dimension(group((fact) => fact.ageBand)),
    analysis: { primaryDimension, secondaryDimension, rows: analysisMatrix },
    campaigns: campaignPerformance,
    departments: dimension(group((fact) => fact.application.department || "Chưa gắn phòng ban")),
    filters: {
      ageBands: ["Dưới 20", "20–24", "25–29", "30–34", "35–39", "Từ 40", "Chưa rõ"],
      companies: unique(applications.map((item) => item.company)),
      campaigns: unique(facts.map((item) => item.campaignName)),
      departments: unique(applications.map((item) => item.department)),
      positions: unique(applications.map((item) => item.position)),
      recruiters: unique(applications.map((item) => item.recruiter)),
      requisitions: unique(facts.map((item) => item.requisitionCode)),
      sources: unique(applications.map((item) => item.source)),
    },
    funnel,
    generatedAt: new Date().toISOString(),
    kpis: {
      ...totalSummary,
      total: totalSummary.applications,
    },
    ok: true,
    period: {
      dateBasis: period.dateBasis,
      from: period.from?.toISOString() || null,
      label: period.label,
      to: period.to ? new Date(period.to.getTime() - 1).toISOString() : null,
      type: period.type,
      year: period.year,
    },
    positions: dimension(group((fact) => fact.application.position || "Chưa gắn vị trí")),
    recruiters: dimension(group((fact) => fact.application.recruiter || "Chưa gắn HR")),
    requisitions: requisitionPerformance,
    reviewers: Array.from(reviewerMap, ([name, value]) => ({
      name,
      assigned: value.assigned,
      averageScore: average(value.scores),
      completed: value.completed,
      completionRate: rate(value.completed, value.assigned),
      passRate: rate(value.pass, value.completed),
    })).sort((left, right) => right.assigned - left.assigned),
    qualityByRound: Array.from(roundQualityMap, ([name, value]) => ({
      averageCultureScore: average(value.culture),
      averageScore: average(value.scores),
      averageTechnicalScore: average(value.technical),
      cards: value.cards,
      name,
    })),
    rejectionReasons,
    sourceDemand,
    sources: sourcePerformance,
    statuses: Array.from(statusMap, ([name, value]) => ({ name, value }))
      .sort((left, right) => right.value - left.value),
    trend: Array.from(trendMap, ([date, rows]) => ({
      date,
      applications: rows.length,
      cvPassed: count(rows, "cvPassed"),
      hired: count(rows, "hired"),
      value: rows.length,
    })).sort((left, right) => left.date.localeCompare(right.date)),
  };
}

export async function dispatchRecruitmentManagementRpc(
  session: AppSession,
  method: string,
  payload: JsonRecord,
): Promise<{ handled: boolean; result?: unknown }> {
  const methods: Record<
    string,
    (session: AppSession, payload: JsonRecord) => Promise<unknown>
  > = {
    archiveDuplicateApplications,
    archiveIntake,
    assignTemporaryJd,
    getRecruitmentExecutiveReport,
    getTemporaryJdCenter,
    importPdfIntake,
    getManagementWorkspace: getRecruitmentManagementWorkspace,
    importIntakeFile,
    promoteIntake,
    repairCandidateCodes,
    saveCampaign,
    saveInterview,
    saveJourney,
    saveManualIntake,
    saveRequisition,
    saveSourceDefinition,
    saveTemporaryJd,
    syncRecruitmentFormResults,
    syncRecruitmentTrackingInput,
    transferCandidate,
  };
  const handler = methods[method];
  if (!handler) return { handled: false };
  return { handled: true, result: await handler(session, payload) };
}
