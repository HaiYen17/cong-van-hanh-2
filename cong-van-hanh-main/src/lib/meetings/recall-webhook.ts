import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { getDb } from "@/lib/db";
import { getMeetingRuntimeConfig } from "@/lib/meetings/config";
import { generateMeetingMinutes } from "@/lib/meetings/minutes";

type RecallWebhookPayload = {
  data?: {
    bot?: { id?: string; metadata?: Record<string, unknown> };
    bot_id?: string;
    data?: { code?: string; sub_code?: string | null; updated_at?: string };
    recording?: { id?: string; metadata?: Record<string, unknown> };
    status?: {
      code?: string;
      created_at?: string;
      message?: string | null;
      recording_id?: string;
      sub_code?: string | null;
    };
    transcript?: { id?: string; metadata?: Record<string, unknown> };
  };
  event?: string;
};

type TranscriptEntry = {
  language_code?: string;
  participant?: { email?: string | null; id?: number | null; name?: string | null };
  words?: {
    end_timestamp?: { absolute?: string | null; relative?: number };
    start_timestamp?: { absolute?: string | null; relative?: number };
    text?: string;
  }[];
};

function safeEqual(left: Buffer, right: Buffer) {
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyRecallWebhook(input: {
  headers: Headers;
  payload: string;
  secret: string;
}) {
  const id = input.headers.get("webhook-id") || input.headers.get("svix-id") || "";
  const timestamp =
    input.headers.get("webhook-timestamp") || input.headers.get("svix-timestamp") || "";
  const signatures =
    input.headers.get("webhook-signature") || input.headers.get("svix-signature") || "";
  if (!input.secret.startsWith("whsec_")) throw new Error("Recall verification secret không hợp lệ.");
  if (!id || !timestamp || !signatures) throw new Error("Thiếu header xác thực Recall webhook.");
  const epochSeconds = Number(timestamp);
  if (!Number.isFinite(epochSeconds) || Math.abs(Date.now() / 1000 - epochSeconds) > 5 * 60) {
    throw new Error("Recall webhook đã quá hạn xác thực.");
  }
  const key = Buffer.from(input.secret.slice("whsec_".length), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${input.payload}`)
    .digest();
  const valid = signatures.split(" ").some((versioned) => {
    const [version, signature] = versioned.split(",");
    if (version !== "v1" || !signature) return false;
    try {
      return safeEqual(expected, Buffer.from(signature, "base64"));
    } catch {
      return false;
    }
  });
  if (!valid) throw new Error("Chữ ký Recall webhook không khớp.");
  return { id };
}

function objectPayload(value: Prisma.JsonValue): RecallWebhookPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as RecallWebhookPayload;
}

function botId(payload: RecallWebhookPayload) {
  return payload.data?.bot?.id || payload.data?.bot_id || "";
}

function meetingIdFromMetadata(payload: RecallWebhookPayload) {
  return String(
    payload.data?.bot?.metadata?.meeting_id ||
      payload.data?.recording?.metadata?.meeting_id ||
      payload.data?.transcript?.metadata?.meeting_id ||
      "",
  );
}

export function recallBotStatusForEvent(event: string, code = "") {
  const normalized = event.startsWith("bot.") && event !== "bot.status_change"
    ? event.slice("bot.".length)
    : code;
  if (normalized === "joining_call") return "JOINING" as const;
  if (normalized === "in_waiting_room") return "WAITING_ROOM" as const;
  if (["in_call_not_recording", "in_call_recording"].includes(normalized)) return "IN_CALL" as const;
  if (normalized === "call_ended") return "PROCESSING" as const;
  if (normalized === "done") return "COMPLETED" as const;
  if (["fatal", "recording_permission_denied"].includes(normalized)) return "FAILED" as const;
  return null;
}

function timecode(seconds: number) {
  const safe = Math.max(0, Math.round(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(remaining).padStart(2, "0")}`;
}

async function fetchRecallTranscript(transcriptId: string) {
  const config = await getMeetingRuntimeConfig();
  if (!config.recallApiKey) throw new Error("Chưa cấu hình Recall API key.");
  const response = await fetch(
    `https://${config.recallRegion}.recall.ai/api/v1/transcript/${encodeURIComponent(transcriptId)}/`,
    {
      headers: {
        accept: "application/json",
        authorization: `Token ${config.recallApiKey}`,
      },
      signal: AbortSignal.timeout(30_000),
    },
  );
  const artifact = (await response.json()) as {
    data?: { download_url?: string };
    detail?: string;
  };
  if (!response.ok || !artifact.data?.download_url) {
    throw new Error(artifact.detail || `Không lấy được transcript Recall (HTTP ${response.status}).`);
  }
  const download = await fetch(artifact.data.download_url, {
    signal: AbortSignal.timeout(45_000),
  });
  if (!download.ok) throw new Error(`Không tải được nội dung transcript (HTTP ${download.status}).`);
  const raw = (await download.json()) as unknown;
  if (!Array.isArray(raw)) throw new Error("Transcript Recall không đúng cấu trúc danh sách.");

  const segments = (raw as TranscriptEntry[])
    .map((entry) => {
      const words = Array.isArray(entry.words) ? entry.words : [];
      const content = words.map((word) => String(word.text || "")).join(" ").replace(/\s+/g, " ").trim();
      if (!content) return null;
      const startSeconds = Number(words[0]?.start_timestamp?.relative) || 0;
      const endSeconds = Number(words.at(-1)?.end_timestamp?.relative) || startSeconds;
      return {
        endSeconds,
        languageCode: String(entry.language_code || ""),
        speaker: String(entry.participant?.name || "Người nói chưa xác định"),
        speakerEmail: String(entry.participant?.email || ""),
        speakerId: entry.participant?.id ?? null,
        startSeconds,
        text: content,
      };
    })
    .filter((segment): segment is NonNullable<typeof segment> => Boolean(segment));
  const contentText = segments
    .map((segment) => `[${timecode(segment.startSeconds)}] ${segment.speaker}: ${segment.text}`)
    .join("\n");
  return {
    checksum: createHash("sha256").update(contentText).digest("hex"),
    contentText,
    language: segments.find((segment) => segment.languageCode)?.languageCode || "vi",
    segments,
    wordCount: segments.reduce(
      (count, segment) => count + segment.text.split(/\s+/).filter(Boolean).length,
      0,
    ),
  };
}

export async function processRecallWebhook(webhookEventId: string) {
  const db = getDb();
  const record = await db.meetingWebhookEvent.findUnique({ where: { id: webhookEventId } });
  if (!record || record.processedAt) return;
  const payload = objectPayload(record.payload);
  const event = String(payload.event || record.eventType);
  let run = await db.meetingBotRun.findUnique({
    where: { providerBotId: botId(payload) || "__missing__" },
  });
  if (!run) {
    const metadataMeetingId = meetingIdFromMetadata(payload);
    if (metadataMeetingId) {
      run = await db.meetingBotRun.findFirst({
        orderBy: { createdAt: "desc" },
        where: { meetingId: metadataMeetingId },
      });
    }
  }
  if (!run) {
    await db.meetingWebhookEvent.update({
      data: { error: "Không ánh xạ được webhook với MeetingBotRun." },
      where: { id: record.id },
    });
    return;
  }
  await db.meetingWebhookEvent.update({ data: { meetingId: run.meetingId }, where: { id: record.id } });

  try {
    if (event.startsWith("bot.")) {
      const legacyStatus = payload.data?.status;
      const currentStatus = payload.data?.data;
      const statusCode = String(
        currentStatus?.code || legacyStatus?.code || "",
      );
      const statusSubCode = String(
        currentStatus?.sub_code || legacyStatus?.sub_code || "",
      );
      const mapped = recallBotStatusForEvent(event, statusCode);
      if (mapped) {
        await db.meetingBotRun.update({
          data: {
            ...(mapped === "IN_CALL" ? { joinedAt: new Date() } : {}),
            ...(["PROCESSING", "COMPLETED", "FAILED"].includes(mapped)
              ? { leftAt: new Date() }
              : {}),
            error:
              mapped === "FAILED"
                ? String(
                    legacyStatus?.message ||
                      statusSubCode ||
                      "Recall bot thất bại",
                  )
                : null,
            status: mapped,
            statusMessage: legacyStatus?.message || null,
            statusSubCode: statusSubCode || null,
            webhookLastReceivedAt: new Date(),
          },
          where: { id: run.id },
        });
      }
    } else if (event.startsWith("recording.")) {
      const artifactStatus = event.split(".")[1]?.toUpperCase() || "UNKNOWN";
      await db.meetingBotRun.update({
        data: {
          recordingStatus: artifactStatus,
          webhookLastReceivedAt: new Date(),
        },
        where: { id: run.id },
      });
    } else if (event.startsWith("transcript.")) {
      const artifactStatus = event.split(".")[1]?.toUpperCase() || "UNKNOWN";
      const transcriptId = String(payload.data?.transcript?.id || "");
      await db.meetingBotRun.update({
        data: { transcriptStatus: artifactStatus, webhookLastReceivedAt: new Date() },
        where: { id: run.id },
      });
      if (event === "transcript.processing") {
        await db.meetingTranscript.upsert({
          create: {
            meetingId: run.meetingId,
            providerTranscriptId: transcriptId || null,
            status: "PROCESSING",
          },
          update: { providerTranscriptId: transcriptId || undefined, status: "PROCESSING" },
          where: { meetingId: run.meetingId },
        });
      } else if (event === "transcript.failed") {
        const error = String(payload.data?.data?.sub_code || "Recall không tạo được transcript.");
        await db.meetingTranscript.upsert({
          create: {
            error,
            meetingId: run.meetingId,
            providerTranscriptId: transcriptId || null,
            status: "FAILED",
          },
          update: { error, providerTranscriptId: transcriptId || undefined, status: "FAILED" },
          where: { meetingId: run.meetingId },
        });
      } else if (event === "transcript.deleted") {
        await db.meetingTranscript.updateMany({
          data: { contentText: null, purgedAt: new Date(), segments: [], status: "PURGED" },
          where: { meetingId: run.meetingId },
        });
      } else if (event === "transcript.done" && transcriptId) {
        const transcript = await fetchRecallTranscript(transcriptId);
        const config = await getMeetingRuntimeConfig();
        await db.meetingTranscript.upsert({
          create: {
            ...transcript,
            expiresAt: new Date(Date.now() + config.transcriptRetentionDays * 86_400_000),
            meetingId: run.meetingId,
            providerTranscriptId: transcriptId,
            receivedAt: new Date(),
            status: "READY",
          },
          update: {
            ...transcript,
            error: null,
            expiresAt: new Date(Date.now() + config.transcriptRetentionDays * 86_400_000),
            providerTranscriptId: transcriptId,
            receivedAt: new Date(),
            status: "READY",
          },
          where: { meetingId: run.meetingId },
        });
        await db.meetingBotRun.update({
          data: { status: "COMPLETED", transcriptStatus: "DONE" },
          where: { id: run.id },
        });
        await generateMeetingMinutes(run.meetingId);
      }
    }
    await db.meetingWebhookEvent.update({
      data: { error: null, processedAt: new Date() },
      where: { id: record.id },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Lỗi xử lý webhook");
    await db.meetingWebhookEvent.update({
      data: { error: message.slice(0, 2_000) },
      where: { id: record.id },
    });
    throw error;
  }
}
