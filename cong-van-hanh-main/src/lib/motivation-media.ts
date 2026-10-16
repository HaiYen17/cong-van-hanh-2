import "server-only";

import { randomBytes } from "node:crypto";

import { GoogleAuth } from "google-auth-library";

import { getDb } from "@/lib/db";
import { driveThumbnail, getDriveFolders } from "@/lib/drive";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const motivationGoogleAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive"],
});

export class MotivationMediaError extends Error {}

type DriveUploadMeta = {
  id?: string;
  name?: string;
};

export type MotivationMedia = {
  id: string;
  name: string;
  url: string;
};

function imageFiles(values: FormDataEntryValue[]) {
  return values.filter(
    (value): value is File =>
      value instanceof File && value.size > 0 && Boolean(value.name),
  );
}

async function motivationFolderId() {
  const folders = await getDriveFolders(getDb());
  const folderId = folders["config.motivationImageFolderId"]?.trim();
  if (!folderId) {
    throw new MotivationMediaError(
      "Chưa cấu hình thư mục ảnh Thông báo/Bản tin trong Cấu hình Tổng.",
    );
  }
  return folderId;
}

async function uploadOne(file: File, folderId: string): Promise<MotivationMedia> {
  if (!file.type.toLowerCase().startsWith("image/")) {
    throw new MotivationMediaError(`File “${file.name}” không phải định dạng hình ảnh.`);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new MotivationMediaError(
      `File “${file.name}” vượt quá giới hạn 12 MB.`,
    );
  }

  const boundary = `tvg_motivation_${randomBytes(12).toString("hex")}`;
  const safeName = file.name.replace(/[^\p{L}\p{N}._ -]+/gu, "_");
  const metadata = {
    name: `${Date.now()}-${safeName}`,
    parents: [folderId],
  };
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`,
    "utf8",
  );
  const tail = Buffer.from(`\r\n--${boundary}--`, "utf8");
  const client = await motivationGoogleAuth.getClient();
  const response = await client.request<DriveUploadMeta>({
    data: Buffer.concat([
      head,
      Buffer.from(await file.arrayBuffer()),
      tail,
    ]),
    headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
    method: "POST",
    params: {
      fields: "id,name",
      supportsAllDrives: true,
      uploadType: "multipart",
    },
    url: "https://www.googleapis.com/upload/drive/v3/files",
  });
  const id = String(response.data.id || "").trim();
  if (!id) {
    throw new MotivationMediaError(`Không nhận được File ID cho “${file.name}”.`);
  }
  return {
    id,
    name: String(response.data.name || file.name),
    url: driveThumbnail(id, "w1600"),
  };
}

export async function uploadMotivationMedia(values: FormDataEntryValue[]) {
  const files = imageFiles(values);
  if (!files.length) return [];
  const folderId = await motivationFolderId();
  const uploaded: MotivationMedia[] = [];
  for (const file of files) {
    uploaded.push(await uploadOne(file, folderId));
  }
  return uploaded;
}
