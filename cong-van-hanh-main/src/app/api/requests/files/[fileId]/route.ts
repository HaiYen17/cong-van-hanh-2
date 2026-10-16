import { Readable } from "node:stream";

import { NextResponse } from "next/server";

import { canAny } from "@/lib/auth/authorization";
import { requireCurrentSession } from "@/lib/auth/session";
import { sessionOwnsUserId } from "@/lib/auth/session-identity";
import { getDb } from "@/lib/db";
import { requestAttachmentStorage } from "@/lib/requests/attachments";
import { mayReadCompany } from "@/lib/requests/digital-signature-workflow";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const session = await requireCurrentSession();
  const { fileId } = await params;
  const db = getDb();
  const file = await db.fileObject.findUnique({
    include: {
      requestAttachments: {
        include: { request: true },
      },
    },
    where: { id: fileId },
  });

  if (!file || file.archivedAt || file.provider !== "GCS" || !file.bucket) {
    return NextResponse.json({ error: "Không tìm thấy tệp." }, { status: 404 });
  }

  const signatureWorkflow = await db.digitalSignatureWorkflow.findFirst({
    select: { companyId: true },
    where: { OR: [{ originalFileId: fileId }, { outputFileId: fileId }] },
  });
  const canRead = signatureWorkflow
    ? sessionOwnsUserId(session, file.ownerId) ||
      file.requestAttachments.some((item) =>
        sessionOwnsUserId(session, item.request.createdById),
      ) || await mayReadCompany(session, signatureWorkflow.companyId)
    :
    sessionOwnsUserId(session, file.ownerId) ||
    file.requestAttachments.some(
      (item) => sessionOwnsUserId(session, item.request.createdById),
    ) ||
    canAny(session, [
      "admin_requests.read",
      "admin_requests.process",
      "admin_requests.approve",
    ]);
  if (!canRead) {
    return NextResponse.json({ error: "Không có quyền xem tệp." }, { status: 403 });
  }

  const [exists] = await requestAttachmentStorage()
    .bucket(file.bucket)
    .file(file.objectKey)
    .exists();
  if (!exists) {
    return NextResponse.json({ error: "Tệp không còn tồn tại." }, { status: 404 });
  }

  const source = requestAttachmentStorage()
    .bucket(file.bucket)
    .file(file.objectKey)
    .createReadStream();
  const headers = new Headers({
    "Cache-Control": "private, no-store, max-age=0",
    "Content-Disposition": `${new URL(request.url).searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
    "Content-Type": file.mimeType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  if (file.sizeBytes !== null) {
    headers.set("Content-Length", file.sizeBytes.toString());
  }

  // Stream qua route đã kiểm tra quyền thay vì ký URL GCS. Cách này giữ file
  // riêng tư và không buộc service account Cloud Run phải có quyền signBlob.
  return new Response(
    Readable.toWeb(source) as ReadableStream<Uint8Array>,
    { headers },
  );
}
