export const MAX_SHELF_SKU_GROUPS = 6;

export function shelfSkuFamily(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLocaleUpperCase("en-US")
    .match(/^[A-Z]+/)?.[0] ?? "";
}

export function normalizeShelfSkuGroups(values: readonly unknown[]) {
  const result: string[] = [];
  for (const value of values) {
    const family = shelfSkuFamily(value);
    if (!family) {
      throw new Error(`Không lấy được mã chữ đầu SKU từ “${String(value ?? "").trim()}”.`);
    }
    if (!result.includes(family)) result.push(family);
  }
  if (result.length > MAX_SHELF_SKU_GROUPS) {
    throw new Error(`Mỗi kệ chỉ được cấu hình tối đa ${MAX_SHELF_SKU_GROUPS} nhóm SKU.`);
  }
  return result;
}

export function normalizeShelfSkuFloors(
  groups: readonly string[],
  value: unknown,
  floorCount: number,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Vị trí tầng của nhóm SKU không hợp lệ.");
  }
  const input = value as Record<string, unknown>;
  const normalized: Record<string, number> = {};
  for (const group of groups) {
    const floor = input[group];
    if (!Number.isSafeInteger(floor) || Number(floor) < 1 || Number(floor) > floorCount) {
      throw new Error(`Hãy chọn tầng từ 1 đến ${floorCount} cho nhóm ${group}.`);
    }
    normalized[group] = Number(floor);
  }
  if (Object.keys(input).some((key) => !groups.includes(key))) {
    throw new Error("Vị trí tầng chứa nhóm SKU không còn trong cấu hình.");
  }
  return normalized;
}

export function skuBelongsToShelf(sku: string, groups: readonly string[]) {
  const family = shelfSkuFamily(sku);
  return Boolean(family) && groups.includes(family);
}
