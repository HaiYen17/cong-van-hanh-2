import {
  ALLOCATION_CATEGORY,
  type AllocationCatalogItem,
} from "./allocation-catalog";

export const ALLOCATION_IMPORT_MAX_ROWS = 500;

export const ALLOCATION_IMPORT_HEADERS = [
  "Mã nhân viên",
  "Họ và tên",
  "Danh mục",
  "Tên hàng hóa / CCDC",
  "Mô tả / Size",
  "Số lượng",
] as const;

export type AllocationImportEmployee = {
  employeeCode: string;
  fullName: string;
  id: string;
  label: string;
};

export type AllocationImportItem = {
  assignee: string;
  assigneeId: string;
  category: string;
  description: string;
  itemName: string;
  quantity: string;
};

export type AllocationImportError = {
  message: string;
  row: number | null;
};

export type AllocationImportResult = {
  dataRowCount: number;
  errors: AllocationImportError[];
  headerRow: number | null;
  items: AllocationImportItem[];
};

type ColumnKey =
  | "employeeCode"
  | "fullName"
  | "category"
  | "itemName"
  | "description"
  | "quantity";

type ColumnMap = Partial<Record<ColumnKey, number>>;

function text(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/^\uFEFF/, "").trim();
}

export function normalizeAllocationImportText(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

const HEADER_ALIASES = new Map<string, ColumnKey>();

function registerHeader(key: ColumnKey, aliases: string[]) {
  aliases.forEach((alias) => {
    HEADER_ALIASES.set(normalizeAllocationImportText(alias), key);
  });
}

registerHeader("employeeCode", [
  "Mã nhân viên",
  "Mã NV",
  "MSNV",
  "Employee code",
]);
registerHeader("fullName", [
  "Họ và tên",
  "Họ tên",
  "Tên nhân viên",
  "Người được gán",
  "Người được cấp",
]);
registerHeader("category", [
  "Danh mục",
  "Danh mục đăng ký",
  "Danh mục cấp phát",
  "Loại",
]);
registerHeader("itemName", [
  "Tên hàng hóa / CCDC",
  "Tên hàng hoá / CCDC",
  "Tên hàng hóa",
  "Tên hàng hoá",
  "Tên CCDC",
  "Mặt hàng",
]);
registerHeader("description", [
  "Mô tả / Size",
  "Mô tả",
  "Size",
  "Quy cách",
]);
registerHeader("quantity", ["Số lượng", "SL", "Quantity"]);

function findHeader(matrix: unknown[][]) {
  const scanLimit = Math.min(matrix.length, 20);

  for (let rowIndex = 0; rowIndex < scanLimit; rowIndex += 1) {
    const columns: ColumnMap = {};
    const row = Array.isArray(matrix[rowIndex]) ? matrix[rowIndex] : [];

    row.forEach((cell, columnIndex) => {
      const key = HEADER_ALIASES.get(normalizeAllocationImportText(cell));
      if (key && columns[key] === undefined) columns[key] = columnIndex;
    });

    const hasRecipient =
      columns.employeeCode !== undefined || columns.fullName !== undefined;
    if (
      hasRecipient &&
      columns.category !== undefined &&
      columns.itemName !== undefined &&
      columns.quantity !== undefined
    ) {
      return { columns, rowIndex };
    }
  }

  return null;
}

function cell(row: unknown[], columns: ColumnMap, key: ColumnKey) {
  const index = columns[key];
  return index === undefined ? "" : text(row[index]);
}

function canonicalCategory(value: string) {
  const normalized = normalizeAllocationImportText(value);
  const aliases: Array<[string[], string]> = [
    [
      ["ccdc tai san", "tai san", "ccdc", "cong cu dung cu"],
      ALLOCATION_CATEGORY.asset,
    ],
    [
      ["van phong pham", "vpp"],
      ALLOCATION_CATEGORY.stationery,
    ],
    [["dong phuc", "uniform"], ALLOCATION_CATEGORY.uniform],
  ];

  return (
    aliases.find(([values]) => values.includes(normalized))?.[1] || ""
  );
}

function findCatalogItem(
  catalog: AllocationCatalogItem[],
  category: string,
  itemName: string,
) {
  const normalizedName = normalizeAllocationImportText(itemName);
  return catalog.filter(
    (item) =>
      item.category === category &&
      normalizeAllocationImportText(item.name) === normalizedName,
  );
}

function findEmployee(
  employees: AllocationImportEmployee[],
  employeeCode: string,
  fullName: string,
) {
  const normalizedCode = normalizeAllocationImportText(employeeCode);
  const normalizedName = normalizeAllocationImportText(fullName);

  if (normalizedCode) {
    const employee = employees.find(
      (candidate) =>
        normalizeAllocationImportText(candidate.employeeCode) === normalizedCode,
    );
    if (!employee) {
      return { error: `Không tìm thấy mã nhân viên “${employeeCode}”.` };
    }
    if (
      normalizedName &&
      normalizeAllocationImportText(employee.fullName) !== normalizedName
    ) {
      return {
        error: `Mã ${employeeCode} không khớp với họ tên “${fullName}”.`,
      };
    }
    return { employee };
  }

  if (!normalizedName) {
    return { error: "Cần nhập Mã nhân viên hoặc Họ và tên." };
  }

  const matches = employees.filter(
    (candidate) =>
      normalizeAllocationImportText(candidate.fullName) === normalizedName,
  );
  if (!matches.length) {
    return { error: `Không tìm thấy nhân viên “${fullName}”.` };
  }
  if (matches.length > 1) {
    return {
      error: `Có nhiều nhân viên tên “${fullName}”; vui lòng điền Mã nhân viên.`,
    };
  }
  return { employee: matches[0] };
}

function canonicalDescription(
  item: AllocationCatalogItem,
  rawDescription: string,
) {
  if (item.category === ALLOCATION_CATEGORY.stationery) {
    return { value: item.description || "" };
  }
  if (item.category !== ALLOCATION_CATEGORY.uniform) {
    return { value: item.description || "" };
  }

  const normalized = normalizeAllocationImportText(rawDescription);
  if (!normalized) {
    return { error: "Đồng phục cần Mô tả / Size, ví dụ “Nam_M”." };
  }

  const exact = item.sizeOptions.find(
    (option) => normalizeAllocationImportText(option.value) === normalized,
  );
  if (exact) return { value: exact.value };

  const bySize = item.sizeOptions.filter(
    (option) => normalizeAllocationImportText(option.size) === normalized,
  );
  if (bySize.length === 1) return { value: bySize[0].value };
  if (bySize.length > 1) {
    return {
      error: `Size “${rawDescription}” có cả Nam và Nữ; ghi rõ theo dạng “Nam_${rawDescription}” hoặc “Nữ_${rawDescription}”.`,
    };
  }

  return {
    error: `Size “${rawDescription}” chưa được cấu hình cho “${item.name}”.`,
  };
}

function parseQuantity(value: string) {
  const parsed = Number(value.replace(/\s/g, "").replace(",", "."));
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseAllocationImport(
  matrix: unknown[][],
  catalog: AllocationCatalogItem[],
  employees: AllocationImportEmployee[],
): AllocationImportResult {
  const header = findHeader(matrix);
  if (!header) {
    return {
      dataRowCount: 0,
      errors: [
        {
          message:
            "Không tìm thấy hàng tiêu đề. File cần có Danh mục, Tên hàng hóa / CCDC, Số lượng và ít nhất một cột Mã nhân viên hoặc Họ và tên.",
          row: null,
        },
      ],
      headerRow: null,
      items: [],
    };
  }

  const mappedColumnIndexes = Object.values(header.columns).filter(
    (value): value is number => value !== undefined,
  );
  const dataRows = matrix
    .slice(header.rowIndex + 1)
    .map((row, offset) => ({
      row: Array.isArray(row) ? row : [],
      rowNumber: header.rowIndex + offset + 2,
    }))
    .filter(({ row }) =>
      mappedColumnIndexes.some((index) => Boolean(text(row[index]))),
    );

  if (dataRows.length > ALLOCATION_IMPORT_MAX_ROWS) {
    return {
      dataRowCount: dataRows.length,
      errors: [
        {
          message: `Mỗi lần chỉ nạp tối đa ${ALLOCATION_IMPORT_MAX_ROWS} dòng. File hiện có ${dataRows.length} dòng dữ liệu.`,
          row: null,
        },
      ],
      headerRow: header.rowIndex + 1,
      items: [],
    };
  }

  const errors: AllocationImportError[] = [];
  const items: AllocationImportItem[] = [];

  dataRows.forEach(({ row, rowNumber }) => {
    const employeeCode = cell(row, header.columns, "employeeCode");
    const fullName = cell(row, header.columns, "fullName");
    const categoryInput = cell(row, header.columns, "category");
    const itemNameInput = cell(row, header.columns, "itemName");
    const descriptionInput = cell(row, header.columns, "description");
    const quantityInput = cell(row, header.columns, "quantity");
    const issues: string[] = [];

    const employeeResult = findEmployee(employees, employeeCode, fullName);
    if (employeeResult.error) issues.push(employeeResult.error);

    const category = canonicalCategory(categoryInput);
    if (!category) {
      issues.push(
        `Danh mục “${categoryInput || "(trống)"}” không hợp lệ; dùng CCDC/tài sản, Văn phòng phẩm hoặc Đồng phục.`,
      );
    }

    const catalogMatches = category
      ? findCatalogItem(catalog, category, itemNameInput)
      : [];
    if (!itemNameInput) {
      issues.push("Tên hàng hóa / CCDC đang trống.");
    } else if (!catalogMatches.length && category) {
      issues.push(
        `Không tìm thấy “${itemNameInput}” trong danh mục “${category}”.`,
      );
    } else if (catalogMatches.length > 1) {
      issues.push(
        `Có nhiều mặt hàng tên “${itemNameInput}” trong danh mục “${category}”.`,
      );
    }

    const quantity = parseQuantity(quantityInput);
    if (quantity === null) {
      issues.push("Số lượng phải là số nguyên lớn hơn 0.");
    }

    const catalogItem = catalogMatches.length === 1 ? catalogMatches[0] : null;
    const descriptionResult = catalogItem
      ? canonicalDescription(catalogItem, descriptionInput)
      : { value: "" };
    if (descriptionResult.error) issues.push(descriptionResult.error);

    if (issues.length) {
      errors.push({ message: issues.join(" "), row: rowNumber });
      return;
    }

    const employee = employeeResult.employee;
    if (!employee || !catalogItem || quantity === null) return;

    items.push({
      assignee: employee.label,
      assigneeId: employee.id,
      category: catalogItem.category,
      description: descriptionResult.value || "",
      itemName: catalogItem.name,
      quantity: String(quantity),
    });
  });

  if (!dataRows.length) {
    errors.push({
      message: "File chưa có dòng dữ liệu nào bên dưới hàng tiêu đề.",
      row: null,
    });
  }

  return {
    dataRowCount: dataRows.length,
    errors,
    headerRow: header.rowIndex + 1,
    items,
  };
}
