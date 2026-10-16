"use server";

import { revalidatePath } from "next/cache";

import { Prisma } from "@/generated/prisma/client";
import type { MotivationStatus } from "@/generated/prisma/enums";
import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import {
  MotivationMediaError,
  type MotivationMedia,
  uploadMotivationMedia,
} from "@/lib/motivation-media";

const PATH = "/cau-hinh/thong-bao";

export type MotivationActionState = { error?: string; success?: string };

function text(formData: FormData, name: string) {
  return String(formData.get(name) || "").trim();
}
function optionalText(formData: FormData, name: string) {
  const v = text(formData, name);
  return v ? v : null;
}
function checked(formData: FormData, name: string) {
  return formData.get(name) != null;
}
function list(formData: FormData, name: string) {
  return formData.getAll(name).map((v) => String(v)).filter(Boolean);
}
function parseDate(value: string | null) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function parseTimes(value: string | null) {
  return (value || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
}
function parseLines(value: string | null) {
  return (value || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
function resolveImage(input: string | null): { imageId: string | null; imageUrl: string | null } {
  if (!input) return { imageId: null, imageUrl: null };
  const s = input.trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  let id: string | null = m ? m[1] : null;
  if (!id && /^[A-Za-z0-9_-]{20,}$/.test(s)) id = s;
  if (id) return { imageId: id, imageUrl: `https://drive.google.com/thumbnail?id=${id}&sz=w1200` };
  if (/^https?:\/\//.test(s)) return { imageId: null, imageUrl: s };
  return { imageId: null, imageUrl: null };
}

export async function saveMotivationAction(
  _state: MotivationActionState,
  formData: FormData,
): Promise<MotivationActionState> {
  const session = await requireCurrentSession();
  if (!can(session, "motivation.manage")) {
    return { error: "Ông chưa có quyền cấu hình thông báo." };
  }

  const editId = text(formData, "editId");
  const kind = ["message", "event", "notice"].includes(text(formData, "kind"))
    ? text(formData, "kind")
    : "message";
  const title = text(formData, "title");
  if (!title) return { error: "Nhập tiêu đề / tên." };

  let uploadedImages: MotivationMedia[] = [];
  let uploadedThumbnail: MotivationMedia[] = [];
  try {
    [uploadedImages, uploadedThumbnail] = await Promise.all([
      uploadMotivationMedia(formData.getAll("imageFiles")),
      uploadMotivationMedia(formData.getAll("thumbnailFile")),
    ]);
  } catch (error) {
    return {
      error:
        error instanceof MotivationMediaError
          ? error.message
          : "Không tải được hình lên Google Drive.",
    };
  }

  const configuredMain = resolveImage(optionalText(formData, "image"));
  const uploadedMain = uploadedImages[0];
  const imageId = configuredMain.imageId || uploadedMain?.id || null;
  const imageUrl = configuredMain.imageUrl || uploadedMain?.url || null;
  const resolvedImages = parseLines(optionalText(formData, "images"))
    .map((value) => resolveImage(value))
    .filter((value) => value.imageId || value.imageUrl);
  for (const media of uploadedImages) {
    if (!resolvedImages.some((item) => item.imageId === media.id)) {
      resolvedImages.push({ imageId: media.id, imageUrl: media.url });
    }
  }
  if (imageId || imageUrl) {
    const firstAlreadyPresent = resolvedImages.some(
      (value) =>
        (imageId && value.imageId === imageId) ||
        (imageUrl && value.imageUrl === imageUrl),
    );
    if (!firstAlreadyPresent) resolvedImages.unshift({ imageId, imageUrl });
  }
  const configuredThumbnail = resolveImage(optionalText(formData, "thumbnail"));
  const thumbnail = uploadedThumbnail[0]
    ? {
        imageId: uploadedThumbnail[0].id,
        imageUrl: uploadedThumbnail[0].url,
      }
    : configuredThumbnail;
  const priorityRaw = Number.parseInt(text(formData, "priority"), 10);
  const autoRaw = Number.parseInt(text(formData, "autoDismissMs"), 10);
  const scope = ["all", "company", "department", "employee"].includes(text(formData, "targetScope"))
    ? text(formData, "targetScope")
    : "all";
  const displayChannel = ["webapp", "notifier", "both"].includes(
    text(formData, "displayChannel"),
  )
    ? text(formData, "displayChannel")
    : "both";
  const displayMode = [
    "toast",
    "center_popup",
    "sticky_warning",
    "image_portrait",
    "image_landscape",
    "image_only",
  ].includes(text(formData, "displayMode"))
    ? text(formData, "displayMode")
    : "toast";
  const popupContentMode = [
    "full",
    "hide_message",
    "hide_title",
    "image_only",
  ].includes(text(formData, "popupContentMode"))
    ? text(formData, "popupContentMode")
    : "full";
  const linkedTaskEnabled = checked(formData, "linkedTaskEnabled");
  const linkedTaskTitle = text(formData, "linkedTaskTitle");
  if (linkedTaskEnabled && !linkedTaskTitle) {
    return { error: "Nhập tên việc khi bật Giao việc kèm thông báo." };
  }
  const startAt = parseDate(optionalText(formData, "startAt"));
  const endAt = parseDate(optionalText(formData, "endAt"));
  if (startAt && endAt && endAt.getTime() <= startAt.getTime()) {
    return { error: "Thời gian kết thúc phải sau thời gian bắt đầu." };
  }
  const targetCompanies = list(formData, "targetCompanies");
  const targetDepartments = list(formData, "targetDepartments");
  const targetEmployees = list(formData, "targetEmployees");
  if (
    (scope === "company" && !targetCompanies.length) ||
    (scope === "department" && !targetDepartments.length) ||
    (scope === "employee" && !targetEmployees.length)
  ) {
    return { error: "Chọn ít nhất một đối tượng nhận theo phạm vi đã chọn." };
  }

  const data = {
    autoDismissMs: Number.isFinite(autoRaw) ? autoRaw : null,
    body: optionalText(formData, "body"),
    bypassSnooze: checked(formData, "bypassSnooze"),
    closePolicy: text(formData, "closePolicy") || "auto",
    displayChannel,
    displayMode,
    endAt,
    imageId,
    imageIds: resolvedImages
      .map((value) => value.imageId)
      .filter((value): value is string => Boolean(value)),
    imageUrl,
    imageUrls: resolvedImages
      .map((value) => value.imageUrl)
      .filter((value): value is string => Boolean(value)),
    kind,
    level: text(formData, "level") || "normal",
    linkedTask: linkedTaskEnabled
      ? {
          context: optionalText(formData, "linkedTaskContext"),
          deadlineSource: "event_end_at",
          output: optionalText(formData, "linkedTaskOutput"),
          reminderSource: "notifier_reminder_times",
          targetSource: "event_target_scope",
          title: linkedTaskTitle,
        }
      : Prisma.JsonNull,
    location: optionalText(formData, "location"),
    popupContentMode,
    priority: Number.isFinite(priorityRaw) ? priorityRaw : 1,
    reactionSetId: optionalText(formData, "reactionSetId"),
    reminderTimes: parseTimes(optionalText(formData, "reminderTimes")),
    requireAck: checked(formData, "requireAck"),
    saveResponse: checked(formData, "saveResponse"),
    startAt,
    targetCompanies,
    targetDepartments,
    targetEmployees,
    targetScope: scope,
    targetUrl: optionalText(formData, "targetUrl"),
    thumbnailId: thumbnail.imageId,
    thumbnailUrl: thumbnail.imageUrl,
    title,
  };

  const db = getDb();
  try {
    if (editId) {
      await db.motivationEvent.update({ data, where: { id: editId } });
    } else {
      await db.motivationEvent.create({
        data: { ...data, createdById: session.userId, status: "ACTIVE" },
      });
    }
    await db.auditLog.create({
      data: {
        action: editId ? "UPDATE" : "CREATE",
        actorId: session.userId,
        metadata: { kind, title },
        summary: `${editId ? "Cập nhật" : "Tạo"} mục ${kind} "${title}".`,
        targetId: editId || title,
        targetType: "MotivationEvent",
      },
    });
  } catch {
    return { error: "Không lưu được mục." };
  }

  revalidatePath(PATH);
  revalidatePath("/");
  return { success: editId ? "Đã cập nhật." : "Đã thêm." };
}

export async function setMotivationStatusAction(eventId: string, status: MotivationStatus) {
  const session = await requireCurrentSession();
  if (!can(session, "motivation.manage")) return;
  const db = getDb();
  await db.motivationEvent.update({
    data: { archivedAt: status === "ARCHIVED" ? new Date() : null, status },
    where: { id: eventId },
  });
  revalidatePath(PATH);
  revalidatePath("/");
}

export async function moveMotivationPriorityAction(
  eventId: string,
  direction: "up" | "down",
) {
  const session = await requireCurrentSession();
  if (!can(session, "motivation.manage")) return;
  const db = getDb();
  const ordered = await db.motivationEvent.findMany({
    orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
    select: { id: true, priority: true },
    where: { archivedAt: null },
  });
  const currentIndex = ordered.findIndex((item) => item.id === eventId);
  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
  const current = ordered[currentIndex];
  const target = ordered[targetIndex];
  if (current.priority === target.priority) {
    await db.motivationEvent.update({
      data: {
        priority:
          direction === "up" ? target.priority + 1 : target.priority - 1,
      },
      where: { id: current.id },
    });
  } else {
    await db.$transaction([
      db.motivationEvent.update({
        data: { priority: target.priority },
        where: { id: current.id },
      }),
      db.motivationEvent.update({
        data: { priority: current.priority },
        where: { id: target.id },
      }),
    ]);
  }
  revalidatePath(PATH);
  revalidatePath("/");
}

// ----- Bộ reaction (ReactionSet) -----
export type ReactionActionState = { error?: string; success?: string };

export async function saveReactionSetAction(
  _state: ReactionActionState,
  formData: FormData,
): Promise<ReactionActionState> {
  const session = await requireCurrentSession();
  if (!can(session, "motivation.manage")) {
    return { error: "Ông chưa có quyền cấu hình." };
  }

  const editId = text(formData, "editId");
  const name = text(formData, "name");
  if (!name) return { error: "Nhập tên bộ." };

  // options gửi lên dạng JSON: [{label, value, symbol, tone}]
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(formData, "options") || "[]");
  } catch {
    parsed = [];
  }
  const options = (Array.isArray(parsed) ? parsed : [])
    .map((raw) => {
      const o = raw as { label?: unknown; symbol?: unknown; tone?: unknown; value?: unknown };
      const label = String(o.label ?? "").trim();
      const value = String(o.value ?? label).trim() || slugify(label);
      return { label, symbol: String(o.symbol ?? "").trim(), tone: String(o.tone ?? "").trim(), value };
    })
    .filter((o) => o.label);

  if (options.length === 0) {
    return { error: "Chọn ít nhất một cảm xúc hoặc thêm một thẻ." };
  }

  const db = getDb();
  try {
    if (editId) {
      await db.reactionSet.update({ data: { name, options }, where: { id: editId } });
    } else {
      await db.reactionSet.create({
        data: { key: `${slugify(name)}-${Date.now().toString(36)}`, name, options, status: "ACTIVE" },
      });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: "Tên/mã bộ reaction đã tồn tại." };
    }
    return { error: editId ? "Không cập nhật được bộ reaction." : "Không tạo được bộ reaction." };
  }

  revalidatePath(PATH);
  return { success: editId ? "Đã cập nhật bộ reaction." : "Đã tạo bộ reaction." };
}

export async function setReactionSetStatusAction(setId: string, status: MotivationStatus) {
  const session = await requireCurrentSession();
  if (!can(session, "motivation.manage")) return;
  const db = getDb();
  await db.reactionSet.update({ data: { status }, where: { id: setId } });
  revalidatePath(PATH);
}

export async function deleteReactionSetAction(setId: string) {
  const session = await requireCurrentSession();
  if (!can(session, "motivation.manage")) return;
  const db = getDb();
  // Events tham chiếu sẽ tự set reactionSetId = null (onDelete: SetNull).
  await db.reactionSet.delete({ where: { id: setId } });
  revalidatePath(PATH);
  revalidatePath("/");
}
