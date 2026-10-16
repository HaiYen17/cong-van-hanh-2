import { getCurrentSession } from "@/lib/auth/session";
import { findEvaluationRecordByIdentifier } from "@/lib/evaluation/record-identity";
import { buildEvaluationResultPdf } from "@/lib/evaluation/result-pdf";
import { resolveOperationActor } from "@/lib/operations/actor";
import { asRecord, text } from "@/lib/operations/json";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json(
      { message: "Phiên đăng nhập đã hết hạn." },
      { status: 401 },
    );
  }
  const instanceId = new URL(request.url).searchParams.get("instanceId") || "";
  const instance = await findEvaluationRecordByIdentifier(
    "evaluation-instance",
    instanceId,
  );
  if (!instance) {
    return Response.json(
      { message: "Không tìm thấy phiếu đánh giá." },
      { status: 404 },
    );
  }
  const actor = await resolveOperationActor(session);
  const content = asRecord(instance.content);
  const allowed =
    actor.isAdmin ||
    [
      content.employeeCode,
      content.employeeId,
      content.managerEmployeeCode,
      content.peerEmployeeCode,
      content.hrEmployeeCode,
      content.bodEmployeeCode,
    ]
      .map(text)
      .includes(actor.employeeCode);
  if (!allowed) {
    return Response.json(
      { message: "Bạn không có quyền xem PDF của phiếu này." },
      { status: 403 },
    );
  }
  try {
    const { buffer, fileName } = await buildEvaluationResultPdf(instanceId);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Content-Type": "application/pdf",
      },
    });
  } catch (error) {
    console.error("Evaluation PDF failed", error);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (acceptsHtml) {
      return new Response(
        '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Không tạo được PDF</title><style>body{font-family:Arial,sans-serif;background:#f7f5ef;color:#123f36;margin:0;padding:40px}.card{max-width:620px;margin:8vh auto;padding:28px;border:1px solid #d7e1dd;border-radius:16px;background:#fff;box-shadow:0 18px 42px rgba(17,45,39,.12)}h1{font-size:24px}p{line-height:1.6;color:#60736e}</style><div class="card"><h1>Không tạo được PDF kết quả đánh giá</h1><p>Hệ thống chưa hoàn tất tệp in. Hãy đóng tab này, tải lại phiếu rồi thử In PDF một lần nữa.</p></div></html>',
        { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 500 },
      );
    }
    return Response.json(
      { message: "Không tạo được PDF kết quả đánh giá." },
      { status: 500 },
    );
  }
}
