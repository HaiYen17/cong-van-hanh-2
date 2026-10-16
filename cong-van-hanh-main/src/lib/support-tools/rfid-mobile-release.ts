import "server-only";

import { asRecord, text } from "@/lib/operations/json";
import { getDb } from "@/lib/db";

export const RFID_SCANNER_SUPPORT_APP_ID = "rfid-android-scanner";

export class RfidMobileReleaseError extends Error {
  constructor(
    message: string,
    public readonly status = 404,
  ) {
    super(message);
    this.name = "RfidMobileReleaseError";
  }
}

type VersionSource = {
  fileId: string;
  fileName: string;
  updatedAt: string;
  versionName: string;
};

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi");
}

function versionRows(content: Record<string, unknown>) {
  const raw = content.versions ?? content["Phiên bản JSON"];
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function selectRfidScannerVersion(
  content: Record<string, unknown>,
): VersionSource | null {
  for (const value of versionRows(content)) {
    const row = asRecord(value);
    const fileId = text(row.fileId);
    const fileName = text(row.fileName);
    const downloadType = normalized(row.downloadType || "download");
    const versionName = text(row.versionName);
    if (
      fileId &&
      fileName.toLocaleLowerCase("vi").endsWith(".apk") &&
      downloadType !== "copy" &&
      /^\d+(?:\.\d+){1,3}$/.test(versionName)
    ) {
      return {
        fileId,
        fileName,
        updatedAt: text(row.updatedAt),
        versionName,
      };
    }
  }
  return null;
}

export async function getRfidScannerRelease() {
  const db = getDb();
  const app = await db.configurationRecord.findFirst({
    where: {
      code: RFID_SCANNER_SUPPORT_APP_ID,
      recordType: "app-definition",
      status: { notIn: ["Vô hiệu", "INACTIVE", "ARCHIVED"] },
    },
  });
  if (!app) {
    throw new RfidMobileReleaseError(
      "Chưa cấu hình ứng dụng Máy quét RFID trong Công cụ hỗ trợ.",
    );
  }
  const content = asRecord(app.content);
  const version = selectRfidScannerVersion(content);
  if (!version) {
    throw new RfidMobileReleaseError(
      "Máy quét RFID chưa có phiên bản APK hợp lệ.",
    );
  }
  const file = await db.fileObject.findUnique({
    include: {
      links: {
        select: { entityId: true, entityType: true },
      },
    },
    where: { id: version.fileId },
  });
  const linked = file?.links.some(
    (link) =>
      link.entityType === "SUPPORT_TOOL_APP" &&
      link.entityId === RFID_SCANNER_SUPPORT_APP_ID,
  );
  if (
    !file ||
    !linked ||
    file.provider !== "GCS" ||
    !file.bucket ||
    !file.sha256 ||
    file.sizeBytes === null
  ) {
    throw new RfidMobileReleaseError(
      "File APK chưa sẵn sàng trong kho ứng dụng.",
    );
  }
  return {
    file,
    release: {
      downloadUrl: "/api/mobile/rfid-app/update/file",
      fileName: version.fileName,
      notes: text(content.note || content["Ghi chú"] || content.description),
      publishedAt:
        version.updatedAt || app.updatedAt.toISOString(),
      sha256: file.sha256.toLocaleLowerCase("en"),
      sizeBytes: Number(file.sizeBytes),
      versionName: version.versionName,
    },
  };
}
