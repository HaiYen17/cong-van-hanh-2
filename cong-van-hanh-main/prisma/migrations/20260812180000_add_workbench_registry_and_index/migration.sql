-- CreateTable
CREATE TABLE "WorkbenchWidgetConfig" (
    "widgetKey" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowMultiple" BOOLEAN NOT NULL DEFAULT false,
    "defaultColor" TEXT NOT NULL DEFAULT 'teal',
    "defaultWidth" INTEGER NOT NULL,
    "defaultHeight" INTEGER NOT NULL,
    "minWidth" INTEGER NOT NULL,
    "minHeight" INTEGER NOT NULL,
    "maxWidth" INTEGER NOT NULL,
    "maxHeight" INTEGER NOT NULL,
    "defaultVisible" BOOLEAN NOT NULL DEFAULT false,
    "defaultX" INTEGER NOT NULL DEFAULT 0,
    "defaultY" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchWidgetConfig_pkey" PRIMARY KEY ("widgetKey")
);

-- CreateTable
CREATE TABLE "WorkbenchSourceConfig" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "moduleKey" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "lastSyncedAt" TIMESTAMP(3),
    "lastStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "itemCount" INTEGER NOT NULL DEFAULT 0,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchSourceConfig_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WorkbenchItem" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "sourceRecordId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "moduleKey" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" TEXT NOT NULL,
    "priority" TEXT,
    "href" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkbenchItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkbenchWidgetConfig_isEnabled_sortOrder_idx" ON "WorkbenchWidgetConfig"("isEnabled", "sortOrder");

-- CreateIndex
CREATE INDEX "WorkbenchSourceConfig_isEnabled_sortOrder_idx" ON "WorkbenchSourceConfig"("isEnabled", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "WorkbenchItem_ownerUserId_sourceKey_sourceRecordId_key" ON "WorkbenchItem"("ownerUserId", "sourceKey", "sourceRecordId");

-- CreateIndex
CREATE INDEX "WorkbenchItem_ownerUserId_isActive_dueAt_idx" ON "WorkbenchItem"("ownerUserId", "isActive", "dueAt");

-- CreateIndex
CREATE INDEX "WorkbenchItem_ownerUserId_occurredAt_idx" ON "WorkbenchItem"("ownerUserId", "occurredAt" DESC);

-- CreateIndex
CREATE INDEX "WorkbenchItem_sourceKey_isActive_lastSyncedAt_idx" ON "WorkbenchItem"("sourceKey", "isActive", "lastSyncedAt");

-- AddForeignKey
ALTER TABLE "WorkbenchItem" ADD CONSTRAINT "WorkbenchItem_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
