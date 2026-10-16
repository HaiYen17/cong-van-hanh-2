import "server-only";

import { GoogleAuth } from "google-auth-library";

import {
  parseSpreadsheetId,
  type SheetRead,
} from "@/lib/personnel";

export const PERSONNEL_SHEETS_READER_ACCOUNT =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";

const sheetsAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

type GoogleApiFailure = {
  message?: string;
  response?: {
    data?: { error?: { message?: string } };
    status?: number;
  };
};

function sheetReadError(error: unknown, sheetName: string) {
  const failure = error as GoogleApiFailure;
  const status = Number(failure?.response?.status || 0);
  const message = String(
    failure?.response?.data?.error?.message ||
      failure?.message ||
      "Không đọc được Google Sheet.",
  );

  if (
    status === 401 ||
    /invalid credentials|unauthenticated|authentication credentials/i.test(message)
  ) {
    return new Error(
      "Máy chủ chưa xác thực được với Google Sheets. Vui lòng báo quản trị hệ thống.",
    );
  }
  if (
    status === 403 ||
    /permission|forbidden|caller does not have permission/i.test(message)
  ) {
    return new Error(
      `Google Sheet chưa cấp quyền Người xem cho ${PERSONNEL_SHEETS_READER_ACCOUNT}. Không cần bật “Bất kỳ ai có liên kết”.`,
    );
  }
  if (status === 404 || /not found|requested entity was not found/i.test(message)) {
    return new Error(
      `Không tìm thấy Google Sheet hoặc Sheet chưa cấp quyền Người xem cho ${PERSONNEL_SHEETS_READER_ACCOUNT}.`,
    );
  }
  if (
    status === 400 &&
    /unable to parse range|invalid value|bad request/i.test(message)
  ) {
    return new Error(
      `Không tìm thấy sheet con “${sheetName}”. Kiểm tra lại tên tab, kể cả dấu và khoảng trắng.`,
    );
  }
  return new Error(message);
}

function text(value: unknown) {
  return String(value ?? "");
}

// Đọc Sheet riêng tư bằng tài khoản dịch vụ đang chạy V3.
export async function readSheet(
  apiLink: string,
  sheetName: string,
  headerRow: number,
): Promise<SheetRead> {
  const spreadsheetId = parseSpreadsheetId(apiLink);
  if (!spreadsheetId) {
    throw new Error("Link nguồn không hợp lệ (không tìm được ID Google Sheet).");
  }
  const normalizedSheetName = sheetName.trim();
  if (!normalizedSheetName) {
    throw new Error("Thiếu tên sheet lấy danh sách.");
  }
  const headerIndex =
    Number.isFinite(headerRow) && headerRow > 0 ? Math.trunc(headerRow) : 1;
  const escapedSheetName = normalizedSheetName.replace(/'/g, "''");

  try {
    const client = await sheetsAuth.getClient();
    const response = await client.request<{ values?: unknown[][] }>({
      params: {
        dateTimeRenderOption: "FORMATTED_STRING",
        majorDimension: "ROWS",
        valueRenderOption: "FORMATTED_VALUE",
      },
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}` +
        `/values/${encodeURIComponent(`'${escapedSheetName}'!A:ZZ`)}`,
    });
    const all = (response.data.values || []).map((row) => row.map(text));
    if (all.length < headerIndex) {
      throw new Error(`Sheet không có dòng header số ${headerIndex}.`);
    }
    const headers = (all[headerIndex - 1] || []).map((header) => header.trim());
    const rows = all
      .slice(headerIndex)
      .filter((row) => row.some((cell) => cell.trim() !== ""));
    return {
      headerRowIndex: headerIndex,
      headers,
      rows,
      sheetName: normalizedSheetName,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `Sheet không có dòng header số ${headerIndex}.`
    ) {
      throw error;
    }
    throw sheetReadError(error, normalizedSheetName);
  }
}
