import { getCurrentSession } from "@/lib/auth/session";
import {
  dispatchWorkshopRpc,
  WorkshopError,
} from "@/lib/workshop/runtime";

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
    const method = String(body.method ?? "").trim();
    if (!method) throw new WorkshopError("Thiếu phương thức xử lý.");
    const result = await dispatchWorkshopRpc(session, method, body.payload);
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof WorkshopError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    console.error("Workshop PostgreSQL RPC failed", error);
    return Response.json(
      {
        message: "Không xử lý được yêu cầu Phân Xưởng trên PostgreSQL.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
