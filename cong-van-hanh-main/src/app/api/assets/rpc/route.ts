import { getCurrentSession } from "@/lib/auth/session";
import {
  AssetLegacyRpcError,
  dispatchAssetLegacyRpc,
} from "@/lib/assets/legacy-rpc";
import { AssetSetupError } from "@/lib/assets/setup-runtime";
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
    if (!method) throw new AssetLegacyRpcError("Thiếu phương thức xử lý.");
    const result = await dispatchAssetLegacyRpc(
      session,
      method,
      asRecord(body.payload),
    );
    return Response.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AssetLegacyRpcError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: error.status },
      );
    }
    if (error instanceof AssetSetupError) {
      return Response.json(
        { message: error.message, ok: false },
        { status: 400 },
      );
    }
    console.error("Asset setup RPC failed", error);
    return Response.json(
      {
        message:
          "Không xử lý được yêu cầu Setup tài sản trên PostgreSQL/GCS.",
        ok: false,
      },
      { status: 500 },
    );
  }
}
