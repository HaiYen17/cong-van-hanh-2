import { GoogleAuth, OAuth2Client } from "google-auth-library";

import type {
  DriveFileMetadata,
  LegacyInboxSourceRow,
} from "./types";
import {
  LEGACY_INBOX_SHEET_NAME,
  LEGACY_INBOX_SPREADSHEET_ID,
} from "./types";

type GoogleValuesResponse = {
  values?: unknown[][];
};

type GoogleSpreadsheetResponse = {
  sheets?: {
    properties?: {
      gridProperties?: { rowCount?: number };
      title?: string;
    };
  }[];
};

type GoogleDriveFileResponse = {
  createdTime?: string;
  id?: string;
  md5Checksum?: string;
  mimeType?: string;
  modifiedTime?: string;
  name?: string;
  parents?: string[];
  sha256Checksum?: string;
  size?: string;
  trashed?: boolean;
  webContentLink?: string;
  webViewLink?: string;
};

const READ_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets.readonly",
  "https://www.googleapis.com/auth/drive.readonly",
];

function cell(row: unknown[], index: number) {
  return row[index] ?? "";
}

function text(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value)) {
    return String(value);
  }
  return String(value ?? "").trim();
}

function quotedSheetName(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function sheetValuesUrl(
  spreadsheetId: string,
  sheetName: string,
  range: string,
) {
  const a1 = `${quotedSheetName(sheetName)}!${range}`;
  const query = new URLSearchParams({
    dateTimeRenderOption: "FORMATTED_STRING",
    majorDimension: "ROWS",
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}/values/${encodeURIComponent(a1)}?${query.toString()}`;
}

export type FetchLegacyInboxOptions = {
  batchSize?: number;
  maxRows?: number;
  sheetName?: string;
  spreadsheetId?: string;
  startRow?: number;
};

export class LegacyGoogleSource {
  private readonly auth: GoogleAuth;
  private readonly accessToken: string;

  constructor(auth = new GoogleAuth({ scopes: READ_SCOPES })) {
    this.auth = auth;
    this.accessToken = String(process.env.GOOGLE_ACCESS_TOKEN || "").trim();
  }

  private async getClient() {
    if (!this.accessToken) return this.auth.getClient();
    const client = new OAuth2Client();
    client.setCredentials({ access_token: this.accessToken });
    return client;
  }

  async fetchInboxRows(
    options: FetchLegacyInboxOptions = {},
  ): Promise<LegacyInboxSourceRow[]> {
    const spreadsheetId =
      options.spreadsheetId || LEGACY_INBOX_SPREADSHEET_ID;
    const sheetName = options.sheetName || LEGACY_INBOX_SHEET_NAME;
    const batchSize = Math.min(
      100,
      Math.max(50, Math.trunc(options.batchSize || 100)),
    );
    const startRow = Math.max(2, Math.trunc(options.startRow || 2));
    const maxRows =
      options.maxRows && options.maxRows > 0
        ? Math.trunc(options.maxRows)
        : Number.POSITIVE_INFINITY;
    const client = await this.getClient();

    const metadata = await client.request<GoogleSpreadsheetResponse>({
      params: {
        fields: "sheets(properties(title,gridProperties(rowCount)))",
      },
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId,
      )}`,
    });
    const sheet = metadata.data.sheets?.find(
      (entry) => entry.properties?.title === sheetName,
    );
    if (!sheet) {
      throw new Error(
        `Không tìm thấy tab “${sheetName}” trong Google Sheet ${spreadsheetId}.`,
      );
    }

    const headerResponse = await client.request<GoogleValuesResponse>({
      url: sheetValuesUrl(spreadsheetId, sheetName, "A1:K1"),
    });
    const headers = headerResponse.data.values?.[0]?.map(text) ?? [];
    const requiredHeaders = [
      "Mã đơn DV",
      "Mã Hệ thống",
      "Ngày tạo",
      "MNV Người tạo",
      "Người tạo",
      "Phòng ban người tạo",
      "Trạng thái",
      "Dữ liệu JSON",
      "Chú thích lỗi",
    ];
    const missing = requiredHeaders.filter(
      (expected, index) =>
        headers[index]?.toLocaleLowerCase("vi-VN") !==
        expected.toLocaleLowerCase("vi-VN"),
    );
    if (missing.length) {
      throw new Error(
        `Cấu trúc 98_Inbox đã đổi. Thiếu/sai cột cố định: ${missing.join(", ")}.`,
      );
    }

    const gridRows = Math.max(
      startRow,
      sheet.properties?.gridProperties?.rowCount || startRow,
    );
    const rows: LegacyInboxSourceRow[] = [];
    for (
      let batchStart = startRow;
      batchStart <= gridRows && rows.length < maxRows;
      batchStart += batchSize
    ) {
      const batchEnd = Math.min(gridRows, batchStart + batchSize - 1);
      const response = await client.request<GoogleValuesResponse>({
        url: sheetValuesUrl(
          spreadsheetId,
          sheetName,
          `A${batchStart}:K${batchEnd}`,
        ),
      });
      const values = response.data.values ?? [];
      values.forEach((row, offset) => {
        if (rows.length >= maxRows) return;
        const core = row.slice(0, 9);
        if (!core.some((value) => text(value))) return;
        rows.push({
          createdAt: cell(row, 2),
          creatorDepartment: text(cell(row, 5)),
          creatorEmployeeCode: text(cell(row, 3)),
          creatorName: text(cell(row, 4)),
          errorNote: text(cell(row, 8)),
          payloadRaw: text(cell(row, 7)),
          requestId: text(cell(row, 0)),
          rowNumber: batchStart + offset,
          serviceCode: text(cell(row, 1)),
          status: text(cell(row, 6)),
        });
      });
    }
    return rows;
  }

  async getDriveFileMetadata(input: {
    driveFileId: string;
    legacyUrl: string;
  }): Promise<DriveFileMetadata> {
    const client = await this.getClient();
    const response = await client.request<GoogleDriveFileResponse>({
      params: {
        fields:
          "id,name,mimeType,size,md5Checksum,sha256Checksum,webViewLink,webContentLink,createdTime,modifiedTime,trashed,parents",
        supportsAllDrives: true,
      },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        input.driveFileId,
      )}`,
    });
    const file = response.data;
    const size = Number(file.size || 0);
    return {
      createdTime: file.createdTime,
      driveFileId: file.id || input.driveFileId,
      legacyUrl: file.webViewLink || input.legacyUrl,
      md5Checksum: file.md5Checksum,
      mimeType: file.mimeType,
      modifiedTime: file.modifiedTime,
      name: file.name,
      parents: file.parents,
      sha256Checksum: file.sha256Checksum,
      sizeBytes: Number.isFinite(size) && size > 0 ? Math.trunc(size) : undefined,
      trashed: file.trashed,
      webContentLink: file.webContentLink,
      webViewLink: file.webViewLink,
    };
  }
}
