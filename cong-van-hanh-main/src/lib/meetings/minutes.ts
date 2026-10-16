import "server-only";

import { createHash } from "node:crypto";

import { Prisma } from "@/generated/prisma/client";
import { callGemini, getGeminiConfig } from "@/lib/ai/gemini";
import { getDb } from "@/lib/db";

type MinutesPayload = {
  action_items?: {
    assignee_name?: string;
    confidence?: number;
    description?: string;
    due_at?: string | null;
    source_text?: string;
    source_timestamp_seconds?: number;
    title?: string;
  }[];
  decisions?: string[];
  discussion_sections?: { notes?: string; topic?: string }[];
  open_questions?: string[];
  risks?: string[];
  summary?: string;
};

function parseJson(text: string): MinutesPayload {
  const normalized = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const parsed = JSON.parse(normalized) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini trả biên bản không đúng cấu trúc JSON.");
  }
  return parsed as MinutesPayload;
}

function text(value: unknown, max = 20_000) {
  return String(value || "").trim().slice(0, max);
}

function stringList(value: unknown, maxItems = 100) {
  return Array.isArray(value)
    ? value.map((item) => text(item, 2_000)).filter(Boolean).slice(0, maxItems)
    : [];
}

function normalize(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase();
}

function optionalDate(value: unknown) {
  const raw = text(value, 100);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

export async function generateMeetingMinutes(meetingId: string) {
  const db = getDb();
  const meeting = await db.meeting.findUnique({
    include: {
      attendees: { include: { employee: { include: { user: true } } } },
      minutes: true,
      transcript: true,
    },
    where: { id: meetingId },
  });
  if (!meeting?.transcript?.contentText) {
    return { error: "Chưa có transcript để tạo biên bản.", ok: false as const };
  }
  if (!meeting.aiEnabled) return { ok: true as const, skipped: true };

  const minutes = meeting.minutes
    ? await db.meetingMinutes.update({
        data: { error: null, status: "PROCESSING" },
        where: { id: meeting.minutes.id },
      })
    : await db.meetingMinutes.create({
        data: { meetingId: meeting.id, status: "PROCESSING" },
      });
  const attendeeDirectory = meeting.attendees.map((attendee) => ({
    email: attendee.email,
    employeeId: attendee.employeeId,
    name: attendee.displayName,
    userId: attendee.userId,
  }));
  const prompt = [
    `Tên cuộc họp: ${meeting.title}`,
    `Mã: ${meeting.code}`,
    `Nội dung dự kiến: ${meeting.agenda}`,
    `Thành phần: ${attendeeDirectory.map((item) => `${item.name} <${item.email}>`).join(", ")}`,
    "",
    "TRANSCRIPT:",
    meeting.transcript.contentText,
    "",
    "Hãy trả đúng một JSON object theo cấu trúc:",
    JSON.stringify({
      action_items: [
        {
          assignee_name: "Tên người phụ trách nếu nghe rõ, không chắc thì để trống",
          confidence: 0.9,
          description: "Chi tiết đầu việc",
          due_at: "ISO-8601 hoặc null",
          source_text: "Câu ngắn trong transcript làm căn cứ",
          source_timestamp_seconds: 123,
          title: "Tên đầu việc",
        },
      ],
      decisions: ["Quyết định đã chốt"],
      discussion_sections: [{ notes: "Nội dung chính", topic: "Chủ đề" }],
      open_questions: ["Vấn đề còn mở"],
      risks: ["Rủi ro hoặc phụ thuộc"],
      summary: "Tóm tắt điều hành ngắn gọn",
    }),
  ].join("\n");
  const result = await callGemini(db, {
    prompt,
    responseMimeType: "application/json",
    system:
      "Bạn là thư ký cuộc họp doanh nghiệp Việt Nam. Chỉ dùng sự kiện có trong transcript, không bịa người phụ trách, hạn chót hay quyết định. Nếu không chắc hãy để trống hoặc đưa vào open_questions. Giữ nguyên tiếng Việt.",
  });
  if (!result.ok) {
    await db.meetingMinutes.update({
      data: { error: result.error, status: "FAILED" },
      where: { id: minutes.id },
    });
    return result;
  }

  try {
    const payload = parseJson(result.text);
    const summary = text(payload.summary, 30_000);
    if (!summary) throw new Error("Gemini không tạo phần tóm tắt.");
    const decisions = stringList(payload.decisions);
    const risks = stringList(payload.risks);
    const openQuestions = stringList(payload.open_questions);
    const sections = Array.isArray(payload.discussion_sections)
      ? payload.discussion_sections
          .map((section) => ({
            notes: text(section?.notes, 8_000),
            topic: text(section?.topic, 500),
          }))
          .filter((section) => section.notes || section.topic)
          .slice(0, 100)
      : [];
    const actions = Array.isArray(payload.action_items)
      ? payload.action_items
          .map((item) => ({
            assigneeName: text(item?.assignee_name, 300),
            confidence: Math.min(1, Math.max(0, Number(item?.confidence) || 0)),
            description: text(item?.description, 5_000),
            dueAt: optionalDate(item?.due_at),
            sourceText: text(item?.source_text, 2_000),
            sourceTimestampSeconds: Math.max(0, Math.round(Number(item?.source_timestamp_seconds) || 0)),
            title: text(item?.title, 500),
          }))
          .filter((item) => item.title)
          .slice(0, 100)
      : [];
    const { model } = await getGeminiConfig(db);
    const content = {
      actionItems: actions,
      decisions,
      discussionSections: sections,
      openQuestions,
      risks,
      summary,
    };
    const nextVersion = minutes.currentVersion + 1;

    await db.$transaction(async (tx) => {
      await tx.meetingActionItem.deleteMany({
        where: { meetingId: meeting.id, status: "DRAFT" },
      });
      await tx.meetingMinutes.update({
        data: {
          content: content as Prisma.InputJsonValue,
          currentVersion: nextVersion,
          decisions,
          error: null,
          generatedAt: new Date(),
          generatedByModel: model,
          openQuestions,
          promptVersion: "meeting-minutes-v1",
          risks,
          sourceTranscriptChecksum:
            meeting.transcript?.checksum ||
            createHash("sha256").update(meeting.transcript?.contentText || "").digest("hex"),
          status: "DRAFT",
          summary,
        },
        where: { id: minutes.id },
      });
      await tx.meetingMinutesVersion.create({
        data: {
          content: content as Prisma.InputJsonValue,
          minutesId: minutes.id,
          source: "AI",
          version: nextVersion,
        },
      });
      for (const [index, action] of actions.entries()) {
        const assignee = attendeeDirectory.find((candidate) => {
          const wanted = normalize(action.assigneeName);
          const candidateName = normalize(candidate.name);
          const candidateEmail = normalize(candidate.email);
          return Boolean(
            wanted &&
              (wanted === candidateName ||
                wanted === candidateEmail ||
                candidateName.includes(wanted) ||
                wanted.includes(candidateName)),
          );
        });
        await tx.meetingActionItem.create({
          data: {
            assigneeEmployeeId: assignee?.employeeId,
            assigneeNameSnapshot: action.assigneeName || null,
            assigneeUserId: assignee?.userId,
            confidence: action.confidence,
            description: action.description || null,
            dueAt: action.dueAt,
            meetingId: meeting.id,
            minutesId: minutes.id,
            sortOrder: index,
            sourceText: action.sourceText || null,
            sourceTimestampSeconds: action.sourceTimestampSeconds,
            title: action.title,
          },
        });
      }
      await tx.meeting.update({
        data: { status: "COMPLETED" },
        where: { id: meeting.id },
      });
    });
    return { minutesId: minutes.id, ok: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được JSON từ Gemini.";
    await db.meetingMinutes.update({
      data: { error: message.slice(0, 2_000), status: "FAILED" },
      where: { id: minutes.id },
    });
    return { error: message, ok: false as const };
  }
}
