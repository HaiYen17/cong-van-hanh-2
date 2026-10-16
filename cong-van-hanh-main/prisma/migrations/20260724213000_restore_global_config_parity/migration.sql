ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'DELETE';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'SYNC';

ALTER TABLE "ViettelPostAccount"
  ADD COLUMN "companyScope" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "departmentScope" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "EshopAccount"
  ADD COLUMN "companyName" TEXT,
  ADD COLUMN "companyScope" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "departmentScope" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN "dataRootFolderId" TEXT,
  ADD COLUMN "rawOrdersFolderId" TEXT,
  ADD COLUMN "snapshotFolderId" TEXT;

UPDATE "ViettelPostAccount" AS account
SET "companyScope" = jsonb_build_array(company."legalName")
FROM "Company" AS company
WHERE account."companyId" = company.id
  AND account."companyScope" = '[]'::jsonb;

UPDATE "EshopAccount" AS account
SET
  "companyName" = COALESCE(account."companyName", company."legalName"),
  "companyScope" = jsonb_build_array(company."legalName")
FROM "Company" AS company
WHERE account."companyId" = company.id
  AND account."companyScope" = '[]'::jsonb;
