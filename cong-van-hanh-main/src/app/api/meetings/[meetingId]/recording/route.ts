import { NextResponse } from "next/server";

import { can } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { getRecallRecordingDownload } from "@/lib/meetings/recall";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ meetingId: string }> },
) {
  const session = await requireCurrentSession();
  const { meetingId } = await params;
  const meeting = await getDb().meeting.findUnique({
    select: { organizerId: true },
    where: { id: meetingId },
  });
  if (!meeting) {
    return NextResponse.json({ error: "Không tìm thấy cuộc họp." }, { status: 404 });
  }
  if (!sessionOwnsUserId(session, meeting.organizerId) && !can(session, "meetings.manage")) {
    return NextResponse.json(
      { error: "Chỉ chủ cuộc họp hoặc quản trị viên được mở bản ghi âm." },
      { status: 403 },
    );
  }

  const download = await getRecallRecordingDownload(meetingId);
  if (!download.ok) {
    return NextResponse.json({ error: download.error }, { status: 404 });
  }
  const response = NextResponse.redirect(download.url, 307);
  response.headers.set("cache-control", "private, no-store");
  return response;
}
