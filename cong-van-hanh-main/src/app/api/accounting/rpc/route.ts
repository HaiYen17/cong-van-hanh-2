import { can } from "@/lib/auth/authorization";
import { getCurrentSession } from "@/lib/auth/session";
import { resolveActorEmail } from "@/lib/accounting/database";
import {
  accountingMethodPermission,
  dispatchAccountingRpc,
  parseRpcBody,
} from "@/lib/accounting/rpc";
import { AccountingRpcError } from "@/lib/accounting/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof AccountingRpcError) {
    return Response.json(
      { ok: false, message: error.message },
      { status: error.status },
    );
  }
  const databaseCode =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "";
  if (databaseCode === "23505") {
    return Response.json(
      {
        ok: false,
        message:
          "Đã có cấu hình trùng khóa trong phiên bản này. Hãy đổi mã định danh rồi lưu lại.",
      },
      { status: 409 },
    );
  }
  if (databaseCode === "23503") {
    return Response.json(
      {
        ok: false,
        message:
          "Dữ liệu tham chiếu không còn tồn tại. Hãy tải lại module rồi thử lại.",
      },
      { status: 409 },
    );
  }
  console.error("Accounting RPC failed", error);
  return Response.json(
    {
      ok: false,
      message: "Không xử lý được yêu cầu Kế toán trên PostgreSQL.",
    },
    { status: 500 },
  );
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { ok: false, message: "Phiên đăng nhập đã hết hạn." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new AccountingRpcError("Nội dung JSON không hợp lệ.");
    }
    const { method, payload } = parseRpcBody(body);
    const permission = accountingMethodPermission(method);
    if (!can(session, permission)) {
      const isRuntime = permission === "accounting.runtime.manage";
      const needsEdit = permission === "accounting.config.edit";
      return Response.json(
        {
          ok: false,
          message: isRuntime
            ? "Bạn không có quyền quản lý kết nối và tiến trình dữ liệu Kế toán."
            : needsEdit
              ? "Bạn không có quyền chỉnh sửa cấu hình Báo cáo Kế toán."
              : "Bạn không có quyền xem cấu hình Báo cáo Kế toán.",
        },
        { status: 403 },
      );
    }

    const actorEmail = await resolveActorEmail(session.userId);
    const result = await dispatchAccountingRpc(method, payload, actorEmail);
    return Response.json({ ok: true, result });
  } catch (error) {
    return errorResponse(error);
  }
}
