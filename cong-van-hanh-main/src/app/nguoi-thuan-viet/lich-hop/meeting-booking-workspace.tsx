"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  DoorOpen,
  ExternalLink,
  Save,
  Sparkles,
  Users,
  Video,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition, type FormEvent } from "react";

import { Badge, Button, Input, Panel, Select } from "@/components/ui";
import { MultiSelect } from "@/components/ui/multi-select";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";

import {
  createMeetingAction,
  setMeetingInterestsAction,
  type CreateMeetingInput,
  type MeetingConflict,
} from "./actions";

type BusyBlock = {
  dateKey: string;
  endsAt: string;
  id: string;
  meetingId: string;
  ownerEmployeeId: string;
  ownerLabel: string;
  roomLabel: string;
  startsAt: string;
  title: string;
};

type EmployeeOption = { email: string; id: string; label: string; sub: string };
type RoomOption = {
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  capacity: number;
  closeTime: string;
  color: string;
  id: string;
  label: string;
  location: string;
  maxBookingMinutes: number;
  openTime: string;
};
type OwnMeeting = {
  attendeeCount: number;
  calendarSyncStatus: string;
  code: string;
  endsAt: string;
  googleMeetUrl: string;
  id: string;
  roomLabel: string;
  startsAt: string;
  status: string;
  title: string;
};
type RoomBusy = { endsAt: string; id: string; roomId: string; startsAt: string };

const TIMEZONE = "Asia/Ho_Chi_Minh";

function localDateKey(value: Date | string) {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIMEZONE,
    year: "numeric",
  }).format(new Date(value));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: TIMEZONE,
  }).format(new Date(value));
}

function fullTimeLabel(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: TIMEZONE,
    weekday: "short",
  }).format(new Date(value));
}

function dateTimeLocal(value: Date) {
  const parts = new Intl.DateTimeFormat("sv-SE", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    timeZone: TIMEZONE,
    year: "numeric",
  })
    .format(value)
    .replace(" ", "T");
  return parts;
}

function defaultTimes() {
  const now = new Date();
  const start = new Date(Math.ceil(now.getTime() / (30 * 60_000)) * 30 * 60_000);
  if (start.getTime() < now.getTime() + 10 * 60_000) {
    start.setTime(start.getTime() + 30 * 60_000);
  }
  return {
    endsAt: dateTimeLocal(new Date(start.getTime() + 60 * 60_000)),
    startsAt: dateTimeLocal(start),
  };
}

function meetingTone(status: string) {
  if (status === "COMPLETED") return "success" as const;
  if (status === "CANCELLED") return "danger" as const;
  if (status === "IN_PROGRESS") return "warning" as const;
  return "info" as const;
}

export function MeetingBookingWorkspace({
  busyBlocks,
  canCreate,
  employees,
  interestEmployeeIds,
  ownMeetings,
  roomBusy,
  rooms,
  weekEndsAt,
  weekStartsAt,
}: {
  busyBlocks: BusyBlock[];
  canCreate: boolean;
  employees: EmployeeOption[];
  interestEmployeeIds: string[];
  ownMeetings: OwnMeeting[];
  roomBusy: RoomBusy[];
  rooms: RoomOption[];
  weekEndsAt: string;
  weekStartsAt: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const initialTimes = useMemo(() => defaultTimes(), []);
  const [pending, startTransition] = useTransition();
  const [trackedIds, setTrackedIds] = useState(interestEmployeeIds);
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [agenda, setAgenda] = useState("");
  const [startsAt, setStartsAt] = useState(initialTimes.startsAt);
  const [endsAt, setEndsAt] = useState(initialTimes.endsAt);
  const [mode, setMode] = useState<CreateMeetingInput["mode"]>("HYBRID");
  const [roomId, setRoomId] = useState(rooms[0]?.id || "");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [recallEnabled, setRecallEnabled] = useState(true);
  const [conflicts, setConflicts] = useState<MeetingConflict[]>([]);
  const [pendingConflictInput, setPendingConflictInput] =
    useState<CreateMeetingInput | null>(null);

  const days = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const date = new Date(new Date(weekStartsAt).getTime() + index * 86_400_000);
        return {
          key: localDateKey(date),
          label: new Intl.DateTimeFormat("vi-VN", {
            day: "2-digit",
            month: "2-digit",
            timeZone: TIMEZONE,
            weekday: "short",
          }).format(date),
        };
      }),
    [weekStartsAt],
  );
  const previousWeek = localDateKey(new Date(new Date(weekStartsAt).getTime() - 7 * 86_400_000));
  const nextWeek = localDateKey(new Date(new Date(weekStartsAt).getTime() + 7 * 86_400_000));
  const selectedRoom = rooms.find((room) => room.id === roomId);
  const selectedRoomBusy = roomBusy.filter((item) => item.roomId === roomId);

  function runCreate(input: CreateMeetingInput) {
    startTransition(async () => {
      const result = await createMeetingAction(input);
      if (result.error) {
        toast({ title: "Chưa thể đặt lịch", message: result.error, tone: "error" });
        return;
      }
      if (result.warning && result.attendeeConflicts) {
        setPendingConflictInput(input);
        setConflicts(result.attendeeConflicts);
        toast({ title: "Có lịch bận cần xác nhận", message: result.warning, tone: "warning" });
        return;
      }
      if (result.meetingId) {
        toast({ title: "Đặt lịch thành công", message: result.success, tone: "success" });
        router.push(`/nguoi-thuan-viet/lich-hop/${result.meetingId}`);
        router.refresh();
      }
    });
  }

  const weekLabel = `${days[0]?.label || ""} – ${new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    timeZone: TIMEZONE,
    year: "numeric",
  }).format(new Date(new Date(weekEndsAt).getTime() - 1))}`;

  function submitMeeting(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    runCreate({
      agenda,
      aiEnabled,
      attendeeEmployeeIds: attendeeIds,
      endsAt,
      mode,
      recallEnabled: recallEnabled && aiEnabled,
      roomId: mode === "ONLINE" ? undefined : roomId,
      startsAt,
      title,
    });
  }

  function saveInterests() {
    startTransition(async () => {
      const result = await setMeetingInterestsAction(trackedIds);
      toast({
        title: result.error ? "Chưa thể lưu" : "Đã lưu người quan tâm",
        message: result.error || result.success,
        tone: result.error ? "error" : "success",
      });
      if (!result.error) router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      <WriteLoadingOverlay
        message="Đang kiểm tra lịch bận và giữ phòng họp..."
        show={pending}
      />

      <Panel
        actions={
          <div className="flex items-center gap-2">
            <Link aria-label="Tuần trước" className="ui-icon-button" href={`?week=${previousWeek}`}>
              <ChevronLeft className="size-4" />
            </Link>
            <Link className="ui-button ui-button--secondary" href="?">
              Tuần này
            </Link>
            <Link aria-label="Tuần sau" className="ui-icon-button" href={`?week=${nextWeek}`}>
              <ChevronRight className="size-4" />
            </Link>
          </div>
        }
        title={`Lịch bận trong tuần · ${weekLabel}`}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
          <label className="ui-module-field">
            <span className="ui-module-label">Người cần theo dõi lịch bận</span>
            <MultiSelect
              name="trackedEmployeeIds"
              onValuesChange={setTrackedIds}
              options={employees.map((employee) => ({
                label: employee.label,
                sub: employee.sub,
                value: employee.id,
              }))}
              placeholder="Tìm tên nhân sự để xem giờ bận..."
              values={trackedIds}
            />
          </label>
          <Button onClick={saveInterests} size="sm" variant="secondary">
            <Save className="size-4" /> Lưu danh sách
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-7">
          {days.map((day) => {
            const blocks = busyBlocks.filter(
              (block) => block.dateKey === day.key &&
                (trackedIds.includes(block.ownerEmployeeId) || block.title !== "Bận"),
            );
            return (
              <section className="min-h-36 rounded-2xl border border-border bg-surface-muted/45 p-3" key={day.key}>
                <div className="mb-2 text-xs font-extrabold uppercase tracking-wide text-primary">
                  {day.label}
                </div>
                <div className="space-y-2">
                  {blocks.length ? (
                    blocks.map((block) => {
                      const content = (
                        <div className="rounded-xl border border-border bg-surface px-2.5 py-2 shadow-sm">
                          <div className="text-[11px] font-extrabold text-accent-strong">
                            {timeLabel(block.startsAt)}–{timeLabel(block.endsAt)}
                          </div>
                          <div className="mt-0.5 truncate text-xs font-bold text-primary">{block.title}</div>
                          <div className="truncate text-[11px] text-muted">{block.ownerLabel}</div>
                          {block.roomLabel ? (
                            <div className="truncate text-[11px] text-muted">{block.roomLabel}</div>
                          ) : null}
                        </div>
                      );
                      return block.meetingId ? (
                        <Link href={`/nguoi-thuan-viet/lich-hop/${block.meetingId}`} key={block.id}>
                          {content}
                        </Link>
                      ) : (
                        <div key={block.id}>{content}</div>
                      );
                    })
                  ) : (
                    <p className="py-3 text-center text-xs text-muted">Chưa có lịch bận</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <Panel title="Đặt cuộc họp mới">
          {canCreate ? (
            <form className="grid gap-4 md:grid-cols-2" onSubmit={submitMeeting}>
              <label className="ui-module-field md:col-span-2">
                <span className="ui-module-label">Tên cuộc họp</span>
                <Input
                  maxLength={180}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Ví dụ: Chốt kế hoạch khai trương chi nhánh"
                  required
                  value={title}
                />
              </label>
              <label className="ui-module-field md:col-span-2">
                <span className="ui-module-label">Nội dung cần trao đổi</span>
                <textarea
                  className="ui-module-textarea min-h-28"
                  maxLength={10_000}
                  onChange={(event) => setAgenda(event.target.value)}
                  placeholder="Liệt kê mục tiêu, vấn đề cần chốt và tài liệu cần chuẩn bị..."
                  required
                  value={agenda}
                />
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Bắt đầu</span>
                <Input onChange={(event) => setStartsAt(event.target.value)} required type="datetime-local" value={startsAt} />
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Kết thúc</span>
                <Input onChange={(event) => setEndsAt(event.target.value)} required type="datetime-local" value={endsAt} />
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Hình thức</span>
                <Select onChange={(event) => setMode(event.target.value as CreateMeetingInput["mode"])} value={mode}>
                  <option value="HYBRID">Tại phòng + Google Meet</option>
                  <option value="ONSITE">Chỉ họp tại phòng</option>
                  <option value="ONLINE">Chỉ Google Meet</option>
                </Select>
              </label>
              <label className="ui-module-field">
                <span className="ui-module-label">Phòng họp</span>
                <Select
                  disabled={mode === "ONLINE"}
                  onChange={(event) => setRoomId(event.target.value)}
                  required={mode !== "ONLINE"}
                  value={mode === "ONLINE" ? "" : roomId}
                >
                  <option value="">{rooms.length ? "Chọn phòng" : "Chưa cấu hình phòng"}</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.label} · {room.capacity} người · {room.openTime}–{room.closeTime}
                    </option>
                  ))}
                </Select>
              </label>
              {selectedRoom && mode !== "ONLINE" ? (
                <div className="md:col-span-2 rounded-2xl border border-border bg-surface-muted/55 px-4 py-3 text-xs text-muted">
                  <div className="flex flex-wrap gap-x-5 gap-y-1">
                    <span><strong className="text-primary">{selectedRoom.label}</strong> · {selectedRoom.location || "Chưa ghi vị trí"}</span>
                    <span>Sức chứa: {selectedRoom.capacity}</span>
                    <span>Tối đa: {selectedRoom.maxBookingMinutes} phút</span>
                    <span>Đệm phòng: {selectedRoom.bufferBeforeMinutes}/{selectedRoom.bufferAfterMinutes} phút</span>
                  </div>
                  {selectedRoomBusy.length ? (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {selectedRoomBusy.map((item) => (
                        <span className="ui-chip" key={item.id}>
                          {fullTimeLabel(item.startsAt)}–{timeLabel(item.endsAt)}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <label className="ui-module-field md:col-span-2">
                <span className="ui-module-label">Người tham gia</span>
                <MultiSelect
                  name="attendeeEmployeeIds"
                  onValuesChange={setAttendeeIds}
                  options={employees.map((employee) => ({
                    label: employee.label,
                    sub: employee.sub,
                    value: employee.id,
                  }))}
                  placeholder="Tìm và chọn người tham gia..."
                  values={attendeeIds}
                />
              </label>
              <div className="md:col-span-2 grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-border bg-surface-muted/55 p-4">
                  <input
                    checked={aiEnabled}
                    className="mt-1 size-4 accent-[var(--accent)]"
                    onChange={(event) => setAiEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-bold text-primary"><Sparkles className="size-4 text-accent" /> Tạo biên bản AI</span>
                    <span className="mt-1 block text-xs leading-5 text-muted">Gemini tạo tóm tắt và đầu việc để chủ cuộc họp duyệt.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-3 rounded-2xl border border-border bg-surface-muted/55 p-4">
                  <input
                    checked={recallEnabled && aiEnabled}
                    className="mt-1 size-4 accent-[var(--accent)]"
                    disabled={!aiEnabled}
                    onChange={(event) => setRecallEnabled(event.target.checked)}
                    type="checkbox"
                  />
                  <span>
                    <span className="flex items-center gap-2 text-sm font-bold text-primary"><Video className="size-4 text-accent" /> Recall vào ghi âm</span>
                    <span className="mt-1 block text-xs leading-5 text-muted">Bot ẩn danh cần người trong phòng họp chấp nhận cho vào.</span>
                  </span>
                </label>
              </div>
              <div className="md:col-span-2 flex justify-end">
                <Button disabled={pending || (mode !== "ONLINE" && !roomId)} type="submit">
                  <CalendarDays className="size-4" /> Kiểm tra và đặt lịch
                </Button>
              </div>
            </form>
          ) : (
            <p className="text-sm leading-6 text-muted">Tài khoản được xem lịch nhưng chưa có quyền tạo cuộc họp.</p>
          )}
        </Panel>

        <Panel title="Cuộc họp của tui trong tuần">
          <div className="space-y-3">
            {ownMeetings.length ? (
              ownMeetings.map((meeting) => (
                <Link
                  className="block rounded-2xl border border-border bg-surface p-4 transition hover:border-accent/50 hover:shadow-md"
                  href={`/nguoi-thuan-viet/lich-hop/${meeting.id}`}
                  key={meeting.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-extrabold uppercase tracking-wide text-accent-strong">{meeting.code}</div>
                      <div className="mt-1 font-extrabold text-primary">{meeting.title}</div>
                    </div>
                    <Badge tone={meetingTone(meeting.status)}>{meeting.status}</Badge>
                  </div>
                  <div className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2">
                    <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" /> {fullTimeLabel(meeting.startsAt)}–{timeLabel(meeting.endsAt)}</span>
                    <span className="flex items-center gap-1.5"><DoorOpen className="size-3.5" /> {meeting.roomLabel || "Không dùng phòng"}</span>
                    <span className="flex items-center gap-1.5"><Users className="size-3.5" /> {meeting.attendeeCount} người</span>
                    <span className="flex items-center gap-1.5"><ExternalLink className="size-3.5" /> Calendar: {meeting.calendarSyncStatus}</span>
                  </div>
                </Link>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-border p-8 text-center text-sm text-muted">
                Tuần này chưa có cuộc họp nào của ông.
              </div>
            )}
          </div>
        </Panel>
      </div>

      {pendingConflictInput ? (
        <div className="fixed inset-0 z-[170] grid place-items-center bg-[rgba(7,24,21,0.52)] px-4 backdrop-blur-sm">
          <section className="w-full max-w-xl rounded-3xl border border-border bg-surface p-6 shadow-[0_30px_90px_rgba(7,24,21,0.35)]">
            <Badge tone="warning">Cần xác nhận</Badge>
            <h2 className="mt-3 text-xl font-extrabold text-primary">Một số người đang bận</h2>
            <p className="mt-2 text-sm leading-6 text-muted">
              Hệ thống không hiển thị họ đang họp gì. Nếu vẫn đặt, lịch mới sẽ được tạo đè và gửi thư mời bình thường.
            </p>
            <div className="mt-4 max-h-56 space-y-2 overflow-auto">
              {conflicts.map((conflict, index) => (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-surface-muted px-3 py-2 text-sm" key={`${conflict.employeeId}-${conflict.startsAt}-${index}`}>
                  <span className="font-bold text-primary">{conflict.displayName}</span>
                  <span className="text-muted">{fullTimeLabel(conflict.startsAt)}–{timeLabel(conflict.endsAt)}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button onClick={() => { setPendingConflictInput(null); setConflicts([]); }} variant="secondary">
                Chọn giờ khác
              </Button>
              <Button
                onClick={() => {
                  const input = pendingConflictInput;
                  setPendingConflictInput(null);
                  setConflicts([]);
                  runCreate({ ...input, allowAttendeeConflict: true });
                }}
              >
                Vẫn đặt lịch
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
