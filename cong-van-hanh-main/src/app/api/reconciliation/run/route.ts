import { getCurrentSession } from "@/lib/auth/session";
import {
  canRunReconciliation,
  runReconciliation,
} from "@/lib/reconciliation/service";
import { toLegacyRunResult } from "@/lib/reconciliation/legacy-rpc";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { message: "Phiên đăng nhập đã hết hạn.", success: false },
        { status: 401 },
      );
    }
    if (!canRunReconciliation(session)) {
      return Response.json(
        {
          message: "Tài khoản chỉ có quyền xem, chưa được phép tạo đối soát.",
          success: false,
        },
        { status: 403 },
      );
    }

    const formData = await request.formData();
    const files = formData
      .getAll("files")
      .filter((item): item is File => item instanceof File && item.size > 0);
    const month = Number(formData.get("month"));
    const year = Number(formData.get("year"));
    const result = await runReconciliation({
      files,
      month,
      session,
      year,
    });
    return Response.json(toLegacyRunResult(result));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Reconciliation run failed", error);
    return Response.json(
      { message, success: false },
      { status: 400 },
    );
  }
}
