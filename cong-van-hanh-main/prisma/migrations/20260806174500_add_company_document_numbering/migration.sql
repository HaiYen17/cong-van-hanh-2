CREATE TABLE "DocumentTypeCompanyNumbering" (
    "id" TEXT NOT NULL,
    "documentTypeId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "startIndex" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentTypeCompanyNumbering_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DocumentTypeCompanyNumbering_documentTypeId_companyId_key"
ON "DocumentTypeCompanyNumbering"("documentTypeId", "companyId");

CREATE INDEX "DocumentTypeCompanyNumbering_companyId_idx"
ON "DocumentTypeCompanyNumbering"("companyId");

ALTER TABLE "DocumentTypeCompanyNumbering"
ADD CONSTRAINT "DocumentTypeCompanyNumbering_documentTypeId_fkey"
FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentTypeCompanyNumbering"
ADD CONSTRAINT "DocumentTypeCompanyNumbering_companyId_fkey"
FOREIGN KEY ("companyId") REFERENCES "Company"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
