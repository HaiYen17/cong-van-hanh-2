export type WarehouseCatalogProduct = {
  barcode: string;
  color: string;
  id: string;
  name: string;
  purchasePrice: number | null;
  rfidCount: number;
  salePrice: number | null;
  size: string;
  sku: string;
  source: string;
  status: string;
  stockTvd: number;
  stockTvg: number;
  taxRate: number | null;
  unit: string;
  updatedAt: string;
};

export type WarehouseBarcodePrintHistoryItem = {
  actorName: string;
  createdAt: string;
  format: string;
  id: string;
  labelCount: number;
  productCount: number;
  startSlot: number;
};

export type WarehouseCatalogWorkspaceData = {
  barcodeFilter: "ALL" | "MAPPED" | "MISSING" | "DUPLICATE";
  generatedAt: string;
  hasMoreProducts: boolean;
  printHistory: WarehouseBarcodePrintHistoryItem[];
  products: WarehouseCatalogProduct[];
  query: string;
  resultCount: number;
  statusFilter: "ACTIVE" | "ALL" | "INACTIVE";
  summary: {
    activeProducts: number;
    duplicateBarcodes: number;
    mappedBarcodes: number;
    missingBarcodes: number;
    totalProducts: number;
  };
};

export type WarehouseCatalogViewInput = {
  barcodeFilter?: WarehouseCatalogWorkspaceData["barcodeFilter"];
  query?: string;
  statusFilter?: WarehouseCatalogWorkspaceData["statusFilter"];
};

export type WarehouseCatalogImportResult = {
  createdCount: number;
  errorCount: number;
  errors: Array<{ message: string; rowNumber: number }>;
  fileName: string;
  generatedBarcodeCount: number;
  importedCount: number;
  sheetName: string;
  skippedCount: number;
  updatedCount: number;
};

export type WarehouseCatalogManualRow = {
  color: string;
  name: string;
  purchasePrice: string;
  salePrice: string;
  size: string;
  sku: string;
  taxRate: string;
  unit: string;
};

export type WarehouseCatalogActionResult = {
  data?: WarehouseCatalogWorkspaceData;
  importResult?: WarehouseCatalogImportResult;
  message: string;
  ok: boolean;
};

export type WarehouseStockPrintItem = {
  barcode: string;
  name: string;
  productId: string;
  quantity: number;
  rowNumbers: number[];
  sku: string;
};

export type WarehouseStockPrintIssue = {
  name: string;
  quantity: number;
  reason: "MISSING_BARCODE" | "MISSING_PRODUCT";
  rowNumbers: number[];
  sku: string;
};

export type WarehouseStockPrintAnalysis = {
  fileName: string;
  ignoredRowCount: number;
  issueItems: WarehouseStockPrintIssue[];
  issueLabelCount: number;
  positiveSkuCount: number;
  printableItems: WarehouseStockPrintItem[];
  printableLabelCount: number;
  sheetName: string;
  totalLabelCount: number;
};

export type WarehouseStockPrintActionResult = {
  analysis?: WarehouseStockPrintAnalysis;
  message: string;
  ok: boolean;
};

export type WarehouseProductionPlanItem = {
  name: string;
  plannedQuantity: number;
  product: WarehouseCatalogProduct | null;
  rowNumbers: number[];
  sku: string;
};

export type WarehouseProductionPlanDate = {
  dateKey: string;
  dateLabel: string;
  items: WarehouseProductionPlanItem[];
  rowCount: number;
  skuCount: number;
  totalQuantity: number;
  weekday: string;
};

export type WarehouseProductionPlanData = {
  dates: WarehouseProductionPlanDate[];
  defaultDateKey: string;
  generatedAt: string;
  sheetName: string;
  todayKey: string;
};

export type WarehouseProductionPlanActionResult = {
  data?: WarehouseProductionPlanData;
  message: string;
  ok: boolean;
};

export type WarehousePrintProductSearchResult = {
  message: string;
  ok: boolean;
  products: WarehouseCatalogProduct[];
};

export type WarehouseBarcodeMapping = {
  barcode: string;
  sku: string;
};
