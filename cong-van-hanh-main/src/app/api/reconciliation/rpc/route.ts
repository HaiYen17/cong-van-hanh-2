import { getCurrentSession } from "@/lib/auth/session";
import { asRecord, text } from "@/lib/operations/json";
import {
  dispatchReconciliationLegacyRpc,
  ReconciliationLegacyRpcError,
} from "@/lib/reconciliation/legacy-rpc";

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
      throw new ReconciliationLegacyRpcError("Thiếu phương thức xử lý.");
    }
    const payload = asRecord(body.payload);
    const result = await dispatchReconciliationLegacyRpc(
      session,
      method,
      payload,
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof ReconciliationLegacyRpcError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    console.error("Reconciliation RPC failed", error);
    return Response.json(
      {
        message:
          error instanceof Error
            ? error.message
            : "Không xử lý được yêu cầu Đối soát.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
