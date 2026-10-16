-- Keep stock lifecycle (Tồn kho/Đã giao/...) separate from RFID issuance state.
ALTER TABLE "WarehouseRfidTag"
  ADD COLUMN "issuanceStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "issuedByName" TEXT,
  ADD COLUMN "issuanceSessionKey" TEXT,
  ADD COLUMN "issuedDeviceName" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "cancelledByName" TEXT;

UPDATE "WarehouseRfidTag"
SET
  "issuanceStatus" = CASE
    WHEN UPPER(COALESCE("status", '')) IN ('HUY', 'HỦY', 'CANCELLED', 'CANCELED', 'INACTIVE') THEN 'CANCELLED'
    ELSE 'ACTIVE'
  END,
  "issuedAt" = COALESCE("entryDate", "createdAt"),
  "issuedByName" = "createdByName",
  "issuanceSessionKey" = "inboundSessionKey";

CREATE INDEX "WarehouseRfidTag_issuanceStatus_issuedAt_idx"
  ON "WarehouseRfidTag"("issuanceStatus", "issuedAt" DESC);
CREATE INDEX "WarehouseRfidTag_issuanceSessionKey_idx"
  ON "WarehouseRfidTag"("issuanceSessionKey");

CREATE TABLE "WarehouseRfidDefinitionSession" (
  "id" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "mode" TEXT NOT NULL DEFAULT 'definition',
  "sku" TEXT,
  "productName" TEXT,
  "barcode" TEXT,
  "issuanceStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "operatorName" TEXT,
  "deviceName" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "expectedQty" INTEGER NOT NULL DEFAULT 0,
  "requestedCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "processStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "message" TEXT,
  "source" TEXT NOT NULL DEFAULT 'Android/RFID',
  "scanPower" INTEGER,
  "scanRangeHint" TEXT,
  "rawPayload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WarehouseRfidDefinitionSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WarehouseRfidIssuanceEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "rfidTagId" TEXT,
  "epc" TEXT NOT NULL,
  "sku" TEXT,
  "productName" TEXT,
  "barcode" TEXT,
  "eventType" TEXT NOT NULL DEFAULT 'ISSUED',
  "issuanceStatus" TEXT NOT NULL DEFAULT 'ACTIVE',
  "operatorName" TEXT,
  "deviceName" TEXT,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "message" TEXT,
  "rawPayload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WarehouseRfidIssuanceEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseRfidDefinitionSession_sessionKey_key"
  ON "WarehouseRfidDefinitionSession"("sessionKey");
CREATE INDEX "WarehouseRfidDefinitionSession_occurredAt_idx"
  ON "WarehouseRfidDefinitionSession"("occurredAt" DESC);
CREATE INDEX "WarehouseRfidDefinitionSession_issuanceStatus_occurredAt_idx"
  ON "WarehouseRfidDefinitionSession"("issuanceStatus", "occurredAt" DESC);
CREATE INDEX "WarehouseRfidDefinitionSession_sku_occurredAt_idx"
  ON "WarehouseRfidDefinitionSession"("sku", "occurredAt" DESC);

CREATE UNIQUE INDEX "WarehouseRfidIssuanceEvent_sessionId_epc_key"
  ON "WarehouseRfidIssuanceEvent"("sessionId", "epc");
CREATE INDEX "WarehouseRfidIssuanceEvent_epc_occurredAt_idx"
  ON "WarehouseRfidIssuanceEvent"("epc", "occurredAt" DESC);
CREATE INDEX "WarehouseRfidIssuanceEvent_sku_occurredAt_idx"
  ON "WarehouseRfidIssuanceEvent"("sku", "occurredAt" DESC);
CREATE INDEX "WarehouseRfidIssuanceEvent_issuanceStatus_occurredAt_idx"
  ON "WarehouseRfidIssuanceEvent"("issuanceStatus", "occurredAt" DESC);

ALTER TABLE "WarehouseRfidIssuanceEvent"
  ADD CONSTRAINT "WarehouseRfidIssuanceEvent_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "WarehouseRfidDefinitionSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WarehouseRfidIssuanceEvent"
  ADD CONSTRAINT "WarehouseRfidIssuanceEvent_rfidTagId_fkey"
  FOREIGN KEY ("rfidTagId") REFERENCES "WarehouseRfidTag"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Register the third restored Kho vận module and its read permission.
INSERT INTO "AppModule" (
  "id", "key", "label", "description", "icon", "groupId",
  "sortOrder", "isActive", "createdAt", "updatedAt"
)
SELECT
  'warehouse-info-module', 'warehouse-info', 'Thông tin kho',
  'Tra cứu RFID đã phát hành và toàn bộ lịch sử định nghĩa RFID.',
  'scan-search', "id", 25, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ModuleGroup"
WHERE "key" = 'warehouse'
ON CONFLICT ("key") DO UPDATE SET
  "label" = EXCLUDED."label",
  "description" = EXCLUDED."description",
  "icon" = EXCLUDED."icon",
  "groupId" = EXCLUDED."groupId",
  "isActive" = TRUE,
  "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "Permission" (
  "id", "key", "module", "action", "description", "appModuleId", "createdAt"
)
SELECT
  'warehouse-info-read-permission', 'warehouse_info.read',
  'warehouse_info', 'read', 'Xem Thông tin kho.', "id", CURRENT_TIMESTAMP
FROM "AppModule"
WHERE "key" = 'warehouse-info'
ON CONFLICT ("key") DO UPDATE SET
  "description" = EXCLUDED."description",
  "appModuleId" = EXCLUDED."appModuleId";
