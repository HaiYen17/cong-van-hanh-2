-- CreateTable
CREATE TABLE "WarehouseProduct" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "color" TEXT,
    "size" TEXT,
    "purchasePrice" DECIMAL(18,2),
    "salePrice" DECIMAL(18,2),
    "taxRate" DECIMAL(8,4),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "source" TEXT,
    "note" TEXT,
    "stockTvg" INTEGER NOT NULL DEFAULT 0,
    "stockTvd" INTEGER NOT NULL DEFAULT 0,
    "reservedTvg" INTEGER NOT NULL DEFAULT 0,
    "reservedTvd" INTEGER NOT NULL DEFAULT 0,
    "reorderAlert" INTEGER,
    "inboundTodayTvg" INTEGER NOT NULL DEFAULT 0,
    "inboundTodayTvd" INTEGER NOT NULL DEFAULT 0,
    "legacySheetRow" INTEGER,
    "rawSource" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarehouseProduct_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseRfidTag" (
    "id" TEXT NOT NULL,
    "recordKey" TEXT,
    "epc" TEXT NOT NULL,
    "productId" TEXT,
    "productSku" TEXT,
    "productName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Tồn kho',
    "entryDate" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "inboundSessionKey" TEXT,
    "outboundSessionKey" TEXT,
    "lastInventorySessionKey" TEXT,
    "lastScannedAt" TIMESTAMP(3),
    "sourceCompany" TEXT,
    "outboundCompany" TEXT,
    "eshopOrderCode" TEXT,
    "trackingCode" TEXT,
    "note" TEXT,
    "createdByName" TEXT,
    "updatedByName" TEXT,
    "legacySheetRow" INTEGER,
    "rawSource" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarehouseRfidTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseInventorySession" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "scanDate" DATE NOT NULL,
    "companyKey" TEXT NOT NULL,
    "inventoryType" TEXT NOT NULL,
    "area" TEXT,
    "shelf" TEXT,
    "source" TEXT NOT NULL DEFAULT 'Android/RFID',
    "operatorName" TEXT,
    "deviceName" TEXT,
    "processStatus" TEXT NOT NULL DEFAULT 'RECEIVED',
    "message" TEXT,
    "requestedReadCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueRfidCount" INTEGER NOT NULL DEFAULT 0,
    "knownRfidCount" INTEGER NOT NULL DEFAULT 0,
    "inStockRfidCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateRfidCount" INTEGER NOT NULL DEFAULT 0,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "comparison" JSONB NOT NULL DEFAULT '[]',
    "unknownRfids" JSONB NOT NULL DEFAULT '[]',
    "wrongStatusRfids" JSONB NOT NULL DEFAULT '[]',
    "wrongCompanyRfids" JSONB NOT NULL DEFAULT '[]',
    "duplicateRfids" JSONB NOT NULL DEFAULT '[]',
    "statement" JSONB,
    "rawPayload" JSONB NOT NULL DEFAULT '{}',
    "legacyRecordId" TEXT,
    "legacySheetRow" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "confirmedByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WarehouseInventorySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarehouseInventoryScanItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "epc" TEXT NOT NULL,
    "firstReadAt" TIMESTAMP(3),
    "lastReadAt" TIMESTAMP(3),
    "readCount" INTEGER NOT NULL DEFAULT 1,
    "itemStatus" TEXT NOT NULL,
    "message" TEXT,
    "rfidTagId" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WarehouseInventoryScanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WarehouseProduct_sku_key" ON "WarehouseProduct"("sku");
CREATE UNIQUE INDEX "WarehouseProduct_legacySheetRow_key" ON "WarehouseProduct"("legacySheetRow");
CREATE INDEX "WarehouseProduct_status_name_idx" ON "WarehouseProduct"("status", "name");
CREATE INDEX "WarehouseProduct_barcode_idx" ON "WarehouseProduct"("barcode");
CREATE UNIQUE INDEX "WarehouseRfidTag_recordKey_key" ON "WarehouseRfidTag"("recordKey");
CREATE UNIQUE INDEX "WarehouseRfidTag_epc_key" ON "WarehouseRfidTag"("epc");
CREATE UNIQUE INDEX "WarehouseRfidTag_legacySheetRow_key" ON "WarehouseRfidTag"("legacySheetRow");
CREATE INDEX "WarehouseRfidTag_productId_status_idx" ON "WarehouseRfidTag"("productId", "status");
CREATE INDEX "WarehouseRfidTag_productSku_idx" ON "WarehouseRfidTag"("productSku");
CREATE INDEX "WarehouseRfidTag_lastInventorySessionKey_idx" ON "WarehouseRfidTag"("lastInventorySessionKey");
CREATE UNIQUE INDEX "WarehouseInventorySession_sessionKey_key" ON "WarehouseInventorySession"("sessionKey");
CREATE INDEX "WarehouseInventorySession_scanDate_companyKey_idx" ON "WarehouseInventorySession"("scanDate" DESC, "companyKey");
CREATE INDEX "WarehouseInventorySession_processStatus_updatedAt_idx" ON "WarehouseInventorySession"("processStatus", "updatedAt" DESC);
CREATE INDEX "WarehouseInventorySession_legacyRecordId_idx" ON "WarehouseInventorySession"("legacyRecordId");
CREATE UNIQUE INDEX "WarehouseInventoryScanItem_sessionId_epc_key" ON "WarehouseInventoryScanItem"("sessionId", "epc");
CREATE INDEX "WarehouseInventoryScanItem_epc_idx" ON "WarehouseInventoryScanItem"("epc");
CREATE INDEX "WarehouseInventoryScanItem_productId_itemStatus_idx" ON "WarehouseInventoryScanItem"("productId", "itemStatus");

-- AddForeignKey
ALTER TABLE "WarehouseRfidTag" ADD CONSTRAINT "WarehouseRfidTag_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseInventoryScanItem" ADD CONSTRAINT "WarehouseInventoryScanItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WarehouseInventorySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseInventoryScanItem" ADD CONSTRAINT "WarehouseInventoryScanItem_rfidTagId_fkey" FOREIGN KEY ("rfidTagId") REFERENCES "WarehouseRfidTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WarehouseInventoryScanItem" ADD CONSTRAINT "WarehouseInventoryScanItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "WarehouseProduct"("id") ON DELETE SET NULL ON UPDATE CASCADE;
