import "server-only";

import { GoogleAuth } from "google-auth-library";

import { asRecord, numberValue, text, type JsonRecord } from "@/lib/operations/json";

export const EVALUATION_AUTOMATION_SERVICE_ACCOUNT =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
  "cong-van-hanh-web@tvg-ops-dev.iam.gserviceaccount.com";

const sheetsAuth = new GoogleAuth({
  scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
});

export type EvaluationAutomationMappingKey =
  | "stableId"
  | "employeeCode"
  | "employeeEmail"
  | "employeeName"
  | "jobTitle"
  | "department"
  | "reviewer"
  | "manager"
  | "indirectManager"
  | "indirectManager2"
  | "peer"
  | "hr"
  | "bod"
  | "milestoneDate";

export type EvaluationAutomationSourceConfig = {
  enabled: boolean;
  spreadsheetUrl: string;
  spreadsheetId: string;
  sheetName: string;
  hierarchySheetName: string;
  headerRow: number;
  leadDays: number;
  expiryDays: number;
  grouping: "monthly" | "quarterly" | "yearly";
  reviewerRole: "manager" | "indirect_manager" | "peer" | "hr" | "bod";
  mappings: Partial<Record<EvaluationAutomationMappingKey, string>>;
};

export type EvaluationAutomationSheetRow = {
  rowNumber: number;
  values: Record<string, string>;
};

export type EvaluationAutomationSheetData = {
  headers: string[];
  rows: EvaluationAutomationSheetRow[];
  sheetName: string;
  spreadsheetId: string;
  spreadsheetTitle: string;
};

const MAPPING_ALIASES: Record<EvaluationAutomationMappingKey, string[]> = {
  stableId: ["job id", "id", "ma job", "ma dong", "external id"],
  employeeCode: [
    "ma nhan su",
    "ma nhan vien",
    "mnv",
    "employee code",
  ],
  employeeEmail: [
    "email nhan vien",
    "email nhan su",
    "email",
    "e mail",
  ],
  employeeName: [
    "ho va ten",
    "ho ten",
    "nhan su",
    "ten nhan vien",
    "ten nhan su",
  ],
  jobTitle: ["chuc vu", "chuc danh", "vi tri", "job title"],
  department: [
    "khu vuc chuyen mon",
    "khu vuc",
    "phong ban",
    "bo phan",
  ],
  reviewer: ["nguoi danh gia", "nguoi cham", "reviewer", "evaluator"],
  manager: [
    "quan ly m1",
    "quan ly 1",
    "quan ly truc tiep",
    "cap tren",
    "quan ly",
    "line manager",
  ],
  indirectManager: [
    "quan ly m2",
    "quan ly 2",
    "quan ly gian tiep",
    "indirect manager",
  ],
  indirectManager2: [
    "quan ly m3",
    "quan ly 3",
    "quan ly gian tiep cap 2",
    "indirect manager 2",
  ],
  peer: ["dong nghiep", "nguoi danh gia dong cap", "peer"],
  hr: ["hr phu trach", "nhan su phu trach", "hr"],
  bod: [
    "bod",
    "ceo",
    "ban giam doc",
    "giam doc phu trach",
  ],
  milestoneDate: [
    "ngay cuoi cung thu viec",
    "ngay ket thuc thu viec",
    "han thu viec",
    "moc thoi gian",
    "ngay den han",
    "deadline",
  ],
};

function normalizeHeader(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseEvaluationSpreadsheetId(input: unknown) {
  const value = text(input);
  const match =
    value.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]+)/i) ||
    value.match(/[?&]id=([A-Za-z0-9_-]+)/i);
  if (match?.[1]) return match[1];
  return /^[A-Za-z0-9_-]{20,}$/.test(value) ? value : "";
}

export function parseEvaluationSheetGid(input: unknown) {
  const match = text(input).match(/[?#&]gid=(\d+)/i);
  return match?.[1] || "";
}

export function autoMapEvaluationAutomationHeaders(headers: string[]) {
  const normalized = headers.map((header) => ({
    header,
    normalized: normalizeHeader(header),
  }));
  const result: Partial<Record<EvaluationAutomationMappingKey, string>> = {};
  (Object.keys(MAPPING_ALIASES) as EvaluationAutomationMappingKey[]).forEach(
    (key) => {
      const aliases = MAPPING_ALIASES[key];
      const exact = normalized.find((item) => aliases.includes(item.normalized));
      const partial = exact
        ? null
        : normalized.find((item) =>
            aliases.some(
              (alias) =>
                item.normalized.includes(alias) || alias.includes(item.normalized),
            ),
          );
      const matched = exact || partial;
      if (matched?.header) result[key] = matched.header;
    },
  );
  return result;
}

export function normalizeEvaluationAutomationSourceConfig(
  value: unknown,
): EvaluationAutomationSourceConfig {
  const content = asRecord(value);
  const mappings = asRecord(
    content.automationSourceMappings || content.sourceMappings,
  );
  const grouping = text(
    content.generationMode ||
      content.automationCycleGrouping ||
      content.sourceCycleGrouping,
  );
  const reviewerRole = text(
    content.automationReviewerRole || content.sourceReviewerRole,
  );
  const spreadsheetUrl = text(
    content.automationSourceLink || content.sourceSpreadsheetUrl,
  );
  return {
    enabled:
      content.automationSourceEnabled === true ||
      text(content.automationSourceEnabled).toLowerCase() === "true" ||
      text(content.automationSourceEnabled) === "1",
    expiryDays: Math.max(
      0,
      Math.trunc(
        numberValue(
          content.automationExpiryDays || content.sourceExpiryDays,
          0,
        ),
      ),
    ),
    grouping: ["quarterly", "yearly"].includes(grouping)
      ? (grouping as "quarterly" | "yearly")
      : "monthly",
    headerRow: Math.max(
      1,
      Math.trunc(
        numberValue(content.automationHeaderRow || content.sourceHeaderRow, 1),
      ),
    ),
    hierarchySheetName:
      text(
        content.automationHierarchySheetName || content.hierarchySheetName,
      ) || "Data quản lý",
    leadDays: Math.max(
      0,
      Math.trunc(
        numberValue(content.automationLeadDays || content.sourceLeadDays, 0),
      ),
    ),
    mappings: Object.fromEntries(
      (Object.keys(MAPPING_ALIASES) as EvaluationAutomationMappingKey[])
        .map((key) => [key, text(mappings[key])])
        .filter(([, header]) => Boolean(header)),
    ) as Partial<Record<EvaluationAutomationMappingKey, string>>,
    reviewerRole: ["indirect_manager", "peer", "hr", "bod"].includes(reviewerRole)
      ? (reviewerRole as "indirect_manager" | "peer" | "hr" | "bod")
      : "manager",
    sheetName: text(
      content.automationSheetName || content.sourceSheetName,
    ),
    spreadsheetId: parseEvaluationSpreadsheetId(spreadsheetUrl),
    spreadsheetUrl,
  };
}

async function sheetsClient() {
  return sheetsAuth.getClient();
}

function googleSheetError(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Không đọc được Google Sheet.";
  if (/403|permission|forbidden|caller does not have permission/i.test(message)) {
    return new Error(
      `Google Sheet chưa chia sẻ quyền xem cho ${EVALUATION_AUTOMATION_SERVICE_ACCOUNT}.`,
    );
  }
  if (/404|not found/i.test(message)) {
    return new Error("Không tìm thấy Google Sheet hoặc sheet con đã chọn.");
  }
  return new Error(message);
}

export async function inspectEvaluationAutomationSpreadsheet(input: {
  spreadsheetUrl: string;
  sheetName?: string;
  headerRow?: number;
}) {
  const spreadsheetId = parseEvaluationSpreadsheetId(input.spreadsheetUrl);
  if (!spreadsheetId) {
    throw new Error("Link Google Sheet không hợp lệ.");
  }
  try {
    const client = await sheetsClient();
    const metadata = await client.request<{
      properties?: { title?: string };
      sheets?: Array<{
        properties?: {
          gridProperties?: { columnCount?: number; rowCount?: number };
          sheetId?: number;
          title?: string;
        };
      }>;
    }>({
      params: {
        fields:
          "properties(title),sheets(properties(sheetId,title,gridProperties(rowCount,columnCount)))",
      },
      url: `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`,
    });
    const sheets = (metadata.data.sheets || []).map((sheet) => ({
      columnCount: sheet.properties?.gridProperties?.columnCount || 0,
      rowCount: sheet.properties?.gridProperties?.rowCount || 0,
      sheetId: String(sheet.properties?.sheetId ?? ""),
      title: text(sheet.properties?.title),
    }));
    const requestedName = text(input.sheetName);
    const gid = parseEvaluationSheetGid(input.spreadsheetUrl);
    const selected =
      sheets.find((sheet) => sheet.title === requestedName) ||
      sheets.find((sheet) => sheet.sheetId === gid) ||
      sheets[0];
    let source: EvaluationAutomationSheetData | null = null;
    if (requestedName || selected?.title) {
      source = await readEvaluationAutomationSheet({
        headerRow: input.headerRow || 1,
        sheetName: requestedName || selected.title,
        spreadsheetId,
        spreadsheetTitle: text(metadata.data.properties?.title),
      });
    }
    return {
      autoMappings: source
        ? autoMapEvaluationAutomationHeaders(source.headers)
        : {},
      headers: source?.headers || [],
      sampleRows: (source?.rows || []).slice(0, 8),
      selectedSheetName: source?.sheetName || selected?.title || "",
      serviceAccount: EVALUATION_AUTOMATION_SERVICE_ACCOUNT,
      sheets,
      spreadsheetId,
      spreadsheetTitle: text(metadata.data.properties?.title),
    };
  } catch (error) {
    throw googleSheetError(error);
  }
}

export async function readEvaluationAutomationSheet(input: {
  spreadsheetId: string;
  spreadsheetTitle?: string;
  sheetName: string;
  headerRow: number;
}): Promise<EvaluationAutomationSheetData> {
  if (!input.sheetName) throw new Error("Chưa chọn sheet lấy dữ liệu.");
  const headerRow = Math.max(1, Math.trunc(input.headerRow || 1));
  const escapedSheetName = input.sheetName.replace(/'/g, "''");
  try {
    const client = await sheetsClient();
    const response = await client.request<{ values?: unknown[][] }>({
      params: {
        dateTimeRenderOption: "FORMATTED_STRING",
        majorDimension: "ROWS",
        valueRenderOption: "FORMATTED_VALUE",
      },
      url:
        `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(input.spreadsheetId)}` +
        `/values/${encodeURIComponent(`'${escapedSheetName}'!A:ZZ`)}`,
    });
    const values = response.data.values || [];
    const headers = (values[headerRow - 1] || []).map((value) => text(value));
    if (!headers.some(Boolean)) {
      throw new Error(`Dòng ${headerRow} không có header.`);
    }
    const rows = values
      .slice(headerRow)
      .map((row, index) => ({
        rowNumber: headerRow + index + 1,
        values: Object.fromEntries(
          headers.map((header, columnIndex) => [
            header,
            text(row[columnIndex]),
          ]),
        ),
      }))
      .filter((row) => Object.values(row.values).some(Boolean));
    return {
      headers,
      rows,
      sheetName: input.sheetName,
      spreadsheetId: input.spreadsheetId,
      spreadsheetTitle: text(input.spreadsheetTitle),
    };
  } catch (error) {
    throw googleSheetError(error);
  }
}

export async function loadEvaluationAutomationSource(
  config: EvaluationAutomationSourceConfig,
) {
  if (!config.spreadsheetId) throw new Error("Link Google Sheet không hợp lệ.");
  if (!config.sheetName) throw new Error("Chưa chọn sheet lấy dữ liệu.");
  return readEvaluationAutomationSheet({
    headerRow: config.headerRow,
    sheetName: config.sheetName,
    spreadsheetId: config.spreadsheetId,
  });
}

export async function loadEvaluationAutomationHierarchySource(
  config: EvaluationAutomationSourceConfig,
) {
  if (!config.spreadsheetId || !config.hierarchySheetName) return null;
  try {
    return await readEvaluationAutomationSheet({
      headerRow: 1,
      sheetName: config.hierarchySheetName,
      spreadsheetId: config.spreadsheetId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      /không tìm thấy google sheet hoặc sheet con|unable to parse range|requested entity was not found/i.test(
        message,
      )
    ) {
      return null;
    }
    throw error;
  }
}

export function mappedEvaluationAutomationValue(
  row: EvaluationAutomationSheetRow,
  config: EvaluationAutomationSourceConfig,
  key: EvaluationAutomationMappingKey,
) {
  const header = text(config.mappings[key]);
  return header ? text(row.values[header]) : "";
}

export function evaluationAutomationConfigForClient(value: unknown): JsonRecord {
  const content = asRecord(value);
  const config = normalizeEvaluationAutomationSourceConfig(value);
  return {
    automationCycleGrouping: config.grouping,
    automationExpiryDays: config.expiryDays,
    automationHeaderRow: config.headerRow,
    automationHierarchySheetName: config.hierarchySheetName,
    automationLeadDays: config.leadDays,
    automationReviewerRole: config.reviewerRole,
    automationSheetName: config.sheetName,
    automationSourceEnabled: config.enabled,
    automationSourceLink: config.spreadsheetUrl,
    automationSourceMappings: config.mappings,
    generationMode: text(content.generationMode) || config.grouping,
    generationTiming:
      text(content.generationTiming) === "period_end"
        ? "period_end"
        : "period_start",
  };
}
