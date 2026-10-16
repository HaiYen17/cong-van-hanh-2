-- Preserve the remaining recruitment operational datasets in PostgreSQL:
-- requisitions, offers and generic configuration/audit rows.

CREATE TABLE "RecruitmentRequisition" (
    "id" TEXT NOT NULL,
    "requisitionCode" TEXT NOT NULL,
    "jobCode" TEXT,
    "department" TEXT,
    "position" TEXT NOT NULL,
    "level" TEXT,
    "company" TEXT,
    "intakeStatus" TEXT,
    "recruitmentStatus" TEXT,
    "recruiter" TEXT,
    "reason" TEXT,
    "requestedQuantity" INTEGER,
    "cancellationStage" TEXT,
    "receivedAt" TIMESTAMP(3),
    "onboardDueAt" TIMESTAMP(3),
    "quarter" TEXT,
    "year" INTEGER,
    "note" TEXT,
    "legacyRowNumber" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentRequisition_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecruitmentOffer" (
    "id" TEXT NOT NULL,
    "applicationId" TEXT,
    "candidateCode" TEXT,
    "candidateName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "department" TEXT,
    "position" TEXT,
    "level" TEXT,
    "requisitionCode" TEXT,
    "source" TEXT,
    "status" TEXT,
    "ownerName" TEXT,
    "onboardAt" TIMESTAMP(3),
    "probationEndAt" TIMESTAMP(3),
    "company" TEXT,
    "compensation" JSONB NOT NULL DEFAULT '{}',
    "employmentRecord" JSONB NOT NULL DEFAULT '{}',
    "note" TEXT,
    "profileUrl" TEXT,
    "legacySource" TEXT NOT NULL,
    "legacyRowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentOffer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecruitmentConfigRecord" (
    "id" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "code" TEXT,
    "name" TEXT,
    "status" TEXT,
    "sourceSheet" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "content" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecruitmentConfigRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentRequisition_requisitionCode_key" ON "RecruitmentRequisition"("requisitionCode");
CREATE UNIQUE INDEX "RecruitmentRequisition_legacyRowNumber_key" ON "RecruitmentRequisition"("legacyRowNumber");
CREATE INDEX "RecruitmentRequisition_recruitmentStatus_receivedAt_idx" ON "RecruitmentRequisition"("recruitmentStatus", "receivedAt");
CREATE INDEX "RecruitmentRequisition_department_position_idx" ON "RecruitmentRequisition"("department", "position");

CREATE UNIQUE INDEX "RecruitmentOffer_legacySource_legacyRowNumber_key" ON "RecruitmentOffer"("legacySource", "legacyRowNumber");
CREATE INDEX "RecruitmentOffer_candidateCode_idx" ON "RecruitmentOffer"("candidateCode");
CREATE INDEX "RecruitmentOffer_status_onboardAt_idx" ON "RecruitmentOffer"("status", "onboardAt");
CREATE INDEX "RecruitmentOffer_department_position_idx" ON "RecruitmentOffer"("department", "position");

CREATE UNIQUE INDEX "RecruitmentConfigRecord_sourceSheet_sourceRow_key" ON "RecruitmentConfigRecord"("sourceSheet", "sourceRow");
CREATE INDEX "RecruitmentConfigRecord_recordType_status_idx" ON "RecruitmentConfigRecord"("recordType", "status");
CREATE INDEX "RecruitmentConfigRecord_recordType_code_idx" ON "RecruitmentConfigRecord"("recordType", "code");

ALTER TABLE "RecruitmentOffer"
ADD CONSTRAINT "RecruitmentOffer_applicationId_fkey"
FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
