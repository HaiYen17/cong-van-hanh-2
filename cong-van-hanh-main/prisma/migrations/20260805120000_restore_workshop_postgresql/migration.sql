-- Restore the full Workshop domain on PostgreSQL.

CREATE TABLE "WorkshopTeam" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Kích hoạt',
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "manager" TEXT,
    "planners" JSONB NOT NULL DEFAULT '[]',
    "approvers" JSONB NOT NULL DEFAULT '[]',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopTeam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopMaterial" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "skuName" TEXT NOT NULL,
    "skuQuantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT NOT NULL,
    "materialUnit" TEXT,
    "materialQuantity" DECIMAL(18,4) NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "rawSource" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopMaterial_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopPlan" (
    "id" TEXT NOT NULL,
    "planCode" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TEAM_PLAN',
    "workshopName" TEXT NOT NULL DEFAULT 'Xưởng chính',
    "teamKey" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "weekKey" TEXT NOT NULL,
    "weekLabel" TEXT NOT NULL,
    "weekStart" DATE,
    "weekEnd" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'Chờ duyệt',
    "approvalStatus" TEXT NOT NULL DEFAULT 'Chờ duyệt',
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "totalDemand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalPlanned" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "creatorId" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "creatorEmployeeId" TEXT,
    "creatorEmail" TEXT,
    "reviewerId" TEXT,
    "reviewerName" TEXT,
    "reviewerEmployeeId" TEXT,
    "reviewerEmail" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "requestId" TEXT,
    "sourceOrderPlanId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopPlanLine" (
    "id" TEXT NOT NULL,
    "lineCode" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "lineIndex" INTEGER NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'production',
    "productName" TEXT NOT NULL,
    "thickness" TEXT,
    "size" TEXT,
    "sku" TEXT,
    "orderQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "receivedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "warrantyType" TEXT,
    "days" JSONB NOT NULL DEFAULT '[0,0,0,0,0,0,0]',
    "demand" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "plannedTotal" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "rawSource" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopPlanLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopPlanAudit" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "note" TEXT,
    "change" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorkshopPlanAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopProposal" (
    "id" TEXT NOT NULL,
    "proposalCode" TEXT NOT NULL,
    "tag" TEXT NOT NULL DEFAULT 'Cập nhật KH tuần',
    "proposalKind" TEXT NOT NULL DEFAULT 'Cập nhật kế hoạch theo ngày',
    "status" TEXT NOT NULL DEFAULT 'Chờ duyệt',
    "weekKey" TEXT NOT NULL,
    "weekLabel" TEXT NOT NULL,
    "proposalDate" DATE NOT NULL,
    "dayKey" TEXT,
    "teamKey" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "planIds" JSONB NOT NULL DEFAULT '[]',
    "sourceVersions" JSONB NOT NULL DEFAULT '[]',
    "sourceLineCount" INTEGER NOT NULL DEFAULT 0,
    "lineCount" INTEGER NOT NULL DEFAULT 0,
    "totalChange" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "affectedTeams" JSONB NOT NULL DEFAULT '[]',
    "summary" TEXT,
    "lines" JSONB NOT NULL DEFAULT '[]',
    "creatorId" TEXT NOT NULL,
    "creatorName" TEXT NOT NULL,
    "creatorEmployeeId" TEXT,
    "creatorEmail" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopProposal_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopReport" (
    "id" TEXT NOT NULL,
    "reportCode" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "reportDate" DATE NOT NULL,
    "dayKey" TEXT,
    "plannedToday" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "actualQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defectLightQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defectMediumQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "defectHeavyQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "reporterId" TEXT NOT NULL,
    "reporterName" TEXT NOT NULL,
    "reporterEmployeeId" TEXT,
    "reporterEmail" TEXT,
    "snapshot" JSONB NOT NULL DEFAULT '{}',
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopInventorySession" (
    "id" TEXT NOT NULL,
    "sessionCode" TEXT NOT NULL,
    "inventoryDate" DATE NOT NULL,
    "workshopName" TEXT NOT NULL DEFAULT 'Xưởng chính',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "operatorId" TEXT NOT NULL,
    "operatorName" TEXT NOT NULL,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopInventorySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkshopInventoryItem" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "materialCode" TEXT NOT NULL,
    "materialName" TEXT,
    "unit" TEXT,
    "expectedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "countedQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "difference" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorkshopInventoryItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorkshopTeam_key_key" ON "WorkshopTeam"("key");
CREATE INDEX "WorkshopTeam_status_sortOrder_idx" ON "WorkshopTeam"("status", "sortOrder");
CREATE UNIQUE INDEX "WorkshopMaterial_sku_materialCode_key" ON "WorkshopMaterial"("sku", "materialCode");
CREATE INDEX "WorkshopMaterial_skuName_sku_idx" ON "WorkshopMaterial"("skuName", "sku");
CREATE INDEX "WorkshopMaterial_materialCode_materialName_idx" ON "WorkshopMaterial"("materialCode", "materialName");
CREATE UNIQUE INDEX "WorkshopPlan_planCode_key" ON "WorkshopPlan"("planCode");
CREATE UNIQUE INDEX "WorkshopPlan_requestId_key" ON "WorkshopPlan"("requestId");
CREATE UNIQUE INDEX "WorkshopPlan_weekKey_teamKey_kind_version_key" ON "WorkshopPlan"("weekKey", "teamKey", "kind", "version");
CREATE INDEX "WorkshopPlan_weekKey_kind_createdAt_idx" ON "WorkshopPlan"("weekKey", "kind", "createdAt" DESC);
CREATE INDEX "WorkshopPlan_teamKey_approvalStatus_createdAt_idx" ON "WorkshopPlan"("teamKey", "approvalStatus", "createdAt" DESC);
CREATE INDEX "WorkshopPlan_sourceOrderPlanId_idx" ON "WorkshopPlan"("sourceOrderPlanId");
CREATE UNIQUE INDEX "WorkshopPlanLine_lineCode_key" ON "WorkshopPlanLine"("lineCode");
CREATE UNIQUE INDEX "WorkshopPlanLine_planId_lineIndex_key" ON "WorkshopPlanLine"("planId", "lineIndex");
CREATE INDEX "WorkshopPlanLine_planId_type_idx" ON "WorkshopPlanLine"("planId", "type");
CREATE INDEX "WorkshopPlanLine_sku_idx" ON "WorkshopPlanLine"("sku");
CREATE INDEX "WorkshopPlanAudit_planId_createdAt_idx" ON "WorkshopPlanAudit"("planId", "createdAt" DESC);
CREATE UNIQUE INDEX "WorkshopProposal_proposalCode_key" ON "WorkshopProposal"("proposalCode");
CREATE INDEX "WorkshopProposal_weekKey_teamKey_proposalDate_createdAt_idx" ON "WorkshopProposal"("weekKey", "teamKey", "proposalDate", "createdAt" DESC);
CREATE INDEX "WorkshopProposal_status_createdAt_idx" ON "WorkshopProposal"("status", "createdAt" DESC);
CREATE UNIQUE INDEX "WorkshopReport_reportCode_key" ON "WorkshopReport"("reportCode");
CREATE UNIQUE INDEX "WorkshopReport_reportKey_key" ON "WorkshopReport"("reportKey");
CREATE UNIQUE INDEX "WorkshopReport_lineId_reportDate_key" ON "WorkshopReport"("lineId", "reportDate");
CREATE INDEX "WorkshopReport_planId_reportDate_idx" ON "WorkshopReport"("planId", "reportDate");
CREATE INDEX "WorkshopReport_reporterId_reportDate_idx" ON "WorkshopReport"("reporterId", "reportDate" DESC);
CREATE UNIQUE INDEX "WorkshopInventorySession_sessionCode_key" ON "WorkshopInventorySession"("sessionCode");
CREATE INDEX "WorkshopInventorySession_inventoryDate_status_idx" ON "WorkshopInventorySession"("inventoryDate" DESC, "status");
CREATE UNIQUE INDEX "WorkshopInventoryItem_sessionId_materialCode_key" ON "WorkshopInventoryItem"("sessionId", "materialCode");
CREATE INDEX "WorkshopInventoryItem_materialCode_idx" ON "WorkshopInventoryItem"("materialCode");

ALTER TABLE "WorkshopPlan" ADD CONSTRAINT "WorkshopPlan_sourceOrderPlanId_fkey" FOREIGN KEY ("sourceOrderPlanId") REFERENCES "WorkshopPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkshopPlanLine" ADD CONSTRAINT "WorkshopPlanLine_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkshopPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopPlanAudit" ADD CONSTRAINT "WorkshopPlanAudit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkshopPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopReport" ADD CONSTRAINT "WorkshopReport_planId_fkey" FOREIGN KEY ("planId") REFERENCES "WorkshopPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopReport" ADD CONSTRAINT "WorkshopReport_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "WorkshopPlanLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkshopInventoryItem" ADD CONSTRAINT "WorkshopInventoryItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "WorkshopInventorySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
