import { NextResponse } from "next/server";

import {
  getMobileProfileFromRequest,
  MobileAuthError,
} from "@/lib/auth/mobile-auth";
import {
  getRfidScannerRelease,
  RfidMobileReleaseError,
} from "@/lib/support-tools/rfid-mobile-release";
import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await assertWarehouseApiRequest(request);
    await getMobileProfileFromRequest(request);
    const { release } = await getRfidScannerRelease();
    return NextResponse.json({ ok: true, release });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không đọc được bản cập nhật.";
    const status =
      error instanceof MobileAuthError ||
      error instanceof WarehouseApiAuthError ||
      error instanceof RfidMobileReleaseError
        ? error.status
        : 500;
    return NextResponse.json(
      { code: "RFID_APP_UPDATE_FAILED", message, ok: false },
      { status },
    );
  }
}
