import "server-only";

import { createHash } from "node:crypto";

import { GoogleAuth } from "google-auth-library";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";

import { getDb } from "@/lib/db";
import {
  finishMigrationRecord,
  finishMigrationRun,
  mapExternalId,
  migrationFingerprint,
  recordMigrationIssue,
  stageMigrationRecord,
  startMigrationRun,
} from "@/lib/migration/service";
import {
  normalizeRecruitmentSheetText,
  parseRecruitmentFormScoringConfig,
  RECRUITMENT_FORM_GT_KEYS,
  RECRUITMENT_FORM_TRAITS,
  scoreRecruitmentFormSubmission,
} from "@/lib/recruitment/form-scoring";

export const RECRUITMENT_FORM_SYNC_SERVICE_ACCOUNT =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";

export const RECRUITMENT_FORM_SYNC_SOURCE_KEY =
  "google-sheet-recruitment-form-v3";
export const RECRUITMENT_TRACKING_SYNC_SOURCE_KEY =
  "google-sheet-recruitment-tracking-v3";

const RESULTS_SPREADSHEET_ID =
  process.env.RECRUITMENT_RESULTS_SPREADSHEET_ID ||
  "1Tfu17uZKxWCh0un7wB4QdJTM_VBfTTolBE5GmFLLtFI";
const TRACKING_SPREADSHEET_ID =
  process.env.RECRUITMENT_TRACKING_SPREADSHEET_ID ||
  "1HM3rVU_tajRsqaPnRVrIZJhRx_W7JlKlkCw7MumloKc";
const SCORING_SPREADSHEET_ID =
  process.env.RECRUITMENT_SCORING_SPREADSHEET_ID ||
  "1hx2CsL5ebZZSWkH4n_RVNulGYWtsVG57ZmMX8ELmT_g";
const RESULTS_SHEET = "Kết quả Ứng viên";
const TRACKING_SHEET = "Theo dõi Tuyển dụng";
const SCORING_SHEET = "Cơ sở Test tính cách";
const PRELIMINARY_SHEET = "SoVan_Logs";
const GENERATED_HEXACO_SHEET = "Kết quả Ứng viên / V3 Form Sync";

const sheetsAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

type SheetRow = {
  record: Record<string, unknown>;
  rowNumber: number;
  values: unknown[];
};

type SheetData = {
  headers: string[];
  rows: SheetRow[];
};

type SyncDatabase = PrismaClient | Prisma.TransactionClient;

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function stableId(prefix: string, value: unknown) {
  return `${prefix}_${createHash("sha1").update(String(value)).digest("hex")}`;
}

function sourceConfig() {
  return {
    results: {
      sheetName: RESULTS_SHEET,
      spreadsheetId: RESULTS_SPREADSHEET_ID,
    },
    preliminary: {
      sheetName: PRELIMINARY_SHEET,
      spreadsheetId: RESULTS_SPREADSHEET_ID,
    },
    scoring: {
      sheetName: SCORING_SHEET,
      spreadsheetId: SCORING_SPREADSHEET_ID,
    },
    serviceAccount: RECRUITMENT_FORM_SYNC_SERVICE_ACCOUNT,
    tracking: {
      sheetName: TRACKING_SHEET,
      spreadsheetId: TRACKING_SPREADSHEET_ID,
    },
  };
}

function googleSheetError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Không đọc được Google Sheet.";
  if (/403|permission|forbidden|caller does not have permission/i.test(message)) {
    return new Error(
      `Google Sheet chưa chia sẻ quyền xem cho ${RECRUITMENT_FORM_SYNC_SERVICE_ACCOUNT}.`,
    );
  }
  if (/404|not found/i.test(message)) {
    return new Error("Không tìm thấy Google Sheet tuyển dụng hoặc sheet con.");
  }
  return new Error(message);
}

async function readSheet(input: {
  headerRow?: number;
  range: string;
  sheetName: string;
  spreadsheetId: string;
}): Promise<SheetData> {
  const escapedName = input.sheetName.replace(/'/g, "''");
  try {
    const client = await sheetsAuth.getClient();
    const response = await client.request<{ values?: unknown[][] }>({
      params: {
        dateTimeRenderOption: "SERIAL_NUMBER",
        majorDimension: "ROWS",
        valueRenderOption: "UNFORMATTED_VALUE",
      },
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}` +
        `/values/${encodeURIComponent(`'${escapedName}'!${input.range}`)}`,
    });
    const values = response.data.values || [];
    if (input.headerRow === 0) {
      return {
        headers: [],
        rows: values.map((row, index) => ({
          record: {},
          rowNumber: index + 1,
          values: row,
        })),
      };
    }
    const headerRow = Math.max(1, input.headerRow || 1);
    const headers = (values[headerRow - 1] || []).map((value) =>
      String(value ?? "").trim(),
    );
    if (!headers.some(Boolean)) {
      throw new Error(`Sheet ${input.sheetName} không có hàng tiêu đề.`);
    }
    return {
      headers,
      rows: values
        .slice(headerRow)
        .map((row, index) => ({
          record: Object.fromEntries(
            headers
              .map((header, column) => [header, row[column]] as const)
              .filter(([header]) => Boolean(header)),
          ),
          rowNumber: index + headerRow + 1,
          values: row,
        }))
        .filter((row) => row.values.some((value) => String(value ?? "").trim())),
    };
  } catch (error) {
    throw googleSheetError(error);
  }
}

function normalizedRecord(record: Record<string, unknown>) {
  return new Map(
    Object.entries(record).map(([key, value]) => [
      normalizeRecruitmentSheetText(key),
      value,
    ]),
  );
}

function field(record: Record<string, unknown>, ...aliases: string[]) {
  const normalized = normalizedRecord(record);
  for (const alias of aliases) {
    const value = normalized.get(normalizeRecruitmentSheetText(alias));
    if (value !== undefined && String(value ?? "").trim()) return value;
  }
  return "";
}

function stringField(record: Record<string, unknown>, ...aliases: string[]) {
  return String(field(record, ...aliases) ?? "").replace(/\s+/g, " ").trim();
}

function normalizePhone(value: unknown) {
  return String(value ?? "").replace(/[^\d+]/g, "");
}

export function recruitmentGoogleSheetDate(value: unknown) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.round((value - 25569) * 86_400_000);
    const parsed = new Date(milliseconds - 7 * 60 * 60 * 1000);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const content = String(value ?? "").trim();
  if (!content) return null;
  const dayFirst = content.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/,
  );
  if (dayFirst) {
    const utc = Date.UTC(
      Number(dayFirst[3]),
      Number(dayFirst[2]) - 1,
      Number(dayFirst[1]),
      Number(dayFirst[4] || 0) - 7,
      Number(dayFirst[5] || 0),
      Number(dayFirst[6] || 0),
    );
    const parsed = new Date(utc);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(content);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function dateOnly(value: unknown) {
  const parsed = recruitmentGoogleSheetDate(value);
  return parsed ? parsed.toISOString().slice(0, 10) : String(value ?? "").trim();
}

function stageFromTrackingStatus(status: string) {
  const normalized = normalizeRecruitmentSheetText(status);
  if (normalized.includes("nhan viec")) return "onboarding";
  if (normalized.includes("offer")) return "offer";
  if (normalized.includes("pv v2") || normalized.includes("vong 2")) {
    return "round2";
  }
  if (
    normalized.includes("pv v1") ||
    normalized.includes("vong 1") ||
    normalized.includes("phong van")
  ) {
    return "round1";
  }
  if (normalized.includes("test") || normalized.includes("danh gia")) {
    return "test";
  }
  if (normalized.includes("so van") || normalized.includes("lien he")) {
    return "preliminary";
  }
  if (
    normalized.includes("loai") ||
    normalized.includes("khong phu hop") ||
    normalized.includes("luu tru")
  ) {
    return "closed";
  }
  return "cv_screening";
}

function nextActionForStage(stage: string) {
  if (stage === "round2") return "Phỏng vấn vòng 2";
  if (stage === "round1") return "Phỏng vấn vòng 1";
  if (stage === "offer") return "Chuẩn bị Offer";
  if (stage === "onboarding") return "Theo dõi nhận việc";
  if (stage === "closed") return "Đã kết thúc tuyển dụng";
  return stage === "preliminary" ? "Sơ vấn ứng viên" : "Rà soát hồ sơ";
}

function combinedInterviewDate(dateValue: unknown, timeValue: unknown) {
  if (typeof dateValue === "number" && Number.isFinite(dateValue)) {
    const time =
      typeof timeValue === "number" && Number.isFinite(timeValue)
        ? timeValue
        : 0;
    return recruitmentGoogleSheetDate(Math.trunc(dateValue) + time);
  }
  const date = recruitmentGoogleSheetDate(dateValue);
  if (!date) return null;
  if (typeof timeValue === "number" && Number.isFinite(timeValue)) {
    return new Date(date.getTime() + timeValue * 86_400_000);
  }
  const timeMatch = String(timeValue ?? "")
    .trim()
    .match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!timeMatch) return date;
  return new Date(
    date.getTime() +
      Number(timeMatch[1]) * 3_600_000 +
      Number(timeMatch[2]) * 60_000 +
      Number(timeMatch[3] || 0) * 1000,
  );
}

function reviewerIdentity(value: unknown) {
  const content = String(value ?? "").replace(/\s+/g, " ").trim();
  const parts = content.split(/\s+-\s+/);
  return {
    employeeCode: /^\d+$/.test(parts[0] || "") ? parts[0] : "",
    fallbackName: parts[1] || content,
    raw: content,
  };
}

async function syncInterviewPlanFromTracking(
  db: SyncDatabase,
  applicationId: string,
  tracking: SheetRow,
) {
  const rounds = [
    {
      date: field(tracking.record, "Ngày PV vòng 1"),
      key: "round1",
      label: "Phỏng vấn vòng 1",
      reviewers: [
        {
          key: "culture",
          label: "Đánh giá văn hóa",
          value: field(tracking.record, "Người phỏng vấn V1 - Văn hóa"),
        },
        {
          key: "technical",
          label: "Đánh giá chuyên môn",
          value: field(tracking.record, "Người phỏng vấn V1 - Chuyên môn"),
        },
        {
          key: "balance",
          label: "Đánh giá cân bằng",
          value: field(tracking.record, "Người phỏng vấn V1 - Cân bằng"),
        },
      ],
      time: field(tracking.record, "Giờ phỏng vấn V1"),
    },
    {
      date: field(tracking.record, "Ngày PV vòng 2"),
      key: "round2",
      label: "Phỏng vấn vòng 2",
      reviewers: [
        {
          key: "interviewer",
          label: "Người phỏng vấn",
          value: field(tracking.record, "Người phỏng vấn V2 -01"),
        },
        {
          key: "decision",
          label: "Quyết định",
          value: field(tracking.record, "Người phỏng vấn V2 -02"),
        },
      ],
      time: field(tracking.record, "Giờ phỏng vấn V2"),
    },
  ];

  for (const round of rounds) {
    const reviewers = round.reviewers.filter((reviewer) =>
      String(reviewer.value ?? "").trim(),
    );
    const startAt = combinedInterviewDate(round.date, round.time);
    if (!reviewers.length && !startAt) continue;
    const interviewId = stableId(
      "rec_interview",
      `tracking|${tracking.rowNumber}|${round.key}`,
    );
    await db.recruitmentInterview.upsert({
      create: {
        applicationId,
        createdByName: "Đồng bộ Google Form V3",
        id: interviewId,
        roundKey: round.key,
        roundLabel: round.label,
        startAt,
        status: startAt ? "scheduled" : "assigned",
        updatedByName: "Đồng bộ Google Form V3",
      },
      update: {
        applicationId,
        roundKey: round.key,
        roundLabel: round.label,
        startAt,
        status: startAt ? "scheduled" : "assigned",
        updatedByName: "Đồng bộ Google Form V3",
      },
      where: { id: interviewId },
    });
    for (const reviewer of reviewers) {
      const identity = reviewerIdentity(reviewer.value);
      const employee = identity.employeeCode
        ? await db.employee.findFirst({
            select: { fullName: true, id: true },
            where: { employeeCode: identity.employeeCode },
          })
        : null;
      await db.recruitmentAssignment.upsert({
        create: {
          applicationId,
          id: stableId(
            "rec_assignment",
            `tracking|${tracking.rowNumber}|${round.key}|${reviewer.key}`,
          ),
          interviewId,
          reviewerEmployeeId: employee?.id || identity.employeeCode || null,
          reviewerName: employee?.fullName || identity.fallbackName,
          roleKey: reviewer.key,
          roleLabel: reviewer.label,
          roundKey: round.key,
          status: "assigned",
        },
        update: {
          applicationId,
          interviewId,
          reviewerEmployeeId: employee?.id || identity.employeeCode || null,
          reviewerName: employee?.fullName || identity.fallbackName,
          roleKey: reviewer.key,
          roleLabel: reviewer.label,
          roundKey: round.key,
          status: "assigned",
        },
        where: {
          id: stableId(
            "rec_assignment",
            `tracking|${tracking.rowNumber}|${round.key}|${reviewer.key}`,
          ),
        },
      });
    }
  }
}

async function applicationFromTrackingRow(
  db: SyncDatabase,
  candidateCode: string,
  tracking: SheetRow | undefined,
  options: { testCompleted?: boolean } = {},
) {
  if (!tracking) {
    const existing = candidateCode
      ? await db.recruitmentApplication.findFirst({
          orderBy: { updatedAt: "desc" },
          select: { id: true },
          where: { candidateCode },
        })
      : null;
    if (existing) {
      if (options.testCompleted) {
        await db.recruitmentJourney.upsert({
          create: {
            applicationId: existing.id,
            nextAction: "Rà soát kết quả bài test",
            progressKey: "waiting",
            stageKey: "test",
            testStatus: "completed",
            updatedByName: "Tự động từ Google Form",
          },
          update: { testStatus: "completed" },
          where: { applicationId: existing.id },
        });
      }
      return { applicationId: existing.id, created: false };
    }
    const identity = `portal|${candidateCode}`;
    const candidateId = stableId("rec_candidate", identity);
    const applicationId = stableId("rec_application", identity);
    await db.recruitmentCandidate.upsert({
      create: {
        fullName: `Ứng viên ${candidateCode}`,
        id: candidateId,
      },
      update: {},
      where: { id: candidateId },
    });
    await db.recruitmentApplication.upsert({
      create: {
        applicationCode: `legacy-portal:${candidateCode}`,
        candidateCode,
        candidateId,
        id: applicationId,
        raw: asJson({ importedBy: "v3-form-sync" }),
        status: "IMPORTED",
      },
      update: { candidateCode, candidateId },
      where: { applicationCode: `legacy-portal:${candidateCode}` },
    });
    await db.recruitmentJourney.upsert({
      create: {
        applicationId,
        nextAction: options.testCompleted
          ? "Rà soát kết quả bài test"
          : "Rà soát hồ sơ và liên hệ ứng viên",
        progressKey: "waiting",
        stageKey: options.testCompleted ? "test" : "cv_screening",
        testStatus: options.testCompleted ? "completed" : undefined,
        updatedByName: options.testCompleted
          ? "Tự động từ Google Form"
          : "Đồng bộ đầu vào V2",
      },
      update: options.testCompleted ? { testStatus: "completed" } : {},
      where: { applicationId },
    });
    return { applicationId, created: true };
  }

  const [existingByRow, existingByCode] = await Promise.all([
    db.recruitmentApplication.findUnique({
      include: { journey: true },
      where: { legacyRowNumber: tracking.rowNumber },
    }),
    candidateCode
      ? db.recruitmentApplication.findFirst({
          include: { journey: true },
          orderBy: { updatedAt: "desc" },
          where: { candidateCode },
        })
      : Promise.resolve(null),
  ]);
  const existing = existingByRow || existingByCode;
  const source = stringField(tracking.record, "Nguồn tuyển dụng") || "Không xác định";
  const requisitionCode = stringField(
    tracking.record,
    "Mã yêu cầu tuyển dụng",
  );
  const phone = normalizePhone(field(tracking.record, "Số Điện Thoại"));
  const email = stringField(tracking.record, "Email").toLowerCase();
  const fullName =
    stringField(tracking.record, "Họ và tên ứng viên", "Họ và tên ứng viên") ||
    `Ứng viên ${candidateCode || tracking.rowNumber}`;
  const identity = candidateCode || phone || email || `${fullName}|${tracking.rowNumber}`;
  const candidateId = existing?.candidateId || stableId("rec_candidate", identity);
  const applicationId =
    existing?.id || stableId("rec_application", `tracking|${tracking.rowNumber}`);
  const campaigns = requisitionCode
    ? await db.recruitmentCampaign.findMany({
        select: { id: true, source: true },
        where: { code: requisitionCode },
      })
    : [];
  const campaign =
    campaigns.find(
      (item) =>
        normalizeRecruitmentSheetText(item.source) ===
        normalizeRecruitmentSheetText(source),
    ) || campaigns[0];
  const status = stringField(tracking.record, "Trạng thái ứng viên");
  const stageKey = stageFromTrackingStatus(status);
  const birthDate =
    dateOnly(field(tracking.record, "Ngày tháng năm sinh")) || null;

  await db.recruitmentCandidate.upsert({
    create: {
      birthDate,
      email: email || null,
      fullName,
      id: candidateId,
      phone: phone || null,
    },
    update: {
      birthDate,
      email: email || null,
      fullName,
      phone: phone || null,
    },
    where: { id: candidateId },
  });
  const applicationData = {
      campaignId: campaign?.id,
      candidateCode: candidateCode || null,
      candidateId,
      cvUrl:
        stringField(
          tracking.record,
          "Link CV Ứng Viên (Link Base Workflow)",
        ) || null,
      department: stringField(tracking.record, "Phòng ban") || null,
      legacyRowNumber: tracking.rowNumber,
      level: stringField(tracking.record, "Cấp bậc") || null,
      note: stringField(tracking.record, "Ghi chú") || null,
      position:
        stringField(tracking.record, "Vị trí tuyển dụng", "Vị trí") || null,
      raw: asJson(tracking.record),
      receivedAt: recruitmentGoogleSheetDate(
        field(tracking.record, "Ngày nộp"),
      ),
      recruiter: stringField(tracking.record, "Người tuyển dụng") || null,
      requisitionCode: requisitionCode || null,
      source,
      status: status || null,
  };
  if (existing) {
    await db.recruitmentApplication.update({
      data: applicationData,
      where: { id: existing.id },
    });
  } else {
    await db.recruitmentApplication.create({
      data: {
        ...applicationData,
        applicationCode: `legacy-tracking:${tracking.rowNumber}`,
        id: applicationId,
      },
    });
  }
  const journeyWasAutomatic =
    !existing?.journey?.updatedByName ||
    /^(Đồng bộ|Tự động)/i.test(existing.journey.updatedByName);
  await db.recruitmentJourney.upsert({
    create: {
      applicationId,
      nextAction: nextActionForStage(stageKey),
      progressKey: ["round1", "round2"].includes(stageKey)
        ? "scheduled"
        : "waiting",
      stageKey,
      testStatus: options.testCompleted ? "completed" : undefined,
      updatedByName: "Đồng bộ đầu vào V2",
    },
    update: {
      ...(journeyWasAutomatic
        ? {
            nextAction: nextActionForStage(stageKey),
            progressKey: ["round1", "round2"].includes(stageKey)
              ? "scheduled"
              : "waiting",
            stageKey,
            updatedByName: "Đồng bộ đầu vào V2",
          }
        : {}),
      ...(options.testCompleted ? { testStatus: "completed" } : {}),
    },
    where: { applicationId },
  });
  await syncInterviewPlanFromTracking(db, applicationId, tracking);
  return { applicationId, created: !existing };
}

async function saveResponse(input: {
  configRows: unknown[][];
  headers: string[];
  response: SheetRow;
  tracking?: SheetRow;
}) {
  const db = getDb();
  const config = parseRecruitmentFormScoringConfig(input.configRows);
  const scored = scoreRecruitmentFormSubmission({
    config,
    headers: input.headers,
    row: input.response.values,
  });
  if (!scored.code) {
    throw new Error("Lượt gửi không có Mã phỏng vấn.");
  }
  const sourceTimestamp =
    recruitmentGoogleSheetDate(field(input.response.record, "Dấu thời gian")) ||
    new Date();
  const compactDetail = {
    detailHex: scored.detailHex.map((item) => ({
      addTrait: item.addTrait,
      q: item.q,
      subTrait: item.subTrait,
    })),
    gtAbs: scored.gtAbsolute,
    gtProfile: scored.gtProfile,
    hex: scored.hex,
    interviewCode: scored.code,
    lvl: scored.levels,
    source: "v3-form-sync",
  };
  const detailJson = JSON.stringify(compactDetail);
  if (detailJson.length > 50_000) {
    throw new Error("Kết quả tóm tắt vượt quá giới hạn an toàn 50.000 ký tự.");
  }
  const hexacoPayload: Record<string, unknown> = {
    "Dấu thời gian": sourceTimestamp.toISOString(),
    "Mã Phỏng vấn": scored.code,
    "Mã phỏng vấn": scored.code,
    "Detail(JSON)": detailJson,
    "Đáy": scored.pit,
    "Đỉnh": scored.peak,
  };
  RECRUITMENT_FORM_TRAITS.forEach((trait) => {
    hexacoPayload[trait] = scored.hex[trait];
    hexacoPayload[`${trait}_level`] = scored.levels[trait];
    hexacoPayload[`${trait}_lvl`] = scored.levels[trait];
  });
  RECRUITMENT_FORM_GT_KEYS.forEach((key) => {
    hexacoPayload[key] = scored.gtProfile[key];
  });

  return db.$transaction(async (transaction) => {
    const linked = await applicationFromTrackingRow(
      transaction,
      scored.code,
      input.tracking,
      { testCompleted: true },
    );
    await transaction.recruitmentLegacySnapshot.upsert({
      create: {
        applicationId: linked.applicationId,
        createdAt: sourceTimestamp,
        id: stableId(
          "rec_snapshot",
          `${RESULTS_SHEET}|${input.response.rowNumber}`,
        ),
        kind: "candidate-result",
        payload: asJson(input.response.record),
        sourceRow: input.response.rowNumber,
        sourceSheet: RESULTS_SHEET,
        sourceUpdatedAt: sourceTimestamp,
      },
      update: {
        applicationId: linked.applicationId,
        payload: asJson(input.response.record),
        sourceUpdatedAt: sourceTimestamp,
      },
      where: {
        id: stableId(
          "rec_snapshot",
          `${RESULTS_SHEET}|${input.response.rowNumber}`,
        ),
      },
    });
    await transaction.recruitmentLegacySnapshot.upsert({
      create: {
        applicationId: linked.applicationId,
        createdAt: sourceTimestamp,
        id: stableId(
          "rec_snapshot",
          `form-sync|${RESULTS_SHEET}|${input.response.rowNumber}`,
        ),
        kind: "hexaco",
        payload: asJson(hexacoPayload),
        sourceRow: input.response.rowNumber,
        sourceSheet: GENERATED_HEXACO_SHEET,
        sourceUpdatedAt: sourceTimestamp,
      },
      update: {
        applicationId: linked.applicationId,
        payload: asJson(hexacoPayload),
        sourceUpdatedAt: sourceTimestamp,
      },
      where: {
        id: stableId(
          "rec_snapshot",
          `form-sync|${RESULTS_SHEET}|${input.response.rowNumber}`,
        ),
      },
    });
    await transaction.recruitmentJourney.upsert({
      create: {
        applicationId: linked.applicationId,
        nextAction: "Rà soát kết quả bài test",
        progressKey: "waiting",
        stageKey: "test",
        testStatus: "completed",
        updatedByName: "Tự động từ Google Form",
      },
      update: { testStatus: "completed" },
      where: { applicationId: linked.applicationId },
    });
    await transaction.recruitmentTimeline.upsert({
      create: {
        actorName: "Đồng bộ Google Form V3",
        applicationId: linked.applicationId,
        createdAt: sourceTimestamp,
        detail: `Lượt gửi nguồn dòng ${input.response.rowNumber}.`,
        eventType: "candidate-test-synced",
        id: stableId(
          "rec_timeline",
          `form-sync|${RESULTS_SHEET}|${input.response.rowNumber}`,
        ),
        title: "Đã nhận bài đánh giá từ Google Form",
      },
      update: {
        applicationId: linked.applicationId,
        createdAt: sourceTimestamp,
      },
      where: {
        id: stableId(
          "rec_timeline",
          `form-sync|${RESULTS_SHEET}|${input.response.rowNumber}`,
        ),
      },
    });
    return {
      applicationCreated: linked.created,
      applicationId: linked.applicationId,
      candidateCode: scored.code,
      detailLength: detailJson.length,
      usedFallbackHexacoMap: config.usedFallbackHexacoMap,
    };
  });
}

function candidateCodeAliases(value: unknown) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  const unquoted = raw.replace(/^["']+|["']+$/g, "").trim();
  return [...new Set([raw, unquoted].filter(Boolean))];
}

function preliminaryFingerprint(record: Record<string, unknown>) {
  const updatedAt = recruitmentGoogleSheetDate(
    field(record, "SV_Updated_At", "Cập nhật lúc"),
  );
  return migrationFingerprint({
    candidateCode:
      candidateCodeAliases(
        field(record, "Mã phỏng vấn", "Mã Phỏng vấn", "Mã ứng viên"),
      ).at(-1) || "",
    detail: String(field(record, "SV_Detail(JSON)") || ""),
    updatedAt: updatedAt?.toISOString() || "",
    updatedBy: stringField(record, "SV_Updated_By", "Người cập nhật"),
  });
}

async function savePreliminaryResult(input: {
  response: SheetRow;
  tracking?: SheetRow;
}) {
  const db = getDb();
  const rawCandidateCode = stringField(
    input.response.record,
    "Mã phỏng vấn",
    "Mã Phỏng vấn",
    "Mã ứng viên",
  );
    const aliases = candidateCodeAliases(rawCandidateCode);
  const candidateCode = aliases.at(-1) || "";
  if (!candidateCode) {
    throw new Error("Kết quả sơ khảo không có Mã phỏng vấn.");
  }
  const sourceTimestamp =
    recruitmentGoogleSheetDate(
      field(input.response.record, "SV_Updated_At", "Cập nhật lúc"),
    ) || new Date();
  const snapshotId = stableId(
    "rec_snapshot",
    `${PRELIMINARY_SHEET}|${input.response.rowNumber}`,
  );

  return db.$transaction(async (transaction) => {
    const existingApplication = await transaction.recruitmentApplication.findFirst({
      orderBy: { updatedAt: "desc" },
      select: { id: true },
      where: { candidateCode: { in: aliases } },
    });
    const linked = existingApplication
      ? { applicationId: existingApplication.id, created: false }
      : await applicationFromTrackingRow(
          transaction,
          candidateCode,
          input.tracking,
        );
    await transaction.recruitmentLegacySnapshot.upsert({
      create: {
        applicationId: linked.applicationId,
        createdAt: sourceTimestamp,
        id: snapshotId,
        kind: "so-van",
        payload: asJson(input.response.record),
        sourceRow: input.response.rowNumber,
        sourceSheet: PRELIMINARY_SHEET,
        sourceUpdatedAt: sourceTimestamp,
      },
      update: {
        applicationId: linked.applicationId,
        payload: asJson(input.response.record),
        sourceUpdatedAt: sourceTimestamp,
      },
      where: { id: snapshotId },
    });
    return {
      applicationCreated: linked.created,
      applicationId: linked.applicationId,
      snapshotId,
    };
  });
}

export async function runRecruitmentTrackingSync(input: {
  force?: boolean;
  triggeredById?: string;
} = {}) {
  const db = getDb();
  const migration = await startMigrationRun(db, {
    config: sourceConfig().tracking,
    kind: "GOOGLE_SHEET",
    mode: "SYNC",
    name: "Đầu vào ứng viên từ Theo dõi Tuyển dụng V2",
    sourceKey: RECRUITMENT_TRACKING_SYNC_SOURCE_KEY,
    triggeredById: input.triggeredById,
  });
  let rowsRead = 0;
  let rowsCreated = 0;
  let rowsUpdated = 0;
  let rowsFailed = 0;
  let rowsSkipped = 0;
  try {
    const tracking = await readSheet({
      range: "A:AI",
      sheetName: TRACKING_SHEET,
      spreadsheetId: TRACKING_SPREADSHEET_ID,
    });
    rowsRead = tracking.rows.length;
    const existingMaps = await db.externalIdMap.findMany({
      select: { externalId: true, fingerprint: true },
      where: {
        entityType: "recruitment-tracking-row",
        sourceId: migration.sourceId,
      },
    });
    const fingerprintByExternalId = new Map(
      existingMaps.map((item) => [item.externalId, item.fingerprint || ""]),
    );
    const validRows = tracking.rows.filter((row) =>
      Boolean(
        stringField(row.record, "Mã ứng viên") ||
          stringField(
            row.record,
            "Họ và tên ứng viên",
            "Họ và tên ứng viên",
          ) ||
          normalizePhone(field(row.record, "Số Điện Thoại")) ||
          stringField(row.record, "Email"),
      ),
    );
    rowsSkipped += tracking.rows.length - validRows.length;
    const pending = validRows
      .map((row) => {
        const externalId = `tracking-row:${row.rowNumber}`;
        const fingerprint = migrationFingerprint(row.values);
        return { externalId, fingerprint, row };
      })
      .filter((item) => {
        const unchanged =
          fingerprintByExternalId.get(item.externalId) === item.fingerprint;
        if (unchanged && !input.force) rowsSkipped += 1;
        return input.force || !unchanged;
      });

    const batchSize = 6;
    for (let offset = 0; offset < pending.length; offset += batchSize) {
      const batch = pending.slice(offset, offset + batchSize);
      await Promise.all(
        batch.map(async ({ externalId, fingerprint, row }) => {
          const candidateCode = stringField(row.record, "Mã ứng viên");
          const migrationRecord = await stageMigrationRecord(db, {
            entityType: "recruitment-tracking-row",
            externalId,
            fingerprint,
            rawData: row.record,
            rowNumber: row.rowNumber,
            runId: migration.runId,
          });
          try {
            const saved = await db.$transaction((transaction) =>
              applicationFromTrackingRow(
                transaction,
                candidateCode,
                row,
                { testCompleted: false },
              ),
            );
            if (saved.created) rowsCreated += 1;
            else rowsUpdated += 1;
            await mapExternalId(db, {
              entityType: "recruitment-tracking-row",
              externalId,
              fingerprint,
              internalId: saved.applicationId,
              metadata: {
                candidateCode,
                rowNumber: row.rowNumber,
                sheetName: TRACKING_SHEET,
              },
              sourceId: migration.sourceId,
            });
            await finishMigrationRecord(db, migrationRecord.id, {
              internalId: saved.applicationId,
              status: "IMPORTED",
            });
          } catch (error) {
            rowsFailed += 1;
            const message =
              error instanceof Error
                ? error.message
                : "Không ánh xạ được dòng ứng viên V2.";
            await recordMigrationIssue(db, {
              code: "RECRUITMENT_TRACKING_ROW_FAILED",
              externalId: candidateCode || externalId,
              message,
              rawData: row.record,
              rowNumber: row.rowNumber,
              runId: migration.runId,
            });
            await finishMigrationRecord(db, migrationRecord.id, {
              issueCount: 1,
              status: "FAILED",
            });
          }
        }),
      );
    }

    const status = rowsFailed ? "PARTIAL" : "COMPLETED";
    const summary = rowsFailed
      ? `Đã ánh xạ ${rowsCreated + rowsUpdated}/${pending.length} dòng đầu vào V2; ${rowsFailed} dòng cần kiểm tra.`
      : pending.length
        ? `Đã ánh xạ ${rowsCreated} hồ sơ mới và cập nhật ${rowsUpdated} hồ sơ từ V2 sang PostgreSQL.`
        : `Đầu vào V2 đã đồng bộ đủ ${validRows.length} dòng; không có thay đổi mới.`;
    await finishMigrationRun(db, migration.runId, {
      checksum: migrationFingerprint(tracking.rows.map((row) => row.values)),
      rowsCreated,
      rowsFailed,
      rowsRead,
      rowsSkipped,
      rowsUpdated,
      rowsValid: validRows.length - rowsFailed,
      status,
      summary,
    });
    return {
      failed: rowsFailed,
      imported: rowsCreated,
      message: summary,
      runId: migration.runId,
      skipped: rowsSkipped,
      updated: rowsUpdated,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Không đồng bộ được đầu vào ứng viên V2.";
    await finishMigrationRun(db, migration.runId, {
      rowsCreated,
      rowsFailed: Math.max(1, rowsFailed),
      rowsRead,
      rowsSkipped,
      rowsUpdated,
      rowsValid: Math.max(0, rowsRead - rowsFailed),
      status: "FAILED",
      summary: message,
    });
    throw error;
  }
}

export async function runRecruitmentFormSync(input: {
  triggeredById?: string;
} = {}) {
  const db = getDb();
  const migration = await startMigrationRun(db, {
    config: sourceConfig(),
    kind: "GOOGLE_SHEET",
    mode: "SYNC",
    name: "Kết quả bài test và sơ khảo ứng viên",
    sourceKey: RECRUITMENT_FORM_SYNC_SOURCE_KEY,
    triggeredById: input.triggeredById,
  });
  let rowsRead = 0;
  let rowsCreated = 0;
  let rowsUpdated = 0;
  let rowsFailed = 0;
  let rowsSkipped = 0;
  let applicationCreated = 0;
  let preliminaryImported = 0;
  let preliminaryUpdated = 0;
  try {
    const [results, preliminary] = await Promise.all([
      readSheet({
        range: "A:ZZ",
        sheetName: RESULTS_SHEET,
        spreadsheetId: RESULTS_SPREADSHEET_ID,
      }),
      readSheet({
        range: "A:D",
        sheetName: PRELIMINARY_SHEET,
        spreadsheetId: RESULTS_SPREADSHEET_ID,
      }),
    ]);
    rowsRead = results.rows.length + preliminary.rows.length;
    const [existing, repairCandidates, existingPreliminary] = await Promise.all([
      db.recruitmentLegacySnapshot.findMany({
        select: { sourceRow: true },
        where: {
          kind: "candidate-result",
          sourceRow: { not: null },
          sourceSheet: RESULTS_SHEET,
        },
      }),
      db.recruitmentLegacySnapshot.findMany({
        select: {
          application: {
            select: {
              interviews: { select: { roundKey: true } },
              journey: { select: { stageKey: true } },
            },
          },
          sourceRow: true,
        },
        where: {
          kind: "hexaco",
          sourceRow: { not: null },
          sourceSheet: GENERATED_HEXACO_SHEET,
        },
      }),
      db.recruitmentLegacySnapshot.findMany({
        select: { payload: true, sourceRow: true },
        where: {
          kind: "so-van",
          sourceRow: { not: null },
          sourceSheet: PRELIMINARY_SHEET,
        },
      }),
    ]);
    const importedRows = new Set(
      existing.map((item) => item.sourceRow).filter((row) => row != null),
    );
    const repairRows = new Set(
      repairCandidates
        .filter((item) => {
          const stage = item.application.journey?.stageKey;
          if (!stage || !["round1", "round2"].includes(stage)) return false;
          return !item.application.interviews.some(
            (interview) =>
              interview.roundKey === stage ||
              interview.roundKey === stage.replace("round", "round_"),
          );
        })
        .map((item) => item.sourceRow)
        .filter((row) => row != null),
    );
    const pending = results.rows.filter(
      (row) => !importedRows.has(row.rowNumber) || repairRows.has(row.rowNumber),
    );
    const preliminaryByRow = new Map(
      existingPreliminary
        .filter((item) => item.sourceRow != null)
        .map((item) => [item.sourceRow as number, item.payload]),
    );
    const pendingPreliminary = preliminary.rows.filter((row) => {
      const current = preliminaryByRow.get(row.rowNumber);
      return (
        !current ||
        preliminaryFingerprint(current as Record<string, unknown>) !==
          preliminaryFingerprint(row.record)
      );
    });
    rowsSkipped =
      results.rows.length - pending.length +
      preliminary.rows.length - pendingPreliminary.length;
    if (!pending.length && !pendingPreliminary.length) {
      const summary =
        `Đã đồng bộ đủ ${results.rows.length} bài test và ${preliminary.rows.length} kết quả sơ khảo; ` +
        "không có dữ liệu mới.";
      await finishMigrationRun(db, migration.runId, {
        checksum: migrationFingerprint({
          preliminary: preliminary.rows.map((row) => row.values),
          results: results.rows.map((row) => row.values),
        }),
        rowsCreated: 0,
        rowsFailed: 0,
        rowsRead,
        rowsSkipped,
        rowsUpdated,
        rowsValid: rowsRead,
        status: "COMPLETED",
        summary,
      });
      return {
        applicationCreated: 0,
        imported: 0,
        message: summary,
        preliminaryImported: 0,
        preliminaryUpdated: 0,
        runId: migration.runId,
        skipped: rowsSkipped,
      };
    }

    const [config, tracking] = await Promise.all([
      pending.length
        ? readSheet({
            headerRow: 0,
            range: "A:K",
            sheetName: SCORING_SHEET,
            spreadsheetId: SCORING_SPREADSHEET_ID,
          })
        : Promise.resolve({ headers: [], rows: [] } satisfies SheetData),
      readSheet({
        range: "A:AI",
        sheetName: TRACKING_SHEET,
        spreadsheetId: TRACKING_SPREADSHEET_ID,
      }),
    ]);
    const trackingByCode = new Map<string, SheetRow>();
    tracking.rows.forEach((row) => {
      const code = stringField(row.record, "Mã ứng viên");
      candidateCodeAliases(code).forEach((alias) => trackingByCode.set(alias, row));
    });

    for (const response of pending) {
      const candidateCode = stringField(
        response.record,
        "Mã Phỏng vấn",
        "Mã phỏng vấn",
        "Mã ứng viên",
      );
      const migrationRecord = await stageMigrationRecord(db, {
        entityType: "recruitment-form-response",
        externalId: candidateCode || `row-${response.rowNumber}`,
        fingerprint: preliminaryFingerprint(response.record),
        rawData: response.record,
        rowNumber: response.rowNumber,
        runId: migration.runId,
      });
      try {
        const isRepair = importedRows.has(response.rowNumber);
        const saved = await saveResponse({
          configRows: config.rows.map((row) => row.values),
          headers: results.headers,
          response,
          tracking: trackingByCode.get(candidateCode),
        });
        if (isRepair) rowsUpdated += 1;
        else rowsCreated += 1;
        if (saved.applicationCreated) applicationCreated += 1;
        await finishMigrationRecord(db, migrationRecord.id, {
          internalId: saved.applicationId,
          status: "IMPORTED",
        });
      } catch (error) {
        rowsFailed += 1;
        const message =
          error instanceof Error ? error.message : "Không chấm được lượt gửi.";
        await recordMigrationIssue(db, {
          code: "RECRUITMENT_FORM_ROW_FAILED",
          externalId: candidateCode || undefined,
          message,
          rawData: response.record,
          rowNumber: response.rowNumber,
          runId: migration.runId,
        });
        await finishMigrationRecord(db, migrationRecord.id, {
          issueCount: 1,
          status: "FAILED",
        });
      }
    }

    for (const response of pendingPreliminary) {
      const rawCandidateCode = stringField(
        response.record,
        "Mã phỏng vấn",
        "Mã Phỏng vấn",
        "Mã ứng viên",
      );
      const aliases = candidateCodeAliases(rawCandidateCode);
      const candidateCode = aliases.at(-1) || "";
      const migrationRecord = await stageMigrationRecord(db, {
        entityType: "recruitment-preliminary-result",
        externalId: candidateCode || `row-${response.rowNumber}`,
        fingerprint: migrationFingerprint(response.values),
        rawData: response.record,
        rowNumber: response.rowNumber,
        runId: migration.runId,
      });
      try {
        const isUpdate = preliminaryByRow.has(response.rowNumber);
        const saved = await savePreliminaryResult({
          response,
          tracking: aliases
            .map((alias) => trackingByCode.get(alias))
            .find((row): row is SheetRow => Boolean(row)),
        });
        if (isUpdate) {
          rowsUpdated += 1;
          preliminaryUpdated += 1;
        } else {
          rowsCreated += 1;
          preliminaryImported += 1;
        }
        if (saved.applicationCreated) applicationCreated += 1;
        await finishMigrationRecord(db, migrationRecord.id, {
          internalId: saved.applicationId,
          status: "IMPORTED",
        });
      } catch (error) {
        rowsFailed += 1;
        const message =
          error instanceof Error
            ? error.message
            : "Không nhận được kết quả sơ khảo.";
        await recordMigrationIssue(db, {
          code: "RECRUITMENT_PRELIMINARY_ROW_FAILED",
          externalId: candidateCode || undefined,
          message,
          rawData: response.record,
          rowNumber: response.rowNumber,
          runId: migration.runId,
        });
        await finishMigrationRecord(db, migrationRecord.id, {
          issueCount: 1,
          status: "FAILED",
        });
      }
    }

    const status = rowsFailed ? "PARTIAL" : "COMPLETED";
    const formImported = rowsCreated - preliminaryImported;
    const formUpdated = rowsUpdated - preliminaryUpdated;
    const summary = rowsFailed
      ? `Đã xử lý ${rowsCreated + rowsUpdated}/${pending.length + pendingPreliminary.length} kết quả; ${rowsFailed} dòng cần kiểm tra.`
      : `Đồng bộ xong: bài test ${formImported} mới, ${formUpdated} cập nhật; sơ khảo ${preliminaryImported} mới, ${preliminaryUpdated} cập nhật.`;
    await finishMigrationRun(db, migration.runId, {
      checksum: migrationFingerprint({
        preliminary: preliminary.rows.map((row) => row.values),
        results: results.rows.map((row) => row.values),
      }),
      rowsCreated,
      rowsFailed,
      rowsRead,
      rowsSkipped,
      rowsUpdated,
      rowsValid: rowsRead - rowsFailed,
      status,
      summary,
    });
    return {
      applicationCreated,
      failed: rowsFailed,
      imported: rowsCreated,
      message: summary,
      preliminaryImported,
      preliminaryUpdated,
      runId: migration.runId,
      skipped: rowsSkipped,
      updated: rowsUpdated,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không đồng bộ được Google Form.";
    await finishMigrationRun(db, migration.runId, {
      rowsCreated,
      rowsFailed: Math.max(1, rowsFailed),
      rowsRead,
      rowsSkipped,
      rowsUpdated,
      rowsValid: Math.max(0, rowsRead - rowsFailed),
      status: "FAILED",
      summary: message,
    });
    throw error;
  }
}

export async function getRecruitmentFormSyncStatus() {
  const source = await getDb().migrationSource.findUnique({
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        select: {
          completedAt: true,
          id: true,
          rowsCreated: true,
          rowsFailed: true,
          rowsRead: true,
          startedAt: true,
          status: true,
          summary: true,
        },
        take: 1,
      },
    },
    where: { key: RECRUITMENT_FORM_SYNC_SOURCE_KEY },
  });
  const latest = source?.runs[0];
  return {
    configured: true,
    lastCompletedAt: latest?.completedAt?.toISOString() || "",
    lastRunAt: source?.lastRunAt?.toISOString() || "",
    latest: latest
      ? {
          completedAt: latest.completedAt?.toISOString() || "",
          imported: latest.rowsCreated,
          message: latest.summary || "",
          rowsFailed: latest.rowsFailed,
          rowsRead: latest.rowsRead,
          startedAt: latest.startedAt.toISOString(),
          status: latest.status,
        }
      : null,
    serviceAccount: RECRUITMENT_FORM_SYNC_SERVICE_ACCOUNT,
  };
}

export async function getRecruitmentTrackingSyncStatus() {
  const source = await getDb().migrationSource.findUnique({
    include: {
      runs: {
        orderBy: { startedAt: "desc" },
        select: {
          completedAt: true,
          id: true,
          rowsCreated: true,
          rowsFailed: true,
          rowsRead: true,
          rowsSkipped: true,
          rowsUpdated: true,
          startedAt: true,
          status: true,
          summary: true,
        },
        take: 1,
      },
    },
    where: { key: RECRUITMENT_TRACKING_SYNC_SOURCE_KEY },
  });
  const latest = source?.runs[0];
  return {
    configured: true,
    lastCompletedAt: latest?.completedAt?.toISOString() || "",
    lastRunAt: source?.lastRunAt?.toISOString() || "",
    latest: latest
      ? {
          completedAt: latest.completedAt?.toISOString() || "",
          imported: latest.rowsCreated,
          message: latest.summary || "",
          rowsFailed: latest.rowsFailed,
          rowsRead: latest.rowsRead,
          rowsSkipped: latest.rowsSkipped,
          startedAt: latest.startedAt.toISOString(),
          status: latest.status,
          updated: latest.rowsUpdated,
        }
      : null,
    serviceAccount: RECRUITMENT_FORM_SYNC_SERVICE_ACCOUNT,
  };
}
