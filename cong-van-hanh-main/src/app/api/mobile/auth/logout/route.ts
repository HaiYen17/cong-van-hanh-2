import { NextResponse } from "next/server";

import { logoutMobileRequest, MobileAuthError } from "@/lib/auth/mobile-auth";
import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    await assertWarehouseApiRequest(request);
    await logoutMobileRequest(request);
    return NextResponse.json({ message: "Đã đăng xuất ứng dụng.", ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đăng xuất được.";
    const code = error instanceof MobileAuthError ? error.code : "LOGOUT_FAILED";
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
