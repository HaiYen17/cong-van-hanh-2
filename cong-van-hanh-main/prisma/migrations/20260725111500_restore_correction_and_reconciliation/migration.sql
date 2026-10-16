-- Restore the operational data model used by Hiệu đính hồ sơ and Đối soát.
-- RequestItem keeps each legacy 98_Inbox business row addressable and LegalDossier
-- preserves the correction/storage lifecycle without rewriting the original request.

CREATE TABLE "RequestItem" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "itemIndex" INTEGER NOT NULL,
    "serviceCode" TEXT NOT NULL,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "legacySourceRow" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RequestItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalDossier" (
    "id" TEXT NOT NULL,
    "requestItemId" TEXT NOT NULL,
    "legacyRegistryId" TEXT,
    "documentRegistryId" TEXT,
    "companyId" TEXT,
    "documentTypeId" TEXT,
    "companyNameSnapshot" TEXT,
    "companyShortSnapshot" TEXT,
    "documentTypeSnapshot" TEXT,
    "conditionSnapshot" TEXT,
    "takesNumber" BOOLEAN NOT NULL DEFAULT false,
    "orderStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "fileStatus" TEXT NOT NULL DEFAULT 'PENDING_UPLOAD',
    "numberStatus" TEXT NOT NULL DEFAULT 'UNDECIDED',
    "submissionOfficeKey" TEXT,
    "submissionOfficeLabel" TEXT,
    "generatedStorageName" TEXT,
    "storageCounterparty" TEXT,
    "storageSummary" TEXT,
    "storageRevision" INTEGER,
    "storageIssuedDate" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalDossier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LegalDossierEvent" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "note" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LegalDossierEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FollowUpRequirement" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT,
    "requestId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SIGNED_COPY',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "reason" TEXT NOT NULL,
    "blocksModules" JSONB NOT NULL DEFAULT '[]',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUpRequirement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationRun" (
    "id" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT,
    "rowsUrbox" INTEGER NOT NULL DEFAULT 0,
    "rowsBaseReward" INTEGER NOT NULL DEFAULT 0,
    "rowsInPeriod" INTEGER NOT NULL DEFAULT 0,
    "matchedTransactions" INTEGER NOT NULL DEFAULT 0,
    "accountResolved" INTEGER NOT NULL DEFAULT 0,
    "fallbackCompany" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2),
    "summary" TEXT,
    "error" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReconciliationRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationSourceFile" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileObjectId" TEXT NOT NULL,
    "originalSheetName" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "checksum" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReconciliationSourceFile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationDetail" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "exchangeTime" TIMESTAMP(3),
    "program" TEXT,
    "orderCode" TEXT,
    "transactionCode" TEXT,
    "occurrence" INTEGER NOT NULL DEFAULT 1,
    "customerCode" TEXT,
    "brand" TEXT,
    "giftName" TEXT,
    "category" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "value" DECIMAL(18,2),
    "employeeName" TEXT,
    "rawEmployeeName" TEXT,
    "username" TEXT,
    "company" TEXT,
    "department" TEXT,
    "employeeCode" TEXT,
    "hrMatched" BOOLEAN NOT NULL DEFAULT false,
    "accountMatched" BOOLEAN NOT NULL DEFAULT false,
    "rawUrbox" JSONB NOT NULL DEFAULT '{}',
    "rawBaseReward" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReconciliationDetail_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationIssue" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "sourceRow" INTEGER,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "transactionCode" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReconciliationIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReconciliationOutput" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileObjectId" TEXT,
    "driveFileId" TEXT,
    "spreadsheetUrl" TEXT,
    "sheetName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReconciliationOutput_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RequestItem_requestId_itemIndex_key" ON "RequestItem"("requestId", "itemIndex");
CREATE INDEX "RequestItem_serviceCode_status_idx" ON "RequestItem"("serviceCode", "status");
CREATE UNIQUE INDEX "LegalDossier_requestItemId_key" ON "LegalDossier"("requestItemId");
CREATE UNIQUE INDEX "LegalDossier_legacyRegistryId_key" ON "LegalDossier"("legacyRegistryId");
CREATE UNIQUE INDEX "LegalDossier_documentRegistryId_key" ON "LegalDossier"("documentRegistryId");
CREATE INDEX "LegalDossier_fileStatus_orderStatus_createdAt_idx" ON "LegalDossier"("fileStatus", "orderStatus", "createdAt" DESC);
CREATE INDEX "LegalDossier_submissionOfficeKey_fileStatus_idx" ON "LegalDossier"("submissionOfficeKey", "fileStatus");
CREATE INDEX "LegalDossier_companyId_documentTypeId_idx" ON "LegalDossier"("companyId", "documentTypeId");
CREATE INDEX "LegalDossierEvent_dossierId_createdAt_idx" ON "LegalDossierEvent"("dossierId", "createdAt");
CREATE INDEX "LegalDossierEvent_type_createdAt_idx" ON "LegalDossierEvent"("type", "createdAt");
CREATE INDEX "FollowUpRequirement_targetUserId_status_idx" ON "FollowUpRequirement"("targetUserId", "status");
CREATE INDEX "FollowUpRequirement_requestId_status_idx" ON "FollowUpRequirement"("requestId", "status");
CREATE INDEX "FollowUpRequirement_dossierId_status_idx" ON "FollowUpRequirement"("dossierId", "status");
CREATE UNIQUE INDEX "ReconciliationRun_periodKey_attempt_key" ON "ReconciliationRun"("periodKey", "attempt");
CREATE INDEX "ReconciliationRun_status_startedAt_idx" ON "ReconciliationRun"("status", "startedAt" DESC);
CREATE INDEX "ReconciliationRun_year_month_attempt_idx" ON "ReconciliationRun"("year", "month", "attempt");
CREATE UNIQUE INDEX "ReconciliationSourceFile_runId_kind_key" ON "ReconciliationSourceFile"("runId", "kind");
CREATE INDEX "ReconciliationSourceFile_kind_createdAt_idx" ON "ReconciliationSourceFile"("kind", "createdAt");
CREATE UNIQUE INDEX "ReconciliationDetail_runId_sourceRow_key" ON "ReconciliationDetail"("runId", "sourceRow");
CREATE INDEX "ReconciliationDetail_runId_company_idx" ON "ReconciliationDetail"("runId", "company");
CREATE INDEX "ReconciliationDetail_transactionCode_occurrence_idx" ON "ReconciliationDetail"("transactionCode", "occurrence");
CREATE INDEX "ReconciliationIssue_runId_severity_idx" ON "ReconciliationIssue"("runId", "severity");
CREATE INDEX "ReconciliationIssue_code_createdAt_idx" ON "ReconciliationIssue"("code", "createdAt");
CREATE UNIQUE INDEX "ReconciliationOutput_periodKey_kind_key" ON "ReconciliationOutput"("periodKey", "kind");
CREATE INDEX "ReconciliationOutput_runId_kind_idx" ON "ReconciliationOutput"("runId", "kind");

ALTER TABLE "RequestItem" ADD CONSTRAINT "RequestItem_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegalDossier" ADD CONSTRAINT "LegalDossier_requestItemId_fkey" FOREIGN KEY ("requestItemId") REFERENCES "RequestItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegalDossier" ADD CONSTRAINT "LegalDossier_documentRegistryId_fkey" FOREIGN KEY ("documentRegistryId") REFERENCES "DocumentRegistry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalDossier" ADD CONSTRAINT "LegalDossier_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalDossier" ADD CONSTRAINT "LegalDossier_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalDossier" ADD CONSTRAINT "LegalDossier_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegalDossierEvent" ADD CONSTRAINT "LegalDossierEvent_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "LegalDossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegalDossierEvent" ADD CONSTRAINT "LegalDossierEvent_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpRequirement" ADD CONSTRAINT "FollowUpRequirement_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "LegalDossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpRequirement" ADD CONSTRAINT "FollowUpRequirement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FollowUpRequirement" ADD CONSTRAINT "FollowUpRequirement_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FollowUpRequirement" ADD CONSTRAINT "FollowUpRequirement_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FollowUpRequirement" ADD CONSTRAINT "FollowUpRequirement_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReconciliationRun" ADD CONSTRAINT "ReconciliationRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ReconciliationSourceFile" ADD CONSTRAINT "ReconciliationSourceFile_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationSourceFile" ADD CONSTRAINT "ReconciliationSourceFile_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ReconciliationDetail" ADD CONSTRAINT "ReconciliationDetail_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationIssue" ADD CONSTRAINT "ReconciliationIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationOutput" ADD CONSTRAINT "ReconciliationOutput_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ReconciliationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReconciliationOutput" ADD CONSTRAINT "ReconciliationOutput_fileObjectId_fkey" FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
