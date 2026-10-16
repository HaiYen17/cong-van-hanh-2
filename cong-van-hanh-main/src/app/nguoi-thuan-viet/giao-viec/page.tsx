import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  sessionEmployeeIds,
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { requestStatusMeta } from "@/lib/requests/services";
import {
  formatTodoRepeatSchedule,
  normalizeTodoRepeatSchedule,
} from "@/lib/todo/recurrence";
import { materializeTodoRecurrences } from "@/lib/todo/recurrence-runtime";
import {
  canonicalTodoOutputStatus,
  todoAssigneeEmployeeIds,
  todoAssigneeNames,
  todoAssigneeUserIds,
} from "@/lib/todo/output";

import { TodoWorkspace } from "./todo-workspace";
import styles from "./todo.module.css";

export const metadata: Metadata = {
  title: "Giao việc | Cổng vận hành",
};

type OutputPayload = {
  assignee?: string;
  assigneeEmployeeId?: string;
  assigneeEmployeeIds?: string[];
  assigneeUserId?: string;
  assigneeUserIds?: string[];
  assignees?: string[];
  description?: string;
  dueAt?: string;
  feedbacks?: {
    actorName?: string;
    createdAt?: string;
    id?: string;
    report?: string;
    status?: string;
  }[];
  id?: string;
  status?: string;
};

function payloadObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function text(value: unknown) {
  return String(value || "").trim();
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

export default async function TodoPage() {
  const session = await requireCurrentSession();
  const identityEmployeeIds = sessionEmployeeIds(session);
  const identityUserIds = sessionUserIds(session);
  const canOpen =
    session.fullAccess ||
    session.moduleGroups.includes("tien-ich") ||
    session.modules.includes("todo");
  if (!canOpen) {
    return (
      <AppShell activePath="/" moduleKey="todo" session={session}>
        <Panel title="Không có quyền truy cập">
          <p className="text-sm text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở Giao việc.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const db = getDb();
  try {
    await materializeTodoRecurrences();
  } catch (error) {
    console.error("Unable to materialize recurring todos while opening the board.", error);
  }
  const [employees, actors, rows] = await Promise.all([
    db.employee.findMany({
      include: { company: true, user: { select: { id: true } } },
      orderBy: [{ fullName: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.user.findMany({
      include: { employee: true },
      where: { id: { in: identityUserIds } },
    }),
    db.request.findMany({
      orderBy: [{ updatedAt: "desc" }],
      where: {
        archivedAt: null,
        serviceCode: "todo-assignment",
      },
    }),
  ]);
  const actorTokens = [
    session.displayName,
    ...actors.flatMap((actor) => [
      actor.email,
      actor.username,
      actor.employee?.employeeCode,
      actor.employee?.fullName,
      actor.employee?.email,
      actor.employee?.phone,
    ]),
  ]
    .map(normalize)
    .filter(Boolean);

  const recurrenceEnabledByTemplate = new Map<string, boolean>();
  for (const row of rows) {
    const payload = payloadObject(row.payload);
    const recurrence = payloadObject(payload.recurrence);
    if (recurrence.isTemplate === true || text(payload.assignmentKind) === "recurring") {
      const templateId = text(recurrence.templateId) || row.id;
      if (recurrence.isTemplate === true || !recurrenceEnabledByTemplate.has(templateId)) {
        recurrenceEnabledByTemplate.set(
          templateId,
          Boolean(normalizeTodoRepeatSchedule(payload.repeat)?.enabled),
        );
      }
    }
  }

  const tasks = rows
    .map((row) => {
      const payload = payloadObject(row.payload);
      const source = payloadObject(payload.source);
      const outputs = Array.isArray(payload.outputs)
        ? (payload.outputs as OutputPayload[])
        : [];
      const createdByMe = sessionOwnsUserId(session, row.createdById);
      const mappedOutputs = outputs.map((output, index) => {
        const assigneeEmployeeIds = todoAssigneeEmployeeIds(output);
        const assigneeUserIds = todoAssigneeUserIds(output);
        const assignees = todoAssigneeNames(output);
        let assignedToMe = false;
        if (assigneeUserIds.length || assigneeEmployeeIds.length) {
          assignedToMe =
            assigneeUserIds.some((userId) => identityUserIds.includes(userId)) ||
            assigneeEmployeeIds.some((employeeId) =>
              identityEmployeeIds.includes(employeeId),
            );
        } else {
          const assignee = normalize(output.assignee);
          assignedToMe = Boolean(
            assignee &&
              actorTokens.some(
                (token) => assignee.includes(token) || token.includes(assignee),
              ),
          );
        }
        return {
          assignedToMe,
          assignee: assignees.join(" · ") || text(output.assignee),
          assigneeEmployeeIds,
          assigneeUserIds,
          assignees,
          description: text(output.description) || `Đầu việc ${index + 1}`,
          dueAt: text(output.dueAt).slice(0, 10),
          feedbacks: (output.feedbacks || []).map((feedback) => ({
            actorName: text(feedback.actorName),
            createdAt: text(feedback.createdAt),
            id: text(feedback.id) || `${row.id}-${index}`,
            report: text(feedback.report),
            status: text(feedback.status),
          })),
          id: text(output.id) || `${row.id}-${index}`,
          status: canonicalTodoOutputStatus(output.status, row.status),
        };
      });
      const actionableOutputs = mappedOutputs.filter(
        (output) => !["CANCELLED", "REJECTED"].includes(output.status),
      );
      if (
        !createdByMe &&
        !actionableOutputs.some((output) => output.assignedToMe) &&
        !session.fullAccess
      ) {
        return null;
      }
      const visibleOutputs =
        createdByMe || session.fullAccess
          ? actionableOutputs
          : actionableOutputs.filter((output) => output.assignedToMe);
      if (!visibleOutputs.length) return null;
      const hasUnfinishedOutput = actionableOutputs.some(
        (output) => output.status !== "APPROVED",
      );
      const effectiveRequestStatus: keyof typeof requestStatusMeta =
        hasUnfinishedOutput &&
        ["APPROVED", "COMPLETED", "CANCELLED", "REJECTED"].includes(row.status)
          ? "IN_PROGRESS"
          : row.status;
      const repeat = normalizeTodoRepeatSchedule(payload.repeat);
      const recurrence = payloadObject(payload.recurrence);
      const recurrenceTemplateId = text(recurrence.templateId) || row.id;
      return {
        code: row.code,
        canReview: createdByMe || session.fullAccess,
        context: text(payload.context),
        createdAt: row.createdAt.toISOString(),
        createdByMe,
        id: row.id,
        kind: text(payload.assignmentKind) || "planned",
        outputs: visibleOutputs,
        projectName:
          text(payload.projectName) ||
          (text(source.type) === "meeting-minutes" ? "Đầu việc sau họp" : "Không thuộc dự án"),
        recurrenceTemplateId,
        repeatEnabled:
          recurrenceEnabledByTemplate.get(recurrenceTemplateId) ??
          Boolean(repeat?.enabled),
        repeatLabel: formatTodoRepeatSchedule(repeat),
        status: effectiveRequestStatus,
        statusLabel: requestStatusMeta[effectiveRequestStatus].label,
        title: row.title,
      };
    })
    .filter((task): task is NonNullable<typeof task> => Boolean(task));

  return (
    <AppShell activePath="/" moduleKey="todo" session={session}>
      <div className={styles.page}>
        <TodoWorkspace
          employees={employees.map((employee) => ({
            department: employee.department || "",
            fullName: employee.fullName,
            id: employee.id,
            label: [
              employee.fullName,
              employee.employeeCode,
              employee.department,
              employee.company?.shortName || employee.company?.legalName,
            ]
              .filter(Boolean)
              .join(" · "),
            userId: employee.user?.id || "",
          }))}
          tasks={tasks}
        />
      </div>
    </AppShell>
  );
}
