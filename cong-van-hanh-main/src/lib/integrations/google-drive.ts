import { GoogleAuth } from "google-auth-library";

const driveAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/drive.readonly"],
});

export function extractGoogleDriveId(value: string) {
  const text = String(value || "").trim().replace(/^['"]|['"]$/g, "");
  if (!text) return "";
  return (
    text.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/)?.[1] ??
    text.match(/\/folders\/([A-Za-z0-9_-]+)/)?.[1] ??
    text.match(/[?&]id=([A-Za-z0-9_-]+)/)?.[1] ??
    text
  );
}

export async function assertGoogleDriveResource(
  value: string,
  kind: "folder" | "spreadsheet",
) {
  const id = extractGoogleDriveId(value);
  if (!id || !/^[A-Za-z0-9_-]{10,}$/.test(id)) {
    throw new Error(
      kind === "folder"
        ? "Vui lòng nhập link Google Drive folder hoặc Folder ID hợp lệ."
        : "Vui lòng nhập link Google Sheet hoặc Spreadsheet ID hợp lệ.",
    );
  }

  try {
    const client = await driveAuth.getClient();
    const response = await client.request<{
      id?: string;
      mimeType?: string;
      name?: string;
    }>({
      params: {
        fields: "id,name,mimeType",
        supportsAllDrives: true,
      },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`,
    });
    const mimeType = response.data.mimeType ?? "";
    if (
      kind === "folder" &&
      mimeType !== "application/vnd.google-apps.folder"
    ) {
      throw new Error("ID đã nhập không phải Google Drive folder.");
    }
    if (
      kind === "spreadsheet" &&
      mimeType !== "application/vnd.google-apps.spreadsheet"
    ) {
      throw new Error("ID đã nhập không phải Google Sheet.");
    }
    return id;
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("không phải") ||
        error.message.includes("hợp lệ"))
    ) {
      throw error;
    }
    const serviceAccount =
      process.env.GOOGLE_CLOUD_SERVICE_ACCOUNT ||
      "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";
    throw new Error(
      `Google Cloud chưa truy cập được tài nguyên ${id}. Hãy chia sẻ tài nguyên cho ${serviceAccount}, rồi lưu lại.`,
    );
  }
}
