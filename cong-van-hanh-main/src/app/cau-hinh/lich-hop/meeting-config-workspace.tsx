"use client";

import {
  Archive,
  CalendarCog,
  DoorOpen,
  KeyRound,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Save,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { Badge, Button, Input, LinkButton, Select } from "@/components/ui";
import { useToast, WriteLoadingOverlay } from "@/components/ui/toast";
import {
  RECALL_REGIONS,
  type MeetingConfigSnapshot,
} from "@/lib/meetings/config-shared";

import {
  saveMeetingConfigAction,
  saveMeetingRoomAction,
  setMeetingRoomStatusAction,
} from "./actions";

type RoomRow = {
  amenities: string[];
  archivedAt: string;
  bufferAfterMinutes: number;
  bufferBeforeMinutes: number;
  capacity: number;
  closeTime: string;
  code: string;
  color: string;
  description: string;
  floor: string;
  googleCalendarId: string;
  id: string;
  location: string;
  maxBookingMinutes: number;
  name: string;
  openTime: string;
  sortOrder: number;
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  timezone: string;
};

type ViewKey = "rooms" | "integrations";

function Field({
  children,
  label,
  wide = false,
}: {
  children: ReactNode;
  label: string;
  wide?: boolean;
}) {
  return (
    <label className={`ui-module-field${wide ? " md:col-span-2" : ""}`}>
      <span className="ui-module-label">{label}</span>
      {children}
    </label>
  );
}

function StatusLine({
  configured,
  label,
  value,
}: {
  configured: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 last:border-0">
      <span className="text-sm font-semibold text-primary">{label}</span>
      <Badge tone={configured ? "success" : "warning"}>
        {configured ? value : "Chưa cấu hình"}
      </Badge>
    </div>
  );
}

export function MeetingConfigWorkspace({
  canManage,
  config: initialConfig,
  rooms,
}: {
  canManage: boolean;
  config: MeetingConfigSnapshot;
  rooms: RoomRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [view, setView] = useState<ViewKey>("rooms");
  const [editing, setEditing] = useState<RoomRow | null>(null);
  const [config, setConfig] = useState(initialConfig);
  const [busy, setBusy] = useState("");

  async function saveRoom(formData: FormData) {
    setBusy("Đang kiểm tra và lưu phòng họp...");
    try {
      const result = await saveMeetingRoomAction({
        amenities: String(formData.get("amenities") || ""),
        bufferAfterMinutes: Number(formData.get("bufferAfterMinutes") || 0),
        bufferBeforeMinutes: Number(formData.get("bufferBeforeMinutes") || 0),
        capacity: Number(formData.get("capacity") || 1),
        closeTime: String(formData.get("closeTime") || ""),
        code: String(formData.get("code") || ""),
        color: String(formData.get("color") || ""),
        description: String(formData.get("description") || ""),
        editId: String(formData.get("editId") || ""),
        floor: String(formData.get("floor") || ""),
        googleCalendarId: String(formData.get("googleCalendarId") || ""),
        location: String(formData.get("location") || ""),
        maxBookingMinutes: Number(formData.get("maxBookingMinutes") || 480),
        name: String(formData.get("name") || ""),
        openTime: String(formData.get("openTime") || ""),
        sortOrder: Number(formData.get("sortOrder") || 100),
        status:
          formData.get("status") === "INACTIVE" ? "INACTIVE" : "ACTIVE",
        timezone: String(formData.get("timezone") || ""),
      });
      if (!result.ok) throw new Error(result.message);
      toast({ message: result.message, title: "Phòng họp", tone: "success" });
      setEditing(null);
      router.refresh();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không lưu được phòng",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }

  async function changeRoomStatus(
    room: RoomRow,
    status: "ACTIVE" | "INACTIVE" | "ARCHIVED",
  ) {
    setBusy(`Đang cập nhật ${room.name}...`);
    try {
      const result = await setMeetingRoomStatusAction(room.id, status);
      if (!result.ok) throw new Error(result.message);
      toast({ message: result.message, title: room.name, tone: "success" });
      if (editing?.id === room.id) setEditing(null);
      router.refresh();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không cập nhật được phòng",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }

  async function saveConfig(formData: FormData) {
    setBusy("Đang mã hóa và lưu cấu hình tích hợp...");
    try {
      const result = await saveMeetingConfigAction({
        audioRetentionDays: Number(formData.get("audioRetentionDays") || 7),
        botJoinLeadMinutes: Number(formData.get("botJoinLeadMinutes") || 2),
        defaultTimezone: String(formData.get("defaultTimezone") || ""),
        googleOrganizerEmail: String(
          formData.get("googleOrganizerEmail") || "",
        ),
        recallEnabled: formData.get("recallEnabled") === "true",
        recallRegion: String(formData.get("recallRegion") || ""),
        transcriptRetentionDays: Number(
          formData.get("transcriptRetentionDays") || 90,
        ),
      });
      if (!result.ok) throw new Error(result.message);
      if (result.data?.config) setConfig(result.data.config);
      toast({ message: result.message, title: "Cấu hình Lịch họp", tone: "success" });
      router.refresh();
    } catch (error) {
      toast({
        message: error instanceof Error ? error.message : undefined,
        title: "Không lưu được cấu hình",
        tone: "error",
      });
    } finally {
      setBusy("");
    }
  }

  return (
    <>
      <WriteLoadingOverlay message={busy} show={Boolean(busy)} />
      <div className="mt-5 flex flex-wrap gap-2">
        <Button
          onClick={() => setView("rooms")}
          size="sm"
          variant={view === "rooms" ? "primary" : "secondary"}
        >
          <DoorOpen size={16} />
          Phòng họp
        </Button>
        <Button
          onClick={() => setView("integrations")}
          size="sm"
          variant={view === "integrations" ? "primary" : "secondary"}
        >
          <CalendarCog size={16} />
          Tích hợp &amp; lưu trữ
        </Button>
      </div>

      {view === "rooms" ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
          <section className="ui-module-panel p-5">
            <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <Badge tone="info">Danh mục phòng</Badge>
                <h2 className="mt-2 text-xl font-extrabold text-primary">
                  {editing ? `Sửa ${editing.name}` : "Thêm phòng họp"}
                </h2>
              </div>
              {editing ? (
                <Button onClick={() => setEditing(null)} size="sm" variant="secondary">
                  <Plus size={15} />
                  Tạo phòng mới
                </Button>
              ) : null}
            </div>

            {canManage ? (
              <form action={saveRoom} className="grid gap-4 md:grid-cols-2" key={editing?.id || "new"}>
                <input name="editId" type="hidden" value={editing?.id || ""} />
                <Field label="Mã phòng">
                  <Input defaultValue={editing?.code} name="code" placeholder="VD: PH-A01" required />
                </Field>
                <Field label="Tên phòng">
                  <Input defaultValue={editing?.name} name="name" placeholder="Phòng họp A01" required />
                </Field>
                <Field label="Vị trí">
                  <Input defaultValue={editing?.location} name="location" placeholder="Tòa nhà / địa chỉ" />
                </Field>
                <Field label="Tầng">
                  <Input defaultValue={editing?.floor} name="floor" placeholder="Tầng 3" />
                </Field>
                <Field label="Sức chứa">
                  <Input defaultValue={editing?.capacity ?? 8} min={1} name="capacity" type="number" />
                </Field>
                <Field label="Màu hiển thị">
                  <Input defaultValue={editing?.color || "#0f766e"} name="color" type="color" />
                </Field>
                <Field label="Giờ mở cửa">
                  <Input defaultValue={editing?.openTime || "08:00"} name="openTime" type="time" />
                </Field>
                <Field label="Giờ đóng cửa">
                  <Input defaultValue={editing?.closeTime || "18:00"} name="closeTime" type="time" />
                </Field>
                <Field label="Đệm trước họp (phút)">
                  <Input defaultValue={editing?.bufferBeforeMinutes ?? 0} max={120} min={0} name="bufferBeforeMinutes" type="number" />
                </Field>
                <Field label="Đệm sau họp (phút)">
                  <Input defaultValue={editing?.bufferAfterMinutes ?? 0} max={120} min={0} name="bufferAfterMinutes" type="number" />
                </Field>
                <Field label="Thời lượng tối đa (phút)">
                  <Input defaultValue={editing?.maxBookingMinutes ?? 480} max={1440} min={15} name="maxBookingMinutes" type="number" />
                </Field>
                <Field label="Thứ tự">
                  <Input defaultValue={editing?.sortOrder ?? 100} min={0} name="sortOrder" type="number" />
                </Field>
                <Field label="Múi giờ">
                  <Input defaultValue={editing?.timezone || "Asia/Ho_Chi_Minh"} name="timezone" />
                </Field>
                <Field label="Trạng thái">
                  <Select defaultValue={editing?.status === "INACTIVE" ? "INACTIVE" : "ACTIVE"} name="status">
                    <option value="ACTIVE">Đang hoạt động</option>
                    <option value="INACTIVE">Tạm ngưng</option>
                  </Select>
                </Field>
                <Field label="Tiện ích" wide>
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    defaultValue={editing?.amenities.join(", ")}
                    name="amenities"
                    placeholder="TV, máy chiếu, bảng viết, camera..."
                  />
                </Field>
                <Field label="Google Resource Calendar ID — để trống trong MVP" wide>
                  <Input defaultValue={editing?.googleCalendarId} name="googleCalendarId" placeholder="phong-hop-a01@resource.calendar.google.com" />
                </Field>
                <Field label="Mô tả" wide>
                  <textarea
                    className="min-h-24 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
                    defaultValue={editing?.description}
                    name="description"
                  />
                </Field>
                <div className="md:col-span-2">
                  <Button disabled={Boolean(busy)} type="submit">
                    <Save size={17} />
                    {editing ? "Cập nhật phòng" : "Lưu phòng họp"}
                  </Button>
                </div>
              </form>
            ) : (
              <p className="text-sm text-muted">Tài khoản hiện tại chỉ được xem danh mục phòng.</p>
            )}
          </section>

          <aside className="ui-module-panel h-fit p-5 xl:sticky xl:top-20">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <Badge tone="warning">Phòng đã cấu hình</Badge>
                <h2 className="mt-2 text-xl font-extrabold text-primary">{rooms.length} phòng</h2>
              </div>
              <DoorOpen className="text-accent" size={28} />
            </div>
            <div className="max-h-[calc(100dvh-250px)] space-y-3 overflow-auto pr-1">
              {rooms.length ? rooms.map((room) => (
                <article className="rounded-xl border border-border bg-surface p-4" key={room.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: room.color }} />
                        <strong className="truncate text-primary">{room.name}</strong>
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {room.code} · {room.capacity} người · {room.openTime}–{room.closeTime}
                      </p>
                    </div>
                    <Badge tone={room.status === "ACTIVE" ? "success" : room.status === "INACTIVE" ? "warning" : "neutral"}>
                      {room.status === "ACTIVE" ? "Đang dùng" : room.status === "INACTIVE" ? "Tạm ngưng" : "Lưu trữ"}
                    </Badge>
                  </div>
                  {room.location || room.floor ? (
                    <p className="mt-2 text-xs leading-5 text-muted">{[room.location, room.floor].filter(Boolean).join(" · ")}</p>
                  ) : null}
                  {room.amenities.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {room.amenities.slice(0, 6).map((item) => (
                        <span className="rounded-full bg-primary/7 px-2 py-1 text-[11px] font-semibold text-primary" key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                  {canManage && room.status !== "ARCHIVED" ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button onClick={() => setEditing(room)} size="sm" variant="secondary"><Pencil size={14} />Sửa</Button>
                      <Button onClick={() => changeRoomStatus(room, room.status === "ACTIVE" ? "INACTIVE" : "ACTIVE")} size="sm" variant="ghost">
                        {room.status === "ACTIVE" ? <PowerOff size={14} /> : <Power size={14} />}
                        {room.status === "ACTIVE" ? "Tạm ngưng" : "Bật lại"}
                      </Button>
                      <Button onClick={() => changeRoomStatus(room, "ARCHIVED")} size="sm" variant="ghost"><Archive size={14} />Lưu trữ</Button>
                    </div>
                  ) : null}
                </article>
              )) : (
                <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                  Chưa có phòng họp. Hãy tạo phòng đầu tiên ở bên trái.
                </div>
              )}
            </div>
          </aside>
        </div>
      ) : (
        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
          <section className="ui-module-panel p-5">
            <Badge tone="info">Tích hợp và chính sách</Badge>
            <h2 className="mt-2 text-xl font-extrabold text-primary">Google Calendar · Recall · Retention</h2>
            {canManage ? (
              <form action={saveConfig} className="mt-5 grid gap-4 md:grid-cols-2">
                <Field label="Tài khoản tổ chức Google Calendar" wide>
                  <Input defaultValue={config.googleOrganizerEmail} name="googleOrganizerEmail" required type="email" />
                </Field>
                <Field label="Múi giờ mặc định">
                  <Input defaultValue={config.defaultTimezone} name="defaultTimezone" />
                </Field>
                <Field label="Recall region">
                  <Select defaultValue={config.recallRegion} name="recallRegion">
                    {RECALL_REGIONS.map((region) => <option key={region.key} value={region.key}>{region.label}</option>)}
                  </Select>
                </Field>
                <Field label="Recall bot">
                  <Select defaultValue={config.recallEnabled ? "true" : "false"} name="recallEnabled">
                    <option value="true">Bật cho cuộc họp mới</option>
                    <option value="false">Tạm tắt</option>
                  </Select>
                </Field>
                <Field label="Bot vào sớm (phút)">
                  <Input defaultValue={config.botJoinLeadMinutes} max={30} min={0} name="botJoinLeadMinutes" type="number" />
                </Field>
                <Field label="Giữ audio ở provider (ngày)">
                  <Input defaultValue={config.audioRetentionDays} max={30} min={1} name="audioRetentionDays" type="number" />
                </Field>
                <Field label="Giữ transcript thô (ngày)">
                  <Input defaultValue={config.transcriptRetentionDays} max={365} min={7} name="transcriptRetentionDays" type="number" />
                </Field>
                <div className="md:col-span-2">
                  <Button disabled={Boolean(busy)} type="submit"><Save size={17} />Lưu cấu hình</Button>
                </div>
              </form>
            ) : (
              <p className="mt-4 text-sm text-muted">Tài khoản hiện tại chỉ được xem trạng thái tích hợp.</p>
            )}
          </section>

          <aside className="ui-module-panel h-fit p-5 xl:sticky xl:top-20">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Badge tone="warning">Trạng thái nền</Badge>
                <h2 className="mt-2 text-xl font-extrabold text-primary">Sẵn sàng kết nối</h2>
              </div>
              <ShieldCheck className="text-accent" size={30} />
            </div>
            <div className="mt-4">
              <StatusLine configured={Boolean(config.googleOrganizerEmail)} label="Google Organizer" value={config.googleOrganizerEmail} />
              <StatusLine configured={Boolean(config.googleServiceAccountEmail)} label="Service account" value="Đã xác định" />
              <StatusLine configured={config.recallApiKeyConfigured} label="Recall API key" value="Đã mã hóa" />
              <StatusLine configured={config.recallVerificationSecretConfigured} label="Webhook verification" value="Đã mã hóa" />
            </div>
            <div className="mt-4 rounded-xl border border-brand/20 bg-brand-soft/70 p-4 text-sm leading-6 text-brand-strong">
              <div className="flex items-center gap-2 font-bold"><KeyRound size={17} />Secret quản lý tập trung</div>
              <p className="mt-2">API key và Verification Secret chỉ chỉnh tại Cấu hình Tổng. Trang này chỉ hiển thị trạng thái để tránh hai nơi cùng sửa một cấu hình.</p>
              <LinkButton className="mt-3" href="/cau-hinh/tong?tab=recall-ai" size="sm" variant="secondary">
                Mở Cấu hình Tổng
              </LinkButton>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}
