import { NextResponse } from "next/server";

import {
  getMobileProfileFromRequest,
  MobileAuthError,
} from "@/lib/auth/mobile-auth";
import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await assertWarehouseApiRequest(request);
    const profile = await getMobileProfileFromRequest(request);
    return NextResponse.json({ ok: true, profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không đọc được phiên đăng nhập.";
    const code = error instanceof MobileAuthError ? error.code : "PROFILE_FAILED";
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
