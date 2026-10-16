import type { Metadata } from "next";

import { AppShell } from "@/components/layout/app-shell";
import { Panel } from "@/components/ui";
import { can, canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { getMeetingConfigSnapshot } from "@/lib/meetings/config";

import { ConfigTabs } from "../config-tabs";
import { MeetingConfigWorkspace } from "./meeting-config-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Cấu hình Lịch họp | Cổng vận hành",
};

export default async function MeetingConfigPage() {
  const session = await requireCurrentSession();
  const canRead = canAny(session, ["meeting_config.read", "meeting_config.manage"]);
  const canManage = can(session, "meeting_config.manage");
  if (!canRead) {
    return (
      <AppShell activePath="/cau-hinh" moduleKey="meeting-config" session={session}>
        <Panel title="Không có quyền Cấu hình Lịch họp">
          <p className="text-sm leading-6 text-muted">
            Tài khoản hiện tại chưa được cấp quyền xem danh mục phòng và tích hợp lịch họp.
          </p>
        </Panel>
      </AppShell>
    );
  }

  const [rooms, config] = await Promise.all([
    getDb().meetingRoom.findMany({
      orderBy: [{ status: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    }),
    getMeetingConfigSnapshot(),
  ]);

  return (
    <AppShell activePath="/cau-hinh" moduleKey="meeting-config" session={session}>
      <ConfigTabs active="meetings" />
      <MeetingConfigWorkspace
        canManage={canManage}
        config={config}
        rooms={rooms.map((room) => ({
          amenities: Array.isArray(room.amenities)
            ? room.amenities.map(String)
            : [],
          archivedAt: room.archivedAt?.toISOString() || "",
          bufferAfterMinutes: room.bufferAfterMinutes,
          bufferBeforeMinutes: room.bufferBeforeMinutes,
          capacity: room.capacity,
          closeTime: room.closeTime,
          code: room.code,
          color: room.color,
          description: room.description || "",
          floor: room.floor || "",
          googleCalendarId: room.googleCalendarId || "",
          id: room.id,
          location: room.location || "",
          maxBookingMinutes: room.maxBookingMinutes,
          name: room.name,
          openTime: room.openTime,
          sortOrder: room.sortOrder,
          status: room.status,
          timezone: room.timezone,
        }))}
      />
    </AppShell>
  );
}
