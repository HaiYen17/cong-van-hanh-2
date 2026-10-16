import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { runPersonnelSync } from "@/lib/personnel-sync";

export const dynamic = "force-dynamic";

// Cron đồng bộ nhân sự. Vercel Cron gọi GET kèm `Authorization: Bearer <CRON_SECRET>`.
// ?mode=interval (mặc định, chạy mỗi 30') hoặc ?mode=snapshot (chạy 1 lần/ngày).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const mode = new URL(request.url).searchParams.get("mode") === "snapshot" ? "snapshot" : "interval";
  const db = getDb();
  const sources = await db.personnelSource.findMany({ where: { status: "ACTIVE", syncMode: mode } });

  const results: { company: string; count: number; message: string }[] = [];
  for (const source of sources) {
    const { count, message } = await runPersonnelSync(db, source);
    await db.personnelSource.update({
      data: { lastSyncCount: count, lastSyncMessage: message, lastSyncedAt: new Date() },
      where: { id: source.id },
    });
    results.push({ company: source.companyId, count, message });
  }

  return NextResponse.json({ mode, sources: results.length, results });
}
