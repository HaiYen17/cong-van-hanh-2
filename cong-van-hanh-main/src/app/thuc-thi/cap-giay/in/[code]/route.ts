import { requireCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";

import {
  buildAuthorizationPrintDocument,
  buildAuthorizationPrintError,
  buildAuthorizationPrintItems,
} from "../../print-runtime";

function objectOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
    status,
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ code: string }> },
) {
  try {
    const session = await requireCurrentSession();
    const { code } = await context.params;
    const request = await getDb().request.findUnique({
      where: { code: decodeURIComponent(code) },
    });
    if (!request || request.archivedAt) {
      return htmlResponse(
        buildAuthorizationPrintError("Không tìm thấy đơn cấp giấy."),
        404,
      );
    }
    if (request.serviceCode !== "authorization-letter") {
      return htmlResponse(
        buildAuthorizationPrintError(
          "Mã đơn này không thuộc dịch vụ Cấp giấy Ủy quyền/Giới thiệu.",
        ),
        400,
      );
    }
    const allowed =
      sessionOwnsUserId(session, request.createdById) ||
      session.fullAccess ||
      session.modules.includes("authorization-letter") ||
      session.modules.includes("order-management") ||
      session.permissions.includes("admin_requests.read") ||
      session.permissions.includes("admin_requests.process");
    if (!allowed) {
      return htmlResponse(
        buildAuthorizationPrintError("Tài khoản không có quyền mở bản in này."),
        403,
      );
    }
    const payload = objectOf(request.payload);
    const rows = Array.isArray(payload.items) ? payload.items : [];
    if (!rows.length) {
      return htmlResponse(
        buildAuthorizationPrintError("Đơn chưa có dữ liệu để dựng bản in."),
        400,
      );
    }
    const items = await buildAuthorizationPrintItems(getDb(), rows, {
      issueDate: request.createdAt,
    });
    return htmlResponse(
      buildAuthorizationPrintDocument({
        draft: false,
        items,
        requestCode: request.code,
      }),
    );
  } catch (error) {
    return htmlResponse(
      buildAuthorizationPrintError(
        error instanceof Error ? error.message : "Không dựng được bản in.",
      ),
      500,
    );
  }
}
