import { ArrowLeft, Bot, CalendarClock, DoorOpen, Headphones, ListChecks, Sparkles, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { AppShell } from "@/components/layout/app-shell";
import { Badge, LinkButton, Panel } from "@/components/ui";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import {
  sessionEmployeeIds,
  sessionOwnsUserId,
  sessionUserIds,
} from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";

import { MeetingDetailActions } from "./meeting-detail-actions";
import { MeetingMinutesEditor } from "./meeting-minutes-editor";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Chi tiết cuộc họp | Cổng vận hành",
};

const TIMEZONE = "Asia/Ho_Chi_Minh";

function dateTime(value: Date) {
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: TIMEZONE,
  }).format(value);
}

function statusTone(status: string) {
  if (["COMPLETED", "APPROVED", "SYNCED", "READY"].includes(status)) return "success" as const;
  if (["FAILED", "CANCELLED"].includes(status)) return "danger" as const;
  if (["PROCESSING", "IN_PROGRESS", "WAITING_ROOM"].includes(status)) return "warning" as const;
  return "info" as const;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

export default async function MeetingDetailPage({ params }: { params: Promise<{ meetingId: string }> }) {
  const session = await requireCurrentSession();
  const identityEmployeeIds = sessionEmployeeIds(session);
  const identityUserIds = sessionUserIds(session);
  const { meetingId } = await params;
  const db = getDb();
  const meeting = await db.meeting.findUnique({
    include: {
      actionItems: { include: { assigneeEmployee: true }, orderBy: { sortOrder: "asc" } },
      attendees: { orderBy: [{ role: "asc" }, { displayName: "asc" }] },
      botRuns: { orderBy: { createdAt: "desc" }, take: 1 },
      minutes: true,
      organizer: { include: { employee: true } },
      room: true,
      transcript: true,
    },
    where: { id: meetingId },
  });

  const actors = await db.user.findMany({
    select: { employeeId: true, email: true },
    where: { id: { in: identityUserIds } },
  });
  const actorEmails = actors.map((actor) => actor.email.toLowerCase());
  const participant = Boolean(
    meeting &&
      (sessionOwnsUserId(session, meeting.organizerId) ||
        meeting.attendees.some(
          (attendee) =>
            Boolean(attendee.userId && identityUserIds.includes(attendee.userId)) ||
            actorEmails.includes(attendee.email.toLowerCase()) ||
            Boolean(
              attendee.employeeId &&
                identityEmployeeIds.includes(attendee.employeeId),
            ),
        )),
  );
  const canManage = can(session, "meetings.manage");

  if (!meeting || (!participant && !canManage)) {
    return (
      <AppShell activePath="/nguoi-thuan-viet/lich-hop" session={session}>
        <Panel title="Không thể mở cuộc họp">
          <p className="text-sm leading-6 text-muted">Cuộc họp không tồn tại hoặc ông không nằm trong danh sách được xem nội dung.</p>
          <Link className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-accent-strong" href="/nguoi-thuan-viet/lich-hop">
            <ArrowLeft className="size-4" /> Quay lại lịch tuần
          </Link>
        </Panel>
      </AppShell>
    );
  }

  const botRun = meeting.botRuns[0];
  const canCancel =
    meeting.status !== "CANCELLED" &&
    meeting.status !== "COMPLETED" &&
    (sessionOwnsUserId(session, meeting.organizerId) || canManage);
  const canApproveMinutes =
    sessionOwnsUserId(session, meeting.organizerId) ||
    can(session, "meetings.minutes.approve") ||
    canManage;

  return (
    <AppShell activePath="/nguoi-thuan-viet/lich-hop" session={session}>
      <Link className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-primary hover:text-accent-strong" href="/nguoi-thuan-viet/lich-hop">
        <ArrowLeft className="size-4" /> Lịch họp trong tuần
      </Link>
      <section className="mb-5 rounded-3xl border border-border bg-surface p-6 shadow-[0_18px_44px_rgba(17,45,39,0.08)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex flex-wrap gap-2">
              <Badge tone={statusTone(meeting.status)}>{meeting.status}</Badge>
              <Badge tone="neutral">{meeting.code}</Badge>
            </div>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-primary">{meeting.title}</h1>
            <p className="mt-2 text-sm text-muted">Chủ cuộc họp: {meeting.organizer.employee?.fullName || meeting.organizer.displayName}</p>
          </div>
          <MeetingDetailActions
            canCancel={canCancel}
            canRetry={meeting.status !== "CANCELLED" && (sessionOwnsUserId(session, meeting.organizerId) || canManage)}
            googleMeetUrl={meeting.googleMeetUrl || ""}
            meetingId={meeting.id}
          />
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <div className="rounded-2xl bg-surface-muted p-4">
            <CalendarClock className="size-5 text-accent" />
            <div className="mt-2 text-sm font-bold text-primary">{dateTime(meeting.startsAt)}</div>
            <div className="text-xs text-muted">đến {dateTime(meeting.endsAt)}</div>
          </div>
          <div className="rounded-2xl bg-surface-muted p-4">
            <DoorOpen className="size-5 text-accent" />
            <div className="mt-2 text-sm font-bold text-primary">{meeting.room?.name || "Không dùng phòng"}</div>
            <div className="text-xs text-muted">{meeting.locationText || meeting.room?.location || "Google Meet"}</div>
          </div>
          <div className="rounded-2xl bg-surface-muted p-4">
            <Users className="size-5 text-accent" />
            <div className="mt-2 text-sm font-bold text-primary">{meeting.attendees.length} người tham gia</div>
            <div className="text-xs text-muted">Calendar: {meeting.calendarSyncStatus}</div>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <div className="space-y-5">
          <Panel title="Nội dung cần trao đổi">
            <p className="whitespace-pre-wrap text-sm leading-7 text-foreground">{meeting.agenda}</p>
          </Panel>
          <Panel
            actions={<Badge tone={statusTone(meeting.minutes?.status || "PENDING")}>{meeting.minutes?.status || "PENDING"}</Badge>}
            title="Biên bản cuộc họp"
          >
            {meeting.minutes?.summary && meeting.minutes.status === "DRAFT" && canApproveMinutes ? (
              <MeetingMinutesEditor
                actionItems={meeting.actionItems.map((item) => ({
                  assigneeEmployeeId: item.assigneeEmployeeId || "",
                  description: item.description || "",
                  dueAt: item.dueAt?.toISOString().slice(0, 10) || "",
                  title: item.title,
                }))}
                decisions={stringList(meeting.minutes.decisions)}
                employees={meeting.attendees
                  .filter((attendee) => attendee.employeeId)
                  .map((attendee) => ({
                    id: attendee.employeeId || "",
                    label: attendee.displayName,
                  }))
                  .filter(
                    (employee, index, rows) =>
                      rows.findIndex((row) => row.id === employee.id) === index,
                  )}
                meetingId={meeting.id}
                openQuestions={stringList(meeting.minutes.openQuestions)}
                risks={stringList(meeting.minutes.risks)}
                summary={meeting.minutes.summary}
              />
            ) : meeting.minutes?.summary ? (
              <div className="space-y-4">
                <p className="whitespace-pre-wrap text-sm leading-7">{meeting.minutes.summary}</p>
                <p className="text-xs text-muted">Biên bản đang ở phiên bản {meeting.minutes.currentVersion}. Chủ cuộc họp sẽ duyệt trước khi giao việc.</p>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-7 text-center">
                <Sparkles className="mx-auto size-7 text-accent" />
                <p className="mt-2 text-sm font-bold text-primary">Biên bản sẽ xuất hiện sau cuộc họp</p>
                <p className="mt-1 text-xs leading-5 text-muted">Recall gửi transcript, sau đó Gemini tạo bản nháp để chủ cuộc họp sửa và duyệt.</p>
              </div>
            )}
          </Panel>
          <Panel title="Đầu việc sau cuộc họp">
            {meeting.actionItems.length ? (
              <div className="space-y-2">
                {meeting.actionItems.map((item) => (
                  <div className="rounded-2xl border border-border p-4" key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-bold text-primary">{item.title}</div>
                        {item.description ? <p className="mt-1 text-sm text-muted">{item.description}</p> : null}
                      </div>
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                    </div>
                    <div className="mt-2 text-xs text-muted">Phụ trách: {item.assigneeEmployee?.fullName || item.assigneeNameSnapshot || "Chưa gán"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-2xl bg-surface-muted p-4 text-sm text-muted">
                <ListChecks className="size-5 text-accent" /> Chưa có đầu việc; Gemini sẽ đề xuất từ transcript.
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <Panel title="Người tham gia">
            <div className="space-y-2">
              {meeting.attendees.map((attendee) => (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2" key={attendee.id}>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-primary">{attendee.displayName}</div>
                    <div className="truncate text-xs text-muted">{attendee.email}</div>
                  </div>
                  <Badge tone={attendee.role === "ORGANIZER" ? "info" : "neutral"}>{attendee.role}</Badge>
                </div>
              ))}
            </div>
          </Panel>
          <Panel title="Google Calendar & Recall">
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-3"><span className="text-muted">Calendar</span><Badge tone={statusTone(meeting.calendarSyncStatus)}>{meeting.calendarSyncStatus}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span className="text-muted">Google Meet</span><Badge tone={meeting.googleMeetUrl ? "success" : "neutral"}>{meeting.googleMeetUrl ? "READY" : "PENDING"}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-muted"><Bot className="size-4" /> Recall</span><Badge tone={statusTone(botRun?.status || (meeting.recallEnabled ? "PENDING" : "OFF"))}>{botRun?.status || (meeting.recallEnabled ? "PENDING" : "OFF")}</Badge></div>
              <div className="flex items-center justify-between gap-3"><span className="text-muted">Transcript</span><Badge tone={statusTone(meeting.transcript?.status || "PENDING")}>{meeting.transcript?.status || "PENDING"}</Badge></div>
            </div>
            {botRun?.recordingStatus === "DONE" &&
            (sessionOwnsUserId(session, meeting.organizerId) || canManage) ? (
              <div className="mt-4 border-t border-border pt-4">
                <LinkButton
                  href={`/api/meetings/${meeting.id}/recording`}
                  rel="noreferrer"
                  size="sm"
                  target="_blank"
                  variant="secondary"
                >
                  <Headphones className="size-4" /> Mở bản ghi âm
                </LinkButton>
                <p className="mt-2 text-xs leading-5 text-muted">
                  Link tải được lấy mới từ Recall khi mở và chỉ còn hiệu lực trong thời hạn lưu trữ.
                </p>
              </div>
            ) : null}
            {meeting.calendarError ? <p className="mt-4 rounded-xl bg-danger/10 p-3 text-xs leading-5 text-danger">{meeting.calendarError}</p> : null}
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}
