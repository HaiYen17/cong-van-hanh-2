import { isRecruitmentAdministrator } from "./access-policy";

type RecruitmentAssessmentHistoryActor = {
  employeeCode: string;
  employeeId: string;
  isAdmin: boolean;
  roles?: string[];
  userId: string;
};

type RecruitmentAssessmentHistoryCard = {
  finalScore?: unknown;
  items?: unknown[];
  reviewerEmployeeId?: string | null;
  roundKey: string;
  status: string;
  submittedAt?: unknown;
};

function normalizedValue(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizedRound(value: unknown) {
  const round = normalizedValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_");
  if (
    round.includes("so_van") ||
    round.includes("screen") ||
    round.includes("prelim")
  ) {
    return "preliminary";
  }
  if (
    round === "round2" ||
    round === "vong2" ||
    round.includes("round_2") ||
    round.includes("vong_2") ||
    round.endsWith("_2")
  ) {
    return "round2";
  }
  return "round1";
}

function roundOrder(value: unknown) {
  const round = normalizedRound(value);
  if (round === "preliminary") return 0;
  if (round === "round1") return 1;
  return 2;
}

export function isCompletedRecruitmentAssessmentStatus(value: unknown) {
  return ["submitted", "completed", "published"].includes(
    normalizedValue(value),
  );
}

export function hasRecordedRecruitmentAssessment(
  card: RecruitmentAssessmentHistoryCard,
) {
  if (isCompletedRecruitmentAssessmentStatus(card.status)) return true;
  if (card.submittedAt) return true;

  const finalScore = String(card.finalScore ?? "").trim();
  return Boolean(
    Array.isArray(card.items) &&
      card.items.length &&
      finalScore !== "" &&
      Number.isFinite(Number(finalScore)),
  );
}

export function canViewRecruitmentAssessmentHistory(
  actor: RecruitmentAssessmentHistoryActor,
  card: RecruitmentAssessmentHistoryCard,
  currentRound: string,
) {
  if (isRecruitmentAdministrator(actor)) return true;

  const reviewer = String(card.reviewerEmployeeId || "").trim();
  if (
    reviewer &&
    [actor.employeeId, actor.employeeCode, actor.userId].includes(reviewer)
  ) {
    return true;
  }

  return (
    roundOrder(card.roundKey) < roundOrder(currentRound) &&
    hasRecordedRecruitmentAssessment(card)
  );
}
