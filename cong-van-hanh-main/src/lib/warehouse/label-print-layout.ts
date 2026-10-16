const SLOTS_PER_FORMAT: Record<string, number> = {
  TOMY_133_16: 16,
  TOMY_148_33: 33,
  TOMY_148_BARCODE_33: 33,
};

export function warehouseLabelSlotsPerPage(format: string) {
  return SLOTS_PER_FORMAT[format] || 33;
}

export function isWarehouseLabelStartSlotValid(format: string, value: unknown) {
  const slot = Number(value);
  return (
    Number.isInteger(slot) &&
    slot >= 1 &&
    slot <= warehouseLabelSlotsPerPage(format)
  );
}

export function buildWarehouseLabelPrintPages<T>(
  items: T[],
  slotsPerPage: number,
  startSlot: number,
) {
  const capacity = Math.max(1, Math.trunc(slotsPerPage));
  const firstSlot = Math.max(1, Math.min(Math.trunc(startSlot), capacity));
  const offset = firstSlot - 1;
  const pageCount = items.length
    ? Math.ceil((offset + items.length) / capacity)
    : 0;
  const pages: Array<Array<{ item: T; slotIndex: number }>> = Array.from(
    { length: pageCount },
    () => [],
  );

  items.forEach((item, index) => {
    const absoluteSlot = offset + index;
    pages[Math.floor(absoluteSlot / capacity)]?.push({
      item,
      slotIndex: absoluteSlot % capacity,
    });
  });
  return pages;
}

export function buildWarehouseGroupedLabelPrintPages<T>(
  groups: T[][],
  slotsPerPage: number,
  columns: number,
  startSlot: number,
  alignGroupRows = true,
) {
  const capacity = Math.max(1, Math.trunc(slotsPerPage));
  const columnCount = Math.max(1, Math.min(Math.trunc(columns), capacity));
  const firstSlot = Math.max(1, Math.min(Math.trunc(startSlot), capacity));
  const pages: Array<Array<{ item: T; slotIndex: number }>> = [];
  const orderedGroups = alignGroupRows
    ? [
        ...groups.filter((group) => group.length > 1),
        ...groups.filter((group) => group.length <= 1),
      ]
    : groups;
  let absoluteSlot = firstSlot - 1;

  orderedGroups.forEach((group, groupIndex) => {
    group.forEach((item) => {
      const pageIndex = Math.floor(absoluteSlot / capacity);
      pages[pageIndex] ??= [];
      pages[pageIndex].push({
        item,
        slotIndex: absoluteSlot % capacity,
      });
      absoluteSlot += 1;
    });

    if (
      !alignGroupRows ||
      groupIndex === orderedGroups.length - 1 ||
      group.length <= 1
    ) {
      return;
    }
    const usedColumns = absoluteSlot % columnCount;
    if (usedColumns) absoluteSlot += columnCount - usedColumns;
  });

  return pages;
}
