import { Readable } from "node:stream";

import { getCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { requestAttachmentStorage } from "@/lib/requests/attachments";
import {
  canAccessAppSetup,
  canAccessSupportTools,
} from "@/lib/support-tools/runtime";

const ENTITY_TYPES = new Set([
  "SUPPORT_TOOL_APP",
  "SUPPORT_TOOL_DOWNLOAD",
]);

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json(
      { message: "Phiên đăng nhập đã hết hạn." },
      { status: 401 },
    );
  }
  const { fileId } = await params;
  const file = await getDb().fileObject.findUnique({
    include: { links: { select: { entityType: true } } },
    where: { id: fileId },
  });
  if (!file || file.provider !== "GCS" || !file.bucket) {
    return Response.json({ message: "Không tìm thấy file." }, { status: 404 });
  }
  const belongsToSupportTools = file.links.some((link) =>
    ENTITY_TYPES.has(link.entityType),
  );
  const canRead =
    sessionOwnsUserId(session, file.ownerId) ||
    (belongsToSupportTools &&
      (canAccessSupportTools(session) || canAccessAppSetup(session)));
  if (!canRead) {
    return Response.json(
      { message: "Không có quyền mở file này." },
      { status: 403 },
    );
  }
  const object = requestAttachmentStorage()
    .bucket(file.bucket)
    .file(file.objectKey);
  const [exists] = await object.exists();
  if (!exists) {
    return Response.json(
      { message: "File không còn tồn tại trong kho GCS." },
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
