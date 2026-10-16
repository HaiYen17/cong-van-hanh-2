import "dotenv/config";

import { createHash } from "node:crypto";
import pg from "pg";

type TargetSpec = {
  table: string;
  keySql?: string;
};

type MappingSpec = {
  workbook: "main" | "recruitment" | "results" | "scoring";
  sheet: string;
  domain: string;
  sourceKey?: string;
  sourceKeyMode?:
    | "evaluationLegacyId"
    | "motivationTitleKind"
    | "partnerExternalId"
    | "tagOrReactionId";
  sourceFilter?: { header: string; equals?: string; notBlank?: boolean };
  targets: TargetSpec[];
  policy: "UPSERT_SOURCE_OWNED" | "APPEND_HISTORY" | "AUDIT_ONLY" | "EXCLUDED";
  note: string;
};

const WORKBOOKS = {
  main: process.env.V2_MAIN_SPREADSHEET_ID ||
    "1_aDstrpRuxLuaEKHTuuWuL3ybyBvCPVcyFMouQxVjyg",
  recruitment: process.env.V2_RECRUITMENT_SPREADSHEET_ID ||
    "1HM3rVU_tajRsqaPnRVrIZJhRx_W7JlKlkCw7MumloKc",
  results: process.env.V2_RECRUITMENT_RESULTS_SPREADSHEET_ID ||
    "1Tfu17uZKxWCh0un7wB4QdJTM_VBfTTolBE5GmFLLtFI",
  scoring: process.env.V2_RECRUITMENT_SCORING_SPREADSHEET_ID ||
    "1hx2CsL5ebZZSWkH4n_RVNulGYWtsVG57ZmMX8ELmT_g",
} as const;

// Đây là manifest đối soát, không phải danh sách lệnh ghi. Những nguồn có nhiều
// loại bản ghi được tách theo sourceFilter để không so nhầm tổng số dòng.
const MAPPINGS: MappingSpec[] = [
  {
    workbook: "main",
    sheet: "01_Thông tin nhân viên",
    domain: "Nhân sự",
    sourceKey: "Mã nhân sự",
    targets: [{
      table: "Employee",
      keySql: `select "employeeCode"::text as key from "Employee" where "archivedAt" is null`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "MNV là khóa chính; dữ liệu V3 mới hơn không bị ghi đè.",
  },
  {
    workbook: "main",
    sheet: "02_Thông tin chức năng",
    domain: "Công ty",
    sourceKey: "Viết tắt",
    sourceFilter: { header: "Công ty", notBlank: true },
    targets: [{
      table: "Company",
      keySql: `select coalesce(nullif("shortName", ''), "code")::text as key from "Company" where "archivedAt" is null`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Đối chiếu công ty theo tên rút gọn; MST dùng để phát hiện xung đột.",
  },
  {
    workbook: "main",
    sheet: "02_Thông tin chức năng",
    domain: "Loại văn bản",
    sourceKey: "Văn bản",
    sourceFilter: { header: "Văn bản", notBlank: true },
    targets: [{ table: "DocumentType", keySql: `select "name"::text as key from "DocumentType"` }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Tên văn bản là khóa nghiệp vụ; legacySheetRow giữ dòng nguồn.",
  },
  {
    workbook: "main",
    sheet: "03_Biểu mẫu",
    domain: "Biểu mẫu",
    sourceKey: "Mã biểu mẫu",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'template'`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Định nghĩa biểu mẫu; file Drive được giữ bằng FileObject/sourceDriveId.",
  },
  {
    workbook: "main",
    sheet: "05_Biểu mẫu lịch sử",
    domain: "Biểu mẫu",
    sourceKey: "Mã lịch sử",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'template-history'`,
    }],
    policy: "APPEND_HISTORY",
    note: "Lịch sử tạo file chỉ thêm, không sửa bản ghi V3.",
  },
  {
    workbook: "main",
    sheet: "06_Chỉ mục hồ sơ",
    domain: "Hồ sơ pháp lý",
    sourceKey: "Registry ID",
    targets: [{
      table: "LegalDossier",
      keySql: `select "legacyRegistryId"::text as key from "LegalDossier" where "legacyRegistryId" is not null`,
    }, { table: "FileObject" }],
    policy: "APPEND_HISTORY",
    note: "Registry ID chống trùng; file giữ sourceDriveId và chỉ sao chép khi chưa có.",
  },
  {
    workbook: "main",
    sheet: "07_Sổ văn bản",
    domain: "Sổ văn bản",
    sourceKey: "Số văn bản",
    targets: [{ table: "DocumentRegistry", keySql: `select "documentNumber"::text as key from "DocumentRegistry"` }],
    policy: "APPEND_HISTORY",
    note: "Số đã cấp là lịch sử bất biến; không hạ số hoặc ghi đè trạng thái V3.",
  },
  {
    workbook: "main",
    sheet: "08_Bộ Tag",
    domain: "Tag và liên kết nhân sự",
    sourceKeyMode: "tagOrReactionId",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'shared-tag'`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Tách theo Loại bản ghi; không nhập chung JSON như V2.",
  },
  {
    workbook: "main",
    sheet: "09_Cấu hình nền",
    domain: "Bản tin/Thông báo",
    sourceKeyMode: "motivationTitleKind",
    sourceFilter: { header: "Loại nội dung", notBlank: true },
    targets: [{
      table: "MotivationEvent",
      keySql: `select lower("title") || '|' || "kind" as key from "MotivationEvent"`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Chỉ các dòng có Loại nội dung; nội dung đánh giá được tách riêng.",
  },
  {
    workbook: "main",
    sheet: "09_Cấu hình nền",
    domain: "Đánh giá nhân sự/JD",
    sourceKeyMode: "evaluationLegacyId",
    sourceFilter: { header: "Evaluation Record Type", notBlank: true },
    targets: [{
      table: "EvaluationRecord",
      keySql: `select "legacyId"::text as key from "EvaluationRecord" where "legacyId" is not null`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Evaluation ID + fingerprint; ưu tiên JD mới, bản [BC] chỉ fallback.",
  },
  {
    workbook: "main",
    sheet: "10_Setup tài sản",
    domain: "Cấu hình tài sản",
    sourceKey: "Record ID",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'asset-setup'`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Tách cấu hình danh mục và job xử lý ảnh; không chạy lại job đã hoàn tất.",
  },
  {
    workbook: "main",
    sheet: "11_Danh mục tài sản",
    domain: "Tài sản/CCDC",
    sourceKey: "Asset ID",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'asset-catalog'`,
    }, { table: "FileObject" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Ảnh Drive ánh xạ bằng sourceDriveId.",
  },
  {
    workbook: "main",
    sheet: "12_Văn phòng phẩm",
    domain: "Tài sản/CCDC",
    targets: [{ table: "ConfigurationRecord" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Hiện nguồn chỉ có header.",
  },
  {
    workbook: "main",
    sheet: "13_Đồng phục",
    domain: "Tài sản/CCDC",
    targets: [{ table: "ConfigurationRecord" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Hiện nguồn chỉ có header.",
  },
  {
    workbook: "main",
    sheet: "14_Cấu hình kho",
    domain: "Kho vận",
    sourceKey: "Mã SKU",
    targets: [{ table: "WarehouseProduct", keySql: `select "sku"::text as key from "WarehouseProduct"` }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "SKU chống trùng; chỉ cập nhật trường mang nguồn V2.",
  },
  {
    workbook: "main",
    sheet: "15_Báo cáo kho",
    domain: "Kho vận",
    targets: [{ table: "SystemSetting" }],
    policy: "AUDIT_ONLY",
    note: "Snapshot/report cũ; không trộn với tồn kho thật trước khi xác minh loại bản ghi.",
  },
  {
    workbook: "main",
    sheet: "15_Nhac viec",
    domain: "Nhắc việc",
    sourceKey: "Task ID",
    targets: [{
      table: "Request",
      keySql: `select replace("code", 'TODO-V2-', '')::text as key from "Request" where "serviceCode" = 'todo-assignment'`,
    }],
    policy: "APPEND_HISTORY",
    note: "V3 chưa có bảng Task chuyên biệt; staging trước, không làm mất lịch sử.",
  },
  {
    workbook: "main",
    sheet: "16_Chat Thu ky Meo",
    domain: "Chat",
    sourceKey: "Message ID",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'chat-history'`,
    }],
    policy: "APPEND_HISTORY",
    note: "V3 chưa có bảng Chat chuyên biệt; staging trước.",
  },
  {
    workbook: "main",
    sheet: "16_Kho KTS",
    domain: "Kho vận/RFID",
    sourceKey: "RFID",
    targets: [{ table: "WarehouseRfidTag", keySql: `select "epc"::text as key from "WarehouseRfidTag"` }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "EPC chuẩn hóa viết hoa, bỏ khoảng trắng.",
  },
  {
    workbook: "main",
    sheet: "17_Lịch chạy dữ liệu",
    domain: "Kho vận/RFID",
    sourceKey: "Record ID",
    sourceFilter: { header: "Job Key", equals: "rfid-inventory-scan" },
    targets: [{
      table: "WarehouseInventorySession",
      keySql: `select coalesce("legacyRecordId", "sessionKey")::text as key from "WarehouseInventorySession"`,
    }],
    policy: "APPEND_HISTORY",
    note: "Chỉ nhập lịch sử kiểm kê RFID; các job Eshop/VTP là log tích hợp.",
  },
  {
    workbook: "main",
    sheet: "18_Gửi thư",
    domain: "Gửi thư",
    sourceKey: "Record ID",
    targets: [{
      table: "MailOrder",
      keySql: `
        select replace(e."externalId", '18_Gửi thư:', '') as key
          from "ExternalIdMap" e
          join "MigrationSource" s on s.id = e."sourceId"
         where s.key = 'google-sheet-18-mail-orders'
           and e."entityType" = 'MailOrder'
      `,
    }],
    policy: "APPEND_HISTORY",
    note: "Mã vận đơn/mã đơn là khóa phụ; không gọi lại API tạo vận đơn.",
  },
  {
    workbook: "main",
    sheet: "20_RFID Log",
    domain: "Kho vận/RFID",
    sourceKey: "SessionId",
    sourceFilter: { header: "Mode", equals: "definition" },
    targets: [{
      table: "WarehouseRfidDefinitionSession",
      keySql: `select "sessionKey"::text as key from "WarehouseRfidDefinitionSession"`,
    }, { table: "WarehouseRfidIssuanceEvent" }],
    policy: "APPEND_HISTORY",
    note: "Log quét chỉ thêm; dedupe theo session + EPC.",
  },
  {
    workbook: "main",
    sheet: "25_NCC Khach hang",
    domain: "Đối tác",
    sourceKeyMode: "partnerExternalId",
    targets: [{
      table: "SystemSetting",
      keySql: `
        select e."externalId"::text as key
          from "ExternalIdMap" e
          join "MigrationSource" s on s.id = e."sourceId"
         where s.key = 'google-sheet-25-seal-partners'
           and e."entityType" = 'SystemSetting'
      `,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "MST/CCCD chuẩn hóa; dữ liệu hiện phục vụ Đóng dấu/Cấp giấy.",
  },
  {
    workbook: "main",
    sheet: "26_Cấu hình báo cáo KT",
    domain: "Kế toán",
    sourceKey: "Record ID",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `
        select record_id::text as key
          from accounting_portal.config_records
         where version_id = 'CFG-20260719-133700-49B4'
      `,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Phân tách theo Record Type; Record ID là khóa ổn định.",
  },
  {
    workbook: "main",
    sheet: "27_Audit báo cáo KT",
    domain: "Kế toán",
    sourceKey: "Audit ID",
    targets: [{
      table: "AuditLog",
      keySql: `select audit_id::text as key from accounting_portal.audit_events`,
    }],
    policy: "APPEND_HISTORY",
    note: "Audit chỉ thêm, tuyệt đối không cập nhật ngược lịch sử.",
  },
  {
    workbook: "main",
    sheet: "97_Cấu hình tổng",
    domain: "Cấu hình tổng",
    sourceKey: "Record ID",
    targets: [{
      table: "SystemSetting",
      keySql: `
        select e."externalId"::text as key
          from "ExternalIdMap" e
          join "MigrationSource" s on s.id = e."sourceId"
         where s.key = 'legacy-global-config-sheet-97'
      `,
    }, { table: "ViettelPostAccount" }, { table: "EshopAccount" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Secret không ghi vào report; giữ mã hóa/Secret Manager của V3.",
  },
  {
    workbook: "main",
    sheet: "98_Inbox",
    domain: "Đơn hàng/Hồ sơ",
    sourceKey: "Mã đơn DV",
    targets: [{ table: "Request", keySql: `select "code"::text as key from "Request"` }, { table: "ExternalIdMap" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Importer chuyên biệt giữ thay đổi V3 mới hơn và liên kết file theo Drive ID.",
  },
  {
    workbook: "main",
    sheet: "99_Cấu hình quyền",
    domain: "Phân quyền",
    sourceKey: "Mã quyền",
    targets: [{ table: "Role", keySql: `select "key"::text as key from "Role" where "archivedAt" is null` }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Chỉ module đang hiện trên Services mới được đưa vào quyền.",
  },
  {
    workbook: "main",
    sheet: "99_Phân quyền hệ thống",
    domain: "Phân quyền",
    sourceKey: "Mã nhân sự",
    targets: [{
      table: "UserRole",
      keySql: `
        select distinct e."employeeCode"::text as key
          from "UserRole" ur
          join "User" u on u.id = ur."userId"
          join "Employee" e on e.id = u."employeeId"
         where e."archivedAt" is null
      `,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Gán theo MNV; không ghi đè mật khẩu V3 mới hơn.",
  },
  {
    workbook: "main",
    sheet: "AI_ReviewHopDong",
    domain: "AI Review",
    sourceKey: "ID",
    targets: [{
      table: "ConfigurationRecord",
      keySql: `select "code"::text as key from "ConfigurationRecord" where "recordType" = 'ai-review-record'`,
    }, { table: "FileObject" }],
    policy: "APPEND_HISTORY",
    note: "Tách Request/Run/Finding/Annotation; file dùng sourceDriveId.",
  },
  {
    workbook: "main",
    sheet: "ĐG_JD_Tài liệu",
    domain: "Đánh giá/JD",
    sourceKey: "JD ID",
    targets: [{ table: "EvaluationRecord" }],
    policy: "AUDIT_ONLY",
    note: "Bảng dẫn xuất; nguồn chuẩn để import vẫn là EvaluationRecord trong 09_Cấu hình nền.",
  },
  {
    workbook: "main",
    sheet: "ĐG_JD_Nhóm công việc",
    domain: "Đánh giá/JD",
    sourceKey: "Mã nhóm",
    targets: [{ table: "EvaluationRecord" }],
    policy: "AUDIT_ONLY",
    note: "Bảng dẫn xuất; dùng kiểm tra chéo số nhóm.",
  },
  {
    workbook: "main",
    sheet: "ĐG_JD_Hoạt động",
    domain: "Đánh giá/JD",
    sourceKey: "Mã hoạt động",
    targets: [{ table: "EvaluationRecord" }],
    policy: "AUDIT_ONLY",
    note: "Bảng dẫn xuất; dùng kiểm tra chéo số hoạt động.",
  },
  {
    workbook: "recruitment",
    sheet: "Theo dõi Tuyển dụng",
    domain: "Tuyển dụng/Ứng viên",
    targets: [{ table: "RecruitmentApplication" }, { table: "RecruitmentCandidate" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Importer tuyển dụng giữ legacyRowNumber/snapshot.",
  },
  {
    workbook: "recruitment",
    sheet: "ORDER TD",
    domain: "Tuyển dụng/Yêu cầu",
    sourceKey: "Mã order",
    targets: [{
      table: "RecruitmentRequisition",
      keySql: `select "requisitionCode"::text as key from "RecruitmentRequisition"`,
    }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Yêu cầu tuyển dụng; khóa legacyRowNumber + mã yêu cầu.",
  },
  {
    workbook: "recruitment",
    sheet: "OFFER",
    domain: "Tuyển dụng/Offer",
    targets: [{ table: "RecruitmentOffer" }],
    policy: "EXCLUDED",
    note: "Loại khỏi migration theo quyết định của người dùng; code Offer vẫn khóa.",
  },
  {
    workbook: "results",
    sheet: "Kết quả Ứng viên",
    domain: "Tuyển dụng/Kết quả",
    targets: [{ table: "RecruitmentApplication" }, { table: "RecruitmentScorecard" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Kết quả và lịch sử portal; không lấy JD cũ làm nguồn chính.",
  },
  {
    workbook: "results",
    sheet: "Portal_NhatKy",
    domain: "Tuyển dụng/Lịch sử",
    targets: [{ table: "RecruitmentTimeline" }],
    policy: "APPEND_HISTORY",
    note: "Nhật ký chỉ thêm.",
  },
  {
    workbook: "scoring",
    sheet: "Config",
    domain: "Tuyển dụng/Chấm điểm",
    targets: [{ table: "RecruitmentConfigRecord" }],
    policy: "UPSERT_SOURCE_OWNED",
    note: "Cấu hình chấm điểm ứng viên.",
  },
  {
    workbook: "scoring",
    sheet: "JD_Output",
    domain: "Tuyển dụng/JD cũ",
    targets: [{ table: "RecruitmentConfigRecord" }],
    policy: "AUDIT_ONLY",
    note: "JD cũ chỉ fallback khi không có JD mới không mang tiền tố [BC].",
  },
];

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function key(value: unknown) {
  return text(value).normalize("NFC").toLocaleLowerCase("vi-VN");
}

function compareKey(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("vi-VN");
}

function normalizedIdentifier(value: unknown) {
  const raw = text(value).replace(/\s+/g, "");
  const digits = raw.replace(/\D+/g, "");
  if (/^\d+$/.test(raw) && (digits.length === 9 || digits.length === 12)) {
    return `0${digits}`;
  }
  return raw;
}

function shortHash(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 28);
}

function motivationKind(value: unknown) {
  const normalized = key(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replaceAll("đ", "d");
  if (normalized.includes("thong diep") || normalized === "message") return "message";
  if (normalized.includes("su kien") || normalized === "event") return "event";
  if (normalized.includes("thong bao") || normalized === "notice") return "notice";
  return normalized;
}

function a1(sheet: string) {
  return `'${sheet.replace(/'/g, "''")}'!A:CN`;
}

async function fetchValues(workbook: keyof typeof WORKBOOKS, sheet: string) {
  const range = encodeURIComponent(a1(sheet));
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(WORKBOOKS[workbook])}` +
    `/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`;
  const token = text(process.env.GOOGLE_ACCESS_TOKEN);
  const response = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) {
    throw new Error(`${workbook}/${sheet}: Google Sheets HTTP ${response.status}`);
  }
  const payload = await response.json() as { values?: unknown[][] };
  return Array.isArray(payload.values) ? payload.values : [];
}

function filteredRows(values: unknown[][], spec: MappingSpec) {
  const headers = (values[0] || []).map(text);
  const rows = values.slice(1).filter((row) => row.some((value) => text(value)));
  if (!spec.sourceFilter) return { headers, rows };
  const index = headers.findIndex((header) => key(header) === key(spec.sourceFilter?.header));
  if (index < 0) return { headers, rows: [] as unknown[][] };
  return {
    headers,
    rows: rows.filter((row) => {
      const value = text(row[index]);
      if (spec.sourceFilter?.notBlank && !value) return false;
      if (spec.sourceFilter?.equals != null) {
        return key(value) === key(spec.sourceFilter.equals);
      }
      return true;
    }),
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Thiếu DATABASE_URL.");
  if (!process.env.GOOGLE_ACCESS_TOKEN) {
    throw new Error("Thiếu GOOGLE_ACCESS_TOKEN chỉ đọc Google Sheets.");
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const tableNames = Array.from(new Set(MAPPINGS.flatMap((item) => item.targets.map((target) => target.table))));
    const tableCounts = new Map<string, number>();
    for (const table of tableNames) {
      const exists = await client.query(
        `select exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = $1) as ok`,
        [table],
      );
      if (!exists.rows[0]?.ok) {
        tableCounts.set(table, -1);
        continue;
      }
      const result = await client.query(`select count(*)::int as count from ${pg.escapeIdentifier(table)}`);
      tableCounts.set(table, result.rows[0]?.count ?? 0);
    }

    const cache = new Map<string, unknown[][]>();
    const rows = [];
    for (const spec of MAPPINGS) {
      const cacheKey = `${spec.workbook}:${spec.sheet}`;
      let values = cache.get(cacheKey);
      if (!values) {
        values = await fetchValues(spec.workbook, spec.sheet);
        cache.set(cacheKey, values);
      }
      const selected = filteredRows(values, spec);
      const sourceKeyIndex = spec.sourceKey
        ? selected.headers.findIndex((header) => key(header) === key(spec.sourceKey))
        : -1;
      let sourceKeys = sourceKeyIndex >= 0
        ? selected.rows.map((row) => text(row[sourceKeyIndex])).filter(Boolean)
        : [];
      if (spec.sourceKeyMode === "evaluationLegacyId") {
        const typeIndex = selected.headers.findIndex((header) => key(header) === key("Evaluation Record Type"));
        const idIndex = selected.headers.findIndex((header) => key(header) === key("Evaluation ID"));
        const seen = new Set<string>();
        sourceKeys = values.slice(1).flatMap((row, offset) => {
          const rowNumber = offset + 2;
          const recordType = text(row[typeIndex]);
          if (!recordType) return [];
          const sourceId = text(row[idIndex]) || `evaluation-row-${rowNumber}`;
          const base = `${recordType}:${sourceId}`;
          const value = seen.has(base) ? `${base}:row-${rowNumber}` : base;
          seen.add(value);
          return [value];
        });
      }
      if (spec.sourceKeyMode === "motivationTitleKind") {
        const titleIndex = selected.headers.findIndex((header) =>
          ["Tiêu đề", "Tên hình"].some((candidate) => key(header) === key(candidate)),
        );
        const kindIndex = selected.headers.findIndex((header) => key(header) === key("Loại nội dung"));
        sourceKeys = selected.rows.flatMap((row) => {
          const title = text(row[titleIndex]);
          const recordKind = motivationKind(row[kindIndex]);
          return title && recordKind ? [`${key(title)}|${recordKind}`] : [];
        });
      }
      if (spec.sourceKeyMode === "tagOrReactionId") {
        const tagIndex = selected.headers.findIndex((header) => key(header) === key("Tag ID"));
        const reactionIndex = selected.headers.findIndex(
          (header) => key(header) === key("Bộ tương tác ID"),
        );
        sourceKeys = selected.rows
          .map((row) => text(row[tagIndex]) || text(row[reactionIndex]))
          .filter(Boolean);
      }
      if (spec.sourceKeyMode === "partnerExternalId") {
        const headerIndex = (aliases: string[]) => selected.headers.findIndex((header) =>
          aliases.some((alias) => compareKey(header) === compareKey(alias)),
        );
        const columns = {
          address: headerIndex(["Địa chỉ", "Dia chi"]),
          issuedDate: headerIndex(["Ngày cấp", "Ngay cap", "Ngày cấp CCCD"]),
          issuedPlace: headerIndex(["Nơi cấp", "Noi cap", "Nơi cấp CCCD"]),
          name: headerIndex([
            "Tên NCC/ khách hàng",
            "Tên NCC/khách hàng",
            "Tên đối tác",
            "Tên khách hàng",
            "Tên công ty",
          ]),
          shortName: headerIndex(["Tên viết tắt", "Ten viet tat", "Viết tắt"]),
          taxId: headerIndex(["Mã số thuế (CCCD)", "MST/CCCD", "Mã số thuế", "CCCD"]),
        };
        sourceKeys = selected.rows.flatMap((row) => {
          const at = (index: number) => index >= 0 ? text(row[index]) : "";
          const name = at(columns.name);
          if (!name) return [];
          const taxId = normalizedIdentifier(at(columns.taxId));
          const issuedDate = at(columns.issuedDate);
          const issuedPlace = at(columns.issuedPlace);
          const identity = taxId
            ? `${issuedDate || issuedPlace ? "person" : "business"}:${compareKey(taxId)}`
            : `name:${compareKey(name)}|short:${compareKey(at(columns.shortName))}|address:${compareKey(at(columns.address))}`;
          return [shortHash(identity)];
        });
      }
      const sourceKeySet = new Set(sourceKeys.map(key));
      const duplicateKeyCount = Math.max(0, sourceKeys.length - sourceKeySet.size);

      let overlap: number | null = null;
      let missingInV3: number | null = null;
      const directTarget = spec.targets.find((target) => target.keySql);
      if (sourceKeySet.size && directTarget?.keySql) {
        const targetResult = await client.query(directTarget.keySql);
        const targetKeys = new Set(targetResult.rows.map((row) => key(row.key)).filter(Boolean));
        overlap = [...sourceKeySet].filter((item) => targetKeys.has(item)).length;
        missingInV3 = sourceKeySet.size - overlap;
      }

      rows.push({
        domain: spec.domain,
        workbook: spec.workbook,
        sheet: spec.sheet,
        policy: spec.policy,
        sourceRows: selected.rows.length,
        sourceDistinctKeys: sourceKeySet.size || null,
        duplicateKeyCount: sourceKeyIndex >= 0 || spec.sourceKeyMode ? duplicateKeyCount : null,
        overlap,
        missingInV3,
        targets: spec.targets.map((target) => ({
          table: target.table,
          rows: tableCounts.get(target.table) ?? -1,
        })),
        note: spec.note,
      });
    }

    const report = {
      generatedAt: new Date().toISOString(),
      source: "V2 Google Sheets (read-only)",
      destination: "PostgreSQL V3 (read-only audit)",
      databaseBreakdown: {
        configurationRecord: (await client.query(
          `select "recordType", count(*)::int as count
             from "ConfigurationRecord"
            group by "recordType"
            order by count(*) desc, "recordType"`,
        )).rows,
        evaluationRecord: (await client.query(
          `select "recordType", count(*)::int as count,
                  count("legacyId")::int as "withLegacyId",
                  count("sourceFingerprint")::int as "withFingerprint"
             from "EvaluationRecord"
            group by "recordType"
            order by count(*) desc, "recordType"`,
        )).rows,
        latestMigrationRuns: (await client.query(
          `select ms.key, mr.mode, mr.status, mr."rowsRead", mr."rowsCreated",
                  mr."rowsUpdated", mr."rowsSkipped", mr."rowsFailed", mr."startedAt"
             from "MigrationRun" mr
             join "MigrationSource" ms on ms.id = mr."sourceId"
            order by mr."startedAt" desc
            limit 30`,
        )).rows,
        recruitment: (await client.query(
          `select 'RecruitmentApplication' as table_name, count(*)::int as count from "RecruitmentApplication"
           union all select 'RecruitmentCandidate', count(*)::int from "RecruitmentCandidate"
           union all select 'RecruitmentRequisition', count(*)::int from "RecruitmentRequisition"
           union all select 'RecruitmentTimeline', count(*)::int from "RecruitmentTimeline"
           union all select 'RecruitmentScorecard', count(*)::int from "RecruitmentScorecard"
           union all select 'RecruitmentConfigRecord', count(*)::int from "RecruitmentConfigRecord"`,
        )).rows,
      },
      mappings: rows,
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
