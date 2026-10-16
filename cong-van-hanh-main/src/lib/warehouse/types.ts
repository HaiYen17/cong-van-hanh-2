export type WarehouseInventoryCompany = "TVD" | "TVG" | "";
export type WarehouseInventoryType = "START" | "END" | "";

export type WarehouseInventoryComparisonLine = {
  category: "da_quet" | "khop" | "thieu" | "du" | "rfid_khong_co_tren_eshop";
  difference: number;
  expectedQuantity: number;
  name: string;
  physicalQuantity: number;
  rfids: string[];
  sku: string;
};

export type WarehouseInventoryIssue = {
  name?: string;
  reason: string;
  rfid: string;
  sku?: string;
  status?: string;
};

export type WarehouseInventoryDuplicate = {
  count: number;
  reason: string;
  rfid: string;
};

export type WarehouseInventorySummary = {
  cancelledRfidCount: number;
  comparedSkuCount: number;
  duplicateRfidCount: number;
  expectedSkuCount: number;
  inStockRfidCount: number;
  knownRfidCount: number;
  matchedSkuCount: number;
  noEshopSkuCount: number;
  physicalSkuCount: number;
  requestedReadCount: number;
  shortageSkuCount: number;
  surplusSkuCount: number;
  uniqueRfidCount: number;
  unknownRfidCount: number;
  wrongCompanyRfidCount: number;
  wrongStatusRfidCount: number;
};

export type WarehouseInventoryStatementLine = {
  eshopCurrentQuantity: number;
  eshopDifference: number;
  expectedFinalQuantity: number;
  finalQuantity: number;
  inboundQuantity: number;
  name: string;
  openingQuantity: number;
  outboundQuantity: number;
  rfids: string[];
  sku: string;
  status: "OK" | "REVIEW";
};

export type WarehouseInventoryStatement = {
  generatedAt: string;
  lines: WarehouseInventoryStatementLine[];
  readyToConfirm: boolean;
  summary: {
    differenceQuantity: number;
    eshopQuantity: number;
    physicalQuantity: number;
    reviewSkuCount: number;
    totalSkuCount: number;
  };
};

export type WarehouseInventorySessionItem = {
  area: string;
  companyKey: WarehouseInventoryCompany;
  confirmedAt: string | null;
  confirmedByName: string;
  deviceName: string;
  inventoryType: WarehouseInventoryType;
  itemCount: number;
  linkedSessionCount: number;
  message: string;
  operatorName: string;
  processStatus: string;
  scanDate: string;
  sessionKey: string;
  shelf: string;
  source: string;
  summary: WarehouseInventorySummary;
  updatedAt: string;
};

export type WarehouseInventoryScanRow = {
  epc: string;
  issuanceStatus: "ACTIVE" | "CANCELLED";
  itemStatus: string;
  message: string;
  name: string;
  readCount: number;
  sku: string;
  tagStatus: string;
};

export type WarehouseInventoryDetail = WarehouseInventorySessionItem & {
  comparison: WarehouseInventoryComparisonLine[];
  duplicateRfids: WarehouseInventoryDuplicate[];
  rawPayload: Record<string, unknown>;
  scanItems: WarehouseInventoryScanRow[];
  statement: WarehouseInventoryStatement;
  unknownRfids: WarehouseInventoryIssue[];
  wrongCompanyRfids: WarehouseInventoryIssue[];
  wrongStatusRfids: WarehouseInventoryIssue[];
};

export type WarehouseInventoryWorkspaceData = {
  detail: WarehouseInventoryDetail | null;
  generatedAt: string;
  sessions: WarehouseInventorySessionItem[];
  sourceStats: {
    mappedTagCount: number;
    productCount: number;
    tagCount: number;
  };
};

export type WarehouseInventoryActionResult = {
  affectedSessionCount?: number;
  data?: WarehouseInventoryWorkspaceData;
  deletedSessionKeys?: string[];
  message: string;
  ok: boolean;
  redefinitionSessionKey?: string;
  sessionKey?: string;
};

export type WarehouseInventoryPairComparisonLine = {
  difference: number;
  inputQuantity: number;
  name: string;
  outputQuantity: number;
  sku: string;
};

export type WarehouseInventoryPairSession = {
  operatorName: string;
  scanDate: string;
  sessionKey: string;
  updatedAt: string;
};

export type WarehouseInventoryPairComparisonData = {
  inputSession: WarehouseInventoryPairSession;
  lines: WarehouseInventoryPairComparisonLine[];
  outputSession: WarehouseInventoryPairSession;
  summary: {
    changedSkuCount: number;
    differenceQuantity: number;
    inputQuantity: number;
    outputQuantity: number;
    skuCount: number;
  };
};

export type WarehouseInventoryPairComparisonActionResult = {
  data?: WarehouseInventoryPairComparisonData;
  message: string;
  ok: boolean;
};

export type WarehouseInventoryProductOption = {
  barcode: string;
  name: string;
  rfidCount: number;
  sku: string;
  status: string;
};

export type WarehouseInventoryProductSearchActionResult = {
  message: string;
  ok: boolean;
  products: WarehouseInventoryProductOption[];
};

export type WarehouseRfidIssuanceStatus = "ACTIVE" | "CANCELLED";

export type WarehouseRfidRegistryRow = {
  cancelledAt: string | null;
  cancelledByName: string;
  epc: string;
  issuanceSessionKey: string;
  issuanceStatus: WarehouseRfidIssuanceStatus;
  issuedAt: string;
  issuedByName: string;
  issuedDeviceName: string;
  productName: string;
  sku: string;
  stockStatus: string;
  updatedAt: string;
};

export type WarehouseRfidDefinitionSessionItem = {
  barcode: string;
  createdCount: number;
  deviceName: string;
  errorCount: number;
  expectedQty: number;
  issuanceStatus: WarehouseRfidIssuanceStatus;
  occurredAt: string;
  operatorName: string;
  processStatus: string;
  productName: string;
  requestedCount: number;
  sessionKey: string;
  skippedCount: number;
  sku: string;
  source: string;
};

export type WarehouseRfidIssuanceEventRow = {
  barcode: string;
  deviceName: string;
  epc: string;
  eventType: string;
  issuanceStatus: WarehouseRfidIssuanceStatus;
  message: string;
  occurredAt: string;
  operatorName: string;
  productName: string;
  sku: string;
};

export type WarehouseRfidDefinitionDetail =
  WarehouseRfidDefinitionSessionItem & {
    events: WarehouseRfidIssuanceEventRow[];
    rawPayload: Record<string, unknown>;
  };

export type WarehouseInfoWorkspaceData = {
  generatedAt: string;
  query: string;
  registry: WarehouseRfidRegistryRow[];
  selectedSession: WarehouseRfidDefinitionDetail | null;
  sessions: WarehouseRfidDefinitionSessionItem[];
  stats: {
    activeCount: number;
    cancelledCount: number;
    issuedSkuCount: number;
    totalCount: number;
  };
  status: "ALL" | WarehouseRfidIssuanceStatus;
};

export type WarehouseInfoActionResult = {
  data?: WarehouseInfoWorkspaceData;
  message: string;
  ok: boolean;
  sessionKey?: string;
};

export type WarehouseShelfEntityType = "SHELF" | "VEHICLE";

export type WarehouseShelfDefinition = {
  barcode: string;
  code: string;
  entityType: WarehouseShelfEntityType;
  epc: string;
  floorCount: number;
  name: string;
  operationId: string;
  skuConfigurationVersion: number;
  skuConfiguredAt: string | null;
  skuFloors: Record<string, number>;
  skuGroups: string[];
  shelfId: string;
  synced: boolean;
  updatedAt: string;
  version: number;
  warehouse: string;
};

export type WarehouseShelfDefinitionUpdate = Pick<
  WarehouseShelfDefinition,
  | "code"
  | "entityType"
  | "epc"
  | "floorCount"
  | "name"
  | "shelfId"
  | "version"
  | "warehouse"
>;

export type WarehouseShelfDefinitionCreate = Pick<
  WarehouseShelfDefinition,
  "code" | "entityType" | "floorCount" | "name" | "warehouse"
>;

export type WarehouseShelfDefinitionActionResult = {
  message: string;
  ok: boolean;
  shelf?: WarehouseShelfDefinition;
  shelves?: WarehouseShelfDefinition[];
};

export type WarehouseRfidDefinitionResult = {
  createdCount: number;
  errorCount: number;
  errors: Array<{ epc: string; message: string }>;
  message: string;
  ok: boolean;
  sessionId: string;
  skippedCount: number;
};
