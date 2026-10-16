import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getMeetingRuntimeConfig } from "@/lib/meetings/config";

function apiBase(region: string) {
  return `https://${region}.recall.ai/api/v1`;
}

function detailText(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const payload = value as { code?: unknown; detail?: unknown; message?: unknown };
  return String(payload.detail || payload.message || payload.code || "").slice(0, 2_000);
}

type RecallBotArtifact = {
  detail?: string;
  recordings?: {
    completed_at?: string | null;
    expires_at?: string | null;
    media_shortcuts?: {
      audio_mixed?: {
        data?: { download_url?: string | null } | null;
        format?: string | null;
      } | null;
      video_mixed?: {
        data?: { download_url?: string | null } | null;
        format?: string | null;
      } | null;
    } | null;
    status?: { code?: string | null } | null;
  }[];
};

export function recallRecordingDownload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const recordings = Array.isArray((payload as RecallBotArtifact).recordings)
    ? (payload as RecallBotArtifact).recordings || []
    : [];
  const ready = recordings
    .filter((recording) => recording.status?.code === "done")
    .sort((left, right) =>
      String(right.completed_at || "").localeCompare(String(left.completed_at || "")),
    );
  for (const recording of ready) {
    const audioUrl = String(
      recording.media_shortcuts?.audio_mixed?.data?.download_url || "",
    ).trim();
    if (audioUrl) {
      return {
        expiresAt: recording.expires_at || null,
        format: recording.media_shortcuts?.audio_mixed?.format || "mp3",
        kind: "audio" as const,
        url: audioUrl,
      };
    }
    const legacyVideoUrl = String(
      recording.media_shortcuts?.video_mixed?.data?.download_url || "",
    ).trim();
    if (legacyVideoUrl) {
      return {
        expiresAt: recording.expires_at || null,
        format: recording.media_shortcuts?.video_mixed?.format || "mp4",
        kind: "legacy-video" as const,
        url: legacyVideoUrl,
      };
    }
  }
  return null;
}

async function existingRemoteBot(input: {
  apiKey: string;
  meetingId: string;
  region: string;
}) {
  const response = await fetch(
    `${apiBase(input.region)}/bot/?metadata__meeting_id=${encodeURIComponent(input.meetingId)}`,
    {
      headers: {
        accept: "application/json",
        authorization: `Token ${input.apiKey}`,
      },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    results?: { id?: string; join_at?: string; status_changes?: Prisma.InputJsonValue }[];
  };
  return payload.results?.find((bot) => bot.id) || null;
}

export async function scheduleRecallBot(meetingId: string) {
  const db = getDb();
  const [meeting, config] = await Promise.all([
    db.meeting.findUnique({
      include: { botRuns: { orderBy: { createdAt: "desc" }, take: 1 } },
      where: { id: meetingId },
    }),
    getMeetingRuntimeConfig(),
  ]);
  if (!meeting) return { error: "Không tìm thấy cuộc họp.", ok: false as const };
  if (!meeting.aiEnabled || !meeting.recallEnabled) return { ok: true as const, skipped: true };
  const existing = meeting.botRuns[0];
  if (existing?.providerBotId && existing.status !== "FAILED" && existing.status !== "CANCELLED") {
    return { botId: existing.providerBotId, ok: true as const };
  }
  if (!config.recallEnabled) {
    return { error: "Recall đang tắt trong cấu hình Lịch họp.", ok: false as const };
  }
  if (!config.recallApiKey) {
    return { error: "Chưa cấu hình Recall API key.", ok: false as const };
  }
  if (!meeting.googleMeetUrl) {
    return { error: "Cuộc họp chưa có Google Meet URL.", ok: false as const };
  }
  if (meeting.endsAt <= new Date()) {
    return { error: "Cuộc họp đã kết thúc nên không thể lên lịch Recall.", ok: false as const };
  }

  const joinAt = new Date(
    meeting.startsAt.getTime() - Math.max(0, config.botJoinLeadMinutes) * 60_000,
  );
  let botRun = existing;
  if (!botRun || botRun.providerBotId) {
    botRun = await db.meetingBotRun.create({
      data: { joinAt, meetingId: meeting.id, status: "SCHEDULED" },
    });
  } else {
    botRun = await db.meetingBotRun.update({
      data: { error: null, joinAt, status: "SCHEDULED" },
      where: { id: botRun.id },
    });
  }

  try {
    const remote = await existingRemoteBot({
      apiKey: config.recallApiKey,
      meetingId: meeting.id,
      region: config.recallRegion,
    });
    if (remote?.id) {
      await db.meetingBotRun.update({
        data: {
          error: null,
          providerBotId: remote.id,
          rawMetadata: {
            joinAt: remote.join_at || joinAt.toISOString(),
            recoveredByMetadata: true,
            statusChanges: remote.status_changes || [],
          },
          status: "SCHEDULED",
        },
        where: { id: botRun.id },
      });
      return { botId: remote.id, ok: true as const, recovered: true };
    }
    const response = await fetch(`${apiBase(config.recallRegion)}/bot/`, {
      body: JSON.stringify({
        bot_name: "Thuan Viet Meeting Notes",
        chat: {
          on_bot_join: {
            message:
              "Xin chào, cuộc họp này đang được ghi âm và tạo biên bản AI theo chính sách nội bộ Thuận Việt.",
            pin: true,
            send_to: "everyone",
          },
        },
        join_at: joinAt.toISOString(),
        meeting_url: meeting.googleMeetUrl,
        metadata: {
          meeting_code: meeting.code,
          meeting_id: meeting.id,
          source: "thuan-viet-v3",
        },
        recording_config: {
          audio_mixed_mp3: {},
          retention: {
            hours: Math.max(1, config.audioRetentionDays) * 24,
            type: "timed",
          },
          transcript: { provider: { recallai_streaming: {} } },
          video_mixed_layout: "audio_only",
          video_mixed_mp4: null,
        },
      }),
      headers: {
        accept: "application/json",
        authorization: `Token ${config.recallApiKey}`,
        "content-type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      join_at?: string;
      status_changes?: Prisma.InputJsonValue;
    };
    if (!response.ok || !payload.id) {
      throw new Error(
        detailText(payload) || `Recall từ chối tạo bot (HTTP ${response.status}).`,
      );
    }
    await db.meetingBotRun.update({
      data: {
        error: null,
        providerBotId: payload.id,
        rawMetadata: {
          joinAt: payload.join_at || joinAt.toISOString(),
          statusChanges: payload.status_changes || [],
        },
        status: "SCHEDULED",
      },
      where: { id: botRun.id },
    });
    return { botId: payload.id, ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Lỗi Recall");
    await db.meetingBotRun.update({
      data: { error: message.slice(0, 2_000), status: "FAILED" },
      where: { id: botRun.id },
    });
    return { error: message, ok: false as const };
  }
}

export async function getRecallRecordingDownload(meetingId: string) {
  const db = getDb();
  const [botRun, config] = await Promise.all([
    db.meetingBotRun.findFirst({
      orderBy: { createdAt: "desc" },
      where: { meetingId, providerBotId: { not: null } },
    }),
    getMeetingRuntimeConfig(),
  ]);
  if (!botRun?.providerBotId) {
    return { error: "Cuộc họp chưa có bản ghi Recall.", ok: false as const };
  }
  if (!config.recallApiKey) {
    return { error: "Chưa cấu hình Recall API key.", ok: false as const };
  }
  try {
    const response = await fetch(
      `${apiBase(config.recallRegion)}/bot/${encodeURIComponent(botRun.providerBotId)}/`,
      {
        headers: {
          accept: "application/json",
          authorization: `Token ${config.recallApiKey}`,
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
    const payload = (await response.json().catch(() => ({}))) as RecallBotArtifact;
    if (!response.ok) {
      throw new Error(
        detailText(payload) || `Recall trả lỗi ${response.status} khi đọc bản ghi.`,
      );
    }
    const download = recallRecordingDownload(payload);
    if (!download) {
      return {
        error: "Bản ghi đang xử lý, đã hết hạn hoặc Recall chưa trả tệp tải xuống.",
        ok: false as const,
      };
    }
    return { ...download, ok: true as const };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Không đọc được bản ghi Recall.",
      ok: false as const,
    };
  }
}

export async function cancelRecallBot(meetingId: string) {
  const db = getDb();
  const [botRun, config] = await Promise.all([
    db.meetingBotRun.findFirst({
      orderBy: { createdAt: "desc" },
      where: { meetingId, providerBotId: { not: null } },
    }),
    getMeetingRuntimeConfig(),
  ]);
  if (!botRun?.providerBotId || !config.recallApiKey) return { ok: true as const };
  try {
    const response = await fetch(
      `${apiBase(config.recallRegion)}/bot/${encodeURIComponent(botRun.providerBotId)}/`,
      {
        headers: { authorization: `Token ${config.recallApiKey}` },
        method: "DELETE",
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!response.ok && ![404, 405, 410].includes(response.status)) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(detailText(payload) || `Recall trả lỗi ${response.status}.`);
    }
    await db.meetingBotRun.update({
      data: {
        error: response.status === 405 ? "Bot đã bắt đầu vào phòng; cần xử lý bằng remove-from-call." : null,
        status: "CANCELLED",
      },
      where: { id: botRun.id },
    });
    return { ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Lỗi Recall");
    await db.meetingBotRun.update({ data: { error: message.slice(0, 2_000) }, where: { id: botRun.id } });
    return { error: message, ok: false as const };
  }
}
