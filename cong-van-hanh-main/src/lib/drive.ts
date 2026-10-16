// Tiện ích Drive (xương sống Tầng 2). Đọc ID thư mục từ Cấu hình Tổng + helper nhúng ảnh.
// Lưu ý: TẢI LÊN Drive thật cần Service Account — sẽ nối khi user cấp credential.
import type { PrismaClient } from "@/generated/prisma/client";

// Nhúng ảnh Drive công khai (dùng ở bản tin, login...).
export function driveThumbnail(id: string, size = "w1200"): string {
  return `https://drive.google.com/thumbnail?id=${id}&sz=${size}`;
}

// Tách ID từ link Drive hoặc nhận thẳng ID.
export function parseDriveId(input: string): string | null {
  const s = (input || "").trim();
  const m = s.match(/\/d\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

export const DRIVE_FOLDER_KEYS = [
  "config.motivationImageFolderId",
  "appSetup.supportToolDriveFolderId",
  "eshopDataLake.rootFolderId",
  "eshopDataLake.rawOrdersFolderId",
  "eshopDataLake.snapshotFolderId",
  "template.templateDriveFolderId",
  "assetSetup.rootFolderId",
  "assetSetup.imageFolderId",
  "assetSetup.stationeryFolderId",
  "assetSetup.uniformFolderId",
  "ai.reviewContractFolderId",
  "legal.companyStorageRootFolderId",
  "reconcile.secondaryOutputFolderId",
] as const;

// Lấy map các folder Drive đã cấu hình ở Cấu hình Tổng.
export async function getDriveFolders(db: PrismaClient): Promise<Record<string, string>> {
  const rows = await db.systemSetting.findMany({
    where: { key: { in: [...DRIVE_FOLDER_KEYS] } },
  });
  return Object.fromEntries(rows.filter((r) => r.value).map((r) => [r.key, r.value as string]));
}
