export type ParsedWarehouseProductionPlanItem = {
  name: string;
  plannedQuantity: number;
  rowNumbers: number[];
  sku: string;
};

export type ParsedWarehouseProductionPlanDate = {
  dateKey: string;
  dateLabel: string;
  items: ParsedWarehouseProductionPlanItem[];
  rowCount: number;
  skuCount: number;
  totalQuantity: number;
  weekday: string;
};

const DATE_ALIASES = ["Ngày", "Ngày kế hoạch", "Ngày sản xuất"];
const SKU_ALIASES = ["Mã", "Mã SKU", "SKU", "Mã hàng"];
const NAME_ALIASES = [
  "Tên sản phẩm (đầy đủ)",
  "Tên sản phẩm",
  "Tên hàng hóa",
  "Tên hàng",
];
const QUANTITY_ALIASES = ["Số lượng", "SL", "Số lượng tem"];
const WEEKDAY_ALIASES = ["Thứ", "Thứ trong tuần"];

function text(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalized(value: unknown) {
  return text(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("vi")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedSku(value: unknown) {
  return text(value).toLocaleUpperCase("vi");
}

function headerIndex(headers: unknown[], aliases: readonly string[]) {
  const normalizedAliases = new Set(aliases.map(normalized));
  return headers.findIndex((header) => normalizedAliases.has(normalized(header)));
}

function parseDateKey(value: unknown) {
  const source = text(value);
  if (!source) return "";
  const vi = source.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (vi) {
    const [, day, month, year] = vi;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const iso = source.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  return "";
}

function dateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-");
  return `${day}/${month}/${year}`;
}

function weekdayLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const value = new Intl.DateTimeFormat("vi-VN", {
    timeZone: "Asia/Bangkok",
    weekday: "long",
  }).format(new Date(Date.UTC(year, month - 1, day, 6)));
  return value.charAt(0).toLocaleUpperCase("vi") + value.slice(1);
}

function positiveInteger(value: unknown) {
  const source = text(value).replace(/\s/g, "");
  if (!source) return 0;
  const normalizedNumber = /^\d{1,3}(?:[.,]\d{3})+$/.test(source)
    ? source.replace(/[.,]/g, "")
    : source.replace(",", ".");
  const parsed = Number(normalizedNumber.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : 0;
}

export function parseWarehouseProductionPlanRows(
  headers: unknown[],
  rows: unknown[][],
  headerRowIndex = 1,
): ParsedWarehouseProductionPlanDate[] {
  const dateColumn = headerIndex(headers, DATE_ALIASES);
  const skuColumn = headerIndex(headers, SKU_ALIASES);
  const quantityColumn = headerIndex(headers, QUANTITY_ALIASES);
  const nameColumn = headerIndex(headers, NAME_ALIASES);
  const weekdayColumn = headerIndex(headers, WEEKDAY_ALIASES);

  if (dateColumn < 0 || skuColumn < 0 || quantityColumn < 0) {
    throw new Error(
      "Sheet KeHoach_Xuong phải có đủ ba cột Ngày, Mã và Số lượng.",
    );
  }

  const dates = new Map<
    string,
    {
      items: Map<string, ParsedWarehouseProductionPlanItem>;
      rowCount: number;
      weekday: string;
    }
  >();

  rows.forEach((row, index) => {
    const dateKey = parseDateKey(row[dateColumn]);
    const sku = normalizedSku(row[skuColumn]);
    const plannedQuantity = positiveInteger(row[quantityColumn]);
    if (!dateKey || !sku || plannedQuantity < 1) return;

    const rowNumber = headerRowIndex + index + 1;
    const current = dates.get(dateKey) ?? {
      items: new Map<string, ParsedWarehouseProductionPlanItem>(),
      rowCount: 0,
      weekday: text(row[weekdayColumn]) || weekdayLabel(dateKey),
    };
    current.rowCount += 1;
    const existing = current.items.get(sku);
    if (existing) {
      existing.plannedQuantity += plannedQuantity;
      existing.rowNumbers.push(rowNumber);
      if (!existing.name && nameColumn >= 0) existing.name = text(row[nameColumn]);
    } else {
      current.items.set(sku, {
        name: nameColumn >= 0 ? text(row[nameColumn]) : "",
        plannedQuantity,
        rowNumbers: [rowNumber],
        sku,
      });
    }
    dates.set(dateKey, current);
  });

  return [...dates.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([dateKey, group]) => {
      const items = [...group.items.values()];
      return {
        dateKey,
        dateLabel: dateLabel(dateKey),
        items,
        rowCount: group.rowCount,
        skuCount: items.length,
        totalQuantity: items.reduce(
          (total, item) => total + item.plannedQuantity,
          0,
        ),
        weekday: group.weekday,
      };
    });
}
