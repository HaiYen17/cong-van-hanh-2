import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { canAccessAssetSetup } from "@/lib/assets/setup-runtime";
import { getCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { requestAttachmentStorage } from "@/lib/requests/attachments";

const ASSET_ENTITY_TYPES = new Set([
  "ASSET_BACKGROUND_JOB",
  "ASSET_CATALOG",
  "STATIONERY_ITEM",
  "UNIFORM_ITEM",
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return NextResponse.json(
      { error: "Phiên đăng nhập đã hết hạn." },
      { status: 401 },
    );
  }
  const { fileId } = await params;
  const file = await getDb().fileObject.findUnique({
    include: {
      links: {
        select: { entityType: true },
      },
    },
    where: { id: fileId },
  });
  if (!file || file.provider !== "GCS" || !file.bucket) {
    return NextResponse.json({ error: "Không tìm thấy hình." }, { status: 404 });
  }
  const isAssetFile = file.links.some((link) =>
    ASSET_ENTITY_TYPES.has(link.entityType),
  );
  const canRead =
    sessionOwnsUserId(session, file.ownerId) ||
    (isAssetFile && canAccessAssetSetup(session));
  if (!canRead) {
    return NextResponse.json(
      { error: "Không có quyền xem hình." },
      { status: 403 },
    );
  }
  const storage = requestAttachmentStorage();
  const object = storage.bucket(file.bucket).file(file.objectKey);
  const [exists] = await object.exists();
  if (!exists) {
    return NextResponse.json(
      { error: "Hình không còn tồn tại trong kho." },
      { status: 404 },
    );
  }
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(
      file.originalName,
    )}`,
    "Content-Type": file.mimeType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (file.sizeBytes !== null) {
    headers.set("Content-Length", file.sizeBytes.toString());
  }
  return new Response(
    Readable.toWeb(object.createReadStream()) as ReadableStream<Uint8Array>,
    { headers },
  );
}
