"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import { canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import {
  bangkokDateKey,
  normalizeTodoRepeatSchedule,
} from "@/lib/todo/recurrence";
import {
  canonicalTodoOutputStatus,
  todoAssigneeEmployeeIds,
  todoAssigneeUserIds,
} from "@/lib/todo/output";

const PATH = "/nguoi-thuan-viet/giao-viec";

export type TodoActionState = {
  error?: string;
  success?: string;
};

type TodoFeedback = {
  actorId: string;
  actorName: string;
  createdAt: string;
  id: string;
  report: string;
  status: string;
};

type TodoOutput = {
  assignee?: string;
  assigneeEmployeeId?: string;
  assigneeEmployeeIds?: string[];
  assigneeUserId?: string;
  assigneeUserIds?: string[];
  assignees?: string[];
  description?: string;
  dueAt?: string;
  feedbacks?: TodoFeedback[];
  id?: string;
  status?: string;
};

type TodoPayload = {
  outputs?: TodoOutput[];
  [key: string]: unknown;
};

function payloadObject(value: unknown): TodoPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as TodoPayload;
}

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .trim();
}

async function actorTokens(userId: string, displayName: string) {
  const user = await getDb().user.findUnique({
    include: { employee: true },
    where: { id: userId },
  });
  return {
    employeeId: user?.employeeId || "",
    tokens: [
      displayName,
      user?.email,
      user?.username,
      user?.employee?.employeeCode,
      user?.employee?.fullName,
      user?.employee?.email,
      user?.employee?.phone,
    ]
      .map(normalize)
      .filter(Boolean),
    userId,
  };
}

function outputTargetsActor(
  output: TodoOutput,
  actor: Awaited<ReturnType<typeof actorTokens>>,
) {
  const assigneeUserIds = todoAssigneeUserIds(output);
  const assigneeEmployeeIds = todoAssigneeEmployeeIds(output);
  if (assigneeUserIds.length || assigneeEmployeeIds.length) {
    return (
      assigneeUserIds.includes(actor.userId) ||
      assigneeEmployeeIds.includes(actor.employeeId)
    );
  }
  const assignee = normalize(output.assignee);
  if (!assignee) return false;
  return actor.tokens.some((token) => assignee.includes(token) || token.includes(assignee));
}

function formText(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}

function requestCode() {
  const stamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `GV-${stamp}-${random}`;
}

function isConflict(error: unknown) {
  return error instanceof Error && error.message === "TODO_CONFLICT";
}

function refreshTodoViews() {
  revalidatePath(PATH);
  revalidatePath("/nguoi-thuan-viet/don-hang");
  revalidatePath("/");
}

export async function createTodoTaskAction(
  _state: TodoActionState,
  formData: FormData,
): Promise<TodoActionState> {
  const session = await requireCurrentSession();
  const canOpenTodo =
    session.fullAccess ||
    session.moduleGroups.includes("tien-ich") ||
    session.modules.includes("todo");
  const canCreate = canAny(session, [
    "my_requests.create",
    "admin_requests.create",
    "support_requests.create",
  ]);
  if (!canOpenTodo || !canCreate) {
    return { error: "Ông chưa có quyền giao việc." };
  }

  const title = formText(formData, "title");
  if (!title) return { error: "Nhập tên công việc cần giao." };
  if (title.length > 240) return { error: "Tên công việc tối đa 240 ký tự." };

  let rawPayload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(formText(formData, "payload"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      rawPayload = parsed as Record<string, unknown>;
    }
  } catch {
    return { error: "Dữ liệu giao việc không hợp lệ." };
  }

  const rawOutputs = Array.isArray(rawPayload.outputs)
    ? rawPayload.outputs.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item && typeof item === "object" && !Array.isArray(item)),
      )
    : [];
  if (!rawOutputs.length) {
    return { error: "Cần ít nhất một đầu việc có người thực hiện." };
  }
  if (rawOutputs.length > 50) {
    return { error: "Mỗi lần chỉ giao tối đa 50 đầu việc." };
  }

  const outputEmployeeIds = rawOutputs.map((output) => {
    const multiple = Array.isArray(output.assigneeEmployeeIds)
      ? output.assigneeEmployeeIds.map((value) => String(value || "").trim())
      : [];
    const legacy = String(output.assigneeEmployeeId || "").trim();
    return [...new Set([...multiple, legacy].filter(Boolean))];
  });
  if (outputEmployeeIds.some((employeeIds) => !employeeIds.length)) {
    return { error: "Mỗi đầu việc cần chọn ít nhất một người thực hiện." };
  }
  if (outputEmployeeIds.some((employeeIds) => employeeIds.length > 20)) {
    return { error: "Mỗi đầu việc chỉ được chọn tối đa 20 người thực hiện." };
  }
  const employeeIds = [...new Set(outputEmployeeIds.flat())];
  const db = getDb();
  const employees = await db.employee.findMany({
    include: { user: true },
    where: { id: { in: employeeIds }, status: "ACTIVE" },
  });
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  if (employeeMap.size !== employeeIds.length) {
    return { error: "Có người thực hiện không còn hoạt động hoặc không tồn tại." };
  }

  const outputs = rawOutputs.map((output, index) => {
    const description = String(output.description || "").trim();
    const selectedEmployees = outputEmployeeIds[index]
      .map((employeeId) => employeeMap.get(employeeId))
      .filter((employee): employee is NonNullable<typeof employee> => Boolean(employee));
    if (
      !description ||
      description.length > 1_200 ||
      selectedEmployees.length !== outputEmployeeIds[index].length
    ) {
      return null;
    }
    const dueAt = String(output.dueAt || "").trim();
    const assigneeEmployeeIds = selectedEmployees.map((employee) => employee.id);
    const assigneeUserIds = selectedEmployees
      .map((employee) => employee.user?.id || "")
      .filter(Boolean);
    const assignees = selectedEmployees.map((employee) => employee.fullName);
    return {
      assignee: assignees.join(" · "),
      assigneeEmployeeIds,
      assigneeUserIds,
      assignees,
      ...(selectedEmployees.length === 1
        ? {
            assigneeEmployeeId: selectedEmployees[0].id,
            ...(selectedEmployees[0].user?.id
              ? { assigneeUserId: selectedEmployees[0].user.id }
              : {}),
          }
        : {}),
      description,
      dueAt: /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? dueAt : "",
      feedbacks: [] as TodoFeedback[],
      id: randomUUID(),
      status: "OPEN",
    };
  });
  if (outputs.some((output) => !output)) {
    return { error: "Mỗi đầu việc cần có kết quả cụ thể và người thực hiện." };
  }
  const validOutputs = outputs.filter(
    (output): output is NonNullable<(typeof outputs)[number]> => Boolean(output),
  );

  const context = String(rawPayload.context || "").trim();
  const projectName = String(rawPayload.projectName || "").trim();
  if (context.length > 8_000) return { error: "Bối cảnh công việc quá dài." };
  if (projectName.length > 160) return { error: "Tên dự án tối đa 160 ký tự." };
  const assignmentKind = rawPayload.assignmentKind === "recurring" ? "recurring" : "planned";
  const rawRepeat = payloadObject(rawPayload.repeat);
  const repeat =
    assignmentKind === "recurring"
      ? normalizeTodoRepeatSchedule(rawRepeat, bangkokDateKey())
      : null;
  if (assignmentKind === "recurring" && !repeat) {
    return { error: "Lịch lặp lại không hợp lệ. Chọn lại chu kỳ và ngày bắt đầu." };
  }
  if (repeat?.endDate && repeat.endDate < repeat.startDate) {
    return { error: "Ngày kết thúc lịch lặp phải từ ngày bắt đầu trở đi." };
  }
  const assignedUserIds = [...new Set(
    validOutputs.flatMap((output) => output.assigneeUserIds),
  )];

  await db.$transaction(async (tx) => {
    const basePayload = {
      assignmentKind,
      context,
      outputs: validOutputs,
      projectName,
      repeat,
    };
    const created = await tx.request.create({
      data: {
        assignedToId: assignedUserIds.length === 1 ? assignedUserIds[0] : undefined,
        code: requestCode(),
        createdById: session.userId,
        note: context || undefined,
        payload: basePayload as Prisma.InputJsonValue,
        serviceCode: "todo-assignment",
        status: "SUBMITTED",
        title,
      },
    });
    if (repeat) {
      const anchorDate = repeat.startDate;
      await tx.request.update({
        data: {
          payload: {
            ...basePayload,
            recurrence: {
              anchorDate,
              isTemplate: true,
              occurrenceDate: anchorDate,
              occurrenceKey: `${created.id}:${anchorDate}`,
              templateId: created.id,
            },
          } as Prisma.InputJsonValue,
        },
        where: { id: created.id },
      });
    }
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        note: context || `Giao ${validOutputs.length} đầu việc.`,
        requestId: created.id,
        toStatus: "SUBMITTED",
        type: "SUBMITTED",
      },
    });
    await tx.auditLog.create({
      data: {
        action: "CREATE",
        actorId: session.userId,
        metadata: {
          assigneeEmployeeIds: employeeIds,
          outputCount: validOutputs.length,
          projectName: projectName || null,
          serviceCode: "todo-assignment",
        },
        summary: `Created todo assignment ${created.code}.`,
        targetId: created.id,
        targetType: "Request",
      },
    });
  });

  refreshTodoViews();
  return {
    success: `Đã giao ${validOutputs.length} đầu việc cho ${employeeIds.length} người phụ trách.`,
  };
}

export async function deleteTodoTaskAction(input: { taskId: string }) {
  const session = await requireCurrentSession();
  const identityUserIds = sessionUserIds(session);
  const taskId = String(input.taskId || "").trim();
  if (!taskId) return { error: "Không tìm thấy công việc cần xóa." };

  const db = getDb();
  const task = await db.request.findUnique({ where: { id: taskId } });
  if (!task || task.serviceCode !== "todo-assignment" || task.archivedAt) {
    return { error: "Không tìm thấy công việc cần xóa." };
  }
  if (!sessionOwnsUserId(session, task.createdById)) {
    return { error: "Chỉ người đã giao công việc mới được xóa công việc này." };
  }

  const payload = payloadObject(task.payload);
  const outputIds = Array.isArray(payload.outputs)
    ? payload.outputs
        .map((output) => String(output.id || "").trim())
        .filter(Boolean)
    : [];
  const recurrence = payloadObject(payload.recurrence);

  await db.$transaction(async (tx) => {
    await tx.auditLog.create({
      data: {
        action: "DELETE",
        actorId: session.userId,
        metadata: {
          code: task.code,
          hardDelete: true,
          occurrenceKey: String(recurrence.occurrenceKey || "") || null,
          outputCount: outputIds.length,
          serviceCode: "todo-assignment",
          templateId: String(recurrence.templateId || "") || null,
        },
        summary: `Permanently deleted todo assignment ${task.code}.`,
        targetId: task.id,
        targetType: "Request",
      },
    });

    if (outputIds.length) {
      await tx.workbenchItem.deleteMany({
        where: {
          sourceKey: "tasks",
          sourceRecordId: { in: outputIds },
        },
      });
    }

    const deleted = await tx.request.deleteMany({
      where: {
        createdById: { in: identityUserIds },
        id: task.id,
        serviceCode: "todo-assignment",
      },
    });
    if (deleted.count !== 1) throw new Error("TODO_DELETE_CONFLICT");
  });

  refreshTodoViews();
  return { success: "Đã xóa vĩnh viễn công việc và toàn bộ báo cáo liên quan." };
}

export async function stopTodoRecurrenceAction(input: { taskId: string }) {
  const session = await requireCurrentSession();
  const db = getDb();
  const selected = await db.request.findUnique({ where: { id: input.taskId } });
  if (!selected || selected.serviceCode !== "todo-assignment" || selected.archivedAt) {
    return { error: "Không tìm thấy công việc lặp lại." };
  }
  const selectedPayload = payloadObject(selected.payload);
  const selectedRecurrence = payloadObject(selectedPayload.recurrence);
  const templateId = String(selectedRecurrence.templateId || selected.id).trim();
  const template =
    templateId === selected.id
      ? selected
      : await db.request.findUnique({ where: { id: templateId } });
  if (!template || template.serviceCode !== "todo-assignment" || template.archivedAt) {
    return { error: "Không tìm thấy mẫu công việc lặp lại." };
  }
  if (!sessionOwnsUserId(session, template.createdById) && !session.fullAccess) {
    return { error: "Chỉ người giao việc mới được dừng lịch lặp lại." };
  }
  const payload = payloadObject(template.payload);
  const schedule = normalizeTodoRepeatSchedule(payload.repeat);
  if (!schedule || !schedule.enabled) {
    return { error: "Lịch lặp lại này đã dừng hoặc không còn hợp lệ." };
  }

  await db.$transaction(async (tx) => {
    await tx.request.update({
      data: {
        payload: {
          ...payload,
          repeat: { ...schedule, enabled: false },
        } as Prisma.InputJsonValue,
      },
      where: { id: template.id },
    });
    await tx.requestEvent.create({
      data: {
        actorId: session.userId,
        note: "Đã dừng sinh các kỳ công việc lặp lại tiếp theo.",
        requestId: template.id,
        toStatus: template.status,
        type: "COMMENT",
      },
    });
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: { serviceCode: "todo-assignment", stoppedRecurrence: true },
        summary: `Stopped recurring todo ${template.code}.`,
        targetId: template.id,
        targetType: "Request",
      },
    });
  });

  refreshTodoViews();
  return { success: "Đã dừng lịch lặp. Các kỳ đã tạo vẫn được giữ nguyên." };
}

export async function submitTodoFeedbackAction(input: {
  outputId: string;
  report: string;
  taskId: string;
}) {
  const session = await requireCurrentSession();
  const report = String(input.report || "").trim();
  if (!report) return { error: "Nhập nội dung báo cáo kết quả." };
  if (report.length > 8_000) return { error: "Nội dung báo cáo quá dài." };

  const db = getDb();
  const [task, actor] = await Promise.all([
    db.request.findUnique({ where: { id: input.taskId } }),
    actorTokens(session.userId, session.displayName),
  ]);
  if (!task || task.serviceCode !== "todo-assignment" || task.archivedAt) {
    return { error: "Không tìm thấy công việc." };
  }
  const payload = payloadObject(task.payload);
  const outputs = Array.isArray(payload.outputs) ? [...payload.outputs] : [];
  const index = outputs.findIndex((output) => output.id === input.outputId);
  if (index < 0) return { error: "Không tìm thấy đầu việc." };
  if (!outputTargetsActor(outputs[index], actor)) {
    return { error: "Chỉ người được giao mới có thể gửi kết quả đầu việc này." };
  }
  const currentStatus = canonicalTodoOutputStatus(
    outputs[index].status,
    task.status,
  );
  if (!["OPEN", "IN_PROGRESS", "RETURNED"].includes(currentStatus)) {
    return { error: "Đầu việc này không ở bước cho phép gửi kết quả." };
  }

  const feedback: TodoFeedback = {
    actorId: session.userId,
    actorName: session.displayName,
    createdAt: new Date().toISOString(),
    id: randomUUID(),
    report,
    status: "SUBMITTED",
  };
  outputs[index] = {
    ...outputs[index],
    feedbacks: [...(outputs[index].feedbacks || []), feedback],
    status: "WAITING_REVIEW",
  };

  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({
        data: {
          completedAt: null,
          payload: { ...payload, outputs } as Prisma.InputJsonValue,
          status: "IN_PROGRESS",
        },
        where: { id: task.id, updatedAt: task.updatedAt },
      });
      if (updated.count !== 1) throw new Error("TODO_CONFLICT");
      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          note: `Báo cáo đầu việc: ${report}`,
          requestId: task.id,
          toStatus: "IN_PROGRESS",
          type: "COMMENT",
        },
      });
    });
  } catch (error) {
    if (isConflict(error)) {
      return { error: "Công việc vừa được người khác cập nhật. Tải lại rồi thử lại." };
    }
    throw error;
  }
  refreshTodoViews();
  return { success: "Đã gửi kết quả để người giao việc duyệt." };
}

export async function reviewTodoOutputAction(input: {
  comment?: string;
  decision: "approve" | "return";
  outputId: string;
  taskId: string;
}) {
  const session = await requireCurrentSession();
  const db = getDb();
  const task = await db.request.findUnique({ where: { id: input.taskId } });
  if (!task || task.serviceCode !== "todo-assignment" || task.archivedAt) {
    return { error: "Không tìm thấy công việc." };
  }
  if (!sessionOwnsUserId(session, task.createdById) && !session.fullAccess) {
    return { error: "Chỉ người giao việc mới được duyệt kết quả." };
  }
  const payload = payloadObject(task.payload);
  const outputs = Array.isArray(payload.outputs) ? [...payload.outputs] : [];
  const index = outputs.findIndex((output) => output.id === input.outputId);
  if (index < 0) return { error: "Không tìm thấy đầu việc." };
  if (
    canonicalTodoOutputStatus(outputs[index].status, task.status) !==
    "WAITING_REVIEW"
  ) {
    return { error: "Chỉ duyệt đầu việc đang ở bước chờ duyệt." };
  }

  const reviewComment = String(input.comment || "").trim();
  const nextStatus = input.decision === "approve" ? "APPROVED" : "RETURNED";
  outputs[index] = {
    ...outputs[index],
    feedbacks:
      input.decision === "return"
        ? [
            ...(outputs[index].feedbacks || []),
            {
              actorId: session.userId,
              actorName: session.displayName,
              createdAt: new Date().toISOString(),
              id: randomUUID(),
              report: reviewComment || "Kết quả cần được bổ sung trước khi duyệt.",
              status: "RETURNED",
            },
          ]
        : outputs[index].feedbacks,
    status: nextStatus,
  };
  const completed =
    outputs.length > 0 &&
    outputs.every(
      (output) =>
        canonicalTodoOutputStatus(output.status, task.status) === "APPROVED",
    );

  try {
    await db.$transaction(async (tx) => {
      const updated = await tx.request.updateMany({
        data: {
          completedAt: completed ? new Date() : null,
          payload: { ...payload, outputs } as Prisma.InputJsonValue,
          status: completed ? "COMPLETED" : "IN_PROGRESS",
        },
        where: { id: task.id, updatedAt: task.updatedAt },
      });
      if (updated.count !== 1) throw new Error("TODO_CONFLICT");
      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          note:
            reviewComment ||
            (input.decision === "approve"
              ? "Đã duyệt kết quả đầu việc."
              : "Đã trả kết quả để bổ sung."),
          requestId: task.id,
          toStatus: completed ? "COMPLETED" : "IN_PROGRESS",
          type: completed ? "COMPLETED" : "COMMENT",
        },
      });
    });
  } catch (error) {
    if (isConflict(error)) {
      return { error: "Công việc vừa được người khác cập nhật. Tải lại rồi thử lại." };
    }
    throw error;
  }
  refreshTodoViews();
  return {
    success:
      input.decision === "approve"
        ? "Đã duyệt kết quả đầu việc."
        : "Đã trả kết quả để người thực hiện bổ sung.",
  };
}
