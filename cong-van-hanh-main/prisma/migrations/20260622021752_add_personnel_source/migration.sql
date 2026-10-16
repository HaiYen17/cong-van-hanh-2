-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "birthDate" TEXT,
ADD COLUMN     "identityDate" TEXT,
ADD COLUMN     "identityNumber" TEXT,
ADD COLUMN     "identityPlace" TEXT,
ADD COLUMN     "terminationDate" TEXT;

-- CreateTable
CREATE TABLE "PersonnelSource" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "apiLink" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "mappings" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncCount" INTEGER,
    "lastSyncMessage" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonnelSource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PersonnelSource_companyId_key" ON "PersonnelSource"("companyId");

-- AddForeignKey
ALTER TABLE "PersonnelSource" ADD CONSTRAINT "PersonnelSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
