import { getCurrentSession } from "@/lib/auth/session";
import {
  AirControlRuntimeError,
  executeAirControlCommand,
  getAirControlHistory,
  getAirControlSnapshot,
  getRecentAirControlActivities,
} from "@/lib/air-control/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function errorResponse(error: unknown) {
  if (error instanceof AirControlRuntimeError) {
    return Response.json(
      { message: error.message, ok: false },
      { status: error.status },
    );
  }
  console.error("Electrical system API failed", error);
  return Response.json(
    {
      message: "Không xử lý được yêu cầu điều khiển hệ thống điện.",
      ok: false,
    },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const session = await getCurrentSession();
    if (!session) {
      return Response.json(
        { message: "Phiên đăng nhập đã hết hạn.", ok: false },
        { status: 401 },
      );
    }
    const searchParams = new URL(request.url).searchParams;
    const view = searchParams.get("view") || "snapshot";
    const result =
      view === "activity"
        ? await getRecentAirControlActivities(
            session,
            searchParams.get("after") || "",
          )
        : view === "history"
          ? await getAirControlHistory(session, {
              before: searchParams.get("before") || "",
              limit: Number(searchParams.get("limit")) || 50,
              status: searchParams.get("status") || "",
            })
          : await getAirControlSnapshot(session);
    return Response.json(
      { ok: true, result },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
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
    const body = await request.json().catch(() => {
      throw new AirControlRuntimeError("Dữ liệu gửi lên không hợp lệ.");
    });
    return Response.json({
      ok: true,
      result: await executeAirControlCommand(session, body),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
