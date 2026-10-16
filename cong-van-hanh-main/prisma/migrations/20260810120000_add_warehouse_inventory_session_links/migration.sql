CREATE TABLE "WarehouseInventorySessionLink" (
    "id" TEXT NOT NULL,
    "mergedSessionId" TEXT NOT NULL,
    "sourceSessionId" TEXT NOT NULL,
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WarehouseInventorySessionLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WarehouseInventorySessionLink_mergedSessionId_sourceSessionId_key"
ON "WarehouseInventorySessionLink"("mergedSessionId", "sourceSessionId");

CREATE INDEX "WarehouseInventorySessionLink_sourceSessionId_idx"
ON "WarehouseInventorySessionLink"("sourceSessionId");

ALTER TABLE "WarehouseInventorySessionLink"
ADD CONSTRAINT "WarehouseInventorySessionLink_mergedSessionId_fkey"
FOREIGN KEY ("mergedSessionId") REFERENCES "WarehouseInventorySession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WarehouseInventorySessionLink"
ADD CONSTRAINT "WarehouseInventorySessionLink_sourceSessionId_fkey"
FOREIGN KEY ("sourceSessionId") REFERENCES "WarehouseInventorySession"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
