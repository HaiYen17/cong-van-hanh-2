import {
  ALLOCATION_CATEGORY,
  type AllocationCatalogItem,
} from "./allocation-catalog";
import {
  ALLOCATION_IMPORT_MAX_ROWS,
  normalizeAllocationImportText,
} from "./allocation-import";

type JsonObject = Record<string, unknown>;

export type AllocationRequestValidationResult =
  | { error: string; ok: false }
  | { ok: true; payload: JsonObject };

function objectOf(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function validateAllocationRequestPayload(
  payload: unknown,
  catalog: AllocationCatalogItem[],
): AllocationRequestValidationResult {
  const source = objectOf(payload);
  const items = Array.isArray(source.items) ? source.items : [];

  if (!items.length) {
    return { error: "Danh sách cấp phát chưa có mục nào.", ok: false };
  }
  if (items.length > ALLOCATION_IMPORT_MAX_ROWS) {
    return {
      error: `Mỗi đề xuất chỉ nhận tối đa ${ALLOCATION_IMPORT_MAX_ROWS} mục cấp phát.`,
      ok: false,
    };
  }

  const canonicalItems: JsonObject[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const row = objectOf(items[index]);
    const category = text(row.category);
    const itemName = text(row.itemName);
    const quantity = positiveInteger(row.quantity);
    const catalogMatches = catalog.filter(
      (item) =>
        normalizeAllocationImportText(item.category) ===
          normalizeAllocationImportText(category) &&
        normalizeAllocationImportText(item.name) ===
          normalizeAllocationImportText(itemName),
    );
    const lineLabel = `Mục ${index + 1}`;

    if (!category) {
      return { error: `${lineLabel}: chưa có danh mục.`, ok: false };
    }
    if (!itemName) {
      return { error: `${lineLabel}: chưa có tên hàng hóa / CCDC.`, ok: false };
    }
    if (catalogMatches.length !== 1) {
      return {
        error: `${lineLabel}: “${itemName}” không còn khớp duy nhất với danh mục “${category}”. Vui lòng kiểm tra lại Setup tài sản.`,
        ok: false,
      };
    }
    if (quantity === null) {
      return {
        error: `${lineLabel}: số lượng phải là số nguyên lớn hơn 0.`,
        ok: false,
      };
    }

    const catalogItem = catalogMatches[0];
    let description = "";
    if (catalogItem.category === ALLOCATION_CATEGORY.stationery) {
      description = catalogItem.description || "";
    } else if (catalogItem.category === ALLOCATION_CATEGORY.uniform) {
      const requestedDescription = text(row.description);
      const size = catalogItem.sizeOptions.find(
        (option) =>
          normalizeAllocationImportText(option.value) ===
          normalizeAllocationImportText(requestedDescription),
      );
      if (!size) {
        return {
          error: `${lineLabel}: size “${requestedDescription || "(trống)"}” không hợp lệ cho “${catalogItem.name}”.`,
          ok: false,
        };
      }
      description = size.value;
    }

    canonicalItems.push({
      ...row,
      assignee: text(row.assignee),
      assigneeId: text(row.assigneeId),
      category: catalogItem.category,
      description,
      itemName: catalogItem.name,
      quantity: String(quantity),
    });
  }

  return {
    ok: true,
    payload: {
      ...source,
      itemCount: canonicalItems.length,
      items: canonicalItems,
    },
  };
}
