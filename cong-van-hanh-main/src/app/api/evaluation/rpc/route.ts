import { getCurrentSession } from "@/lib/auth/session";
import {
  dispatchEvaluationRpc,
  EvaluationRuntimeError,
} from "@/lib/evaluation/runtime";
import { asRecord, text } from "@/lib/operations/json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
    const method = text(body.method);
    if (!method) {
      throw new EvaluationRuntimeError("Thiếu phương thức xử lý.");
    }
    const result = await dispatchEvaluationRpc(
      session,
      method,
      asRecord(body.payload),
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof EvaluationRuntimeError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    console.error("Evaluation RPC failed", error);
    return Response.json(
      {
        message: "Không xử lý được yêu cầu đánh giá trên PostgreSQL.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
