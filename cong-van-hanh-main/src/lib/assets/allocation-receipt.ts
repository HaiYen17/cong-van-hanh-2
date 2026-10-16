export type AllocationReceiptIdentity = {
  employeeCodes: Iterable<string>;
  employeeIds: Iterable<string>;
  names: Iterable<string>;
};

export type AllocationReceiptActor = {
  employeeCode: string;
  employeeId: string;
  name: string;
  userId: string;
};

export type AllocationReceiptItem = {
  assignee: string;
  category: string;
  confirmedAt: string;
  confirmedByName: string;
  description: string;
  itemIndex: number;
  itemName: string;
  quantity: string;
  status: "PENDING" | "RECEIVED";
};

export type AllocationReceiptView = {
  confirmedCount: number;
  items: AllocationReceiptItem[];
  pendingCount: number;
  recipient: true;
  totalCount: number;
};

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("vi")
    .replace(/\s+/g, " ");
}

function normalizedSet(values: Iterable<string>) {
  return new Set([...values].map(normalized).filter(Boolean));
}

function identitySets(identity: AllocationReceiptIdentity) {
  return {
    employeeCodes: normalizedSet(identity.employeeCodes),
    employeeIds: normalizedSet(identity.employeeIds),
    names: normalizedSet(identity.names),
  };
}

function rowIdentity(row: JsonRecord) {
  const assignee = text(
    row.assignee || row.recipient || row.employee || row.nhanSu || row.nguoiNhan,
  );
  const labelParts = assignee
    .split(/[·•]/)
    .map((part) => normalized(part))
    .filter(Boolean);
  const ids = [
    row.assigneeId,
    row.recipientId,
    row.employeeDbId,
    row.nhanSuId,
  ]
    .map(normalized)
    .filter(Boolean);
  const codes = [
    row.assigneeEmployeeCode,
    row.recipientEmployeeCode,
    row.employeeCode,
    row.mnv,
    row.maNhanVien,
    labelParts[1],
  ]
    .map(normalized)
    .filter(Boolean);
  const names = [
    row.assigneeName,
    row.recipientName,
    row.employeeName,
    row.hoTen,
    labelParts[0],
  ]
    .map(normalized)
    .filter(Boolean);
  return { assignee, codes, ids, names };
}

export function allocationRecipientMatches(
  value: unknown,
  identity: AllocationReceiptIdentity,
) {
  const row = record(value);
  const rowKeys = rowIdentity(row);
  const viewer = identitySets(identity);
  if (rowKeys.ids.some((candidate) => viewer.employeeIds.has(candidate))) {
    return true;
  }
  if (rowKeys.codes.some((candidate) => viewer.employeeCodes.has(candidate))) {
    return true;
  }

  // Chỉ dùng tên làm phương án tương thích với dữ liệu cũ khi dòng không có
  // bất kỳ khóa định danh nào. Điều này tránh xác nhận nhầm giữa người trùng tên.
  if (!rowKeys.ids.length && !rowKeys.codes.length) {
    return rowKeys.names.some((candidate) => viewer.names.has(candidate));
  }
  return false;
}

function receiptOf(row: JsonRecord) {
  const receipt = record(row.recipientReceipt);
  const status = normalized(receipt.status || row.recipientReceiptStatus);
  return {
    confirmedAt: text(receipt.confirmedAt || row.recipientReceivedAt),
    confirmedByName: text(receipt.confirmedByName || row.recipientReceivedBy),
    received: ["received", "da nhan", "confirmed"].includes(status),
  };
}

export function buildAllocationReceiptView(
  rows: unknown[],
  identity: AllocationReceiptIdentity,
): AllocationReceiptView | null {
  const items = rows.flatMap((value, itemIndex) => {
    if (!allocationRecipientMatches(value, identity)) return [];
    const row = record(value);
    const receipt = receiptOf(row);
    return [
      {
        assignee: text(row.assignee || row.recipient),
        category: text(row.category),
        confirmedAt: receipt.confirmedAt,
        confirmedByName: receipt.confirmedByName,
        description: text(row.description),
        itemIndex,
        itemName: text(row.itemName || row.name || row.title) || `Mục ${itemIndex + 1}`,
        quantity: text(row.quantity || row.qty || row.soLuong) || "1",
        status: receipt.received ? ("RECEIVED" as const) : ("PENDING" as const),
      },
    ];
  });
  if (!items.length) return null;
  const confirmedCount = items.filter((item) => item.status === "RECEIVED").length;
  return {
    confirmedCount,
    items,
    pendingCount: items.length - confirmedCount,
    recipient: true,
    totalCount: items.length,
  };
}

export function confirmAllocationReceiptRows(
  rows: JsonRecord[],
  identity: AllocationReceiptIdentity,
  actor: AllocationReceiptActor,
  confirmedAt: string,
) {
  const confirmedIndexes: number[] = [];
  const alreadyConfirmedIndexes: number[] = [];
  const nextRows = rows.map((row, itemIndex) => {
    if (!allocationRecipientMatches(row, identity)) return row;
    if (receiptOf(row).received) {
      alreadyConfirmedIndexes.push(itemIndex);
      return row;
    }
    confirmedIndexes.push(itemIndex);
    return {
      ...row,
      recipientReceipt: {
        confirmedAt,
        confirmedByEmployeeCode: actor.employeeCode,
        confirmedByEmployeeId: actor.employeeId,
        confirmedByName: actor.name,
        confirmedByUserId: actor.userId,
        status: "RECEIVED",
      },
    };
  });
  return { alreadyConfirmedIndexes, confirmedIndexes, rows: nextRows };
}
