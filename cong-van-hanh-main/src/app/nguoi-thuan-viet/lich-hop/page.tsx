import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  sessionEmployeeIds,
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { weekBounds } from "@/lib/meetings/policy";

import { MeetingBookingWorkspace } from "./meeting-booking-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Lịch họp & Đặt phòng | Cổng vận hành",
};

function dateKey(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
  }).format(value);
}

function safeAnchor(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
  const parsed = new Date(`${value}T12:00:00+07:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date();
}

export default async function MeetingsPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const session = await requireCurrentSession();
  const identityEmployeeIds = sessionEmployeeIds(session);
  const identityUserIds = sessionUserIds(session);
  const canRead = canAny(session, ["meetings.read", "meetings.manage"]);
  const canCreate = can(session, "meetings.create");
  const canManage = can(session, "meetings.manage");
  if (!canRead) {
    return (
      <AppShell activePath="/nguoi-thuan-viet/lich-hop" moduleKey="meetings" session={session}>
        <Panel title="Không có quyền xem lịch họp">
          <p className="text-sm leading-6 text-muted">
            Tài khoản hiện tại chưa được cấp quyền mở Lịch họp & Đặt phòng.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const params = await searchParams;
  const week = weekBounds(safeAnchor(params.week));
  const db = getDb();
  const [actor, rooms, employees, interests] = await Promise.all([
    db.user.findUnique({ include: { employee: true }, where: { id: session.userId } }),
    db.meetingRoom.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.employee.findMany({
      include: { company: true, user: true },
      orderBy: [{ fullName: "asc" }],
      where: { status: "ACTIVE" },
    }),
    db.meetingInterest.findMany({
      include: { employee: true },
      orderBy: { employee: { fullName: "asc" } },
      where: { observerUserId: session.userId },
    }),
  ]);

  const trackedEmployeeIds = [...new Set([
    ...identityEmployeeIds,
    ...interests.map((interest) => interest.employeeId),
  ])];
  const [trackedAttendances, ownMeetings, roomBookings] = await Promise.all([
    trackedEmployeeIds.length
      ? db.meetingAttendee.findMany({
          include: {
            employee: true,
            meeting: { include: { room: true } },
          },
          orderBy: { meeting: { startsAt: "asc" } },
          where: {
            employeeId: { in: trackedEmployeeIds },
            meeting: {
              endsAt: { gt: week.startsAt },
              startsAt: { lt: week.endsAt },
              status: { in: ["SCHEDULED", "IN_PROGRESS"] },
            },
          },
        })
      : Promise.resolve([]),
    db.meeting.findMany({
      include: { attendees: true, room: true },
      orderBy: { startsAt: "asc" },
      where: {
        endsAt: { gt: week.startsAt },
        startsAt: { lt: week.endsAt },
        status: { not: "CANCELLED" },
        OR: [
          { organizerId: { in: identityUserIds } },
          { attendees: { some: { userId: { in: identityUserIds } } } },
          ...(identityEmployeeIds.length
            ? [{ attendees: { some: { employeeId: { in: identityEmployeeIds } } } }]
            : []),
        ],
      },
    }),
    db.meeting.findMany({
      select: { endsAt: true, id: true, roomId: true, startsAt: true },
      where: {
        endsAt: { gt: week.startsAt },
        roomId: { not: null },
        startsAt: { lt: week.endsAt },
        status: { in: ["SCHEDULED", "IN_PROGRESS"] },
      },
    }),
  ]);

  const trackedLabels = new Map(
    employees.map((employee) => [employee.id, employee.fullName]),
  );
  const busyBlocks = trackedAttendances.map((attendance) => {
    const canSeeDetails =
      sessionOwnsUserId(session, attendance.meeting.organizerId) ||
      identityEmployeeIds.includes(attendance.employeeId || "") ||
      canManage;
    return {
      dateKey: dateKey(attendance.meeting.startsAt),
      endsAt: attendance.meeting.endsAt.toISOString(),
      id: `${attendance.meetingId}-${attendance.employeeId}`,
      meetingId: canSeeDetails ? attendance.meetingId : "",
      ownerEmployeeId: attendance.employeeId || "",
      ownerLabel:
        attendance.employee?.fullName ||
        trackedLabels.get(attendance.employeeId || "") ||
        attendance.displayName,
      roomLabel: canSeeDetails ? attendance.meeting.room?.name || "Google Meet" : "",
      startsAt: attendance.meeting.startsAt.toISOString(),
      title: canSeeDetails ? attendance.meeting.title : "Bận",
    };
  });

  return (
    <AppShell activePath="/nguoi-thuan-viet/lich-hop" moduleKey="meetings" session={session}>
      <MeetingBookingWorkspace
        busyBlocks={busyBlocks}
        canCreate={canCreate}
        employees={employees.map((employee) => ({
          email: employee.email || employee.user?.email || "",
          id: employee.id,
          label: employee.fullName,
          sub: [
            employee.employeeCode,
            employee.department,
            employee.company?.shortName || employee.company?.legalName,
            employee.email || employee.user?.email || "Chưa có email",
          ]
            .filter(Boolean)
            .join(" · "),
        }))}
        interestEmployeeIds={interests.map((interest) => interest.employeeId)}
        ownMeetings={ownMeetings.map((meeting) => ({
          attendeeCount: meeting.attendees.length,
          calendarSyncStatus: meeting.calendarSyncStatus,
          code: meeting.code,
          endsAt: meeting.endsAt.toISOString(),
          googleMeetUrl: meeting.googleMeetUrl || "",
          id: meeting.id,
          roomLabel: meeting.room?.name || (meeting.mode === "ONLINE" ? "Google Meet" : ""),
          startsAt: meeting.startsAt.toISOString(),
          status: meeting.status,
          title: meeting.title,
        }))}
        roomBusy={roomBookings.map((meeting) => ({
          endsAt: meeting.endsAt.toISOString(),
          id: meeting.id,
          roomId: meeting.roomId || "",
          startsAt: meeting.startsAt.toISOString(),
        }))}
        rooms={rooms.map((room) => ({
          bufferAfterMinutes: room.bufferAfterMinutes,
          bufferBeforeMinutes: room.bufferBeforeMinutes,
          capacity: room.capacity,
          closeTime: room.closeTime,
          color: room.color,
          id: room.id,
          label: room.name,
          location: room.location || "",
          maxBookingMinutes: room.maxBookingMinutes,
          openTime: room.openTime,
        }))}
        weekEndsAt={week.endsAt.toISOString()}
        weekStartsAt={week.startsAt.toISOString()}
      />
    </AppShell>
  );
}
