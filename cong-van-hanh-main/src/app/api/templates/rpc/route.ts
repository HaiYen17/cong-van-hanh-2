import { getCurrentSession } from "@/lib/auth/session";
import {
  dispatchTemplateRpc,
  TemplateRuntimeError,
} from "@/lib/templates/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { message: "Phiên đăng nhập đã hết hạn.", ok: false },
        { status: 401 },
      );
    }
    const body = asRecord(await request.json());
    const method = String(body.method || "").trim();
    if (!method) {
      throw new TemplateRuntimeError("Thiếu phương thức xử lý.");
    }
    const result = await dispatchTemplateRpc(
      session,
      method,
      asRecord(body.payload),
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof TemplateRuntimeError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    console.error("Template RPC failed", error);
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Không xử lý được yêu cầu Biểu mẫu.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
