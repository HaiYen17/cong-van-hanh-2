import type {
  WarehouseProductionPlanItem,
  WarehouseStockPrintIssue,
} from "./catalog-types";

export type WarehouseProductionPlanDraftItem = WarehouseProductionPlanItem & {
  issueReason?: WarehouseStockPrintIssue["reason"];
  quantity: number;
};

export function toggleWarehouseProductionPlanDate(
  selectedDateKey: string,
  clickedDateKey: string,
) {
  return selectedDateKey === clickedDateKey ? "" : clickedDateKey;
}

export function buildWarehouseProductionPlanDraftItems(
  items?: readonly WarehouseProductionPlanItem[],
): WarehouseProductionPlanDraftItem[] {
  return (items ?? []).map((item) => ({
    ...item,
    quantity: item.plannedQuantity,
  }));
}
