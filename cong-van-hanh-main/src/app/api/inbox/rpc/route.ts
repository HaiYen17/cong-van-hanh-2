import { getCurrentSession } from "@/lib/auth/session";
import {
  dispatchInboxRpc,
  InboxRuntimeError,
} from "@/lib/requests/inbox-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function record(value: unknown): Record<string, unknown> {
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
    const body = record(await request.json());
    const method = String(body.method || "").trim();
    if (!method) throw new InboxRuntimeError("Thiếu phương thức xử lý.");
    const args = Array.isArray(body.args)
      ? body.args
      : body.payload !== undefined
        ? [body.payload]
        : [];
    const result = await dispatchInboxRpc(session, method, args);
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof InboxRuntimeError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    console.error("Inbox RPC failed", error);
    return Response.json(
      {
        message: "Không xử lý được yêu cầu đơn hàng trên PostgreSQL.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
