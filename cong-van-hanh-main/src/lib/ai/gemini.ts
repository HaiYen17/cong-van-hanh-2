// Dịch vụ AI Gemini (xương sống Tầng 2). Khung sẵn — đọc key/model từ Cấu hình Tổng
// (SystemSetting: ai.geminiApiKey, ai.geminiModel). Khi user cấp key là dùng được ngay.
import type { PrismaClient } from "@/generated/prisma/client";
import { openConfigSecret } from "@/lib/config/secret-vault";

async function setting(db: PrismaClient, key: string): Promise<string | null> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function getGeminiConfig(db: PrismaClient) {
  const apiKey = openConfigSecret(
    (await setting(db, "ai.geminiApiKey")) ||
      (await setting(db, "ai.reviewGeminiApiKey")),
  );
  const model =
    (await setting(db, "ai.geminiModel")) ||
    (await setting(db, "ai.reviewGeminiModel")) ||
    (await setting(db, "ai.model")) ||
    "gemini-3.1-flash-lite";
  return { apiKey, configured: Boolean(apiKey), model };
}

export type GeminiResult = { ok: true; text: string } | { error: string; ok: false };

function geminiEndpoint(model: string, apiKey: string) {
  const normalizedModel = model.replace(/^models\//i, "");
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(normalizedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

async function geminiError(res: Response): Promise<GeminiResult> {
  const payload = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; status?: string };
  };
  const detail = String(payload.error?.message || "").trim();
  if (res.status === 429 && /prepayment credits are depleted/i.test(detail)) {
    return {
      error:
        "Gemini đã hết credits Prepay. Vui lòng nạp thêm tại Google AI Studio Billing rồi thử lại.",
      ok: false,
    };
  }
  return {
    error: `Gemini trả lỗi ${res.status}${detail ? `: ${detail}` : "."}`.slice(
      0,
      1_000,
    ),
    ok: false,
  };
}

export async function callGemini(
  db: PrismaClient,
  opts: { prompt: string; responseMimeType?: "application/json"; system?: string },
): Promise<GeminiResult> {
  const { apiKey, model } = await getGeminiConfig(db);
  if (!apiKey) {
    return { error: "Chưa cấu hình Gemini API key (Cấu hình Tổng → AI).", ok: false };
  }
  try {
    const res = await fetch(
      geminiEndpoint(model, apiKey),
      {
        body: JSON.stringify({
          contents: [{ parts: [{ text: opts.prompt }] }],
          ...(opts.responseMimeType
            ? {
                generationConfig: {
                  responseMimeType: opts.responseMimeType,
                  temperature: 0.1,
                },
              }
            : {}),
          ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(45_000),
      },
    );
    if (!res.ok) return geminiError(res);
    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("");
    return { ok: true, text };
  } catch {
    return { error: "Không gọi được Gemini (mạng/định dạng).", ok: false };
  }
}

export async function callGeminiWithInlineFile(
  db: PrismaClient,
  opts: {
    bytes: Buffer;
    mimeType: string;
    prompt: string;
    system?: string;
  },
): Promise<GeminiResult> {
  const { apiKey, model } = await getGeminiConfig(db);
  if (!apiKey) {
    return {
      error: "Chưa cấu hình Gemini API key (Cấu hình Tổng → AI).",
      ok: false,
    };
  }

  try {
    const res = await fetch(
      geminiEndpoint(model, apiKey),
      {
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: opts.prompt },
                {
                  inlineData: {
                    data: opts.bytes.toString("base64"),
                    mimeType: opts.mimeType || "application/octet-stream",
                  },
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.1,
          },
          ...(opts.system
            ? { systemInstruction: { parts: [{ text: opts.system }] } }
            : {}),
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
        signal: AbortSignal.timeout(75_000),
      },
    );
    if (!res.ok) return geminiError(res);

    const data = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("");
    return text.trim()
      ? { ok: true, text }
      : { error: "Gemini không trả nội dung review.", ok: false };
  } catch {
    return {
      error: "Không gọi được Gemini để review tệp (mạng/định dạng).",
      ok: false,
    };
  }
}
