import "server-only";

import * as XLSX from "xlsx";

import { normalizeName, safeText } from "@/lib/reconciliation/engine";
import type {
  ParsedWorkbook,
  RawReconciliationRow,
  WorkbookKind,
} from "@/lib/reconciliation/types";

const URBOX_HEADERS = [
  "thời gian đổi quà",
  "chương trình",
  "mã đơn hàng",
  "mã giao dịch",
  "mã kh",
  "thương hiệu",
  "tên quà",
  "danh mục",
  "số lượng",
  "giá trị",
];

const BASE_REWARD_HEADERS = [
  "tên",
  "username",
  "provider",
  "mã giao dịch",
  "mã chương trình",
];

const MAX_FILE_BYTES = 14 * 1024 * 1024;

function cleanHeader(value: unknown) {
  return normalizeName(value);
}

function looksLikeUrbox(row2: unknown[], sheetName: string) {
  const normalized = row2.map(cleanHeader);
  const hits = URBOX_HEADERS.filter((header) =>
    normalized.includes(cleanHeader(header)),
  ).length;
  return hits >= 7 || cleanHeader(sheetName) === "evoucher";
}

function looksLikeBaseReward(row1: unknown[], sheetName: string) {
  const normalized = row1.map(cleanHeader);
  const hits = BASE_REWARD_HEADERS.filter((header) =>
    normalized.includes(cleanHeader(header)),
  ).length;
  return hits >= 4 || cleanHeader(sheetName) === "exported file";
}

function sheetToObjects(matrix: unknown[][], headerRowIndex: number) {
  const headers = (matrix[headerRowIndex] ?? []).map((header) =>
    safeText(header),
  );
  return matrix
    .slice(headerRowIndex + 1)
    .map((row, index) => ({ row, sourceRow: headerRowIndex + index + 2 }))
    .filter(({ row }) => row.some((value) => safeText(value)))
    .map<RawReconciliationRow>(({ row, sourceRow }) => {
      const object: RawReconciliationRow = { __sourceRow: sourceRow };
      headers.forEach((header, index) => {
        if (header) object[header] = row[index] ?? "";
      });
      return object;
    });
}

function detectWorkbook(
  workbook: XLSX.WorkBook,
): Omit<ParsedWorkbook, "fileName"> | null {
  for (const sheetName of workbook.SheetNames ?? []) {
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      defval: "",
      header: 1,
      raw: true,
    });
    const row1 = matrix[0] ?? [];
    const row2 = matrix[1] ?? [];
    if (looksLikeUrbox(row2, sheetName)) {
      return {
        kind: "URBOX",
        rows: sheetToObjects(matrix, 1),
        sheetName,
      };
    }
    if (looksLikeBaseReward(row1, sheetName)) {
      return {
        kind: "BASE_REWARD",
        rows: sheetToObjects(matrix, 0),
        sheetName,
      };
    }
  }
  return null;
}

export async function parseReconciliationFile(file: File) {
  const fileName = safeText(file.name);
  if (!/\.(xlsx|xls)$/i.test(fileName)) {
    throw new Error(`Tệp “${fileName || "không tên"}” không phải Excel XLS/XLSX.`);
  }
  if (!file.size) {
    throw new Error(`Tệp “${fileName}” đang rỗng.`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`Tệp “${fileName}” vượt giới hạn 14 MB.`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, {
      cellDates: true,
      dense: false,
      type: "buffer",
    });
  } catch {
    throw new Error(
      `Không đọc được “${fileName}”. Kiểm tra lại file Excel và mật khẩu bảo vệ.`,
    );
  }
  const detected = detectWorkbook(workbook);
  if (!detected) {
    throw new Error(
      `Không nhận diện được “${fileName}” là Urbox hoặc BaseReward.`,
    );
  }
  if (!detected.rows.length) {
    throw new Error(
      `Tệp “${fileName}” được nhận diện là ${
        detected.kind === "URBOX" ? "Urbox" : "BaseReward"
      } nhưng không có dòng dữ liệu.`,
    );
  }
  return {
    buffer,
    parsed: { ...detected, fileName } satisfies ParsedWorkbook,
  };
}

export async function parseReconciliationFiles(files: File[]) {
  if (files.length !== 2) {
    throw new Error(
      "Cần đúng 2 file Excel gồm một file Urbox và một file BaseReward.",
    );
  }
  const parsed = await Promise.all(files.map(parseReconciliationFile));
  const byKind = new Map<WorkbookKind, (typeof parsed)[number]>();
  for (const item of parsed) {
    if (byKind.has(item.parsed.kind)) {
      throw new Error(
        `Hai file đều được nhận diện là ${
          item.parsed.kind === "URBOX" ? "Urbox" : "BaseReward"
        }.`,
      );
    }
    byKind.set(item.parsed.kind, item);
  }
  const urbox = byKind.get("URBOX");
  const baseReward = byKind.get("BASE_REWARD");
  if (!urbox || !baseReward) {
    throw new Error(
      "Không nhận diện đủ một file Urbox và một file BaseReward.",
    );
  }
  return { baseReward, urbox };
}
