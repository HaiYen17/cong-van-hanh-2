import type { WarehouseShelfDefinition } from "./types";

export type ShelfSkuProductExample = {
  name: string;
  sku: string;
};

export type ShelfSkuGroupCandidate = {
  displayName: string;
  examples: ShelfSkuProductExample[];
  group: string;
  productCount: number;
};

export type ShelfSkuConfigWorkspace = {
  generatedAt: string;
  shelves: WarehouseShelfDefinition[];
  skuGroupNames: Record<string, string>;
};

export type ShelfSkuConfigActionResult = {
  candidates?: ShelfSkuGroupCandidate[];
  data?: ShelfSkuConfigWorkspace;
  message: string;
  ok: boolean;
};
