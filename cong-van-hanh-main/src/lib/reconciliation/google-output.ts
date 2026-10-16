import "server-only";

import { GoogleAuth } from "google-auth-library";

import { normalizeName, safeText } from "@/lib/reconciliation/engine";
import {
  RECONCILIATION_COMPANIES,
  RECONCILIATION_COMPANY_META,
  SECONDARY_HEADERS,
  type ReconciliationAccountMapping,
  type ReconciliationEngineResult,
  type ReconciliationPeriod,
} from "@/lib/reconciliation/types";

const googleAuth = new GoogleAuth({
  scopes: [
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
  ],
});

const PRIMARY_MAX_ROWS = 2000;
const SECONDARY_MAX_ROWS = 1200;

export type ReconciliationGoogleConfig = {
  accountTitleSheetName: string;
  accountTitleSpreadsheetId: string;
  primarySpreadsheetId: string;
  primaryTemplateSheetName: string;
  secondaryOutputFolderId: string;
  secondaryTemplateSheetName: string;
  secondaryTemplateSpreadsheetId: string;
};

export type GoogleOutput = {
  driveFileId: string;
  existed: boolean;
  name: string;
  sheetName?: string;
  url: string;
};

type SheetProperties = {
  gridProperties?: { columnCount?: number; rowCount?: number };
  hidden?: boolean;
  index?: number;
  sheetId: number;
  title: string;
};

type SpreadsheetMeta = {
  properties?: { title?: string };
  sheets?: {
    data?: {
      rowMetadata?: { pixelSize?: number }[];
    }[];
    properties: SheetProperties;
  }[];
  spreadsheetId: string;
  spreadsheetUrl?: string;
};

type DriveFile = {
  id: string;
  modifiedTime?: string;
  name: string;
  trashed?: boolean;
  webViewLink?: string;
};

type DriveFileList = {
  files?: DriveFile[];
  nextPageToken?: string;
};

type DrivePermission = {
  emailAddress?: string;
  id: string;
  role: string;
  type: string;
};

type DrivePermissionList = {
  permissions?: DrivePermission[];
};

const RECONCILIATION_EDITOR_EMAIL = "hc.thuanviet@gmail.com";

type SheetsValues = {
  values?: unknown[][];
};

function sheetsUrl(spreadsheetId: string, suffix = "") {
  return `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId,
  )}${suffix}`;
}

function sheetLink(spreadsheetId: string, sheetId?: number) {
  const base = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    spreadsheetId,
  )}`;
  return sheetId === undefined ? base : `${base}/edit#gid=${sheetId}`;
}

function quoteDriveQuery(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function secondaryFileName(period: ReconciliationPeriod) {
  return `[T${String(period.month).padStart(2, "0")}/${
    period.year
  }] BaseReward`;
}

function secondarySheetName(
  period: ReconciliationPeriod,
  company: (typeof RECONCILIATION_COMPANIES)[number],
) {
  return `BR T${String(period.month).padStart(2, "0")}.${String(
    period.year,
  ).slice(-2)} - ${RECONCILIATION_COMPANY_META[company].shortLabel}`;
}

function sheetsDateValue(value: Date | null, raw: string) {
  if (!value) return raw;
  return value.getTime() / 86_400_000 + 25_569;
}

function formatMoneyText(value: number) {
  return String(Math.round(Number(value) || 0)).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    ",",
  );
}

async function client() {
  return googleAuth.getClient();
}

async function getSpreadsheetMeta(spreadsheetId: string) {
  const authClient = await client();
  const response = await authClient.request<SpreadsheetMeta>({
    method: "GET",
    params: {
      fields:
        "spreadsheetId,spreadsheetUrl,properties(title),sheets(properties(sheetId,title,index,hidden,gridProperties(rowCount,columnCount)))",
    },
    url: sheetsUrl(spreadsheetId),
  });
  return response.data;
}

async function readValues(spreadsheetId: string, range: string) {
  const authClient = await client();
  const response = await authClient.request<SheetsValues>({
    method: "GET",
    params: { majorDimension: "ROWS", valueRenderOption: "UNFORMATTED_VALUE" },
    url: sheetsUrl(
      spreadsheetId,
      `/values/${encodeURIComponent(range)}`,
    ),
  });
  return response.data.values ?? [];
}

async function readRowPixelSize(
  spreadsheetId: string,
  sheetName: string,
  rowNumber: number,
) {
  const authClient = await client();
  const escapedSheetName = sheetName.replace(/'/g, "''");
  const response = await authClient.request<SpreadsheetMeta>({
    method: "GET",
    params: {
      fields: "sheets(data(rowMetadata(pixelSize)))",
      includeGridData: true,
      ranges: `'${escapedSheetName}'!${rowNumber}:${rowNumber}`,
    },
    url: sheetsUrl(spreadsheetId),
  });
  return response.data.sheets?.[0]?.data?.[0]?.rowMetadata?.[0]?.pixelSize;
}

function findHeaderIndex(headers: unknown[], aliases: string[]) {
  const expected = new Set(aliases.map(normalizeName));
  return headers.findIndex((header) => expected.has(normalizeName(header)));
}

export async function loadReconciliationAccountMappings(
  config: ReconciliationGoogleConfig,
): Promise<ReconciliationAccountMapping[]> {
  if (!config.accountTitleSpreadsheetId || !config.accountTitleSheetName) {
    return [];
  }
  const range = `'${config.accountTitleSheetName.replace(/'/g, "''")}'!A:Z`;
  const values = await readValues(config.accountTitleSpreadsheetId, range);
  if (!values.length) return [];

  const headers = values[0] ?? [];
  const employeeNameColumn = findHeaderIndex(headers, [
    "Họ và tên nhân viên",
    "Họ và tên",
    "Họ tên",
    "Tên nhân viên",
  ]);
  const accountNameColumn = findHeaderIndex(headers, [
    "Tên account",
    "Tên tài khoản",
    "Account",
    "Chức danh",
    "Tên chức danh",
  ]);
  const usernameColumn = findHeaderIndex(headers, [
    "Username",
    "User name",
    "Tên đăng nhập",
    "Tài khoản BaseReward",
    "BaseReward Username",
  ]);
  if (employeeNameColumn < 0 || (accountNameColumn < 0 && usernameColumn < 0)) {
    throw new Error(
      `Tab “${config.accountTitleSheetName}” thiếu cột nhân viên hoặc account/username.`,
    );
  }

  return values
    .slice(1)
    .map((row) => ({
      accountName:
        accountNameColumn >= 0 ? safeText(row[accountNameColumn]) : "",
      employeeName: safeText(row[employeeNameColumn]),
      username: usernameColumn >= 0 ? safeText(row[usernameColumn]) : "",
    }))
    .filter(
      (item) =>
        item.employeeName && Boolean(item.accountName || item.username),
    );
}

async function sheetsBatchUpdate(
  spreadsheetId: string,
  requests: Record<string, unknown>[],
) {
  if (!requests.length) return;
  const authClient = await client();
  await authClient.request({
    data: { includeSpreadsheetInResponse: false, requests },
    method: "POST",
    url: sheetsUrl(spreadsheetId, ":batchUpdate"),
  });
}

async function clearValues(spreadsheetId: string, ranges: string[]) {
  const authClient = await client();
  await authClient.request({
    data: { ranges },
    method: "POST",
    url: sheetsUrl(spreadsheetId, "/values:batchClear"),
  });
}

async function writeValues(
  spreadsheetId: string,
  data: { range: string; values: unknown[][] }[],
) {
  if (!data.length) return;
  const authClient = await client();
  await authClient.request({
    data: { data, includeValuesInResponse: false, valueInputOption: "RAW" },
    method: "POST",
    url: sheetsUrl(spreadsheetId, "/values:batchUpdate"),
  });
}

function copyFormatRequest(input: {
  destinationSheetId?: number;
  destinationEndRow: number;
  destinationStartRow: number;
  endColumn: number;
  sheetId: number;
  sourceRow: number;
  sourceSheetId?: number;
  startColumn: number;
}) {
  return {
    copyPaste: {
      destination: {
        endColumnIndex: input.endColumn,
        endRowIndex: input.destinationEndRow,
        sheetId: input.destinationSheetId ?? input.sheetId,
        startColumnIndex: input.startColumn,
        startRowIndex: input.destinationStartRow,
      },
      pasteOrientation: "NORMAL",
      pasteType: "PASTE_FORMAT",
      source: {
        endColumnIndex: input.endColumn,
        endRowIndex: input.sourceRow + 1,
        sheetId: input.sourceSheetId ?? input.sheetId,
        startColumnIndex: input.startColumn,
        startRowIndex: input.sourceRow,
      },
    },
  };
}

function clearFormatRequest(input: {
  endColumn: number;
  endRow: number;
  sheetId: number;
  startColumn: number;
  startRow: number;
}) {
  return {
    repeatCell: {
      cell: { userEnteredFormat: {} },
      fields: "userEnteredFormat",
      range: {
        endColumnIndex: input.endColumn,
        endRowIndex: input.endRow,
        sheetId: input.sheetId,
        startColumnIndex: input.startColumn,
        startRowIndex: input.startRow,
      },
    },
  };
}

function ensureRowCountRequest(
  sheet: SheetProperties,
  minimumRowCount: number,
) {
  if ((sheet.gridProperties?.rowCount ?? 0) >= minimumRowCount) return null;
  return {
    updateSheetProperties: {
      fields: "gridProperties.rowCount",
      properties: {
        gridProperties: { rowCount: minimumRowCount },
        sheetId: sheet.sheetId,
      },
    },
  };
}

function numberFormatRequest(input: {
  endColumn: number;
  endRow: number;
  pattern: string;
  sheetId: number;
  startColumn: number;
  startRow: number;
  type?: "DATE" | "NUMBER";
}) {
  return {
    repeatCell: {
      cell: {
        userEnteredFormat: {
          numberFormat: {
            pattern: input.pattern,
            type: input.type ?? "NUMBER",
          },
        },
      },
      fields: "userEnteredFormat.numberFormat",
      range: {
        endColumnIndex: input.endColumn,
        endRowIndex: input.endRow,
        sheetId: input.sheetId,
        startColumnIndex: input.startColumn,
        startRowIndex: input.startRow,
      },
    },
  };
}

function rowHeightRequest(input: {
  endRow: number;
  pixelSize: number;
  sheetId: number;
  startRow: number;
}) {
  return {
    updateDimensionProperties: {
      fields: "pixelSize",
      properties: { pixelSize: input.pixelSize },
      range: {
        dimension: "ROWS",
        endIndex: input.endRow,
        sheetId: input.sheetId,
        startIndex: input.startRow,
      },
    },
  };
}

function whiteBlankRequest(input: {
  endColumn: number;
  endRow: number;
  sheetId: number;
  startColumn: number;
  startRow: number;
}) {
  if (input.startRow >= input.endRow) return null;
  return {
    repeatCell: {
      cell: {
        userEnteredFormat: {
          backgroundColor: { blue: 1, green: 1, red: 1 },
          borders: {
            bottom: { color: { blue: 1, green: 1, red: 1 }, style: "SOLID" },
            left: { color: { blue: 1, green: 1, red: 1 }, style: "SOLID" },
            right: { color: { blue: 1, green: 1, red: 1 }, style: "SOLID" },
            top: { color: { blue: 1, green: 1, red: 1 }, style: "SOLID" },
          },
        },
      },
      fields: "userEnteredFormat(backgroundColor,borders)",
      range: {
        endColumnIndex: input.endColumn,
        endRowIndex: input.endRow,
        sheetId: input.sheetId,
        startColumnIndex: input.startColumn,
        startRowIndex: input.startRow,
      },
    },
  };
}

export type ReconciliationGoogleRegistryItem = {
  link: string;
  name: string;
  periodCode: string;
  updatedLabel: string;
};

function parsePrimaryPeriod(value: string) {
  const match = safeText(value).match(/^T(\d{2})\.(\d{4})$/i);
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return {
    periodCode: `T${match[1]}.${match[2]}`,
    sortKey: year * 100 + month,
  };
}

function parseSecondaryPeriod(value: string) {
  const match = safeText(value).match(
    /^\[?T(\d{2})[_./-]?(\d{4})\]?\s*BaseReward$/i,
  );
  if (!match) return null;
  const month = Number(match[1]);
  const year = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return {
    periodCode: `T${match[1]}.${match[2]}`,
    sortKey: year * 100 + month,
  };
}

function updatedLabel(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "Asia/Bangkok",
    year: "numeric",
  }).format(date);
}

async function getDriveFile(fileId: string) {
  const authClient = await client();
  const response = await authClient.request<DriveFile>({
    method: "GET",
    params: {
      fields: "id,name,modifiedTime,webViewLink",
      supportsAllDrives: true,
    },
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId,
    )}`,
  });
  return response.data;
}

async function ensureDrivePermission(input: {
  emailAddress?: string;
  fileId: string;
  role: "reader" | "writer";
  type: "anyone" | "user";
}) {
  const authClient = await client();
  const response = await authClient.request<DrivePermissionList>({
    method: "GET",
    params: {
      fields: "permissions(id,type,role,emailAddress)",
      supportsAllDrives: true,
    },
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      input.fileId,
    )}/permissions`,
  });
  const existing = (response.data.permissions ?? []).find((permission) => {
    if (permission.type !== input.type) return false;
    if (input.type === "anyone") return true;
    return (
      permission.emailAddress?.toLocaleLowerCase("vi-VN") ===
      input.emailAddress?.toLocaleLowerCase("vi-VN")
    );
  });
  const alreadySufficient =
    existing &&
    (existing.role === input.role ||
      (input.role === "writer" &&
        ["owner", "organizer", "fileOrganizer"].includes(existing.role)));
  if (alreadySufficient) return;

  if (existing) {
    await authClient.request({
      data: { role: input.role },
      method: "PATCH",
      params: { supportsAllDrives: true },
      url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        input.fileId,
      )}/permissions/${encodeURIComponent(existing.id)}`,
    });
    return;
  }

  await authClient.request({
    data: {
      ...(input.emailAddress ? { emailAddress: input.emailAddress } : {}),
      role: input.role,
      type: input.type,
    },
    method: "POST",
    params: {
      sendNotificationEmail: input.type === "user" ? false : undefined,
      supportsAllDrives: true,
    },
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      input.fileId,
    )}/permissions`,
  });
}

async function ensureReconciliationOutputSharing(fileId: string) {
  // Google Drive không hỗ trợ cập nhật quyền song song an toàn trên cùng file.
  await ensureDrivePermission({ fileId, role: "reader", type: "anyone" });
  await ensureDrivePermission({
    emailAddress: RECONCILIATION_EDITOR_EMAIL,
    fileId,
    role: "writer",
    type: "user",
  });
}

async function listSecondaryDriveFiles(
  config: ReconciliationGoogleConfig,
) {
  if (!config.secondaryOutputFolderId) return [];
  const authClient = await client();
  const files: DriveFile[] = [];
  let pageToken = "";
  do {
    const response = await authClient.request<DriveFileList>({
      method: "GET",
      params: {
        fields: "nextPageToken,files(id,name,modifiedTime,webViewLink)",
        includeItemsFromAllDrives: true,
        orderBy: "modifiedTime desc",
        pageSize: 100,
        pageToken: pageToken || undefined,
        q: `'${quoteDriveQuery(
          config.secondaryOutputFolderId,
        )}' in parents and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'`,
        supportsAllDrives: true,
      },
      url: "https://www.googleapis.com/drive/v3/files",
    });
    files.push(...(response.data.files ?? []));
    pageToken = response.data.nextPageToken ?? "";
  } while (pageToken);
  return files;
}

export async function getPrimaryGoogleRegistry(
  config: ReconciliationGoogleConfig,
): Promise<ReconciliationGoogleRegistryItem | null> {
  if (!config.primarySpreadsheetId) return null;
  const meta = await getSpreadsheetMeta(config.primarySpreadsheetId);
  // Quyền đọc Sheets và quyền đọc metadata Drive có thể được cấp riêng.
  // Danh sách tab vẫn phải hiện nếu service account đọc được Spreadsheet.
  const driveFile = await getDriveFile(config.primarySpreadsheetId).catch(
    () => null,
  );
  const latest = (meta.sheets ?? [])
    .map((sheet) => {
      const parsed = parsePrimaryPeriod(sheet.properties.title);
      return parsed ? { parsed, sheet: sheet.properties } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.parsed.sortKey - left.parsed.sortKey)[0];
  if (!latest) return null;
  return {
    link: sheetLink(
      config.primarySpreadsheetId,
      latest.sheet.sheetId,
    ),
    name: latest.sheet.title,
    periodCode: latest.parsed.periodCode,
    updatedLabel: updatedLabel(driveFile?.modifiedTime),
  };
}

export async function getSecondaryGoogleRegistry(
  config: ReconciliationGoogleConfig,
): Promise<ReconciliationGoogleRegistryItem[]> {
  const files = await listSecondaryDriveFiles(config);
  return files
    .map((file) => {
      const parsed = parseSecondaryPeriod(file.name);
      return parsed ? { file, parsed } : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => {
      const modified =
        new Date(right.file.modifiedTime ?? 0).getTime() -
        new Date(left.file.modifiedTime ?? 0).getTime();
      if (modified) return modified;
      if (right.parsed.sortKey !== left.parsed.sortKey) {
        return right.parsed.sortKey - left.parsed.sortKey;
      }
      return left.file.name.localeCompare(right.file.name, "vi");
    })
    .slice(0, 12)
    .map(({ file, parsed }) => ({
      link: file.webViewLink || sheetLink(file.id),
      name: file.name,
      periodCode: parsed.periodCode,
      updatedLabel: updatedLabel(file.modifiedTime),
    }));
}

export async function findExistingPrimaryOutput(
  config: ReconciliationGoogleConfig,
  period: ReconciliationPeriod,
): Promise<GoogleOutput | null> {
  if (!config.primarySpreadsheetId) return null;
  const meta = await getSpreadsheetMeta(config.primarySpreadsheetId);
  const sheet = meta.sheets?.find(
    (item) => item.properties.title === period.tabName,
  );
  if (!sheet) return null;
  return {
    driveFileId: config.primarySpreadsheetId,
    existed: true,
    name: meta.properties?.title || period.tabName,
    sheetName: period.tabName,
    url: sheetLink(
      config.primarySpreadsheetId,
      sheet.properties.sheetId,
    ),
  };
}

export async function findExistingSecondaryOutput(
  config: ReconciliationGoogleConfig,
  period: ReconciliationPeriod,
): Promise<GoogleOutput | null> {
  if (!config.secondaryOutputFolderId) return null;
  const file = (await listSecondaryDriveFiles(config)).find((item) => {
    const parsed = parseSecondaryPeriod(item.name);
    return parsed?.periodCode === period.periodKey;
  });
  return file
    ? {
        driveFileId: file.id,
        existed: true,
        name: file.name,
        url: file.webViewLink || sheetLink(file.id),
      }
    : null;
}

export type CancelReconciliationGoogleOutputsResult = {
  primaryDeleted: boolean;
  secondaryDeleted: {
    id: string;
    name: string;
  }[];
};

async function setDriveFileTrashed(fileId: string, trashed: boolean) {
  const authClient = await client();
  await authClient.request<DriveFile>({
    data: { trashed },
    method: "PATCH",
    params: {
      fields: "id,name,trashed",
      supportsAllDrives: true,
    },
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId,
    )}`,
  });
}

export async function cancelReconciliationGoogleOutputs(input: {
  config: ReconciliationGoogleConfig;
  period: ReconciliationPeriod;
}): Promise<CancelReconciliationGoogleOutputsResult> {
  if (input.period.tabName === input.config.primaryTemplateSheetName) {
    throw new Error(
      `Không thể hủy kỳ ${input.period.periodKey} vì đang trùng với tab mẫu tổng hợp.`,
    );
  }

  const [primaryMeta, secondaryFiles] = await Promise.all([
    input.config.primarySpreadsheetId
      ? getSpreadsheetMeta(input.config.primarySpreadsheetId)
      : Promise.resolve(null),
    input.config.secondaryOutputFolderId
      ? listSecondaryDriveFiles(input.config)
      : Promise.resolve([]),
  ]);
  const primarySheet = primaryMeta?.sheets?.find(
    (sheet) => sheet.properties.title === input.period.tabName,
  );
  const matchingSecondaryFiles = secondaryFiles.filter(
    (file) =>
      parseSecondaryPeriod(file.name)?.periodCode === input.period.periodKey,
  );
  const trashedFiles: DriveFile[] = [];

  try {
    for (const file of matchingSecondaryFiles) {
      await setDriveFileTrashed(file.id, true);
      trashedFiles.push(file);
    }
    if (primarySheet) {
      await sheetsBatchUpdate(input.config.primarySpreadsheetId, [
        { deleteSheet: { sheetId: primarySheet.properties.sheetId } },
      ]);
    }
  } catch (error) {
    await Promise.all(
      trashedFiles.map((file) =>
        setDriveFileTrashed(file.id, false).catch(() => undefined),
      ),
    );
    throw error;
  }

  return {
    primaryDeleted: Boolean(primarySheet),
    secondaryDeleted: matchingSecondaryFiles.map((file) => ({
      id: file.id,
      name: file.name,
    })),
  };
}

export async function createPrimaryOutput(input: {
  config: ReconciliationGoogleConfig;
  engine: ReconciliationEngineResult;
  period: ReconciliationPeriod;
  replaceExisting?: boolean;
}) {
  const existing = await findExistingPrimaryOutput(input.config, input.period);
  if (existing && !input.replaceExisting) {
    await ensureReconciliationOutputSharing(existing.driveFileId);
    return existing;
  }

  let meta = await getSpreadsheetMeta(input.config.primarySpreadsheetId);
  const existingTarget = meta.sheets?.find(
    (sheet) => sheet.properties.title === input.period.tabName,
  );
  if (existingTarget) {
    await sheetsBatchUpdate(input.config.primarySpreadsheetId, [
      { deleteSheet: { sheetId: existingTarget.properties.sheetId } },
    ]);
    meta = await getSpreadsheetMeta(input.config.primarySpreadsheetId);
  }
  const template = meta.sheets?.find(
    (sheet) =>
      sheet.properties.title === input.config.primaryTemplateSheetName,
  );
  if (!template) {
    throw new Error(
      `Không tìm thấy tab mẫu tổng hợp “${input.config.primaryTemplateSheetName}”.`,
    );
  }
  const templateTitleValues = await readValues(
    input.config.primarySpreadsheetId,
    `'${input.config.primaryTemplateSheetName.replace(/'/g, "''")}'!AL1`,
  );
  const templateTitle =
    safeText(templateTitleValues[0]?.[0]).split("\n")[0] ||
    "THỐNG KÊ THEO NGƯỜI SỬ DỤNG";
  await sheetsBatchUpdate(input.config.primarySpreadsheetId, [
    {
      duplicateSheet: {
        insertSheetIndex: meta.sheets?.length ?? 0,
        newSheetName: input.period.tabName,
        sourceSheetId: template.properties.sheetId,
      },
    },
  ]);
  const refreshed = await getSpreadsheetMeta(input.config.primarySpreadsheetId);
  const target = refreshed.sheets?.find(
    (sheet) => sheet.properties.title === input.period.tabName,
  );
  if (!target) {
    throw new Error("Đã nhân tab mẫu nhưng không tìm thấy tab đích.");
  }
  const growTarget = ensureRowCountRequest(
    target.properties,
    PRIMARY_MAX_ROWS,
  );
  if (growTarget) {
    await sheetsBatchUpdate(input.config.primarySpreadsheetId, [growTarget]);
  }
  const prefix = `'${input.period.tabName.replace(/'/g, "''")}'!`;
  await clearValues(input.config.primarySpreadsheetId, [
    `${prefix}C5:P${PRIMARY_MAX_ROWS}`,
    `${prefix}S6:W${PRIMARY_MAX_ROWS}`,
    `${prefix}Y6:AC${PRIMARY_MAX_ROWS}`,
    `${prefix}AE6:AI${PRIMARY_MAX_ROWS}`,
    `${prefix}AL6:AN${PRIMARY_MAX_ROWS}`,
    `${prefix}AP6:AR${PRIMARY_MAX_ROWS}`,
    `${prefix}AT6:AU${PRIMARY_MAX_ROWS}`,
  ]);

  const valueWrites: { range: string; values: unknown[][] }[] = [
    { range: `${prefix}N2`, values: [[input.engine.totalAmount]] },
    {
      range: `${prefix}AL1`,
      values: [[`${templateTitle}\nKỳ: ${input.period.label}`]],
    },
  ];
  if (input.engine.details.length) {
    valueWrites.push({
      range: `${prefix}C5:P${4 + input.engine.details.length}`,
      values: input.engine.details.map((row) => [
        row.exchangeTimeRaw,
        row.program,
        row.orderCode,
        row.transactionCode,
        row.occurrence,
        row.customerCode,
        row.brand,
        row.giftName,
        row.category,
        row.quantity,
        row.value,
        row.employeeName,
        row.username,
        row.company,
      ]),
    });
  }

  for (const company of RECONCILIATION_COMPANIES) {
    const companyMeta = RECONCILIATION_COMPANY_META[company];
    const companyStats = input.engine.companyStats[company];
    const userStats = input.engine.userStats[company];
    const companyTotal = companyStats.reduce((sum, row) => sum + row.total, 0);
    const userTotal = userStats.reduce((sum, row) => sum + row.total, 0);
    valueWrites.push({
      range: `${prefix}${companyMeta.primaryCompanyTotalCell}`,
      values: [[companyTotal]],
    });
    valueWrites.push({
      range: `${prefix}${companyMeta.primaryUserTotalCell}`,
      values: [[userTotal]],
    });
    if (companyStats.length) {
      valueWrites.push({
        range: `${prefix}${columnName(
          companyMeta.primaryCompanyStartColumn,
        )}6:${columnName(
          companyMeta.primaryCompanyStartColumn + 4,
        )}${5 + companyStats.length}`,
        values: companyStats.map((row) => [
          row.giftName,
          row.category,
          row.quantity,
          row.value,
          row.total,
        ]),
      });
    }
    if (userStats.length) {
      valueWrites.push({
        range: `${prefix}${columnName(
          companyMeta.primaryUserStartColumn,
        )}6:${columnName(
          companyMeta.primaryUserStartColumn +
            companyMeta.primaryUserWidth -
            1,
        )}${5 + userStats.length}`,
        values: userStats.map((row) =>
          companyMeta.primaryUserWidth === 3
            ? [row.employeeName, row.employeeCode, row.total]
            : [row.employeeName, row.total],
        ),
      });
    }
  }
  await writeValues(input.config.primarySpreadsheetId, valueWrites);

  const formatRequests: Record<string, unknown>[] = [
    clearFormatRequest({
      endColumn: 16,
      endRow: PRIMARY_MAX_ROWS,
      sheetId: target.properties.sheetId,
      startColumn: 2,
      startRow: 4,
    }),
    ...[
      [18, 23],
      [24, 29],
      [30, 35],
      [37, 40],
      [41, 44],
      [45, 47],
    ].map(([startColumn, endColumn]) =>
      clearFormatRequest({
        endColumn,
        endRow: PRIMARY_MAX_ROWS,
        sheetId: target.properties.sheetId,
        startColumn,
        startRow: 5,
      }),
    ),
    numberFormatRequest({
      endColumn: 14,
      endRow: 2,
      pattern: "#,##0",
      sheetId: target.properties.sheetId,
      startColumn: 13,
      startRow: 1,
    }),
  ];
  if (input.engine.details.length) {
    formatRequests.push(
      copyFormatRequest({
        destinationEndRow: 5,
        destinationSheetId: target.properties.sheetId,
        destinationStartRow: 4,
        endColumn: 16,
        sheetId: template.properties.sheetId,
        sourceRow: 4,
        sourceSheetId: template.properties.sheetId,
        startColumn: 2,
      }),
    );
  }
  if (input.engine.details.length > 1) {
    formatRequests.push(
      copyFormatRequest({
        destinationEndRow: 4 + input.engine.details.length,
        destinationSheetId: target.properties.sheetId,
        destinationStartRow: 5,
        endColumn: 16,
        sheetId: template.properties.sheetId,
        sourceRow: 5,
        sourceSheetId: template.properties.sheetId,
        startColumn: 2,
      }),
    );
  }
  for (const company of RECONCILIATION_COMPANIES) {
    const companyMeta = RECONCILIATION_COMPANY_META[company];
    const companyCount = input.engine.companyStats[company].length;
    const userCount = input.engine.userStats[company].length;
    formatRequests.push(
      numberFormatRequest({
        endColumn: companyMeta.primaryCompanyStartColumn + 4,
        endRow: 3,
        pattern: "#,##0",
        sheetId: target.properties.sheetId,
        startColumn: companyMeta.primaryCompanyStartColumn + 3,
        startRow: 2,
      }),
      numberFormatRequest({
        endColumn:
          companyMeta.primaryUserStartColumn +
          companyMeta.primaryUserWidth -
          1,
        endRow: 3,
        pattern: "#,##0",
        sheetId: target.properties.sheetId,
        startColumn:
          companyMeta.primaryUserStartColumn +
          companyMeta.primaryUserWidth -
          2,
        startRow: 2,
      }),
    );
    if (companyCount) {
      formatRequests.push(
        copyFormatRequest({
          destinationEndRow: 6,
          destinationSheetId: target.properties.sheetId,
          destinationStartRow: 5,
          endColumn: companyMeta.primaryCompanyStartColumn + 4,
          sheetId: template.properties.sheetId,
          sourceRow: 5,
          sourceSheetId: template.properties.sheetId,
          startColumn: companyMeta.primaryCompanyStartColumn - 1,
        }),
      );
    }
    if (companyCount > 1) {
      formatRequests.push(
        copyFormatRequest({
          destinationEndRow: 5 + companyCount,
          destinationSheetId: target.properties.sheetId,
          destinationStartRow: 6,
          endColumn: companyMeta.primaryCompanyStartColumn + 4,
          sheetId: template.properties.sheetId,
          sourceRow: 6,
          sourceSheetId: template.properties.sheetId,
          startColumn: companyMeta.primaryCompanyStartColumn - 1,
        }),
      );
    }
    if (userCount) {
      formatRequests.push(
        copyFormatRequest({
          destinationEndRow: 6,
          destinationSheetId: target.properties.sheetId,
          destinationStartRow: 5,
          endColumn:
            companyMeta.primaryUserStartColumn +
            companyMeta.primaryUserWidth -
            1,
          sheetId: template.properties.sheetId,
          sourceRow: 5,
          sourceSheetId: template.properties.sheetId,
          startColumn: companyMeta.primaryUserStartColumn - 1,
        }),
      );
    }
    if (userCount > 1) {
      formatRequests.push(
        copyFormatRequest({
          destinationEndRow: 5 + userCount,
          destinationSheetId: target.properties.sheetId,
          destinationStartRow: 6,
          endColumn:
            companyMeta.primaryUserStartColumn +
            companyMeta.primaryUserWidth -
            1,
          sheetId: template.properties.sheetId,
          sourceRow: 6,
          sourceSheetId: template.properties.sheetId,
          startColumn: companyMeta.primaryUserStartColumn - 1,
        }),
      );
    }
    if (companyCount) {
      formatRequests.push(
        numberFormatRequest({
          endColumn: companyMeta.primaryCompanyStartColumn + 4,
          endRow: 5 + companyCount,
          pattern: "#,##0",
          sheetId: target.properties.sheetId,
          startColumn: companyMeta.primaryCompanyStartColumn + 1,
          startRow: 5,
        }),
      );
    }
    if (userCount) {
      formatRequests.push(
        numberFormatRequest({
          endColumn:
            companyMeta.primaryUserStartColumn +
            companyMeta.primaryUserWidth -
            1,
          endRow: 5 + userCount,
          pattern: "#,##0",
          sheetId: target.properties.sheetId,
          startColumn:
            companyMeta.primaryUserStartColumn +
            companyMeta.primaryUserWidth -
            2,
          startRow: 5,
        }),
      );
    }
    const whiteCompany = whiteBlankRequest({
      endColumn: companyMeta.primaryCompanyStartColumn + 4,
      endRow: PRIMARY_MAX_ROWS,
      sheetId: target.properties.sheetId,
      startColumn: companyMeta.primaryCompanyStartColumn - 1,
      startRow: 5 + companyCount,
    });
    const whiteUser = whiteBlankRequest({
      endColumn:
        companyMeta.primaryUserStartColumn + companyMeta.primaryUserWidth - 1,
      endRow: PRIMARY_MAX_ROWS,
      sheetId: target.properties.sheetId,
      startColumn: companyMeta.primaryUserStartColumn - 1,
      startRow: 5 + userCount,
    });
    if (whiteCompany) formatRequests.push(whiteCompany);
    if (whiteUser) formatRequests.push(whiteUser);
  }
  const whiteDetails = whiteBlankRequest({
    endColumn: 16,
    endRow: PRIMARY_MAX_ROWS,
    sheetId: target.properties.sheetId,
    startColumn: 2,
    startRow: 4 + input.engine.details.length,
  });
  if (whiteDetails) formatRequests.push(whiteDetails);
  if (input.engine.details.length) {
    formatRequests.push(
      numberFormatRequest({
        endColumn: 13,
        endRow: 4 + input.engine.details.length,
        pattern: "#,##0",
        sheetId: target.properties.sheetId,
        startColumn: 11,
        startRow: 4,
      }),
    );
  }
  await sheetsBatchUpdate(input.config.primarySpreadsheetId, formatRequests);

  await ensureReconciliationOutputSharing(input.config.primarySpreadsheetId);

  return {
    driveFileId: input.config.primarySpreadsheetId,
    existed: false,
    name: meta.properties?.title || input.period.tabName,
    sheetName: input.period.tabName,
    url: sheetLink(
      input.config.primarySpreadsheetId,
      target.properties.sheetId,
    ),
  } satisfies GoogleOutput;
}

function columnName(column: number) {
  let value = column;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

export async function createSecondaryOutput(input: {
  config: ReconciliationGoogleConfig;
  engine: ReconciliationEngineResult;
  period: ReconciliationPeriod;
}) {
  const existing = await findExistingSecondaryOutput(input.config, input.period);
  if (existing) {
    await ensureReconciliationOutputSharing(existing.driveFileId);
    return existing;
  }

  const authClient = await client();
  const name = secondaryFileName(input.period);
  const copied = await authClient.request<DriveFile>({
    data: {
      name,
      parents: [input.config.secondaryOutputFolderId],
    },
    method: "POST",
    params: {
      fields: "id,name,webViewLink",
      supportsAllDrives: true,
    },
    url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      input.config.secondaryTemplateSpreadsheetId,
    )}/copy`,
  });
  const spreadsheetId = copied.data.id;

  try {
    let meta = await getSpreadsheetMeta(spreadsheetId);
    const template = meta.sheets?.find(
      (sheet) =>
        sheet.properties.title === input.config.secondaryTemplateSheetName,
    );
    if (!template) {
      throw new Error(
        `Không tìm thấy tab mẫu bảng kê “${input.config.secondaryTemplateSheetName}”.`,
      );
    }
    const templateDataRowHeight = await readRowPixelSize(
      spreadsheetId,
      template.properties.title,
      4,
    );
    const firstCompany = RECONCILIATION_COMPANIES[0];
    const setupRequests: Record<string, unknown>[] = [
      {
        updateSheetProperties: {
          fields: "title",
          properties: {
            sheetId: template.properties.sheetId,
            title: secondarySheetName(input.period, firstCompany),
          },
        },
      },
      ...((meta.sheets ?? [])
        .filter(
          (sheet) => sheet.properties.sheetId !== template.properties.sheetId,
        )
        .map((sheet) => ({
          deleteSheet: { sheetId: sheet.properties.sheetId },
        })) as Record<string, unknown>[]),
      ...RECONCILIATION_COMPANIES.slice(1).map((company) => ({
        duplicateSheet: {
          newSheetName: secondarySheetName(input.period, company),
          sourceSheetId: template.properties.sheetId,
        },
      })),
    ];
    await sheetsBatchUpdate(spreadsheetId, setupRequests);
    meta = await getSpreadsheetMeta(spreadsheetId);
    await sheetsBatchUpdate(
      spreadsheetId,
      (meta.sheets ?? [])
        .map((sheet) =>
          ensureRowCountRequest(sheet.properties, SECONDARY_MAX_ROWS),
        )
        .filter(
          (request): request is NonNullable<typeof request> =>
            Boolean(request),
        ),
    );

    const clearRanges: string[] = [];
    const valueWrites: { range: string; values: unknown[][] }[] = [];
    const formatRequests: Record<string, unknown>[] = [];
    for (const company of RECONCILIATION_COMPANIES) {
      const sheetName = secondarySheetName(input.period, company);
      const sheet = meta.sheets?.find(
        (item) => item.properties.title === sheetName,
      );
      if (!sheet) throw new Error(`Không tạo được tab ${sheetName}.`);
      const escaped = `'${sheetName.replace(/'/g, "''")}'!`;
      const rows = input.engine.voucherRowsByCompany[company];
      const total = rows.reduce((sum, row) => sum + row.totalAmount, 0);
      clearRanges.push(`${escaped}A4:N${SECONDARY_MAX_ROWS}`);
      valueWrites.push(
        {
          range: `${escaped}A1`,
          values: [
            [
              `[${RECONCILIATION_COMPANY_META[company].titleLabel}] - BẢNG KÊ VOUCHER BASEREWARD - T${String(
                input.period.month,
              ).padStart(2, "0")}/${String(input.period.year).slice(-2)}`,
            ],
          ],
        },
        {
          range: `${escaped}A2`,
          values: [[`TỔNG: ${formatMoneyText(total)}`]],
        },
        { range: `${escaped}M2`, values: [["Người lập:"]] },
        { range: `${escaped}A3:N3`, values: [[...SECONDARY_HEADERS]] },
      );
      if (rows.length) {
        valueWrites.push({
          range: `${escaped}A4:N${3 + rows.length}`,
          values: rows.map((row) => [
            row.employeeName,
            row.department,
            row.username,
            sheetsDateValue(row.orderDate, row.orderDateRaw),
            row.provider,
            row.giftName,
            row.unitPrice,
            row.quantity,
            row.totalAmount,
            row.transactionCodeText,
            row.note,
            row.orderCode,
            row.listLabel,
            row.imageFormula,
          ]),
        });
      }
      if (rows.length > 1) {
        formatRequests.push(
          copyFormatRequest({
            destinationEndRow: 3 + rows.length,
            destinationStartRow: 4,
            endColumn: 14,
            sheetId: sheet.properties.sheetId,
            sourceRow: 4,
            startColumn: 0,
          }),
        );
      }
      if (rows.length) {
        if (templateDataRowHeight) {
          formatRequests.push(
            rowHeightRequest({
              endRow: 3 + rows.length,
              pixelSize: templateDataRowHeight,
              sheetId: sheet.properties.sheetId,
              startRow: 3,
            }),
          );
        }
        formatRequests.push({
          repeatCell: {
            cell: {
              userEnteredFormat: {
                numberFormat: { pattern: "dd/MM/yyyy", type: "DATE" },
              },
            },
            fields: "userEnteredFormat.numberFormat",
            range: {
              endColumnIndex: 4,
              endRowIndex: 3 + rows.length,
              sheetId: sheet.properties.sheetId,
              startColumnIndex: 3,
              startRowIndex: 3,
            },
          },
        });
        formatRequests.push({
          repeatCell: {
            cell: {
              userEnteredFormat: {
                numberFormat: { pattern: "#,##0", type: "NUMBER" },
              },
            },
            fields: "userEnteredFormat.numberFormat",
            range: {
              endColumnIndex: 9,
              endRowIndex: 3 + rows.length,
              sheetId: sheet.properties.sheetId,
              startColumnIndex: 6,
              startRowIndex: 3,
            },
          },
        });
        formatRequests.push({
          repeatCell: {
            cell: {
              userEnteredFormat: { wrapStrategy: "WRAP" },
            },
            fields: "userEnteredFormat.wrapStrategy",
            range: {
              endColumnIndex: 10,
              endRowIndex: 3 + rows.length,
              sheetId: sheet.properties.sheetId,
              startColumnIndex: 9,
              startRowIndex: 3,
            },
          },
        });
        formatRequests.push({
          repeatCell: {
            cell: {
              userEnteredFormat: {
                numberFormat: { pattern: "0", type: "NUMBER" },
              },
            },
            fields: "userEnteredFormat.numberFormat",
            range: {
              endColumnIndex: 12,
              endRowIndex: 3 + rows.length,
              sheetId: sheet.properties.sheetId,
              startColumnIndex: 11,
              startRowIndex: 3,
            },
          },
        });
      }
      const white = whiteBlankRequest({
        endColumn: 14,
        endRow: SECONDARY_MAX_ROWS,
        sheetId: sheet.properties.sheetId,
        startColumn: 0,
        startRow: 3 + rows.length,
      });
      if (white) formatRequests.push(white);
    }
    await clearValues(spreadsheetId, clearRanges);
    await writeValues(spreadsheetId, valueWrites);
    await sheetsBatchUpdate(spreadsheetId, formatRequests);

    await ensureReconciliationOutputSharing(spreadsheetId);

    return {
      driveFileId: spreadsheetId,
      existed: false,
      name,
      url: copied.data.webViewLink || sheetLink(spreadsheetId),
    } satisfies GoogleOutput;
  } catch (error) {
    await authClient
      .request({
        method: "DELETE",
        url: `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
          spreadsheetId,
        )}`,
      })
      .catch(() => undefined);
    throw error;
  }
}

export async function rollbackCreatedReconciliationGoogleOutputs(input: {
  config: ReconciliationGoogleConfig;
  outputs: {
    kind: "PRIMARY" | "SECONDARY";
    output: GoogleOutput;
  }[];
}) {
  const errors: string[] = [];
  for (const item of [...input.outputs].reverse()) {
    if (item.output.existed) continue;
    try {
      if (item.kind === "SECONDARY") {
        await setDriveFileTrashed(item.output.driveFileId, true);
        continue;
      }
      const meta = await getSpreadsheetMeta(input.config.primarySpreadsheetId);
      const sheet = meta.sheets?.find(
        (candidate) =>
          candidate.properties.title === item.output.sheetName &&
          candidate.properties.title !==
            input.config.primaryTemplateSheetName,
      );
      if (sheet) {
        await sheetsBatchUpdate(input.config.primarySpreadsheetId, [
          { deleteSheet: { sheetId: sheet.properties.sheetId } },
        ]);
      }
    } catch (error) {
      errors.push(
        `${item.kind}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  if (errors.length) {
    throw new Error(`Không hoàn tác hết đầu ra lỗi: ${errors.join("; ")}`);
  }
}
