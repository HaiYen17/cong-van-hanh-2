"use server";

import { randomBytes } from "node:crypto";

import { revalidatePath } from "next/cache";

import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import {
  cancelGoogleCalendarMeeting,
  syncMeetingToGoogleCalendar,
} from "@/lib/meetings/google-calendar";
import { cancelRecallBot, scheduleRecallBot } from "@/lib/meetings/recall";
import {
  blockedRange,
  parseMeetingDateTime,
  validateMeetingWindow,
} from "@/lib/meetings/policy";

const PATH = "/nguoi-thuan-viet/lich-hop";
const ACTIVE_MEETING_STATUSES = ["SCHEDULED", "IN_PROGRESS"] as const;

export type MeetingConflict = {
  displayName: string;
  employeeId: string;
  endsAt: string;
  startsAt: string;
};

export type CreateMeetingInput = {
  agenda: string;
  aiEnabled: boolean;
  allowAttendeeConflict?: boolean;
  attendeeEmployeeIds: string[];
  endsAt: string;
  mode: "HYBRID" | "ONLINE" | "ONSITE";
  recallEnabled: boolean;
  roomId?: string;
  startsAt: string;
  title: string;
};

function meetingCode(now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  })
    .format(now)
    .replaceAll("-", "");
  return `HOP-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

function localTime(value: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: timezone,
  }).formatToParts(value);
  const hour = parts.find((part) => part.type === "hour")?.value || "00";
  const minute = parts.find((part) => part.type === "minute")?.value || "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

function refreshMeetingPaths(meetingId?: string) {
  revalidatePath(PATH);
  if (meetingId) revalidatePath(`${PATH}/${meetingId}`);
}

export async function createMeetingAction(
  input: CreateMeetingInput,
): Promise<{
  attendeeConflicts?: MeetingConflict[];
  error?: string;
  meetingId?: string;
  success?: string;
  warning?: string;
}> {
  const session = await requireCurrentSession();
  if (!can(session, "meetings.create")) {
    return { error: "Tài khoản chưa có quyền đặt lịch họp." };
  }

  const title = String(input.title || "").trim();
  const agenda = String(input.agenda || "").trim();
  const startsAt = parseMeetingDateTime(input.startsAt);
  const endsAt = parseMeetingDateTime(input.endsAt);
  const attendeeIds = [...new Set(input.attendeeEmployeeIds || [])].filter(Boolean);
  const mode = ["HYBRID", "ONLINE", "ONSITE"].includes(input.mode)
    ? input.mode
    : "HYBRID";

  if (title.length < 3 || title.length > 180) {
    return { error: "Tên cuộc họp cần từ 3 đến 180 ký tự." };
  }
  if (agenda.length < 5 || agenda.length > 10_000) {
    return { error: "Nội dung trao đổi cần từ 5 đến 10.000 ký tự." };
  }
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime())) {
    return { error: "Thời gian họp không hợp lệ." };
  }
  if (startsAt.getTime() < Date.now() - 5 * 60_000) {
    return { error: "Không thể đặt một cuộc họp đã bắt đầu trong quá khứ." };
  }
  if (mode !== "ONLINE" && !input.roomId) {
    return { error: "Chọn phòng cho cuộc họp trực tiếp hoặc kết hợp." };
  }

  const db = getDb();
  const [organizer, room, employees] = await Promise.all([
    db.user.findUnique({
      include: { employee: true },
      where: { id: session.userId },
    }),
    input.roomId
      ? db.meetingRoom.findUnique({ where: { id: input.roomId } })
      : Promise.resolve(null),
    attendeeIds.length
      ? db.employee.findMany({
          include: { user: true },
          where: { id: { in: attendeeIds }, status: "ACTIVE" },
        })
      : Promise.resolve([]),
  ]);

  if (!organizer) return { error: "Không tìm thấy tài khoản người đặt lịch." };
  if (input.roomId && (!room || room.status !== "ACTIVE")) {
    return { error: "Phòng họp không còn hoạt động. Hãy chọn phòng khác." };
  }
  if (employees.length !== attendeeIds.length) {
    return { error: "Có người tham gia không còn hoạt động hoặc không tồn tại." };
  }
  const missingEmail = employees.filter((employee) => !employee.email && !employee.user?.email);
  if (missingEmail.length) {
    return {
      error: `Chưa thể gửi lịch vì thiếu email: ${missingEmail.map((item) => item.fullName).join(", ")}.`,
    };
  }

  try {
    validateMeetingWindow({
      endsAt,
      maxBookingMinutes: room?.maxBookingMinutes || 480,
      startsAt,
    });
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Thời gian họp không hợp lệ." };
  }

  if (room) {
    const startLocal = localTime(startsAt, room.timezone);
    const endLocal = localTime(endsAt, room.timezone);
    if (startLocal < room.openTime || endLocal > room.closeTime) {
      return {
        error: `Phòng ${room.name} chỉ nhận lịch từ ${room.openTime} đến ${room.closeTime}.`,
      };
    }
    const participantCount = new Set([
      organizer.email.toLowerCase(),
      ...employees.map((employee) => (employee.email || employee.user?.email || "").toLowerCase()),
    ]).size;
    if (participantCount > room.capacity) {
      return {
        error: `Phòng ${room.name} chỉ có sức chứa ${room.capacity} người.`,
      };
    }
  }

  const blocked = blockedRange({
    bufferAfterMinutes: room?.bufferAfterMinutes || 0,
    bufferBeforeMinutes: room?.bufferBeforeMinutes || 0,
    endsAt,
    startsAt,
  });

  const roomConflict = room
    ? await db.meeting.findFirst({
        include: { room: true },
        orderBy: { startsAt: "asc" },
        where: {
          blockedEndsAt: { gt: blocked.startsAt },
          blockedStartsAt: { lt: blocked.endsAt },
          roomId: room.id,
          status: { in: [...ACTIVE_MEETING_STATUSES] },
        },
      })
    : null;
  if (roomConflict) {
    return {
      error: `Phòng ${room?.name || "đã chọn"} đã bị khóa trong khung giờ này (mã ${roomConflict.code}).`,
    };
  }

  const conflictEmployeeIds = [...attendeeIds];
  if (organizer.employeeId) conflictEmployeeIds.push(organizer.employeeId);
  const attendeeConflicts = conflictEmployeeIds.length
    ? await db.meetingAttendee.findMany({
        include: { employee: true, meeting: true },
        orderBy: { meeting: { startsAt: "asc" } },
        where: {
          employeeId: { in: [...new Set(conflictEmployeeIds)] },
          meeting: {
            endsAt: { gt: startsAt },
            startsAt: { lt: endsAt },
            status: { in: [...ACTIVE_MEETING_STATUSES] },
          },
        },
      })
    : [];

  const privateConflicts = attendeeConflicts.map((conflict) => ({
    displayName: conflict.employee?.fullName || conflict.displayName,
    employeeId: conflict.employeeId || "",
    endsAt: conflict.meeting.endsAt.toISOString(),
    startsAt: conflict.meeting.startsAt.toISOString(),
  }));
  if (privateConflicts.length && !input.allowAttendeeConflict) {
    return {
      attendeeConflicts: privateConflicts,
      warning:
        "Một số người đang bận trong khung giờ này. Nội dung lịch bận được giữ riêng tư; ông vẫn có thể xác nhận đặt đè.",
    };
  }

  const attendeeRows = new Map<
    string,
    {
      displayName: string;
      email: string;
      employeeId?: string;
      role: "ORGANIZER" | "REQUIRED";
      userId?: string;
    }
  >();
  attendeeRows.set(organizer.email.toLowerCase(), {
    displayName: organizer.displayName,
    email: organizer.email.toLowerCase(),
    employeeId: organizer.employeeId || undefined,
    role: "ORGANIZER",
    userId: organizer.id,
  });
  for (const employee of employees) {
    const email = (employee.email || employee.user?.email || "").toLowerCase();
    if (!email || attendeeRows.has(email)) continue;
    attendeeRows.set(email, {
      displayName: employee.fullName,
      email,
      employeeId: employee.id,
      role: "REQUIRED",
      userId: employee.user?.id,
    });
  }

  try {
    const meeting = await db.$transaction(async (tx) => {
      if (room) {
        const concurrentConflict = await tx.meeting.findFirst({
          where: {
            blockedEndsAt: { gt: blocked.startsAt },
            blockedStartsAt: { lt: blocked.endsAt },
            roomId: room.id,
            status: { in: [...ACTIVE_MEETING_STATUSES] },
          },
        });
        if (concurrentConflict) throw new Error("ROOM_CONFLICT");
      }

      const created = await tx.meeting.create({
        data: {
          agenda,
          aiEnabled: Boolean(input.aiEnabled),
          allowAttendeeConflict: Boolean(input.allowAttendeeConflict),
          attendees: { create: [...attendeeRows.values()] },
          blockedEndsAt: blocked.endsAt,
          blockedStartsAt: blocked.startsAt,
          code: meetingCode(),
          endsAt,
          locationText: room?.location || room?.name || (mode === "ONLINE" ? "Google Meet" : null),
          mode,
          organizerId: session.userId,
          recallEnabled: Boolean(input.recallEnabled && input.aiEnabled),
          roomId: room?.id,
          startsAt,
          timezone: room?.timezone || "Asia/Ho_Chi_Minh",
          title,
        },
      });
      await tx.auditLog.create({
        data: {
          action: "CREATE",
          actorId: session.userId,
          metadata: {
            attendeeCount: attendeeRows.size,
            endsAt: endsAt.toISOString(),
            roomId: room?.id || null,
            startsAt: startsAt.toISOString(),
          },
          summary: `Đặt lịch họp ${created.code}`,
          targetId: created.id,
          targetType: "Meeting",
        },
      });
      return created;
    });

    const calendarResult = await syncMeetingToGoogleCalendar(meeting.id);
    const recallResult = calendarResult.ok
      ? await scheduleRecallBot(meeting.id)
      : { error: "Chưa có Google Meet URL.", ok: false as const };
    refreshMeetingPaths(meeting.id);
    return {
      meetingId: meeting.id,
      success: calendarResult.ok && (!meeting.recallEnabled || recallResult.ok)
        ? `Đã giữ lịch ${meeting.code}${room ? `, khóa phòng ${room.name}` : ""}, gửi thư mời${meeting.recallEnabled ? " và lên lịch Recall" : ""}.`
        : calendarResult.ok
          ? `Đã giữ lịch ${meeting.code} và gửi thư mời. Recall chưa lên lịch; quản trị viên có thể thử lại.`
        : `Đã giữ lịch ${meeting.code}${room ? ` và khóa phòng ${room.name}` : ""}. Google Calendar chưa đồng bộ; có thể thử lại sau.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("ROOM_CONFLICT") || message.includes("Meeting_room_blocked_range_excl")) {
      return { error: "Phòng vừa được người khác đặt trong khung giờ này. Hãy chọn giờ hoặc phòng khác." };
    }
    return { error: `Chưa thể lưu lịch họp: ${message || "lỗi không xác định"}.` };
  }
}

export async function setMeetingInterestsAction(employeeIds: string[]) {
  const session = await requireCurrentSession();
  if (!can(session, "meetings.read")) return { error: "Tài khoản chưa có quyền xem lịch họp." };
  const uniqueIds = [...new Set(employeeIds || [])].filter(Boolean).slice(0, 20);
  const activeEmployees = uniqueIds.length
    ? await getDb().employee.findMany({
        select: { id: true },
        where: { id: { in: uniqueIds }, status: "ACTIVE" },
      })
    : [];
  const db = getDb();
  await db.$transaction([
    db.meetingInterest.deleteMany({ where: { observerUserId: session.userId } }),
    ...(activeEmployees.length
      ? [
          db.meetingInterest.createMany({
            data: activeEmployees.map((employee) => ({
              employeeId: employee.id,
              observerUserId: session.userId,
            })),
            skipDuplicates: true,
          }),
        ]
      : []),
  ]);
  refreshMeetingPaths();
  return { success: "Đã cập nhật danh sách lịch cần theo dõi." };
}

export async function cancelMeetingAction(input: { meetingId: string; reason: string }) {
  const session = await requireCurrentSession();
  const db = getDb();
  const meeting = await db.meeting.findUnique({ where: { id: input.meetingId } });
  if (!meeting) return { error: "Không tìm thấy cuộc họp." };
  if (!sessionOwnsUserId(session, meeting.organizerId) && !can(session, "meetings.manage")) {
    return { error: "Chỉ chủ cuộc họp hoặc quản trị viên mới được hủy lịch." };
  }
  if (meeting.status === "CANCELLED") return { success: "Cuộc họp đã được hủy trước đó." };
  const reason = String(input.reason || "").trim();
  await db.$transaction([
    db.meeting.update({
      data: {
        cancellationReason: reason || "Chủ cuộc họp hủy lịch",
        cancelledAt: new Date(),
        cancelledById: session.userId,
        status: "CANCELLED",
      },
      where: { id: meeting.id },
    }),
    db.auditLog.create({
      data: {
        action: "VOID",
        actorId: session.userId,
        metadata: { reason },
        summary: `Hủy lịch họp ${meeting.code}`,
        targetId: meeting.id,
        targetType: "Meeting",
      },
    }),
  ]);
  await Promise.all([
    cancelGoogleCalendarMeeting(meeting.id),
    cancelRecallBot(meeting.id),
  ]);
  refreshMeetingPaths(meeting.id);
  return { success: `Đã hủy lịch ${meeting.code}; phòng được giải phóng.` };
}

export async function retryMeetingIntegrationsAction(meetingId: string) {
  const session = await requireCurrentSession();
  const meeting = await getDb().meeting.findUnique({ where: { id: meetingId } });
  if (!meeting) return { error: "Không tìm thấy cuộc họp." };
  if (!sessionOwnsUserId(session, meeting.organizerId) && !can(session, "meetings.manage")) {
    return { error: "Chỉ chủ cuộc họp hoặc quản trị viên mới được thử lại tích hợp." };
  }
  if (meeting.status === "CANCELLED") {
    return { error: "Cuộc họp đã hủy nên không thể đồng bộ lại." };
  }
  const calendar = await syncMeetingToGoogleCalendar(meeting.id);
  if (!calendar.ok) {
    refreshMeetingPaths(meeting.id);
    return { error: `Google Calendar chưa đồng bộ: ${calendar.error}` };
  }
  const recall = await scheduleRecallBot(meeting.id);
  refreshMeetingPaths(meeting.id);
  if (meeting.recallEnabled && !recall.ok) {
    return { error: `Calendar đã sẵn sàng nhưng Recall chưa lên lịch: ${recall.error}` };
  }
  return {
    success: meeting.recallEnabled
      ? "Google Calendar, Google Meet và Recall đã sẵn sàng."
      : "Google Calendar và Google Meet đã sẵn sàng.",
  };
}
