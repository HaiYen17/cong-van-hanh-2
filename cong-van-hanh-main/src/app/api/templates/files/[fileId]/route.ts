import { Readable } from "node:stream";

import { getCurrentSession } from "@/lib/auth/session";
import { getDb } from "@/lib/db";
import { canUseTemplates } from "@/lib/templates/runtime";
import { getTemplatePdfStorage } from "@/lib/templates/pdf-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function inlineDisposition(fileName: string) {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 140);
  return `inline; filename="${ascii || "template-preview.pdf"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json(
      { message: "Phiên đăng nhập đã hết hạn.", ok: false },
      { status: 401 },
    );
  }
  if (!canUseTemplates(session)) {
    return Response.json(
      { message: "Tài khoản chưa có quyền xem PDF Biểu mẫu.", ok: false },
      { status: 403 },
    );
  }
  const { fileId } = await context.params;
  const file = await getDb().fileObject.findUnique({ where: { id: fileId } });
  const metadata =
    file?.metadata && typeof file.metadata === "object"
      ? (file.metadata as { source?: unknown })
      : {};
  if (
    !file ||
    file.status !== "ACTIVE" ||
    file.provider !== "GCS" ||
    !file.bucket ||
    metadata.source !== "TEMPLATE_PDF"
  ) {
    return Response.json(
      { message: "PDF nháp không còn tồn tại.", ok: false },
      { status: 404 },
    );
  }
  const source = getTemplatePdfStorage()
    .bucket(file.bucket)
    .file(file.objectKey)
    .createReadStream();
  return new Response(Readable.toWeb(source) as ReadableStream<Uint8Array>, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": inlineDisposition(file.originalName),
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
