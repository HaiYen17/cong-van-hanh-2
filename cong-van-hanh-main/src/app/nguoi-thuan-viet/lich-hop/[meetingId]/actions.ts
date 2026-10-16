"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";

export type MinutesActionInput = {
  assigneeEmployeeId?: string;
  description?: string;
  dueAt?: string;
  title: string;
};

export type SaveMinutesInput = {
  actionItems: MinutesActionInput[];
  decisions: string[];
  meetingId: string;
  openQuestions: string[];
  risks: string[];
  summary: string;
};

function text(value: unknown, max = 20_000) {
  return String(value || "").trim().slice(0, max);
}

function cleanList(values: string[], maxItems = 100) {
  return (values || []).map((value) => text(value, 2_000)).filter(Boolean).slice(0, maxItems);
}

function requestCode() {
  return `YC-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString("hex").toUpperCase()}`;
}

async function editableMeeting(meetingId: string) {
  const db = getDb();
  return db.meeting.findUnique({
    include: { minutes: true },
    where: { id: meetingId },
  }).then((meeting) => ({ meeting, db }));
}

function canApproveMeeting(
  session: Awaited<ReturnType<typeof requireCurrentSession>>,
  organizerId: string,
) {
  return (
    sessionOwnsUserId(session, organizerId) ||
    can(session, "meetings.minutes.approve") ||
    can(session, "meetings.manage")
  );
}

function refresh(meetingId: string) {
  revalidatePath(`/nguoi-thuan-viet/lich-hop/${meetingId}`);
  revalidatePath("/nguoi-thuan-viet/lich-hop");
  revalidatePath("/nguoi-thuan-viet/giao-viec");
}

export async function saveMeetingMinutesAction(input: SaveMinutesInput) {
  const session = await requireCurrentSession();
  const { db, meeting } = await editableMeeting(input.meetingId);
  if (!meeting?.minutes) return { error: "Chưa có bản nháp biên bản để chỉnh sửa." };
  if (!canApproveMeeting(session, meeting.organizerId)) {
    return { error: "Chỉ chủ cuộc họp hoặc người được phân quyền mới được sửa biên bản." };
  }
  if (meeting.minutes.status === "APPROVED") {
    return { error: "Biên bản đã duyệt. Không thể sửa âm thầm sau khi đã giao việc." };
  }
  const summary = text(input.summary, 30_000);
  if (summary.length < 5) return { error: "Phần tóm tắt biên bản đang quá ngắn." };
  const decisions = cleanList(input.decisions);
  const risks = cleanList(input.risks);
  const openQuestions = cleanList(input.openQuestions);
  const actions = (input.actionItems || [])
    .map((item) => ({
      assigneeEmployeeId: text(item.assigneeEmployeeId, 100) || null,
      description: text(item.description, 5_000) || null,
      dueAt: item.dueAt ? new Date(`${item.dueAt}T17:00:00+07:00`) : null,
      title: text(item.title, 500),
    }))
    .filter((item) => item.title)
    .slice(0, 100);
  const employeeIds = actions
    .map((action) => action.assigneeEmployeeId)
    .filter((id): id is string => Boolean(id));
  const employees = employeeIds.length
    ? await db.employee.findMany({
        include: { user: true },
        where: { id: { in: employeeIds }, status: "ACTIVE" },
      })
    : [];
  if (new Set(employeeIds).size !== new Set(employees.map((employee) => employee.id)).size) {
    return { error: "Có người phụ trách không còn hoạt động." };
  }
  const employeeMap = new Map(employees.map((employee) => [employee.id, employee]));
  const nextVersion = meeting.minutes.currentVersion + 1;
  const content = {
    actionItems: actions,
    decisions,
    openQuestions,
    risks,
    summary,
  };

  await db.$transaction(async (tx) => {
    await tx.meetingActionItem.deleteMany({
      where: { meetingId: meeting.id, status: "DRAFT" },
    });
    await tx.meetingMinutes.update({
      data: {
        content: content as Prisma.InputJsonValue,
        currentVersion: nextVersion,
        decisions,
        error: null,
        openQuestions,
        risks,
        status: "DRAFT",
        summary,
      },
      where: { id: meeting.minutes!.id },
    });
    await tx.meetingMinutesVersion.create({
      data: {
        content: content as Prisma.InputJsonValue,
        editedById: session.userId,
        minutesId: meeting.minutes!.id,
        source: "MANUAL",
        version: nextVersion,
      },
    });
    for (const [index, action] of actions.entries()) {
      const employee = action.assigneeEmployeeId
        ? employeeMap.get(action.assigneeEmployeeId)
        : undefined;
      await tx.meetingActionItem.create({
        data: {
          assigneeEmployeeId: employee?.id,
          assigneeNameSnapshot: employee?.fullName,
          assigneeUserId: employee?.user?.id,
          description: action.description,
          dueAt: action.dueAt,
          meetingId: meeting.id,
          minutesId: meeting.minutes!.id,
          sortOrder: index,
          title: action.title,
        },
      });
    }
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: { version: nextVersion },
        summary: `Chỉnh sửa biên bản ${meeting.code}`,
        targetId: meeting.minutes!.id,
        targetType: "MeetingMinutes",
      },
    });
  });
  refresh(meeting.id);
  return { success: `Đã lưu biên bản phiên bản ${nextVersion}.` };
}

export async function approveMeetingMinutesAction(meetingId: string) {
  const session = await requireCurrentSession();
  const db = getDb();
  const meeting = await db.meeting.findUnique({
    include: {
      actionItems: { include: { assigneeEmployee: { include: { user: true } } }, orderBy: { sortOrder: "asc" } },
      minutes: true,
    },
    where: { id: meetingId },
  });
  if (!meeting?.minutes) return { error: "Chưa có biên bản để duyệt." };
  if (!canApproveMeeting(session, meeting.organizerId)) {
    return { error: "Ông chưa có quyền duyệt biên bản cuộc họp này." };
  }
  if (meeting.minutes.status === "APPROVED") {
    return { success: "Biên bản đã được duyệt trước đó." };
  }
  if (!meeting.minutes.summary) return { error: "Biên bản chưa có phần tóm tắt." };
  const now = new Date();

  const result = await db.$transaction(async (tx) => {
    let todoRequestId: string | null = null;
    if (meeting.actionItems.length) {
      const outputs = meeting.actionItems.map((item) => ({
        assignee: item.assigneeEmployee?.fullName || item.assigneeNameSnapshot || "Chưa gán",
        assigneeEmployeeId: item.assigneeEmployeeId,
        assigneeUserId: item.assigneeUserId,
        description: item.description || item.title,
        dueAt: item.dueAt?.toISOString().slice(0, 10) || "",
        id: item.id,
        meetingActionItemId: item.id,
        status: "OPEN",
      }));
      const assignedUserIds = [...new Set(
        outputs
          .map((output) => output.assigneeUserId)
          .filter((userId): userId is string => Boolean(userId)),
      )];
      const request = await tx.request.create({
        data: {
          assignedToId: assignedUserIds.length === 1 ? assignedUserIds[0] : undefined,
          code: requestCode(),
          createdById: session.userId,
          note: `Sinh tự động từ biên bản đã duyệt của cuộc họp ${meeting.code}.`,
          payload: {
            assignmentKind: "planned",
            context: `Cuộc họp ${meeting.code}: ${meeting.title}`,
            outputs,
            projectName: `Cuộc họp · ${meeting.title}`,
            source: {
              meetingId: meeting.id,
              minutesId: meeting.minutes!.id,
              type: "meeting-minutes",
            },
          } as Prisma.InputJsonValue,
          serviceCode: "todo-assignment",
          status: "SUBMITTED",
          title: `Đầu việc sau họp: ${meeting.title}`,
        },
      });
      todoRequestId = request.id;
      await tx.requestEvent.create({
        data: {
          actorId: session.userId,
          note: `Tạo từ biên bản cuộc họp ${meeting.code}.`,
          requestId: request.id,
          toStatus: "SUBMITTED",
          type: "SUBMITTED",
        },
      });
      for (const item of meeting.actionItems) {
        await tx.meetingActionItem.update({
          data: {
            approvedAt: now,
            status: "SYNCED",
            todoOutputId: item.id,
            todoRequestId: request.id,
          },
          where: { id: item.id },
        });
      }
    }
    const nextVersion = meeting.minutes!.currentVersion + 1;
    await tx.meetingMinutes.update({
      data: {
        approvedAt: now,
        approvedById: session.userId,
        currentVersion: nextVersion,
        status: "APPROVED",
      },
      where: { id: meeting.minutes!.id },
    });
    await tx.meetingMinutesVersion.create({
      data: {
        content: meeting.minutes!.content as Prisma.InputJsonValue,
        editedById: session.userId,
        minutesId: meeting.minutes!.id,
        source: "APPROVAL",
        version: nextVersion,
      },
    });
    await tx.auditLog.create({
      data: {
        action: "UPDATE",
        actorId: session.userId,
        metadata: { todoRequestId },
        summary: `Duyệt biên bản ${meeting.code}`,
        targetId: meeting.minutes!.id,
        targetType: "MeetingMinutes",
      },
    });
    return { todoRequestId };
  });
  refresh(meeting.id);
  return {
    success: result.todoRequestId
      ? "Đã duyệt biên bản và giao toàn bộ đầu việc sang Module Giao việc."
      : "Đã duyệt biên bản; cuộc họp không có đầu việc cần giao.",
  };
}
