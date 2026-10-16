import { NextResponse } from "next/server";

import {
  authenticateMobileEmployee,
  MobileAuthError,
} from "@/lib/auth/mobile-auth";
import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    await assertWarehouseApiRequest(request, payload);
    const data = await authenticateMobileEmployee(payload, {
      ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request.headers.get("user-agent") || undefined,
    });
    return NextResponse.json({ data, ok: true, ...data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đăng nhập được.";
    const code = error instanceof MobileAuthError ? error.code : "LOGIN_FAILED";
    const status =
      error instanceof MobileAuthError || error instanceof WarehouseApiAuthError
        ? error.status
        : 400;
    return NextResponse.json(
      { code, error: message, message, ok: false },
      { status },
    );
  }
}
