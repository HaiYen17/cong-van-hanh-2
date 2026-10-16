export type WarehouseSkuSearchItem = {
  barcode?: string | null;
  name?: string | null;
  sku: string;
};

function key(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleUpperCase("vi")
    .trim();
}

function score(query: string, item: WarehouseSkuSearchItem) {
  const sku = key(item.sku);
  const barcode = key(item.barcode);
  const name = key(item.name);
  const skuPosition = sku.indexOf(query);
  const barcodePosition = barcode.indexOf(query);
  const namePosition = name.indexOf(query);

  if (sku === query) return [0, 0, sku.length] as const;
  if (sku.startsWith(query)) return [1, 0, sku.length] as const;
  if (skuPosition >= 0) return [2, skuPosition, sku.length] as const;
  if (barcode === query) return [3, 0, barcode.length] as const;
  if (barcode.startsWith(query)) return [4, 0, barcode.length] as const;
  if (barcodePosition >= 0) return [5, barcodePosition, barcode.length] as const;
  if (name.startsWith(query)) return [6, 0, name.length] as const;
  if (namePosition >= 0) return [7, namePosition, name.length] as const;
  return [8, Number.MAX_SAFE_INTEGER, sku.length] as const;
}

export function compareWarehouseSkuSearch(
  rawQuery: string,
  left: WarehouseSkuSearchItem,
  right: WarehouseSkuSearchItem,
) {
  const query = key(rawQuery);
  if (!query) return left.sku.localeCompare(right.sku, "vi");
  const leftScore = score(query, left);
  const rightScore = score(query, right);
  return (
    leftScore[0] - rightScore[0] ||
    leftScore[1] - rightScore[1] ||
    leftScore[2] - rightScore[2] ||
    left.sku.localeCompare(right.sku, "vi") ||
    key(left.name).localeCompare(key(right.name), "vi")
  );
}

export function rankWarehouseSkuSearch<T extends WarehouseSkuSearchItem>(
  query: string,
  items: T[],
) {
  return [...items].sort((left, right) =>
    compareWarehouseSkuSearch(query, left, right),
  );
}
