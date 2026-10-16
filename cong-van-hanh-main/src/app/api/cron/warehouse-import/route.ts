import { createHash, timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { importAllWarehouseLegacyData } from "@/lib/warehouse/legacy-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export const runtime = "nodejs";

function secureEqual(left: string, right: string) {
  return timingSafeEqual(
    createHash("sha256").update(left, "utf8").digest(),
    createHash("sha256").update(right, "utf8").digest(),
  );
}

export async function POST(request: Request) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  const supplied = String(request.headers.get("authorization") || "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (!secret || !supplied || !secureEqual(supplied, secret)) {
    return NextResponse.json({ error: "Unauthorized", ok: false }, { status: 401 });
  }
  try {
    const result = await importAllWarehouseLegacyData();
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Không nhập được dữ liệu Kho cũ.",
        ok: false,
      },
      { status: 500 },
    );
  }
}

