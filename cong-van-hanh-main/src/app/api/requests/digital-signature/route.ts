import { after } from "next/server";

import { getCurrentSession } from "@/lib/auth/session";
import {
  decideDigitalSignatures,
  enqueueDigitalSignature,
  listDigitalSignatures,
  prepareDigitalSignaturePoll,
} from "@/lib/requests/digital-signature-workflow";
import { runDigitalSignatureQueue } from "@/lib/requests/digital-signature-worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function safeMessage(error: unknown) {
  return error instanceof Error ? error.message : "Không xử lý được hàng chờ ký số.";
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) return Response.json({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
    const mode = new URL(request.url).searchParams.get("mode") === "admin" ? "admin" : "bod";
    return Response.json({ ok: true, items: await listDigitalSignatures(session, mode) });
  } catch (error) {
    return Response.json({ ok: false, message: safeMessage(error) }, { status: 403 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) return Response.json({ ok: false, message: "Phiên đăng nhập đã hết hạn." }, { status: 401 });
    const body = objectValue(await request.json());
    const action = String(body.action || "");
    const requestIds = Array.isArray(body.requestIds)
      ? [...new Set(body.requestIds.map(String).map((id) => id.trim()).filter(Boolean))]
      : [];
    let message = "Đã cập nhật hồ sơ.";
    if (action === "approve" || action === "reject") {
      message = await decideDigitalSignatures(
        session,
        requestIds,
        action === "approve",
        String(body.note || ""),
      );
    } else if (action === "sign" || action === "retry-summary") {
      if (requestIds.length !== 1) throw new Error("Mỗi lần chỉ khởi tạo một hồ sơ ký hoặc tóm tắt lại.");
      await enqueueDigitalSignature(session, requestIds[0], action);
      after(() => runDigitalSignatureQueue(requestIds));
      message = action === "sign"
        ? "Đã đưa hồ sơ vào hàng chờ MISA eSign. Theo dõi trạng thái tại màn hình này."
        : "Đã đưa hồ sơ vào hàng chờ Gemini để tóm tắt lại.";
    } else if (action === "poll") {
      if (requestIds.length !== 1) throw new Error("Mỗi lần chỉ cập nhật một giao dịch ký.");
      await prepareDigitalSignaturePoll(session, requestIds[0]);
      await runDigitalSignatureQueue(requestIds);
      message = "Đã cập nhật trạng thái giao dịch MISA eSign.";
    } else {
      throw new Error("Thao tác ký số không hợp lệ.");
    }
    return Response.json({ ok: true, message });
  } catch (error) {
    return Response.json({ ok: false, message: safeMessage(error) }, { status: 400 });
  }
}
