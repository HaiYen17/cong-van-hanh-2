import { Readable } from "node:stream";

import { can } from "@/lib/auth/authorization";
import { getCurrentSession } from "@/lib/auth/session";
import { accountingStorage } from "@/lib/accounting/export-storage";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function contentDisposition(fileName: string) {
  const ascii = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]+/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 140);
  return `attachment; filename="${ascii || "accounting-export"}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  const session = await getCurrentSession();
  if (!session) {
    return Response.json(
      { ok: false, message: "Phiên đăng nhập đã hết hạn." },
      { status: 401 },
    );
  }
  if (!can(session, "accounting.config.read")) {
    return Response.json(
      { ok: false, message: "Bạn không có quyền tải file Kế toán." },
      { status: 403 },
    );
  }

  const { fileId } = await context.params;
  const file = await getDb().fileObject.findUnique({
    where: { id: fileId },
  });
  if (
    !file ||
    file.status !== "ACTIVE" ||
    file.provider !== "GCS" ||
    !file.bucket
  ) {
    return Response.json(
      { ok: false, message: "File Kế toán không còn tồn tại." },
      { status: 404 },
    );
  }

  try {
    const source = accountingStorage()
      .bucket(file.bucket)
      .file(file.objectKey)
      .createReadStream();
    const body = Readable.toWeb(source) as ReadableStream<Uint8Array>;
    return new Response(body, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": contentDisposition(file.originalName),
        "Content-Type": file.mimeType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Accounting file download failed", error);
    return Response.json(
      { ok: false, message: "Không đọc được file Kế toán từ Cloud Storage." },
      { status: 502 },
    );
  }
}
