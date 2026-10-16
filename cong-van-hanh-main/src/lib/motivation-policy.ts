export type MotivationAudience = {
  companyTokens: string[];
  department: string | null;
  employeeCode: string | null;
  employeeId: string | null;
  email: string | null;
  userId: string;
  username: string | null;
};

export type MotivationPolicyRecord = {
  createdAt: Date;
  displayChannel: string;
  endAt: Date | null;
  kind: string;
  priority: number;
  startAt: Date | null;
  targetCompanies: unknown;
  targetDepartments: unknown;
  targetEmployees: unknown;
  targetScope: string;
  title: string;
  updatedAt: Date;
};

export function normalizeMotivationToken(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function motivationStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function tokenSet(values: unknown[]) {
  return new Set(
    values
      .map(normalizeMotivationToken)
      .filter(Boolean),
  );
}

export function isMotivationVisibleAt(
  event: Pick<MotivationPolicyRecord, "endAt" | "startAt">,
  now: Date,
) {
  return (
    (!event.startAt || event.startAt.getTime() <= now.getTime()) &&
    (!event.endAt || event.endAt.getTime() >= now.getTime())
  );
}

export function matchesMotivationAudience(
  event: Pick<
    MotivationPolicyRecord,
    "targetCompanies" | "targetDepartments" | "targetEmployees" | "targetScope"
  >,
  audience: MotivationAudience,
) {
  const scope = normalizeMotivationToken(event.targetScope) || "all";
  if (scope === "all") return true;

  if (scope === "company") {
    const expected = tokenSet(motivationStringArray(event.targetCompanies));
    if (!expected.size) return false;
    return audience.companyTokens.some((value) =>
      expected.has(normalizeMotivationToken(value)),
    );
  }

  if (scope === "department") {
    const expected = tokenSet(motivationStringArray(event.targetDepartments));
    return Boolean(
      audience.department &&
        expected.has(normalizeMotivationToken(audience.department)),
    );
  }

  if (scope === "employee") {
    const expected = tokenSet(motivationStringArray(event.targetEmployees));
    const actual = [
      audience.employeeCode,
      audience.employeeId,
      audience.userId,
      audience.email,
      audience.username,
    ]
      .map(normalizeMotivationToken)
      .filter(Boolean);
    return actual.some((value) => expected.has(value));
  }

  return false;
}

function contentTypeWeight(kind: string) {
  if (kind === "notice") return 2;
  if (kind === "event") return 1;
  return 0;
}

export function compareMotivationBulletins(
  left: MotivationPolicyRecord,
  right: MotivationPolicyRecord,
) {
  if (left.priority !== right.priority) return right.priority - left.priority;

  const typeDifference =
    contentTypeWeight(right.kind) - contentTypeWeight(left.kind);
  if (typeDifference) return typeDifference;

  const leftTime = (
    left.startAt ??
    left.updatedAt ??
    left.createdAt
  ).getTime();
  const rightTime = (
    right.startAt ??
    right.updatedAt ??
    right.createdAt
  ).getTime();
  if (leftTime !== rightTime) return rightTime - leftTime;

  return left.title.localeCompare(right.title, "vi");
}

export function filterMotivationRecords<T extends MotivationPolicyRecord>(
  records: T[],
  audience: MotivationAudience,
  now: Date,
) {
  return records.filter(
    (record) =>
      isMotivationVisibleAt(record, now) &&
      matchesMotivationAudience(record, audience),
  );
}

export function formatMotivationSchedule(
  startAt: string | Date | null,
  endAt: string | Date | null,
) {
  const formatter = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  });
  const start = startAt ? new Date(startAt) : null;
  const end = endAt ? new Date(endAt) : null;

  if (start && end) {
    return `${formatter.format(start)} – ${formatter.format(end)}`;
  }
  if (start) return `Từ ${formatter.format(start)}`;
  if (end) return `Đến ${formatter.format(end)}`;
  return null;
}

function formatCompactSchedulePoint(value: string | Date) {
  const parts = new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";

  return `${part("day")}/${part("month")} · ${part("hour")}:${part("minute")}`;
}

export function formatMotivationCompactSchedule(
  startAt: string | Date | null,
  endAt: string | Date | null,
) {
  if (startAt && endAt) {
    return `${formatCompactSchedulePoint(startAt)} → ${formatCompactSchedulePoint(endAt)}`;
  }
  if (startAt) return `Từ ${formatCompactSchedulePoint(startAt)}`;
  if (endAt) return `Đến ${formatCompactSchedulePoint(endAt)}`;
  return null;
}
