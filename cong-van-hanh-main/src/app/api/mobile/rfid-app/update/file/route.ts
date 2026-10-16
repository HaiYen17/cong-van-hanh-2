import { Readable } from "node:stream";

import {
  getMobileProfileFromRequest,
  MobileAuthError,
} from "@/lib/auth/mobile-auth";
import { requestAttachmentStorage } from "@/lib/requests/attachments";
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
    const { file, release } = await getRfidScannerRelease();
    const object = requestAttachmentStorage()
      .bucket(file.bucket!)
      .file(file.objectKey);
    const [exists] = await object.exists();
    if (!exists) {
      throw new RfidMobileReleaseError(
        "File APK không còn tồn tại trong kho ứng dụng.",
      );
    }
    return new Response(
      Readable.toWeb(object.createReadStream()) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Cache-Control": "private, no-store, max-age=0",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(release.fileName)}`,
          "Content-Length": String(release.sizeBytes),
          "Content-Type": "application/vnd.android.package-archive",
          "X-Content-SHA256": release.sha256,
          "X-Content-Type-Options": "nosniff",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Không tải được bản cập nhật.";
    const status =
      error instanceof MobileAuthError ||
      error instanceof WarehouseApiAuthError ||
      error instanceof RfidMobileReleaseError
        ? error.status
        : 500;
    return Response.json(
      { code: "RFID_APP_DOWNLOAD_FAILED", message, ok: false },
      { status },
    );
  }
}
