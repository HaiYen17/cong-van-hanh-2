import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "@/generated/prisma/client";
import {
  callGeminiWithInlineFile,
  getGeminiConfig,
} from "@/lib/ai/gemini";

type ReviewRule = {
  blocking: boolean;
  code: string;
  condition: string;
  group: string;
  id: string;
  recommendation: string;
  severity: string;
};

type ReviewProcessingResult =
  | { message: string; ok: true }
  | { error: string; ok: false };

function objectValue(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function parseJsonObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseGeminiJson(text: string): Record<string, unknown> {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  try {
    return objectValue(JSON.parse(cleaned));
  } catch {
    return {
      findings: [],
      overallRisk: "UNKNOWN",
      rawText: text,
      summary: "Gemini đã trả kết quả nhưng chưa đúng cấu trúc JSON chuẩn.",
    };
  }
}

function toRule(
  record: {
    code: string | null;
    content: unknown;
    name: string | null;
  },
): ReviewRule | null {
  const content = objectValue(record.content);
  const recordType = stringValue(content["Loại cấu hình"]);
  if (recordType === "review-rule-group") return null;

  const details = parseJsonObject(content["Review Content JSON"]);
  const condition =
    stringValue(details.condition) ||
    stringValue(content["Review Text"]) ||
    stringValue(record.name);
  if (!condition) return null;

  return {
    blocking: stringValue(content["Review Is Blocking"]).toUpperCase() === "YES",
    code: stringValue(content["Review Code"]) || stringValue(record.code),
    condition,
    group:
      stringValue(details.groupName) ||
      stringValue(content["Review Group"]) ||
      "Khác",
    id: stringValue(content["Review ID"]) || stringValue(record.code),
    recommendation:
      stringValue(details.requiredAction) ||
      stringValue(details.commentTemplate),
    severity: stringValue(content["Review Severity"]) || "GREEN",
  };
}

export async function processReviewRequest(
  db: PrismaClient,
  input: {
    actorId: string;
    file: File;
    requestId: string;
  },
): Promise<ReviewProcessingResult> {
  const request = await db.request.findUnique({
    select: { payload: true, status: true },
    where: { id: input.requestId },
  });
  if (!request) return { error: "Không tìm thấy yêu cầu review.", ok: false };

  const { configured, model } = await getGeminiConfig(db);
  if (!configured) {
    const error = "Chưa cấu hình Gemini API key cho Bộ nguyên tắc AI.";
    await db.requestEvent.create({
      data: {
        actorId: input.actorId,
        note: error,
        requestId: input.requestId,
        type: "COMMENT",
      },
    });
    return { error, ok: false };
  }

  const records = await db.configurationRecord.findMany({
    orderBy: [{ sourceRow: "asc" }],
    select: { code: true, content: true, name: true },
    where: { recordType: "ai-review-rule" },
  });
  const rules = records
    .map(toRule)
    .filter((rule): rule is ReviewRule => Boolean(rule))
    .slice(0, 120);
  if (!rules.length) {
    const error = "Chưa có Bộ nguyên tắc AI đang hoạt động.";
    await db.requestEvent.create({
      data: {
        actorId: input.actorId,
        note: error,
        requestId: input.requestId,
        type: "COMMENT",
      },
    });
    return { error, ok: false };
  }

  const currentPayload = objectValue(request.payload);
  const prompt = [
    "Hãy đọc toàn bộ hồ sơ đính kèm và review theo đúng bộ nguyên tắc bên dưới.",
    "Chỉ đánh dấu nguyên tắc thực sự vi phạm; không suy đoán khi tài liệu không có bằng chứng.",
    "Mỗi finding phải có ruleId, ruleCode, group, severity, blocking, issue, evidence, recommendation.",
    "evidence phải trích ngắn vị trí/nội dung liên quan, không bịa số trang.",
    "Trả JSON với cấu trúc: {summary, overallRisk, findings, passedRuleCount, checkedRuleCount}.",
    "",
    `Thông tin yêu cầu: ${JSON.stringify({
      companyName: currentPayload.companyName,
      documentTypeName: currentPayload.documentTypeName,
      partner: currentPayload.partner,
      summary: currentPayload.summary,
    })}`,
    "",
    `Bộ nguyên tắc (${rules.length} mục):`,
    JSON.stringify(rules),
  ].join("\n");

  const result = await callGeminiWithInlineFile(db, {
    bytes: Buffer.from(await input.file.arrayBuffer()),
    mimeType: input.file.type || "application/octet-stream",
    prompt,
    system:
      "Bạn là chuyên viên pháp chế nội bộ. Review thận trọng, bám sát tài liệu và bộ nguyên tắc được cung cấp. Tuyệt đối chỉ trả JSON.",
  });

  if (!result.ok) {
    await db.requestEvent.create({
      data: {
        actorId: input.actorId,
        note: result.error,
        requestId: input.requestId,
        type: "COMMENT",
      },
    });
    return result;
  }

  const reviewResult = parseGeminiJson(result.text);
  const completedAt = new Date();
  await db.$transaction([
    db.request.update({
      data: {
        completedAt,
        payload: {
          ...currentPayload,
          reviewAiModel: model,
          reviewProcessedAt: completedAt.toISOString(),
          reviewResult,
          reviewRuleCount: rules.length,
        } as Prisma.InputJsonValue,
        status: "COMPLETED",
      },
      where: { id: input.requestId },
    }),
    db.requestEvent.create({
      data: {
        actorId: input.actorId,
        fromStatus: request.status,
        note: `Gemini đã review theo ${rules.length} nguyên tắc.`,
        requestId: input.requestId,
        toStatus: "COMPLETED",
        type: "COMPLETED",
      },
    }),
  ]);

  return {
    message: `AI đã review xong theo ${rules.length} nguyên tắc.`,
    ok: true,
  };
}
