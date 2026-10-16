// Đồng bộ nhân sự — bám tab "Nhân sự" của ConfigModal bản Hành chính cũ.
// 15 field đích lấy từ APP_CONFIG.personnelFieldDefinitions (Code.js).

export type PersonnelField = {
  aliases?: string[];
  allowMultiple?: boolean;
  joinSeparator?: string;
  key: string;
  label: string;
  required?: boolean;
};

// aliases bám APP_CONFIG field aliases bản cũ (Code.js ~49907) để tự nhận diện cột.
export const PERSONNEL_FIELDS: PersonnelField[] = [
  {
    key: "employeeId",
    label: "Mã nhân sự",
    required: true,
    aliases: ["Mã nhân sự", "Mã nhân viên", "Mã NV", "ID"],
  },
  {
    key: "name",
    label: "Nhân sự",
    required: true,
    allowMultiple: true,
    joinSeparator: " ",
    aliases: ["Nhân sự", "Họ tên", "Tên nhân sự", "Tên"],
  },
  {
    key: "department",
    label: "Khu vực / Chuyên môn",
    required: true,
    aliases: ["Khu vực / Chuyên môn", "Phòng ban", "Bộ phận", "Khu vực"],
  },
  { key: "email", label: "Email", aliases: ["Email", "Mail", "E-mail"] },
  {
    key: "title",
    label: "Chức danh",
    required: true,
    aliases: ["Chức danh", "Chức vụ", "Vị trí"],
  },
  {
    key: "phone",
    label: "Điện thoại",
    required: true,
    aliases: ["Điện thoại", "Số điện thoại", "SĐT", "SDT", "ĐT"],
  },
  {
    key: "bankName",
    label: "Ngân hàng",
    aliases: ["Ngân hàng", "Tên ngân hàng"],
  },
  {
    key: "bankAccount",
    label: "Số tài khoản",
    aliases: ["Số tài khoản", "STK"],
  },
  {
    key: "identityNumber",
    label: "Số CCCD",
    required: true,
    aliases: ["Số CCCD", "CCCD", "CMND", "Số CMND"],
  },
  {
    key: "identityPlace",
    label: "Nơi cấp",
    required: true,
    aliases: ["Nơi cấp", "Nơi cấp CCCD"],
  },
  {
    key: "identityDate",
    label: "Ngày cấp",
    required: true,
    aliases: ["Ngày cấp", "Ngày cấp CCCD"],
  },
  {
    key: "birthDate",
    label: "Ngày sinh",
    allowMultiple: true,
    joinSeparator: "/",
    aliases: ["Ngày sinh", "DOB", "Ngày tháng năm sinh"],
  },
  {
    key: "permanentResidence",
    label: "Địa chỉ thường trú",
    aliases: [
      "Địa chỉ thường trú",
      "Nơi thường trú",
      "Hộ khẩu thường trú",
      "Địa chỉ hộ khẩu",
    ],
  },
  {
    key: "personalTaxCode",
    label: "Mã số thuế cá nhân",
    aliases: [
      "Mã số thuế cá nhân",
      "Mã số thuế TNCN",
      "MST cá nhân",
      "MST TNCN",
    ],
  },
  {
    key: "socialInsuranceNumber",
    label: "Số bảo hiểm xã hội",
    aliases: ["Số bảo hiểm xã hội", "Số BHXH", "Mã số BHXH", "Mã BHXH"],
  },
  { key: "status", label: "Trạng thái", aliases: ["Trạng thái", "Tình trạng"] },
  {
    key: "company",
    label: "Công ty",
    aliases: ["Công ty", "Chi nhánh", "Doanh nghiệp"],
  },
  {
    key: "terminationDate",
    label: "Ngày nghỉ việc",
    aliases: ["Ngày nghỉ việc", "Ngày thôi việc"],
  },
];

function normHeader(v: string) {
  return v
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Tự ánh xạ cột nguồn → field dựa alias (bỏ dấu). Trả về mappings gợi ý.
export function autoMapHeaders(headers: string[]): PersonnelMappings {
  const normalized = headers.map((h) => ({ raw: h, n: normHeader(h) }));
  const out: PersonnelMappings = {};
  for (const field of PERSONNEL_FIELDS) {
    const aliases = (field.aliases ?? [field.label]).map(normHeader);
    const hit = normalized.find((h) => aliases.includes(h.n));
    if (hit) out[field.key] = field.allowMultiple ? [hit.raw] : hit.raw;
  }
  return out;
}

export type PersonnelMappings = Record<string, string | string[]>;

export function getFieldByKey(key: string) {
  return PERSONNEL_FIELDS.find((f) => f.key === key) ?? null;
}

// Lấy spreadsheet ID từ link Google Sheet (hoặc nhận thẳng ID).
export function parseSpreadsheetId(input: string): string | null {
  const s = (input || "").trim();
  const m =
    s.match(/\/d\/([A-Za-z0-9_-]+)/) || s.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{20,}$/.test(s)) return s;
  return null;
}

// Parser CSV chịu được dấu phẩy/xuống dòng trong ô có ngoặc kép.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      // bỏ qua, chờ \n
    } else {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export type SheetRead = {
  headerRowIndex: number;
  headers: string[];
  rows: string[][];
  sheetName: string;
};
