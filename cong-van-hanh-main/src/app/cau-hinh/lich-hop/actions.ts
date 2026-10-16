"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import type { MeetingRoomStatus } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  getMeetingConfigSnapshot,
  MEETING_SETTING_KEYS,
  RECALL_REGIONS,
  type MeetingConfigSnapshot,
} from "@/lib/meetings/config";

const PATH = "/cau-hinh/lich-hop";

export type MeetingRoomInput = {
  amenities?: string;
  bufferAfterMinutes?: number;
  bufferBeforeMinutes?: number;
  capacity?: number;
  closeTime?: string;
  code?: string;
  color?: string;
  description?: string;
  editId?: string;
  floor?: string;
  googleCalendarId?: string;
  location?: string;
  maxBookingMinutes?: number;
  name?: string;
  openTime?: string;
  sortOrder?: number;
  status?: MeetingRoomStatus;
  timezone?: string;
};

export type MeetingConfigInput = {
  audioRetentionDays?: number;
  botJoinLeadMinutes?: number;
  defaultTimezone?: string;
  googleOrganizerEmail?: string;
  recallEnabled?: boolean;
  recallRegion?: string;
  transcriptRetentionDays?: number;
};

export type MeetingConfigActionResult =
  | { message: string; ok: false }
  | {
      data?: { config?: MeetingConfigSnapshot };
      message: string;
      ok: true;
    };

function text(value: unknown) {
  return String(value ?? "").trim();
}

function optional(value: unknown) {
  const normalized = text(value);
  return normalized || null;
}

function boundedInteger(value: unknown, min: number, max: number, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} phải nằm trong khoảng ${min}–${max}.`);
  }
  return parsed;
}

function timeValue(value: unknown, label: string) {
  const normalized = text(value);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalized)) {
    throw new Error(`${label} không hợp lệ.`);
  }
  return normalized;
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function colorValue(value: unknown) {
  const normalized = text(value) || "#0f766e";
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error("Màu phòng phải có dạng #RRGGBB.");
  }
  return normalized.toLowerCase();
}

function emailValue(value: unknown) {
  const normalized = text(value).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new Error("Email tài khoản tổ chức Google Calendar không hợp lệ.");
  }
  return normalized;
}

async function requireMeetingConfigAdmin() {
  const session = await requireCurrentSession();
  if (!can(session, "meeting_config.manage")) {
    throw new Error("Ông chưa có quyền quản lý cấu hình Lịch họp.");
  }
  return session;
}

export async function saveMeetingRoomAction(
  input: MeetingRoomInput,
): Promise<MeetingConfigActionResult> {
  try {
    const session = await requireMeetingConfigAdmin();
    const editId = text(input.editId);
    const code = text(input.code)
      .toUpperCase()
      .replace(/[^A-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const name = text(input.name);
    if (!code || !name) throw new Error("Nhập đầy đủ mã và tên phòng họp.");

    const openTime = timeValue(input.openTime || "08:00", "Giờ mở cửa");
    const closeTime = timeValue(input.closeTime || "18:00", "Giờ đóng cửa");
    if (timeMinutes(closeTime) <= timeMinutes(openTime)) {
      throw new Error("Giờ đóng cửa phải sau giờ mở cửa.");
    }
    const amenities = [
      ...new Set(
        text(input.amenities)
          .split(/[\n,;]/g)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ];
    const data = {
      amenities,
      bufferAfterMinutes: boundedInteger(
        input.bufferAfterMinutes ?? 0,
        0,
        120,
        "Thời gian đệm sau họp",
      ),
      bufferBeforeMinutes: boundedInteger(
        input.bufferBeforeMinutes ?? 0,
        0,
        120,
        "Thời gian đệm trước họp",
      ),
      capacity: boundedInteger(input.capacity ?? 1, 1, 500, "Sức chứa"),
      closeTime,
      code,
      color: colorValue(input.color),
      description: optional(input.description),
      floor: optional(input.floor),
      googleCalendarId: optional(input.googleCalendarId),
      location: optional(input.location),
      maxBookingMinutes: boundedInteger(
        input.maxBookingMinutes ?? 480,
        15,
        1440,
        "Thời lượng tối đa",
      ),
      name,
      openTime,
      sortOrder: boundedInteger(input.sortOrder ?? 100, 0, 9999, "Thứ tự"),
      status: input.status === "INACTIVE" ? ("INACTIVE" as const) : ("ACTIVE" as const),
      timezone: text(input.timezone) || "Asia/Ho_Chi_Minh",
      updatedById: session.userId,
    };
    const db = getDb();
    const room = editId
      ? await db.meetingRoom.update({
          data: { ...data, archivedAt: null },
          where: { id: editId },
        })
      : await db.meetingRoom.create({
          data: { ...data, createdById: session.userId },
        });
    await db.auditLog.create({
      data: {
        action: editId ? "UPDATE" : "CREATE",
        actorId: session.userId,
        metadata: {
          bufferAfterMinutes: room.bufferAfterMinutes,
          bufferBeforeMinutes: room.bufferBeforeMinutes,
          capacity: room.capacity,
          code: room.code,
        },
        summary: `${editId ? "Cập nhật" : "Tạo"} phòng họp ${room.code}.`,
        targetId: room.id,
        targetType: "MeetingRoom",
      },
    });
    revalidatePath(PATH);
    revalidatePath("/nguoi-thuan-viet/lich-hop");
    return {
      message: editId ? "Đã cập nhật phòng họp." : "Đã tạo phòng họp.",
      ok: true,
    };
  } catch (error) {
    const duplicate =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    return {
      message: duplicate
        ? "Mã phòng hoặc Calendar ID đã tồn tại."
        : error instanceof Error
          ? error.message
          : "Không lưu được phòng họp.",
      ok: false,
    };
  }
}

export async function setMeetingRoomStatusAction(
  roomId: string,
  status: MeetingRoomStatus,
): Promise<MeetingConfigActionResult> {
  try {
    const session = await requireMeetingConfigAdmin();
    if (!(["ACTIVE", "INACTIVE", "ARCHIVED"] as const).includes(status)) {
      throw new Error("Trạng thái phòng không hợp lệ.");
    }
    const db = getDb();
    if (status === "ARCHIVED") {
      const futureBooking = await db.meeting.findFirst({
        select: { code: true },
        where: {
          endsAt: { gt: new Date() },
          roomId,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        },
      });
      if (futureBooking) {
        throw new Error(
          `Phòng còn cuộc họp ${futureBooking.code}. Hãy chuyển phòng hoặc hủy lịch trước khi lưu trữ.`,
        );
      }
    }
    const room = await db.meetingRoom.update({
      data: {
        archivedAt: status === "ARCHIVED" ? new Date() : null,
        status,
        updatedById: session.userId,
      },
      where: { id: roomId },
    });
    await db.auditLog.create({
      data: {
        action: status === "ARCHIVED" ? "ARCHIVE" : "UPDATE",
        actorId: session.userId,
        metadata: { code: room.code, status },
        summary: `Chuyển phòng ${room.code} sang trạng thái ${status}.`,
        targetId: room.id,
        targetType: "MeetingRoom",
      },
    });
    revalidatePath(PATH);
    revalidatePath("/nguoi-thuan-viet/lich-hop");
    return { message: "Đã cập nhật trạng thái phòng họp.", ok: true };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : "Không cập nhật được phòng.",
      ok: false,
    };
  }
}

export async function saveMeetingConfigAction(
  input: MeetingConfigInput,
): Promise<MeetingConfigActionResult> {
  try {
    const session = await requireMeetingConfigAdmin();
    const region = text(input.recallRegion) || "ap-northeast-1";
    if (!RECALL_REGIONS.some((item) => item.key === region)) {
      throw new Error("Region Recall không được hỗ trợ.");
    }
    const db = getDb();
    const values = new Map<string, string | null>([
      [
        MEETING_SETTING_KEYS.audioRetentionDays,
        String(
          boundedInteger(
            input.audioRetentionDays ?? 7,
            1,
            30,
            "Thời hạn audio",
          ),
        ),
      ],
      [
        MEETING_SETTING_KEYS.botJoinLeadMinutes,
        String(
          boundedInteger(
            input.botJoinLeadMinutes ?? 2,
            0,
            30,
            "Thời gian bot vào sớm",
          ),
        ),
      ],
      [
        MEETING_SETTING_KEYS.defaultTimezone,
        text(input.defaultTimezone) || "Asia/Ho_Chi_Minh",
      ],
      [
        MEETING_SETTING_KEYS.googleOrganizerEmail,
        emailValue(input.googleOrganizerEmail),
      ],
      [MEETING_SETTING_KEYS.recallEnabled, input.recallEnabled ? "true" : "false"],
      [MEETING_SETTING_KEYS.recallRegion, region],
      [
        MEETING_SETTING_KEYS.transcriptRetentionDays,
        String(
          boundedInteger(
            input.transcriptRetentionDays ?? 90,
            7,
            365,
            "Thời hạn transcript",
          ),
        ),
      ],
    ]);

    await db.$transaction(async (tx) => {
      for (const [key, value] of values) {
        await tx.systemSetting.upsert({
          create: { key, updatedById: session.userId, value },
          update: { updatedById: session.userId, value },
          where: { key },
        });
      }
      await tx.auditLog.create({
        data: {
          action: "UPDATE",
          actorId: session.userId,
          metadata: {
            audioRetentionDays: input.audioRetentionDays,
            botJoinLeadMinutes: input.botJoinLeadMinutes,
            googleOrganizerEmail: emailValue(input.googleOrganizerEmail),
            recallEnabled: Boolean(input.recallEnabled),
            recallRegion: region,
            transcriptRetentionDays: input.transcriptRetentionDays,
          },
          summary: "Cập nhật chính sách và tích hợp Lịch họp.",
          targetId: "meetings",
          targetType: "SystemSetting",
        },
      });
    });
    revalidatePath(PATH);
    return {
      data: { config: await getMeetingConfigSnapshot() },
      message: "Đã lưu chính sách Lịch họp.",
      ok: true,
    };
  } catch (error) {
    return {
      message:
        error instanceof Error ? error.message : "Không lưu được cấu hình Lịch họp.",
      ok: false,
    };
  }
}
