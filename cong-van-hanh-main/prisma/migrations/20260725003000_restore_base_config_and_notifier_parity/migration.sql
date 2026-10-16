-- Restore the fields from ConfigModal / Công ty.
ALTER TABLE "Company"
  ADD COLUMN "sendMailLocationKey" TEXT,
  ADD COLUMN "sendMailAddressPriority" TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN "oldAddress" TEXT,
  ADD COLUMN "oldProvinceId" TEXT,
  ADD COLUMN "oldProvinceName" TEXT,
  ADD COLUMN "oldDistrictId" TEXT,
  ADD COLUMN "oldDistrictName" TEXT,
  ADD COLUMN "oldWardId" TEXT,
  ADD COLUMN "oldWardName" TEXT;

-- A normalized replacement for the personnel-identity-link rows formerly
-- stored in 08_Bộ Tag.
CREATE TABLE "PersonnelIdentityLink" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "primaryEmployeeId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "note" TEXT,
  "createdById" TEXT,
  "updatedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PersonnelIdentityLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PersonnelIdentityMember" (
  "linkId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonnelIdentityMember_pkey" PRIMARY KEY ("linkId", "employeeId")
);

CREATE UNIQUE INDEX "PersonnelIdentityMember_employeeId_key"
  ON "PersonnelIdentityMember"("employeeId");
CREATE INDEX "PersonnelIdentityLink_status_idx"
  ON "PersonnelIdentityLink"("status");
CREATE INDEX "PersonnelIdentityLink_primaryEmployeeId_idx"
  ON "PersonnelIdentityLink"("primaryEmployeeId");
CREATE INDEX "PersonnelIdentityMember_employeeId_idx"
  ON "PersonnelIdentityMember"("employeeId");

ALTER TABLE "PersonnelIdentityLink"
  ADD CONSTRAINT "PersonnelIdentityLink_primaryEmployeeId_fkey"
  FOREIGN KEY ("primaryEmployeeId") REFERENCES "Employee"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PersonnelIdentityMember"
  ADD CONSTRAINT "PersonnelIdentityMember_linkId_fkey"
  FOREIGN KEY ("linkId") REFERENCES "PersonnelIdentityLink"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PersonnelIdentityMember"
  ADD CONSTRAINT "PersonnelIdentityMember_employeeId_fkey"
  FOREIGN KEY ("employeeId") REFERENCES "Employee"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Restore every Notifier/event field present in ConfigModal.
ALTER TABLE "MotivationEvent"
  ADD COLUMN "imageUrls" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "imageIds" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "thumbnailUrl" TEXT,
  ADD COLUMN "thumbnailId" TEXT,
  ADD COLUMN "displayChannel" TEXT NOT NULL DEFAULT 'both',
  ADD COLUMN "popupContentMode" TEXT NOT NULL DEFAULT 'full',
  ADD COLUMN "bypassSnooze" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "linkedTask" JSONB;
