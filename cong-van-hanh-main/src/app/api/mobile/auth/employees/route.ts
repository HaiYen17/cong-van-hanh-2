import { NextResponse } from "next/server";

import { listMobileLoginEmployees } from "@/lib/auth/mobile-auth";
import {
  assertWarehouseApiRequest,
  WarehouseApiAuthError,
} from "@/lib/warehouse/api-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await assertWarehouseApiRequest(request);
    const employees = await listMobileLoginEmployees();
    return NextResponse.json({
      employees,
      generatedAt: new Date().toISOString(),
      ok: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không tải được nhân sự.";
    const status = error instanceof WarehouseApiAuthError ? error.status : 400;
    return NextResponse.json({ error: message, message, ok: false }, { status });
  }
}
