CREATE TABLE "EvaluationRecord" (
  "id" TEXT NOT NULL,
  "recordType" TEXT NOT NULL,
  "parentId" TEXT,
  "code" TEXT,
  "name" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "content" JSONB NOT NULL DEFAULT '{}',
  "text" TEXT,
  "note" TEXT,
  "legacyId" TEXT,
  "legacySheetName" TEXT,
  "legacyRowNumber" INTEGER,
  "sourceFingerprint" TEXT,
  "createdByName" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvaluationRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EvaluationRecord_legacyId_key" ON "EvaluationRecord"("legacyId");
CREATE INDEX "EvaluationRecord_recordType_status_idx" ON "EvaluationRecord"("recordType", "status");
CREATE INDEX "EvaluationRecord_recordType_parentId_idx" ON "EvaluationRecord"("recordType", "parentId");
CREATE INDEX "EvaluationRecord_recordType_code_idx" ON "EvaluationRecord"("recordType", "code");
CREATE INDEX "EvaluationRecord_legacySheetName_legacyRowNumber_idx" ON "EvaluationRecord"("legacySheetName", "legacyRowNumber");

CREATE TABLE "RecruitmentSourceDefinition" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "mapping" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "legacyRowNumber" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentSourceDefinition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentSourceDefinition_name_key" ON "RecruitmentSourceDefinition"("name");
CREATE INDEX "RecruitmentSourceDefinition_status_name_idx" ON "RecruitmentSourceDefinition"("status", "name");

CREATE TABLE "RecruitmentCampaign" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "company" TEXT,
  "location" TEXT,
  "block" TEXT,
  "department" TEXT,
  "division" TEXT,
  "team" TEXT,
  "groupName" TEXT,
  "orgPath" TEXT,
  "position" TEXT NOT NULL,
  "cvType" TEXT,
  "campaignName" TEXT,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "availableOrder" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "legacyRowNumber" INTEGER,
  "raw" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentCampaign_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentCampaign_code_source_key" ON "RecruitmentCampaign"("code", "source");
CREATE INDEX "RecruitmentCampaign_status_endDate_idx" ON "RecruitmentCampaign"("status", "endDate");
CREATE INDEX "RecruitmentCampaign_department_position_idx" ON "RecruitmentCampaign"("department", "position");

CREATE TABLE "RecruitmentCandidate" (
  "id" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "phone" TEXT,
  "email" TEXT,
  "birthDate" TEXT,
  "address" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentCandidate_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentCandidate_phone_idx" ON "RecruitmentCandidate"("phone");
CREATE INDEX "RecruitmentCandidate_email_idx" ON "RecruitmentCandidate"("email");
CREATE INDEX "RecruitmentCandidate_fullName_idx" ON "RecruitmentCandidate"("fullName");

CREATE TABLE "RecruitmentApplication" (
  "id" TEXT NOT NULL,
  "applicationCode" TEXT NOT NULL,
  "candidateCode" TEXT,
  "candidateId" TEXT NOT NULL,
  "campaignId" TEXT,
  "requisitionCode" TEXT,
  "company" TEXT,
  "department" TEXT,
  "position" TEXT,
  "level" TEXT,
  "source" TEXT,
  "receivedAt" TIMESTAMP(3),
  "cvUrl" TEXT,
  "recruiter" TEXT,
  "status" TEXT,
  "note" TEXT,
  "legacyRowNumber" INTEGER,
  "raw" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentApplication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentApplication_applicationCode_key" ON "RecruitmentApplication"("applicationCode");
CREATE UNIQUE INDEX "RecruitmentApplication_legacyRowNumber_key" ON "RecruitmentApplication"("legacyRowNumber");
CREATE INDEX "RecruitmentApplication_candidateCode_idx" ON "RecruitmentApplication"("candidateCode");
CREATE INDEX "RecruitmentApplication_requisitionCode_idx" ON "RecruitmentApplication"("requisitionCode");
CREATE INDEX "RecruitmentApplication_department_position_idx" ON "RecruitmentApplication"("department", "position");
CREATE INDEX "RecruitmentApplication_status_receivedAt_idx" ON "RecruitmentApplication"("status", "receivedAt");

CREATE TABLE "RecruitmentIntake" (
  "id" TEXT NOT NULL,
  "fullName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "position" TEXT,
  "source" TEXT,
  "requisitionCode" TEXT,
  "cvUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "legacyRowNumber" INTEGER,
  "raw" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentIntake_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentIntake_legacyRowNumber_key" ON "RecruitmentIntake"("legacyRowNumber");
CREATE INDEX "RecruitmentIntake_status_createdAt_idx" ON "RecruitmentIntake"("status", "createdAt");
CREATE INDEX "RecruitmentIntake_phone_idx" ON "RecruitmentIntake"("phone");

CREATE TABLE "RecruitmentJourney" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "stageKey" TEXT NOT NULL DEFAULT 'cv_screening',
  "progressKey" TEXT NOT NULL DEFAULT 'pending',
  "outcomeKey" TEXT,
  "nextAction" TEXT,
  "ownerEmployeeId" TEXT,
  "ownerName" TEXT,
  "dueAt" TIMESTAMP(3),
  "testStatus" TEXT,
  "offerStatus" TEXT,
  "lastContactAt" TIMESTAMP(3),
  "contactAttempts" INTEGER NOT NULL DEFAULT 0,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentJourney_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentJourney_applicationId_key" ON "RecruitmentJourney"("applicationId");
CREATE INDEX "RecruitmentJourney_stageKey_progressKey_idx" ON "RecruitmentJourney"("stageKey", "progressKey");
CREATE INDEX "RecruitmentJourney_ownerEmployeeId_dueAt_idx" ON "RecruitmentJourney"("ownerEmployeeId", "dueAt");

CREATE TABLE "RecruitmentInterview" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "roundKey" TEXT NOT NULL,
  "roundLabel" TEXT NOT NULL,
  "startAt" TIMESTAMP(3),
  "location" TEXT,
  "meetingLink" TEXT,
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "note" TEXT,
  "createdByName" TEXT,
  "updatedByName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentInterview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentInterview_applicationId_roundKey_idx" ON "RecruitmentInterview"("applicationId", "roundKey");
CREATE INDEX "RecruitmentInterview_startAt_status_idx" ON "RecruitmentInterview"("startAt", "status");

CREATE TABLE "RecruitmentAssignment" (
  "id" TEXT NOT NULL,
  "interviewId" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "roundKey" TEXT NOT NULL,
  "reviewerEmployeeId" TEXT,
  "reviewerName" TEXT NOT NULL,
  "roleKey" TEXT NOT NULL,
  "roleLabel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'assigned',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentAssignment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentAssignment_reviewerEmployeeId_status_idx" ON "RecruitmentAssignment"("reviewerEmployeeId", "status");
CREATE INDEX "RecruitmentAssignment_applicationId_roundKey_idx" ON "RecruitmentAssignment"("applicationId", "roundKey");

CREATE TABLE "RecruitmentScorecard" (
  "id" TEXT NOT NULL,
  "interviewId" TEXT,
  "assignmentId" TEXT,
  "applicationId" TEXT NOT NULL,
  "roundKey" TEXT NOT NULL,
  "roundLabel" TEXT NOT NULL,
  "reviewerEmployeeId" TEXT,
  "reviewerName" TEXT,
  "roleKey" TEXT,
  "roleLabel" TEXT,
  "scoringMode" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "finalScore" DECIMAL(8,3),
  "decision" TEXT,
  "overallComment" TEXT,
  "criteriaSetId" TEXT,
  "criteriaSetName" TEXT,
  "jdPosition" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1,
  "editRevision" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentScorecard_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentScorecard_applicationId_roundKey_version_idx" ON "RecruitmentScorecard"("applicationId", "roundKey", "version");
CREATE INDEX "RecruitmentScorecard_reviewerEmployeeId_status_idx" ON "RecruitmentScorecard"("reviewerEmployeeId", "status");

CREATE TABLE "RecruitmentScoreItem" (
  "id" TEXT NOT NULL,
  "scorecardId" TEXT NOT NULL,
  "sectionKey" TEXT,
  "groupKey" TEXT,
  "groupName" TEXT,
  "itemKey" TEXT,
  "itemName" TEXT,
  "criterionId" TEXT,
  "criterionName" TEXT,
  "weight" DECIMAL(8,3),
  "score" DECIMAL(8,3),
  "note" TEXT,
  "evidence" TEXT,
  "level" INTEGER,
  "bonusTechnical" BOOLEAN NOT NULL DEFAULT false,
  "bonusLearning" BOOLEAN NOT NULL DEFAULT false,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentScoreItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentScoreItem_scorecardId_sectionKey_idx" ON "RecruitmentScoreItem"("scorecardId", "sectionKey");

CREATE TABLE "RecruitmentTimeline" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "fromValue" TEXT,
  "toValue" TEXT,
  "title" TEXT NOT NULL,
  "detail" TEXT,
  "actorEmployeeId" TEXT,
  "actorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentTimeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentTimeline_applicationId_createdAt_idx" ON "RecruitmentTimeline"("applicationId", "createdAt");

CREATE TABLE "RecruitmentPublication" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "publicStatus" TEXT,
  "summary" TEXT,
  "strengths" TEXT,
  "development" TEXT,
  "publishedScore" DECIMAL(8,3),
  "roundVersions" JSONB NOT NULL DEFAULT '{}',
  "publishedAt" TIMESTAMP(3),
  "publishedByName" TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecruitmentPublication_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecruitmentPublication_applicationId_key" ON "RecruitmentPublication"("applicationId");
CREATE UNIQUE INDEX "RecruitmentPublication_accessToken_key" ON "RecruitmentPublication"("accessToken");

CREATE TABLE "RecruitmentLegacySnapshot" (
  "id" TEXT NOT NULL,
  "applicationId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "sourceSheet" TEXT NOT NULL,
  "sourceRow" INTEGER,
  "payload" JSONB NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecruitmentLegacySnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecruitmentLegacySnapshot_applicationId_kind_idx" ON "RecruitmentLegacySnapshot"("applicationId", "kind");
CREATE INDEX "RecruitmentLegacySnapshot_sourceSheet_sourceRow_idx" ON "RecruitmentLegacySnapshot"("sourceSheet", "sourceRow");

ALTER TABLE "RecruitmentApplication"
  ADD CONSTRAINT "RecruitmentApplication_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "RecruitmentCandidate"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecruitmentApplication"
  ADD CONSTRAINT "RecruitmentApplication_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "RecruitmentCampaign"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecruitmentJourney"
  ADD CONSTRAINT "RecruitmentJourney_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentInterview"
  ADD CONSTRAINT "RecruitmentInterview_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentAssignment"
  ADD CONSTRAINT "RecruitmentAssignment_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "RecruitmentInterview"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentAssignment"
  ADD CONSTRAINT "RecruitmentAssignment_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentScorecard"
  ADD CONSTRAINT "RecruitmentScorecard_interviewId_fkey"
  FOREIGN KEY ("interviewId") REFERENCES "RecruitmentInterview"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecruitmentScorecard"
  ADD CONSTRAINT "RecruitmentScorecard_assignmentId_fkey"
  FOREIGN KEY ("assignmentId") REFERENCES "RecruitmentAssignment"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecruitmentScorecard"
  ADD CONSTRAINT "RecruitmentScorecard_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentScoreItem"
  ADD CONSTRAINT "RecruitmentScoreItem_scorecardId_fkey"
  FOREIGN KEY ("scorecardId") REFERENCES "RecruitmentScorecard"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentTimeline"
  ADD CONSTRAINT "RecruitmentTimeline_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentPublication"
  ADD CONSTRAINT "RecruitmentPublication_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecruitmentLegacySnapshot"
  ADD CONSTRAINT "RecruitmentLegacySnapshot_applicationId_fkey"
  FOREIGN KEY ("applicationId") REFERENCES "RecruitmentApplication"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
