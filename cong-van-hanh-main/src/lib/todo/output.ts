export type CanonicalTodoOutputStatus =
  | "APPROVED"
  | "CANCELLED"
  | "IN_PROGRESS"
  | "OPEN"
  | "REJECTED"
  | "RETURNED"
  | "WAITING_REVIEW";

function recordOf(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

export function todoStringList(value: unknown) {
  const source = Array.isArray(value) ? value : [];
  return [...new Set(source.map(text).filter(Boolean))];
}

export function todoAssigneeEmployeeIds(value: unknown) {
  const output = recordOf(value);
  return [
    ...new Set([
      ...todoStringList(output.assigneeEmployeeIds),
      text(output.assigneeEmployeeId),
    ].filter(Boolean)),
  ];
}

export function todoAssigneeUserIds(value: unknown) {
  const output = recordOf(value);
  return [
    ...new Set([
      ...todoStringList(output.assigneeUserIds),
      text(output.assigneeUserId),
    ].filter(Boolean)),
  ];
}

export function todoAssigneeNames(value: unknown) {
  const output = recordOf(value);
  const names = todoStringList(output.assignees);
  if (names.length) return names;
  const legacy = text(output.assignee);
  return legacy ? [legacy] : [];
}

export function canonicalTodoOutputStatus(
  outputStatus: unknown,
  requestStatus?: unknown,
): CanonicalTodoOutputStatus {
  const status = text(outputStatus).toUpperCase();
  if (["APPROVED", "COMPLETED", "DONE"].includes(status)) return "APPROVED";
  if (["SUBMITTED", "PENDING_REVIEW"].includes(status)) return "WAITING_REVIEW";
  if (["CANCELLED", "CANCELED"].includes(status)) return "CANCELLED";
  if (status === "REJECTED") return "REJECTED";
  if (["OPEN", "IN_PROGRESS", "RETURNED", "WAITING_REVIEW"].includes(status)) {
    return status as CanonicalTodoOutputStatus;
  }

  const parent = text(requestStatus).toUpperCase();
  if (["APPROVED", "COMPLETED"].includes(parent)) return "APPROVED";
  if (["CANCELLED", "REJECTED"].includes(parent)) {
    return parent as "CANCELLED" | "REJECTED";
  }
  return "OPEN";
}

export function isTodoOutputClosed(status: unknown) {
  return ["APPROVED", "CANCELLED", "REJECTED"].includes(
    canonicalTodoOutputStatus(status),
  );
}

export function isTodoOutputOverdueForWeek(input: {
  dueAt: unknown;
  status: unknown;
  weekStart: string;
}) {
  const dueAt = text(input.dueAt).slice(0, 10);
  return Boolean(
    /^\d{4}-\d{2}-\d{2}$/.test(dueAt) &&
      dueAt < input.weekStart &&
      !isTodoOutputClosed(input.status),
  );
}
